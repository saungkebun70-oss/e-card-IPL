import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Database,
  HardDrive,
  ShieldCheck,
} from 'lucide-react';
import { Icon3D } from '../Icon3D';
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
          cls: 'bg-[#C87058]/15 text-[#7A311E] border-[#E2A898]',
          barCls: 'bg-gradient-to-r from-[#E2C285] to-[#C87058]',
        }
      : healthStatus === 'warning'
        ? {
            label: 'Perhatian Kuota',
            cls: 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]',
            barCls: 'bg-gradient-to-r from-[#384E35] to-[#C89B42]',
          }
        : {
            label: 'Kapasitas Aman',
            cls: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
            barCls: 'bg-gradient-to-r from-[#243825] to-[#384E35]',
          };

  return (
    <section
      aria-label="Status Penyimpanan Supabase"
      className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 space-y-4 shadow-[0_8px_24px_-12px_rgba(27,39,27,0.08)]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0">
            <HardDrive className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xs sm:text-sm font-bold text-[#1B271B] truncate">
                Kapasitas Penyimpanan Supabase
              </h2>
              <span
                className={`text-[10px] sm:text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${statusBadge.cls}`}
              >
                {statusBadge.label}
              </span>
            </div>
            <p className="text-[11px] text-[#6E786D] truncate mt-0.5">
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
            className="min-h-[34px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
          >
            <Icon3D name="refresh" className={`w-4 h-4 rounded-sm ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Segarkan</span>
          </button>

          {onOpenDriveSettings && (
            <button
              type="button"
              onClick={onOpenDriveSettings}
              className="min-h-[34px] px-3.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <span>Arsip Drive</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#E5EEE3]" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Bucket Storage Progress */}
        <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/60 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#1B271B] inline-flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-[#2B3F29]" />
              <span>Media Storage Bucket</span>
            </span>
            <span className="font-mono font-bold text-[#1B271B] tabular-nums">
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
            className="relative h-3 w-full rounded-full bg-[#E5EEE3]/80 overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${statusBadge.barCls}`}
              style={{ width: `${storageUsed > 0 ? Math.max(storagePct, 3) : 0}%` }}
            />
            {/* Penanda ambang batas pengalihan */}
            <div
              aria-hidden="true"
              title={`Ambang batas ${thresholdPct}%`}
              className="absolute top-0 bottom-0 w-0.5 bg-[#1B271B]/35"
              style={{ left: `${thresholdPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#6E786D] tabular-nums">
            <span>{status?.totalObjects ?? 0} file tersimpan</span>
            <span>Batas alih: {thresholdPct}%</span>
          </div>
        </div>

        {/* Database PostgreSQL Progress */}
        <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/60 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#1B271B] inline-flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-[#2B3F29]" />
              <span>Database PostgreSQL</span>
            </span>
            <span className="font-mono font-bold text-[#1B271B] tabular-nums">
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
            className="relative h-3 w-full rounded-full bg-[#E5EEE3]/80 overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                dbPct >= thresholdPct
                  ? 'bg-[#C87058]'
                  : 'bg-gradient-to-r from-[#243825] to-[#384E35]'
              }`}
              style={{ width: `${dbUsed > 0 ? Math.max(dbPct, 3) : 0}%` }}
            />
            <div
              aria-hidden="true"
              title={`Ambang batas ${thresholdPct}%`}
              className="absolute top-0 bottom-0 w-0.5 bg-[#1B271B]/35"
              style={{ left: `${thresholdPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#6E786D]">
            <span className="inline-flex items-center gap-1">
              {status?.shouldRouteNewMediaToDrive ? (
                <>
                  <AlertTriangle className="w-3 h-3 text-[#6E4D12]" />
                  <span className="text-[#4A3410] font-semibold">Auto-Route Drive Aktif</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3 h-3 text-[#2B3F29]" />
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
          <span className="text-[#6E786D] font-medium">Rincian Bucket:</span>
          {status.buckets.map((b) => (
            <span
              key={b.bucket}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F6F3EA] border border-[#E6E2D6] text-[#1B271B] font-mono tabular-nums"
            >
              <span className="font-semibold text-[#243825]">{b.bucket}</span>
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
