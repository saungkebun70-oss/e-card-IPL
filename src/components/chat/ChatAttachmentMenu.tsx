import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileText, Film, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import {
  DOCUMENT_ACCEPT_ATTR,
  VIDEO_ACCEPT_ATTR,
  type AttachmentPickerKind,
} from '../../lib/chat/attachmentUtils';
import { InAppCameraModal } from './InAppCameraModal';

interface ChatAttachmentMenuProps {
  disabled?: boolean;
  onSelectFiles: (files: File[], kind: AttachmentPickerKind) => void;
  onPickingStateChange?: (picking: boolean) => void;
}

interface AttachmentOptionMeta {
  kind: AttachmentPickerKind;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  iconWrapClass: string;
}

const ATTACHMENT_OPTIONS: AttachmentOptionMeta[] = [
  {
    kind: 'camera',
    label: 'Kamera',
    subtitle: 'Ambil foto langsung',
    icon: Camera,
    iconWrapClass: 'bg-indigo-100 text-[#312E81]',
  },
  {
    kind: 'photo',
    label: 'Galeri Foto',
    subtitle: 'JPG, PNG, WEBP · Maks 20 MB',
    icon: ImageIcon,
    iconWrapClass: 'bg-sky-100 text-sky-700',
  },
  {
    kind: 'document',
    label: 'Dokumen',
    subtitle: 'PDF, Excel, Word · Maks 20 MB',
    icon: FileText,
    iconWrapClass: 'bg-amber-100 text-amber-800',
  },
  {
    kind: 'video',
    label: 'Video Semua Ukuran',
    subtitle: 'Semua ukuran · Kirim langsung',
    icon: Film,
    iconWrapClass: 'bg-emerald-100 text-emerald-800',
  },
];

export function ChatAttachmentMenu({
  disabled = false,
  onSelectFiles,
  onPickingStateChange,
}: ChatAttachmentMenuProps) {
  const [open, setOpen] = useState(false);
  const [inAppCameraOpen, setInAppCameraOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const nativePickingActiveRef = useRef(false);
  const focusResetTimerRef = useRef<number | null>(null);

  const clearFocusResetTimer = useCallback(() => {
    if (focusResetTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(focusResetTimerRef.current);
      focusResetTimerRef.current = null;
    }
  }, []);

  const beginPicking = useCallback(() => {
    clearFocusResetTimer();
    onPickingStateChange?.(true);
  }, [clearFocusResetTimer, onPickingStateChange]);

  const finishPicking = useCallback(() => {
    clearFocusResetTimer();
    nativePickingActiveRef.current = false;
    onPickingStateChange?.(false);
  }, [clearFocusResetTimer, onPickingStateChange]);

  useEffect(() => {
    return () => {
      clearFocusResetTimer();
      nativePickingActiveRef.current = false;
      onPickingStateChange?.(false);
    };
  }, [clearFocusResetTimer, onPickingStateChange]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Saat picker native (Kamera/Galeri/File) ditutup/dibatalkan tanpa event onChange pada browser tertentu,
  // lepaskan kunci modal secara aman setelah jeda singkat ketika fokus kembali ke aplikasi.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scheduleSafeReleaseIfIdle = () => {
      if (!nativePickingActiveRef.current) return;
      clearFocusResetTimer();
      focusResetTimerRef.current = window.setTimeout(() => {
        focusResetTimerRef.current = null;
        if (nativePickingActiveRef.current) {
          finishPicking();
        }
      }, 1200);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleSafeReleaseIfIdle();
      }
    };

    window.addEventListener('focus', scheduleSafeReleaseIfIdle);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', scheduleSafeReleaseIfIdle);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [clearFocusResetTimer, finishPicking]);

  // Tangkap event `cancel` bawaan HTMLInputElement saat user menekan batal di file picker/kamera
  useEffect(() => {
    const inputs = [
      cameraInputRef.current,
      photoInputRef.current,
      documentInputRef.current,
      videoInputRef.current,
    ].filter((el): el is HTMLInputElement => Boolean(el));

    const handleCancel = () => {
      finishPicking();
    };

    inputs.forEach((input) => input.addEventListener('cancel', handleCancel));
    return () => {
      inputs.forEach((input) => input.removeEventListener('cancel', handleCancel));
    };
  }, [finishPicking]);

  const triggerNativeInput = useCallback(
    (kind: AttachmentPickerKind) => {
      beginPicking();
      nativePickingActiveRef.current = true;
      if (kind === 'camera') cameraInputRef.current?.click();
      else if (kind === 'photo') photoInputRef.current?.click();
      else if (kind === 'document') documentInputRef.current?.click();
      else videoInputRef.current?.click();
    },
    [beginPicking]
  );

  const handleOpenPicker = (kind: AttachmentPickerKind) => {
    setOpen(false);
    if (disabled) return;

    if (kind === 'camera') {
      const supportsInAppCamera =
        typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
      if (supportsInAppCamera) {
        beginPicking();
        setInAppCameraOpen(true);
        return;
      }
    }

    triggerNativeInput(kind);
  };

  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    kind: AttachmentPickerKind
  ) => {
    const fileList = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    finishPicking();
    if (fileList.length > 0) {
      onSelectFiles(fileList, kind);
    }
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Lampirkan foto, dokumen, atau video"
        title="Lampirkan foto, dokumen, atau video"
        className={`h-11 w-11 min-h-[44px] min-w-[44px] rounded-2xl border inline-flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50 shrink-0 ${
          open
            ? 'bg-[#312E81] text-white border-[#312E81] shadow-xs'
            : 'bg-white/95 hover:bg-indigo-50 text-[#312E81] border-indigo-200/90'
        }`}
      >
        {open ? <X className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Menu lampiran Chat Cepat"
          className="absolute left-0 bottom-14 z-40 w-[min(296px,calc(100vw-2.75rem))] sm:w-[328px] rounded-2xl bg-white/98 backdrop-blur-xl border border-indigo-200/90 shadow-xl shadow-indigo-950/15 p-2 space-y-1"
        >
          <div className="px-2 pt-0.5 pb-1 flex items-center justify-between gap-2 border-b border-indigo-100/80">
            <span className="text-[11px] font-bold text-[#312E81]">Kirim Lampiran</span>
            <span className="text-[10px] text-slate-500">Pilih Jenis Berkas</span>
          </div>

          <div className="grid grid-cols-1 gap-1 pt-0.5">
            {ATTACHMENT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.kind}
                  type="button"
                  role="menuitem"
                  onClick={() => handleOpenPicker(opt.kind)}
                  className="w-full min-h-[46px] px-2.5 py-2 rounded-xl text-left flex items-center gap-2.5 hover:bg-indigo-50/85 active:bg-indigo-100/70 transition-colors cursor-pointer min-w-0"
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${opt.iconWrapClass}`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold text-[#0F172A] leading-tight truncate">
                      {opt.label}
                    </span>
                    <span className="block text-[10.5px] text-slate-500 leading-tight truncate mt-0.5">
                      {opt.subtitle}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Hidden inputs terpisah di luar popover agar tidak pernah ter-unmount saat kamera/picker terbuka */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => handleInputChange(e, 'camera')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => handleInputChange(e, 'photo')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={documentInputRef}
        type="file"
        accept={DOCUMENT_ACCEPT_ATTR}
        multiple
        onChange={(e) => handleInputChange(e, 'document')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept={VIDEO_ACCEPT_ATTR}
        onChange={(e) => handleInputChange(e, 'video')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Modal Kamera In-App (getUserMedia) + Fallback ke input kamera bawaan */}
      <InAppCameraModal
        open={inAppCameraOpen}
        onCapture={(file) => {
          setInAppCameraOpen(false);
          finishPicking();
          onSelectFiles([file], 'camera');
        }}
        onFallbackNativeCamera={() => {
          setInAppCameraOpen(false);
          triggerNativeInput('camera');
        }}
        onClose={() => {
          setInAppCameraOpen(false);
          finishPicking();
        }}
      />
    </div>
  );
}
