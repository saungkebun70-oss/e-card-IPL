import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

export interface DriveServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
  rootFolderId: string;
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
const MAX_VIDEO_RESUMABLE_BYTES = 500 * 1024 * 1024; // 500 MB

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') || '').trim();
  const configuredPublicUrl = (Deno.env.get('PUBLIC_APP_URL') || '').trim().replace(/\/+$/, '');
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

export function jsonResponse(
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

export function normalizeToken(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function canonicalBlockKey(raw?: string | null): string {
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

export function canonicalAdminUsername(raw?: string | null): string {
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

export function resolvePengurusUsernameFromHints(
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

export function isVideoMedia(mimeType?: string | null, fileName?: string | null): boolean {
  const cleanMime = String(mimeType || '').trim().toLowerCase();
  const cleanName = String(fileName || '').trim().toLowerCase();
  if (cleanMime.startsWith('video/')) return true;
  if (VIDEO_MIME_SET.has(cleanMime)) return true;
  if (VIDEO_EXTENSION_REGEX.test(cleanName)) return true;
  return false;
}

export function classifyNonVideoAttachmentType(mimeType?: string | null, fileName?: string | null): 'photo' | 'document' {
  const cleanMime = String(mimeType || '').trim().toLowerCase();
  const cleanName = String(fileName || '').trim().toLowerCase();
  if (cleanMime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic|heif)$/i.test(cleanName)) {
    return 'photo';
  }
  return 'document';
}

export function sanitizeFileName(rawName?: string | null, fallbackExt = 'bin'): string {
  const last = String(rawName || '').split(/[\\/]/).pop() || '';
  const safe = last.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safe) return `media-${Date.now()}.${fallbackExt}`;
  return safe.slice(0, 140);
}

export function getJakartaYearMonth(isoDate?: string | null): string {
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

export function resolveDriveCategoryFolder(roomId: string): string {
  const clean = String(roomId || '').trim();
  if (clean === 'grup_pengurus') return 'Grup-Pengurus';
  if (clean === 'pengurus_warga') return 'Grup-Pengurus-Warga';
  if (clean === 'pengurus_keamanan') return 'Grup-Pengurus-Keamanan';
  if (clean === 'warga_keamanan') return 'Grup-Warga-Keamanan';
  if (clean === 'forum_umum') return 'Forum-Lingkungan';
  if (clean.startsWith('dm:')) return 'DM-Personal';
  return 'Chat-Lainnya';
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

export function normalizeParticipantId(rawId: string): string {
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

export function getSupabaseAdminClient() {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diatur pada Edge Function.');
  }
  return {
    url,
    serviceKey,
    client: createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export function loadDriveServiceAccountConfig(): DriveServiceAccountConfig {
  const clientEmail = (Deno.env.get('GOOGLE_DRIVE_CLIENT_EMAIL') || '').trim();
  const rawKey = (Deno.env.get('GOOGLE_DRIVE_PRIVATE_KEY') || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
  const rootFolderId = (Deno.env.get('GOOGLE_DRIVE_ROOT_FOLDER_ID') || '').trim();

  if (!clientEmail || !rawKey || !rootFolderId) {
    throw new Error(
      'Konfigurasi GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY, atau GOOGLE_DRIVE_ROOT_FOLDER_ID belum lengkap di Edge Function Secrets.'
    );
  }

  return {
    clientEmail,
    privateKey: rawKey,
    rootFolderId,
  };
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

  const anonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
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

export async function verifyChatCaller(
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

  throw Object.assign(new Error('Sesi portal aktif diperlukan untuk mengunggah lampiran chat.'), {
    statusCode: 401,
  });
}

export async function verifyMessageOwnershipIfPresent(
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

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

export async function getDriveServiceAccountToken(cfg: DriveServiceAccountConfig): Promise<string> {
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

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(cfg.privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

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
    throw new Error(`Gagal otentikasi Service Account Google Drive (${res.status}): ${errText.slice(0, 180)}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }
  return json.access_token;
}

export async function ensureDriveSubfolder(
  accessToken: string,
  folderName: string,
  parentId: string
): Promise<string> {
  const safeName = folderName.replace(/'/g, "\\'");
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`;
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
  if (findRes.ok) {
    const found = (await findRes.json()) as { files?: Array<{ id: string }> };
    if (found.files?.[0]?.id) {
      return found.files[0].id;
    }
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
    const errText = await createRes.text().catch(() => '');
    throw new Error(`Gagal membuat subfolder Drive "${folderName}": ${errText.slice(0, 180)}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export async function resolveMonthlyChatDriveFolder(
  accessToken: string,
  rootFolderId: string,
  roomId: string,
  isoDate?: string | null
): Promise<{ folderId: string; folderPath: string; categoryFolder: string; monthFolder: string }> {
  const categoryFolder = resolveDriveCategoryFolder(roomId);
  const monthFolder = getJakartaYearMonth(isoDate);
  const categoryFolderId = await ensureDriveSubfolder(accessToken, categoryFolder, rootFolderId);
  const monthFolderId = await ensureDriveSubfolder(accessToken, monthFolder, categoryFolderId);
  return {
    folderId: monthFolderId,
    folderPath: `${categoryFolder}/${monthFolder}`,
    categoryFolder,
    monthFolder,
  };
}

export type DrivePermissionScope = 'anyone_link' | 'restricted_private';

export function resolveRoomDrivePermissionScope(roomId: string): DrivePermissionScope {
  const clean = String(roomId || '').trim();
  if (clean === 'grup_pengurus' || clean.startsWith('dm:')) {
    return 'restricted_private';
  }
  return 'anyone_link';
}

export async function stripPublicAnyonePermissions(
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

export async function applyRoomDrivePermissionPolicy(
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

  // Ruang privat (Grup Pengurus & DM Personal): DILARANG memberi izin anyone; hapus izin anyone bila ada
  await stripPublicAnyonePermissions(accessToken, fileId);
  return 'restricted_private';
}

export async function makeDriveFilePublicReader(
  accessToken: string,
  fileId: string
): Promise<void> {
  await applyRoomDrivePermissionPolicy(accessToken, fileId, 'pengurus_warga');
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

export async function recordUnauthorizedDriveAccessAudit(params: {
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
  const rawSecret = (
    Deno.env.get('CHAT_MEDIA_SIGNING_SECRET') ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    ''
  ).trim();
  if (!rawSecret) {
    throw new Error('Kunci penandatanganan akses media privat belum tersedia.');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(rawSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signPrivateStreamToken(payload: {
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

export async function verifyPrivateStreamToken(
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

export async function uploadBytesToDrive(params: {
  accessToken: string;
  folderId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  description?: string;
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
      const errText = await initRes.text().catch(() => '');
      throw new Error(`Gagal memulai unggahan Drive (${initRes.status}): ${errText.slice(0, 180)}`);
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
      const errText = await putRes.text().catch(() => '');
      throw new Error(`Gagal mengunggah konten ke Google Drive (${putRes.status}): ${errText.slice(0, 180)}`);
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
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(`Gagal mengunggah lampiran ke Google Drive (${uploadRes.status}): ${errText.slice(0, 180)}`);
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
    size: Number(uploaded.size || params.bytes.length),
    webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    thumbnailLink: uploaded.thumbnailLink,
  };
}

export async function updateChatAttachmentRecord(params: {
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

export function validateSafeTransitPath(transitPath: string, caller: VerifiedChatCaller): string {
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

export function getAllowedResumableOrigin(req: Request): string | undefined {
  const origin = (req.headers.get('origin') || '').trim();
  if (!origin) return undefined;
  try {
    const parsed = new URL(origin);
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

export { MAX_NON_VIDEO_TRANSIT_BYTES, MAX_VIDEO_RESUMABLE_BYTES };
