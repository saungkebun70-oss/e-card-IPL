import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CheckCircle2,
  Clock,
  Crosshair,
  History,
  Layers,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  Satellite,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import {
  DEFAULT_PATROL_CHECKPOINTS,
  type PatrolCheckpoint,
  type PatrolScan,
  type PatrolSession,
  type SessionUser,
} from '../types';
import {
  escapeLeafletHtml,
  fetchLivePatrolSnapshot,
  formatDurationIndo,
  formatRelativePing,
  formatWibDateTime,
  formatWibTime,
  subscribeLivePatrolRealtime,
  type LivePatrolSnapshot,
} from '../lib/livePatrolService';
import { PatrolCalibrationModal } from './PatrolCalibrationModal';

type MapTileMode = 'satellite' | 'street';

const TILE_LAYERS: Record<MapTileMode, { url: string; attribution: string; maxZoom: number }> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Citra Satelit &copy; Esri World Imagery',
    maxZoom: 19,
  },
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
};

interface PatrolLiveLeafletMapProps {
  session?: SessionUser | null;
  canCalibrate?: boolean;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
  /** Callback opsional agar parent (misal PetugasPortalPage) mengetahui snapshot terbaru */
  onSnapshotUpdate?: (snapshot: LivePatrolSnapshot) => void;
  /** Pemicu refresh eksternal bila petugas baru saja memulai/scan/mengakhiri patroli */
  refreshSignal?: number;
}

function createOfficerDivIcon(officerName: string): L.DivIcon {
  const safeName = escapeLeafletHtml(officerName);
  return L.divIcon({
    className: 'skb-leaflet-officer-icon',
    html: `
      <div class="relative flex flex-col items-center -translate-x-1/2 -translate-y-1/2 select-none">
        <div class="relative flex items-center justify-center w-11 h-11">
          <span class="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-65 animate-ping"></span>
          <span class="absolute inline-flex h-8 w-8 rounded-full bg-sky-400/50 animate-pulse"></span>
          <div class="relative z-10 w-9 h-9 rounded-full bg-emerald-600 border-2 border-white shadow-lg flex items-center justify-center text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
              <path d="m9 12 2 2 4-4"></path>
            </svg>
          </div>
        </div>
        <div class="mt-0.5 px-2 py-0.5 rounded-full bg-slate-900/90 text-white text-[10px] font-bold whitespace-nowrap shadow border border-emerald-400/60">
          ${safeName}
        </div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  });
}

function createCheckpointDivIcon(
  orderIndex: number,
  isVerified: boolean,
  timeWib?: string
): L.DivIcon {
  const safeTime = timeWib ? escapeLeafletHtml(timeWib) : '';
  if (isVerified) {
    return L.divIcon({
      className: 'skb-leaflet-cp-icon',
      html: `
        <div class="relative flex flex-col items-center select-none">
          <div class="w-9 h-9 rounded-full bg-emerald-600 border-2 border-white shadow-lg flex items-center justify-center text-white font-bold text-xs">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <div class="mt-0.5 px-1.5 py-0.5 rounded-md bg-emerald-700 text-white text-[9px] font-mono font-bold whitespace-nowrap shadow border border-white/80">
            Pos ${orderIndex}${safeTime ? ` • ${safeTime}` : ''}
          </div>
        </div>
      `,
      iconSize: [36, 48],
      iconAnchor: [18, 22],
      popupAnchor: [0, -24],
    });
  }

  return L.divIcon({
    className: 'skb-leaflet-cp-icon',
    html: `
      <div class="relative flex flex-col items-center select-none">
        <div class="w-9 h-9 rounded-full bg-red-600 border-2 border-white shadow-lg flex items-center justify-center text-white font-mono font-extrabold text-xs">
          ${orderIndex}
        </div>
        <div class="mt-0.5 px-1.5 py-0.5 rounded-md bg-red-700/95 text-white text-[9px] font-bold whitespace-nowrap shadow border border-white/80">
          Pos ${orderIndex}
        </div>
      </div>
    `,
    iconSize: [36, 48],
    iconAnchor: [18, 22],
    popupAnchor: [0, -24],
  });
}

function buildCheckpointPopupHtml(cp: PatrolCheckpoint, scan: PatrolScan | undefined): string {
  const safeName = escapeLeafletHtml(cp.name);
  const safeTag = escapeLeafletHtml(cp.nfc_tag_id || `NFC-POS-0${cp.order_index}`);
  if (scan) {
    const safeOfficer = escapeLeafletHtml(scan.officer_name);
    const safeTime = escapeLeafletHtml(formatWibTime(scan.scanned_at));
    return `
      <div class="min-w-[180px] font-sans text-xs">
        <p class="font-bold text-slate-900 mb-1">${safeName}</p>
        <p class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold text-[11px]">
          ✓ Sudah Scan
        </p>
        <div class="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
          <p>Jam Verifikasi: <strong class="font-mono text-slate-900">${safeTime}</strong></p>
          <p>Petugas: <strong class="text-slate-900">${safeOfficer}</strong></p>
          <p class="font-mono text-[10px] text-slate-400">NFC: ${safeTag}</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="min-w-[180px] font-sans text-xs">
      <p class="font-bold text-slate-900 mb-1">${safeName}</p>
      <p class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-semibold text-[11px]">
        • Belum Scan
      </p>
      <div class="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
        <p>Menunggu verifikasi petugas pada sesi ini.</p>
        <p class="font-mono text-[10px] text-slate-400">NFC: ${safeTag}</p>
      </div>
    </div>
  `;
}

export function PatrolLiveLeafletMap({
  session = null,
  canCalibrate = false,
  onToast,
  onSnapshotUpdate,
  refreshSignal = 0,
}: PatrolLiveLeafletMapProps) {
  const [snapshot, setSnapshot] = useState<LivePatrolSnapshot>({
    checkpoints: DEFAULT_PATROL_CHECKPOINTS,
    activeSession: null,
    activeScans: [],
    completedSessions: [],
    allScans: [],
  });
  const [loading, setLoading] = useState(true);
  const [tileMode, setTileMode] = useState<MapTileMode>('satellite');
  const [followOfficer, setFollowOfficer] = useState(true);
  const [bottomTab, setBottomTab] = useState<'checkpoints' | 'history'>('checkpoints');
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  // Refs vanilla Leaflet
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const officerMarkerRef = useRef<L.Marker | null>(null);
  const routePolylineRef = useRef<L.Polyline | null>(null);
  const checkpointMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const hasFittedBoundsRef = useRef(false);

  const loadSnapshot = useCallback(async () => {
    const next = await fetchLivePatrolSnapshot(session);
    setSnapshot(next);
    onSnapshotUpdate?.(next);
    setLoading(false);
  }, [session, onSnapshotUpdate]);

  useEffect(() => {
    void loadSnapshot();
    const unsubscribe = subscribeLivePatrolRealtime(session, () => {
      void loadSnapshot();
    });
    return () => {
      unsubscribe();
    };
  }, [loadSnapshot, session]);

  useEffect(() => {
    if (refreshSignal > 0) {
      void loadSnapshot();
    }
  }, [refreshSignal, loadSnapshot]);

  // Timer 1 detik untuk label "Update terakhir [X detik/menit lalu]"
  useEffect(() => {
    if (!snapshot.activeSession) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [snapshot.activeSession]);

  // Inisialisasi Vanilla Leaflet Map + Cleanup Wajib `map.remove()`
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const firstCp = DEFAULT_PATROL_CHECKPOINTS[0];
    const map = L.map(container, {
      center: [firstCp.lat, firstCp.lng],
      zoom: 18,
      zoomControl: true,
      attributionControl: true,
    });

    const initialCfg = TILE_LAYERS.satellite;
    const layer = L.tileLayer(initialCfg.url, {
      attribution: initialCfg.attribution,
      maxZoom: initialCfg.maxZoom,
    }).addTo(map);

    mapRef.current = map;
    tileLayerRef.current = layer;

    // Pastikan ukuran container terbaca akurat setelah layout selesai
    const resizeTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      window.clearTimeout(resizeTimer);
      checkpointMarkersRef.current.clear();
      officerMarkerRef.current = null;
      routePolylineRef.current = null;
      tileLayerRef.current = null;
      map.remove();
      mapRef.current = null;
      hasFittedBoundsRef.current = false;
    };
  }, []);

  // Toggle Layer Peta: Satelit (Esri) vs Peta Jalan (OSM)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }

    const cfg = TILE_LAYERS[tileMode];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);
  }, [tileMode]);

  // Peta scan per checkpoint pada sesi aktif
  const activeScanByCheckpoint = useMemo(() => {
    const map = new Map<string, PatrolScan>();
    for (const sc of snapshot.activeScans) {
      if (!map.has(sc.checkpoint_id)) {
        map.set(sc.checkpoint_id, sc);
      }
    }
    return map;
  }, [snapshot.activeScans]);

  // Sinkronisasi 5 Marker Checkpoint (Merah -> Hijau Real-Time)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existingMarkers = checkpointMarkersRef.current;
    const currentIds = new Set(snapshot.checkpoints.map((c) => c.id));

    for (const [id, marker] of existingMarkers.entries()) {
      if (!currentIds.has(id)) {
        map.removeLayer(marker);
        existingMarkers.delete(id);
      }
    }

    const boundsCoords: L.LatLngExpression[] = [];

    for (const cp of snapshot.checkpoints) {
      if (!Number.isFinite(cp.lat) || !Number.isFinite(cp.lng)) continue;
      boundsCoords.push([cp.lat, cp.lng]);

      const scan = activeScanByCheckpoint.get(cp.id);
      const isVerified = Boolean(scan);
      const timeLabel = scan ? formatWibTime(scan.scanned_at) : undefined;
      const icon = createCheckpointDivIcon(cp.order_index, isVerified, timeLabel);
      const popupHtml = buildCheckpointPopupHtml(cp, scan);

      const existing = existingMarkers.get(cp.id);
      if (existing) {
        existing.setLatLng([cp.lat, cp.lng]);
        existing.setIcon(icon);
        existing.setPopupContent(popupHtml);
      } else {
        const marker = L.marker([cp.lat, cp.lng], { icon })
          .addTo(map)
          .bindPopup(popupHtml);
        existingMarkers.set(cp.id, marker);
      }
    }

    if (!hasFittedBoundsRef.current && boundsCoords.length > 0) {
      hasFittedBoundsRef.current = true;
      const bounds = L.latLngBounds(boundsCoords);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
    }
  }, [snapshot.checkpoints, activeScanByCheckpoint]);

  // Sinkronisasi Ikon Petugas (Radar Ping) + Polyline Jejak Rute Real-Time
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const active = snapshot.activeSession;

    if (!active || active.current_lat === null || active.current_lng === null) {
      if (officerMarkerRef.current) {
        map.removeLayer(officerMarkerRef.current);
        officerMarkerRef.current = null;
      }
      if (routePolylineRef.current) {
        map.removeLayer(routePolylineRef.current);
        routePolylineRef.current = null;
      }
      return;
    }

    const latLng: [number, number] = [active.current_lat, active.current_lng];
    const popupHtml = `
      <div class="font-sans text-xs min-w-[160px]">
        <p class="font-bold text-slate-900">${escapeLeafletHtml(active.officer_name)}</p>
        <p class="text-emerald-700 font-semibold text-[11px] mt-0.5">● Sedang Patroli Aktif</p>
        <p class="text-[11px] text-slate-500 mt-1 font-mono">
          Mulai: ${escapeLeafletHtml(formatWibTime(active.started_at))}
        </p>
      </div>
    `;

    if (officerMarkerRef.current) {
      officerMarkerRef.current.setLatLng(latLng);
      officerMarkerRef.current.setIcon(createOfficerDivIcon(active.officer_name));
      officerMarkerRef.current.setPopupContent(popupHtml);
    } else {
      officerMarkerRef.current = L.marker(latLng, {
        icon: createOfficerDivIcon(active.officer_name),
        zIndexOffset: 1000,
      })
        .addTo(map)
        .bindPopup(popupHtml);
    }

    const routeCoords: [number, number][] = active.route_path.map((pt) => [pt.lat, pt.lng]);
    if (
      routeCoords.length === 0 ||
      routeCoords[routeCoords.length - 1][0] !== latLng[0] ||
      routeCoords[routeCoords.length - 1][1] !== latLng[1]
    ) {
      routeCoords.push(latLng);
    }

    if (routePolylineRef.current) {
      routePolylineRef.current.setLatLngs(routeCoords);
    } else {
      routePolylineRef.current = L.polyline(routeCoords, {
        color: '#2563EB',
        weight: 4,
        opacity: 0.9,
        dashArray: '8 6',
      }).addTo(map);
    }

    if (followOfficer) {
      map.panTo(latLng, { animate: true, duration: 0.7 });
    }
  }, [snapshot.activeSession, followOfficer]);

  const handleFocusOfficer = () => {
    const map = mapRef.current;
    const active = snapshot.activeSession;
    if (!map) return;

    if (active && active.current_lat !== null && active.current_lng !== null) {
      setFollowOfficer(true);
      map.setView([active.current_lat, active.current_lng], Math.max(map.getZoom(), 18), {
        animate: true,
      });
      officerMarkerRef.current?.openPopup();
    } else if (snapshot.checkpoints.length > 0) {
      const bounds = L.latLngBounds(snapshot.checkpoints.map((c) => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
      onToast?.('info', 'Belum ada petugas patroli aktif. Peta difokuskan ke 5 Pos Perumahan.');
    }
  };

  const handleFocusCheckpoint = (cp: PatrolCheckpoint) => {
    const map = mapRef.current;
    if (!map) return;
    setFollowOfficer(false);
    map.setView([cp.lat, cp.lng], 19, { animate: true });
    checkpointMarkersRef.current.get(cp.id)?.openPopup();
  };

  const totalCheckpoints = Math.max(snapshot.checkpoints.length, 5);
  const verifiedCount = snapshot.checkpoints.filter((cp) => activeScanByCheckpoint.has(cp.id)).length;
  const progressPercent = Math.min(100, Math.round((verifiedCount / totalCheckpoints) * 100));

  const scansCountBySessionId = useMemo(() => {
    const countMap = new Map<string, Set<string>>();
    for (const sc of snapshot.allScans) {
      if (!countMap.has(sc.session_id)) {
        countMap.set(sc.session_id, new Set());
      }
      countMap.get(sc.session_id)!.add(sc.checkpoint_id);
    }
    return countMap;
  }, [snapshot.allScans]);

  const activeSession = snapshot.activeSession;

  return (
    <section
      aria-label="Peta Live Tracking Patroli Keamanan Real-Time"
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
    >
      {/* Header & Live Status Badge */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-[#0F172A] flex items-center gap-2">
              <Navigation className="w-4 h-4 text-[#059669] shrink-0" />
              <span>Live Tracking Patroli Real-Time</span>
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Pantau posisi petugas, rute patroli, dan verifikasi 5 pos NFC secara langsung.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {canCalibrate && session && (
              <button
                type="button"
                onClick={() => setCalibrationOpen(true)}
                className="min-h-[36px] px-3 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Settings2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Kalibrasi 5 Pos &amp; NFC</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadSnapshot()}
              className="min-h-[36px] px-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
              title="Segarkan data peta"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Segarkan</span>
            </button>
          </div>
        </div>

        {/* Status Badge Real-Time */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {activeSession ? (
            <div
              role="status"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-bold"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" />
              </span>
              <span>
                LIVE: {activeSession.officer_name} Sedang Patroli • Update terakhir{' '}
                <span className="font-mono tabular-nums">
                  {formatRelativePing(activeSession.last_ping_at || activeSession.started_at, nowTick)}
                </span>
              </span>
            </div>
          ) : (
            <div
              role="status"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-semibold"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
              <span>Standby • Belum ada patroli aktif</span>
            </div>
          )}

          {/* Kontrol Layer Peta & Fokus ke Petugas */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setTileMode('satellite')}
                className={`min-h-[30px] px-2.5 rounded-lg inline-flex items-center gap-1 transition cursor-pointer ${
                  tileMode === 'satellite'
                    ? 'bg-[#0F172A] text-white shadow-xs'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                <Satellite className="w-3 h-3 shrink-0" />
                <span>Satelit</span>
              </button>
              <button
                type="button"
                onClick={() => setTileMode('street')}
                className={`min-h-[30px] px-2.5 rounded-lg inline-flex items-center gap-1 transition cursor-pointer ${
                  tileMode === 'street'
                    ? 'bg-[#0F172A] text-white shadow-xs'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                <Layers className="w-3 h-3 shrink-0" />
                <span>Peta Jalan</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleFocusOfficer}
              className={`min-h-[34px] px-2.5 rounded-xl border text-[11px] font-bold inline-flex items-center gap-1 transition cursor-pointer whitespace-nowrap ${
                followOfficer && activeSession
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-white border-slate-200 hover:bg-slate-50 text-[#0F172A]'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5 shrink-0" />
              <span>Fokus ke Petugas</span>
            </button>
          </div>
        </div>
      </div>

      {/* Container Peta Vanilla Leaflet (Tinggi Eksplisit Anti-Error) */}
      <div className="p-3 sm:p-4 bg-slate-50/70">
        <div className="relative rounded-2xl overflow-hidden border border-slate-200">
          <div
            ref={mapContainerRef}
            className="h-[420px] w-full rounded-2xl z-0 bg-slate-200"
          />

          {/* Legenda Ringkas Overlay */}
          <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-xs border border-slate-200 rounded-xl px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 flex flex-wrap items-center gap-x-3 gap-y-1 shadow-sm pointer-events-none">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-600" />
              Belum Scan
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
              Terverifikasi
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 bg-blue-600 inline-block" />
              Jejak Rute
            </span>
          </div>
        </div>
      </div>

      {/* Progress Bar & Daftar 5 Pos / Tab Riwayat Patroli */}
      <div className="px-4 sm:px-5 pb-5 space-y-4">
        {/* Progress Bar */}
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-bold text-[#0F172A] inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#059669] shrink-0" />
              <span>
                Progres Pos: <strong className="font-mono tabular-nums">{verifiedCount}</strong> /{' '}
                <strong className="font-mono tabular-nums">{totalCheckpoints}</strong> Terverifikasi
              </span>
            </span>
            <span className="font-mono font-bold text-emerald-700 tabular-nums">
              {progressPercent}%
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full bg-[#059669] transition-all duration-500 ${
                progressPercent >= 100
                  ? 'w-full'
                  : progressPercent >= 80
                    ? 'w-4/5'
                    : progressPercent >= 60
                      ? 'w-3/5'
                      : progressPercent >= 40
                        ? 'w-2/5'
                        : progressPercent > 0
                          ? 'w-1/5'
                          : 'w-0'
              }`}
            />
          </div>
        </div>

        {/* Tab Switcher: Daftar 5 Pos vs Riwayat Patroli */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 w-fit">
          <button
            type="button"
            onClick={() => setBottomTab('checkpoints')}
            className={`min-h-[34px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer ${
              bottomTab === 'checkpoints'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            <MapPin className="w-3.5 h-3.5 text-[#059669]" />
            <span>5 Pos Checkpoint</span>
          </button>
          <button
            type="button"
            onClick={() => setBottomTab('history')}
            className={`min-h-[34px] px-3 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer ${
              bottomTab === 'history'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            <History className="w-3.5 h-3.5 text-slate-600" />
            <span>Riwayat Patroli ({snapshot.completedSessions.length})</span>
          </button>
        </div>

        {/* Konten Tab 1: Daftar 5 Pos Ringkas */}
        {bottomTab === 'checkpoints' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {snapshot.checkpoints.map((cp) => {
              const scan = activeScanByCheckpoint.get(cp.id);
              const verified = Boolean(scan);
              return (
                <button
                  key={cp.id}
                  type="button"
                  onClick={() => handleFocusCheckpoint(cp)}
                  className={`text-left rounded-xl border p-3 transition-all cursor-pointer ${
                    verified
                      ? 'bg-emerald-50/70 border-emerald-200 hover:border-emerald-400'
                      : 'bg-white border-slate-200 hover:border-red-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`w-6 h-6 rounded-full text-[11px] font-mono font-bold flex items-center justify-center shrink-0 ${
                        verified ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
                      }`}
                    >
                      {verified ? <CheckCircle2 className="w-3.5 h-3.5" /> : cp.order_index}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                        verified
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {verified ? 'Sudah Scan' : 'Belum Scan'}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-[#0F172A] mt-2 line-clamp-2 leading-snug">
                    {cp.name}
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 mt-1 tabular-nums">
                    {scan ? `✓ ${formatWibTime(scan.scanned_at)}` : `NFC: ${cp.nfc_tag_id || '-'}`}
                  </p>
                </button>
              );
            })}
          </div>
        ) : (
          /* Konten Tab 2: Riwayat Patroli (Completed Sessions) */
          <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
            {snapshot.completedSessions.length === 0 ? (
              <div className="p-7 text-center space-y-1.5 bg-slate-50/60">
                <Radio className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-700">
                  Belum Ada Riwayat Sesi Patroli Selesai
                </p>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Setiap sesi patroli live yang diselesaikan petugas akan tercatat otomatis lengkap
                  dengan durasi dan jumlah pos yang terverifikasi.
                </p>
              </div>
            ) : (
              snapshot.completedSessions.map((sess: PatrolSession) => {
                const scannedSet = scansCountBySessionId.get(sess.id);
                const scannedCount = scannedSet ? scannedSet.size : 0;
                const isCompleteAll = scannedCount >= totalCheckpoints;
                return (
                  <div
                    key={sess.id}
                    className="px-4 py-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs sm:text-sm font-bold text-[#0F172A]">
                          {sess.officer_name}
                        </p>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border font-mono tabular-nums ${
                            isCompleteAll
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {scannedCount} / {totalCheckpoints} Pos
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                        Mulai: {formatWibDateTime(sess.started_at)}
                        {sess.ended_at ? ` • Selesai: ${formatWibTime(sess.ended_at)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700 shrink-0 tabular-nums">
                      <Clock className="w-3.5 h-3.5 text-[#059669]" />
                      <span>Durasi: {formatDurationIndo(sess.started_at, sess.ended_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Modal Kalibrasi 5 Pos & ID NFC (Khusus Admin / Ketua) */}
      {canCalibrate && session && (
        <PatrolCalibrationModal
          open={calibrationOpen}
          session={session}
          checkpoints={snapshot.checkpoints}
          onClose={() => setCalibrationOpen(false)}
          onSaved={loadSnapshot}
          onToast={(type, msg) => onToast?.(type, msg)}
        />
      )}
    </section>
  );
}
