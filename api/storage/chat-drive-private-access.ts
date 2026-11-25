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

async function verifyCaller(headers: {
  role: string;
  blokRumah: string;
  petugasId: string;
}): Promise<VerifiedCaller> {
  const rawRole = normalizeToken(headers.role);
  const rawBlok = String(headers.blokRumah || '').trim();
  const rawPetId = String(headers.petugasId || '').trim();

  if (rawRole === 'admin') {
    const uname = canonicalAdminUsername(rawBlok);
    if (!uname) throw Object.assign(new Error('Identitas Pengurus tidak lengkap.'), { statusCode: 401 });
    const res = await sbRest<Array<{ blok_rumah?: string; nama_warga?: string }>>(
      '/rest/v1/users_warga?aktif=eq.true&role=in.(admin,bendahara)&select=blok_rumah,nama_warga'
    );
    const matched = (res.data || []).find((r) => canonicalAdminUsername(r.blok_rumah) === uname);
    if (!matched) throw Object.assign(new Error('Akun Pengurus tidak aktif.'), { statusCode: 403 });
    try {
      const rpcCheck = await sbRest<unknown>('/rest/v1/rpc/validate_login_account_status', {
        method: 'POST',
        body: JSON.stringify({ p_identifier: uname, p_portal: 'admin' }),
      });
      if (rpcCheck.ok && rpcCheck.data) {
        const row = Array.isArray(rpcCheck.data) ? rpcCheck.data[0] : rpcCheck.data;
        if (row && typeof row === 'object' && 'is_active_pengurus' in row) {
          const activeFlag = (row as { is_active_pengurus?: unknown }).is_active_pengurus;
          if (activeFlag === false || String(activeFlag).toLowerCase() === 'false') {
            throw Object.assign(
              new Error('Status Pengurus Anda telah dinonaktifkan (is_active_pengurus = false).'),
              { statusCode: 403 }
            );
          }
        }
      }
    } catch (rpcErr) {
      if ((rpcErr as { statusCode?: number })?.statusCode === 403) throw rpcErr;
    }
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

function getSigningSecret(): string {
  return (
    process.env.CHAT_MEDIA_SIGNING_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
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

async function isInsideRootCategory(
  token: string,
  rootFolderId: string,
  fileParents: string[] | undefined,
  roomId: string
): Promise<boolean> {
  if (!Array.isArray(fileParents) || fileParents.length === 0) return false;
  const expectedCat = resolveDriveCategoryFolder(roomId);
  const mRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileParents[0])}?supportsAllDrives=true&fields=parents`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!mRes.ok) return false;
  const mJson = (await mRes.json().catch(() => ({}))) as { parents?: string[] };
  const catId = mJson.parents?.[0];
  if (!catId) return false;
  const cRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(catId)}?supportsAllDrives=true&fields=name,parents`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!cRes.ok) return false;
  const cJson = (await cRes.json().catch(() => ({}))) as { name?: string; parents?: string[] };
  return cJson.name === expectedCat && Array.isArray(cJson.parents) && cJson.parents.includes(rootFolderId);
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

  const action = String(bodyObj.action || getQueryParam(req, 'action') || '').trim().toLowerCase();
  let fileId = String(bodyObj.fileId || bodyObj.driveFileId || getQueryParam(req, 'fileId') || '').trim();
  let rawRoomId = String(bodyObj.roomId || getQueryParam(req, 'roomId') || '').trim();
  const messageId = String(bodyObj.messageId || getQueryParam(req, 'messageId') || '').trim();
  const modeRaw = String(bodyObj.mode || getQueryParam(req, 'mode') || 'stream').trim().toLowerCase();
  const mode: 'stream' | 'download' | 'thumbnail' =
    modeRaw === 'download' ? 'download' : modeRaw === 'thumbnail' ? 'thumbnail' : 'stream';

  let callerHeaders = {
    role: getHeader(req.headers, 'x-user-role'),
    blokRumah: getHeader(req.headers, 'x-blok-rumah'),
    petugasId: getHeader(req.headers, 'x-petugas-id'),
  };

  const sig = getQueryParam(req, 'sig');
  const expParam = Number(getQueryParam(req, 'exp') || '0');
  if ((method === 'GET' || method === 'HEAD') && sig) {
    const ro = getQueryParam(req, 'ro');
    const b = getQueryParam(req, 'b');
    const p = getQueryParam(req, 'p');
    if (!verifyStreamToken({ fileId, roomId: rawRoomId, role: ro, blokRumah: b, petugasId: p, exp: expParam }, sig)) {
      await recordUnauthorizedAudit({
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
    callerHeaders = { role: ro, blokRumah: b, petugasId: p };
  }

  try {
    let caller: VerifiedCaller;
    try {
      caller = await verifyCaller(callerHeaders);
    } catch (authErr) {
      const msg = authErr instanceof Error ? authErr.message : 'Identitas tidak valid.';
      await recordUnauthorizedAudit({ headers: callerHeaders, roomId: rawRoomId, fileId, messageId, reason: msg });
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
    let dbRow: PrivateMessageLookupRow | null = null;

    if (messageId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
        res.status(400).json({ ok: false, error: 'Format messageId tidak valid.' });
        return;
      }
      const msgRes = await sbRest<PrivateMessageLookupRow[]>(
        `/rest/v1/community_chat_messages?id=eq.${encodeURIComponent(
          messageId
        )}&select=id,room_id,sender_id,recipient_id,attachment_drive_file_id&limit=1`
      );
      if (!msgRes.data?.[0]) {
        await recordUnauthorizedAudit({
          headers: callerHeaders,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason: 'Pesan lampiran privat tidak ditemukan.',
        });
        res.status(403).json({ ok: false, error: 'Akses lampiran privat ditolak.' });
        return;
      }
      dbRow = msgRes.data[0];
    } else if (fileId && /^[a-zA-Z0-9_-]{10,120}$/.test(fileId)) {
      const msgRes = await sbRest<PrivateMessageLookupRow[]>(
        `/rest/v1/community_chat_messages?attachment_drive_file_id=eq.${encodeURIComponent(
          fileId
        )}&select=id,room_id,sender_id,recipient_id,attachment_drive_file_id&limit=1`
      );
      if (msgRes.data?.[0]) dbRow = msgRes.data[0];
    }

    if (dbRow) {
      if (!fileId && dbRow.attachment_drive_file_id) {
        fileId = String(dbRow.attachment_drive_file_id).trim();
      }
      if (fileId && dbRow.attachment_drive_file_id && dbRow.attachment_drive_file_id !== fileId) {
        await recordUnauthorizedAudit({
          headers: callerHeaders,
          roomId: dbRow.room_id,
          fileId,
          messageId,
          reason: 'driveFileId tidak cocok dengan record pesan.',
        });
        res.status(403).json({ ok: false, error: 'Berkas Google Drive tidak cocok dengan pesan terkait.' });
        return;
      }
      const dbRoom = normalizeRoomId(String(dbRow.room_id || ''));
      if (rawRoomId && normalizeRoomId(rawRoomId) !== dbRoom) {
        await recordUnauthorizedAudit({
          headers: callerHeaders,
          roomId: rawRoomId,
          fileId,
          messageId,
          reason: 'roomId tidak cocok dengan ruang asal pesan.',
        });
        res.status(403).json({ ok: false, error: 'Ruang chat lampiran tidak cocok.' });
        return;
      }
      rawRoomId = dbRoom;
    }

    const roomId = normalizeRoomId(rawRoomId);
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(fileId) || !roomId) {
      await recordUnauthorizedAudit({
        headers: callerHeaders,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason: 'Parameter fileId atau roomId tidak valid.',
      });
      res.status(403).json({ ok: false, error: 'Parameter akses berkas privat tidak valid.' });
      return;
    }

    let authorized = canCallerAccessRoom(caller, roomId);
    let denyReason = 'Bukan anggota ruang chat terkait.';
    if (roomId === 'grup_pengurus' && caller.role !== 'admin') {
      authorized = false;
      denyReason = 'Berkas Grup Pengurus khusus untuk Pengurus aktif.';
    } else if (roomId.startsWith('dm:')) {
      if (!authorized) {
        denyReason = 'Peminta bukan pengirim maupun penerima sah pada percakapan DM ini.';
      } else if (dbRow) {
        const senderNorm = normalizeParticipantId(String(dbRow.sender_id || ''));
        const recNorm = dbRow.recipient_id ? normalizeParticipantId(String(dbRow.recipient_id)) : '';
        const isSenderOrRecipient =
          caller.matchIds.has(senderNorm) || (recNorm ? caller.matchIds.has(recNorm) : false);
        if (!isSenderOrRecipient && !canCallerAccessRoom(caller, roomId)) {
          authorized = false;
          denyReason = 'Peminta bukan pengirim maupun penerima pesan DM.';
        }
      }
    }

    if (!authorized) {
      await recordUnauthorizedAudit({ headers: callerHeaders, roomId, fileId, messageId, reason: denyReason });
      res.status(403).json({ ok: false, error: `Akses ditolak: ${denyReason}` });
      return;
    }

    const driveCfg = getDriveEnv();
    const accessToken = await getDriveToken(driveCfg);
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

    if (!dbRow) {
      const okTree = await isInsideRootCategory(accessToken, driveCfg.rootFolderId, fileMeta.parents, roomId);
      if (!okTree) {
        await recordUnauthorizedAudit({
          headers: callerHeaders,
          roomId,
          fileId,
          messageId,
          reason: 'Berkas Drive di luar struktur arsip ruang chat yang diminta.',
        });
        res.status(403).json({ ok: false, error: 'Berkas tidak terdaftar pada folder ruang chat ini.' });
        return;
      }
    }

    if (method === 'POST' && action === 'mint_stream_url') {
      const exp = Date.now() + STREAM_URL_TTL_MS;
      const signedSig = signStreamToken({
        fileId,
        roomId,
        role: callerHeaders.role.trim(),
        blokRumah: callerHeaders.blokRumah.trim(),
        petugasId: callerHeaders.petugasId.trim(),
        exp,
      });
      const qs = new URLSearchParams({
        fileId,
        roomId,
        ro: callerHeaders.role.trim(),
        b: callerHeaders.blokRumah.trim(),
        p: callerHeaders.petugasId.trim(),
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
      const tRes = await fetch(fileMeta.thumbnailLink, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (tRes.ok) {
        res.setHeader('Content-Type', tRes.headers.get('content-type') || 'image/jpeg');
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
    }

    const rangeHeader = getHeader(req.headers, 'range').trim();
    const driveHeaders: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (rangeHeader && /^bytes=\d*-\d*$/i.test(rangeHeader)) {
      driveHeaders.Range = rangeHeader;
    }

    const mediaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { method: 'GET', headers: driveHeaders }
    );
    if (!mediaRes.ok && mediaRes.status !== 206) {
      res.status(mediaRes.status === 416 ? 416 : 502).json({
        ok: false,
        error: `Gagal mengalirkan berkas dari Google Drive (${mediaRes.status}).`,
      });
      return;
    }

    const safeFileName = sanitizeFileName(fileMeta.name || `lampiran-${fileId}`);
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

    await streamDriveResponse(mediaRes, res);
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
