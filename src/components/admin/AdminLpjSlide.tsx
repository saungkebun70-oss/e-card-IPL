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
    <div className="space-y-6">
      {/* Toolbar Kontrol Filter Triwulan & Tombol Ekspor PDF/Cetak A4 */}
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">
            Pilih Periode Laporan Pertanggungjawaban (Per 3 Bulan)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl">
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

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-[#0F172A] inline-flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak A4</span>
          </button>
          <button
            type="button"
            disabled={downloadingPdf}
            onClick={() => void handleDownloadPdf()}
            className="min-h-[44px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            {downloadingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{downloadingPdf ? 'Menyiapkan PDF...' : 'Unduh LPJ PDF A4'}</span>
          </button>
        </div>
      </section>

      {/* Dokumen Resmi LPJ Triwulanan (Siap Cetak A4 Anti-Potong) */}
      <article
        id="printable-report"
        className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-8 space-y-6"
      >
        {/* Kop Resmi Pengurus */}
        <header className="flex items-start gap-4 border-b-2 border-[#0F172A] pb-5">
          <BrandLogo size="lg" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Dokumen Keuangan Resmi · Perumahan Saung Kebun
            </p>
            <h2 className="text-lg sm:text-xl font-extrabold text-[#0F172A] tracking-tight mt-0.5">
              LAPORAN PERTANGGUNGJAWABAN (LPJ) {lpj.labelTriwulan.toUpperCase()} TAHUN {lpj.tahun}
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-1">
              Periode: <strong>{lpj.rentangBulan} {lpj.tahun}</strong> · {brand.kop_resmi}
            </p>
          </div>
        </header>

        {/* 1. Ikhtisar Arus Kas 3 Bulan */}
        <section className="space-y-3 avoid-break">
          <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-[#059669]" />
            <span>1. Ikhtisar Arus Kas ({lpj.rentangBulan} {lpj.tahun})</span>
          </h3>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="text-[11px] font-semibold text-slate-500">Saldo Awal Triwulan</p>
              <p className="text-base font-bold font-mono text-[#0F172A] tabular-nums mt-1.5">
                {formatRupiah(lpj.saldoAwal)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
              <p className="text-[11px] font-semibold text-emerald-800 flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Pemasukan IPL</span>
              </p>
              <p className="text-base font-bold font-mono text-[#059669] tabular-nums mt-1.5">
                {formatRupiah(lpj.totalIpl)}
              </p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-3.5">
              <p className="text-[11px] font-semibold text-sky-800">Pemasukan Lain</p>
              <p className="text-base font-bold font-mono text-sky-700 tabular-nums mt-1.5">
                {formatRupiah(lpj.totalPemasukanLain)}
              </p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/40 p-3.5">
              <p className="text-[11px] font-semibold text-red-800 flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5" />
                <span>Total Pengeluaran</span>
              </p>
              <p className="text-base font-bold font-mono text-red-700 tabular-nums mt-1.5">
                {formatRupiah(lpj.totalPengeluaran)}
              </p>
            </div>
            <div className="col-span-2 lg:col-span-1 rounded-xl bg-[#0F172A] text-white p-3.5">
              <p className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                <span>Saldo Akhir Triwulan</span>
              </p>
              <p className="text-base font-extrabold font-mono text-emerald-400 tabular-nums mt-1.5">
                {formatRupiah(lpj.saldoAkhir)}
              </p>
            </div>
          </div>
        </section>

        {/* 2. Tingkat Kepatuhan Pembayaran Warga */}
        <section className="space-y-3 avoid-break">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <Users className="w-4 h-4 text-[#059669]" />
              <span>2. Tingkat Kepatuhan Pembayaran IPL Warga</span>
            </h3>
            <span className="text-xs font-mono font-bold text-emerald-700">
              Rata-rata: {lpj.rataRataKepatuhan}% ({lpj.totalUnitAktif} Unit Aktif)
            </span>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Periode Bulan</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Unit Aktif</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Unit Lunas</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Kepatuhan</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Estimasi IPL Terkumpul</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lpj.kepatuhanPerBulan.map((row) => (
                  <tr key={row.bulan}>
                    <td className="px-4 py-2.5 font-semibold text-[#0F172A]">
                      {row.namaBulan} {lpj.tahun}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums text-slate-600">
                      {row.unitAktif}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono font-bold tabular-nums text-[#059669]">
                      {row.unitLunas}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-[#0F172A]">
                      {row.persentase}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-700">
                      {formatRupiah(row.nominalTerkumpul)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-emerald-50/60 border-t border-slate-200 font-bold">
                <tr>
                  <td className="px-4 py-2.5 text-[#0F172A]">Rata-rata / Total Triwulan</td>
                  <td className="px-3 py-2.5 text-center font-mono tabular-nums">
                    {lpj.totalUnitAktif}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono">—</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#059669] tabular-nums">
                    {lpj.rataRataKepatuhan}%
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#059669] tabular-nums">
                    {formatRupiah(lpj.totalIpl)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* 3. Rekapitulasi Pengeluaran per Pos Anggaran */}
        <section className="space-y-3 avoid-break">
          <h3 className="text-sm font-bold text-[#0F172A]">
            3. Rekapitulasi Realisasi Pengeluaran per Pos Anggaran
          </h3>

          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Pos Anggaran / Kategori</th>
                  <th className="text-center px-3 py-2.5 font-semibold">Jumlah Trx</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Porsi (%)</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Total Realisasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lpj.pengeluaranPerKategori.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      Belum ada pencatatan pengeluaran anggaran pada {lpj.labelTriwulan} {lpj.tahun}.
                    </td>
                  </tr>
                ) : (
                  lpj.pengeluaranPerKategori.map((item) => (
                    <tr key={item.kategori}>
                      <td className="px-4 py-2.5 font-medium text-[#0F172A]">{item.kategori}</td>
                      <td className="px-3 py-2.5 text-center font-mono tabular-nums text-slate-600">
                        {item.jumlahTransaksi}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
                        {item.persentase}%
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold tabular-nums text-red-700">
                        {formatRupiah(item.totalNominal)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {lpj.pengeluaranPerKategori.length > 0 && (
                <tfoot className="bg-red-50/50 border-t border-slate-200 font-bold">
                  <tr>
                    <td className="px-4 py-2.5 text-[#0F172A]">Total Pengeluaran Triwulan</td>
                    <td className="px-3 py-2.5 text-center font-mono tabular-nums">
                      {lpj.pengeluaranPerKategori.reduce((s, k) => s + k.jumlahTransaksi, 0)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">100%</td>
                    <td className="px-4 py-2.5 text-right font-mono text-red-700 tabular-nums">
                      {formatRupiah(lpj.totalPengeluaran)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        {/* 4. Lembar Pengesahan Resmi + Stempel Digital Pengurus */}
        <section className="pt-4 border-t border-slate-200 avoid-break space-y-6">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span className="font-semibold text-[#0F172A]">4. Lembar Pengesahan Pengurus</span>
            <span>Karawang, {formatTanggal(new Date().toISOString())}</span>
          </div>

          <div className="grid grid-cols-2 gap-6 text-center items-end relative">
            <div className="space-y-14">
              <p className="text-xs font-semibold text-slate-700">Ketua Lingkungan</p>
              <div>
                <div className="border-b border-slate-400 w-40 mx-auto" />
                <p className="text-sm font-bold text-[#0F172A] mt-1.5">Erlangga</p>
                <p className="text-[11px] text-slate-500">Blok B3/7 · Perumahan Saung Kebun</p>
              </div>
            </div>

            <div className="space-y-14 relative">
              <p className="text-xs font-semibold text-slate-700">Bendahara Lingkungan</p>
              <div className="absolute left-1/2 -translate-x-[75%] top-3 pointer-events-none">
                <OfficialStamp size="md" />
              </div>
              <div className="relative z-10">
                <div className="border-b border-slate-400 w-40 mx-auto" />
                <p className="text-sm font-bold text-[#0F172A] mt-1.5">Andriansyah</p>
                <p className="text-[11px] text-slate-500">Blok B7/16 · Perumahan Saung Kebun</p>
              </div>
            </div>
          </div>

          <div className="pt-2 text-center space-y-14">
            <div>
              <p className="text-xs text-slate-500">Mengetahui,</p>
              <p className="text-xs font-bold text-[#0F172A] mt-0.5">
                Ketua RT / RW / Kepala Desa Bengle
              </p>
            </div>
            <div>
              <div className="border-b border-slate-400 w-52 mx-auto" />
              <p className="text-[11px] text-slate-500 mt-1.5">
                ( .................................................... )
              </p>
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}
