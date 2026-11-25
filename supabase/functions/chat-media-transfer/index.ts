import {
  applyRoomDrivePermissionPolicy,
  buildCorsHeaders,
  buildPrivateDriveProxyUrl,
  canCallerAccessRoom,
  classifyNonVideoAttachmentType,
  getDriveServiceAccountToken,
  getSupabaseAdminClient,
  isVideoMedia,
  jsonResponse,
  loadDriveServiceAccountConfig,
  MAX_NON_VIDEO_TRANSIT_BYTES,
  normalizeChatRoomId,
  resolveMonthlyChatDriveFolder,
  sanitizeFileName,
  type SenderCallerHint,
  updateChatAttachmentRecord,
  uploadBytesToDrive,
  validateSafeTransitPath,
  verifyChatCaller,
  verifyMessageOwnershipIfPresent,
} from '../_shared/chatDriveCore.ts';

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

    stage = 'download_from_transit';
    const { client } = getSupabaseAdminClient();
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
      // Hapus segera jika file video terlanjur masuk sebelum ditolak
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

    stage = 'upload_to_drive';
    const driveCfg = loadDriveServiceAccountConfig();
    const accessToken = await getDriveServiceAccountToken(driveCfg);
    const { folderId, folderPath } = await resolveMonthlyChatDriveFolder(
      accessToken,
      driveCfg.rootFolderId,
      roomId
    );

    const uploaded = await uploadBytesToDrive({
      accessToken,
      folderId,
      fileName: safeName,
      mimeType: effectiveMime,
      bytes,
      description: `Lampiran chat ${roomId} oleh ${caller.displayName} (${caller.senderId})`,
    });

    stage = 'apply_drive_permissions';
    // Terapkan kebijakan izin Drive otomatis sesuai jenis ruang chat
    const drivePermissionScope = await applyRoomDrivePermissionPolicy(
      accessToken,
      uploaded.id,
      roomId
    );

    stage = 'delete_transit';
    // WAJIB hapus file sementara dari chat-transit setelah drive_file_id diperoleh
    const { error: removeErr } = await client.storage.from('chat-transit').remove([transitPath]);
    const transitDeleted = !removeErr;

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
    const statusCode =
      typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    const errorMessage =
      err instanceof Error ? err.message : 'Gagal memindahkan lampiran ke Google Drive.';

    console.error('[chat-media-transfer] transfer failed', {
      stage,
      statusCode,
      errorMessage,
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
    });
  }
});
