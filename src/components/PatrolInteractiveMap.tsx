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
import { SecurityWalkerIcon } from './SecurityWalkerIcon';

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
  const [officerFacing, setOfficerFacing] = useState<'right' | 'left'>('right');
  const [officerMoving, setOfficerMoving] = useState(false);
  const prevOfficerPosRef = useRef<{ x: number; y: number } | null>(null);
  const moveStopTimerRef = useRef<number | null>(null);
  const returnTimersRef = useRef<number[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [newlyScannedIds, setNewlyScannedIds] = useState<Record<string, boolean>>({});
  const prevScannedRef = useRef<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // State perjalanan pulang otomatis (Pos 5 -> Pos 4 -> Pos 3 -> Pos 2 -> Pos 1)
  const [returnJourney, setReturnJourney] = useState<{
    phase: 'none' | 'paused_at_pos5' | 'returning' | 'arrived_standby';
    x: number;
    y: number;
    facing: 'right' | 'left';
    transitionMs: number;
    headingDeg: number | null;
    trailPoints: Array<{ x: number; y: number }>;
  }>({
    phase: 'none',
    x: DEFAULT_FALLBACK_COORDS[0].x,
    y: DEFAULT_FALLBACK_COORDS[0].y,
    facing: 'right',
    transitionMs: 0,
    headingDeg: null,
    trailPoints: [],
  });

  const clearReturnTimers = () => {
    for (const tid of returnTimersRef.current) {
      window.clearTimeout(tid);
    }
    returnTimersRef.current = [];
  };

  const isLiveActive = mode !== 'editor' && liveSession?.status === 'active';

  // Perbarui teks "Update X detik lalu" setiap 1 detik saat patroli live aktif
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
    // Batalkan segera animasi/timer perjalanan pulang saat siklus direset
    clearReturnTimers();
    setReturnJourney((prev) => ({
      ...prev,
      phase: 'none',
      facing: 'right',
      transitionMs: 0,
      headingDeg: null,
      trailPoints: [],
    }));
    await onResetCycle();
    setConfirmReset(false);
  };

  const customMapUrl = patrolMapConfig?.map_image_url || null;
  const activeGuide = draggingPin
    ? { x: draggingPin.x, y: draggingPin.y }
    : hoverGuide;

  // Tentukan posisi & metadata marker petugas + logika perjalanan pulang otomatis dari Pos 5 ke Pos 1
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

  // Daftar waypoints jalur pulang mengikuti rute jalan biru: Pos 5 -> Pos 4 -> Pos 3 -> Pos 2 -> Pos 1
  const returnWaypoints = useMemo(() => {
    return [...pinItems].reverse().map((p) => ({
      id: p.titik.id,
      index: p.index,
      x: clampMapPercent(p.x, 3, 97),
      y: clampMapPercent(p.y, 3, 97),
      label: p.titik.nama_lokasi,
    }));
  }, [pinItems]);

  // Pemicu otomatis: Pos 5 (titik terakhir) terverifikasi ATAU seluruh 5/5 titik selesai di-scan dalam siklus aktif
  const completionTrigger = useMemo(() => {
    if (mode === 'editor' || pinItems.length < 2) return null;
    const lastPin = pinItems[pinItems.length - 1];
    const allCompleted = totalCount > 0 && scannedCount === totalCount;
    const lastPinScanned = Boolean(lastPin?.scanned && lastPin.latestLog);

    if (!allCompleted && !lastPinScanned) return null;

    // Utamakan timestamp scan Pos 5 (atau scan terakhir jika 5/5 selesai di urutan lain)
    const anchorLog =
      (lastPinScanned ? lastPin.latestLog : null) || latestScannedPin?.latestLog || null;
    if (!anchorLog) return null;

    const scanMs = new Date(anchorLog.waktu_scan).getTime();
    if (Number.isNaN(scanMs)) return null;

    return {
      key: `${cycleStartMs}::${anchorLog.id}::${anchorLog.waktu_scan}::${scannedCount}/${totalCount}`,
      scanMs,
      scanIso: anchorLog.waktu_scan,
      officerName: liveSession?.officer_name || anchorLog.nama_petugas || 'Petugas Keamanan',
      pos5Label: lastPin.titik.nama_lokasi,
      pos1Label: pinItems[0].titik.nama_lokasi,
    };
  }, [mode, pinItems, totalCount, scannedCount, latestScannedPin, cycleStartMs, liveSession?.officer_name]);

  // Orkestrasi perjalanan pulang otomatis sinkron real-time (Petugas, Admin, & Warga) berbasis timestamp scan Pos 5
  const returnWaypointsRef = useRef(returnWaypoints);
  returnWaypointsRef.current = returnWaypoints;

  useEffect(() => {
    clearReturnTimers();

    if (!completionTrigger || returnWaypointsRef.current.length < 2) {
      setReturnJourney((prev) =>
        prev.phase === 'none'
          ? prev
          : {
              ...prev,
              phase: 'none',
              facing: 'right',
              transitionMs: 0,
              headingDeg: null,
              trailPoints: [],
            }
      );
      return;
    }

    const waypoints = returnWaypointsRef.current; // [Pos 5, Pos 4, Pos 3, Pos 2, Pos 1]
    const pos5 = waypoints[0];
    const pos1 = waypoints[waypoints.length - 1];
    const segmentCount = waypoints.length - 1;
    const PAUSE_AT_POS5_MS = 1300; // 1,3 detik jeda singkat agar Pos 5 terlihat berubah hijau
    const SEGMENT_MS = 1800; // 1,8 detik per segmen (~7,2 detik total untuk 4 segmen)
    const MAX_REALTIME_WINDOW_MS = Math.max(10000, PAUSE_AT_POS5_MS + segmentCount * SEGMENT_MS);

    const rawElapsed = Date.now() - completionTrigger.scanMs;
    const safeElapsed = Math.max(0, rawElapsed);

    // Jika Admin/Warga membuka halaman SETELAH durasi perjalanan pulang lewat (> 10 detik sejak Pos 5 di-scan),
    // langsung tampilkan petugas dalam kondisi idle/standby di Pos 1 tanpa mengulang animasi pulang.
    if (safeElapsed >= MAX_REALTIME_WINDOW_MS) {
      setReturnJourney({
        phase: 'arrived_standby',
        x: pos1.x,
        y: pos1.y,
        facing: 'right',
        transitionMs: 0,
        headingDeg: null,
        trailPoints: [],
      });
      return;
    }

    const scheduleSegmentsFrom = (startWaypointIdx: number, initialDelayMs: number) => {
      let currentIdx = Math.max(0, Math.min(startWaypointIdx, segmentCount - 1));
      let runningDelay = initialDelayMs;

      for (let nextIdx = currentIdx + 1; nextIdx < waypoints.length; nextIdx++) {
        const fromPt = waypoints[nextIdx - 1];
        const toPt = waypoints[nextIdx];
        const dx = toPt.x - fromPt.x;
        const dy = toPt.y - fromPt.y;
        const segHeading =
          Math.hypot(dx, dy) >= 0.35 ? (Math.atan2(dy, dx) * 180) / Math.PI + 90 : null;
        const segTrail = waypoints.slice(0, nextIdx + 1).map((w) => ({ x: w.x, y: w.y }));

        const stepTimer = window.setTimeout(() => {
          setReturnJourney((prev) => {
            const nextFacing: 'right' | 'left' =
              dx < -0.5 ? 'left' : dx > 0.5 ? 'right' : prev.facing;
            return {
              phase: 'returning',
              x: toPt.x,
              y: toPt.y,
              facing: nextFacing,
              transitionMs: SEGMENT_MS,
              headingDeg: segHeading,
              trailPoints: segTrail,
            };
          });
        }, runningDelay);

        returnTimersRef.current.push(stepTimer);
        runningDelay += SEGMENT_MS;
      }

      // Saat tiba di Pos 1 (Gerbang): hentikan animasi berjalan & kembali ke hadap standar
      const finishTimer = window.setTimeout(() => {
        setReturnJourney({
          phase: 'arrived_standby',
          x: pos1.x,
          y: pos1.y,
          facing: 'right',
          transitionMs: 300,
          headingDeg: null,
          trailPoints: [],
        });
      }, runningDelay);
      returnTimersRef.current.push(finishTimer);
    };

    if (safeElapsed < PAUSE_AT_POS5_MS) {
      // Masih dalam fase jeda 1,3 detik di Pos 5
      setReturnJourney({
        phase: 'paused_at_pos5',
        x: pos5.x,
        y: pos5.y,
        facing: 'right',
        transitionMs: 600,
        headingDeg: null,
        trailPoints: [{ x: pos5.x, y: pos5.y }],
      });
      scheduleSegmentsFrom(0, Math.max(120, PAUSE_AT_POS5_MS - safeElapsed));
    } else {
      // Admin/Warga bergabung di tengah perjalanan pulang: mulai tepat dari segmen aktif saat ini
      const travelElapsed = safeElapsed - PAUSE_AT_POS5_MS;
      const startSegIdx = Math.min(segmentCount - 1, Math.floor(travelElapsed / SEGMENT_MS));
      const startPt = waypoints[startSegIdx];
      const nextPt = waypoints[startSegIdx + 1];
      const initFacing: 'right' | 'left' = nextPt.x - startPt.x < -0.5 ? 'left' : 'right';

      setReturnJourney({
        phase: 'returning',
        x: startPt.x,
        y: startPt.y,
        facing: initFacing,
        transitionMs: 0,
        headingDeg: null,
        trailPoints: waypoints.slice(0, startSegIdx + 1).map((w) => ({ x: w.x, y: w.y })),
      });
      scheduleSegmentsFrom(startSegIdx, 60);
    }

    return () => {
      clearReturnTimers();
    };
  }, [completionTrigger?.key]);

  const pos1Pin = pinItems[0] || null;
  const latestAnyLog = patroliLogs[0] || null;

  const officerMarker = useMemo(() => {
    if (mode === 'editor') return null;

    // Prioritas 1: Fase perjalanan pulang otomatis / selesai di Pos 1 setelah Pos 5 terverifikasi
    if (completionTrigger && returnJourney.phase !== 'none') {
      const isReturning = returnJourney.phase === 'returning';
      const isPausedAt5 = returnJourney.phase === 'paused_at_pos5';
      return {
        x: returnJourney.x,
        y: returnJourney.y,
        name: completionTrigger.officerName,
        isLive: isReturning || isPausedAt5,
        isReturning,
        isArrivedStandby: returnJourney.phase === 'arrived_standby',
        lastUpdateIso: completionTrigger.scanIso,
        accuracy: liveSession?.accuracy ?? null,
        lokasiLabel:
          returnJourney.phase === 'arrived_standby'
            ? completionTrigger.pos1Label
            : isPausedAt5
              ? completionTrigger.pos5Label
              : 'Menuju Pos Security (Gerbang)',
        headingDeg: returnJourney.headingDeg,
        transitionMs: returnJourney.transitionMs,
        forcedFacing: returnJourney.facing,
      };
    }

    // Prioritas 2: Sesi Live Tracking GPS aktif (menuju Pos 1-5)
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
        isReturning: false,
        isArrivedStandby: false,
        lastUpdateIso: liveSession.last_ping_at,
        accuracy: liveSession.accuracy ?? null,
        lokasiLabel: null as string | null,
        headingDeg,
        transitionMs: 1000,
        forcedFacing: null as 'right' | 'left' | null,
      };
    }

    // Prioritas 3: Koordinat manual opsional
    if (officerCoords && Number.isFinite(officerCoords.x) && Number.isFinite(officerCoords.y)) {
      return {
        x: clampMapPercent(officerCoords.x, 3, 97),
        y: clampMapPercent(officerCoords.y, 3, 97),
        name: officerCoords.name || 'Petugas Keamanan',
        isLive: true,
        isReturning: false,
        isArrivedStandby: false,
        lastUpdateIso: new Date().toISOString(),
        accuracy: null as number | null,
        lokasiLabel: null as string | null,
        headingDeg: null as number | null,
        transitionMs: 1000,
        forcedFacing: null as 'right' | 'left' | null,
      };
    }

    // Prioritas 4: Posisi Pos scan terakhir pada siklus aktif (Pos 1-4)
    if (latestScannedPin && latestScannedPin.latestLog) {
      return {
        x: clampMapPercent(latestScannedPin.x, 3, 97),
        y: clampMapPercent(latestScannedPin.y, 3, 97),
        name: latestScannedPin.latestLog.nama_petugas,
        isLive: false,
        isReturning: false,
        isArrivedStandby: false,
        lastUpdateIso: latestScannedPin.latestLog.waktu_scan,
        accuracy: null as number | null,
        lokasiLabel: latestScannedPin.titik.nama_lokasi,
        headingDeg: null as number | null,
        transitionMs: 1000,
        forcedFacing: null as 'right' | 'left' | null,
      };
    }

    // Prioritas 5 (Setelah Reset Siklus Patroli / 0 dari 5): Standby siap tugas di Pos 1 (Gerbang)
    if (pos1Pin) {
      return {
        x: clampMapPercent(pos1Pin.x, 3, 97),
        y: clampMapPercent(pos1Pin.y, 3, 97),
        name: latestAnyLog?.nama_petugas || 'Petugas Keamanan',
        isLive: false,
        isReturning: false,
        isArrivedStandby: false,
        lastUpdateIso: patrolMapConfig?.cycle_reset_at || latestAnyLog?.waktu_scan || '',
        accuracy: null as number | null,
        lokasiLabel: pos1Pin.titik.nama_lokasi,
        headingDeg: null as number | null,
        transitionMs: 400,
        forcedFacing: 'right' as 'right' | 'left',
      };
    }

    return null;
  }, [
    mode,
    completionTrigger,
    returnJourney,
    isLiveActive,
    liveSession,
    officerCoords,
    latestScannedPin,
    pos1Pin,
    latestAnyLog,
    patrolMapConfig?.cycle_reset_at,
  ]);

  const trailPolylinePoints = useMemo(() => {
    // Tampilkan jalur pulang SVG saat sedang berjalan kembali dari Pos 5 ke Pos 1
    if (returnJourney.phase === 'returning' && returnJourney.trailPoints.length >= 2) {
      return returnJourney.trailPoints
        .map((pt) => `${clampMapPercent(pt.x, 2, 98)},${clampMapPercent(pt.y, 2, 98)}`)
        .join(' ');
    }
    if (!isLiveActive || !liveSession || !Array.isArray(liveSession.trail_points)) return '';
    if (liveSession.trail_points.length < 2) return '';
    return liveSession.trail_points
      .map((pt) => `${clampMapPercent(pt.x, 2, 98)},${clampMapPercent(pt.y, 2, 98)}`)
      .join(' ');
  }, [returnJourney.phase, returnJourney.trailPoints, isLiveActive, liveSession]);

  // Deteksi arah hadap horizontal (kiri/kanan) & status bergerak untuk animasi berjalan Satpam
  useEffect(() => {
    if (!officerMarker) {
      prevOfficerPosRef.current = null;
      setOfficerMoving(false);
      return;
    }

    // Jika sedang dalam fase perjalanan pulang otomatis / selesai di Pos 1, gunakan state perjalanan pulang secara langsung
    if (returnJourney.phase !== 'none') {
      setOfficerFacing(returnJourney.facing);
      setOfficerMoving(returnJourney.phase === 'returning');
      prevOfficerPosRef.current = { x: officerMarker.x, y: officerMarker.y };
      return;
    }

    const prev = prevOfficerPosRef.current;
    if (!prev) {
      // Inisialisasi arah hadap dari 2 titik terakhir trail jika tersedia
      const pts = liveSession?.trail_points || [];
      if (pts.length >= 2) {
        const dxTrail = pts[pts.length - 1].x - pts[pts.length - 2].x;
        if (dxTrail < -0.15) setOfficerFacing('left');
        else if (dxTrail > 0.15) setOfficerFacing('right');
      } else if (officerMarker.forcedFacing) {
        setOfficerFacing(officerMarker.forcedFacing);
      }
      prevOfficerPosRef.current = { x: officerMarker.x, y: officerMarker.y };
      if (officerMarker.isLive) {
        const pingMs = new Date(officerMarker.lastUpdateIso).getTime();
        const freshPing = !Number.isNaN(pingMs) && Date.now() - pingMs < 12000;
        setOfficerMoving(freshPing);
        if (freshPing) {
          if (moveStopTimerRef.current) window.clearTimeout(moveStopTimerRef.current);
          moveStopTimerRef.current = window.setTimeout(() => {
            setOfficerMoving(false);
          }, 10000);
        }
      }
      return;
    }

    const dx = officerMarker.x - prev.x;
    const dy = officerMarker.y - prev.y;
    const dist = Math.hypot(dx, dy);

    if (dist >= 0.15) {
      if (dx < -0.15) setOfficerFacing('left');
      else if (dx > 0.15) setOfficerFacing('right');

      setOfficerMoving(true);
      if (moveStopTimerRef.current) window.clearTimeout(moveStopTimerRef.current);
      moveStopTimerRef.current = window.setTimeout(
        () => {
          setOfficerMoving(false);
        },
        officerMarker.isLive ? 9000 : 1150
      );
    }

    prevOfficerPosRef.current = { x: officerMarker.x, y: officerMarker.y };
  }, [
    officerMarker?.x,
    officerMarker?.y,
    officerMarker?.isLive,
    officerMarker?.lastUpdateIso,
    officerMarker?.forcedFacing,
    liveSession?.trail_points,
    returnJourney.phase,
    returnJourney.facing,
  ]);

  useEffect(() => {
    return () => {
      if (moveStopTimerRef.current) {
        window.clearTimeout(moveStopTimerRef.current);
      }
      clearReturnTimers();
    };
  }, []);

  const isWalkerAnimating = Boolean(
    officerMarker &&
      (returnJourney.phase === 'returning'
        ? true
        : returnJourney.phase === 'arrived_standby' || returnJourney.phase === 'paused_at_pos5'
          ? false
          : officerMoving ||
            (officerMarker.isLive &&
              nowMs - new Date(officerMarker.lastUpdateIso).getTime() < 9000))
  );

  const effectiveFacing: 'right' | 'left' =
    officerMarker?.forcedFacing ?? officerFacing;

  return (
    <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs">
      {/* Header Progres Patroli & Mode */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/75">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-[#1B271B] flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-[#2B3F29] shrink-0" />
                {mode === 'editor'
                  ? 'Editor Koordinat Pin Peta Patroli'
                  : 'Peta Mapping Rute Patroli Real-Time'}
              </h3>
              {mode !== 'editor' &&
                (returnJourney.phase === 'returning' && completionTrigger ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#243825] bg-[#E5EEE3] border border-[#C6D2BF] rounded-md px-2 py-0.5">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#384E35] opacity-85" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2B3F29]" />
                    </span>
                    <span>
                      LIVE: {completionTrigger.officerName} Kembali ke Pos Security...
                    </span>
                  </span>
                ) : returnJourney.phase === 'arrived_standby' ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#243825] bg-[#E5EEE3] border border-[#C6D2BF] rounded-md px-2 py-0.5 tabular-nums">
                    <span className="w-2 h-2 rounded-full bg-[#2B3F29] shrink-0" />
                    <span>
                      Standby di Pos Security • Patroli Selesai ({scannedCount}/{totalCount})
                    </span>
                  </span>
                ) : isLiveActive && liveSession ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#243825] bg-[#E5EEE3] border border-[#C6D2BF] rounded-md px-2 py-0.5 tabular-nums">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#384E35] opacity-80" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2B3F29]" />
                    </span>
                    <span>
                      LIVE: {liveSession.officer_name} Sedang Patroli • Update{' '}
                      {formatElapsedIndonesian(liveSession.last_ping_at, nowMs)}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#4A554A] bg-[#FFFDF8] border border-[#E6E2D6] rounded-md px-2 py-0.5">
                    <span className="w-2 h-2 rounded-full bg-[#9AA598] shrink-0" />
                    <span>{scannedCount === 0 ? 'Standby di Pos Security' : 'Standby'}</span>
                  </span>
                ))}
              {mode === 'warga' && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#243825] bg-[#FFFDF8] border border-[#C6D2BF] rounded-md px-2 py-0.5">
                  <Eye className="w-3 h-3 text-[#2B3F29]" />
                  Read-Only (Pantauan Warga)
                </span>
              )}
            </div>
            {mode !== 'editor' ? (
              <p className="text-xs font-semibold text-[#4A554A] mt-1 tabular-nums">
                Progres Patroli:{' '}
                <span
                  className={
                    scannedCount === totalCount && totalCount > 0
                      ? 'text-[#243825]'
                      : 'text-[#1B271B]'
                  }
                >
                  {scannedCount} / {totalCount} Titik Terverifikasi
                </span>
                {patrolMapConfig?.cycle_reset_at && (
                  <span className="text-[11px] font-normal text-[#6E786D] ml-1.5">
                    · Siklus mulai {formatJamWib(patrolMapConfig.cycle_reset_at)}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-xs text-[#6E786D] mt-0.5">
                Klik langsung di jalur jalan peta atau seret (drag) pin untuk menempatkan ujung pin
                secara presisi.
              </p>
            )}
          </div>

          {canResetCycle && mode !== 'warga' && mode !== 'editor' && onResetCycle && (
            <div className="shrink-0">
              {confirmReset ? (
                <div className="flex items-center gap-1.5 bg-[#F2D8A7]/45 border border-[#E2C285] rounded-2xl px-2.5 py-1.5">
                  <span className="text-[11px] font-semibold text-[#4A3410]">
                    Reset siklus shift?
                  </span>
                  <button
                    type="button"
                    onClick={handleConfirmReset}
                    disabled={resettingCycle}
                    className="px-3 py-1 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-[#FFFDF8] text-[11px] font-bold transition disabled:opacity-50 cursor-pointer"
                  >
                    {resettingCycle ? 'Mereset...' : 'Ya, Reset'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    disabled={resettingCycle}
                    className="px-2.5 py-1 rounded-full bg-[#FFFDF8] border border-[#E6E2D6] text-[#4A554A] text-[11px] font-semibold hover:bg-[#F7F4EC] cursor-pointer"
                  >
                    Batal
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#FFFDF8] hover:bg-[#E5EEE3] border border-[#E6E2D6] text-[#1B271B] text-xs font-semibold transition min-h-[36px] cursor-pointer"
                  title="Reset status pin peta untuk shift baru tanpa menghapus riwayat patroli"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-[#2B3F29]" />
                  Reset Siklus Patroli
                </button>
              )}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {mode !== 'editor' && totalCount > 0 && (
          <div className="mt-2.5">
            <div className="h-2 w-full rounded-full bg-[#E6E2D6] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#2B3F29] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Area Kanvas Peta + Overlay Pin */}
      <div className="p-3 sm:p-4 bg-[#F6F3EA]">
        {mode === 'editor' && selectedEditorTitikId && (
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 bg-[#E5EEE3] border border-[#C6D2BF] rounded-2xl px-3 py-2 text-xs text-[#243825]">
            <span className="flex items-center gap-1.5 font-medium">
              <Crosshair className="w-3.5 h-3.5 text-[#2B3F29] shrink-0" />
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
                <span className="font-mono text-[11px] font-bold bg-[#FFFDF8] border border-[#C6D2BF] text-[#243825] px-2 py-0.5 rounded-md tabular-nums">
                  X: {activeGuide.x.toFixed(2)}% · Y: {activeGuide.y.toFixed(2)}%
                </span>
              )}
              {savingPin && (
                <span className="text-[11px] font-bold text-[#243825]">Menyimpan...</span>
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
          className={`relative w-full overflow-hidden rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] select-none ${
            mode === 'editor' && selectedEditorTitikId
              ? 'cursor-crosshair ring-2 ring-[#2B3F29]/35 touch-none'
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
              className="block w-full h-auto bg-[#F7F4EC] pointer-events-none"
              role="img"
              aria-label="Denah Perumahan Saung Kebun"
            >
              <defs>
                <pattern id="grid-patrol-169" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E6E2D6" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width="800" height="450" fill="url(#grid-patrol-169)" />
              {/* Jalan Utama & Rute Patroli 16:9 */}
              <path
                d="M 80 342 L 512 342 L 500 205 L 496 130 L 672 130"
                fill="none"
                stroke="#384E35"
                strokeWidth="12"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.2"
              />
              <path
                d="M 80 342 L 512 342 L 500 205 L 496 130 L 672 130"
                fill="none"
                stroke="#2B3F29"
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
                fill="#FFFDF8"
                stroke="#C6D2BF"
                strokeWidth="1.5"
              />
              <text x="305" y="236" textAnchor="middle" fill="#1B271B" fontSize="14" fontWeight="700">
                BLOK A &amp; BLOK B
              </text>
              <text x="305" y="256" textAnchor="middle" fill="#6E786D" fontSize="10">
                Sekretariat Blok B3/7
              </text>

              <rect
                x="555"
                y="185"
                width="195"
                height="110"
                rx="12"
                fill="#E5EEE3"
                stroke="#C6D2BF"
                strokeWidth="1.5"
              />
              <text x="652" y="236" textAnchor="middle" fill="#243825" fontSize="13" fontWeight="700">
                TAMAN &amp; FASUM
              </text>
              <text x="652" y="255" textAnchor="middle" fill="#384E35" fontSize="10">
                Area Terbuka Warga
              </text>

              <rect
                x="170"
                y="72"
                width="270"
                height="82"
                rx="12"
                fill="#FFFDF8"
                stroke="#C6D2BF"
                strokeWidth="1.5"
              />
              <text x="305" y="112" textAnchor="middle" fill="#1B271B" fontSize="13" fontWeight="700">
                BLOK C &amp; BLOK BELAKANG
              </text>
              <text x="305" y="130" textAnchor="middle" fill="#6E786D" fontSize="10">
                Sektor Utara Perumahan
              </text>

              <rect x="34" y="366" width="136" height="36" rx="8" fill="#243825" />
              <text x="102" y="388" textAnchor="middle" fill="#FFFDF8" fontSize="11" fontWeight="700">
                GERBANG / POS 1
              </text>

              <text x="24" y="34" fill="#1B271B" fontSize="13" fontWeight="700">
                DENAH PERUMAHAN SAUNG KEBUN
              </text>
              <text x="24" y="50" fill="#6E786D" fontSize="10">
                Unggah gambar peta 3D perumahan di Pengaturan &gt; Petugas &gt; Peta Mapping
              </text>
            </svg>
          )}

          {/* Garis Bantu Crosshair Presisi pada Editor Mode */}
          {mode === 'editor' && activeGuide && (
            <div className="pointer-events-none absolute inset-0 z-10">
              <div
                className="absolute top-0 bottom-0 border-l border-dashed border-[#2B3F29]/80"
                style={{ left: `${activeGuide.x}%` }}
              />
              <div
                className="absolute left-0 right-0 border-t border-dashed border-[#2B3F29]/80"
                style={{ top: `${activeGuide.y}%` }}
              />
              <span
                className="absolute w-2.5 h-2.5 rounded-full border-2 border-[#2B3F29] bg-[#FFFDF8] shadow-xs"
                style={{
                  left: `${activeGuide.x}%`,
                  top: `${activeGuide.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            </div>
          )}

          {/* OVERLAY JEJAK RUTE SVG REAL-TIME (Garis Cyan/Biru Cerah Putus-Putus Bercahaya) */}
          {(isLiveActive || returnJourney.phase === 'returning') && trailPolylinePoints && (
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
                stroke="#384E35"
                strokeWidth="1.35"
                strokeOpacity="0.45"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#patrol-live-trail-glow)"
              />
              <polyline
                points={trailPolylinePoints}
                fill="none"
                stroke="#2B3F29"
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
                  ? 'bg-[#2B3F29]'
                  : 'bg-[#1B271B]'
                : item.scanned
                  ? isWarningNote
                    ? 'bg-[#D9A74A]'
                    : 'bg-[#2B3F29]'
                  : 'bg-[#C87058]';

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
                    className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-6 h-6 rounded-full bg-[#C87058]/35 animate-ping"
                  />
                )}
                {mode !== 'editor' && item.scanned && isJustScanned && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 w-8 h-8 rounded-full bg-[#384E35]/55 animate-ping"
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
                    className={`relative flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-t-full rounded-r-full rounded-bl-none -rotate-45 ring-2 ring-[#FFFDF8] shadow-md transition-transform duration-150 ${pinBgClass} ${
                      isDraggingThis
                        ? 'scale-125 ring-[#E5EEE3]'
                        : isSelected
                          ? 'scale-115'
                          : 'group-hover:scale-110'
                    }`}
                  >
                    <span className="rotate-45 text-[10px] sm:text-[11px] font-extrabold text-[#FFFDF8] leading-none tabular-nums">
                      {item.index}
                    </span>
                  </span>

                  {/* Badge Status Sudut Pin */}
                  {mode !== 'editor' && item.scanned && (
                    <span
                      aria-hidden="true"
                      className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#FFFDF8] shadow-xs flex items-center justify-center ring-1 ${
                        isWarningNote
                          ? 'text-[#6E4D12] ring-[#E2C285]'
                          : 'text-[#2B3F29] ring-[#C6D2BF]'
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
                      className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#FFFDF8] text-[#2B3F29] ring-1 ring-[#384E35] shadow-xs flex items-center justify-center"
                    >
                      <Move className="w-2 h-2" />
                    </span>
                  )}
                  {mode === 'editor' && !isSelected && calibratedPosIds?.has(item.titik.id) && (
                    <span
                      aria-hidden="true"
                      title="GPS Terkalibrasi"
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[#2B3F29] text-[#FFFDF8] ring-1 ring-[#FFFDF8] shadow-xs flex items-center justify-center"
                    >
                      <Check className="w-2 h-2 stroke-[3.5]" />
                    </span>
                  )}
                </button>

                {/* Label Mini Transparan Gelap */}
                <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1 text-[9px] font-semibold leading-none px-1.5 py-0.5 rounded-full bg-[#1B271B]/85 text-[#FFFDF8] backdrop-blur-sm whitespace-nowrap shadow-xs">
                  {item.shortLabel}
                </span>

                {/* Popover / Tooltip Detail saat Pin Diketuk (Non-Editor) */}
                {mode !== 'editor' && isSelected && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute ${popoverVerticalClass} ${popoverHorizontalClass} z-40 w-52 sm:w-56 rounded-xl bg-[#1B271B]/95 text-[#FFFDF8] backdrop-blur-md border border-[#FFFDF8]/15 shadow-xl p-2.5 text-left`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <p className="text-[11px] font-bold leading-snug text-[#FFFDF8]">
                        {item.index}. {item.titik.nama_lokasi}
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedPinId(null)}
                        aria-label="Tutup detail pin"
                        className="p-0.5 rounded text-[#E5EEE3]/70 hover:text-[#FFFDF8] cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>

                    {item.scanned && item.latestLog ? (
                      <div className="mt-1.5 space-y-1">
                        <p
                          className={`text-[10px] font-bold inline-flex items-center gap-1 ${
                            isWarningNote ? 'text-[#F2D8A7]' : 'text-[#E5EEE3]'
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
                          <p className="text-[10px] text-[#F2D8A7] bg-[#F2D8A7]/15 border border-[#F2D8A7]/30 rounded-lg px-2 py-1 leading-snug">
                            {item.latestLog.catatan}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] font-semibold text-[#E2A898]">
                        Belum Scan pada siklus patroli aktif
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* MARKER KARAKTER SATPAM BERGERAK MULUS (JANGKAR BAWAH KAKI + RADAR ANIMATE-PING) */}
          {officerMarker && (
            <div
              style={{
                left: `${officerMarker.x}%`,
                top: `${officerMarker.y}%`,
                transform: 'translate(-50%, -100%)',
                transition:
                  officerMarker.transitionMs > 0
                    ? `left ${officerMarker.transitionMs}ms linear, top ${officerMarker.transitionMs}ms linear`
                    : 'none',
              }}
              className={`pointer-events-none absolute will-change-[left,top] ${
                officerPopoverOpen ? 'z-[35]' : 'z-[28]'
              }`}
            >
              {/* Label Nama Petugas di Atas Kepala */}
              <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap">
                <span
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#1B271B]/90 text-[#FFFDF8] text-[10px] font-bold shadow-md backdrop-blur-sm ${
                    officerMarker.isReturning
                      ? 'ring-1 ring-[#F2D8A7]/80'
                      : officerMarker.isLive
                        ? 'ring-1 ring-[#E5EEE3]/85'
                        : 'ring-1 ring-[#C6D2BF]/65'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      officerMarker.isReturning
                        ? 'bg-[#F2D8A7] animate-pulse'
                        : officerMarker.isLive
                          ? 'bg-[#E5EEE3] animate-pulse'
                          : officerMarker.isArrivedStandby
                            ? 'bg-[#C6D2BF]'
                            : 'bg-[#E5EEE3]'
                    }`}
                  />
                  <span>
                    {officerMarker.isLive
                      ? `Petugas · ${officerMarker.name}`
                      : `Petugas · ${officerMarker.name.split(' ')[0]}`}
                  </span>
                </span>
              </div>

              {/* Radar Pulse Perspektif 3D tepat di Dasar / Bawah Kaki */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 flex items-center justify-center"
              >
                {officerMarker.isLive && officerMarker.headingDeg !== null && (
                  <span
                    style={{ transform: `rotate(${officerMarker.headingDeg}deg)` }}
                    className="absolute w-14 h-14 transition-transform duration-700 ease-out"
                  >
                    <span className="block mx-auto w-0 h-0 border-l-[9px] border-l-transparent border-r-[9px] border-r-transparent border-b-[18px] border-b-[#384E35]/55 blur-[1px]" />
                  </span>
                )}
                <span
                  className={`absolute w-9 h-5 rounded-full animate-ping ${
                    officerMarker.isLive ? 'bg-[#384E35]/60' : 'bg-[#C6D2BF]/60'
                  }`}
                />
                <span
                  className={`absolute w-6 h-3.5 rounded-full animate-ping [animation-delay:450ms] ${
                    officerMarker.isLive ? 'bg-[#2B3F29]/55' : 'bg-[#E5EEE3]/55'
                  }`}
                />
                <span
                  className={`relative block w-5 h-2.5 rounded-full border-2 border-[#FFFDF8]/90 shadow-xs ${
                    officerMarker.isLive ? 'bg-[#2B3F29]/85' : 'bg-[#384E35]/80'
                  }`}
                />
              </div>

              {/* Tombol Interaktif Karakter Satpam */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedPinId(null);
                  setOfficerPopoverOpen((prev) => !prev);
                }}
                aria-label={`Posisi Petugas ${officerMarker.name} (${
                  officerMarker.isReturning
                    ? 'Kembali ke Pos Security'
                    : isWalkerAnimating
                      ? 'Sedang Berjalan'
                      : 'Standby'
                }) pada koordinat ${officerMarker.x.toFixed(1)}%, ${officerMarker.y.toFixed(1)}%`}
                className="pointer-events-auto relative block pb-[2px] cursor-pointer transition-transform duration-200 hover:scale-110 active:scale-95 focus:outline-none"
              >
                <SecurityWalkerIcon
                  size={42}
                  isWalking={isWalkerAnimating}
                  isFlipped={effectiveFacing === 'left'}
                  isLive={officerMarker.isLive}
                  className="w-[38px] h-[38px] sm:w-[44px] sm:h-[44px]"
                />
              </button>

              {/* Popover Info Petugas saat Karakter Diketuk */}
              {officerPopoverOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className={`pointer-events-auto absolute ${
                    officerMarker.y < 36 ? 'top-full mt-3' : 'bottom-full mb-7'
                  } ${
                    officerMarker.x < 24
                      ? 'left-0 translate-x-0'
                      : officerMarker.x > 76
                        ? 'right-0 translate-x-0'
                        : 'left-1/2 -translate-x-1/2'
                  } z-40 w-52 sm:w-56 rounded-xl bg-[#1B271B]/95 text-[#FFFDF8] backdrop-blur-md border border-[#C6D2BF]/35 shadow-xl p-2.5 text-left`}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div>
                      <p className="text-[11px] font-bold leading-snug text-[#FFFDF8]">
                        {officerMarker.name}
                      </p>
                      <p
                        className={`text-[10px] font-semibold mt-0.5 ${
                          officerMarker.isReturning
                            ? 'text-[#F2D8A7]'
                            : 'text-[#E5EEE3]'
                        }`}
                      >
                        {officerMarker.isReturning
                          ? 'Kembali ke Pos Security...'
                          : officerMarker.isArrivedStandby
                            ? `Standby di Pos Security (${scannedCount}/${totalCount})`
                            : officerMarker.isLive
                              ? `${isWalkerAnimating ? 'Berjalan' : 'Berhenti'} • Update ${formatElapsedIndonesian(officerMarker.lastUpdateIso, nowMs)}`
                              : officerMarker.lastUpdateIso
                                ? `Standby • ${formatJamWib(officerMarker.lastUpdateIso)}`
                                : 'Standby di Pos Security'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOfficerPopoverOpen(false)}
                      aria-label="Tutup detail petugas"
                      className="p-0.5 rounded text-[#E5EEE3]/70 hover:text-[#FFFDF8] cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="mt-2 pt-1.5 border-t border-[#FFFDF8]/15 flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-[#E5EEE3]/85 tabular-nums">
                    <span>
                      Peta: X {officerMarker.x.toFixed(1)}% · Y {officerMarker.y.toFixed(1)}%
                    </span>
                    {officerMarker.accuracy !== null && (
                      <span className="text-[#F2D8A7]">GPS ±{Math.round(officerMarker.accuracy)}m</span>
                    )}
                  </div>
                  {officerMarker.lokasiLabel && (
                    <p className="mt-1 text-[10px] text-[#E5EEE3]/80">
                      Titik: {officerMarker.lokasiLabel}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Legenda Status Kompak */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#4A554A]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C87058] inline-block" />
              Belum Scan
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-[#2B3F29] inline-block" />
              Aman (✓)
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="w-2.5 h-2.5 rounded-full bg-[#D9A74A] inline-block" />
              Ada Catatan (!)
            </span>
            {mode !== 'editor' && (
              <span className="inline-flex items-center gap-1.5 font-medium text-[#243825]">
                <span className="w-2.5 h-2.5 rounded-full bg-[#384E35] ring-1 ring-[#C6D2BF] inline-block" />
                Petugas Live &amp; Jejak Rute
              </span>
            )}
          </div>
          {mode !== 'editor' && (
            <span className="text-[#6E786D]">Ketuk pin untuk melihat detail scan</span>
          )}
        </div>
      </div>

      {/* Panel Detail Pin Terpilih (Opsional di Bawah Peta saat Pin Aktif) */}
      {mode !== 'editor' && selectedPin && (
        <div className="px-4 py-3.5 border-t border-[#E6E2D6] bg-[#FFFDF8]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-[#2B3F29] tabular-nums">
                  TITIK #{selectedPin.index}
                </span>
                <h4 className="text-xs sm:text-sm font-bold text-[#1B271B]">
                  {selectedPin.titik.nama_lokasi}
                </h4>
              </div>
              {selectedPin.titik.keterangan && (
                <p className="text-[11px] text-[#6E786D] mt-0.5">{selectedPin.titik.keterangan}</p>
              )}
            </div>
            <span
              className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                selectedPin.scanned
                  ? selectedPin.latestLog?.status_kondisi === 'Ada Catatan'
                    ? 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]'
                    : 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                  : 'bg-[#C87058]/12 text-[#7A311E] border-[#E2A898]'
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
              <div className="flex items-center gap-2 bg-[#F7F4EC] rounded-2xl px-3 py-2 border border-[#E6E2D6]">
                <Clock className="w-3.5 h-3.5 text-[#2B3F29] shrink-0" />
                <span className="text-[#4A554A] font-medium tabular-nums">
                  {formatTanggalRingkas(selectedPin.latestLog.waktu_scan)} (
                  {selectedPin.latestLog.metode_scan})
                </span>
              </div>
              <div className="flex items-center gap-2 bg-[#F7F4EC] rounded-2xl px-3 py-2 border border-[#E6E2D6]">
                <UserCheck className="w-3.5 h-3.5 text-[#2B3F29] shrink-0" />
                <span className="text-[#4A554A] font-medium truncate">
                  Petugas: {selectedPin.latestLog.nama_petugas}
                </span>
              </div>
              {selectedPin.latestLog.catatan && (
                <div className="sm:col-span-2 bg-[#F2D8A7]/45 border border-[#E2C285] rounded-2xl px-3 py-2 text-[#4A3410]">
                  <span className="font-semibold">Catatan Lapangan:</span>{' '}
                  {selectedPin.latestLog.catatan}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-[#7A311E] bg-[#C87058]/10 border border-[#E2A898] rounded-2xl px-3 py-2">
              Titik checkpoint ini belum di-tap oleh petugas pada siklus patroli aktif.
            </p>
          )}
        </div>
      )}

      {/* Ringkasan Daftar Checkpoint Kompak */}
      {mode !== 'editor' && pinItems.length > 0 && (
        <div className="px-4 py-3.5 border-t border-[#E6E2D6] bg-[#F7F4EC]/70">
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
                  className={`text-left rounded-2xl border px-3 py-2.5 transition flex items-center justify-between gap-2 cursor-pointer ${
                    isSelected
                      ? 'border-[#2B3F29] bg-[#E5EEE3] shadow-xs'
                      : 'border-[#E6E2D6] bg-[#FFFDF8] hover:border-[#C6D2BF]'
                  }`}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                        item.scanned
                          ? isWarning
                            ? 'bg-[#F2D8A7] text-[#4A3410] border border-[#E2C285]'
                            : 'bg-[#2B3F29] text-[#FFFDF8]'
                          : 'bg-[#C87058]/15 text-[#7A311E] border border-[#E2A898]'
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
                      <p className="text-xs font-bold text-[#1B271B] truncate">
                        {item.titik.nama_lokasi}
                      </p>
                      <p className="text-[11px] text-[#6E786D] truncate tabular-nums">
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
                          ? 'bg-[#D9A74A]'
                          : 'bg-[#2B3F29]'
                        : 'bg-[#C87058]'
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
