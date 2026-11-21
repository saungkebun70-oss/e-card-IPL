import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Crosshair,
  Eye,
  MapPin,
  Move,
  RotateCcw,
  Shield,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  LogPatroli,
  PatrolLiveSession,
  PatrolMapConfig,
  TitikPatroli,
} from '../types';
import { clampMapPercent, formatElapsedIndonesian } from '../lib/patrolGpsUtils';

export interface PatrolMapViewerProps {
  titikList: TitikPatroli[];
  patroliLogs: LogPatroli[];
  patrolMapConfig?: PatrolMapConfig | null;
  mode: 'admin' | 'petugas' | 'warga' | 'editor';
  /** Sesi live tracking patroli aktif (jika ada) untuk ditampilkan langsung di atas peta 3D */
  liveSession?: PatrolLiveSession | null;
  /** Opsional: koordinat manual X% Y% petugas apabila tidak menggunakan objek liveSession penuh */
  officerCoords?: { x: number; y: number; name?: string } | null;
  /** Daftar ID Pos yang sudah memiliki kalibrasi GPS asli (untuk indikator di mode editor) */
  calibratedPosIds?: Set<string>;
  canResetCycle?: boolean;
  onResetCycle?: () => Promise<void> | void;
  resettingCycle?: boolean;
  /** Editor mode: checkpoint aktif yang sedang ditempatkan pin-nya */
  selectedEditorTitikId?: string | null;
  onSelectEditorTitik?: (titikId: string) => void;
  onPlacePin?: (titikId: string, xPercent: number, yPercent: number) => Promise<void> | void;
  savingPin?: boolean;
}

/**
 * Koordinat default presisi untuk peta 3D Perumahan Saung Kebun (rasio 16:9)
 * Menancap langsung pada jalur biru rute patroli bila belum disesuaikan manual oleh Admin.
 */
const DEFAULT_FALLBACK_COORDS: Array<{ x: number; y: number }> = [
  { x: 12.5, y: 76.0 }, // Titik 1: Pos Utama
  { x: 64.0, y: 76.0 }, // Titik 2: Checkpoint 2
  { x: 62.5, y: 45.5 }, // Titik 3: Checkpoint 3
  { x: 62.0, y: 29.0 }, // Titik 4: Checkpoint 4
  { x: 84.0, y: 29.0 }, // Titik 5: Checkpoint 5
  { x: 38.0, y: 60.0 },
  { x: 38.0, y: 34.0 },
  { x: 80.0, y: 58.0 },
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

function buildCompactPinLabel(namaLokasi: string, index: number): string {
  const lower = namaLokasi.toLowerCase();
  if (index === 1 && (lower.includes('pos') || lower.includes('gerbang') || lower.includes('utama'))) {
    return 'Pos 1';
  }
  if (lower.includes('pos')) return `Pos ${index}`;
  return `CP ${index}`;
}

function clampPercent(val: number): number {
  return Math.max(1, Math.min(99, Number(val.toFixed(2))));
}

export const PatrolMapViewer: React.FC<PatrolMapViewerProps> = ({
  titikList,
  patroliLogs,
  patrolMapConfig,
  mode,
  liveSession = null,
  officerCoords = null,
  calibratedPosIds,
  canResetCycle = false,
  onResetCycle,
  resettingCycle = false,
  selectedEditorTitikId = null,
  onSelectEditorTitik,
  onPlacePin,
  savingPin = false,
}) => {
  const activeTitik = useMemo(() => titikList.filter((t) => t.aktif !== false), [titikList]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [officerPopoverOpen, setOfficerPopoverOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [newlyScannedIds, setNewlyScannedIds] = useState<Record<string, boolean>>({});
  const prevScannedRef = useRef<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const isLiveActive = mode !== 'editor' && liveSession?.status === 'active';

  // Perbarui teks "Update X detik lalu" setiap 1 detik hanya saat patroli live aktif
  useEffect(() => {
    if (!isLiveActive) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLiveActive]);

  // Ref langsung pada kontainer pembungkus gambar peta (tanpa padding dalam)
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // State interaksi presisi Editor Mode (crosshair hover + drag pin langsung)
  const [hoverGuide, setHoverGuide] = useState<{ x: number; y: number } | null>(null);
  const [draggingPin, setDraggingPin] = useState<{
    titikId: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

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
      const baseX =
        typeof saved?.x_percent === 'number'
          ? saved.x_percent
          : typeof titik.x_percent === 'number'
            ? titik.x_percent
            : fallback.x;
      const baseY =
        typeof saved?.y_percent === 'number'
          ? saved.y_percent
          : typeof titik.y_percent === 'number'
            ? titik.y_percent
            : fallback.y;

      const isBeingDragged = draggingPin?.titikId === titik.id;
      const x = isBeingDragged ? draggingPin.x : baseX;
      const y = isBeingDragged ? draggingPin.y : baseY;

      const titikNameLower = titik.nama_lokasi.trim().toLowerCase();
      const cycleLog = patroliLogs.find((log) => {
        const scanMs = new Date(log.waktu_scan).getTime();
        if (Number.isNaN(scanMs) || scanMs < cycleStartMs) return false;
        if (log.titik_id && log.titik_id === titik.id) return true;
        return log.nama_lokasi.trim().toLowerCase() === titikNameLower;
      });

      return {
        index: idx + 1,
        shortLabel: buildCompactPinLabel(titik.nama_lokasi, idx + 1),
        titik,
        x,
        y,
        scanned: Boolean(cycleLog),
        latestLog: cycleLog || null,
      };
    });
  }, [activeTitik, patrolMapConfig?.pin_positions, patroliLogs, cycleStartMs, draggingPin]);

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

  const computeCoordsFromClientPoint = (
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null => {
    const rect = mapContainerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const x_percent = clampPercent(((clientX - rect.left) / rect.width) * 100);
    const y_percent = clampPercent(((clientY - rect.top) / rect.height) * 100);
    return { x: x_percent, y: y_percent };
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'editor') {
      // Tutup popover bila klik area kosong peta
      setSelectedPinId(null);
      setOfficerPopoverOpen(false);
      return;
    }
    if (draggingPin?.moved || !selectedEditorTitikId || !onPlacePin || savingPin) return;
    const coords = computeCoordsFromClientPoint(e.clientX, e.clientY);
    if (!coords) return;
    void onPlacePin(selectedEditorTitikId, coords.x, coords.y);
  };

  const handleContainerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'editor') return;
    const coords = computeCoordsFromClientPoint(e.clientX, e.clientY);
    if (!coords) return;
    setHoverGuide(coords);

    if (draggingPin) {
      e.preventDefault();
      setDraggingPin((prev) =>
        prev ? { ...prev, x: coords.x, y: coords.y, moved: true } : null
      );
    }
  };

  const handleContainerPointerUp = () => {
    if (mode !== 'editor' || !draggingPin) return;
    const finished = draggingPin;
    setDraggingPin(null);
    if (finished.moved && onPlacePin && !savingPin) {
      void onPlacePin(finished.titikId, finished.x, finished.y);
    }
  };

  const handleContainerPointerLeave = () => {
    if (mode !== 'editor') return;
    if (!draggingPin) {
      setHoverGuide(null);
    }
  };

  const handleConfirmReset = async () => {
    if (!onResetCycle) return;
    await onResetCycle();
    setConfirmReset(false);
  };

  const customMapUrl = patrolMapConfig?.map_image_url || null;
  const activeGuide = draggingPin
    ? { x: draggingPin.x, y: draggingPin.y }
    : hoverGuide;

  // Tentukan posisi & metadata marker petugas (Prioritas: Live Session aktif -> officerCoords -> Pos scan terakhir pada siklus aktif)
  const latestScannedPin = useMemo(() => {
    if (mode === 'editor') return null;
    const scannedPins = pinItems.filter((p) => p.scanned && p.latestLog);
    if (scannedPins.length === 0) return null;
    return scannedPins.reduce((latest, curr) => {
      const latestMs = new Date(latest.latestLog!.waktu_scan).getTime();
      const currMs = new Date(curr.latestLog!.waktu_scan).getTime();
      return currMs > latestMs ? curr : latest;
    });
  }, [mode, pinItems]);

  const officerMarker = useMemo(() => {
    if (mode === 'editor') return null;

    if (isLiveActive && liveSession) {
      const x = clampMapPercent(liveSession.current_x, 3, 97);
      const y = clampMapPercent(liveSession.current_y, 3, 97);
      let headingDeg: number | null = null;
      const pts = liveSession.trail_points || [];
      if (pts.length >= 2) {
        const prev = pts[pts.length - 2];
        const curr = pts[pts.length - 1];
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        if (Math.hypot(dx, dy) >= 0.35) {
          headingDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        }
      }
      return {
        x,
        y,
        name: liveSession.officer_name,
        isLive: true,
        lastUpdateIso: liveSession.last_ping_at,
        accuracy: liveSession.accuracy ?? null,
        lokasiLabel: null as string | null,
        headingDeg,
      };
    }

    if (officerCoords && Number.isFinite(officerCoords.x) && Number.isFinite(officerCoords.y)) {
      return {
        x: clampMapPercent(officerCoords.x, 3, 97),
        y: clampMapPercent(officerCoords.y, 3, 97),
        name: officerCoords.name || 'Petugas Keamanan',
        isLive: true,
        lastUpdateIso: new Date().toISOString(),
        accuracy: null as number | null,
        lokasiLabel: null as string | null,
        headingDeg: null as number | null,
      };
    }

    if (latestScannedPin && latestScannedPin.latestLog) {
      return {
        x: clampMapPercent(latestScannedPin.x, 3, 97),
        y: clampMapPercent(latestScannedPin.y, 3, 97),
        name: latestScannedPin.latestLog.nama_petugas,
        isLive: false,
        lastUpdateIso: latestScannedPin.latestLog.waktu_scan,
        accuracy: null as number | null,
        lokasiLabel: latestScannedPin.titik.nama_lokasi,
        headingDeg: null as number | null,
      };
    }

    return null;
  }, [mode, isLiveActive, liveSession, officerCoords, latestScannedPin]);

  const trailPolylinePoints = useMemo(() => {
    if (!isLiveActive || !liveSession || !Array.isArray(liveSession.trail_points)) return '';
    if (liveSession.trail_points.length < 2) return '';
    return liveSession.trail_points
      .map((pt) => `${clampMapPercent(pt.x, 2, 98)},${clampMapPercent(pt.y, 2, 98)}`)
      .join(' ');
  }, [isLiveActive, liveSession]);

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
              {mode !== 'editor' &&
                (isLiveActive && liveSession ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-0.5 tabular-nums">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span>
                      LIVE: {liveSession.officer_name} Sedang Patroli • Update{' '}
                      {formatElapsedIndonesian(liveSession.last_ping_at, nowMs)}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-md px-2 py-0.5">
                    <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                    <span>Standby</span>
                  </span>
                ))}
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
                <span
                  className={
                    scannedCount === totalCount && totalCount > 0
                      ? 'text-[#059669]'
                      : 'text-slate-900'
                  }
                >
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
                Klik langsung di jalur jalan peta atau seret (drag) pin untuk menempatkan ujung pin
                secara presisi.
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
                    className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold transition disabled:opacity-50 cursor-pointer"
                  >
                    {resettingCycle ? 'Mereset...' : 'Ya, Reset'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    disabled={resettingCycle}
                    className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 text-[11px] font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition min-h-[36px] cursor-pointer"
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
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-xs text-emerald-900">
            <span className="flex items-center gap-1.5 font-medium">
              <Crosshair className="w-3.5 h-3.5 text-[#059669] shrink-0" />
              <span>
                Klik peta / seret pin untuk menempatkan:{' '}
                <strong>
                  {activeTitik.find((t) => t.id === selectedEditorTitikId)?.nama_lokasi ||
                    'Checkpoint'}
                </strong>
              </span>
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {activeGuide && (
                <span className="font-mono text-[11px] font-bold bg-white border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-md tabular-nums">
                  X: {activeGuide.x.toFixed(2)}% · Y: {activeGuide.y.toFixed(2)}%
                </span>
              )}
              {savingPin && (
                <span className="text-[11px] font-bold text-[#059669]">Menyimpan...</span>
              )}
            </div>
          </div>
        )}

        {/* KONTAINER PETA PRESISI (TANPA PADDING DALAM) — ANTI BERGESER */}
        <div
          ref={mapContainerRef}
          onClick={handleMapClick}
          onPointerMove={handleContainerPointerMove}
          onPointerUp={handleContainerPointerUp}
          onPointerCancel={handleContainerPointerUp}
          onPointerLeave={handleContainerPointerLeave}
          className={`relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 select-none ${
            mode === 'editor' && selectedEditorTitikId
              ? 'cursor-crosshair ring-2 ring-[#059669]/35 touch-none'
              : ''
          }`}
        >
          {customMapUrl ? (
            <img
              src={customMapUrl}
              alt="Peta Denah Perumahan Saung Kebun"
              draggable={false}
              className="block w-full h-auto pointer-events-none"
            />
          ) : (
            /* Fallback Denah 16:9 Perumahan Saung Kebun jika gambar kustom belum diunggah */
            <svg
              viewBox="0 0 800 450"
              className="block w-full h-auto bg-[#F8FAFC] pointer-events-none"
              role="img"
              aria-label="Denah Perumahan Saung Kebun"
            >
              <defs>
                <pattern id="grid-patrol-169" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="800" height="450" fill="url(#grid-patrol-169)" />
              {/* Jalan Utama & Rute Patroli Biru 16:9 */}
              <path
                d="M 80 342 L 512 342 L 500 205 L 496 130 L 672 130"
                fill="none"
                stroke="#3B82F6"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.22"
              />
              <path
                d="M 80 342 L 512 342 L 500 205 L 496 130 L 672 130"
                fill="none"
                stroke="#2563EB"
                strokeWidth="3"
                strokeDasharray="8 6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Klaster Blok */}
              <rect
                x="170"
                y="185"
                width="270"
                height="110"
                rx="12"
                fill="#FFFFFF"
                stroke="#CBD5E1"
                strokeWidth="1.5"
              />
              <text x="305" y="236" textAnchor="middle" fill="#334155" fontSize="14" fontWeight="700">
                BLOK A &amp; BLOK B
              </text>
              <text x="305" y="256" textAnchor="middle" fill="#64748B" fontSize="10">
                Sekretariat Blok B3/7
              </text>

              <rect
                x="555"
                y="185"
                width="195"
                height="110"
                rx="12"
                fill="#ECFDF5"
                stroke="#A7F3D0"
                strokeWidth="1.5"
              />
              <text x="652" y="236" textAnchor="middle" fill="#065F46" fontSize="13" fontWeight="700">
                TAMAN &amp; FASUM
              </text>
              <text x="652" y="255" textAnchor="middle" fill="#047857" fontSize="10">
                Area Terbuka Warga
              </text>

              <rect
                x="170"
                y="72"
                width="270"
                height="82"
                rx="12"
                fill="#FFFFFF"
                stroke="#CBD5E1"
                strokeWidth="1.5"
              />
              <text x="305" y="112" textAnchor="middle" fill="#334155" fontSize="13" fontWeight="700">
                BLOK C &amp; BLOK BELAKANG
              </text>
              <text x="305" y="130" textAnchor="middle" fill="#64748B" fontSize="10">
                Sektor Utara Perumahan
              </text>

              <rect x="34" y="366" width="136" height="36" rx="8" fill="#0F172A" />
              <text x="102" y="388" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700">
                GERBANG / POS 1
              </text>

              <text x="24" y="34" fill="#0F172A" fontSize="13" fontWeight="700">
                DENAH PERUMAHAN SAUNG KEBUN
              </text>
              <text x="24" y="50" fill="#64748B" fontSize="10">
                Unggah gambar peta 3D perumahan di Pengaturan &gt; Petugas &gt; Peta Mapping
              </text>
            </svg>
          )}

          {/* Garis Bantu Crosshair Presisi pada Editor Mode */}
          {mode === 'editor' && activeGuide && (
            <div className="pointer-events-none absolute inset-0 z-10">
              <div
                className="absolute top-0 bottom-0 border-l border-dashed border-sky-500/80"
                style={{ left: `${activeGuide.x}%` }}
              />
              <div
                className="absolute left-0 right-0 border-t border-dashed border-sky-500/80"
                style={{ top: `${activeGuide.y}%` }}
              />
              <span
                className="absolute w-2.5 h-2.5 rounded-full border-2 border-sky-600 bg-white/90 shadow-xs"
                style={{
                  left: `${activeGuide.x}%`,
                  top: `${activeGuide.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </div>
          )}

          {/* OVERLAY JEJAK RUTE SVG REAL-TIME (Garis Cyan/Biru Cerah Putus-Putus Bercahaya) */}
          {isLiveActive && trailPolylinePoints && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 w-full h-full z-[15]"
            >
              <defs>
                <filter id="patrol-live-trail-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="0.55" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <polyline
                points={trailPolylinePoints}
                fill="none"
                stroke="#06B6D4"
                strokeWidth="1.35"
                strokeOpacity="0.45"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#patrol-live-trail-glow)"
              />
              <polyline
                points={trailPolylinePoints}
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="0.7"
                strokeDasharray="1.8 1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}

          {/* PIN CHECKPOINT PRESISI (ujung bawah menancap tepat di x_percent%, y_percent%) */}
          {pinItems.map((item) => {
            const isSelected =
              mode === 'editor'
                ? selectedEditorTitikId === item.titik.id
                : selectedPinId === item.titik.id;
            const isJustScanned = Boolean(newlyScannedIds[item.titik.id]);
            const isWarningNote = item.latestLog?.status_kondisi === 'Ada Catatan';
            const isDraggingThis = draggingPin?.titikId === item.titik.id;

            // Tentukan warna pin teardrop
            const pinBgClass =
              mode === 'editor'
                ? isSelected
                  ? 'bg-[#059669]'
                  : 'bg-slate-800'
                : item.scanned
                  ? isWarningNote
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                  : 'bg-red-500';

            // Penempatan popover agar tidak terpotong tepi peta
            const popoverVerticalClass = item.y < 34 ? 'top-full mt-4' : 'bottom-full mb-2';
            const popoverHorizontalClass =
              item.x < 24
                ? 'left-0 translate-x-0'
                : item.x > 76
                  ? 'right-0 translate-x-0'
                  : 'left-1/2 -translate-x-1/2';

            return (
              <div
                key={item.titik.id}
                style={{
                  left: `${item.x}%`,
                  top: `${item.y}%`,
                  transform: 'translate(-50%, -100%)',
                }}
                className={`absolute ${isSelected || isDraggingThis ? 'z-30' : 'z-20'}`}
              >
                {/* Efek Ring Denyut Halus tepat di titik jangkar (Belum Scan / Baru Scan) */}
                {mode !== 'editor' && !item.scanned && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-6 h-6 rounded-full bg-red-500/35 animate-ping"
                  />
                )}
                {mode !== 'editor' && item.scanned && isJustScanned && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-8 h-8 rounded-full bg-emerald-400/55 animate-ping"
                  />
                )}

                {/* Tombol Pin Teardrop Kompak (ujung lancip bawah menancap di x%, y%) */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (mode === 'editor') {
                      onSelectEditorTitik?.(item.titik.id);
                      return;
                    }
                    setSelectedPinId((prev) => (prev === item.titik.id ? null : item.titik.id));
                  }}
                  onPointerDown={(e) => {
                    if (mode !== 'editor' || !onPlacePin || savingPin) return;
                    e.stopPropagation();
                    onSelectEditorTitik?.(item.titik.id);
                    setDraggingPin({
                      titikId: item.titik.id,
                      x: item.x,
                      y: item.y,
                      moved: false,
                    });
                  }}
                  aria-label={`Checkpoint ${item.index}: ${item.titik.nama_lokasi} (${
                    item.scanned ? 'Sudah Scan' : 'Belum Scan'
                  })`}
                  className={`relative block focus:outline-none group ${
                    mode === 'editor' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                  }`}
                >
                  {/* Bentuk Teardrop / Location Marker (w-6 h-6 sm:w-7 sm:h-7) */}
                  <span
                    className={`relative flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-t-full rounded-r-full rounded-bl-none -rotate-45 ring-2 ring-white shadow-md transition-transform duration-150 ${pinBgClass} ${
                      isDraggingThis
                        ? 'scale-125 ring-emerald-200'
                        : isSelected
                          ? 'scale-115'
                          : 'group-hover:scale-110'
                    }`}
                  >
                    <span className="rotate-45 text-[10px] sm:text-[11px] font-extrabold text-white leading-none tabular-nums">
                      {item.index}
                    </span>
                  </span>

                  {/* Badge Status Sudut Pin (✓ Hijau / ! Amber saat Terverifikasi NFC) */}
                  {mode !== 'editor' && item.scanned && (
                    <span
                      aria-hidden="true"
                      className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-white shadow-xs flex items-center justify-center ring-1 ${
                        isWarningNote
                          ? 'text-amber-600 ring-amber-400'
                          : 'text-emerald-600 ring-emerald-400'
                      }`}
                    >
                      {isWarningNote ? (
                        <span className="text-[9px] font-black leading-none">!</span>
                      ) : (
                        <Check className="w-2.5 h-2.5 stroke-[3.5]" />
                      )}
                    </span>
                  )}

                  {/* Indikator Drag / GPS Terkalibrasi di Editor Mode */}
                  {mode === 'editor' && isSelected && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-white text-[#059669] ring-1 ring-emerald-500 shadow-xs flex items-center justify-center"
                    >
                      <Move className="w-2 h-2" />
                    </span>
                  )}
                  {mode === 'editor' && !isSelected && calibratedPosIds?.has(item.titik.id) && (
                    <span
                      aria-hidden="true"
                      title="GPS Terkalibrasi"
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white ring-1 ring-white shadow-xs flex items-center justify-center"
                    >
                      <Check className="w-2 h-2 stroke-[3.5]" />
                    </span>
                  )}
                </button>

                {/* Label Mini Transparan Gelap (Digantung di bawah ujung pin tanpa menggeser koordinat) */}
                <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[9px] font-semibold leading-none px-1.5 py-0.5 rounded-full bg-slate-900/80 text-white backdrop-blur-sm whitespace-nowrap shadow-xs">
                  {item.shortLabel}
                </span>

                {/* Popover / Tooltip Detail saat Pin Diketuk (Non-Editor) */}
                {mode !== 'editor' && isSelected && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute ${popoverVerticalClass} ${popoverHorizontalClass} z-40 w-52 sm:w-56 rounded-xl bg-slate-900/95 text-white backdrop-blur-md border border-white/15 shadow-xl p-2.5 text-left`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <p className="text-[11px] font-bold leading-snug text-white">
                        {item.index}. {item.titik.nama_lokasi}
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedPinId(null)}
                        aria-label="Tutup detail pin"
                        className="p-0.5 rounded text-slate-400 hover:text-white cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    {item.scanned && item.latestLog ? (
                      <div className="mt-1.5 space-y-1">
                        <p
                          className={`text-[10px] font-bold inline-flex items-center gap-1 ${
                            isWarningNote ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          {isWarningNote ? (
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                          ) : (
                            <Check className="w-3 h-3 shrink-0" />
                          )}
                          <span>
                            {isWarningNote ? 'Ada Catatan' : 'Sudah Scan'} •{' '}
                            {formatJamWib(item.latestLog.waktu_scan)} •{' '}
                            {item.latestLog.nama_petugas.split(' ')[0]}
                          </span>
                        </p>
                        {item.latestLog.catatan && (
                          <p className="text-[10px] text-amber-100 bg-amber-500/20 border border-amber-400/30 rounded-lg px-2 py-1 leading-snug">
                            {item.latestLog.catatan}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] font-semibold text-red-300">
                        Belum Scan pada siklus patroli aktif
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* MARKER PETUGAS BERGERAK MULUS (SMOOTH CSS TRANSITION X%, Y% + RADAR ANIMATE-PING) */}
          {officerMarker && (
            <div
              style={{
                left: `${officerMarker.x}%`,
                top: `${officerMarker.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute transition-[left,top] duration-1000 ease-linear will-change-[left,top] ${
                officerPopoverOpen ? 'z-[35]' : 'z-[28]'
              }`}
            >
              {/* Label Nama Petugas Ringkas di Atas Ikon */}
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-900/90 text-white text-[10px] font-bold shadow-md backdrop-blur-sm ${
                    officerMarker.isLive
                      ? 'ring-1 ring-cyan-400/70'
                      : 'ring-1 ring-emerald-400/50'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      officerMarker.isLive
                        ? 'bg-emerald-400 animate-pulse'
                        : 'bg-sky-400'
                    }`}
                  />
                  <span>
                    {officerMarker.isLive
                      ? officerMarker.name
                      : `Petugas · ${officerMarker.name.split(' ')[0]}`}
                  </span>
                </span>
              </div>

              {/* Kerucut Arah Gerak Radar (Berputar mulus mengikuti vektor gerak petugas) */}
              {officerMarker.isLive && officerMarker.headingDeg !== null && (
                <span
                  aria-hidden="true"
                  style={{ transform: `translate(-50%, -50%) rotate(${officerMarker.headingDeg}deg)` }}
                  className="pointer-events-none absolute left-1/2 top-1/2 w-14 h-14 transition-transform duration-700 ease-out"
                >
                  <span
                    className="block mx-auto w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[20px] border-b-cyan-400/45 blur-[1px]"
                  />
                </span>
              )}

              {/* Efek Radar Berdenyut 2 Gelombang (animate-ping berlapis) */}
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 -m-3 rounded-full animate-ping ${
                  officerMarker.isLive ? 'bg-cyan-400/55' : 'bg-emerald-400/40'
                }`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 -m-1.5 rounded-full animate-ping [animation-delay:450ms] ${
                  officerMarker.isLive ? 'bg-emerald-400/45' : 'bg-sky-400/30'
                }`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 -m-1 rounded-full ${
                  officerMarker.isLive ? 'bg-sky-500/30' : 'bg-emerald-500/20'
                }`}
              />

              {/* Tombol Ikon Perisai Petugas Keamanan (Interaktif saat diketuk) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPinId(null);
                  setOfficerPopoverOpen((prev) => !prev);
                }}
                aria-label={`Posisi Petugas ${officerMarker.name} pada koordinat ${officerMarker.x.toFixed(1)}%, ${officerMarker.y.toFixed(1)}%`}
                className={`relative w-8 h-8 sm:w-9 sm:h-9 rounded-full text-white ring-2 ring-white shadow-lg flex items-center justify-center cursor-pointer transition-transform duration-200 hover:scale-110 active:scale-95 focus:outline-none ${
                  officerMarker.isLive
                    ? 'bg-gradient-to-br from-sky-500 via-cyan-500 to-emerald-500 shadow-cyan-500/40'
                    : 'bg-gradient-to-br from-slate-700 to-emerald-600 shadow-slate-900/30'
                }`}
              >
                <Shield className="w-4 h-4 sm:w-[18px] sm:h-[18px] stroke-[2.4]" />
              </button>

              {/* Popover Info Petugas saat Marker Diketuk */}
              {officerPopoverOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className={`absolute ${
                    officerMarker.y < 34 ? 'top-full mt-3' : 'bottom-full mb-8'
                  } ${
                    officerMarker.x < 24
                      ? 'left-0 translate-x-0'
                      : officerMarker.x > 76
                        ? 'right-0 translate-x-0'
                        : 'left-1/2 -translate-x-1/2'
                  } z-40 w-52 sm:w-56 rounded-xl bg-slate-900/95 text-white backdrop-blur-md border border-cyan-400/30 shadow-xl p-2.5 text-left`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div>
                      <p className="text-[11px] font-bold leading-snug text-white">
                        {officerMarker.name}
                      </p>
                      <p
                        className={`text-[10px] font-semibold mt-0.5 ${
                          officerMarker.isLive ? 'text-emerald-300' : 'text-sky-300'
                        }`}
                      >
                        {officerMarker.isLive
                          ? `LIVE Patroli • Update ${formatElapsedIndonesian(officerMarker.lastUpdateIso, nowMs)}`
                          : `Scan Terakhir • ${formatJamWib(officerMarker.lastUpdateIso)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOfficerPopoverOpen(false)}
                      aria-label="Tutup detail petugas"
                      className="p-0.5 rounded text-slate-400 hover:text-white cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-300 tabular-nums">
                    <span>
                      Peta: X {officerMarker.x.toFixed(1)}% · Y {officerMarker.y.toFixed(1)}%
                    </span>
                    {officerMarker.accuracy !== null && (
                      <span className="text-cyan-300">GPS ±{Math.round(officerMarker.accuracy)}m</span>
                    )}
                  </div>
                  {officerMarker.lokasiLabel && (
                    <p className="mt-1 text-[10px] text-slate-300">
                      Titik: {officerMarker.lokasiLabel}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Legenda Status Kompak */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
              Belum Scan
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              Aman (✓)
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
              Ada Catatan (!)
            </span>
            {mode !== 'editor' && (
              <span className="inline-flex items-center gap-1.5 font-medium text-sky-700">
                <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 ring-1 ring-cyan-300 inline-block" />
                Petugas Live &amp; Jejak Rute
              </span>
            )}
          </div>
          {mode !== 'editor' && (
            <span className="text-slate-400">Ketuk pin untuk melihat detail scan</span>
          )}
        </div>
      </div>

      {/* Panel Detail Pin Terpilih (Opsional di Bawah Peta saat Pin Aktif) */}
      {mode !== 'editor' && selectedPin && (
        <div className="px-4 py-3 border-t border-slate-100 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                  TITIK #{selectedPin.index}
                </span>
                <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                  {selectedPin.titik.nama_lokasi}
                </h4>
              </div>
              {selectedPin.titik.keterangan && (
                <p className="text-[11px] text-slate-500 mt-0.5">{selectedPin.titik.keterangan}</p>
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
                    ? 'Ada Catatan'
                    : 'Terverifikasi NFC'}
                </>
              ) : (
                'Belum Scan'
              )}
            </span>
          </div>

          {selectedPin.latestLog ? (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
                <Clock className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                <span className="text-slate-700 font-medium tabular-nums">
                  {formatTanggalRingkas(selectedPin.latestLog.waktu_scan)} (
                  {selectedPin.latestLog.metode_scan})
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
              const isWarning = item.latestLog?.status_kondisi === 'Ada Catatan';
              return (
                <button
                  key={item.titik.id}
                  type="button"
                  onClick={() =>
                    setSelectedPinId((prev) => (prev === item.titik.id ? null : item.titik.id))
                  }
                  className={`text-left rounded-xl border px-3 py-2 transition flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected
                      ? 'border-[#059669] bg-emerald-50/60'
                      : 'border-slate-200/80 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                        item.scanned
                          ? isWarning
                            ? 'bg-amber-500 text-white'
                            : 'bg-emerald-500 text-white'
                          : 'bg-red-100 text-red-700 border border-red-200'
                      }`}
                    >
                      {item.scanned ? (
                        isWarning ? (
                          '!'
                        ) : (
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        )
                      ) : (
                        item.index
                      )}
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
                      item.scanned
                        ? isWarning
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                        : 'bg-red-500'
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

// Alias kompatibilitas agar seluruh impor lama & baru memakai satu komponen bersama yang 100% identik
export const PatrolInteractiveMap = PatrolMapViewer;
