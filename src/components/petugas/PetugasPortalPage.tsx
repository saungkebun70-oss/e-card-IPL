import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  LogOut,
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
  submitLogPatroliPetugas,
  type PetugasOwnData,
} from '../../lib/dataService';
import { BrandLogo } from '../BrandLogo';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';

interface WebNdefRecord {
  recordType?: string;
  data?: DataView;
}

interface WebNdefReadingEvent extends Event {
  serialNumber?: string;
  message?: {
    records?: WebNdefRecord[];
  };
}

interface WebNdefReader {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((event: WebNdefReadingEvent) => void) | null;
  onreadingerror: (() => void) | null;
}

interface WindowWithNdef extends Window {
  NDEFReader?: new () => WebNdefReader;
}

interface PetugasPortalPageProps {
  session: SessionUser;
  onLogout: () => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

function isSameLocalDay(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function extractNdefText(event: WebNdefReadingEvent): string[] {
  const results: string[] = [];
  if (event.serialNumber) {
    results.push(event.serialNumber.trim().toUpperCase());
  }
  const records = event.message?.records || [];
  const decoder = new TextDecoder();
  for (const rec of records) {
    if (rec.data) {
      try {
        const text = decoder.decode(rec.data).trim().toUpperCase();
        if (text) results.push(text);
      } catch {
        // Abaikan record non-teks
      }
    }
  }
  return results;
}

export function PetugasPortalPage({
  session,
  onLogout,
  onToast,
}: PetugasPortalPageProps) {
  const { brand } = useAppBrand();
  const [data, setData] = useState<PetugasOwnData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // State Patroli NFC & Manual Fallback
  const nfcSupported = typeof window !== 'undefined' && 'NDEFReader' in window;
  const [scanningNfc, setScanningNfc] = useState(false);
  const [nfcStatusText, setNfcStatusText] = useState<string | null>(null);
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
    return () => {
      nfcAbortRef.current?.abort();
    };
  }, [loadData]);

  // Kontak Darurat Pengurus (Ketua & Bendahara)
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
            `Patroli "${res.data.nama_lokasi}" (${res.data.status_kondisi}) berhasil tercatat!`
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
      return;
    }

    const NDEFReaderCtor = (window as unknown as WindowWithNdef).NDEFReader;
    if (!NDEFReaderCtor) {
      setShowManualForm(true);
      onToast(
        'info',
        'Perangkat/browser ini tidak mendukung Web NFC. Gunakan pilihan Input Manual di bawah.'
      );
      return;
    }

    try {
      const controller = new AbortController();
      nfcAbortRef.current = controller;
      const ndef = new NDEFReaderCtor();
      setScanningNfc(true);
      setNfcStatusText('NFC aktif — tempelkan bagian belakang HP ke stiker RFID/NFC titik patroli...');

      await ndef.scan({ signal: controller.signal });

      ndef.onreadingerror = () => {
        setNfcStatusText('Gagal membaca tag NFC. Coba tempelkan kembali lebih dekat ke stiker RFID.');
      };

      ndef.onreading = (event: WebNdefReadingEvent) => {
        const tokens = extractNdefText(event);
        const checkpoints = data?.titikPatroli || [];
        const matched = checkpoints.find((t) =>
          tokens.some(
            (tok) =>
              tok === t.rfid_uid.toUpperCase() ||
              tok.replace(/[:\-\s]/g, '') === t.rfid_uid.toUpperCase().replace(/[:\-\s]/g, '')
          )
        );

        stopNfcScan();

        if (matched) {
          setNfcStatusText(`Tag terbaca: ${matched.nama_lokasi} (${matched.rfid_uid})`);
          void recordPatrolEntry(matched, matched.nama_lokasi, 'NFC Tap');
        } else {
          const rawUid = tokens[0] || 'TAG-TIDAK-TERDAFTAR';
          setNfcStatusText(
            `UID "${rawUid}" belum terdaftar di master titik checkpoint. Hubungi Bendahara atau catat manual.`
          );
          onToast('error', `Tag NFC (${rawUid}) belum terdaftar pada titik patroli.`);
        }
      };
    } catch (err) {
      stopNfcScan();
      const msg =
        err instanceof Error ? err.message : 'Izin NFC ditolak atau sensor NFC HP sedang nonaktif.';
      setNfcStatusText(`Sensor NFC tidak aktif: ${msg}`);
      setShowManualForm(true);
      onToast('error', 'Aktifkan fitur NFC di pengaturan HP Anda, atau gunakan Input Manual.');
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

  const patroliHariIni = useMemo<LogPatroli[]>(() => {
    return (data?.patroliPribadi || []).filter((log) => isSameLocalDay(log.waktu_scan));
  }, [data?.patroliPribadi]);

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

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] text-[#0F172A] pb-12">
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

      <main className="max-w-3xl mx-auto px-4 pt-5 space-y-5">
        {loading && !data ? (
          <div className="space-y-4">
            <div className="h-36 rounded-2xl bg-slate-200/70 animate-pulse" />
            <div className="h-56 rounded-2xl bg-slate-200/70 animate-pulse" />
            <div className="h-44 rounded-2xl bg-slate-200/70 animate-pulse" />
          </div>
        ) : (
          <>
            {/* BAGIAN 1: INFO KEAMANAN, TUGAS SHIFT & PANGGILAN DARURAT PENGURUS */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[#059669] flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-sm sm:text-base font-bold text-[#0F172A]">
                      Info Keamanan &amp; Tugas Shift
                    </h1>
                    <p className="text-xs text-slate-500 truncate">
                      {profil.shift} · Perumahan Saung Kebun
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-mono font-semibold text-emerald-700 shrink-0">
                  {patroliHariIni.length} scan hari ini
                </span>
              </div>

              {/* Papan Instruksi Keamanan dari Pengurus */}
              {data && data.instruksiKeamanan.length > 0 ? (
                <div className="space-y-2">
                  {data.instruksiKeamanan.slice(0, 3).map((info) => (
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

              {/* Tombol Panggilan Darurat ke Pengurus (Ketua & Bendahara) */}
              {emergencyPengurus.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Panggilan Darurat ke Pengurus
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {emergencyPengurus.map((contact) => {
                      const waText = encodeURIComponent(
                        `[LAPORAN KEAMANAN] Halo ${contact.label}, saya ${profil.nama} (${profil.shift}) melaporkan situasi di Perumahan Saung Kebun:`
                      );
                      return (
                        <div
                          key={contact.label}
                          className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[#0F172A] truncate">
                              {contact.label}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                              +{contact.wa}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={`https://wa.me/${contact.wa}?text=${waText}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-[38px] px-2.5 rounded-lg bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>WA</span>
                            </a>
                            <a
                              href={`tel:+${contact.wa}`}
                              className="min-h-[38px] px-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center gap-1"
                            >
                              <PhoneCall className="w-3.5 h-3.5" />
                              <span>Telp</span>
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* BAGIAN 2: PATROLI & SCAN CHECKPOINT NFC HP KE TAG RFID */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-[#0F172A]">
                      Patroli &amp; Scan Checkpoint NFC
                    </h2>
                    <p className="text-xs text-slate-500">
                      Tempelkan HP ke tag RFID/NFC di titik patroli untuk mencatat jam otomatis.
                    </p>
                  </div>
                </div>
              </div>

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
                          ? 'bg-emerald-600 border-emerald-600 text-white'
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

              {/* Tombol Utama Scan NFC */}
              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={submittingPatroli}
                  onClick={() => void handleStartNfcScan()}
                  className={`w-full min-h-[54px] rounded-2xl text-sm sm:text-base font-bold flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-60 ${
                    scanningNfc
                      ? 'bg-amber-600 hover:bg-amber-700 text-white ring-4 ring-amber-200'
                      : 'bg-[#059669] hover:bg-emerald-700 active:scale-[0.99] text-white'
                  }`}
                >
                  {submittingPatroli ? (
                    <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                  ) : (
                    <Smartphone className={`w-5 h-5 shrink-0 ${scanningNfc ? 'animate-pulse' : ''}`} />
                  )}
                  <span>
                    {submittingPatroli
                      ? 'Menyimpan Patroli...'
                      : scanningNfc
                        ? 'Menunggu Tap Tag NFC... (Ketuk untuk Batal)'
                        : 'Mulai Scan NFC Tag Checkpoint'}
                  </span>
                </button>

                {nfcStatusText && (
                  <div className="rounded-xl bg-slate-900 text-emerald-300 px-3.5 py-2.5 text-xs font-medium flex items-center gap-2">
                    <Radio className={`w-4 h-4 shrink-0 ${scanningNfc ? 'animate-ping' : ''}`} />
                    <span>{nfcStatusText}</span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                  <span>
                    {nfcSupported
                      ? 'Web NFC tersedia di perangkat ini (Chrome Android).'
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

              {/* Riwayat Patroli Pribadi Hari Ini */}
              <div className="pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Riwayat Patroli Pribadi Hari Ini
                  </h3>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {patroliHariIni.length} titik
                  </span>
                </div>

                {patroliHariIni.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    Belum ada scan checkpoint hari ini. Mulai patroli dengan mengetuk tombol NFC di
                    atas.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                    {patroliHariIni.map((log) => (
                      <div
                        key={log.id}
                        className="px-3.5 py-3 bg-white flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <p className="text-sm font-bold text-[#0F172A]">{log.nama_lokasi}</p>
                            <span
                              className={`text-[11px] font-semibold ${
                                log.status_kondisi === 'Aman'
                                  ? 'text-emerald-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              · {log.status_kondisi}
                            </span>
                          </div>
                          {log.catatan && (
                            <p className="text-xs text-slate-600 mt-0.5 leading-snug">
                              {log.catatan}
                            </p>
                          )}
                          <p className="text-[11px] text-slate-400 mt-0.5">{log.metode_scan}</p>
                        </div>
                        <span className="text-xs font-mono font-semibold text-slate-600 tabular-nums shrink-0 inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {new Date(log.waktu_scan).toLocaleTimeString('id-ID', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* BAGIAN 3: RIWAYAT HONORARIUM BULANAN & LEMBUR PRIBADI (TERISOLASI KETAT) */}
            <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-[#059669] flex items-center justify-center shrink-0">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-[#0F172A]">
                      Riwayat Honorarium &amp; Lembur Pribadi
                    </h2>
                    <p className="text-xs text-slate-500">
                      Hanya menampilkan penerimaan honor &amp; lembur atas nama Anda.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Total Tercatat
                  </p>
                  <p className="text-sm font-mono font-bold text-[#059669] tabular-nums">
                    {formatRupiah(totalHonorDiterima)}
                  </p>
                </div>
              </div>

              {!data || data.riwayatHonor.length === 0 ? (
                <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 p-6 text-center space-y-1">
                  <ShieldAlert className="w-7 h-7 text-slate-400 mx-auto" />
                  <p className="text-xs font-semibold text-slate-700">
                    Belum Ada Catatan Honorarium / Lembur
                  </p>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    Setiap pencairan honor rutin maupun uang lembur yang dicatat Bendahara untuk
                    akun Anda akan langsung tampil beserta kwitansi digitalnya di sini.
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
                                <span aria-hidden="true" className="text-slate-300">·</span>
                                <span className="text-slate-600 font-medium">{trx.termin}</span>
                              </>
                            )}
                            <span aria-hidden="true" className="text-slate-300">·</span>
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
          </>
        )}
      </main>

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
