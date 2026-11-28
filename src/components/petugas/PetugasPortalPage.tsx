import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Crosshair,
  Loader2,
  Map as MapIcon,
  MapPin,
  Menu,
  Navigation,
  PhoneCall,
  Play,
  Radio,
  ScanFace,
  Shield,
  ShieldAlert,
  Smartphone,
  Square,
  Wallet,
  X,
} from 'lucide-react';
import { Icon3D, type Icon3DName } from '../Icon3D';
import { Navbar3D } from '../Navbar3D';
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
import { BrandLogo, SaungKebunWatermark } from '../BrandLogo';
import bgHeaderAsset from '../../assets/bg-header.jpg';
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
import { FloatingChatWidget } from '../FloatingChatWidget';
import {
  fetchChatUnreadSummary,
  subscribeChatMessagesRealtime,
  type ChatRoomId,
} from '../../lib/chatService';

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
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [chatInitialRoomId, setChatInitialRoomId] = useState<ChatRoomId | null>(null);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
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
    if (targetUrl.startsWith('chat:')) {
      const roomId = targetUrl.slice('chat:'.length) as ChatRoomId;
      if (roomId) setChatInitialRoomId(roomId);
      setChatModalOpen(true);
      return;
    }
    if (targetUrl.startsWith('tab:')) {
      const targetTab = targetUrl.replace('tab:', '');
      if (targetTab === 'chat') {
        setChatModalOpen(true);
      } else if (targetTab === 'keamanan') {
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

  useEffect(() => {
    let active = true;
    const syncChatUnread = async () => {
      const summary = await fetchChatUnreadSummary(session);
      if (active) {
        setUnreadChatCount(summary.totalUnread);
      }
    };
    void syncChatUnread();
    const unsub = subscribeChatMessagesRealtime(session, {
      onAnyChange: () => {
        void syncChatUnread();
      },
    });
    return () => {
      active = false;
      unsub();
    };
  }, [session]);

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
    icon3d?: Icon3DName;
  }> = [
    { id: 'info', label: 'Pos Jaga & Shift', subtitle: 'Absensi & darurat', icon: Shield, icon3d: 'keamanan' },
    { id: 'riwayat', label: 'Riwayat Patroli', subtitle: 'Log checkpoint Anda', icon: ClipboardList, icon3d: 'rekap' },
    { id: 'scan', label: 'Scan NFC / Patroli', subtitle: 'Checkpoint RFID/NFC', icon: Radio, icon3d: 'scan_nfc' },
    { id: 'honor', label: 'Honor & Lembur', subtitle: 'Termin & uang lembur', icon: Wallet },
    { id: 'peta', label: 'Peta Patroli', subtitle: 'Status titik live', icon: MapIcon },
  ];

  const renderPetugasSidebarNav = () => (
    <div className="flex-1 overflow-y-auto px-4 md:px-5 lg:px-4 py-5 md:py-6 lg:py-5 space-y-6 md:space-y-7 lg:space-y-6">
      <div className="space-y-1.5 md:space-y-2 lg:space-y-1.5">
        <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#6E786D]">
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
                  ? 'bg-[#E5EEE3] text-[#243825] font-bold border border-[#C6D2BF] shadow-2xs'
                  : 'text-[#4A554A] font-medium hover:bg-[#F7F4EC] hover:text-[#1B271B] border border-transparent hover:border-[#E6E2D6]'
              }`}
            >
              {item.icon3d ? (
                <Icon3D
                  name={item.icon3d}
                  className={`w-9 h-9 rounded-xl shadow-xs transition-transform ${
                    isActive ? 'scale-105 ring-2 ring-[#2B3F29]/25' : ''
                  }`}
                />
              ) : (
                <span
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                      : 'bg-[#F7F4EC] text-[#4A554A]'
                  }`}
                >
                  <Icon className="w-[18px] h-[18px]" strokeWidth={isActive ? 2.4 : 2} />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight">{item.label}</p>
                <p className="text-[11px] text-[#6E786D] font-normal truncate mt-0.5">
                  {item.subtitle}
                </p>
              </div>
              {item.id === 'scan' && scanningNfc && (
                <span className="px-2 py-0.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] text-[10px] font-bold shrink-0">
                  Aktif
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5 md:space-y-2 lg:space-y-1.5">
        <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.08em] text-[#6E786D]">
          Komunikasi &amp; Profil
        </p>
        <button
          type="button"
          onClick={() => {
            setSidebarOpen(false);
            setChatModalOpen(true);
          }}
          className={`w-full min-h-[46px] md:min-h-[50px] lg:min-h-[46px] px-3.5 md:px-4 lg:px-3.5 py-2.5 md:py-3 lg:py-2.5 rounded-2xl text-left flex items-center gap-3.5 text-[13.5px] md:text-sm leading-snug transition-all duration-200 cursor-pointer ${
            chatModalOpen
              ? 'bg-[#E5EEE3] text-[#243825] font-bold border border-[#C6D2BF] shadow-2xs'
              : 'text-[#4A554A] font-medium hover:bg-[#F7F4EC] hover:text-[#1B271B] border border-transparent hover:border-[#E6E2D6]'
          }`}
        >
          <Icon3D name="chat_cepat" className="w-9 h-9 rounded-xl shadow-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate leading-tight">Chat Cepat Lingkungan</p>
            <p className="text-[11px] text-[#6E786D] font-normal truncate mt-0.5">
              DM &amp; Group (Pengurus · Warga)
            </p>
          </div>
          {unreadChatCount > 0 && !chatModalOpen && (
            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#C87058] text-[#FFFDF8] tabular-nums shrink-0">
              {unreadChatCount > 99 ? '99+' : unreadChatCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={handleOpenProfileFromSidebar}
          className="w-full min-h-[46px] md:min-h-[50px] lg:min-h-[46px] px-3.5 md:px-4 lg:px-3.5 py-2.5 md:py-3 lg:py-2.5 rounded-2xl text-left flex items-center gap-3.5 text-[13.5px] md:text-sm leading-snug font-medium text-[#4A554A] hover:bg-[#F7F4EC] hover:text-[#1B271B] border border-transparent hover:border-[#E6E2D6] transition-all duration-200 cursor-pointer"
        >
          <Icon3D name="profil" className="w-9 h-9 shrink-0 shadow-xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate leading-tight">Profil &amp; Tema Petugas</p>
            <p className="text-[11px] text-[#6E786D] font-normal truncate mt-0.5">
              Foto, Tema, Notifikasi &amp; Biometrik
            </p>
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] glass-canvas bg-[#F6F3EA] text-[#1B271B] overflow-x-hidden">
      {/* SIDEBAR TETAP — DESKTOP (lg+, lebar 260px) */}
      <aside
        aria-label="Navigasi Sidebar Portal Keamanan"
        className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-[260px] z-30 glass-sidebar-panel border-r border-white/25 shadow-[8px_0_32px_-12px_rgba(20,32,21,0.18)] no-print"
      >
        <div className="relative overflow-hidden px-4 pt-5 pb-4 glass-header-green border-b border-white/15 text-[#FFFDF8] shrink-0">
          <SaungKebunWatermark className="absolute -right-6 -bottom-4 w-32 h-24" tone="cream" />
          <button
            type="button"
            onClick={() => handleSelectTabFromSidebar('scan')}
            className="relative z-10 w-full flex items-center gap-3 text-left cursor-pointer group"
          >
            <BrandLogo size="md" variant="dark" srcOverride={null} className="shrink-0" />
            <div className="min-w-0">
              <p className="font-serif-brand text-sm font-bold tracking-tight text-[#FFFDF8] leading-tight truncate">
                {brand.app_name || 'Perumahan Saung Kebun'}
              </p>
              <p className="text-[11px] font-medium text-[#E5EEE3]/85 truncate mt-0.5">
                Portal Petugas Keamanan
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleOpenProfileFromSidebar}
            className="relative z-10 group mt-3.5 w-full p-2.5 rounded-2xl glass-profile-card bg-white/15 hover:bg-white/22 backdrop-blur-md border border-white/25 shadow-md flex items-center gap-2.5 text-left transition-all duration-200 cursor-pointer"
          >
            <UserAvatar
              name={profil.nama}
              src={effectiveAvatarUrl}
              size="sm"
              className="shrink-0 ring-2 ring-[#E5EEE3]/60 transition-all"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#FFFDF8] truncate leading-tight transition-colors">
                {profil.nama}
              </p>
              <p className="text-[11px] text-[#E5EEE3]/85 truncate mt-0.5 leading-tight">
                Keamanan · {effectiveShiftLabel}
              </p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[#E5EEE3]/80 group-hover:translate-x-0.5 shrink-0 transition-all duration-200" />
          </button>
        </div>

        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          <SaungKebunWatermark
            tone="moss"
            className="inset-x-0 bottom-6 mx-auto w-44 h-60 opacity-[0.06]"
          />
          <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
            {renderPetugasSidebarNav()}
          </div>
        </div>

        <div className="relative z-10 mt-auto px-4 pt-3.5 pb-4 border-t border-white/25 glass-sidebar-footer space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={handleLogoutFromSidebar}
            className="w-full min-h-[42px] px-3.5 rounded-2xl bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#7A311E] border border-[#E2A898] text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.98]"
          >
            <Icon3D name="keluar" className="w-5 h-5 rounded-md shadow-2xs" />
            <span>Keluar / Logout</span>
          </button>

          <AppVersionFooter compact className="px-1 pt-0.5" />
        </div>
      </aside>

      {/* SLIDE-OVER SIDEBAR — MOBILE & TABLET (< lg) */}
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
              className="fixed inset-0 bg-[#1B271B]/50 backdrop-blur-sm"
            />

            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-[84vw] max-w-[328px] md:max-w-[360px] h-full glass-sidebar-panel rounded-r-3xl border-r border-white/25 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="relative overflow-hidden px-4 pt-[calc(max(env(safe-area-inset-top,0px),18px)+0.75rem)] pb-4 glass-header-green border-b border-white/15 text-[#FFFDF8] shrink-0">
                <SaungKebunWatermark className="absolute -right-4 -bottom-4 w-28 h-36" tone="cream" />
                <div className="relative z-10 flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <BrandLogo size="md" variant="dark" srcOverride={null} className="shrink-0" />
                    <div className="min-w-0">
                      <p className="font-serif-brand text-sm font-bold text-[#FFFDF8] leading-tight truncate">
                        {brand?.app_name || 'Perumahan Saung Kebun'}
                      </p>
                      <p className="text-[11px] text-[#E5EEE3]/85 truncate mt-0.5">
                        Portal Petugas Keamanan
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Tutup menu sidebar"
                    className="h-9 w-9 rounded-xl bg-[#FFFDF8]/15 hover:bg-[#FFFDF8]/25 active:scale-95 text-[#FFFDF8] flex items-center justify-center transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleOpenProfileFromSidebar}
                  className="relative z-10 group mt-4 w-full text-left p-3 rounded-2xl glass-profile-card bg-white/15 hover:bg-white/22 backdrop-blur-md border border-white/25 shadow-md flex items-center gap-3 transition-all duration-200 cursor-pointer"
                >
                  <UserAvatar
                    name={profil.nama}
                    src={effectiveAvatarUrl}
                    size="md"
                    ringClassName="ring-2 ring-[#E5EEE3]/70"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#FFFDF8] leading-tight truncate">
                      {profil.nama}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-[#E5EEE3]/90 truncate">
                      Keamanan · {effectiveShiftLabel}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#E5EEE3] group-hover:translate-x-0.5 transition-transform shrink-0" />
                </button>
              </div>

              <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                <SaungKebunWatermark
                  tone="moss"
                  className="inset-x-0 bottom-6 mx-auto w-44 h-60 opacity-[0.06]"
                />
                <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
                  {renderPetugasSidebarNav()}
                </div>
              </div>

              <div className="relative z-10 mt-auto px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/25 glass-sidebar-footer space-y-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleLogoutFromSidebar}
                  className="w-full min-h-[44px] px-4 rounded-2xl bg-[#C87058]/10 text-[#7A311E] hover:bg-[#C87058]/20 active:scale-[0.98] font-semibold text-sm border border-[#E2A898] inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Icon3D name="keluar" className="w-5 h-5 rounded-md shadow-2xs" />
                  <span>Keluar / Logout</span>
                </button>
                <AppVersionFooter compact className="px-1" />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Header Tetap & Anti-Geser Frosted Glass Khusus Petugas (Offset lg:left-[260px] pada Desktop) */}
      <header className="fixed top-0 left-0 right-0 lg:left-[260px] z-40 h-[calc(4.85rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] glass-header-green text-[#FFFDF8] border-b border-white/15 flex items-center shadow-lg">
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
          <img
            src={bgHeaderAsset}
            alt=""
            className="w-full h-full object-cover object-center opacity-35"
          />
          <div className="absolute inset-0 bg-[#243825]/78 backdrop-blur-md" />
        </div>
        <div className="relative z-10 max-w-3xl w-full mx-auto px-3 sm:px-4 flex flex-nowrap items-center justify-between gap-2 min-w-0">
          <div className="flex flex-nowrap items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Buka Menu Sidebar Petugas"
              title="Menu Profil & Navigasi"
              className="lg:hidden h-10 w-10 rounded-xl bg-[#FFFDF8]/12 hover:bg-[#FFFDF8]/22 border border-[#FFFDF8]/20 text-[#FFFDF8] flex items-center justify-center cursor-pointer shrink-0 transition-colors active:scale-95"
            >
              <Menu className="w-5 h-5" />
            </button>

            <BrandLogo size="sm" variant="dark" srcOverride={null} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#FFFDF8] leading-tight truncate">
                {profil.nama}
              </p>
              <p className="text-[11px] text-[#E5EEE3]/85 font-medium truncate">
                Keamanan · {effectiveShiftLabel}
              </p>
            </div>
          </div>

          <div className="flex flex-nowrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void loadData(true)}
              aria-label="Muat ulang data petugas"
              className="h-10 w-10 rounded-full bg-[#FFFDF8]/10 hover:bg-[#FFFDF8]/20 border border-[#FFFDF8]/15 text-[#E5EEE3] flex items-center justify-center cursor-pointer shrink-0 transition-colors"
            >
              <Icon3D name="refresh" className={`w-4 h-4 rounded-sm ${refreshing ? 'animate-spin' : ''}`} />
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
              className="p-0.5 rounded-full border border-[#FFFDF8]/25 bg-[#FFFDF8]/10 hover:border-[#E5EEE3] transition-colors cursor-pointer shrink-0"
            >
              <UserAvatar name={profil.nama} src={effectiveAvatarUrl} size="sm" />
            </button>
          </div>
        </div>
      </header>

      <main className="lg:pl-[260px] pt-[calc(4.85rem+env(safe-area-inset-top,0px)+0.5rem)] pb-[calc(8rem+env(safe-area-inset-bottom,0px))] lg:pb-12 w-full max-w-full min-w-0 overflow-x-hidden">
        <div className="max-w-3xl mx-auto px-3 py-3 sm:px-4 space-y-4 w-full min-w-0">
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
            <h1 className="font-serif-brand text-base sm:text-lg font-bold text-[#1B271B] leading-tight">
              {TAB_TITLES[activeTab].title}
            </h1>
            <p className="text-xs text-[#6E786D] mt-0.5 truncate">
              {TAB_TITLES[activeTab].subtitle}
            </p>
          </div>
          {activeTab !== 'peta' && (
            <button
              type="button"
              onClick={() => handleSelectTab('peta')}
              className="shrink-0 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] px-3 py-1.5 text-right cursor-pointer hover:bg-[#D6E4D3] transition-all duration-200 active:scale-[0.97]"
            >
              <p className="text-[10px] font-semibold text-[#243825] leading-none">
                {activeLiveSession?.status === 'active' ? 'LIVE Aktif' : 'Siklus Aktif'}
              </p>
              <p className="text-xs font-mono font-bold text-[#2B3F29] tabular-nums mt-0.5">
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
              className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 shadow-xs"
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
              className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 shadow-xs"
            >
              <ThemePicker onToast={onToast} />
            </section>

            {/* KARTU PENGATURAN NOTIFIKASI, SUARA & GETARAN */}
            <section
              aria-label="Pengaturan Notifikasi, Suara & Getaran Petugas"
              className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 shadow-xs"
            >
              <NotificationSettingsCard session={session} onToast={onToast} />
            </section>

            {/* KARTU PENGATURAN MASUK CEPAT BIOMETRIK (FACE ID / SIDIK JARI) */}
            <section
              aria-label="Keamanan Akses Biometrik"
              className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
            >
              <div className="flex items-start gap-3 min-w-0">
                {biometryAvailability?.isFace ? (
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                      isBiometricEnabledForMe
                        ? 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                        : 'bg-[#F7F4EC] text-[#2B3F29] border-[#E6E2D6]'
                    }`}
                  >
                    <ScanFace className="w-5 h-5" />
                  </div>
                ) : (
                  <Icon3D name="sidik_jari" className="w-10 h-10 rounded-2xl shadow-xs" />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-[#1B271B]">
                      Masuk Cepat {biometryAvailability?.label || 'Biometrik'}
                    </h2>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
                        isBiometricEnabledForMe
                          ? 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                          : 'bg-[#F7F4EC] text-[#4A554A] border-[#E6E2D6]'
                      }`}
                    >
                      {isBiometricEnabledForMe ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="text-xs text-[#6E786D] mt-0.5 leading-relaxed">
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
                      ? 'bg-[#F7F4EC] hover:bg-[#C87058]/15 text-[#4A554A] hover:text-[#7A311E] border border-[#E6E2D6] hover:border-[#E2A898]'
                      : 'bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] shadow-sm'
                  }`}
                >
                  {togglingBiometric ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : biometryAvailability.isFace ? (
                    <ScanFace className="w-4 h-4" />
                  ) : (
                    <Icon3D name="sidik_jari" className="w-5 h-5 rounded-md shadow-2xs" />
                  )}
                  <span>{isBiometricEnabledForMe ? 'Nonaktifkan' : 'Aktifkan Sekarang'}</span>
                </button>
              )}
            </section>

            {/* INFO VERSI & CEK PEMBARUAN MANUAL */}
            <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl px-4 py-3 shadow-xs">
              <AppVersionFooter compact />
            </div>
          </>
        )}

        {/* PANEL KONTROL LIVE TRACKING PATROLI RINGKAS */}
        {(activeTab === 'info' || activeTab === 'scan') && (
          <section
            aria-label="Status Patroli Live GPS"
            className={`rounded-3xl p-4 sm:p-5 space-y-3 relative overflow-hidden ${
              activeLiveSession?.status === 'active'
                ? 'glass-hero bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] shadow-md text-[#FFFDF8]'
                : 'glass-card bg-[#FFFDF8] border border-[#E6E2D6] text-[#1B271B] shadow-xs'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative z-10">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {activeLiveSession?.status === 'active' ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#E5EEE3]">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E5EEE3] opacity-75" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#E5EEE3]" />
                      </span>
                      PATROLI LIVE AKTIF DI PETA 3D
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#1B271B]">
                      <Navigation className="w-4 h-4 text-[#2B3F29]" />
                      Live Tracking Patroli di Peta 3D
                    </span>
                  )}
                </div>

                {activeLiveSession?.status === 'active' ? (
                  <p className="text-[11px] text-[#E5EEE3]/90 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="inline-flex items-center gap-1">
                      <Crosshair className="w-3.5 h-3.5 text-[#E5EEE3]" />
                      GPS Aktif ({gpsAccuracy !== null ? `±${gpsAccuracy}m` : 'mengunci...'})
                    </span>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1">
                      <Smartphone className="w-3.5 h-3.5 text-[#E5EEE3]" />
                      {wakeLockActive ? 'Layar Terjaga' : 'Layar Normal'}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-[#6E786D]">
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
                        className="min-h-[42px] px-3.5 rounded-full bg-[#E5EEE3] hover:bg-[#C6D2BF] text-[#243825] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <Crosshair className="w-4 h-4" />
                        <span>Lanjutkan GPS</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={completingLivePatrol}
                      onClick={() => setConfirmFinishOpen(true)}
                      className="min-h-[42px] px-4 rounded-full bg-[#C87058] hover:bg-[#B25C45] disabled:opacity-60 text-[#FFFDF8] text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
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
                    className="w-full sm:w-auto min-h-[44px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap shadow-sm transition-colors"
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
              <div className="rounded-2xl bg-[#C87058]/10 border border-[#E2A898] p-3 text-xs text-[#7A311E] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#C87058] shrink-0 mt-0.5" />
                <p className="leading-relaxed">{gpsErrorMsg}</p>
              </div>
            )}
          </section>
        )}

        {loading && !data ? (
          <div className="space-y-4">
            <div className="h-36 rounded-2xl bg-[#E6E2D6]/70 animate-pulse" />
            <div className="h-56 rounded-2xl bg-[#E6E2D6]/70 animate-pulse" />
          </div>
        ) : (
          <>
            {/* TAB 1: INFO & SHIFT */}
            {activeTab === 'info' && (
              <div className="space-y-4">
                {/* Kartu Shift Aktif & Ringkasan Tugas */}
                <section className="glass-hero relative overflow-hidden bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] shadow-md text-[#FFFDF8] rounded-3xl p-4 sm:p-5 space-y-4">
                  <SaungKebunWatermark />
                  <div className="flex items-start justify-between gap-3 relative z-10">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-[#FFFDF8]/12 border border-[#FFFDF8]/20 text-[#E5EEE3] flex items-center justify-center shrink-0">
                        <Shield className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#E5EEE3]">
                          Shift Bertugas Aktif
                        </p>
                        <p className="text-base font-bold text-[#FFFDF8] truncate mt-0.5">
                          {effectiveShiftLabel}
                        </p>
                        <p className="text-xs text-[#E5EEE3]/75 font-mono mt-0.5">
                          @{profil.username} · Perumahan Saung Kebun
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 relative z-10">
                    <div className="rounded-2xl bg-[#FFFDF8]/10 border border-[#FFFDF8]/15 p-3">
                      <p className="text-[11px] text-[#E5EEE3]/80">Scan Pribadi Hari Ini</p>
                      <p className="text-lg font-mono font-bold text-[#FFFDF8] tabular-nums mt-0.5">
                        {patroliHariIni.length}{' '}
                        <span className="text-xs font-sans font-normal text-[#E5EEE3]/80">kali</span>
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#FFFDF8]/10 border border-[#FFFDF8]/15 p-3">
                      <p className="text-[11px] text-[#E5EEE3]/80">Progres Peta Shift</p>
                      <p className="text-lg font-mono font-bold text-[#E5EEE3] tabular-nums mt-0.5">
                        {activeCycleProgress.scanned}/{activeCycleProgress.total}{' '}
                        <span className="text-xs font-sans font-normal text-[#E5EEE3]/80">titik</span>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 relative z-10">
                    <button
                      type="button"
                      onClick={handleCenterScanFabClick}
                      className="min-h-[44px] rounded-full bg-[#E5EEE3] hover:bg-[#C6D2BF] text-[#243825] text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Radio className="w-4 h-4 shrink-0" />
                      <span>Mulai Scan NFC</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectTab('peta')}
                      className="min-h-[44px] rounded-full bg-[#FFFDF8]/12 hover:bg-[#FFFDF8]/22 border border-[#FFFDF8]/20 text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <MapIcon className="w-4 h-4 shrink-0 text-[#E5EEE3]" />
                      <span>Buka Peta Patroli</span>
                    </button>
                  </div>
                </section>

                {/* Instruksi Keamanan Hari Ini dari Pengurus */}
                <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 space-y-3 shadow-xs">
                  <h2 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[#6E4D12] shrink-0" />
                    <span>Instruksi Keamanan Hari Ini dari Pengurus</span>
                  </h2>

                  {data && data.instruksiKeamanan.length > 0 ? (
                    <div className="space-y-2.5">
                      {data.instruksiKeamanan.slice(0, 4).map((info) => (
                        <div
                          key={info.id}
                          className="rounded-2xl bg-[#F2D8A7]/45 border border-[#E2C285] px-3.5 py-3 space-y-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#4A3410]">
                            <span className="font-bold">{info.title}</span>
                            <span className="font-mono">{formatTanggalWaktu(info.created_at)}</span>
                          </div>
                          <p className="text-xs text-[#4A554A] leading-relaxed whitespace-pre-line">
                            {info.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] px-3.5 py-3 text-xs text-[#4A554A] leading-relaxed">
                      Belum ada instruksi keamanan khusus hari ini. Lakukan patroli rutin di seluruh
                      titik checkpoint dan laporkan segera bila ada kondisi mencurigakan.
                    </div>
                  )}
                </section>

                {/* Tombol Panggilan Darurat ke Erlangga (Ketua) & Andriansyah (Bendahara) */}
                {emergencyPengurus.length > 0 && (
                  <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 space-y-3 shadow-xs">
                    <div>
                      <h2 className="text-sm font-bold text-[#1B271B]">
                        Panggilan Darurat ke Pengurus
                      </h2>
                      <p className="text-xs text-[#6E786D] mt-0.5">
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
                            className="rounded-2xl border border-[#E6E2D6] bg-[#F7F4EC] p-3.5 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#1B271B] truncate">
                                {contact.label}
                              </p>
                              <p className="text-[11px] font-mono text-[#6E786D] tabular-nums mt-0.5">
                                +{contact.wa}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`https://wa.me/${contact.wa}?text=${waText}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-h-[40px] px-3.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <Icon3D name="kirim_wa" className="w-4 h-4 rounded-sm" />
                                <span>WA</span>
                              </a>
                              <a
                                href={`tel:+${contact.wa}`}
                                className="min-h-[40px] px-3.5 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1"
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
              <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs">
                <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 bg-[#FFFDF8] border border-[#E6E2D6] rounded-2xl">
                    <button
                      type="button"
                      onClick={() => setRiwayatFilter('hari_ini')}
                      className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        riwayatFilter === 'hari_ini'
                          ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                          : 'text-[#4A554A] hover:text-[#1B271B]'
                      }`}
                    >
                      Hari Ini ({patroliHariIni.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRiwayatFilter('semua')}
                      className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition cursor-pointer ${
                        riwayatFilter === 'semua'
                          ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                          : 'text-[#4A554A] hover:text-[#1B271B]'
                      }`}
                    >
                      Semua Riwayat ({data?.patroliPribadi.length || 0})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCenterScanFabClick}
                    className="min-h-[36px] px-3.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Scan Baru</span>
                  </button>
                </div>

                {displayedRiwayat.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <ClipboardList className="w-8 h-8 text-[#C6D2BF] mx-auto" />
                    <p className="text-sm font-bold text-[#1B271B]">
                      {riwayatFilter === 'hari_ini'
                        ? 'Belum Ada Scan Checkpoint Hari Ini'
                        : 'Belum Ada Riwayat Patroli'}
                    </p>
                    <p className="text-xs text-[#6E786D] max-w-xs mx-auto">
                      Ketuk tombol SCAN NFC di tengah bawah untuk mulai men-tap stiker checkpoint di
                      lapangan.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#E6E2D6]">
                    {displayedRiwayat.map((log) => {
                      const isAman = log.status_kondisi === 'Aman';
                      return (
                        <div
                          key={log.id}
                          className="px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <p className="text-sm font-bold text-[#1B271B]">{log.nama_lokasi}</p>
                              <span
                                className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                                  isAman
                                    ? 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                                    : 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]'
                                }`}
                              >
                                {isAman ? 'Situasi Aman' : 'Ada Catatan'}
                              </span>
                            </div>
                            {log.catatan && (
                              <p className="text-xs text-[#4A554A] bg-[#F7F4EC] border border-[#E6E2D6] rounded-xl px-2.5 py-1.5 leading-snug">
                                {log.catatan}
                              </p>
                            )}
                            <p className="text-[11px] text-[#6E786D]">
                              Metode: <span className="font-medium text-[#4A554A]">{log.metode_scan}</span>
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-mono font-bold text-[#1B271B] tabular-nums inline-flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-[#2B3F29]" />
                              {new Date(log.waktu_scan).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              WIB
                            </p>
                            <p className="text-[10px] font-mono text-[#6E786D] mt-0.5 tabular-nums">
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
              <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 space-y-4 shadow-xs">
                {/* Pilihan Kondisi & Catatan Sebelum Tap */}
                <div className="space-y-3 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] p-3.5">
                  <div>
                    <p className="text-xs font-semibold text-[#1B271B] mb-1.5">
                      Kondisi Area Patroli
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setStatusKondisi('Aman')}
                        className={`min-h-[44px] rounded-full text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                          statusKondisi === 'Aman'
                            ? 'bg-[#2B3F29] border-[#2B3F29] text-[#FFFDF8] shadow-xs'
                            : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]'
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
                            ? 'bg-[#C87058] border-[#C87058] text-[#FFFDF8] shadow-xs'
                            : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#F2D8A7]/40'
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
                      className="block text-xs font-semibold text-[#1B271B] mb-1"
                    >
                      Catatan Lapangan (Opsional)
                    </label>
                    <input
                      id="catatan-patroli"
                      type="text"
                      value={catatanPatroli}
                      onChange={(e) => setCatatanPatroli(e.target.value)}
                      placeholder="Contoh: PJU Blok B3 mati / gerbang terkunci rapi..."
                      className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] placeholder:text-[#6E786D]/70 focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                    />
                  </div>
                </div>

                {/* Status Banner Scan NFC */}
                <div className="space-y-2.5">
                  {submittingPatroli ? (
                    <div
                      role="status"
                      className="rounded-2xl px-3.5 py-3 text-xs font-semibold flex items-center gap-2.5 border bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]"
                    >
                      <Loader2 className="w-4 h-4 animate-spin text-[#2B3F29] shrink-0" />
                      <span>Menyimpan log patroli &amp; memperbarui status pin peta...</span>
                    </div>
                  ) : scanningNfc ? (
                    <div
                      role="status"
                      className="rounded-2xl px-3.5 py-3 text-xs font-semibold flex items-start gap-2.5 border bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]"
                    >
                      <span className="relative flex h-4 w-4 mt-0.5 shrink-0 items-center justify-center">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#384E35] opacity-75" />
                        <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-[#384E35] opacity-60 [animation-delay:250ms]" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#2B3F29]" />
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
                          ? 'bg-[#F2D8A7]/45 border-[#E2C285] text-[#4A3410]'
                          : 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]'
                      }`}
                    >
                      {nfcStatusError ? (
                        <AlertTriangle className="w-4 h-4 text-[#6E4D12] shrink-0 mt-0.5" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-[#2B3F29] shrink-0 mt-0.5" />
                      )}
                      <span className="leading-relaxed">{nfcStatusText}</span>
                    </div>
                  ) : (
                    <div className="rounded-2xl px-3.5 py-2.5 text-xs text-[#4A554A] bg-[#F7F4EC] border border-dashed border-[#C6D2BF] flex items-center gap-2">
                      <Radio className="w-4 h-4 text-[#2B3F29] shrink-0" />
                      <span>
                        Ketuk tombol bulat <strong>Scan NFC</strong> di tengah bawah untuk
                        mengaktifkan sensor NFC.
                      </span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs text-[#6E786D] pt-1">
                    <span>
                      {nfcSupported
                        ? 'Web NFC foreground siap (Chrome Android).'
                        : 'Web NFC tidak tersedia di browser ini — gunakan Input Manual Checkpoint.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowManualForm((v) => !v)}
                      className="font-semibold text-[#2B3F29] hover:underline cursor-pointer shrink-0"
                    >
                      {showManualForm ? 'Tutup Input Manual' : 'Input Manual Checkpoint'}
                    </button>
                  </div>

                  {/* Fallback Input Manual Checkpoint */}
                  {showManualForm && (
                    <div className="rounded-2xl border border-[#E6E2D6] bg-[#F7F4EC] p-3.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#1B271B]">
                          Input Manual Checkpoint (Fallback Non-NFC)
                        </p>
                        {gpsAccuracy !== null && (
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border bg-[#E5EEE3] text-[#243825] border-[#C6D2BF] tabular-nums">
                            GPS Aktif (±{gpsAccuracy}m)
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <select
                          value={selectedTitikId}
                          onChange={(e) => setSelectedTitikId(e.target.value)}
                          className="sm:col-span-5 min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3 text-xs sm:text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
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
                          className="sm:col-span-3 min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3 text-xs font-mono text-[#1B271B] placeholder:font-sans placeholder:text-[#6E786D]/70 focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                        />
                        <button
                          type="button"
                          disabled={submittingPatroli || (!selectedTitikId && !manualUidInput.trim())}
                          onClick={() => void handleManualFallbackVerify()}
                          className="sm:col-span-4 min-h-[44px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                        >
                          <MapPin className="w-4 h-4 shrink-0 text-[#E5EEE3]" />
                          <span>Catat Checkpoint</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Ringkasan Cepat 3 Scan Terakhir & Tautan ke Peta */}
                <div className="pt-3 border-t border-[#E6E2D6] flex items-center justify-between gap-2">
                  <p className="text-xs text-[#4A554A]">
                    Scan hari ini:{' '}
                    <strong className="font-mono text-[#1B271B]">{patroliHariIni.length}</strong>{' '}
                    checkpoint
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSelectTab('peta')}
                    className="text-xs font-bold text-[#2B3F29] hover:underline inline-flex items-center gap-1 cursor-pointer"
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
                      ? 'glass-hero bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] shadow-md text-[#FFFDF8]'
                      : 'glass-card bg-[#FFFDF8] border border-[#E6E2D6] text-[#1B271B] shadow-xs'
                  }`}
                >
                  {activeLiveSession?.status === 'active' ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#E5EEE3]">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E5EEE3] opacity-80" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#E5EEE3]" />
                            </span>
                            PATROLI LIVE SEDANG BERLANGSUNG
                          </span>
                          <p className="text-xs font-mono text-[#E5EEE3]/90 tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="inline-flex items-center gap-1">
                              <Crosshair className="w-3.5 h-3.5 text-[#E5EEE3]" />
                              GPS Aktif ({gpsAccuracy !== null ? `±${gpsAccuracy}m` : 'mencari...'})
                            </span>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1">
                              <Smartphone className="w-3.5 h-3.5 text-[#E5EEE3]" />
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
                            className="min-h-[38px] px-3.5 rounded-full bg-[#E5EEE3] hover:bg-[#C6D2BF] text-[#243825] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                          >
                            <Crosshair className="w-3.5 h-3.5" />
                            <span>Lanjutkan GPS</span>
                          </button>
                        )}
                      </div>

                      {calibratedCount < 2 && (
                        <p className="text-[11px] text-[#E5EEE3]/90 bg-[#FFFDF8]/10 border border-[#FFFDF8]/15 rounded-2xl px-3 py-2 leading-relaxed">
                          Kalibrasi GPS pos saat ini ({calibratedCount} pos). Posisi Anda akan
                          otomatis berpindah mengikuti Pos yang terakhir di-scan NFC hingga Pengurus
                          mengunci minimal 2 pos di Pengaturan &gt; Petugas.
                        </p>
                      )}

                      <button
                        type="button"
                        disabled={completingLivePatrol}
                        onClick={() => setConfirmFinishOpen(true)}
                        className="w-full min-h-[48px] rounded-full bg-[#C87058] hover:bg-[#B25C45] disabled:opacity-60 text-[#FFFDF8] text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors"
                      >
                        <Square className="w-4 h-4 fill-current" />
                        <span>Selesai Patroli</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-[#1B271B] flex items-center gap-1.5">
                          <Navigation className="w-4 h-4 text-[#2B3F29]" />
                          <span>Live Tracking Patroli Real-Time</span>
                        </p>
                        <p className="text-xs text-[#6E786D]">
                          Aktifkan pelacakan GPS &amp; jaga layar tetap menyala agar posisi dan
                          jejak rute Anda muncul langsung di atas Peta 3D.
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={startingLivePatrol}
                        onClick={() => void handleStartLivePatrol()}
                        className="w-full min-h-[50px] rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors"
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
                    <div className="rounded-2xl bg-[#C87058]/10 border border-[#E2A898] p-3 text-xs text-[#7A311E] flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-[#C87058] shrink-0 mt-0.5" />
                      <p className="leading-relaxed">{gpsErrorMsg}</p>
                    </div>
                  )}
                </section>

                <button
                  type="button"
                  onClick={handleCenterScanFabClick}
                  className="w-full min-h-[48px] rounded-full bg-[#243825] hover:bg-[#1B271B] text-[#FFFDF8] text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-colors"
                >
                  <Radio className="w-4 h-4 text-[#E5EEE3]" />
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

      {/* IKON CHAT MELAYANG + PANEL CHAT CEPAT (DM & GROUP) */}
      <FloatingChatWidget
        session={session}
        unreadCount={unreadChatCount}
        open={chatModalOpen}
        onOpenChange={setChatModalOpen}
        initialRoomId={chatInitialRoomId}
        onToast={onToast}
      />

      {/* FLOATING BOTTOM NAVIGATION DOCK — NB2 3D SOFT PORCELAIN (MOBILE & TABLET < lg) */}
      <Navbar3D
        ariaLabel="Navigasi Bawah Floating Orb Dock Petugas"
        activeId={scanningNfc ? 'scan' : activeTab}
        onSelect={(id) => {
          if (id === 'scan') {
            handleCenterScanFabClick();
          } else {
            handleSelectTab(id as PetugasTab);
          }
        }}
        items={[
          { id: 'info', label: 'Pos Jaga & Shift', shortLabel: 'Pos Jaga', icon: Shield, icon3d: 'keamanan' },
          { id: 'riwayat', label: 'Riwayat Patroli', shortLabel: 'Patroli', icon: ClipboardList, icon3d: 'rekap' },
          {
            id: 'scan',
            label: scanningNfc ? 'Hentikan Mode Scan NFC Patroli' : 'Aktifkan Scan NFC Checkpoint Patroli',
            shortLabel: submittingPatroli ? 'Simpan' : scanningNfc ? 'Aktif' : 'Scan',
            icon: Radio,
            icon3d: 'scan_nfc',
            isCenterFab: true,
            disabled: submittingPatroli,
            ariaPressed: scanningNfc,
            isScanning: scanningNfc,
            isLoading: submittingPatroli,
          },
          { id: 'honor', label: 'Honor & Lembur', shortLabel: 'Honor', icon: Wallet },
          { id: 'peta', label: 'Peta Patroli', shortLabel: 'Peta', icon: MapIcon },
        ]}
      />

      {selectedHonorTrx && (
        <KwitansiDigitalModal
          mode="kas"
          trxKas={selectedHonorTrx}
          onClose={() => setSelectedHonorTrx(null)}
        />
      )}

      {/* Modal Profil & Tema Petugas */}
      {profileModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Pengaturan Profil dan Tema Petugas"
          onClick={() => setProfileModalOpen(false)}
          className="fixed inset-0 z-[65] bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#FFFDF8] w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-5 shadow-2xl animate-modal-pop"
          >
            <div className="sm:hidden mx-auto w-10 h-1 rounded-full bg-[#C6D2BF]" aria-hidden="true" />
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E6E2D6]">
              <div>
                <h2 className="font-serif-brand text-base font-bold text-[#1B271B]">Profil &amp; Tema Petugas</h2>
                <p className="text-xs text-[#6E786D]">
                  Ubah foto profil atau pilih tema tampilan (termasuk Midnight untuk patroli malam).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                aria-label="Tutup modal profil dan tema"
                className="w-9 h-9 rounded-full text-[#6E786D] hover:text-[#243825] hover:bg-[#E5EEE3] flex items-center justify-center cursor-pointer"
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

            <div className="pt-4 border-t border-[#E6E2D6]">
              <ThemePicker compact onToast={onToast} />
            </div>

            <div className="pt-4 border-t border-[#E6E2D6]">
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
          className="fixed inset-0 z-[60] bg-[#1B271B]/55 backdrop-blur-md flex items-center justify-center p-4 animate-modal-backdrop"
        >
          <div className="bg-[#FFFDF8] w-full max-w-sm rounded-3xl border border-[#E6E2D6] p-5 space-y-4 shadow-2xl animate-modal-pop">
            <div className="space-y-1.5">
              <h2 className="font-serif-brand text-base font-bold text-[#1B271B]">Selesaikan Patroli Live?</h2>
              <p className="text-xs text-[#4A554A] leading-relaxed">
                Pelacakan GPS dan penguncian layar akan dihentikan, lalu sesi patroli Anda (
                <strong className="font-mono text-[#1B271B]">
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
                className="min-h-[40px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-xs font-bold text-[#4A554A] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={completingLivePatrol}
                aria-busy={completingLivePatrol}
                onClick={() => void handleConfirmFinishLivePatrol()}
                className="min-h-[40px] px-4 rounded-full bg-[#C87058] hover:bg-[#B25C45] disabled:opacity-60 text-[#FFFDF8] text-xs font-bold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer"
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
