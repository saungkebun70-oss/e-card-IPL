import { useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {
  TAHUN_AKTIF,
  TRIWULAN_LIST,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../../types';
import { useAppBrand } from '../../lib/brandContext';
import { buildQuarterlyLpjReport } from '../../lib/financeUtils';
import { formatRupiah, formatTanggal } from '../../lib/format';
import { downloadLpjTriwulanPdf } from '../../lib/pdfGenerator';
import { BrandLogo } from '../BrandLogo';
import { OfficialStamp } from '../OfficialStamp';

interface AdminLpjSlideProps {
  wargaList: Warga[];
  statusList: StatusEcardBulanan[];
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

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

export function AdminLpjSlide({
  wargaList,
  statusList,
  transaksiList,
  transaksiKasList,
  onToast,
}: AdminLpjSlideProps) {
  const { brand } = useAppBrand();
  const currentQuarter = (Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  const [triwulanId, setTriwulanId] = useState<1 | 2 | 3 | 4>(currentQuarter);
  const [tahun, setTahun] = useState<number>(TAHUN_AKTIF);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const lpj = useMemo(
    () =>
      buildQuarterlyLpjReport(
        tahun,
        triwulanId,
        wargaList,
        statusList,
        transaksiList,
        transaksiKasList
      ),
    [tahun, triwulanId, wargaList, statusList, transaksiList, transaksiKasList]
  );

  const kopAlamat = getCompactKopAlamat(brand.kop_resmi);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      await downloadLpjTriwulanPdf(lpj, brand);
      onToast(
        'success',
        `LPJ ${lpj.labelTriwulan} ${lpj.tahun} format PDF A4 berhasil diunduh.`
      );
    } catch {
      onToast('error', 'Gagal membuat file PDF LPJ. Silakan coba Cetak A4.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar Kontrol Filter Triwulan & Tombol Ekspor PDF/Cetak A4 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 no-print">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">
            Pilih Periode Laporan Pertanggungjawaban (Per 3 Bulan)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl flex-1 sm:flex-none">
              {TRIWULAN_LIST.map((tw) => {
                const active = triwulanId === tw.id;
                return (
                  <button
                    key={tw.id}
                    type="button"
                    onClick={() => setTriwulanId(tw.id as 1 | 2 | 3 | 4)}
                    className={`min-h-[38px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#0F172A] text-white shadow-sm'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    {tw.label}
                  </button>
                );
              })}
            </div>

            <select
              aria-label="Pilih Tahun LPJ"
              value={tahun}
              onChange={(e) => setTahun(Number(e.target.value))}
              className="min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono font-bold text-[#0F172A]"
            >
              {[TAHUN_AKTIF - 1, TAHUN_AKTIF, TAHUN_AKTIF + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] px-3.5 sm:px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs sm:text-sm font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-4 h-4 shrink-0" />
            <span>Cetak A4</span>
          </button>
          <button
            type="button"
            disabled={downloadingPdf}
            onClick={() => void handleDownloadPdf()}
            className="min-h-[44px] px-3.5 sm:px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            {downloadingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Download className="w-4 h-4 shrink-0" />
            )}
            <span>{downloadingPdf ? 'Menyiapkan...' : 'Unduh LPJ PDF A4'}</span>
          </button>
        </div>
      </section>

      {/* Dokumen Resmi LPJ Triwulanan (Presisi A4 Anti-Potong & Rapi di Mobile/Tablet) */}
      <article
        id="printable-report"
        className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-7 print:p-0 space-y-5 print:space-y-3.5"
      >
        {/* Kop Resmi Pengurus — Proporsional Tanpa Memanjang ke Bawah */}
        <header className="flex items-center gap-3 sm:gap-4 border-b-2 border-[#0F172A] pb-3.5 print:pb-2.5">
          <BrandLogo size="sm" variant="light" className="shrink-0 sm:w-12 sm:h-12" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-700 leading-tight">
              Pengurus Lingkungan Perumahan Saung Kebun
            </p>
            <h2 className="text-sm sm:text-lg print:text-base font-extrabold text-[#0F172A] tracking-tight leading-snug mt-0.5">
              LAPORAN PERTANGGUNGJAWABAN (LPJ) {lpj.labelTriwulan.toUpperCase()} {lpj.tahun}
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-600 mt-0.5 leading-snug">
              Periode <strong>{lpj.rentangBulan} {lpj.tahun}</strong> · {kopAlamat}
            </p>
          </div>
        </header>

        {/* 1. Ikhtisar Arus Kas 3 Bulan — Otomatis 5 Kolom Sejajar Saat Cetak A4 */}
        <section className="space-y-2.5 print:space-y-1.5 avoid-break">
          <h3 className="text-xs sm:text-sm print:text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4 text-[#059669] shrink-0 print:w-3.5 print:h-3.5" />
            <span>1. Ikhtisar Arus Kas ({lpj.rentangBulan} {lpj.tahun})</span>
          </h3>

          <div className="grid grid-cols-2 lg:grid-cols-5 print:grid-cols-5 gap-2.5 print:gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 print:p-2">
              <p className="text-[10px] sm:text-[11px] print:text-[9px] font-semibold text-slate-500">
                Saldo Awal
              </p>
              <p className="text-sm sm:text-base print:text-xs font-bold font-mono text-[#0F172A] tabular-nums mt-1">
                {formatRupiah(lpj.saldoAwal)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 print:p-2">
              <p className="text-[10px] sm:text-[11px] print:text-[9px] font-semibold text-emerald-800 flex items-center gap-1">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span>Pemasukan IPL</span>
              </p>
              <p className="text-sm sm:text-base print:text-xs font-bold font-mono text-[#059669] tabular-nums mt-1">
                {formatRupiah(lpj.totalIpl)}
              </p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3 print:p-2">
              <p className="text-[10px] sm:text-[11px] print:text-[9px] font-semibold text-sky-800">
                Pemasukan Lain
              </p>
              <p className="text-sm sm:text-base print:text-xs font-bold font-mono text-sky-700 tabular-nums mt-1">
                {formatRupiah(lpj.totalPemasukanLain)}
              </p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/40 p-3 print:p-2">
              <p className="text-[10px] sm:text-[11px] print:text-[9px] font-semibold text-red-800 flex items-center gap-1">
                <TrendingDown className="w-3 h-3 shrink-0" />
                <span>Pengeluaran</span>
              </p>
              <p className="text-sm sm:text-base print:text-xs font-bold font-mono text-red-700 tabular-nums mt-1">
                {formatRupiah(lpj.totalPengeluaran)}
              </p>
            </div>
            <div className="col-span-2 lg:col-span-1 print:col-span-1 rounded-xl bg-[#0F172A] text-white p-3 print:p-2">
              <p className="text-[10px] sm:text-[11px] print:text-[9px] font-semibold text-slate-300 flex items-center gap-1">
                <Wallet className="w-3 h-3 text-emerald-400 shrink-0" />
                <span>Saldo Akhir</span>
              </p>
              <p className="text-sm sm:text-base print:text-xs font-extrabold font-mono text-emerald-400 tabular-nums mt-1">
                {formatRupiah(lpj.saldoAkhir)}
              </p>
            </div>
          </div>
        </section>

        {/* 2. Tingkat Kepatuhan Pembayaran Warga */}
        <section className="space-y-2 print:space-y-1.5 avoid-break">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs sm:text-sm print:text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
              <Users className="w-4 h-4 text-[#059669] shrink-0 print:w-3.5 print:h-3.5" />
              <span>2. Tingkat Kepatuhan Pembayaran IPL Warga</span>
            </h3>
            <span className="text-[11px] sm:text-xs print:text-[10px] font-mono font-bold text-emerald-700">
              Rata-rata: {lpj.rataRataKepatuhan}% ({lpj.totalUnitAktif} Unit Aktif)
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs print:text-[10px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left px-3 sm:px-4 py-2 print:py-1.5 font-semibold">Periode Bulan</th>
                  <th className="text-center px-2.5 py-2 print:py-1.5 font-semibold">Aktif</th>
                  <th className="text-center px-2.5 py-2 print:py-1.5 font-semibold">Lunas</th>
                  <th className="text-right px-3 sm:px-4 py-2 print:py-1.5 font-semibold">Kepatuhan</th>
                  <th className="text-right px-3 sm:px-4 py-2 print:py-1.5 font-semibold">IPL Terkumpul</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lpj.kepatuhanPerBulan.map((row) => (
                  <tr key={row.bulan}>
                    <td className="px-3 sm:px-4 py-2 print:py-1.5 font-semibold text-[#0F172A] whitespace-nowrap">
                      {row.namaBulan} {lpj.tahun}
                    </td>
                    <td className="px-2.5 py-2 print:py-1.5 text-center font-mono tabular-nums text-slate-600">
                      {row.unitAktif}
                    </td>
                    <td className="px-2.5 py-2 print:py-1.5 text-center font-mono font-bold tabular-nums text-[#059669]">
                      {row.unitLunas}
                    </td>
                    <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono font-bold tabular-nums text-[#0F172A]">
                      {row.persentase}%
                    </td>
                    <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {formatRupiah(row.nominalTerkumpul)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-emerald-50/60 border-t border-slate-200 font-bold">
                <tr>
                  <td className="px-3 sm:px-4 py-2 print:py-1.5 text-[#0F172A]">
                    Rata-rata / Total Triwulan
                  </td>
                  <td className="px-2.5 py-2 print:py-1.5 text-center font-mono tabular-nums">
                    {lpj.totalUnitAktif}
                  </td>
                  <td className="px-2.5 py-2 print:py-1.5 text-center font-mono">—</td>
                  <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono text-[#059669] tabular-nums">
                    {lpj.rataRataKepatuhan}%
                  </td>
                  <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono text-[#059669] tabular-nums whitespace-nowrap">
                    {formatRupiah(lpj.totalIpl)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* 3. Rekapitulasi Pengeluaran per Pos Anggaran */}
        <section className="space-y-2 print:space-y-1.5 avoid-break">
          <h3 className="text-xs sm:text-sm print:text-xs font-bold text-[#0F172A]">
            3. Rekapitulasi Realisasi Pengeluaran per Pos Anggaran
          </h3>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs print:text-[10px]">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left px-3 sm:px-4 py-2 print:py-1.5 font-semibold">
                    Pos Anggaran / Kategori
                  </th>
                  <th className="text-center px-2.5 py-2 print:py-1.5 font-semibold">Trx</th>
                  <th className="text-right px-3 sm:px-4 py-2 print:py-1.5 font-semibold">Porsi</th>
                  <th className="text-right px-3 sm:px-4 py-2 print:py-1.5 font-semibold">
                    Total Realisasi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lpj.pengeluaranPerKategori.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 print:py-3 text-center text-slate-500">
                      Belum ada pencatatan pengeluaran anggaran pada {lpj.labelTriwulan} {lpj.tahun}.
                    </td>
                  </tr>
                ) : (
                  lpj.pengeluaranPerKategori.map((item) => (
                    <tr key={item.kategori}>
                      <td className="px-3 sm:px-4 py-2 print:py-1.5 font-medium text-[#0F172A]">
                        {item.kategori}
                      </td>
                      <td className="px-2.5 py-2 print:py-1.5 text-center font-mono tabular-nums text-slate-600">
                        {item.jumlahTransaksi}
                      </td>
                      <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono tabular-nums text-slate-600">
                        {item.persentase}%
                      </td>
                      <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono font-bold tabular-nums text-red-700 whitespace-nowrap">
                        {formatRupiah(item.totalNominal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {lpj.pengeluaranPerKategori.length > 0 && (
                <tfoot className="bg-red-50/50 border-t border-slate-200 font-bold">
                  <tr>
                    <td className="px-3 sm:px-4 py-2 print:py-1.5 text-[#0F172A]">
                      Total Pengeluaran Triwulan
                    </td>
                    <td className="px-2.5 py-2 print:py-1.5 text-center font-mono tabular-nums">
                      {lpj.pengeluaranPerKategori.reduce((s, k) => s + k.jumlahTransaksi, 0)}
                    </td>
                    <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono">100%</td>
                    <td className="px-3 sm:px-4 py-2 print:py-1.5 text-right font-mono text-red-700 tabular-nums whitespace-nowrap">
                      {formatRupiah(lpj.totalPengeluaran)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {/* 4. Lembar Pengesahan Resmi + Stempel Digital Pengurus (Rapi, Tidak Menutupi Nama) */}
        <section className="pt-3 print:pt-2.5 border-t border-slate-200 avoid-break space-y-4 print:space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs print:text-[10px] text-slate-600">
            <span className="font-bold text-[#0F172A]">4. Lembar Pengesahan Pengurus</span>
            <span>Karawang, {formatTanggal(new Date().toISOString())}</span>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:gap-6 text-center items-end">
            <div>
              <p className="text-xs print:text-[10px] font-semibold text-slate-700">
                Ketua Lingkungan
              </p>
              <div className="h-16 sm:h-20 print:h-14" />
              <div className="border-b border-slate-400 w-32 sm:w-40 mx-auto" />
              <p className="text-xs sm:text-sm print:text-xs font-bold text-[#0F172A] mt-1.5">
                Erlangga
              </p>
              <p className="text-[10px] sm:text-[11px] print:text-[9px] text-slate-500">
                Blok B3/7 · Perumahan Saung Kebun
              </p>
            </div>

            <div>
              <p className="text-xs print:text-[10px] font-semibold text-slate-700">
                Bendahara Lingkungan
              </p>
              <div className="h-16 sm:h-20 print:h-14 relative flex items-center justify-center">
                <div className="pointer-events-none -translate-x-4 sm:-translate-x-6 opacity-85">
                  <OfficialStamp size="sm" />
                </div>
              </div>
              <div className="border-b border-slate-400 w-32 sm:w-40 mx-auto" />
              <p className="text-xs sm:text-sm print:text-xs font-bold text-[#0F172A] mt-1.5">
                Andriansyah
              </p>
              <p className="text-[10px] sm:text-[11px] print:text-[9px] text-slate-500">
                Blok B7/16 · Perumahan Saung Kebun
              </p>
            </div>
          </div>

          <div className="pt-1 text-center">
            <p className="text-[11px] print:text-[10px] text-slate-500">Mengetahui,</p>
            <p className="text-xs print:text-[10px] font-bold text-[#0F172A] mt-0.5">
              Ketua RT / RW / Kepala Desa Bengle
            </p>
            <div className="h-14 sm:h-16 print:h-12" />
            <div className="border-b border-slate-400 w-44 sm:w-52 mx-auto" />
            <p className="text-[10px] text-slate-500 mt-1">
              ( .................................................... )
            </p>
          </div>
        </section>
      </article>
    </div>
  );
}
