// Vercel Serverless Function: GET/HEAD/POST /api/storage/chat-drive-private-access
// Self-contained (kompatibel penuh dengan Node ESM di Vercel).
import crypto from 'crypto';

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
  body?: unknown;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  write?: (chunk: Buffer | Uint8Array) => boolean;
  send?: (body: unknown) => void;
  end: (body?: string | Buffer) => void;
  once?: (event: string, cb: () => void) => void;
}

interface VerifiedCaller {
  role: 'admin' | 'warga' | 'petugas';
  senderId: string;
  slug: string;
  displayName: string;
  matchIds: Set<string>;
}

const STREAM_URL_TTL_MS = 5 * 60 * 1000;
const EPHEMERAL_FALLBACK_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, authorization, apikey, x-client-info, x-user-role, x-blok-rumah, x-petugas-id, x-admin-jabatan, x-admin-permission, x-sender-id, x-pengurus-username, range, cache-control, pragma'
  );
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, Accept-Ranges, Content-Disposition, Content-Type'
  );
  res.setHeader('Access-Control-Max-Age', '3600');
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function sendJsonError(
  res: VercelRes,
  status: number,
  payload: Record<string, unknown> & { error: string; reason?: string; stage?: string }
): void {
  res.status(status).json({
    ok: false,
    ...payload,
    reason: payload.reason || payload.error,
  });
}

function getQueryParam(req: VercelReq, key: string): string {
  if (req.query && key in req.query) {
    const v = req.query[key];
    return Array.isArray(v) ? v[0] || '' : v || '';
  }
  if (req.url && req.url.includes('?')) {
    const qs = req.url.slice(req.url.indexOf('?'));
    return new URLSearchParams(qs).get(key) || '';
  }
  return '';
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
  if (clean.startsWith('pengurus:')) return `admin:${canonicalAdminUsername(clean.slice(9))}`;
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

function doesCallerMatchFieldValue(caller: VerifiedCaller, rawValue?: string | null): boolean {
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

function resolveDriveCategoryFolder(roomId: string): string {
  if (roomId === 'grup_pengurus') return 'Grup-Pengurus';
  if (roomId === 'pengurus_warga') return 'Grup-Pengurus-Warga';
  if (roomId === 'pengurus_keamanan') return 'Grup-Pengurus-Keamanan';
  if (roomId === 'warga_keamanan') return 'Grup-Warga-Keamanan';
  if (roomId === 'forum_umum') return 'Forum-Lingkungan';
  if (roomId.startsWith('dm:')) return 'DM-Personal';
  return 'Chat-Lainnya';
}

function sanitizeFileName(rawName?: string | null): string {
  const last = String(rawName || '').split(/[\\/]/).pop() || '';
  const safe = last.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || `lampiran-${Date.now()}.bin`).slice(0, 140);
}

interface CredentialValidationError extends Error {
  statusCode?: number;
  missingFields?: string[];
  invalidFields?: string[];
  fieldReasons?: Record<string, string>;
}

interface DriveOAuth2Config {
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

function getDriveEnv(): DriveOAuth2Config {
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

async function sbRest<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; errorText: string }> {
  const { url, serviceKey } = getSupabaseEnv();
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
  const txt = await res.text().catch(() => '');
  if (!txt) return { ok: true, status: res.status, data: null, errorText: '' };
  try {
    return { ok: true, status: res.status, data: JSON.parse(txt) as T, errorText: '' };
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
  const r = normalizeToken(row.role);
  const b = normalizeToken(row.bot_role);
  return r === 'admin' || r === 'bendahara' || r === 'pengurus' || b === 'admin' || b === 'bendahara' || b === 'pengurus';
}

async function fetchUsersWargaRows(): Promise<{ rows: UsersWargaCallerRow[]; ok: boolean }> {
  for (const selectExpr of [
    'id,blok_rumah,nama_warga,no_wa,secondary_whatsapp,role,bot_role,jabatan,admin_permission,aktif',
    'id,blok_rumah,nama_warga,no_wa,role,bot_role,jabatan,admin_permission,aktif',
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

async function resolveVerifiedAuthUser(authorization?: string): Promise<{
  id: string;
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

async function verifyCaller(headers: {
  role: string;
  blokRumah: string;
  petugasId: string;
  authorization?: string;
  adminJabatan?: string;
  adminPermission?: string;
  senderHint?: SenderCallerHint | null;
}): Promise<VerifiedCaller> {
  const hint = headers.senderHint || null;
  const rawRole = normalizeToken(headers.role || hint?.role);
  const rawBlok = String(headers.blokRumah || hint?.blokRumah || '').trim();
  const rawPetId = String(headers.petugasId || hint?.petugasId || '').trim();
  const rawJabatan = String(headers.adminJabatan || hint?.jabatan || '').trim();
  const rawPermission = String(headers.adminPermission || hint?.adminPermission || '').trim();

  const verifiedAuthUser = await resolveVerifiedAuthUser(headers.authorization);
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
    let uname = resolvePengurusUsernameFromHints(rawBlok, rawJabatan, hint);
    if (!uname && verifiedAuthUser) {
      uname = resolvePengurusUsernameFromHints(
        String(
          verifiedAuthUser.userMetadata?.pengurus_username ||
            verifiedAuthUser.userMetadata?.username ||
            verifiedAuthUser.userMetadata?.blok_rumah ||
            ''
        ),
        rawJabatan,
        hint
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
      (rpcActivePengurus === true ? { nama_warga: rpcPengurusNama || hint?.namaWarga || knownMeta?.nama } : null) ||
      (verifiedAuthUser?.id && !inactiveAdminRow
        ? {
            nama_warga:
              String(verifiedAuthUser.userMetadata?.nama_warga || '') ||
              hint?.namaWarga ||
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

    const matchIds = new Set<string>([`admin:${uname}`, uname]);
    if (uname === 'andriansyah') {
      matchIds.add('admin:admin');
      matchIds.add('admin:bendahara');
    }
    if (uname === 'bpiwan') matchIds.add('admin:paiwan');

    const matchedAdminRow = activeAdminRow || linkedActiveRow;
    addIdentityVariants(matchIds, 'admin', {
      uuid: matchedAdminRow?.id || hint?.userId || verifiedAuthUser?.id,
      blok: matchedAdminRow?.blok_rumah || knownMeta?.linkedBlock,
      name: matchedAdminRow?.nama_warga || hint?.namaWarga || knownMeta?.nama,
      username: uname,
      phones: [matchedAdminRow?.no_wa, matchedAdminRow?.secondary_whatsapp, hint?.noWa],
    });
    if (knownMeta?.linkedBlock) {
      const linkedCanon = canonicalBlockKey(knownMeta.linkedBlock).toLowerCase();
      if (linkedCanon) {
        matchIds.add(`warga:${linkedCanon}`);
        matchIds.add(linkedCanon);
      }
    }

    return {
      role: 'admin',
      senderId: `admin:${uname}`,
      slug: uname,
      displayName: String(
        verifiedMatch.nama_warga || rpcPengurusNama || hint?.namaWarga || knownMeta?.nama || 'Pengurus'
      ).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'warga') {
    const rawWargaBlock =
      rawBlok ||
      (hint?.senderId?.toLowerCase().startsWith('warga:')
        ? hint.senderId.slice('warga:'.length)
        : '') ||
      String(verifiedAuthUser?.userMetadata?.blok_rumah || '');
    const canon = canonicalBlockKey(rawWargaBlock);
    const uuidCandidate = String(
      hint?.userId ||
        verifiedAuthUser?.id ||
        (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawWargaBlock)
          ? rawWargaBlock
          : '')
    )
      .trim()
      .toLowerCase();
    const phoneCandidates = new Set<string>(buildPhoneMatchTokens(hint?.noWa || rawWargaBlock));
    const nameCandidate = normalizeToken(hint?.namaWarga || (!canon ? rawWargaBlock : ''));

    if (!canon && !uuidCandidate && phoneCandidates.size === 0 && !nameCandidate) {
      throw Object.assign(
        new Error('Identitas Warga tidak lengkap (blok_rumah, UUID, maupun nomor HP/username tidak tersedia).'),
        { statusCode: 401 }
      );
    }

    const { rows, ok } = await fetchUsersWargaRows();
    let matchingRows = canon ? rows.filter((r) => canonicalBlockKey(r.blok_rumah) === canon) : [];
    if (matchingRows.length === 0 && uuidCandidate) {
      matchingRows = rows.filter((r) => String(r.id || '').trim().toLowerCase() === uuidCandidate);
    }
    if (matchingRows.length === 0 && phoneCandidates.size > 0) {
      matchingRows = rows.filter((r) => {
        const rowPhones = [
          ...buildPhoneMatchTokens(r.no_wa),
          ...buildPhoneMatchTokens(r.secondary_whatsapp),
        ];
        return rowPhones.some((p) => phoneCandidates.has(p));
      });
    }
    if (matchingRows.length === 0 && nameCandidate) {
      const exactNameRows = rows.filter(
        (r) => normalizeToken(r.nama_warga) === nameCandidate && !isPengurusRowRole(r)
      );
      if (exactNameRows.length === 1) {
        matchingRows = exactNameRows;
      }
    }

    const activeWargaRow = matchingRows.find((r) => r.aktif !== false && !isPengurusRowRole(r));
    const inactiveWargaRow = matchingRows.find((r) => r.aktif === false && !isPengurusRowRole(r));
    const activePengurusRow = matchingRows.find((r) => r.aktif !== false && isPengurusRowRole(r));

    const resolvedCanon = canonicalBlockKey(activeWargaRow?.blok_rumah || rawWargaBlock) || canon;
    let verifiedDisplayName = activeWargaRow ? String(activeWargaRow.nama_warga || '').trim() : '';
    let verifiedWarga = Boolean(activeWargaRow);

    if (!verifiedWarga && !inactiveWargaRow) {
      try {
        const dirRes = await sbRest<Array<Record<string, unknown>>>('/rest/v1/rpc/get_chat_directory', {
          method: 'POST',
          body: '{}',
        });
        if (dirRes.ok && Array.isArray(dirRes.data)) {
          const lowerCanon = resolvedCanon.toLowerCase();
          const dirMatch = dirRes.data.find((entry) => {
            const entryRole = normalizeToken(String(entry.role || ''));
            if (entryRole && entryRole !== 'warga') return false;
            const entryBlok = canonicalBlockKey(String(entry.blok_rumah || entry.blok_or_code || ''));
            const entryPid = normalizeParticipantId(String(entry.participant_id || ''));
            const entryName = normalizeToken(String(entry.display_name || ''));
            return (
              (resolvedCanon && entryBlok === resolvedCanon) ||
              (lowerCanon && entryPid === `warga:${lowerCanon}`) ||
              (nameCandidate && entryName === nameCandidate)
            );
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
          new Error(`Akun Warga Blok "${resolvedCanon || rawWargaBlock}" berstatus nonaktif di users_warga (aktif = false).`),
          { statusCode: 403 }
        );
      }
      if (activePengurusRow) {
        throw Object.assign(
          new Error(
            `Akun Blok "${resolvedCanon || rawWargaBlock}" terdaftar sebagai Pengurus aktif (${String(
              activePengurusRow.jabatan || activePengurusRow.role || 'Pengurus'
            )}). Gunakan portal Pengurus untuk mengakses lampiran.`
          ),
          { statusCode: 403 }
        );
      }
      if (!ok) {
        throw new Error('Gagal membaca tabel users_warga saat verifikasi akun Warga.');
      }
      throw Object.assign(
        new Error(
          `Akun Warga "${resolvedCanon || rawWargaBlock || hint?.namaWarga || '-'}" tidak ditemukan aktif di users_warga maupun direktori chat (baris users_warga=${rows.length}).`
        ),
        { statusCode: 403 }
      );
    }

    const lower = (resolvedCanon || rawWargaBlock).toLowerCase();
    const matchIds = new Set<string>([`warga:${lower}`]);
    if (normalizeToken(rawWargaBlock)) matchIds.add(`warga:${normalizeToken(rawWargaBlock)}`);
    addIdentityVariants(matchIds, 'warga', {
      uuid: activeWargaRow?.id || hint?.userId || verifiedAuthUser?.id,
      blok: activeWargaRow?.blok_rumah || resolvedCanon,
      name: verifiedDisplayName || activeWargaRow?.nama_warga || hint?.namaWarga,
      username: hint?.username,
      phones: [activeWargaRow?.no_wa, activeWargaRow?.secondary_whatsapp, hint?.noWa],
    });

    return {
      role: 'warga',
      senderId: `warga:${lower}`,
      slug: lower.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(verifiedDisplayName || hint?.namaWarga || `Warga ${resolvedCanon || rawWargaBlock}`).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'petugas' || effectiveRole === 'keamanan') {
    const tok = normalizeToken(rawPetId || rawBlok || hint?.namaWarga || hint?.username);
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
    const matchIds = new Set<string>([`petugas:${pid}`, `keamanan:${pid}`, pid]);
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
      senderId: `petugas:${pid}`,
      slug: pid.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(matched.nama || 'Petugas Keamanan'),
      matchIds,
    };
  }

  throw Object.assign(new Error('Sesi portal aktif diperlukan.'), { statusCode: 401 });
}

function b64Url(input: Buffer | string): string {
  const b = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getSigningSecret(): string {
  return (
    stripOuterQuotes(process.env.CHAT_MEDIA_SIGNING_SECRET) ||
    stripOuterQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    stripOuterQuotes(process.env.SERVICE_ROLE_KEY) ||
    EPHEMERAL_FALLBACK_SIGNING_KEY
  ).trim();
}

function signStreamToken(payload: {
  fileId: string;
  roomId: string;
  role: string;
  blokRumah: string;
  petugasId: string;
  exp: number;
}): string {
  const canonical = JSON.stringify({
    f: payload.fileId,
    r: payload.roomId,
    ro: payload.role,
    b: payload.blokRumah,
    p: payload.petugasId,
    e: payload.exp,
  });
  return b64Url(crypto.createHmac('sha256', getSigningSecret()).update(canonical).digest());
}

function verifyStreamToken(
  payload: {
    fileId: string;
    roomId: string;
    role: string;
    blokRumah: string;
    petugasId: string;
    exp: number;
  },
  signature: string
): boolean {
  if (!signature || !Number.isFinite(payload.exp) || Date.now() > payload.exp) return false;
  try {
    const expected = signStreamToken(payload);
    const a = Buffer.from(expected, 'utf-8');
    const b = Buffer.from(signature, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function recordUnauthorizedAudit(params: {
  headers: { role: string; blokRumah: string; petugasId: string };
  roomId?: string;
  fileId?: string;
  messageId?: string;
  reason: string;
}): Promise<void> {
  try {
    const actorRole = normalizeToken(params.headers.role) || 'anonymous';
    const actorBlok = String(params.headers.blokRumah || '').trim();
    const actorPet = String(params.headers.petugasId || '').trim();
    await sbRest('/rest/v1/audit_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        actor_role: actorRole,
        actor_id: actorBlok || actorPet || 'anonymous',
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
          requested_petugas_id: actorPet || null,
        },
      }),
    });
  } catch {
    // Jangan blokir respons 403
  }
}

const oauth2TokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

async function exchangeOAuth2RefreshToken(
  cfg: DriveOAuth2Config,
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

async function getDriveToken(cfg: DriveOAuth2Config, forceRefresh = false): Promise<string> {
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
  driveCfg?: DriveOAuth2Config
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
        [folderField]: `Folder atau berkas Google Drive tidak ditemukan / tidak dapat diakses oleh akun OAuth2 (${errInfo.status} / notFound: ${errInfo.message}).`,
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
        [folderField]: `Akun Google OAuth2 tidak memiliki izin mengakses berkas/folder ${folderField} (${errInfo.status} / ${errInfo.reason}): ${errInfo.message}.`,
      },
    });
  }

  return Object.assign(
    new Error(`${context} (${errInfo.status}${reasonTag}): ${errInfo.message}`),
    { statusCode: 502 }
  );
}

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
    const res = await sbRest<PrivateMessageLookupRow[]>(
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

async function isInsideRootCategory(
  token: string,
  rootFolderId: string,
  fileParents: string[] | undefined,
  roomId: string
): Promise<boolean> {
  if (!Array.isArray(fileParents) || fileParents.length === 0) return false;
  const expectedCat = resolveDriveCategoryFolder(roomId);
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
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
    ).catch(() => null);
    if (!folderRes || !folderRes.ok) continue;

    const folderJson = (await folderRes.json().catch(() => ({}))) as { name?: string; parents?: string[] };
    const isCatFolder = folderJson.name === expectedCat;
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
  const safeAscii = sanitizeFileName(fileName);
  const cleanRawName = String(fileName || safeAscii).replace(/[\r\n"]/g, '').trim() || safeAscii;
  if (upstreamHeader && upstreamHeader.toLowerCase().includes('filename')) {
    return upstreamHeader.replace(/^(inline|attachment)/i, dispType);
  }
  return `${dispType}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(cleanRawName)}`;
}

async function streamDriveResponse(fetchRes: Response, res: VercelRes): Promise<void> {
  if (typeof res.write === 'function' && fetchRes.body) {
    const reader = fetchRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          const ok = res.write(Buffer.from(value));
          if (!ok && typeof res.once === 'function') {
            await new Promise<void>((resolve) => res.once?.('drain', resolve));
          }
        }
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
    return;
  }
  const buf = Buffer.from(await fetchRes.arrayBuffer());
  if (typeof res.send === 'function') {
    res.send(buf);
  } else {
    res.end(buf);
  }
}

export default async function handler(req: VercelReq, res: VercelRes) {
  applyCorsAndNoStoreHeaders(req, res);

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
    sendJsonError(res, 405, {
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
        sendJsonError(res, 400, {
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

  const action = String(bodyObj.action || getQueryParam(req, 'action') || '').trim().toLowerCase();
  fileId = String(
    bodyObj.fileId ||
      bodyObj.driveFileId ||
      bodyObj.drive_file_id ||
      getQueryParam(req, 'fileId') ||
      getQueryParam(req, 'driveFileId') ||
      getQueryParam(req, 'drive_file_id') ||
      ''
  ).trim();
  const attachmentId = String(
    bodyObj.attachmentId ||
      bodyObj.attachment_id ||
      getQueryParam(req, 'attachmentId') ||
      getQueryParam(req, 'attachment_id') ||
      ''
  ).trim();
  rawRoomId = String(bodyObj.roomId || getQueryParam(req, 'roomId') || '').trim();
  messageId = String(
    bodyObj.messageId ||
      bodyObj.message_id ||
      getQueryParam(req, 'messageId') ||
      getQueryParam(req, 'message_id') ||
      ''
  ).trim();
  const modeRaw = String(bodyObj.mode || getQueryParam(req, 'mode') || 'stream').trim().toLowerCase();
  const mode: 'stream' | 'download' | 'thumbnail' =
    modeRaw === 'download' ? 'download' : modeRaw === 'thumbnail' ? 'thumbnail' : 'stream';

  let callerHeaders: {
    role: string;
    blokRumah: string;
    petugasId: string;
    authorization?: string;
    adminJabatan?: string;
    adminPermission?: string;
    senderHint?: SenderCallerHint | null;
  } = {
    role: getHeader(req.headers, 'x-user-role'),
    blokRumah: getHeader(req.headers, 'x-blok-rumah') || getHeader(req.headers, 'x-pengurus-username'),
    petugasId: getHeader(req.headers, 'x-petugas-id'),
    authorization: getHeader(req.headers, 'authorization'),
    adminJabatan: getHeader(req.headers, 'x-admin-jabatan'),
    adminPermission: getHeader(req.headers, 'x-admin-permission'),
    senderHint:
      bodyObj.sender && typeof bodyObj.sender === 'object' ? (bodyObj.sender as SenderCallerHint) : null,
  };

  const sig = getQueryParam(req, 'sig');
  const expParam = Number(getQueryParam(req, 'exp') || '0');
  if ((method === 'GET' || method === 'HEAD') && sig) {
    stage = 'verify_stream_signature';
    const ro = getQueryParam(req, 'ro');
    const b = getQueryParam(req, 'b');
    const p = getQueryParam(req, 'p');
    if (!verifyStreamToken({ fileId, roomId: rawRoomId, role: ro, blokRumah: b, petugasId: p, exp: expParam }, sig)) {
      const reason = 'Tanda tangan URL aliran media privat tidak valid atau telah kedaluwarsa.';
      await recordUnauthorizedAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      sendJsonError(res, 403, {
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
    let caller: VerifiedCaller;
    try {
      caller = await verifyCaller(callerHeaders);
    } catch (authErr) {
      const typedAuthErr = authErr as CredentialValidationError;
      if (typedAuthErr?.missingFields?.length || typedAuthErr?.invalidFields?.length) {
        throw authErr;
      }
      const statusCode = typeof typedAuthErr?.statusCode === 'number' ? typedAuthErr.statusCode : 403;
      const reason = authErr instanceof Error ? authErr.message : 'Identitas peminta tidak valid.';
      await recordUnauthorizedAudit({ headers: callerHeaders, roomId: rawRoomId, fileId, messageId, reason });
      sendJsonError(res, statusCode, {
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
      sendJsonError(res, 400, {
        stage,
        error: 'Format messageId tidak valid.',
        reason: 'Parameter messageId harus berupa UUID valid atau sertakan drive_file_id/fileId.',
      });
      return;
    }

    const dbRow = await lookupPrivateMessageRecord({
      messageId,
      fileId,
      attachmentId,
    });

    if (dbRow) {
      const dbFileId = String(dbRow.attachment_drive_file_id || dbRow.drive_file_id || '').trim();
      if (!fileId && dbFileId) {
        fileId = dbFileId;
      }
      if (fileId && dbFileId && dbFileId !== fileId) {
        const reason = 'ID berkas Google Drive yang diminta tidak cocok dengan record pesan terkait.';
        await recordUnauthorizedAudit({
          headers: callerHeaders,
          roomId: dbRow.room_id,
          fileId,
          messageId,
          reason,
        });
        sendJsonError(res, 403, {
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
        return;
      }
      const dbRoom = normalizeRoomId(String(dbRow.room_id || ''));
      if (rawRoomId && dbRoom && normalizeRoomId(rawRoomId) !== dbRoom) {
        const reason = 'roomId yang diminta tidak cocok dengan ruang asal pesan pada database.';
        await recordUnauthorizedAudit({
          headers: callerHeaders,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason,
        });
        sendJsonError(res, 403, {
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
      await recordUnauthorizedAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      sendJsonError(res, 404, {
        stage,
        error: 'Lampiran chat tidak ditemukan.',
        reason,
      });
      return;
    }

    const roomId = normalizeRoomId(rawRoomId);
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId) || !roomId) {
      const reason = !/^[a-zA-Z0-9_-]{10,120}$/.test(fileId)
        ? `ID berkas Google Drive tidak valid atau kosong ("${fileId || '-'}").`
        : `ID ruang chat tidak valid ("${rawRoomId || '-'}").`;
      await recordUnauthorizedAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      sendJsonError(res, 400, {
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
        denyReason = 'Berkas Group Pengurus & Keamanan hanya dapat diakses oleh akun Pengurus atau Keamanan aktif.';
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
      const matchesSenderOrRecipient = dbRow
        ? doesCallerMatchFieldValue(caller, dbRow.sender_id) ||
          doesCallerMatchFieldValue(caller, dbRow.sender_user_id) ||
          doesCallerMatchFieldValue(caller, dbRow.recipient_id) ||
          doesCallerMatchFieldValue(caller, dbRow.target_user_id)
        : false;

      if (matchesSenderOrRecipient) {
        authorized = true;
      } else if (authorized && dbRow) {
        const hasExplicitSender = Boolean(dbRow.sender_id || dbRow.sender_user_id);
        const hasExplicitRecipient = Boolean(dbRow.recipient_id || dbRow.target_user_id);
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
      await recordUnauthorizedAudit({ headers: callerHeaders, roomId, fileId, messageId, reason: denyReason });
      sendJsonError(res, 403, {
        stage,
        error: 'Akses lampiran privat ditolak.',
        reason: denyReason,
      });
      return;
    }

    stage = 'validate_drive_secrets';
    const driveCfg = getDriveEnv();

    stage = 'authenticate_drive';
    const accessToken = await getDriveToken(driveCfg);

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
        sendJsonError(res, 404, {
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
      sendJsonError(res, 404, {
        stage,
        error: 'Berkas telah dihapus dari Google Drive.',
        reason: `Berkas Google Drive "${fileMeta.name || fileId}" berada di Trash/Sampah.`,
      });
      return;
    }

    if (!dbRow) {
      const okTree = await isInsideRootCategory(accessToken, driveCfg.rootFolderId, fileMeta.parents, roomId);
      if (!okTree) {
        const reason = `Berkas Google Drive ("${fileMeta.name || fileId}") tidak terdaftar di database pesan maupun folder kategori ruang "${roomId}".`;
        await recordUnauthorizedAudit({
          headers: callerHeaders,
          roomId,
          fileId,
          messageId,
          reason,
        });
        sendJsonError(res, 403, {
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
      const blokVal = (callerHeaders.blokRumah || callerHeaders.senderHint?.blokRumah || caller.slug || '').trim();
      const petVal = (callerHeaders.petugasId || callerHeaders.senderHint?.petugasId || '').trim();
      const signedSig = signStreamToken({
        fileId,
        roomId,
        role: roleVal,
        blokRumah: blokVal,
        petugasId: petVal,
        exp,
      });
      const qs = new URLSearchParams({
        fileId,
        roomId,
        ro: roleVal,
        b: blokVal,
        p: petVal,
        exp: String(exp),
        sig: signedSig,
      });
      if (messageId) qs.set('messageId', messageId);
      if (mode !== 'stream') qs.set('mode', mode);
      res.status(200).json({
        ok: true,
        streamUrl: `/api/storage/chat-drive-private-access?${qs.toString()}`,
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
      const tRes = await fetch(fileMeta.thumbnailLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      });
      const tCt = (tRes.headers.get('content-type') || '').trim().toLowerCase();
      if (tRes.ok && tCt.startsWith('image/')) {
        res.setHeader('Content-Type', tCt || 'image/jpeg');
        res.setHeader('Cache-Control', 'private, no-store');
        res.status(200);
        if (method === 'HEAD') {
          await tRes.body?.cancel().catch(() => undefined);
          res.end();
          return;
        }
        await streamDriveResponse(tRes, res);
        return;
      }
      await tRes.body?.cancel().catch(() => undefined);
    }

    stage = 'stream_drive_media';
    const rangeHeader = getHeader(req.headers, 'range').trim();
    const driveHeaders: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader)) {
      driveHeaders.Range = rangeHeader;
    }

    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { method: 'GET', headers: driveHeaders, cache: 'no-store' }
    );
    if (!mediaRes.ok && mediaRes.status !== 206) {
      const mediaErr = await parseGoogleDriveApiError(mediaRes);
      if (mediaRes.status === 416) {
        sendJsonError(res, 416, {
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
      resolveForwardedContentDisposition(mediaRes.headers.get('content-disposition'), rawFileName, mode)
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

    await streamDriveResponse(mediaRes, res);
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

    sendJsonError(res, statusCode, {
      stage,
      error: errorMessage,
      reason: detailReason,
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
    });
  }
}
