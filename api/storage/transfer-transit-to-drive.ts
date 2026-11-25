// Vercel Serverless Function: POST /api/storage/transfer-transit-to-drive
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
  slug: string;
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
const MAX_NON_VIDEO_BYTES = 25 * 1024 * 1024;

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
}

function normalizeToken(raw?: string | null): string {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
}

function canonicalBlockKey(raw?: string | null): string {
  const clean = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!clean) return '';
  const m = clean.match(/^([A-Z]+)0*(\d+)\/0*(\d+)$/);
  return m ? `${m[1]}${Number(m[2])}/${Number(m[3])}` : clean;
}

function canonicalAdminUsername(raw?: string | null): string {
  const clean = normalizeToken(raw);
  if (clean === 'admin' || clean === 'andriansyah') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan') return 'bpiwan';
  return clean;
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
  return (safe || `media-${Date.now()}.bin`).slice(0, 140);
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

function getSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    throw Object.assign(new Error('SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diset.'), { statusCode: 500 });
  }
  return { url, serviceKey };
}

function getDriveEnv() {
  const clientEmail = (process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '').trim();
  const privateKey = (process.env.GOOGLE_DRIVE_PRIVATE_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
  const rootFolderId = (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim();
  if (!clientEmail || !privateKey || !rootFolderId) {
    throw Object.assign(
      new Error('Konfigurasi Service Account Google Drive belum lengkap di environment server.'),
      { statusCode: 500 }
    );
  }
  return { clientEmail, privateKey, rootFolderId };
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

async function verifyCaller(req: VercelReq): Promise<VerifiedCaller> {
  const rawRole = normalizeToken(getHeader(req.headers, 'x-user-role'));
  const rawBlok = getHeader(req.headers, 'x-blok-rumah').trim();
  const rawPetId = getHeader(req.headers, 'x-petugas-id').trim();

  if (rawRole === 'admin') {
    const uname = canonicalAdminUsername(rawBlok);
    if (!uname) throw Object.assign(new Error('Identitas Pengurus tidak lengkap.'), { statusCode: 401 });
    const res = await sbRest<Array<{ blok_rumah?: string; nama_warga?: string }>>(
      '/rest/v1/users_warga?aktif=eq.true&role=in.(admin,bendahara)&select=blok_rumah,nama_warga'
    );
    const matched = (res.data || []).find((r) => canonicalAdminUsername(r.blok_rumah) === uname);
    if (!matched) throw Object.assign(new Error('Akun Pengurus tidak aktif.'), { statusCode: 403 });
    const matchIds = new Set<string>([`admin:${uname}`]);
    if (uname === 'andriansyah') matchIds.add('admin:admin');
    if (uname === 'bpiwan') matchIds.add('admin:paiwan');
    return {
      role: 'admin',
      senderId: `admin:${uname}`,
      slug: uname,
      displayName: String(matched.nama_warga || 'Pengurus'),
      matchIds,
    };
  }

  if (rawRole === 'warga') {
    const canon = canonicalBlockKey(rawBlok);
    if (!canon) throw Object.assign(new Error('Blok rumah Warga tidak valid.'), { statusCode: 401 });
    const res = await sbRest<Array<{ blok_rumah?: string; nama_warga?: string }>>(
      '/rest/v1/users_warga?aktif=eq.true&role=eq.warga&select=blok_rumah,nama_warga'
    );
    const matched = (res.data || []).find((r) => canonicalBlockKey(r.blok_rumah) === canon);
    if (!matched) {
      throw Object.assign(new Error('Akun Warga tidak aktif atau terdaftar sebagai Pengurus.'), { statusCode: 403 });
    }
    const lower = canon.toLowerCase();
    const matchIds = new Set<string>([`warga:${lower}`]);
    if (normalizeToken(rawBlok)) matchIds.add(`warga:${normalizeToken(rawBlok)}`);
    return {
      role: 'warga',
      senderId: `warga:${lower}`,
      slug: lower.replace(/[^a-z0-9_-]+/g, '-'),
      displayName: String(matched.nama_warga || `Warga ${canon}`),
      matchIds,
    };
  }

  if (rawRole === 'petugas' || rawRole === 'keamanan') {
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
    if (!matched?.id) throw Object.assign(new Error('Akun Petugas Keamanan tidak aktif.'), { statusCode: 403 });
    const pid = normalizeToken(matched.id);
    const matchIds = new Set<string>([`petugas:${pid}`, `keamanan:${pid}`]);
    if (rawBlok) {
      matchIds.add(`petugas:${normalizeToken(rawBlok)}`);
      matchIds.add(`keamanan:${normalizeToken(rawBlok)}`);
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

async function getDriveToken(cfg: { clientEmail: string; privateKey: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64Url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  )}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const jwt = `${signingInput}.${b64Url(signer.sign(cfg.privateKey))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Gagal otentikasi Service Account Drive (${res.status}).`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('Access token Drive tidak tersedia.');
  return json.access_token;
}

async function ensureDriveFolder(token: string, name: string, parentId: string): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`,
    fields: 'files(id)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (findRes.ok) {
    const found = (await findRes.json()) as { files?: Array<{ id: string }> };
    if (found.files?.[0]?.id) return found.files[0].id;
  }
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    }
  );
  if (!createRes.ok) throw new Error(`Gagal membuat folder Drive "${name}".`);
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Cache-Control', 'no-store');
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
    const caller = await verifyCaller(req);
    const roomId = normalizeRoomId(String(body.roomId || ''));
    if (!roomId || !canCallerAccessRoom(caller, roomId)) {
      res.status(403).json({ ok: false, error: 'Tidak memiliki akses ke ruang chat ini.' });
      return;
    }

    const transitPath = String(body.transitPath || '').trim().replace(/^\/+/, '');
    if (
      !transitPath ||
      transitPath.includes('..') ||
      transitPath.includes('\\') ||
      transitPath.includes('?') ||
      transitPath.includes('#') ||
      !/^[a-zA-Z0-9._:/-]+$/.test(transitPath)
    ) {
      res.status(400).json({ ok: false, error: 'Path transit tidak valid.' });
      return;
    }
    if (!transitPath.startsWith(`${caller.role}/${caller.slug}/`) && !(caller.role === 'admin' && transitPath.startsWith('admin/'))) {
      res.status(403).json({ ok: false, error: 'Path transit harus milik sesi Anda.' });
      return;
    }

    const declaredMime = String(body.mimeType || 'application/octet-stream').trim().toLowerCase();
    const safeName = sanitizeFileName(String(body.fileName || transitPath.split('/').pop() || ''));
    if (isVideoMedia(declaredMime, safeName) || isVideoMedia(declaredMime, transitPath)) {
      res.status(400).json({
        ok: false,
        error: 'Video ukuran berapa pun DILARANG transit di Supabase Storage.',
      });
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

    const { url: sbUrl, serviceKey } = getSupabaseEnv();
    const encodedPath = transitPath.split('/').map((s) => encodeURIComponent(s)).join('/');
    const dlRes = await fetch(`${sbUrl}/storage/v1/object/chat-transit/${encodedPath}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!dlRes.ok) {
      res.status(404).json({ ok: false, error: 'Berkas sementara di chat-transit tidak ditemukan.' });
      return;
    }

    const effectiveMime =
      String(dlRes.headers.get('content-type') || declaredMime).split(';')[0].trim().toLowerCase() ||
      declaredMime;
    if (isVideoMedia(effectiveMime, safeName)) {
      await fetch(`${sbUrl}/storage/v1/object/chat-transit/${encodedPath}`, {
        method: 'DELETE',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      }).catch(() => undefined);
      res.status(400).json({ ok: false, error: 'Video ditolak dari jalur transit.' });
      return;
    }

    const buf = Buffer.from(await dlRes.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_NON_VIDEO_BYTES) {
      res.status(400).json({ ok: false, error: 'Ukuran berkas non-video melebihi batas 25 MB.' });
      return;
    }

    const driveCfg = getDriveEnv();
    const accessToken = await getDriveToken(driveCfg);
    const categoryFolder = resolveDriveCategoryFolder(roomId);
    const monthFolder = getJakartaYearMonth();
    const catId = await ensureDriveFolder(accessToken, categoryFolder, driveCfg.rootFolderId);
    const folderId = await ensureDriveFolder(accessToken, monthFolder, catId);
    const folderPath = `${categoryFolder}/${monthFolder}`;

    let uploaded: { id: string; name?: string; size?: string; webViewLink?: string; thumbnailLink?: string };
    if (buf.byteLength > 4 * 1024 * 1024) {
      const initRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,webViewLink,thumbnailLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': effectiveMime,
            'X-Upload-Content-Length': String(buf.byteLength),
          },
          body: JSON.stringify({
            name: safeName,
            parents: [folderId],
            mimeType: effectiveMime,
            description: `Lampiran chat ${roomId} oleh ${caller.displayName}`,
          }),
        }
      );
      const loc = (initRes.headers.get('location') || '').trim();
      if (!initRes.ok || !loc) throw new Error('Gagal memulai unggah dokumen besar ke Drive.');
      const putRes = await fetch(loc, {
        method: 'PUT',
        headers: { 'Content-Type': effectiveMime, 'Content-Length': String(buf.byteLength) },
        body: new Uint8Array(buf),
      });
      if (!putRes.ok) throw new Error('Gagal mengunggah dokumen ke Drive.');
      uploaded = (await putRes.json()) as typeof uploaded;
    } else {
      const boundary = `sk_drive_${crypto.randomBytes(12).toString('hex')}`;
      const metaPart = JSON.stringify({
        name: safeName,
        parents: [folderId],
        description: `Lampiran chat ${roomId} oleh ${caller.displayName}`,
      });
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n--${boundary}\r\nContent-Type: ${effectiveMime}\r\n\r\n`,
          'utf-8'
        ),
        buf,
        Buffer.from(`\r\n--${boundary}--`, 'utf-8'),
      ]);
      const upRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size,webViewLink,thumbnailLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: new Uint8Array(payload),
        }
      );
      if (!upRes.ok) throw new Error(`Gagal upload ke Drive (${upRes.status}).`);
      uploaded = (await upRes.json()) as typeof uploaded;
    }

    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    ).catch(() => undefined);

    const delRes = await fetch(`${sbUrl}/storage/v1/object/chat-transit/${encodedPath}`, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });

    const isPhoto =
      effectiveMime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic|heif)$/i.test(safeName);
    const attachmentType: 'photo' | 'document' = isPhoto ? 'photo' : 'document';
    const webViewLink = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`;
    const attachmentUrl = isPhoto
      ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w1600`
      : webViewLink;
    const thumbnailUrl = isPhoto
      ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w480`
      : uploaded.thumbnailLink || null;
    const finalSize = Number(uploaded.size || buf.byteLength);

    let messageUpdated = false;
    if (messageId) {
      const rpcRes = await sbRest('/rest/v1/rpc/update_chat_message_attachment', {
        method: 'POST',
        body: JSON.stringify({
          p_message_id: messageId,
          p_attachment_type: attachmentType,
          p_attachment_name: uploaded.name || safeName,
          p_attachment_mime: effectiveMime,
          p_attachment_size_bytes: finalSize,
          p_attachment_storage_provider: 'google_drive',
          p_attachment_drive_file_id: uploaded.id,
          p_attachment_drive_folder_path: folderPath,
          p_attachment_url: attachmentUrl,
          p_attachment_thumbnail_url: thumbnailUrl,
          p_attachment_status: 'ready',
        }),
      });
      if (rpcRes.ok) {
        messageUpdated = true;
      } else {
        const patchRes = await sbRest(
          `/rest/v1/community_chat_messages?id=eq.${encodeURIComponent(messageId)}`,
          {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({
              attachment_type: attachmentType,
              attachment_name: uploaded.name || safeName,
              attachment_mime: effectiveMime,
              attachment_size_bytes: finalSize,
              attachment_storage_provider: 'google_drive',
              attachment_drive_file_id: uploaded.id,
              attachment_drive_folder_path: folderPath,
              attachment_url: attachmentUrl,
              attachment_thumbnail_url: thumbnailUrl,
              attachment_status: 'ready',
            }),
          }
        );
        messageUpdated = patchRes.ok;
      }
    }

    res.status(200).json({
      ok: true,
      storageProvider: 'google_drive',
      attachmentType,
      driveFileId: uploaded.id,
      folderPath,
      fileName: uploaded.name || safeName,
      mimeType: effectiveMime,
      sizeBytes: finalSize,
      attachmentUrl,
      thumbnailUrl,
      webViewLink,
      transitDeleted: delRes.ok,
      messageUpdated,
    });
  } catch (err) {
    const statusCode =
      typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    res.status(statusCode).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal memindahkan lampiran ke Google Drive.',
    });
  }
}
