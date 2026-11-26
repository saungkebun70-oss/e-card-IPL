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
  blokRumah?: string;
  pengurusUsername?: string;
  namaWarga?: string;
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

export type DriveAuthConfig =
  | {
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
  | {
      mode: 'service_account';
      clientEmail: string;
      privateKey: string;
      rootFolderId: string;
      privateKeyId?: string;
      clientEmailField?: string;
      privateKeyField?: string;
      rootFolderField?: string;
    };

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
    const p1 = normalizeParticipantId(body.slice(0, idx));
    const p2 = normalizeParticipantId(body.slice(idx + 2));
    return caller.matchIds.has(p1) || caller.matchIds.has(p2);
  }
  return false;
}

const DEFAULT_DRIVE_CLIENT_EMAIL = 'saung-kebun-drive@saung-kebun-87b23.iam.gserviceaccount.com';
const DEFAULT_DRIVE_ROOT_FOLDER_ID = '1708f9PjDgjOUC6pEdyirmRdPhQCtd_uz';

function stripOuterQuotes(raw?: string | null): string {
  let clean = String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  while (
    clean.length >= 2 &&
    ((clean.startsWith('"') && clean.endsWith('"')) ||
      (clean.startsWith("'") && clean.endsWith("'")))
  ) {
    clean = clean.slice(1, -1).trim();
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

function extractServiceAccountJson(raw: string): {
  clientEmail?: string;
  privateKey?: string;
  privateKeyId?: string;
} | null {
  const clean = stripOuterQuotes(raw)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  if (!clean.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(clean) as {
      client_email?: unknown;
      private_key?: unknown;
      private_key_id?: unknown;
    };
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      clientEmail: typeof parsed.client_email === 'string' ? stripOuterQuotes(parsed.client_email) : undefined,
      privateKey: typeof parsed.private_key === 'string' ? parsed.private_key : undefined,
      privateKeyId:
        typeof parsed.private_key_id === 'string' ? stripOuterQuotes(parsed.private_key_id) : undefined,
    };
  } catch {
    return null;
  }
}

function normalizePrivateKeyPem(raw: string): string {
  let clean = stripOuterQuotes(raw)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  if (!clean) return '';

  const parsedJson = extractServiceAccountJson(clean);
  if (parsedJson?.privateKey && parsedJson.privateKey.trim()) {
    clean = stripOuterQuotes(parsedJson.privateKey);
  }

  if ((clean.startsWith('"') && clean.endsWith('"')) || clean.includes('\\"')) {
    try {
      const unwrapped = JSON.parse(clean.startsWith('"') ? clean : `"${clean}"`);
      if (typeof unwrapped === 'string' && unwrapped.trim()) {
        clean = stripOuterQuotes(unwrapped);
      }
    } catch {
      clean = clean.replace(/^\\["']|\\["']$/g, '');
    }
  }

  clean = clean
    .replace(/\\+r\\+n/g, '\n')
    .replace(/\\+n/g, '\n')
    .replace(/\\+r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  clean = stripOuterQuotes(clean).replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '');

  const pkcs8Match = clean.match(
    /-----\s*BEGIN\s+PRIVATE\s+KEY\s*-----([\s\S]*?)-----\s*END\s+PRIVATE\s+KEY\s*-----/i
  );
  if (pkcs8Match) {
    const cleanBody = pkcs8Match[1]
      .replace(/\\+[rn]/gi, '')
      .replace(/[\s\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]+/g, '');
    const wrappedBody = cleanBody.match(/.{1,64}/g)?.join('\n') || cleanBody;
    return `-----BEGIN PRIVATE KEY-----\n${wrappedBody}\n-----END PRIVATE KEY-----`;
  }

  const pkcs1Match = clean.match(
    /-----\s*BEGIN\s+RSA\s+PRIVATE\s+KEY\s*-----([\s\S]*?)-----\s*END\s+RSA\s+PRIVATE\s+KEY\s*-----/i
  );
  if (pkcs1Match) {
    const cleanBody = pkcs1Match[1]
      .replace(/\\+[rn]/gi, '')
      .replace(/[\s\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]+/g, '');
    const wrappedBody = cleanBody.match(/.{1,64}/g)?.join('\n') || cleanBody;
    return `-----BEGIN RSA PRIVATE KEY-----\n${wrappedBody}\n-----END RSA PRIVATE KEY-----`;
  }

  return clean
    .replace(/(-----BEGIN [A-Z0-9 ]+-----)\s*/g, '$1\n')
    .replace(/\s*(-----END [A-Z0-9 ]+-----)/g, '\n$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function pemToDerBuffer(pem: string): Buffer {
  const match = pem.match(
    /-----BEGIN (?:RSA )?PRIVATE KEY-----([\s\S]*?)-----END (?:RSA )?PRIVATE KEY-----/
  );
  const rawBody = match ? match[1] : pem;
  const cleaned = rawBody
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, '')
    .replace(/\\+[rn]/gi, '')
    .replace(/[\s\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]+/g, '');
  if (!cleaned) {
    throw new Error('Body base64 di dalam blok PRIVATE KEY kosong.');
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new Error('Body PEM mengandung karakter non-base64.');
  }
  return Buffer.from(cleaned, 'base64');
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

  const jsonEnv = readFirstSecretEnv([
    'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
  ]);
  const emailEnv = readFirstSecretEnv(['GOOGLE_DRIVE_CLIENT_EMAIL', 'GOOGLE_CLIENT_EMAIL']);
  const keyEnv = readFirstSecretEnv([
    'GOOGLE_DRIVE_PRIVATE_KEY',
    'GOOGLE_PRIVATE_KEY',
    'GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_SERVICE_ACCOUNT_JSON',
  ]);
  const keyIdEnv = readFirstSecretEnv(['GOOGLE_DRIVE_PRIVATE_KEY_ID', 'GOOGLE_PRIVATE_KEY_ID']);

  const hasAnyOAuthEnv = Boolean(
    oauthClientIdEnv.value || oauthClientSecretEnv.value || oauthRefreshTokenEnv.value
  );
  const hasLegacySaKey = Boolean(keyEnv.value || jsonEnv.value);

  if (hasAnyOAuthEnv || !hasLegacySaKey) {
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

  const embeddedJson =
    (jsonEnv.value ? extractServiceAccountJson(jsonEnv.value) : null) ||
    (keyEnv.value ? extractServiceAccountJson(keyEnv.value) : null);
  const clientEmail = (emailEnv.value || embeddedJson?.clientEmail || DEFAULT_DRIVE_CLIENT_EMAIL).trim();
  const privateKey = keyEnv.value ? normalizePrivateKeyPem(keyEnv.value) : '';
  const privateKeyId = (keyIdEnv.value || embeddedJson?.privateKeyId || '').trim();
  const rootFolderId = (folderEnv.value || DEFAULT_DRIVE_ROOT_FOLDER_ID).trim();

  const emailField = emailEnv.sourceName || 'GOOGLE_DRIVE_CLIENT_EMAIL';
  const keyField = keyEnv.sourceName || 'GOOGLE_DRIVE_PRIVATE_KEY';
  const folderField = folderEnv.sourceName || 'GOOGLE_DRIVE_FOLDER_ID';

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const fieldReasons: Record<string, string> = {};

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    invalidFields.push(emailField);
    fieldReasons[emailField] = 'Format email service account tidak valid.';
  }

  if (!privateKey) {
    missingFields.push('GOOGLE_DRIVE_PRIVATE_KEY', 'GOOGLE_PRIVATE_KEY');
    fieldReasons.GOOGLE_DRIVE_PRIVATE_KEY = 'Secret kosong (fallback GOOGLE_PRIVATE_KEY juga kosong).';
  } else if (
    (!privateKey.includes('-----BEGIN PRIVATE KEY-----') ||
      !privateKey.includes('-----END PRIVATE KEY-----')) &&
    (!privateKey.includes('-----BEGIN RSA PRIVATE KEY-----') ||
      !privateKey.includes('-----END RSA PRIVATE KEY-----'))
  ) {
    invalidFields.push(keyField);
    fieldReasons[keyField] =
      'Harus berisi blok utuh -----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY----- (format PKCS#8).';
  } else {
    try {
      const der = pemToDerBuffer(privateKey);
      if (der.byteLength < 64) {
        invalidFields.push(keyField);
        fieldReasons[keyField] = `Panjang byte kunci privat terlalu pendek (${der.byteLength} byte, minimal 64 byte).`;
      }
    } catch (decodeErr) {
      invalidFields.push(keyField);
      fieldReasons[keyField] = `Decode base64 kunci privat gagal (${
        decodeErr instanceof Error ? decodeErr.message : 'invalid base64'
      }).`;
    }
  }

  if (isUrlLikeValue(rootFolderId) || !/^[a-zA-Z0-9_-]{8,150}$/.test(rootFolderId)) {
    invalidFields.push(folderField);
    fieldReasons[folderField] = isUrlLikeValue(rootFolderId)
      ? `Nilai ${folderField} masih berupa URL lengkap (https://...); salin hanya ID folder Google Drive.`
      : 'Harus berupa ID folder Google Drive yang valid (bukan URL/teks bebas).';
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    throw buildCredentialError({
      scope: 'Google Drive',
      missingFields,
      invalidFields,
      fieldReasons,
    });
  }

  return {
    mode: 'service_account',
    clientEmail,
    privateKey,
    rootFolderId,
    privateKeyId: privateKeyId || undefined,
    clientEmailField: emailField,
    privateKeyField: keyField,
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
  blok_rumah?: string | null;
  nama_warga?: string | null;
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

    const matchIds = new Set<string>([`admin:${reqUsername}`]);
    if (reqUsername === 'andriansyah') {
      matchIds.add('admin:admin');
      matchIds.add('admin:bendahara');
    }
    if (reqUsername === 'bpiwan') matchIds.add('admin:paiwan');

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
    if (!canonBlok) {
      throw Object.assign(new Error('Blok rumah Warga tidak valid.'), { statusCode: 401 });
    }

    const { rows, errorText } = await fetchUsersWargaRows();
    const matchingRows = rows.filter(
      (row) => canonicalBlockKey(String(row.blok_rumah || '')) === canonBlok
    );
    const activeWargaRow = matchingRows.find(
      (row) => row.aktif !== false && !isPengurusRowRole(row)
    );
    const inactiveWargaRow = matchingRows.find(
      (row) => row.aktif === false && !isPengurusRowRole(row)
    );
    const activePengurusRow = matchingRows.find(
      (row) => row.aktif !== false && isPengurusRowRole(row)
    );

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
          const canonLower = canonBlok.toLowerCase();
          const dirMatch = dirRes.data.find((entry) => {
            const entryRole = normalizeToken(String(entry.role || ''));
            if (entryRole && entryRole !== 'warga') return false;
            const entryBlok = canonicalBlockKey(String(entry.blok_rumah || ''));
            const entryPid = normalizeParticipantId(String(entry.participant_id || ''));
            return entryBlok === canonBlok || entryPid === `warga:${canonLower}`;
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
            `Akun Warga Blok "${canonBlok}" berstatus nonaktif di users_warga (aktif = false).`
          ),
          { statusCode: 403 }
        );
      }
      if (activePengurusRow) {
        throw Object.assign(
          new Error(
            `Akun Blok "${canonBlok}" terdaftar sebagai Pengurus aktif (${String(
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
          `Akun Warga Blok "${canonBlok}" tidak ditemukan aktif di users_warga maupun direktori chat (baris users_warga=${rows.length}).`
        ),
        { statusCode: 403 }
      );
    }

    const canonLower = canonBlok.toLowerCase();
    const rawLower = normalizeToken(rawWargaBlockCandidate);
    const matchIds = new Set<string>([`warga:${canonLower}`]);
    if (rawLower) matchIds.add(`warga:${rawLower}`);

    return {
      role: 'warga',
      senderId: `warga:${canonLower}`,
      slug: canonLower.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(verifiedDisplayName || hint?.namaWarga || `Warga ${canonBlok}`).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'petugas' || effectiveRole === 'keamanan') {
    const lookupToken = normalizeToken(rawPetugasId || rawBlok);
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
    const matchIds = new Set<string>([`petugas:${petIdLower}`, `keamanan:${petIdLower}`]);
    if (rawBlok) {
      matchIds.add(`petugas:${normalizeToken(rawBlok)}`);
      matchIds.add(`keamanan:${normalizeToken(rawBlok)}`);
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

async function fetchGoogleServiceAccountJwks(
  clientEmail: string
): Promise<Array<{ kid?: string; n?: string; e?: string }> | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(
        `https://www.googleapis.com/service_accounts/v1/jwk/${encodeURIComponent(clientEmail)}`,
        { signal: controller.signal }
      );
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as {
        keys?: Array<{ kid?: string; n?: string; e?: string }>;
      } | null;
      return Array.isArray(json?.keys) ? json.keys : null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

async function exchangeOAuth2RefreshToken(
  cfg: Extract<DriveAuthConfig, { mode: 'oauth2' }>
): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
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
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }
  return json.access_token;
}

async function getDriveServiceAccountToken(cfg: DriveAuthConfig): Promise<string> {
  if (cfg.mode === 'oauth2') {
    return exchangeOAuth2RefreshToken(cfg);
  }

  const keyField = cfg.privateKeyField || 'GOOGLE_DRIVE_PRIVATE_KEY';
  const emailField = cfg.clientEmailField || 'GOOGLE_DRIVE_CLIENT_EMAIL';

  let keyFp = 'unknown';
  let privateKeyObj: crypto.KeyObject;
  let privateKeyModulus = '';
  try {
    const der = pemToDerBuffer(cfg.privateKey);
    keyFp = crypto.createHash('sha256').update(der).digest('hex').slice(0, 12);
    privateKeyObj = crypto.createPrivateKey(cfg.privateKey);
    try {
      const exported = privateKeyObj.export({ format: 'jwk' }) as { n?: string };
      privateKeyModulus = String(exported?.n || '').trim();
    } catch {
      privateKeyModulus = '';
    }
  } catch (keyErr) {
    const cleanDetail = (keyErr instanceof Error ? keyErr.message : String(keyErr || 'invalid key'))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    throw buildCredentialError({
      scope: 'Google Drive',
      missingFields: [],
      invalidFields: [keyField],
      fieldReasons: {
        [keyField]: `Gagal memproses kunci privat PEM (${cleanDetail}). Pastikan secret berisi private_key PKCS#8 utuh untuk ${cfg.clientEmail}.`,
      },
    });
  }

  let resolvedKid =
    cfg.privateKeyId && /^[a-zA-Z0-9._-]{4,128}$/.test(cfg.privateKeyId)
      ? cfg.privateKeyId
      : '';
  let activeKidsOnGcp: string[] = [];

  if (privateKeyModulus) {
    const gcpJwks = await fetchGoogleServiceAccountJwks(cfg.clientEmail);
    if (gcpJwks && gcpJwks.length > 0) {
      activeKidsOnGcp = gcpJwks
        .map((k) => String(k.kid || '').trim())
        .filter(Boolean);
      const matchedJwk = gcpJwks.find((k) => k.n && k.n === privateKeyModulus);
      if (matchedJwk?.kid) {
        resolvedKid = matchedJwk.kid;
      } else {
        const kidListLabel = activeKidsOnGcp
          .map((id) => `${id.slice(0, 12)}...`)
          .join(', ');
        throw buildCredentialError({
          scope: 'Google Drive OAuth2',
          missingFields: [],
          invalidFields: [emailField, keyField],
          fieldReasons: {
            [emailField]: `Service Account ${cfg.clientEmail} memiliki ${activeKidsOnGcp.length} kunci aktif di Google Cloud IAM (${kidListLabel || 'tidak ada'}).`,
            [keyField]: `Kunci privat di secret [fp=${keyFp}, mod=${privateKeyModulus.slice(0, 10)}...] TIDAK COCOK dengan kunci aktif mana pun milik ${cfg.clientEmail} di Google Cloud IAM (Key ID aktif: ${kidListLabel || 'kosong'}).`,
          },
        });
      }
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const jwtHeaderPayload: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (resolvedKid) {
    jwtHeaderPayload.kid = resolvedKid;
  }
  const header = base64UrlEncode(JSON.stringify(jwtHeaderPayload));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec - 30,
      exp: nowSec + 3570,
    })
  );
  const signingInput = `${header}.${claimSet}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyObj);
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const errText = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 180);
    const isSigErr = /invalid jwt signature/i.test(errText);
    const activeInfo = activeKidsOnGcp.length
      ? ` Key ID aktif di IAM: ${activeKidsOnGcp.map((id) => `${id.slice(0, 12)}...`).join(', ')}.`
      : '';
    const hintSuffix = isSigErr
      ? ` Pastikan ${keyField} berasal dari JSON key AKTIF milik ${cfg.clientEmail} [fp=${keyFp}].${activeInfo}`
      : ` [iss=${cfg.clientEmail}, fp=${keyFp}].`;
    throw buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields: [emailField, keyField],
      fieldReasons: {
        [emailField]: `Service Account (iss): ${cfg.clientEmail} ditolak Google OAuth2 (${res.status}).`,
        [keyField]: `Ditolak Google OAuth2 (${res.status}): ${errText || 'invalid_grant'}.${hintSuffix}`,
      },
    });
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }
  return json.access_token;
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
    if (driveCfg?.mode === 'service_account') {
      return buildCredentialError({
        scope: 'Google Drive',
        missingFields: [
          'GOOGLE_OAUTH_CLIENT_ID',
          'GOOGLE_OAUTH_CLIENT_SECRET',
          'GOOGLE_OAUTH_REFRESH_TOKEN',
        ],
        invalidFields: [driveCfg.clientEmailField || 'GOOGLE_DRIVE_CLIENT_EMAIL'],
        fieldReasons: {
          [driveCfg.clientEmailField || 'GOOGLE_DRIVE_CLIENT_EMAIL']:
            `Service Account (${driveCfg.clientEmail}) ditolak Google Drive (${errInfo.status} / storageQuotaExceeded): akun robot tidak punya kuota pada Google Drive pribadi (@gmail.com). Gunakan kredensial OAuth 2.0 pemilik folder (${errInfo.message}).`,
        },
      });
    }
    return Object.assign(
      new Error(`${context} (${errInfo.status}${reasonTag}): Kuota penyimpanan Google Drive penuh — ${errInfo.message}`),
      { statusCode: 502 }
    );
  }

  if (errInfo.status === 404 || errInfo.reason === 'notFound') {
    return buildCredentialError({
      scope: 'Google Drive',
      missingFields: [],
      invalidFields: [folderField],
      fieldReasons: {
        [folderField]: `Folder Google Drive (${driveCfg?.rootFolderId || '-'}) tidak ditemukan atau tidak dapat diakses oleh akun Google yang terautentikasi (${errInfo.status} / notFound: ${errInfo.message}).`,
      },
    });
  }

  if (errInfo.status === 401 || errInfo.reason === 'authError' || errInfo.reason === 'invalidCredentials') {
    const authField =
      driveCfg?.mode === 'oauth2'
        ? driveCfg.refreshTokenField
        : driveCfg?.privateKeyField || 'GOOGLE_DRIVE_PRIVATE_KEY';
    return buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields: [authField],
      fieldReasons: {
        [authField]: `Token akses Google Drive ditolak (${errInfo.status}${reasonTag}): ${errInfo.message}.`,
      },
    });
  }

  if (
    errInfo.status === 403 &&
    (errInfo.reason === 'insufficientFilePermissions' || errInfo.reason === 'insufficientPermissions')
  ) {
    return buildCredentialError({
      scope: 'Google Drive',
      missingFields: [],
      invalidFields: [folderField],
      fieldReasons: {
        [folderField]: `Akun Google tidak memiliki izin menulis ke folder ${folderField} (${errInfo.status} / ${errInfo.reason}): ${errInfo.message}.`,
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
  const safeName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeParent = parentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
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
  const categoryFolder = resolveDriveCategoryFolder(roomId);
  const monthFolder = getJakartaYearMonth(isoDate);
  const categoryFolderId = await ensureDriveSubfolder(
    accessToken,
    categoryFolder,
    rootFolderId,
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

async function isDriveFileInsideRootCategory(
  accessToken: string,
  rootFolderId: string,
  fileParents: string[] | undefined,
  roomId: string
): Promise<boolean> {
  if (!Array.isArray(fileParents) || fileParents.length === 0) return false;
  const expectedCategory = resolveDriveCategoryFolder(roomId);
  const monthFolderId = fileParents[0];
  const monthRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      monthFolderId
    )}?supportsAllDrives=true&fields=parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!monthRes.ok) return false;
  const monthJson = (await monthRes.json().catch(() => ({}))) as { parents?: string[] };
  const catId = monthJson.parents?.[0];
  if (!catId) return false;

  const catRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      catId
    )}?supportsAllDrives=true&fields=name,parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!catRes.ok) return false;
  const catJson = (await catRes.json().catch(() => ({}))) as { name?: string; parents?: string[] };
  return (
    catJson.name === expectedCategory &&
    Array.isArray(catJson.parents) &&
    catJson.parents.includes(rootFolderId)
  );
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
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, Content-Disposition, Content-Type');

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method tidak diizinkan.' });
    return;
  }

  let bodyObj: Record<string, unknown> = {};
  if (method === 'POST') {
    if (typeof req.body === 'string') {
      try {
        bodyObj = JSON.parse(req.body) as Record<string, unknown>;
      } catch {
        res.status(400).json({ ok: false, error: 'Body JSON tidak valid.' });
        return;
      }
    } else if (req.body && typeof req.body === 'object') {
      bodyObj = req.body as Record<string, unknown>;
    }
  }

  const action = String(bodyObj.action || readNodeQuery(req.query, 'action') || '')
    .trim()
    .toLowerCase();
  let fileId = String(
    bodyObj.fileId || bodyObj.driveFileId || readNodeQuery(req.query, 'fileId') || ''
  ).trim();
  let rawRoomId = String(bodyObj.roomId || readNodeQuery(req.query, 'roomId') || '').trim();
  const messageId = String(bodyObj.messageId || readNodeQuery(req.query, 'messageId') || '').trim();
  const modeRaw = String(bodyObj.mode || readNodeQuery(req.query, 'mode') || 'stream')
    .trim()
    .toLowerCase();
  const mode: 'stream' | 'download' | 'thumbnail' =
    modeRaw === 'download' ? 'download' : modeRaw === 'thumbnail' ? 'thumbnail' : 'stream';

  let callerHeaders: CallerVerificationInput = {
    role: readNodeHeader(req.headers, 'x-user-role'),
    blokRumah: readNodeHeader(req.headers, 'x-blok-rumah'),
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
    const ro = readNodeQuery(req.query, 'ro');
    const b = readNodeQuery(req.query, 'b');
    const p = readNodeQuery(req.query, 'p');
    const sigValid = verifyPrivateStreamToken(
      { fileId, roomId: rawRoomId, role: ro, blokRumah: b, petugasId: p, exp: expParam },
      sig
    );
    if (!sigValid) {
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason: 'Tanda tangan akses stream privat tidak valid atau kedaluwarsa.',
      });
      res.status(403).json({
        ok: false,
        error: 'Akses ditolak: token aliran media privat tidak valid atau telah kedaluwarsa.',
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
    let caller: VerifiedChatCaller;
    try {
      caller = await verifyChatCallerFromHeaders(callerHeaders);
    } catch (authErr) {
      const msg = authErr instanceof Error ? authErr.message : 'Identitas tidak valid.';
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason: msg,
      });
      res.status(403).json({ ok: false, error: msg });
      return;
    }

    interface PrivateMessageLookupRow {
      id: string;
      room_id: string;
      sender_id: string;
      recipient_id?: string | null;
      attachment_drive_file_id?: string | null;
    }
    let dbMessageRow: PrivateMessageLookupRow | null = null;

    if (messageId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
        res.status(400).json({ ok: false, error: 'Format messageId tidak valid.' });
        return;
      }
      const msgRes = await supabaseRestJson<PrivateMessageLookupRow[]>(
        `/rest/v1/community_chat_messages?id=eq.${encodeURIComponent(
          messageId
        )}&select=id,room_id,sender_id,recipient_id,attachment_drive_file_id&limit=1`
      );
      const row = msgRes.data?.[0];
      if (!row) {
        await recordUnauthorizedDriveAccessAudit({
          headers: callerHeaders,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason: 'Pesan lampiran privat tidak ditemukan.',
        });
        res.status(403).json({ ok: false, error: 'Akses lampiran privat ditolak.' });
        return;
      }
      dbMessageRow = row;
    } else if (fileId && /^[a-zA-Z0-9_-]{10,120}$/.test(fileId)) {
      const msgRes = await supabaseRestJson<PrivateMessageLookupRow[]>(
        `/rest/v1/community_chat_messages?attachment_drive_file_id=eq.${encodeURIComponent(
          fileId
        )}&select=id,room_id,sender_id,recipient_id,attachment_drive_file_id&limit=1`
      );
      if (msgRes.data?.[0]) {
        dbMessageRow = msgRes.data[0];
      }
    }

    if (dbMessageRow) {
      if (!fileId && dbMessageRow.attachment_drive_file_id) {
        fileId = String(dbMessageRow.attachment_drive_file_id).trim();
      }
      if (
        fileId &&
        dbMessageRow.attachment_drive_file_id &&
        dbMessageRow.attachment_drive_file_id !== fileId
      ) {
        await recordUnauthorizedDriveAccessAudit({
          headers: callerHeaders,
          roomId: dbMessageRow.room_id,
          fileId,
          messageId,
          reason: 'driveFileId tidak cocok dengan record pesan.',
        });
        res.status(403).json({
          ok: false,
          error: 'Berkas Google Drive tidak cocok dengan pesan terkait.',
        });
        return;
      }
      const dbRoom = normalizeChatRoomId(String(dbMessageRow.room_id || ''));
      if (rawRoomId && normalizeChatRoomId(rawRoomId) !== dbRoom) {
        await recordUnauthorizedDriveAccessAudit({
          headers: callerHeaders,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason: 'roomId tidak cocok dengan ruang asal pesan.',
        });
        res.status(403).json({
          ok: false,
          error: 'Ruang chat lampiran tidak cocok.',
        });
        return;
      }
      rawRoomId = dbRoom;
    }

    const roomId = normalizeChatRoomId(rawRoomId);
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId) || !roomId) {
      await recordUnauthorizedDriveAccessAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason: 'Parameter fileId atau roomId tidak valid.',
      });
      res.status(403).json({
        ok: false,
        error: 'Parameter akses berkas privat tidak valid.',
      });
      return;
    }

    let authorized = canCallerAccessRoom(caller, roomId);
    let denyReason = 'Bukan anggota ruang chat terkait.';

    if (roomId === 'grup_pengurus') {
      if (caller.role !== 'admin') {
        authorized = false;
        denyReason = 'Berkas Grup Pengurus khusus untuk Pengurus aktif.';
      }
    } else if (roomId.startsWith('dm:')) {
      if (!authorized) {
        denyReason = 'Peminta bukan pengirim maupun penerima sah pada percakapan DM ini.';
      } else if (dbMessageRow) {
        const senderNorm = normalizeParticipantId(String(dbMessageRow.sender_id || ''));
        const recNorm = dbMessageRow.recipient_id
          ? normalizeParticipantId(String(dbMessageRow.recipient_id))
          : '';
        const isSenderOrRecipient =
          caller.matchIds.has(senderNorm) || (recNorm ? caller.matchIds.has(recNorm) : false);
        if (!isSenderOrRecipient && !canCallerAccessRoom(caller, roomId)) {
          authorized = false;
          denyReason = 'Peminta bukan pengirim maupun penerima pesan DM.';
        }
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
      res.status(403).json({ ok: false, error: `Akses ditolak: ${denyReason}` });
      return;
    }

    const driveCfg = getDriveConfig();
    const accessToken = await getDriveServiceAccountToken(driveCfg);

    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,thumbnailLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      const metaErr = await parseGoogleDriveApiError(metaRes);
      if (metaRes.status === 404) {
        res.status(404).json({ ok: false, error: 'Berkas tidak ditemukan di Google Drive.' });
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
      res.status(404).json({ ok: false, error: 'Berkas telah dihapus dari Google Drive.' });
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
        await recordUnauthorizedDriveAccessAudit({
          headers: callerHeaders,
          roomId,
          fileId,
          messageId,
          reason: 'Berkas Drive di luar struktur arsip ruang chat yang diminta.',
        });
        res.status(403).json({
          ok: false,
          error: 'Berkas tidak terdaftar pada folder ruang chat ini.',
        });
        return;
      }
    }

    if (method === 'POST' && action === 'mint_stream_url') {
      const exp = Date.now() + STREAM_URL_TTL_MS;
      const signedSig = signPrivateStreamToken({
        fileId,
        roomId,
        role: callerHeaders.role.trim(),
        blokRumah: callerHeaders.blokRumah.trim(),
        petugasId: callerHeaders.petugasId.trim(),
        exp,
      });
      const streamParams = new URLSearchParams({
        fileId,
        roomId,
        ro: callerHeaders.role.trim(),
        b: callerHeaders.blokRumah.trim(),
        p: callerHeaders.petugasId.trim(),
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
      const thumbRes = await fetch(fileMeta.thumbnailLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (thumbRes.ok) {
        res.setHeader('Content-Type', thumbRes.headers.get('content-type') || 'image/jpeg');
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
    }

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
      }
    );

    if (!mediaRes.ok && mediaRes.status !== 206) {
      if (mediaRes.status === 416) {
        res.status(416).json({ ok: false, error: 'Rentang byte berkas Google Drive tidak valid (416).' });
        return;
      }
      const mediaErr = await parseGoogleDriveApiError(mediaRes);
      throw buildDriveApiFailureError('Gagal mengalirkan berkas dari Google Drive', mediaErr, driveCfg);
    }

    const safeFileName = sanitizeFileName(fileMeta.name || `lampiran-${fileId}`, 'bin');
    res.setHeader(
      'Content-Type',
      fileMeta.mimeType || mediaRes.headers.get('content-type') || 'application/octet-stream'
    );
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `${mode === 'download' ? 'attachment' : 'inline'}; filename="${safeFileName}"`
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
    const missingFields = Array.isArray(typedErr?.missingFields) ? typedErr.missingFields : undefined;
    const invalidFields = Array.isArray(typedErr?.invalidFields) ? typedErr.invalidFields : undefined;
    const fieldReasons =
      typedErr?.fieldReasons && typeof typedErr.fieldReasons === 'object'
        ? typedErr.fieldReasons
        : undefined;
    res.status(statusCode).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal mengakses berkas privat Google Drive.',
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
    });
  }
}
