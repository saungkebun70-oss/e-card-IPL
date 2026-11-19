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
} from 'lucide-react';
import {
  BULAN_LIST,
  NOMINAL_IPL_STANDAR,
  PETUGAS_PENERIMA,
  TAHUN_AKTIF,
  type SessionUser,
  type StatusBulanEcard,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type Warga,
} from '../../types';
import {
  extractBlokPrefix,
  formatRupiah,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import {
  calculateCashAllocation,
  exportLaporanCsv,
  exportLaporanExcel,
} from '../../lib/exportReport';
import { submitManualCashAdmin } from '../../lib/dataService';
import { recordAuditLog } from '../../lib/auditLogger';

interface AdminRekapSlideProps {
  session: SessionUser;
  wargaList: Warga[];
  statusList: StatusEcardBulanan[];
  transaksiList: TransaksiIPL[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

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
  onRefresh,
  onToast,
}: AdminRekapSlideProps) {
  const PAGE_SIZE = 20;
  const [blokFilter, setBlokFilter] = useState<string>('Semua');
  const [statusFilter, setStatusFilter] = useState<'Semua' | 'Lunas' | 'Menunggak'>('Semua');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // State Modal Input Setoran Tunai Manual Admin
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [selectedWargaId, setSelectedWargaId] = useState<string>('');
  const [selectedMonths, setSelectedMonths] = useState<number[]>([getCurrentBillingMonth()]);
  const [petugas, setPetugas] = useState<string>(PETUGAS_PENERIMA[0]);
  const [nominalInput, setNominalInput] = useState<string>(String(NOMINAL_IPL_STANDAR));
  const [keterangan, setKeterangan] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentMonth = getCurrentBillingMonth();
  const cashSummary = useMemo(() => calculateCashAllocation(transaksiList), [transaksiList]);

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
        const currentSt = statusList.find(
          (s) =>
            s.blok_rumah === w.blok_rumah && s.tahun === TAHUN_AKTIF && s.bulan === currentMonth
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
    const matchedPetugas = PETUGAS_PENERIMA.find(
      (p) => p.toLowerCase().includes(session.nama_warga.toLowerCase())
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

  return (
    <div className="space-y-6">
      {/* Ringkasan Alokasi Kas & Dana Darurat */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Kas Terverifikasi ({TAHUN_AKTIF})</p>
          <p className="text-2xl font-mono font-bold text-[#0F172A] tabular-nums mt-1.5">
            {formatRupiah(cashSummary.totalTerverifikasi)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Akumulasi seluruh setoran lunas</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-medium text-slate-500">Kas IPL Reguler (≥ Rp 100.000/bln)</p>
          <p className="text-2xl font-mono font-bold text-[#059669] tabular-nums mt-1.5">
            {formatRupiah(cashSummary.alokasiIplReguler)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Operasional &amp; pemeliharaan lingkungan</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <p className="text-xs font-medium text-slate-500">
            Alokasi Dana Darurat (&lt; Rp 100.000/bln)
          </p>
          <p className="text-2xl font-mono font-bold text-amber-700 tabular-nums mt-1.5">
            {formatRupiah(cashSummary.alokasiDanaDarurat)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {cashSummary.jumlahTransaksiDarurat} transaksi setoran khusus/parsial
          </p>
        </div>
      </section>

      {/* Toolbar Filter, Input Tunai Manual & Export */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[200px] flex-1 sm:flex-none">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari blok / nama..."
              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
          </div>

          <select
            aria-label="Filter Blok"
            value={blokFilter}
            onChange={(e) => setBlokFilter(e.target.value)}
            className="min-h-[42px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-[#0F172A] focus:border-emerald-600 focus:outline-none"
          >
            {blokOptions.map((b) => (
              <option key={b} value={b}>
                {b === 'Semua' ? 'Semua Blok' : `Blok ${b}`}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
            {(['Semua', 'Lunas', 'Menunggak'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F172A]'
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
            onClick={openManualModal}
            className="min-h-[42px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Banknote className="w-4 h-4" />
            <span>Input Tunai Manual</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4 text-slate-500" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="min-h-[42px] px-3.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>Export Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Matriks Pembayaran 12 Bulan (Jan – Des 2026) */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">
              Matriks Pembayaran 12 Bulan ({TAHUN_AKTIF})
            </h2>
            <p className="text-xs text-slate-500">
              Filter status mengacu pada bulan berjalan ({getNamaBulan(currentMonth)} {TAHUN_AKTIF}).
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {filteredWarga.length} unit tampil
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-4 sticky left-0 bg-slate-50 z-10 whitespace-nowrap border-r border-slate-200">
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
                      const st =
                        statusList.find(
                          (s) =>
                            s.blok_rumah === w.blok_rumah &&
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
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 text-xs text-slate-600">
            <span className="tabular-nums">
              Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filteredWarga.length)} dari {filteredWarga.length} unit
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 inline-flex items-center gap-1 font-semibold cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Sebelumnya</span>
              </button>
              <span className="px-2 font-mono font-semibold tabular-nums">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 inline-flex items-center gap-1 font-semibold cursor-pointer"
              >
                <span>Berikutnya</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Modal Input Setoran Tunai Manual oleh Admin */}
      {manualModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setManualModalOpen(false)}
        >
          <form
            onSubmit={handleManualSubmit}
            className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">
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
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
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
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
                        className={`min-h-[38px] rounded-lg border text-xs font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                          checked
                            ? 'bg-emerald-50 border-[#059669] text-emerald-900'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-[#059669]" />}
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
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono font-bold tabular-nums focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setManualModalOpen(false)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || selectedMonths.length === 0}
                className="min-h-[42px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
              >
                {submitting ? 'Menyimpan...' : 'Simpan & Verifikasi'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
