import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Download,
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Lock,
  Maximize2,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { SessionUser } from '../../types';
import type { ChatAttachmentType, ChatMessage } from '../../lib/chatService';
import {
  extractDriveFileIdFromAttachment,
  fetchPrivateAttachmentBlobUrl,
  getCachedPrivateAttachmentBlobUrl,
  isPrivateChatRoom,
} from '../../lib/chatMediaUpload';
import {
  formatFileSize,
  getFileExtensionLabel,
  isSafeExternalUrl,
} from '../../lib/chat/attachmentUtils';

interface ChatMessageAttachmentBubbleProps {
  session: SessionUser;
  message: ChatMessage;
  isMine: boolean;
  onOpenAttachment: (message: ChatMessage) => void;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i;

function resolveEffectiveAttachmentInfo(message: ChatMessage): {
  type: ChatAttachmentType;
  driveFileId: string;
  fileName: string;
  mimeType: string;
} {
  const driveFileId = extractDriveFileIdFromAttachment(message);
  const tagMatch = message.message.trim().match(/^\[(foto|video|dokumen|file)\]\s+(.+)$/i);
  const fileName =
    (message.attachment_name || '').trim() ||
    (tagMatch?.[2] ? tagMatch[2].trim() : '') ||
    'Lampiran Media';
  const mimeType = (message.attachment_mime || '').trim().toLowerCase();
  const hasAnyLink = Boolean(
    driveFileId || message.attachment_url || message.drive_web_view_link
  );

  let type: ChatAttachmentType = message.attachment_type || 'none';
  if (mimeType.startsWith('image/') || IMAGE_EXT_RE.test(fileName)) {
    if (type !== 'none' || hasAnyLink) type = 'photo';
  } else if (mimeType.startsWith('video/') || VIDEO_EXT_RE.test(fileName)) {
    if (type !== 'none' || hasAnyLink) type = 'video';
  } else if (type === 'none' && hasAnyLink) {
    if (tagMatch?.[1]?.toLowerCase() === 'foto') {
      type = 'photo';
    } else if (tagMatch?.[1]?.toLowerCase() === 'video') {
      type = 'video';
    } else {
      type = 'document';
    }
  }

  return { type, driveFileId, fileName, mimeType };
}

function renderDocumentIcon(fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (
    /\.(xls|xlsx|csv)$/i.test(lowerName) ||
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('excel') ||
    lowerMime === 'text/csv'
  ) {
    return <FileSpreadsheet className="w-4 h-4" />;
  }
  if (
    /\.(pdf|doc|docx|txt|ppt|pptx)$/i.test(lowerName) ||
    lowerMime === 'application/pdf' ||
    lowerMime.includes('wordprocessing') ||
    lowerMime === 'application/msword' ||
    lowerMime.startsWith('text/')
  ) {
    return <FileText className="w-4 h-4" />;
  }
  return <File className="w-4 h-4" />;
}

export function ChatMessageAttachmentBubble({
  session,
  message,
  isMine,
  onOpenAttachment,
}: ChatMessageAttachmentBubbleProps) {
  const {
    type: attachmentType,
    driveFileId,
    fileName,
    mimeType,
  } = useMemo(() => resolveEffectiveAttachmentInfo(message), [message]);

  const [retryToken, setRetryToken] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [downloadingDoc, setDownloadingDoc] = useState(false);

  const isPrivateRoom =
    message.drive_permission_scope === 'restricted_private' ||
    isPrivateChatRoom(message.room_id);

  const isPending =
    message.attachment_status === 'pending_transfer' ||
    message.attachment_status === 'uploading_video';
  const isFailed = message.attachment_status === 'failed';
  const isOptimisticLocalPreview = Boolean(
    message.local_preview_url && message.id?.startsWith('optimistic-')
  );
  const isReady =
    (!isPending || isOptimisticLocalPreview) &&
    !isFailed &&
    Boolean(
      driveFileId ||
        message.local_preview_url ||
        message.drive_web_view_link ||
        message.attachment_url
    );

  const resolvedMessage = useMemo<ChatMessage>(
    () => ({
      ...message,
      attachment_type: attachmentType,
      attachment_name: fileName,
      attachment_mime: mimeType || message.attachment_mime || null,
      attachment_drive_file_id: driveFileId || message.attachment_drive_file_id || null,
    }),
    [message, attachmentType, fileName, mimeType, driveFileId]
  );

  const cachedBlob = useMemo(
    () =>
      attachmentType === 'photo' && isReady && driveFileId
        ? getCachedPrivateAttachmentBlobUrl(session, resolvedMessage)
        : null,
    [attachmentType, isReady, driveFileId, session, resolvedMessage]
  );

  const [proxyPhotoUrl, setProxyPhotoUrl] = useState<string | null>(() => cachedBlob?.objectUrl || null);
  const [proxyPhotoLoading, setProxyPhotoLoading] = useState<boolean>(
    () => attachmentType === 'photo' && isReady && Boolean(driveFileId) && !cachedBlob
  );
  const [proxyPhotoError, setProxyPhotoError] = useState(false);

  // Muat otomatis gambar melalui proxy `chat-drive-private-access` (POST { driveFileId })
  // dengan cache memori berdasarkan drive_file_id agar tampil instan tanpa berkedip.
  useEffect(() => {
    setImageError(false);
    setProxyPhotoError(false);

    if (attachmentType !== 'photo' || !isReady || !driveFileId) {
      setProxyPhotoUrl(null);
      setProxyPhotoLoading(false);
      return;
    }

    if (retryToken === 0) {
      const hit = getCachedPrivateAttachmentBlobUrl(session, {
        id: message.id,
        room_id: message.room_id,
        attachment_drive_file_id: driveFileId,
      });
      if (hit) {
        setProxyPhotoUrl(hit.objectUrl);
        setProxyPhotoLoading(false);
        return;
      }
    }

    let active = true;
    const controller = new AbortController();
    setProxyPhotoLoading(true);

    void (async () => {
      try {
        const res = await fetchPrivateAttachmentBlobUrl(
          session,
          {
            id: message.id,
            room_id: message.room_id,
            attachment_drive_file_id: driveFileId,
            attachment_url: message.attachment_url,
            attachment_thumbnail_url: message.attachment_thumbnail_url,
            drive_permission_scope: message.drive_permission_scope,
            drive_web_view_link: message.drive_web_view_link,
            drive_thumbnail_link: message.drive_thumbnail_link,
          },
          {
            mode: 'stream',
            signal: controller.signal,
            forceRefresh: retryToken > 0,
          }
        );
        if (!active) return;
        setProxyPhotoUrl(res.objectUrl);
      } catch {
        if (!active) return;
        setProxyPhotoUrl(null);
        setProxyPhotoError(true);
      } finally {
        if (active) setProxyPhotoLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    attachmentType,
    isReady,
    driveFileId,
    message.id,
    message.room_id,
    message.attachment_url,
    message.attachment_thumbnail_url,
    message.drive_permission_scope,
    message.drive_web_view_link,
    message.drive_thumbnail_link,
    session,
    retryToken,
  ]);

  if (!attachmentType || attachmentType === 'none') {
    return null;
  }

  const extLabel = getFileExtensionLabel(fileName, mimeType || message.attachment_mime);
  const sizeLabel = message.attachment_size_bytes
    ? formatFileSize(message.attachment_size_bytes)
    : null;

  const fallbackExternalPhotoSrc = !driveFileId
    ? message.local_preview_url ||
      [
        message.attachment_thumbnail_url,
        message.drive_thumbnail_link,
        message.attachment_url,
      ].find((u) => isSafeExternalUrl(u)) ||
      null
    : null;

  const resolvedPhotoSrc = driveFileId ? proxyPhotoUrl || message.local_preview_url || null : fallbackExternalPhotoSrc;

  const publicDriveLink = !isPrivateRoom
    ? isSafeExternalUrl(message.drive_web_view_link)
      ? message.drive_web_view_link
      : isSafeExternalUrl(message.attachment_url)
        ? message.attachment_url
        : null
    : null;

  const handleDirectDownloadDocument = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloadingDoc) return;

    if (!driveFileId) {
      if (publicDriveLink) {
        const link = document.createElement('a');
        link.href = publicDriveLink;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else {
        onOpenAttachment(resolvedMessage);
      }
      return;
    }

    setDownloadingDoc(true);
    try {
      const res = await fetchPrivateAttachmentBlobUrl(session, resolvedMessage, {
        mode: 'download',
      });
      const link = document.createElement('a');
      link.href = res.objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      onOpenAttachment(resolvedMessage);
    } finally {
      setDownloadingDoc(false);
    }
  };

  const cardSurfaceClass = isMine
    ? 'bg-white/14 border-white/25 text-[#FFFDF8]'
    : 'bg-[#F6F3EA]/90 border-[#E6E2D6] text-[#1B271B]';

  const subTextClass = isMine ? 'text-[#E5EEE3]/85' : 'text-[#4A554A]';

  const actionBtnPrimaryClass = isMine
    ? 'bg-[#FFFDF8] hover:bg-white text-[#243825] border border-white/80'
    : 'bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] border border-[#2B3F29]';

  const actionBtnSecondaryClass = isMine
    ? 'bg-white/15 hover:bg-white/25 text-[#FFFDF8] border border-white/30'
    : 'bg-[#FFFDF8] hover:bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]';

  if (isPending) {
    return (
      <div
        className={`mb-2 w-full min-w-0 max-w-full rounded-xl border px-2.5 py-2 flex items-center gap-2 ${cardSurfaceClass}`}
      >
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold truncate">{fileName}</p>
          <p className={`text-[10.5px] truncate ${subTextClass}`}>
            {message.attachment_status === 'uploading_video'
              ? 'Sedang mengunggah video...'
              : 'Sedang memproses lampiran...'}
          </p>
        </div>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div
        className={`mb-2 w-full min-w-0 max-w-full rounded-xl border px-2.5 py-2 flex items-center gap-2 ${
          isMine
            ? 'bg-[#C87058]/30 border-[#E2A898]/50 text-[#FFFDF8]'
            : 'bg-[#C87058]/10 border-[#E2A898] text-[#7A311E]'
        }`}
      >
        <AlertCircle className="w-4 h-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-semibold truncate">{fileName}</p>
          <p className="text-[10.5px] truncate">Unggahan lampiran gagal diproses.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-2 w-full min-w-0 max-w-full space-y-1.5 overflow-hidden">
      {attachmentType === 'photo' ? (
        <div className={`w-full min-w-0 rounded-xl border overflow-hidden ${cardSurfaceClass}`}>
          {proxyPhotoLoading ? (
            <div className="h-40 w-full min-w-[200px] flex flex-col items-center justify-center gap-1.5 px-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className={`text-[10.5px] ${subTextClass}`}>Memuat pratinjau gambar...</span>
            </div>
          ) : resolvedPhotoSrc && !imageError ? (
            <button
              type="button"
              onClick={() => onOpenAttachment(resolvedMessage)}
              aria-label={`Perbesar foto ${fileName}`}
              className="group/thumb relative block w-full text-left cursor-pointer focus:outline-none"
            >
              <img
                src={resolvedPhotoSrc}
                alt={fileName}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImageError(true)}
                className="w-full max-h-60 min-h-[110px] object-cover block bg-[#1B271B]/10"
              />
              {isOptimisticLocalPreview ? (
                <span className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-[#1B271B]/65 text-[#FFFDF8] text-[10px] font-semibold inline-flex items-center gap-1 backdrop-blur-xs">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Mengirim...</span>
                </span>
              ) : null}
              <span className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-[#1B271B]/60 text-[#FFFDF8] text-[10px] font-semibold inline-flex items-center gap-1 opacity-90 sm:opacity-0 sm:group-hover/thumb:opacity-100 transition-opacity backdrop-blur-xs">
                <Maximize2 className="w-3 h-3" />
                <span>Pratinjau</span>
              </span>
            </button>
          ) : (
            <div className="w-full px-3 py-3 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => onOpenAttachment(resolvedMessage)}
                className="flex-1 min-w-0 flex items-center gap-2.5 text-left cursor-pointer"
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    isMine ? 'bg-white/15 text-[#FFFDF8]' : 'bg-[#FFFDF8] text-[#243825] border border-[#E6E2D6]'
                  }`}
                >
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold truncate">{fileName}</p>
                  <p className={`text-[10.5px] truncate ${subTextClass}`}>
                    <span>{extLabel}</span>
                    {sizeLabel ? <span> · {sizeLabel}</span> : null}
                    <span>
                      {' · '}
                      {proxyPhotoError ? 'Gagal memuat pratinjau' : 'Ketuk untuk buka'}
                    </span>
                  </p>
                </div>
              </button>
              {driveFileId && (
                <button
                  type="button"
                  onClick={() => setRetryToken((t) => t + 1)}
                  aria-label="Muat ulang gambar"
                  title="Muat ulang gambar"
                  className={`h-8 px-2.5 rounded-lg text-[10.5px] font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${actionBtnSecondaryClass}`}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Muat</span>
                </button>
              )}
            </div>
          )}

          <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 border-t border-inherit min-w-0">
            <p className="text-[11px] font-semibold truncate min-w-0 flex-1">{fileName}</p>
            {sizeLabel && (
              <span className={`text-[10px] font-mono tabular-nums shrink-0 ${subTextClass}`}>
                {sizeLabel}
              </span>
            )}
          </div>
        </div>
      ) : attachmentType === 'video' ? (
        <button
          type="button"
          onClick={() => onOpenAttachment(resolvedMessage)}
          className={`w-full min-w-0 rounded-xl border p-2.5 text-left flex items-center gap-2.5 cursor-pointer transition-opacity hover:opacity-95 ${cardSurfaceClass}`}
        >
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isMine ? 'bg-white/20 text-[#FFFDF8]' : 'bg-[#2B3F29] text-[#FFFDF8]'
            }`}
          >
            <Play className="w-4 h-4 fill-current ml-0.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-snug line-clamp-2 break-words">{fileName}</p>
            <p className={`text-[10.5px] truncate mt-0.5 ${subTextClass}`}>
              <span>Video {extLabel}</span>
              {sizeLabel ? <span className="tabular-nums"> · {sizeLabel}</span> : null}
              <span> · {isPrivateRoom ? 'Privat' : 'Putar'}</span>
            </p>
          </div>
          <Film className={`w-4 h-4 shrink-0 ${subTextClass}`} />
        </button>
      ) : (
        <div
          className={`w-full min-w-0 rounded-xl border p-2.5 space-y-2 ${cardSurfaceClass}`}
        >
          <button
            type="button"
            onClick={() => onOpenAttachment(resolvedMessage)}
            className="w-full flex items-start gap-2.5 text-left cursor-pointer min-w-0"
          >
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isMine
                  ? 'bg-white/20 text-[#FFFDF8]'
                  : 'bg-[#FFFDF8] text-[#243825] border border-[#E6E2D6]'
              }`}
            >
              {renderDocumentIcon(fileName, mimeType || message.attachment_mime || '')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-snug line-clamp-2 break-words">{fileName}</p>
              <p className={`text-[10.5px] truncate mt-0.5 ${subTextClass}`}>
                <span className="font-semibold">{extLabel}</span>
                {sizeLabel ? <span className="tabular-nums"> · {sizeLabel}</span> : null}
                <span> · {isPrivateRoom ? 'Privat' : 'Lampiran'}</span>
              </p>
            </div>
          </button>

          {isReady && (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onOpenAttachment(resolvedMessage)}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors min-w-0 ${actionBtnSecondaryClass}`}
              >
                {isPrivateRoom ? (
                  <Lock className="w-3 h-3 shrink-0" />
                ) : (
                  <ExternalLink className="w-3 h-3 shrink-0" />
                )}
                <span className="truncate">Buka</span>
              </button>

              <button
                type="button"
                disabled={downloadingDoc}
                onClick={(e) => void handleDirectDownloadDocument(e)}
                className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 min-w-0 ${actionBtnPrimaryClass}`}
              >
                {downloadingDoc ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                ) : (
                  <Download className="w-3 h-3 shrink-0" />
                )}
                <span className="truncate">{downloadingDoc ? 'Mengunduh...' : 'Unduh'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
