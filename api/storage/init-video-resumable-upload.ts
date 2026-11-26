// Vercel Serverless Function: POST /api/storage/init-video-resumable-upload
// Self-contained (kompatibel penuh dengan Node ESM di Vercel).
import crypto from 'crypto';

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

interface VerifiedCaller {
  role: 'admin' | 'warga' | 'petugas';
  senderId: string;
  displayName: string;
  matchIds: Set<string>;
}

const VIDEO_EXT_RE = /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i;
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
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
}

function isAllowedCorsOrigin(origin: string): boolean {
  const clean = origin.trim();
  if (!clean) return false;
  const configuredPublicUrl = stripOuterQuotes(
    process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://e-card-ipl.vercel.app'
  ).replace(/\/+$/, '');
  if (configuredPublicUrl && clean === configuredPublicUrl) return true;
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === 'https:' &&
      (host === 'e-card-ipl.vercel.app' ||
        host.endsWith('.vercel.app') ||
        host.endsWith('.run.app') ||
        host.endsWith('.stackblitz.io') ||
        host.endsWith('.webcontainer.io'))
    ) {
      return true;
    }
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (host === 'localhost' || host === '127.0.0.1')
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function applyCorsAndNoStoreHeaders(req: VercelReq, res: VercelRes): void {
  const reqOrigin = getHeader(req.headers, 'origin').trim();
  const configuredPublicUrl =
    stripOuterQuotes(process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://e-card-ipl.vercel.app').replace(
      /\/+$/,
      ''
    ) || 'https://e-card-ipl.vercel.app';
  const allowOrigin = isAllowedCorsOrigin(reqOrigin) ? reqOrigin : configuredPublicUrl;
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, authorization, apikey, x-client-info, x-user-role, x-blok-rumah, x-petugas-id, x-admin-jabatan, x-admin-permission, range, cache-control, pragma'
  );
  res.setHeader('Access-Control-Max-Age', '3600');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function normalizeToken(raw?: string | null): string {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
}

function canonicalBlockKey(raw?: string | null): string {
  const clean = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/^BLOK\s*/i, '')
    .replace(/\s+/g, '');
  if (!clean) return '';
  const m = clean.match(/^([A-Z]+)0*(\d+)[\/-]0*(\d+)$/);
  return m ? `${m[1]}${Number(m[2])}/${Number(m[3])}` : clean;
}

function canonicalAdminUsername(raw?: string | null): string {
  const clean = normalizeToken(raw);
  if (clean === 'admin' || clean === 'andriansyah' || clean === 'bendahara') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan' || clean === 'iwan' || clean === 'pembina') return 'bpiwan';
  if (clean === 'ketua') return 'erlangga';
  if (clean === 'deni') return 'deny';
  return clean;
}

interface SenderCallerHint {
  role?: string;
  senderId?: string;
  blokRumah?: string;
  pengurusUsername?: string;
  namaWarga?: string;
  jabatan?: string;
  adminPermission?: string;
  petugasId?: string;
}

const KNOWN_PENGURUS_DIRECTORY = [
  { username: 'bpiwan', nama: 'Bp. Iwan', jabatan: 'Pembina', linkedBlock: 'B8/5' },
  { username: 'erlangga', nama: 'Erlangga', jabatan: 'Ketua', linkedBlock: 'B3/7' },
  { username: 'andriansyah', nama: 'Andriansyah', jabatan: 'Bendahara', linkedBlock: 'B7/16' },
  { username: 'doni', nama: 'Doni', jabatan: 'Humas', linkedBlock: 'B5/21' },
  { username: 'wahyu', nama: 'Wahyu', jabatan: 'Humas', linkedBlock: 'B5/24' },
  { username: 'deny', nama: 'Deny', jabatan: 'Seksi Olahraga', linkedBlock: 'B8/6' },
] as const;

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
    const canonBlock = canonicalBlockKey(clean);
    const byBlock = KNOWN_PENGURUS_DIRECTORY.find((p) => canonicalBlockKey(p.linkedBlock) === canonBlock);
    if (byBlock) return byBlock.username;
    const canon = canonicalAdminUsername(clean);
    if (canon) return canon;
  }
  const jab = normalizeToken(rawJabatan || hint?.jabatan);
  if (jab === 'bendahara') return 'andriansyah';
  if (jab === 'pembina') return 'bpiwan';
  if (jab === 'ketua') return 'erlangga';
  if (jab === 'seksiolahraga') return 'deny';
  return '';
}

function parseRpcBoolean(val: unknown): boolean | null {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const clean = val.trim().toLowerCase();
    if (clean === 'true' || clean === '1' || clean === 't' || clean === 'active' || clean === 'aktif') return true;
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

function normalizeParticipantId(rawId: string): string {
  const clean = normalizeToken(rawId);
  if (clean.startsWith('admin:')) return `admin:${canonicalAdminUsername(clean.slice(6))}`;
  if (clean.startsWith('warga:')) {
    const sub = clean.slice(6);
    return `warga:${canonicalBlockKey(sub).toLowerCase() || sub}`;
  }
  if (clean.startsWith('keamanan:')) return `petugas:${clean.slice(9)}`;
  return clean;
}

function normalizeRoomId(rawRoomId: string): string {
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

function canCallerAccessRoom(caller: VerifiedCaller, roomId: string): boolean {
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
    return (
      caller.matchIds.has(normalizeParticipantId(body.slice(0, idx))) ||
      caller.matchIds.has(normalizeParticipantId(body.slice(idx + 2)))
    );
  }
  return false;
}

function isVideoMedia(mimeType?: string | null, fileName?: string | null): boolean {
  const m = String(mimeType || '').trim().toLowerCase();
  const n = String(fileName || '').trim().toLowerCase();
  return m.startsWith('video/') || VIDEO_MIME_SET.has(m) || VIDEO_EXT_RE.test(n);
}

function sanitizeFileName(rawName?: string | null): string {
  const last = String(rawName || '').split(/[\\/]/).pop() || '';
  const safe = last.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || `video-${Date.now()}.mp4`).slice(0, 140);
}

function getJakartaYearMonth(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')?.value || String(now.getUTCFullYear());
  const m = parts.find((p) => p.type === 'month')?.value || String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function resolveDriveCategoryFolder(roomId: string): string {
  if (roomId === 'grup_pengurus') return 'Grup-Pengurus';
  if (roomId === 'pengurus_warga') return 'Grup-Pengurus-Warga';
  if (roomId === 'pengurus_keamanan') return 'Grup-Pengurus-Keamanan';
  if (roomId === 'warga_keamanan') return 'Grup-Warga-Keamanan';
  if (roomId === 'forum_umum') return 'Forum-Lingkungan';
  if (roomId.startsWith('dm:')) return 'DM-Personal';
  return 'Chat-Lainnya';
}

interface CredentialValidationError extends Error {
  statusCode?: number;
  missingFields?: string[];
  invalidFields?: string[];
  fieldReasons?: Record<string, string>;
}

type DriveAuthConfig =
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

const DEFAULT_DRIVE_CLIENT_EMAIL = 'saung-kebun-drive@saung-kebun-87b23.iam.gserviceaccount.com';
const DEFAULT_DRIVE_ROOT_FOLDER_ID = '1708f9PjDgjOUC6pEdyirmRdPhQCtd_uz';

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
    if (cleaned) return { value: cleaned, sourceName: name };
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
  if (!cleaned) throw new Error('Body base64 di dalam blok PRIVATE KEY kosong.');
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) throw new Error('Body PEM mengandung karakter non-base64.');
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
  if (params.missingFields.length > 0) details.push(`field kosong: [${params.missingFields.join(', ')}]`);
  if (params.invalidFields.length > 0) {
    const invalidDesc = params.invalidFields.map((field) => {
      const reason = params.fieldReasons?.[field];
      return reason ? `${field} (${reason})` : field;
    });
    details.push(`field tidak valid: [${invalidDesc.join(', ')}]`);
  }
  const err = new Error(
    `Validasi secrets ${params.scope} gagal di server API — ${details.join('; ')}.`
  ) as CredentialValidationError;
  err.statusCode = params.statusCode ?? 500;
  err.missingFields = [...params.missingFields];
  err.invalidFields = [...params.invalidFields];
  if (params.fieldReasons && Object.keys(params.fieldReasons).length > 0) {
    err.fieldReasons = params.fieldReasons;
  }
  return err;
}

function getSupabaseEnv() {
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
    throw buildCredentialError({ scope: 'Supabase', missingFields, invalidFields, fieldReasons });
  }
  return { url, serviceKey };
}

function getDriveEnv(): DriveAuthConfig {
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
      throw buildCredentialError({ scope: 'Google Drive OAuth2', missingFields, invalidFields, fieldReasons });
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
    throw buildCredentialError({ scope: 'Google Drive', missingFields, invalidFields, fieldReasons });
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

async function sbRest<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const { url, serviceKey } = getSupabaseEnv();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  const txt = await res.text().catch(() => '');
  if (!txt) return { ok: true, status: res.status, data: null };
  try {
    return { ok: true, status: res.status, data: JSON.parse(txt) as T };
  } catch {
    return { ok: true, status: res.status, data: null };
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
  const r = normalizeToken(row.role);
  const b = normalizeToken(row.bot_role);
  return r === 'admin' || r === 'bendahara' || r === 'pengurus' || b === 'admin' || b === 'bendahara' || b === 'pengurus';
}

async function fetchUsersWargaRows(): Promise<{ rows: UsersWargaCallerRow[]; ok: boolean }> {
  for (const selectExpr of [
    'blok_rumah,nama_warga,role,bot_role,jabatan,admin_permission,aktif',
    'blok_rumah,nama_warga,role,jabatan,aktif',
    'blok_rumah,nama_warga,role,aktif',
  ]) {
    const res = await sbRest<UsersWargaCallerRow[]>(`/rest/v1/users_warga?select=${encodeURIComponent(selectExpr)}`);
    if (res.ok && Array.isArray(res.data)) {
      return { rows: res.data, ok: true };
    }
  }
  return { rows: [], ok: false };
}

async function resolveVerifiedAuthUser(authorization: string): Promise<{
  id: string;
  userMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
} | null> {
  const rawAuth = authorization.trim();
  if (!rawAuth.toLowerCase().startsWith('bearer ')) return null;
  const token = rawAuth.slice(7).trim();
  if (!token || token.split('.').length !== 3) return null;
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (anonKey && token === anonKey) return null;
  try {
    const { url, serviceKey } = getSupabaseEnv();
    const res = await fetch(`${url}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: string;
      user_metadata?: Record<string, unknown>;
      app_metadata?: Record<string, unknown>;
    };
    if (!u?.id) return null;
    return { id: u.id, userMetadata: u.user_metadata || {}, appMetadata: u.app_metadata || {} };
  } catch {
    return null;
  }
}

async function verifyCaller(req: VercelReq, callerHint?: SenderCallerHint | null): Promise<VerifiedCaller> {
  const rawRole = normalizeToken(getHeader(req.headers, 'x-user-role') || callerHint?.role);
  const rawBlok = (getHeader(req.headers, 'x-blok-rumah') || callerHint?.blokRumah || '').trim();
  const rawPetId = (getHeader(req.headers, 'x-petugas-id') || callerHint?.petugasId || '').trim();
  const rawJabatan = (getHeader(req.headers, 'x-admin-jabatan') || callerHint?.jabatan || '').trim();
  const rawPermission = (getHeader(req.headers, 'x-admin-permission') || callerHint?.adminPermission || '').trim();

  const verifiedAuthUser = await resolveVerifiedAuthUser(getHeader(req.headers, 'authorization'));
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
    let uname = resolvePengurusUsernameFromHints(rawBlok, rawJabatan, callerHint);
    if (!uname && verifiedAuthUser) {
      uname = resolvePengurusUsernameFromHints(
        String(
          verifiedAuthUser.userMetadata?.pengurus_username ||
            verifiedAuthUser.userMetadata?.username ||
            verifiedAuthUser.userMetadata?.blok_rumah ||
            ''
        ),
        rawJabatan,
        callerHint
      );
    }
    if (!uname) {
      throw Object.assign(
        new Error(
          `Verifikasi Pengurus gagal: identitas Pengurus tidak lengkap (role="${effectiveRole}", blok="${rawBlok || '-'}", jabatan="${rawJabatan || '-'}").`
        ),
        { statusCode: 401 }
      );
    }

    const knownMeta = KNOWN_PENGURUS_DIRECTORY.find((p) => p.username === uname);
    const { rows, ok } = await fetchUsersWargaRows();
    if (!ok) {
      throw new Error('Gagal membaca tabel users_warga saat verifikasi akun Pengurus.');
    }

    const activeAdminRows: UsersWargaCallerRow[] = [];
    const inactiveAdminRows: UsersWargaCallerRow[] = [];
    const linkedBlockRows: UsersWargaCallerRow[] = [];

    for (const row of rows) {
      const rowBlok = String(row.blok_rumah || '').trim();
      const isPengurus = isPengurusRowRole(row);
      const isBendaharaRow =
        uname === 'andriansyah' &&
        (normalizeToken(row.jabatan) === 'bendahara' ||
          normalizeToken(row.admin_permission) === 'full' ||
          normalizeToken(row.role) === 'bendahara');
      if (isPengurus && (canonicalAdminUsername(rowBlok) === uname || isBendaharaRow)) {
        if (row.aktif === false) inactiveAdminRows.push(row);
        else activeAdminRows.push(row);
        continue;
      }
      if (knownMeta && canonicalBlockKey(rowBlok) === canonicalBlockKey(knownMeta.linkedBlock)) {
        linkedBlockRows.push(row);
      }
    }

    let rpcActivePengurus: boolean | null = null;
    let rpcActiveFlagRaw: unknown = undefined;
    let rpcStatusRaw = '';
    let rpcPengurusNama = '';

    for (const payload of [
      { p_identifier: uname, p_login_portal: 'admin' },
      { p_identifier: uname, p_portal: 'admin' },
      { p_identifier: uname, p_portal: 'pengurus' },
      { p_blok: uname, p_portal: 'admin' },
      { p_identifier: uname },
    ]) {
      try {
        const rpcCheck = await sbRest<unknown>('/rest/v1/rpc/validate_login_account_status', {
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
        const pf = parseRpcBoolean(obj.is_active_pengurus);
        const ps = parseRpcBoolean(obj.pengurus_account_status);
        if (pf !== null) rpcActivePengurus = pf;
        else if (ps !== null) rpcActivePengurus = ps;
        if (rpcActivePengurus !== null) break;
      } catch {
        // Coba signature berikutnya
      }
    }

    const activeAdminRow = activeAdminRows[0];
    const inactiveAdminRow = inactiveAdminRows[0];
    const linkedActiveRow = linkedBlockRows.find(
      (r) =>
        r.aktif !== false &&
        (isPengurusRowRole(r) || (knownMeta && normalizeToken(r.jabatan) === normalizeToken(knownMeta.jabatan)))
    );

    if (rpcActivePengurus === false && uname !== 'andriansyah') {
      throw Object.assign(
        new Error(
          `Status Pengurus "${uname}" nonaktif pada validate_login_account_status (is_active_pengurus=${String(
            rpcActiveFlagRaw
          )}, pengurus_account_status=${rpcStatusRaw || 'inactive'}).`
        ),
        { statusCode: 403 }
      );
    }

    if (rpcActivePengurus === false && inactiveAdminRow) {
      throw Object.assign(
        new Error(
          `Status Pengurus "${uname}" nonaktif di users_warga dan validate_login_account_status (aktif=false, pengurus_account_status=${
            rpcStatusRaw || 'inactive'
          }).`
        ),
        { statusCode: 403 }
      );
    }

    const verifiedMatch =
      activeAdminRow ||
      linkedActiveRow ||
      (rpcActivePengurus === true ? { nama_warga: rpcPengurusNama || callerHint?.namaWarga || knownMeta?.nama } : null) ||
      (verifiedAuthUser?.id && !inactiveAdminRow
        ? {
            nama_warga:
              String(verifiedAuthUser.userMetadata?.nama_warga || '') ||
              callerHint?.namaWarga ||
              knownMeta?.nama,
          }
        : null);

    if (!verifiedMatch) {
      if (inactiveAdminRow) {
        throw Object.assign(
          new Error(
            `Akun Pengurus "${String(inactiveAdminRow.blok_rumah || uname)}" (${
              String(inactiveAdminRow.nama_warga || uname)
            }) berstatus nonaktif di users_warga (aktif = false).`
          ),
          { statusCode: 403 }
        );
      }
      throw Object.assign(
        new Error(
          `Verifikasi Pengurus gagal untuk "${rawBlok || uname}" (canonical="${uname}", jabatan="${
            rawJabatan || '-'
          }", permission="${rawPermission || '-'}", authJwt=${
            verifiedAuthUser ? 'valid' : 'none'
          }): tidak ditemukan baris Pengurus aktif pada users_warga maupun status aktif pada validate_login_account_status.`
        ),
        { statusCode: 403 }
      );
    }

    const matchIds = new Set<string>([`admin:${uname}`]);
    if (uname === 'andriansyah') {
      matchIds.add('admin:admin');
      matchIds.add('admin:bendahara');
    }
    if (uname === 'bpiwan') matchIds.add('admin:paiwan');
    return {
      role: 'admin',
      senderId: `admin:${uname}`,
      displayName: String(
        verifiedMatch.nama_warga || rpcPengurusNama || callerHint?.namaWarga || knownMeta?.nama || 'Pengurus'
      ).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'warga') {
    const rawWargaBlock =
      rawBlok ||
      (callerHint?.senderId?.toLowerCase().startsWith('warga:')
        ? callerHint.senderId.slice('warga:'.length)
        : '') ||
      String(verifiedAuthUser?.userMetadata?.blok_rumah || '');
    const canon = canonicalBlockKey(rawWargaBlock);
    if (!canon) throw Object.assign(new Error('Blok rumah Warga tidak valid.'), { statusCode: 401 });

    const { rows, ok } = await fetchUsersWargaRows();
    const matchingRows = rows.filter((r) => canonicalBlockKey(r.blok_rumah) === canon);
    const activeWargaRow = matchingRows.find((r) => r.aktif !== false && !isPengurusRowRole(r));
    const inactiveWargaRow = matchingRows.find((r) => r.aktif === false && !isPengurusRowRole(r));
    const activePengurusRow = matchingRows.find((r) => r.aktif !== false && isPengurusRowRole(r));

    let verifiedDisplayName = activeWargaRow ? String(activeWargaRow.nama_warga || '').trim() : '';
    let verifiedWarga = Boolean(activeWargaRow);

    if (!verifiedWarga && !inactiveWargaRow) {
      try {
        const dirRes = await sbRest<Array<Record<string, unknown>>>('/rest/v1/rpc/get_chat_directory', {
          method: 'POST',
          body: '{}',
        });
        if (dirRes.ok && Array.isArray(dirRes.data)) {
          const lowerCanon = canon.toLowerCase();
          const dirMatch = dirRes.data.find((entry) => {
            const entryRole = normalizeToken(String(entry.role || ''));
            if (entryRole && entryRole !== 'warga') return false;
            const entryBlok = canonicalBlockKey(String(entry.blok_rumah || ''));
            const entryPid = normalizeParticipantId(String(entry.participant_id || ''));
            return entryBlok === canon || entryPid === `warga:${lowerCanon}`;
          });
          if (dirMatch) {
            verifiedWarga = true;
            verifiedDisplayName = String(dirMatch.display_name || '').trim();
          }
        }
      } catch {
        // Lanjutkan ke pengecekan akhir
      }
    }

    if (!verifiedWarga) {
      if (inactiveWargaRow) {
        throw Object.assign(
          new Error(`Akun Warga Blok "${canon}" berstatus nonaktif di users_warga (aktif = false).`),
          { statusCode: 403 }
        );
      }
      if (activePengurusRow) {
        throw Object.assign(
          new Error(
            `Akun Blok "${canon}" terdaftar sebagai Pengurus aktif (${String(
              activePengurusRow.jabatan || activePengurusRow.role || 'Pengurus'
            )}). Gunakan portal Pengurus untuk mengunggah lampiran.`
          ),
          { statusCode: 403 }
        );
      }
      if (!ok) {
        throw new Error('Gagal membaca tabel users_warga saat verifikasi akun Warga.');
      }
      throw Object.assign(
        new Error(
          `Akun Warga Blok "${canon}" tidak ditemukan aktif di users_warga maupun direktori chat (baris users_warga=${rows.length}).`
        ),
        { statusCode: 403 }
      );
    }

    const lower = canon.toLowerCase();
    const matchIds = new Set<string>([`warga:${lower}`]);
    if (normalizeToken(rawWargaBlock)) matchIds.add(`warga:${normalizeToken(rawWargaBlock)}`);
    return {
      role: 'warga',
      senderId: `warga:${lower}`,
      displayName: String(verifiedDisplayName || callerHint?.namaWarga || `Warga ${canon}`).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'petugas' || effectiveRole === 'keamanan') {
    const tok = normalizeToken(rawPetId || rawBlok);
    if (!tok) throw Object.assign(new Error('Identitas Petugas tidak lengkap.'), { statusCode: 401 });
    const res = await sbRest<Array<{ id?: string; nama?: string; username?: string }>>(
      '/rest/v1/petugas_keamanan?aktif=eq.true&select=id,nama,username'
    );
    const matched = (res.data || []).find(
      (r) =>
        normalizeToken(r.id) === tok ||
        normalizeToken(r.username) === tok ||
        normalizeToken(r.nama) === tok
    );
    if (!matched?.id) {
      throw Object.assign(new Error(`Akun Petugas Keamanan "${rawPetId || rawBlok}" tidak aktif atau tidak ditemukan.`), {
        statusCode: 403,
      });
    }
    const pid = normalizeToken(matched.id);
    const matchIds = new Set<string>([`petugas:${pid}`, `keamanan:${pid}`]);
    if (rawBlok) {
      matchIds.add(`petugas:${normalizeToken(rawBlok)}`);
      matchIds.add(`keamanan:${normalizeToken(rawBlok)}`);
    }
    return { role: 'petugas', senderId: `petugas:${pid}`, displayName: String(matched.nama || 'Petugas Keamanan'), matchIds };
  }

  throw Object.assign(new Error('Sesi portal aktif diperlukan.'), { statusCode: 401 });
}

function b64Url(input: Buffer | string): string {
  const b = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

const oauth2TokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

async function exchangeOAuth2RefreshToken(
  cfg: Extract<DriveAuthConfig, { mode: 'oauth2' }>,
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
        // fallback
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
        }): ${detail}. Pastikan refresh token masih aktif dan OAuth Consent Screen berstatus Published/Production.`,
      },
    });
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    oauth2TokenCache.delete(cacheKey);
    throw new Error('Access token OAuth2 Google Drive tidak tersedia.');
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

async function getDriveToken(cfg: DriveAuthConfig, forceRefresh = false): Promise<string> {
  if (cfg.mode === 'oauth2') {
    return exchangeOAuth2RefreshToken(cfg, forceRefresh);
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

  const now = Math.floor(Date.now() / 1000);
  const jwtHeaderPayload: Record<string, string> = { alg: 'RS256', typ: 'JWT' };
  if (resolvedKid) {
    jwtHeaderPayload.kid = resolvedKid;
  }
  const signingInput = `${b64Url(JSON.stringify(jwtHeaderPayload))}.${b64Url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now - 30,
      exp: now + 3570,
    })
  )}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyObj);
  const jwt = `${signingInput}.${b64Url(signature)}`;

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
  if (!json.access_token) throw new Error('Access token Drive tidak tersedia.');
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
        [folderField]: `Folder Google Drive (${driveCfg?.rootFolderId || '-'}) tidak ditemukan atau tidak dapat diakses akun yang terautentikasi (${errInfo.status} / notFound: ${errInfo.message}).`,
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

async function ensureDriveFolder(
  token: string,
  name: string,
  parentId: string,
  driveCfg?: DriveAuthConfig
): Promise<string> {
  const cleanParentId = stripOuterQuotes(parentId);
  const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeParent = cleanParentId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${safeParent}' in parents`,
    fields: 'files(id,name)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!findRes.ok) {
    const findErr = await parseGoogleDriveApiError(findRes);
    throw buildDriveApiFailureError(`Gagal mencari folder Drive "${name}"`, findErr, driveCfg);
  }
  const found = (await findRes.json().catch(() => ({}))) as { files?: Array<{ id?: string }> };
  if (found.files?.[0]?.id) return found.files[0].id;

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [cleanParentId],
      }),
    }
  );
  if (!createRes.ok) {
    const createErr = await parseGoogleDriveApiError(createRes);
    throw buildDriveApiFailureError(`Gagal membuat folder Drive "${name}"`, createErr, driveCfg);
  }
  const created = (await createRes.json().catch(() => ({}))) as { id?: string };
  if (!created?.id) {
    throw new Error(`Google Drive tidak mengembalikan ID saat membuat folder "${name}".`);
  }
  return created.id;
}

function sanitizeOrigin(raw: string): string | undefined {
  const clean = raw.trim();
  if (!clean) return undefined;
  try {
    const parsed = new URL(clean);
    if (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    ) {
      return `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  applyCorsAndNoStoreHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method tidak diizinkan. Gunakan POST.' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      res.status(400).json({ ok: false, error: 'Body JSON tidak valid.' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as Record<string, unknown>;
  }

  try {
    if (body.transitPath) {
      res.status(400).json({ ok: false, error: 'Video DILARANG menggunakan bucket transit Supabase.' });
      return;
    }

    const senderHint =
      body.sender && typeof body.sender === 'object' ? (body.sender as SenderCallerHint) : null;
    const caller = await verifyCaller(req, senderHint);
    const roomId = normalizeRoomId(String(body.roomId || ''));
    if (!roomId || !canCallerAccessRoom(caller, roomId)) {
      res.status(403).json({ ok: false, error: 'Tidak memiliki akses ke ruang chat ini.' });
      return;
    }

    const safeName = sanitizeFileName(String(body.fileName || ''));
    const cleanMime = String(body.mimeType || 'video/mp4').trim().toLowerCase();
    if (!isVideoMedia(cleanMime, safeName)) {
      res.status(400).json({ ok: false, error: 'Endpoint ini khusus berkas video.' });
      return;
    }

    const sizeBytes = Number(body.sizeBytes || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_BYTES) {
      res.status(400).json({ ok: false, error: 'Ukuran video maksimal 500 MB.' });
      return;
    }

    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : '';
    if (messageId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
        res.status(400).json({ ok: false, error: 'Format messageId tidak valid.' });
        return;
      }
      const msgRes = await sbRest<Array<{ id: string; room_id?: string; sender_id?: string }>>(
        `/rest/v1/community_chat_messages?id=eq.${encodeURIComponent(messageId)}&select=id,room_id,sender_id&limit=1`
      );
      const row = msgRes.data?.[0];
      if (!row) {
        res.status(404).json({ ok: false, error: 'Pesan chat tidak ditemukan.' });
        return;
      }
      if (
        normalizeRoomId(String(row.room_id || '')) !== roomId ||
        (caller.role !== 'admin' && !caller.matchIds.has(normalizeParticipantId(String(row.sender_id || ''))))
      ) {
        res.status(403).json({ ok: false, error: 'Anda tidak berhak mengubah lampiran pesan ini.' });
        return;
      }
    }

    const driveCfg = getDriveEnv();
    const accessToken = await getDriveToken(driveCfg);
    const categoryFolder = resolveDriveCategoryFolder(roomId);
    const monthFolder = getJakartaYearMonth();
    const catId = await ensureDriveFolder(accessToken, categoryFolder, driveCfg.rootFolderId, driveCfg);
    const folderId = await ensureDriveFolder(accessToken, monthFolder, catId, driveCfg);
    const folderPath = `${categoryFolder}/${monthFolder}`;

    const effectiveMime = cleanMime.startsWith('video/') ? cleanMime : 'video/mp4';
    const origin = sanitizeOrigin(getHeader(req.headers, 'origin'));
    const initHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': effectiveMime,
      'X-Upload-Content-Length': String(Math.round(sizeBytes)),
    };
    if (origin) initHeaders.Origin = origin;

    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,thumbnailLink',
      {
        method: 'POST',
        headers: initHeaders,
        body: JSON.stringify({
          name: safeName,
          parents: [folderId],
          mimeType: effectiveMime,
          description: `Video chat ${roomId} oleh ${caller.displayName}`,
        }),
      }
    );
    if (!initRes.ok) {
      const errInfo = await parseGoogleDriveApiError(initRes);
      throw buildDriveApiFailureError('Gagal inisiasi resumable Drive', errInfo, driveCfg);
    }

    const sessionUri = (initRes.headers.get('location') || '').trim();
    if (!sessionUri.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      res.status(502).json({ ok: false, error: 'URI sesi resumable Drive tidak valid.' });
      return;
    }

    if (messageId) {
      await sbRest('/rest/v1/rpc/update_chat_message_attachment', {
        method: 'POST',
        body: JSON.stringify({
          p_message_id: messageId,
          p_attachment_type: 'video',
          p_attachment_name: safeName,
          p_attachment_mime: effectiveMime,
          p_attachment_size_bytes: Math.round(sizeBytes),
          p_attachment_storage_provider: 'google_drive',
          p_attachment_drive_file_id: null,
          p_attachment_drive_folder_path: folderPath,
          p_attachment_url: null,
          p_attachment_thumbnail_url: null,
          p_attachment_status: 'uploading_video',
        }),
      });
    }

    res.status(200).json({
      ok: true,
      sessionUri,
      folderId,
      folderPath,
      fileName: safeName,
      mimeType: effectiveMime,
      sizeBytes: Math.round(sizeBytes),
      storageProvider: 'google_drive',
    });
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
      error: err instanceof Error ? err.message : 'Gagal membuat sesi unggah video Google Drive.',
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
    });
  }
}
