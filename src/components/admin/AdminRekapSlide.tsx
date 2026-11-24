import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Banknote,
  Search,
  X,
  Check,
  ChevronLeft,
  ChevronRight,
  Printer,
  FileText,
  TableProperties,
  BookOpen,
  FileBarChart2,
} from 'lucide-react';
import {
  BULAN_LIST,
  isKetuaRole,
  NOMINAL_IPL_STANDAR,
  PETUGAS_PENERIMA,
  TAHUN_AKTIF,
  type SessionUser,
  type StatusBulanEcard,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../../types';
import {
  canonicalizeBlokKey,
  extractBlokPrefix,
  formatRupiah,
  formatTanggal,
  formatTanggalSingkat,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
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
import { BrandLogo } from '../BrandLogo';
import { OfficialStamp } from '../OfficialStamp';
import { ChairmanMonthlyReportPanel } from './ChairmanMonthlyReportPanel';

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

function getMatrixCellBadge(status: StatusBulanEcard) {
  switch (status) {
    case 'Lunas':
      return { text: 'Lunas', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' };
    case 'Menunggu Verifikasi':
      return { text: 'Pending', cls: 'bg-amber-50 text-amber-800 border-amber-200' };
    case 'Jatuh Tempo':
    case 'Belum Bayar':
      return { text: 'Tunggak', cls: 'bg-red-50 text-red-700 border-red-200' };
    default:
      return { text: '—', cls: 'bg-slate-50 text-slate-400 border-slate-200' };
  }
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
  const isKetua = isKetuaRole(session);
  const PAGE_SIZE = 20;
  const currentMonth = getCurrentBillingMonth();

  // Sub-tab Rekap Bulanan (Buku Kas Umum), Laporan Otomatis Ketua, vs Matriks 12 Bulan
  const [subTab, setSubTab] = useState<RekapSubTab>('bulanan');
  const [selectedBulan, setSelectedBulan] = useState<number>(currentMonth);
  const [selectedTahun, setSelectedTahun] = useState<number>(TAHUN_AKTIF);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [printingPdf, setPrintingPdf] = useState(false);

  // Filter Matriks 12 Bulan
  const [blokFilter, setBlokFilter] = useState<string>('Semua');
  const [statusFilter, setStatusFilter] = useState<'Semua' | 'Lunas' | 'Menunggak'>('Semua');
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
    () => buildMonthlyCashReport(selectedTahun, selectedBulan, transaksiList, transaksiKasList),
    [selectedTahun, selectedBulan, transaksiList, transaksiKasList]
  );

  const blokOptions = useMemo(() => {
    const prefixes = new Set<string>(['B3', 'B5', 'B6', 'B7', 'B8']);
    for (const w of wargaList) {
      prefixes.add(extractBlokPrefix(w.blok_rumah));
    }
    return ['Semua', ...Array.from(prefixes).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))];
  }, [wargaList]);

  const filteredWarga = useMemo(() => {
    const q = search.trim().toLowerCase();
    return wargaList.filter((w) => {
      const prefix = extractBlokPrefix(w.blok_rumah);
      if (blokFilter !== 'Semua' && prefix !== blokFilter) return false;
      if (q && !w.blok_rumah.toLowerCase().includes(q) && !w.nama_warga.toLowerCase().includes(q)) {
        return false;
      }

      if (statusFilter !== 'Semua') {
        const wKey = canonicalizeBlokKey(w.blok_rumah);
        const currentSt = statusList.find(
          (s) =>
            canonicalizeBlokKey(s.blok_rumah) === wKey &&
            s.tahun === TAHUN_AKTIF &&
            s.bulan === currentMonth
        )?.status;
        if (statusFilter === 'Lunas' && currentSt !== 'Lunas') return false;
        if (
          statusFilter === 'Menunggak' &&
          (currentSt === 'Lunas' || currentSt === 'Menunggu Verifikasi')
        ) {
          return false;
        }
      }
      return true;
    });
  }, [wargaList, statusList, blokFilter, statusFilter, search, currentMonth]);

  useEffect(() => {
    setPage(1);
  }, [blokFilter, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredWarga.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedWarga = useMemo(
    () => filteredWarga.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredWarga, safePage]
  );

  const openManualModal = () => {
    const first = wargaList[0];
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
          `Setoran tunai ${selectedWargaObj.blok_rumah} berhasil dicatat & otomatis Terverifikasi.`
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
    exportLaporanExcel(wargaList, statusList, transaksiList);
    void recordAuditLog({
      session,
      action: 'EXPORT_EXCEL',
      entity: 'laporan_kas',
      summary: `Admin mengekspor Laporan Rekap Matriks & Kas (${TAHUN_AKTIF}) ke format Excel (.xlsx).`,
    });
    onToast('success', 'Laporan Excel (.xlsx) berhasil diunduh.');
  };

  const handleExportCsv = () => {
    exportLaporanCsv(wargaList, statusList, transaksiList);
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
      {/* Sub-Tab Switcher & Quick Action Input Tunai */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex p-1.5 bg-indigo-50/80 border border-indigo-100/90 backdrop-blur-md rounded-2xl w-full sm:w-fit overflow-x-auto">
          <button
            type="button"
            onClick={() => setSubTab('bulanan')}
            className={`flex-1 sm:flex-none min-h-[40px] px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'bulanan'
                ? 'bg-[#4C1D95] text-white shadow-sm'
                : 'text-slate-600 hover:text-[#4C1D95]'
            }`}
          >
            <BookOpen className={`w-4 h-4 shrink-0 ${subTab === 'bulanan' ? 'text-emerald-300' : 'text-[#4C1D95]'}`} />
            <span>Rekap Bulanan (Buku Kas)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('matriks')}
            className={`flex-1 sm:flex-none min-h-[40px] px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
              subTab === 'matriks'
                ? 'bg-[#4C1D95] text-white shadow-sm'
                : 'text-slate-600 hover:text-[#4C1D95]'
            }`}
          >
            <TableProperties className={`w-4 h-4 shrink-0 ${subTab === 'matriks' ? 'text-indigo-200' : 'text-slate-500'}`} />
            <span>Matriks IPL 12 Bulan</span>
          </button>
          {isKetua && (
            <button
              type="button"
              onClick={() => setSubTab('ketua')}
              className={`flex-1 sm:flex-none min-h-[40px] px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                subTab === 'ketua'
                  ? 'bg-[#4C1D95] text-white shadow-sm'
                  : 'text-slate-600 hover:text-[#4C1D95]'
              }`}
            >
              <FileBarChart2 className={`w-4 h-4 shrink-0 ${subTab === 'ketua' ? 'text-emerald-300' : 'text-[#4C1D95]'}`} />
              <span>Laporan Ketua (PDF)</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={openManualModal}
          className="min-h-[42px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
        >
          <Banknote className="w-4 h-4 shrink-0" />
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
          <div className="no-print glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                aria-label="Pilih Bulan Rekapitulasi"
                value={selectedBulan}
                onChange={(e) => setSelectedBulan(Number(e.target.value))}
                className="min-h-[42px] rounded-2xl border border-indigo-100 bg-white/95 px-3.5 text-sm font-semibold text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
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
                className="min-h-[42px] rounded-2xl border border-indigo-100 bg-white/95 px-3.5 text-sm font-mono font-semibold text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
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
                className="min-h-[42px] px-4 rounded-full border border-slate-200 bg-white/95 hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-all duration-200 active:scale-[0.97]"
              >
                {printingPdf ? (
                  <LoadingSpinner size="xs" tone="current" />
                ) : (
                  <Printer className="w-4 h-4 text-slate-600" />
                )}
                <span>{printingPdf ? 'Menyiapkan...' : 'Cetak A4'}</span>
              </button>

              <button
                type="button"
                disabled={downloadingPdf || printingPdf}
                onClick={() => void handleDownloadMonthlyPdf()}
                className="min-h-[42px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-all duration-200 active:scale-[0.97] shadow-sm"
              >
                {downloadingPdf ? (
                  <LoadingSpinner size="xs" tone="white" />
                ) : (
                  <FileText className="w-4 h-4 text-emerald-300" />
                )}
                <span>{downloadingPdf ? 'Menyiapkan PDF...' : 'Unduh PDF A4'}</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className="min-h-[42px] px-4 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-xs font-semibold text-[#064E3B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
              >
                <FileSpreadsheet className="w-4 h-4 text-[#064E3B]" />
                <span>Excel</span>
              </button>
            </div>
          </div>

          {/* Dokumen Resmi Rekapitulasi Bulanan (#printable-report) */}
          <article
            id="printable-report"
            className="bg-white border border-indigo-100/90 rounded-3xl print:rounded-none print:border-none print:shadow-none p-4 sm:p-7 print:p-0 space-y-5 print:space-y-3.5 min-w-0 overflow-hidden print:overflow-visible"
          >
            {/* Kop Resmi Perumahan */}
            <header className="pb-3.5 print:pb-2.5 border-b-2 border-[#0F172A] flex items-center gap-3 sm:gap-4">
              <BrandLogo size="md" variant="light" className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-[#059669] leading-tight">
                  Pengurus Lingkungan Perumahan Saung Kebun
                </p>
                <h2 className="text-sm sm:text-lg print:text-base font-extrabold text-[#0F172A] leading-snug mt-0.5">
                  Rekapitulasi Keuangan Bulanan — {monthlyReport.namaBulan} {monthlyReport.tahun}
                </h2>
                <p className="text-[11px] sm:text-xs text-slate-600 mt-0.5 leading-snug">
                  {(brand.kop_resmi || '')
                    .replace(/^pengurus\s+lingkungan\s+perumahan\s+saung\s+kebun\s*[—–\-:|·]*\s*/i, '')
                    .trim() ||
                    'Desa Bengle, Kec. Majalaya, Kab. Karawang · Sekretariat Blok B3/7'}
                </p>
              </div>
            </header>

            {/* 5 Kartu Posisi Kas Bulanan — Otomatis 5 Kolom Saat Cetak A4 */}
            <section className="grid grid-cols-2 lg:grid-cols-5 print:grid-cols-5 gap-2.5 print:gap-2 avoid-break">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-slate-500">
                  Saldo Awal
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-[#0F172A] tabular-nums mt-1">
                  {formatRupiah(monthlyReport.saldoAwal)}
                </p>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-emerald-800">
                  Pemasukan IPL
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-emerald-700 tabular-nums mt-1">
                  {formatRupiah(monthlyReport.totalIplBulanIni)}
                </p>
                <p className="text-[10px] print:text-[8.5px] text-emerald-700/80 mt-0.5 tabular-nums">
                  {monthlyReport.jumlahTransaksiIpl} transaksi
                </p>
              </div>

              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-sky-800">
                  Pemasukan Lain
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-sky-700 tabular-nums mt-1">
                  {formatRupiah(monthlyReport.totalPemasukanLainBulanIni)}
                </p>
                <p className="text-[10px] print:text-[8.5px] text-sky-700/80 mt-0.5 tabular-nums">
                  {monthlyReport.jumlahPemasukanLain} transaksi
                </p>
              </div>

              <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-rose-800">
                  Pengeluaran
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold text-rose-700 tabular-nums mt-1">
                  {formatRupiah(monthlyReport.totalKeluarBulanIni)}
                </p>
                <p className="text-[10px] print:text-[8.5px] text-rose-700/80 mt-0.5 tabular-nums">
                  {monthlyReport.jumlahPengeluaran} transaksi
                </p>
              </div>

              <div className="col-span-2 lg:col-span-1 print:col-span-1 rounded-xl border border-[#0F172A] bg-[#0F172A] text-white p-3 print:p-2">
                <p className="text-[10px] sm:text-[11px] print:text-[9px] font-medium text-emerald-300">
                  Saldo Akhir
                </p>
                <p className="text-sm sm:text-base print:text-xs font-mono font-bold tabular-nums mt-1">
                  {formatRupiah(monthlyReport.saldoAkhir)}
                </p>
              </div>
            </section>

            {/* Rincian Pengeluaran per Kategori */}
            {monthlyReport.pengeluaranPerKategori.length > 0 && (
              <section className="space-y-2 print:space-y-1.5 avoid-break">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Realisasi Pengeluaran per Pos Anggaran
                </h3>
                <div className="overflow-x-auto w-full border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs print:text-[10px]">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <th className="py-2 print:py-1.5 px-3.5">Pos Anggaran</th>
                        <th className="py-2 print:py-1.5 px-3 text-center">Trx</th>
                        <th className="py-2 print:py-1.5 px-3 text-right">Porsi</th>
                        <th className="py-2 print:py-1.5 px-3.5 text-right">Total Nominal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {monthlyReport.pengeluaranPerKategori.map((item) => (
                        <tr key={item.kategori}>
                          <td className="py-2 print:py-1.5 px-3.5 font-semibold text-[#0F172A]">
                            {item.kategori}
                          </td>
                          <td className="py-2 print:py-1.5 px-3 text-center font-mono tabular-nums text-slate-600">
                            {item.jumlahTransaksi}
                          </td>
                          <td className="py-2 print:py-1.5 px-3 text-right font-mono tabular-nums text-slate-600">
                            {item.persentase}%
                          </td>
                          <td className="py-2 print:py-1.5 px-3.5 text-right font-mono font-bold text-rose-700 tabular-nums whitespace-nowrap">
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
            <section className="space-y-2 print:space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Buku Kas Umum — Mutasi Kronologis ({monthlyReport.namaBulan} {monthlyReport.tahun})
                </h3>
                <span className="text-xs print:text-[10px] font-mono text-slate-500 tabular-nums">
                  {monthlyReport.mutasiKronologis.length} entri
                </span>
              </div>

              <div className="overflow-x-auto w-full border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse text-xs print:text-[9.5px]">
                  <thead>
                    <tr className="bg-[#0F172A] text-white font-semibold">
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 whitespace-nowrap">Tanggal</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 whitespace-nowrap">No. Bukti</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3">Uraian &amp; Kategori</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right whitespace-nowrap">Masuk</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right whitespace-nowrap">Keluar</th>
                      <th className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right whitespace-nowrap">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {/* Baris Saldo Awal */}
                    <tr className="bg-slate-50 font-semibold">
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-slate-500 whitespace-nowrap">—</td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-slate-500 whitespace-nowrap">
                        SALDO-AWAL
                      </td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-[#0F172A]">
                        Saldo Kas Awal Bulan {monthlyReport.namaBulan} {monthlyReport.tahun}
                      </td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono text-slate-400">—</td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono text-slate-400">—</td>
                      <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-bold text-[#0F172A] tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.saldoAwal)}
                      </td>
                    </tr>

                    {monthlyReport.mutasiKronologis.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-500">
                          Belum ada mutasi kas masuk maupun pengeluaran pada {monthlyReport.namaBulan}{' '}
                          {monthlyReport.tahun}.
                        </td>
                      </tr>
                    ) : (
                      monthlyReport.mutasiKronologis.map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/70">
                          <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-slate-600 whitespace-nowrap tabular-nums">
                            {formatTanggalSingkat(row.tanggal)}
                          </td>
                          <td className="py-2 print:py-1.5 px-2.5 sm:px-3 font-mono text-[10px] text-slate-600 whitespace-nowrap">
                            {row.noBukti}
                          </td>
                          <td className="py-2 print:py-1.5 px-2.5 sm:px-3 min-w-[180px]">
                            <p className="font-medium text-[#0F172A] leading-snug">{row.uraian}</p>
                            <p className="text-[10px] text-slate-500 mt-0.5">{row.kategori}</p>
                          </td>
                          <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                            {row.masuk > 0 ? formatRupiah(row.masuk) : '—'}
                          </td>
                          <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-semibold text-rose-700 tabular-nums whitespace-nowrap">
                            {row.keluar > 0 ? formatRupiah(row.keluar) : '—'}
                          </td>
                          <td className="py-2 print:py-1.5 px-2.5 sm:px-3 text-right font-mono font-bold text-[#0F172A] tabular-nums whitespace-nowrap">
                            {formatRupiah(row.saldoBerjalan)}
                          </td>
                        </tr>
                      ))
                    )}

                    {/* Baris Total & Saldo Akhir */}
                    <tr className="bg-emerald-50/70 border-t-2 border-emerald-200 font-bold">
                      <td colSpan={3} className="py-2.5 print:py-2 px-2.5 sm:px-3 text-[#0F172A]">
                        TOTAL MUTASI &amp; SALDO AKHIR ({monthlyReport.namaBulan.toUpperCase()}{' '}
                        {monthlyReport.tahun})
                      </td>
                      <td className="py-2.5 print:py-2 px-2.5 sm:px-3 text-right font-mono text-emerald-800 tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.totalMasukBulanIni)}
                      </td>
                      <td className="py-2.5 print:py-2 px-2.5 sm:px-3 text-right font-mono text-rose-800 tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.totalKeluarBulanIni)}
                      </td>
                      <td className="py-2.5 print:py-2 px-2.5 sm:px-3 text-right font-mono text-[#059669] tabular-nums whitespace-nowrap">
                        {formatRupiah(monthlyReport.saldoAkhir)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {/* Blok Tanda Tangan & Stempel Pengurus — Stempel Rapi di Area TTD (Tidak Menutupi Nama) */}
            <footer className="pt-3 print:pt-2.5 border-t border-slate-200 avoid-break">
              <p className="text-xs print:text-[10px] text-slate-600 text-right mb-3">
                Karawang, {formatTanggal(new Date().toISOString())}
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
                  <p className="text-slate-500">Mengetahui,</p>
                  <p className="font-bold text-[#0F172A]">Ketua Lingkungan</p>
                  <div className="h-16 sm:h-20 print:h-14" />
                  <div className="border-b border-slate-400 w-32 sm:w-40 mx-auto" />
                  <p className="font-bold text-[#0F172A] mt-1.5">Erlangga</p>
                  <p className="text-[10px] text-slate-500">Perumahan Saung Kebun</p>
                </div>

                <div>
                  <p className="text-slate-500">Disusun &amp; Disahkan oleh,</p>
                  <p className="font-bold text-[#0F172A]">Bendahara Lingkungan</p>
                  <div className="h-16 sm:h-20 print:h-14" />
                  <div className="border-b border-slate-400 w-32 sm:w-40 mx-auto" />
                  <p className="font-bold text-[#0F172A] mt-1.5">Andriansyah</p>
                  <p className="text-[10px] text-slate-500">Pengurus Kas &amp; IPL</p>
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
            <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5">
              <p className="text-xs font-medium text-slate-500">
                Total Kas Terverifikasi ({TAHUN_AKTIF})
              </p>
              <p className="text-2xl font-mono font-bold text-[#0F172A] tabular-nums mt-1.5">
                {formatRupiah(cashSummary.totalTerverifikasi)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Akumulasi seluruh setoran lunas</p>
            </div>

            <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5">
              <p className="text-xs font-medium text-slate-500">Kas IPL Reguler (≥ Rp 100.000/bln)</p>
              <p className="text-2xl font-mono font-bold text-[#047857] tabular-nums mt-1.5">
                {formatRupiah(cashSummary.alokasiIplReguler)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Operasional &amp; pemeliharaan lingkungan</p>
            </div>

            <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5">
              <p className="text-xs font-medium text-slate-500">
                Alokasi Dana Darurat (&lt; Rp 100.000/bln)
              </p>
              <p className="text-2xl font-mono font-bold text-[#B45309] tabular-nums mt-1.5">
                {formatRupiah(cashSummary.alokasiDanaDarurat)}
              </p>
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                {cashSummary.jumlahTransaksiDarurat} transaksi setoran khusus/parsial
              </p>
            </div>
          </section>

          {/* Toolbar Filter & Export */}
          <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative min-w-[200px] flex-1 sm:flex-none">
                <Search className="w-4 h-4 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari blok / nama..."
                  className="w-full min-h-[42px] rounded-2xl border border-indigo-100 bg-white/95 pl-9 pr-3 text-sm focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                />
              </div>

              <select
                aria-label="Filter Blok"
                value={blokFilter}
                onChange={(e) => setBlokFilter(e.target.value)}
                className="min-h-[42px] rounded-2xl border border-indigo-100 bg-white/95 px-3 text-xs font-semibold text-[#0F172A] focus:border-[#4C1D95] focus:outline-none"
              >
                {blokOptions.map((b) => (
                  <option key={b} value={b}>
                    {b === 'Semua' ? 'Semua Blok' : `Blok ${b}`}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 p-1 bg-indigo-50/80 rounded-2xl">
                {(['Semua', 'Lunas', 'Menunggak'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      statusFilter === st
                        ? 'bg-[#4C1D95] text-white shadow-sm'
                        : 'text-slate-600 hover:text-[#4C1D95]'
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
                className="min-h-[42px] px-4 rounded-full border border-slate-200 bg-white/95 hover:bg-slate-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4 text-slate-500" />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className="min-h-[42px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
                <span>Export Excel (.xlsx)</span>
              </button>
            </div>
          </div>

          {/* Matriks Pembayaran 12 Bulan (Jan – Des 2026) */}
          <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
            <div className="px-5 py-4 border-b border-indigo-100/80 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#0F172A]">
                  Matriks Pembayaran 12 Bulan ({TAHUN_AKTIF})
                </h2>
                <p className="text-xs text-slate-500">
                  Filter status mengacu pada bulan berjalan ({getNamaBulan(currentMonth)} {TAHUN_AKTIF}).
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-[#4C1D95] tabular-nums">
                {filteredWarga.length} unit tampil
              </span>
            </div>

            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-indigo-100/80 bg-indigo-50/70 text-[11px] font-semibold text-[#4C1D95]">
                    <th className="py-3 px-4 sticky left-0 bg-indigo-50/95 z-10 whitespace-nowrap border-r border-indigo-100">
                      Blok / Warga
                    </th>
                    {BULAN_LIST.map((b) => (
                      <th
                        key={b.angka}
                        className={`py-3 px-2 text-center whitespace-nowrap ${
                          b.angka === currentMonth ? 'bg-emerald-50/70 text-emerald-900' : ''
                        }`}
                      >
                        {b.singkat}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {pagedWarga.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="py-10 text-center text-sm text-slate-500">
                        Tidak ada unit rumah yang cocok dengan filter yang dipilih.
                      </td>
                    </tr>
                  ) : (
                    pagedWarga.map((w) => (
                      <tr key={w.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-4 sticky left-0 bg-white z-10 border-r border-slate-100 whitespace-nowrap">
                          <p className="font-mono font-bold text-[#0F172A]">{w.blok_rumah}</p>
                          <p className="text-[11px] text-slate-500 truncate max-w-[140px]">
                            {w.nama_warga}
                          </p>
                        </td>
                        {BULAN_LIST.map((b) => {
                          const wKey = canonicalizeBlokKey(w.blok_rumah);
                          const st =
                            statusList.find(
                              (s) =>
                                canonicalizeBlokKey(s.blok_rumah) === wKey &&
                                s.tahun === TAHUN_AKTIF &&
                                s.bulan === b.angka
                            )?.status || 'Belum Tagihan';
                          const badge = getMatrixCellBadge(st);
                          return (
                            <td
                              key={b.angka}
                              className={`py-2.5 px-1.5 text-center ${
                                b.angka === currentMonth ? 'bg-emerald-50/30' : ''
                              }`}
                            >
                              <span
                                className={`inline-block w-full min-w-[54px] py-1 px-1.5 rounded-md border text-[10px] font-semibold text-center ${badge.cls}`}
                              >
                                {badge.text}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {filteredWarga.length > PAGE_SIZE && (
              <div className="px-4 py-3 border-t border-indigo-100/80 bg-indigo-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-slate-600">
                <span className="tabular-nums text-center sm:text-left">
                  Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safePage * PAGE_SIZE, filteredWarga.length)} dari {filteredWarga.length} unit
                </span>
                <div className="flex items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="flex-1 sm:flex-none min-h-[36px] px-3 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 disabled:opacity-40 inline-flex items-center justify-center gap-1 font-semibold cursor-pointer whitespace-nowrap"
                  >
                    <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                    <span>Sebelumnya</span>
                  </button>
                  <span className="px-2 font-mono font-semibold text-[#4C1D95] tabular-nums whitespace-nowrap shrink-0">
                    {safePage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="flex-1 sm:flex-none min-h-[36px] px-3 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 disabled:opacity-40 inline-flex items-center justify-center gap-1 font-semibold cursor-pointer whitespace-nowrap"
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
          className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          onClick={() => !submitting && setManualModalOpen(false)}
        >
          <form
            onSubmit={handleManualSubmit}
            className="bg-white/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] flex flex-col border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 sm:px-5 py-4 border-b border-indigo-100/70 bg-indigo-50/40 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-[#0F172A] truncate">
                  Input Setoran Tunai Manual (Admin)
                </h3>
                <p className="text-xs text-slate-500">
                  Otomatis berstatus Terverifikasi &amp; menyinkronkan e-Card menjadi Lunas.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-indigo-100/60 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
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
                  className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                >
                  {wargaList.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.blok_rumah} — {w.nama_warga} ({w.status_hunian})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
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
                            ? 'bg-indigo-50 border-[#4C1D95] text-[#4C1D95]'
                            : 'bg-white border-indigo-100 text-slate-600 hover:bg-indigo-50/50'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-[#4C1D95]" />}
                        <span>{b.singkat}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Petugas Penerima
                  </label>
                  <select
                    value={petugas}
                    onChange={(e) => setPetugas(e.target.value)}
                    className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                  >
                    {PETUGAS_PENERIMA.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Nominal Diterima (Rp)
                  </label>
                  <input
                    type="number"
                    min={1000}
                    required
                    value={nominalInput}
                    onChange={(e) => setNominalInput(e.target.value)}
                    className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm font-mono font-bold tabular-nums text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Keterangan (Opsional)
                </label>
                <input
                  type="text"
                  value={keterangan}
                  onChange={(e) => setKeterangan(e.target.value)}
                  placeholder="Contoh: Setoran tunai saat rapat lingkungan"
                  className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                />
              </div>
            </div>

            <div className="shrink-0 px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-indigo-50/40 border-t border-indigo-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="min-h-[42px] px-4 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || selectedMonths.length === 0}
                aria-busy={submitting}
                className="min-h-[42px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
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
