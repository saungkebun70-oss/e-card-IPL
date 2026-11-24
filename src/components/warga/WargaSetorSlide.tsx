import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Upload,
  X,
  CreditCard,
  Banknote,
  Smartphone,
  AlertCircle,
  Lock,
  Send,
  Loader2,
  QrCode,
} from 'lucide-react';
import {
  BULAN_LIST,
  NOMINAL_IPL_STANDAR,
  PETUGAS_PENERIMA,
  TAHUN_AKTIF,
  type MetodeBayar,
  type PaymentConfig,
  type SessionUser,
  type StatusEcardBulanan,
  type Warga,
} from '../../types';
import { copyToClipboard, formatRupiah } from '../../lib/format';
import { submitSetoranWarga, type SetorSubmitStage } from '../../lib/dataService';
import { compressProofImage, formatFileSize } from '../../lib/imageCompressor';

const SUBMIT_STEPS: Array<{ key: Exclude<SetorSubmitStage, 'idle'>; label: string }> = [
  { key: 'uploading_proof', label: 'Mengunggah foto bukti transfer' },
  { key: 'saving_transaction', label: 'Mencatat transaksi IPL ke server' },
  { key: 'syncing_ecard', label: 'Memperbarui status e-Card bulanan' },
  { key: 'refreshing', label: 'Menyinkronkan data rumah Anda' },
];

const STAGE_BUTTON_LABELS: Record<Exclude<SetorSubmitStage, 'idle'>, string> = {
  uploading_proof: 'Mengunggah foto bukti...',
  saving_transaction: 'Menyimpan transaksi...',
  syncing_ecard: 'Memperbarui e-Card...',
  refreshing: 'Menyinkronkan data...',
};

interface WargaSetorSlideProps {
  session: SessionUser;
  profil: Warga;
  statusBulanan: StatusEcardBulanan[];
  paymentConfig: PaymentConfig;
  preselectedMonth: number | null;
  onClearPreselected: () => void;
  preselectedPetugas?: string | null;
  onClearPreselectedPetugas?: () => void;
  onSuccessSubmit: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function WargaSetorSlide({
  session,
  profil,
  statusBulanan,
  paymentConfig,
  preselectedMonth,
  onClearPreselected,
  preselectedPetugas,
  onClearPreselectedPetugas,
  onSuccessSubmit,
  onToast,
}: WargaSetorSlideProps) {
  const nominalUnit = profil.nominal_iuran || NOMINAL_IPL_STANDAR;

  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [metodeBayar, setMetodeBayar] = useState<MetodeBayar>('Transfer Bank');
  const [petugasPenerima, setPetugasPenerima] = useState<string>(PETUGAS_PENERIMA[0]);
  const [nominalInput, setNominalInput] = useState<string>('0');
  const [manualNominalEdited, setManualNominalEdited] = useState(false);
  const [keterangan, setKeterangan] = useState('');
  const [buktiFile, setBuktiFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sizeInfo, setSizeInfo] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [copiedRek, setCopiedRek] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<SetorSubmitStage>('idle');
  const submitLockRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Terapkan preselectedMonth jika warga datang dari klik kotak matriks
  useEffect(() => {
    if (preselectedMonth !== null) {
      const st = statusBulanan.find((s) => s.bulan === preselectedMonth);
      if (!st || (st.status !== 'Lunas' && st.status !== 'Menunggu Verifikasi')) {
        setSelectedMonths([preselectedMonth]);
        setManualNominalEdited(false);
      }
      onClearPreselected();
    }
  }, [preselectedMonth, statusBulanan, onClearPreselected]);

  // Terapkan preselectedPetugas jika warga datang dari Profil Lingkungan
  useEffect(() => {
    if (preselectedPetugas) {
      setMetodeBayar('Setor Tunai');
      if (PETUGAS_PENERIMA.includes(preselectedPetugas)) {
        setPetugasPenerima(preselectedPetugas);
      }
      onClearPreselectedPetugas?.();
    }
  }, [preselectedPetugas, onClearPreselectedPetugas]);

  // Hitung otomatis nominal jika tidak diedit manual
  useEffect(() => {
    if (!manualNominalEdited) {
      const autoNominal = selectedMonths.length * nominalUnit;
      setNominalInput(String(autoNominal));
    }
  }, [selectedMonths, nominalUnit, manualNominalEdited]);

  // Bersihkan object URL saat unmount/ganti gambar
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const toggleMonth = (bulan: number) => {
    if (submitting) return;
    setManualNominalEdited(false);
    setSelectedMonths((prev) =>
      prev.includes(bulan) ? prev.filter((m) => m !== bulan) : [...prev, bulan].sort((a, b) => a - b)
    );
  };

  const handleCopyRek = async (nomor: string, bank: string) => {
    const ok = await copyToClipboard(nomor);
    if (ok) {
      setCopiedRek(nomor);
      onToast('success', `Nomor rekening ${bank} berhasil disalin.`);
      setTimeout(() => setCopiedRek(null), 2000);
    } else {
      onToast('error', 'Gagal menyalin nomor rekening. Silakan salin manual.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || submitting) return;
    if (!file.type.startsWith('image/')) {
      onToast('error', 'File bukti transaksi harus berupa gambar (JPG, PNG, atau WebP).');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      onToast('error', 'Ukuran gambar mentah maksimal 12 MB.');
      return;
    }
    setCompressing(true);
    try {
      const result = await compressProofImage(file, 1280, 0.78);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setBuktiFile(result.file);
      setPreviewUrl(URL.createObjectURL(result.file));
      setSizeInfo(
        result.wasCompressed
          ? `${formatFileSize(result.originalSize)} → ${formatFileSize(result.compressedSize)}`
          : formatFileSize(result.compressedSize)
      );
    } finally {
      setCompressing(false);
    }
  };

  const clearFile = () => {
    if (submitting) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setBuktiFile(null);
    setPreviewUrl(null);
    setSizeInfo(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const numericNominal = Number(nominalInput.replace(/\D/g, '')) || 0;
  const perMonthNominal =
    selectedMonths.length > 0 ? numericNominal / selectedMonths.length : 0;
  const isBelowStandard =
    selectedMonths.length > 0 && numericNominal > 0 && perMonthNominal < NOMINAL_IPL_STANDAR;

  const canSubmit =
    !submitting &&
    !compressing &&
    selectedMonths.length > 0 &&
    numericNominal > 0 &&
    buktiFile !== null &&
    (metodeBayar !== 'Setor Tunai' || Boolean(petugasPenerima));

  const activeStepIndex = SUBMIT_STEPS.findIndex((s) => s.key === submitStage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current || submitting) return;
    if (!buktiFile) {
      onToast('error', 'Bukti foto transaksi wajib diunggah sebelum mengirim setoran.');
      return;
    }
    submitLockRef.current = true;
    setSubmitting(true);
    setSubmitStage('uploading_proof');
    try {
      const res = await submitSetoranWarga(session, {
        blok_rumah: profil.blok_rumah,
        nama_warga: profil.nama_warga,
        bulan_dibayar: selectedMonths,
        metode_bayar: metodeBayar,
        petugas_penerima: metodeBayar === 'Setor Tunai' ? petugasPenerima : undefined,
        nominal: numericNominal,
        keterangan,
        buktiFile,
        onStageChange: (stage) => setSubmitStage(stage),
      });

      if (res.error) {
        onToast('error', res.error);
      } else {
        setSubmitStage('refreshing');
        onToast(
          'success',
          'Setoran IPL berhasil dikirim dan menunggu verifikasi Pengurus Lingkungan.'
        );
        setSelectedMonths([]);
        setManualNominalEdited(false);
        setNominalInput('0');
        setKeterangan('');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setBuktiFile(null);
        setPreviewUrl(null);
        setSizeInfo(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        await onSuccessSubmit();
      }
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
      setSubmitStage('idle');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-busy={submitting}
      className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
    >
      {/* Kolom Kiri: Identitas Terkunci, Bulan & Metode */}
      <div className={`lg:col-span-7 space-y-6 transition-opacity ${submitting ? 'opacity-70 pointer-events-none' : ''}`}>
        {/* Identitas Terkunci (Read-only) */}
        <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-base font-bold text-[#0F172A]">Identitas Penyetor</h2>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Lock className="w-3.5 h-3.5 text-[#4C1D95]" />
              Terkunci per Rumah
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Blok / No. Rumah
              </label>
              <input
                type="text"
                readOnly
                value={profil.blok_rumah}
                className="w-full min-h-[44px] rounded-2xl border border-indigo-100 bg-indigo-50/50 px-3.5 text-sm font-mono font-bold text-slate-700 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Nama Kepala Keluarga
              </label>
              <input
                type="text"
                readOnly
                value={profil.nama_warga}
                className="w-full min-h-[44px] rounded-2xl border border-indigo-100 bg-indigo-50/50 px-3.5 text-sm font-semibold text-slate-700 cursor-not-allowed"
              />
            </div>
          </div>
        </section>

        {/* Pilihan Multi-Bulan */}
        <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="text-base font-bold text-[#0F172A]">
              Pilih Bulan yang Dibayar ({TAHUN_AKTIF})
            </h2>
            <span className="text-xs font-mono font-semibold text-[#4C1D95] tabular-nums">
              {selectedMonths.length} bulan dipilih
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            Anda dapat mencentang 1 bulan atau beberapa bulan sekaligus.
          </p>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {BULAN_LIST.map((b) => {
              const st = statusBulanan.find((s) => s.bulan === b.angka)?.status;
              const isLocked = st === 'Lunas' || st === 'Menunggu Verifikasi';
              const isChecked = selectedMonths.includes(b.angka);

              return (
                <label
                  key={b.angka}
                  className={`relative flex flex-col justify-between rounded-2xl border p-3 min-h-[64px] transition-all select-none ${
                    isLocked
                      ? 'bg-indigo-50/35 border-indigo-100/70 text-slate-400 cursor-not-allowed'
                      : isChecked
                        ? 'bg-indigo-50 border-[#4C1D95] text-[#3b0764] cursor-pointer ring-1 ring-[#4C1D95]'
                        : 'bg-white/90 border-indigo-100/80 text-slate-700 hover:border-indigo-300 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={isLocked}
                    checked={isChecked}
                    onChange={() => !isLocked && toggleMonth(b.angka)}
                    className="sr-only"
                  />
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-semibold">{b.singkat}</span>
                    {isChecked && !isLocked && (
                      <span className="w-4 h-4 rounded-full bg-[#4C1D95] text-white flex items-center justify-center">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] mt-1 leading-tight">
                    {st === 'Lunas'
                      ? 'Lunas'
                      : st === 'Menunggu Verifikasi'
                        ? 'Pending'
                        : b.nama}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {/* Metode Pembayaran */}
        <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6 space-y-5">
          <h2 className="text-base font-bold text-[#0F172A]">Metode Pembayaran</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {(
              [
                { value: 'QRIS', label: 'Via QR / QRIS', icon: QrCode },
                { value: 'Transfer Bank', label: 'Transfer Bank', icon: CreditCard },
                { value: 'E-Wallet', label: 'E-Wallet', icon: Smartphone },
                { value: 'Setor Tunai', label: 'Titip Pengurus', icon: Banknote },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = metodeBayar === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMetodeBayar(opt.value)}
                  className={`min-h-[46px] flex items-center justify-center gap-1.5 rounded-full border px-3 text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#4C1D95] border-[#4C1D95] text-white shadow-xs'
                      : 'bg-white/95 border-indigo-100 text-slate-700 hover:bg-indigo-50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {metodeBayar === 'QRIS' ? (
            <div className="rounded-2xl border border-indigo-100/80 bg-indigo-50/50 p-4 space-y-3">
              {paymentConfig.qris_aktif && paymentConfig.qris_image_url ? (
                <>
                  <div className="text-center">
                    <p className="text-sm font-bold text-[#0F172A]">
                      {paymentConfig.qris_label || 'QRIS Kas Lingkungan Perumahan Saung Kebun'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {paymentConfig.qris_catatan}
                    </p>
                  </div>
                  <div className="flex justify-center bg-white rounded-2xl border border-indigo-100 p-4">
                    <img
                      src={paymentConfig.qris_image_url}
                      alt="QRIS Kas Lingkungan Perumahan Saung Kebun"
                      referrerPolicy="no-referrer"
                      className="max-h-72 w-auto object-contain rounded-xl"
                    />
                  </div>
                </>
              ) : (
                <div className="py-6 text-center space-y-1.5">
                  <QrCode className="w-8 h-8 text-indigo-300 mx-auto" />
                  <p className="text-sm font-semibold text-[#0F172A]">
                    Kode QRIS Belum Diaktifkan oleh Bendahara
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Silakan pilih metode Transfer Bank, E-Wallet, atau Titip Pengurus, atau hubungi
                    Bendahara (Andriansyah) untuk aktivasi QRIS.
                  </p>
                </div>
              )}
            </div>
          ) : metodeBayar === 'Transfer Bank' || metodeBayar === 'E-Wallet' ? (
            <div className="space-y-3 pt-1">
              <p className="text-xs font-medium text-slate-600">
                Rekening Resmi Kas Lingkungan Perumahan Saung Kebun (dikelola Bendahara):
              </p>
              {(() => {
                const filteredRek = paymentConfig.rekening_list.filter((r) =>
                  metodeBayar === 'E-Wallet' ? r.tipe === 'E-Wallet' : r.tipe === 'Transfer Bank'
                );
                if (filteredRek.length === 0) {
                  return (
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 text-xs text-slate-500 text-center">
                      Belum ada nomor rekening {metodeBayar} yang terdaftar oleh Bendahara.
                    </div>
                  );
                }
                return (
                  <div className="divide-y divide-indigo-100/80 border border-indigo-100/80 rounded-2xl overflow-hidden bg-indigo-50/40">
                    {filteredRek.map((rek) => (
                      <div
                        key={rek.id}
                        className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-500">{rek.bank}</p>
                          <p className="text-base font-mono font-bold text-[#0F172A] tracking-wide tabular-nums mt-0.5">
                            {rek.nomor}
                          </p>
                          <p className="text-xs text-slate-600">a.n. {rek.atasNama}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyRek(rek.nomor, rek.bank)}
                          className="min-h-[40px] px-4 rounded-full bg-white/95 border border-indigo-200 hover:border-[#4C1D95] text-xs font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                        >
                          {copiedRek === rek.nomor ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">Tersalin</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-[#4C1D95]" />
                              <span>Salin Nomor</span>
                            </>
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div>
              <label
                htmlFor="petugas-penerima"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                Pilih Pengurus Penerima (Via Titip Pengurus)
              </label>
              <select
                id="petugas-penerima"
                value={petugasPenerima}
                onChange={(e) => setPetugasPenerima(e.target.value)}
                className="w-full min-h-[46px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm font-medium text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
              >
                {PETUGAS_PENERIMA.map((nama) => (
                  <option key={nama} value={nama}>
                    {nama}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1.5">
                Lampirkan foto kwitansi tunai / bukti serah terima dengan pengurus di kolom kanan.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Kolom Kanan: Nominal, Upload Bukti WAJIB & Submit */}
      <div className="lg:col-span-5 space-y-6">
        <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6 space-y-5">
          <div>
            <label
              htmlFor="nominal-setoran"
              className="block text-sm font-bold text-[#0F172A] mb-1.5"
            >
              Nominal Setoran (Rp)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-mono font-semibold text-slate-500">
                Rp
              </span>
              <input
                id="nominal-setoran"
                type="text"
                inputMode="numeric"
                disabled={submitting}
                value={numericNominal > 0 ? numericNominal.toLocaleString('id-ID') : ''}
                onChange={(e) => {
                  setManualNominalEdited(true);
                  setNominalInput(e.target.value.replace(/\D/g, ''));
                }}
                placeholder="0"
                className="w-full min-h-[48px] rounded-2xl border border-indigo-200/80 bg-white/90 disabled:bg-indigo-50/50 disabled:text-slate-500 pl-11 pr-4 text-lg font-mono font-bold text-[#0F172A] tabular-nums focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1.5 tabular-nums">
              Kalkulasi otomatis: {selectedMonths.length} bulan × {formatRupiah(nominalUnit)} ={' '}
              <span className="font-semibold text-slate-700">
                {formatRupiah(selectedMonths.length * nominalUnit)}
              </span>
              . Dapat diedit manual untuk setoran khusus/dana darurat.
            </p>
            {isBelowStandard && (
              <div className="mt-2.5 flex items-start gap-2 rounded-2xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Nominal di bawah Rp 100.000/bulan akan dicatat pengurus pada pos alokasi dana
                  darurat/setoran khusus.
                </span>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="keterangan-setor"
              className="block text-sm font-semibold text-[#0F172A] mb-1.5"
            >
              Catatan Tambahan (Opsional)
            </label>
            <input
              id="keterangan-setor"
              type="text"
              disabled={submitting}
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Contoh: Transfer dari rekening a.n. pasangan"
              className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 disabled:bg-indigo-50/50 disabled:text-slate-500 px-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
            />
          </div>

          {/* Upload Bukti Transaksi (WAJIB) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-bold text-[#0F172A]">
                Bukti Transaksi / Kwitansi <span className="text-red-600">*</span>
              </label>
              <span className="text-xs font-semibold text-red-700">Wajib Diunggah</span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              disabled={submitting || compressing}
              onChange={handleFileChange}
              className="sr-only"
              id="upload-bukti-input"
            />

            {compressing ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-2xl border border-indigo-200 bg-indigo-50/50 overflow-hidden"
              >
                <div className="h-44 flex flex-col items-center justify-center gap-2.5 bg-indigo-50/70 motion-safe:animate-pulse px-4 text-center">
                  <Loader2 className="w-6 h-6 text-[#4C1D95] animate-spin" />
                  <p className="text-sm font-semibold text-[#0F172A]">
                    Mengoptimalkan foto bukti transfer...
                  </p>
                  <p className="text-xs text-slate-500">
                    Menyesuaikan resolusi agar unggahan cepat &amp; ringan
                  </p>
                </div>
                <div className="p-3 bg-white/90 border-t border-indigo-100 space-y-2">
                  <div className="h-3 w-2/3 rounded bg-indigo-100 motion-safe:animate-pulse" />
                  <div className="h-2.5 w-1/3 rounded bg-indigo-50 motion-safe:animate-pulse" />
                </div>
              </div>
            ) : !previewUrl ? (
              <label
                htmlFor="upload-bukti-input"
                className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-200 hover:border-[#4C1D95] bg-indigo-50/40 hover:bg-indigo-50/80 p-6 text-center transition-colors cursor-pointer min-h-[168px]"
              >
                <div className="w-11 h-11 rounded-full bg-white border border-indigo-100 flex items-center justify-center mb-3 shadow-2xs">
                  <Upload className="w-5 h-5 text-[#4C1D95]" />
                </div>
                <p className="text-sm font-semibold text-[#0F172A]">
                  Pilih Foto Bukti Transfer / Kwitansi
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Foto otomatis dikompresi agar unggahan cepat &amp; hemat kuota
                </p>
              </label>
            ) : (
              <div className="relative rounded-2xl border border-indigo-100 overflow-hidden bg-indigo-50/30">
                <div className="relative">
                  <img
                    src={previewUrl}
                    alt="Preview bukti transaksi IPL"
                    referrerPolicy="no-referrer"
                    className={`w-full max-h-64 object-contain bg-slate-900/5 transition-opacity ${
                      submitting ? 'opacity-50' : 'opacity-100'
                    }`}
                  />
                  {submitting && submitStage === 'uploading_proof' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/35 backdrop-blur-[1px] text-white px-4 text-center">
                      <Loader2 className="w-7 h-7 animate-spin mb-2" />
                      <p className="text-xs font-semibold">Mengirim foto ke server...</p>
                    </div>
                  )}
                </div>
                <div className="p-3 bg-white/95 border-t border-indigo-100 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-700 font-medium truncate">{buktiFile?.name}</p>
                    {sizeInfo && (
                      <p className="text-[11px] font-mono text-emerald-700 tabular-nums mt-0.5">
                        Ukuran teroptimasi: {sizeInfo}
                      </p>
                    )}
                  </div>
                  {!submitting && (
                    <div className="flex items-center gap-2 shrink-0">
                      <label
                        htmlFor="upload-bukti-input"
                        className="text-xs font-semibold text-[#4C1D95] hover:underline cursor-pointer"
                      >
                        Ganti
                      </label>
                      <button
                        type="button"
                        onClick={clearFile}
                        aria-label="Hapus foto bukti"
                        className="p-1 rounded-xl text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Tombol Kirim dengan Spinner & Indikator Progres Granular */}
          <div className="pt-2 space-y-3">
            <button
              type="submit"
              disabled={!canSubmit}
              aria-busy={submitting || compressing}
              className={`w-full min-h-[48px] px-4 rounded-full font-semibold text-sm flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap shadow-sm ${
                submitting
                  ? 'bg-[#312E81] text-white cursor-wait'
                  : compressing
                    ? 'bg-indigo-100 text-slate-600 cursor-wait'
                    : 'bg-[#3730A3] hover:bg-[#312E81] disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white cursor-pointer'
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>
                    {submitStage !== 'idle'
                      ? STAGE_BUTTON_LABELS[submitStage]
                      : 'Memproses setoran...'}
                  </span>
                </>
              ) : compressing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  <span>Mengoptimalkan foto...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 shrink-0" />
                  <span>Submit Setoran</span>
                </>
              )}
            </button>

            {submitting && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#3b0764]">
                    Sedang memproses setoran Anda
                  </span>
                  <span className="font-mono font-semibold text-[#4C1D95] tabular-nums">
                    {Math.max(1, activeStepIndex + 1)}/{SUBMIT_STEPS.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {SUBMIT_STEPS.map((step, idx) => {
                    const isDone = activeStepIndex > idx;
                    const isActive = activeStepIndex === idx;
                    return (
                      <div key={step.key} className="flex items-center gap-2.5 text-xs">
                        {isDone ? (
                          <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                            <Check className="w-2.5 h-2.5" />
                          </span>
                        ) : isActive ? (
                          <Loader2 className="w-4 h-4 text-[#4C1D95] animate-spin shrink-0" />
                        ) : (
                          <span className="w-4 h-4 rounded-full border border-indigo-200 bg-white shrink-0" />
                        )}

                        {isDone || isActive ? (
                          <span
                            className={
                              isActive
                                ? 'font-semibold text-[#0F172A]'
                                : 'text-emerald-800 line-through decoration-emerald-400/70'
                            }
                          >
                            {step.label}
                          </span>
                        ) : (
                          <span className="flex-1 flex items-center gap-2 text-slate-400">
                            <span>{step.label}</span>
                            <span className="h-2 w-12 rounded bg-indigo-100/80 motion-safe:animate-pulse" />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-[11px] text-slate-600 pt-1 border-t border-indigo-200/70">
                  Mohon tunggu sebentar dan jangan menutup halaman sampai proses selesai.
                </p>
              </div>
            )}

            {!buktiFile && !compressing && !submitting && (
              <p className="text-xs text-slate-500 text-center">
                Tombol kirim aktif setelah bulan dipilih dan foto bukti transaksi diunggah.
              </p>
            )}
          </div>
        </section>
      </div>
    </form>
  );
}
