import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Lock,
  Play,
} from 'lucide-react';
import type { SessionUser } from '../../types';
import type { ChatMessage } from '../../lib/chatService';
import { fetchPrivateAttachmentBlobUrl, isPrivateChatRoom } from '../../lib/chatMediaUpload';
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

export function ChatMessageAttachmentBubble({
  session,
  message,
  isMine,
  onOpenAttachment,
}: ChatMessageAttachmentBubbleProps) {
  const attachmentType = message.attachment_type;
  const [privateThumbUrl, setPrivateThumbUrl] = useState<string | null>(null);
  const [privateThumbLoading, setPrivateThumbLoading] = useState(false);
  const [imageError, setImageError] = useState(false);

  const isPrivateRoom =
    message.drive_permission_scope === 'restricted_private' ||
    isPrivateChatRoom(message.room_id);

  const isPending =
    message.attachment_status === 'pending_transfer' ||
    message.attachment_status === 'uploading_video';
  const isFailed = message.attachment_status === 'failed';
  const isReady =
    !isPending &&
    !isFailed &&
    Boolean(
      message.attachment_drive_file_id ||
        message.drive_web_view_link ||
        message.attachment_url
    );

  // Untuk foto pada ruang privat (`grup_pengurus` / `dm:*`), muat thumbnail via proxy aman
  useEffect(() => {
    setImageError(false);
    if (
      attachmentType !== 'photo' ||
      !isPrivateRoom ||
      !isReady ||
      !message.attachment_drive_file_id
    ) {
      setPrivateThumbUrl(null);
      setPrivateThumbLoading(false);
      return;
    }

    let active = true;
    let revokeFn: (() => void) | null = null;
    const controller = new AbortController();
    setPrivateThumbLoading(true);

    void (async () => {
      try {
        const res = await fetchPrivateAttachmentBlobUrl(session, message, {
          mode: 'thumbnail',
          signal: controller.signal,
        });
        if (!active) {
          res.revoke();
          return;
        }
        revokeFn = res.revoke;
        setPrivateThumbUrl(res.objectUrl);
      } catch {
        if (!active) return;
        setPrivateThumbUrl(null);
      } finally {
        if (active) setPrivateThumbLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      if (revokeFn) {
        try {
          revokeFn();
        } catch {
          // Abaikan
        }
      }
    };
  }, [
    attachmentType,
    isPrivateRoom,
    isReady,
    message.id,
    message.attachment_drive_file_id,
    message.room_id,
    session,
  ]);

  if (!attachmentType || attachmentType === 'none') {
    return null;
  }

  const fileName = message.attachment_name || 'Lampiran Media';
  const extLabel = getFileExtensionLabel(fileName, message.attachment_mime);
  const sizeLabel = message.attachment_size_bytes
    ? formatFileSize(message.attachment_size_bytes)
    : null;

  const publicDriveLink = !isPrivateRoom
    ? isSafeExternalUrl(message.drive_web_view_link)
      ? message.drive_web_view_link
      : isSafeExternalUrl(message.attachment_url)
        ? message.attachment_url
        : null
    : null;

  const publicPhotoPreviewSrc = !isPrivateRoom
    ? [
        message.attachment_thumbnail_url,
        message.drive_thumbnail_link,
        message.attachment_url,
      ].find((u) => isSafeExternalUrl(u)) || null
    : null;

  const resolvedPhotoSrc = isPrivateRoom ? privateThumbUrl : publicPhotoPreviewSrc;

  const cardSurfaceClass = isMine
    ? 'bg-white/14 border-white/25 text-white'
    : 'bg-indigo-50/75 border-indigo-200/80 text-[#0F172A]';

  const subTextClass = isMine ? 'text-sky-100/85' : 'text-slate-600';

  const driveBtnClass = isMine
    ? 'bg-white/95 hover:bg-white text-[#312E81] border border-white/80'
    : 'bg-white hover:bg-indigo-50 text-[#312E81] border border-indigo-200';

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
              ? 'Sedang mengunggah video ke Google Drive...'
              : 'Sedang memindahkan ke Google Drive...'}
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
            ? 'bg-rose-950/35 border-rose-300/40 text-rose-100'
            : 'bg-rose-50 border-rose-200 text-rose-800'
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
      {/* Pratinjau sesuai tipe lampiran */}
      {attachmentType === 'photo' ? (
        <div
          className={`w-full min-w-0 rounded-xl border overflow-hidden ${cardSurfaceClass}`}
        >
          {privateThumbLoading ? (
            <div className="h-36 w-full flex flex-col items-center justify-center gap-1.5 px-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className={`text-[10.5px] ${subTextClass}`}>Memuat pratinjau aman...</span>
            </div>
          ) : resolvedPhotoSrc && !imageError ? (
            <button
              type="button"
              onClick={() => onOpenAttachment(message)}
              aria-label={`Perbesar foto ${fileName}`}
              className="block w-full text-left cursor-pointer focus:outline-none"
            >
              <img
                src={resolvedPhotoSrc}
                alt={fileName}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImageError(true)}
                className="w-full max-h-52 object-cover block bg-slate-900/10"
              />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenAttachment(message)}
              className="w-full px-3 py-4 flex items-center gap-2.5 text-left cursor-pointer"
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  isMine ? 'bg-white/15 text-white' : 'bg-white text-[#312E81]'
                }`}
              >
                <ImageIcon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold truncate">{fileName}</p>
                <p className={`text-[10.5px] truncate ${subTextClass}`}>
                  <span>{extLabel}</span>
                  {sizeLabel ? <span> · {sizeLabel}</span> : null}
                  <span> · Ketuk untuk pratinjau</span>
                </p>
              </div>
            </button>
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
          onClick={() => onOpenAttachment(message)}
          className={`w-full min-w-0 rounded-xl border p-2.5 text-left flex items-center gap-2.5 cursor-pointer transition-opacity hover:opacity-95 ${cardSurfaceClass}`}
        >
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isMine ? 'bg-white/20 text-white' : 'bg-[#312E81] text-white'
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
          className={`w-full min-w-0 rounded-xl border p-2.5 flex items-start gap-2.5 ${cardSurfaceClass}`}
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              isMine ? 'bg-white/20 text-white' : 'bg-white text-[#312E81] border border-indigo-100'
            }`}
          >
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold leading-snug line-clamp-2 break-words">{fileName}</p>
            <p className={`text-[10.5px] truncate mt-0.5 ${subTextClass}`}>
              <span>{extLabel}</span>
              {sizeLabel ? <span className="tabular-nums"> · {sizeLabel}</span> : null}
              <span> · {isPrivateRoom ? 'Privat Drive' : 'Google Drive'}</span>
            </p>
          </div>
        </div>
      )}

      {/* Tombol Wajib: Buka di Google Drive (Publik via anyone_link vs Privat via chat-drive-private-access) */}
      {isReady &&
        (!isPrivateRoom && publicDriveLink ? (
          <a
            href={publicDriveLink}
            target="_blank"
            rel="noopener noreferrer"
            className={`w-full min-h-[38px] px-3 py-1.5 rounded-xl text-[11.5px] font-bold inline-flex items-center justify-center gap-1.5 shadow-2xs transition-colors min-w-0 ${driveBtnClass}`}
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Buka di Google Drive</span>
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onOpenAttachment(message)}
            className={`w-full min-h-[38px] px-3 py-1.5 rounded-xl text-[11.5px] font-bold inline-flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer min-w-0 ${driveBtnClass}`}
          >
            {isPrivateRoom ? (
              <Lock className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">Buka di Google Drive</span>
          </button>
        ))}
    </div>
  );
}
