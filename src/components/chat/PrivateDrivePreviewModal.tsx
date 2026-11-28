import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  Lock,
  RotateCcw,
  Video,
  X,
} from 'lucide-react';
import type { SessionUser } from '../../types';
import type { ChatMessage } from '../../lib/chatService';
import {
  extractDriveFileIdFromAttachment,
  fetchPrivateAttachmentBlobUrl,
  isPrivateChatRoom,
  resolveChatAttachmentAccess,
  sanitizeUserFacingChatUploadError,
} from '../../lib/chatMediaUpload';
import {
  formatFileSize,
  getFileExtensionLabel,
  isSafeExternalUrl,
} from '../../lib/chat/attachmentUtils';

interface PrivateDrivePreviewModalProps {
  session: SessionUser;
  message: ChatMessage | null;
  onClose: () => void;
}

interface PreviewState {
  loading: boolean;
  error: string | null;
  reason?: string | null;
  sourceUrl: string | null;
  mimeType: string;
  isBlob: boolean;
  expiresAt?: string;
}

function canPreviewInlineInIframe(mimeType: string, fileName: string): boolean {
  const m = mimeType.toLowerCase();
  const n = fileName.toLowerCase();
  return (
    m === 'application/pdf' ||
    n.endsWith('.pdf') ||
    m.startsWith('text/') ||
    /\.(txt|csv)$/i.test(n)
  );
}

export function PrivateDrivePreviewModal({
  session,
  message,
  onClose,
}: PrivateDrivePreviewModalProps) {
  const [state, setState] = useState<PreviewState>({
    loading: false,
    error: null,
    reason: null,
    sourceUrl: null,
    mimeType: '',
    isBlob: false,
  });
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const revokeRef = useRef<(() => void) | null>(null);

  const cleanupRevoke = useCallback(() => {
    if (revokeRef.current) {
      try {
        revokeRef.current();
      } catch {
        // Abaikan
      }
      revokeRef.current = null;
    }
  }, []);

  const loadAttachment = useCallback(
    async (target: ChatMessage, signal: AbortSignal) => {
      cleanupRevoke();
      setImageLoadFailed(false);
      setState({
        loading: true,
        error: null,
        reason: null,
        sourceUrl: null,
        mimeType: target.attachment_mime || '',
        isBlob: false,
      });

      const isPrivate =
        target.drive_permission_scope === 'restricted_private' ||
        isPrivateChatRoom(target.room_id);
      const effectiveFileId = extractDriveFileIdFromAttachment(target);
      const lowerName = String(target.attachment_name || '').toLowerCase();
      const lowerMime = String(target.attachment_mime || '').toLowerCase();
      const resolvedType =
        lowerMime.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(lowerName)
          ? 'photo'
          : lowerMime.startsWith('video/') || /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i.test(lowerName)
            ? 'video'
            : target.attachment_type || 'document';

      try {
        if (resolvedType === 'video') {
          const access = await resolveChatAttachmentAccess(session, target, {
            mode: 'stream',
            signal,
          });
          if (signal.aborted) return;
          const safeUrl = access.url || target.drive_web_view_link || '';
          if (!safeUrl) {
            throw new Error('Tautan untuk video ini tidak tersedia.');
          }
          setState({
            loading: false,
            error: null,
            reason: null,
            sourceUrl: safeUrl,
            mimeType: access.mimeType || target.attachment_mime || 'video/mp4',
            isBlob: false,
            expiresAt: access.expiresAt,
          });
          return;
        }

        if (effectiveFileId) {
          const blobRes = await fetchPrivateAttachmentBlobUrl(
            session,
            { ...target, attachment_drive_file_id: effectiveFileId },
            {
              mode: resolvedType === 'photo' ? 'stream' : 'download',
              signal,
            }
          );
          if (signal.aborted) {
            blobRes.revoke();
            return;
          }
          revokeRef.current = blobRes.revoke;
          setState({
            loading: false,
            error: null,
            reason: null,
            sourceUrl: blobRes.objectUrl,
            mimeType: blobRes.mimeType || target.attachment_mime || 'application/octet-stream',
            isBlob: true,
          });
          return;
        }

        if (!isPrivate) {
          const publicAccess = await resolveChatAttachmentAccess(session, target, {
            mode: 'stream',
            signal,
          });
          if (signal.aborted) return;
          const safeUrl = isSafeExternalUrl(publicAccess.url)
            ? publicAccess.url
            : isSafeExternalUrl(target.drive_web_view_link)
              ? target.drive_web_view_link || ''
              : '';
          if (!safeUrl) {
            throw new Error('Tautan untuk lampiran ini tidak tersedia.');
          }
          setState({
            loading: false,
            error: null,
            reason: null,
            sourceUrl: safeUrl,
            mimeType: target.attachment_mime || '',
            isBlob: false,
          });
          return;
        }

        throw new Error('ID berkas untuk lampiran privat tidak tersedia.');
      } catch (err) {
        if (signal.aborted) return;
        const rawReason = (err as { reason?: unknown } | null)?.reason;
        const cleanReason =
          typeof rawReason === 'string' && rawReason.trim()
            ? sanitizeUserFacingChatUploadError(rawReason.trim())
            : null;
        setState({
          loading: false,
          error:
            err instanceof Error
              ? sanitizeUserFacingChatUploadError(
                  err.message,
                  'Gagal memverifikasi akses berkas lampiran.'
                )
              : 'Gagal memverifikasi akses berkas lampiran.',
          reason: cleanReason,
          sourceUrl: null,
          mimeType: target.attachment_mime || '',
          isBlob: false,
        });
      }
    },
    [cleanupRevoke, session]
  );

  useEffect(() => {
    if (!message) {
      cleanupRevoke();
      return;
    }
    const controller = new AbortController();
    void loadAttachment(message, controller.signal);
    return () => {
      controller.abort();
      cleanupRevoke();
    };
  }, [message, loadAttachment, cleanupRevoke]);

  useEffect(() => {
    if (!message) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [message, onClose]);

  if (!message || typeof document === 'undefined') return null;

  const fileName = message.attachment_name || 'Lampiran Chat';
  const extLabel = getFileExtensionLabel(fileName, state.mimeType || message.attachment_mime);
  const isPrivate =
    message.drive_permission_scope === 'restricted_private' ||
    isPrivateChatRoom(message.room_id);
  const safeDriveWebLink = isSafeExternalUrl(message.drive_web_view_link)
    ? message.drive_web_view_link
    : isSafeExternalUrl(message.attachment_url)
      ? message.attachment_url
      : null;

  const lowerModalName = fileName.toLowerCase();
  const lowerModalMime = (state.mimeType || message.attachment_mime || '').toLowerCase();
  const attachmentType =
    lowerModalMime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|heic|heif|bmp)$/i.test(lowerModalName)
      ? 'photo'
      : lowerModalMime.startsWith('video/') ||
          /\.(mp4|mov|mkv|avi|webm|3gp|m4v)$/i.test(lowerModalName)
        ? 'video'
        : message.attachment_type || 'document';
  const canIframeDoc =
    attachmentType === 'document' &&
    Boolean(state.sourceUrl) &&
    canPreviewInlineInIframe(state.mimeType || message.attachment_mime || '', fileName);

  const handleRetry = () => {
    const controller = new AbortController();
    void loadAttachment(message, controller.signal);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pratinjau lampiran ${fileName}`}
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[10000] bg-[#1B271B]/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 no-print"
    >
      <button
        type="button"
        aria-label="Tutup pratinjau lampiran"
        onClick={onClose}
        className="absolute inset-0 w-full h-full cursor-default"
      />

      <div className="relative z-10 w-full max-w-lg max-h-[88dvh] bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl shadow-2xl overflow-hidden flex flex-col min-w-0">
        {/* Header Modal (shrink-0) */}
        <div className="shrink-0 px-4 py-3.5 border-b border-[#E6E2D6] flex items-center justify-between gap-3 min-w-0 bg-[#FFFDF8]">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="w-9 h-9 rounded-xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0">
              {attachmentType === 'photo' ? (
                <ImageIcon className="w-4 h-4" />
              ) : attachmentType === 'video' ? (
                <Video className="w-4 h-4" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm font-bold text-[#1B271B] truncate">{fileName}</p>
              <p className="text-[11px] text-[#4A554A] truncate mt-0.5">
                <span>{extLabel}</span>
                {message.attachment_size_bytes ? (
                  <>
                    <span> · </span>
                    <span className="tabular-nums">
                      {formatFileSize(message.attachment_size_bytes)}
                    </span>
                  </>
                ) : null}
                <span> · </span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#243825]">
                  {isPrivate && <Lock className="w-3 h-3 inline" />}
                  {isPrivate ? 'Akses Privat Terverifikasi' : 'Lampiran Ruang Chat'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau"
            className="w-9 h-9 rounded-full bg-[#F6F3EA] hover:bg-[#E5EEE3] text-[#4A554A] inline-flex items-center justify-center cursor-pointer shrink-0 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Konten Media (flex-1 min-h-0) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 bg-[#F6F3EA]/70 flex items-center justify-center">
          {state.loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-[#2B3F29]" />
              <p className="text-xs sm:text-sm font-semibold text-[#1B271B]">
                {isPrivate
                  ? 'Memverifikasi izin anggota ruang & memuat lampiran...'
                  : 'Menyiapkan pratinjau lampiran...'}
              </p>
            </div>
          ) : state.error ? (
            <div className="max-w-md w-full rounded-2xl border border-[#E2A898] bg-[#C87058]/10 p-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#C87058]/15 text-[#9A422B] mx-auto flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-bold text-[#7A311E]">
                  {isPrivate || /ditolak|privat/i.test(state.error)
                    ? 'Akses lampiran privat ditolak'
                    : 'Akses Berkas Tidak Dapat Dibuka'}
                </p>
                <p className="text-xs text-[#7A311E] leading-relaxed break-words">
                  {state.reason || state.error}
                </p>
                {state.reason &&
                  state.error &&
                  state.reason.trim() !== state.error.trim() &&
                  !/^Akses lampiran privat ditolak\.?$/i.test(state.error.trim()) && (
                    <p className="text-[11px] text-[#9A422B] leading-relaxed break-words">
                      {state.error}
                    </p>
                  )}
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="min-h-[40px] px-4 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Coba Lagi</span>
              </button>
            </div>
          ) : attachmentType === 'photo' && state.sourceUrl && !imageLoadFailed ? (
            <img
              src={state.sourceUrl}
              alt={fileName}
              referrerPolicy="no-referrer"
              onError={() => setImageLoadFailed(true)}
              className="w-auto h-auto max-w-full max-h-[54dvh] object-contain rounded-2xl shadow-sm mx-auto bg-[#FFFDF8]"
            />
          ) : attachmentType === 'video' && state.sourceUrl ? (
            isPrivate || state.sourceUrl.includes('chat-drive-private-access') ? (
              <video
                src={state.sourceUrl}
                controls
                playsInline
                autoPlay
                className="w-full max-h-[54dvh] rounded-2xl bg-black shadow-md"
              >
                Peramban Anda tidak mendukung pemutaran video langsung.
              </video>
            ) : (
              <div className="max-w-md w-full rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-5 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl mx-auto bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center">
                  <Video className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[#1B271B] break-words">{fileName}</p>
                  <p className="text-xs text-[#4A554A]">
                    Video siap diputar. Gunakan tombol di bawah untuk memutar atau membuka berkas.
                  </p>
                </div>
              </div>
            )
          ) : canIframeDoc && state.sourceUrl ? (
            <iframe
              title={`Pratinjau ${fileName}`}
              src={state.sourceUrl}
              className="w-full h-[54dvh] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8]"
            />
          ) : (
            <div className="max-w-md w-full rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-5 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl mx-auto bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-[#1B271B] break-words">{fileName}</p>
                <p className="text-xs text-[#4A554A]">
                  {imageLoadFailed
                    ? 'Pratinjau gambar tidak dapat ditampilkan di layar ini.'
                    : 'Berkas terverifikasi aman. Silakan unduh atau buka berkas.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Aksi (shrink-0) */}
        <div className="shrink-0 px-4 py-3.5 border-t border-[#E6E2D6] bg-[#FFFDF8] flex flex-col sm:flex-row items-center justify-between gap-2.5 pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))]">
          <p className="text-[11px] text-[#6E786D] text-center sm:text-left">
            {isPrivate
              ? 'Akses privat terverifikasi untuk anggota ruang.'
              : 'Lampiran aman untuk anggota ruang chat.'}
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
            {state.sourceUrl && (
              <a
                href={state.sourceUrl}
                download={state.isBlob ? fileName : undefined}
                target={state.isBlob ? undefined : '_blank'}
                rel={state.isBlob ? undefined : 'noopener noreferrer'}
                className="min-h-[40px] px-3.5 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>{state.isBlob ? 'Unduh Berkas' : 'Buka Berkas'}</span>
              </a>
            )}

            {!isPrivate && safeDriveWebLink && (
              <a
                href={safeDriveWebLink}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[40px] px-3.5 rounded-xl border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D7E4D4] text-[#243825] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span>Buka di Tab Baru</span>
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-3.5 rounded-xl border border-[#E6E2D6] bg-[#F6F3EA] hover:bg-[#E5EEE3] text-[#1B271B] text-xs font-semibold inline-flex items-center justify-center cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
