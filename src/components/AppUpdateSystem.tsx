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
      className="fixed top-0 left-0 right-0 z-[70] no-print bg-[#0F172A]/95 backdrop-blur-md text-white border-b border-emerald-500/35 shadow-lg pt-[calc(max(env(safe-area-inset-top,0px),24px)+0.5rem)] pb-2.5 px-3.5 sm:px-5 sm:pt-2.5"
    >
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/35 text-emerald-300 flex items-center justify-center shrink-0">
            <DownloadCloud className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs sm:text-sm font-bold text-white leading-tight truncate">
              Pembaruan tersedia
            </p>
            <p className="text-[11px] text-slate-300 leading-tight truncate mt-0.5">
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
            className="min-h-[36px] px-3 sm:px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-65 text-white text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer whitespace-nowrap"
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
            className="min-h-[36px] min-w-[36px] rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center transition cursor-pointer"
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
      className="fixed inset-0 z-[80] bg-[#F8FAFC] flex items-center justify-center px-5 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1rem)] pb-[calc(max(env(safe-area-inset-bottom,0px),16px)+1rem)]"
    >
      <section className="w-full max-w-md bg-white border border-slate-200 rounded-3xl p-6 sm:p-7 shadow-xl text-center space-y-5">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shadow-md">
          <WifiOff className="w-8 h-8" />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#059669]">
            Perumahan Saung Kebun
          </p>
          <h2 id="offline-title" className="text-xl font-bold text-[#0F172A] tracking-tight">
            Koneksi Internet Terputus
          </h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Koneksi internet terputus. Periksa jaringan Anda untuk melanjutkan akses e-Card IPL,
            laporan kas, dan patroli keamanan secara real-time.
          </p>
        </div>

        {stillOfflineNote && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-800 text-left leading-relaxed">
            Jaringan masih belum terhubung. Pastikan Wi-Fi atau paket data seluler Anda aktif, lalu
            tekan <strong>Coba Lagi</strong>.
          </div>
        )}

        <button
          type="button"
          disabled={retryingConnection}
          onClick={() => void handleRetry()}
          className="w-full min-h-[48px] rounded-xl bg-[#059669] hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-65 text-white text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer"
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
      } text-slate-500 ${className}`}
    >
      <div className="inline-flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-[11px] text-slate-400 tabular-nums truncate">
          v{currentVersion}
        </span>
        {feedback && !updateAvailable && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
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
          className="min-h-[30px] px-2.5 rounded-lg bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer shrink-0"
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
          className="min-h-[30px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 disabled:opacity-60 text-slate-600 text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin text-[#059669]' : ''}`} />
          <span>{checking ? 'Memeriksa...' : 'Cek Update'}</span>
        </button>
      )}
    </div>
  );
}
