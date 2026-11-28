import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileBarChart2,
  FileSpreadsheet,
  FileText,
  Plus,
  Printer,
  Search,
} from 'lucide-react';
import {
  BULAN_LIST,
  isKetuaRole,
  NOMINAL_IPL_STANDAR,
  PETUGAS_PENERIMA,
  resolveOccupancyStatus,
  TAHUN_AKTIF,
  type SessionUser,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../../types';
import {
  compareBlokRumah,
  extractBlokPrefix,
  formatBillingStartLabel,
  formatBlokRumah,
  formatRupiah,
  formatTanggal,
  formatTanggalSingkat,
  getCurrentBillingMonth,
  getNamaBulan,
  isBeforeBillingStart,
  matchesBlockSearch,
} from '../../lib/format';
import {
  buildBillingCellKey,
  buildPaidAmountLookup,
  formatDaruratBadgeLabel,
  getStatusBadgeStyle,
  getUnitDelinquentMonths,
  isUnitBillable,
  resolveUnitMonthBillingStatus,
  type CellStatus,
} from '../../lib/billingStatus';
import {
  calculateCashAllocation,
  exportLaporanCsv,
  exportLaporanExcel,
} from '../../lib/exportReport';
import { submitManualCashAdmin } from '../../lib/dataService';
import { LoadingSpinner } from '../LoadingSpinner';
import { recordAuditLog } from '../../lib/auditLogger';
import { buildMonthlyCashReport } from '../../lib/financeUtils';
import {
  downloadRekapBulananPdf,
  isNativeCapacitorPlatform,
} from '../../lib/pdfGenerator';
import { useAppBrand } from '../../lib/brandContext';
import { BrandLogo, SaungKebunWatermark } from '../BrandLogo';
import { OfficialStamp } from '../OfficialStamp';
import { ChairmanMonthlyReportPanel } from './ChairmanMonthlyReportPanel';
import { useSimulation } from '../../lib/simulationContext';
import { parseSimDateToLocalNoon } from '../../lib/simulationStore';
import { SimulationDateSwitcher } from '../SimulationDateSwitcher';

interface AdminRekapSlideProps {
  session: SessionUser;
  wargaList: Warga[];
  statusList: StatusEcardBulanan[];
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type RekapSubTab = 'bulanan' | 'matriks' | 'ketua';
type DelinquencyFilter = 'all' | 'gt0' | '1' | '2' | '3' | 'gt3';

function isUnitKosong(w: Warga): boolean {
  return resolveOccupancyStatus(w) === 'kosong';
}

function getMatrixBadgeDisplay(
  status: CellStatus,
  isPending: boolean,
  paidAmount = 0
): {
  label: string;
  className: string;
} {
  if (status === 'DANA_DARURAT') {
    return {
      label: formatDaruratBadgeLabel(paidAmount),
      className: 'bg-purple-100 text-purple-800 border border-purple-300 font-semibold',
    };
  }
  if (isPending && status !== 'LUNAS' && status !== 'KOSONG' && status !== 'PRA_RILIS') {
    return {
      label: 'Pending',
      className: 'bg-[#F2D8A7]/70 text-[#4A3410] border border-[#E2C285]',
    };
  }
  return getStatusBadgeStyle(status);
}

export function AdminRekapSlide({
  session,
  wargaList,
  statusList,
  transaksiList,
  transaksiKasList,
  onRefresh,
  onToast,
}: AdminRekapSlideProps) {
  const { brand } = useAppBrand();
  const { simNow, simDateIso } = useSimulation();
  const isSimulation = Boolean(session.is_simulation);
  const effectiveNow = useMemo(
    () => (isSimulation ? simNow : undefined),
    [isSimulation, simDateIso, simNow]
  );
  const isKetua = isKetuaRole(session);
  const PAGE_SIZE = 20;
  const currentMonth = getCurrentBillingMonth(effectiveNow);

  // Sub-tab Rekap Bulanan (Buku Kas Umum), Laporan Otomatis Ketua, vs Matriks 12 Bulan
  const [subTab, setSubTab] = useState<RekapSubTab>('bulanan');
  const [selectedBulan, setSelectedBulan] = useState<number>(currentMonth);
  const [selectedTahun, setSelectedTahun] = useState<number>(TAHUN_AKTIF);

  useEffect(() => {
    if (isSimulation) {
      const parsed = parseSimDateToLocalNoon(simDateIso);
      setSelectedBulan(getCurrentBillingMonth(parsed));
      setSelectedTahun(parsed.getFullYear());
    }
  }, [isSimulation, simDateIso]);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);

  // Filter Matriks 12 Bulan
  const [blokFilter, setBlokFilter] = useState<string>('Semua');
  const [statusFilter, setStatusFilter] = useState<'Semua' | 'Lunas' | 'Darurat' | 'Menunggak'>('Semua');
  const [delinquencyFilter, setDelinquencyFilter] = useState<DelinquencyFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // State Modal Input Setoran Tunai Manual Admin
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [selectedWargaId, setSelectedWargaId] = useState<string>('');
  const [selectedMonths, setSelectedMonths] = useState<number[]>([currentMonth]);
  const [petugas, setPetugas] = useState<string>(PETUGAS_PENERIMA[0]);
  const [nominalInput, setNominalInput] = useState<string>(String(NOMINAL_IPL_STANDAR));
  const [keterangan, setKeterangan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const cashSummary = useMemo(() => calculateCashAllocation(transaksiList), [transaksiList]);

  const monthlyReport = useMemo(
    () =>
      buildMonthlyCashReport(selectedTahun, selectedBulan, transaksiList, transaksiKasList, {
        wargaList,
        statusList,
        billingStart: brand,
        now: effectiveNow,
      }),
    [selectedTahun, selectedBulan, transaksiList, transaksiKasList, wargaList, statusList, brand, effectiveNow]
  );

  const sortedWargaList = useMemo(
    () => [...wargaList].sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah)),
    [wargaList]
  );

  const { paidAmountByKey, pendingKeys } = useMemo(
    () => buildPaidAmountLookup(transaksiList, statusList),
    [transaksiList, statusList]
  );

  const matrixSummary = useMemo(() => {
    let berpenghuniCount = 0;
    let kosongCount = 0;
    let exemptCount = 0;
    let sudahSetorCount = 0;
    let lunasBulanIniCount = 0;
    let daruratBulanIniCount = 0;
    let belumSetorCount = 0;
    let menungguCount = 0;
    let menunggak1Bln = 0;
    let menunggak2Bln = 0;
    let menunggak3Bln = 0;
    let menunggakGt3Bln = 0;
    let menunggakTotal = 0;
    const unpaidMonthsByWargaId = new Map<string, number>();

    for (const w of sortedWargaList) {
      if (!isUnitBillable(w)) {
        if (isUnitKosong(w)) {
          kosongCount += 1;
        } else {
          exemptCount += 1;
        }
        unpaidMonthsByWargaId.set(w.id, 0);
        continue;
      }

      berpenghuniCount += 1;
      const currentCellKey = buildBillingCellKey(w.blok_rumah, TAHUN_AKTIF, currentMonth);
      const currentPaid = paidAmountByKey.get(currentCellKey) ?? 0;
      const currentSt = resolveUnitMonthBillingStatus({
        warga: w,
        targetYear: TAHUN_AKTIF,
        targetMonth: currentMonth,
        paidAmount: currentPaid,
        billingStart: brand,
        now: effectiveNow,
      });
      const currentPending =
        currentPaid === 0 &&
        currentSt !== 'KOSONG' &&
        currentSt !== 'PRA_RILIS' &&
        pendingKeys.has(currentCellKey);

      if (currentSt === 'LUNAS') {
        sudahSetorCount += 1;
        lunasBulanIniCount += 1;
      } else if (currentSt === 'DANA_DARURAT') {
        // Pembayaran < Rp 100.000/bln dialihkan ke Dana Darurat -> tetap terhitung Belum Setor IPL Penuh
        belumSetorCount += 1;
        daruratBulanIniCount += 1;
      } else if (currentSt !== 'PRA_RILIS' && currentSt !== 'KOSONG') {
        belumSetorCount += 1;
        if (currentPending) {
          menungguCount += 1;
        }
      }

      const delinquentMonths = getUnitDelinquentMonths({
        warga: w,
        year: TAHUN_AKTIF,
        paidAmountByKey,
        pendingKeys,
        billingStart: brand,
        now: effectiveNow,
      });
      const tunggakMonths = delinquentMonths.length;

      unpaidMonthsByWargaId.set(w.id, tunggakMonths);
      if (tunggakMonths >= 1) {
        menunggakTotal += 1;
        if (tunggakMonths === 1) menunggak1Bln += 1;
        else if (tunggakMonths === 2) menunggak2Bln += 1;
        else if (tunggakMonths === 3) menunggak3Bln += 1;
        else menunggakGt3Bln += 1;
      }
    }

    return {
      berpenghuniCount,
      kosongCount,
      exemptCount,
      sudahSetorCount,
      lunasBulanIniCount,
      daruratBulanIniCount,
      belumSetorCount,
      menungguCount,
      menunggak1Bln,
      menunggak2Bln,
      menunggak3Bln,
      menunggakGt3Bln,
      menunggakTotal,
      unpaidMonthsByWargaId,
    };
  }, [sortedWargaList, paidAmountByKey, pendingKeys, currentMonth, brand, effectiveNow]);

  const blokOptions = useMemo(() => {
    const prefixes = new Set<string>(['B03', 'B05', 'B06', 'B07', 'B08']);
    for (const w of sortedWargaList) {
      prefixes.add(extractBlokPrefix(w.blok_rumah));
    }
    return ['Semua', ...Array.from(prefixes).sort((a, b) => compareBlokRumah(a, b))];
  }, [sortedWargaList]);

  const filteredWarga = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedWargaList.filter((w) => {
      const prefix = extractBlokPrefix(w.blok_rumah);
      if (blokFilter !== 'Semua' && prefix !== blokFilter) return false;
      if (q && !matchesBlockSearch(w.blok_rumah, search) && !w.nama_warga.toLowerCase().includes(q)) {
        return false;
      }

      if (delinquencyFilter !== 'all') {
        if (!isUnitBillable(w)) return false;
        const unpaidCount = matrixSummary.unpaidMonthsByWargaId.get(w.id) ?? 0;
        if (delinquencyFilter === 'gt0' && unpaidCount < 1) return false;
        if (delinquencyFilter === '1' && unpaidCount !== 1) return false;
        if (delinquencyFilter === '2' && unpaidCount !== 2) return false;
        if (delinquencyFilter === '3' && unpaidCount !== 3) return false;
        if (delinquencyFilter === 'gt3' && unpaidCount <= 3) return false;
      }

      if (statusFilter !== 'Semua') {
        const currentCellKey = buildBillingCellKey(w.blok_rumah, TAHUN_AKTIF, currentMonth);
        const currentPaid = paidAmountByKey.get(currentCellKey) ?? 0;
        const currentSt = resolveUnitMonthBillingStatus({
          warga: w,
          targetYear: TAHUN_AKTIF,
          targetMonth: currentMonth,
          paidAmount: currentPaid,
          billingStart: brand,
          now: effectiveNow,
        });
        const currentPending = currentPaid === 0 && pendingKeys.has(currentCellKey);
        const tunggakCount = matrixSummary.unpaidMonthsByWargaId.get(w.id) ?? 0;

        if (statusFilter === 'Lunas' && currentSt !== 'LUNAS') return false;
        if (statusFilter === 'Darurat' && currentSt !== 'DANA_DARURAT') return false;
        if (statusFilter === 'Menunggak') {
          const isUnpaidCurrent =
            !currentPending &&
            (currentSt === 'BERJALAN' || currentSt === 'MASA_TAGIH' || currentSt === 'TUNGGAK');
          if (!isUnpaidCurrent && tunggakCount === 0) return false;
        }
      }
      return true;
    });
  }, [
    sortedWargaList,
    paidAmountByKey,
    pendingKeys,
    matrixSummary,
    blokFilter,
    statusFilter,
    delinquencyFilter,
    search,
    currentMonth,
    brand,
    effectiveNow,
  ]);

  useEffect(() => {
    setPage(1);
  }, [blokFilter, statusFilter, delinquencyFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredWarga.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedWarga = useMemo(
    () => filteredWarga.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredWarga, safePage]
  );

  const openManualModal = () => {
    const first = sortedWargaList[0];
    setSelectedWargaId(first?.id || '');
    const defaultBulan = [currentMonth];
    setSelectedMonths(defaultBulan);
    setNominalInput(String((first?.nominal_iuran || NOMINAL_IPL_STANDAR) * defaultBulan.length));
    const matchedPetugas = PETUGAS_PENERIMA.find((p) =>
      p.toLowerCase().includes(session.nama_warga.toLowerCase())
    );
    setPetugas(matchedPetugas || PETUGAS_PENERIMA[0]);
    setKeterangan('');
    setManualModalOpen(true);
  };

  const selectedWargaObj = wargaList.find((w) => w.id === selectedWargaId);

  const toggleManualMonth = (bulan: number) => {
    const next = selectedMonths.includes(bulan)
      ? selectedMonths.filter((m) => m !== bulan)
      : [...selectedMonths, bulan].sort((a, b) => a - b);
    setSelectedMonths(next);
    const unitNominal = selectedWargaObj?.nominal_iuran || NOMINAL_IPL_STANDAR;
    setNominalInput(String(next.length * unitNominal));
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWargaObj) {
      onToast('error', 'Pilih unit warga terlebih dahulu.');
      return;
    }
    const nominal = Number(nominalInput.replace(/\D/g, '')) || 0;
    setSubmitting(true);
    try {
      const res = await submitManualCashAdmin(session, {
        warga: selectedWargaObj,
        bulan_dibayar: selectedMonths,
        petugas_penerima: petugas,
        nominal,
        keterangan,
      });
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          `Setoran tunai ${formatBlokRumah(selectedWargaObj.blok_rumah) || selectedWargaObj.blok_rumah} berhasil dicatat & otomatis Terverifikasi.`
        );
        setManualModalOpen(false);
        await onRefresh();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadMonthlyPdf = async () => {
    if (downloadingPdf || printingPdf) return;
    setDownloadingPdf(true);
    try {
      const result = await downloadRekapBulananPdf(monthlyReport, brand, { mode: 'download' });
      if (result.method === 'native_share') {
        if (!result.cancelled) {
          onToast(
            'success',
            `PDF Rekapitulasi Kas ${monthlyReport.namaBulan} ${monthlyReport.tahun} siap disimpan atau dibagikan via menu Android.`
          );
        }
      } else {
        onToast(
          'success',
          `PDF Rekapitulasi Kas ${monthlyReport.namaBulan} ${monthlyReport.tahun} (A4) berhasil diunduh.`
        );
      }
    } catch {
      onToast('error', 'Gagal membuat file PDF Rekapitulasi Bulanan.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handlePrintReport = async () => {
    if (!isNativeCapacitorPlatform()) {
      window.print();
      return;
    }
    if (downloadingPdf || printingPdf) return;
    setPrintingPdf(true);
    try {
      const result = await downloadRekapBulananPdf(monthlyReport, brand, { mode: 'print' });
      if (!result.cancelled) {
        onToast(
          'info',
          `Pilih "Cetak / Print" dari menu Android untuk mencetak Rekap Kas ${monthlyReport.namaBulan} ${monthlyReport.tahun}.`
        );
      }
    } catch {
      onToast('error', 'Gagal menyiapkan PDF Rekapitulasi Bulanan untuk cetak di Android.');
    } finally {
      setPrintingPdf(false);
    }
  };

  const handleExportExcel = () => {
    exportLaporanExcel(wargaList, statusList, transaksiList, brand);
    void recordAuditLog({
      session,
      action: 'EXPORT_EXCEL',
      entity: 'laporan_kas',
      summary: `Admin mengekspor Laporan Rekap Matriks & Kas (${TAHUN_AKTIF}) ke format Excel (.xlsx).`,
    });
    onToast('success', 'Laporan Excel (.xlsx) berhasil diunduh.');
  };

  const handleExportCsv = () => {
    exportLaporanCsv(wargaList, statusList, transaksiList, brand);
    void recordAuditLog({
      session,
      action: 'EXPORT_CSV',
      entity: 'laporan_kas',
      summary: `Admin mengekspor Laporan Rekap Matriks & Kas (${TAHUN_AKTIF}) ke format CSV.`,
    });
    onToast('success', 'Laporan CSV berhasil diunduh.');
  };

  const yearOptions = [TAHUN_AKTIF - 1, TAHUN_AKTIF, TAHUN_AKTIF + 1];

  return (
    <div className="space-y-5 pb-28 print:pb-0 overflow-x-hidden">
      {isSimulation && (
        <div className="no-print">
          <SimulationDateSwitcher />
        </div>
      )}
      {/* Sub-Tab Switcher & Quick Action Input Tunai */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          className={`grid ${
            isKetua ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'
          } gap-1.5 w-full sm:flex-1 sm:max-w-2xl p-1.5 bg-[#FFFDF8] border border-[#E6E2D6] rounded-2xl shadow-xs`}
        >
          <button
            type="button"
            onClick={() => setSubTab('bulanan')}
            className={`w-full min-w-0 px-2 py-2.5 text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5 text-center leading-tight transition-colors cursor-pointer ${
              subTab === 'bulanan'
                ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-sm'
                : 'text-[#4A554A] hover:bg-[#E5EEE3]/60 hover:text-[#243825]'
            }`}
          >
            <BookOpen className={`w-4 h-4 shrink-0 ${subTab === 'bulanan' ? 'text-[#E5EEE3]' : 'text-[#2B3F29]'}`} />
            <span>Rekap Bulanan (Buku Kas)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('matriks')}
            className={`w-full min-w-0 px-2 py-2.5 text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5 text-center leading-tight transition-colors cursor-pointer ${
              subTab === 'matriks'
                ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-sm'
                : 'text-[#4A554A] hover:bg-[#E5EEE3]/60 hover:text-[#243825]'
            }`}
          >
            <FileSpreadsheet className={`w-4 h-4 shrink-0 ${subTab === 'matriks' ? 'text-[#E5EEE3]' : 'text-[#2B3F29]'}`} />
            <span>Matriks IPL 12 Bulan</span>
          </button>
          {isKetua && (
            <button
              type="button"
              onClick={() => setSubTab('ketua')}
              className={`col-span-2 sm:col-span-1 w-full min-w-0 px-2 py-2.5 text-xs sm:text-sm font-semibold rounded-xl flex items-center justify-center gap-1.5 text-center leading-tight transition-colors cursor-pointer ${
                subTab === 'ketua'
                  ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-sm'
                  : 'text-[#4A554A] hover:bg-[#E5EEE3]/60 hover:text-[#243825]'
              }`}
            >
              <FileBarChart2 className={`w-4 h-4 shrink-0 ${subTab === 'ketua' ? 'text-[#E5EEE3]' : 'text-[#2B3F29]'}`} />
              <span>Laporan Ketua (PDF)</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={openManualModal}
          className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm shrink-0"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span>Input Tunai Manual</span>
        </button>
      </div>

      {/* ================================================================= */}
      {/* SUB-TAB KHUSUS KETUA: GENERATOR LAPORAN RINGKASAN OTOMATIS (PDF) */}
      {/* ================================================================= */}
      {subTab === 'ketua' && isKetua && (
        <ChairmanMonthlyReportPanel
          session={session}
          wargaList={wargaList}
          statusList={statusList}
          transaksiList={transaksiList}
          transaksiKasList={transaksiKasList}
          onToast={onToast}
          mode="full"
          bulanOverride={selectedBulan}
          tahunOverride={selectedTahun}
          onPeriodChange={(b, t) => {
            setSelectedBulan(b);
            setSelectedTahun(t);
          }}
        />
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 1: REKAPITULASI KEUANGAN BULANAN (BUKU KAS UMUM + PDF A4) */}
      {/* ================================================================= */}
      {subTab === 'bulanan' && (
        <div className="space-y-5 min-w-0">
          {/* Toolbar Filter Bulan/Tahun + Cetak/Unduh A4 + Excel */}
          <div className="no-print glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0 shadow-xs">
                <FileText className="w-4 h-4" />
              </div>
              <select
                aria-label="Pilih Bulan Rekapitulasi"
                value={selectedBulan}
                onChange={(e) => setSelectedBulan(Number(e.target.value))}
                className="min-h-[42px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm font-semibold text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
              >
                {BULAN_LIST.map((b) => (
                  <option key={b.angka} value={b.angka}>
                    {b.nama}
                  </option>
                ))}
              </select>

              <select
                aria-label="Pilih Tahun Rekapitulasi"
                value={selectedTahun}
                onChange={(e) => setSelectedTahun(Number(e.target.value))}
                className="min-h-[42px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm font-mono font-semibold text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={printingPdf || downloadingPdf}
                onClick={() => void handlePrintReport()}
                className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 disabled:opacity-60 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-all duration-200 active:scale-[0.97]"
              >
                {printingPdf ? (
                  <LoadingSpinner size="xs" tone="current" />
                ) : (
                  <Printer className="w-4 h-4 shrink-0" />
                )}
                <span>{printingPdf ? 'Menyiapkan...' : 'Cetak A4'}</span>
              </button>

              <button
                type="button"
                disabled={downloadingPdf || printingPdf}
                onClick={() => void handleDownloadMonthlyPdf()}
                className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-all duration-200 active:scale-[0.97] shadow-sm"
              >
                {downloadingPdf ? (
                  <LoadingSpinner size="xs" tone="white" />
                ) : (
                  <Download className="w-4 h-4 shrink-0" />
                )}
                <span>{downloadingPdf ? 'Menyiapkan PDF...' : 'Unduh PDF A4'}</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className="min-h-[42px] px-4 rounded-full bg-[#E5EEE3] hover:bg-[#D3E3D0] border border-[#C6D2BF] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Excel</span>
              </button>
            </div>
          </div>

          {/* Dokumen Resmi Rekapitulasi Bulanan (#printable-report) */}
          <article
            id="printable-report"
            className="relative bg-white border border-[#E6E2D6] rounded-3xl print:rounded-none print:border-none print:shadow-none p-4 sm:p-7 print:p-0 space-y-5 print:space-y-3.5 min-w-0 overflow-hidden print:overflow-visible"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute inset-0 flex items-center justify-center z-0 overflow-hidden"
            >
              <SaungKebunWatermark
                tone="moss"
                className="relative right-auto bottom-auto w-64 h-88 sm:w-80 sm:h-[26rem] opacity-[0.065] print:opacity-[0.08]"
              />
            </div>

            {/* Kop Resmi Perumahan */}
            <header className="relative z-10 pb-3.5 print:pb-2.5 border-b-2 border-[#243825] flex items-center gap-3 sm:gap-4">
              <BrandLogo size="md" variant="light" srcOverride={null} className="shrink-0 !bg-transparent" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#2B3F29] leading-tight">
                  Pengurus Lingkungan Perumahan Saung Kebun
                </p>
                <h2 className="font-serif-brand text-sm sm:text-lg print:text-base font-extrabold text-[#1B271B] leading-snug mt-0.5">
                  Rekapitulasi Keuangan Bulanan — {monthlyReport.namaBulan} {monthlyReport.tahun}
                </h2>
                <p className="text-[11px] sm:text-xs text-[#4A554A] mt-0.5 leading-snug">
                  {(brand.kop_resmi || '')
                    .replace(/^pengurus\s+lingkungan\s+perumahan\s+saung\s+kebun\s*[—–\-:|·]*\s*/i, '')
                    .trim() ||
                    'Desa Bengle, Kec. Majalaya, Kab. Karawang · Sekretariat Blok B3/7'}
                </p>
              </div>
            </header>

            {/* 5 Kartu Posisi Kas Bulanan — Otomatis 5 Kolom Saat Cetak A4 */}
            <section className="relative z-10 grid grid-cols-2 lg:grid-cols-5 print:grid-cols-5 gap-2.5 print:gap-2 avoid-break">
              <div className="rounded-xl border border-[#E6E2D6] bg-[#F6F3EA]/70 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-[#6E786D]">
                  Saldo Awal
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-[#1B271B] tabular-nums mt-1">
                  {formatRupiah(monthlyReport.saldoAwal)}
                </p>
              </div>

              <div className="rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/65 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-[#243825]">
                  Pemasukan IPL
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-[#243825] tabular-nums mt-1">
                  {formatRupiah(monthlyReport.totalIplBulanIni)}
                </p>
                <p className="text-[10px] print:text-[8.5px] text-[#384E35] mt-0.5 tabular-nums">
                  {monthlyReport.jumlahTransaksiIpl} transaksi
                </p>
              </div>

              <div className="rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/35 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-[#384E35]">
                  Pemasukan Lain
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-[#2B3F29] tabular-nums mt-1">
                  {formatRupiah(monthlyReport.totalPemasukanLainBulanIni)}
                </p>
                <p className="text-[10px] print:text-[8.5px] text-[#4A554A] mt-0.5 tabular-nums">
                  {monthlyReport.jumlahPemasukanLain} transaksi
                </p>
              </div>

              <div className="rounded-xl border border-[#E2A898] bg-[#C87058]/10 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-[#7A311E]">
                  Pengeluaran
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-[#A44831] tabular-nums mt-1">
                  {formatRupiah(monthlyReport.totalKeluarBulanIni)}
                </p>
                <p className="text-[10px] print:text-[8.5px] text-[#A44831]/85 mt-0.5 tabular-nums">
                  {monthlyReport.jumlahPengeluaran} transaksi
                </p>
              </div>

              <div className="col-span-2 lg:col-span-1 print:col-span-1 rounded-xl border border-[#243825] bg-[#243825] text-[#FFFDF8] p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-[#E5EEE3]">
                  Saldo Akhir
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold tabular-nums mt-1">
                  {formatRupiah(monthlyReport.saldoAkhir)}
                </p>
              </div>
            </section>

            {/* Rincian Alokasi Dana (Reguler vs Darurat) & Pemegang Saldo (Bendahara vs Titipan) */}
            <section className="relative z-10 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-2.5 print:gap-2 avoid-break">
              <div className="rounded-xl border border-[#E6E2D6] bg-[#FAF7EF] p-3 print:p-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E786D]">
                    Pemisahan Pos Pemasukan
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                      <span className="w-2 h-2 rounded-full bg-emerald-600" />
                      Kas IPL Reguler: <strong className="font-mono tabular-nums">{formatRupiah(monthlyReport.totalIplReguler)}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-purple-800">
                      <span className="w-2 h-2 rounded-full bg-purple-600" />
                      Dana Darurat: <strong className="font-mono tabular-nums">{formatRupiah(monthlyReport.totalDanaDarurat)}</strong>
                      {monthlyReport.jumlahTransaksiDarurat > 0 && (
                        <span className="text-[10px] text-purple-700">({monthlyReport.jumlahTransaksiDarurat} trx)</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#E6E2D6] bg-[#FAF7EF] p-3 print:p-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#6E786D]">
                    Posisi Pemegang Saldo Akhir
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#243825]">
                      <span className="w-2 h-2 rounded-full bg-[#243825]" />
                      Kas di Bendahara: <strong className="font-mono tabular-nums">{formatRupiah(monthlyReport.saldoAkhirBendahara)}</strong>
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-[#6E4D12]">
                      <span className="w-2 h-2 rounded-full bg-[#C78C26]" />
                      Titipan Pengurus: <strong className="font-mono tabular-nums">{formatRupiah(monthlyReport.saldoAkhirPengurusTitipan)}</strong>
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* Ringkasan Kepatuhan Unit Wajib Iuran */}
            {monthlyReport.summaryKepatuhan.totalBillable > 0 && (
              <section className="relative z-10 rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/35 px-3.5 py-2.5 print:py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs print:text-[9.5px] avoid-break">
                <span className="font-bold text-[#243825]">
                  Kepatuhan Unit Wajib Iuran ({monthlyReport.namaBulan} {monthlyReport.tahun}):
                </span>
                <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300 font-semibold">
                    Sudah Setor Lunas: {monthlyReport.summaryKepatuhan.sudahSetor}/{monthlyReport.summaryKepatuhan.totalBillable}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-300 font-semibold">
                    Belum Setor: {monthlyReport.summaryKepatuhan.belumSetor}
                    {monthlyReport.summaryKepatuhan.unitDarurat > 0
                      ? ` (${monthlyReport.summaryKepatuhan.unitDarurat} Darurat)`
                      : ''}
                  </span>
                  <span className="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-300 font-semibold">
                    Menunggak (&gt;Tgl 7): {monthlyReport.summaryKepatuhan.menunggak} unit
                  </span>
                </div>
              </section>
            )}

            {/* Rincian Pengeluaran per Kategori */}
            {monthlyReport.pengeluaranPerKategori.length > 0 && (
              <section className="relative z-10 space-y-2 print:space-y-1.5 avoid-break">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E786D]">
                  Realisasi Pengeluaran per Pos Anggaran
                </h3>
                <div className="overflow-x-auto w-full border border-[#E6E2D6] rounded-xl">
                  <table className="w-full text-left border-collapse text-xs print:text-[10px]">
                    <thead>
                      <tr className="bg-[#F6F3EA] border-b border-[#E6E2D6] text-[#4A554A] font-semibold">
                        <th className="py-2 print:py-1.5 px-3.5">Pos Anggaran</th>
                        <th className="py-2 print:py-1.5 px-3 text-center">Trx</th>
                        <th className="py-2 print:py-1.5 px-3 text-right">Porsi</th>
                        <th className="py-2 print:py-1.5 px-3.5 text-right">Total Nominal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E2D6]/70">
                      {monthlyReport.pengeluaranPerKategori.map((item) => (
                        <tr key={item.kategori}>
                          <td className="py-2 print:py-1.5 px-3.5 font-semibold text-[#1B271B]">
                            {item.kategori}
                          </td>
                          <td className="py-2 print:py-1.5 px-3 text-center font-mono tabular-nums text-[#4A554A]">
                            {item.jumlahTransaksi}
                          </td>
                          <td className="py-2 print:py-1.5 px-3 text-right font-mono tabular-nums text-[#4A554A]">
                            {item.persentase}%
                          </td>
                          <td className="py-2 print:py-1.5 px-3.5 text-right font-mono font-bold text-[#C87058] tabular-nums whitespace-nowrap">
                            {formatRupiah(item.totalNominal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Buku Kas Umum Kronologis */}
            <section className="relative z-10 space-y-2 print:space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E786D]">
                  Buku Kas Umum — Mutasi Kronologis ({monthlyReport.namaBulan} {monthlyReport.tahun})
                </h3>
                <span className="text-xs print:text-[10px] font-mono text-[#6E786D] tabular-nums">
                  {monthlyReport.mutasiKronologis.length} entri
                </span>
              </div>

              <div className="overflow-x-auto w-full border border-[#E6E2D6] rounded-xl">
                <table className="w-full text-left border-collapse text-xs print:text-[9.5px]">
                  <thead>
                    <tr className="bg-[#243825] text-[#FFFDF8] font-semibold">
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 whitespace-nowrap">Tanggal</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 whitespace-nowrap">No. Bukti</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3">Uraian &amp; Kategori</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right whitespace-nowrap">Masuk</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right whitespace-nowrap">Keluar</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right whitespace-nowrap">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E6E2D6]/70">
                    {/* Baris Saldo Awal */}
                    <tr className="bg-[#F6F3EA] font-semibold">
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-[#6E786D] whitespace-nowrap">—</td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-[#6E786D] whitespace-nowrap">
                        SALDO-AWAL
                      </td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-[#1B271B]">
                        Saldo Kas Awal Bulan {monthlyReport.namaBulan} {monthlyReport.tahun}
                      </td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono text-[#8E948A]">—</td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono text-[#8E948A]">—</td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-bold text-[#1B271B] tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.saldoAwal)}
                      </td>
                    </tr>

                    {monthlyReport.mutasiKronologis.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-[#6E786D]">
                          Belum ada mutasi kas masuk maupun pengeluaran pada {monthlyReport.namaBulan}{' '}
                          {monthlyReport.tahun}.
                        </td>
                      </tr>
                    ) : (
                      monthlyReport.mutasiKronologis.map((row) => {
                        const isDarurat = row.fundType === 'DANA_DARURAT';
                        const isTitipan = row.holderRole === 'PENGURUS_TITIPAN';
                        return (
                          <tr
                            key={row.id}
                            className={
                              isDarurat
                                ? 'border-l-4 border-l-purple-600 bg-purple-50/70 hover:bg-purple-50'
                                : 'hover:bg-[#F6F3EA]/70'
                            }
                          >
                            <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-[#4A554A] whitespace-nowrap tabular-nums">
                              {formatTanggalSingkat(row.tanggal)}
                            </td>
                            <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-[10px] text-[#4A554A] whitespace-nowrap">
                              {row.noBukti}
                            </td>
                            <td className="py-2 print:py-1.5 px-2.5 sm:px-3 min-w-[180px]">
                              <p className="font-medium text-[#1B271B] leading-snug">
                                {row.uraian}
                                {isDarurat && (
                                  <span className="inline-block ml-1.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-300 text-[9.5px] font-bold align-middle">
                                    Dana Darurat
                                  </span>
                                )}
                                {isTitipan && (
                                  <span className="inline-block ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300 text-[9.5px] font-semibold align-middle">
                                    Titipan Pengurus
                                  </span>
                                )}
                              </p>
                              <p className="text-[10px] text-[#6E786D] mt-0.5">{row.kategori}</p>
                            </td>
                            <td
                              className={`py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                                isDarurat ? 'text-purple-800' : 'text-[#243825]'
                              }`}
                            >
                              {row.masuk > 0 ? formatRupiah(row.masuk) : '—'}
                            </td>
                            <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-semibold text-[#C87058] tabular-nums whitespace-nowrap">
                              {row.keluar > 0 ? formatRupiah(row.keluar) : '—'}
                            </td>
                            <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-bold text-[#1B271B] tabular-nums whitespace-nowrap">
                              {formatRupiah(row.saldoBerjalan)}
                            </td>
                          </tr>
                        );
                      })
                    )}

                    {/* Baris Total & Saldo Akhir */}
                    <tr className="bg-[#E5EEE3]/70 border-t-2 border-[#C6D2BF] font-bold">
                      <td colSpan={3} className="py-2.5 print:py-2 px-2.5 sm:px-3 text-[#1B271B]">
                        TOTAL MUTASI &amp; SALDO AKHIR ({monthlyReport.namaBulan.toUpperCase()}{' '}
                        {monthlyReport.tahun})
                      </td>
                      <td className="py-2.5 print:py-2 px-2.5 sm:px-3 text-right font-mono text-[#243825] tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.totalMasukBulanIni)}
                      </td>
                      <td className="py-2.5 print:py-2 px-2.5 sm:px-3 text-right font-mono text-[#C87058] tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.totalKeluarBulanIni)}
                      </td>
                      <td className="py-2.5 print:py-2 px-2.5 sm:px-3 text-right font-mono text-[#243825] tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.saldoAkhir)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Daftar Unit Menunggak (Hanya unit wajib iuran yang lewat tgl 7 bulan berikutnya) */}
            <section className="relative z-10 space-y-2 print:space-y-1.5 avoid-break">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#7A311E]">
                  Daftar Unit Menunggak (Melewati Jatuh Tempo Tgl 7)
                </h3>
                <span className="text-xs print:text-[10px] font-mono font-bold text-[#A44831] tabular-nums">
                  {monthlyReport.daftarUnitMenunggak.length} unit
                </span>
              </div>
              {monthlyReport.daftarUnitMenunggak.length === 0 ? (
                <div className="rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/40 px-4 py-3 text-xs text-[#243825] font-medium">
                  Tidak ada unit wajib iuran yang berstatus menunggak hingga periode {monthlyReport.namaBulan} {monthlyReport.tahun}.
                </div>
              ) : (
                <div className="overflow-x-auto w-full border border-[#E2A898] rounded-xl">
                  <table className="w-full text-left border-collapse text-xs print:text-[9.5px]">
                    <thead>
                      <tr className="bg-[#C87058]/15 border-b border-[#E2A898] text-[#7A311E] font-semibold">
                        <th className="py-2 print:py-1.5 px-3 whitespace-nowrap">Blok</th>
                        <th className="py-2 print:py-1.5 px-3">Nama Warga</th>
                        <th className="py-2 print:py-1.5 px-3">Bulan Menunggak</th>
                        <th className="py-2 print:py-1.5 px-3 text-right whitespace-nowrap">Estimasi Tagihan</th>
                        <th className="py-2 print:py-1.5 px-3">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E6E2D6]/70">
                      {monthlyReport.daftarUnitMenunggak.map((u) => (
                        <tr key={u.blokRumah}>
                          <td className="py-2 print:py-1.5 px-3 font-mono font-bold text-[#1B271B] whitespace-nowrap">
                            {u.blokRumah}
                          </td>
                          <td className="py-2 print:py-1.5 px-3 font-medium text-[#1B271B]">
                            {u.namaWarga}
                          </td>
                          <td className="py-2 print:py-1.5 px-3 text-[#7A311E] font-medium">
                            {u.labelBulan} ({u.bulanTunggak.length} bln)
                          </td>
                          <td className="py-2 print:py-1.5 px-3 text-right font-mono font-bold text-[#A44831] tabular-nums whitespace-nowrap">
                            {formatRupiah(u.estimasiTunggakan)}
                          </td>
                          <td className="py-2 print:py-1.5 px-3 text-[#6E786D]">
                            {u.statusKeterangan || 'Melewati jatuh tempo tgl 7'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Blok Tanda Tangan & Stempel Pengurus — Stempel Rapi di Area TTD (Tidak Menutupi Nama) */}
            <footer className="relative z-10 pt-3 print:pt-2.5 border-t border-[#E6E2D6] avoid-break">
              <p className="text-xs print:text-[10px] text-[#4A554A] text-right mb-3">
                Karawang, {formatTanggal((effectiveNow ?? new Date()).toISOString())}
              </p>
              <div className="relative grid grid-cols-2 gap-4 sm:gap-6 text-center text-xs print:text-[10px] items-end">
                <div className="signature-center-stamp pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[8deg] z-10 opacity-35 mix-blend-multiply">
                  <OfficialStamp
                    size="md"
                    unstyledTransform
                    className="w-20 h-20 sm:w-24 sm:h-24 print:w-24 print:h-24"
                  />
                </div>

                <div>
                  <p className="text-[#6E786D]">Mengetahui,</p>
                  <p className="font-bold text-[#1B271B]">Ketua Lingkungan</p>
                  <div className="h-16 sm:h-20 print:h-14" />
                  <div className="border-b border-[#6E786D] w-32 sm:w-40 mx-auto" />
                  <p className="font-bold text-[#1B271B] mt-1.5">Erlangga</p>
                  <p className="text-[10px] text-[#6E786D]">Perumahan Saung Kebun</p>
                </div>

                <div>
                  <p className="text-[#6E786D]">Disusun &amp; Disahkan oleh,</p>
                  <p className="font-bold text-[#1B271B]">Bendahara Lingkungan</p>
                  <div className="h-16 sm:h-20 print:h-14" />
                  <div className="border-b border-[#6E786D] w-32 sm:w-40 mx-auto" />
                  <p className="font-bold text-[#1B271B] mt-1.5">Andriansyah</p>
                  <p className="text-[10px] text-[#6E786D]">Pengurus Kas &amp; IPL</p>
                </div>
              </div>
            </footer>
          </article>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 2: MATRIKS PEMBAYARAN IPL 12 BULAN + ALOKASI DANA DARURAT */}
      {/* ================================================================= */}
      {subTab === 'matriks' && (
        <div className="space-y-5">
          {/* Ringkasan Alokasi Kas & Dana Darurat */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5">
              <p className="text-xs font-medium text-[#6E786D]">
                Total Kas Terverifikasi ({TAHUN_AKTIF})
              </p>
              <p className="text-2xl font-mono font-bold text-[#1B271B] tabular-nums mt-1.5">
                {formatRupiah(cashSummary.totalTerverifikasi)}
              </p>
              <p className="text-xs text-[#6E786D] mt-1">Akumulasi seluruh setoran lunas</p>
            </div>

            <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5">
              <p className="text-xs font-medium text-[#6E786D]">Kas IPL Reguler (≥ Rp 100.000/bln)</p>
              <p className="text-2xl font-mono font-bold text-[#243825] tabular-nums mt-1.5">
                {formatRupiah(cashSummary.alokasiIplReguler)}
              </p>
              <p className="text-xs text-[#6E786D] mt-1">Operasional &amp; pemeliharaan lingkungan</p>
            </div>

            <div className="glass-card bg-purple-50/70 border border-purple-300 rounded-3xl p-5">
              <p className="text-xs font-semibold text-purple-900">
                Alokasi Dana Darurat (&lt; Rp 100.000/bln)
              </p>
              <p className="text-2xl font-mono font-bold text-purple-700 tabular-nums mt-1.5">
                {formatRupiah(cashSummary.alokasiDanaDarurat)}
              </p>
              <p className="text-xs text-purple-800/80 mt-1 tabular-nums">
                {cashSummary.jumlahTransaksiDarurat} transaksi setoran khusus/parsial (belum lunas IPL)
              </p>
            </div>
          </section>

          {/* Toolbar Filter & Export */}
          <div className="relative z-10 glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[200px] flex-1 sm:flex-none">
                <Search className="w-4 h-4 text-[#6E786D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari blok / nama..."
                  className="w-full min-h-[42px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] pl-9 pr-3 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
                />
              </div>

              <select
                aria-label="Filter Blok"
                value={blokFilter}
                onChange={(e) => setBlokFilter(e.target.value)}
                className="min-h-[42px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3 text-xs font-semibold text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
              >
                {blokOptions.map((b) => (
                  <option key={b} value={b}>
                    {b === 'Semua' ? 'Semua Blok' : `Blok ${b}`}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap items-center gap-1 p-1 bg-[#F1ECE0] rounded-2xl">
                {(['Semua', 'Lunas', 'Darurat', 'Menunggak'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      statusFilter === st
                        ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-sm'
                        : 'text-[#4A554A] hover:text-[#243825]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportCsv}
                className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Export Excel (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Matriks Pembayaran 12 Bulan (Jan – Des 2026) */}
          <section className="relative z-10 glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-serif-brand text-base font-bold text-[#1B271B]">
                  Matriks Pembayaran 12 Bulan ({TAHUN_AKTIF})
                </h2>
                <p className="text-xs text-[#6E786D]">
                  Sage lembut = wajib iuran · Krem hangat = kosong/bebas iuran · Mulai penagihan:{' '}
                  <span className="font-semibold text-[#1B271B]">
                    {formatBillingStartLabel(brand)}
                  </span>{' '}
                  (sebelumnya Pra-Rilis) · Filter mengacu {getNamaBulan(currentMonth)} {TAHUN_AKTIF}.
                  {delinquencyFilter !== 'all' && (
                    <span className="ml-1 font-semibold text-[#243825]">
                      (Filter tunggakan:{' '}
                      {delinquencyFilter === 'gt0'
                        ? '≥ 1 bulan'
                        : delinquencyFilter === 'gt3'
                          ? '> 3 bulan'
                          : `${delinquencyFilter} bulan`}
                      )
                    </span>
                  )}
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-[#243825] tabular-nums">
                {filteredWarga.length} unit tampil
              </span>
            </div>

            {/* Kartu Ringkasan Statistik Matriks di Dalam Kontainer Matriks */}
            <div className="px-4 sm:px-5 pt-4">
              <section
                aria-label="Ringkasan Statistik Matriks IPL Bulan Berjalan"
                className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-4"
              >
                {/* 1. Blok Wajib Iuran */}
                <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/75 p-3.5">
                  <p className="text-[11px] font-semibold text-[#243825]">Unit Wajib Iuran</p>
                  <p className="text-lg sm:text-xl font-mono font-bold text-[#243825] tabular-nums mt-1">
                    {matrixSummary.berpenghuniCount} Unit
                  </p>
                  <p className="text-[11px] text-[#384E35] mt-0.5">Berpenghuni aktif</p>
                </div>

                {/* 2. Blok Kosong / Bebas Iuran */}
                <div className="rounded-2xl border border-[#E2C285] bg-[#F2D8A7]/45 p-3.5">
                  <p className="text-[11px] font-semibold text-[#4A3410]">Kosong / Bebas Iuran</p>
                  <p className="text-lg sm:text-xl font-mono font-bold text-[#4A3410] tabular-nums mt-1">
                    {matrixSummary.kosongCount + matrixSummary.exemptCount} Unit
                  </p>
                  <p className="text-[11px] text-[#6E4D12] mt-0.5 tabular-nums">
                    {matrixSummary.kosongCount} kosong{matrixSummary.exemptCount > 0 ? ` · ${matrixSummary.exemptCount} bebas iuran` : ''}
                  </p>
                </div>

                {/* 3. Sudah Setor (Lunas >= Rp100rb) */}
                <div className="rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] p-3.5">
                  <p className="text-[11px] font-semibold text-[#4A554A]">
                    Sudah Setor ({getNamaBulan(currentMonth)})
                  </p>
                  <p className="text-lg sm:text-xl font-mono font-bold text-[#243825] tabular-nums mt-1">
                    {matrixSummary.sudahSetorCount} Unit
                  </p>
                  <p className="text-[11px] text-[#6E786D] mt-0.5 tabular-nums">
                    {matrixSummary.lunasBulanIniCount} Lunas ≥ Rp100rb (
                    {matrixSummary.berpenghuniCount > 0
                      ? `${Math.round((matrixSummary.sudahSetorCount / matrixSummary.berpenghuniCount) * 100)}%`
                      : '0%'}
                    )
                  </p>
                </div>

                {/* 4. Belum Setor (Termasuk Dana Darurat < Rp100rb) */}
                <div className="rounded-2xl border border-[#C87058]/40 bg-[#C87058]/10 p-3.5">
                  <p className="text-[11px] font-semibold text-[#A44831]">
                    Belum Setor ({getNamaBulan(currentMonth)})
                  </p>
                  <p className="text-lg sm:text-xl font-mono font-bold text-[#A44831] tabular-nums mt-1">
                    {matrixSummary.belumSetorCount} Unit
                  </p>
                  <p className="text-[11px] text-[#A44831]/85 mt-0.5 tabular-nums">
                    {isBeforeBillingStart(TAHUN_AKTIF, currentMonth, brand)
                      ? 'Periode Pra-Rilis (Belum Berlaku)'
                      : matrixSummary.daruratBulanIniCount > 0
                        ? `${matrixSummary.daruratBulanIniCount} Dana Darurat (<100rb)${matrixSummary.menungguCount > 0 ? ` · ${matrixSummary.menungguCount} pending` : ''}`
                        : matrixSummary.menungguCount > 0
                          ? `${matrixSummary.menungguCount} menunggu verifikasi`
                          : 'Unit aktif belum lunas'}
                  </p>
                </div>

                {/* 5. Menunggak (Lewat Tgl 7) + Filter Rincian */}
                <div className="col-span-2 sm:col-span-1 rounded-2xl border border-[#E2C285] bg-[#F2D8A7]/55 p-3.5 flex flex-col justify-between gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold text-[#4A3410]">
                        Menunggak (Lewat Tgl 7)
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          setDelinquencyFilter((prev) => (prev === 'gt0' ? 'all' : 'gt0'))
                        }
                        title="Filter unit menunggak melewati jatuh tempo tgl 7"
                        className={`mt-1 text-left font-mono text-lg sm:text-xl font-bold tabular-nums cursor-pointer underline-offset-4 hover:underline ${
                          delinquencyFilter === 'gt0' ? 'text-[#243825] underline' : 'text-[#4A3410]'
                        }`}
                      >
                        {matrixSummary.menunggakTotal} Unit
                      </button>
                    </div>
                    {delinquencyFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setDelinquencyFilter('all')}
                        className="px-2 py-1 rounded-lg bg-[#FFFDF8] border border-[#E2C285] text-[10px] font-semibold text-[#4A3410] hover:bg-[#F2D8A7]/40 cursor-pointer shrink-0"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { key: '1', label: '1 bln', count: matrixSummary.menunggak1Bln },
                        { key: '2', label: '2 bln', count: matrixSummary.menunggak2Bln },
                        { key: '3', label: '3 bln', count: matrixSummary.menunggak3Bln },
                        { key: 'gt3', label: '>3 bln', count: matrixSummary.menunggakGt3Bln },
                      ] as const
                    ).map((item) => {
                      const active = delinquencyFilter === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() =>
                            setDelinquencyFilter((prev) => (prev === item.key ? 'all' : item.key))
                          }
                          className={`px-1.5 py-0.5 rounded-lg border text-[10px] font-semibold tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-[#2B3F29] text-[#FFFDF8] border-[#2B3F29] shadow-2xs'
                              : 'bg-[#FFFDF8] text-[#4A3410] border-[#E2C285] hover:bg-[#F2D8A7]/50'
                          }`}
                        >
                          {item.label}: {item.count}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              {/* Legenda Status Sel Matriks */}
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-[#4A554A]">
                <span className="font-semibold text-[#243825] mr-1">Keterangan:</span>
                {(
                  ['LUNAS', 'DANA_DARURAT', 'BERJALAN', 'MASA_TAGIH', 'TUNGGAK', 'PRA_RILIS'] as const
                ).map((stKey) => {
                  const stBadge = getStatusBadgeStyle(stKey);
                  return (
                    <span
                      key={stKey}
                      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${stBadge.className}`}
                    >
                      {stBadge.label}
                    </span>
                  );
                })}
                <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[#F2D8A7]/70 text-[#4A3410] border border-[#E2C285]">
                  Pending
                </span>
                <span className="text-[10.5px] text-[#6E786D]">
                  · <strong className="text-[#4A554A]">Darurat</strong>: &lt; Rp100.000/bln ·{' '}
                  <strong className="text-[#4A554A]">Masa Tagih</strong>: Tgl 1–7 bulan depan
                </span>
              </div>
            </div>

            <div className="relative z-0 overflow-x-auto w-full border-t border-[#E6E2D6]">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E6E2D6] bg-[#E5EEE3]/65 text-[11px] font-semibold text-[#243825]">
                    <th className="py-3 px-4 sticky left-0 bg-[#E5EEE3] z-10 whitespace-nowrap border-r border-[#C6D2BF]">
                      Blok / Warga
                    </th>
                    {BULAN_LIST.map((b) => (
                      <th
                        key={b.angka}
                        className={`py-3 px-2 text-center whitespace-nowrap ${
                          b.angka === currentMonth ? 'bg-[#D3E3D0] text-[#243825]' : ''
                        }`}
                      >
                        {b.singkat}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E2D6]/70 text-xs">
                  {pagedWarga.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-10 text-center text-sm text-[#6E786D]">
                        Tidak ada unit rumah yang cocok dengan filter yang dipilih.
                      </td>
                    </tr>
                  ) : (
                    pagedWarga.map((w) => {
                      const kosong = !isUnitBillable(w);
                      return (
                        <tr
                          key={w.id}
                          className={`group transition-colors ${
                            kosong
                              ? 'bg-[#F2D8A7]/30 hover:bg-[#F2D8A7]/45'
                              : 'bg-[#E5EEE3]/40 hover:bg-[#E5EEE3]/70'
                          }`}
                        >
                          <td
                            className={`py-3 px-4 sticky left-0 z-10 whitespace-nowrap border-r transition-colors ${
                              kosong
                                ? 'bg-[#F7E8C9] group-hover:bg-[#F2D8A7] border-[#E2C285]'
                                : 'bg-[#ECF3EA] group-hover:bg-[#E5EEE3] border-[#C6D2BF]'
                            }`}
                          >
                            <p
                              className={`font-mono font-bold tabular-nums ${
                                kosong ? 'text-[#4A3410]' : 'text-[#243825]'
                              }`}
                            >
                              {formatBlokRumah(w.blok_rumah) || w.blok_rumah}
                            </p>
                            <p
                              className={`text-[11px] truncate max-w-[155px] ${
                                kosong ? 'text-[#6E4D12] font-medium' : 'text-[#384E35]'
                              }`}
                            >
                              {w.nama_warga}
                              {w.is_exempt ? ' (Bebas Iuran)' : ''}
                            </p>
                          </td>
                          {BULAN_LIST.map((b) => {
                            const cellKey = buildBillingCellKey(w.blok_rumah, TAHUN_AKTIF, b.angka);
                            const paidAmount = paidAmountByKey.get(cellKey) ?? 0;
                            const cellStatus = resolveUnitMonthBillingStatus({
                              warga: w,
                              targetYear: TAHUN_AKTIF,
                              targetMonth: b.angka,
                              paidAmount,
                              billingStart: brand,
                              now: effectiveNow,
                            });
                            const isPending = paidAmount === 0 && pendingKeys.has(cellKey);
                            const badge = getMatrixBadgeDisplay(cellStatus, isPending, paidAmount);
                            return (
                              <td
                                key={b.angka}
                                className={`py-2.5 px-1.5 text-center ${
                                  b.angka === currentMonth
                                    ? kosong
                                      ? 'bg-[#F2D8A7]/40'
                                      : 'bg-[#E5EEE3]/70'
                                    : ''
                                }`}
                              >
                                <span
                                  className={`inline-block w-full min-w-[66px] py-1 px-1.5 rounded-md text-[10px] font-semibold text-center whitespace-nowrap ${badge.className}`}
                                >
                                  {badge.label}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {filteredWarga.length > PAGE_SIZE && (
              <div className="px-4 py-3 border-t border-[#E6E2D6] bg-[#F6F3EA]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-[#4A554A]">
                <span className="tabular-nums text-center sm:text-left">
                  Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safePage * PAGE_SIZE, filteredWarga.length)} dari {filteredWarga.length} unit
                </span>
                <div className="flex items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex-1 sm:flex-none min-h-[36px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3] disabled:opacity-40 inline-flex items-center justify-center gap-1 font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                    <span>Sebelumnya</span>
                  </button>
                  <span className="px-2 font-mono font-semibold text-[#243825] tabular-nums whitespace-nowrap shrink-0">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="flex-1 sm:flex-none min-h-[36px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3] disabled:opacity-40 inline-flex items-center justify-center gap-1 font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <span>Berikutnya</span>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Modal Input Setoran Tunai Manual oleh Admin */}
      {manualModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-[#142015]/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          onClick={() => !submitting && setManualModalOpen(false)}
        >
          <form
            onSubmit={handleManualSubmit}
            className="bg-[#FFFDF8] rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] flex flex-col border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F6F3EA] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-serif-brand text-sm sm:text-base font-bold text-[#1B271B] truncate">
                  Input Setoran Tunai Manual (Admin)
                </h3>
                <p className="text-xs text-[#6E786D]">
                  Otomatis berstatus Terverifikasi &amp; menyinkronkan e-Card menjadi Lunas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-full text-[#6E786D] hover:text-[#1B271B] hover:bg-[#E5EEE3] cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                  Pilih Unit Warga
                </label>
                <select
                  required
                  value={selectedWargaId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedWargaId(id);
                    const found = wargaList.find((w) => w.id === id);
                    if (found) {
                      setNominalInput(String(found.nominal_iuran * selectedMonths.length));
                    }
                  }}
                  className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                >
                  {sortedWargaList.map((w) => (
                    <option key={w.id} value={w.id}>
                      {formatBlokRumah(w.blok_rumah) || w.blok_rumah} — {w.nama_warga} ({w.status_hunian})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1B271B] mb-1.5">
                  Pilih Bulan Pembayaran ({TAHUN_AKTIF})
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {BULAN_LIST.map((b) => {
                    const checked = selectedMonths.includes(b.angka);
                    return (
                      <button
                        key={b.angka}
                        type="button"
                        onClick={() => toggleManualMonth(b.angka)}
                        className={`min-h-[38px] rounded-xl border text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                          checked
                            ? 'bg-[#E5EEE3] border-[#2B3F29] text-[#243825]'
                            : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]/50'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-[#243825]" />}
                        <span>{b.singkat}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                    Petugas Penerima
                  </label>
                  <select
                    value={petugas}
                    onChange={(e) => setPetugas(e.target.value)}
                    className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                  >
                    {PETUGAS_PENERIMA.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                    Nominal Diterima (Rp)
                  </label>
                  <input
                    type="number"
                    min={1000}
                    required
                    value={nominalInput}
                    onChange={(e) => setNominalInput(e.target.value)}
                    className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm font-mono font-bold tabular-nums text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                  Keterangan (Opsional)
                </label>
                <input
                  type="text"
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  placeholder="Contoh: Setoran tunai saat rapat lingkungan"
                  className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                />
              </div>
            </div>

            <div className="shrink-0 px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-[#F6F3EA] border-t border-[#E6E2D6] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-sm font-semibold text-[#4A554A] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || selectedMonths.length === 0}
                aria-busy={submitting}
                className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-[#FFFDF8] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {submitting && <LoadingSpinner size="xs" tone="white" />}
                <span>{submitting ? 'Menyimpan...' : 'Simpan & Verifikasi'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
