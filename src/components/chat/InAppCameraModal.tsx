import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Loader2, RefreshCw, RotateCcw, SwitchCamera, X } from 'lucide-react';

interface InAppCameraModalProps {
  open: boolean;
  onCapture: (file: File) => void;
  onFallbackNativeCamera: () => void;
  onClose: () => void;
}

export function InAppCameraModal({
  open,
  onCapture,
  onFallbackNativeCamera,
  onClose,
}: InAppCameraModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [starting, setStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    const activeStream = streamRef.current;
    if (activeStream) {
      activeStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Abaikan
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const clearCaptured = useCallback(() => {
    setCapturedBlob(null);
    setCapturedUrl((prev) => {
      if (prev) {
        try {
          URL.revokeObjectURL(prev);
        } catch {
          // Abaikan
        }
      }
      return null;
    });
  }, []);

  const handleSafeClose = useCallback(() => {
    stopStream();
    clearCaptured();
    onClose();
  }, [stopStream, clearCaptured, onClose]);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopStream();
      setCameraError(null);
      setStarting(true);

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setStarting(false);
        setCameraError('Kamera langsung tidak tersedia pada peramban ini.');
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: mode },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch (err) {
        const msg =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Izin kamera belum diberikan. Anda dapat memakai kamera perangkat sebagai alternatif.'
            : 'Tidak dapat membuka kamera langsung di modal ini.';
        setCameraError(msg);
      } finally {
        setStarting(false);
      }
    },
    [stopStream]
  );

  useEffect(() => {
    if (!open) {
      stopStream();
      clearCaptured();
      setCameraError(null);
      return;
    }

    if (!capturedUrl) {
      void startCamera(facingMode);
    }

    return () => {
      stopStream();
    };
  }, [open, facingMode, capturedUrl, startCamera, stopStream, clearCaptured]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleSafeClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, handleSafeClose]);

  if (!open || typeof document === 'undefined') return null;

  const handleToggleFacing = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleTakeSnapshot = () => {
    const videoEl = videoRef.current;
    if (!videoEl) return;
    const vw = videoEl.videoWidth || 1280;
    const vh = videoEl.videoHeight || 720;
    if (!vw || !vh) return;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(videoEl, 0, 0, vw, vh);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        const url = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setCapturedUrl(url);
      },
      'image/jpeg',
      0.92
    );
  };

  const handleRetake = () => {
    clearCaptured();
  };

  const handleConfirmPhoto = () => {
    if (!capturedBlob) return;
    const fileName = `kamera-${Date.now()}.jpg`;
    let file: File;
    try {
      file = new File([capturedBlob], fileName, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    } catch {
      file = capturedBlob as unknown as File;
    }
    stopStream();
    clearCaptured();
    onCapture(file);
  };

  const handleUseNativeCamera = () => {
    stopStream();
    clearCaptured();
    // Jangan memanggil onClose() agar isPickingAttachmentRef tetap terkunci sampai input kamera selesai
    onFallbackNativeCamera();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kamera Chat Cepat"
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[9999] bg-black/95 flex flex-col justify-between h-[100dvh] pb-[env(safe-area-inset-bottom,16px)] no-print"
    >
      {/* Header Atas (shrink-0) */}
      <div className="shrink-0 px-4 py-3 bg-slate-950/90 border-b border-white/10 flex items-center justify-between gap-2 text-white">
        <div className="flex items-center gap-2 min-w-0">
          <Camera className="w-4 h-4 text-sky-300 shrink-0" />
          <span className="text-sm font-bold truncate">Ambil Foto Lampiran</span>
        </div>
        <button
          type="button"
          onClick={handleSafeClose}
          aria-label="Tutup kamera"
          className="min-h-[44px] min-w-[44px] rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Area Preview Video/Foto (flex-1 min-h-0) */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden p-3">
        {capturedUrl ? (
          <img
            src={capturedUrl}
            alt="Hasil jepretan kamera"
            className="w-full h-full max-h-[65dvh] object-contain rounded-2xl"
          />
        ) : cameraError ? (
          <div className="p-6 text-center space-y-4 max-w-sm rounded-3xl bg-slate-900/90 border border-white/10">
            <div className="w-12 h-12 rounded-2xl bg-white/10 text-sky-300 mx-auto flex items-center justify-center">
              <Camera className="w-6 h-6" />
            </div>
            <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">{cameraError}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleUseNativeCamera}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Gunakan Kamera Perangkat</span>
              </button>
              <button
                type="button"
                onClick={() => void startCamera(facingMode)}
                className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                <span>Coba Lagi</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full max-h-[65dvh] object-cover rounded-2xl bg-black ${
                facingMode === 'user' ? 'scale-x-[-1]' : ''
              }`}
            />
            {starting && (
              <div className="absolute inset-3 rounded-2xl bg-slate-950/75 flex flex-col items-center justify-center gap-2 text-white">
                <Loader2 className="w-6 h-6 animate-spin text-sky-300" />
                <span className="text-xs font-medium">Menyalakan kamera...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Kontrol Bawah (shrink-0) */}
      <div className="shrink-0 py-4 px-6 bg-slate-950/90 border-t border-white/10 flex items-center justify-center gap-6">
        {capturedUrl ? (
          <>
            <button
              type="button"
              onClick={handleRetake}
              className="min-h-[44px] px-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4 shrink-0" />
              <span>Ulangi</span>
            </button>
            <button
              type="button"
              onClick={handleConfirmPhoto}
              className="min-h-[44px] px-5 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 hover:brightness-105 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-md"
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>Gunakan Foto</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSafeClose}
              className="min-h-[44px] px-4 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center cursor-pointer shrink-0"
            >
              Batal
            </button>

            <button
              type="button"
              disabled={starting || Boolean(cameraError)}
              onClick={handleTakeSnapshot}
              aria-label="Jepret foto"
              className="w-16 h-16 min-h-[44px] min-w-[44px] rounded-full bg-white hover:bg-sky-50 active:scale-95 disabled:opacity-40 p-1.5 flex items-center justify-center cursor-pointer shadow-lg ring-4 ring-white/25 transition-all shrink-0"
            >
              <span className="w-full h-full rounded-full border-2 border-slate-900 bg-white block" />
            </button>

            <button
              type="button"
              disabled={starting}
              onClick={handleToggleFacing}
              aria-label="Ganti kamera depan atau belakang"
              title="Ganti kamera depan / belakang"
              className="min-h-[44px] min-w-[44px] px-3.5 rounded-2xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white inline-flex items-center justify-center cursor-pointer shrink-0"
            >
              <SwitchCamera className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
