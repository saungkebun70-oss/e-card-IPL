import crypto from 'crypto';

export interface VerifiedChatCaller {
  role: 'admin' | 'warga' | 'petugas';
  senderId: string;
  slug: string;
  displayName: string;
  matchIds: Set<string>;
}

export interface SenderCallerHint {
  role?: string;
  senderId?: string;
  userId?: string;
  blokRumah?: string;
  pengurusUsername?: string;
  username?: string;
  namaWarga?: string;
  noWa?: string;
  jabatan?: string;
  adminPermission?: string;
  petugasId?: string;
}

export interface CallerVerificationInput {
  role: string;
  blokRumah: string;
  petugasId: string;
  authorization?: string;
  adminJabatan?: string;
  adminPermission?: string;
  senderHint?: SenderCallerHint | null;
}

export type DrivePermissionScope = 'anyone_link' | 'restricted_private';

export interface DriveAuthConfig {
  mode: 'oauth2';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
  clientIdField: string;
  clientSecretField: string;
  refreshTokenField: string;
  rootFolderField: string;
}

export type DriveServiceAccountConfig = DriveAuthConfig;

interface CredentialValidationError extends Error {
  statusCode?: number;
  missingFields?: string[];
  invalidFields?: string[];
  fieldReasons?: Record<string, string>;
}

export interface TransferTransitResult {
  ok: true;
  storageProvider: 'google_drive';
  attachmentType: 'photo' | 'document';
  driveFileId: string;
  drivePermissionScope: DrivePermissionScope;
  driveWebViewLink: string;
  driveThumbnailLink: string | null;
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

export interface VideoResumableInitResult {
  ok: true;
  sessionUri: string;
  folderId: string;
  folderPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: 'google_drive';
}

export interface VideoResumableCompleteResult {
  ok: true;
  storageProvider: 'google_drive';
  attachmentType: 'video';
  driveFileId: string;
  drivePermissionScope: DrivePermissionScope;
  driveWebViewLink: string;
  driveThumbnailLink: string | null;
  folderPath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  attachmentUrl: string;
  thumbnailUrl: string | null;
  webViewLink: string;
  messageUpdated: boolean;
}

const VIDEO_EXTENSION_REGEX = /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i;
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

export const MAX_NON_VIDEO_TRANSIT_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_RESUMABLE_BYTES = 500 * 1024 * 1024;

function normalizeToken(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function canonicalBlockKey(raw?: string | null): string {
  const clean = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/^BLOK\s*/i, '')
    .replace(/\s+/g, '');
  if (!clean) return '';
  const match = clean.match(/^([A-Z]+)0*(\d+)[\/-]0*(\d+)$/);
  if (match) {
    return `${match[1]}${Number(match[2])}/${Number(match[3])}`;
  }
  return clean;
}

function canonicalAdminUsername(raw?: string | null): string {
  const clean = normalizeToken(raw);
  if (clean === 'admin' || clean === 'andriansyah' || clean === 'bendahara') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan' || clean === 'iwan' || clean === 'pembina') return 'bpiwan';
  if (clean === 'ketua') return 'erlangga';
  if (clean === 'deni') return 'deny';
  return clean;
}

interface KnownPengurusMeta {
  username: string;
  nama: string;
  jabatan: string;
  linkedBlock: string;
  permission: 'full' | 'add_only';
}

const KNOWN_PENGURUS_DIRECTORY: KnownPengurusMeta[] = [
  { username: 'bpiwan', nama: 'Bp. Iwan', jabatan: 'Pembina', linkedBlock: 'B8/5', permission: 'add_only' },
  { username: 'erlangga', nama: 'Erlangga', jabatan: 'Ketua', linkedBlock: 'B3/7', permission: 'add_only' },
  { username: 'andriansyah', nama: 'Andriansyah', jabatan: 'Bendahara', linkedBlock: 'B7/16', permission: 'full' },
  { username: 'doni', nama: 'Doni', jabatan: 'Humas', linkedBlock: 'B5/21', permission: 'add_only' },
  { username: 'wahyu', nama: 'Wahyu', jabatan: 'Humas', linkedBlock: 'B5/24', permission: 'add_only' },
  { username: 'deny', nama: 'Deny', jabatan: 'Seksi Olahraga', linkedBlock: 'B8/6', permission: 'add_only' },
];

const PENGURUS_META_BY_USERNAME = new Map<string, KnownPengurusMeta>(
  KNOWN_PENGURUS_DIRECTORY.map((p) => [p.username, p])
);
const PENGURUS_META_BY_BLOCK = new Map<string, KnownPengurusMeta>(
  KNOWN_PENGURUS_DIRECTORY.map((p) => [canonicalBlockKey(p.linkedBlock), p])
);

function resolvePengurusUsernameFromHints(
  rawBlok: string,
  rawJabatan?: string,
  hint?: SenderCallerHint | null
): string {
  const candidates = [
    hint?.pengurusUsername,
    rawBlok,
    hint?.blokRumah,
    hint?.senderId?.startsWith('admin:') ? hint.senderId.slice('admin:'.length) : undefined,
  ];
  for (const cand of candidates) {
    const clean = String(cand || '').trim();
    if (!clean) continue;
    const byBlock = PENGURUS_META_BY_BLOCK.get(canonicalBlockKey(clean));
    if (byBlock) return byBlock.username;
    const canon = canonicalAdminUsername(clean);
    if (canon) return canon;
  }

  const jabatanNorm = normalizeToken(rawJabatan || hint?.jabatan);
  if (jabatanNorm === 'bendahara') return 'andriansyah';
  if (jabatanNorm === 'pembina') return 'bpiwan';
  if (jabatanNorm === 'ketua') return 'erlangga';
  if (jabatanNorm === 'seksiolahraga') return 'deny';
  return '';
}

function parseRpcBoolean(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const clean = val.trim().toLowerCase();
    if (clean === 'true' || clean === '1' || clean === 't' || clean === 'active' || clean === 'aktif') {
      return true;
    }
    if (
      clean === 'false' ||
      clean === '0' ||
      clean === 'f' ||
      clean === 'inactive' ||
      clean === 'nonaktif' ||
      clean === 'revoked' ||
      clean === 'suspended'
    ) {
      return false;
    }
  }
  return null;
}

export function isVideoMedia(mimeType?: string | null, fileName?: string | null): boolean {
  const cleanMime = String(mimeType || '').trim().toLowerCase();
  const cleanName = String(fileName || '').trim().toLowerCase();
  if (cleanMime.startsWith('video/')) return true;
  if (VIDEO_MIME_SET.has(cleanMime)) return true;
  if (VIDEO_EXTENSION_REGEX.test(cleanName)) return true;
  return false;
}

function classifyNonVideoAttachmentType(
  mimeType?: string | null,
  fileName?: string | null
): 'photo' | 'document' {
  const cleanMime = String(mimeType || '').trim().toLowerCase();
  const cleanName = String(fileName || '').trim().toLowerCase();
  if (cleanMime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic|heif)$/i.test(cleanName)) {
    return 'photo';
  }
  return 'document';
}

function sanitizeFileName(rawName?: string | null, fallbackExt = 'bin'): string {
  const last = String(rawName || '').split(/[\\/]/).pop() || '';
  const safe = last.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) return `media-${Date.now()}.${fallbackExt}`;
  return safe.slice(0, 140);
}

function getJakartaYearMonth(isoDate?: string | null): string {
  const baseDate = isoDate && !Number.isNaN(Date.parse(isoDate)) ? new Date(isoDate) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(baseDate);
  const year = parts.find((p) => p.type === 'year')?.value || String(baseDate.getUTCFullYear());
  const month =
    parts.find((p) => p.type === 'month')?.value ||
    String(baseDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function resolveDriveCategoryFolder(roomId: string): string {
  const clean = String(roomId || '').trim();
  if (clean === 'grup_pengurus') return 'Grup-Pengurus';
  if (clean === 'pengurus_warga') return 'Grup-Pengurus-Warga';
  if (clean === 'pengurus_keamanan') return 'Grup-Pengurus-Keamanan';
  if (clean === 'warga_keamanan') return 'Grup-Warga-Keamanan';
  if (clean === 'forum_umum') return 'Forum-Lingkungan';
  if (clean.startsWith('dm:')) return 'DM-Personal';
  return 'Chat-Lainnya';
}

function normalizeParticipantId(rawId: string): string {
  const clean = normalizeToken(rawId);
  if (clean.startsWith('admin:')) {
    return `admin:${canonicalAdminUsername(clean.slice('admin:'.length))}`;
  }
  if (clean.startsWith('pengurus:')) {
    return `admin:${canonicalAdminUsername(clean.slice('pengurus:'.length))}`;
  }
  if (clean.startsWith('warga:')) {
    const sub = clean.slice('warga:'.length);
    return `warga:${canonicalBlockKey(sub).toLowerCase() || sub}`;
  }
  if (clean.startsWith('keamanan:')) {
    return `petugas:${clean.slice('keamanan:'.length)}`;
  }
  return clean;
}

export function normalizeChatRoomId(rawRoomId: string): string {
  const clean = String(rawRoomId || '').trim();
  if (
    clean === 'grup_pengurus' ||
    clean === 'pengurus_warga' ||
    clean === 'pengurus_keamanan' ||
    clean === 'warga_keamanan' ||
    clean === 'forum_umum'
  ) {
    return clean;
  }
  if (clean.startsWith('dm:') && clean.slice(3).includes('__')) {
    const body = clean.slice(3);
    const idx = body.indexOf('__');
    const a = normalizeParticipantId(body.slice(0, idx));
    const b = normalizeParticipantId(body.slice(idx + 2));
    if (a && b) {
      const sorted = [a, b].sort((x, y) => x.localeCompare(y));
      return `dm:${sorted[0]}__${sorted[1]}`;
    }
  }
  return '';
}

export function canCallerAccessRoom(caller: VerifiedChatCaller, roomId: string): boolean {
  if (!roomId) return false;
  if (roomId === 'grup_pengurus') return caller.role === 'admin';
  if (roomId === 'pengurus_keamanan') return caller.role === 'admin' || caller.role === 'petugas';
  if (roomId === 'pengurus_warga') return caller.role === 'admin' || caller.role === 'warga';
  if (roomId === 'warga_keamanan') return caller.role === 'warga' || caller.role === 'petugas';
  if (roomId === 'forum_umum') return true;
  if (roomId.startsWith('dm:')) {
    const body = roomId.slice(3);
    const idx = body.indexOf('__');
    if (idx <= 0) return false;
    const raw1 = body.slice(0, idx);
    const raw2 = body.slice(idx + 2);
    return (
      caller.matchIds.has(normalizeParticipantId(raw1)) ||
      caller.matchIds.has(normalizeParticipantId(raw2)) ||
      caller.matchIds.has(normalizeToken(raw1)) ||
      caller.matchIds.has(normalizeToken(raw2))
    );
  }
  return false;
}

function buildPhoneMatchTokens(rawPhone?: string | null): string[] {
  const digits = String(rawPhone || '').replace(/\D+/g, '');
  if (digits.length < 7) return [];
  const tokens = new Set<string>([digits]);
  if (digits.startsWith('62') && digits.length >= 9) {
    tokens.add(`0${digits.slice(2)}`);
    tokens.add(digits.slice(2));
  } else if (digits.startsWith('0') && digits.length >= 8) {
    tokens.add(`62${digits.slice(1)}`);
    tokens.add(digits.slice(1));
  }
  return Array.from(tokens);
}

function addIdentityVariants(
  matchIds: Set<string>,
  prefix: 'admin' | 'warga' | 'petugas',
  values: {
    uuid?: string | null;
    blok?: string | null;
    name?: string | null;
    username?: string | null;
    phones?: Array<string | null | undefined>;
  }
): void {
  const addToken = (raw?: string | null, alsoBlock = false) => {
    const tok = normalizeToken(raw);
    if (!tok) return;
    matchIds.add(tok);
    matchIds.add(`${prefix}:${tok}`);
    if (alsoBlock) {
      const canon = canonicalBlockKey(raw).toLowerCase();
      if (canon) {
        matchIds.add(canon);
        matchIds.add(`${prefix}:${canon}`);
      }
    }
  };

  if (values.uuid) {
    const cleanUuid = String(values.uuid).trim().toLowerCase();
    if (cleanUuid) {
      matchIds.add(cleanUuid);
      matchIds.add(`${prefix}:${cleanUuid}`);
      matchIds.add(`user:${cleanUuid}`);
    }
  }
  if (values.blok) addToken(values.blok, true);
  if (values.username) addToken(values.username, false);
  if (values.name) addToken(values.name, false);
  for (const ph of values.phones || []) {
    for (const pTok of buildPhoneMatchTokens(ph)) {
      matchIds.add(pTok);
      matchIds.add(`${prefix}:${pTok}`);
    }
  }
}

function doesCallerMatchFieldValue(caller: VerifiedChatCaller, rawValue?: string | null): boolean {
  const clean = String(rawValue || '').trim();
  if (!clean) return false;
  if (caller.matchIds.has(clean.toLowerCase())) return true;
  const tok = normalizeToken(clean);
  if (tok && caller.matchIds.has(tok)) return true;
  const normPid = normalizeParticipantId(clean);
  if (normPid && caller.matchIds.has(normPid)) return true;
  const canonBlok = canonicalBlockKey(clean).toLowerCase();
  if (canonBlok && (caller.matchIds.has(canonBlok) || caller.matchIds.has(`warga:${canonBlok}`))) {
    return true;
  }
  for (const pTok of buildPhoneMatchTokens(clean)) {
    if (caller.matchIds.has(pTok) || caller.matchIds.has(`warga:${pTok}`)) {
      return true;
    }
  }
  return false;
}

function stripOuterQuotes(raw?: string | null): string {
  let clean = String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  let changed = true;
  while (changed && clean.length > 0) {
    changed = false;
    if (
      (clean.startsWith('\\"') && clean.endsWith('\\"')) ||
      (clean.startsWith("\\'") && clean.endsWith("\\'"))
    ) {
      clean = clean.slice(2, -2).trim();
      changed = true;
      continue;
    }
    const first = clean[0];
    const last = clean[clean.length - 1];
    const isQuoteChar = (ch: string) =>
      ch === '"' ||
      ch === "'" ||
      ch === '`' ||
      ch === '\u201C' ||
      ch === '\u201D' ||
      ch === '\u2018' ||
      ch === '\u2019';
    if (clean.length >= 2 && isQuoteChar(first) && isQuoteChar(last)) {
      clean = clean.slice(1, -1).trim();
      changed = true;
      continue;
    }
    if (isQuoteChar(first)) {
      clean = clean.slice(1).trim();
      changed = true;
      continue;
    }
    if (isQuoteChar(last)) {
      clean = clean.slice(0, -1).trim();
      changed = true;
    }
  }
  return clean;
}

function isUrlLikeValue(raw: string): boolean {
  const clean = raw.trim();
  return /^https?:\/\//i.test(clean) || /^[a-z0-9+.-]+:\/\//i.test(clean);
}

function readFirstSecretEnv(names: string[]): { value: string; sourceName: string | null } {
  for (const name of names) {
    const cleaned = stripOuterQuotes(process.env[name]);
    if (cleaned) {
      return { value: cleaned, sourceName: name };
    }
  }
  return { value: '', sourceName: null };
}

function buildCredentialError(params: {
  scope: string;
  missingFields: string[];
  invalidFields: string[];
  fieldReasons?: Record<string, string>;
  statusCode?: number;
}): CredentialValidationError {
  const details: string[] = [];
  if (params.missingFields.length > 0) {
    details.push(`field kosong: [${params.missingFields.join(', ')}]`);
  }
  if (params.invalidFields.length > 0) {
    const invalidDesc = params.invalidFields.map((field) => {
      const reason = params.fieldReasons?.[field];
      return reason ? `${field} (${reason})` : field;
    });
    details.push(`field tidak valid: [${invalidDesc.join(', ')}]`);
  }
  const err = new Error(
    `Validasi secrets ${params.scope} gagal di server — ${details.join('; ')}.`
  ) as CredentialValidationError;
  err.statusCode = params.statusCode ?? 500;
  err.missingFields = [...params.missingFields];
  err.invalidFields = [...params.invalidFields];
  if (params.fieldReasons && Object.keys(params.fieldReasons).length > 0) {
    err.fieldReasons = params.fieldReasons;
  }
  return err;
}

function getSupabaseServerConfig(): { url: string; serviceKey: string } {
  const urlEnv = readFirstSecretEnv(['SUPABASE_URL', 'VITE_SUPABASE_URL']);
  const serviceKeyEnv = readFirstSecretEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']);
  const url = urlEnv.value.replace(/\/+$/, '');
  const serviceKey = serviceKeyEnv.value;

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const fieldReasons: Record<string, string> = {};

  if (!url) {
    missingFields.push('SUPABASE_URL');
    fieldReasons.SUPABASE_URL = 'Environment variable kosong atau belum diatur.';
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        invalidFields.push(urlEnv.sourceName || 'SUPABASE_URL');
        fieldReasons[urlEnv.sourceName || 'SUPABASE_URL'] = 'Protokol URL harus http atau https.';
      }
    } catch {
      invalidFields.push(urlEnv.sourceName || 'SUPABASE_URL');
      fieldReasons[urlEnv.sourceName || 'SUPABASE_URL'] = 'Format URL tidak valid.';
    }
  }

  if (!serviceKey) {
    missingFields.push('SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY');
    fieldReasons.SUPABASE_SERVICE_ROLE_KEY = 'Secret kosong (fallback SERVICE_ROLE_KEY juga kosong).';
  } else if (serviceKey.length < 20 || /\s/.test(serviceKey)) {
    const keyField = serviceKeyEnv.sourceName || 'SUPABASE_SERVICE_ROLE_KEY';
    invalidFields.push(keyField);
    fieldReasons[keyField] = 'Format token service role tidak valid atau mengandung spasi.';
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    throw buildCredentialError({
      scope: 'Supabase',
      missingFields,
      invalidFields,
      fieldReasons,
    });
  }

  return { url, serviceKey };
}

function getDriveConfig(): DriveAuthConfig {
  const oauthClientIdEnv = readFirstSecretEnv(['GOOGLE_OAUTH_CLIENT_ID']);
  const oauthClientSecretEnv = readFirstSecretEnv(['GOOGLE_OAUTH_CLIENT_SECRET']);
  const oauthRefreshTokenEnv = readFirstSecretEnv(['GOOGLE_OAUTH_REFRESH_TOKEN']);
  const folderEnv = readFirstSecretEnv([
    'GOOGLE_DRIVE_FOLDER_ID',
    'GOOGLE_DRIVE_ROOT_FOLDER_ID',
    'GOOGLE_DRIVE_ROOT_ID',
    'GOOGLE_ROOT_ID',
  ]);

  const clientId = oauthClientIdEnv.value;
  const clientSecret = oauthClientSecretEnv.value;
  const refreshToken = oauthRefreshTokenEnv.value;
  const rootFolderId = folderEnv.value;
  const folderField = folderEnv.sourceName || 'GOOGLE_DRIVE_FOLDER_ID';

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const fieldReasons: Record<string, string> = {};

  if (!clientId) {
    missingFields.push('GOOGLE_OAUTH_CLIENT_ID');
    fieldReasons.GOOGLE_OAUTH_CLIENT_ID = 'Environment variable GOOGLE_OAUTH_CLIENT_ID kosong.';
  } else if (isUrlLikeValue(clientId) || /\s/.test(clientId)) {
    invalidFields.push('GOOGLE_OAUTH_CLIENT_ID');
    fieldReasons.GOOGLE_OAUTH_CLIENT_ID = isUrlLikeValue(clientId)
      ? 'Nilai GOOGLE_OAUTH_CLIENT_ID masih berupa URL lengkap (https://...); isi dengan OAuth Client ID mentah.'
      : 'Nilai GOOGLE_OAUTH_CLIENT_ID mengandung spasi atau karakter tidak valid.';
  }

  if (!clientSecret) {
    missingFields.push('GOOGLE_OAUTH_CLIENT_SECRET');
    fieldReasons.GOOGLE_OAUTH_CLIENT_SECRET = 'Environment variable GOOGLE_OAUTH_CLIENT_SECRET kosong.';
  } else if (isUrlLikeValue(clientSecret) || /\s/.test(clientSecret)) {
    invalidFields.push('GOOGLE_OAUTH_CLIENT_SECRET');
    fieldReasons.GOOGLE_OAUTH_CLIENT_SECRET = isUrlLikeValue(clientSecret)
      ? 'Nilai GOOGLE_OAUTH_CLIENT_SECRET masih berupa URL lengkap (https://...); isi dengan Client Secret mentah.'
      : 'Nilai GOOGLE_OAUTH_CLIENT_SECRET mengandung spasi atau karakter tidak valid.';
  }

  if (!refreshToken) {
    missingFields.push('GOOGLE_OAUTH_REFRESH_TOKEN');
    fieldReasons.GOOGLE_OAUTH_REFRESH_TOKEN = 'Environment variable GOOGLE_OAUTH_REFRESH_TOKEN kosong.';
  } else if (isUrlLikeValue(refreshToken) || /\s/.test(refreshToken)) {
    invalidFields.push('GOOGLE_OAUTH_REFRESH_TOKEN');
    fieldReasons.GOOGLE_OAUTH_REFRESH_TOKEN = isUrlLikeValue(refreshToken)
      ? 'Nilai GOOGLE_OAUTH_REFRESH_TOKEN masih berupa URL lengkap (https://...); isi dengan Refresh Token mentah.'
      : 'Nilai GOOGLE_OAUTH_REFRESH_TOKEN mengandung spasi atau karakter tidak valid.';
  }

  if (!rootFolderId) {
    missingFields.push('GOOGLE_DRIVE_FOLDER_ID');
    fieldReasons.GOOGLE_DRIVE_FOLDER_ID =
      'Environment variable GOOGLE_DRIVE_FOLDER_ID kosong (fallback GOOGLE_DRIVE_ROOT_FOLDER_ID / GOOGLE_DRIVE_ROOT_ID / GOOGLE_ROOT_ID juga kosong).';
  } else if (isUrlLikeValue(rootFolderId) || !/^[a-zA-Z0-9_-]{8,150}$/.test(rootFolderId)) {
    invalidFields.push(folderField);
    fieldReasons[folderField] = isUrlLikeValue(rootFolderId)
      ? `Nilai ${folderField} masih berupa URL lengkap (https://...); salin hanya ID folder di belakang /folders/.`
      : `Format ${folderField} tidak valid (harus berupa ID folder Google Drive tanpa spasi/URL).`;
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    throw buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields,
      invalidFields,
      fieldReasons,
    });
  }

  return {
    mode: 'oauth2',
    clientId,
    clientSecret,
    refreshToken,
    rootFolderId,
    clientIdField: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretField: 'GOOGLE_OAUTH_CLIENT_SECRET',
    refreshTokenField: 'GOOGLE_OAUTH_REFRESH_TOKEN',
    rootFolderField: folderField,
  };
}

async function supabaseRestJson<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; errorText: string }> {
  const { url, serviceKey } = getSupabaseServerConfig();
  const res = await fetch(`${url}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    return { ok: false, status: res.status, data: null, errorText };
  }
  if (res.status === 204) {
    return { ok: true, status: 204, data: null, errorText: '' };
  }
  const text = await res.text().catch(() => '');
  if (!text) return { ok: true, status: res.status, data: null, errorText: '' };
  try {
    return { ok: true, status: res.status, data: JSON.parse(text) as T, errorText: '' };
  } catch {
    return { ok: true, status: res.status, data: null, errorText: '' };
  }
}

interface UsersWargaCallerRow {
  id?: string | null;
  blok_rumah?: string | null;
  nama_warga?: string | null;
  no_wa?: string | null;
  secondary_whatsapp?: string | null;
  role?: string | null;
  bot_role?: string | null;
  jabatan?: string | null;
  admin_permission?: string | null;
  aktif?: boolean | null;
}

function isPengurusRowRole(row: UsersWargaCallerRow): boolean {
  const roleNorm = normalizeToken(row.role);
  const botRoleNorm = normalizeToken(row.bot_role);
  return (
    roleNorm === 'admin' ||
    roleNorm === 'bendahara' ||
    roleNorm === 'pengurus' ||
    botRoleNorm === 'admin' ||
    botRoleNorm === 'bendahara' ||
    botRoleNorm === 'pengurus'
  );
}

async function fetchUsersWargaRows(): Promise<{ rows: UsersWargaCallerRow[]; errorText: string | null }> {
  const selectCandidates = [
    'id,blok_rumah,nama_warga,no_wa,secondary_whatsapp,role,bot_role,jabatan,admin_permission,aktif',
    'id,blok_rumah,nama_warga,no_wa,role,bot_role,jabatan,admin_permission,aktif',
    'blok_rumah,nama_warga,role,bot_role,jabatan,admin_permission,aktif',
    'blok_rumah,nama_warga,role,jabatan,aktif',
    'blok_rumah,nama_warga,role,aktif',
  ];

  let lastErr: string | null = null;
  for (const selectExpr of selectCandidates) {
    const res = await supabaseRestJson<UsersWargaCallerRow[]>(
      `/rest/v1/users_warga?select=${encodeURIComponent(selectExpr)}`
    );
    if (res.ok && Array.isArray(res.data)) {
      return { rows: res.data, errorText: null };
    }
    lastErr = res.errorText || `HTTP ${res.status}`;
  }
  return { rows: [], errorText: lastErr };
}

async function resolveVerifiedAuthUserFromBearer(
  authorization?: string
): Promise<{
  id: string;
  email?: string;
  userMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
} | null> {
  const rawAuth = String(authorization || '').trim();
  if (!rawAuth.toLowerCase().startsWith('bearer ')) return null;
  const token = rawAuth.slice(7).trim();
  if (!token || token.split('.').length !== 3) return null;

  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (anonKey && token === anonKey) return null;

  try {
    const { url, serviceKey } = getSupabaseServerConfig();
    const res = await fetch(`${url}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      id?: string;
      email?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    };
    if (!user?.id) return null;
    return {
      id: user.id,
      email: user.email,
      userMetadata: user.user_metadata || {},
      appMetadata: user.app_metadata || {},
    };
  } catch {
    return null;
  }
}

export async function verifyChatCallerFromHeaders(
  headers: CallerVerificationInput
): Promise<VerifiedChatCaller> {
  const hint = headers.senderHint || null;
  const rawRole = normalizeToken(headers.role || hint?.role);
  const rawBlok = String(headers.blokRumah || hint?.blokRumah || '').trim();
  const rawPetugasId = String(headers.petugasId || hint?.petugasId || '').trim();
  const rawJabatan = String(headers.adminJabatan || hint?.jabatan || '').trim();
  const rawPermission = String(headers.adminPermission || hint?.adminPermission || '').trim();

  const verifiedAuthUser = await resolveVerifiedAuthUserFromBearer(headers.authorization);
  const authMetaRole = normalizeToken(
    String(verifiedAuthUser?.appMetadata?.role || verifiedAuthUser?.userMetadata?.role || '')
  );
  const effectiveRole =
    rawRole ||
    (authMetaRole === 'admin' || authMetaRole === 'bendahara' || authMetaRole === 'pengurus'
      ? 'admin'
      : authMetaRole === 'petugas' || authMetaRole === 'keamanan'
        ? 'petugas'
        : authMetaRole === 'warga'
          ? 'warga'
          : '');

  if (
    effectiveRole === 'admin' ||
    effectiveRole === 'bendahara' ||
    effectiveRole === 'pengurus' ||
    effectiveRole === 'ketua'
  ) {
    let reqUsername = resolvePengurusUsernameFromHints(rawBlok, rawJabatan, hint);
    if (!reqUsername && verifiedAuthUser) {
      const metaIdent = String(
        verifiedAuthUser.userMetadata?.pengurus_username ||
          verifiedAuthUser.userMetadata?.username ||
          verifiedAuthUser.userMetadata?.blok_rumah ||
          ''
      );
      reqUsername = resolvePengurusUsernameFromHints(metaIdent, rawJabatan, hint);
    }

    if (!reqUsername) {
      throw Object.assign(
        new Error(
          `Verifikasi Pengurus gagal: identitas Pengurus tidak lengkap (role="${effectiveRole}", blok="${rawBlok || '-'}", jabatan="${rawJabatan || '-'}").`
        ),
        { statusCode: 401 }
      );
    }

    const knownMeta = PENGURUS_META_BY_USERNAME.get(reqUsername);
    const { rows, errorText } = await fetchUsersWargaRows();
    if (errorText) {
      throw new Error(`Gagal memverifikasi akun Pengurus pada users_warga: ${errorText}`);
    }

    const activeAdminRows: UsersWargaCallerRow[] = [];
    const inactiveAdminRows: UsersWargaCallerRow[] = [];
    const linkedBlockRows: UsersWargaCallerRow[] = [];

    for (const row of rows) {
      const rowBlokRaw = String(row.blok_rumah || '').trim();
      const rowCanonAdmin = canonicalAdminUsername(rowBlokRaw);
      const rowCanonBlok = canonicalBlockKey(rowBlokRaw);
      const isPengurus = isPengurusRowRole(row);
      const isBendaharaRow =
        reqUsername === 'andriansyah' &&
        (normalizeToken(row.jabatan) === 'bendahara' ||
          normalizeToken(row.admin_permission) === 'full' ||
          normalizeToken(row.role) === 'bendahara');

      if (isPengurus && (rowCanonAdmin === reqUsername || isBendaharaRow)) {
        if (row.aktif === false) {
          inactiveAdminRows.push(row);
        } else {
          activeAdminRows.push(row);
        }
        continue;
      }

      if (knownMeta && rowCanonBlok && rowCanonBlok === canonicalBlockKey(knownMeta.linkedBlock)) {
        linkedBlockRows.push(row);
      }
    }

    // Verifikasi terhadap RPC Migrasi V16 (`validate_login_account_status`) dengan dukungan berbagai signature
    let rpcActivePengurus: boolean | null = null;
    let rpcActiveFlagRaw: unknown = undefined;
    let rpcStatusRaw = '';
    let rpcPengurusNama = '';

    const rpcPayloads: Array<Record<string, unknown>> = [
      { p_identifier: reqUsername, p_login_portal: 'admin' },
      { p_identifier: reqUsername, p_portal: 'admin' },
      { p_identifier: reqUsername, p_portal: 'pengurus' },
      { p_blok: reqUsername, p_portal: 'admin' },
      { p_identifier: reqUsername },
    ];

    for (const payload of rpcPayloads) {
      try {
        const rpcCheck = await supabaseRestJson<unknown>('/rest/v1/rpc/validate_login_account_status', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (!rpcCheck.ok || rpcCheck.data === null || rpcCheck.data === undefined) continue;
        const row = Array.isArray(rpcCheck.data) ? rpcCheck.data[0] : rpcCheck.data;
        if (!row || typeof row !== 'object') continue;
        const obj = row as Record<string, unknown>;
        rpcActiveFlagRaw = obj.is_active_pengurus;
        rpcStatusRaw = String(obj.pengurus_account_status || '').trim();
        rpcPengurusNama = String(obj.pengurus_nama || '').trim();

        const parsedFlag = parseRpcBoolean(obj.is_active_pengurus);
        const parsedStatus = parseRpcBoolean(obj.pengurus_account_status);
        if (parsedFlag !== null) {
          rpcActivePengurus = parsedFlag;
        } else if (parsedStatus !== null) {
          rpcActivePengurus = parsedStatus;
        }
        if (rpcActivePengurus !== null) break;
      } catch {
        // Coba signature berikutnya
      }
    }

    const activeAdminRow = activeAdminRows[0];
    const inactiveAdminRow = inactiveAdminRows[0];
    const linkedActivePengurusRow = linkedBlockRows.find(
      (r) =>
        r.aktif !== false &&
        (isPengurusRowRole(r) ||
          (knownMeta && normalizeToken(r.jabatan) === normalizeToken(knownMeta.jabatan)))
    );

    if (rpcActivePengurus === false && reqUsername !== 'andriansyah') {
      throw Object.assign(
        new Error(
          `Status Pengurus "${reqUsername}" nonaktif pada validate_login_account_status (is_active_pengurus=${String(
            rpcActiveFlagRaw
          )}, pengurus_account_status=${rpcStatusRaw || 'inactive'}).`
        ),
        { statusCode: 403 }
      );
    }

    if (rpcActivePengurus === false && inactiveAdminRow) {
      throw Object.assign(
        new Error(
          `Status Pengurus "${reqUsername}" nonaktif di users_warga dan validate_login_account_status (aktif=false, pengurus_account_status=${
            rpcStatusRaw || 'inactive'
          }).`
        ),
        { statusCode: 403 }
      );
    }

    const hasVerifiedAuthSession = Boolean(verifiedAuthUser?.id);
    const verifiedMatch =
      activeAdminRow ||
      linkedActivePengurusRow ||
      (rpcActivePengurus === true ? { nama_warga: rpcPengurusNama || hint?.namaWarga || knownMeta?.nama } : null) ||
      (hasVerifiedAuthSession && !inactiveAdminRow
        ? {
            nama_warga:
              String(verifiedAuthUser?.userMetadata?.nama_warga || '') ||
              hint?.namaWarga ||
              knownMeta?.nama,
          }
        : null);

    if (!verifiedMatch) {
      if (inactiveAdminRow) {
        throw Object.assign(
          new Error(
            `Akun Pengurus "${String(inactiveAdminRow.blok_rumah || reqUsername)}" (${
              String(inactiveAdminRow.nama_warga || reqUsername)
            }) berstatus nonaktif di users_warga (aktif = false).`
          ),
          { statusCode: 403 }
        );
      }

      throw Object.assign(
        new Error(
          `Verifikasi Pengurus gagal untuk "${rawBlok || reqUsername}" (canonical="${reqUsername}", jabatan="${
            rawJabatan || '-'
          }", permission="${rawPermission || '-'}", authJwt=${
            hasVerifiedAuthSession ? 'valid' : 'none'
          }): tidak ditemukan baris Pengurus aktif pada users_warga maupun status aktif pada validate_login_account_status.`
        ),
        { statusCode: 403 }
      );
    }

    const matchIds = new Set<string>([`admin:${reqUsername}`, reqUsername]);
    if (reqUsername === 'andriansyah') {
      matchIds.add('admin:admin');
      matchIds.add('admin:bendahara');
    }
    if (reqUsername === 'bpiwan') matchIds.add('admin:paiwan');

    const matchedAdminRow = activeAdminRow || linkedActivePengurusRow;
    addIdentityVariants(matchIds, 'admin', {
      uuid: matchedAdminRow?.id || hint?.userId || verifiedAuthUser?.id,
      blok: matchedAdminRow?.blok_rumah || knownMeta?.linkedBlock,
      name: matchedAdminRow?.nama_warga || hint?.namaWarga || knownMeta?.nama,
      username: reqUsername,
      phones: [matchedAdminRow?.no_wa, matchedAdminRow?.secondary_whatsapp, hint?.noWa],
    });
    if (knownMeta?.linkedBlock) {
      const linkedCanon = canonicalBlockKey(knownMeta.linkedBlock).toLowerCase();
      if (linkedCanon) {
        matchIds.add(`warga:${linkedCanon}`);
        matchIds.add(linkedCanon);
      }
    }

    const displayName = String(
      verifiedMatch.nama_warga || rpcPengurusNama || hint?.namaWarga || knownMeta?.nama || 'Pengurus'
    ).trim();

    return {
      role: 'admin',
      senderId: `admin:${reqUsername}`,
      slug: reqUsername,
      displayName,
      matchIds,
    };
  }

  if (effectiveRole === 'warga') {
    const rawWargaBlockCandidate =
      rawBlok ||
      (hint?.senderId?.toLowerCase().startsWith('warga:')
        ? hint.senderId.slice('warga:'.length)
        : '') ||
      String(verifiedAuthUser?.userMetadata?.blok_rumah || '');
    const canonBlok = canonicalBlockKey(rawWargaBlockCandidate);
    const uuidCandidate = String(
      hint?.userId ||
        verifiedAuthUser?.id ||
        (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          rawWargaBlockCandidate
        )
          ? rawWargaBlockCandidate
          : '')
    )
      .trim()
      .toLowerCase();
    const phoneCandidates = new Set<string>(buildPhoneMatchTokens(hint?.noWa || rawWargaBlockCandidate));
    const nameCandidate = normalizeToken(hint?.namaWarga || (!canonBlok ? rawWargaBlockCandidate : ''));

    if (!canonBlok && !uuidCandidate && phoneCandidates.size === 0 && !nameCandidate) {
      throw Object.assign(
        new Error('Identitas Warga tidak lengkap (blok_rumah, UUID, maupun nomor HP/username tidak tersedia).'),
        { statusCode: 401 }
      );
    }

    const { rows, errorText } = await fetchUsersWargaRows();
    let matchingRows = canonBlok
      ? rows.filter((row) => canonicalBlockKey(String(row.blok_rumah || '')) === canonBlok)
      : [];
    if (matchingRows.length === 0 && uuidCandidate) {
      matchingRows = rows.filter((row) => String(row.id || '').trim().toLowerCase() === uuidCandidate);
    }
    if (matchingRows.length === 0 && phoneCandidates.size > 0) {
      matchingRows = rows.filter((row) => {
        const rowPhones = [
          ...buildPhoneMatchTokens(row.no_wa),
          ...buildPhoneMatchTokens(row.secondary_whatsapp),
        ];
        return rowPhones.some((p) => phoneCandidates.has(p));
      });
    }
    if (matchingRows.length === 0 && nameCandidate) {
      const exactNameRows = rows.filter(
        (row) => normalizeToken(row.nama_warga) === nameCandidate && !isPengurusRowRole(row)
      );
      if (exactNameRows.length === 1) {
        matchingRows = exactNameRows;
      }
    }

    const activeWargaRow = matchingRows.find(
      (row) => row.aktif !== false && !isPengurusRowRole(row)
    );
    const inactiveWargaRow = matchingRows.find(
      (row) => row.aktif === false && !isPengurusRowRole(row)
    );
    const activePengurusRow = matchingRows.find(
      (row) => row.aktif !== false && isPengurusRowRole(row)
    );

    const resolvedCanonBlok =
      canonicalBlockKey(activeWargaRow?.blok_rumah || rawWargaBlockCandidate) || canonBlok;
    let verifiedDisplayName = activeWargaRow
      ? String(activeWargaRow.nama_warga || '').trim()
      : '';
    let verifiedWarga = Boolean(activeWargaRow);

    if (!verifiedWarga && !inactiveWargaRow) {
      try {
        const dirRes = await supabaseRestJson<Array<Record<string, unknown>>>(
          '/rest/v1/rpc/get_chat_directory',
          { method: 'POST', body: '{}' }
        );
        if (dirRes.ok && Array.isArray(dirRes.data)) {
          const canonLower = resolvedCanonBlok.toLowerCase();
          const dirMatch = dirRes.data.find((entry) => {
            const entryRole = normalizeToken(String(entry.role || ''));
            if (entryRole && entryRole !== 'warga') return false;
            const entryBlok = canonicalBlockKey(String(entry.blok_rumah || entry.blok_or_code || ''));
            const entryPid = normalizeParticipantId(String(entry.participant_id || ''));
            const entryName = normalizeToken(String(entry.display_name || ''));
            return (
              (resolvedCanonBlok && entryBlok === resolvedCanonBlok) ||
              (canonLower && entryPid === `warga:${canonLower}`) ||
              (nameCandidate && entryName === nameCandidate)
            );
          });
          if (dirMatch) {
            verifiedWarga = true;
            verifiedDisplayName = String(dirMatch.display_name || '').trim();
          }
        }
      } catch {
        // Lanjutkan ke validasi akhir
      }
    }

    if (!verifiedWarga) {
      if (inactiveWargaRow) {
        throw Object.assign(
          new Error(
            `Akun Warga Blok "${resolvedCanonBlok || rawWargaBlockCandidate}" berstatus nonaktif di users_warga (aktif = false).`
          ),
          { statusCode: 403 }
        );
      }
      if (activePengurusRow) {
        throw Object.assign(
          new Error(
            `Akun Blok "${resolvedCanonBlok || rawWargaBlockCandidate}" terdaftar sebagai Pengurus aktif (${String(
              activePengurusRow.jabatan || activePengurusRow.role || 'Pengurus'
            )}). Gunakan portal Pengurus untuk mengunggah lampiran.`
          ),
          { statusCode: 403 }
        );
      }
      if (errorText) {
        throw new Error(`Gagal memverifikasi akun Warga pada users_warga: ${errorText}`);
      }
      throw Object.assign(
        new Error(
          `Akun Warga "${resolvedCanonBlok || rawWargaBlockCandidate || hint?.namaWarga || '-'}" tidak ditemukan aktif di users_warga maupun direktori chat (baris users_warga=${rows.length}).`
        ),
        { statusCode: 403 }
      );
    }

    const canonLower = (resolvedCanonBlok || rawWargaBlockCandidate).toLowerCase();
    const rawLower = normalizeToken(rawWargaBlockCandidate);
    const matchIds = new Set<string>([`warga:${canonLower}`]);
    if (rawLower) matchIds.add(`warga:${rawLower}`);

    addIdentityVariants(matchIds, 'warga', {
      uuid: activeWargaRow?.id || hint?.userId || verifiedAuthUser?.id,
      blok: activeWargaRow?.blok_rumah || resolvedCanonBlok,
      name: verifiedDisplayName || activeWargaRow?.nama_warga || hint?.namaWarga,
      username: hint?.username,
      phones: [activeWargaRow?.no_wa, activeWargaRow?.secondary_whatsapp, hint?.noWa],
    });

    return {
      role: 'warga',
      senderId: `warga:${canonLower}`,
      slug: canonLower.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(
        verifiedDisplayName || hint?.namaWarga || `Warga ${resolvedCanonBlok || rawWargaBlockCandidate}`
      ).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'petugas' || effectiveRole === 'keamanan') {
    const lookupToken = normalizeToken(rawPetugasId || rawBlok || hint?.namaWarga || hint?.username);
    if (!lookupToken) {
      throw Object.assign(new Error('Identitas Petugas Keamanan tidak lengkap.'), { statusCode: 401 });
    }

    const res = await supabaseRestJson<
      Array<{ id?: string; nama?: string; username?: string; aktif?: boolean }>
    >('/rest/v1/petugas_keamanan?aktif=eq.true&select=id,nama,username,aktif');

    if (!res.ok || !Array.isArray(res.data)) {
      throw new Error(`Gagal memverifikasi akun Keamanan: ${res.errorText || res.status}`);
    }

    const matched = res.data.find(
      (row) =>
        normalizeToken(row.id) === lookupToken ||
        normalizeToken(row.username) === lookupToken ||
        normalizeToken(row.nama) === lookupToken
    );

    if (!matched || !matched.id) {
      throw Object.assign(
        new Error(`Akun Petugas Keamanan "${rawPetugasId || rawBlok}" tidak aktif atau tidak ditemukan.`),
        { statusCode: 403 }
      );
    }

    const petIdLower = normalizeToken(matched.id);
    const matchIds = new Set<string>([`petugas:${petIdLower}`, `keamanan:${petIdLower}`, petIdLower]);
    if (rawBlok) {
      matchIds.add(`petugas:${normalizeToken(rawBlok)}`);
      matchIds.add(`keamanan:${normalizeToken(rawBlok)}`);
    }
    if (matched.username) {
      const uTok = normalizeToken(matched.username);
      matchIds.add(`petugas:${uTok}`);
      matchIds.add(`keamanan:${uTok}`);
      matchIds.add(uTok);
    }
    if (matched.nama) {
      const nTok = normalizeToken(matched.nama);
      matchIds.add(`petugas:${nTok}`);
      matchIds.add(`keamanan:${nTok}`);
      matchIds.add(nTok);
    }

    return {
      role: 'petugas',
      senderId: `petugas:${petIdLower}`,
      slug: petIdLower.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(matched.nama || 'Petugas Keamanan'),
      matchIds,
    };
  }

  throw Object.assign(new Error('Sesi portal aktif diperlukan untuk mengunggah lampiran chat.'), {
    statusCode: 401,
  });
}

async function verifyMessageOwnershipIfPresent(
  messageId: string | undefined,
  roomId: string,
  caller: VerifiedChatCaller
): Promise<void> {
  if (!messageId) return;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
    throw Object.assign(new Error('Format messageId tidak valid.'), { statusCode: 400 });
  }

  const res = await supabaseRestJson<
    Array<{ id: string; room_id?: string; sender_id?: string }>
  >(`/rest/v1/community_chat_messages?id=eq.${encodeURIComponent(messageId)}&select=id,room_id,sender_id&limit=1`);

  if (!res.ok) {
    throw new Error(`Gagal memeriksa kepemilikan pesan: ${res.errorText || res.status}`);
  }
  const row = res.data?.[0];
  if (!row) {
    throw Object.assign(new Error('Pesan chat tidak ditemukan.'), { statusCode: 404 });
  }
  if (normalizeChatRoomId(String(row.room_id || '')) !== roomId) {
    throw Object.assign(new Error('Pesan tidak sesuai dengan ruang chat yang diminta.'), {
      statusCode: 403,
    });
  }
  const rowSender = normalizeParticipantId(String(row.sender_id || ''));
  if (caller.role !== 'admin' && !caller.matchIds.has(rowSender)) {
    throw Object.assign(new Error('Anda tidak berhak mengubah lampiran pesan ini.'), {
      statusCode: 403,
    });
  }
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

const oauth2TokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

async function exchangeOAuth2RefreshToken(
  cfg: DriveAuthConfig,
  forceRefresh = false
): Promise<string> {
  const clientId = stripOuterQuotes(cfg.clientId);
  const clientSecret = stripOuterQuotes(cfg.clientSecret);
  const refreshToken = stripOuterQuotes(cfg.refreshToken);

  if (!clientId || !clientSecret || !refreshToken) {
    const missingFields: string[] = [];
    const fieldReasons: Record<string, string> = {};
    if (!clientId) {
      missingFields.push(cfg.clientIdField);
      fieldReasons[cfg.clientIdField] = `Environment variable ${cfg.clientIdField} kosong setelah sanitasi.`;
    }
    if (!clientSecret) {
      missingFields.push(cfg.clientSecretField);
      fieldReasons[cfg.clientSecretField] = `Environment variable ${cfg.clientSecretField} kosong setelah sanitasi.`;
    }
    if (!refreshToken) {
      missingFields.push(cfg.refreshTokenField);
      fieldReasons[cfg.refreshTokenField] = `Environment variable ${cfg.refreshTokenField} kosong setelah sanitasi.`;
    }
    throw buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields,
      invalidFields: [],
      fieldReasons,
    });
  }

  const cacheKey = crypto
    .createHash('sha256')
    .update(`${clientId}|${refreshToken}`)
    .digest('hex')
    .slice(0, 24);
  if (!forceRefresh) {
    const cached = oauth2TokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 90_000) {
      return cached.accessToken;
    }
  } else {
    oauth2TokenCache.delete(cacheKey);
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cache: 'no-store',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    oauth2TokenCache.delete(cacheKey);
    const rawText = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim();
    let errCode = '';
    let errDesc = '';
    if (rawText.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawText) as { error?: string; error_description?: string };
        errCode = String(parsed.error || '').trim();
        errDesc = String(parsed.error_description || '').trim();
      } catch {
        // fallback ke rawText
      }
    }
    const detail = (errDesc || rawText || `HTTP ${res.status}`).slice(0, 180);
    if (errCode === 'invalid_client') {
      throw buildCredentialError({
        scope: 'Google Drive OAuth2',
        missingFields: [],
        invalidFields: [cfg.clientIdField, cfg.clientSecretField],
        fieldReasons: {
          [cfg.clientIdField]: `Google OAuth2 menolak client_id (${res.status} / ${errCode}): ${detail}.`,
          [cfg.clientSecretField]: `Pastikan ${cfg.clientSecretField} cocok dengan ${cfg.clientIdField} pada OAuth Client ID Google Cloud.`,
        },
      });
    }
    throw buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields: [cfg.refreshTokenField],
      fieldReasons: {
        [cfg.refreshTokenField]: `Pertukaran refresh_token ditolak Google OAuth2 (${res.status}${
          errCode ? ` / ${errCode}` : ''
        }): ${detail}. Pastikan refresh token masih aktif, OAuth Consent Screen berstatus Published/Production, dan scope Drive disetujui.`,
      },
    });
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    oauth2TokenCache.delete(cacheKey);
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }
  const expiresInSec =
    typeof json.expires_in === 'number' && Number.isFinite(json.expires_in) && json.expires_in > 120
      ? json.expires_in
      : 3600;
  oauth2TokenCache.set(cacheKey, {
    accessToken: json.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
  });
  return json.access_token;
}

async function getDriveServiceAccountToken(cfg: DriveAuthConfig, forceRefresh = false): Promise<string> {
  return exchangeOAuth2RefreshToken(cfg, forceRefresh);
}

async function parseGoogleDriveApiError(res: Response): Promise<{
  status: number;
  reason: string;
  message: string;
}> {
  const rawText = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim();
  let reason = '';
  let message = '';
  if (rawText.startsWith('{')) {
    try {
      const parsed = JSON.parse(rawText) as {
        error?: {
          message?: string;
          status?: string;
          errors?: Array<{ reason?: string; message?: string }>;
        };
      };
      reason = String(parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || '').trim();
      message = String(parsed?.error?.message || '').trim();
    } catch {
      // Gunakan rawText
    }
  }
  return {
    status: res.status,
    reason,
    message: (message || rawText || `HTTP ${res.status}`).slice(0, 220),
  };
}

function buildDriveApiFailureError(
  context: string,
  errInfo: { status: number; reason: string; message: string },
  driveCfg?: DriveAuthConfig
): Error {
  const reasonTag = errInfo.reason ? ` / ${errInfo.reason}` : '';
  const folderField = driveCfg?.rootFolderField || 'GOOGLE_DRIVE_FOLDER_ID';

  if (
    errInfo.reason === 'storageQuotaExceeded' ||
    /storageQuotaExceeded|Service Accounts do not have storage quota/i.test(errInfo.message)
  ) {
    return Object.assign(
      new Error(`${context} (${errInfo.status}${reasonTag}): Kuota penyimpanan Google Drive penuh — ${errInfo.message}`),
      { statusCode: 502 }
    );
  }

  if (errInfo.status === 404 || errInfo.reason === 'notFound') {
    return buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields: [folderField],
      fieldReasons: {
        [folderField]: `Folder Google Drive (${driveCfg?.rootFolderId || '-'}) tidak ditemukan atau tidak dapat diakses oleh akun OAuth2 (${errInfo.status} / notFound: ${errInfo.message}).`,
      },
      statusCode: 404,
    });
  }

  if (errInfo.status === 401 || errInfo.reason === 'authError' || errInfo.reason === 'invalidCredentials') {
    const authField = driveCfg?.refreshTokenField || 'GOOGLE_OAUTH_REFRESH_TOKEN';
    return buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields: [authField],
      fieldReasons: {
        [authField]: `Token akses Google Drive OAuth2 ditolak (${errInfo.status}${reasonTag}): ${errInfo.message}.`,
      },
    });
  }

  if (
    errInfo.status === 403 &&
    (errInfo.reason === 'insufficientFilePermissions' || errInfo.reason === 'insufficientPermissions')
  ) {
    return buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields: [folderField],
      fieldReasons: {
        [folderField]: `Akun Google OAuth2 tidak memiliki izin menulis/mengakses folder ${folderField} (${errInfo.status} / ${errInfo.reason}): ${errInfo.message}.`,
      },
    });
  }

  return Object.assign(
    new Error(`${context} (${errInfo.status}${reasonTag}): ${errInfo.message}`),
    { statusCode: 502 }
  );
}

async function ensureDriveSubfolder(
  accessToken: string,
  folderName: string,
  parentId: string,
  driveCfg?: DriveAuthConfig
): Promise<string> {
  const cleanParentId = stripOuterQuotes(parentId);
  const safeName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeParent = cleanParentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${safeParent}' in parents`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!findRes.ok) {
    const findErr = await parseGoogleDriveApiError(findRes);
    throw buildDriveApiFailureError(`Gagal mencari subfolder Drive "${folderName}"`, findErr, driveCfg);
  }
  const found = (await findRes.json().catch(() => ({}))) as { files?: Array<{ id?: string }> };
  if (found.files?.[0]?.id) return found.files[0].id;

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [cleanParentId],
      }),
    }
  );
  if (!createRes.ok) {
    const createErr = await parseGoogleDriveApiError(createRes);
    throw buildDriveApiFailureError(`Gagal membuat subfolder Drive "${folderName}"`, createErr, driveCfg);
  }
  const created = (await createRes.json().catch(() => ({}))) as { id?: string };
  if (!created?.id) {
    throw new Error(`Google Drive tidak mengembalikan ID saat membuat subfolder "${folderName}".`);
  }
  return created.id;
}

async function resolveMonthlyChatDriveFolder(
  accessToken: string,
  rootFolderId: string,
  roomId: string,
  isoDate?: string | null,
  driveCfg?: DriveAuthConfig
): Promise<{
  folderId: string;
  categoryFolderId: string;
  folderPath: string;
}> {
  const cleanRootFolderId = stripOuterQuotes(rootFolderId);
  const categoryFolder = resolveDriveCategoryFolder(roomId);
  const monthFolder = getJakartaYearMonth(isoDate);
  const categoryFolderId = await ensureDriveSubfolder(
    accessToken,
    categoryFolder,
    cleanRootFolderId,
    driveCfg
  );
  const folderId = await ensureDriveSubfolder(
    accessToken,
    monthFolder,
    categoryFolderId,
    driveCfg
  );
  return {
    folderId,
    categoryFolderId,
    folderPath: `${categoryFolder}/${monthFolder}`,
  };
}

const EPHEMERAL_FALLBACK_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

export function resolveRoomDrivePermissionScope(roomId: string): DrivePermissionScope {
  const clean = String(roomId || '').trim();
  if (clean === 'grup_pengurus' || clean.startsWith('dm:')) {
    return 'restricted_private';
  }
  return 'anyone_link';
}

async function stripPublicAnyonePermissions(accessToken: string, fileId: string): Promise<void> {
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}/permissions?supportsAllDrives=true&fields=permissions(id,type,role)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  ).catch(() => null);

  if (!listRes || !listRes.ok) return;
  const listJson = (await listRes.json().catch(() => ({}))) as {
    permissions?: Array<{ id?: string; type?: string }>;
  };

  for (const perm of listJson.permissions || []) {
    if (perm?.type === 'anyone' && perm.id) {
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          fileId
        )}/permissions/${encodeURIComponent(perm.id)}?supportsAllDrives=true`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      ).catch(() => undefined);
    }
  }
}

export async function applyRoomDrivePermissionPolicy(
  accessToken: string,
  fileId: string,
  roomId: string,
  driveCfg?: DriveAuthConfig
): Promise<DrivePermissionScope> {
  const scope = resolveRoomDrivePermissionScope(roomId);
  if (scope === 'anyone_link') {
    const permRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'anyone',
          role: 'reader',
          allowFileDiscovery: false,
        }),
      }
    );
    if (!permRes.ok) {
      const permErr = await parseGoogleDriveApiError(permRes);
      throw buildDriveApiFailureError('Gagal menetapkan izin baca publik tautan Google Drive', permErr, driveCfg);
    }
    return 'anyone_link';
  }

  // Ruang privat (Grup Pengurus & DM Personal): DILARANG memberi izin anyone; hapus izin anyone bila ada
  await stripPublicAnyonePermissions(accessToken, fileId);
  return 'restricted_private';
}

export function buildPrivateDriveProxyUrl(params: {
  fileId: string;
  roomId: string;
  messageId?: string;
  mode?: 'stream' | 'download' | 'thumbnail';
}): string {
  const qs = new URLSearchParams({
    fileId: params.fileId,
    roomId: params.roomId,
  });
  if (params.messageId) qs.set('messageId', params.messageId);
  if (params.mode && params.mode !== 'stream') qs.set('mode', params.mode);
  return `/api/storage/chat-drive-private-access?${qs.toString()}`;
}

function getPrivateStreamSigningSecret(): string {
  return (
    stripOuterQuotes(process.env.CHAT_MEDIA_SIGNING_SECRET) ||
    stripOuterQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    stripOuterQuotes(process.env.SERVICE_ROLE_KEY) ||
    EPHEMERAL_FALLBACK_SIGNING_KEY
  ).trim();
}

export function signPrivateStreamToken(payload: {
  fileId: string;
  roomId: string;
  role: string;
  blokRumah: string;
  petugasId: string;
  exp: number;
}): string {
  const secret = getPrivateStreamSigningSecret();
  const canonical = JSON.stringify({
    f: payload.fileId,
    r: payload.roomId,
    ro: payload.role,
    b: payload.blokRumah,
    p: payload.petugasId,
    e: payload.exp,
  });
  return base64UrlEncode(crypto.createHmac('sha256', secret).update(canonical).digest());
}

export function verifyPrivateStreamToken(
  payload: {
    fileId: string;
    roomId: string;
    role: string;
    blokRumah: string;
    petugasId: string;
    exp: number;
  },
  signatureB64Url: string
): boolean {
  if (!signatureB64Url || !Number.isFinite(payload.exp) || Date.now() > payload.exp) {
    return false;
  }
  try {
    const expected = signPrivateStreamToken(payload);
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(signatureB64Url, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function recordUnauthorizedDriveAccessAudit(params: {
  headers: { role: string; blokRumah: string; petugasId: string };
  roomId?: string;
  fileId?: string;
  messageId?: string;
  reason: string;
}): Promise<void> {
  try {
    const actorRole = normalizeToken(params.headers.role) || 'anonymous';
    const actorBlok = String(params.headers.blokRumah || '').trim();
    const actorPetugas = String(params.headers.petugasId || '').trim();
    const actorId = actorBlok || actorPetugas || 'anonymous';

    await supabaseRestJson('/rest/v1/audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        actor_role: actorRole,
        actor_id: actorId,
        actor_name: `Penolakan Akses (${actorRole})`,
        action: 'UNAUTHORIZED_PRIVATE_DRIVE_ACCESS',
        entity: 'chat_private_media',
        entity_id: params.fileId || params.messageId || params.roomId || null,
        summary: `Akses berkas privat Google Drive ditolak (403) pada ruang ${
          params.roomId || 'tidak diketahui'
        }: ${params.reason}`,
        metadata: {
          room_id: params.roomId || null,
          drive_file_id: params.fileId || null,
          message_id: params.messageId || null,
          reason: params.reason,
          requested_role: actorRole,
          requested_blok: actorBlok || null,
          requested_petugas_id: actorPetugas || null,
        },
      }),
    });
  } catch {
    // Jangan gagalkan respons 403 bila penulisan audit mengalami kendala jaringan
  }
}

async function uploadBufferToDrive(params: {
  accessToken: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  description?: string;
  driveCfg?: DriveAuthConfig;
}): Promise<{
  id: string;
  name: string;
  size: number;
  webViewLink: string;
  thumbnailLink?: string;
}> {
  if (params.buffer.byteLength > 4 * 1024 * 1024) {
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,webViewLink,thumbnailLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': params.mimeType,
          'X-Upload-Content-Length': String(params.buffer.byteLength),
        },
        body: JSON.stringify({
          name: params.fileName,
          parents: [params.folderId],
          mimeType: params.mimeType,
          description: params.description || 'Lampiran Chat Komunitas e-Card IPL Saung Kebun',
        }),
      }
    );

    if (!initRes.ok) {
      const errInfo = await parseGoogleDriveApiError(initRes);
      throw buildDriveApiFailureError('Gagal memulai unggah dokumen besar ke Google Drive', errInfo, params.driveCfg);
    }

    const sessionUri = (initRes.headers.get('location') || '').trim();
    if (!sessionUri) {
      throw new Error('Google Drive tidak mengembalikan URI unggah.');
    }

    const putRes = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': params.mimeType,
        'Content-Length': String(params.buffer.byteLength),
      },
      body: new Uint8Array(params.buffer),
    });

    if (!putRes.ok) {
      const errInfo = await parseGoogleDriveApiError(putRes);
      throw buildDriveApiFailureError('Gagal mengunggah konten ke Google Drive', errInfo, params.driveCfg);
    }

    const uploaded = (await putRes.json()) as {
      id: string;
      name: string;
      size?: string;
      webViewLink?: string;
      thumbnailLink?: string;
    };

    return {
      id: uploaded.id,
      name: uploaded.name || params.fileName,
      size: Number(uploaded.size || params.buffer.byteLength),
      webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
      thumbnailLink: uploaded.thumbnailLink,
    };
  }

  const boundary = `sk_drive_${crypto.randomBytes(12).toString('hex')}`;
  const metadataJson = JSON.stringify({
    name: params.fileName,
    parents: [params.folderId],
    description: params.description || 'Lampiran Chat Komunitas e-Card IPL Saung Kebun',
  });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    'utf-8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf-8');
  const multipart = Buffer.concat([head, params.buffer, tail]);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(multipart),
    }
  );

  if (!uploadRes.ok) {
    const errInfo = await parseGoogleDriveApiError(uploadRes);
    throw buildDriveApiFailureError('Gagal mengunggah lampiran ke Google Drive', errInfo, params.driveCfg);
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    name: string;
    size?: string;
    webViewLink?: string;
    thumbnailLink?: string;
  };

  return {
    id: uploaded.id,
    name: uploaded.name || params.fileName,
    size: Number(uploaded.size || params.buffer.byteLength),
    webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    thumbnailLink: uploaded.thumbnailLink,
  };
}

async function updateChatAttachmentRecord(params: {
  messageId?: string;
  attachmentType: 'photo' | 'document' | 'video';
  attachmentName: string;
  attachmentMime: string;
  attachmentSizeBytes: number;
  storageProvider: 'google_drive';
  driveFileId: string | null;
  driveFolderPath: string;
  attachmentUrl: string | null;
  thumbnailUrl: string | null;
  status: 'uploading_video' | 'ready' | 'failed';
  drivePermissionScope?: DrivePermissionScope;
  driveWebViewLink?: string | null;
  driveThumbnailLink?: string | null;
}): Promise<boolean> {
  if (!params.messageId) return false;

  const rpcV2 = await supabaseRestJson('/rest/v1/rpc/update_chat_message_attachment_v2', {
    method: 'POST',
    body: JSON.stringify({
      p_message_id: params.messageId,
      p_attachment_type: params.attachmentType,
      p_attachment_name: params.attachmentName,
      p_attachment_mime: params.attachmentMime,
      p_attachment_size_bytes: params.attachmentSizeBytes,
      p_attachment_storage_provider: params.storageProvider,
      p_attachment_drive_file_id: params.driveFileId,
      p_attachment_drive_folder_path: params.driveFolderPath,
      p_attachment_url: params.attachmentUrl,
      p_attachment_thumbnail_url: params.thumbnailUrl,
      p_attachment_status: params.status,
      p_drive_permission_scope: params.drivePermissionScope || null,
      p_drive_web_view_link: params.driveWebViewLink || null,
      p_drive_thumbnail_link: params.driveThumbnailLink || null,
    }),
  });
  if (rpcV2.ok) return true;

  const rpcRes = await supabaseRestJson('/rest/v1/rpc/update_chat_message_attachment', {
    method: 'POST',
    body: JSON.stringify({
      p_message_id: params.messageId,
      p_attachment_type: params.attachmentType,
      p_attachment_name: params.attachmentName,
      p_attachment_mime: params.attachmentMime,
      p_attachment_size_bytes: params.attachmentSizeBytes,
      p_attachment_storage_provider: params.storageProvider,
      p_attachment_drive_file_id: params.driveFileId,
      p_attachment_drive_folder_path: params.driveFolderPath,
      p_attachment_url: params.attachmentUrl,
      p_attachment_thumbnail_url: params.thumbnailUrl,
      p_attachment_status: params.status,
    }),
  });
  if (rpcRes.ok) return true;

  const patchRes = await supabaseRestJson(
    `/rest/v1/community_chat_messages?id=eq.${encodeURIComponent(params.messageId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        attachment_type: params.attachmentType,
        attachment_name: params.attachmentName,
        attachment_mime: params.attachmentMime,
        attachment_size_bytes: params.attachmentSizeBytes,
        attachment_storage_provider: params.storageProvider,
        attachment_drive_file_id: params.driveFileId,
        attachment_drive_folder_path: params.driveFolderPath,
        attachment_url: params.attachmentUrl,
        attachment_thumbnail_url: params.thumbnailUrl,
        attachment_status: params.status,
        ...(params.drivePermissionScope ? { drive_permission_scope: params.drivePermissionScope } : {}),
        ...(params.driveWebViewLink !== undefined ? { drive_web_view_link: params.driveWebViewLink } : {}),
        ...(params.driveThumbnailLink !== undefined
          ? { drive_thumbnail_link: params.driveThumbnailLink }
          : {}),
      }),
    }
  );
  return patchRes.ok;
}

function validateSafeTransitPath(transitPath: string, caller: VerifiedChatCaller): string {
  const clean = String(transitPath || '').trim().replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.includes('\\') || clean.includes('?') || clean.includes('#')) {
    throw Object.assign(new Error('Path transit tidak valid.'), { statusCode: 400 });
  }
  if (!/^[a-zA-Z0-9._:/-]+$/.test(clean)) {
    throw Object.assign(new Error('Karakter path transit tidak diizinkan.'), { statusCode: 400 });
  }
  const expectedPrefix = `${caller.role}/${caller.slug}/`;
  if (!clean.startsWith(expectedPrefix) && caller.role !== 'admin') {
    throw Object.assign(new Error('Path transit harus berada di folder sesi Anda sendiri.'), {
      statusCode: 403,
    });
  }
  if (caller.role === 'admin' && !clean.startsWith('admin/')) {
    throw Object.assign(new Error('Path transit admin tidak valid.'), { statusCode: 403 });
  }
  return clean;
}

function encodeStoragePath(pathValue: string): string {
  return pathValue
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

function sanitizeAllowedOrigin(rawOrigin?: string): string | undefined {
  const clean = String(rawOrigin || '').trim();
  if (!clean) return undefined;
  try {
    const parsed = new URL(clean);
    if (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' &&
        (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    ) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export async function transferChatTransitToDrive(params: {
  callerHeaders: CallerVerificationInput;
  transitPath: string;
  roomId: string;
  messageId?: string;
  fileName?: string;
  mimeType?: string;
}): Promise<TransferTransitResult> {
  const caller = await verifyChatCallerFromHeaders(params.callerHeaders);
  const roomId = normalizeChatRoomId(params.roomId);
  if (!roomId || !canCallerAccessRoom(caller, roomId)) {
    throw Object.assign(new Error('Anda tidak memiliki akses mengunggah lampiran ke ruang chat ini.'), {
      statusCode: 403,
    });
  }

  const transitPath = validateSafeTransitPath(params.transitPath, caller);
  const declaredMime = String(params.mimeType || 'application/octet-stream').trim().toLowerCase();
  const safeName = sanitizeFileName(params.fileName || transitPath.split('/').pop(), 'bin');

  if (isVideoMedia(declaredMime, safeName) || isVideoMedia(declaredMime, transitPath)) {
    throw Object.assign(
      new Error(
        'Video ukuran berapa pun DILARANG transit di Supabase Storage. Gunakan direct Google Drive resumable upload.'
      ),
      { statusCode: 400 }
    );
  }

  await verifyMessageOwnershipIfPresent(params.messageId, roomId, caller);

  const { url: supabaseUrl, serviceKey } = getSupabaseServerConfig();
  const encodedPath = encodeStoragePath(transitPath);
  const downloadRes = await fetch(`${supabaseUrl}/storage/v1/object/chat-transit/${encodedPath}`, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!downloadRes.ok) {
    throw Object.assign(
      new Error(`Berkas sementara di chat-transit tidak ditemukan (${downloadRes.status}).`),
      { statusCode: 404 }
    );
  }

  const contentTypeHeader = String(downloadRes.headers.get('content-type') || declaredMime)
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (isVideoMedia(contentTypeHeader, safeName)) {
    await fetch(`${supabaseUrl}/storage/v1/object/chat-transit/${encodedPath}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }).catch(() => undefined);
    throw Object.assign(
      new Error('Berkas video ditolak dari jalur transit dan dihapus dari bucket sementara.'),
      { statusCode: 400 }
    );
  }

  const bytes = Buffer.from(await downloadRes.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_NON_VIDEO_TRANSIT_BYTES) {
    throw Object.assign(
      new Error(
        `Ukuran lampiran non-video harus antara 1 byte hingga ${Math.round(
          MAX_NON_VIDEO_TRANSIT_BYTES / (1024 * 1024)
        )} MB.`
      ),
      { statusCode: 400 }
    );
  }

  const driveCfg = getDriveConfig();
  const accessToken = await getDriveServiceAccountToken(driveCfg);
  const { folderId, folderPath } = await resolveMonthlyChatDriveFolder(
    accessToken,
    driveCfg.rootFolderId,
    roomId,
    null,
    driveCfg
  );

  const uploaded = await uploadBufferToDrive({
    accessToken,
    folderId,
    fileName: safeName,
    mimeType: contentTypeHeader || declaredMime,
    buffer: bytes,
    description: `Lampiran chat ${roomId} oleh ${caller.displayName} (${caller.senderId})`,
    driveCfg,
  });

  const drivePermissionScope = await applyRoomDrivePermissionPolicy(
    accessToken,
    uploaded.id,
    roomId,
    driveCfg
  );

  // WAJIB hapus objek sementara di chat-transit setelah sukses di Drive
  const deleteRes = await fetch(`${supabaseUrl}/storage/v1/object/chat-transit/${encodedPath}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  const transitDeleted = deleteRes.ok;

  const effectiveMime = contentTypeHeader || declaredMime;
  const attachmentType = classifyNonVideoAttachmentType(effectiveMime, safeName);
  const driveWebViewLink = uploaded.webViewLink;
  const driveThumbnailLink =
    drivePermissionScope === 'anyone_link' && attachmentType === 'photo'
      ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w480`
      : uploaded.thumbnailLink || null;

  const attachmentUrl =
    drivePermissionScope === 'restricted_private'
      ? buildPrivateDriveProxyUrl({
          fileId: uploaded.id,
          roomId,
          messageId: params.messageId,
          mode: 'stream',
        })
      : attachmentType === 'photo'
        ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w1600`
        : driveWebViewLink;

  const thumbnailUrl =
    drivePermissionScope === 'restricted_private'
      ? attachmentType === 'photo'
        ? buildPrivateDriveProxyUrl({
            fileId: uploaded.id,
            roomId,
            messageId: params.messageId,
            mode: 'thumbnail',
          })
        : null
      : driveThumbnailLink;

  const messageUpdated = await updateChatAttachmentRecord({
    messageId: params.messageId,
    attachmentType,
    attachmentName: uploaded.name,
    attachmentMime: effectiveMime,
    attachmentSizeBytes: uploaded.size,
    storageProvider: 'google_drive',
    driveFileId: uploaded.id,
    driveFolderPath: folderPath,
    attachmentUrl,
    thumbnailUrl,
    status: 'ready',
    drivePermissionScope,
    driveWebViewLink,
    driveThumbnailLink,
  });

  return {
    ok: true,
    storageProvider: 'google_drive',
    attachmentType,
    driveFileId: uploaded.id,
    drivePermissionScope,
    driveWebViewLink,
    driveThumbnailLink,
    folderPath,
    fileName: uploaded.name,
    mimeType: effectiveMime,
    sizeBytes: uploaded.size,
    attachmentUrl,
    thumbnailUrl,
    webViewLink: driveWebViewLink,
    transitDeleted,
    messageUpdated,
  };
}

export async function initChatVideoResumableUpload(params: {
  callerHeaders: CallerVerificationInput;
  roomId: string;
  messageId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  transitPath?: string;
  originHeader?: string;
}): Promise<VideoResumableInitResult> {
  const caller = await verifyChatCallerFromHeaders(params.callerHeaders);
  if (params.transitPath) {
    throw Object.assign(new Error('Video DILARANG menggunakan bucket transit Supabase Storage.'), {
      statusCode: 400,
    });
  }

  const roomId = normalizeChatRoomId(params.roomId);
  if (!roomId || !canCallerAccessRoom(caller, roomId)) {
    throw Object.assign(new Error('Anda tidak memiliki akses mengunggah video ke ruang chat ini.'), {
      statusCode: 403,
    });
  }

  const safeName = sanitizeFileName(params.fileName || `video-${Date.now()}.mp4`, 'mp4');
  const cleanMime = String(params.mimeType || 'video/mp4').trim().toLowerCase();
  if (!isVideoMedia(cleanMime, safeName)) {
    throw Object.assign(
      new Error('Endpoint ini khusus untuk berkas video (direct Google Drive resumable upload).'),
      { statusCode: 400 }
    );
  }

  const sizeBytes = Number(params.sizeBytes || 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_RESUMABLE_BYTES) {
    throw Object.assign(
      new Error(
        `Ukuran video harus antara 1 byte hingga ${Math.round(
          MAX_VIDEO_RESUMABLE_BYTES / (1024 * 1024)
        )} MB.`
      ),
      { statusCode: 400 }
    );
  }

  await verifyMessageOwnershipIfPresent(params.messageId, roomId, caller);

  const driveCfg = getDriveConfig();
  const accessToken = await getDriveServiceAccountToken(driveCfg);
  const { folderId, folderPath } = await resolveMonthlyChatDriveFolder(
    accessToken,
    driveCfg.rootFolderId,
    roomId,
    null,
    driveCfg
  );

  const safeOrigin = sanitizeAllowedOrigin(params.originHeader);
  const effectiveVideoMime = cleanMime.startsWith('video/') ? cleanMime : 'video/mp4';
  const initHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': effectiveVideoMime,
    'X-Upload-Content-Length': String(Math.round(sizeBytes)),
  };
  if (safeOrigin) {
    initHeaders.Origin = safeOrigin;
  }

  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: initHeaders,
      body: JSON.stringify({
        name: safeName,
        parents: [folderId],
        mimeType: effectiveVideoMime,
        description: `Video chat ${roomId} oleh ${caller.displayName} (${caller.senderId})`,
      }),
    }
  );

  if (!initRes.ok) {
    const errInfo = await parseGoogleDriveApiError(initRes);
    throw buildDriveApiFailureError('Gagal menginisiasi sesi Resumable Upload Google Drive', errInfo, driveCfg);
  }

  const sessionUri = (initRes.headers.get('location') || '').trim();
  if (!sessionUri.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
    throw Object.assign(
      new Error('Google Drive tidak mengembalikan URI sesi resumable yang valid.'),
      { statusCode: 502 }
    );
  }

  if (params.messageId) {
    await updateChatAttachmentRecord({
      messageId: params.messageId,
      attachmentType: 'video',
      attachmentName: safeName,
      attachmentMime: effectiveVideoMime,
      attachmentSizeBytes: Math.round(sizeBytes),
      storageProvider: 'google_drive',
      driveFileId: null,
      driveFolderPath: folderPath,
      attachmentUrl: null,
      thumbnailUrl: null,
      status: 'uploading_video',
    });
  }

  return {
    ok: true,
    sessionUri,
    folderId,
    folderPath,
    fileName: safeName,
    mimeType: effectiveVideoMime,
    sizeBytes: Math.round(sizeBytes),
    storageProvider: 'google_drive',
  };
}

export async function completeChatVideoResumableUpload(params: {
  callerHeaders: CallerVerificationInput;
  roomId: string;
  messageId?: string;
  driveFileId: string;
  folderPath?: string;
}): Promise<VideoResumableCompleteResult> {
  const caller = await verifyChatCallerFromHeaders(params.callerHeaders);
  const roomId = normalizeChatRoomId(params.roomId);
  if (!roomId || !canCallerAccessRoom(caller, roomId)) {
    throw Object.assign(new Error('Anda tidak memiliki akses ke ruang chat ini.'), {
      statusCode: 403,
    });
  }

  const driveFileId = String(params.driveFileId || '').trim();
  if (!/^[a-zA-Z0-9_-]{10,120}$/.test(driveFileId)) {
    throw Object.assign(new Error('driveFileId Google Drive tidak valid.'), { statusCode: 400 });
  }

  await verifyMessageOwnershipIfPresent(params.messageId, roomId, caller);

  const driveCfg = getDriveConfig();
  const accessToken = await getDriveServiceAccountToken(driveCfg);

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      driveFileId
    )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,webViewLink,thumbnailLink,trashed`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metaRes.ok) {
    const metaErr = await parseGoogleDriveApiError(metaRes);
    if (metaRes.status === 404) {
      throw Object.assign(
        new Error(`Berkas video tidak ditemukan di Google Drive (${metaRes.status}).`),
        { statusCode: 404 }
      );
    }
    throw buildDriveApiFailureError('Gagal membaca metadata video Google Drive', metaErr, driveCfg);
  }

  const fileMeta = (await metaRes.json()) as {
    id: string;
    name?: string;
    mimeType?: string;
    size?: string;
    parents?: string[];
    webViewLink?: string;
    thumbnailLink?: string;
    trashed?: boolean;
  };

  if (fileMeta.trashed) {
    throw Object.assign(new Error('Berkas video telah dihapus dari Drive.'), { statusCode: 400 });
  }

  const effectiveMime = String(fileMeta.mimeType || 'video/mp4').trim().toLowerCase();
  const effectiveName = String(fileMeta.name || `video-${driveFileId}.mp4`).trim();
  if (!isVideoMedia(effectiveMime, effectiveName)) {
    throw Object.assign(
      new Error('Berkas yang diselesaikan di Drive bukan tipe video yang valid.'),
      { statusCode: 400 }
    );
  }

  const expectedFolder = await resolveMonthlyChatDriveFolder(
    accessToken,
    driveCfg.rootFolderId,
    roomId,
    null,
    driveCfg
  );

  const parentIds = Array.isArray(fileMeta.parents) ? fileMeta.parents : [];
  let parentVerified = parentIds.length === 0 || parentIds.includes(expectedFolder.folderId);
  if (!parentVerified && parentIds[0]) {
    const parentMetaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        parentIds[0]
      )}?supportsAllDrives=true&fields=parents`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (parentMetaRes.ok) {
      const pMeta = (await parentMetaRes.json()) as { parents?: string[] };
      if (Array.isArray(pMeta.parents) && pMeta.parents.includes(expectedFolder.categoryFolderId)) {
        parentVerified = true;
      }
    }
  }
  if (!parentVerified) {
    throw Object.assign(
      new Error('Berkas video tidak berada pada folder tujuan Google Drive ruang chat ini.'),
      { statusCode: 403 }
    );
  }

  const resolvedFolderPath = params.folderPath?.trim() || expectedFolder.folderPath;

  const drivePermissionScope = await applyRoomDrivePermissionPolicy(
    accessToken,
    driveFileId,
    roomId,
    driveCfg
  );

  const driveWebViewLink =
    fileMeta.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
  const driveThumbnailLink =
    drivePermissionScope === 'anyone_link'
      ? fileMeta.thumbnailLink ||
        `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w640`
      : fileMeta.thumbnailLink || null;

  const attachmentUrl =
    drivePermissionScope === 'restricted_private'
      ? buildPrivateDriveProxyUrl({
          fileId: driveFileId,
          roomId,
          messageId: params.messageId,
          mode: 'stream',
        })
      : driveWebViewLink;

  const thumbnailUrl =
    drivePermissionScope === 'restricted_private'
      ? buildPrivateDriveProxyUrl({
          fileId: driveFileId,
          roomId,
          messageId: params.messageId,
          mode: 'thumbnail',
        })
      : driveThumbnailLink;
  const sizeBytes = Number(fileMeta.size || 0);

  const messageUpdated = await updateChatAttachmentRecord({
    messageId: params.messageId,
    attachmentType: 'video',
    attachmentName: effectiveName,
    attachmentMime: effectiveMime,
    attachmentSizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    storageProvider: 'google_drive',
    driveFileId,
    driveFolderPath: resolvedFolderPath,
    attachmentUrl,
    thumbnailUrl,
    status: 'ready',
    drivePermissionScope,
    driveWebViewLink,
    driveThumbnailLink,
  });

  return {
    ok: true,
    storageProvider: 'google_drive',
    attachmentType: 'video',
    driveFileId,
    drivePermissionScope,
    driveWebViewLink,
    driveThumbnailLink,
    folderPath: resolvedFolderPath,
    fileName: effectiveName,
    mimeType: effectiveMime,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    attachmentUrl,
    thumbnailUrl,
    webViewLink: driveWebViewLink,
    messageUpdated,
  };
}

const STREAM_URL_TTL_MS = 5 * 60 * 1000;

interface PrivateMessageLookupRow {
  id: string;
  room_id: string;
  sender_id: string;
  sender_user_id?: string | null;
  recipient_id?: string | null;
  target_user_id?: string | null;
  attachment_drive_file_id?: string | null;
  drive_file_id?: string | null;
  attachment_id?: string | null;
}

const MESSAGE_SELECT_CANDIDATES = [
  'id,room_id,sender_id,sender_user_id,recipient_id,target_user_id,attachment_drive_file_id,drive_file_id,attachment_id',
  'id,room_id,sender_id,sender_user_id,recipient_id,target_user_id,attachment_drive_file_id',
  'id,room_id,sender_id,recipient_id,attachment_drive_file_id',
];

async function querySingleChatMessageByColumn(
  column: string,
  value: string
): Promise<PrivateMessageLookupRow | null> {
  if (!value) return null;
  for (const selectExpr of MESSAGE_SELECT_CANDIDATES) {
    const res = await supabaseRestJson<PrivateMessageLookupRow[]>(
      `/rest/v1/community_chat_messages?${encodeURIComponent(column)}=eq.${encodeURIComponent(
        value
      )}&select=${encodeURIComponent(selectExpr)}&limit=1`
    );
    if (res.ok) {
      return res.data?.[0] || null;
    }
    const errMsg = String(res.errorText || '');
    if (/column .* does not exist|Could not find .* column|PGRST204/i.test(errMsg)) {
      if (errMsg.toLowerCase().includes(column.toLowerCase())) {
        return null;
      }
      continue;
    }
    break;
  }
  return null;
}

async function lookupPrivateMessageRecord(params: {
  messageId: string;
  fileId: string;
  attachmentId: string;
}): Promise<PrivateMessageLookupRow | null> {
  if (
    params.messageId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.messageId)
  ) {
    const byId = await querySingleChatMessageByColumn('id', params.messageId);
    if (byId) return byId;
  }

  if (params.fileId) {
    const byAttachDriveId = await querySingleChatMessageByColumn('attachment_drive_file_id', params.fileId);
    if (byAttachDriveId) return byAttachDriveId;

    const byDriveId = await querySingleChatMessageByColumn('drive_file_id', params.fileId);
    if (byDriveId) return byDriveId;
  }

  const attachmentLookup = params.attachmentId || params.fileId;
  if (attachmentLookup) {
    const byAttachmentId = await querySingleChatMessageByColumn('attachment_id', attachmentLookup);
    if (byAttachmentId) return byAttachmentId;

    if (
      params.attachmentId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.attachmentId)
    ) {
      const byMsgId = await querySingleChatMessageByColumn('id', params.attachmentId);
      if (byMsgId) return byMsgId;
    }
  }

  return null;
}

async function isDriveFileInsideRootCategory(
  accessToken: string,
  rootFolderId: string,
  fileParents: string[] | undefined,
  roomId: string
): Promise<boolean> {
  if (!Array.isArray(fileParents) || fileParents.length === 0) return false;
  const expectedCategory = resolveDriveCategoryFolder(roomId);
  const visited = new Set<string>();
  const queue: Array<{ folderId: string; sawExpectedCategory: boolean; depth: number }> = fileParents.map(
    (id) => ({ folderId: id, sawExpectedCategory: false, depth: 1 })
  );

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (!current.folderId || visited.has(current.folderId) || current.depth > 5) continue;
    visited.add(current.folderId);

    if (current.folderId === rootFolderId) {
      if (current.sawExpectedCategory) return true;
      continue;
    }

    const folderRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        current.folderId
      )}?supportsAllDrives=true&fields=id,name,parents`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
    ).catch(() => null);
    if (!folderRes || !folderRes.ok) continue;

    const folderJson = (await folderRes.json().catch(() => ({}))) as { name?: string; parents?: string[] };
    const isCatFolder = folderJson.name === expectedCategory;
    const nextParents = Array.isArray(folderJson.parents) ? folderJson.parents : [];

    if (isCatFolder && nextParents.includes(rootFolderId)) {
      return true;
    }

    for (const parentId of nextParents) {
      queue.push({
        folderId: parentId,
        sawExpectedCategory: current.sawExpectedCategory || isCatFolder,
        depth: current.depth + 1,
      });
    }
  }

  return false;
}

function resolveForwardedContentDisposition(
  upstreamHeader: string | null,
  fileName: string,
  mode: 'stream' | 'download' | 'thumbnail'
): string {
  const dispType = mode === 'download' ? 'attachment' : 'inline';
  const safeAscii = sanitizeFileName(fileName, 'bin');
  const cleanRawName = String(fileName || safeAscii).replace(/[\r\n"]/g, '').trim() || safeAscii;
  if (upstreamHeader && upstreamHeader.toLowerCase().includes('filename')) {
    return upstreamHeader.replace(/^(inline|attachment)/i, dispType);
  }
  return `${dispType}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(cleanRawName)}`;
}

function sendPrivateDriveError(
  res: PrivateDriveNodeResponse,
  status: number,
  payload: Record<string, unknown> & { error: string; reason?: string; stage?: string }
): void {
  res.status(status).json({
    ok: false,
    ...payload,
    reason: payload.reason || payload.error,
  });
}

export interface PrivateDriveNodeRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body?: unknown;
  pathBase?: string;
}

export interface PrivateDriveNodeResponse {
  status: (code: number) => PrivateDriveNodeResponse;
  setHeader: (name: string, value: string) => void;
  json: (data: unknown) => void;
  write: (chunk: Buffer | Uint8Array) => boolean;
  end: (chunk?: string | Buffer) => void;
  once?: (event: string, cb: () => void) => void;
}

function readNodeHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
}

function readNodeQuery(query: Record<string, unknown>, key: string): string {
  const val = query[key];
  if (Array.isArray(val)) return String(val[0] || '');
  return typeof val === 'string' ? val : '';
}

async function pumpFetchBodyToNodeRes(
  fetchRes: Response,
  res: PrivateDriveNodeResponse
): Promise<void> {
  if (!fetchRes.body) {
    res.end();
    return;
  }
  const reader = fetchRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        const canContinue = res.write(Buffer.from(value));
        if (!canContinue && typeof res.once === 'function') {
          await new Promise<void>((resolve) => res.once?.('drain', resolve));
        }
      }
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

export async function handlePrivateChatDriveAccess(
  req: PrivateDriveNodeRequest,
  res: PrivateDriveNodeResponse
): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, Accept-Ranges, Content-Disposition, Content-Type'
  );

  let stage = 'parse_request';
  let fileId = '';
  let rawRoomId = '';
  let messageId = '';

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    sendPrivateDriveError(res, 405, {
      stage,
      error: 'Method tidak diizinkan.',
      reason: `Metode HTTP ${method} tidak didukung untuk akses lampiran privat.`,
    });
    return;
  }

  let bodyObj: Record<string, unknown> = {};
  if (method === 'POST') {
    if (typeof req.body === 'string') {
      try {
        bodyObj = JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        sendPrivateDriveError(res, 400, {
          stage,
          error: 'Body JSON tidak valid.',
          reason: 'Payload permintaan POST bukan format JSON yang valid.',
        });
        return;
      }
    } else if (req.body && typeof req.body === 'object') {
      bodyObj = req.body as Record<string, unknown>;
    }
  }

  const action = String(bodyObj.action || readNodeQuery(req.query, 'action') || '')
    .trim()
    .toLowerCase();
  fileId = String(
    bodyObj.fileId ||
      bodyObj.driveFileId ||
      bodyObj.drive_file_id ||
      readNodeQuery(req.query, 'fileId') ||
      readNodeQuery(req.query, 'driveFileId') ||
      readNodeQuery(req.query, 'drive_file_id') ||
      ''
  ).trim();
  const attachmentId = String(
    bodyObj.attachmentId ||
      bodyObj.attachment_id ||
      readNodeQuery(req.query, 'attachmentId') ||
      readNodeQuery(req.query, 'attachment_id') ||
      ''
  ).trim();
  rawRoomId = String(bodyObj.roomId || readNodeQuery(req.query, 'roomId') || '').trim();
  messageId = String(
    bodyObj.messageId ||
      bodyObj.message_id ||
      readNodeQuery(req.query, 'messageId') ||
      readNodeQuery(req.query, 'message_id') ||
      ''
  ).trim();
  const modeRaw = String(bodyObj.mode || readNodeQuery(req.query, 'mode') || 'stream')
    .trim()
    .toLowerCase();
  const mode: 'stream' | 'download' | 'thumbnail' =
    modeRaw === 'download' ? 'download' : modeRaw === 'thumbnail' ? 'thumbnail' : 'stream';

  let callerHeaders: CallerVerificationInput = {
    role: readNodeHeader(req.headers, 'x-user-role'),
    blokRumah: readNodeHeader(req.headers, 'x-blok-rumah') || readNodeHeader(req.headers, 'x-pengurus-username'),
    petugasId: readNodeHeader(req.headers, 'x-petugas-id'),
    authorization: readNodeHeader(req.headers, 'authorization'),
    adminJabatan: readNodeHeader(req.headers, 'x-admin-jabatan'),
    adminPermission: readNodeHeader(req.headers, 'x-admin-permission'),
    senderHint:
      bodyObj.sender && typeof bodyObj.sender === 'object'
        ? (bodyObj.sender as SenderCallerHint)
        : null,
  };

  const sig = readNodeQuery(req.query, 'sig');
  const expParam = Number(readNodeQuery(req.query, 'exp') || '0');
  if ((method === 'GET' || method === 'HEAD') && sig) {
    stage = 'verify_stream_signature';
    const ro = readNodeQuery(req.query, 'ro');
    const b = readNodeQuery(req.query, 'b');
    const p = readNodeQuery(req.query, 'p');
    const sigValid = verifyPrivateStreamToken(
      { fileId, roomId: rawRoomId, role: ro, blokRumah: b, petugasId: p, exp: expParam },
      sig
    );
    if (!sigValid) {
      const reason = 'Tanda tangan URL aliran media privat tidak valid atau telah kedaluwarsa.';
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      sendPrivateDriveError(res, 403, {
        stage,
        error: 'Akses lampiran privat ditolak.',
        reason,
      });
      return;
    }
    callerHeaders = {
      ...callerHeaders,
      role: ro,
      blokRumah: b,
      petugasId: p,
    };
  }

  try {
    stage = 'verify_caller';
    let caller: VerifiedChatCaller;
    try {
      caller = await verifyChatCallerFromHeaders(callerHeaders);
    } catch (authErr) {
      const typedAuthErr = authErr as CredentialValidationError;
      if (typedAuthErr?.missingFields?.length || typedAuthErr?.invalidFields?.length) {
        throw authErr;
      }
      const statusCode = typeof typedAuthErr?.statusCode === 'number' ? typedAuthErr.statusCode : 403;
      const reason = authErr instanceof Error ? authErr.message : 'Identitas peminta tidak valid.';
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      sendPrivateDriveError(res, statusCode, {
        stage,
        error: 'Akses lampiran privat ditolak.',
        reason,
      });
      return;
    }

    stage = 'lookup_message_record';
    if (
      messageId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId) &&
      !fileId
    ) {
      sendPrivateDriveError(res, 400, {
        stage,
        error: 'Format messageId tidak valid.',
        reason: 'Parameter messageId harus berupa UUID valid atau sertakan drive_file_id/fileId.',
      });
      return;
    }

    const dbMessageRow = await lookupPrivateMessageRecord({
      messageId,
      fileId,
      attachmentId,
    });

    if (dbMessageRow) {
      const dbFileId = String(
        dbMessageRow.attachment_drive_file_id || dbMessageRow.drive_file_id || ''
      ).trim();
      if (!fileId && dbFileId) {
        fileId = dbFileId;
      }
      if (fileId && dbFileId && dbFileId !== fileId) {
        const reason = 'ID berkas Google Drive yang diminta tidak cocok dengan record pesan terkait.';
        await recordUnauthorizedDriveAccessAudit({
          headers: callerHeaders,
          roomId: dbMessageRow.room_id,
          fileId,
          messageId,
          reason,
        });
        sendPrivateDriveError(res, 403, {
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
        return;
      }
      const dbRoom = normalizeChatRoomId(String(dbMessageRow.room_id || ''));
      if (rawRoomId && dbRoom && normalizeChatRoomId(rawRoomId) !== dbRoom) {
        const reason = 'roomId yang diminta tidak cocok dengan ruang asal pesan pada database.';
        await recordUnauthorizedDriveAccessAudit({
          headers: callerHeaders,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason,
        });
        sendPrivateDriveError(res, 403, {
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
        return;
      }
      if (dbRoom) rawRoomId = dbRoom;
    } else if (!fileId && (messageId || attachmentId)) {
      const reason =
        'Record pesan atau lampiran chat tidak ditemukan di database berdasarkan messageId maupun attachment_id.';
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      sendPrivateDriveError(res, 404, {
        stage,
        error: 'Lampiran chat tidak ditemukan.',
        reason,
      });
      return;
    }

    const roomId = normalizeChatRoomId(rawRoomId);
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId) || !roomId) {
      const reason = !/^[a-zA-Z0-9_-]{10,120}$/.test(fileId)
        ? `ID berkas Google Drive tidak valid atau kosong ("${fileId || '-'}").`
        : `ID ruang chat tidak valid ("${rawRoomId || '-'}").`;
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      sendPrivateDriveError(res, 400, {
        stage,
        error: 'Parameter akses berkas privat tidak valid.',
        reason,
      });
      return;
    }

    stage = 'authorize_room_access';
    let authorized = canCallerAccessRoom(caller, roomId);
    let denyReason = 'Akun peminta bukan anggota sah ruang chat terkait.';

    if (roomId === 'grup_pengurus') {
      authorized = caller.role === 'admin';
      if (!authorized) {
        denyReason = 'Berkas Group Pengurus hanya dapat diakses oleh akun Pengurus aktif.';
      }
    } else if (roomId === 'pengurus_keamanan') {
      authorized = caller.role === 'admin' || caller.role === 'petugas';
      if (!authorized) {
        denyReason =
          'Berkas Group Pengurus & Keamanan hanya dapat diakses oleh akun Pengurus atau Keamanan aktif.';
      }
    } else if (roomId === 'pengurus_warga') {
      authorized = caller.role === 'admin' || caller.role === 'warga';
      if (!authorized) {
        denyReason = 'Berkas Group Pengurus & Warga khusus untuk Pengurus dan Warga aktif.';
      }
    } else if (roomId === 'warga_keamanan') {
      authorized = caller.role === 'warga' || caller.role === 'petugas';
      if (!authorized) {
        denyReason = 'Berkas Group Warga & Keamanan khusus untuk Warga dan Petugas Keamanan aktif.';
      }
    } else if (roomId.startsWith('dm:')) {
      const matchesSenderOrRecipient = dbMessageRow
        ? doesCallerMatchFieldValue(caller, dbMessageRow.sender_id) ||
          doesCallerMatchFieldValue(caller, dbMessageRow.sender_user_id) ||
          doesCallerMatchFieldValue(caller, dbMessageRow.recipient_id) ||
          doesCallerMatchFieldValue(caller, dbMessageRow.target_user_id)
        : false;

      if (matchesSenderOrRecipient) {
        authorized = true;
      } else if (authorized && dbMessageRow) {
        const hasExplicitSender = Boolean(dbMessageRow.sender_id || dbMessageRow.sender_user_id);
        const hasExplicitRecipient = Boolean(
          dbMessageRow.recipient_id || dbMessageRow.target_user_id
        );
        if (hasExplicitSender && hasExplicitRecipient) {
          authorized = false;
          denyReason =
            'Peminta bukan pengirim (sender_id/sender_user_id) maupun penerima (recipient_id/target_user_id) pesan DM ini.';
        }
      } else if (!authorized) {
        denyReason = 'Peminta bukan pengirim maupun penerima sah pada percakapan DM Personal ini.';
      }
    }

    if (!authorized) {
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId,
        fileId,
        messageId,
        reason: denyReason,
      });
      sendPrivateDriveError(res, 403, {
        stage,
        error: 'Akses lampiran privat ditolak.',
        reason: denyReason,
      });
      return;
    }

    stage = 'validate_drive_secrets';
    const driveCfg = getDriveConfig();

    stage = 'authenticate_drive';
    const accessToken = await getDriveServiceAccountToken(driveCfg);

    stage = 'fetch_drive_metadata';
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,thumbnailLink`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' }
    );
    if (!metaRes.ok) {
      const metaErr = await parseGoogleDriveApiError(metaRes);
      if (metaRes.status === 404) {
        sendPrivateDriveError(res, 404, {
          stage,
          error: 'Berkas lampiran tidak ditemukan di Google Drive.',
          reason: `Google Drive API mengembalikan 404 untuk fileId "${fileId}": ${metaErr.message}`,
        });
        return;
      }
      throw buildDriveApiFailureError('Gagal membaca metadata berkas Google Drive', metaErr, driveCfg);
    }

    const fileMeta = (await metaRes.json()) as {
      id: string;
      name?: string;
      mimeType?: string;
      size?: string;
      parents?: string[];
      trashed?: boolean;
      thumbnailLink?: string;
    };
    if (fileMeta.trashed) {
      sendPrivateDriveError(res, 404, {
        stage,
        error: 'Berkas telah dihapus dari Google Drive.',
        reason: `Berkas Google Drive "${fileMeta.name || fileId}" berada di Trash/Sampah.`,
      });
      return;
    }

    if (!dbMessageRow) {
      const inRootTree = await isDriveFileInsideRootCategory(
        accessToken,
        driveCfg.rootFolderId,
        fileMeta.parents,
        roomId
      );
      if (!inRootTree) {
        const reason = `Berkas Google Drive ("${fileMeta.name || fileId}") tidak terdaftar di database pesan maupun folder kategori ruang "${roomId}".`;
        await recordUnauthorizedDriveAccessAudit({
          headers: callerHeaders,
          roomId,
          fileId,
          messageId,
          reason,
        });
        sendPrivateDriveError(res, 403, {
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
        return;
      }
    }

    if (method === 'POST' && action === 'mint_stream_url') {
      stage = 'mint_stream_url';
      const exp = Date.now() + STREAM_URL_TTL_MS;
      const roleVal = (callerHeaders.role || caller.role).trim();
      const blokVal = (
        callerHeaders.blokRumah ||
        callerHeaders.senderHint?.blokRumah ||
        caller.slug ||
        ''
      ).trim();
      const petVal = (
        callerHeaders.petugasId ||
        callerHeaders.senderHint?.petugasId ||
        ''
      ).trim();
      const signedSig = signPrivateStreamToken({
        fileId,
        roomId,
        role: roleVal,
        blokRumah: blokVal,
        petugasId: petVal,
        exp,
      });
      const streamParams = new URLSearchParams({
        fileId,
        roomId,
        ro: roleVal,
        b: blokVal,
        p: petVal,
        exp: String(exp),
        sig: signedSig,
      });
      if (messageId) streamParams.set('messageId', messageId);
      if (mode !== 'stream') streamParams.set('mode', mode);

      const endpointBase = req.pathBase || '/api/storage/chat-drive-private-access';
      res.status(200).json({
        ok: true,
        streamUrl: `${endpointBase}?${streamParams.toString()}`,
        expiresAt: new Date(exp).toISOString(),
        mimeType: fileMeta.mimeType || 'application/octet-stream',
        fileName: fileMeta.name || `lampiran-${fileId}`,
        sizeBytes: Number(fileMeta.size || 0),
        drivePermissionScope: 'restricted_private',
      });
      return;
    }

    if (mode === 'thumbnail' && fileMeta.thumbnailLink) {
      stage = 'stream_thumbnail';
      const thumbRes = await fetch(fileMeta.thumbnailLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const thumbCt = (thumbRes.headers.get('content-type') || '').trim().toLowerCase();
      if (thumbRes.ok && thumbCt.startsWith('image/')) {
        res.setHeader('Content-Type', thumbCt || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(200);
        if (method === 'HEAD') {
          await thumbRes.body?.cancel().catch(() => undefined);
          res.end();
          return;
        }
        await pumpFetchBodyToNodeRes(thumbRes, res);
        return;
      }
      await thumbRes.body?.cancel().catch(() => undefined);
    }

    stage = 'stream_drive_media';
    const rangeHeader = readNodeHeader(req.headers, 'range').trim();
    const driveFetchHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader)) {
      driveFetchHeaders.Range = rangeHeader;
    }

    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?alt=media&supportsAllDrives=true`,
      {
        method: 'GET',
        headers: driveFetchHeaders,
        cache: 'no-store',
      }
    );

    if (!mediaRes.ok && mediaRes.status !== 206) {
      const mediaErr = await parseGoogleDriveApiError(mediaRes);
      if (mediaRes.status === 416) {
        sendPrivateDriveError(res, 416, {
          stage,
          error: 'Rentang byte berkas Google Drive tidak valid (416).',
          reason: mediaErr.message,
        });
        return;
      }
      throw buildDriveApiFailureError('Gagal mengalirkan berkas dari Google Drive', mediaErr, driveCfg);
    }

    const upstreamCt = (mediaRes.headers.get('content-type') || '').trim();
    const resolvedCt =
      (upstreamCt && upstreamCt !== 'application/octet-stream' ? upstreamCt : '') ||
      fileMeta.mimeType ||
      upstreamCt ||
      'application/octet-stream';
    const rawFileName = fileMeta.name || `lampiran-${fileId}`;

    res.setHeader('Content-Type', resolvedCt);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      resolveForwardedContentDisposition(
        mediaRes.headers.get('content-disposition'),
        rawFileName,
        mode
      )
    );

    const contentRange = mediaRes.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const contentLength = mediaRes.headers.get('content-length') || fileMeta.size;
    if (contentLength) res.setHeader('Content-Length', String(contentLength));

    res.status(mediaRes.status);
    if (method === 'HEAD') {
      await mediaRes.body?.cancel().catch(() => undefined);
      res.end();
      return;
    }

    await pumpFetchBodyToNodeRes(mediaRes, res);
  } catch (err) {
    const typedErr = err as CredentialValidationError;
    const statusCode = typeof typedErr?.statusCode === 'number' ? typedErr.statusCode : 500;
    const errorMessage = err instanceof Error ? err.message : 'Gagal mengakses berkas privat Google Drive.';
    const missingFields = Array.isArray(typedErr?.missingFields) ? typedErr.missingFields : undefined;
    const invalidFields = Array.isArray(typedErr?.invalidFields) ? typedErr.invalidFields : undefined;
    const fieldReasons =
      typedErr?.fieldReasons && typeof typedErr.fieldReasons === 'object'
        ? typedErr.fieldReasons
        : undefined;
    const detailReason =
      fieldReasons && Object.keys(fieldReasons).length > 0
        ? Object.values(fieldReasons).join(' ')
        : errorMessage;

    sendPrivateDriveError(res, statusCode, {
      stage,
      error: errorMessage,
      reason: detailReason,
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
    });
  }
}
