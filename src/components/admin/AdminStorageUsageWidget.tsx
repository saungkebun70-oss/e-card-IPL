import { useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Cloud,
  Database,
  HardDrive,
  Info,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchBackendStorageStatus,
  formatBytesCompact,
  type BackendStorageBucketStat,
  type BackendStorageStatus,
} from '../../lib/googleDriveHybridService';
import type { SessionUser } from '../../types';

interface AdminStorageUsageWidgetProps {
  session: SessionUser;
  variant?: 'full' | 'sidebar';
  onOpenStorageInfo?: () => void;
}

const DEFAULT_SIM_STATUS: BackendStorageStatus = {
  ok: true,
  configured: true,
  measuredVia: 'client_fallback',
  status: 'normal',
  shouldRouteNewMediaToDrive: false,
  routeReason: 'Mode Simulasi aktif — tidak terhubung ke kuota produksi Supabase.',
  storageUsedBytes: 12.4 * 1024 * 1024,
  storageLimitBytes: 1024 * 1024 * 1024,
  storageUsagePercent: 1.21,
  dbUsedBytes: 14.95 * 1024 * 1024,
  dbLimitBytes: 500 * 1024 * 1024,
  dbUsagePercent: 2.99,
  totalObjects: 24,
  buckets: [
    { bucket: 'bukti-ipl', fileCount: 18, usedBytes: 11.8 * 1024 * 1024 },
    { bucket: 'transit', fileCount: 2, usedBytes: 320 * 1024 },
    { bucket: 'avatars', fileCount: 4, usedBytes: 280 * 1024 },
  ],
  thresholdPercent: 60,
  settings: {
    targetEmail: 'simulasi@saungkebun.local',
    thresholdPercent: 60,
    storageLimitBytes: 1024 * 1024 * 1024,
    dbLimitBytes: 500 * 1024 * 1024,
    autoRouteOnNearLimit: true,
    forceRouteToDrive: false,
  },
  measuredAt: '2026-11-28T00:00:00.000Z',
};

function getUsageTone(pct: number): {
  barCls: string;
  badgeCls: string;
  label: string;
} {
  if (pct > 90) {
    return {
      barCls: 'bg-[#C87058]',
      badgeCls: 'bg-[#C87058]/15 text-[#7A311E] border-[#E2A898]',
      label: 'Kritis (>90%)',
    };
  }
  if (pct > 75) {
    return {
      barCls: 'bg-gradient-to-r from-[#D4A24C] to-[#C89B42]',
      badgeCls: 'bg-[#F4E4C4]/70 text-[#5C4110] border-[#E2C285]',
      label: 'Perhatian (>75%)',
    };
  }
  return {
    barCls: 'bg-gradient-to-r from-[#243825] to-[#384E35]',
    badgeCls: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
    label: 'Kapasitas Aman',
  };
}

function buildDisplayBuckets(buckets?: BackendStorageBucketStat[]): BackendStorageBucketStat[] {
  const incoming = Array.isArray(buckets) ? buckets : [];
  if (incoming.length === 0) {
    return [
      { bucket: 'bukti-ipl', fileCount: 0, usedBytes: 0 },
      { bucket: 'transit', fileCount: 0, usedBytes: 0 },
      { bucket: 'avatars', fileCount: 0, usedBytes: 0 },
    ];
  }

  const byName = new Map<string, BackendStorageBucketStat>();
  for (const item of incoming) {
    byName.set(item.bucket, item);
  }

  const priorityOrder = ['bukti-ipl', 'transit', 'avatars'];
  const ordered: BackendStorageBucketStat[] = [];

  for (const name of priorityOrder) {
    const found = byName.get(name);
    if (found) {
      ordered.push(found);
      byName.delete(name);
    } else {
      ordered.push({ bucket: name, fileCount: 0, usedBytes: 0 });
    }
  }

  for (const rest of byName.values()) {
    if (rest.fileCount > 0 || rest.usedBytes > 0) {
      ordered.push(rest);
    }
  }

  return ordered;
}

export function AdminStorageUsageWidget({
  session,
  variant = 'full',
  onOpenStorageInfo,
}: AdminStorageUsageWidgetProps) {
  const [status, setStatus] = useState<BackendStorageStatus | null>(() =>
    session.is_simulation ? DEFAULT_SIM_STATUS : null
  );
  const [loading, setLoading] = useState(!session.is_simulation);

  const loadStatus = useCallback(
    async (forceRefresh = false) => {
      if (session.is_simulation) {
        setStatus(DEFAULT_SIM_STATUS);
        setLoading(false);
        return;
      }
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
  const autoRouteEnabled =
    status?.settings?.autoRouteOnNearLimit !== false ||
    Boolean(status?.settings?.forceRouteToDrive) ||
    Boolean(status?.shouldRouteNewMediaToDrive);
  const thresholdDbBytes = Math.round((dbLimit * thresholdPct) / 100);
  const thresholdStorageBytes = Math.round((storageLimit * thresholdPct) / 100);

  const maxPct = Math.max(dbPct, storagePct);
  const overallTone = getUsageTone(maxPct);
  const dbTone = getUsageTone(dbPct);
  const storageTone = getUsageTone(storagePct);
  const displayBuckets = buildDisplayBuckets(status?.buckets);

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={onOpenStorageInfo}
        className="w-full text-left rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/80 hover:bg-[#E5EEE3]/70 hover:border-[#C6D2BF] px-3 py-2.5 space-y-2 transition-colors cursor-pointer group"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#243825] min-w-0">
            <Database className="w-3.5 h-3.5 text-[#384E35] shrink-0" />
            <span className="truncate">Info Penyimpanan</span>
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-[#6E786D] group-hover:text-[#243825] group-hover:translate-x-0.5 transition-transform shrink-0" />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-[10.5px] text-[#4A554A] tabular-nums">
            <span>PostgreSQL</span>
            <span className="font-mono font-semibold text-[#1B271B]">
              {loading && !status
                ? 'Memuat...'
                : `${formatBytesCompact(dbUsed)} (${dbPct}%)`}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(dbPct)}
            aria-label="Ringkasan kapasitas Database PostgreSQL"
            className="h-1.5 w-full rounded-full bg-[#E5EEE3] overflow-hidden"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${dbTone.barCls}`}
              style={{ width: `${dbUsed > 0 ? Math.max(dbPct, 4) : 0}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-1.5 text-[10px]">
          <span className="inline-flex items-center gap-1 font-semibold text-[#243825] truncate">
            <Cloud className="w-3 h-3 text-[#384E35] shrink-0" />
            <span className="truncate">
              {autoRouteEnabled ? 'Auto-Route Drive Aktif' : 'Auto-Route Siaga'}
            </span>
          </span>
          <span className="font-mono text-[#6E786D] shrink-0 tabular-nums">
            Batas {thresholdPct}%
          </span>
        </div>
      </button>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* PANEL 1: KAPASITAS PENYIMPANAN SUPABASE (READ-ONLY INFO) */}
      <section
        aria-label="Informasi Kapasitas Penyimpanan Supabase"
        className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 space-y-4 shadow-[0_8px_24px_-12px_rgba(27,39,27,0.08)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0">
              <Database className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-[#1B271B]">
                  Kapasitas Penyimpanan Supabase
                </h3>
                <span
                  className={`text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full border ${overallTone.badgeCls}`}
                >
                  {overallTone.label}
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#F6F3EA] border border-[#E6E2D6] text-[#6E786D]">
                  Read-Only
                </span>
              </div>
              <p className="text-xs text-[#6E786D] mt-0.5">
                Pemantauan real-time penggunaan Database PostgreSQL dan Storage Bucket Supabase.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadStatus(true)}
            aria-label="Muat ulang status penyimpanan"
            className="min-h-[36px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3]/70 hover:bg-[#E5EEE3] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Memuat...' : 'Muat Ulang Status'}</span>
          </button>
        </div>

        {/* Bar Progres Database PostgreSQL & Media Storage Bucket */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Database PostgreSQL */}
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/70 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-[#1B271B] inline-flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-[#243825] shrink-0" />
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
              aria-label="Persentase penggunaan Database PostgreSQL"
              className="relative h-3 w-full rounded-full bg-[#E5EEE3] overflow-hidden"
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${dbTone.barCls}`}
                style={{ width: `${dbUsed > 0 ? Math.max(dbPct, 3) : 0}%` }}
              />
              <div
                aria-hidden="true"
                title={`Ambang batas pengalihan ${thresholdPct}%`}
                className="absolute top-0 bottom-0 w-0.5 bg-[#243825]/35"
                style={{ left: `${thresholdPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#6E786D] tabular-nums">
              <span>Status: {dbTone.label}</span>
              <span>Batas alih: {thresholdPct}%</span>
            </div>
          </div>

          {/* Media Storage Bucket */}
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/70 p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-[#1B271B] inline-flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-[#243825] shrink-0" />
                <span>Storage Bucket Media</span>
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
              aria-label="Persentase penggunaan Storage Bucket Supabase"
              className="relative h-3 w-full rounded-full bg-[#E5EEE3] overflow-hidden"
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${storageTone.barCls}`}
                style={{ width: `${storageUsed > 0 ? Math.max(storagePct, 3) : 0}%` }}
              />
              <div
                aria-hidden="true"
                title={`Ambang batas pengalihan ${thresholdPct}%`}
                className="absolute top-0 bottom-0 w-0.5 bg-[#243825]/35"
                style={{ left: `${thresholdPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#6E786D] tabular-nums">
              <span>{status?.totalObjects ?? 0} file tersimpan</span>
              <span>Batas alih: {thresholdPct}%</span>
            </div>
          </div>
        </div>

        {/* Rincian Storage Bucket dalam Kartu Pil Rapi */}
        <div className="space-y-2 pt-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#6E786D]">
            Rincian Storage Bucket
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {displayBuckets.map((b) => (
              <div
                key={b.bucket}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#F6F3EA] border border-[#E6E2D6] text-xs"
              >
                <span className="w-2 h-2 rounded-full bg-[#384E35] shrink-0" />
                <span className="font-mono font-bold text-[#243825]">{b.bucket}</span>
                <span className="text-[#4A554A] font-mono tabular-nums">
                  {b.fileCount} file · {formatBytesCompact(b.usedBytes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PANEL 2: INFO PENYIMPANAN GOOGLE DRIVE (SEBATAS INFO READ-ONLY) */}
      <section
        aria-label="Informasi Penyimpanan Google Drive"
        className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 space-y-3.5 shadow-[0_8px_24px_-12px_rgba(27,39,27,0.08)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-[#1B271B]">
                  Info Penyimpanan Google Drive
                </h3>
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                    autoRouteEnabled
                      ? 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                      : 'bg-[#F6F3EA] text-[#6E786D] border-[#E6E2D6]'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {autoRouteEnabled ? 'Auto-Route Drive Aktif' : 'Auto-Route Drive Nonaktif'}
                  </span>
                </span>
              </div>
              <p className="text-xs text-[#4A554A] leading-relaxed">
                {status?.shouldRouteNewMediaToDrive
                  ? 'Kuota Supabase sedang melewati batas alih. Lampiran dan arsip media baru otomatis diarahkan ke Google Drive.'
                  : 'Lampiran bukti IPL, kas, dan arsip lingkungan otomatis dialihkan ke Google Drive saat kuota penyimpanan Supabase mendekati ambang batas.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadStatus(true)}
            className="min-h-[34px] px-3 rounded-full border border-[#E6E2D6] bg-[#F6F3EA] hover:bg-[#E5EEE3] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${loading ? 'animate-spin' : ''}`} />
            <span>Segarkan Info</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/70 px-3.5 py-2.5">
            <p className="text-[10.5px] font-semibold text-[#6E786D]">Status Pengalihan</p>
            <p className="text-xs sm:text-sm font-bold text-[#243825] mt-0.5">
              {status?.shouldRouteNewMediaToDrive
                ? 'Sedang Dialihkan ke Drive'
                : autoRouteEnabled
                  ? 'Siaga (Otomatis Aktif)'
                  : 'Manual'}
            </p>
          </div>

          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/70 px-3.5 py-2.5">
            <p className="text-[10.5px] font-semibold text-[#6E786D]">Batas Alih Penyimpanan</p>
            <p className="text-xs sm:text-sm font-mono font-bold text-[#1B271B] tabular-nums mt-0.5">
              Batas alih: {thresholdPct}%
            </p>
            <p className="text-[10.5px] text-[#6E786D] font-mono tabular-nums mt-0.5">
              DB {formatBytesCompact(thresholdDbBytes)} · Media {formatBytesCompact(thresholdStorageBytes)}
            </p>
          </div>

          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/70 px-3.5 py-2.5">
            <p className="text-[10.5px] font-semibold text-[#6E786D]">Sumber Pengukuran</p>
            <p className="text-xs sm:text-sm font-bold text-[#1B271B] mt-0.5">
              {session.is_simulation
                ? 'Mode Simulasi Lokal'
                : status?.measuredVia === 'rpc_exact'
                  ? 'Statistik Realtime SQL'
                  : status?.measuredVia === 'storage_api_scan'
                    ? 'Scan Storage API'
                    : 'Estimasi Aktif'}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-2xl border border-[#C6D2BF]/70 bg-[#E5EEE3]/40 px-3.5 py-2.5 text-[11px] text-[#384E35]">
          <Info className="w-4 h-4 text-[#243825] shrink-0 mt-0.5" />
          <span>
            Panel ini hanya menampilkan informasi status &amp; kapasitas penyimpanan secara
            read-only agar konfigurasi sinkronisasi Google Drive tetap aman dan terjaga.
          </span>
        </div>
      </section>
    </div>
  );
}
