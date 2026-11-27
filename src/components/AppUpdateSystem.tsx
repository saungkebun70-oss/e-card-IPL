import { useState } from 'react';
import {
  CheckCircle2,
  DownloadCloud,
  Loader2,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react';
import { useAppUpdate } from '../lib/appUpdate';

/**
 * Banner notifikasi pembaruan di bagian atas layar ketika versi produksi baru terdeteksi.
 */
export function AppUpdateBanner() {
  const { updateAvailable, bannerDismissed, latestVersion, updating, applyUpdate, dismissBanner } =
    useAppUpdate();

  if (!updateAvailable || bannerDismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[70] no-print bg-[#243825]/95 backdrop-blur-xl text-[#FFFDF8] border-b border-white/15 shadow-lg pt-[calc(max(env(safe-area-inset-top,0px),24px)+0.5rem)] pb-2.5 px-3.5 sm:px-5 sm:pt-2.5"
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-2xl bg-white/15 border border-white/20 text-[#E5EEE3] flex items-center justify-center shrink-0">
            <DownloadCloud className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold text-[#FFFDF8] leading-tight truncate">
              Pembaruan tersedia
            </p>
            <p className="text-[11px] text-[#E5EEE3]/85 leading-tight truncate mt-0.5">
              {latestVersion
                ? `Versi baru v${latestVersion} siap dimuat tanpa instal ulang.`
                : 'Versi terbaru aplikasi siap dimuat secara otomatis.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={updating}
            onClick={() => void applyUpdate()}
            className="min-h-[36px] px-3.5 sm:px-4 rounded-full bg-[#E5EEE3] hover:bg-[#D3E3D0] active:scale-[0.98] disabled:opacity-65 text-[#243825] text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap shadow-xs"
          >
            {updating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Memperbarui...</span>
              </>
            ) : (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Update Sekarang</span>
              </>
            )}
          </button>

          <button
            type="button"
            disabled={updating}
            onClick={dismissBanner}
            aria-label="Tutup banner pembaruan"
            className="min-h-[36px] min-w-[36px] rounded-full bg-white/10 hover:bg-white/20 text-[#E5EEE3] flex items-center justify-center transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Layar penanganan offline ketika perangkat pengguna terputus dari koneksi internet.
 */
export function OfflineOverlay() {
  const { isOffline, retryingConnection, retryConnection } = useAppUpdate();
  const [stillOfflineNote, setStillOfflineNote] = useState(false);

  if (!isOffline) return null;

  const handleRetry = async () => {
    setStillOfflineNote(false);
    const online = await retryConnection();
    if (!online) {
      setStillOfflineNote(true);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="offline-title"
      className="fixed inset-0 z-[80] glass-canvas flex items-center justify-center px-3.5 sm:px-5 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1rem)] pb-[calc(max(env(safe-area-inset-bottom,0px),16px)+1rem)]"
    >
      <section className="w-full max-w-md bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-7 shadow-xl text-center space-y-4 sm:space-y-5">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[#243825] text-[#E5EEE3] flex items-center justify-center shadow-md">
          <WifiOff className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#2B3F29]">
            Perumahan Saung Kebun
          </p>
          <h2 id="offline-title" className="text-xl font-bold text-[#1B271B] tracking-tight">
            Koneksi Internet Terputus
          </h2>
          <p className="text-sm text-[#4A554A] leading-relaxed">
            Koneksi internet terputus. Periksa jaringan Anda untuk melanjutkan akses e-Card IPL,
            laporan kas, dan patroli keamanan secara real-time.
          </p>
        </div>

        {stillOfflineNote && (
          <div className="rounded-2xl bg-[#F2D8A7]/40 border border-[#F2D8A7] px-3.5 py-2.5 text-xs text-[#4A3410] text-left leading-relaxed">
            Jaringan masih belum terhubung. Pastikan Wi-Fi atau paket data seluler Anda aktif, lalu
            tekan <strong>Coba Lagi</strong>.
          </div>
        )}

        <button
          type="button"
          disabled={retryingConnection}
          onClick={() => void handleRetry()}
          className="w-full min-h-[48px] rounded-full bg-[#2B3F29] hover:bg-[#243825] active:scale-[0.99] disabled:opacity-65 text-[#FFFDF8] text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer shadow-sm"
        >
          {retryingConnection ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Memeriksa Koneksi...</span>
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>Coba Lagi</span>
            </>
          )}
        </button>
      </section>
    </div>
  );
}

/**
 * Info versi ringkas + tombol manual "Cek Update" untuk footer login & pengaturan.
 */
export function AppVersionFooter({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const {
    currentVersion,
    updateAvailable,
    checking,
    updating,
    checkForUpdate,
    applyUpdate,
  } = useAppUpdate();
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleManualCheck = async () => {
    setFeedback(null);
    const status = await checkForUpdate({ manual: true });
    if (status === 'up_to_date') {
      setFeedback('Versi terbaru');
      window.setTimeout(() => setFeedback(null), 3500);
    } else if (status === 'offline') {
      setFeedback('Tidak ada koneksi');
      window.setTimeout(() => setFeedback(null), 3500);
    } else if (status === 'error') {
      setFeedback('Gagal memeriksa');
      window.setTimeout(() => setFeedback(null), 3500);
    }
  };

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 ${
        compact ? 'text-[11px]' : 'text-xs'
      } text-[#6E786D] ${className}`}
    >
      <div className="inline-flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-[11px] text-[#6E786D] tabular-nums truncate">
          v{currentVersion}
        </span>
        {feedback && !updateAvailable && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#2B3F29]">
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            <span>{feedback}</span>
          </span>
        )}
      </div>

      {updateAvailable ? (
        <button
          type="button"
          disabled={updating}
          onClick={() => void applyUpdate()}
          className="min-h-[32px] px-3 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap shadow-xs"
        >
          {updating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <DownloadCloud className="w-3 h-3" />
          )}
          <span>{updating ? 'Memperbarui...' : 'Update Sekarang'}</span>
        </button>
      ) : (
        <button
          type="button"
          disabled={checking}
          onClick={() => void handleManualCheck()}
          className="min-h-[32px] px-3 rounded-full border border-[#C6D2BF] bg-[#FFFDF8] hover:bg-[#E5EEE3] disabled:opacity-60 text-[#243825] text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap"
        >
          <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin text-[#243825]' : ''}`} />
          <span>{checking ? 'Memeriksa...' : 'Cek Update'}</span>
        </button>
      )}
    </div>
  );
}
