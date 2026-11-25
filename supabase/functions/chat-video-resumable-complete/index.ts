import {
  applyRoomDrivePermissionPolicy,
  buildCorsHeaders,
  buildPrivateDriveProxyUrl,
  canCallerAccessRoom,
  getDriveServiceAccountToken,
  isVideoMedia,
  jsonResponse,
  loadDriveServiceAccountConfig,
  normalizeChatRoomId,
  resolveMonthlyChatDriveFolder,
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
    const caller = await verifyChatCaller(req);
    const body = (await req.json().catch(() => ({}))) as {
      roomId?: string;
      messageId?: string;
      driveFileId?: string;
      folderPath?: string;
    };

    const roomId = normalizeChatRoomId(String(body.roomId || ''));
    if (!roomId || !canCallerAccessRoom(caller, roomId)) {
      return jsonResponse(req, 403, {
        ok: false,
        error: 'Anda tidak memiliki akses ke ruang chat ini.',
      });
    }

    const driveFileId = String(body.driveFileId || '').trim();
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(driveFileId)) {
      return jsonResponse(req, 400, { ok: false, error: 'driveFileId Google Drive tidak valid.' });
    }

    await verifyMessageOwnershipIfPresent(body.messageId, roomId, caller);

    const driveCfg = loadDriveServiceAccountConfig();
    const accessToken = await getDriveServiceAccountToken(driveCfg);

    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        driveFileId
      )}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,webViewLink,webContentLink,thumbnailLink,trashed`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!metaRes.ok) {
      const errText = await metaRes.text().catch(() => '');
      return jsonResponse(req, 404, {
        ok: false,
        error: `Berkas video tidak ditemukan di Google Drive (${metaRes.status}): ${errText.slice(0, 140)}`,
      });
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
      return jsonResponse(req, 400, { ok: false, error: 'Berkas video telah dihapus dari Drive.' });
    }

    const effectiveMime = String(fileMeta.mimeType || 'video/mp4').trim().toLowerCase();
    const effectiveName = String(fileMeta.name || `video-${driveFileId}.mp4`).trim();
    if (!isVideoMedia(effectiveMime, effectiveName)) {
      return jsonResponse(req, 400, {
        ok: false,
        error: 'Berkas yang diselesaikan di Drive bukan tipe video yang valid.',
      });
    }

    const expectedFolder = await resolveMonthlyChatDriveFolder(
      accessToken,
      driveCfg.rootFolderId,
      roomId
    );
    const parentIds = Array.isArray(fileMeta.parents) ? fileMeta.parents : [];
    let parentVerified = parentIds.length === 0 || parentIds.includes(expectedFolder.folderId);
    if (!parentVerified && parentIds[0]) {
      const pRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          parentIds[0]
        )}?supportsAllDrives=true&fields=parents,name`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (pRes.ok) {
        const pData = (await pRes.json()) as { parents?: string[] };
        if (Array.isArray(pData.parents) && pData.parents.length > 0) {
          const grandRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
              pData.parents[0]
            )}?supportsAllDrives=true&fields=name,parents`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (grandRes.ok) {
            const gData = (await grandRes.json()) as { name?: string; parents?: string[] };
            if (
              gData.name === expectedFolder.categoryFolder &&
              Array.isArray(gData.parents) &&
              gData.parents.includes(driveCfg.rootFolderId)
            ) {
              parentVerified = true;
            }
          }
        }
      }
    }
    if (!parentVerified) {
      return jsonResponse(req, 403, {
        ok: false,
        error: 'Berkas video tidak berada pada folder tujuan Google Drive ruang chat ini.',
      });
    }
    const resolvedFolderPath = body.folderPath?.trim() || expectedFolder.folderPath;

    // Terapkan kebijakan izin Google Drive otomatis sesuai jenis ruang chat
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
            messageId: body.messageId,
            mode: 'stream',
          })
        : driveWebViewLink;
    const thumbnailUrl =
      drivePermissionScope === 'restricted_private'
        ? buildPrivateDriveProxyUrl({
            fileId: driveFileId,
            roomId,
            messageId: body.messageId,
            mode: 'thumbnail',
          })
        : driveThumbnailLink;
    const sizeBytes = Number(fileMeta.size || 0);

    const messageUpdated = await updateChatAttachmentRecord({
      messageId: body.messageId,
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

    return jsonResponse(req, 200, {
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
    });
  } catch (err) {
    const statusCode =
      typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    return jsonResponse(req, statusCode, {
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal menyelesaikan metadata video Google Drive.',
    });
  }
});
