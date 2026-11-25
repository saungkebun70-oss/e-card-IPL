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

export interface DriveServiceAccountConfig {
  clientEmail: string;
  privateKey: string;
  rootFolderId: string;
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

function getSupabaseServerConfig(): { url: string; serviceKey: string } {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    throw Object.assign(
      new Error('SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diatur di server.'),
      { statusCode: 500 }
    );
  }
  return { url, serviceKey };
}

function getDriveConfig(): DriveServiceAccountConfig {
  const clientEmail = (process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.GOOGLE_DRIVE_PRIVATE_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
  const rootFolderId = (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim();
  if (!clientEmail || !privateKey || !rootFolderId) {
    throw Object.assign(
      new Error(
        'Konfigurasi GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY, atau GOOGLE_DRIVE_ROOT_FOLDER_ID belum lengkap di server.'
      ),
      { statusCode: 500 }
    );
  }
  return { clientEmail, privateKey, rootFolderId };
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
    const canonBlok = canonicalBlockKey(rawBlok);
    if (!canonBlok) {
      throw Object.assign(new Error('Blok rumah Warga tidak valid.'), { statusCode: 401 });
    }
    const res = await supabaseRestJson<
      Array<{ blok_rumah?: string; nama_warga?: string; role?: string; aktif?: boolean }>
    >('/rest/v1/users_warga?aktif=eq.true&role=eq.warga&select=blok_rumah,nama_warga,role,aktif');

    if (!res.ok || !Array.isArray(res.data)) {
      throw new Error(`Gagal memverifikasi akun Warga: ${res.errorText || res.status}`);
    }

    const matched = res.data.find((row) => canonicalBlockKey(row.blok_rumah) === canonBlok);
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
      displayName: String(matched.nama_warga || hint?.namaWarga || `Warga ${canonBlok}`),
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
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(cfg.privateKey);
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
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Gagal otentikasi Service Account Google Drive (${res.status}): ${errText.slice(0, 180)}`
    );
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('Google OAuth2 tidak mengembalikan access_token.');
  }
  return json.access_token;
}

async function ensureDriveSubfolder(
  accessToken: string,
  folderName: string,
  parentId: string
): Promise<string> {
  const safeName = folderName.replace(/'/g, "\\'");
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`;
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
  if (findRes.ok) {
    const found = (await findRes.json()) as { files?: Array<{ id: string }> };
    if (found.files?.[0]?.id) return found.files[0].id;
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

async function resolveMonthlyChatDriveFolder(
  accessToken: string,
  rootFolderId: string,
  roomId: string,
  isoDate?: string | null
): Promise<{
  folderId: string;
  categoryFolderId: string;
  folderPath: string;
}> {
  const categoryFolder = resolveDriveCategoryFolder(roomId);
  const monthFolder = getJakartaYearMonth(isoDate);
  const categoryFolderId = await ensureDriveSubfolder(accessToken, categoryFolder, rootFolderId);
  const folderId = await ensureDriveSubfolder(accessToken, monthFolder, categoryFolderId);
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
    process.env.CHAT_MEDIA_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
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
        'Content-Length': String(params.buffer.byteLength),
      },
      body: new Uint8Array(params.buffer),
    });

    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => '');
      throw new Error(
        `Gagal mengunggah konten ke Google Drive (${putRes.status}): ${errText.slice(0, 180)}`
      );
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
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(
      `Gagal mengunggah lampiran ke Google Drive (${uploadRes.status}): ${errText.slice(0, 180)}`
    );
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
    roomId
  );

  const uploaded = await uploadBufferToDrive({
    accessToken,
    folderId,
    fileName: safeName,
    mimeType: contentTypeHeader || declaredMime,
    buffer: bytes,
    description: `Lampiran chat ${roomId} oleh ${caller.displayName} (${caller.senderId})`,
  });

  const drivePermissionScope = await applyRoomDrivePermissionPolicy(
    accessToken,
    uploaded.id,
    roomId
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
    roomId
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
    const errText = await initRes.text().catch(() => '');
    throw Object.assign(
      new Error(
        `Gagal menginisiasi sesi Resumable Upload Google Drive (${initRes.status}): ${errText.slice(0, 180)}`
      ),
      { statusCode: 502 }
    );
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
    throw Object.assign(
      new Error(`Berkas video tidak ditemukan di Google Drive (${metaRes.status}).`),
      { statusCode: 404 }
    );
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
    roomId
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
    roomId
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
      res.status(404).json({ ok: false, error: 'Berkas tidak ditemukan di Google Drive.' });
      return;
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
      const errText = await mediaRes.text().catch(() => '');
      res.status(mediaRes.status === 416 ? 416 : 502).json({
        ok: false,
        error: `Gagal mengalirkan berkas dari Google Drive (${mediaRes.status}): ${errText.slice(0, 140)}`,
      });
      return;
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
    const statusCode =
      typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    res.status(statusCode).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal mengakses berkas privat Google Drive.',
    });
  }
}
