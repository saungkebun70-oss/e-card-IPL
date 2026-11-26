/**
 * Supabase Edge Function: chat-drive-private-access (Standalone Ready-to-Deploy)
 *
 * Fitur:
 * - Memvalidasi identitas peminta (Pengurus, Warga, Keamanan), hak akses ruang chat, serta kepemilikan pesan.
 * - Mengatur/memvalidasi kebijakan izin file Google Drive per ruang chat (`anyone_link` vs `restricted_private`).
 * - Melayani stream/download/thumbnail aman dan URL stream bertanda tangan jangka pendek untuk berkas privat
 *   (Grup Pengurus, Grup Pengurus & Keamanan, & DM Personal) via OAuth 2.0 User Credentials,
 *   serta mencatat penolakan ke `audit_logs`.
 * - Mendukung sanitasi otomatis env secrets, lookup fleksibel (UUID/blok/HP/username, drive_file_id/attachment_id),
 *   dan mengembalikan `reason` spesifik pada seluruh respons error JSON.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface VerifiedChatCaller {
  role: 'admin' | 'warga' | 'petugas';
  senderId: string;
  slug: string;
  displayName: string;
  matchIds: Set<string>;
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

type DrivePermissionScope = 'anyone_link' | 'restricted_private';

interface CredentialValidationError extends Error {
  statusCode?: number;
  missingFields?: string[];
  invalidFields?: string[];
  fieldReasons?: Record<string, string>;
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

interface KnownPengurusMeta {
  username: string;
  nama: string;
  jabatan: string;
  linkedBlock: string;
  permission: 'full' | 'add_only';
}

const STREAM_URL_TTL_MS = 5 * 60 * 1000; // 5 menit

const ALLOWED_STATIC_ORIGINS = new Set([
  'https://e-card-ipl.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

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

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') || '').trim();
  const configuredPublicUrl = stripOuterQuotes(Deno.env.get('PUBLIC_APP_URL')).replace(/\/+$/, '');
  let allowedOrigin = configuredPublicUrl || 'https://e-card-ipl.vercel.app';

  if (origin) {
    try {
      const parsed = new URL(origin);
      const host = parsed.hostname.toLowerCase();
      if (
        ALLOWED_STATIC_ORIGINS.has(origin) ||
        (configuredPublicUrl && origin === configuredPublicUrl) ||
        host.endsWith('.vercel.app') ||
        host.endsWith('.stackblitz.io') ||
        host.endsWith('.webcontainer.io') ||
        host.endsWith('.run.app') ||
        ((host === 'localhost' || host === '127.0.0.1') &&
          (parsed.protocol === 'http:' || parsed.protocol === 'https:'))
      ) {
        allowedOrigin = origin;
      }
    } catch {
      allowedOrigin = configuredPublicUrl || 'https://e-card-ipl.vercel.app';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, range, cache-control, pragma, x-user-role, x-blok-rumah, x-petugas-id, x-admin-permission, x-admin-jabatan, x-sender-id, x-pengurus-username',
    'Access-Control-Expose-Headers':
      'Content-Range, Content-Length, Accept-Ranges, Content-Disposition, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Vary: 'Origin',
  };
}

function jsonResponse(
  req: Request,
  status: number,
  payload: Record<string, unknown>
): Response {
  const enrichedPayload = { ...payload };
  if (status >= 400 && !enrichedPayload.reason && typeof enrichedPayload.error === 'string') {
    enrichedPayload.reason = enrichedPayload.error;
  }
  return new Response(JSON.stringify(enrichedPayload), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      'Content-Type': 'application/json',
    },
  });
}

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

const OUTER_QUOTE_CHARS = new Set(['"', "'", '`', '\u201C', '\u201D', '\u2018', '\u2019']);

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
    if (clean.length >= 2 && OUTER_QUOTE_CHARS.has(first) && OUTER_QUOTE_CHARS.has(last)) {
      clean = clean.slice(1, -1).trim();
      changed = true;
      continue;
    }
    if (OUTER_QUOTE_CHARS.has(first)) {
      clean = clean.slice(1).trim();
      changed = true;
      continue;
    }
    if (OUTER_QUOTE_CHARS.has(last)) {
      clean = clean.slice(0, -1).trim();
      changed = true;
    }
  }
  return clean.trim();
}

function isUrlLikeValue(raw: string): boolean {
  const clean = raw.trim();
  return /^https?:\/\//i.test(clean) || /^[a-z0-9+.-]+:\/\//i.test(clean);
}

function readFirstSecretEnv(names: string[]): { value: string; sourceName: string | null } {
  for (const name of names) {
    const cleaned = stripOuterQuotes(Deno.env.get(name));
    if (cleaned) {
      return { value: cleaned, sourceName: name };
    }
  }
  return { value: '', sourceName: null };
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
    `Validasi secrets ${params.scope} gagal di Edge Function — ${details.join('; ')}.`
  ) as CredentialValidationError;
  err.statusCode = params.statusCode ?? 500;
  err.missingFields = [...params.missingFields];
  err.invalidFields = [...params.invalidFields];
  if (params.fieldReasons && Object.keys(params.fieldReasons).length > 0) {
    err.fieldReasons = params.fieldReasons;
  }
  return err;
}

function getSupabaseAdminClient() {
  const urlEnv = readFirstSecretEnv(['SUPABASE_URL']);
  const serviceKeyEnv = readFirstSecretEnv(['SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);

  const url = urlEnv.value.replace(/\/+$/, '');
  const serviceKey = serviceKeyEnv.value;

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const fieldReasons: Record<string, string> = {};

  if (!url) {
    missingFields.push('SUPABASE_URL');
    fieldReasons.SUPABASE_URL = 'Secret kosong atau belum diatur.';
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        invalidFields.push('SUPABASE_URL');
        fieldReasons.SUPABASE_URL = 'Protokol URL harus http atau https.';
      }
    } catch {
      invalidFields.push('SUPABASE_URL');
      fieldReasons.SUPABASE_URL = 'Format URL tidak valid.';
    }
  }

  if (!serviceKey) {
    missingFields.push('SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');
    fieldReasons.SERVICE_ROLE_KEY = 'Secret kosong (fallback SUPABASE_SERVICE_ROLE_KEY juga kosong).';
  } else if (serviceKey.length < 20 || /\s/.test(serviceKey)) {
    const keyField = serviceKeyEnv.sourceName || 'SERVICE_ROLE_KEY';
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

  return {
    url,
    serviceKey,
    client: createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

function loadDriveOAuth2Config(): DriveOAuth2Config {
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
    fieldReasons.GOOGLE_OAUTH_CLIENT_ID = 'Secret GOOGLE_OAUTH_CLIENT_ID kosong.';
  } else if (isUrlLikeValue(clientId) || /\s/.test(clientId)) {
    invalidFields.push('GOOGLE_OAUTH_CLIENT_ID');
    fieldReasons.GOOGLE_OAUTH_CLIENT_ID = isUrlLikeValue(clientId)
      ? 'Nilai GOOGLE_OAUTH_CLIENT_ID masih berupa URL lengkap (https://...); isi dengan OAuth Client ID mentah.'
      : 'Nilai GOOGLE_OAUTH_CLIENT_ID mengandung spasi atau karakter tidak valid.';
  }

  if (!clientSecret) {
    missingFields.push('GOOGLE_OAUTH_CLIENT_SECRET');
    fieldReasons.GOOGLE_OAUTH_CLIENT_SECRET = 'Secret GOOGLE_OAUTH_CLIENT_SECRET kosong.';
  } else if (isUrlLikeValue(clientSecret) || /\s/.test(clientSecret)) {
    invalidFields.push('GOOGLE_OAUTH_CLIENT_SECRET');
    fieldReasons.GOOGLE_OAUTH_CLIENT_SECRET = isUrlLikeValue(clientSecret)
      ? 'Nilai GOOGLE_OAUTH_CLIENT_SECRET masih berupa URL lengkap (https://...); isi dengan Client Secret mentah.'
      : 'Nilai GOOGLE_OAUTH_CLIENT_SECRET mengandung spasi atau karakter tidak valid.';
  }

  if (!refreshToken) {
    missingFields.push('GOOGLE_OAUTH_REFRESH_TOKEN');
    fieldReasons.GOOGLE_OAUTH_REFRESH_TOKEN = 'Secret GOOGLE_OAUTH_REFRESH_TOKEN kosong.';
  } else if (isUrlLikeValue(refreshToken) || /\s/.test(refreshToken)) {
    invalidFields.push('GOOGLE_OAUTH_REFRESH_TOKEN');
    fieldReasons.GOOGLE_OAUTH_REFRESH_TOKEN = isUrlLikeValue(refreshToken)
      ? 'Nilai GOOGLE_OAUTH_REFRESH_TOKEN masih berupa URL lengkap (https://...); isi dengan Refresh Token mentah.'
      : 'Nilai GOOGLE_OAUTH_REFRESH_TOKEN mengandung spasi atau karakter tidak valid.';
  }

  if (!rootFolderId) {
    missingFields.push('GOOGLE_DRIVE_FOLDER_ID');
    fieldReasons.GOOGLE_DRIVE_FOLDER_ID =
      'Secret GOOGLE_DRIVE_FOLDER_ID kosong (fallback GOOGLE_DRIVE_ROOT_FOLDER_ID / GOOGLE_DRIVE_ROOT_ID / GOOGLE_ROOT_ID juga kosong).';
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

function sanitizeFileName(rawName?: string | null, fallbackExt = 'bin'): string {
  const last = String(rawName || '').split(/[\\/]/).pop() || '';
  const safe = last.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) return `media-${Date.now()}.${fallbackExt}`;
  return safe.slice(0, 140);
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

function normalizeChatRoomId(rawRoomId: string): string {
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

function canCallerAccessRoom(caller: VerifiedChatCaller, roomId: string): boolean {
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
    const p1 = normalizeParticipantId(raw1);
    const p2 = normalizeParticipantId(raw2);
    return (
      caller.matchIds.has(p1) ||
      caller.matchIds.has(p2) ||
      caller.matchIds.has(normalizeToken(raw1)) ||
      caller.matchIds.has(normalizeToken(raw2))
    );
  }
  return false;
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

async function fetchUsersWargaForCallerVerification(
  client: ReturnType<typeof getSupabaseAdminClient>['client']
): Promise<{ rows: UsersWargaCallerRow[]; errorMessage: string | null }> {
  const selectCandidates = [
    'id, blok_rumah, nama_warga, no_wa, secondary_whatsapp, role, bot_role, jabatan, admin_permission, aktif',
    'id, blok_rumah, nama_warga, no_wa, role, bot_role, jabatan, admin_permission, aktif',
    'blok_rumah, nama_warga, role, bot_role, jabatan, admin_permission, aktif',
    'blok_rumah, nama_warga, role, jabatan, aktif',
    'blok_rumah, nama_warga, role, aktif',
  ];

  let lastError: string | null = null;
  for (const cols of selectCandidates) {
    const { data, error } = await client.from('users_warga').select(cols);
    if (!error && Array.isArray(data)) {
      return { rows: data as UsersWargaCallerRow[], errorMessage: null };
    }
    lastError = error?.message || 'Gagal membaca tabel users_warga';
  }
  return { rows: [], errorMessage: lastError };
}

async function resolveVerifiedSupabaseAuthUser(
  req: Request,
  client: ReturnType<typeof getSupabaseAdminClient>['client']
): Promise<{
  id: string;
  email?: string;
  userMetadata: Record<string, unknown>;
  appMetadata: Record<string, unknown>;
} | null> {
  const authHeader = (req.headers.get('authorization') || '').trim();
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.split('.').length !== 3) return null;

  const anonKey = stripOuterQuotes(Deno.env.get('SUPABASE_ANON_KEY'));
  if (anonKey && token === anonKey) return null;

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user) return null;
    return {
      id: data.user.id,
      email: data.user.email,
      userMetadata: (data.user.user_metadata || {}) as Record<string, unknown>,
      appMetadata: (data.user.app_metadata || {}) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

async function verifyChatCaller(
  req: Request,
  callerHint?: SenderCallerHint | null
): Promise<VerifiedChatCaller> {
  const rawRole = normalizeToken(req.headers.get('x-user-role') || callerHint?.role);
  const rawBlok = (req.headers.get('x-blok-rumah') || callerHint?.blokRumah || '').trim();
  const rawPetugasId = (req.headers.get('x-petugas-id') || callerHint?.petugasId || '').trim();
  const rawJabatan = (req.headers.get('x-admin-jabatan') || callerHint?.jabatan || '').trim();
  const rawPermission = (req.headers.get('x-admin-permission') || callerHint?.adminPermission || '').trim();

  const { client } = getSupabaseAdminClient();
  const verifiedAuthUser = await resolveVerifiedSupabaseAuthUser(req, client);

  const authMetaRole = normalizeToken(
    String(
      verifiedAuthUser?.appMetadata?.role ||
        verifiedAuthUser?.userMetadata?.role ||
        ''
    )
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
    let reqUsername = resolvePengurusUsernameFromHints(rawBlok, rawJabatan, callerHint);
    if (!reqUsername && verifiedAuthUser) {
      const metaIdent = String(
        verifiedAuthUser.userMetadata?.pengurus_username ||
          verifiedAuthUser.userMetadata?.username ||
          verifiedAuthUser.userMetadata?.blok_rumah ||
          ''
      );
      reqUsername = resolvePengurusUsernameFromHints(metaIdent, rawJabatan, callerHint);
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
    const { rows, errorMessage } = await fetchUsersWargaForCallerVerification(client);
    if (errorMessage) {
      throw new Error(`Gagal memverifikasi akun Pengurus pada users_warga: ${errorMessage}`);
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
        const rpcCheck = await client.rpc('validate_login_account_status', payload);
        if (rpcCheck.error || rpcCheck.data === null || rpcCheck.data === undefined) continue;
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
      (rpcActivePengurus === true ? { nama_warga: rpcPengurusNama || callerHint?.namaWarga || knownMeta?.nama } : null) ||
      (hasVerifiedAuthSession && !inactiveAdminRow
        ? {
            nama_warga:
              String(verifiedAuthUser?.userMetadata?.nama_warga || '') ||
              callerHint?.namaWarga ||
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
      uuid: matchedAdminRow?.id || callerHint?.userId || verifiedAuthUser?.id,
      blok: matchedAdminRow?.blok_rumah || knownMeta?.linkedBlock,
      name: matchedAdminRow?.nama_warga || callerHint?.namaWarga || knownMeta?.nama,
      username: reqUsername,
      phones: [matchedAdminRow?.no_wa, matchedAdminRow?.secondary_whatsapp, callerHint?.noWa],
    });
    if (knownMeta?.linkedBlock) {
      const linkedCanon = canonicalBlockKey(knownMeta.linkedBlock).toLowerCase();
      if (linkedCanon) {
        matchIds.add(`warga:${linkedCanon}`);
        matchIds.add(linkedCanon);
      }
    }

    const displayName = String(
      verifiedMatch.nama_warga || rpcPengurusNama || callerHint?.namaWarga || knownMeta?.nama || 'Pengurus'
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
      (callerHint?.senderId?.toLowerCase().startsWith('warga:')
        ? callerHint.senderId.slice('warga:'.length)
        : '') ||
      String(verifiedAuthUser?.userMetadata?.blok_rumah || '');
    const canonBlok = canonicalBlockKey(rawWargaBlockCandidate);
    const uuidCandidate = String(
      callerHint?.userId ||
        verifiedAuthUser?.id ||
        (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawWargaBlockCandidate)
          ? rawWargaBlockCandidate
          : '')
    )
      .trim()
      .toLowerCase();
    const phoneCandidates = new Set<string>(buildPhoneMatchTokens(callerHint?.noWa || rawWargaBlockCandidate));
    const nameCandidate = normalizeToken(callerHint?.namaWarga || (!canonBlok ? rawWargaBlockCandidate : ''));

    if (!canonBlok && !uuidCandidate && phoneCandidates.size === 0 && !nameCandidate) {
      throw Object.assign(
        new Error('Identitas Warga tidak lengkap (blok_rumah, UUID, maupun nomor HP/username tidak tersedia).'),
        { statusCode: 401 }
      );
    }

    const { rows, errorMessage } = await fetchUsersWargaForCallerVerification(client);
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
        const dirCheck = await client.rpc('get_chat_directory');
        if (!dirCheck.error && Array.isArray(dirCheck.data)) {
          const canonLower = resolvedCanonBlok.toLowerCase();
          const dirMatch = (dirCheck.data as Array<Record<string, unknown>>).find((entry) => {
            const entryRole = normalizeToken(String(entry.role || ''));
            if (entryRole && entryRole !== 'warga') return false;
            const entryBlok = canonicalBlockKey(
              String(entry.blok_rumah || entry.blok_or_code || '')
            );
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
        // Lanjutkan ke pengecekan akhir
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
            )}). Gunakan portal Pengurus untuk mengakses lampiran.`
          ),
          { statusCode: 403 }
        );
      }
      if (errorMessage) {
        throw new Error(`Gagal memverifikasi akun Warga pada users_warga: ${errorMessage}`);
      }
      throw Object.assign(
        new Error(
          `Akun Warga "${resolvedCanonBlok || rawWargaBlockCandidate || callerHint?.namaWarga || '-'}" tidak ditemukan aktif di users_warga maupun direktori chat (baris users_warga=${rows.length}).`
        ),
        { statusCode: 403 }
      );
    }

    const canonLower = (resolvedCanonBlok || rawWargaBlockCandidate).toLowerCase();
    const rawLower = normalizeToken(rawWargaBlockCandidate);
    const matchIds = new Set<string>([`warga:${canonLower}`]);
    if (rawLower) matchIds.add(`warga:${rawLower}`);

    addIdentityVariants(matchIds, 'warga', {
      uuid: activeWargaRow?.id || callerHint?.userId || verifiedAuthUser?.id,
      blok: activeWargaRow?.blok_rumah || resolvedCanonBlok,
      name: verifiedDisplayName || activeWargaRow?.nama_warga || callerHint?.namaWarga,
      username: callerHint?.username,
      phones: [activeWargaRow?.no_wa, activeWargaRow?.secondary_whatsapp, callerHint?.noWa],
    });

    return {
      role: 'warga',
      senderId: `warga:${canonLower}`,
      slug: canonLower.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(
        verifiedDisplayName || callerHint?.namaWarga || `Warga ${resolvedCanonBlok || rawWargaBlockCandidate}`
      ).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'petugas' || effectiveRole === 'keamanan') {
    const lookupToken = normalizeToken(
      rawPetugasId || rawBlok || callerHint?.namaWarga || callerHint?.username
    );
    if (!lookupToken) {
      throw Object.assign(new Error('Identitas Petugas Keamanan tidak lengkap.'), { statusCode: 401 });
    }

    const { data, error } = await client
      .from('petugas_keamanan')
      .select('id, nama, username, aktif')
      .eq('aktif', true);

    if (error) {
      throw new Error(`Gagal memverifikasi akun Keamanan: ${error.message}`);
    }

    const matched = (data || []).find(
      (row) =>
        normalizeToken(String(row.id || '')) === lookupToken ||
        normalizeToken(String(row.username || '')) === lookupToken ||
        normalizeToken(String(row.nama || '')) === lookupToken
    );

    if (!matched) {
      throw Object.assign(
        new Error(`Akun Petugas Keamanan "${rawPetugasId || rawBlok}" tidak aktif atau tidak ditemukan.`),
        { statusCode: 403 }
      );
    }

    const petIdLower = normalizeToken(String(matched.id));
    const matchIds = new Set<string>([
      `petugas:${petIdLower}`,
      `keamanan:${petIdLower}`,
      petIdLower,
    ]);
    if (rawBlok) {
      matchIds.add(`petugas:${normalizeToken(rawBlok)}`);
      matchIds.add(`keamanan:${normalizeToken(rawBlok)}`);
    }
    if (matched.username) {
      const uTok = normalizeToken(String(matched.username));
      matchIds.add(`petugas:${uTok}`);
      matchIds.add(`keamanan:${uTok}`);
      matchIds.add(uTok);
    }
    if (matched.nama) {
      const nTok = normalizeToken(String(matched.nama));
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

  throw Object.assign(new Error('Sesi portal aktif diperlukan untuk mengakses lampiran chat.'), {
    statusCode: 401,
  });
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}



const oauth2TokenCache = new Map<string, { accessToken: string; expiresAtMs: number }>();

function buildOAuth2CacheKey(clientId: string, clientSecret: string, refreshToken: string): string {
  return `${clientId}::${clientSecret.slice(0, 6)}:${clientSecret.slice(-6)}::${refreshToken.slice(-16)}`;
}

async function exchangeOAuth2RefreshToken(
  cfg: DriveOAuth2Config,
  forceRefresh = false
): Promise<string> {
  const clientId = stripOuterQuotes(cfg.clientId);
  const clientSecret = stripOuterQuotes(cfg.clientSecret);
  const refreshToken = stripOuterQuotes(cfg.refreshToken);

  const missingFields: string[] = [];
  const invalidFields: string[] = [];
  const fieldReasons: Record<string, string> = {};

  if (!clientId) {
    missingFields.push(cfg.clientIdField);
    fieldReasons[cfg.clientIdField] = `Secret ${cfg.clientIdField} kosong setelah sanitasi.`;
  } else if (isUrlLikeValue(clientId) || /\s/.test(clientId)) {
    invalidFields.push(cfg.clientIdField);
    fieldReasons[cfg.clientIdField] = `Format ${cfg.clientIdField} tidak valid.`;
  }
  if (!clientSecret) {
    missingFields.push(cfg.clientSecretField);
    fieldReasons[cfg.clientSecretField] = `Secret ${cfg.clientSecretField} kosong setelah sanitasi.`;
  } else if (isUrlLikeValue(clientSecret) || /\s/.test(clientSecret)) {
    invalidFields.push(cfg.clientSecretField);
    fieldReasons[cfg.clientSecretField] = `Format ${cfg.clientSecretField} tidak valid.`;
  }
  if (!refreshToken) {
    missingFields.push(cfg.refreshTokenField);
    fieldReasons[cfg.refreshTokenField] = `Secret ${cfg.refreshTokenField} kosong setelah sanitasi.`;
  } else if (isUrlLikeValue(refreshToken) || /\s/.test(refreshToken)) {
    invalidFields.push(cfg.refreshTokenField);
    fieldReasons[cfg.refreshTokenField] = `Format ${cfg.refreshTokenField} tidak valid.`;
  }
  if (missingFields.length > 0 || invalidFields.length > 0) {
    throw buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields,
      invalidFields,
      fieldReasons,
    });
  }

  const cacheKey = buildOAuth2CacheKey(clientId, clientSecret, refreshToken);
  if (!forceRefresh) {
    const cached = oauth2TokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAtMs) {
      return cached.accessToken;
    }
  } else {
    oauth2TokenCache.delete(cacheKey);
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    let oauthErrCode = '';
    let oauthErrDesc = '';
    if (rawText.startsWith('{')) {
      try {
        const parsed = JSON.parse(rawText) as { error?: string; error_description?: string };
        oauthErrCode = String(parsed.error || '').trim();
        oauthErrDesc = String(parsed.error_description || '').trim();
      } catch {
        // Gunakan rawText
      }
    }
    const detail = [oauthErrCode, oauthErrDesc].filter(Boolean).join(': ') || rawText.slice(0, 180);
    const nextInvalidFields: string[] = [];
    const nextFieldReasons: Record<string, string> = {};

    if (/invalid_client/i.test(oauthErrCode) || /client/i.test(oauthErrDesc)) {
      nextInvalidFields.push(cfg.clientIdField, cfg.clientSecretField);
      nextFieldReasons[cfg.clientIdField] = `Google OAuth2 menolak client_id (${res.status}): ${detail}`;
      nextFieldReasons[cfg.clientSecretField] = `Periksa kecocokan ${cfg.clientSecretField} dengan ${cfg.clientIdField}.`;
    } else {
      nextInvalidFields.push(cfg.refreshTokenField);
      nextFieldReasons[cfg.refreshTokenField] =
        `Pertukaran refresh_token ke access_token ditolak Google OAuth2 (${res.status}): ${detail || 'invalid_grant'}. Pastikan Refresh Token masih aktif dan dibuat oleh Client ID & Client Secret yang sama.`;
    }

    throw buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields: nextInvalidFields,
      fieldReasons: nextFieldReasons,
    });
  }

  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  const accessToken = stripOuterQuotes(json.access_token);
  if (!accessToken) {
    oauth2TokenCache.delete(cacheKey);
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }

  const expiresInSec = Number(json.expires_in || 3600);
  const ttlMs = Math.max(60, (Number.isFinite(expiresInSec) ? expiresInSec : 3600) - 90) * 1000;
  oauth2TokenCache.set(cacheKey, { accessToken, expiresAtMs: Date.now() + ttlMs });
  return accessToken;
}

async function getDriveOAuth2AccessToken(cfg: DriveOAuth2Config, forceRefresh = false): Promise<string> {
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
        [folderField]: `Folder atau berkas Google Drive (${driveCfg?.rootFolderId || '-'}) tidak ditemukan / tidak dapat diakses oleh akun OAuth2 (${errInfo.status} / notFound: ${errInfo.message}).`,
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

function resolveRoomDrivePermissionScope(roomId: string): DrivePermissionScope {
  const clean = String(roomId || '').trim();
  if (clean === 'grup_pengurus' || clean.startsWith('dm:')) {
    return 'restricted_private';
  }
  return 'anyone_link';
}

async function stripPublicAnyonePermissions(
  accessToken: string,
  fileId: string
): Promise<void> {
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}/permissions?supportsAllDrives=true&fields=permissions(id,type,role)`,
    {
      cache: 'no-store',
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
          cache: 'no-store',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      ).catch(() => undefined);
    }
  }
}

async function applyRoomDrivePermissionPolicy(
  accessToken: string,
  fileId: string,
  roomId: string,
  driveCfg?: DriveOAuth2Config
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
      throw buildDriveApiFailureError(
        'Gagal menetapkan izin baca publik tautan Google Drive',
        permErr,
        driveCfg
      );
    }
    return 'anyone_link';
  }

  await stripPublicAnyonePermissions(accessToken, fileId);
  return 'restricted_private';
}

async function recordUnauthorizedDriveAccessAudit(params: {
  req: Request;
  roomId?: string;
  fileId?: string;
  messageId?: string;
  reason: string;
}): Promise<void> {
  try {
    const { client } = getSupabaseAdminClient();
    const actorRole = normalizeToken(params.req.headers.get('x-user-role')) || 'anonymous';
    const actorBlok = (params.req.headers.get('x-blok-rumah') || '').trim();
    const actorPetugas = (params.req.headers.get('x-petugas-id') || '').trim();
    const actorId = actorBlok || actorPetugas || 'anonymous';

    await client.from('audit_logs').insert({
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
    });
  } catch {
    // Jangan gagalkan respons 403 bila penulisan audit mengalami kendala jaringan
  }
}

async function getPrivateStreamSigningSecret(): Promise<CryptoKey> {
  const signingEnv = readFirstSecretEnv([
    'CHAT_MEDIA_SIGNING_SECRET',
    'SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  if (!signingEnv.value) {
    throw buildCredentialError({
      scope: 'Penandatanganan Media Privat',
      missingFields: ['CHAT_MEDIA_SIGNING_SECRET (atau SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY)'],
      invalidFields: [],
    });
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingEnv.value),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signPrivateStreamToken(payload: {
  fileId: string;
  roomId: string;
  role: string;
  blokRumah: string;
  petugasId: string;
  exp: number;
}): Promise<string> {
  const key = await getPrivateStreamSigningSecret();
  const canonical = JSON.stringify({
    f: payload.fileId,
    r: payload.roomId,
    ro: payload.role,
    b: payload.blokRumah,
    p: payload.petugasId,
    e: payload.exp,
  });
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
  return base64UrlEncode(new Uint8Array(sig));
}

async function verifyPrivateStreamToken(
  payload: {
    fileId: string;
    roomId: string;
    role: string;
    blokRumah: string;
    petugasId: string;
    exp: number;
  },
  signatureB64Url: string
): Promise<boolean> {
  if (!signatureB64Url || !Number.isFinite(payload.exp) || Date.now() > payload.exp) {
    return false;
  }
  try {
    const expected = await signPrivateStreamToken(payload);
    if (expected.length !== signatureB64Url.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ signatureB64Url.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
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
  'id, room_id, sender_id, sender_user_id, recipient_id, target_user_id, attachment_drive_file_id, drive_file_id, attachment_id',
  'id, room_id, sender_id, sender_user_id, recipient_id, target_user_id, attachment_drive_file_id',
  'id, room_id, sender_id, recipient_id, attachment_drive_file_id',
];

async function querySingleChatMessageByColumn(
  client: ReturnType<typeof getSupabaseAdminClient>['client'],
  column: string,
  value: string
): Promise<PrivateMessageLookupRow | null> {
  if (!value) return null;
  for (const selectExpr of MESSAGE_SELECT_CANDIDATES) {
    const { data, error } = await client
      .from('community_chat_messages')
      .select(selectExpr)
      .eq(column, value)
      .limit(1)
      .maybeSingle();

    if (!error) {
      return (data as PrivateMessageLookupRow | null) || null;
    }

    const errMsg = String(error.message || '');
    // Jika kolom yang di-select atau di-filter belum ada di tabel, coba fallback kolom yang tersedia
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

async function lookupPrivateMessageRecord(
  client: ReturnType<typeof getSupabaseAdminClient>['client'],
  params: { messageId: string; fileId: string; attachmentId: string }
): Promise<PrivateMessageLookupRow | null> {
  if (
    params.messageId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.messageId)
  ) {
    const byId = await querySingleChatMessageByColumn(client, 'id', params.messageId);
    if (byId) return byId;
  }

  if (params.fileId) {
    const byAttachDriveId = await querySingleChatMessageByColumn(
      client,
      'attachment_drive_file_id',
      params.fileId
    );
    if (byAttachDriveId) return byAttachDriveId;

    const byDriveId = await querySingleChatMessageByColumn(client, 'drive_file_id', params.fileId);
    if (byDriveId) return byDriveId;
  }

  const attachmentLookup = params.attachmentId || params.fileId;
  if (attachmentLookup) {
    const byAttachmentId = await querySingleChatMessageByColumn(
      client,
      'attachment_id',
      attachmentLookup
    );
    if (byAttachmentId) return byAttachmentId;

    if (
      params.attachmentId &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        params.attachmentId
      )
    ) {
      const byMsgId = await querySingleChatMessageByColumn(client, 'id', params.attachmentId);
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
      { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } }
    ).catch(() => null);
    if (!folderRes || !folderRes.ok) continue;

    const folderJson = (await folderRes.json().catch(() => ({}))) as {
      name?: string;
      parents?: string[];
    };
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

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return jsonResponse(req, 405, {
      ok: false,
      error: 'Method tidak diizinkan.',
      reason: `Metode HTTP ${req.method} tidak didukung untuk akses lampiran privat.`,
    });
  }

  let stage = 'parse_request';
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const action = String(body.action || url.searchParams.get('action') || '').trim().toLowerCase();
  let fileId = String(
    body.fileId ||
      body.driveFileId ||
      body.drive_file_id ||
      url.searchParams.get('fileId') ||
      url.searchParams.get('driveFileId') ||
      url.searchParams.get('drive_file_id') ||
      ''
  ).trim();
  const attachmentId = String(
    body.attachmentId ||
      body.attachment_id ||
      url.searchParams.get('attachmentId') ||
      url.searchParams.get('attachment_id') ||
      ''
  ).trim();
  let rawRoomId = String(body.roomId || url.searchParams.get('roomId') || '').trim();
  const messageId = String(
    body.messageId ||
      body.message_id ||
      url.searchParams.get('messageId') ||
      url.searchParams.get('message_id') ||
      ''
  ).trim();
  const modeRaw = String(body.mode || url.searchParams.get('mode') || 'stream').trim().toLowerCase();
  const mode: 'stream' | 'download' | 'thumbnail' =
    modeRaw === 'download' ? 'download' : modeRaw === 'thumbnail' ? 'thumbnail' : 'stream';

  try {
    stage = 'validate_supabase_secrets';
    const { client, url: supabaseUrl } = getSupabaseAdminClient();

    // Dukungan URL bertanda tangan jangka pendek untuk tag <video>/<audio>/<img> native Range seeking
    let effectiveReq = req;
    const sig = url.searchParams.get('sig') || '';
    const expParam = Number(url.searchParams.get('exp') || '0');
    if ((req.method === 'GET' || req.method === 'HEAD') && sig) {
      stage = 'verify_stream_signature';
      const ro = url.searchParams.get('ro') || '';
      const b = url.searchParams.get('b') || '';
      const p = url.searchParams.get('p') || '';
      const sigValid = await verifyPrivateStreamToken(
        { fileId, roomId: rawRoomId, role: ro, blokRumah: b, petugasId: p, exp: expParam },
        sig
      );
      if (!sigValid) {
        const reason = 'Tanda tangan URL aliran media privat tidak valid atau telah kedaluwarsa.';
        await recordUnauthorizedDriveAccessAudit({
          req,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason,
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
      }
      const syntheticHeaders = new Headers(req.headers);
      syntheticHeaders.set('x-user-role', ro);
      syntheticHeaders.set('x-blok-rumah', b);
      syntheticHeaders.set('x-petugas-id', p);
      effectiveReq = new Request(req.url, { method: req.method, headers: syntheticHeaders });
    }

    stage = 'verify_caller';
    let caller: VerifiedChatCaller;
    const senderHint =
      body.sender && typeof body.sender === 'object' ? (body.sender as SenderCallerHint) : null;
    try {
      caller = await verifyChatCaller(effectiveReq, senderHint);
    } catch (authErr) {
      const typedAuthErr = authErr as CredentialValidationError;
      if (typedAuthErr.missingFields?.length || typedAuthErr.invalidFields?.length) {
        throw authErr;
      }
      const statusCode = typeof typedAuthErr?.statusCode === 'number' ? typedAuthErr.statusCode : 403;
      const reason = authErr instanceof Error ? authErr.message : 'Identitas peminta tidak valid.';
      await recordUnauthorizedDriveAccessAudit({
        req: effectiveReq,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      return jsonResponse(req, statusCode, {
        ok: false,
        stage,
        error: 'Akses lampiran privat ditolak.',
        reason,
      });
    }

    stage = 'lookup_message_record';
    if (
      messageId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId) &&
      !fileId
    ) {
      return jsonResponse(req, 400, {
        ok: false,
        stage,
        error: 'Format messageId tidak valid.',
        reason: 'Parameter messageId harus berupa UUID valid atau sertakan drive_file_id/fileId.',
      });
    }

    const dbMessageRow = await lookupPrivateMessageRecord(client, {
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
          req: effectiveReq,
          roomId: dbMessageRow.room_id,
          fileId,
          messageId,
          reason,
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
      }
      const dbRoom = normalizeChatRoomId(String(dbMessageRow.room_id || ''));
      if (rawRoomId && dbRoom && normalizeChatRoomId(rawRoomId) !== dbRoom) {
        const reason = 'roomId yang diminta tidak cocok dengan ruang asal pesan pada database.';
        await recordUnauthorizedDriveAccessAudit({
          req: effectiveReq,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason,
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
      }
      if (dbRoom) rawRoomId = dbRoom;
    } else if (!fileId && (messageId || attachmentId)) {
      const reason =
        'Record pesan atau lampiran chat tidak ditemukan di database berdasarkan messageId maupun attachment_id.';
      await recordUnauthorizedDriveAccessAudit({
        req: effectiveReq,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      return jsonResponse(req, 404, {
        ok: false,
        stage,
        error: 'Lampiran chat tidak ditemukan.',
        reason,
      });
    }

    const roomId = normalizeChatRoomId(rawRoomId);
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId) || !roomId) {
      const reason = !/^[a-zA-Z0-9_-]{10,120}$/.test(fileId)
        ? `ID berkas Google Drive tidak valid atau kosong ("${fileId || '-'}").`
        : `ID ruang chat tidak valid ("${rawRoomId || '-'}").`;
      await recordUnauthorizedDriveAccessAudit({
        req: effectiveReq,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason,
      });
      return jsonResponse(req, 400, {
        ok: false,
        stage,
        error: 'Parameter akses berkas privat tidak valid.',
        reason,
      });
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
        req: effectiveReq,
        roomId,
        fileId,
        messageId,
        reason: denyReason,
      });
      return jsonResponse(req, 403, {
        ok: false,
        stage,
        error: 'Akses lampiran privat ditolak.',
        reason: denyReason,
      });
    }

    stage = 'validate_drive_secrets';
    const driveCfg = loadDriveOAuth2Config();

    stage = 'authenticate_drive';
    const accessToken = await getDriveOAuth2AccessToken(driveCfg);

    stage = 'fetch_drive_metadata';
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,thumbnailLink,webViewLink`,
      { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      const metaErr = await parseGoogleDriveApiError(metaRes);
      if (metaRes.status === 404) {
        return jsonResponse(req, 404, {
          ok: false,
          stage,
          error: 'Berkas lampiran tidak ditemukan di Google Drive.',
          reason: `Google Drive API mengembalikan 404 untuk fileId "${fileId}": ${metaErr.message}`,
        });
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
      webViewLink?: string;
    };
    if (fileMeta.trashed) {
      return jsonResponse(req, 404, {
        ok: false,
        stage,
        error: 'Berkas telah dihapus dari Google Drive.',
        reason: `Berkas Google Drive "${fileMeta.name || fileId}" berada di Trash/Sampah.`,
      });
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
          req: effectiveReq,
          roomId,
          fileId,
          messageId,
          reason,
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Akses lampiran privat ditolak.',
          reason,
        });
      }
    }

    const expectedScope = resolveRoomDrivePermissionScope(roomId);

    // Opsional: sinkronkan/validasi izin file Drive sesuai jenis ruang chat (`anyone_link` vs `restricted_private`)
    if (req.method === 'POST' && action === 'sync_permission') {
      stage = 'sync_drive_permission';
      const appliedScope = await applyRoomDrivePermissionPolicy(accessToken, fileId, roomId, driveCfg);
      return jsonResponse(req, 200, {
        ok: true,
        fileId,
        roomId,
        drivePermissionScope: appliedScope,
        driveWebViewLink:
          appliedScope === 'anyone_link'
            ? fileMeta.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
            : null,
      });
    }

    // Terbitkan URL stream sementara untuk tag <video>/<audio>/<img> pada berkas privat
    if (req.method === 'POST' && action === 'mint_stream_url') {
      stage = 'mint_stream_url';
      const exp = Date.now() + STREAM_URL_TTL_MS;
      const roleVal = (effectiveReq.headers.get('x-user-role') || caller.role).trim();
      const blokVal = (
        effectiveReq.headers.get('x-blok-rumah') ||
        senderHint?.blokRumah ||
        caller.slug ||
        ''
      ).trim();
      const petVal = (
        effectiveReq.headers.get('x-petugas-id') ||
        senderHint?.petugasId ||
        ''
      ).trim();
      const signedSig = await signPrivateStreamToken({
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

      const endpointBase = url.pathname.startsWith('/functions/v1/')
        ? `${url.origin}${url.pathname}`
        : `${supabaseUrl}/functions/v1/chat-drive-private-access`;

      return jsonResponse(req, 200, {
        ok: true,
        streamUrl: `${endpointBase}?${streamParams.toString()}`,
        expiresAt: new Date(exp).toISOString(),
        mimeType: fileMeta.mimeType || 'application/octet-stream',
        fileName: fileMeta.name || `lampiran-${fileId}`,
        sizeBytes: Number(fileMeta.size || 0),
        drivePermissionScope: expectedScope,
      });
    }

    // Mode thumbnail privat via OAuth2
    if (mode === 'thumbnail' && fileMeta.thumbnailLink) {
      stage = 'stream_thumbnail';
      const thumbRes = await fetch(fileMeta.thumbnailLink, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (thumbRes.ok) {
        const respHeaders = new Headers(corsHeaders);
        respHeaders.set('Content-Type', thumbRes.headers.get('content-type') || 'image/jpeg');
        respHeaders.set('Cache-Control', 'private, no-store');
        return new Response(req.method === 'HEAD' ? null : thumbRes.body, {
          status: 200,
          headers: respHeaders,
        });
      }
    }

    // Alirkan konten file dengan meneruskan header Range untuk video/audio seeking
    stage = 'stream_drive_media';
    const rangeHeader = (req.headers.get('range') || '').trim();
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
        cache: 'no-store',
        headers: driveFetchHeaders,
      }
    );

    if (!mediaRes.ok && mediaRes.status !== 206) {
      const mediaErr = await parseGoogleDriveApiError(mediaRes);
      if (mediaRes.status === 416) {
        return jsonResponse(req, 416, {
          ok: false,
          stage,
          error: 'Rentang byte berkas Google Drive tidak valid (416).',
          reason: mediaErr.message,
        });
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

    const respHeaders = new Headers(corsHeaders);
    respHeaders.set('Content-Type', resolvedCt);
    respHeaders.set('Accept-Ranges', 'bytes');
    respHeaders.set('Cache-Control', 'private, no-store');
    respHeaders.set(
      'Content-Disposition',
      resolveForwardedContentDisposition(
        mediaRes.headers.get('content-disposition'),
        rawFileName,
        mode
      )
    );

    const contentRange = mediaRes.headers.get('content-range');
    if (contentRange) respHeaders.set('Content-Range', contentRange);
    const contentLength = mediaRes.headers.get('content-length') || fileMeta.size;
    if (contentLength) respHeaders.set('Content-Length', String(contentLength));

    if (req.method === 'HEAD') {
      await mediaRes.body?.cancel().catch(() => undefined);
      return new Response(null, { status: mediaRes.status, headers: respHeaders });
    }

    return new Response(mediaRes.body, {
      status: mediaRes.status,
      headers: respHeaders,
    });
  } catch (err) {
    const typedErr = err as {
      statusCode?: number;
      missingFields?: string[];
      invalidFields?: string[];
      fieldReasons?: Record<string, string>;
    };
    const statusCode = typeof typedErr?.statusCode === 'number' ? typedErr.statusCode : 500;
    const errorMessage =
      err instanceof Error ? err.message : 'Gagal mengakses berkas privat Google Drive.';
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

    console.error('[chat-drive-private-access] failed', {
      stage,
      statusCode,
      errorMessage,
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
      roomId: rawRoomId || null,
      fileId: fileId || null,
    });

    return jsonResponse(req, statusCode, {
      ok: false,
      stage,
      error: errorMessage,
      reason: detailReason,
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
    });
  }
});
