import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Keyboard,
  Loader2,
  MapPin,
  Moon,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Icon3D } from './Icon3D';
import {
  APP_PETUGAS_PORTAL_URL,
  type LogPatroli,
  type PatrolLiveSession,
  type PatrolMapConfig,
  type PetugasKontakDarurat,
  type SessionUser,
  type StatusKondisiPatroli,
  type SystemNotification,
  type TitikPatroli,
} from '../types';
import { formatTanggalWaktu } from '../lib/format';
import {
  deleteAllLogPatroliAdmin,
  deleteLogPatroliAdmin,
  resetPatrolCycle,
  submitLogPatroliAdmin,
} from '../lib/dataService';
import {
  fetchActiveLiveSession,
  subscribeLivePatrolSessions,
} from '../lib/livePatrolService';
import {
  describeWebNfcError,
  extractNfcReadingData,
  getNdefReaderConstructor,
  isWebNfcSupported,
  normalizeNfcUid,
  triggerNfcVibrate,
} from '../lib/webNfc';
import {
  EmergencySecurityContactCard,
  SecurityPatrolFeedCard,
} from './SecurityLiveWidgets';
import { LoadingSpinner } from './LoadingSpinner';
import {
  type CheckpointKondisiState,
  type CheckpointStatusItem,
} from './SecurityPatrolMapSvg';
import { PatrolInteractiveMap } from './PatrolInteractiveMap';
import { WargaActiveGuardCard } from './warga/WargaActiveGuardCard';
import { AdminAttendanceMonitorPanel } from './admin/AdminAttendanceMonitorPanel';
import { AdminShiftOvertimePanel } from './admin/AdminShiftOvertimePanel';
import {
  fetchSecurityAttendance,
  subscribeSecurityAttendance,
} from '../lib/securityAttendanceService';
import {
  fetchShiftOverrides,
  isSundayOvertimeShift,
  subscribeShiftOverrides,
} from '../lib/securityShiftOvertimeService';
import { SaungKebunWatermark } from './BrandLogo';

interface KeamananSlideProps {
  role: 'warga' | 'admin';
  session?: SessionUser;
  senderName: string;
  senderBlok?: string;
  senderJabatan?: string;
  petugasKontak: PetugasKontakDarurat[];
  patroliFeed: LogPatroli[];
  titikPatroliList?: TitikPatroli[];
  patrolMapConfig?: PatrolMapConfig | null;
  notifications: SystemNotification[];
  isRefreshing?: boolean;
  onRefresh: () => Promise<void>;
  onOpenPetugasSettings?: () => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

function isTodayLocal(isoDate?: string | null): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function KeamananSlide({
  role,
  session,
  senderName,
  senderBlok,
  senderJabatan,
  petugasKontak,
  patroliFeed,
  titikPatroliList = [],
  patrolMapConfig = null,
  notifications,
  isRefreshing = false,
  onRefresh,
  onOpenPetugasSettings,
  onToast,
}: KeamananSlideProps) {
  const safePetugasKontak = useMemo(
    () => (Array.isArray(petugasKontak) ? petugasKontak : []),
    [petugasKontak]
  );
  const safePatroliFeed = useMemo(
    () => (Array.isArray(patroliFeed) ? patroliFeed : []),
    [patroliFeed]
  );
  const safeTitikPatroliList = useMemo(
    () => (Array.isArray(titikPatroliList) ? titikPatroliList : []),
    [titikPatroliList]
  );
  const safeNotifications = useMemo(
    () => (Array.isArray(notifications) ? notifications : []),
    [notifications]
  );
  const [kondisiFilter, setKondisiFilter] = useState<'semua' | 'Aman' | 'Ada Catatan'>('semua');
  const [checkpointFilter, setCheckpointFilter] = useState<
    'semua' | CheckpointKondisiState | 'belum_hari_ini'
  >('semua');
  const [activeLiveSession, setActiveLiveSession] = useState<PatrolLiveSession | null>(null);
  const [resettingCycle, setResettingCycle] = useState(false);
  const [deletingPatrolId, setDeletingPatrolId] = useState<string | null>(null);
  const [deletingAllPatrol, setDeletingAllPatrol] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<'patroli' | 'absensi' | 'shift_lembur'>('patroli');
  const [adminOnDutyCount, setAdminOnDutyCount] = useState<number>(0);
  const [unpaidOvertimeCount, setUnpaidOvertimeCount] = useState<number>(0);

  const handleDeletePatrolLog = useCallback(
    async (log: LogPatroli) => {
      if (role !== 'admin' || !session || deletingPatrolId) return;
      setDeletingPatrolId(log.id);
      try {
        const res = await deleteLogPatroliAdmin(
          session,
          log.id,
          `${log.nama_lokasi} · ${log.nama_petugas}`
        );
        if (!res.ok) {
          onToast('error', res.error || 'Gagal menghapus log patroli.');
          return;
        }
        onToast('success', `Log patroli "${log.nama_lokasi}" berhasil dihapus.`);
        await onRefresh();
      } finally {
        setDeletingPatrolId(null);
      }
    },
    [role, session, deletingPatrolId, onToast, onRefresh]
  );

  const handleDeleteAllPatrolLogs = useCallback(async () => {
    if (role !== 'admin' || !session || deletingAllPatrol) return;
    setDeletingAllPatrol(true);
    try {
      const res = await deleteAllLogPatroliAdmin(session);
      if (!res.ok) {
        onToast('error', res.error || 'Gagal mengosongkan log patroli.');
        return;
      }
      onToast('success', 'Seluruh log patroli keamanan berhasil dihapus.');
      await onRefresh();
    } finally {
      setDeletingAllPatrol(false);
    }
  }, [role, session, deletingAllPatrol, onToast, onRefresh]);

  const loadActiveLiveSession = useCallback(async () => {
    const live = await fetchActiveLiveSession(session || null);
    setActiveLiveSession(live);
  }, [session]);

  const loadAdminOnDutyCount = useCallback(async () => {
    if (role !== 'admin') return;
    const rows = await fetchSecurityAttendance(session || null, { limit: 60 });
    setAdminOnDutyCount(rows.filter((r) => r.status === 'on_duty').length);
  }, [role, session]);

  const loadUnpaidOvertimeCount = useCallback(async () => {
    if (role !== 'admin') return;
    const rows = await fetchShiftOverrides(session || null, { limit: 150 });
    setUnpaidOvertimeCount(
      rows.filter(
        (o) =>
          isSundayOvertimeShift(o.shift_name) &&
          o.payment_status !== 'paid' &&
          !o.cash_transaction_id
      ).length
    );
  }, [role, session]);

  useEffect(() => {
    if (role !== 'admin') return;
    void loadAdminOnDutyCount();
    void loadUnpaidOvertimeCount();
    const unsubAtt = subscribeSecurityAttendance(session || null, () => {
      void loadAdminOnDutyCount();
    });
    const unsubOv = subscribeShiftOverrides(session || null, () => {
      void loadUnpaidOvertimeCount();
    });
    return () => {
      unsubAtt();
      unsubOv();
    };
  }, [role, session, loadAdminOnDutyCount, loadUnpaidOvertimeCount]);

  useEffect(() => {
    void loadActiveLiveSession();
    const unsub = subscribeLivePatrolSessions(session || null, () => {
      void loadActiveLiveSession();
    });
    return () => {
      unsub();
    };
  }, [session, loadActiveLiveSession]);

  // State Panel Scan Checkpoint Patroli NFC (Admin)
  const nfcSupported = isWebNfcSupported();
  const [scanningNfc, setScanningNfc] = useState(false);
  const [submittingPatrol, setSubmittingPatrol] = useState(false);
  const [nfcFeedback, setNfcFeedback] = useState<{
    type: 'scanning' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [selectedPetugasId, setSelectedPetugasId] = useState<string>(
    () => safePetugasKontak[0]?.id || ''
  );
  const [patrolKondisi, setPatrolKondisi] = useState<StatusKondisiPatroli>('Aman');
  const [patrolCatatan, setPatrolCatatan] = useState('');
  const [showManualFallback, setShowManualFallback] = useState(!nfcSupported);
  const [manualTitikId, setManualTitikId] = useState<string>(
    () => safeTitikPatroliList[0]?.id || ''
  );
  const [manualUidInput, setManualUidInput] = useState('');
  const nfcAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedPetugasId && safePetugasKontak.length > 0) {
      setSelectedPetugasId(safePetugasKontak[0]?.id || '');
    }
  }, [safePetugasKontak, selectedPetugasId]);

  useEffect(() => {
    if (!manualTitikId && safeTitikPatroliList.length > 0) {
      setManualTitikId(safeTitikPatroliList[0]?.id || '');
    }
  }, [safeTitikPatroliList, manualTitikId]);

  const stopNfcScan = useCallback(() => {
    if (nfcAbortRef.current) {
      nfcAbortRef.current.abort();
      nfcAbortRef.current = null;
    }
    setScanningNfc(false);
  }, []);

  useEffect(() => {
    return () => {
      nfcAbortRef.current?.abort();
    };
  }, []);

  const scanHariIni = useMemo(
    () => safePatroliFeed.filter((log) => isTodayLocal(log?.waktu_scan)).length,
    [safePatroliFeed]
  );

  const catatanKhususCount = useMemo(
    () => safePatroliFeed.filter((log) => log?.status_kondisi === 'Ada Catatan').length,
    [safePatroliFeed]
  );

  const latestLog = safePatroliFeed[0] || null;

  const checkpointStatuses = useMemo<CheckpointStatusItem[]>(() => {
    const activePoints = safeTitikPatroliList.filter((t) => Boolean(t) && t.aktif !== false);
    const sortedLogs = [...safePatroliFeed].sort(
      (a, b) => new Date(b?.waktu_scan || 0).getTime() - new Date(a?.waktu_scan || 0).getTime()
    );

    return activePoints.map((titik) => {
      const normalizedName = (titik?.nama_lokasi || '').trim().toLowerCase();
      const matched =
        sortedLogs.find(
          (log) =>
            (log?.titik_id && log.titik_id === titik.id) ||
            (log?.nama_lokasi || '').trim().toLowerCase() === normalizedName
        ) || null;

      if (!matched) {
        return {
          titik,
          latestLog: null,
          state: 'belum_dipatroli',
          scannedToday: false,
        };
      }

      const state: CheckpointKondisiState =
        matched.status_kondisi === 'Ada Catatan' ? 'perlu_perhatian' : 'aman';

      return {
        titik,
        latestLog: matched,
        state,
        scannedToday: isTodayLocal(matched.waktu_scan),
      };
    });
  }, [safeTitikPatroliList, safePatroliFeed]);

  const checkpointSummary = useMemo(() => {
    const total = checkpointStatuses.length;
    const aman = checkpointStatuses.filter((c) => c.state === 'aman').length;
    const perluPerhatian = checkpointStatuses.filter((c) => c.state === 'perlu_perhatian').length;
    const belumDipatroli = checkpointStatuses.filter((c) => c.state === 'belum_dipatroli').length;
    const terpantauHariIni = checkpointStatuses.filter((c) => c.scannedToday).length;
    const belumHariIni = total - terpantauHariIni;
    return {
      total,
      aman,
      perluPerhatian,
      belumDipatroli,
      terpantauHariIni,
      belumHariIni,
    };
  }, [checkpointStatuses]);

  const filteredCheckpoints = useMemo(() => {
    if (checkpointFilter === 'semua') return checkpointStatuses;
    if (checkpointFilter === 'belum_hari_ini') {
      return checkpointStatuses.filter((c) => !c.scannedToday);
    }
    return checkpointStatuses.filter((c) => c.state === checkpointFilter);
  }, [checkpointStatuses, checkpointFilter]);

  const filteredPatroli = useMemo(() => {
    if (kondisiFilter === 'semua') return safePatroliFeed;
    return safePatroliFeed.filter((log) => log?.status_kondisi === kondisiFilter);
  }, [safePatroliFeed, kondisiFilter]);

  const securityAnnouncements = useMemo(
    () => safeNotifications.filter((n) => n?.category === 'Keamanan'),
    [safeNotifications]
  );

  const handleCopyPetugasLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_PETUGAS_PORTAL_URL);
      onToast('success', `Link Portal Petugas (${APP_PETUGAS_PORTAL_URL}) berhasil disalin.`);
    } catch {
      onToast('info', `Link Portal Petugas: ${APP_PETUGAS_PORTAL_URL}`);
    }
  };

  const handleResetPatrolCycle = async () => {
    if (!session || role !== 'admin' || resettingCycle) return;
    setResettingCycle(true);
    try {
      const res = await resetPatrolCycle(session);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          'Siklus patroli berhasil direset untuk shift baru. Riwayat patroli sebelumnya tetap tersimpan.'
        );
        await onRefresh();
      }
    } finally {
      setResettingCycle(false);
    }
  };

  const recordAdminPatrol = useCallback(
    async (
      titik: TitikPatroli | null,
      fallbackLokasi: string,
      metode: 'NFC Tap' | 'Input Manual'
    ) => {
      if (!session || session.role !== 'admin') return;
      setSubmittingPatrol(true);
      try {
        const selectedGuard =
          petugasKontak.find((p) => p.id === selectedPetugasId) || petugasKontak[0] || null;
        const res = await submitLogPatroliAdmin(session, {
          petugas_id: selectedGuard?.id || null,
          nama_petugas: selectedGuard
            ? `${selectedGuard.nama} (via ${session.jabatan || 'Admin'})`
            : `${session.nama_warga} (${session.jabatan || 'Pengurus'})`,
          titik_id: titik?.id || null,
          nama_lokasi: titik?.nama_lokasi || fallbackLokasi,
          metode_scan: metode,
          status_kondisi: patrolKondisi,
          catatan: patrolCatatan,
        });

        if (res.error || !res.data) {
          onToast('error', res.error || 'Gagal mencatat log patroli.');
        } else {
          onToast(
            'success',
            `Checkpoint "${res.data.nama_lokasi}" (${res.data.status_kondisi}) berhasil tercatat!`
          );
          setPatrolCatatan('');
          setPatrolKondisi('Aman');
          setManualUidInput('');
          await onRefresh();
        }
      } finally {
        setSubmittingPatrol(false);
      }
    },
    [session, petugasKontak, selectedPetugasId, patrolKondisi, patrolCatatan, onToast, onRefresh]
  );

  const handleToggleNfcPatrolScan = async () => {
    if (scanningNfc) {
      stopNfcScan();
      setNfcFeedback(null);
      return;
    }

    stopNfcScan();

    const NDEFReaderCtor = getNdefReaderConstructor();
    if (!NDEFReaderCtor) {
      const msg =
        'Web NFC hanya didukung browser Chrome Android (HTTPS). Gunakan form Input Manual di bawah.';
      setShowManualFallback(true);
      setNfcFeedback({ type: 'error', text: msg });
      onToast('error', msg);
      return;
    }

    try {
      const controller = new AbortController();
      nfcAbortRef.current = controller;
      const ndef = new NDEFReaderCtor();

      // Daftarkan listener SEBELUM ndef.scan() agar foreground NFC langsung menangkap UID tanpa pop-up OS Android
      ndef.addEventListener(
        'readingerror',
        () => {
          setNfcFeedback({
            type: 'error',
            text: 'Tag terdeteksi tetapi tidak berformat NDEF (misal kartu e-Money/MIFARE Classic) atau stiker belum diformat. Gunakan stiker NTAG213/215/216 atau Input Manual.',
          });
          onToast('error', 'Gagal membaca tag NFC. Pastikan stiker berformat NDEF.');
        },
        { signal: controller.signal }
      );

      ndef.addEventListener(
        'reading',
        (event) => {
          const { uid, allNormalizedTokens } = extractNfcReadingData(event);
          const activePoints = titikPatroliList.filter((t) => t.aktif !== false);
          const matched = activePoints.find((t) => {
            const normTarget = normalizeNfcUid(t.rfid_uid);
            return normTarget && allNormalizedTokens.includes(normTarget);
          });

          stopNfcScan();

          if (matched) {
            triggerNfcVibrate([100, 50, 100]);
            setNfcFeedback({
              type: 'success',
              text: `Stiker NFC terbaca: ${matched.nama_lokasi} (UID: ${uid || normalizeNfcUid(matched.rfid_uid)}). Mencatat patroli...`,
            });
            void recordAdminPatrol(matched, matched.nama_lokasi, 'NFC Tap');
          } else {
            const displayUid = uid || 'TIDAK-DIKENAL';
            triggerNfcVibrate([60]);
            setManualUidInput(uid || '');
            setShowManualFallback(true);
            setNfcFeedback({
              type: 'error',
              text: `UID "${displayUid}" belum terdaftar di master titik checkpoint. Daftarkan dulu di Pengaturan > Petugas & Titik RFID, atau simpan melalui Input Manual.`,
            });
            onToast('error', `UID NFC "${displayUid}" belum terdaftar di daftar checkpoint.`);
          }
        },
        { signal: controller.signal }
      );

      setScanningNfc(true);
      setNfcFeedback({
        type: 'scanning',
        text: 'Mode Scan Aktif — Tempelkan stiker NFC ke belakang HP sekarang...',
      });

      await ndef.scan({ signal: controller.signal });
    } catch (err) {
      stopNfcScan();
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const readableErr = describeWebNfcError(err);
      setNfcFeedback({ type: 'error', text: readableErr });
      setShowManualFallback(true);
      onToast('error', readableErr);
    }
  };

  const handleManualPatrolSubmit = async () => {
    const cleanUid = normalizeNfcUid(manualUidInput);
    if (cleanUid) {
      const matchedByUid = titikPatroliList.find(
        (t) => normalizeNfcUid(t.rfid_uid) === cleanUid
      );
      if (matchedByUid) {
        triggerNfcVibrate([100, 50, 100]);
        await recordAdminPatrol(matchedByUid, matchedByUid.nama_lokasi, 'Input Manual');
        return;
      }
      await recordAdminPatrol(null, `Checkpoint UID ${cleanUid}`, 'Input Manual');
      return;
    }

    const titik = titikPatroliList.find((t) => t.id === manualTitikId) || null;
    if (!titik) {
      onToast('error', 'Pilih titik checkpoint atau masukkan kode UID terlebih dahulu.');
      return;
    }
    await recordAdminPatrol(titik, titik.nama_lokasi, 'Input Manual');
  };

  return (
    <div className="space-y-5 pb-24">
      {/* Header Aksi Halaman Keamanan */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-[#4A554A]">
            Pusat informasi keamanan, kontak darurat 24 jam, dan log patroli NFC Perumahan Saung
            Kebun.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {role === 'admin' && onOpenPetugasSettings && (
            <button
              type="button"
              onClick={onOpenPetugasSettings}
              className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Kelola Petugas &amp; NFC</span>
            </button>
          )}
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void onRefresh()}
            className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 disabled:opacity-60 text-xs sm:text-sm font-semibold text-[#1B271B] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`w-4 h-4 text-[#2B3F29] shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? 'Memuat...' : 'Muat Ulang'}</span>
          </button>
        </div>
      </div>

      {/* Tab Navigasi Khusus Admin: Patroli & Peta Live vs Monitoring Absensi Keamanan */}
      {role === 'admin' && session && (
        <div
          role="tablist"
          aria-label="Menu Keamanan Admin"
          className="flex flex-wrap items-center gap-1.5 p-1.5 bg-[#FFFDF8] border border-[#E6E2D6] rounded-2xl w-full sm:w-fit"
        >
          <button
            type="button"
            role="tab"
            aria-selected={adminSubTab === 'patroli'}
            onClick={() => setAdminSubTab('patroli')}
            className={`flex-1 sm:flex-initial min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap ${
              adminSubTab === 'patroli'
                ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                : 'text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/40'
            }`}
          >
            <Radio className={`w-4 h-4 shrink-0 ${adminSubTab === 'patroli' ? 'text-[#E5EEE3]' : 'text-[#2B3F29]'}`} />
            <span>Patroli &amp; Peta Live</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={adminSubTab === 'absensi'}
            onClick={() => setAdminSubTab('absensi')}
            className={`flex-1 sm:flex-initial min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap ${
              adminSubTab === 'absensi'
                ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                : 'text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/40'
            }`}
          >
            <ShieldCheck className={`w-4 h-4 shrink-0 ${adminSubTab === 'absensi' ? 'text-[#E5EEE3]' : 'text-[#2B3F29]'}`} />
            <span>Monitoring Absensi Keamanan</span>
            {adminOnDutyCount > 0 && (
              <span
                className={`text-[11px] font-mono font-bold tabular-nums ${
                  adminSubTab === 'absensi' ? 'text-[#E5EEE3]' : 'text-[#243825]'
                }`}
              >
                ({adminOnDutyCount} aktif)
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={adminSubTab === 'shift_lembur'}
            onClick={() => setAdminSubTab('shift_lembur')}
            className={`flex-1 sm:flex-initial min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap ${
              adminSubTab === 'shift_lembur'
                ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                : 'text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/40'
            }`}
          >
            <Moon className={`w-4 h-4 shrink-0 ${adminSubTab === 'shift_lembur' ? 'text-[#E5EEE3]' : 'text-[#2B3F29]'}`} />
            <span>Kelola Shift &amp; Lembur</span>
            {unpaidOvertimeCount > 0 && (
              <span
                className={`text-[11px] font-mono font-bold tabular-nums ${
                  adminSubTab === 'shift_lembur' ? 'text-[#F2D8A7]' : 'text-[#6E4D12]'
                }`}
              >
                ({unpaidOvertimeCount} blm bayar)
              </span>
            )}
          </button>
        </div>
      )}

      {/* TAB MONITORING ABSENSI KEAMANAN (ADMIN FULL CONTROL) */}
      <div key={adminSubTab} className="space-y-5 animate-page-enter">
      {role === 'admin' && session && adminSubTab === 'absensi' ? (
        <AdminAttendanceMonitorPanel
          session={session}
          petugasList={petugasKontak}
          patroliFeed={patroliFeed}
          titikPatroliList={titikPatroliList}
          patrolMapConfig={patrolMapConfig}
          onToast={onToast}
        />
      ) : role === 'admin' && session && adminSubTab === 'shift_lembur' ? (
        <AdminShiftOvertimePanel
          session={session}
          petugasList={petugasKontak}
          onCashChanged={onRefresh}
          onToast={onToast}
        />
      ) : (
        <>
          {/* MONITORING REAL-TIME PETUGAS JAGA AKTIF (AKUN WARGA READ-ONLY) */}
          {role === 'warga' && <WargaActiveGuardCard session={session} />}

          {/* Ringkasan KPI Keamanan & Status Petugas Bertugas */}
          <section className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
        <div className="relative overflow-hidden glass-hero bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] shadow-xl shadow-[#243825]/15 text-[#FFFDF8] rounded-3xl p-4 sm:p-5">
          <SaungKebunWatermark className="right-2 bottom-1 w-24 h-24 opacity-[0.10]" />
          <div className="relative flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[#E5EEE3]/85">Petugas Siaga Aktif</p>
            <ShieldCheck className="w-4 h-4 text-[#E5EEE3] shrink-0" />
          </div>
          <p className="relative text-xl sm:text-2xl font-mono font-bold text-[#FFFDF8] tabular-nums mt-2">
            {petugasKontak.length}{' '}
            <span className="text-xs font-sans font-normal text-[#E5EEE3]/80">personel</span>
          </p>
          <p className="relative text-[11px] text-[#E5EEE3]/80 mt-1 truncate">
            {petugasKontak.length > 0
              ? petugasKontak.map((p) => p.nama).join(', ')
              : 'Siaga panggilan darurat 24 jam'}
          </p>
        </div>

        <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[#6E786D]">Progres Titik Hari Ini</p>
            <Radio className="w-4 h-4 text-[#2B3F29] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-bold text-[#1B271B] tabular-nums mt-2">
            {checkpointSummary.total > 0
              ? `${checkpointSummary.terpantauHariIni}/${checkpointSummary.total}`
              : scanHariIni}{' '}
            <span className="text-xs font-sans font-normal text-[#6E786D]">titik</span>
          </p>
          <p className="text-[11px] text-[#6E786D] mt-1">
            {catatanKhususCount > 0
              ? `${catatanKhususCount} log ada catatan`
              : `${scanHariIni} total scan hari ini`}
          </p>
        </div>

        <div className="col-span-2 lg:col-span-1 glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[#6E786D]">Patroli Terakhir</p>
            <Clock className="w-4 h-4 text-[#2B3F29] shrink-0" />
          </div>
          {latestLog ? (
            <>
              <p className="text-sm sm:text-base font-bold text-[#1B271B] truncate mt-2">
                {latestLog.nama_lokasi}
              </p>
              <p className="text-[11px] text-[#6E786D] mt-1 truncate font-mono tabular-nums">
                {latestLog.nama_petugas} · {formatTanggalWaktu(latestLog.waktu_scan)}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-[#4A554A] mt-2">Belum ada scan terbaru</p>
              <p className="text-[11px] text-[#6E786D] mt-1">
                Otomatis terisi saat petugas tap NFC
              </p>
            </>
          )}
        </div>
      </section>

      {/* Panel Scan Checkpoint Patroli NFC (Foreground Anti Pop-up Android — Khusus Admin) */}
      {role === 'admin' && session && (
        <section
          aria-label="Scan Checkpoint Patroli NFC"
          className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden"
        >
          <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Icon3D name="scan_nfc" className="w-9 h-9 rounded-xl shadow-xs mt-0.5" />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#1B271B] leading-tight">
                  Scan Checkpoint Patroli RFID / NFC
                </h2>
                <p className="text-[11px] text-[#6E786D] mt-0.5">
                  Aktifkan mode scan foreground Chrome Android agar tag langsung terbaca tanpa
                  pop-up e-Wallet, atau gunakan input manual.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyPetugasLink()}
              className="min-h-[38px] px-3.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] hover:bg-[#D6E4D3] text-[#243825] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin Link /petugas</span>
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Pengaturan Petugas, Kondisi & Catatan Sebelum Tap */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] p-3.5">
              <div>
                <label
                  htmlFor="admin-patrol-guard"
                  className="block text-[11px] font-semibold text-[#4A554A] mb-1"
                >
                  Petugas Bertugas
                </label>
                {petugasKontak.length > 0 ? (
                  <select
                    id="admin-patrol-guard"
                    value={selectedPetugasId}
                    onChange={(e) => setSelectedPetugasId(e.target.value)}
                    className="w-full min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-xs sm:text-sm font-medium text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                  >
                    {petugasKontak.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nama} ({p.shift})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 flex items-center text-xs text-[#4A554A]">
                    {session.nama_warga} ({session.jabatan || 'Pengurus'})
                  </div>
                )}
              </div>

              <div>
                <p className="block text-[11px] font-semibold text-[#4A554A] mb-1">
                  Kondisi Lokasi
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPatrolKondisi('Aman')}
                    className={`min-h-[42px] rounded-full text-xs font-bold inline-flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                      patrolKondisi === 'Aman'
                        ? 'bg-[#2B3F29] border-[#2B3F29] text-[#FFFDF8]'
                        : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]/50'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Aman</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPatrolKondisi('Ada Catatan')}
                    className={`min-h-[42px] rounded-full text-xs font-bold inline-flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                      patrolKondisi === 'Ada Catatan'
                        ? 'bg-[#C87058] border-[#C87058] text-[#FFFDF8]'
                        : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#F7F4EC]'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Catatan</span>
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="admin-patrol-note"
                  className="block text-[11px] font-semibold text-[#4A554A] mb-1"
                >
                  Catatan Lapangan (Opsional)
                </label>
                <input
                  id="admin-patrol-note"
                  type="text"
                  value={patrolCatatan}
                  onChange={(e) => setPatrolCatatan(e.target.value)}
                  placeholder="Misal: Lampu jalan mati / gerbang aman..."
                  className="w-full min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-xs sm:text-sm text-[#1B271B] placeholder:text-[#6E786D]/70 focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                />
              </div>
            </div>

            {/* Tombol Utama Scan NFC Foreground */}
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={submittingPatrol}
                onClick={() => void handleToggleNfcPatrolScan()}
                className={`w-full min-h-[52px] px-5 rounded-full text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-60 ${
                  scanningNfc
                    ? 'bg-[#D9A754] hover:bg-[#C4913E] text-[#1B271B] ring-4 ring-[#F2D8A7]'
                    : 'bg-[#2B3F29] hover:bg-[#243825] active:scale-[0.99] text-[#FFFDF8] shadow-sm'
                }`}
              >
                {submittingPatrol ? (
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                ) : scanningNfc ? (
                  <span className="relative flex h-4 w-4 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1B271B] opacity-40" />
                    <Radio className="relative w-4 h-4 text-[#1B271B]" />
                  </span>
                ) : (
                  <Icon3D name="scan_nfc" className="w-6 h-6 rounded-lg shadow-xs" />
                )}
                <span>
                  {submittingPatrol
                    ? 'Menyimpan Log Patroli...'
                    : scanningNfc
                      ? 'Mode Scan Aktif... (Ketuk untuk Hentikan)'
                      : 'Mulai Scan Checkpoint Patroli'}
                </span>
              </button>

              {/* Status Banner Radar Pulse / Hasil / Error NFC */}
              {nfcFeedback && (
                <div
                  role="status"
                  className={`rounded-2xl px-3.5 py-3 text-xs flex items-start justify-between gap-2.5 border ${
                    nfcFeedback.type === 'scanning'
                      ? 'bg-[#243825] border-[#384E35] text-[#E5EEE3]'
                      : nfcFeedback.type === 'success'
                        ? 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]'
                        : 'bg-[#F2D8A7]/40 border-[#E2C285] text-[#4A3410]'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {nfcFeedback.type === 'scanning' ? (
                      <span className="relative flex h-4 w-4 mt-0.5 shrink-0 items-center justify-center">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#E5EEE3] opacity-75" />
                        <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-[#C6D2BF] opacity-60 [animation-delay:250ms]" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#E5EEE3]" />
                      </span>
                    ) : nfcFeedback.type === 'error' ? (
                      <AlertTriangle className="w-4 h-4 text-[#8C621A] shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-[#243825] shrink-0 mt-0.5" />
                    )}
                    <span className="leading-relaxed font-medium">{nfcFeedback.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      stopNfcScan();
                      setNfcFeedback(null);
                    }}
                    aria-label="Tutup status NFC"
                    className="p-0.5 rounded opacity-70 hover:opacity-100 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Info Web NFC & Toggle Fallback Input Manual */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E786D]">
                <span>
                  {nfcSupported
                    ? 'Web NFC siap (Chrome Android HTTPS). Tekan tombol di atas sebelum menempelkan stiker.'
                    : 'Browser ini belum mendukung Web NFC — gunakan Fallback Input Manual di bawah.'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowManualFallback((v) => !v)}
                  className="font-semibold text-[#2B3F29] hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  <span>{showManualFallback ? 'Sembunyikan Manual' : 'Input Manual / UID'}</span>
                </button>
              </div>

              {/* Fallback Input Manual Checkpoint / UID */}
              {showManualFallback && (
                <div className="rounded-2xl border border-[#E6E2D6] bg-[#F7F4EC] p-3.5 space-y-2.5">
                  <p className="text-xs font-bold text-[#1B271B]">
                    Catat Patroli Manual (Fallback Non-NFC / Input Kode UID)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <select
                      value={manualTitikId}
                      onChange={(e) => {
                        setManualTitikId(e.target.value);
                        setManualUidInput('');
                      }}
                      disabled={titikPatroliList.length === 0}
                      className="sm:col-span-5 min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-xs sm:text-sm text-[#1B271B] disabled:opacity-60 focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                    >
                      {titikPatroliList.length === 0 ? (
                        <option value="">Belum ada titik checkpoint terdaftar</option>
                      ) : (
                        titikPatroliList.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.nama_lokasi} ({t.rfid_uid})
                          </option>
                        ))
                      )}
                    </select>
                    <input
                      type="text"
                      value={manualUidInput}
                      onChange={(e) => setManualUidInput(normalizeNfcUid(e.target.value))}
                      placeholder="Atau ketik UID manual (misal: 04A1B2C3)"
                      className="sm:col-span-4 min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-xs sm:text-sm font-mono uppercase text-[#1B271B] placeholder:font-sans placeholder:normal-case placeholder:text-[#6E786D]/70 focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                    />
                    <button
                      type="button"
                      disabled={submittingPatrol || (!manualTitikId && !manualUidInput.trim())}
                      aria-busy={submittingPatrol}
                      onClick={() => void handleManualPatrolSubmit()}
                      className="sm:col-span-3 min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-[#FFFDF8] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap"
                    >
                      {submittingPatrol ? (
                        <LoadingSpinner size="xs" tone="white" />
                      ) : (
                        <MapPin className="w-4 h-4 shrink-0" />
                      )}
                      <span>{submittingPatrol ? 'Menyimpan...' : 'Catat Patroli'}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Peta 3D Patroli Real-Time + Overlay Live Tracking Petugas (Tanpa Library Peta Eksternal) */}
      <PatrolInteractiveMap
        mode={role === 'admin' ? 'admin' : 'warga'}
        titikList={titikPatroliList}
        patroliLogs={patroliFeed}
        patrolMapConfig={patrolMapConfig}
        liveSession={activeLiveSession}
        canResetCycle={role === 'admin' && Boolean(session)}
        onResetCycle={role === 'admin' && session ? handleResetPatrolCycle : undefined}
        resettingCycle={resettingCycle}
      />

      {/* Visualisasi Status Kondisi & Progres Harian Titik Checkpoint Patroli */}
      {role === 'admin' && (
        <section
          aria-label="Status Kondisi Terkini Titik Checkpoint Patroli"
          className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden"
        >
          {/* Header & Ringkasan Kondisi Titik */}
          <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-2xl bg-[#243825] text-[#E5EEE3] flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#1B271B] leading-tight">
                  Daftar Titik Checkpoint &amp; Status Patroli Hari Ini
                </h2>
                <p className="text-[11px] text-[#6E786D] mt-0.5">
                  Pantau titik yang sudah discan hari ini, belum discan, maupun yang membutuhkan
                  perhatian segera.
                </p>
              </div>
            </div>

            {/* Filter Cepat Status Titik */}
            {checkpointSummary.total > 0 && (
              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F7F4EC] border border-[#E6E2D6] rounded-2xl shrink-0">
                {(
                  [
                    { id: 'semua', label: `Semua (${checkpointSummary.total})` },
                    { id: 'aman', label: `Aman (${checkpointSummary.aman})` },
                    {
                      id: 'perlu_perhatian',
                      label: `Perlu Perhatian (${checkpointSummary.perluPerhatian})`,
                    },
                    {
                      id: 'belum_hari_ini',
                      label: `Belum Hari Ini (${checkpointSummary.belumHariIni})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCheckpointFilter(tab.id)}
                    className={`min-h-[32px] px-2.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      checkpointFilter === tab.id
                        ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                        : 'text-[#4A554A] hover:text-[#243825]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bar Proporsi Status Titik Checkpoint */}
          {checkpointSummary.total > 0 && (
            <div className="px-4 sm:px-5 py-3 bg-[#F7F4EC]/70 border-b border-[#E6E2D6] space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#243825]">
                    <span className="w-2 h-2 rounded-full bg-[#2B3F29]" aria-hidden="true" />
                    Aman: <span className="font-mono tabular-nums">{checkpointSummary.aman}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#A44831]">
                    <span className="w-2 h-2 rounded-full bg-[#C87058]" aria-hidden="true" />
                    Perlu Perhatian:{' '}
                    <span className="font-mono tabular-nums">
                      {checkpointSummary.perluPerhatian}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#6E786D]">
                    <span className="w-2 h-2 rounded-full bg-[#9CA396]" aria-hidden="true" />
                    Belum Discan Hari Ini:{' '}
                    <span className="font-mono tabular-nums">
                      {checkpointSummary.belumHariIni}
                    </span>
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-[#4A554A] tabular-nums">
                  Cakupan hari ini: {checkpointSummary.terpantauHariIni}/{checkpointSummary.total}{' '}
                  titik
                </span>
              </div>

              <div
                className="h-2 w-full rounded-full bg-[#E6E2D6] overflow-hidden flex"
                aria-hidden="true"
              >
                {checkpointSummary.aman > 0 && (
                  <div
                    className="bg-[#2B3F29] h-full transition-all"
                    style={{ width: `${(checkpointSummary.aman / checkpointSummary.total) * 100}%` }}
                  />
                )}
                {checkpointSummary.perluPerhatian > 0 && (
                  <div
                    className="bg-[#C87058] h-full transition-all"
                    style={{
                      width: `${
                        (checkpointSummary.perluPerhatian / checkpointSummary.total) * 100
                      }%`,
                    }}
                  />
                )}
                {checkpointSummary.belumDipatroli > 0 && (
                  <div
                    className="bg-[#C6C2B5] h-full transition-all"
                    style={{
                      width: `${
                        (checkpointSummary.belumDipatroli / checkpointSummary.total) * 100
                      }%`,
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Grid Kartu Setiap Titik Checkpoint */}
          {checkpointSummary.total === 0 ? (
            <div className="px-5 py-6 text-center space-y-2">
              <MapPin className="w-7 h-7 text-[#C6D2BF] mx-auto" />
              <p className="text-xs font-semibold text-[#1B271B]">
                Belum Ada Titik Checkpoint Patroli Terdaftar
              </p>
              <p className="text-[11px] text-[#6E786D] max-w-sm mx-auto">
                Tambahkan lokasi pos atau sudut blok beserta UID stiker RFID/NFC melalui tombol
                Kelola Petugas &amp; NFC agar status patroli setiap titik dapat dipantau di sini.
              </p>
            </div>
          ) : filteredCheckpoints.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-[#6E786D]">
              Tidak ada titik checkpoint pada filter status ini.
            </div>
          ) : (
            <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredCheckpoints.map(({ titik, latestLog: lastScan, state, scannedToday }) => {
                const isAman = state === 'aman';
                const isAttention = state === 'perlu_perhatian';

                return (
                  <article
                    key={titik.id}
                    className={`rounded-2xl border p-3.5 sm:p-4 flex flex-col justify-between gap-2.5 transition-colors ${
                      isAttention
                        ? 'border-[#E2A898] bg-[#C87058]/10'
                        : isAman
                          ? 'border-[#C6D2BF] bg-[#E5EEE3]/45'
                          : 'border-[#E6E2D6] bg-[#F7F4EC]'
                    }`}
                  >
                    {/* Baris Judul Lokasi & Status Kondisi */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#1B271B] leading-snug flex items-center gap-1.5">
                          <MapPin
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isAttention
                                ? 'text-[#C87058]'
                                : isAman
                                  ? 'text-[#243825]'
                                  : 'text-[#6E786D]'
                            }`}
                          />
                          <span className="truncate">{titik.nama_lokasi}</span>
                        </h3>
                        <p className="text-[11px] font-mono text-[#6E786D] mt-0.5 truncate">
                          UID: {titik.rfid_uid}
                          {titik.keterangan ? ` · ${titik.keterangan}` : ''}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                            isAttention
                              ? 'text-[#A44831]'
                              : isAman
                                ? 'text-[#243825]'
                                : 'text-[#6E786D]'
                          }`}
                        >
                          {isAttention ? (
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          ) : isAman ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                          )}
                          <span>
                            {isAttention
                              ? 'Perlu Perhatian'
                              : isAman
                                ? 'Aman'
                                : 'Belum Dipatroli'}
                          </span>
                        </span>
                        <p
                          className={`text-[10px] font-semibold mt-0.5 ${
                            scannedToday ? 'text-[#243825]' : 'text-[#8C621A]'
                          }`}
                        >
                          {scannedToday ? 'Sudah discan hari ini' : 'Belum discan hari ini'}
                        </p>
                      </div>
                    </div>

                    {/* Info Scan Terakhir / Catatan Perhatian */}
                    {lastScan ? (
                      <div className="pt-2 border-t border-[#E6E2D6] space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-[#4A554A]">
                          <span>
                            Petugas:{' '}
                            <strong className="text-[#1B271B]">{lastScan.nama_petugas}</strong>
                          </span>
                          <span className="font-mono tabular-nums text-[#6E786D] inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-[#6E786D] shrink-0" />
                            {formatTanggalWaktu(lastScan.waktu_scan)}
                          </span>
                        </div>

                        {lastScan.catatan ? (
                          <p
                            className={`text-xs rounded-xl px-2.5 py-1.5 leading-relaxed ${
                              isAttention
                                ? 'bg-[#FFFDF8] border border-[#E2A898] text-[#7A311E] font-medium'
                                : 'bg-[#FFFDF8] border border-[#E6E2D6] text-[#4A554A]'
                            }`}
                          >
                            {lastScan.catatan}
                          </p>
                        ) : (
                          <p className="text-[11px] text-[#6E786D]">
                            {scannedToday
                              ? 'Sudah dipatroli hari ini tanpa catatan kendala.'
                              : 'Scan terakhir sebelum hari ini — jadwalkan pengecekan ulang pada shift berjalan.'}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-[#E6E2D6]">
                        <p className="text-[11px] text-[#6E786D]">
                          Belum ada laporan scan NFC/manual pada titik ini. Prioritaskan pada rute
                          patroli berikutnya.
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Kontak Darurat Keamanan (24 Jam) */}
      <EmergencySecurityContactCard
        petugasList={petugasKontak}
        senderContext={{
          role,
          nama: senderName,
          blokRumah: senderBlok,
          jabatan: senderJabatan,
        }}
      />

      {/* Info & Instruksi Keamanan dari Pengurus (Jika Ada) */}
      {securityAnnouncements.length > 0 && (
        <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] flex items-center gap-2">
            <Icon3D name="pengumuman" className="w-7 h-7 rounded-lg shadow-2xs" />
            <h2 className="text-sm font-bold text-[#1B271B]">
              Imbauan &amp; Info Keamanan Lingkungan
            </h2>
          </div>
          <div className="divide-y divide-[#E6E2D6]">
            {securityAnnouncements.slice(0, 4).map((notif) => (
              <article key={notif.id} className="px-4 sm:px-5 py-3.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6E786D]">
                  <span className="font-semibold text-[#6E4D12]">
                    {notif.sender_name} ({notif.sender_jabatan})
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatTanggalWaktu(notif.created_at)}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#1B271B]">{notif.title}</h3>
                <p className="text-xs text-[#4A554A] leading-relaxed whitespace-pre-line">
                  {notif.message}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Filter & Daftar Lengkap Log Patroli Lingkungan Real-Time */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-[#6E786D]">
            Filter Riwayat Patroli
          </p>
          <div className="flex items-center gap-1 p-1 bg-[#FFFDF8] border border-[#E6E2D6] rounded-2xl">
            {(
              [
                { id: 'semua', label: `Semua (${safePatroliFeed.length})` },
                {
                  id: 'Aman',
                  label: `Aman (${safePatroliFeed.filter((l) => l?.status_kondisi === 'Aman').length})`,
                },
                {
                  id: 'Ada Catatan',
                  label: `Catatan (${catatanKhususCount})`,
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setKondisiFilter(opt.id)}
                className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  kondisiFilter === opt.id
                    ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                    : 'text-[#4A554A] hover:text-[#243825]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <SecurityPatrolFeedCard
          patroliFeed={filteredPatroli}
          maxItems={25}
          canDelete={role === 'admin' && Boolean(session)}
          deletingLogId={deletingPatrolId}
          deletingAllLogs={deletingAllPatrol}
          onDeleteLog={(log) => void handleDeletePatrolLog(log)}
          onDeleteAllLogs={() => void handleDeleteAllPatrolLogs()}
        />
      </div>
        </>
      )}
      </div>
    </div>
  );
}
