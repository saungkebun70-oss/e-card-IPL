/**
 * Supabase Edge Function: chat-media-transfer (Standalone Ready-to-Deploy)
 *
 * Fitur:
 * - Memindahkan lampiran chat non-video (foto kamera, galeri, dokumen) dari bucket transit `chat-transit`
 *   ke Google Drive Service Account (`saung-kebun-drive@saung-kebun-87b23.iam.gserviceaccount.com`),
 *   menerapkan izin Drive otomatis sesuai jenis ruang chat (`anyone_link` vs `restricted_private`),
 *   lalu menghapus file sementara dari `chat-transit` dan memperbarui metadata `community_chat_messages`.
 * - Menolak tegas semua ukuran file video agar tidak melewati bucket `chat-transit`.
 * - Mendukung seluruh alias secret server & pelaporan field spesifik bila kredensial kosong/tidak valid.
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
  blokRumah?: string;
  pengurusUsername?: string;
  namaWarga?: string;
  jabatan?: string;
  adminPermission?: string;
  petugasId?: string;
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

type DriveServiceAccountConfig = DriveAuthConfig;

type DrivePermissionScope = 'anyone_link' | 'restricted_private';

interface CredentialValidationError extends Error {
  statusCode?: number;
  missingFields?: string[];
  invalidFields?: string[];
  fieldReasons?: Record<string, string>;
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

interface KnownPengurusMeta {
  username: string;
  nama: string;
  jabatan: string;
  linkedBlock: string;
  permission: 'full' | 'add_only';
}

const ALLOWED_STATIC_ORIGINS = new Set([
  'https://e-card-ipl.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

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

const MAX_NON_VIDEO_TRANSIT_BYTES = 25 * 1024 * 1024; // 25 MB

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
  let allowedOrigin = '*';

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
        host.endsWith('.run.app')
      ) {
        allowedOrigin = origin;
      }
    } catch {
      allowedOrigin = '*';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, range, x-user-role, x-blok-rumah, x-petugas-id, x-admin-permission, x-admin-jabatan, x-sender-id, x-pengurus-username',
    'Access-Control-Expose-Headers':
      'Content-Range, Content-Length, Accept-Ranges, Content-Disposition, Content-Type',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function jsonResponse(
  req: Request,
  status: number,
  payload: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(payload), {
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
    const cleaned = stripOuterQuotes(Deno.env.get(name));
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

  // Dukungan bila seluruh JSON Service Account tertempel ke secret private key
  const parsedJson = extractServiceAccountJson(clean);
  if (parsedJson?.privateKey && parsedJson.privateKey.trim()) {
    clean = stripOuterQuotes(parsedJson.privateKey);
  }

  // Tangani string ter-escape ganda hasil JSON serialization (mis. "\"-----BEGIN...\\n...\"")
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

  // Normalkan \r\n, \n, \r (baik literal ter-escape maupun karakter asli) menjadi \n
  clean = clean
    .replace(/\\+r\\+n/g, '\n')
    .replace(/\\+n/g, '\n')
    .replace(/\\+r/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Bersihkan kutip luar dan karakter kontrol di luar/sekitar PEM (pertahankan \n untuk pemisahan baris)
  clean = stripOuterQuotes(clean).replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '');

  // Ambil hanya blok PEM PKCS#8 agar spasi/karakter kontrol/teks liar di luar BEGIN..END terbuang
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

  // Deteksi bila kunci masih berformat PKCS#1 (BEGIN RSA PRIVATE KEY) agar pesan validasi akurat
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

  // Rapikan batas header/footer PEM umum bila salah satu penanda tidak lengkap
  return clean
    .replace(/(-----BEGIN [A-Z0-9 ]+-----)\s*/g, '$1\n')
    .replace(/\s*(-----END [A-Z0-9 ]+-----)/g, '\n$1')
    .replace(/\n{2,}/g, '\n')
    .trim();
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

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const match = pem.match(
    /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/
  );
  const rawBody = match ? match[1] : pem;
  const cleaned = rawBody
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\+[rn]/gi, '')
    .replace(/[\s\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]+/g, '');

  if (!cleaned) {
    throw new Error('Body base64 di dalam blok PRIVATE KEY kosong.');
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new Error('Body PEM mengandung karakter non-base64.');
  }

  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
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

const DEFAULT_DRIVE_CLIENT_EMAIL = 'saung-kebun-drive@saung-kebun-87b23.iam.gserviceaccount.com';
const DEFAULT_DRIVE_ROOT_FOLDER_ID = '1708f9PjDgjOUC6pEdyirmRdPhQCtd_uz';

function loadDriveServiceAccountConfig(): DriveAuthConfig {
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

  const embeddedJson =
    (jsonEnv.value ? extractServiceAccountJson(jsonEnv.value) : null) ||
    (keyEnv.value ? extractServiceAccountJson(keyEnv.value) : null);
  const clientEmail = (emailEnv.value || embeddedJson?.clientEmail || DEFAULT_DRIVE_CLIENT_EMAIL)
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  const privateKey = keyEnv.value ? normalizePrivateKeyPem(keyEnv.value) : '';
  const privateKeyId = (keyIdEnv.value || embeddedJson?.privateKeyId || '')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  const rootFolderId = (folderEnv.value || DEFAULT_DRIVE_ROOT_FOLDER_ID)
    .replace(/[\u0000-\u001F\u007F\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();

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
  } else if (privateKey.includes('-----BEGIN RSA PRIVATE KEY-----')) {
    invalidFields.push(keyField);
    fieldReasons[keyField] =
      'Terdeteksi format PKCS#1 (BEGIN RSA PRIVATE KEY); WebCrypto membutuhkan PKCS#8 (BEGIN PRIVATE KEY) dari JSON Service Account Google.';
  } else if (
    !privateKey.includes('-----BEGIN PRIVATE KEY-----') ||
    !privateKey.includes('-----END PRIVATE KEY-----')
  ) {
    invalidFields.push(keyField);
    fieldReasons[keyField] =
      'Harus berisi blok utuh -----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY----- (format PKCS#8).';
  } else {
    try {
      const keyBuffer = pemToArrayBuffer(privateKey);
      if (keyBuffer.byteLength < 64) {
        invalidFields.push(keyField);
        fieldReasons[keyField] = `Panjang byte kunci privat terlalu pendek (${keyBuffer.byteLength} byte, minimal 64 byte).`;
      }
    } catch (decodeErr) {
      const decodeDetail =
        decodeErr instanceof Error ? decodeErr.message : 'gagal decode base64 PEM';
      invalidFields.push(keyField);
      fieldReasons[keyField] = `Decode base64 kunci privat gagal (${decodeDetail}).`;
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

function isVideoMedia(mimeType?: string | null, fileName?: string | null): boolean {
  const cleanMime = String(mimeType || '').trim().toLowerCase();
  const cleanName = String(fileName || '').trim().toLowerCase();
  if (cleanMime.startsWith('video/')) return true;
  if (VIDEO_MIME_SET.has(cleanMime)) return true;
  if (VIDEO_EXTENSION_REGEX.test(cleanName)) return true;
  return false;
}

function classifyNonVideoAttachmentType(mimeType?: string | null, fileName?: string | null): 'photo' | 'document' {
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
  const month = parts.find((p) => p.type === 'month')?.value || String(baseDate.getUTCMonth() + 1).padStart(2, '0');
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
    const p1 = normalizeParticipantId(body.slice(0, idx));
    const p2 = normalizeParticipantId(body.slice(idx + 2));
    return caller.matchIds.has(p1) || caller.matchIds.has(p2);
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

    const matchIds = new Set<string>([`admin:${reqUsername}`]);
    if (reqUsername === 'andriansyah') {
      matchIds.add('admin:admin');
      matchIds.add('admin:bendahara');
    }
    if (reqUsername === 'bpiwan') matchIds.add('admin:paiwan');

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
    if (!canonBlok) {
      throw Object.assign(new Error('Blok rumah Warga tidak valid.'), { statusCode: 401 });
    }

    const { rows, errorMessage } = await fetchUsersWargaForCallerVerification(client);
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
        const dirCheck = await client.rpc('get_chat_directory');
        if (!dirCheck.error && Array.isArray(dirCheck.data)) {
          const canonLower = canonBlok.toLowerCase();
          const dirMatch = (dirCheck.data as Array<Record<string, unknown>>).find((entry) => {
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
        // Lanjutkan ke pengecekan akhir
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
      if (errorMessage) {
        throw new Error(`Gagal memverifikasi akun Warga pada users_warga: ${errorMessage}`);
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
      displayName: String(verifiedDisplayName || callerHint?.namaWarga || `Warga ${canonBlok}`).trim(),
      matchIds,
    };
  }

  if (effectiveRole === 'petugas' || effectiveRole === 'keamanan') {
    const lookupToken = normalizeToken(rawPetugasId || rawBlok);
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
    ]);
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
  const { client } = getSupabaseAdminClient();
  const { data, error } = await client
    .from('community_chat_messages')
    .select('id, room_id, sender_id')
    .eq('id', messageId)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal memeriksa kepemilikan pesan: ${error.message}`);
  }
  if (!data) {
    throw Object.assign(new Error('Pesan chat tidak ditemukan.'), { statusCode: 404 });
  }
  const rowRoom = normalizeChatRoomId(String(data.room_id || ''));
  if (rowRoom !== roomId) {
    throw Object.assign(new Error('Pesan tidak sesuai dengan ruang chat yang diminta.'), {
      statusCode: 403,
    });
  }
  const rowSender = normalizeParticipantId(String(data.sender_id || ''));
  if (caller.role !== 'admin' && !caller.matchIds.has(rowSender)) {
    throw Object.assign(new Error('Anda tidak berhak mengubah lampiran pesan ini.'), {
      statusCode: 403,
    });
  }
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
  if (caller.role === 'admin' && !clean.startsWith('admin/') && !clean.startsWith(expectedPrefix)) {
    throw Object.assign(new Error('Path transit admin tidak valid.'), { statusCode: 403 });
  }
  return clean;
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function computeShortSha256Hex(buffer: ArrayBuffer): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest).slice(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return 'unknown';
  }
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
    const invalidFields: string[] = [];
    const fieldReasons: Record<string, string> = {};

    if (/invalid_client/i.test(oauthErrCode) || /client/i.test(oauthErrDesc)) {
      invalidFields.push(cfg.clientIdField, cfg.clientSecretField);
      fieldReasons[cfg.clientIdField] = `Google OAuth2 menolak client_id (${res.status}): ${detail}`;
      fieldReasons[cfg.clientSecretField] = `Periksa kecocokan ${cfg.clientSecretField} dengan ${cfg.clientIdField}.`;
    } else {
      invalidFields.push(cfg.refreshTokenField);
      fieldReasons[cfg.refreshTokenField] =
        `Pertukaran refresh_token ke access_token ditolak Google OAuth2 (${res.status}): ${detail || 'invalid_grant'}. Pastikan Refresh Token masih aktif dan dibuat oleh Client ID & Client Secret yang sama.`;
    }

    throw buildCredentialError({
      scope: 'Google Drive OAuth2',
      missingFields: [],
      invalidFields,
      fieldReasons,
    });
  }

  const json = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }
  return json.access_token;
}

async function getDriveServiceAccountToken(cfg: DriveAuthConfig): Promise<string> {
  if (cfg.mode === 'oauth2') {
    return exchangeOAuth2RefreshToken(cfg);
  }

  let cryptoKey: CryptoKey;
  let pkcs8Buffer: ArrayBuffer;
  let privateKeyModulus = '';
  const keyField = cfg.privateKeyField || 'GOOGLE_DRIVE_PRIVATE_KEY';
  const emailField = cfg.clientEmailField || 'GOOGLE_DRIVE_CLIENT_EMAIL';
  try {
    pkcs8Buffer = pemToArrayBuffer(cfg.privateKey);
    cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      pkcs8Buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['sign']
    );
    try {
      const exported = (await crypto.subtle.exportKey('jwk', cryptoKey)) as { n?: string };
      privateKeyModulus = String(exported?.n || '').trim();
    } catch {
      privateKeyModulus = '';
    }
  } catch (keyErr) {
    const rawDetail =
      keyErr instanceof Error
        ? `${keyErr.name && keyErr.name !== 'Error' ? `${keyErr.name}: ` : ''}${keyErr.message}`
        : String(keyErr || 'kesalahan tidak diketahui');
    const cleanDetail = rawDetail.replace(/\s+/g, ' ').trim().slice(0, 180) || 'format DER/PKCS8 ditolak WebCrypto';
    const keyReason = `crypto.subtle.importKey(pkcs8) gagal: ${cleanDetail}. Pastikan secret berisi private_key PKCS#8 utuh untuk ${cfg.clientEmail}.`;
    throw buildCredentialError({
      scope: 'Google Drive',
      missingFields: [],
      invalidFields: [keyField],
      fieldReasons: { [keyField]: keyReason },
    });
  }

  const keyFp = await computeShortSha256Hex(pkcs8Buffer);
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
            [keyField]: `Kunci privat di secret [fp=${keyFp}, mod=${privateKeyModulus.slice(0, 10)}...] TIDAK COCOK dengan kunci aktif mana pun milik ${cfg.clientEmail} di Google Cloud IAM (Key ID aktif: ${kidListLabel || 'kosong'}). Pastikan Anda menyalin seluruh file JSON atau nilai private_key dari salah satu Key ID aktif tersebut (bukan dari kunci lama/terhapus atau Service Account Firebase lain).`,
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

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

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
      ? ` Pastikan ${keyField} berasal dari JSON key AKTIF (belum dihapus/dirotasi di Google Cloud IAM) milik ${cfg.clientEmail} [fp=${keyFp}${resolvedKid ? `, kid=${resolvedKid.slice(0, 12)}...` : ''}].${activeInfo}`
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
  const searchParams = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const findRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!findRes.ok) {
    const findErr = await parseGoogleDriveApiError(findRes);
    throw buildDriveApiFailureError(`Gagal mencari folder Drive "${folderName}"`, findErr, driveCfg);
  }
  const found = (await findRes.json().catch(() => ({}))) as { files?: Array<{ id?: string }> };
  if (found.files?.[0]?.id) {
    return found.files[0].id;
  }

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
): Promise<{ folderId: string; folderPath: string; categoryFolder: string; monthFolder: string }> {
  const categoryFolder = resolveDriveCategoryFolder(roomId);
  const monthFolder = getJakartaYearMonth(isoDate);
  const categoryFolderId = await ensureDriveSubfolder(accessToken, categoryFolder, rootFolderId, driveCfg);
  const monthFolderId = await ensureDriveSubfolder(accessToken, monthFolder, categoryFolderId, driveCfg);
  return {
    folderId: monthFolderId,
    folderPath: `${categoryFolder}/${monthFolder}`,
    categoryFolder,
    monthFolder,
  };
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

async function applyRoomDrivePermissionPolicy(
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
      throw buildDriveApiFailureError(
        'Gagal menetapkan izin baca publik tautan Google Drive',
        permErr,
        driveCfg
      );
    }
    return 'anyone_link';
  }

  // Ruang privat (Grup Pengurus & DM Personal): DILARANG memberi izin anyone; hapus izin anyone bila ada
  await stripPublicAnyonePermissions(accessToken, fileId);
  return 'restricted_private';
}

function buildPrivateDriveProxyUrl(params: {
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

async function uploadBytesToDrive(params: {
  accessToken: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  description?: string;
  driveCfg?: DriveAuthConfig;
}): Promise<{
  id: string;
  name: string;
  size: number;
  webViewLink: string;
  thumbnailLink?: string;
}> {
  if (params.bytes.byteLength > 4 * 1024 * 1024) {
    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,webViewLink,thumbnailLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': params.mimeType,
          'X-Upload-Content-Length': String(params.bytes.byteLength),
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
      const initErr = await parseGoogleDriveApiError(initRes);
      throw buildDriveApiFailureError('Gagal memulai unggahan Drive', initErr, params.driveCfg);
    }

    const sessionUri = (initRes.headers.get('location') || '').trim();
    if (!sessionUri) {
      throw new Error('Google Drive tidak mengembalikan URI unggah.');
    }

    const putRes = await fetch(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': params.mimeType,
        'Content-Length': String(params.bytes.byteLength),
      },
      body: params.bytes,
    });

    if (!putRes.ok) {
      const putErr = await parseGoogleDriveApiError(putRes);
      throw buildDriveApiFailureError('Gagal mengunggah konten ke Google Drive', putErr, params.driveCfg);
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
      size: Number(uploaded.size || params.bytes.byteLength),
      webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
      thumbnailLink: uploaded.thumbnailLink,
    };
  }

  const boundary = `sk_drive_${crypto.randomUUID().replace(/-/g, '')}`;
  const metadataJson = JSON.stringify({
    name: params.fileName,
    parents: [params.folderId],
    description: params.description || 'Lampiran Chat Komunitas e-Card IPL Saung Kebun',
  });

  const encoder = new TextEncoder();
  const part1 = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`
  );
  const part3 = encoder.encode(`\r\n--${boundary}--`);
  const payload = new Uint8Array(part1.length + params.bytes.length + part3.length);
  payload.set(part1, 0);
  payload.set(params.bytes, part1.length);
  payload.set(part3, part1.length + params.bytes.length);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: payload,
    }
  );

  if (!uploadRes.ok) {
    const uploadErr = await parseGoogleDriveApiError(uploadRes);
    throw buildDriveApiFailureError('Gagal mengunggah lampiran ke Google Drive', uploadErr, params.driveCfg);
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
    size: Number(uploaded.size || params.bytes.byteLength),
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
  const { client } = getSupabaseAdminClient();

  const rpcV2 = await client.rpc('update_chat_message_attachment_v2', {
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
  });

  if (!rpcV2.error) return true;

  const rpcRes = await client.rpc('update_chat_message_attachment', {
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
  });

  if (!rpcRes.error) return true;

  const { error: patchErr } = await client
    .from('community_chat_messages')
    .update({
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
    })
    .eq('id', params.messageId);

  return !patchErr;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return jsonResponse(req, 405, { ok: false, error: 'Method tidak diizinkan. Gunakan POST.' });
  }

  let stage = 'parse_body';
  let body: {
    transitPath?: string;
    roomId?: string;
    messageId?: string;
    fileName?: string;
    mimeType?: string;
    sender?: SenderCallerHint;
  } = {};

  try {
    body = (await req.json().catch(() => ({}))) as typeof body;

    stage = 'validate_supabase_secrets';
    const { client } = getSupabaseAdminClient();

    stage = 'verify_caller';
    const caller = await verifyChatCaller(req, body.sender || null);

    stage = 'authorize_room';
    const roomId = normalizeChatRoomId(String(body.roomId || ''));
    if (!roomId || !canCallerAccessRoom(caller, roomId)) {
      return jsonResponse(req, 403, {
        ok: false,
        stage,
        error: `Anda tidak memiliki akses mengunggah lampiran ke ruang chat ini (role=${caller.role}, room=${roomId || '-'}).`,
      });
    }

    stage = 'validate_transit_path';
    const transitPath = validateSafeTransitPath(String(body.transitPath || ''), caller);
    const declaredMime = String(body.mimeType || 'application/octet-stream').trim().toLowerCase();
    const safeName = sanitizeFileName(body.fileName || transitPath.split('/').pop(), 'bin');

    // ATURAN KETAT: Semua video dilarang melewati bucket transit Supabase
    if (isVideoMedia(declaredMime, safeName) || isVideoMedia(declaredMime, transitPath)) {
      return jsonResponse(req, 400, {
        ok: false,
        stage,
        error:
          'Video ukuran berapa pun DILARANG transit di Supabase Storage. Gunakan direct Google Drive resumable upload.',
      });
    }

    stage = 'verify_message_ownership';
    await verifyMessageOwnershipIfPresent(body.messageId, roomId, caller);

    stage = 'validate_drive_secrets';
    const driveCfg = loadDriveServiceAccountConfig();

    stage = 'download_from_transit';
    const { data: downloadedBlob, error: downloadErr } = await client.storage
      .from('chat-transit')
      .download(transitPath);

    if (downloadErr || !downloadedBlob) {
      return jsonResponse(req, 404, {
        ok: false,
        stage,
        error: `Berkas sementara di chat-transit tidak ditemukan: ${downloadErr?.message || 'kosong'}`,
      });
    }

    const effectiveMime = String(downloadedBlob.type || declaredMime || 'application/octet-stream')
      .trim()
      .toLowerCase();
    if (isVideoMedia(effectiveMime, safeName)) {
      await client.storage.from('chat-transit').remove([transitPath]);
      return jsonResponse(req, 400, {
        ok: false,
        stage,
        error: 'Berkas video ditolak dari jalur transit dan dihapus dari bucket sementara.',
      });
    }

    const bytes = new Uint8Array(await downloadedBlob.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_NON_VIDEO_TRANSIT_BYTES) {
      return jsonResponse(req, 400, {
        ok: false,
        stage,
        error: `Ukuran lampiran non-video harus antara 1 byte hingga ${Math.round(
          MAX_NON_VIDEO_TRANSIT_BYTES / (1024 * 1024)
        )} MB.`,
      });
    }

    stage = 'authenticate_drive';
    const accessToken = await getDriveServiceAccountToken(driveCfg);

    stage = 'upload_to_drive';
    const { folderId, folderPath } = await resolveMonthlyChatDriveFolder(
      accessToken,
      driveCfg.rootFolderId,
      roomId,
      null,
      driveCfg
    );

    const uploaded = await uploadBytesToDrive({
      accessToken,
      folderId,
      fileName: safeName,
      mimeType: effectiveMime,
      bytes,
      description: `Lampiran chat ${roomId} oleh ${caller.displayName} (${caller.senderId})`,
      driveCfg,
    });

    stage = 'apply_drive_permissions';
    const drivePermissionScope = await applyRoomDrivePermissionPolicy(
      accessToken,
      uploaded.id,
      roomId,
      driveCfg
    );

    stage = 'delete_transit';
    const { error: removeErr } = await client.storage.from('chat-transit').remove([transitPath]);
    const transitDeleted = !removeErr;
    if (removeErr) {
      console.warn('[chat-media-transfer] failed to delete transit file', {
        transitPath,
        error: removeErr.message,
      });
    }

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
            messageId: body.messageId,
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
              messageId: body.messageId,
              mode: 'thumbnail',
            })
          : null
        : driveThumbnailLink;

    stage = 'update_message_record';
    const messageUpdated = await updateChatAttachmentRecord({
      messageId: body.messageId,
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

    console.info('[chat-media-transfer] transfer completed', {
      roomId,
      senderId: caller.senderId,
      driveFileId: uploaded.id,
      drivePermissionScope,
      transitDeleted,
      messageUpdated,
    });

    return jsonResponse(req, 200, {
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
      err instanceof Error ? err.message : 'Gagal memindahkan lampiran ke Google Drive.';
    const hasMissing = Array.isArray(typedErr?.missingFields);
    const hasInvalid = Array.isArray(typedErr?.invalidFields);
    const missingFields = hasMissing ? typedErr.missingFields : undefined;
    const invalidFields = hasInvalid ? typedErr.invalidFields : undefined;
    const fieldReasons =
      typedErr?.fieldReasons && Object.keys(typedErr.fieldReasons).length > 0
        ? typedErr.fieldReasons
        : undefined;

    console.error('[chat-media-transfer] transfer failed', {
      stage,
      statusCode,
      errorMessage,
      ...(hasMissing ? { missingFields } : {}),
      ...(hasInvalid ? { invalidFields } : {}),
      ...(fieldReasons ? { fieldReasons } : {}),
      roomId: body.roomId || null,
      roleHeader: req.headers.get('x-user-role') || body.sender?.role || null,
      blokHeader: req.headers.get('x-blok-rumah') || body.sender?.blokRumah || null,
      pengurusUsername: body.sender?.pengurusUsername || null,
      hasAuthorization: Boolean(req.headers.get('authorization')),
    });

    return jsonResponse(req, statusCode, {
      ok: false,
      stage,
      error: errorMessage,
      ...(hasMissing || hasInvalid
        ? {
            missingFields: missingFields || [],
            invalidFields: invalidFields || [],
            ...(fieldReasons ? { fieldReasons } : {}),
          }
        : {}),
    });
  }
});
