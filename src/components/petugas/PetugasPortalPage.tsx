import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Crosshair,
  Fingerprint,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  MessageCircle,
  Navigation,
  PhoneCall,
  Play,
  Radio,
  RefreshCw,
  ScanFace,
  Shield,
  ShieldAlert,
  Smartphone,
  Square,
  UserCircle2,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  SUSUNAN_PENGURUS,
  type LogPatroli,
  type PatrolGpsCalibration,
  type PatrolLiveSession,
  type SecurityShiftOverride,
  type SessionUser,
  type StatusKondisiPatroli,
  type TitikPatroli,
  type TrailPoint,
  type TransaksiKas,
} from '../../types';
import { useAppBrand } from '../../lib/brandContext';
import { ContentLoadingState, LoadingSpinner } from '../LoadingSpinner';
import {
  formatTanggal,
  formatTanggalWaktu,
  normalizePhoneNumber,
} from '../../lib/format';
import {
  fetchPetugasOwnData,
  resetPatrolCycle,
  submitLogPatroliPetugas,
  subscribePatroliRealtime,
  type PetugasOwnData,
} from '../../lib/dataService';
import {
  checkPetugasBiometryAvailability,
  clearPetugasBiometricEnrollment,
  enrollPetugasBiometric,
  loadPetugasBiometricEnrollment,
  subscribeBiometryResume,
  type BiometricAvailability,
  type BiometricEnrollmentProfile,
} from '../../lib/biometricAuth';
import { AppVersionFooter } from '../AppUpdateSystem';
import {
  completeLivePatrolSession,
  fetchActiveLiveSession,
  fetchGpsCalibrations,
  playScanSuccessFeedback,
  startLivePatrolSession,
  subscribeLivePatrolSessions,
  updateLivePatrolPosition,
} from '../../lib/livePatrolService';
import {
  buildCalibratedCheckpoints,
  convertGpsToMapPercent,
  describeGeolocationError,
  getLatestScannedPosPercent,
  getTitikMapPercent,
} from '../../lib/patrolGpsUtils';
import {
  describeWebNfcError,
  extractNfcReadingData,
  getNdefReaderConstructor,
  isWebNfcSupported,
  normalizeNfcUid,
} from '../../lib/webNfc';
import { BrandLogo } from '../BrandLogo';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';
import { PatrolInteractiveMap } from '../PatrolInteractiveMap';
import { PetugasAttendanceCard } from './PetugasAttendanceCard';
import { PetugasHonorTab } from './PetugasHonorTab';
import { NotificationBell } from '../NotificationBell';
import { UserAvatar } from '../UserAvatar';
import { ProfileAvatarEditor } from '../ProfileAvatarEditor';
import { ThemePicker } from '../ThemePicker';
import { NotificationSettingsCard } from '../NotificationSettingsCard';
import {
  fetchShiftOverrides,
  findActiveOverrideForOfficer,
  subscribeShiftOverrides,
} from '../../lib/securityShiftOvertimeService';

interface PetugasPortalPageProps {
  session: SessionUser;
  onAvatarUpdated?: (nextUrl: string | null) => void;
  onLogout: () => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type PetugasTab = 'info' | 'riwayat' | 'scan' | 'honor' | 'peta';

function isSameLocalDay(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

const TAB_TITLES: Record<PetugasTab, { title: string; subtitle: string }> = {
  info: {
    title: 'Info & Shift Keamanan',
    subtitle: 'Jadwal aktif, instruksi pengurus & panggilan darurat',
  },
  riwayat: {
    title: 'Riwayat Patroli Pribadi',
    subtitle: 'Log checkpoint hasil scan pribadi Anda',
  },
  scan: {
    title: 'Patroli & Scan Checkpoint NFC',
    subtitle: 'Tempelkan HP ke tag RFID/NFC di titik checkpoint',
  },
  honor: {
    title: 'Honor & Lembur Pribadi',
    subtitle: 'Pencairan honor Termin Tgl 7/18 & uang lembur Anda',
  },
  peta: {
    title: 'Peta Patroli Real-Time',
    subtitle: 'Pantau titik merah (belum scan) & hijau (terverifikasi)',
  },
};

export function PetugasPortalPage({
  session,
  onAvatarUpdated,
  onLogout,
  onToast,
}: PetugasPortalPageProps) {
  const { brand } = useAppBrand();
  const [activeTab, setActiveTab] = useState<PetugasTab>('scan');
  const [data, setData] = useState<PetugasOwnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [riwayatFilter, setRiwayatFilter] = useState<'hari_ini' | 'semua'>('hari_ini');
  const [resettingCycle, setResettingCycle] = useState(false);
  const [biometryAvailability, setBiometryAvailability] = useState<BiometricAvailability | null>(
    null
  );
  const [biometricProfile, setBiometricProfile] = useState<BiometricEnrollmentProfile | null>(() =>
    loadPetugasBiometricEnrollment()
  );
  const [togglingBiometric, setTogglingBiometric] = useState(false);

  // Tangkap tombol Back HP/Browser agar menutup sidebar, modal profil, atau kembali ke menu utama ('scan') tanpa keluar login
  useEffect(() => {
    const onBackOverlay = (e: Event) => {
      const detail = (e as CustomEvent<{ handled?: boolean }>).detail;
      if (!detail || detail.handled) return;
      if (sidebarOpen) {
        detail.handled = true;
        setSidebarOpen(false);
        return;
      }
      if (profileModalOpen) {
        detail.handled = true;
        setProfileModalOpen(false);
        return;
      }
      if (activeTab !== 'scan') {
        detail.handled = true;
        setActiveTab('scan');
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('ecard-handle-back-overlay', onBackOverlay);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('ecard-handle-back-overlay', onBackOverlay);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sidebarOpen, profileModalOpen, activeTab]);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    const initBiometry = async () => {
      try {
        const avail = await checkPetugasBiometryAvailability();
        if (!active) return;
        setBiometryAvailability(avail);
        setBiometricProfile(loadPetugasBiometricEnrollment());
        unsubscribe = await subscribeBiometryResume((nextAvail) => {
          if (!active) return;
          setBiometryAvailability(nextAvail);
        });
      } catch {
        // Biometrik opsional — abaikan jika tidak tersedia di perangkat/browser
      }
    };
    void initBiometry();
    return () => {
      active = false;
      try {
        unsubscribe();
      } catch {
        // Abaikan
      }
    };
  }, []);

  const isBiometricEnabledForMe = Boolean(
    biometricProfile && biometricProfile.petugas_id === session?.petugas_id
  );

  const handleToggleBiometric = async () => {
    if (isBiometricEnabledForMe) {
      clearPetugasBiometricEnrollment();
      setBiometricProfile(null);
      onToast('info', 'Masuk cepat biometrik di perangkat ini telah dinonaktifkan.');
      return;
    }

    if (!biometryAvailability?.isAvailable) {
      onToast(
        'error',
        biometryAvailability?.reason || 'Perangkat ini belum mendukung login biometrik.'
      );
      return;
    }

    setTogglingBiometric(true);
    try {
      const res = await enrollPetugasBiometric(session, biometryAvailability);
      if (res?.ok && res?.profile) {
        setBiometricProfile(res.profile);
        onToast(
          'success',
          `Masuk cepat ${biometryAvailability.label} aktif untuk ${session?.nama_warga || 'Petugas'}.`
        );
      } else if (!res?.cancelled) {
        onToast('error', res?.error || 'Gagal mengaktifkan login biometrik.');
      }
    } catch {
      onToast('error', 'Gagal mengaktifkan login biometrik pada perangkat ini.');
    } finally {
      setTogglingBiometric(false);
    }
  };

  // State Patroli NFC & Manual Fallback
  const nfcSupported = isWebNfcSupported();
  const [scanningNfc, setScanningNfc] = useState(false);
  const [nfcStatusText, setNfcStatusText] = useState<string | null>(null);
  const [nfcStatusError, setNfcStatusError] = useState(false);
  const [selectedTitikId, setSelectedTitikId] = useState<string>('');
  const [statusKondisi, setStatusKondisi] = useState<StatusKondisiPatroli>('Aman');
  const [catatanPatroli, setCatatanPatroli] = useState('');
  const [submittingPatroli, setSubmittingPatroli] = useState(false);
  const [showManualForm, setShowManualForm] = useState(!nfcSupported);
  const nfcAbortRef = useRef<AbortController | null>(null);

  // State Live Tracking Patroli Real-Time di atas Peta 3D (patrol_live_sessions & patrol_gps_calibration)
  const [gpsCalibrations, setGpsCalibrations] = useState<Record<string, PatrolGpsCalibration>>({});
  const [activeLiveSession, setActiveLiveSession] = useState<PatrolLiveSession | null>(null);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsErrorMsg, setGpsErrorMsg] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [startingLivePatrol, setStartingLivePatrol] = useState(false);
  const [completingLivePatrol, setCompletingLivePatrol] = useState(false);
  const [confirmFinishOpen, setConfirmFinishOpen] = useState(false);
  const [manualUidInput, setManualUidInput] = useState('');

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const lastPingSentAtRef = useRef<number>(0);
  const trailPointsRef = useRef<TrailPoint[]>([]);
  const activeSessionRef = useRef<PatrolLiveSession | null>(null);
  const gpsCalibrationsRef = useRef<Record<string, PatrolGpsCalibration>>({});
  const gpsCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const patrolMapConfigRef = useRef(data?.patrolMapConfig || null);
  const patroliCycleLogsRef = useRef<LogPatroli[]>([]);

  activeSessionRef.current = activeLiveSession;
  gpsCalibrationsRef.current = gpsCalibrations;
  gpsCoordsRef.current = gpsCoords;
  patrolMapConfigRef.current = data?.patrolMapConfig || null;
  patroliCycleLogsRef.current = data?.patroliCycleLogs || [];

  // Ref terbaru agar kondisi & catatan yang diubah saat scan aktif tetap ikut tersimpan
  const statusKondisiRef = useRef<StatusKondisiPatroli>(statusKondisi);
  const catatanPatroliRef = useRef<string>(catatanPatroli);
  const titikPatroliRef = useRef<TitikPatroli[]>([]);

  statusKondisiRef.current = statusKondisi;
  catatanPatroliRef.current = catatanPatroli;
  titikPatroliRef.current = data?.titikPatroli || [];

  // State Kwitansi Honor Pribadi
  const [selectedHonorTrx, setSelectedHonorTrx] = useState<TransaksiKas | null>(null);

  const calibratedCount = useMemo(
    () =>
      buildCalibratedCheckpoints(
        data?.titikPatroli || [],
        gpsCalibrations,
        data?.patrolMapConfig || null
      ).length,
    [data?.titikPatroli, gpsCalibrations, data?.patrolMapConfig]
  );

  const computeMappedPosition = useCallback(
    (lat?: number | null, lng?: number | null, overrideFallback?: { x: number; y: number } | null) => {
      const titikList = titikPatroliRef.current;
      const mapCfg = patrolMapConfigRef.current;
      const calibrated = buildCalibratedCheckpoints(
        titikList,
        gpsCalibrationsRef.current,
        mapCfg
      );

      let fallbackPos = overrideFallback || null;
      if (!fallbackPos) {
        const latestScanned = getLatestScannedPosPercent(
          titikList,
          patroliCycleLogsRef.current,
          mapCfg,
          mapCfg?.cycle_reset_at
        );
        if (latestScanned) {
          fallbackPos = { x: latestScanned.x, y: latestScanned.y };
        } else {
          const activeTitik = titikList.filter((t) => t.aktif !== false);
          if (activeTitik.length > 0) {
            fallbackPos = getTitikMapPercent(activeTitik[0], 0, mapCfg);
          } else {
            fallbackPos = { x: 12.5, y: 76.0 };
          }
        }
      }

      if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
        return convertGpsToMapPercent(lat, lng, calibrated, fallbackPos);
      }

      return {
        x: fallbackPos.x,
        y: fallbackPos.y,
        mode: 'fallback' as const,
      };
    },
    []
  );

  const loadLivePatrolState = useCallback(async () => {
    const [calMap, activeSess] = await Promise.all([
      fetchGpsCalibrations(session),
      fetchActiveLiveSession(session),
    ]);
    setGpsCalibrations(calMap);
    setActiveLiveSession(activeSess);
    if (activeSess && activeSess.trail_points.length > trailPointsRef.current.length) {
      trailPointsRef.current = activeSess.trail_points;
    } else if (!activeSess) {
      trailPointsRef.current = [];
    }
  }, [session]);

  const acquireWakeLock = useCallback(async () => {
    try {
      const navWithWake = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
      };
      if (navWithWake.wakeLock && typeof navWithWake.wakeLock.request === 'function') {
        const sentinel = await navWithWake.wakeLock.request('screen');
        wakeLockRef.current = sentinel;
        setWakeLockActive(true);
        sentinel.addEventListener('release', () => {
          setWakeLockActive(false);
        });
      } else {
        setWakeLockActive(false);
      }
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      // Abaikan error pelepasan Wake Lock
    } finally {
      setWakeLockActive(false);
    }
  }, []);

  const stopGpsWatcher = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof navigator !== 'undefined' &&
      'geolocation' in navigator
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startGpsWatcherForSession = useCallback(
    (patrolSession: PatrolLiveSession) => {
      stopGpsWatcher();
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = Math.round(pos.coords.accuracy || 0);
          setGpsCoords({ lat, lng });
          setGpsAccuracy(accuracy);
          setGpsErrorMsg(null);

          const nowMs = Date.now();
          // Throttle setiap 4 detik agar hemat kuota & baterai namun tetap mulus
          if (nowMs - lastPingSentAtRef.current < 4000) return;
          lastPingSentAtRef.current = nowMs;

          const activeSess = activeSessionRef.current || patrolSession;
          if (!activeSess || activeSess.status !== 'active') return;

          const mapped = computeMappedPosition(lat, lng, {
            x: activeSess.current_x,
            y: activeSess.current_y,
          });
          const nowIso = new Date(nowMs).toISOString();

          const currentTrail = trailPointsRef.current;
          const lastPt = currentTrail[currentTrail.length - 1];
          const movedEnough =
            !lastPt ||
            Math.hypot(mapped.x - lastPt.x, mapped.y - lastPt.y) >= 0.2;

          const nextTrail: TrailPoint[] = movedEnough
            ? [...currentTrail, { x: mapped.x, y: mapped.y, time: nowIso }].slice(-180)
            : currentTrail.length > 0
              ? currentTrail
              : [{ x: mapped.x, y: mapped.y, time: nowIso }];

          trailPointsRef.current = nextTrail;

          setActiveLiveSession((prev) =>
            prev
              ? {
                  ...prev,
                  current_x: mapped.x,
                  current_y: mapped.y,
                  current_lat: lat,
                  current_lng: lng,
                  accuracy,
                  trail_points: nextTrail,
                  last_ping_at: nowIso,
                }
              : prev
          );

          void updateLivePatrolPosition(session, activeSess.id, {
            current_x: mapped.x,
            current_y: mapped.y,
            current_lat: lat,
            current_lng: lng,
            accuracy,
            trail_points: nextTrail,
          });
        },
        (err) => {
          setGpsErrorMsg(describeGeolocationError(err));
        },
        {
          enableHighAccuracy: true,
          maximumAge: 3000,
          timeout: 15000,
        }
      );
    },
    [computeMappedPosition, session, stopGpsWatcher]
  );

  const handleStartLivePatrol = useCallback(async () => {
    if (startingLivePatrol) return;
    setGpsErrorMsg(null);

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      const msg = describeGeolocationError(null);
      setGpsErrorMsg(msg);
      onToast('error', msg);
      return;
    }

    setStartingLivePatrol(true);
    try {
      const initialPosition = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 3000,
        });
      });

      const lat = initialPosition.coords.latitude;
      const lng = initialPosition.coords.longitude;
      const acc = Math.round(initialPosition.coords.accuracy || 0);

      setGpsCoords({ lat, lng });
      setGpsAccuracy(acc);

      await acquireWakeLock();

      const mapped = computeMappedPosition(lat, lng);
      const res = await startLivePatrolSession(session, {
        current_x: mapped.x,
        current_y: mapped.y,
        current_lat: lat,
        current_lng: lng,
        accuracy: acc,
      });

      if (!res.ok || !res.data) {
        await releaseWakeLock();
        onToast('error', res.message || 'Gagal memulai sesi Patroli Live.');
        return;
      }

      trailPointsRef.current = res.data.trail_points;
      lastPingSentAtRef.current = Date.now();
      setActiveLiveSession(res.data);
      startGpsWatcherForSession(res.data);
      onToast(
        'success',
        `Patroli Live dimulai! GPS Aktif (±${acc}m) dan posisi Anda kini tampil di Peta 3D.`
      );
    } catch (err) {
      const msg = describeGeolocationError(err);
      setGpsErrorMsg(msg);
      onToast('error', msg);
    } finally {
      setStartingLivePatrol(false);
    }
  }, [
    startingLivePatrol,
    acquireWakeLock,
    releaseWakeLock,
    computeMappedPosition,
    session,
    startGpsWatcherForSession,
    onToast,
  ]);

  const handleConfirmFinishLivePatrol = useCallback(async () => {
    const active = activeSessionRef.current;
    if (!active || completingLivePatrol) {
      setConfirmFinishOpen(false);
      return;
    }
    setCompletingLivePatrol(true);
    try {
      stopGpsWatcher();
      await releaseWakeLock();
      const res = await completeLivePatrolSession(session, active.id);
      if (!res.ok) {
        onToast('error', res.message);
      } else {
        setActiveLiveSession(null);
        trailPointsRef.current = [];
        setConfirmFinishOpen(false);
        await loadLivePatrolState();
        onToast('success', 'Patroli Live selesai. Terima kasih telah menjaga keamanan lingkungan!');
      }
    } finally {
      setCompletingLivePatrol(false);
    }
  }, [completingLivePatrol, stopGpsWatcher, releaseWakeLock, session, onToast, loadLivePatrolState]);

  const loadData = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetchPetugasOwnData(session);
        if (res.data) {
          setData(res.data);
          if (res.data.titikPatroli.length > 0) {
            setSelectedTitikId((prev) => prev || res.data!.titikPatroli[0].id);
          }
        } else if (res.error) {
          onToast('error', res.error);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, onToast]
  );

  // Re-acquire Wake Lock otomatis saat layar/tab kembali aktif selama patroli berlangsung
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeSessionRef.current?.status === 'active') {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [acquireWakeLock]);

  useEffect(() => {
    void loadData(false);
    void loadLivePatrolState();
    const unsubscribeLegacy = subscribePatroliRealtime(session, () => loadData(true));
    const unsubscribeLive = subscribeLivePatrolSessions(session, () => {
      void loadLivePatrolState();
    });
    return () => {
      unsubscribeLegacy();
      unsubscribeLive();
      stopGpsWatcher();
      void releaseWakeLock();
      nfcAbortRef.current?.abort();
    };
  }, [loadData, loadLivePatrolState, session, stopGpsWatcher, releaseWakeLock]);

  // Kontak Darurat Pengurus (Erlangga — Ketua & Andriansyah — Bendahara)
  const emergencyPengurus = useMemo(() => {
    const ketua = SUSUNAN_PENGURUS.find((p) => p.jabatan === 'Ketua');
    const bendahara = SUSUNAN_PENGURUS.find((p) => p.jabatan === 'Bendahara');
    const map = brand.pengurus_wa_map || {};
    const defaultWa = normalizePhoneNumber(brand.wa_pengurus || '');

    return [
      {
        label: ketua ? `${ketua.nama} (Ketua)` : 'Erlangga (Ketua)',
        wa: normalizePhoneNumber(
          (ketua && map[ketua.username.toLowerCase()]) || defaultWa
        ),
      },
      {
        label: bendahara ? `${bendahara.nama} (Bendahara)` : 'Andriansyah (Bendahara)',
        wa: normalizePhoneNumber(
          (bendahara && map[bendahara.username.toLowerCase()]) || defaultWa
        ),
      },
    ].filter((c) => c.wa.length >= 10);
  }, [brand]);

  const stopNfcScan = useCallback(() => {
    nfcAbortRef.current?.abort();
    nfcAbortRef.current = null;
    setScanningNfc(false);
  }, []);

  const recordPatrolEntry = useCallback(
    async (
      titik: TitikPatroli | null,
      fallbackLabel: string,
      metode: 'NFC Tap' | 'Input Manual'
    ) => {
      setSubmittingPatroli(true);
      try {
        const res = await submitLogPatroliPetugas(session, {
          titik_id: titik?.id || null,
          nama_lokasi: titik?.nama_lokasi || fallbackLabel,
          metode_scan: metode,
          status_kondisi: statusKondisiRef.current,
          catatan: catatanPatroliRef.current,
        });

        playScanSuccessFeedback();

        // Sinkronkan posisi marker petugas di Peta 3D bila sesi Patroli Live sedang aktif
        // (khususnya otomatis memindahkan marker ke Pos yang baru di-scan saat kalibrasi GPS < 2 pos)
        const currentSess = activeSessionRef.current;
        if (currentSess && currentSess.status === 'active' && titik) {
          const activeTitikList = titikPatroliRef.current.filter((t) => t.aktif !== false);
          const idx = activeTitikList.findIndex((t) => t.id === titik.id);
          const posPercent = getTitikMapPercent(
            titik,
            idx >= 0 ? idx : 0,
            patrolMapConfigRef.current
          );
          const calibratedNow = buildCalibratedCheckpoints(
            activeTitikList,
            gpsCalibrationsRef.current,
            patrolMapConfigRef.current
          );

          if (calibratedNow.length < 2) {
            const nowIso = new Date().toISOString();
            const nextTrail: TrailPoint[] = [
              ...trailPointsRef.current,
              { x: posPercent.x, y: posPercent.y, time: nowIso },
            ].slice(-180);
            trailPointsRef.current = nextTrail;

            setActiveLiveSession((prev) =>
              prev
                ? {
                    ...prev,
                    current_x: posPercent.x,
                    current_y: posPercent.y,
                    trail_points: nextTrail,
                    last_ping_at: nowIso,
                  }
                : prev
            );

            void updateLivePatrolPosition(session, currentSess.id, {
              current_x: posPercent.x,
              current_y: posPercent.y,
              current_lat: gpsCoordsRef.current?.lat ?? currentSess.current_lat ?? null,
              current_lng: gpsCoordsRef.current?.lng ?? currentSess.current_lng ?? null,
              trail_points: nextTrail,
            });
          }
        }

        if (res.error) {
          onToast('error', res.error || 'Gagal mencatat patroli.');
        } else {
          const displayLokasi = res.data?.nama_lokasi || titik?.nama_lokasi || fallbackLabel;
          onToast(
            'success',
            `Checkpoint "${displayLokasi}" terverifikasi! Pin Peta 3D langsung diperbarui secara real-time.`
          );
          setCatatanPatroli('');
          setStatusKondisi('Aman');
          await loadData(true);
        }
      } finally {
        setSubmittingPatroli(false);
      }
    },
    [session, onToast, loadData]
  );

  const handleStartNfcScan = async () => {
    if (submittingPatroli) return;

    if (scanningNfc) {
      stopNfcScan();
      setNfcStatusText(null);
      setNfcStatusError(false);
      return;
    }

    try {
      const hasNdef = typeof window !== 'undefined' && 'NDEFReader' in window;
      const NDEFReaderCtor = hasNdef ? getNdefReaderConstructor() : null;
      if (!NDEFReaderCtor) {
        const msg =
          'Perangkat/browser ini tidak mendukung Web NFC (misal iOS atau laptop). Gunakan form "Input Manual Checkpoint" di bawah agar tetap bisa patroli.';
        setShowManualForm(true);
        setNfcStatusError(true);
        setNfcStatusText(msg);
        onToast('info', msg);
        return;
      }

      const controller = new AbortController();
      nfcAbortRef.current = controller;
      const ndef = new NDEFReaderCtor();

      ndef.addEventListener(
        'readingerror',
        () => {
          setNfcStatusError(true);
          setNfcStatusText(
            'Tag terdeteksi tetapi tidak berformat NDEF atau stiker belum diformat. Gunakan stiker NTAG213/215/216 atau Input Manual di bawah.'
          );
        },
        { signal: controller.signal }
      );

      ndef.addEventListener(
        'reading',
        (event) => {
          const { uid, rawSerialNumber, allNormalizedTokens } = extractNfcReadingData(event);
          const serialToken = normalizeNfcUid(rawSerialNumber || uid || '');

          const checkpoints = titikPatroliRef.current;
          const matchedTitik =
            checkpoints.find((t) => {
              const normTarget = normalizeNfcUid(t.rfid_uid);
              return normTarget && (allNormalizedTokens.includes(normTarget) || normTarget === serialToken);
            }) || null;

          stopNfcScan();

          if (matchedTitik) {
            setNfcStatusError(false);
            setNfcStatusText(
              `Stiker NFC terbaca: ${matchedTitik.nama_lokasi} (UID: ${serialToken || matchedTitik.rfid_uid})`
            );
            void recordPatrolEntry(matchedTitik, matchedTitik.nama_lokasi, 'NFC Tap');
          } else {
            const displayUid = serialToken || uid || 'TIDAK-DIKENAL';
            setNfcStatusError(true);
            setNfcStatusText(
              `ID NFC "${displayUid}" belum terdaftar pada Titik Patroli. Minta Pengurus mendaftarkan UID stiker ini di Pengaturan > Petugas, atau gunakan Input Manual.`
            );
            setShowManualForm(true);
            onToast('error', `Tag NFC (${displayUid}) belum terdaftar pada titik patroli.`);
          }
        },
        { signal: controller.signal }
      );

      setScanningNfc(true);
      setNfcStatusError(false);
      setNfcStatusText('Mode Scan Aktif — Tempelkan stiker NFC ke belakang HP sekarang...');

      await ndef.scan({ signal: controller.signal });
    } catch (err) {
      stopNfcScan();
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const readableErr = describeWebNfcError(err);
      setNfcStatusError(true);
      setNfcStatusText(readableErr);
      setShowManualForm(true);
      onToast('error', readableErr);
    }
  };

  /**
   * Tombol bulat tengah "Scan NFC":
   * - Jika sedang scanning -> hentikan mode scan (abort).
   * - Jika belum scanning -> langsung buka tab "Patroli & Scan Checkpoint NFC" sekaligus picu ndef.scan().
   */
  const handleCenterScanFabClick = () => {
    if (submittingPatroli) return;
    if (scanningNfc) {
      stopNfcScan();
      setNfcStatusText(null);
      setNfcStatusError(false);
      return;
    }
    if (activeTab !== 'scan') {
      setActiveTab('scan');
      void loadData(true);
    }
    void handleStartNfcScan();
  };

  /**
   * Fallback Input Manual Checkpoint untuk perangkat non-NFC (iOS / Laptop / Pengujian)
   */
  const handleManualFallbackVerify = async () => {
    if (submittingPatroli) return;

    const checkpoints = data?.titikPatroli || [];
    const cleanUid = normalizeNfcUid(manualUidInput);

    let targetTitik: TitikPatroli | null = null;
    if (cleanUid) {
      targetTitik =
        checkpoints.find((t) => normalizeNfcUid(t.rfid_uid) === cleanUid) || null;
    }
    if (!targetTitik && selectedTitikId) {
      targetTitik = checkpoints.find((t) => t.id === selectedTitikId) || null;
    }
    if (!targetTitik && checkpoints.length > 0) {
      targetTitik = checkpoints[0];
    }

    if (!targetTitik) {
      onToast('error', 'Pilih Titik Checkpoint terlebih dahulu.');
      return;
    }

    setManualUidInput('');
    await recordPatrolEntry(targetTitik, targetTitik.nama_lokasi, 'Input Manual');
  };

  const handleResetCycle = async () => {
    if (resettingCycle) return;
    setResettingCycle(true);
    try {
      const res = await resetPatrolCycle(session);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          'Siklus patroli berhasil direset untuk shift baru. Semua pin siap dipatroli kembali.'
        );
        await loadData(true);
      }
    } finally {
      setResettingCycle(false);
    }
  };

  const patroliHariIni = useMemo<LogPatroli[]>(() => {
    return (data?.patroliPribadi || []).filter((log) => isSameLocalDay(log.waktu_scan));
  }, [data?.patroliPribadi]);

  const displayedRiwayat = useMemo<LogPatroli[]>(() => {
    if (riwayatFilter === 'hari_ini') return patroliHariIni;
    return data?.patroliPribadi || [];
  }, [riwayatFilter, patroliHariIni, data?.patroliPribadi]);

  const activeCycleProgress = useMemo(() => {
    const activePoints = (data?.titikPatroli || []).filter((t) => t.aktif !== false);
    const cycleResetMs = data?.patrolMapConfig?.cycle_reset_at
      ? new Date(data.patrolMapConfig.cycle_reset_at).getTime()
      : (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })();

    const logs = data?.patroliCycleLogs || [];
    const scannedCount = activePoints.filter((titik) => {
      const lower = titik.nama_lokasi.trim().toLowerCase();
      return logs.some((log) => {
        const ms = new Date(log.waktu_scan).getTime();
        if (Number.isNaN(ms) || ms < cycleResetMs) return false;
        return (
          (log.titik_id && log.titik_id === titik.id) ||
          log.nama_lokasi.trim().toLowerCase() === lower
        );
      });
    }).length;

    return { scanned: scannedCount, total: activePoints.length };
  }, [data]);

  const profil = data?.profil || {
    id: session.petugas_id || '',
    nama: session.nama_warga,
    username: session.blok_rumah,
    no_hp: session.no_wa || '',
    shift: session.shift || 'Shift Keamanan',
    avatar_url: session.avatar_url || null,
  };
  const effectiveAvatarUrl = profil.avatar_url ?? session.avatar_url ?? null;

  const handlePetugasAvatarUpdated = (nextUrl: string | null) => {
    onAvatarUpdated?.(nextUrl);
    setData((prev) =>
      prev
        ? {
            ...prev,
            profil: { ...prev.profil, avatar_url: nextUrl },
          }
        : prev
    );
  };

  const handleNotificationNavigate = (targetUrl: string) => {
    if (!targetUrl) return;
    if (targetUrl.startsWith('tab:')) {
      const targetTab = targetUrl.replace('tab:', '');
      if (targetTab === 'keamanan') {
        handleSelectTab('peta');
      } else if (
        targetTab === 'info' ||
        targetTab === 'riwayat' ||
        targetTab === 'scan' ||
        targetTab === 'honor' ||
        targetTab === 'peta'
      ) {
        handleSelectTab(targetTab);
      }
    }
  };

  const [officerShiftOverrides, setOfficerShiftOverrides] = useState<SecurityShiftOverride[]>([]);

  const loadOfficerShiftOverrides = useCallback(async () => {
    const list = await fetchShiftOverrides(session, {
      officerName: profil.nama,
      limit: 40,
    });
    setOfficerShiftOverrides(list);
  }, [session, profil.nama]);

  useEffect(() => {
    void loadOfficerShiftOverrides();
    const unsub = subscribeShiftOverrides(session, () => {
      void loadOfficerShiftOverrides();
    });
    return () => {
      unsub();
    };
  }, [session, loadOfficerShiftOverrides]);

  const activeShiftOverride = useMemo(
    () => findActiveOverrideForOfficer(officerShiftOverrides, profil.nama),
    [officerShiftOverrides, profil.nama]
  );

  const effectiveShiftLabel = activeShiftOverride?.shift_name || profil.shift;

  const handleSelectTab = (nextTab: PetugasTab) => {
    if (activeTab === 'scan' && nextTab !== 'scan' && scanningNfc) {
      stopNfcScan();
    }
    setActiveTab(nextTab);
    void loadData(true);
  };

  const handleSelectTabFromSidebar = (nextTab: PetugasTab) => {
    setSidebarOpen(false);
    handleSelectTab(nextTab);
  };

  const handleOpenProfileFromSidebar = () => {
    setSidebarOpen(false);
    setProfileModalOpen(true);
  };

  const handleLogoutFromSidebar = () => {
    setSidebarOpen(false);
    onLogout();
  };

  const sidebarNavItems: Array<{
    id: PetugasTab;
    label: string;
    subtitle: string;
    icon: typeof Shield;
  }> = [
    { id: 'info', label: 'Pos Jaga & Shift', subtitle: 'Absensi & darurat', icon: Shield },
    { id: 'riwayat', label: 'Riwayat Patroli', subtitle: 'Log checkpoint Anda', icon: ClipboardList },
    { id: 'scan', label: 'Scan NFC / Patroli', subtitle: 'Checkpoint RFID/NFC', icon: Radio },
    { id: 'honor', label: 'Honor & Lembur', subtitle: 'Termin & uang lembur', icon: Wallet },
    { id: 'peta', label: 'Peta Patroli', subtitle: 'Status titik live', icon: MapIcon },
  ];

  const renderPetugasSidebarNav = () => (
    <div className="flex-1 overflow-y-auto px-4 md:px-5 lg:px-4 py-5 md:py-6 lg:py-5 space-y-6 md:space-y-7 lg:space-y-6">
      <div className="space-y-1.5 md:space-y-2 lg:space-y-1.5">
        <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400/90">
          Menu Keamanan
        </p>
        {sidebarNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectTabFromSidebar(item.id)}
              className={`w-full min-h-[46px] md:min-h-[50px] lg:min-h-[46px] px-3.5 md:px-4 lg:px-3.5 py-2.5 md:py-3 lg:py-2.5 rounded-2xl text-left flex items-center gap-3.5 text-[13.5px] md:text-sm leading-snug transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 text-[#312E81] font-bold border border-sky-200/80 shadow-2xs'
                  : 'text-slate-600 font-medium hover:bg-white/80 hover:text-[#0F172A] border border-transparent hover:border-white/80'
              }`}
            >
              <span
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isActive
                    ? 'bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white shadow-xs'
                    : 'bg-slate-100/85 text-slate-500'
                }`}
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={isActive ? 2.4 : 2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight">{item.label}</p>
                <p className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
                  {item.subtitle}
                </p>
              </div>
              {item.id === 'scan' && scanningNfc && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold shrink-0">
                  Aktif
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5 md:space-y-2 lg:space-y-1.5">
        <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400/90">
          Profil &amp; Pengaturan
        </p>
        <button
          type="button"
          onClick={handleOpenProfileFromSidebar}
          className="w-full min-h-[46px] md:min-h-[50px] lg:min-h-[46px] px-3.5 md:px-4 lg:px-3.5 py-2.5 md:py-3 lg:py-2.5 rounded-2xl text-left flex items-center gap-3.5 text-[13.5px] md:text-sm leading-snug font-medium text-slate-600 hover:bg-white/80 hover:text-[#0F172A] border border-transparent hover:border-white/80 transition-all duration-200 cursor-pointer"
        >
          <span className="w-9 h-9 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
            <UserCircle2 className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate leading-tight">Profil &amp; Tema Petugas</p>
            <p className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
              Foto, Tema, Notifikasi &amp; Biometrik
            </p>
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] glass-canvas bg-gradient-to-br from-[#EEF2FF] via-[#F3E8FF] to-[#E0F2FE] text-[#0F172A] overflow-x-hidden">
      {/* SIDEBAR KACA ESTETIK TETAP — DESKTOP (lg+, lebar 260px) */}
      <aside
        aria-label="Navigasi Sidebar Portal Keamanan"
        className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-[260px] z-30 glass-sidebar bg-white/65 backdrop-blur-2xl backdrop-saturate-150 border-l border-l-white/20 border-r border-r-white/85 shadow-[inset_1px_0_0_rgba(255,255,255,0.55),8px_0_36px_-14px_rgba(49,46,129,0.16)] no-print"
      >
        <div className="px-4 pt-5 pb-4 border-b border-indigo-100/70 shrink-0">
          <button
            type="button"
            onClick={() => handleSelectTabFromSidebar('scan')}
            className="w-full flex items-center gap-3 text-left cursor-pointer group"
          >
            <BrandLogo size="md" variant="light" className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-extrabold tracking-tight text-[#0F172A] leading-tight truncate">
                {brand.app_name || 'Perumahan Saung Kebun'}
              </p>
              <p className="text-[11px] font-medium text-slate-500 truncate mt-0.5">
                Portal Petugas Keamanan
              </p>
            </div>
          </button>
        </div>

        {renderPetugasSidebarNav()}

        <div className="mt-auto px-4 pt-3.5 pb-4 border-t border-indigo-100/70 bg-white/40 backdrop-blur-xl space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenProfileFromSidebar}
            className="group w-full p-3 rounded-2xl bg-white/80 hover:bg-gradient-to-r hover:from-indigo-50/95 hover:via-sky-50/90 hover:to-white border border-white/90 hover:border-sky-200/80 shadow-2xs hover:shadow-sm flex items-center gap-3 text-left transition-all duration-200 cursor-pointer"
          >
            <UserAvatar
              name={profil.nama}
              src={effectiveAvatarUrl}
              size="sm"
              className="shrink-0 ring-2 ring-white/80 group-hover:ring-sky-200/80 transition-all"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#0F172A] group-hover:text-[#312E81] truncate leading-tight transition-colors">
                {profil.nama}
              </p>
              <p className="text-[11px] text-slate-500 truncate mt-0.5 leading-tight">
                Keamanan · {effectiveShiftLabel}
              </p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#312E81] group-hover:translate-x-0.5 shrink-0 transition-all duration-200" />
          </button>

          <button
            type="button"
            onClick={handleLogoutFromSidebar}
            className="w-full min-h-[42px] px-3.5 rounded-2xl bg-red-50/90 hover:bg-red-100 text-red-600 border border-red-100 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.98]"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Keluar / Logout</span>
          </button>

          <AppVersionFooter compact className="px-1 pt-0.5" />
        </div>
      </aside>

      {/* SLIDE-OVER GLASS SIDEBAR — MOBILE & TABLET (< lg) */}
      <AnimatePresence>
        {sidebarOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu Sidebar & Profil Petugas"
            className="lg:hidden fixed inset-0 z-[60] flex no-print"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm"
            />

            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-[84vw] max-w-[328px] md:max-w-[360px] h-full glass-sidebar bg-white/75 backdrop-blur-2xl backdrop-saturate-150 rounded-r-3xl border-l border-l-white/20 border-r border-r-white/90 shadow-[inset_1px_0_0_rgba(255,255,255,0.55),0_25px_50px_-12px_rgba(15,23,42,0.35)] flex flex-col overflow-hidden"
            >
              <div className="px-4 pt-[calc(max(env(safe-area-inset-top,0px),18px)+0.75rem)] pb-4 bg-gradient-to-tr from-[#312E81] via-[#3730A3] to-[#0284C7] text-white shrink-0">
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <BrandLogo size="md" variant="dark" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-tight truncate">
                        {brand?.app_name || 'Perumahan Saung Kebun'}
                      </p>
                      <p className="text-[11px] text-sky-100/90 truncate mt-0.5">
                        Portal Petugas Keamanan
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Tutup menu sidebar"
                    className="h-9 w-9 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 text-white flex items-center justify-center transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleOpenProfileFromSidebar}
                  className="group mt-4 w-full text-left p-3 rounded-2xl bg-white/15 hover:bg-gradient-to-r hover:from-white/25 hover:to-sky-200/20 border border-white/20 hover:border-white/35 flex items-center gap-3 transition-all duration-200 cursor-pointer"
                >
                  <UserAvatar
                    name={profil.nama}
                    src={effectiveAvatarUrl}
                    size="md"
                    ringClassName="ring-2 ring-sky-200/70"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white leading-tight truncate">
                      {profil.nama}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-sky-100 truncate">
                      Keamanan · {effectiveShiftLabel}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-sky-100 group-hover:translate-x-0.5 transition-transform shrink-0" />
                </button>
              </div>

              {renderPetugasSidebarNav()}

              <div className="mt-auto px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-indigo-100/80 bg-white/55 backdrop-blur-xl space-y-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleLogoutFromSidebar}
                  className="w-full min-h-[44px] px-4 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 active:scale-[0.98] font-semibold text-sm border border-red-100 inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Keluar / Logout</span>
                </button>
                <AppVersionFooter compact className="px-1" />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Header Tetap & Anti-Geser Khusus Petugas (Offset lg:left-[260px] pada Desktop) */}
      <header className="fixed top-0 left-0 right-0 lg:left-[260px] z-40 h-[calc(4rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] bg-gradient-to-r from-[#312E81]/95 via-[#3730A3]/95 to-[#0284C7]/95 backdrop-blur-xl text-white border-b border-white/15 flex items-center shadow-lg shadow-indigo-950/15">
        <div className="max-w-3xl w-full mx-auto px-3 sm:px-4 flex flex-nowrap items-center justify-between gap-2 min-w-0">
          <div className="flex flex-nowrap items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Buka Menu Sidebar Petugas"
              title="Menu Profil & Navigasi"
              className="lg:hidden h-10 w-10 rounded-xl bg-white/12 hover:bg-white/22 border border-white/20 text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors active:scale-95"
            >
              <Menu className="w-5 h-5" />
            </button>

            <BrandLogo size="xs" variant="dark" className="shrink-0 lg:hidden" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight truncate">
                {profil.nama}
              </p>
              <p className="text-[11px] text-sky-100 font-medium truncate">
                Keamanan · {effectiveShiftLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void loadData(true)}
              aria-label="Muat ulang data petugas"
              className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-sky-100 flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>

            <div className="inline-flex items-center visible opacity-100 shrink-0">
              <NotificationBell
                session={session}
                variant="dark"
                onNavigateTarget={handleNotificationNavigate}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setSidebarOpen(true);
                } else {
                  setProfileModalOpen(true);
                }
              }}
              aria-label="Profil & Menu Petugas"
              title="Profil & Pengaturan Petugas"
              className="p-0.5 rounded-full border border-white/25 bg-white/10 hover:border-sky-200 transition-colors cursor-pointer shrink-0"
            >
              <UserAvatar name={profil.nama} src={effectiveAvatarUrl} size="sm" />
            </button>
          </div>
        </div>
      </header>

      <main className="lg:pl-[260px] pt-[calc(4rem+env(safe-area-inset-top,0px)+1rem)] pb-28 lg:pb-12">
        <div className="max-w-3xl mx-auto px-4 space-y-4">
        {loading && !data ? (
          <ContentLoadingState
            message="Memuat Portal Keamanan..."
            subMessage="Mengambil jadwal shift, titik checkpoint NFC & log patroli"
          />
        ) : (
        <div key={activeTab} className="space-y-4 animate-page-enter">
        {/* Banner Judul Halaman Aktif */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-[#0F172A] leading-tight">
              {TAB_TITLES[activeTab].title}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {TAB_TITLES[activeTab].subtitle}
            </p>
          </div>
          {activeTab !== 'peta' && (
            <button
              type="button"
              onClick={() => handleSelectTab('peta')}
              className="shrink-0 rounded-2xl bg-indigo-50/80 border border-indigo-200/80 px-3 py-1.5 text-right cursor-pointer hover:bg-indigo-100/80 transition-all duration-200 active:scale-[0.97]"
            >
              <p className="text-[10px] font-semibold text-[#4C1D95] leading-none">
                {activeLiveSession?.status === 'active' ? 'LIVE Aktif' : 'Siklus Aktif'}
              </p>
              <p className="text-xs font-mono font-bold text-[#3730A3] tabular-nums mt-0.5">
                {activeCycleProgress.scanned}/{activeCycleProgress.total} Pos
              </p>
            </button>
          )}
        </div>

        {/* KARTU ABSENSI JAGA & FOTO PROFIL — TAB INFO & SHIFT */}
        {activeTab === 'info' && (
          <>
            <PetugasAttendanceCard
              session={session}
              officerName={profil.nama}
              assignedShift={profil.shift}
              onToast={onToast}
            />

            {/* KARTU FOTO PROFIL PETUGAS KEAMANAN */}
            <section
              aria-label="Foto Profil Petugas Keamanan"
              className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5"
            >
              <ProfileAvatarEditor
                session={session}
                avatarUrl={effectiveAvatarUrl}
                subtitle={`Petugas Keamanan · ${effectiveShiftLabel} · @${profil.username}`}
                onAvatarUpdated={handlePetugasAvatarUpdated}
                onToast={onToast}
                compact
              />
            </section>

            {/* KARTU TEMA TAMPILAN (NYAMAN UNTUK PATROLI SIANG / MALAM) */}
            <section
              aria-label="Tema Tampilan Portal Petugas"
              className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5"
            >
              <ThemePicker onToast={onToast} />
            </section>

            {/* KARTU PENGATURAN NOTIFIKASI, SUARA & GETARAN */}
            <section
              aria-label="Pengaturan Notifikasi, Suara & Getaran Petugas"
              className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5"
            >
              <NotificationSettingsCard session={session} onToast={onToast} />
            </section>

            {/* KARTU PENGATURAN MASUK CEPAT BIOMETRIK (FACE ID / SIDIK JARI) */}
            <section
              aria-label="Keamanan Akses Biometrik"
              className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                    isBiometricEnabledForMe
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-indigo-50 text-[#4C1D95] border border-indigo-100'
                  }`}
                >
                  {biometryAvailability?.isFace ? (
                    <ScanFace className="w-5 h-5" />
                  ) : (
                    <Fingerprint className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-[#0F172A]">
                      Masuk Cepat {biometryAvailability?.label || 'Biometrik'}
                    </h2>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        isBiometricEnabledForMe
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-indigo-50 text-[#4C1D95] border border-indigo-100'
                      }`}
                    >
                      {isBiometricEnabledForMe ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    {biometryAvailability?.isAvailable
                      ? isBiometricEnabledForMe
                        ? `Aktif di perangkat ini hingga ${formatTanggal(biometricProfile?.expires_at || '')}. Saat keluar, Anda dapat masuk kembali tanpa mengetik PIN 6 digit.`
                        : `Aktifkan ${biometryAvailability.label} agar tidak perlu mengetik ulang PIN 6 digit setiap kali membuka Portal Keamanan.`
                      : biometryAvailability?.reason ||
                        'Tersedia pada aplikasi Android/iOS atau perangkat dengan sensor Sidik Jari / Face ID aktif.'}
                  </p>
                </div>
              </div>

              {biometryAvailability?.isAvailable && (
                <button
                  type="button"
                  disabled={togglingBiometric}
                  onClick={() => void handleToggleBiometric()}
                  className={`min-h-[42px] px-4 rounded-full text-xs font-bold inline-flex items-center justify-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap disabled:opacity-60 ${
                    isBiometricEnabledForMe
                      ? 'bg-indigo-50/80 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-indigo-100 hover:border-red-200'
                      : 'bg-[#3730A3] hover:bg-[#312E81] text-white shadow-sm'
                  }`}
                >
                  {togglingBiometric ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : biometryAvailability.isFace ? (
                    <ScanFace className="w-4 h-4" />
                  ) : (
                    <Fingerprint className="w-4 h-4" />
                  )}
                  <span>{isBiometricEnabledForMe ? 'Nonaktifkan' : 'Aktifkan Sekarang'}</span>
                </button>
              )}
            </section>

            {/* INFO VERSI & CEK PEMBARUAN MANUAL */}
            <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl px-4 py-3">
              <AppVersionFooter compact />
            </div>
          </>
        )}

        {/* PANEL KONTROL LIVE TRACKING PATROLI RINGKAS (Pada Tab Info & Scan; pada Tab Peta ditempatkan tepat di bawah Peta 3D) */}
        {(activeTab === 'info' || activeTab === 'scan') && (
          <section
            aria-label="Status Patroli Live GPS"
            className={`rounded-3xl p-4 sm:p-5 space-y-3 ${
              activeLiveSession?.status === 'active'
                ? 'glass-hero bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] shadow-xl shadow-indigo-900/15 text-white'
                : 'glass-card bg-white/80 backdrop-blur-xl border border-white/90 text-[#0F172A]'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {activeLiveSession?.status === 'active' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#A7F3D0]">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                      </span>
                      PATROLI LIVE AKTIF DI PETA 3D
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
                      <Navigation className="w-4 h-4 text-[#4C1D95]" />
                      Live Tracking Patroli di Peta 3D
                    </span>
                  )}
                </div>

                {activeLiveSession?.status === 'active' ? (
                  <p className="text-[11px] text-indigo-100/90 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="inline-flex items-center gap-1">
                      <Crosshair className="w-3.5 h-3.5 text-[#A7F3D0]" />
                      GPS Aktif ({gpsAccuracy !== null ? `±${gpsAccuracy}m` : 'mengunci...'})
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <Smartphone className="w-3.5 h-3.5 text-[#A7F3D0]" />
                      {wakeLockActive ? 'Layar Terjaga' : 'Layar Normal'}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Mulai Patroli Live agar posisi &amp; jejak rute Anda tampil real-time di Peta
                    3D Perumahan Saung Kebun.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {activeLiveSession?.status === 'active' ? (
                  <>
                    {watchIdRef.current === null && (
                      <button
                        type="button"
                        onClick={() => {
                          void acquireWakeLock();
                          startGpsWatcherForSession(activeLiveSession);
                          onToast('info', 'Pelacakan GPS live dilanjutkan.');
                        }}
                        className="min-h-[42px] px-3.5 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-[#064E3B] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Crosshair className="w-4 h-4" />
                        <span>Lanjutkan GPS</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={completingLivePatrol}
                      onClick={() => setConfirmFinishOpen(true)}
                      className="min-h-[42px] px-4 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Selesai Patroli</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={startingLivePatrol}
                    onClick={() => void handleStartLivePatrol()}
                    className="w-full sm:w-auto min-h-[44px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-60 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shadow-sm transition-colors"
                  >
                    {startingLivePatrol ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 fill-current" />
                    )}
                    <span>
                      {startingLivePatrol ? 'Mengaktifkan GPS...' : 'Mulai Patroli Live'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {gpsErrorMsg && (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-3 text-xs text-red-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">{gpsErrorMsg}</p>
              </div>
            )}
          </section>
        )}

        {loading && !data ? (
          <div className="space-y-4">
            <div className="h-36 rounded-2xl bg-slate-200/70 animate-pulse" />
            <div className="h-56 rounded-2xl bg-slate-200/70 animate-pulse" />
          </div>
        ) : (
          <>
            {/* TAB 1: INFO & SHIFT */}
            {activeTab === 'info' && (
              <div className="space-y-4">
                {/* Kartu Shift Aktif & Ringkasan Tugas */}
                <section className="glass-hero bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] shadow-xl shadow-indigo-900/15 text-white rounded-3xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-white/10 border border-white/15 text-[#A7F3D0] flex items-center justify-center shrink-0">
                        <Shield className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A7F3D0]">
                          Shift Bertugas Aktif
                        </p>
                        <p className="text-base font-bold text-white truncate mt-0.5">
                          {effectiveShiftLabel}
                        </p>
                        <p className="text-xs text-indigo-100/75 font-mono mt-0.5">
                          @{profil.username} · Perumahan Saung Kebun
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
                      <p className="text-[11px] text-indigo-100/75">Scan Pribadi Hari Ini</p>
                      <p className="text-lg font-mono font-bold text-white tabular-nums mt-0.5">
                        {patroliHariIni.length}{' '}
                        <span className="text-xs font-sans font-normal text-indigo-100/75">kali</span>
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/10 border border-white/15 p-3">
                      <p className="text-[11px] text-indigo-100/75">Progres Peta Shift</p>
                      <p className="text-lg font-mono font-bold text-[#A7F3D0] tabular-nums mt-0.5">
                        {activeCycleProgress.scanned}/{activeCycleProgress.total}{' '}
                        <span className="text-xs font-sans font-normal text-indigo-100/75">titik</span>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCenterScanFabClick}
                      className="min-h-[44px] rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-[#064E3B] text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Radio className="w-4 h-4 shrink-0" />
                      <span>Mulai Scan NFC</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectTab('peta')}
                      className="min-h-[44px] rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <MapIcon className="w-4 h-4 shrink-0 text-[#A7F3D0]" />
                      <span>Buka Peta Patroli</span>
                    </button>
                  </div>
                </section>

                {/* Instruksi Keamanan Hari Ini dari Pengurus */}
                <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5 space-y-3">
                  <h2 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Instruksi Keamanan Hari Ini dari Pengurus</span>
                  </h2>

                  {data && data.instruksiKeamanan.length > 0 ? (
                    <div className="space-y-2.5">
                      {data.instruksiKeamanan.slice(0, 4).map((info) => (
                        <div
                          key={info.id}
                          className="rounded-2xl bg-amber-50/75 border border-amber-200/90 px-3.5 py-3 space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-amber-800">
                            <span className="font-bold">{info.title}</span>
                            <span className="font-mono">{formatTanggalWaktu(info.created_at)}</span>
                          </div>
                          <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
                            {info.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-indigo-50/50 border border-indigo-100/80 px-3.5 py-3 text-xs text-slate-600 leading-relaxed">
                      Belum ada instruksi keamanan khusus hari ini. Lakukan patroli rutin di seluruh
                      titik checkpoint dan laporkan segera bila ada kondisi mencurigakan.
                    </div>
                  )}
                </section>

                {/* Tombol Panggilan Darurat ke Erlangga (Ketua) & Andriansyah (Bendahara) */}
                {emergencyPengurus.length > 0 && (
                  <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5 space-y-3">
                    <div>
                      <h2 className="text-sm font-bold text-[#0F172A]">
                        Panggilan Darurat ke Pengurus
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Hubungi langsung Ketua atau Bendahara lingkungan bila terjadi kondisi darurat.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {emergencyPengurus.map((contact) => {
                        const waText = encodeURIComponent(
                          `[LAPORAN KEAMANAN] Halo ${contact.label}, saya ${profil.nama} (${effectiveShiftLabel}) melaporkan situasi di Perumahan Saung Kebun:`
                        );
                        return (
                          <div
                            key={contact.label}
                            className="rounded-2xl border border-indigo-100/80 bg-indigo-50/50 p-3.5 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#0F172A] truncate">
                                {contact.label}
                              </p>
                              <p className="text-[11px] font-mono text-slate-500 tabular-nums mt-0.5">
                                +{contact.wa}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`https://wa.me/${contact.wa}?text=${waText}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-h-[40px] px-3.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span>WA</span>
                              </a>
                              <a
                                href={`tel:+${contact.wa}`}
                                className="min-h-[40px] px-3.5 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                                <span>Telp</span>
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            )}

            {/* TAB 2: RIWAYAT PATROLI PRIBADI */}
            {activeTab === 'riwayat' && (
              <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-indigo-100/70 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 bg-indigo-50/80 border border-indigo-100/80 rounded-2xl">
                    <button
                      type="button"
                      onClick={() => setRiwayatFilter('hari_ini')}
                      className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        riwayatFilter === 'hari_ini'
                          ? 'bg-[#4C1D95] text-white shadow-xs'
                          : 'text-slate-600 hover:text-[#4C1D95]'
                      }`}
                    >
                      Hari Ini ({patroliHariIni.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRiwayatFilter('semua')}
                      className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        riwayatFilter === 'semua'
                          ? 'bg-[#4C1D95] text-white shadow-xs'
                          : 'text-slate-600 hover:text-[#4C1D95]'
                      }`}
                    >
                      Semua Riwayat ({data?.patroliPribadi.length || 0})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCenterScanFabClick}
                    className="min-h-[36px] px-3.5 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Scan Baru</span>
                  </button>
                </div>

                {displayedRiwayat.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <ClipboardList className="w-8 h-8 text-indigo-300 mx-auto" />
                    <p className="text-sm font-bold text-slate-700">
                      {riwayatFilter === 'hari_ini'
                        ? 'Belum Ada Scan Checkpoint Hari Ini'
                        : 'Belum Ada Riwayat Patroli'}
                    </p>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      Ketuk tombol SCAN NFC di tengah bawah untuk mulai men-tap stiker checkpoint di
                      lapangan.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-indigo-100/60">
                    {displayedRiwayat.map((log) => {
                      const isAman = log.status_kondisi === 'Aman';
                      return (
                        <div
                          key={log.id}
                          className="px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <p className="text-sm font-bold text-[#0F172A]">{log.nama_lokasi}</p>
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                  isAman
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {isAman ? 'Situasi Aman' : 'Ada Catatan'}
                              </span>
                            </div>
                            {log.catatan && (
                              <p className="text-xs text-slate-700 bg-indigo-50/50 border border-indigo-100/80 rounded-xl px-2.5 py-1.5 leading-snug">
                                {log.catatan}
                              </p>
                            )}
                            <p className="text-[11px] text-slate-400">
                              Metode: <span className="font-medium text-slate-600">{log.metode_scan}</span>
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-mono font-bold text-[#0F172A] tabular-nums inline-flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-[#4C1D95]" />
                              {new Date(log.waktu_scan).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              WIB
                            </p>
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                              {formatTanggal(log.waktu_scan)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* TAB 3 (TENGAH FAB): PATROLI & SCAN CHECKPOINT NFC */}
            {activeTab === 'scan' && (
              <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5 space-y-4">
                {/* Pilihan Kondisi & Catatan Sebelum Tap */}
                <div className="space-y-3 rounded-2xl bg-indigo-50/50 border border-indigo-100/80 p-3.5">
                  <div>
                    <p className="text-xs font-semibold text-[#0F172A] mb-1.5">
                      Kondisi Area Patroli
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setStatusKondisi('Aman')}
                        className={`min-h-[44px] rounded-full text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                          statusKondisi === 'Aman'
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                            : 'bg-white/95 border-indigo-100 text-slate-700 hover:bg-indigo-50'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Situasi Aman</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusKondisi('Ada Catatan')}
                        className={`min-h-[44px] rounded-full text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                          statusKondisi === 'Ada Catatan'
                            ? 'bg-amber-600 border-amber-600 text-white shadow-xs'
                            : 'bg-white/95 border-indigo-100 text-slate-700 hover:bg-indigo-50'
                        }`}
                      >
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Ada Catatan</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="catatan-patroli"
                      className="block text-xs font-semibold text-[#0F172A] mb-1"
                    >
                      Catatan Lapangan (Opsional)
                    </label>
                    <input
                      id="catatan-patroli"
                      type="text"
                      value={catatanPatroli}
                      onChange={(e) => setCatatanPatroli(e.target.value)}
                      placeholder="Contoh: PJU Blok B3 mati / gerbang terkunci rapi..."
                      className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                    />
                  </div>
                </div>

                {/* Status Banner Scan NFC (Dikendalikan langsung oleh Tombol Bulat Tengah "Scan NFC") */}
                <div className="space-y-2.5">
                  {submittingPatroli ? (
                    <div
                      role="status"
                      className="rounded-2xl px-3.5 py-3 text-xs font-semibold flex items-center gap-2.5 border bg-indigo-50/80 border-indigo-200 text-[#4C1D95]"
                    >
                      <Loader2 className="w-4 h-4 animate-spin text-[#4C1D95] shrink-0" />
                      <span>Menyimpan log patroli &amp; memperbarui status pin peta...</span>
                    </div>
                  ) : scanningNfc ? (
                    <div
                      role="status"
                      className="rounded-2xl px-3.5 py-3 text-xs font-semibold flex items-start gap-2.5 border bg-emerald-50 border-emerald-200 text-emerald-900"
                    >
                      <span className="relative flex h-4 w-4 mt-0.5 shrink-0 items-center justify-center">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                        <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-400 opacity-60 [animation-delay:250ms]" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-600" />
                      </span>
                      <span className="leading-relaxed">
                        Mode Scan Aktif — Tempelkan stiker NFC ke belakang HP sekarang...
                      </span>
                    </div>
                  ) : nfcStatusText ? (
                    <div
                      role="status"
                      className={`rounded-2xl px-3.5 py-3 text-xs font-medium flex items-start gap-2.5 border ${
                        nfcStatusError
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                      }`}
                    >
                      {nfcStatusError ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      )}
                      <span className="leading-relaxed">{nfcStatusText}</span>
                    </div>
                  ) : (
                    <div className="rounded-2xl px-3.5 py-2.5 text-xs text-slate-600 bg-indigo-50/40 border border-dashed border-indigo-200 flex items-center gap-2">
                      <Radio className="w-4 h-4 text-[#4C1D95] shrink-0" />
                      <span>
                        Ketuk tombol bulat <strong>Scan NFC</strong> di tengah bawah untuk
                        mengaktifkan sensor NFC.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                    <span>
                      {nfcSupported
                        ? 'Web NFC foreground siap (Chrome Android).'
                        : 'Web NFC tidak tersedia di browser ini — gunakan Input Manual Checkpoint.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowManualForm((v) => !v)}
                      className="font-semibold text-[#4C1D95] hover:underline cursor-pointer shrink-0"
                    >
                      {showManualForm ? 'Tutup Input Manual' : 'Input Manual Checkpoint'}
                    </button>
                  </div>

                  {/* Fallback Input Manual Checkpoint (iOS / Laptop / Pengujian Tanpa Crash) */}
                  {showManualForm && (
                    <div className="rounded-2xl border border-indigo-100/80 bg-indigo-50/50 p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#0F172A]">
                          Input Manual Checkpoint (Fallback Non-NFC)
                        </p>
                        {gpsAccuracy !== null && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border bg-emerald-50 text-emerald-800 border-emerald-200 tabular-nums">
                            GPS Aktif (±{gpsAccuracy}m)
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <select
                          value={selectedTitikId}
                          onChange={(e) => setSelectedTitikId(e.target.value)}
                          className="sm:col-span-5 min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3 text-xs sm:text-sm text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                        >
                          {(data?.titikPatroli || [])
                            .filter((t) => t.aktif !== false)
                            .map((titik, idx) => (
                              <option key={titik.id} value={titik.id}>
                                Pos {idx + 1} — {titik.nama_lokasi}
                              </option>
                            ))}
                        </select>
                        <input
                          type="text"
                          value={manualUidInput}
                          onChange={(e) => setManualUidInput(normalizeNfcUid(e.target.value))}
                          placeholder="UID NFC (opsional)"
                          className="sm:col-span-3 min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3 text-xs font-mono text-[#0F172A] placeholder:font-sans placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                        />
                        <button
                          type="button"
                          disabled={submittingPatroli || (!selectedTitikId && !manualUidInput.trim())}
                          onClick={() => void handleManualFallbackVerify()}
                          className="sm:col-span-4 min-h-[44px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-60 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                        >
                          <MapPin className="w-4 h-4 shrink-0 text-[#A7F3D0]" />
                          <span>Catat Checkpoint</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Ringkasan Cepat 3 Scan Terakhir & Tautan ke Peta */}
                <div className="pt-3 border-t border-indigo-100/70 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-600">
                    Scan hari ini:{' '}
                    <strong className="font-mono text-[#0F172A]">{patroliHariIni.length}</strong>{' '}
                    checkpoint
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSelectTab('peta')}
                    className="text-xs font-bold text-[#4C1D95] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    <span>Cek Status Pin di Peta</span>
                  </button>
                </div>
              </section>
            )}

            {/* TAB 4: HONOR & LEMBUR PRIBADI (TERISOLASI KETAT, READ-ONLY) */}
            {activeTab === 'honor' && (
              <PetugasHonorTab
                session={session}
                officerName={profil.nama}
                riwayatHonor={data?.riwayatHonor || []}
                onOpenKwitansi={setSelectedHonorTrx}
                onToast={onToast}
              />
            )}

            {/* TAB 5: PETA 3D PATROLI LIVE TRACKING REAL-TIME */}
            {activeTab === 'peta' && data && (
              <div className="space-y-3.5">
                <PatrolInteractiveMap
                  mode="petugas"
                  titikList={data.titikPatroli}
                  patroliLogs={data.patroliCycleLogs}
                  patrolMapConfig={data.patrolMapConfig}
                  liveSession={activeLiveSession}
                  canResetCycle={true}
                  onResetCycle={handleResetCycle}
                  resettingCycle={resettingCycle}
                />

                {/* KONTROL LIVE TRACKING PATROLI TEPAT DI BAWAH PETA 3D */}
                <section
                  aria-label="Kontrol Patroli Live di Bawah Peta 3D"
                  className={`rounded-3xl p-4 sm:p-5 space-y-3 ${
                    activeLiveSession?.status === 'active'
                      ? 'glass-hero bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] shadow-xl shadow-indigo-900/15 text-white'
                      : 'glass-card bg-white/80 backdrop-blur-xl border border-white/90 text-[#0F172A]'
                  }`}
                >
                  {activeLiveSession?.status === 'active' ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#A7F3D0]">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                            </span>
                            PATROLI LIVE SEDANG BERLANGSUNG
                          </span>
                          <p className="text-xs font-mono text-indigo-100/95 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="inline-flex items-center gap-1">
                              <Crosshair className="w-3.5 h-3.5 text-[#A7F3D0]" />
                              GPS Aktif ({gpsAccuracy !== null ? `±${gpsAccuracy}m` : 'mencari...'})
                            </span>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1">
                              <Smartphone className="w-3.5 h-3.5 text-[#A7F3D0]" />
                              {wakeLockActive ? 'Layar Terjaga' : 'Layar Normal'}
                            </span>
                          </p>
                        </div>

                        {watchIdRef.current === null && (
                          <button
                            type="button"
                            onClick={() => {
                              void acquireWakeLock();
                              startGpsWatcherForSession(activeLiveSession);
                              onToast('info', 'Pelacakan GPS live dilanjutkan.');
                            }}
                            className="min-h-[38px] px-3.5 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-[#064E3B] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            <Crosshair className="w-3.5 h-3.5" />
                            <span>Lanjutkan GPS</span>
                          </button>
                        )}
                      </div>

                      {calibratedCount < 2 && (
                        <p className="text-[11px] text-indigo-100/90 bg-white/10 border border-white/15 rounded-2xl px-3 py-2 leading-relaxed">
                          Kalibrasi GPS pos saat ini ({calibratedCount} pos). Posisi Anda akan
                          otomatis berpindah mengikuti Pos yang terakhir di-scan NFC hingga Pengurus
                          mengunci minimal 2 pos di Pengaturan &gt; Petugas.
                        </p>
                      )}

                      <button
                        type="button"
                        disabled={completingLivePatrol}
                        onClick={() => setConfirmFinishOpen(true)}
                        className="w-full min-h-[48px] rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span>Selesai Patroli</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-[#0F172A] flex items-center gap-1.5">
                          <Navigation className="w-4 h-4 text-[#4C1D95]" />
                          <span>Live Tracking Patroli Real-Time</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          Aktifkan pelacakan GPS &amp; jaga layar tetap menyala agar posisi dan
                          jejak rute Anda muncul langsung di atas Peta 3D.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={startingLivePatrol}
                        onClick={() => void handleStartLivePatrol()}
                        className="w-full min-h-[50px] rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-60 text-white text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md shadow-indigo-900/20 cursor-pointer transition-colors"
                      >
                        {startingLivePatrol ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Play className="w-5 h-5 fill-current" />
                        )}
                        <span>
                          {startingLivePatrol ? 'Mengaktifkan GPS...' : 'Mulai Patroli Live'}
                        </span>
                      </button>
                    </>
                  )}

                  {gpsErrorMsg && (
                    <div className="rounded-2xl bg-red-50 border border-red-200 p-3 text-xs text-red-900 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <p className="leading-relaxed">{gpsErrorMsg}</p>
                    </div>
                  )}
                </section>

                <button
                  type="button"
                  onClick={handleCenterScanFabClick}
                  className="w-full min-h-[48px] rounded-full bg-[#4C1D95] hover:bg-[#3b0764] text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors"
                >
                  <Radio className="w-4 h-4 text-[#A7F3D0]" />
                  <span>Scan Checkpoint NFC Sekarang</span>
                </button>
              </div>
            )}
          </>
        )}
        </div>
        )}
        </div>
      </main>

      {/* 7. DUAL-RING FLOATING ORB DOCK — MOBILE & TABLET (< lg, Maksimal 5 Ikon) */}
      <nav
        aria-label="Navigasi Bawah Floating Orb Dock Petugas"
        className="lg:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-4 max-w-md mx-auto rounded-full bg-white/80 backdrop-blur-2xl border border-white/90 shadow-[0_14px_38px_-8px_rgba(49,46,129,0.22),0_4px_14px_-2px_rgba(2,132,199,0.16)] px-3 sm:px-4 py-2 grid grid-cols-5 items-center z-40 no-print"
      >
        {/* 1. Pos Jaga / Info & Shift */}
        <button
          type="button"
          onClick={() => handleSelectTab('info')}
          className={`relative flex flex-col items-center justify-center py-0.5 px-0.5 transition-all duration-150 active:scale-[0.94] cursor-pointer min-w-0 ${
            activeTab === 'info' ? 'text-[#312E81]' : 'text-slate-500 hover:text-[#312E81]'
          }`}
        >
          <Shield
            className={`w-[20px] h-[20px] transition-transform duration-150 ${
              activeTab === 'info' ? 'scale-105' : ''
            }`}
            strokeWidth={activeTab === 'info' ? 2.4 : 1.9}
          />
          <span
            className={`text-[10px] mt-1 leading-none truncate max-w-full ${
              activeTab === 'info' ? 'font-bold text-[#312E81]' : 'font-medium text-slate-600'
            }`}
          >
            Pos Jaga
          </span>
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full mt-1 transition-all duration-200 ${
              activeTab === 'info'
                ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)] opacity-100 scale-100'
                : 'bg-transparent opacity-0 scale-0'
            }`}
          />
        </button>

        {/* 2. Patroli / Riwayat */}
        <button
          type="button"
          onClick={() => handleSelectTab('riwayat')}
          className={`relative flex flex-col items-center justify-center py-0.5 px-0.5 transition-all duration-150 active:scale-[0.94] cursor-pointer min-w-0 ${
            activeTab === 'riwayat' ? 'text-[#312E81]' : 'text-slate-500 hover:text-[#312E81]'
          }`}
        >
          <ClipboardList
            className={`w-[20px] h-[20px] transition-transform duration-150 ${
              activeTab === 'riwayat' ? 'scale-105' : ''
            }`}
            strokeWidth={activeTab === 'riwayat' ? 2.4 : 1.9}
          />
          <span
            className={`text-[10px] mt-1 leading-none truncate max-w-full ${
              activeTab === 'riwayat' ? 'font-bold text-[#312E81]' : 'font-medium text-slate-600'
            }`}
          >
            Patroli
          </span>
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full mt-1 transition-all duration-200 ${
              activeTab === 'riwayat'
                ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)] opacity-100 scale-100'
                : 'bg-transparent opacity-0 scale-0'
            }`}
          />
        </button>

        {/* 3. CENTER DUAL-RING FLOATING ORB: PEMICU SCAN WEB NFC */}
        <div className="flex flex-col items-center justify-center relative">
          <button
            type="button"
            disabled={submittingPatroli}
            onClick={handleCenterScanFabClick}
            aria-label={
              scanningNfc
                ? 'Hentikan Mode Scan NFC Patroli'
                : 'Aktifkan Scan NFC Checkpoint Patroli'
            }
            aria-pressed={scanningNfc}
            className={`w-16 h-16 -mt-8 rounded-full text-white shadow-xl flex flex-col items-center justify-center gap-0.5 ring-4 ring-white/90 relative cursor-pointer transition-all duration-200 active:scale-95 disabled:opacity-70 before:content-[''] before:absolute before:-inset-1.5 before:rounded-full before:border before:-z-10 ${
              scanningNfc
                ? 'bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-emerald-500/40 scale-[1.06] before:border-emerald-400/50 before:bg-emerald-400/15'
                : activeTab === 'scan'
                  ? 'bg-gradient-to-tr from-[#312E81] to-[#0284C7] shadow-sky-500/35 scale-[1.04] before:border-sky-400/40 before:bg-sky-400/10'
                  : 'bg-gradient-to-tr from-[#312E81] to-[#0284C7] shadow-sky-900/25 hover:scale-[1.02] before:border-sky-400/40 before:bg-sky-400/10'
            }`}
          >
            {scanningNfc && (
              <>
                <span
                  aria-hidden="true"
                  className="absolute -inset-2 rounded-full bg-emerald-400/40 animate-ping pointer-events-none"
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-full bg-emerald-300/35 animate-ping [animation-delay:300ms] pointer-events-none"
                />
              </>
            )}
            {submittingPatroli ? (
              <Loader2 className="w-6 h-6 relative z-10 animate-spin shrink-0" />
            ) : (
              <Radio
                className={`w-6 h-6 relative z-10 shrink-0 ${scanningNfc ? 'animate-pulse' : ''}`}
                strokeWidth={2.4}
              />
            )}
            <span className="text-[9px] font-bold tracking-wide leading-none text-sky-50 relative z-10">
              {submittingPatroli ? 'Simpan' : scanningNfc ? 'Aktif' : 'Scan'}
            </span>
          </button>
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-all duration-200 ${
              activeTab === 'scan' || scanningNfc
                ? scanningNfc
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.95)] opacity-100 scale-100'
                  : 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)] opacity-100 scale-100'
                : 'bg-transparent opacity-0 scale-0'
            }`}
          />
        </div>

        {/* 4. Honor & Lembur */}
        <button
          type="button"
          onClick={() => handleSelectTab('honor')}
          className={`relative flex flex-col items-center justify-center py-0.5 px-0.5 transition-all duration-150 active:scale-[0.94] cursor-pointer min-w-0 ${
            activeTab === 'honor' ? 'text-[#312E81]' : 'text-slate-500 hover:text-[#312E81]'
          }`}
        >
          <Wallet
            className={`w-[20px] h-[20px] transition-transform duration-150 ${
              activeTab === 'honor' ? 'scale-105' : ''
            }`}
            strokeWidth={activeTab === 'honor' ? 2.4 : 1.9}
          />
          <span
            className={`text-[10px] mt-1 leading-none truncate max-w-full ${
              activeTab === 'honor' ? 'font-bold text-[#312E81]' : 'font-medium text-slate-600'
            }`}
          >
            Honor
          </span>
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full mt-1 transition-all duration-200 ${
              activeTab === 'honor'
                ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)] opacity-100 scale-100'
                : 'bg-transparent opacity-0 scale-0'
            }`}
          />
        </button>

        {/* 5. Peta Patroli */}
        <button
          type="button"
          onClick={() => handleSelectTab('peta')}
          className={`relative flex flex-col items-center justify-center py-0.5 px-0.5 transition-all duration-150 active:scale-[0.94] cursor-pointer min-w-0 ${
            activeTab === 'peta' ? 'text-[#312E81]' : 'text-slate-500 hover:text-[#312E81]'
          }`}
        >
          <MapIcon
            className={`w-[20px] h-[20px] transition-transform duration-150 ${
              activeTab === 'peta' ? 'scale-105' : ''
            }`}
            strokeWidth={activeTab === 'peta' ? 2.4 : 1.9}
          />
          <span
            className={`text-[10px] mt-1 leading-none truncate max-w-full ${
              activeTab === 'peta' ? 'font-bold text-[#312E81]' : 'font-medium text-slate-600'
            }`}
          >
            Peta
          </span>
          <span
            aria-hidden="true"
            className={`w-1.5 h-1.5 rounded-full mt-1 transition-all duration-200 ${
              activeTab === 'peta'
                ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)] opacity-100 scale-100'
                : 'bg-transparent opacity-0 scale-0'
            }`}
          />
        </button>
      </nav>

      {selectedHonorTrx && (
        <KwitansiDigitalModal
          mode="kas"
          trxKas={selectedHonorTrx}
          onClose={() => setSelectedHonorTrx(null)}
        />
      )}

      {/* Modal Profil & Tema Petugas (Dibuka saat ketuk Avatar di Header) */}
      {profileModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pengaturan Profil dan Tema Petugas"
          onClick={() => setProfileModalOpen(false)}
          className="fixed inset-0 z-[65] bg-slate-950/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white/95 backdrop-blur-xl w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-white/90 p-5 space-y-5 shadow-2xl animate-modal-pop"
          >
            <div className="sm:hidden mx-auto w-10 h-1 rounded-full bg-indigo-200" aria-hidden="true" />
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-indigo-100/70">
              <div>
                <h2 className="text-base font-bold text-[#0F172A]">Profil &amp; Tema Petugas</h2>
                <p className="text-xs text-slate-500">
                  Ubah foto profil atau pilih tema tampilan (termasuk Midnight untuk patroli malam).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                aria-label="Tutup modal profil dan tema"
                className="w-9 h-9 rounded-full text-slate-400 hover:text-[#4C1D95] hover:bg-indigo-50 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <ProfileAvatarEditor
              session={session}
              avatarUrl={effectiveAvatarUrl}
              subtitle={`${effectiveShiftLabel} · @${profil.username}`}
              onAvatarUpdated={handlePetugasAvatarUpdated}
              onToast={onToast}
              compact
            />

            <div className="pt-4 border-t border-indigo-100/70">
              <ThemePicker compact onToast={onToast} />
            </div>

            <div className="pt-4 border-t border-indigo-100/70">
              <NotificationSettingsCard session={session} compact onToast={onToast} />
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Selesai Patroli Live */}
      {confirmFinishOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Selesai Patroli"
          className="fixed inset-0 z-[60] bg-slate-950/55 backdrop-blur-md flex items-center justify-center p-4 animate-modal-backdrop"
        >
          <div className="bg-white/95 backdrop-blur-xl w-full max-w-sm rounded-3xl border border-white/90 p-5 space-y-4 shadow-2xl animate-modal-pop">
            <div className="space-y-1.5">
              <h2 className="text-base font-bold text-[#0F172A]">Selesaikan Patroli Live?</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Pelacakan GPS dan penguncian layar akan dihentikan, lalu sesi patroli Anda (
                <strong className="font-mono text-[#0F172A]">
                  {activeCycleProgress.scanned}/{activeCycleProgress.total} Pos
                </strong>
                ) akan ditutup dengan status selesai.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={completingLivePatrol}
                onClick={() => setConfirmFinishOpen(false)}
                className="min-h-[40px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-bold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={completingLivePatrol}
                aria-busy={completingLivePatrol}
                onClick={() => void handleConfirmFinishLivePatrol()}
                className="min-h-[40px] px-4 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {completingLivePatrol && <LoadingSpinner size="xs" tone="white" />}
                <span>{completingLivePatrol ? 'Menyelesaikan...' : 'Ya, Selesai Patroli'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
