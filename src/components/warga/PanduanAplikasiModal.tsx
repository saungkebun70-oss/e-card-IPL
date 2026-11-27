import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  CreditCard,
  ReceiptText,
  Upload,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  APP_PORTAL_URL,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  TANGGAL_TERBIT_TAGIHAN,
  type Warga,
} from '../../types';
import { formatBlokRumah, formatRupiah } from '../../lib/format';

interface PanduanAplikasiModalProps {
  open: boolean;
  onClose: () => void;
  profil: Pick<Warga, 'blok_rumah' | 'nama_warga' | 'nominal_iuran'>;
  onGoToBeranda?: () => void;
  onGoToSetor?: () => void;
  onGoToRiwayat?: () => void;
  onOpenLingkungan?: () => void;
}

const TOTAL_STEPS = 4;

export function PanduanAplikasiModal({
  open,
  onClose,
  profil,
  onGoToBeranda,
  onGoToSetor,
  onGoToRiwayat,
  onOpenLingkungan,
}: PanduanAplikasiModalProps) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const nominal = profil.nominal_iuran || NOMINAL_IPL_STANDAR;

  const stepMeta = [
    { id: 0, short: '1. Beranda', title: 'Masuk & Kenali e-Card Anda', icon: CreditCard },
    { id: 1, short: '2. Cek Status', title: 'Cara Cek Status e-Card 12 Bulan', icon: Calendar },
    { id: 2, short: '3. Setor IPL', title: 'Cara Setor Iuran IPL', icon: Upload },
    { id: 3, short: '4. Kwitansi', title: 'Kwitansi Digital & Info Pengurus', icon: ReceiptText },
  ] as const;

  const handleNavigate = (action?: () => void) => {
    onClose();
    action?.();
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="panduan-aplikasi-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#1B271B]/55 backdrop-blur-md"
            aria-hidden="true"
          />

          {/* Dialog Container */}
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-2xl max-h-[90vh] bg-[#FFFDF8] backdrop-blur-xl rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Mobile Drag Handle */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-[#C6D2BF]" aria-hidden="true" />
            </div>

            {/* Header */}
            <div className="px-5 sm:px-6 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC] flex items-start justify-between gap-4 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] flex items-center justify-center shrink-0 mt-0.5">
                  <BookOpen className="w-5 h-5 text-[#243825]" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="panduan-aplikasi-title"
                    className="text-base sm:text-lg font-bold font-serif-brand text-[#1B271B] tracking-tight"
                  >
                    Panduan Aplikasi untuk Warga Baru
                  </h2>
                  <p className="text-xs text-[#6E786D] mt-0.5">
                    Perumahan Saung Kebun · Unit{' '}
                    <span className="font-mono font-semibold text-[#1B271B]">
                      {formatBlokRumah(profil.blok_rumah)}
                    </span>{' '}
                    · Langkah <span className="font-mono tabular-nums">{step + 1}/{TOTAL_STEPS}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup Panduan Aplikasi"
                className="min-h-[40px] min-w-[40px] rounded-full text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/70 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Stepper Tab Navigasi */}
            <div className="px-5 sm:px-6 pt-3.5 pb-3 border-b border-[#E6E2D6] bg-[#F6F3EA]/70 shrink-0">
              <div
                role="tablist"
                aria-label="Langkah Panduan Penggunaan Aplikasi"
                className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-[#F7F4EC] border border-[#E6E2D6] rounded-2xl"
              >
                {stepMeta.map((item) => {
                  const Icon = item.icon;
                  const active = step === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setStep(item.id)}
                      className={`min-h-[40px] px-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                          : 'text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/50'
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? 'text-[#E5EEE3]' : 'text-[#6E786D]'
                        }`}
                      />
                      <span className="truncate">{item.short}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Konten Langkah */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-5"
                >
                  {step === 0 && (
                    <>
                      <div>
                        <h3 className="text-base font-bold text-[#1B271B]">
                          01. Masuk &amp; Kenali Beranda e-Card Anda
                        </h3>
                        <p className="text-sm text-[#4A554A] mt-1 leading-relaxed">
                          Selamat datang di portal resmi <strong>e-Card Verifikasi &amp; IPL Digital</strong>{' '}
                          Perumahan Saung Kebun. Akun Anda terkunci khusus untuk unit{' '}
                          <span className="font-mono font-semibold text-[#1B271B]">
                            {formatBlokRumah(profil.blok_rumah) || profil.blok_rumah}
                          </span>{' '}
                          demi menjaga privasi data warga.
                        </p>
                      </div>

                      <ol className="space-y-3 text-sm text-[#4A554A]">
                        <li className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6]">
                          <span className="w-6 h-6 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                            1
                          </span>
                          <div>
                            <p className="font-semibold text-[#1B271B]">Login dengan Blok &amp; PIN 6 Digit</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Buka halaman Portal Warga di{' '}
                              <span className="font-mono text-[#1B271B]">{APP_PORTAL_URL}</span>, lalu masukkan
                              Username Blok Rumah Anda (contoh:{' '}
                              <span className="font-mono font-semibold">
                                {formatBlokRumah(profil.blok_rumah) || profil.blok_rumah}
                              </span>
                              ) dan PIN 6 digit resmi dari pengurus.
                            </p>
                          </div>
                        </li>
                        <li className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6]">
                          <span className="w-6 h-6 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                            2
                          </span>
                          <div>
                            <p className="font-semibold text-[#1B271B]">Lihat Kartu e-Card &amp; Pengumuman</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Pada menu <strong>e-Card</strong>, Anda dapat langsung melihat pengumuman resmi
                              pengurus (jadwal kerja bakti/perawatan) serta kartu identitas iuran rumah Anda.
                            </p>
                          </div>
                        </li>
                        <li className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6]">
                          <span className="w-6 h-6 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                            3
                          </span>
                          <div>
                            <p className="font-semibold text-[#1B271B]">Siklus Tagihan Bulanan</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Tagihan IPL sebesar{' '}
                              <span className="font-mono font-semibold text-[#1B271B] tabular-nums">
                                {formatRupiah(nominal)}/bulan
                              </span>{' '}
                              terbit setiap <strong>tanggal {TANGGAL_TERBIT_TAGIHAN}</strong> dan jatuh tempo
                              setiap <strong>tanggal {TANGGAL_JATUH_TEMPO}</strong>.
                            </p>
                          </div>
                        </li>
                      </ol>

                      {onGoToBeranda && (
                        <button
                          type="button"
                          onClick={() => handleNavigate(onGoToBeranda)}
                          className="min-h-[42px] px-5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] text-[#243825] text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <CreditCard className="w-4 h-4" />
                          <span>Buka Beranda &amp; e-Card</span>
                        </button>
                      )}
                    </>
                  )}

                  {step === 1 && (
                    <>
                      <div>
                        <h3 className="text-base font-bold text-[#1B271B]">
                          02. Cara Cek Status e-Card 12 Bulan ({TAHUN_AKTIF})
                        </h3>
                        <p className="text-sm text-[#4A554A] mt-1 leading-relaxed">
                          Di bawah kartu e-Card pada menu <strong>Beranda</strong>, tersedia tabel matriks 12
                          bulan (Januari hingga Desember {TAHUN_AKTIF}) untuk memantau status pembayaran rumah
                          Anda secara transparan.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="p-3.5 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-[#243825] shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-[#243825]">Lunas</p>
                            <p className="text-xs text-[#384E35] mt-0.5 leading-relaxed">
                              Pembayaran bulan tersebut sudah diterima dan diverifikasi oleh Bendahara.
                            </p>
                          </div>
                        </div>

                        <div className="p-3.5 rounded-2xl bg-[#F2D8A7]/45 border border-[#E2C285] flex items-start gap-3">
                          <Clock className="w-5 h-5 text-[#6E4D12] shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-[#4A3410]">Menunggu Verifikasi</p>
                            <p className="text-xs text-[#6E4D12] mt-0.5 leading-relaxed">
                              Bukti setor Anda sudah masuk dan sedang diperiksa oleh Bendahara.
                            </p>
                          </div>
                        </div>

                        <div className="p-3.5 rounded-2xl bg-[#C87058]/12 border border-[#E2A898] flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-[#9A422B] shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-[#7A311E]">Belum Bayar / Jatuh Tempo</p>
                            <p className="text-xs text-[#9A422B] mt-0.5 leading-relaxed">
                              Ketuk langsung kotak bulan ini untuk otomatis diarahkan ke form
                              Setor Iuran.
                            </p>
                          </div>
                        </div>

                        <div className="p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] flex items-start gap-3">
                          <Calendar className="w-5 h-5 text-[#243825] shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-[#1B271B]">Belum Tagihan</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Periode bulan mendatang. Anda tetap boleh mengetuknya jika ingin membayar di
                              muka beberapa bulan sekaligus.
                            </p>
                          </div>
                        </div>
                      </div>

                      {onGoToBeranda && (
                        <button
                          type="button"
                          onClick={() => handleNavigate(onGoToBeranda)}
                          className="min-h-[42px] px-5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] text-[#243825] text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                        >
                          <Calendar className="w-4 h-4" />
                          <span>Cek Matriks e-Card Saya</span>
                        </button>
                      )}
                    </>
                  )}

                  {step === 2 && (
                    <>
                      <div>
                        <h3 className="text-base font-bold text-[#1B271B]">
                          03. Cara Setor Iuran IPL dengan Mudah
                        </h3>
                        <p className="text-sm text-[#4A554A] mt-1 leading-relaxed">
                          Buka menu <strong>Setor</strong> (atau ketuk bulan yang belum lunas di e-Card) lalu
                          ikuti 4 langkah singkat berikut:
                        </p>
                      </div>

                      <ol className="space-y-2.5 text-sm text-[#4A554A]">
                        <li className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6]">
                          <span className="w-6 h-6 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                            1
                          </span>
                          <div>
                            <p className="font-semibold text-[#1B271B]">Pilih Bulan yang Akan Dibayar</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Anda dapat memilih 1 bulan atau beberapa bulan sekaligus. Total nominal (
                              <span className="font-mono tabular-nums">{formatRupiah(nominal)}</span>/bln) akan
                              terhitung otomatis.
                            </p>
                          </div>
                        </li>

                        <li className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6]">
                          <span className="w-6 h-6 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                            2
                          </span>
                          <div>
                            <p className="font-semibold text-[#1B271B]">Pilih Metode Pembayaran Resmi</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Tersedia 4 pilihan: <strong>Via QR / QRIS</strong> (scan QR resmi),{' '}
                              <strong>Transfer Bank</strong>, <strong>E-Wallet</strong> (salin nomor rekening
                              kas), atau <strong>Titip Pengurus</strong> (pilih nama pengurus penerima tunai).
                            </p>
                          </div>
                        </li>

                        <li className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6]">
                          <span className="w-6 h-6 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                            3
                          </span>
                          <div>
                            <p className="font-semibold text-[#1B271B]">Unggah Foto / Screenshot Bukti Bayar</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Pilih gambar bukti transfer atau kwitansi tunai dari galeri HP Anda. Sistem
                              otomatis mengompres foto agar proses unggah ringan dan cepat.
                            </p>
                          </div>
                        </li>

                        <li className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6]">
                          <span className="w-6 h-6 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                            4
                          </span>
                          <div>
                            <p className="font-semibold text-[#1B271B]">Kirim &amp; Tunggu Verifikasi</p>
                            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                              Tekan <strong>Kirim Setoran IPL</strong>. Status bulan langsung berubah menjadi{' '}
                              <strong>Menunggu Verifikasi</strong> hingga disetujui Bendahara.
                            </p>
                          </div>
                        </li>
                      </ol>

                      {onGoToSetor && (
                        <button
                          type="button"
                          onClick={() => handleNavigate(onGoToSetor)}
                          className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer shadow-xs"
                        >
                          <Upload className="w-4 h-4" />
                          <span>Coba Buka Menu Setor Iuran</span>
                        </button>
                      )}
                    </>
                  )}

                  {step === 3 && (
                    <>
                      <div>
                        <h3 className="text-base font-bold text-[#1B271B]">
                          04. Unduh Kwitansi Digital &amp; Hubungi Pengurus
                        </h3>
                        <p className="text-sm text-[#4A554A] mt-1 leading-relaxed">
                          Setiap setoran yang telah disetujui Bendahara otomatis menghasilkan kwitansi resmi
                          digital yang tersimpan aman di riwayat akun Anda.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <div className="p-4 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] space-y-1.5">
                          <p className="text-sm font-semibold text-[#1B271B]">
                            Riwayat Transaksi &amp; Kwitansi Sah
                          </p>
                          <p className="text-xs text-[#4A554A] leading-relaxed">
                            Buka menu <strong>Riwayat</strong> untuk memantau seluruh setoran Anda (Pending,
                            Terverifikasi, atau Ditolak). Pada transaksi <strong>Terverifikasi</strong>, klik
                            tombol <strong>Cetak / Simpan Kwitansi</strong> sebagai bukti pembayaran sah.
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] space-y-1.5">
                          <p className="text-sm font-semibold text-[#1B271B]">
                            Profil Lingkungan &amp; Susunan Pengurus
                          </p>
                          <p className="text-xs text-[#4A554A] leading-relaxed">
                            Buka menu <strong>Lingkungan</strong> untuk melihat daftar pengurus Saung Kebun
                            (Pembina Bp. Iwan, Ketua Erlangga, Bendahara Andriansyah, Humas Doni &amp; Wahyu,
                            Seksi Olahraga Deny), lokasi blok masing-masing, serta tombol cepat setor tunai.
                          </p>
                        </div>

                        <div className="p-4 rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] space-y-1.5">
                          <p className="text-sm font-semibold text-[#1B271B]">
                            Bantuan Reset PIN atau Ganti Nomor WA
                          </p>
                          <p className="text-xs text-[#4A554A] leading-relaxed">
                            Jika lupa PIN 6 digit atau nomor WhatsApp Anda berubah, gunakan tombol{' '}
                            <strong>Hubungi Pengurus via WhatsApp</strong> pada halaman Profil untuk
                            pembaruan data oleh Bendahara.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {onGoToRiwayat && (
                          <button
                            type="button"
                            onClick={() => handleNavigate(onGoToRiwayat)}
                            className="min-h-[42px] px-4 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] text-[#243825] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <ReceiptText className="w-4 h-4" />
                            <span>Buka Riwayat &amp; Kwitansi</span>
                          </button>
                        )}
                        {onOpenLingkungan && (
                          <button
                            type="button"
                            onClick={() => handleNavigate(onOpenLingkungan)}
                            className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-[#1B271B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Building2 className="w-4 h-4 text-[#243825]" />
                            <span>Lihat Profil Lingkungan</span>
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer Navigasi Langkah */}
            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E6E2D6] bg-[#F7F4EC] flex items-center justify-between gap-3 shrink-0 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
              <button
                type="button"
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 disabled:opacity-40 disabled:cursor-not-allowed text-[#1B271B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Sebelumnya</span>
              </button>

              <span className="text-xs font-mono text-[#6E786D] tabular-nums">
                {step + 1} / {TOTAL_STEPS}
              </span>

              {step < TOTAL_STEPS - 1 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
                  className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                >
                  <span>Langkah Berikutnya</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#E5EEE3]" />
                  <span>Selesai &amp; Mengerti</span>
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
