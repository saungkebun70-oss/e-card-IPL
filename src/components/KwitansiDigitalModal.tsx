import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Printer,
  X,
} from 'lucide-react';
import { type TransaksiIPL, type TransaksiKas } from '../types';
import { useAppBrand } from '../lib/brandContext';
import {
  formatBlokRumah,
  formatDaftarBulan,
  formatRupiah,
  formatTanggal,
  terbilangRupiah,
} from '../lib/format';
import {
  downloadKwitansiIplPdf,
  downloadKwitansiKasPdf,
  isNativeCapacitorPlatform,
} from '../lib/pdfGenerator';
import { BrandLogo } from './BrandLogo';
import { OfficialStamp } from './OfficialStamp';
import { RoleApprovalStamp } from './RoleApprovalStamp';
import { LoadingSpinner } from './LoadingSpinner';

type KwitansiDigitalModalProps =
  | {
      mode: 'ipl';
      trx: TransaksiIPL;
      onClose: () => void;
    }
  | {
      mode: 'kas';
      trxKas: TransaksiKas;
      onClose: () => void;
    };

function getCompactKopAlamat(kopResmi?: string): string {
  const raw = (kopResmi || '').trim();
  if (!raw) {
    return 'Desa Bengle, Kec. Majalaya, Kab. Karawang · Sekretariat Blok B3/7';
  }
  const stripped = raw
    .replace(/^pengurus\s+lingkungan\s+perumahan\s+saung\s+kebun\s*[—–\-:|·]*\s*/i, '')
    .trim();
  return stripped || raw;
}

export function KwitansiDigitalModal(props: KwitansiDigitalModalProps) {
  const { brand } = useAppBrand();
  const [downloading, setDownloading] = useState(false);
  const [printing, setPrinting] = useState(false);

  const isIpl = props.mode === 'ipl';
  const isPengeluaran = props.mode === 'kas' && props.trxKas.jenis === 'pengeluaran';
  const statusVerifikasi = isIpl
    ? props.trx.status_verifikasi
    : props.trxKas.status_verifikasi || 'Terverifikasi';
  const isFinalVerified = statusVerifikasi === 'Terverifikasi';
  const isAccBendahara = statusVerifikasi === 'ACC Bendahara';

  const nomorDokumen = isIpl ? props.trx.no_kwitansi : props.trxKas.no_bukti;
  const nominal = isIpl ? props.trx.nominal : props.trxKas.nominal;
  const tanggalIso = isIpl
    ? props.trx.verified_at || props.trx.tanggal_setor
    : props.trxKas.tanggal;
  const judulDokumen = isIpl
    ? 'Kwitansi Pembayaran IPL Digital'
    : isPengeluaran
      ? 'Kwitansi Bukti Pengeluaran Kas'
      : 'Kwitansi Bukti Pemasukan Lain';
  const kopAlamat = getCompactKopAlamat(brand.kop_resmi);

  const handleDownloadPdf = async () => {
    if (downloading || printing) return;
    setDownloading(true);
    try {
      if (props.mode === 'ipl') {
        await downloadKwitansiIplPdf(props.trx, brand, { mode: 'download' });
      } else {
        await downloadKwitansiKasPdf(props.trxKas, brand, { mode: 'download' });
      }
    } finally {
      setDownloading(false);
    }
  };

  const handlePrintA4 = async () => {
    if (!isNativeCapacitorPlatform()) {
      window.print();
      return;
    }
    if (downloading || printing) return;
    setPrinting(true);
    try {
      if (props.mode === 'ipl') {
        await downloadKwitansiIplPdf(props.trx, brand, { mode: 'print' });
      } else {
        await downloadKwitansiKasPdf(props.trxKas, brand, { mode: 'print' });
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kwitansi-digital-title"
      className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto animate-modal-backdrop"
      onClick={props.onClose}
    >
      <div
        className="bg-[#FFFDF8] backdrop-blur-xl rounded-t-3xl sm:rounded-3xl max-w-2xl w-full border border-[#E6E2D6] shadow-2xl overflow-hidden my-auto max-h-[94dvh] flex flex-col animate-modal-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden mx-auto mt-2.5 w-10 h-1 rounded-full bg-[#C6D2BF] no-print" aria-hidden="true" />
        {/* Header Modal (Disembunyikan saat cetak) */}
        <div className="px-4 sm:px-5 py-3 border-b border-[#E6E2D6] flex items-center justify-between gap-3 bg-[#F7F4EC] no-print shrink-0">
          <div className="min-w-0">
            <h3 id="kwitansi-digital-title" className="text-sm font-bold font-serif-brand text-[#1B271B] truncate">
              {judulDokumen}
            </h3>
            <p className="text-[11px] font-mono text-[#6E786D] truncate">{nomorDokumen}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Tutup kwitansi"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-full text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/70 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lembar Kwitansi Resmi — Responsif Mobile/Tablet & Presisi Cetak A4 */}
        <div className="overflow-y-auto flex-1">
          <div
            id="printable-kwitansi"
            className="p-4 sm:p-7 print:p-0 bg-white text-[#0F172A] space-y-4 sm:space-y-5 print:space-y-4"
          >
            {/* Kop Resmi Pengurus — Baris 1 Penuh (Logo 48x48 + Judul & Alamat Lebar Penuh) */}
            <header className="space-y-2.5">
              <div className="flex items-center gap-3 w-full pb-3 border-b-2 border-[#0F172A]">
                <BrandLogo
                  size="md"
                  variant="light"
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] sm:text-sm font-extrabold tracking-tight text-[#0F172A] leading-snug">
                    PENGURUS LINGKUNGAN PERUMAHAN SAUNG KEBUN
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                    {kopAlamat}
                  </p>
                </div>
              </div>

              {/* Baris 2 Terpisah: NO. KWITANSI & Tanggal dalam kotak bar horizontal */}
              <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 bg-slate-50 border border-slate-200/80 px-3 py-2 rounded-lg text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
                    {isIpl ? 'No. Kwitansi:' : 'No. Bukti Kas:'}
                  </span>
                  <span className="font-mono font-bold text-[#0F172A] tabular-nums truncate">
                    {nomorDokumen}
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-slate-700 tabular-nums shrink-0">
                  {formatTanggal(tanggalIso)}
                </span>
              </div>
            </header>

            {/* Banner Status Verifikasi / Jenis Transaksi */}
            <div
              className={`rounded-xl px-3.5 py-2.5 flex items-center gap-2 border text-xs font-bold leading-snug ${
                isPengeluaran
                  ? 'bg-[#C87058]/12 border-[#E2A898] text-[#7A311E]'
                  : 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]'
              }`}
            >
              <CheckCircle2
                className={`w-4 h-4 shrink-0 ${
                  isPengeluaran ? 'text-[#C87058]' : 'text-[#243825]'
                }`}
              />
              <span>
                {isIpl
                  ? isFinalVerified
                    ? 'TERVERIFIKASI SAH (BENDAHARA & KETUA) — LUNAS'
                    : isAccBendahara
                      ? 'ACC BENDAHARA — MENUNGGU VERIFIKASI KETUA'
                      : `STATUS: ${statusVerifikasi.toUpperCase()}`
                  : isFinalVerified
                    ? isPengeluaran
                      ? 'BUKTI PENGELUARAN KAS — TERVERIFIKASI SAH (BENDAHARA & KETUA)'
                      : 'BUKTI PEMASUKAN KAS LAIN — TERVERIFIKASI SAH (BENDAHARA & KETUA)'
                    : isAccBendahara
                      ? 'ACC BENDAHARA — MENUNGGU PENGESAHAN KETUA'
                      : 'MENUNGGU VERIFIKASI BENDAHARA'}
              </span>
            </div>

            {/* Tabel Rincian Kwitansi */}
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs sm:text-sm">
              <div className="divide-y divide-slate-200">
                {props.mode === 'ipl' ? (
                  <>
                    <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline">
                      <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                        Diterima Dari
                      </span>
                      <span className="col-span-7 sm:col-span-8 font-bold text-[#1B271B] break-words">
                        {props.trx.nama_warga}{' '}
                        <span className="font-mono text-[#243825] whitespace-nowrap">
                          (Blok {formatBlokRumah(props.trx.blok_rumah) || props.trx.blok_rumah})
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline bg-slate-50/70">
                      <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                        Untuk Pembayaran
                      </span>
                      <span className="col-span-7 sm:col-span-8 font-semibold text-[#0F172A]">
                        IPL {formatDaftarBulan(props.trx.bulan_dibayar)} {props.trx.tahun}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline">
                      <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                        Metode Bayar
                      </span>
                      <span className="col-span-7 sm:col-span-8 text-slate-800">
                        {props.trx.metode_bayar}
                        {props.trx.petugas_penerima ? ` — ${props.trx.petugas_penerima}` : ''}
                      </span>
                    </div>
                    {props.trx.keterangan && (
                      <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline bg-slate-50/70">
                        <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                          Catatan
                        </span>
                        <span className="col-span-7 sm:col-span-8 text-slate-700 break-words">
                          {props.trx.keterangan}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline">
                      <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                        {isPengeluaran ? 'Dibayarkan Ke' : 'Diterima Dari'}
                      </span>
                      <span className="col-span-7 sm:col-span-8 font-bold text-[#0F172A] break-words">
                        {props.trxKas.penerima_atau_sumber}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline bg-slate-50/70">
                      <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                        Pos Anggaran
                      </span>
                      <span className="col-span-7 sm:col-span-8 font-semibold text-[#0F172A]">
                        {props.trxKas.kategori}
                        {props.trxKas.termin ? ` · ${props.trxKas.termin}` : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline">
                      <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                        Keterangan
                      </span>
                      <span className="col-span-7 sm:col-span-8 text-slate-700 break-words">
                        {props.trxKas.keterangan || '-'}
                      </span>
                    </div>
                    <div className="grid grid-cols-12 px-3.5 sm:px-4 py-2.5 gap-2 items-baseline bg-slate-50/70">
                      <span className="col-span-5 sm:col-span-4 text-[11px] sm:text-xs font-semibold text-slate-500">
                        Dicatat Oleh
                      </span>
                      <span className="col-span-7 sm:col-span-8 text-slate-700">
                        {props.trxKas.created_by_name}
                      </span>
                    </div>
                  </>
                )}

                {/* Nominal & Terbilang */}
                <div className="px-3.5 sm:px-4 py-3 bg-slate-50 flex flex-col sm:flex-row print:flex-row sm:items-center print:items-center justify-between gap-2.5">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Terbilang
                    </p>
                    <p className="text-xs font-semibold italic text-slate-800 mt-0.5 leading-snug">
                      # {terbilangRupiah(nominal)} #
                    </p>
                  </div>
                  <div className="pt-2 border-t border-slate-200/80 sm:pt-0 sm:border-t-0 print:pt-0 print:border-t-0 sm:text-right print:text-right shrink-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Jumlah Nominal
                    </p>
                    <p
                      className={`text-lg sm:text-xl font-extrabold font-mono tabular-nums mt-0.5 ${
                        isPengeluaran ? 'text-[#9A422B]' : 'text-[#243825]'
                      }`}
                    >
                      {formatRupiah(nominal)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Area Tanda Tangan & Stempel Digital — Stempel Bulat Tepat di Tengah (Antara Ketua & Bendahara) */}
            <div className="avoid-break pt-1">
              <p className="text-[11px] sm:text-xs text-slate-600 text-right mb-3">
                Karawang, {formatTanggal(tanggalIso)}
              </p>

              <div className="relative grid grid-cols-2 gap-4 sm:gap-6 items-end text-center">
                {/* Stempel Bulat Resmi — Overlay Tepat di Tengah Area TTD */}
                <div className="signature-center-stamp pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[8deg] z-10 opacity-35 mix-blend-multiply">
                  <OfficialStamp
                    size="md"
                    unstyledTransform
                    className="w-20 h-20 sm:w-24 sm:h-24 print:w-24 print:h-24"
                  />
                </div>

                <div>
                  <p className="text-[11px] sm:text-xs font-semibold text-slate-700">
                    Ketua Lingkungan
                  </p>
                  <div className="h-16 sm:h-20 relative flex items-center justify-center">
                    {isFinalVerified ? (
                      <RoleApprovalStamp role="ketua" />
                    ) : (
                      <span className="text-[10px] italic text-slate-400">Menunggu Pengesahan Ketua</span>
                    )}
                  </div>
                  <div className="border-b border-slate-400 w-28 sm:w-36 mx-auto" />
                  <p className="text-xs font-bold text-[#0F172A] mt-1.5">Erlangga</p>
                  <p className="text-[10px] text-slate-500">Perumahan Saung Kebun</p>
                </div>

                <div>
                  <p className="text-[11px] sm:text-xs font-semibold text-slate-700">
                    Bendahara Lingkungan
                  </p>
                  <div className="h-16 sm:h-20 relative flex items-center justify-center">
                    {isFinalVerified || isAccBendahara ? (
                      <RoleApprovalStamp role="bendahara" />
                    ) : (
                      <span className="text-[10px] italic text-slate-400">Menunggu ACC Bendahara</span>
                    )}
                  </div>
                  <div className="border-b border-slate-400 w-28 sm:w-36 mx-auto" />
                  <p className="text-xs font-bold text-[#0F172A] mt-1.5">Andriansyah</p>
                  <p className="text-[10px] text-slate-500">Pengurus Kas Lingkungan</p>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 text-center mt-4 pt-3 border-t border-slate-100 leading-relaxed">
                Dokumen kwitansi ini diterbitkan secara elektronik oleh sistem e-Card IPL Digital
                Perumahan Saung Kebun dengan verifikasi berjenjang (Bendahara &amp; Ketua) dan sah
                sebagai bukti transaksi resmi.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Tombol Aksi — Rapi 1 Baris di Tablet/Desktop & Simetris di Mobile */}
        <div className="px-4 sm:px-5 py-3 bg-[#F7F4EC] border-t border-[#E6E2D6] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 no-print shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={props.onClose}
            className="w-full sm:w-auto min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-xs sm:text-sm font-semibold text-[#4A554A] hover:bg-[#E5EEE3]/50 cursor-pointer"
          >
            Tutup
          </button>

          <div className="grid grid-cols-2 sm:flex items-center gap-2">
            <button
              type="button"
              disabled={printing || downloading}
              onClick={() => void handlePrintA4()}
              className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 disabled:opacity-60 text-xs sm:text-sm font-semibold text-[#1B271B] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-all duration-200 active:scale-[0.97]"
            >
              {printing ? (
                <LoadingSpinner size="xs" tone="current" />
              ) : (
                <Printer className="w-4 h-4" />
              )}
              <span>{printing ? 'Menyiapkan...' : 'Cetak A4'}</span>
            </button>
            <button
              type="button"
              disabled={downloading || printing}
              onClick={() => void handleDownloadPdf()}
              className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-all duration-200 active:scale-[0.97]"
            >
              {downloading ? (
                <LoadingSpinner size="xs" tone="white" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>{downloading ? 'Menyiapkan...' : 'Unduh PDF A4'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
