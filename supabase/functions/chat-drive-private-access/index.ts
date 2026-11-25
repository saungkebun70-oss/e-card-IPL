import {
  buildCorsHeaders,
  canCallerAccessRoom,
  getDriveServiceAccountToken,
  getSupabaseAdminClient,
  jsonResponse,
  loadDriveServiceAccountConfig,
  normalizeChatRoomId,
  normalizeParticipantId,
  recordUnauthorizedDriveAccessAudit,
  resolveDriveCategoryFolder,
  sanitizeFileName,
  signPrivateStreamToken,
  verifyChatCaller,
  verifyPrivateStreamToken,
} from '../_shared/chatDriveCore.ts';

const STREAM_URL_TTL_MS = 5 * 60 * 1000; // 5 menit

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

  // Dukungan URL bertanda tangan jangka pendek untuk tag <video>/<audio>/<img> native Range seeking
  let effectiveReq = req;
  const sig = url.searchParams.get('sig') || '';
  const expParam = Number(url.searchParams.get('exp') || '0');
  if ((req.method === 'GET' || req.method === 'HEAD') && sig) {
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
        error: 'Akses ditolak: token aliran media privat tidak valid atau telah kedaluwarsa.',
      });
    }
    const syntheticHeaders = new Headers(req.headers);
    syntheticHeaders.set('x-user-role', ro);
    syntheticHeaders.set('x-blok-rumah', b);
    syntheticHeaders.set('x-petugas-id', p);
    effectiveReq = new Request(req.url, { method: req.method, headers: syntheticHeaders });
  }

  try {
    let caller;
    try {
      caller = await verifyChatCaller(effectiveReq);
    } catch (authErr) {
      const msg = authErr instanceof Error ? authErr.message : 'Identitas tidak valid.';
      await recordUnauthorizedDriveAccessAudit({
        req: effectiveReq,
        roomId: rawRoomId,
        fileId,
        messageId,
        reason: msg,
      });
      return jsonResponse(req, 403, { ok: false, error: msg });
    }

    const { client } = getSupabaseAdminClient();
    let dbMessageRow: {
      id: string;
      room_id: string;
      sender_id: string;
      recipient_id?: string | null;
      attachment_drive_file_id?: string | null;
    } | null = null;

    if (messageId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId)) {
        return jsonResponse(req, 400, { ok: false, error: 'Format messageId tidak valid.' });
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
        return jsonResponse(req, 403, { ok: false, error: 'Akses lampiran privat ditolak.' });
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
        error: 'Parameter akses berkas privat tidak valid.',
      });
    }

    // Verifikasi otorisasi ketat sesuai jenis ruang
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
      return jsonResponse(req, 403, { ok: false, error: `Akses ditolak: ${denyReason}` });
    }

    const driveCfg = loadDriveServiceAccountConfig();
    const accessToken = await getDriveServiceAccountToken(driveCfg);

    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed,thumbnailLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      return jsonResponse(req, 404, { ok: false, error: 'Berkas tidak ditemukan di Google Drive.' });
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
      return jsonResponse(req, 404, { ok: false, error: 'Berkas telah dihapus dari Google Drive.' });
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
          error: 'Berkas tidak terdaftar pada folder ruang chat ini.',
        });
      }
    }

    // Jika POST action = mint_stream_url, terbitkan URL stream sementara untuk tag <video>/<audio>/<img>
    if (req.method === 'POST' && action === 'mint_stream_url') {
      const exp = Date.now() + STREAM_URL_TTL_MS;
      const roleVal = (effectiveReq.headers.get('x-user-role') || '').trim();
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

      const endpointBase = `${url.origin}${url.pathname}`;
      return jsonResponse(req, 200, {
        ok: true,
        streamUrl: `${endpointBase}?${streamParams.toString()}`,
        expiresAt: new Date(exp).toISOString(),
        mimeType: fileMeta.mimeType || 'application/octet-stream',
        fileName: fileMeta.name || `lampiran-${fileId}`,
        sizeBytes: Number(fileMeta.size || 0),
        drivePermissionScope: 'restricted_private',
      });
    }

    // Mode thumbnail privat via Service Account
    if (mode === 'thumbnail' && fileMeta.thumbnailLink) {
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
        method: req.method === 'HEAD' ? 'GET' : 'GET',
        headers: driveFetchHeaders,
      }
    );

    if (!mediaRes.ok && mediaRes.status !== 206) {
      const errText = await mediaRes.text().catch(() => '');
      return jsonResponse(req, mediaRes.status === 416 ? 416 : 502, {
        ok: false,
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
    const statusCode =
      typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    return jsonResponse(req, statusCode, {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal mengakses berkas privat Google Drive.',
    });
  }
});
