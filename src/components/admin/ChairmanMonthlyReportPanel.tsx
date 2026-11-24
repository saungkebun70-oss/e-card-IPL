import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileBarChart2,
  Loader2,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  BULAN_LIST,
  isKetuaRole,
  TAHUN_AKTIF,
  type SessionUser,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../../types';
import {
  formatRupiah,
  formatTanggalSingkat,
  getCurrentBillingMonth,
} from '../../lib/format';
import { buildChairmanMonthlySummaryReport } from '../../lib/financeUtils';
import { downloadChairmanMonthlySummaryPdf } from '../../lib/pdfGenerator';
import { recordAuditLog } from '../../lib/auditLogger';
import { useAppBrand } from '../../lib/brandContext';

interface ChairmanMonthlyReportPanelProps {
  session: SessionUser;
  wargaList: Warga[];
  statusList: StatusEcardBulanan[];
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
  mode?: 'compact' | 'full';
  bulanOverride?: number;
  tahunOverride?: number;
  onPeriodChange?: (bulan: number, tahun: number) => void;
}

export function ChairmanMonthlyReportPanel({
  session,
  wargaList,
  statusList,
  transaksiList,
  transaksiKasList,
  onToast,
  mode = 'full',
  bulanOverride,
  tahunOverride,
  onPeriodChange,
}: ChairmanMonthlyReportPanelProps) {
  const { brand } = useAppBrand();
  const isKetua = isKetuaRole(session);
  const currentMonth = getCurrentBillingMonth();

  const [internalBulan, setInternalBulan] = useState<number>(currentMonth);
  const [internalTahun, setInternalTahun] = useState<number>(TAHUN_AKTIF);
  const [expanded, setExpanded] = useState<boolean>(mode === 'full');
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);

  const selectedBulan = bulanOverride ?? internalBulan;
  const selectedTahun = tahunOverride ?? internalTahun;

  const updatePeriod = (nextBulan: number, nextTahun: number) => {
    setInternalBulan(nextBulan);
    setInternalTahun(nextTahun);
    onPeriodChange?.(nextBulan, nextTahun);
  };

  const report = useMemo(
    () =>
      buildChairmanMonthlySummaryReport(
        selectedTahun,
        selectedBulan,
        wargaList,
        statusList,
        transaksiList,
        transaksiKasList
      ),
    [selectedTahun, selectedBulan, wargaList, statusList, transaksiList, transaksiKasList]
  );

  // Eksklusif untuk Ketua Lingkungan
  if (!isKetua) {
    return null;
  }

  const handleSelectCurrentMonth = () => {
    updatePeriod(currentMonth, TAHUN_AKTIF);
  };

  const handleSelectPrevMonth = () => {
    if (currentMonth === 1) {
      updatePeriod(12, TAHUN_AKTIF - 1);
    } else {
      updatePeriod(currentMonth - 1, TAHUN_AKTIF);
    }
  };

  const handleDownloadChairmanPdf = async () => {
    if (!isKetuaRole(session)) {
      onToast('error', 'Akses ditolak: Laporan Eksekutif Ketua hanya dapat diunduh oleh akun Ketua.');
      return;
    }
    if (generatingPdf) return;
    setGeneratingPdf(true);
    try {
      const result = await downloadChairmanMonthlySummaryPdf(report, brand, { mode: 'download' });
      void recordAuditLog({
        session,
        action: 'EXPORT_CHAIRMAN_MONTHLY_PDF',
        entity: 'laporan_ketua',
        entity_id: report.documentNumber,
        summary: `Ketua (${session.nama_warga}) mengunduh PDF Ringkasan Bulanan Otomatis periode ${report.namaBulan} ${report.tahun} (${report.totalTransaksiTerverifikasi} trx, ${report.expenseLogs.length} log pengeluaran).`,
        metadata: {
          document_number: report.documentNumber,
          bulan: report.bulan,
          tahun: report.tahun,
          total_masuk: report.monthlyCash.totalMasukBulanIni,
          total_keluar: report.monthlyCash.totalKeluarBulanIni,
          saldo_akhir: report.monthlyCash.saldoAkhir,
          expense_logs_count: report.expenseLogs.length,
        },
      });
      if (result.method === 'native_share') {
        if (!result.cancelled) {
          onToast(
            'success',
            `Laporan Ringkasan Bulanan Ketua (${report.namaBulan} ${report.tahun}) siap disimpan atau dibagikan via menu Android.`
          );
        }
      } else {
        onToast(
          'success',
          `Laporan Ringkasan Bulanan Ketua (${report.namaBulan} ${report.tahun}) berhasil diunduh sebagai PDF A4.`
        );
      }
    } catch {
      onToast('error', 'Gagal menyusun PDF Laporan Ringkasan Bulanan Ketua.');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const yearOptions = [TAHUN_AKTIF - 1, TAHUN_AKTIF, TAHUN_AKTIF + 1];
  const mc = report.monthlyCash;
  const isSurplus = report.surplusDefisit >= 0;

  return (
    <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
      {/* Header Panel Eksekutif Ketua */}
      <div className="px-4 sm:px-5 py-4 glass-hero bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] text-white flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-white/15 border border-white/25 text-emerald-200 flex items-center justify-center shrink-0 mt-0.5">
            <FileBarChart2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold tracking-tight text-white">
                Generator Laporan Bulanan Otomatis
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 border border-white/25 text-[10px] font-semibold text-emerald-100">
                <ShieldCheck className="w-3 h-3" />
                Khusus Ketua
              </span>
            </div>
            <p className="text-xs text-indigo-100/90 mt-0.5 leading-snug">
              Kompilasi otomatis total transaksi, metode bayar IPL, dan seluruh log pengeluaran{' '}
              <span className="font-semibold text-white">
                {report.namaBulan} {report.tahun}
              </span>{' '}
              ke satu dokumen PDF A4.
            </p>
            <p className="text-[10px] font-mono text-indigo-200/80 mt-1">
              No. Dokumen: {report.documentNumber}
            </p>
          </div>
        </div>

        {/* Kontrol Periode + Tombol Unduh PDF Ketua */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            aria-label="Pilih Bulan Laporan Ketua"
            value={selectedBulan}
            onChange={(e) => updatePeriod(Number(e.target.value), selectedTahun)}
            className="min-h-[40px] rounded-full border border-white/25 bg-white/15 px-3.5 text-xs sm:text-sm font-semibold text-white focus:border-emerald-300 focus:outline-none [&>option]:text-slate-900"
          >
            {BULAN_LIST.map((b) => (
              <option key={b.angka} value={b.angka}>
                {b.nama}
              </option>
            ))}
          </select>

          <select
            aria-label="Pilih Tahun Laporan Ketua"
            value={selectedTahun}
            onChange={(e) => updatePeriod(selectedBulan, Number(e.target.value))}
            className="min-h-[40px] rounded-full border border-white/25 bg-white/15 px-3.5 text-xs sm:text-sm font-mono font-semibold text-white focus:border-emerald-300 focus:outline-none [&>option]:text-slate-900"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={generatingPdf}
            onClick={() => void handleDownloadChairmanPdf()}
            className="min-h-[40px] px-4 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] disabled:opacity-60 text-[#064E3B] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
          >
            {generatingPdf ? (
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            ) : (
              <Download className="w-4 h-4 shrink-0" />
            )}
            <span>{generatingPdf ? 'Menyusun PDF...' : 'Unduh PDF Ketua'}</span>
          </button>
        </div>
      </div>

      {/* Ringkasan Angka Kompilasi Cepat */}
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSelectCurrentMonth}
              className={`min-h-[34px] px-3 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                selectedBulan === currentMonth && selectedTahun === TAHUN_AKTIF
                  ? 'bg-[#4C1D95] border-[#4C1D95] text-white shadow-xs'
                  : 'bg-white/95 border-indigo-100 text-slate-600 hover:bg-indigo-50'
              }`}
            >
              Bulan Ini
            </button>
            <button
              type="button"
              onClick={handleSelectPrevMonth}
              className={`min-h-[34px] px-3 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                (currentMonth === 1
                  ? selectedBulan === 12 && selectedTahun === TAHUN_AKTIF - 1
                  : selectedBulan === currentMonth - 1 && selectedTahun === TAHUN_AKTIF)
                  ? 'bg-[#4C1D95] border-[#4C1D95] text-white shadow-xs'
                  : 'bg-white/95 border-indigo-100 text-slate-600 hover:bg-indigo-50'
              }`}
            >
              Bulan Lalu
            </button>
          </div>

          {mode === 'compact' && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="min-h-[34px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>{expanded ? 'Tutup Pratinjau' : 'Lihat Pratinjau Ringkasan & Log'}</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* 4 Kartu Total Transaksi Bulanan */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/55 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-emerald-900">
              <span>Total Pemasukan</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            </div>
            <p className="text-sm sm:text-base font-mono font-bold text-emerald-700 tabular-nums mt-1">
              {formatRupiah(mc.totalMasukBulanIni)}
            </p>
            <p className="text-[10px] text-emerald-800/80 mt-0.5 tabular-nums">
              {mc.jumlahTransaksiIpl} IPL · {mc.jumlahPemasukanLain} Kas Lain
            </p>
          </div>

          <div className="rounded-2xl border border-rose-200/80 bg-rose-50/55 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-rose-900">
              <span>Total Pengeluaran</span>
              <TrendingDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            </div>
            <p className="text-sm sm:text-base font-mono font-bold text-rose-700 tabular-nums mt-1">
              {formatRupiah(mc.totalKeluarBulanIni)}
            </p>
            <p className="text-[10px] text-rose-800/80 mt-0.5 tabular-nums">
              {report.expenseLogs.length} log tercatat ({mc.jumlahPengeluaran} sah)
            </p>
          </div>

          <div className="rounded-2xl border border-indigo-100/80 bg-indigo-50/50 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-slate-600">
              <span>{isSurplus ? 'Surplus Bulan Ini' : 'Defisit Bulan Ini'}</span>
              <Wallet className="w-3.5 h-3.5 text-[#4C1D95] shrink-0" />
            </div>
            <p
              className={`text-sm sm:text-base font-mono font-bold tabular-nums mt-1 ${
                isSurplus ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {isSurplus ? '+' : '-'}
              {formatRupiah(Math.abs(report.surplusDefisit))}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
              Saldo Akhir: {formatRupiah(mc.saldoAkhir)}
            </p>
          </div>

          <div className="rounded-2xl border border-sky-200/80 bg-sky-50/55 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-sky-900">
              <span>Kepatuhan IPL</span>
              <Receipt className="w-3.5 h-3.5 text-sky-600 shrink-0" />
            </div>
            <p className="text-sm sm:text-base font-mono font-bold text-sky-800 tabular-nums mt-1">
              {report.compliance.persentaseKepatuhan}%
            </p>
            <p className="text-[10px] text-sky-900/80 mt-0.5 tabular-nums">
              {report.compliance.unitLunas} / {report.compliance.unitAktif} unit aktif lunas
            </p>
          </div>
        </div>

        {/* Pratinjau Lengkap Dokumen Terkompilasi */}
        {expanded && (
          <div className="space-y-4 pt-3 border-t border-indigo-100/70">
            {/* Sorotan Eksekutif Otomatis */}
            <div className="rounded-2xl border border-indigo-100/80 bg-indigo-50/50 p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#0F172A]">
                <Sparkles className="w-3.5 h-3.5 text-[#4C1D95]" />
                <span>Ringkasan Otomatis Periode {report.namaBulan} {report.tahun}</span>
              </div>
              <ul className="space-y-1 text-xs text-slate-700 list-disc pl-4 leading-relaxed">
                {report.executiveHighlights.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            </div>

            {/* Grid 2 Kolom: Metode Pembayaran IPL & Pos Pengeluaran */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-indigo-100/80 bg-white/75 rounded-2xl overflow-hidden">
                <div className="px-3.5 py-2.5 bg-indigo-50/70 border-b border-indigo-100/80 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[#0F172A]">
                    Total IPL per Metode Pembayaran
                  </h3>
                  <span className="text-[11px] font-mono font-semibold text-emerald-700 tabular-nums">
                    {formatRupiah(mc.totalIplBulanIni)}
                  </span>
                </div>
                <div className="divide-y divide-indigo-100/60">
                  {report.metodePembayaranBreakdown.length === 0 ? (
                    <p className="px-3.5 py-4 text-xs text-slate-500 text-center">
                      Belum ada transaksi IPL terverifikasi pada periode ini.
                    </p>
                  ) : (
                    report.metodePembayaranBreakdown.map((item) => (
                      <div
                        key={item.metode}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0F172A] truncate">{item.metode}</p>
                          <p className="text-[10px] text-slate-500 tabular-nums">
                            {item.jumlahTransaksi} transaksi ({item.persentase}%)
                          </p>
                        </div>
                        <span className="font-mono font-bold text-emerald-700 tabular-nums shrink-0">
                          {formatRupiah(item.totalNominal)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border border-indigo-100/80 bg-white/75 rounded-2xl overflow-hidden">
                <div className="px-3.5 py-2.5 bg-indigo-50/70 border-b border-indigo-100/80 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[#0F172A]">
                    Pengeluaran per Pos Anggaran
                  </h3>
                  <span className="text-[11px] font-mono font-semibold text-rose-700 tabular-nums">
                    {formatRupiah(mc.totalKeluarBulanIni)}
                  </span>
                </div>
                <div className="divide-y divide-indigo-100/60">
                  {mc.pengeluaranPerKategori.length === 0 ? (
                    <p className="px-3.5 py-4 text-xs text-slate-500 text-center">
                      Belum ada pengeluaran terverifikasi pada periode ini.
                    </p>
                  ) : (
                    mc.pengeluaranPerKategori.map((kat) => (
                      <div
                        key={kat.kategori}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0F172A] truncate">{kat.kategori}</p>
                          <p className="text-[10px] text-slate-500 tabular-nums">
                            {kat.jumlahTransaksi} log ({kat.persentase}%)
                          </p>
                        </div>
                        <span className="font-mono font-bold text-rose-700 tabular-nums shrink-0">
                          {formatRupiah(kat.totalNominal)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Tabel Log Rincian Pengeluaran Bulanan */}
            <div className="border border-indigo-100/80 bg-white/75 rounded-2xl overflow-hidden">
              <div className="px-3.5 py-2.5 bg-indigo-50/70 border-b border-indigo-100/80 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-[#0F172A]">
                    Log Pengeluaran Bulanan ({report.expenseLogs.length} Catatan)
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    Seluruh catatan pengeluaran yang akan dikompilasi ke dalam PDF Ketua.
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-rose-700 tabular-nums">
                  Total: {formatRupiah(report.totalExpenseAll)}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-indigo-50/50 border-b border-indigo-100/80 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      <th className="py-2 px-3 whitespace-nowrap">Tanggal</th>
                      <th className="py-2 px-3 whitespace-nowrap">No. Bukti</th>
                      <th className="py-2 px-3 whitespace-nowrap">Pos Anggaran</th>
                      <th className="py-2 px-3">Penerima &amp; Uraian</th>
                      <th className="py-2 px-3 whitespace-nowrap">Status</th>
                      <th className="py-2 px-3 text-right whitespace-nowrap">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-100/50">
                    {report.expenseLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-5 px-3 text-center text-slate-500">
                          Belum ada log pengeluaran pada periode {report.namaBulan} {report.tahun}.
                        </td>
                      </tr>
                    ) : (
                      report.expenseLogs.map((exp) => (
                        <tr key={exp.id} className="hover:bg-indigo-50/40">
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                            {formatTanggalSingkat(exp.tanggal)}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                            {exp.noBukti}
                          </td>
                          <td className="py-2 px-3 font-semibold text-[#0F172A] whitespace-nowrap">
                            {exp.kategori}
                          </td>
                          <td className="py-2 px-3 text-slate-700 min-w-[200px]">
                            <span className="font-semibold text-[#0F172A]">{exp.penerima}</span>
                            {exp.termin ? (
                              <span className="ml-1 text-[10px] font-mono text-slate-500">
                                [{exp.termin}]
                              </span>
                            ) : null}
                            {exp.keterangan && exp.keterangan !== '-' ? (
                              <span className="text-slate-600"> — {exp.keterangan}</span>
                            ) : null}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                                exp.statusVerifikasi === 'Terverifikasi'
                                  ? 'bg-[#D1FAE5] text-[#047857] border-emerald-200'
                                  : exp.statusVerifikasi === 'ACC Bendahara'
                                    ? 'bg-sky-50 text-sky-800 border-sky-200'
                                    : 'bg-[#FEF3C7] text-[#B45309] border-amber-200'
                              }`}
                            >
                              {exp.statusVerifikasi === 'Terverifikasi'
                                ? 'Sah'
                                : exp.statusVerifikasi}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-rose-700 tabular-nums whitespace-nowrap">
                            {formatRupiah(exp.nominal)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
