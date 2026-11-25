import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Database,
  HardDrive,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchBackendStorageStatus,
  formatBytesCompact,
  type BackendStorageStatus,
} from '../../lib/googleDriveHybridService';
import type { SessionUser } from '../../types';

interface AdminStorageUsageWidgetProps {
  session: SessionUser;
  onOpenDriveSettings?: () => void;
}

export function AdminStorageUsageWidget({
  session,
  onOpenDriveSettings,
}: AdminStorageUsageWidgetProps) {
  const [status, setStatus] = useState<BackendStorageStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        const res = await fetchBackendStorageStatus(session, forceRefresh);
        if (res) {
          setStatus(res);
        }
      } finally {
        setLoading(false);
      }
    },
    [session]
  );

  useEffect(() => {
    void loadStatus(false);
  }, [loadStatus]);

  const storageUsed = status?.storageUsedBytes ?? 0;
  const storageLimit = status?.storageLimitBytes ?? 1024 * 1024 * 1024;
  const storagePct = Math.min(100, Math.max(0, status?.storageUsagePercent ?? 0));

  const dbUsed = status?.dbUsedBytes ?? 0;
  const dbLimit = status?.dbLimitBytes ?? 500 * 1024 * 1024;
  const dbPct = Math.min(100, Math.max(0, status?.dbUsagePercent ?? 0));

  const thresholdPct = status?.settings?.thresholdPercent ?? status?.thresholdPercent ?? 80;
  const healthStatus = status?.status ?? 'normal';

  const statusBadge =
    healthStatus === 'near_limit'
      ? {
          label: 'Mendekati Batas',
          cls: 'bg-rose-100 text-rose-800 border-rose-200',
          barCls: 'bg-gradient-to-r from-amber-500 to-rose-600',
        }
      : healthStatus === 'warning'
        ? {
            label: 'Perhatian Kuota',
            cls: 'bg-amber-100 text-amber-800 border-amber-200',
            barCls: 'bg-gradient-to-r from-[#4C1D95] to-amber-500',
          }
        : {
            label: 'Kapasitas Aman',
            cls: 'bg-emerald-100 text-emerald-800 border-emerald-200',
            barCls: 'bg-gradient-to-r from-[#4C1D95] to-emerald-500',
          };

  return (
    <section
      aria-label="Status Penyimpanan Supabase"
      className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5 space-y-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-2xl bg-[#4C1D95]/10 text-[#4C1D95] flex items-center justify-center shrink-0">
            <HardDrive className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-[#0F172A] truncate">
                Kapasitas Penyimpanan Supabase
              </h2>
              <span
                className={`text-[10px] sm:text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${statusBadge.cls}`}
              >
                {statusBadge.label}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 truncate mt-0.5">
              {status?.shouldRouteNewMediaToDrive
                ? 'Mode Hybrid aktif: media baru dialihkan ke Google Drive OAuth2'
                : `Batas pengalihan otomatis ke Google Drive: ${thresholdPct}%`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadStatus(true)}
            aria-label="Segarkan status penyimpanan"
            className="min-h-[34px] px-3 rounded-full border border-indigo-100 bg-white/90 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>

          {onOpenDriveSettings && (
            <button
              type="button"
              onClick={onOpenDriveSettings}
              className="min-h-[34px] px-3.5 rounded-full bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>Arsip Drive</span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-300" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Bucket Storage Progress */}
        <div className="rounded-2xl border border-indigo-100/80 bg-white/90 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-700 inline-flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[#4C1D95]" />
              <span>Media Storage Bucket</span>
            </span>
            <span className="font-mono font-bold text-[#0F172A] tabular-nums">
              {loading && !status
                ? 'Memuat...'
                : `${formatBytesCompact(storageUsed)} / ${formatBytesCompact(storageLimit)} (${storagePct}%)`}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(storagePct)}
            aria-label="Persentase penggunaan Supabase Storage"
            className="relative h-3 w-full rounded-full bg-indigo-100/90 overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${statusBadge.barCls}`}
              style={{ width: `${storageUsed > 0 ? Math.max(storagePct, 3) : 0}%` }}
            />
            {/* Penanda ambang batas pengalihan */}
            <div
              aria-hidden="true"
              title={`Ambang batas ${thresholdPct}%`}
              className="absolute top-0 bottom-0 w-0.5 bg-slate-900/35"
              style={{ left: `${thresholdPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
            <span>{status?.totalObjects ?? 0} file tersimpan</span>
            <span>Batas alih: {thresholdPct}%</span>
          </div>
        </div>

        {/* Database PostgreSQL Progress */}
        <div className="rounded-2xl border border-indigo-100/80 bg-white/90 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-700 inline-flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <span>Database PostgreSQL</span>
            </span>
            <span className="font-mono font-bold text-[#0F172A] tabular-nums">
              {loading && !status
                ? 'Memuat...'
                : `${formatBytesCompact(dbUsed)} / ${formatBytesCompact(dbLimit)} (${dbPct}%)`}
            </span>
          </div>

          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(dbPct)}
            aria-label="Persentase penggunaan Database Supabase"
            className="relative h-3 w-full rounded-full bg-emerald-100/90 overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                dbPct >= thresholdPct
                  ? 'bg-rose-500'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-500'
              }`}
              style={{ width: `${dbUsed > 0 ? Math.max(dbPct, 3) : 0}%` }}
            />
            <div
              aria-hidden="true"
              title={`Ambang batas ${thresholdPct}%`}
              className="absolute top-0 bottom-0 w-0.5 bg-slate-900/35"
              style={{ left: `${thresholdPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              {status?.shouldRouteNewMediaToDrive ? (
                <>
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  <span className="text-amber-800 font-semibold">Auto-Route Drive Aktif</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>Operasional Normal</span>
                </>
              )}
            </span>
            <span className="tabular-nums">Batas alih: {thresholdPct}%</span>
          </div>
        </div>
      </div>

      {/* Rincian per Bucket (jika tersedia) */}
      {status?.buckets && status.buckets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-slate-500 font-medium">Rincian Bucket:</span>
          {status.buckets.map((b) => (
            <span
              key={b.bucket}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50/80 border border-indigo-100 text-slate-700 font-mono tabular-nums"
            >
              <span className="font-semibold text-[#4C1D95]">{b.bucket}</span>
              <span>
                {b.fileCount} file · {formatBytesCompact(b.usedBytes)}
              </span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
