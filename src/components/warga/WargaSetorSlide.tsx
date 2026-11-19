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
} from 'lucide-react';
import {
  BULAN_LIST,
  NOMINAL_IPL_STANDAR,
  PETUGAS_PENERIMA,
  REKENING_KAS,
  TAHUN_AKTIF,
  type MetodeBayar,
  type SessionUser,
  type StatusEcardBulanan,
  type Warga,
} from '../../types';
import { copyToClipboard, formatRupiah } from '../../lib/format';
import { submitSetoranWarga } from '../../lib/dataService';
import { compressProofImage, formatFileSize } from '../../lib/imageCompressor';

interface WargaSetorSlideProps {
  session: SessionUser;
  profil: Warga;
  statusBulanan: StatusEcardBulanan[];
  preselectedMonth: number | null;
  onClearPreselected: () => void;
  onSuccessSubmit: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function WargaSetorSlide({
  session,
  profil,
  statusBulanan,
  preselectedMonth,
  onClearPreselected,
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
    if (!file) return;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buktiFile) {
      onToast('error', 'Bukti foto transaksi wajib diunggah sebelum mengirim setoran.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitSetoranWarga(session, {
        bulan_dibayar: selectedMonths,
        metode_bayar: metodeBayar,
        petugas_penerima: metodeBayar === 'Setor Tunai' ? petugasPenerima : undefined,
        nominal: numericNominal,
        keterangan,
        buktiFile,
      });

      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          'Setoran IPL berhasil dikirim dan menunggu verifikasi Pengurus Lingkungan.'
        );
        setSelectedMonths([]);
        setManualNominalEdited(false);
        setNominalInput('0');
        setKeterangan('');
        clearFile();
        await onSuccessSubmit();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Kolom Kiri: Identitas Terkunci, Bulan & Metode */}
      <div className="lg:col-span-7 space-y-6">
        {/* Identitas Terkunci (Read-only) */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-base font-bold text-[#0F172A]">Identitas Penyetor</h2>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Lock className="w-3.5 h-3.5" />
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
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-100 px-3.5 text-sm font-mono font-bold text-slate-700 cursor-not-allowed"
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
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-100 px-3.5 text-sm font-semibold text-slate-700 cursor-not-allowed"
              />
            </div>
          </div>
        </section>

        {/* Pilihan Multi-Bulan */}
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="text-base font-bold text-[#0F172A]">
              Pilih Bulan yang Dibayar ({TAHUN_AKTIF})
            </h2>
            <span className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
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
                  className={`relative flex flex-col justify-between rounded-xl border p-3 min-h-[64px] transition-all select-none ${
                    isLocked
                      ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                      : isChecked
                        ? 'bg-emerald-50 border-[#059669] text-emerald-950 cursor-pointer ring-1 ring-[#059669]'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 cursor-pointer'
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
                      <span className="w-4 h-4 rounded bg-[#059669] text-white flex items-center justify-center">
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
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
          <h2 className="text-base font-bold text-[#0F172A]">Metode Pembayaran</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(
              [
                { value: 'Transfer Bank', label: 'Transfer Bank', icon: CreditCard },
                { value: 'E-Wallet', label: 'E-Wallet', icon: Smartphone },
                { value: 'Setor Tunai', label: 'Setor Tunai', icon: Banknote },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = metodeBayar === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMetodeBayar(opt.value)}
                  className={`min-h-[46px] flex items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-[#0F172A] border-[#0F172A] text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {metodeBayar === 'Transfer Bank' || metodeBayar === 'E-Wallet' ? (
            <div className="space-y-3 pt-1">
              <p className="text-xs font-medium text-slate-600">
                Rekening Resmi Kas Lingkungan Perumahan Saung Kebun:
              </p>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-slate-50/70">
                {REKENING_KAS.filter((r) =>
                  metodeBayar === 'E-Wallet' ? r.tipe === 'E-Wallet' : r.tipe === 'Transfer Bank'
                ).map((rek) => (
                  <div
                    key={rek.nomor}
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
                      className="min-h-[40px] px-3.5 rounded-lg bg-white border border-slate-300 hover:border-emerald-600 text-xs font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      {copiedRek === rek.nomor ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700">Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-500" />
                          <span>Salin Nomor Rekening</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label
                htmlFor="petugas-penerima"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                Pilih Petugas Penerima Setoran Tunai
              </label>
              <select
                id="petugas-penerima"
                value={petugasPenerima}
                onChange={(e) => setPetugasPenerima(e.target.value)}
                className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-medium text-[#0F172A] focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
              >
                {PETUGAS_PENERIMA.map((nama) => (
                  <option key={nama} value={nama}>
                    {nama}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1.5">
                Lampirkan foto kwitansi tunai / bukti serah terima dengan petugas di kolom kanan.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Kolom Kanan: Nominal, Upload Bukti WAJIB & Submit */}
      <div className="lg:col-span-5 space-y-6">
        <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
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
                value={numericNominal > 0 ? numericNominal.toLocaleString('id-ID') : ''}
                onChange={(e) => {
                  setManualNominalEdited(true);
                  setNominalInput(e.target.value.replace(/\D/g, ''));
                }}
                placeholder="0"
                className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white pl-11 pr-4 text-lg font-mono font-bold text-[#0F172A] tabular-nums focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
              <div className="mt-2.5 flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
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
              value={keterangan}
              onChange={(e) => setKeterangan(e.target.value)}
              placeholder="Contoh: Transfer dari rekening a.n. pasangan"
              className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
              onChange={handleFileChange}
              className="sr-only"
              id="upload-bukti-input"
            />

            {!previewUrl ? (
              <label
                htmlFor="upload-bukti-input"
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 hover:border-emerald-600 bg-slate-50 hover:bg-emerald-50/40 p-6 text-center transition-colors cursor-pointer min-h-[168px]"
              >
                <div className="w-11 h-11 rounded-full bg-white border border-slate-200 flex items-center justify-center mb-3">
                  <Upload className="w-5 h-5 text-emerald-700" />
                </div>
                <p className="text-sm font-semibold text-[#0F172A]">
                  {compressing
                    ? 'Mengoptimalkan ukuran foto...'
                    : 'Pilih Foto Bukti Transfer / Kwitansi'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Foto otomatis dikompresi agar unggahan cepat &amp; hemat kuota
                </p>
              </label>
            ) : (
              <div className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-100">
                <img
                  src={previewUrl}
                  alt="Preview bukti transaksi IPL"
                  referrerPolicy="no-referrer"
                  className="w-full max-h-64 object-contain bg-slate-900/5"
                />
                <div className="p-3 bg-white border-t border-slate-200 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-700 font-medium truncate">{buktiFile?.name}</p>
                    {sizeInfo && (
                      <p className="text-[11px] font-mono text-emerald-700 tabular-nums mt-0.5">
                        Ukuran teroptimasi: {sizeInfo}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label
                      htmlFor="upload-bukti-input"
                      className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                    >
                      Ganti
                    </label>
                    <button
                      type="button"
                      onClick={clearFile}
                      aria-label="Hapus foto bukti"
                      className="p-1 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Tombol Kirim — Nonaktif (disabled) sebelum bukti gambar dipilih */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full min-h-[48px] rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{submitting ? 'Mengunggah & Menyimpan...' : 'Submit Setoran'}</span>
            </button>
            {!buktiFile && (
              <p className="text-xs text-slate-500 text-center mt-2">
                Tombol kirim aktif setelah bulan dipilih dan foto bukti transaksi diunggah.
              </p>
            )}
          </div>
        </section>
      </div>
    </form>
  );
}
