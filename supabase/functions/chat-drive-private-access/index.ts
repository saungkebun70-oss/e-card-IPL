/**
 * Supabase Edge Function: chat-drive-private-access (Standalone Ready-to-Deploy)
 *
 * Fitur:
 * - Memvalidasi identitas peminta (Pengurus, Warga, Keamanan), hak akses ruang chat, serta kepemilikan pesan.
 * - Mengatur/memvalidasi kebijakan izin file Google Drive per ruang chat (`anyone_link` vs `restricted_private`).
 * - Melayani stream/download/thumbnail aman dan URL stream bertanda tangan jangka pendek untuk berkas privat
 *   (Grup Pengurus & DM Personal) via Service Account tanpa membuka tautan publik, serta mencatat penolakan ke `audit_logs`.
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

interface DriveServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
  rootFolderId: string;
}

type DrivePermissionScope = 'anyone_link' | 'restricted_private';

interface CredentialValidationError extends Error {
  statusCode?: number;
  missingFields?: string[];
  invalidFields?: string[];
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
    .replace(/\s+/g, '');
  if (!clean) return '';
  const match = clean.match(/^([A-Z]+)0*(\d+)\/0*(\d+)$/);
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
  let clean = String(raw || '').trim();
  while (
    clean.length >= 2 &&
    ((clean.startsWith('"') && clean.endsWith('"')) ||
      (clean.startsWith("'") && clean.endsWith("'")))
  ) {
    clean = clean.slice(1, -1).trim();
  }
  return clean;
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

function normalizePrivateKeyPem(raw: string): string {
  return stripOuterQuotes(raw)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();
}

function buildCredentialError(params: {
  scope: string;
  missingFields: string[];
  invalidFields: string[];
  statusCode?: number;
}): CredentialValidationError {
  const details: string[] = [];
  if (params.missingFields.length > 0) {
    details.push(`field kosong: [${params.missingFields.join(', ')}]`);
  }
  if (params.invalidFields.length > 0) {
    details.push(`field tidak valid: [${params.invalidFields.join(', ')}]`);
  }
  const err = new Error(
    `Validasi secrets ${params.scope} gagal di Edge Function — ${details.join('; ')}.`
  ) as CredentialValidationError;
  err.statusCode = params.statusCode ?? 500;
  if (params.missingFields.length > 0) err.missingFields = params.missingFields;
  if (params.invalidFields.length > 0) err.invalidFields = params.invalidFields;
  return err;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
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

  if (!url) {
    missingFields.push('SUPABASE_URL');
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        invalidFields.push('SUPABASE_URL (protokol harus http/https)');
      }
    } catch {
      invalidFields.push('SUPABASE_URL (format URL tidak valid)');
    }
  }

  if (!serviceKey) {
    missingFields.push('SERVICE_ROLE_KEY (fallback: SUPABASE_SERVICE_ROLE_KEY)');
  } else if (serviceKey.length < 20 || /\s/.test(serviceKey)) {
    invalidFields.push(
      `${serviceKeyEnv.sourceName || 'SERVICE_ROLE_KEY'} (format token service role tidak valid)`
    );
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    throw buildCredentialError({
      scope: 'Supabase',
      missingFields,
      invalidFields,
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

function loadDriveServiceAccountConfig(): DriveServiceAccountConfig {
  const emailEnv = readFirstSecretEnv(['GOOGLE_DRIVE_CLIENT_EMAIL', 'GOOGLE_CLIENT_EMAIL']);
  const keyEnv = readFirstSecretEnv(['GOOGLE_DRIVE_PRIVATE_KEY', 'GOOGLE_PRIVATE_KEY']);
  const folderEnv = readFirstSecretEnv(['GOOGLE_DRIVE_ROOT_FOLDER_ID', 'GOOGLE_DRIVE_FOLDER_ID']);

  const clientEmail = emailEnv.value;
  const privateKey = keyEnv.value ? normalizePrivateKeyPem(keyEnv.value) : '';
  const rootFolderId = folderEnv.value;

  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  if (!clientEmail) {
    missingFields.push('GOOGLE_DRIVE_CLIENT_EMAIL (fallback: GOOGLE_CLIENT_EMAIL)');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
    invalidFields.push(
      `${emailEnv.sourceName || 'GOOGLE_DRIVE_CLIENT_EMAIL'} (format email service account tidak valid)`
    );
  }

  if (!privateKey) {
    missingFields.push('GOOGLE_DRIVE_PRIVATE_KEY (fallback: GOOGLE_PRIVATE_KEY)');
  } else {
    const keyName = keyEnv.sourceName || 'GOOGLE_DRIVE_PRIVATE_KEY';
    if (
      !privateKey.includes('-----BEGIN PRIVATE KEY-----') ||
      !privateKey.includes('-----END PRIVATE KEY-----')
    ) {
      invalidFields.push(
        `${keyName} (harus berformat PEM PKCS8 dengan header BEGIN/END PRIVATE KEY)`
      );
    } else {
      try {
        const keyBuffer = pemToArrayBuffer(privateKey);
        if (keyBuffer.byteLength < 64) {
          invalidFields.push(`${keyName} (panjang byte kunci privat terlalu pendek/terpotong)`);
        }
      } catch {
        invalidFields.push(`${keyName} (isi base64 kunci privat tidak valid)`);
      }
    }
  }

  if (!rootFolderId) {
    missingFields.push('GOOGLE_DRIVE_ROOT_FOLDER_ID (fallback: GOOGLE_DRIVE_FOLDER_ID)');
  } else if (!/^[a-zA-Z0-9_-]{8,150}$/.test(rootFolderId)) {
    invalidFields.push(
      `${folderEnv.sourceName || 'GOOGLE_DRIVE_ROOT_FOLDER_ID'} (harus berupa ID folder Google Drive yang valid)`
    );
  }

  if (missingFields.length > 0 || invalidFields.length > 0) {
    throw buildCredentialError({
      scope: 'Google Drive',
      missingFields,
      invalidFields,
    });
  }

  return {
    clientEmail,
    privateKey,
    rootFolderId,
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
    const canonBlok = canonicalBlockKey(rawBlok);
    if (!canonBlok) {
      throw Object.assign(new Error('Blok rumah Warga tidak valid.'), { statusCode: 401 });
    }

    const { data, error } = await client
      .from('users_warga')
      .select('blok_rumah, nama_warga, role, aktif')
      .eq('aktif', true)
      .eq('role', 'warga');

    if (error) {
      throw new Error(`Gagal memverifikasi akun Warga: ${error.message}`);
    }

    const matched = (data || []).find(
      (row) => canonicalBlockKey(String(row.blok_rumah || '')) === canonBlok
    );
    if (!matched) {
      throw Object.assign(
        new Error(
          `Akun Warga Blok "${canonBlok}" berstatus nonaktif di users_warga atau sedang berstatus Pengurus aktif.`
        ),
        { statusCode: 403 }
      );
    }

    const canonLower = canonBlok.toLowerCase();
    const rawLower = normalizeToken(rawBlok);
    const matchIds = new Set<string>([`warga:${canonLower}`]);
    if (rawLower) matchIds.add(`warga:${rawLower}`);

    return {
      role: 'warga',
      senderId: `warga:${canonLower}`,
      slug: canonLower.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(matched.nama_warga || callerHint?.namaWarga || `Warga ${canonBlok}`),
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

async function getDriveServiceAccountToken(cfg: DriveServiceAccountConfig): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const signingInput = `${header}.${claimSet}`;

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(cfg.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch (keyErr) {
    const keyReason = keyErr instanceof Error ? keyErr.message : 'gagal mengimpor kunci PKCS8';
    throw buildCredentialError({
      scope: 'Google Drive',
      missingFields: [],
      invalidFields: [`GOOGLE_DRIVE_PRIVATE_KEY / GOOGLE_PRIVATE_KEY (${keyReason})`],
    });
  }

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
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Gagal otentikasi Service Account Google Drive (${res.status}) — periksa GOOGLE_DRIVE_CLIENT_EMAIL/GOOGLE_CLIENT_EMAIL dan GOOGLE_DRIVE_PRIVATE_KEY/GOOGLE_PRIVATE_KEY: ${errText.slice(0, 180)}`
    );
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }
  return json.access_token;
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
  roomId: string
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
      const errText = await permRes.text().catch(() => '');
      throw new Error(
        `Gagal menetapkan izin baca publik tautan Google Drive (${permRes.status}): ${errText.slice(0, 140)}`
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

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    return jsonResponse(req, 405, { ok: false, error: 'Method tidak diizinkan.' });
  }

  let stage = 'parse_request';
  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const action = String(body.action || url.searchParams.get('action') || '').trim().toLowerCase();
  let fileId = String(body.fileId || body.driveFileId || url.searchParams.get('fileId') || '').trim();
  let rawRoomId = String(body.roomId || url.searchParams.get('roomId') || '').trim();
  const messageId = String(body.messageId || url.searchParams.get('messageId') || '').trim();
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
        await recordUnauthorizedDriveAccessAudit({
          req,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason: 'Tanda tangan akses stream privat tidak valid atau kedaluwarsa.',
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Akses ditolak: token aliran media privat tidak valid atau telah kedaluwarsa.',
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
    try {
      const senderHint =
        body.sender && typeof body.sender === 'object' ? (body.sender as SenderCallerHint) : null;
      caller = await verifyChatCaller(effectiveReq, senderHint);
    } catch (authErr) {
      const typedAuthErr = authErr as CredentialValidationError;
      if (typedAuthErr.missingFields?.length || typedAuthErr.invalidFields?.length) {
        throw authErr;
      }
      const msg = authErr instanceof Error ? authErr.message : 'Identitas tidak valid.';
      await recordUnauthorizedDriveAccessAudit({
        req: effectiveReq,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason: msg,
      });
      return jsonResponse(req, 403, { ok: false, stage, error: msg });
    }

    stage = 'lookup_message_record';
    let dbMessageRow: {
      id: string;
      room_id: string;
      sender_id: string;
      recipient_id?: string | null;
      attachment_drive_file_id?: string | null;
    } | null = null;

    if (messageId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
        return jsonResponse(req, 400, { ok: false, stage, error: 'Format messageId tidak valid.' });
      }
      const { data } = await client
        .from('community_chat_messages')
        .select('id, room_id, sender_id, recipient_id, attachment_drive_file_id')
        .eq('id', messageId)
        .maybeSingle();
      if (!data) {
        await recordUnauthorizedDriveAccessAudit({
          req: effectiveReq,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason: 'Pesan lampiran privat tidak ditemukan.',
        });
        return jsonResponse(req, 403, { ok: false, stage, error: 'Akses lampiran privat ditolak.' });
      }
      dbMessageRow = data as typeof dbMessageRow;
    } else if (fileId) {
      const { data } = await client
        .from('community_chat_messages')
        .select('id, room_id, sender_id, recipient_id, attachment_drive_file_id')
        .eq('attachment_drive_file_id', fileId)
        .limit(1)
        .maybeSingle();
      if (data) {
        dbMessageRow = data as typeof dbMessageRow;
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
          req: effectiveReq,
          roomId: dbMessageRow.room_id,
          fileId,
          messageId,
          reason: 'driveFileId tidak cocok dengan record pesan.',
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Berkas Google Drive tidak cocok dengan pesan terkait.',
        });
      }
      const dbRoom = normalizeChatRoomId(String(dbMessageRow.room_id || ''));
      if (rawRoomId && normalizeChatRoomId(rawRoomId) !== dbRoom) {
        await recordUnauthorizedDriveAccessAudit({
          req: effectiveReq,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason: 'roomId tidak cocok dengan ruang asal pesan.',
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Ruang chat lampiran tidak cocok.',
        });
      }
      rawRoomId = dbRoom;
    }

    const roomId = normalizeChatRoomId(rawRoomId);
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId) || !roomId) {
      await recordUnauthorizedDriveAccessAudit({
        req: effectiveReq,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason: 'Parameter fileId atau roomId tidak valid.',
      });
      return jsonResponse(req, 403, {
        ok: false,
        stage,
        error: 'Parameter akses berkas privat tidak valid.',
      });
    }

    stage = 'authorize_room_access';
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
        req: effectiveReq,
        roomId,
        fileId,
        messageId,
        reason: denyReason,
      });
      return jsonResponse(req, 403, { ok: false, stage, error: `Akses ditolak: ${denyReason}` });
    }

    stage = 'validate_drive_secrets';
    const driveCfg = loadDriveServiceAccountConfig();

    stage = 'authenticate_drive';
    const accessToken = await getDriveServiceAccountToken(driveCfg);

    stage = 'fetch_drive_metadata';
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,thumbnailLink,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      return jsonResponse(req, 404, { ok: false, stage, error: 'Berkas tidak ditemukan di Google Drive.' });
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
      return jsonResponse(req, 404, { ok: false, stage, error: 'Berkas telah dihapus dari Google Drive.' });
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
          req: effectiveReq,
          roomId,
          fileId,
          messageId,
          reason: 'Berkas Drive di luar struktur arsip ruang chat yang diminta.',
        });
        return jsonResponse(req, 403, {
          ok: false,
          stage,
          error: 'Berkas tidak terdaftar pada folder ruang chat ini.',
        });
      }
    }

    const expectedScope = resolveRoomDrivePermissionScope(roomId);

    // Opsional: sinkronkan/validasi izin file Drive sesuai jenis ruang chat (`anyone_link` vs `restricted_private`)
    if (req.method === 'POST' && action === 'sync_permission') {
      stage = 'sync_drive_permission';
      const appliedScope = await applyRoomDrivePermissionPolicy(accessToken, fileId, roomId);
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
      const blokVal = (effectiveReq.headers.get('x-blok-rumah') || '').trim();
      const petVal = (effectiveReq.headers.get('x-petugas-id') || '').trim();
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

    // Mode thumbnail privat via Service Account
    if (mode === 'thumbnail' && fileMeta.thumbnailLink) {
      stage = 'stream_thumbnail';
      const thumbRes = await fetch(fileMeta.thumbnailLink, {
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
        headers: driveFetchHeaders,
      }
    );

    if (!mediaRes.ok && mediaRes.status !== 206) {
      const errText = await mediaRes.text().catch(() => '');
      return jsonResponse(req, mediaRes.status === 416 ? 416 : 502, {
        ok: false,
        stage,
        error: `Gagal mengalirkan berkas dari Google Drive (${mediaRes.status}): ${errText.slice(0, 140)}`,
      });
    }

    const safeFileName = sanitizeFileName(fileMeta.name || `lampiran-${fileId}`, 'bin');
    const respHeaders = new Headers(corsHeaders);
    respHeaders.set(
      'Content-Type',
      fileMeta.mimeType || mediaRes.headers.get('content-type') || 'application/octet-stream'
    );
    respHeaders.set('Accept-Ranges', 'bytes');
    respHeaders.set('Cache-Control', 'private, no-store');
    respHeaders.set(
      'Content-Disposition',
      `${mode === 'download' ? 'attachment' : 'inline'}; filename="${safeFileName}"`
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
    };
    const statusCode = typeof typedErr?.statusCode === 'number' ? typedErr.statusCode : 500;
    const errorMessage =
      err instanceof Error ? err.message : 'Gagal mengakses berkas privat Google Drive.';
    const missingFields = Array.isArray(typedErr?.missingFields) ? typedErr.missingFields : undefined;
    const invalidFields = Array.isArray(typedErr?.invalidFields) ? typedErr.invalidFields : undefined;

    console.error('[chat-drive-private-access] failed', {
      stage,
      statusCode,
      errorMessage,
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      roomId: rawRoomId || null,
      fileId: fileId || null,
    });

    return jsonResponse(req, statusCode, {
      ok: false,
      stage,
      error: errorMessage,
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
    });
  }
});
