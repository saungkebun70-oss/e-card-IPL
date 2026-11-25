import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Lock,
  RotateCcw,
  X,
} from 'lucide-react';
import type { SessionUser } from '../../types';
import type { ChatMessage } from '../../lib/chatService';
import {
  fetchPrivateAttachmentBlobUrl,
  isPrivateChatRoom,
  resolveChatAttachmentAccess,
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
        sourceUrl: null,
        mimeType: target.attachment_mime || '',
        isBlob: false,
      });

      const isPrivate =
        target.drive_permission_scope === 'restricted_private' ||
        isPrivateChatRoom(target.room_id);

      try {
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
            throw new Error('Tautan Google Drive untuk lampiran ini tidak tersedia.');
          }
          setState({
            loading: false,
            error: null,
            sourceUrl: safeUrl,
            mimeType: target.attachment_mime || '',
            isBlob: false,
          });
          return;
        }

        if (target.attachment_type === 'video') {
          const access = await resolveChatAttachmentAccess(session, target, {
            mode: 'stream',
            signal,
          });
          if (signal.aborted) return;
          setState({
            loading: false,
            error: null,
            sourceUrl: access.url,
            mimeType: access.mimeType || target.attachment_mime || 'video/mp4',
            isBlob: false,
            expiresAt: access.expiresAt,
          });
          return;
        }

        const blobRes = await fetchPrivateAttachmentBlobUrl(session, target, {
          mode: target.attachment_type === 'photo' ? 'stream' : 'download',
          signal,
        });
        if (signal.aborted) {
          blobRes.revoke();
          return;
        }
        revokeRef.current = blobRes.revoke;
        setState({
          loading: false,
          error: null,
          sourceUrl: blobRes.objectUrl,
          mimeType: blobRes.mimeType || target.attachment_mime || 'application/octet-stream',
          isBlob: true,
        });
      } catch (err) {
        if (signal.aborted) return;
        setState({
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : 'Gagal memverifikasi akses berkas di Google Drive.',
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

  if (!message) return null;

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

  const attachmentType = message.attachment_type || 'document';
  const canIframeDoc =
    attachmentType === 'document' &&
    Boolean(state.sourceUrl) &&
    canPreviewInlineInIframe(state.mimeType || message.attachment_mime || '', fileName);

  const handleRetry = () => {
    const controller = new AbortController();
    void loadAttachment(message, controller.signal);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pratinjau lampiran ${fileName}`}
      className="fixed inset-0 z-[80] flex items-center justify-center p-2.5 sm:p-5 bg-slate-950/75 backdrop-blur-sm"
    >
      <button
        type="button"
        aria-label="Tutup pratinjau lampiran"
        onClick={onClose}
        className="absolute inset-0 w-full h-full cursor-default"
      />

      <div className="relative z-10 w-full max-w-3xl max-h-[90dvh] flex flex-col rounded-3xl bg-white border border-indigo-100 shadow-2xl overflow-hidden min-w-0">
        {/* Header Modal */}
        <div className="px-3.5 py-3 sm:px-5 sm:py-3.5 border-b border-indigo-100 bg-indigo-50/60 flex items-center justify-between gap-2.5 shrink-0 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-white border border-indigo-100 text-[#312E81] flex items-center justify-center shrink-0">
              {attachmentType === 'photo' ? (
                <ImageIcon className="w-4 h-4" />
              ) : attachmentType === 'video' ? (
                <Film className="w-4 h-4" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm font-bold text-[#0F172A] truncate">{fileName}</p>
              <p className="text-[11px] text-slate-600 truncate mt-0.5">
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
                <span className="inline-flex items-center gap-1 font-semibold text-[#312E81]">
                  {isPrivate && <Lock className="w-3 h-3 inline" />}
                  {isPrivate ? 'Akses Privat Terverifikasi' : 'Google Drive Publik'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pratinjau"
            className="min-h-[40px] min-w-[40px] rounded-xl border border-indigo-200 bg-white hover:bg-slate-100 text-slate-700 inline-flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Pratinjau */}
        <div className="flex-1 min-h-[240px] overflow-auto bg-slate-900/5 p-3 sm:p-4 flex items-center justify-center">
          {state.loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-[#312E81]" />
              <p className="text-xs sm:text-sm font-semibold text-[#0F172A]">
                {isPrivate
                  ? 'Memverifikasi izin anggota ruang & memuat dari Google Drive...'
                  : 'Menyiapkan pratinjau Google Drive...'}
              </p>
            </div>
          ) : state.error ? (
            <div className="max-w-md w-full rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 mx-auto flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-rose-900">Akses Berkas Tidak Dapat Dibuka</p>
                <p className="text-xs text-rose-700 leading-relaxed break-words">{state.error}</p>
              </div>
              <button
                type="button"
                onClick={handleRetry}
                className="min-h-[40px] px-4 rounded-xl bg-[#312E81] hover:bg-[#3730A3] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
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
              className="max-h-[64dvh] max-w-full rounded-2xl object-contain shadow-sm bg-white"
            />
          ) : attachmentType === 'video' && state.sourceUrl ? (
            isPrivate || state.sourceUrl.includes('chat-drive-private-access') ? (
              <video
                src={state.sourceUrl}
                controls
                playsInline
                autoPlay
                className="w-full max-h-[64dvh] rounded-2xl bg-black shadow-md"
              >
                Peramban Anda tidak mendukung pemutaran video langsung.
              </video>
            ) : (
              <div className="max-w-md w-full rounded-2xl border border-indigo-100 bg-white p-5 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-[#312E81] mx-auto flex items-center justify-center">
                  <Film className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[#0F172A] break-words">{fileName}</p>
                  <p className="text-xs text-slate-500">
                    Video tersimpan di Google Drive. Gunakan tombol di bawah untuk memutar atau
                    membuka berkas langsung di Google Drive.
                  </p>
                </div>
              </div>
            )
          ) : canIframeDoc && state.sourceUrl ? (
            <iframe
              title={`Pratinjau ${fileName}`}
              src={state.sourceUrl}
              className="w-full h-[60dvh] rounded-2xl border border-indigo-100 bg-white"
            />
          ) : (
            <div className="max-w-md w-full rounded-2xl border border-indigo-100 bg-white p-5 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-[#312E81] mx-auto flex items-center justify-center">
                <FileText className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-[#0F172A] break-words">{fileName}</p>
                <p className="text-xs text-slate-600">
                  {imageLoadFailed
                    ? 'Pratinjau gambar tidak dapat ditampilkan di layar ini.'
                    : 'Berkas terverifikasi aman. Silakan unduh atau buka di tab baru.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Aksi */}
        <div className="px-3.5 py-3 sm:px-5 border-t border-indigo-100 bg-white flex flex-wrap items-center justify-between gap-2 shrink-0">
          <p className="text-[11px] text-slate-500">
            {isPrivate
              ? 'Dilayani aman via proxy chat-drive-private-access.'
              : 'Tautan baca anggota ruang via Google Drive.'}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {state.sourceUrl && (
              <a
                href={state.sourceUrl}
                download={state.isBlob ? fileName : undefined}
                target={state.isBlob ? undefined : '_blank'}
                rel={state.isBlob ? undefined : 'noopener noreferrer'}
                className="min-h-[40px] px-3.5 rounded-xl bg-gradient-to-tr from-[#312E81] to-[#0284C7] hover:brightness-105 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-xs"
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
                className="min-h-[40px] px-3.5 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-[#312E81] text-xs font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span>Buka di Google Drive</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
