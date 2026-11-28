import { useEffect, useMemo, useState } from 'react';
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
import { useSimulation } from '../../lib/simulationContext';

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
  const { simNow, simDateIso } = useSimulation();
  const isSimulation = Boolean(session.is_simulation);
  const effectiveNow = useMemo(
    () => (isSimulation ? simNow : undefined),
    [isSimulation, simDateIso, simNow]
  );
  const isKetua = isKetuaRole(session);
  const currentMonth = getCurrentBillingMonth(effectiveNow);
  const activeYear = effectiveNow ? effectiveNow.getFullYear() : TAHUN_AKTIF;

  const [internalBulan, setInternalBulan] = useState<number>(currentMonth);
  const [internalTahun, setInternalTahun] = useState<number>(activeYear);
  const [expanded, setExpanded] = useState<boolean>(mode === 'full');
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);

  useEffect(() => {
    if (isSimulation && bulanOverride === undefined) {
      setInternalBulan(getCurrentBillingMonth(simNow));
      setInternalTahun(simNow.getFullYear());
    }
  }, [isSimulation, simDateIso, simNow, bulanOverride]);

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
        transaksiKasList,
        brand,
        effectiveNow
      ),
    [selectedTahun, selectedBulan, wargaList, statusList, transaksiList, transaksiKasList, brand, effectiveNow]
  );

  // Eksklusif untuk Ketua Lingkungan
  if (!isKetua) {
    return null;
  }

  const handleSelectCurrentMonth = () => {
    updatePeriod(currentMonth, activeYear);
  };

  const handleSelectPrevMonth = () => {
    if (currentMonth === 1) {
      updatePeriod(12, activeYear - 1);
    } else {
      updatePeriod(currentMonth - 1, activeYear);
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
    <section className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-[0_8px_24px_-12px_rgba(27,39,27,0.08)]">
      {/* Header Panel Eksekutif Ketua */}
      <div className="px-4 sm:px-5 py-4 bg-gradient-to-r from-[#243825] via-[#2B3F29] to-[#384E35] text-[#FFFDF8] flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-white/15 border border-white/25 text-[#E5EEE3] flex items-center justify-center shrink-0 mt-0.5">
            <FileBarChart2 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold tracking-tight text-[#FFFDF8]">
                Generator Laporan Bulanan Otomatis
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 border border-white/25 text-[10px] font-semibold text-[#E5EEE3]">
                <ShieldCheck className="w-3 h-3" />
                Khusus Ketua
              </span>
            </div>
            <p className="text-xs text-[#E5EEE3]/90 mt-0.5 leading-snug">
              Kompilasi otomatis total transaksi, metode bayar IPL, dan seluruh log pengeluaran{' '}
              <span className="font-semibold text-[#FFFDF8]">
                {report.namaBulan} {report.tahun}
              </span>{' '}
              ke satu dokumen PDF A4.
            </p>
            <p className="text-[10px] font-mono text-[#E5EEE3]/75 mt-1">
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
            className="min-h-[40px] rounded-full border border-white/25 bg-white/15 px-3.5 text-xs sm:text-sm font-semibold text-[#FFFDF8] focus:border-[#E5EEE3] focus:outline-none [&>option]:text-[#1B271B]"
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
            className="min-h-[40px] rounded-full border border-white/25 bg-white/15 px-3.5 text-xs sm:text-sm font-mono font-semibold text-[#FFFDF8] focus:border-[#E5EEE3] focus:outline-none [&>option]:text-[#1B271B]"
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
            className="min-h-[40px] px-4 rounded-full bg-[#E5EEE3] hover:bg-[#FFFDF8] disabled:opacity-60 text-[#243825] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
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
                  ? 'bg-[#2B3F29] border-[#2B3F29] text-[#FFFDF8] shadow-xs'
                  : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]/60'
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
                  ? 'bg-[#2B3F29] border-[#2B3F29] text-[#FFFDF8] shadow-xs'
                  : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]/60'
              }`}
            >
              Bulan Lalu
            </button>
          </div>

          {mode === 'compact' && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="min-h-[34px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>{expanded ? 'Tutup Pratinjau' : 'Lihat Pratinjau Ringkasan & Log'}</span>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* 4 Kartu Total Transaksi Bulanan */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/55 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[#243825]">
              <span>Total Pemasukan</span>
              <TrendingUp className="w-3.5 h-3.5 text-[#2B3F29] shrink-0" />
            </div>
            <p className="text-sm sm:text-base font-mono font-bold text-[#243825] tabular-nums mt-1">
              {formatRupiah(mc.totalMasukBulanIni)}
            </p>
            <p className="text-[10px] text-[#384E35] mt-0.5 tabular-nums">
              {mc.jumlahTransaksiIpl} IPL · {mc.jumlahPemasukanLain} Kas Lain
            </p>
          </div>

          <div className="rounded-2xl border border-[#E2A898] bg-[#C87058]/10 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[#7A311E]">
              <span>Total Pengeluaran</span>
              <TrendingDown className="w-3.5 h-3.5 text-[#9A422B] shrink-0" />
            </div>
            <p className="text-sm sm:text-base font-mono font-bold text-[#9A422B] tabular-nums mt-1">
              {formatRupiah(mc.totalKeluarBulanIni)}
            </p>
            <p className="text-[10px] text-[#7A311E]/85 mt-0.5 tabular-nums">
              {report.expenseLogs.length} log tercatat ({mc.jumlahPengeluaran} sah)
            </p>
          </div>

          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/75 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[#4A554A]">
              <span>{isSurplus ? 'Surplus Bulan Ini' : 'Defisit Bulan Ini'}</span>
              <Wallet className="w-3.5 h-3.5 text-[#2B3F29] shrink-0" />
            </div>
            <p
              className={`text-sm sm:text-base font-mono font-bold tabular-nums mt-1 ${
                isSurplus ? 'text-[#243825]' : 'text-[#9A422B]'
              }`}
            >
              {isSurplus ? '+' : '-'}
              {formatRupiah(Math.abs(report.surplusDefisit))}
            </p>
            <p className="text-[10px] text-[#6E786D] mt-0.5 tabular-nums">
              Saldo Akhir: {formatRupiah(mc.saldoAkhir)}
            </p>
          </div>

          <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/40 p-3.5">
            <div className="flex items-center justify-between gap-1 text-[11px] font-medium text-[#243825]">
              <span>Kepatuhan IPL</span>
              <Receipt className="w-3.5 h-3.5 text-[#384E35] shrink-0" />
            </div>
            <p className="text-sm sm:text-base font-mono font-bold text-[#243825] tabular-nums mt-1">
              {report.compliance.persentaseKepatuhan}%
            </p>
            <p className="text-[10px] text-[#4A554A] mt-0.5 tabular-nums">
              {report.compliance.isPraRilis
                ? 'Periode Pra-Rilis (Belum Berlaku)'
                : `${report.compliance.unitLunas} / ${report.compliance.unitAktif} unit lunas · ${mc.summaryKepatuhan.menunggak} menunggak`}
            </p>
          </div>
        </div>

        {/* Strip Pemisahan Dana (Reguler vs Darurat) & Pemegang Saldo */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2">
            <p className="text-[10px] font-semibold text-emerald-800">Kas IPL Reguler (≥100rb)</p>
            <p className="text-xs sm:text-sm font-mono font-bold text-emerald-900 tabular-nums mt-0.5">
              {formatRupiah(mc.totalIplReguler)}
            </p>
          </div>
          <div className="rounded-xl border border-purple-300 bg-purple-50/80 px-3 py-2">
            <p className="text-[10px] font-semibold text-purple-900">Dana Darurat (&lt;100rb/bln)</p>
            <p className="text-xs sm:text-sm font-mono font-bold text-purple-800 tabular-nums mt-0.5">
              {formatRupiah(mc.totalDanaDarurat)}
            </p>
          </div>
          <div className="rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/45 px-3 py-2">
            <p className="text-[10px] font-semibold text-[#243825]">Kas di Bendahara</p>
            <p className="text-xs sm:text-sm font-mono font-bold text-[#1B271B] tabular-nums mt-0.5">
              {formatRupiah(mc.saldoAkhirBendahara)}
            </p>
          </div>
          <div className="rounded-xl border border-[#E2C285] bg-[#F2D8A7]/40 px-3 py-2">
            <p className="text-[10px] font-semibold text-[#4A3410]">Titipan Pengurus</p>
            <p className="text-xs sm:text-sm font-mono font-bold text-[#4A3410] tabular-nums mt-0.5">
              {formatRupiah(mc.saldoAkhirPengurusTitipan)}
            </p>
          </div>
        </div>

        {/* Pratinjau Lengkap Dokumen Terkompilasi */}
        {expanded && (
          <div className="space-y-4 pt-3 border-t border-[#E6E2D6]">
            {/* Sorotan Eksekutif Otomatis */}
            <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/45 p-3.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#1B271B]">
                <Sparkles className="w-3.5 h-3.5 text-[#2B3F29]" />
                <span>Ringkasan Otomatis Periode {report.namaBulan} {report.tahun}</span>
              </div>
              <ul className="space-y-1 text-xs text-[#4A554A] list-disc pl-4 leading-relaxed">
                {report.executiveHighlights.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            </div>

            {/* Grid 2 Kolom: Metode Pembayaran IPL & Pos Pengeluaran */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-[#E6E2D6] bg-[#FFFDF8] rounded-2xl overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[#F6F3EA] border-b border-[#E6E2D6] flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[#1B271B]">
                    Total IPL per Metode Pembayaran
                  </h3>
                  <span className="text-[11px] font-mono font-semibold text-[#2B3F29] tabular-nums">
                    {formatRupiah(mc.totalIplBulanIni)}
                  </span>
                </div>
                <div className="divide-y divide-[#E6E2D6]/60">
                  {report.metodePembayaranBreakdown.length === 0 ? (
                    <p className="px-3.5 py-4 text-xs text-[#6E786D] text-center">
                      Belum ada transaksi IPL terverifikasi pada periode ini.
                    </p>
                  ) : (
                    report.metodePembayaranBreakdown.map((item) => (
                      <div
                        key={item.metode}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1B271B] truncate">{item.metode}</p>
                          <p className="text-[10px] text-[#6E786D] tabular-nums">
                            {item.jumlahTransaksi} transaksi ({item.persentase}%)
                          </p>
                        </div>
                        <span className="font-mono font-bold text-[#243825] tabular-nums shrink-0">
                          {formatRupiah(item.totalNominal)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="border border-[#E6E2D6] bg-[#FFFDF8] rounded-2xl overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[#F6F3EA] border-b border-[#E6E2D6] flex items-center justify-between">
                  <h3 className="text-xs font-bold text-[#1B271B]">
                    Pengeluaran per Pos Anggaran
                  </h3>
                  <span className="text-[11px] font-mono font-semibold text-[#9A422B] tabular-nums">
                    {formatRupiah(mc.totalKeluarBulanIni)}
                  </span>
                </div>
                <div className="divide-y divide-[#E6E2D6]/60">
                  {mc.pengeluaranPerKategori.length === 0 ? (
                    <p className="px-3.5 py-4 text-xs text-[#6E786D] text-center">
                      Belum ada pengeluaran terverifikasi pada periode ini.
                    </p>
                  ) : (
                    mc.pengeluaranPerKategori.map((kat) => (
                      <div
                        key={kat.kategori}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-[#1B271B] truncate">{kat.kategori}</p>
                          <p className="text-[10px] text-[#6E786D] tabular-nums">
                            {kat.jumlahTransaksi} log ({kat.persentase}%)
                          </p>
                        </div>
                        <span className="font-mono font-bold text-[#9A422B] tabular-nums shrink-0">
                          {formatRupiah(kat.totalNominal)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Tabel Log Rincian Pengeluaran Bulanan */}
            <div className="border border-[#E6E2D6] bg-[#FFFDF8] rounded-2xl overflow-hidden">
              <div className="px-3.5 py-2.5 bg-[#F6F3EA] border-b border-[#E6E2D6] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-[#1B271B]">
                    Log Pengeluaran Bulanan ({report.expenseLogs.length} Catatan)
                  </h3>
                  <p className="text-[10px] text-[#6E786D]">
                    Seluruh catatan pengeluaran yang akan dikompilasi ke dalam PDF Ketua.
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-[#9A422B] tabular-nums">
                  Total: {formatRupiah(report.totalExpenseAll)}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F6F3EA]/70 border-b border-[#E6E2D6] text-[10px] font-bold uppercase tracking-wider text-[#4A554A]">
                      <th className="py-2 px-3 whitespace-nowrap">Tanggal</th>
                      <th className="py-2 px-3 whitespace-nowrap">No. Bukti</th>
                      <th className="py-2 px-3 whitespace-nowrap">Pos Anggaran</th>
                      <th className="py-2 px-3">Penerima &amp; Uraian</th>
                      <th className="py-2 px-3 whitespace-nowrap">Status</th>
                      <th className="py-2 px-3 text-right whitespace-nowrap">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E2D6]/60">
                    {report.expenseLogs.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-5 px-3 text-center text-[#6E786D]">
                          Belum ada log pengeluaran pada periode {report.namaBulan} {report.tahun}.
                        </td>
                      </tr>
                    ) : (
                      report.expenseLogs.map((exp) => (
                        <tr key={exp.id} className="hover:bg-[#F6F3EA]/60">
                          <td className="py-2 px-3 font-mono text-[11px] text-[#4A554A] whitespace-nowrap">
                            {formatTanggalSingkat(exp.tanggal)}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-[#4A554A] whitespace-nowrap">
                            {exp.noBukti}
                          </td>
                          <td className="py-2 px-3 font-semibold text-[#1B271B] whitespace-nowrap">
                            {exp.kategori}
                          </td>
                          <td className="py-2 px-3 text-[#4A554A] min-w-[200px]">
                            <span className="font-semibold text-[#1B271B]">{exp.penerima}</span>
                            {exp.termin ? (
                              <span className="ml-1 text-[10px] font-mono text-[#6E786D]">
                                [{exp.termin}]
                              </span>
                            ) : null}
                            {exp.keterangan && exp.keterangan !== '-' ? (
                              <span className="text-[#4A554A]"> — {exp.keterangan}</span>
                            ) : null}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                                exp.statusVerifikasi === 'Terverifikasi'
                                  ? 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                                  : exp.statusVerifikasi === 'ACC Bendahara'
                                    ? 'bg-[#384E35]/15 text-[#243825] border-[#C6D2BF]'
                                    : 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]'
                              }`}
                            >
                              {exp.statusVerifikasi === 'Terverifikasi'
                                ? 'Sah'
                                : exp.statusVerifikasi}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-[#9A422B] tabular-nums whitespace-nowrap">
                            {formatRupiah(exp.nominal)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Daftar Unit Menunggak (Melewati Jatuh Tempo Tgl 7) */}
            <div className="border border-[#E2A898] bg-[#FFFDF8] rounded-2xl overflow-hidden">
              <div className="px-3.5 py-2.5 bg-[#C87058]/10 border-b border-[#E2A898] flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-[#7A311E]">
                    Daftar Unit Menunggak ({mc.daftarUnitMenunggak.length} Unit)
                  </h3>
                  <p className="text-[10px] text-[#7A311E]/85">
                    Unit wajib iuran yang melewati jatuh tempo tanggal 7 bulan berikutnya.
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-[#A44831] tabular-nums">
                  {mc.daftarUnitMenunggak.length} unit
                </span>
              </div>
              {mc.daftarUnitMenunggak.length === 0 ? (
                <p className="px-3.5 py-4 text-xs text-[#243825] text-center font-medium">
                  Tidak ada unit wajib iuran yang berstatus menunggak hingga periode {report.namaBulan} {report.tahun}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#F6F3EA]/70 border-b border-[#E6E2D6] text-[10px] font-bold uppercase tracking-wider text-[#4A554A]">
                        <th className="py-2 px-3 whitespace-nowrap">Blok</th>
                        <th className="py-2 px-3">Nama Warga</th>
                        <th className="py-2 px-3">Bulan Menunggak</th>
                        <th className="py-2 px-3 text-right whitespace-nowrap">Estimasi Tagihan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E2D6]/60">
                      {mc.daftarUnitMenunggak.map((u) => (
                        <tr key={u.blokRumah} className="hover:bg-[#F6F3EA]/60">
                          <td className="py-2 px-3 font-mono font-bold text-[#1B271B] whitespace-nowrap">
                            {u.blokRumah}
                          </td>
                          <td className="py-2 px-3 font-medium text-[#1B271B]">
                            {u.namaWarga}
                          </td>
                          <td className="py-2 px-3 text-[#7A311E]">
                            {u.labelBulan} ({u.bulanTunggak.length} bln)
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-[#A44831] tabular-nums whitespace-nowrap">
                            {formatRupiah(u.estimasiTunggakan)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
