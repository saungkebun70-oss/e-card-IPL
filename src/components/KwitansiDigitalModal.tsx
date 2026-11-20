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
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={props.onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden my-auto max-h-[94dvh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Aksi (Disembunyikan saat cetak) */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50 no-print shrink-0">
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

        {/* Lembar Kwitansi Resmi */}
        <div className="overflow-y-auto flex-1">
          <div id="printable-kwitansi" className="p-6 sm:p-8 bg-white text-[#0F172A] space-y-6">
            {/* Kop Resmi Pengurus */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-[#0F172A] pb-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <BrandLogo size="md" className="shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm sm:text-base font-extrabold tracking-tight text-[#0F172A] leading-snug">
                    PENGURUS LINGKUNGAN PERUMAHAN SAUNG KEBUN
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">
                    {brand.kop_resmi}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {isIpl ? 'No. Kwitansi' : 'No. Bukti Kas'}
                </p>
                <p className="text-xs font-mono font-bold text-[#0F172A] mt-0.5">
                  {nomorDokumen}
                </p>
              </div>
            </div>

            {/* Banner Status */}
            <div
              className={`rounded-xl px-4 py-3 flex items-center justify-between gap-3 border ${
                isPengeluaran
                  ? 'bg-red-50/70 border-red-200 text-red-900'
                  : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
              }`}
            >
              <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
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
              <span className="text-[11px] font-mono shrink-0">
                {formatTanggal(tanggalIso)}
              </span>
            </div>

            {/* Tabel Rincian Kwitansi */}
            <div className="border border-slate-200 rounded-xl overflow-hidden text-sm">
              <div className="divide-y divide-slate-200">
                {props.mode === 'ipl' ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1">
                      <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                        Telah Diterima Dari
                      </span>
                      <span className="sm:col-span-8 font-bold text-[#0F172A]">
                        {props.trx.nama_warga}{' '}
                        <span className="font-mono text-emerald-700">
                          (Blok {props.trx.blok_rumah})
                        </span>
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1 bg-slate-50/60">
                      <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                        Untuk Pembayaran
                      </span>
                      <span className="sm:col-span-8 font-semibold text-[#0F172A]">
                        IPL Periode {formatDaftarBulan(props.trx.bulan_dibayar)} {props.trx.tahun}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1">
                      <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                        Metode Pembayaran
                      </span>
                      <span className="sm:col-span-8 text-slate-800">
                        {props.trx.metode_bayar}
                        {props.trx.petugas_penerima ? ` — ${props.trx.petugas_penerima}` : ''}
                      </span>
                    </div>
                    {props.trx.keterangan && (
                      <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1 bg-slate-50/60">
                        <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                          Catatan
                        </span>
                        <span className="sm:col-span-8 text-slate-700">{props.trx.keterangan}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1">
                      <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                        {isPengeluaran ? 'Dibayarkan Kepada' : 'Diterima Dari'}
                      </span>
                      <span className="sm:col-span-8 font-bold text-[#0F172A]">
                        {props.trxKas.penerima_atau_sumber}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1 bg-slate-50/60">
                      <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                        Kategori / Pos Anggaran
                      </span>
                      <span className="sm:col-span-8 font-semibold text-[#0F172A]">
                        {props.trxKas.kategori}
                        {props.trxKas.termin ? ` · ${props.trxKas.termin}` : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1">
                      <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                        Uraian / Keterangan
                      </span>
                      <span className="sm:col-span-8 text-slate-700">
                        {props.trxKas.keterangan || '-'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 px-4 py-2.5 gap-1 bg-slate-50/60">
                      <span className="sm:col-span-4 text-xs font-semibold text-slate-500">
                        Dicatat Oleh
                      </span>
                      <span className="sm:col-span-8 text-slate-700">
                        {props.trxKas.created_by_name}
                      </span>
                    </div>
                  </>
                )}

                {/* Nominal & Terbilang */}
                <div className="px-4 py-3.5 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Terbilang
                    </p>
                    <p className="text-xs sm:text-sm font-semibold italic text-slate-800 mt-0.5">
                      # {terbilangRupiah(nominal)} #
                    </p>
                  </div>
                  <div className="sm:text-right shrink-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Jumlah Nominal
                    </p>
                    <p
                      className={`text-xl font-extrabold font-mono tabular-nums mt-0.5 ${
                        isPengeluaran ? 'text-red-700' : 'text-[#059669]'
                      }`}
                    >
                      {formatRupiah(nominal)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Area Tanda Tangan & Stempel Digital Pengurus */}
            <div className="avoid-break pt-2">
              <p className="text-xs text-slate-600 text-right mb-4">
                Karawang, {formatTanggal(tanggalIso)}
              </p>

              <div className="grid grid-cols-2 gap-6 items-end text-center relative">
                <div className="space-y-12">
                  <p className="text-xs font-semibold text-slate-700">Ketua Lingkungan</p>
                  <div>
                    <div className="border-b border-slate-400 w-36 mx-auto" />
                    <p className="text-xs font-bold text-[#0F172A] mt-1.5">Erlangga</p>
                    <p className="text-[10px] text-slate-500">Perumahan Saung Kebun</p>
                  </div>
                </div>

                <div className="space-y-12 relative">
                  <p className="text-xs font-semibold text-slate-700">Bendahara Lingkungan</p>

                  {/* Stempel Digital Pengurus menimpa estetis area tanda tangan */}
                  <div className="absolute left-1/2 -translate-x-[75%] top-2 pointer-events-none">
                    <OfficialStamp size="md" />
                  </div>

                  <div className="relative z-10">
                    <div className="border-b border-slate-400 w-36 mx-auto" />
                    <p className="text-xs font-bold text-[#0F172A] mt-1.5">Andriansyah</p>
                    <p className="text-[10px] text-slate-500">Pengurus Kas Lingkungan</p>
                  </div>
                </div>
              </div>

              <p className="text-[10px] text-slate-400 text-center mt-5 pt-3 border-t border-slate-100">
                Dokumen kwitansi ini diterbitkan secara elektronik oleh sistem e-Card IPL Digital
                Perumahan Saung Kebun dan sah sebagai bukti transaksi resmi.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Tombol Unduh PDF & Cetak A4 */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2 no-print shrink-0">
          <button
            type="button"
            onClick={props.onClose}
            className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-sm font-semibold text-[#0F172A] inline-flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak A4</span>
          </button>
          <button
            type="button"
            disabled={downloading}
            onClick={() => void handleDownloadPdf()}
            className="min-h-[42px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{downloading ? 'Menyiapkan PDF...' : 'Unduh PDF A4'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
