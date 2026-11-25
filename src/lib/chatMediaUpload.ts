import type { SessionUser } from '../types';
import {
  getChatParticipantId,
  normalizeChatUserRole,
  sendChatMessage,
  type ChatAttachmentType,
  type ChatContact,
  type ChatMessage,
  type ChatRoomId,
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
  const roleFolder = normalizeChatUserRole(session.role);
  const participantId = getChatParticipantId(session);
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
  return {
    'x-user-role': session.role || 'anon',
    'x-blok-rumah': session.blok_rumah || '',
    'x-petugas-id': session.petugas_id || '',
    'x-admin-permission': session.admin_permission || '',
    'x-admin-jabatan': session.jabatan || '',
  };
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

async function callBackendOrEdgeFunction<T extends { ok?: boolean; error?: string }>(params: {
  edgeFunctionName: string;
  apiPath: string;
  session: SessionUser;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<T> {
  const identityHeaders = buildSessionIdentityHeaders(params.session);
  const sbCfg = getSupabasePublicConfig();

  // 1. Prioritaskan Supabase Edge Function bila Supabase aktif
  if (sbCfg) {
    try {
      const edgeRes = await fetch(`${sbCfg.url}/functions/v1/${params.edgeFunctionName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: sbCfg.anonKey,
          Authorization: `Bearer ${sbCfg.anonKey}`,
          ...identityHeaders,
        },
        body: JSON.stringify(params.body),
        signal: params.signal,
      });

      const edgeJson = (await edgeRes.json().catch(() => ({}))) as T;
      if (edgeRes.ok && edgeJson.ok !== false) {
        return edgeJson;
      }

      // Error validasi/otorisasi (400/401/403) langsung diteruskan tanpa menyembunyikan alasan
      if (edgeRes.status === 400 || edgeRes.status === 401 || edgeRes.status === 403) {
        throw new Error(edgeJson.error || `Permintaan ditolak (${edgeRes.status}).`);
      }

      // Bila Edge Function belum di-deploy (404) atau secret Drive belum diset di Edge Function,
      // fallback ke endpoint server /api/storage/... (Vercel / Express).
    } catch (err) {
      if (isAbortError(err)) throw err;
      // Untuk penolakan validasi/otorisasi eksplisit dari Edge Function, lempar langsung
      if (
        err instanceof Error &&
        /DILARANG|tidak memiliki akses|tidak aktif|tidak valid|ditolak/i.test(err.message)
      ) {
        throw err;
      }
      // Selain itu lanjut fallback ke /api/storage/...
    }
  }

  const apiRes = await fetch(params.apiPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...identityHeaders,
    },
    body: JSON.stringify(params.body),
    signal: params.signal,
  });

  const apiJson = (await apiRes.json().catch(() => ({}))) as T;
  if (!apiRes.ok || apiJson.ok === false) {
    throw new Error(apiJson.error || `Gagal memproses media di server (${apiRes.status}).`);
  }
  return apiJson;
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
  };

  return { message: completedMessage, upload };
}
