import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Crosshair,
  Eye,
  MapPin,
  RotateCcw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type { LogPatroli, PatrolMapConfig, TitikPatroli } from '../types';

interface PatrolInteractiveMapProps {
  titikList: TitikPatroli[];
  patroliLogs: LogPatroli[];
  patrolMapConfig?: PatrolMapConfig | null;
  mode: 'admin' | 'petugas' | 'warga' | 'editor';
  canResetCycle?: boolean;
  onResetCycle?: () => Promise<void> | void;
  resettingCycle?: boolean;
  /** Editor mode: checkpoint aktif yang sedang ditempatkan pin-nya */
  selectedEditorTitikId?: string | null;
  onPlacePin?: (titikId: string, xPercent: number, yPercent: number) => Promise<void> | void;
  savingPin?: boolean;
}

const DEFAULT_FALLBACK_COORDS: Array<{ x: number; y: number }> = [
  { x: 50, y: 84 },
  { x: 24, y: 60 },
  { x: 76, y: 58 },
  { x: 30, y: 26 },
  { x: 72, y: 24 },
  { x: 50, y: 45 },
  { x: 18, y: 38 },
  { x: 82, y: 38 },
];

function formatJamWib(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} WIB`;
}

function formatTanggalRingkas(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTodayStartMs(): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

export const PatrolInteractiveMap: React.FC<PatrolInteractiveMapProps> = ({
  titikList,
  patroliLogs,
  patrolMapConfig,
  mode,
  canResetCycle = false,
  onResetCycle,
  resettingCycle = false,
  selectedEditorTitikId = null,
  onPlacePin,
  savingPin = false,
}) => {
  const activeTitik = useMemo(() => titikList.filter((t) => t.aktif !== false), [titikList]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [newlyScannedIds, setNewlyScannedIds] = useState<Record<string, boolean>>({});
  const prevScannedRef = useRef<Set<string>>(new Set());
  const mapStageRef = useRef<HTMLDivElement | null>(null);

  const cycleStartMs = useMemo(() => {
    if (patrolMapConfig?.cycle_reset_at) {
      const parsed = new Date(patrolMapConfig.cycle_reset_at).getTime();
      if (!Number.isNaN(parsed)) return parsed;
    }
    return getTodayStartMs();
  }, [patrolMapConfig?.cycle_reset_at]);

  const pinItems = useMemo(() => {
    const savedPositions = patrolMapConfig?.pin_positions || {};

    return activeTitik.map((titik, idx) => {
      const saved = savedPositions[titik.id];
      const fallback = DEFAULT_FALLBACK_COORDS[idx % DEFAULT_FALLBACK_COORDS.length];
      const x =
        typeof saved?.x_percent === 'number'
          ? saved.x_percent
          : typeof titik.x_percent === 'number'
            ? titik.x_percent
            : fallback.x;
      const y =
        typeof saved?.y_percent === 'number'
          ? saved.y_percent
          : typeof titik.y_percent === 'number'
            ? titik.y_percent
            : fallback.y;

      const titikNameLower = titik.nama_lokasi.trim().toLowerCase();
      // Cari log patroli terbaru dalam siklus aktif
      const cycleLog = patroliLogs.find((log) => {
        const scanMs = new Date(log.waktu_scan).getTime();
        if (Number.isNaN(scanMs) || scanMs < cycleStartMs) return false;
        if (log.titik_id && log.titik_id === titik.id) return true;
        return log.nama_lokasi.trim().toLowerCase() === titikNameLower;
      });

      return {
        index: idx + 1,
        titik,
        x,
        y,
        hasCustomPosition:
          typeof saved?.x_percent === 'number' || typeof titik.x_percent === 'number',
        scanned: Boolean(cycleLog),
        latestLog: cycleLog || null,
      };
    });
  }, [activeTitik, patrolMapConfig?.pin_positions, patroliLogs, cycleStartMs]);

  // Deteksi pin yang baru berubah menjadi Hijau secara real-time untuk animasi gelombang sukses
  useEffect(() => {
    const currentScanned = new Set(pinItems.filter((p) => p.scanned).map((p) => p.titik.id));
    const newlyAdded: string[] = [];
    if (prevScannedRef.current.size > 0 || currentScanned.size > 0) {
      for (const id of currentScanned) {
        if (!prevScannedRef.current.has(id)) {
          newlyAdded.push(id);
        }
      }
    }
    prevScannedRef.current = currentScanned;

    if (newlyAdded.length > 0) {
      setNewlyScannedIds((prev) => {
        const next = { ...prev };
        for (const id of newlyAdded) next[id] = true;
        return next;
      });
      const timer = window.setTimeout(() => {
        setNewlyScannedIds((prev) => {
          const next = { ...prev };
          for (const id of newlyAdded) delete next[id];
          return next;
        });
      }, 3200);
      return () => window.clearTimeout(timer);
    }
  }, [pinItems]);

  const scannedCount = pinItems.filter((p) => p.scanned).length;
  const totalCount = pinItems.length;
  const progressPct = totalCount > 0 ? Math.round((scannedCount / totalCount) * 100) : 0;

  const selectedPin =
    pinItems.find((p) => p.titik.id === (mode === 'editor' ? selectedEditorTitikId : selectedPinId)) ||
    null;

  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'editor' || !selectedEditorTitikId || !onPlacePin || savingPin) return;
    const rect = mapStageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;

    const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
    const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
    const clampedX = Math.max(2, Math.min(98, Math.round(xPercent * 100) / 100));
    const clampedY = Math.max(2, Math.min(98, Math.round(yPercent * 100) / 100));
    void onPlacePin(selectedEditorTitikId, clampedX, clampedY);
  };

  const handleConfirmReset = async () => {
    if (!onResetCycle) return;
    await onResetCycle();
    setConfirmReset(false);
  };

  const customMapUrl = patrolMapConfig?.map_image_url || null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
      {/* Header Progres Patroli & Mode */}
      <div className="px-4 py-3.5 border-b border-slate-100 bg-slate-50/70">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-[#059669] shrink-0" />
                {mode === 'editor'
                  ? 'Editor Koordinat Pin Peta Patroli'
                  : 'Peta Mapping Rute Patroli Real-Time'}
              </h3>
              {mode === 'warga' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-0.5">
                  <Eye className="w-3 h-3 text-slate-400" />
                  Read-Only (Pantauan Warga)
                </span>
              )}
            </div>
            {mode !== 'editor' ? (
              <p className="text-xs font-semibold text-slate-700 mt-1 tabular-nums">
                Progres Patroli:{' '}
                <span className={scannedCount === totalCount && totalCount > 0 ? 'text-[#059669]' : 'text-slate-900'}>
                  {scannedCount} / {totalCount} Titik Terverifikasi
                </span>
                {patrolMapConfig?.cycle_reset_at && (
                  <span className="text-[11px] font-normal text-slate-500 ml-1.5">
                    · Siklus mulai {formatJamWib(patrolMapConfig.cycle_reset_at)}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">
                Pilih titik checkpoint lalu klik/tap langsung pada gambar peta untuk menyimpan posisi pin.
              </p>
            )}
          </div>

          {canResetCycle && mode !== 'warga' && mode !== 'editor' && onResetCycle && (
            <div className="shrink-0">
              {confirmReset ? (
                <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1.5">
                  <span className="text-[11px] font-semibold text-amber-800">
                    Reset siklus shift?
                  </span>
                  <button
                    type="button"
                    onClick={handleConfirmReset}
                    disabled={resettingCycle}
                    className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition disabled:opacity-50"
                  >
                    {resettingCycle ? 'Mereset...' : 'Ya, Reset'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    disabled={resettingCycle}
                    className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold hover:bg-slate-50"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition min-h-[36px]"
                  title="Reset status pin peta untuk shift baru tanpa menghapus riwayat patroli"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                  Reset Siklus Patroli
                </button>
              )}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {mode !== 'editor' && totalCount > 0 && (
          <div className="mt-2.5">
            <div className="h-2 w-full rounded-full bg-slate-200/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#059669] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Area Kanvas Peta + Overlay Pin */}
      <div className="p-3 sm:p-4 bg-slate-100/60">
        {mode === 'editor' && selectedEditorTitikId && (
          <div className="mb-2.5 flex items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-900">
            <span className="flex items-center gap-1.5 font-semibold">
              <Crosshair className="w-3.5 h-3.5 text-[#059669] shrink-0" />
              Klik/tap titik lokasi pada gambar peta untuk menempatkan pin:{' '}
              <strong>
                {activeTitik.find((t) => t.id === selectedEditorTitikId)?.nama_lokasi || 'Checkpoint'}
              </strong>
            </span>
            {savingPin && (
              <span className="text-[11px] font-bold text-[#059669] shrink-0">Menyimpan...</span>
            )}
          </div>
        )}

        <div className="flex justify-center">
          <div
            ref={mapStageRef}
            onClick={handleStageClick}
            className={`relative inline-block w-full max-w-[760px] rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shadow-inner select-none ${
              mode === 'editor' && selectedEditorTitikId ? 'cursor-crosshair ring-2 ring-[#059669]/40' : ''
            }`}
          >
            {customMapUrl ? (
              <img
                src={customMapUrl}
                alt="Peta Denah Perumahan Saung Kebun"
                draggable={false}
                className="block w-full h-auto max-h-[460px] object-contain mx-auto bg-white"
              />
            ) : (
              /* Fallback Denah Arsitektural Perumahan Saung Kebun jika gambar kustom belum diunggah */
              <svg
                viewBox="0 0 800 500"
                className="block w-full h-auto bg-[#F8FAFC]"
                role="img"
                aria-label="Denah Perumahan Saung Kebun"
              >
                <defs>
                  <pattern id="grid-patrol" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path
                      d="M 40 0 L 0 0 0 40"
                      fill="none"
                      stroke="#E2E8F0"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                <rect width="800" height="500" fill="url(#grid-patrol)" />
                {/* Jalan Utama & Melingkar */}
                <path
                  d="M 400 480 L 400 370 M 140 370 L 660 370 M 140 370 L 140 120 L 660 120 L 660 370 M 140 245 L 660 245"
                  fill="none"
                  stroke="#CBD5E1"
                  strokeWidth="26"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M 400 480 L 400 370 M 140 370 L 660 370 M 140 370 L 140 120 L 660 120 L 660 370 M 140 245 L 660 245"
                  fill="none"
                  stroke="#F1F5F9"
                  strokeWidth="2"
                  strokeDasharray="8 8"
                />
                {/* Klaster Blok */}
                <rect x="175" y="148" width="205" height="72" rx="10" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.5" />
                <text x="277" y="182" textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700">
                  BLOK A (A1 – A8)
                </text>
                <text x="277" y="201" textAnchor="middle" fill="#64748B" fontSize="10">
                  Sektor Barat Utara
                </text>

                <rect x="420" y="148" width="205" height="72" rx="10" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.5" />
                <text x="522" y="182" textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700">
                  BLOK B (B1 – B8)
                </text>
                <text x="522" y="201" textAnchor="middle" fill="#64748B" fontSize="10">
                  Sekretariat Blok B3/7
                </text>

                <rect x="175" y="272" width="205" height="72" rx="10" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.5" />
                <text x="277" y="306" textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700">
                  BLOK C (C1 – C6)
                </text>
                <text x="277" y="325" textAnchor="middle" fill="#64748B" fontSize="10">
                  Sektor Barat Selatan
                </text>

                <rect x="420" y="272" width="205" height="72" rx="10" fill="#ECFDF5" stroke="#A7F3D0" strokeWidth="1.5" />
                <text x="522" y="306" textAnchor="middle" fill="#065F46" fontSize="14" fontWeight="700">
                  TAMAN &amp; BLOK D
                </text>
                <text x="522" y="325" textAnchor="middle" fill="#047857" fontSize="10">
                  Fasum &amp; Area Terbuka
                </text>

                {/* Gerbang Utama */}
                <rect x="315" y="425" width="170" height="44" rx="10" fill="#0F172A" />
                <text x="400" y="451" textAnchor="middle" fill="#FFFFFF" fontSize="12" fontWeight="700">
                  GERBANG UTAMA · POS SATPAM
                </text>

                {/* Label Header Denah */}
                <text x="24" y="36" fill="#0F172A" fontSize="13" fontWeight="700">
                  DENAH PERUMAHAN SAUNG KEBUN
                </text>
                <text x="24" y="54" fill="#64748B" fontSize="10">
                  Desa Bengle, Kec. Majalaya, Karawang · Unggah denah asli di Pengaturan &gt; Petugas
                </text>
              </svg>
            )}

            {/* Pin Checkpoint Interaktif */}
            {pinItems.map((item) => {
              const isSelected =
                mode === 'editor'
                  ? selectedEditorTitikId === item.titik.id
                  : selectedPinId === item.titik.id;
              const isJustScanned = Boolean(newlyScannedIds[item.titik.id]);
              const isWarningNote = item.latestLog?.status_kondisi === 'Ada Catatan';

              return (
                <button
                  key={item.titik.id}
                  type="button"
                  onClick={(e) => {
                    if (mode === 'editor') return;
                    e.stopPropagation();
                    setSelectedPinId((prev) => (prev === item.titik.id ? null : item.titik.id));
                  }}
                  style={{ left: `${item.x}%`, top: `${item.y}%` }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group focus:outline-none z-10"
                  aria-label={`Checkpoint ${item.index}: ${item.titik.nama_lokasi} (${
                    item.scanned ? 'Sudah Scan' : 'Belum Scan'
                  })`}
                >
                  <div className="relative flex flex-col items-center">
                    {/* Pulse / Success Wave Ring */}
                    {mode !== 'editor' && !item.scanned && (
                      <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-red-500/35 animate-ping pointer-events-none" />
                    )}
                    {mode !== 'editor' && item.scanned && isJustScanned && (
                      <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-emerald-400/50 animate-ping pointer-events-none" />
                    )}

                    {/* Bulatan Pin */}
                    <span
                      className={`relative w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border-2 border-white transition-transform duration-200 ${
                        isSelected ? 'scale-125 ring-4 ring-slate-900/20' : 'group-hover:scale-110'
                      } ${
                        mode === 'editor'
                          ? isSelected
                            ? 'bg-[#059669] text-white shadow-lg shadow-emerald-600/40'
                            : 'bg-slate-800 text-white shadow-md'
                          : item.scanned
                            ? isWarningNote
                              ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/40'
                              : 'bg-[#059669] text-white shadow-lg shadow-emerald-500/50'
                            : 'bg-red-600 text-white shadow-lg shadow-red-600/40'
                      }`}
                    >
                      {mode !== 'editor' && item.scanned ? (
                        isWarningNote ? (
                          <AlertTriangle className="w-3.5 h-3.5" />
                        ) : (
                          <Check className="w-4 h-4 stroke-[3]" />
                        )
                      ) : (
                        item.index
                      )}
                    </span>

                    {/* Label Ringkas di Bawah Pin */}
                    <span
                      className={`mt-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold leading-tight whitespace-nowrap shadow-xs border ${
                        mode === 'editor'
                          ? isSelected
                            ? 'bg-[#059669] text-white border-emerald-700'
                            : 'bg-white/95 text-slate-800 border-slate-200'
                          : item.scanned
                            ? 'bg-emerald-950/90 text-emerald-100 border-emerald-500/40'
                            : 'bg-red-700/95 text-white border-red-400/50'
                      }`}
                    >
                      {mode === 'editor' ? (
                        `${item.index}. ${item.titik.nama_lokasi.slice(0, 14)}`
                      ) : item.scanned && item.latestLog ? (
                        `${formatJamWib(item.latestLog.waktu_scan)} · ${item.latestLog.nama_petugas.split(' ')[0]}`
                      ) : (
                        `${item.index}. Belum Scan`
                      )}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Legenda Status */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" />
              Belum Scan (Merah)
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-[#059669] inline-block" />
              Terverifikasi NFC (Hijau)
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
              Ada Catatan
            </span>
          </div>
          {mode !== 'editor' && (
            <span className="text-slate-400">Ketuk pin pada peta untuk melihat detail</span>
          )}
        </div>
      </div>

      {/* Panel Detail Pin Terpilih */}
      {mode !== 'editor' && selectedPin && (
        <div className="px-4 py-3.5 border-t border-slate-100 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-400 tabular-nums">
                  TITIK #{selectedPin.index}
                </span>
                <h4 className="text-sm font-bold text-slate-900">
                  {selectedPin.titik.nama_lokasi}
                </h4>
              </div>
              {selectedPin.titik.keterangan && (
                <p className="text-xs text-slate-500 mt-0.5">{selectedPin.titik.keterangan}</p>
              )}
            </div>
            <span
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                selectedPin.scanned
                  ? selectedPin.latestLog?.status_kondisi === 'Ada Catatan'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : 'bg-emerald-50 text-[#059669] border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {selectedPin.scanned ? (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {selectedPin.latestLog?.status_kondisi === 'Ada Catatan'
                    ? 'Scan — Ada Catatan'
                    : 'Terverifikasi NFC'}
                </>
              ) : (
                'Belum Scan'
              )}
            </span>
          </div>

          {selectedPin.latestLog ? (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                <Clock className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                <span className="text-slate-700 font-medium tabular-nums">
                  {formatTanggalRingkas(selectedPin.latestLog.waktu_scan)} ({selectedPin.latestLog.metode_scan})
                </span>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                <UserCheck className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                <span className="text-slate-700 font-medium truncate">
                  Petugas: {selectedPin.latestLog.nama_petugas}
                </span>
              </div>
              {selectedPin.latestLog.catatan && (
                <div className="sm:col-span-2 bg-amber-50/70 border border-amber-200/70 rounded-xl px-3 py-2 text-amber-900">
                  <span className="font-semibold">Catatan Lapangan:</span>{' '}
                  {selectedPin.latestLog.catatan}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-red-600 bg-red-50/70 border border-red-100 rounded-xl px-3 py-2">
              Titik checkpoint ini belum di-tap oleh petugas pada siklus patroli aktif.
            </p>
          )}
        </div>
      )}

      {/* Ringkasan Daftar Checkpoint Kompak */}
      {mode !== 'editor' && pinItems.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {pinItems.map((item) => {
              const isSelected = selectedPinId === item.titik.id;
              return (
                <button
                  key={item.titik.id}
                  type="button"
                  onClick={() =>
                    setSelectedPinId((prev) => (prev === item.titik.id ? null : item.titik.id))
                  }
                  className={`text-left rounded-xl border px-3 py-2 transition flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'border-[#059669] bg-emerald-50/60'
                      : 'border-slate-200/80 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                        item.scanned
                          ? 'bg-[#059669] text-white'
                          : 'bg-red-100 text-red-700 border border-red-200'
                      }`}
                    >
                      {item.scanned ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : item.index}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {item.titik.nama_lokasi}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate tabular-nums">
                        {item.latestLog
                          ? `${formatJamWib(item.latestLog.waktu_scan)} · ${item.latestLog.nama_petugas}`
                          : 'Belum Scan'}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      item.scanned ? 'bg-[#059669]' : 'bg-red-500'
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
