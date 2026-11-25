// Vercel Serverless Function: POST /api/storage/complete-video-resumable-upload
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
    return { role: 'admin', senderId: `admin:${uname}`, displayName: String(matched.nama_warga || 'Pengurus'), matchIds };
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
    return { role: 'warga', senderId: `warga:${lower}`, displayName: String(matched.nama_warga || `Warga ${canon}`), matchIds };
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
    return { role: 'petugas', senderId: `petugas:${pid}`, displayName: String(matched.nama || 'Petugas Keamanan'), matchIds };
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

async function findDriveFolderId(token: string, name: string, parentId: string): Promise<string | null> {
  const safe = name.replace(/'/g, "\\'");
  const params = new URLSearchParams({
    q: `name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`,
    fields: 'files(id)',
    pageSize: '5',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { files?: Array<{ id: string }> };
  return json.files?.[0]?.id || null;
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

    const driveFileId = String(body.driveFileId || '').trim();
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(driveFileId)) {
      res.status(400).json({ ok: false, error: 'driveFileId Google Drive tidak valid.' });
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
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        driveFileId
      )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,webViewLink,thumbnailLink,trashed`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      res.status(404).json({ ok: false, error: 'Berkas video tidak ditemukan di Google Drive.' });
      return;
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
      res.status(400).json({ ok: false, error: 'Berkas video telah dihapus dari Drive.' });
      return;
    }

    const effectiveMime = String(fileMeta.mimeType || 'video/mp4').trim().toLowerCase();
    const effectiveName = String(fileMeta.name || `video-${driveFileId}.mp4`).trim();
    if (!isVideoMedia(effectiveMime, effectiveName)) {
      res.status(400).json({ ok: false, error: 'Berkas Drive bukan tipe video yang valid.' });
      return;
    }

    const categoryFolder = resolveDriveCategoryFolder(roomId);
    const monthFolder = getJakartaYearMonth();
    const catId = await findDriveFolderId(accessToken, categoryFolder, driveCfg.rootFolderId);
    const parentIds = Array.isArray(fileMeta.parents) ? fileMeta.parents : [];
    if (catId && parentIds.length > 0) {
      const monthId = await findDriveFolderId(accessToken, monthFolder, catId);
      let verified = Boolean(monthId && parentIds.includes(monthId));
      if (!verified && parentIds[0]) {
        const pRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            parentIds[0]
          )}?supportsAllDrives=true&fields=parents`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (pRes.ok) {
          const pData = (await pRes.json()) as { parents?: string[] };
          if (Array.isArray(pData.parents) && pData.parents.includes(catId)) verified = true;
        }
      }
      if (!verified) {
        res.status(403).json({ ok: false, error: 'Video tidak berada pada folder Drive ruang chat ini.' });
        return;
      }
    }

    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    ).catch(() => undefined);

    const folderPath =
      typeof body.folderPath === 'string' && body.folderPath.trim()
        ? body.folderPath.trim()
        : `${categoryFolder}/${monthFolder}`;
    const webViewLink =
      fileMeta.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
    const thumbnailUrl =
      fileMeta.thumbnailLink ||
      `https://drive.google.com/thumbnail?id=${encodeURIComponent(driveFileId)}&sz=w640`;
    const sizeBytes = Number(fileMeta.size || 0);

    let messageUpdated = false;
    if (messageId) {
      const rpcRes = await sbRest('/rest/v1/rpc/update_chat_message_attachment', {
        method: 'POST',
        body: JSON.stringify({
          p_message_id: messageId,
          p_attachment_type: 'video',
          p_attachment_name: effectiveName,
          p_attachment_mime: effectiveMime,
          p_attachment_size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
          p_attachment_storage_provider: 'google_drive',
          p_attachment_drive_file_id: driveFileId,
          p_attachment_drive_folder_path: folderPath,
          p_attachment_url: webViewLink,
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
              attachment_type: 'video',
              attachment_name: effectiveName,
              attachment_mime: effectiveMime,
              attachment_size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
              attachment_storage_provider: 'google_drive',
              attachment_drive_file_id: driveFileId,
              attachment_drive_folder_path: folderPath,
              attachment_url: webViewLink,
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
      attachmentType: 'video',
      driveFileId,
      folderPath,
      fileName: effectiveName,
      mimeType: effectiveMime,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      attachmentUrl: webViewLink,
      thumbnailUrl,
      webViewLink,
      messageUpdated,
    });
  } catch (err) {
    const statusCode =
      typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    res.status(statusCode).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menyelesaikan metadata video Google Drive.',
    });
  }
}
