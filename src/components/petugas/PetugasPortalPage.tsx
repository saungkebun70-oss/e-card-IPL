import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileText,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  MessageCircle,
  PhoneCall,
  Radio,
  RefreshCw,
  Shield,
  ShieldAlert,
  Smartphone,
  Wallet,
} from 'lucide-react';
import {
  SUSUNAN_PENGURUS,
  type LogPatroli,
  type SessionUser,
  type StatusKondisiPatroli,
  type TitikPatroli,
  type TransaksiKas,
} from '../../types';
import { useAppBrand } from '../../lib/brandContext';
import {
  formatRupiah,
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
  describeWebNfcError,
  extractNfcReadingData,
  getNdefReaderConstructor,
  isWebNfcSupported,
  normalizeNfcUid,
  triggerNfcVibrate,
} from '../../lib/webNfc';
import { BrandLogo } from '../BrandLogo';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';
import { PatrolInteractiveMap } from '../PatrolInteractiveMap';

interface PetugasPortalPageProps {
  session: SessionUser;
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
  onLogout,
  onToast,
}: PetugasPortalPageProps) {
  const { brand } = useAppBrand();
  const [activeTab, setActiveTab] = useState<PetugasTab>('info');
  const [data, setData] = useState<PetugasOwnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [riwayatFilter, setRiwayatFilter] = useState<'hari_ini' | 'semua'>('hari_ini');
  const [resettingCycle, setResettingCycle] = useState(false);

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

  // State Kwitansi Honor Pribadi
  const [selectedHonorTrx, setSelectedHonorTrx] = useState<TransaksiKas | null>(null);

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

  useEffect(() => {
    void loadData(false);
    const unsubscribe = subscribePatroliRealtime(session, () => {
      void loadData(true);
    });
    return () => {
      unsubscribe();
      nfcAbortRef.current?.abort();
    };
  }, [loadData, session]);

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
          status_kondisi: statusKondisi,
          catatan: catatanPatroli,
        });
        if (res.error || !res.data) {
          onToast('error', res.error || 'Gagal mencatat patroli.');
        } else {
          onToast(
            'success',
            `Patroli "${res.data.nama_lokasi}" (${res.data.status_kondisi}) berhasil tercatat! Pin peta kini hijau.`
          );
          setCatatanPatroli('');
          setStatusKondisi('Aman');
          await loadData(true);
        }
      } finally {
        setSubmittingPatroli(false);
      }
    },
    [session, statusKondisi, catatanPatroli, onToast, loadData]
  );

  const handleStartNfcScan = async () => {
    if (scanningNfc) {
      stopNfcScan();
      setNfcStatusText(null);
      setNfcStatusError(false);
      return;
    }

    const NDEFReaderCtor = getNdefReaderConstructor();
    if (!NDEFReaderCtor) {
      const msg =
        'Web NFC hanya tersedia di browser Chrome Android (HTTPS). Gunakan pilihan Input Manual di bawah.';
      setShowManualForm(true);
      setNfcStatusError(true);
      setNfcStatusText(msg);
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
          setNfcStatusError(true);
          setNfcStatusText(
            'Tag terdeteksi tetapi tidak berformat NDEF (misal kartu e-Money/MIFARE Classic) atau stiker belum diformat. Gunakan stiker NTAG213/215/216 atau Input Manual.'
          );
        },
        { signal: controller.signal }
      );

      ndef.addEventListener(
        'reading',
        (event) => {
          const { uid, allNormalizedTokens } = extractNfcReadingData(event);
          const checkpoints = data?.titikPatroli || [];
          const matched = checkpoints.find((t) => {
            const normTarget = normalizeNfcUid(t.rfid_uid);
            return normTarget && allNormalizedTokens.includes(normTarget);
          });

          stopNfcScan();

          if (matched) {
            triggerNfcVibrate([100, 50, 100]);
            setNfcStatusError(false);
            setNfcStatusText(
              `Stiker NFC terbaca: ${matched.nama_lokasi} (UID: ${uid || normalizeNfcUid(matched.rfid_uid)})`
            );
            void recordPatrolEntry(matched, matched.nama_lokasi, 'NFC Tap');
          } else {
            const displayUid = uid || 'TIDAK-DIKENAL';
            triggerNfcVibrate([60]);
            setNfcStatusError(true);
            setNfcStatusText(
              `UID "${displayUid}" belum terdaftar di master titik checkpoint. Minta Bendahara mendaftarkannya atau catat manual.`
            );
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

  const handleManualSubmit = async () => {
    const titik = data?.titikPatroli.find((t) => t.id === selectedTitikId) || null;
    if (!titik) {
      onToast('error', 'Pilih titik lokasi patroli terlebih dahulu.');
      return;
    }
    await recordPatrolEntry(titik, titik.nama_lokasi, 'Input Manual');
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

  const totalHonorDiterima = useMemo(() => {
    return (data?.riwayatHonor || []).reduce((sum, item) => sum + item.nominal, 0);
  }, [data?.riwayatHonor]);

  const profil = data?.profil || {
    id: session.petugas_id || '',
    nama: session.nama_warga,
    username: session.blok_rumah,
    no_hp: session.no_wa || '',
    shift: session.shift || 'Shift Keamanan',
  };

  const handleSelectTab = (nextTab: PetugasTab) => {
    if (activeTab === 'scan' && nextTab !== 'scan' && scanningNfc) {
      stopNfcScan();
    }
    setActiveTab(nextTab);
    void loadData(true);
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] text-[#0F172A] pb-28">
      {/* Header Terisolasi Khusus Petugas (Tanpa Tautan ke Portal Admin / Warga) */}
      <header className="sticky top-0 z-30 bg-[#0F172A] text-white border-b border-slate-800 pt-safe">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo size="sm" variant="dark" className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-white leading-tight truncate">
                {profil.nama}
              </p>
              <p className="text-[11px] text-emerald-400 font-medium truncate">
                Petugas Keamanan · {profil.shift}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void loadData(true)}
              aria-label="Muat ulang data petugas"
              className="min-h-[40px] min-w-[40px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="min-h-[40px] px-3 rounded-xl bg-slate-800 hover:bg-red-900/60 text-slate-100 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Keluar</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
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
          {activeTab !== 'peta' && activeCycleProgress.total > 0 && (
            <button
              type="button"
              onClick={() => handleSelectTab('peta')}
              className="shrink-0 rounded-xl bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-right cursor-pointer hover:bg-emerald-100 transition"
            >
              <p className="text-[10px] font-semibold text-emerald-700 leading-none">Siklus Aktif</p>
              <p className="text-xs font-mono font-bold text-[#059669] tabular-nums mt-0.5">
                {activeCycleProgress.scanned}/{activeCycleProgress.total} Titik
              </p>
            </button>
          )}
        </div>

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
                <section className="bg-[#0F172A] text-white rounded-2xl p-4 sm:p-5 border border-slate-800 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                        <Shield className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
                          Shift Bertugas Aktif
                        </p>
                        <p className="text-base font-bold text-white truncate mt-0.5">
                          {profil.shift}
                        </p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          @{profil.username} · Perumahan Saung Kebun
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-xl bg-slate-800/80 border border-slate-700/70 p-3">
                      <p className="text-[11px] text-slate-400">Scan Pribadi Hari Ini</p>
                      <p className="text-lg font-mono font-bold text-white tabular-nums mt-0.5">
                        {patroliHariIni.length}{' '}
                        <span className="text-xs font-sans font-normal text-slate-400">kali</span>
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-800/80 border border-slate-700/70 p-3">
                      <p className="text-[11px] text-slate-400">Progres Peta Shift</p>
                      <p className="text-lg font-mono font-bold text-emerald-400 tabular-nums mt-0.5">
                        {activeCycleProgress.scanned}/{activeCycleProgress.total}{' '}
                        <span className="text-xs font-sans font-normal text-slate-400">titik</span>
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSelectTab('scan')}
                      className="min-h-[44px] rounded-xl bg-[#059669] hover:bg-emerald-600 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Radio className="w-4 h-4 shrink-0" />
                      <span>Mulai Scan NFC</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectTab('peta')}
                      className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <MapIcon className="w-4 h-4 shrink-0 text-emerald-400" />
                      <span>Buka Peta Patroli</span>
                    </button>
                  </div>
                </section>

                {/* Instruksi Keamanan Hari Ini dari Pengurus */}
                <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
                  <h2 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Instruksi Keamanan Hari Ini dari Pengurus</span>
                  </h2>

                  {data && data.instruksiKeamanan.length > 0 ? (
                    <div className="space-y-2.5">
                      {data.instruksiKeamanan.slice(0, 4).map((info) => (
                        <div
                          key={info.id}
                          className="rounded-xl bg-amber-50/70 border border-amber-200/90 px-3.5 py-3 space-y-1"
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
                    <div className="rounded-xl bg-slate-50 border border-slate-200/80 px-3.5 py-3 text-xs text-slate-600 leading-relaxed">
                      Belum ada instruksi keamanan khusus hari ini. Lakukan patroli rutin di seluruh
                      titik checkpoint dan laporkan segera bila ada kondisi mencurigakan.
                    </div>
                  )}
                </section>

                {/* Tombol Panggilan Darurat ke Erlangga (Ketua) & Andriansyah (Bendahara) */}
                {emergencyPengurus.length > 0 && (
                  <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
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
                          `[LAPORAN KEAMANAN] Halo ${contact.label}, saya ${profil.nama} (${profil.shift}) melaporkan situasi di Perumahan Saung Kebun:`
                        );
                        return (
                          <div
                            key={contact.label}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex items-center justify-between gap-2"
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
                                className="min-h-[40px] px-3 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                <span>WA</span>
                              </a>
                              <a
                                href={`tel:+${contact.wa}`}
                                className="min-h-[40px] px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1"
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
              <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setRiwayatFilter('hari_ini')}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        riwayatFilter === 'hari_ini'
                          ? 'bg-white text-[#0F172A] shadow-xs'
                          : 'text-slate-600 hover:text-[#0F172A]'
                      }`}
                    >
                      Hari Ini ({patroliHariIni.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRiwayatFilter('semua')}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        riwayatFilter === 'semua'
                          ? 'bg-white text-[#0F172A] shadow-xs'
                          : 'text-slate-600 hover:text-[#0F172A]'
                      }`}
                    >
                      Semua Riwayat ({data?.patroliPribadi.length || 0})
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSelectTab('scan')}
                    className="min-h-[36px] px-3 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>Scan Baru</span>
                  </button>
                </div>

                {displayedRiwayat.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <ClipboardList className="w-8 h-8 text-slate-300 mx-auto" />
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
                  <div className="divide-y divide-slate-100">
                    {displayedRiwayat.map((log) => {
                      const isAman = log.status_kondisi === 'Aman';
                      return (
                        <div
                          key={log.id}
                          className="px-4 sm:px-5 py-3.5 bg-white flex items-start justify-between gap-3"
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
                              <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg px-2.5 py-1.5 leading-snug">
                                {log.catatan}
                              </p>
                            )}
                            <p className="text-[11px] text-slate-400">
                              Metode: <span className="font-medium text-slate-600">{log.metode_scan}</span>
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-mono font-bold text-[#0F172A] tabular-nums inline-flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-[#059669]" />
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
              <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                {/* Pilihan Kondisi & Catatan Sebelum Tap */}
                <div className="space-y-3 rounded-xl bg-slate-50 border border-slate-200/80 p-3.5">
                  <div>
                    <p className="text-xs font-semibold text-[#0F172A] mb-1.5">
                      Kondisi Area Patroli
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setStatusKondisi('Aman')}
                        className={`min-h-[44px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                          statusKondisi === 'Aman'
                            ? 'bg-[#059669] border-[#059669] text-white'
                            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>Situasi Aman</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatusKondisi('Ada Catatan')}
                        className={`min-h-[44px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                          statusKondisi === 'Ada Catatan'
                            ? 'bg-amber-600 border-amber-600 text-white'
                            : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100'
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
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                    />
                  </div>
                </div>

                {/* Tombol Utama Scan NFC Foreground Anti Pop-up Android */}
                <div className="space-y-2.5">
                  <button
                    type="button"
                    disabled={submittingPatroli}
                    onClick={() => void handleStartNfcScan()}
                    className={`w-full min-h-[58px] rounded-2xl text-sm sm:text-base font-bold flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-60 ${
                      scanningNfc
                        ? 'bg-amber-600 hover:bg-amber-700 text-white ring-4 ring-amber-200'
                        : 'bg-[#059669] hover:bg-emerald-700 active:scale-[0.99] text-white shadow-md shadow-emerald-600/25'
                    }`}
                  >
                    {submittingPatroli ? (
                      <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                    ) : (
                      <Smartphone
                        className={`w-5 h-5 shrink-0 ${scanningNfc ? 'animate-pulse' : ''}`}
                      />
                    )}
                    <span>
                      {submittingPatroli
                        ? 'Menyimpan Patroli...'
                        : scanningNfc
                          ? 'Mode Scan Aktif... (Ketuk untuk Batal)'
                          : 'Mulai Scan Checkpoint NFC'}
                    </span>
                  </button>

                  {nfcStatusText && (
                    <div
                      role="status"
                      className={`rounded-xl px-3.5 py-3 text-xs font-medium flex items-start gap-2.5 border ${
                        nfcStatusError
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-[#0F172A] border-slate-800 text-emerald-300'
                      }`}
                    >
                      {scanningNfc ? (
                        <span className="relative flex h-4 w-4 mt-0.5 shrink-0 items-center justify-center">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-300 opacity-60 [animation-delay:250ms]" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                        </span>
                      ) : nfcStatusError ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <Radio className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      )}
                      <span className="leading-relaxed">{nfcStatusText}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                    <span>
                      {nfcSupported
                        ? 'Web NFC foreground siap (Chrome Android).'
                        : 'Web NFC belum didukung browser ini — gunakan Input Manual.'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowManualForm((v) => !v)}
                      className="font-semibold text-[#059669] hover:underline cursor-pointer shrink-0"
                    >
                      {showManualForm ? 'Sembunyikan Manual' : 'Input Manual'}
                    </button>
                  </div>

                  {/* Fallback Input Manual bila HP tanpa NFC / iOS Safari */}
                  {showManualForm && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                      <p className="text-xs font-bold text-[#0F172A]">
                        Catat Titik Patroli Manual (Fallback Non-NFC)
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2.5">
                        <select
                          value={selectedTitikId}
                          onChange={(e) => setSelectedTitikId(e.target.value)}
                          className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A]"
                        >
                          {(data?.titikPatroli || []).map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.nama_lokasi} ({t.rfid_uid})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={submittingPatroli || !selectedTitikId}
                          onClick={() => void handleManualSubmit()}
                          className="min-h-[44px] px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <MapPin className="w-4 h-4 shrink-0" />
                          <span>Catat Lokasi Ini</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Ringkasan Cepat 3 Scan Terakhir & Tautan ke Peta */}
                <div className="pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-600">
                    Scan hari ini:{' '}
                    <strong className="font-mono text-[#0F172A]">{patroliHariIni.length}</strong>{' '}
                    checkpoint
                  </p>
                  <button
                    type="button"
                    onClick={() => handleSelectTab('peta')}
                    className="text-xs font-bold text-[#059669] hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    <span>Cek Status Pin di Peta</span>
                  </button>
                </div>
              </section>
            )}

            {/* TAB 4: HONOR & LEMBUR PRIBADI (TERISOLASI KETAT) */}
            {activeTab === 'honor' && (
              <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80 p-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-[#059669] text-white flex items-center justify-center shrink-0">
                      <Wallet className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
                        Total Honor &amp; Lembur Tercatat
                      </p>
                      <p className="text-lg font-mono font-extrabold text-[#0F172A] tabular-nums">
                        {formatRupiah(totalHonorDiterima)}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-emerald-800 bg-white/90 border border-emerald-200 rounded-lg px-2.5 py-1">
                    Privasi Pribadi Terisolasi
                  </span>
                </div>

                {!data || data.riwayatHonor.length === 0 ? (
                  <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-7 text-center space-y-1.5">
                    <ShieldAlert className="w-7 h-7 text-slate-400 mx-auto" />
                    <p className="text-xs font-bold text-slate-700">
                      Belum Ada Catatan Honorarium / Lembur
                    </p>
                    <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                      Setiap pencairan honor rutin (Termin Tgl 7 &amp; Tgl 18) maupun uang lembur
                      yang dicatat Bendahara atas nama Anda akan langsung tampil beserta
                      e-Kwitansinya di sini.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {data.riwayatHonor.map((trx) => {
                      const isLembur =
                        trx.jenis_honor === 'lembur' ||
                        trx.kategori.toLowerCase().includes('lembur');
                      return (
                        <div
                          key={trx.id}
                          className="p-3.5 sm:p-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                              <span
                                className={`font-bold ${
                                  isLembur ? 'text-sky-700' : 'text-emerald-700'
                                }`}
                              >
                                {isLembur ? 'Uang Lembur' : 'Honor Rutin'}
                              </span>
                              {trx.termin && (
                                <>
                                  <span aria-hidden="true" className="text-slate-300">
                                    ·
                                  </span>
                                  <span className="text-slate-700 font-semibold">{trx.termin}</span>
                                </>
                              )}
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="font-mono text-slate-500 tabular-nums">
                                {formatTanggal(trx.tanggal)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 line-clamp-2">
                              {trx.keterangan || trx.kategori}
                            </p>
                            <p className="text-[11px] font-mono text-slate-400">{trx.no_bukti}</p>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                            <p className="text-base font-mono font-extrabold text-[#0F172A] tabular-nums">
                              {formatRupiah(trx.nominal)}
                            </p>
                            <button
                              type="button"
                              onClick={() => setSelectedHonorTrx(trx)}
                              className="min-h-[40px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              <FileText className="w-3.5 h-3.5 shrink-0" />
                              <span>e-Kwitansi</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* TAB 5: PETA PATROLI INTERAKTIF REAL-TIME */}
            {activeTab === 'peta' && data && (
              <div className="space-y-3">
                <PatrolInteractiveMap
                  mode="petugas"
                  titikList={data.titikPatroli}
                  patroliLogs={data.patroliCycleLogs}
                  patrolMapConfig={data.patrolMapConfig}
                  canResetCycle={true}
                  onResetCycle={handleResetCycle}
                  resettingCycle={resettingCycle}
                />

                <button
                  type="button"
                  onClick={() => handleSelectTab('scan')}
                  className="w-full min-h-[48px] rounded-2xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-bold inline-flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                >
                  <Radio className="w-4 h-4" />
                  <span>Scan Checkpoint NFC Sekarang</span>
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* BOTTOM NAVIGATION BAR 5 MENU SIMETRIS KHUSUS PETUGAS KEAMANAN */}
      <nav
        aria-label="Navigasi Petugas Keamanan"
        className="fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe shadow-[0_-4px_20px_rgba(15,23,42,0.06)]"
      >
        <div className="max-w-3xl mx-auto grid grid-cols-5 h-16 items-center px-1">
          {/* 1. Info & Shift */}
          <button
            type="button"
            onClick={() => handleSelectTab('info')}
            className={`flex flex-col items-center justify-center gap-0.5 h-full rounded-xl transition cursor-pointer ${
              activeTab === 'info' ? 'text-[#059669]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Shield className={`w-5 h-5 ${activeTab === 'info' ? 'stroke-[2.5]' : ''}`} />
            <span className="text-[10px] font-bold leading-tight">Info &amp; Shift</span>
          </button>

          {/* 2. Riwayat Patroli */}
          <button
            type="button"
            onClick={() => handleSelectTab('riwayat')}
            className={`flex flex-col items-center justify-center gap-0.5 h-full rounded-xl transition cursor-pointer ${
              activeTab === 'riwayat' ? 'text-[#059669]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <ClipboardList className={`w-5 h-5 ${activeTab === 'riwayat' ? 'stroke-[2.5]' : ''}`} />
            <span className="text-[10px] font-bold leading-tight">Riwayat</span>
          </button>

          {/* 3. TENGAH MENONJOL: SCAN NFC FAB */}
          <div className="flex flex-col items-center justify-center relative">
            <button
              type="button"
              onClick={() => handleSelectTab('scan')}
              aria-label="Scan NFC Checkpoint Patroli"
              className={`relative -mt-7 w-14 h-14 rounded-full border-4 border-white flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer ${
                activeTab === 'scan'
                  ? 'bg-emerald-700 text-white shadow-emerald-700/40 scale-105'
                  : 'bg-[#059669] hover:bg-emerald-600 text-white shadow-emerald-600/35'
              }`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-emerald-400/30 animate-ping pointer-events-none"
              />
              <Radio className="w-6 h-6 relative z-10 stroke-[2.5]" />
            </button>
            <span
              className={`text-[10px] font-extrabold leading-tight mt-0.5 ${
                activeTab === 'scan' ? 'text-[#059669]' : 'text-slate-700'
              }`}
            >
              Scan NFC
            </span>
          </div>

          {/* 4. Honor & Lembur */}
          <button
            type="button"
            onClick={() => handleSelectTab('honor')}
            className={`flex flex-col items-center justify-center gap-0.5 h-full rounded-xl transition cursor-pointer ${
              activeTab === 'honor' ? 'text-[#059669]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Wallet className={`w-5 h-5 ${activeTab === 'honor' ? 'stroke-[2.5]' : ''}`} />
            <span className="text-[10px] font-bold leading-tight">Honor</span>
          </button>

          {/* 5. Peta Patroli */}
          <button
            type="button"
            onClick={() => handleSelectTab('peta')}
            className={`flex flex-col items-center justify-center gap-0.5 h-full rounded-xl transition cursor-pointer ${
              activeTab === 'peta' ? 'text-[#059669]' : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <MapIcon className={`w-5 h-5 ${activeTab === 'peta' ? 'stroke-[2.5]' : ''}`} />
            <span className="text-[10px] font-bold leading-tight">Peta</span>
          </button>
        </div>
      </nav>

      {selectedHonorTrx && (
        <KwitansiDigitalModal
          mode="kas"
          trxKas={selectedHonorTrx}
          onClose={() => setSelectedHonorTrx(null)}
        />
      )}
    </div>
  );
}
