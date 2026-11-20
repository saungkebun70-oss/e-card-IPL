import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Loader2,
  Printer,
  X,
} from 'lucide-react';
import { type TransaksiIPL, type TransaksiKas } from '../types';
import { useAppBrand } from '../lib/brandContext';
import {
  formatDaftarBulan,
  formatRupiah,
  formatTanggal,
  terbilangRupiah,
} from '../lib/format';
import { downloadKwitansiIplPdf, downloadKwitansiKasPdf } from '../lib/pdfGenerator';
import { BrandLogo } from './BrandLogo';
import { OfficialStamp } from './OfficialStamp';

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

  const isIpl = props.mode === 'ipl';
  const isPengeluaran = props.mode === 'kas' && props.trxKas.jenis === 'pengeluaran';

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
    setDownloading(true);
    try {
      if (props.mode === 'ipl') {
        await downloadKwitansiIplPdf(props.trx, brand);
      } else {
        await downloadKwitansiKasPdf(props.trxKas, brand);
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kwitansi-digital-title"
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-2.5 sm:p-4 overflow-y-auto"
      onClick={props.onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden my-auto max-h-[94dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal (Disembunyikan saat cetak) */}
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50 no-print shrink-0">
          <div className="min-w-0">
            <h3 id="kwitansi-digital-title" className="text-sm font-bold text-[#0F172A] truncate">
              {judulDokumen}
            </h3>
            <p className="text-[11px] font-mono text-slate-500 truncate">{nomorDokumen}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Tutup kwitansi"
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 cursor-pointer shrink-0"
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
                  className="!w-12 !h-12 shrink-0"
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
                  ? 'bg-red-50/70 border-red-200 text-red-900'
                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              }`}
            >
              <CheckCircle2
                className={`w-4 h-4 shrink-0 ${
                  isPengeluaran ? 'text-red-600' : 'text-[#059669]'
                }`}
              />
              <span>
                {isIpl
                  ? props.trx.status_verifikasi === 'Terverifikasi'
                    ? 'TERVERIFIKASI LUNAS — BUKTI PEMBAYARAN SAH'
                    : `STATUS: ${props.trx.status_verifikasi.toUpperCase()}`
                  : isPengeluaran
                    ? 'BUKTI PENGELUARAN KAS LINGKUNGAN'
                    : 'BUKTI PEMASUKAN KAS LAIN-LAIN'}
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
                      <span className="col-span-7 sm:col-span-8 font-bold text-[#0F172A] break-words">
                        {props.trx.nama_warga}{' '}
                        <span className="font-mono text-emerald-700 whitespace-nowrap">
                          (Blok {props.trx.blok_rumah})
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
                        isPengeluaran ? 'text-red-700' : 'text-[#059669]'
                      }`}
                    >
                      {formatRupiah(nominal)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Area Tanda Tangan & Stempel Digital — Stempel Rapi di Area TTD (Tidak Menutupi Nama) */}
            <div className="avoid-break pt-1">
              <p className="text-[11px] sm:text-xs text-slate-600 text-right mb-3">
                Karawang, {formatTanggal(tanggalIso)}
              </p>

              <div className="grid grid-cols-2 gap-4 sm:gap-6 items-end text-center">
                <div>
                  <p className="text-[11px] sm:text-xs font-semibold text-slate-700">
                    Ketua Lingkungan
                  </p>
                  <div className="h-16 sm:h-20" />
                  <div className="border-b border-slate-400 w-28 sm:w-36 mx-auto" />
                  <p className="text-xs font-bold text-[#0F172A] mt-1.5">Erlangga</p>
                  <p className="text-[10px] text-slate-500">Perumahan Saung Kebun</p>
                </div>

                <div>
                  <p className="text-[11px] sm:text-xs font-semibold text-slate-700">
                    Bendahara Lingkungan
                  </p>
                  <div className="h-16 sm:h-20 relative flex items-center justify-center">
                    <div className="pointer-events-none -translate-x-3 sm:-translate-x-5 opacity-85">
                      <OfficialStamp size="sm" />
                    </div>
                  </div>
                  <div className="border-b border-slate-400 w-28 sm:w-36 mx-auto" />
                  <p className="text-xs font-bold text-[#0F172A] mt-1.5">Andriansyah</p>
                  <p className="text-[10px] text-slate-500">Pengurus Kas Lingkungan</p>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 text-center mt-4 pt-3 border-t border-slate-100 leading-relaxed">
                Dokumen kwitansi ini diterbitkan secara elektronik oleh sistem e-Card IPL Digital
                Perumahan Saung Kebun dan sah sebagai bukti transaksi resmi.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Tombol Aksi — Rapi 1 Baris di Tablet/Desktop & Simetris di Mobile */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-200 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 no-print shrink-0">
          <button
            type="button"
            onClick={props.onClose}
            className="w-full sm:w-auto min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            Tutup
          </button>

          <div className="grid grid-cols-2 sm:flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[42px] px-3.5 sm:px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs sm:text-sm font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4 shrink-0" />
              <span>Cetak A4</span>
            </button>
            <button
              type="button"
              disabled={downloading}
              onClick={() => void handleDownloadPdf()}
              className="min-h-[42px] px-3.5 sm:px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {downloading ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Download className="w-4 h-4 shrink-0" />
              )}
              <span>{downloading ? 'Menyiapkan...' : 'Unduh PDF A4'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
