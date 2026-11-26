import type { SessionUser } from '../types';
import {
  buildChatSessionHeaders,
  buildChatSessionSenderContext,
  normalizeChatSessionForUpload,
  resolveChatSupabaseAccessToken,
  sendChatMessage,
  type ChatAttachmentType,
  type ChatContact,
  type ChatMessage,
  type ChatRoomId,
  type DrivePermissionScope,
} from './chatService';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

export type ChatUploadPhase =
  | 'preparing'
  | 'uploading_transit'
  | 'transferring_to_drive'
  | 'initializing_video_session'
  | 'uploading_video_direct'
  | 'finalizing_video'
  | 'completed';

export interface ChatMediaUploadProgress {
  percent: number;
  phase: ChatUploadPhase;
  bytesUploaded: number;
  totalBytes: number;
  label: string;
}

export interface ChatMediaUploadResult {
  ok: true;
  storageProvider: 'google_drive';
  attachmentType: Exclude<ChatAttachmentType, 'none'>;
  driveFileId: string;
  drivePermissionScope?: DrivePermissionScope;
  driveWebViewLink?: string | null;
  driveThumbnailLink?: string | null;
  folderPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  attachmentUrl: string;
  thumbnailUrl: string | null;
  webViewLink: string;
  transitDeleted: boolean;
  messageUpdated: boolean;
}

export interface UploadChatAttachmentParams {
  session: SessionUser;
  roomId: ChatRoomId;
  file: File;
  messageId?: string;
  onProgress?: (progress: ChatMediaUploadProgress) => void;
  signal?: AbortSignal;
}

export interface SendChatMessageWithAttachmentParams {
  session: SessionUser;
  roomId: ChatRoomId;
  file: File;
  caption?: string;
  replyToId?: string | null;
  replyPreview?: string | null;
  recipient?: Pick<ChatContact, 'participant_id' | 'display_name' | 'role'> | null;
  onProgress?: (progress: ChatMediaUploadProgress) => void;
  signal?: AbortSignal;
}

const VIDEO_EXTENSION_RE = /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i;
const VIDEO_MIME_SET = new Set([
  'application/mp4',
  'application/x-matroska',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/3gpp',
  'video/x-m4v',
]);

// Kelipatan 256 KiB wajib sesuai spesifikasi Google Drive Resumable Upload API (5 MiB = 20 * 256 KiB)
const VIDEO_CHUNK_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 4;
const MAX_NON_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export function isVideoMediaFile(
  fileOrMeta: Pick<File, 'type' | 'name'> | { mimeType?: string | null; fileName?: string | null }
): boolean {
  const mime = ('type' in fileOrMeta ? fileOrMeta.type : fileOrMeta.mimeType) || '';
  const name = ('name' in fileOrMeta ? fileOrMeta.name : fileOrMeta.fileName) || '';
  const cleanMime = String(mime).trim().toLowerCase();
  const cleanName = String(name).trim().toLowerCase();
  if (cleanMime.startsWith('video/')) return true;
  if (VIDEO_MIME_SET.has(cleanMime)) return true;
  if (VIDEO_EXTENSION_RE.test(cleanName)) return true;
  return false;
}

export function classifyChatAttachmentType(
  file: Pick<File, 'type' | 'name'>
): Exclude<ChatAttachmentType, 'none'> {
  if (isVideoMediaFile(file)) return 'video';
  const cleanMime = String(file.type || '').trim().toLowerCase();
  const cleanName = String(file.name || '').trim().toLowerCase();
  if (cleanMime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic|heif)$/i.test(cleanName)) {
    return 'photo';
  }
  return 'document';
}

function sanitizeClientFileName(rawName: string, fallbackExt = 'bin'): string {
  const last = String(rawName || '').split(/[\\/]/).pop() || '';
  const safe = last.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) return `media-${Date.now()}.${fallbackExt}`;
  return safe.slice(0, 120);
}

function buildTransitSlug(session: SessionUser): { roleFolder: 'admin' | 'warga' | 'petugas'; slug: string } {
  const ctx = buildChatSessionSenderContext(session);
  const roleFolder = ctx.role;
  const participantId = ctx.senderId;
  const rawPart = participantId.includes(':')
    ? participantId.split(':').slice(1).join('-')
    : participantId;
  const slug =
    rawPart
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'user';
  return { roleFolder, slug };
}

function buildSessionIdentityHeaders(session: SessionUser): Record<string, string> {
  return buildChatSessionHeaders(session);
}

function getSupabasePublicConfig(): { url: string; anonKey: string } | null {
  const url = ((import.meta.env.VITE_SUPABASE_URL as string | undefined) || '').trim().replace(/\/+$/, '');
  const anonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '').trim();
  if (!url || !anonKey || !url.startsWith('http')) return null;
  return { url, anonKey };
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Unggahan dibatalkan.', 'AbortError');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Unggahan dibatalkan.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface ChatUploadErrorDiagnostics {
  stage?: string;
  reason?: string;
  missingFields?: string[];
  invalidFields?: string[];
  fieldReasons?: Record<string, string>;
}

export class ChatMediaUploadError extends Error {
  stage?: string;
  reason?: string;
  missingFields?: string[];
  invalidFields?: string[];
  fieldReasons?: Record<string, string>;

  constructor(message: string, diagnostics?: ChatUploadErrorDiagnostics | null) {
    super(message);
    this.name = 'ChatMediaUploadError';
    if (diagnostics?.stage) this.stage = diagnostics.stage;
    if (diagnostics?.reason) this.reason = diagnostics.reason;
    if (diagnostics?.missingFields?.length) this.missingFields = [...diagnostics.missingFields];
    if (diagnostics?.invalidFields?.length) this.invalidFields = [...diagnostics.invalidFields];
    if (diagnostics?.fieldReasons && Object.keys(diagnostics.fieldReasons).length > 0) {
      this.fieldReasons = { ...diagnostics.fieldReasons };
    }
  }
}

type BackendErrorPayload = {
  ok?: boolean;
  error?: string;
  reason?: unknown;
  stage?: unknown;
  missingFields?: unknown;
  invalidFields?: unknown;
  fieldReasons?: unknown;
};

function sanitizeDiagnosticFieldList(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of val) {
    if (typeof item !== 'string') continue;
    const clean = item.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function sanitizeDiagnosticFieldReasons(val: unknown): Record<string, string> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawReason] of Object.entries(val as Record<string, unknown>)) {
    const key = String(rawKey || '').trim();
    const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
    if (key && reason) {
      out[key] = reason;
    }
  }
  return out;
}

function parseBackendErrorDiagnostics(
  payload: BackendErrorPayload | null | undefined
): ChatUploadErrorDiagnostics | null {
  if (!payload || typeof payload !== 'object') return null;
  const stage =
    typeof payload.stage === 'string' && payload.stage.trim() ? payload.stage.trim() : undefined;
  const reason =
    typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : undefined;
  const missingFields = sanitizeDiagnosticFieldList(payload.missingFields);
  const invalidFields = sanitizeDiagnosticFieldList(payload.invalidFields);
  const fieldReasons = sanitizeDiagnosticFieldReasons(payload.fieldReasons);

  if (
    !stage &&
    !reason &&
    missingFields.length === 0 &&
    invalidFields.length === 0 &&
    Object.keys(fieldReasons).length === 0
  ) {
    return null;
  }

  return {
    ...(stage ? { stage } : {}),
    ...(reason ? { reason } : {}),
    ...(missingFields.length > 0 ? { missingFields } : {}),
    ...(invalidFields.length > 0 ? { invalidFields } : {}),
    ...(Object.keys(fieldReasons).length > 0 ? { fieldReasons } : {}),
  };
}

function hasFieldDiagnostics(diag?: ChatUploadErrorDiagnostics | null): boolean {
  if (!diag) return false;
  return (
    (diag.missingFields?.length || 0) > 0 ||
    (diag.invalidFields?.length || 0) > 0 ||
    Object.keys(diag.fieldReasons || {}).length > 0
  );
}

function isMissingOnlyDiagnostics(diag?: ChatUploadErrorDiagnostics | null): boolean {
  if (!diag) return false;
  return (
    (diag.missingFields?.length || 0) > 0 &&
    (diag.invalidFields?.length || 0) === 0
  );
}

function hasInvalidFieldDiagnostics(diag?: ChatUploadErrorDiagnostics | null): boolean {
  if (!diag) return false;
  return (diag.invalidFields?.length || 0) > 0;
}

const DEFAULT_PRODUCTION_API_ORIGIN = 'https://e-card-ipl.vercel.app';

function getProductionApiOrigin(): string {
  const raw = String(
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_PRODUCTION_API_ORIGIN || ''
  )
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/\/+$/, '');
  if (raw && /^https?:\/\//i.test(raw)) {
    return raw;
  }
  return DEFAULT_PRODUCTION_API_ORIGIN;
}

function isVercelDeploymentOrigin(): boolean {
  if (typeof window === 'undefined' || !window.location) return true;
  const prodOrigin = getProductionApiOrigin();
  if (window.location.origin === prodOrigin) return true;
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'e-card-ipl.vercel.app' || host.endsWith('.vercel.app');
}

function buildApiCandidateUrls(apiPath: string): Array<{ url: string; isLocalPreviewFallback: boolean }> {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const prodOrigin = getProductionApiOrigin();
  if (isVercelDeploymentOrigin()) {
    return [{ url: normalizedPath, isLocalPreviewFallback: false }];
  }
  return [
    { url: `${prodOrigin}${normalizedPath}`, isLocalPreviewFallback: false },
    { url: normalizedPath, isLocalPreviewFallback: true },
  ];
}

function isEmptyLocalEnvLegacyError(
  message: string,
  diagnostics: ChatUploadErrorDiagnostics | null
): boolean {
  const missing = diagnostics?.missingFields || [];
  if (
    missing.some((f) =>
      /GOOGLE_DRIVE_PRIVATE_KEY|GOOGLE_PRIVATE_KEY|GOOGLE_OAUTH_CLIENT_ID|GOOGLE_OAUTH_CLIENT_SECRET|GOOGLE_OAUTH_REFRESH_TOKEN|SUPABASE_SERVICE_ROLE_KEY/i.test(
        f
      )
    )
  ) {
    return true;
  }
  return /field kosong:\s*\[[^\]]*(GOOGLE_DRIVE_PRIVATE_KEY|GOOGLE_PRIVATE_KEY|GOOGLE_OAUTH_)/i.test(
    message
  );
}

async function callBackendOrEdgeFunction<T extends BackendErrorPayload>(params: {
  edgeFunctionName: string;
  apiPath: string;
  session: SessionUser;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<T> {
  const normalizedSession = normalizeChatSessionForUpload(params.session);
  const identityHeaders = buildSessionIdentityHeaders(normalizedSession);
  const senderContext = buildChatSessionSenderContext(normalizedSession);
  const enrichedBody: Record<string, unknown> = {
    ...params.body,
    sender: senderContext,
  };
  const sbCfg = getSupabasePublicConfig();
  const userJwt = await resolveChatSupabaseAccessToken(normalizedSession);

  let edgeFailure: {
    status: number;
    message: string;
    diagnostics: ChatUploadErrorDiagnostics | null;
  } | null = null;

  // 1. Prioritaskan Supabase Edge Function produksi bila Supabase aktif (tanpa cache)
  if (sbCfg) {
    try {
      const bearerToken = userJwt || sbCfg.anonKey;
      const edgeRes = await fetch(`${sbCfg.url}/functions/v1/${params.edgeFunctionName}`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbCfg.anonKey,
          Authorization: `Bearer ${bearerToken}`,
          ...identityHeaders,
        },
        body: JSON.stringify(enrichedBody),
        signal: params.signal,
      });

      const edgeJson = (await edgeRes.json().catch(() => ({}))) as T;
      if (edgeRes.ok && edgeJson.ok !== false) {
        return edgeJson;
      }

      const edgeDiagnostics = parseBackendErrorDiagnostics(edgeJson);
      const edgeErrorMsg =
        typeof edgeJson.error === 'string' && edgeJson.error.trim() ? edgeJson.error.trim() : '';
      const edgeCombinedText = `${edgeErrorMsg} ${edgeDiagnostics?.reason || ''}`;
      const isLegacySaError =
        /GOOGLE_DRIVE_PRIVATE_KEY|GOOGLE_PRIVATE_KEY|Service Account|private_key/i.test(
          edgeCombinedText
        ) || isEmptyLocalEnvLegacyError(edgeErrorMsg, edgeDiagnostics);
      const isStalePrivateProxyError =
        params.edgeFunctionName === 'chat-drive-private-access' &&
        (edgeRes.status === 401 || edgeRes.status === 403) &&
        !edgeDiagnostics?.reason;

      // Error validasi/otorisasi spesifik (400/401/403) langsung diteruskan dengan reason spesifik,
      // kecuali bila Edge Function belum terdeploy ulang (masih mengembalikan error Service Account / tanpa reason).
      if (
        (edgeRes.status === 400 || edgeRes.status === 401 || edgeRes.status === 403) &&
        !isLegacySaError &&
        !isStalePrivateProxyError
      ) {
        throw new ChatMediaUploadError(
          edgeErrorMsg || edgeDiagnostics?.reason || `Permintaan ditolak (${edgeRes.status}).`,
          edgeDiagnostics
        );
      }

      edgeFailure = {
        status: edgeRes.status,
        message: edgeErrorMsg || edgeDiagnostics?.reason || '',
        diagnostics: edgeDiagnostics,
      };
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (err instanceof ChatMediaUploadError) {
        throw err;
      }
      if (
        err instanceof Error &&
        /DILARANG|tidak memiliki akses|tidak aktif|nonaktif|dicabut|tidak valid|ditolak|Verifikasi/i.test(
          err.message
        )
      ) {
        throw err;
      }
    }
  }

  // 2. Pada pratinjau non-Vercel (*.run.app / localhost / StackBlitz), arahkan langsung ke API produksi Vercel
  // yang menyimpan secrets OAuth2 terbaru agar tidak memukul server lokal yang tidak punya secrets.
  const candidates = buildApiCandidateUrls(params.apiPath);
  let lastApiFailure: {
    status: number;
    message: string;
    diagnostics: ChatUploadErrorDiagnostics | null;
  } | null = null;

  for (const candidate of candidates) {
    try {
      const apiRes = await fetch(candidate.url, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(userJwt ? { Authorization: `Bearer ${userJwt}` } : {}),
          ...identityHeaders,
        },
        body: JSON.stringify(enrichedBody),
        signal: params.signal,
      });

      const apiJson = (await apiRes.json().catch(() => ({}))) as T;
      if (apiRes.ok && apiJson.ok !== false) {
        return apiJson;
      }

      const apiDiagnostics = parseBackendErrorDiagnostics(apiJson);
      const apiErrorMsg =
        typeof apiJson.error === 'string' && apiJson.error.trim() ? apiJson.error.trim() : '';

      // Jika fallback lokal hanya gagal karena container pratinjau tidak memiliki env/secrets,
      // pertahankan error asli dari produksi/Edge Function.
      if (
        candidate.isLocalPreviewFallback &&
        isEmptyLocalEnvLegacyError(apiErrorMsg, apiDiagnostics) &&
        (lastApiFailure || edgeFailure)
      ) {
        break;
      }

      lastApiFailure = {
        status: apiRes.status,
        message: apiErrorMsg,
        diagnostics: apiDiagnostics,
      };

      // Jangan coba fallback lokal jika server produksi Vercel sudah merespons (status HTTP apa pun)
      if (!candidate.isLocalPreviewFallback) {
        break;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      if (!candidate.isLocalPreviewFallback && candidates.length > 1) {
        continue;
      }
      if (err instanceof ChatMediaUploadError) {
        throw err;
      }
      if (lastApiFailure?.message) {
        throw new ChatMediaUploadError(lastApiFailure.message, lastApiFailure.diagnostics);
      }
      if (edgeFailure && (hasFieldDiagnostics(edgeFailure.diagnostics) || edgeFailure.message)) {
        throw new ChatMediaUploadError(
          edgeFailure.message || `Gagal memproses media di Edge Function (${edgeFailure.status}).`,
          edgeFailure.diagnostics
        );
      }
      throw err;
    }
  }

  const preferEdgeDiagnostics =
    hasFieldDiagnostics(edgeFailure?.diagnostics) &&
    (!hasFieldDiagnostics(lastApiFailure?.diagnostics) ||
      (hasInvalidFieldDiagnostics(edgeFailure?.diagnostics) &&
        isMissingOnlyDiagnostics(lastApiFailure?.diagnostics)) ||
      isEmptyLocalEnvLegacyError(lastApiFailure?.message || '', lastApiFailure?.diagnostics || null));

  if (preferEdgeDiagnostics && edgeFailure) {
    throw new ChatMediaUploadError(
      edgeFailure.message ||
        lastApiFailure?.message ||
        `Gagal memproses media di Edge Function (${edgeFailure.status}).`,
      edgeFailure.diagnostics
    );
  }

  throw new ChatMediaUploadError(
    lastApiFailure?.message ||
      edgeFailure?.message ||
      `Gagal memproses media di server (${lastApiFailure?.status ?? edgeFailure?.status ?? 500}).`,
    lastApiFailure?.diagnostics || edgeFailure?.diagnostics
  );
}

function parseRangeHeaderLastByte(rangeHeader: string | null): number | null {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/bytes=\d+-(\d+)/i);
  if (!match) return null;
  const end = Number(match[1]);
  return Number.isFinite(end) ? end : null;
}

async function probeResumableOffset(
  sessionUri: string,
  totalBytes: number,
  signal?: AbortSignal
): Promise<number | null> {
  try {
    const res = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes */${totalBytes}`,
      },
      signal,
    });
    if (res.status === 308) {
      const endByte = parseRangeHeaderLastByte(res.headers.get('range'));
      return endByte !== null ? endByte + 1 : 0;
    }
    return null;
  } catch {
    return null;
  }
}

async function uploadVideoDirectToDrive(params: UploadChatAttachmentParams): Promise<ChatMediaUploadResult> {
  const { session, roomId, file, messageId, onProgress, signal } = params;
  if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `Ukuran video harus antara 1 byte hingga ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB.`
    );
  }

  const mimeType =
    file.type && file.type.toLowerCase().startsWith('video/') ? file.type.toLowerCase() : 'video/mp4';
  const safeName = sanitizeClientFileName(file.name, 'mp4');

  onProgress?.({
    percent: 3,
    phase: 'initializing_video_session',
    bytesUploaded: 0,
    totalBytes: file.size,
    label: 'Menyiapkan jalur langsung Google Drive...',
  });

  // 1. Minta sessionUri Google Drive Resumable Upload (TANPA melewati Supabase Storage)
  const initResp = await callBackendOrEdgeFunction<{
    ok: boolean;
    sessionUri: string;
    folderId: string;
    folderPath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    error?: string;
  }>({
    edgeFunctionName: 'chat-video-resumable-init',
    apiPath: '/api/storage/init-video-resumable-upload',
    session,
    body: {
      roomId,
      messageId,
      fileName: safeName,
      mimeType,
      sizeBytes: file.size,
    },
    signal,
  });

  if (!initResp.sessionUri) {
    throw new Error('Server tidak mengembalikan URI unggah Google Drive.');
  }

  // 2. Unggah chunk demi chunk langsung dari browser ke Google Drive
  let offset = 0;
  let driveFileId = '';

  while (offset < file.size) {
    if (signal?.aborted) {
      throw new DOMException('Unggahan video dibatalkan.', 'AbortError');
    }

    const end = Math.min(offset + VIDEO_CHUNK_SIZE_BYTES, file.size);
    const chunkBlob = file.slice(offset, end);
    const contentRange = `bytes ${offset}-${end - 1}/${file.size}`;

    let chunkCompleted = false;
    let lastChunkError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_CHUNK_RETRIES; attempt += 1) {
      try {
        const putRes = await fetch(initResp.sessionUri, {
          method: 'PUT',
          headers: {
            'Content-Type': mimeType,
            'Content-Range': contentRange,
          },
          body: chunkBlob,
          signal,
        });

        if (putRes.status === 308) {
          const confirmedEnd = parseRangeHeaderLastByte(putRes.headers.get('range'));
          offset = confirmedEnd !== null ? Math.max(offset, confirmedEnd + 1) : end;
          const pct = Math.min(94, Math.max(6, Math.round((offset / file.size) * 89) + 5));
          onProgress?.({
            percent: pct,
            phase: 'uploading_video_direct',
            bytesUploaded: offset,
            totalBytes: file.size,
            label: `Mengunggah video langsung ke Drive (${pct}%)...`,
          });
          chunkCompleted = true;
          break;
        }

        if (putRes.status === 200 || putRes.status === 201) {
          const uploadedMeta = (await putRes.json().catch(() => ({}))) as { id?: string };
          if (!uploadedMeta.id) {
            throw new Error('Google Drive selesai menerima video tetapi tidak mengembalikan ID berkas.');
          }
          driveFileId = uploadedMeta.id;
          offset = file.size;
          onProgress?.({
            percent: 95,
            phase: 'uploading_video_direct',
            bytesUploaded: file.size,
            totalBytes: file.size,
            label: 'Video selesai dikirim ke Drive, memverifikasi...',
          });
          chunkCompleted = true;
          break;
        }

        const errText = await putRes.text().catch(() => '');
        if (putRes.status >= 400 && putRes.status < 500 && putRes.status !== 408 && putRes.status !== 429) {
          throw new Error(`Google Drive menolak chunk video (${putRes.status}): ${errText.slice(0, 140)}`);
        }
        lastChunkError = new Error(`Google Drive merespons ${putRes.status}: ${errText.slice(0, 120)}`);
      } catch (err) {
        if (isAbortError(err)) throw err;
        lastChunkError = err instanceof Error ? err : new Error('Koneksi unggah video terputus.');
        if (/Google Drive menolak chunk video/i.test(lastChunkError.message)) {
          throw lastChunkError;
        }
      }

      // Cek posisi byte terakhir yang diterima Drive sebelum retry
      const serverOffset = await probeResumableOffset(initResp.sessionUri, file.size, signal);
      if (serverOffset !== null && serverOffset > offset) {
        offset = serverOffset;
        chunkCompleted = true;
        break;
      }

      if (attempt < MAX_CHUNK_RETRIES) {
        await sleepWithAbort(700 * Math.pow(2, attempt - 1), signal);
      }
    }

    if (!chunkCompleted) {
      throw lastChunkError || new Error('Gagal mengunggah potongan video ke Google Drive.');
    }
  }

  if (!driveFileId) {
    throw new Error('ID berkas video Google Drive tidak diperoleh setelah unggah selesai.');
  }

  onProgress?.({
    percent: 97,
    phase: 'finalizing_video',
    bytesUploaded: file.size,
    totalBytes: file.size,
    label: 'Menyimpan metadata video & izin baca...',
  });

  // 3. Finalisasi metadata di backend & PostgreSQL
  const doneResp = await callBackendOrEdgeFunction<ChatMediaUploadResult & { error?: string }>({
    edgeFunctionName: 'chat-video-resumable-complete',
    apiPath: '/api/storage/complete-video-resumable-upload',
    session,
    body: {
      roomId,
      messageId,
      driveFileId,
      folderPath: initResp.folderPath,
    },
    signal,
  });

  onProgress?.({
    percent: 100,
    phase: 'completed',
    bytesUploaded: file.size,
    totalBytes: file.size,
    label: 'Video tersimpan aman di Google Drive.',
  });

  return {
    ...doneResp,
    transitDeleted: true,
  };
}

async function uploadNonVideoViaTransitToDrive(
  params: UploadChatAttachmentParams
): Promise<ChatMediaUploadResult> {
  const { session, roomId, file, messageId, onProgress, signal } = params;
  if (file.size <= 0 || file.size > MAX_NON_VIDEO_BYTES) {
    throw new Error(
      `Ukuran foto/dokumen harus antara 1 byte hingga ${Math.round(
        MAX_NON_VIDEO_BYTES / (1024 * 1024)
      )} MB.`
    );
  }

  if (isVideoMediaFile(file)) {
    throw new Error('Berkas video tidak boleh melalui bucket transit chat-transit.');
  }

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Koneksi Supabase belum aktif untuk unggah transit lampiran.');
  }

  const { roleFolder, slug } = buildTransitSlug(session);
  const safeRoomSlug = String(roomId).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 64);
  const safeName = sanitizeClientFileName(file.name, 'bin');
  const uniqueSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const transitPath = `${roleFolder}/${slug}/${safeRoomSlug}/${Date.now()}-${uniqueSuffix}-${safeName}`;
  const mimeType = (file.type || 'application/octet-stream').trim().toLowerCase();

  onProgress?.({
    percent: 15,
    phase: 'uploading_transit',
    bytesUploaded: 0,
    totalBytes: file.size,
    label: 'Mengunggah sementara ke transit aman...',
  });

  const { error: uploadErr } = await supabase.storage.from('chat-transit').upload(transitPath, file, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadErr) {
    throw new Error(`Gagal mengunggah ke bucket chat-transit: ${uploadErr.message}`);
  }

  if (signal?.aborted) {
    await supabase.storage.from('chat-transit').remove([transitPath]).catch(() => undefined);
    throw new DOMException('Unggahan dibatalkan.', 'AbortError');
  }

  onProgress?.({
    percent: 60,
    phase: 'transferring_to_drive',
    bytesUploaded: file.size,
    totalBytes: file.size,
    label: 'Memindahkan berkas ke Google Drive & membersihkan transit...',
  });

  try {
    const transferResp = await callBackendOrEdgeFunction<ChatMediaUploadResult & { error?: string }>({
      edgeFunctionName: 'chat-media-transfer',
      apiPath: '/api/storage/transfer-transit-to-drive',
      session,
      body: {
        transitPath,
        roomId,
        messageId,
        fileName: safeName,
        mimeType,
      },
      signal,
    });

    onProgress?.({
      percent: 100,
      phase: 'completed',
      bytesUploaded: file.size,
      totalBytes: file.size,
      label: 'Lampiran tersimpan di Google Drive & transit telah dihapus.',
    });

    return transferResp;
  } catch (err) {
    // Best-effort cleanup bila transfer gagal agar file yatim tidak menumpuk di chat-transit
    await supabase.storage.from('chat-transit').remove([transitPath]).catch(() => undefined);
    throw err;
  }
}

/**
 * Helper terpadu unggah lampiran chat:
 * - Foto (Galeri/Kamera) & Dokumen -> Supabase `chat-transit` -> transfer ke Google Drive -> hapus transit.
 * - SEMUA Video (ukuran kecil maupun besar) -> Direct Google Drive Resumable Upload (TANPA transit Supabase).
 */
export async function uploadChatAttachment(
  params: UploadChatAttachmentParams
): Promise<ChatMediaUploadResult> {
  if (isVideoMediaFile(params.file)) {
    return uploadVideoDirectToDrive(params);
  }
  return uploadNonVideoViaTransitToDrive(params);
}

/**
 * Membuat record pesan chat terlebih dahulu lalu mengunggah lampiran sesuai aturan routing Drive.
 */
export async function sendChatMessageWithAttachment(
  params: SendChatMessageWithAttachmentParams
): Promise<{ message: ChatMessage; upload: ChatMediaUploadResult }> {
  const attachmentType = classifyChatAttachmentType(params.file);
  const cleanCaption = (params.caption || '').trim();
  const fallbackLabel =
    attachmentType === 'video'
      ? `[Video] ${params.file.name}`
      : attachmentType === 'photo'
        ? `[Foto] ${params.file.name}`
        : `[Dokumen] ${params.file.name}`;

  const { message } = await sendChatMessage(params.session, {
    room_id: params.roomId,
    message: cleanCaption || fallbackLabel,
    reply_to_id: params.replyToId,
    reply_preview: params.replyPreview,
    recipient: params.recipient,
    attachment: {
      attachment_type: attachmentType,
      attachment_name: params.file.name,
      attachment_mime: params.file.type || (attachmentType === 'video' ? 'video/mp4' : 'application/octet-stream'),
      attachment_size_bytes: params.file.size,
      attachment_storage_provider: 'google_drive',
      attachment_status: attachmentType === 'video' ? 'uploading_video' : 'pending_transfer',
    },
  });

  const upload = await uploadChatAttachment({
    session: params.session,
    roomId: params.roomId,
    file: params.file,
    messageId: message.id,
    onProgress: params.onProgress,
    signal: params.signal,
  });

  const isPrivateRoom = isPrivateChatRoom(params.roomId);
  const completedMessage: ChatMessage = {
    ...message,
    attachment_type: upload.attachmentType,
    attachment_name: upload.fileName,
    attachment_mime: upload.mimeType,
    attachment_size_bytes: upload.sizeBytes,
    attachment_storage_provider: 'google_drive',
    attachment_drive_file_id: upload.driveFileId,
    attachment_drive_folder_path: upload.folderPath,
    attachment_url: upload.attachmentUrl,
    attachment_thumbnail_url: upload.thumbnailUrl,
    attachment_status: 'ready',
    drive_permission_scope:
      upload.drivePermissionScope || (isPrivateRoom ? 'restricted_private' : 'anyone_link'),
    drive_web_view_link: upload.driveWebViewLink ?? upload.webViewLink ?? null,
    drive_thumbnail_link: upload.driveThumbnailLink ?? null,
  };

  return { message: completedMessage, upload };
}

export function isPrivateChatRoom(roomId: ChatRoomId | string): boolean {
  const clean = String(roomId || '').trim();
  return clean === 'grup_pengurus' || clean.startsWith('dm:');
}

export interface ResolvedChatAttachmentAccess {
  isPrivate: boolean;
  url: string;
  thumbnailUrl: string | null;
  driveWebViewLink: string | null;
  drivePermissionScope: DrivePermissionScope;
  expiresAt?: string;
  mimeType?: string;
  fileName?: string;
}

export type ChatAttachmentTarget = Pick<
  ChatMessage,
  | 'id'
  | 'room_id'
  | 'attachment_drive_file_id'
  | 'attachment_url'
  | 'attachment_thumbnail_url'
  | 'drive_permission_scope'
  | 'drive_web_view_link'
  | 'drive_thumbnail_link'
>;

export function extractDriveFileIdFromAttachment(
  target:
    | (Partial<ChatAttachmentTarget> & { drive_file_id?: string | null })
    | null
    | undefined
): string {
  if (!target) return '';
  const direct = String(target.attachment_drive_file_id || target.drive_file_id || '').trim();
  if (direct) return direct;

  const urlCandidates = [
    target.attachment_url,
    target.attachment_thumbnail_url,
    target.drive_web_view_link,
    target.drive_thumbnail_link,
  ];
  for (const raw of urlCandidates) {
    const val = String(raw || '').trim();
    if (!val) continue;
    const fileIdParam = val.match(/[?&]fileId=([a-zA-Z0-9_-]{10,})/i);
    if (fileIdParam?.[1]) return fileIdParam[1];
    const pathFileMatch = val.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/i);
    if (pathFileMatch?.[1]) return pathFileMatch[1];
    const lhMatch = val.match(/googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/i);
    if (lhMatch?.[1]) return lhMatch[1];
    const openIdMatch = val.match(/[?&]id=([a-zA-Z0-9_-]{10,})/i);
    if (openIdMatch?.[1]) return openIdMatch[1];
  }
  return '';
}

interface CachedPrivateBlobEntry {
  objectUrl: string;
  mimeType: string;
  createdAt: number;
}

const MAX_PRIVATE_BLOB_CACHE_ENTRIES = 80;
const privateBlobCache = new Map<string, CachedPrivateBlobEntry>();
const privateBlobInflight = new Map<string, Promise<{ objectUrl: string; mimeType: string }>>();

function buildPrivateBlobCacheKey(
  senderId: string,
  fileId: string,
  roomId: string
): string {
  return `${senderId}::${fileId}::${String(roomId || '').trim()}`;
}

function setPrivateBlobCacheEntry(key: string, entry: CachedPrivateBlobEntry): void {
  if (privateBlobCache.has(key)) {
    privateBlobCache.delete(key);
  }
  privateBlobCache.set(key, entry);
  while (privateBlobCache.size > MAX_PRIVATE_BLOB_CACHE_ENTRIES) {
    const oldestKey = privateBlobCache.keys().next().value;
    if (!oldestKey) break;
    const evicted = privateBlobCache.get(oldestKey);
    privateBlobCache.delete(oldestKey);
    if (evicted?.objectUrl) {
      try {
        URL.revokeObjectURL(evicted.objectUrl);
      } catch {
        // Abaikan
      }
    }
  }
}

async function raceWithAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    throw new DOMException('Permintaan dibatalkan.', 'AbortError');
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new DOMException('Permintaan dibatalkan.', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

/**
 * Mengembalikan URL aman untuk membuka/mempratinjau lampiran chat:
 * - Ruang publik (Pengurus & Warga / Pengurus & Keamanan): langsung tautan `anyone_link`.
 * - Ruang privat (Grup Pengurus / DM Personal): memanggil endpoint proxy terverifikasi
 *   untuk menerbitkan URL bertanda tangan jangka pendek (mendukung seeking video/audio & verifikasi DB).
 */
export async function resolveChatAttachmentAccess(
  session: SessionUser,
  target: ChatAttachmentTarget,
  options?: { mode?: 'stream' | 'download' | 'thumbnail'; signal?: AbortSignal }
): Promise<ResolvedChatAttachmentAccess> {
  const isPrivate =
    isPrivateChatRoom(target.room_id) ||
    target.drive_permission_scope === 'restricted_private' ||
    Boolean(target.attachment_url?.includes('/api/storage/chat-drive-private-access'));

  if (!isPrivate) {
    return {
      isPrivate: false,
      url: target.attachment_url || target.drive_web_view_link || '',
      thumbnailUrl: target.attachment_thumbnail_url || target.drive_thumbnail_link || null,
      driveWebViewLink: target.drive_web_view_link || null,
      drivePermissionScope: target.drive_permission_scope || 'anyone_link',
    };
  }

  const fileId = extractDriveFileIdFromAttachment(target);
  if (!fileId) {
    throw new Error('ID berkas Google Drive untuk lampiran privat tidak tersedia.');
  }

  const minted = await callBackendOrEdgeFunction<{
    ok: boolean;
    streamUrl: string;
    expiresAt: string;
    mimeType?: string;
    fileName?: string;
    drivePermissionScope?: DrivePermissionScope;
    error?: string;
  }>({
    edgeFunctionName: 'chat-drive-private-access',
    apiPath: '/api/storage/chat-drive-private-access',
    session,
    body: {
      action: 'mint_stream_url',
      fileId,
      roomId: target.room_id,
      messageId: target.id,
      mode: options?.mode || 'stream',
    },
    signal: options?.signal,
  });

  return {
    isPrivate: true,
    url: minted.streamUrl,
    thumbnailUrl: null,
    driveWebViewLink: target.drive_web_view_link || null,
    drivePermissionScope: 'restricted_private',
    expiresAt: minted.expiresAt,
    mimeType: minted.mimeType,
    fileName: minted.fileName,
  };
}

/**
 * Mengambil berkas/thumbnail via proxy `chat-drive-private-access` dengan cache Blob URL di memori
 * agar tidak mengunduh berkas berulang kali saat scroll, pindah tab, atau membuka pratinjau penuh.
 */
export async function fetchPrivateAttachmentBlobUrl(
  session: SessionUser,
  target: ChatAttachmentTarget,
  options?: { mode?: 'stream' | 'download' | 'thumbnail'; signal?: AbortSignal; forceRefresh?: boolean }
): Promise<{ objectUrl: string; mimeType: string; revoke: () => void }> {
  const fileId = extractDriveFileIdFromAttachment(target);
  if (!fileId) {
    throw new Error('ID berkas Google Drive untuk lampiran privat tidak tersedia.');
  }

  const normalizedSession = normalizeChatSessionForUpload(session);
  const senderCtx = buildChatSessionSenderContext(normalizedSession);
  const cacheKey = buildPrivateBlobCacheKey(senderCtx.senderId, fileId, target.room_id);

  if (!options?.forceRefresh) {
    const cached = privateBlobCache.get(cacheKey);
    if (cached) {
      // Refresh LRU position
      privateBlobCache.delete(cacheKey);
      privateBlobCache.set(cacheKey, cached);
      return {
        objectUrl: cached.objectUrl,
        mimeType: cached.mimeType,
        revoke: () => {
          // Object URL dikelola oleh cache memori agar tidak perlu diunduh ulang
        },
      };
    }

    const inflight = privateBlobInflight.get(cacheKey);
    if (inflight) {
      const resolved = await raceWithAbortSignal(inflight, options?.signal);
      return {
        objectUrl: resolved.objectUrl,
        mimeType: resolved.mimeType,
        revoke: () => {
          // Object URL dikelola oleh cache memori
        },
      };
    }
  }

  const fetchTask = (async (): Promise<{ objectUrl: string; mimeType: string }> => {
    const qs = new URLSearchParams({
      fileId,
      roomId: target.room_id,
      messageId: target.id,
    });
    if (options?.mode && options.mode !== 'stream') {
      qs.set('mode', options.mode);
    }

    const identityHeaders = buildSessionIdentityHeaders(normalizedSession);
    const sbCfg = getSupabasePublicConfig();
    const userJwt = await resolveChatSupabaseAccessToken(normalizedSession);

    let response: Response | null = null;
    let edgeErrorMessage = '';
    let edgeErrorDiagnostics: ChatUploadErrorDiagnostics | null = null;
    if (sbCfg) {
      try {
        const edgeRes = await fetch(
          `${sbCfg.url}/functions/v1/chat-drive-private-access?${qs.toString()}`,
          {
            method: 'GET',
            cache: 'no-store',
            headers: {
              apikey: sbCfg.anonKey,
              Authorization: `Bearer ${userJwt || sbCfg.anonKey}`,
              ...identityHeaders,
            },
          }
        );
        if (edgeRes.ok) {
          response = edgeRes;
        } else {
          const errJson = (await edgeRes.json().catch(() => ({}))) as BackendErrorPayload;
          edgeErrorDiagnostics = parseBackendErrorDiagnostics(errJson);
          edgeErrorMessage = String(errJson.error || '').trim();
          const combined = `${edgeErrorMessage} ${edgeErrorDiagnostics?.reason || ''}`;
          const isLegacySaError = /GOOGLE_DRIVE_PRIVATE_KEY|GOOGLE_PRIVATE_KEY|Service Account|private_key/i.test(
            combined
          );
          const isStaleWithoutReason =
            (edgeRes.status === 401 || edgeRes.status === 403) && !edgeErrorDiagnostics?.reason;

          if (
            (edgeRes.status === 400 || edgeRes.status === 401 || edgeRes.status === 403) &&
            !isLegacySaError &&
            !isStaleWithoutReason
          ) {
            throw new ChatMediaUploadError(
              edgeErrorMessage ||
                edgeErrorDiagnostics?.reason ||
                `Akses lampiran privat ditolak (${edgeRes.status}).`,
              edgeErrorDiagnostics
            );
          }
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        if (err instanceof ChatMediaUploadError) {
          throw err;
        }
      }
    }

    if (!response) {
      const candidates = buildApiCandidateUrls(`/api/storage/chat-drive-private-access?${qs.toString()}`);
      let lastError = edgeErrorMessage;
      let lastDiagnostics: ChatUploadErrorDiagnostics | null = edgeErrorDiagnostics;
      for (const candidate of candidates) {
        try {
          const apiRes = await fetch(candidate.url, {
            method: 'GET',
            cache: 'no-store',
            headers: {
              ...(userJwt ? { Authorization: `Bearer ${userJwt}` } : {}),
              ...identityHeaders,
            },
          });
          if (apiRes.ok) {
            response = apiRes;
            break;
          }
          const errJson = (await apiRes.json().catch(() => ({}))) as BackendErrorPayload;
          const apiDiagnostics = parseBackendErrorDiagnostics(errJson);
          const msg = String(errJson.error || '').trim();
          if (!candidate.isLocalPreviewFallback || !isEmptyLocalEnvLegacyError(msg, apiDiagnostics)) {
            lastError = msg || apiDiagnostics?.reason || `Gagal memuat berkas privat (${apiRes.status}).`;
            lastDiagnostics = apiDiagnostics;
          }
          if (!candidate.isLocalPreviewFallback) {
            throw new ChatMediaUploadError(lastError, lastDiagnostics);
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (err instanceof ChatMediaUploadError) {
            if (!candidate.isLocalPreviewFallback && candidates.length > 1) {
              continue;
            }
            throw err;
          }
          if (!candidate.isLocalPreviewFallback && candidates.length > 1) {
            continue;
          }
          if (err instanceof Error && err.message) {
            throw new ChatMediaUploadError(err.message, lastDiagnostics);
          }
        }
      }
      if (!response) {
        throw new ChatMediaUploadError(
          lastError || 'Gagal memuat berkas privat dari Google Drive.',
          lastDiagnostics
        );
      }
    }

    const blob = await response.blob();
    const mimeType =
      (blob.type && blob.type !== 'application/octet-stream'
        ? blob.type
        : response.headers.get('content-type')?.split(';')[0]?.trim()) ||
      'application/octet-stream';
    const objectUrl = URL.createObjectURL(blob);
    setPrivateBlobCacheEntry(cacheKey, {
      objectUrl,
      mimeType,
      createdAt: Date.now(),
    });
    return { objectUrl, mimeType };
  })();

  privateBlobInflight.set(cacheKey, fetchTask);
  try {
    const resolved = await raceWithAbortSignal(fetchTask, options?.signal);
    return {
      objectUrl: resolved.objectUrl,
      mimeType: resolved.mimeType,
      revoke: () => {
        // Object URL dikelola oleh cache memori
      },
    };
  } finally {
    if (privateBlobInflight.get(cacheKey) === fetchTask) {
      privateBlobInflight.delete(cacheKey);
    }
  }
}
