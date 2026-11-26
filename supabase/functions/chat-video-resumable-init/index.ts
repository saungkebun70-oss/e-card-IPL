import {
  buildCorsHeaders,
  buildDriveApiFailureError,
  canCallerAccessRoom,
  getAllowedResumableOrigin,
  getDriveServiceAccountToken,
  isVideoMedia,
  jsonResponse,
  loadDriveServiceAccountConfig,
  MAX_VIDEO_RESUMABLE_BYTES,
  normalizeChatRoomId,
  parseGoogleDriveApiError,
  resolveMonthlyChatDriveFolder,
  sanitizeFileName,
  type SenderCallerHint,
  updateChatAttachmentRecord,
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

  try {
    const body = (await req.json().catch(() => ({}))) as {
      roomId?: string;
      messageId?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      transitPath?: string;
      sender?: SenderCallerHint;
    };
    const caller = await verifyChatCaller(req, body.sender || null);

    if (body.transitPath) {
      return jsonResponse(req, 400, {
        ok: false,
        error: 'Video DILARANG menggunakan bucket transit Supabase Storage.',
      });
    }

    const roomId = normalizeChatRoomId(String(body.roomId || ''));
    if (!roomId || !canCallerAccessRoom(caller, roomId)) {
      return jsonResponse(req, 403, {
        ok: false,
        error: 'Anda tidak memiliki akses mengunggah video ke ruang chat ini.',
      });
    }

    const safeName = sanitizeFileName(body.fileName || `video-${Date.now()}.mp4`, 'mp4');
    const cleanMime = String(body.mimeType || 'video/mp4').trim().toLowerCase();
    if (!isVideoMedia(cleanMime, safeName)) {
      return jsonResponse(req, 400, {
        ok: false,
        error: 'Endpoint ini khusus untuk berkas video (direct Google Drive resumable upload).',
      });
    }

    const sizeBytes = Number(body.sizeBytes || 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_RESUMABLE_BYTES) {
      return jsonResponse(req, 400, {
        ok: false,
        error: `Ukuran video harus antara 1 byte hingga ${Math.round(
          MAX_VIDEO_RESUMABLE_BYTES / (1024 * 1024)
        )} MB.`,
      });
    }

    await verifyMessageOwnershipIfPresent(body.messageId, roomId, caller);

    const driveCfg = loadDriveServiceAccountConfig();
    const accessToken = await getDriveServiceAccountToken(driveCfg);
    const { folderId, folderPath } = await resolveMonthlyChatDriveFolder(
      accessToken,
      driveCfg.rootFolderId,
      roomId,
      null,
      driveCfg
    );

    const allowedOrigin = getAllowedResumableOrigin(req);
    const initHeaders: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': cleanMime.startsWith('video/') ? cleanMime : 'video/mp4',
      'X-Upload-Content-Length': String(Math.round(sizeBytes)),
    };
    if (allowedOrigin) {
      initHeaders.Origin = allowedOrigin;
    }

    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,thumbnailLink',
      {
        method: 'POST',
        headers: initHeaders,
        body: JSON.stringify({
          name: safeName,
          parents: [folderId],
          mimeType: cleanMime.startsWith('video/') ? cleanMime : 'video/mp4',
          description: `Video chat ${roomId} oleh ${caller.displayName} (${caller.senderId})`,
        }),
      }
    );

    if (!initRes.ok) {
      const initErr = await parseGoogleDriveApiError(initRes);
      throw buildDriveApiFailureError(
        'Gagal menginisiasi sesi Resumable Upload Google Drive',
        initErr,
        driveCfg
      );
    }

    const sessionUri = (initRes.headers.get('location') || '').trim();
    if (!sessionUri.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      return jsonResponse(req, 502, {
        ok: false,
        error: 'Google Drive tidak mengembalikan URI sesi resumable yang valid.',
      });
    }

    if (body.messageId) {
      await updateChatAttachmentRecord({
        messageId: body.messageId,
        attachmentType: 'video',
        attachmentName: safeName,
        attachmentMime: cleanMime,
        attachmentSizeBytes: Math.round(sizeBytes),
        storageProvider: 'google_drive',
        driveFileId: null,
        driveFolderPath: folderPath,
        attachmentUrl: null,
        thumbnailUrl: null,
        status: 'uploading_video',
      });
    }

    return jsonResponse(req, 200, {
      ok: true,
      sessionUri,
      folderId,
      folderPath,
      fileName: safeName,
      mimeType: cleanMime,
      sizeBytes: Math.round(sizeBytes),
      storageProvider: 'google_drive',
    });
  } catch (err) {
    const typedErr = err as {
      statusCode?: number;
      missingFields?: string[];
      invalidFields?: string[];
      fieldReasons?: Record<string, string>;
    };
    const statusCode = typeof typedErr?.statusCode === 'number' ? typedErr.statusCode : 500;
    const missingFields = Array.isArray(typedErr?.missingFields) ? typedErr.missingFields : undefined;
    const invalidFields = Array.isArray(typedErr?.invalidFields) ? typedErr.invalidFields : undefined;
    const fieldReasons =
      typedErr?.fieldReasons && typeof typedErr.fieldReasons === 'object'
        ? typedErr.fieldReasons
        : undefined;
    return jsonResponse(req, statusCode, {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal membuat sesi unggah video Google Drive.',
      ...(missingFields?.length ? { missingFields } : {}),
      ...(invalidFields?.length ? { invalidFields } : {}),
      ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
    });
  }
});
