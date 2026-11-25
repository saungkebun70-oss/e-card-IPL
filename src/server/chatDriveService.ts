import crypto from 'crypto';

export interface VerifiedChatCaller {
  role: 'admin' | 'warga' | 'petugas';
  senderId: string;
  slug: string;
  displayName: string;
  matchIds: Set<string>;
}

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
  if (clean === 'admin' || clean === 'andriansyah') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan') return 'bpiwan';
  return clean;
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

export async function verifyChatCallerFromHeaders(headers: {
  role: string;
  blokRumah: string;
  petugasId: string;
}): Promise<VerifiedChatCaller> {
  const rawRole = normalizeToken(headers.role);
  const rawBlok = String(headers.blokRumah || '').trim();
  const rawPetugasId = String(headers.petugasId || '').trim();

  if (rawRole === 'admin') {
    const reqUsername = canonicalAdminUsername(rawBlok);
    if (!reqUsername) {
      throw Object.assign(new Error('Identitas Pengurus tidak lengkap.'), { statusCode: 401 });
    }
    const res = await supabaseRestJson<
      Array<{ blok_rumah?: string; nama_warga?: string; role?: string; aktif?: boolean }>
    >('/rest/v1/users_warga?aktif=eq.true&role=in.(admin,bendahara)&select=blok_rumah,nama_warga,role,aktif');

    if (!res.ok || !Array.isArray(res.data)) {
      throw new Error(`Gagal memverifikasi akun Pengurus: ${res.errorText || res.status}`);
    }

    const matched = res.data.find(
      (row) => canonicalAdminUsername(row.blok_rumah) === reqUsername
    );
    if (!matched) {
      throw Object.assign(
        new Error('Akun Pengurus tidak aktif atau hak Pengurus telah dicabut.'),
        { statusCode: 403 }
      );
    }

    const matchIds = new Set<string>([`admin:${reqUsername}`]);
    if (reqUsername === 'andriansyah') matchIds.add('admin:admin');
    if (reqUsername === 'bpiwan') matchIds.add('admin:paiwan');

    return {
      role: 'admin',
      senderId: `admin:${reqUsername}`,
      slug: reqUsername,
      displayName: String(matched.nama_warga || 'Pengurus'),
      matchIds,
    };
  }

  if (rawRole === 'warga') {
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
        new Error('Akun Warga tidak aktif atau sedang berstatus Pengurus aktif.'),
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
      displayName: String(matched.nama_warga || `Warga ${canonBlok}`),
      matchIds,
    };
  }

  if (rawRole === 'petugas' || rawRole === 'keamanan') {
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
      throw Object.assign(new Error('Akun Petugas Keamanan tidak aktif atau tidak ditemukan.'), {
        statusCode: 403,
      });
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

async function makeDriveFilePublicReader(accessToken: string, fileId: string): Promise<void> {
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }
  ).catch(() => undefined);
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
}): Promise<boolean> {
  if (!params.messageId) return false;

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
  callerHeaders: { role: string; blokRumah: string; petugasId: string };
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

  await makeDriveFilePublicReader(accessToken, uploaded.id);

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
  const attachmentUrl =
    attachmentType === 'photo'
      ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w1600`
      : uploaded.webViewLink;
  const thumbnailUrl =
    attachmentType === 'photo'
      ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w480`
      : uploaded.thumbnailLink || null;

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
  });

  return {
    ok: true,
    storageProvider: 'google_drive',
    attachmentType,
    driveFileId: uploaded.id,
    folderPath,
    fileName: uploaded.name,
    mimeType: effectiveMime,
    sizeBytes: uploaded.size,
    attachmentUrl,
    thumbnailUrl,
    webViewLink: uploaded.webViewLink,
    transitDeleted,
    messageUpdated,
  };
}

export async function initChatVideoResumableUpload(params: {
  callerHeaders: { role: string; blokRumah: string; petugasId: string };
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
  callerHeaders: { role: string; blokRumah: string; petugasId: string };
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

  await makeDriveFilePublicReader(accessToken, driveFileId);

  const webViewLink =
    fileMeta.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
  const thumbnailUrl =
    fileMeta.thumbnailLink ||
    `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w640`;
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
    attachmentUrl: webViewLink,
    thumbnailUrl,
    status: 'ready',
  });

  return {
    ok: true,
    storageProvider: 'google_drive',
    attachmentType: 'video',
    driveFileId,
    folderPath: resolvedFolderPath,
    fileName: effectiveName,
    mimeType: effectiveMime,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    attachmentUrl: webViewLink,
    thumbnailUrl,
    webViewLink,
    messageUpdated,
  };
}
