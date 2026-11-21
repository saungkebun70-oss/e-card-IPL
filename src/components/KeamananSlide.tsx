import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Keyboard,
  Loader2,
  MapPin,
  Megaphone,
  Radio,
  RefreshCw,
  Settings,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import {
  APP_PETUGAS_PORTAL_URL,
  type LogPatroli,
  type PatrolMapConfig,
  type PetugasKontakDarurat,
  type SessionUser,
  type StatusKondisiPatroli,
  type SystemNotification,
  type TitikPatroli,
} from '../types';
import { formatTanggalWaktu } from '../lib/format';
import { resetPatrolCycle, submitLogPatroliAdmin } from '../lib/dataService';
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
import {
  type CheckpointKondisiState,
  type CheckpointStatusItem,
} from './SecurityPatrolMapSvg';
import { PatrolInteractiveMap } from './PatrolInteractiveMap';
import { PatrolLiveLeafletMap } from './PatrolLiveLeafletMap';

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

function isTodayLocal(isoDate: string): boolean {
  const d = new Date(isoDate);
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
  const [kondisiFilter, setKondisiFilter] = useState<'semua' | 'Aman' | 'Ada Catatan'>('semua');
  const [checkpointFilter, setCheckpointFilter] = useState<
    'semua' | CheckpointKondisiState | 'belum_hari_ini'
  >('semua');
  const [mapViewMode, setMapViewMode] = useState<'live_gps' | 'denah'>('live_gps');
  const [resettingCycle, setResettingCycle] = useState(false);

  // State Panel Scan Checkpoint Patroli NFC (Admin)
  const nfcSupported = isWebNfcSupported();
  const [scanningNfc, setScanningNfc] = useState(false);
  const [submittingPatrol, setSubmittingPatrol] = useState(false);
  const [nfcFeedback, setNfcFeedback] = useState<{
    type: 'scanning' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [selectedPetugasId, setSelectedPetugasId] = useState<string>(
    () => petugasKontak[0]?.id || ''
  );
  const [patrolKondisi, setPatrolKondisi] = useState<StatusKondisiPatroli>('Aman');
  const [patrolCatatan, setPatrolCatatan] = useState('');
  const [showManualFallback, setShowManualFallback] = useState(!nfcSupported);
  const [manualTitikId, setManualTitikId] = useState<string>(
    () => titikPatroliList[0]?.id || ''
  );
  const [manualUidInput, setManualUidInput] = useState('');
  const nfcAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedPetugasId && petugasKontak.length > 0) {
      setSelectedPetugasId(petugasKontak[0].id);
    }
  }, [petugasKontak, selectedPetugasId]);

  useEffect(() => {
    if (!manualTitikId && titikPatroliList.length > 0) {
      setManualTitikId(titikPatroliList[0].id);
    }
  }, [titikPatroliList, manualTitikId]);

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
    () => patroliFeed.filter((log) => isTodayLocal(log.waktu_scan)).length,
    [patroliFeed]
  );

  const catatanKhususCount = useMemo(
    () => patroliFeed.filter((log) => log.status_kondisi === 'Ada Catatan').length,
    [patroliFeed]
  );

  const latestLog = patroliFeed[0] || null;

  const checkpointStatuses = useMemo<CheckpointStatusItem[]>(() => {
    const activePoints = titikPatroliList.filter((t) => t.aktif !== false);
    const sortedLogs = [...patroliFeed].sort(
      (a, b) => new Date(b.waktu_scan).getTime() - new Date(a.waktu_scan).getTime()
    );

    return activePoints.map((titik) => {
      const normalizedName = titik.nama_lokasi.trim().toLowerCase();
      const matched =
        sortedLogs.find(
          (log) =>
            (log.titik_id && log.titik_id === titik.id) ||
            log.nama_lokasi.trim().toLowerCase() === normalizedName
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
  }, [titikPatroliList, patroliFeed]);

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
    if (kondisiFilter === 'semua') return patroliFeed;
    return patroliFeed.filter((log) => log.status_kondisi === kondisiFilter);
  }, [patroliFeed, kondisiFilter]);

  const securityAnnouncements = useMemo(
    () => notifications.filter((n) => n.category === 'Keamanan'),
    [notifications]
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
          <p className="text-sm text-slate-600">
            Pusat informasi keamanan, kontak darurat 24 jam, dan log patroli NFC Perumahan Saung
            Kebun.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {role === 'admin' && onOpenPetugasSettings && (
            <button
              type="button"
              onClick={onOpenPetugasSettings}
              className="min-h-[42px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Kelola Petugas &amp; NFC</span>
            </button>
          )}
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void onRefresh()}
            className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs sm:text-sm font-semibold text-[#0F172A] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`w-4 h-4 text-slate-500 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? 'Memuat...' : 'Muat Ulang'}</span>
          </button>
        </div>
      </div>

      {/* Ringkasan KPI Keamanan & Status Petugas Bertugas */}
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
        <div className="bg-[#0F172A] text-white rounded-2xl p-4 sm:p-5 border border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-300">Petugas Siaga Aktif</p>
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-bold text-emerald-400 tabular-nums mt-2">
            {petugasKontak.length}{' '}
            <span className="text-xs font-sans font-normal text-slate-400">personel</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-1 truncate">
            {petugasKontak.length > 0
              ? petugasKontak.map((p) => p.nama).join(', ')
              : 'Siaga panggilan darurat 24 jam'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Progres Titik Hari Ini</p>
            <Radio className="w-4 h-4 text-[#059669] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-bold text-[#0F172A] tabular-nums mt-2">
            {checkpointSummary.total > 0
              ? `${checkpointSummary.terpantauHariIni}/${checkpointSummary.total}`
              : scanHariIni}{' '}
            <span className="text-xs font-sans font-normal text-slate-500">titik</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {catatanKhususCount > 0
              ? `${catatanKhususCount} log ada catatan`
              : `${scanHariIni} total scan hari ini`}
          </p>
        </div>

        <div className="col-span-2 lg:col-span-1 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Patroli Terakhir</p>
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          {latestLog ? (
            <>
              <p className="text-sm sm:text-base font-bold text-[#0F172A] truncate mt-2">
                {latestLog.nama_lokasi}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 truncate font-mono tabular-nums">
                {latestLog.nama_petugas} · {formatTanggalWaktu(latestLog.waktu_scan)}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-slate-600 mt-2">Belum ada scan terbaru</p>
              <p className="text-[11px] text-slate-400 mt-1">
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
          className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
        >
          <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Radio className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#0F172A] leading-tight">
                  Scan Checkpoint Patroli RFID / NFC
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Aktifkan mode scan foreground Chrome Android agar tag langsung terbaca tanpa
                  pop-up e-Wallet, atau gunakan input manual.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleCopyPetugasLink()}
              className="min-h-[38px] px-3 rounded-xl bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Salin Link /petugas</span>
            </button>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            {/* Pengaturan Petugas, Kondisi & Catatan Sebelum Tap */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl bg-slate-50 border border-slate-200/80 p-3.5">
              <div>
                <label
                  htmlFor="admin-patrol-guard"
                  className="block text-[11px] font-semibold text-slate-700 mb-1"
                >
                  Petugas Bertugas
                </label>
                {petugasKontak.length > 0 ? (
                  <select
                    id="admin-patrol-guard"
                    value={selectedPetugasId}
                    onChange={(e) => setSelectedPetugasId(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-medium text-[#0F172A]"
                  >
                    {petugasKontak.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nama} ({p.shift})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 flex items-center text-xs text-slate-600">
                    {session.nama_warga} ({session.jabatan || 'Pengurus'})
                  </div>
                )}
              </div>

              <div>
                <p className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Kondisi Lokasi
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPatrolKondisi('Aman')}
                    className={`min-h-[42px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                      patrolKondisi === 'Aman'
                        ? 'bg-[#059669] border-[#059669] text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Aman</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPatrolKondisi('Ada Catatan')}
                    className={`min-h-[42px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                      patrolKondisi === 'Ada Catatan'
                        ? 'bg-red-600 border-red-600 text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
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
                  className="block text-[11px] font-semibold text-slate-700 mb-1"
                >
                  Catatan Lapangan (Opsional)
                </label>
                <input
                  id="admin-patrol-note"
                  type="text"
                  value={patrolCatatan}
                  onChange={(e) => setPatrolCatatan(e.target.value)}
                  placeholder="Misal: Lampu jalan mati / gerbang aman..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>
            </div>

            {/* Tombol Utama Scan NFC Foreground */}
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={submittingPatrol}
                onClick={() => void handleToggleNfcPatrolScan()}
                className={`w-full min-h-[52px] px-4 rounded-2xl text-sm sm:text-base font-bold inline-flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-60 ${
                  scanningNfc
                    ? 'bg-amber-600 hover:bg-amber-700 text-white ring-4 ring-amber-200'
                    : 'bg-[#059669] hover:bg-emerald-700 active:scale-[0.99] text-white shadow-sm'
                }`}
              >
                {submittingPatrol ? (
                  <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                ) : scanningNfc ? (
                  <span className="relative flex h-4 w-4 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                    <Radio className="relative w-4 h-4 text-white" />
                  </span>
                ) : (
                  <Smartphone className="w-5 h-5 shrink-0" />
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
                  className={`rounded-xl px-3.5 py-3 text-xs flex items-start justify-between gap-2.5 border ${
                    nfcFeedback.type === 'scanning'
                      ? 'bg-[#0F172A] border-slate-800 text-emerald-300'
                      : nfcFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {nfcFeedback.type === 'scanning' ? (
                      <span className="relative flex h-4 w-4 mt-0.5 shrink-0 items-center justify-center">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-300 opacity-60 [animation-delay:250ms]" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                      </span>
                    ) : nfcFeedback.type === 'error' ? (
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
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
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {nfcSupported
                    ? 'Web NFC siap (Chrome Android HTTPS). Tekan tombol di atas sebelum menempelkan stiker.'
                    : 'Browser ini belum mendukung Web NFC — gunakan Fallback Input Manual di bawah.'}
                </span>
                <button
                  type="button"
                  onClick={() => setShowManualFallback((v) => !v)}
                  className="font-semibold text-[#059669] hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Keyboard className="w-3.5 h-3.5" />
                  <span>{showManualFallback ? 'Sembunyikan Manual' : 'Input Manual / UID'}</span>
                </button>
              </div>

              {/* Fallback Input Manual Checkpoint / UID */}
              {showManualFallback && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2.5">
                  <p className="text-xs font-bold text-[#0F172A]">
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
                      className="sm:col-span-5 min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-[#0F172A] disabled:opacity-60"
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
                      className="sm:col-span-4 min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm font-mono uppercase text-[#0F172A] placeholder:font-sans placeholder:normal-case placeholder:text-slate-400"
                    />
                    <button
                      type="button"
                      disabled={submittingPatrol || (!manualTitikId && !manualUidInput.trim())}
                      onClick={() => void handleManualPatrolSubmit()}
                      className="sm:col-span-3 min-h-[42px] px-3.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <MapPin className="w-4 h-4 shrink-0" />
                      <span>Catat Patroli</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Peta Patroli: Live Tracking GPS Satelit (Gojek-style) + Toggle Denah Vektor */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/70 border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setMapViewMode('live_gps')}
              className={`min-h-[34px] px-3 rounded-lg transition cursor-pointer ${
                mapViewMode === 'live_gps'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              Live Tracking GPS &amp; Satelit
            </button>
            <button
              type="button"
              onClick={() => setMapViewMode('denah')}
              className={`min-h-[34px] px-3 rounded-lg transition cursor-pointer ${
                mapViewMode === 'denah'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              Denah Vektor Perumahan
            </button>
          </div>
        </div>

        {mapViewMode === 'live_gps' ? (
          <PatrolLiveLeafletMap
            session={session || null}
            canCalibrate={role === 'admin'}
            onToast={onToast}
          />
        ) : (
          <PatrolInteractiveMap
            mode={role === 'admin' ? 'admin' : 'warga'}
            titikList={titikPatroliList}
            patroliLogs={patroliFeed}
            patrolMapConfig={patrolMapConfig}
            canResetCycle={role === 'admin' && Boolean(session)}
            onResetCycle={role === 'admin' && session ? handleResetPatrolCycle : undefined}
            resettingCycle={resettingCycle}
          />
        )}
      </div>

      {/* Visualisasi Status Kondisi & Progres Harian Titik Checkpoint Patroli */}
      {role === 'admin' && (
        <section
          aria-label="Status Kondisi Terkini Titik Checkpoint Patroli"
          className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
        >
          {/* Header & Ringkasan Kondisi Titik */}
          <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#0F172A] leading-tight">
                  Daftar Titik Checkpoint &amp; Status Patroli Hari Ini
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Pantau titik yang sudah discan hari ini, belum discan, maupun yang membutuhkan
                  perhatian segera.
                </p>
              </div>
            </div>

            {/* Filter Cepat Status Titik */}
            {checkpointSummary.total > 0 && (
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
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
                    className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      checkpointFilter === tab.id
                        ? 'bg-white text-[#0F172A] shadow-sm'
                        : 'text-slate-600 hover:text-[#0F172A]'
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
            <div className="px-4 sm:px-5 py-3 bg-slate-50/70 border-b border-slate-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-[#059669]" aria-hidden="true" />
                    Aman: <span className="font-mono tabular-nums">{checkpointSummary.aman}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                    <span className="w-2 h-2 rounded-full bg-[#DC2626]" aria-hidden="true" />
                    Perlu Perhatian:{' '}
                    <span className="font-mono tabular-nums">
                      {checkpointSummary.perluPerhatian}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                    <span className="w-2 h-2 rounded-full bg-slate-400" aria-hidden="true" />
                    Belum Discan Hari Ini:{' '}
                    <span className="font-mono tabular-nums">
                      {checkpointSummary.belumHariIni}
                    </span>
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-slate-600 tabular-nums">
                  Cakupan hari ini: {checkpointSummary.terpantauHariIni}/{checkpointSummary.total}{' '}
                  titik
                </span>
              </div>

              <div
                className="h-2 w-full rounded-full bg-slate-200 overflow-hidden flex"
                aria-hidden="true"
              >
                {checkpointSummary.aman > 0 && (
                  <div
                    className="bg-[#059669] h-full transition-all"
                    style={{ width: `${(checkpointSummary.aman / checkpointSummary.total) * 100}%` }}
                  />
                )}
                {checkpointSummary.perluPerhatian > 0 && (
                  <div
                    className="bg-[#DC2626] h-full transition-all"
                    style={{
                      width: `${
                        (checkpointSummary.perluPerhatian / checkpointSummary.total) * 100
                      }%`,
                    }}
                  />
                )}
                {checkpointSummary.belumDipatroli > 0 && (
                  <div
                    className="bg-slate-300 h-full transition-all"
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
              <MapPin className="w-7 h-7 text-slate-300 mx-auto" />
              <p className="text-xs font-semibold text-slate-700">
                Belum Ada Titik Checkpoint Patroli Terdaftar
              </p>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                Tambahkan lokasi pos atau sudut blok beserta UID stiker RFID/NFC melalui tombol
                Kelola Petugas &amp; NFC agar status patroli setiap titik dapat dipantau di sini.
              </p>
            </div>
          ) : filteredCheckpoints.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-slate-500">
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
                    className={`rounded-xl border p-3.5 sm:p-4 flex flex-col justify-between gap-2.5 transition-colors ${
                      isAttention
                        ? 'border-red-300 bg-red-50/50'
                        : isAman
                          ? 'border-emerald-200/80 bg-emerald-50/25'
                          : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    {/* Baris Judul Lokasi & Status Kondisi */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#0F172A] leading-snug flex items-center gap-1.5">
                          <MapPin
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isAttention
                                ? 'text-red-600'
                                : isAman
                                  ? 'text-[#059669]'
                                  : 'text-slate-400'
                            }`}
                          />
                          <span className="truncate">{titik.nama_lokasi}</span>
                        </h3>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                          UID: {titik.rfid_uid}
                          {titik.keterangan ? ` · ${titik.keterangan}` : ''}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`text-xs font-bold inline-flex items-center gap-1 whitespace-nowrap ${
                            isAttention
                              ? 'text-red-700'
                              : isAman
                                ? 'text-emerald-700'
                                : 'text-slate-500'
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
                            scannedToday ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {scannedToday ? 'Sudah discan hari ini' : 'Belum discan hari ini'}
                        </p>
                      </div>
                    </div>

                    {/* Info Scan Terakhir / Catatan Perhatian */}
                    {lastScan ? (
                      <div className="pt-2 border-t border-slate-200/70 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                          <span>
                            Petugas:{' '}
                            <strong className="text-[#0F172A]">{lastScan.nama_petugas}</strong>
                          </span>
                          <span className="font-mono tabular-nums text-slate-500 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                            {formatTanggalWaktu(lastScan.waktu_scan)}
                          </span>
                        </div>

                        {lastScan.catatan ? (
                          <p
                            className={`text-xs rounded-lg px-2.5 py-1.5 leading-relaxed ${
                              isAttention
                                ? 'bg-white border border-red-200 text-red-950 font-medium'
                                : 'bg-white border border-slate-200/80 text-slate-700'
                            }`}
                          >
                            {lastScan.catatan}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500">
                            {scannedToday
                              ? 'Sudah dipatroli hari ini tanpa catatan kendala.'
                              : 'Scan terakhir sebelum hari ini — jadwalkan pengecekan ulang pada shift berjalan.'}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-slate-200/70">
                        <p className="text-[11px] text-slate-500">
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
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-amber-600 shrink-0" />
            <h2 className="text-sm font-bold text-[#0F172A]">
              Imbauan &amp; Info Keamanan Lingkungan
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {securityAnnouncements.slice(0, 4).map((notif) => (
              <article key={notif.id} className="px-4 sm:px-5 py-3.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-amber-700">
                    {notif.sender_name} ({notif.sender_jabatan})
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatTanggalWaktu(notif.created_at)}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-[#0F172A]">{notif.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
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
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Filter Riwayat Patroli
          </p>
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
            {(
              [
                { id: 'semua', label: `Semua (${patroliFeed.length})` },
                {
                  id: 'Aman',
                  label: `Aman (${patroliFeed.filter((l) => l.status_kondisi === 'Aman').length})`,
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
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  kondisiFilter === opt.id
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <SecurityPatrolFeedCard patroliFeed={filteredPatroli} maxItems={25} />
      </div>
    </div>
  );
}
