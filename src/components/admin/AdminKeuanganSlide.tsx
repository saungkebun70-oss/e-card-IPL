import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Image as ImageIcon,
  Loader2,
  Moon,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  getStatusVerifikasiShortLabel,
  isBendaharaFullAccess,
  isBendaharaOnly,
  isKetuaRole,
  KATEGORI_PEMASUKAN_LAIN_LIST,
  KATEGORI_PENGELUARAN_LIST,
  TERMIN_PENGELUARAN_LIST,
  type JenisTransaksiKas,
  type PetugasKeamanan,
  type SecurityShiftOverride,
  type SessionUser,
  type StatusVerifikasi,
  type TransaksiIPL,
  type TransaksiKas,
} from '../../types';
import {
  createTransaksiKasAdmin,
  deleteTransaksiKasAdmin,
  fetchPetugasListAdmin,
  subscribePetugasKeamananRealtime,
  updateTransaksiKasAdmin,
  verifyTransaksiKasBendaharaAdmin,
  verifyTransaksiKasKetuaAdmin,
  type AdminSnapshot,
} from '../../lib/dataService';
import { calculateGlobalCashSummary } from '../../lib/financeUtils';
import { LoadingSpinner } from '../LoadingSpinner';
import {
  formatRupiah,
  formatTanggalSingkat,
  terbilangRupiah,
} from '../../lib/format';
import { compressProofImage } from '../../lib/imageCompressor';
import {
  fetchShiftOverrides,
  isSundayOvertimeShift,
  revertShiftOverridesByCashTransactionAdmin,
  subscribeShiftOverrides,
} from '../../lib/securityShiftOvertimeService';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';
import { AdminShiftOvertimePanel } from './AdminShiftOvertimePanel';

function isHonorKeamananPos(kat: string): boolean {
  return (
    kat === 'Honor & Lembur Keamanan' ||
    kat === 'Honorarium Keamanan / Satpam' ||
    kat === 'Lembur Petugas Keamanan'
  );
}

const DEFAULT_NON_HONOR_PENGELUARAN =
  KATEGORI_PENGELUARAN_LIST.find((k) => !isHonorKeamananPos(k)) || KATEGORI_PENGELUARAN_LIST[0];

interface AdminKeuanganSlideProps {
  session: SessionUser;
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  petugasList?: PetugasKeamanan[];
  onRefresh: () => Promise<void>;
  onOptimisticMutate?: (updater: (prev: AdminSnapshot) => AdminSnapshot) => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminKeuanganSlide({
  session,
  transaksiList,
  transaksiKasList,
  petugasList = [],
  onRefresh,
  onOptimisticMutate,
  onToast,
}: AdminKeuanganSlideProps) {
  const canEditDelete = isBendaharaFullAccess(session);
  const isBendahara = isBendaharaOnly(session);
  const isKetua = isKetuaRole(session);
  const todayIso = new Date().toISOString().slice(0, 10);

  // Form Pengeluaran / Pemasukan Lain
  const [formJenis, setFormJenis] = useState<JenisTransaksiKas>('pengeluaran');
  const [editingItem, setEditingItem] = useState<TransaksiKas | null>(null);
  const [kategori, setKategori] = useState<string>(DEFAULT_NON_HONOR_PENGELUARAN);
  const [termin, setTermin] = useState<string>(TERMIN_PENGELUARAN_LIST[0]);
  const [tanggal, setTanggal] = useState<string>(todayIso);
  const [nominalStr, setNominalStr] = useState<string>('');
  const [penerimaAtauSumber, setPenerimaAtauSumber] = useState<string>('');
  const [keterangan, setKeterangan] = useState<string>('');
  const [buktiFile, setBuktiFile] = useState<File | null>(null);
  const [buktiPreview, setBuktiPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [keuanganSubTab, setKeuanganSubTab] = useState<'buku_kas' | 'shift_lembur'>('buku_kas');
  const [shiftOverrides, setShiftOverrides] = useState<SecurityShiftOverride[]>([]);
  const [livePetugasList, setLivePetugasList] = useState<PetugasKeamanan[]>(petugasList);

  useEffect(() => {
    setLivePetugasList(petugasList);
  }, [petugasList]);

  const loadSyncedShiftAndOfficers = useCallback(async () => {
    const [ovRows, freshPetugas] = await Promise.all([
      fetchShiftOverrides(session, { limit: 250 }),
      fetchPetugasListAdmin(session),
    ]);
    setShiftOverrides(ovRows);
    if (freshPetugas.length > 0) {
      setLivePetugasList(freshPetugas);
    }
  }, [session]);

  useEffect(() => {
    void loadSyncedShiftAndOfficers();
    const unsubOv = subscribeShiftOverrides(session, () => {
      void loadSyncedShiftAndOfficers();
    });
    const unsubPetugas = subscribePetugasKeamananRealtime(session, () => {
      void loadSyncedShiftAndOfficers();
    });
    return () => {
      unsubOv();
      unsubPetugas();
    };
  }, [session, loadSyncedShiftAndOfficers]);

  const unpaidOvertimeCount = useMemo(
    () =>
      shiftOverrides.filter(
        (o) =>
          isSundayOvertimeShift(o.shift_name) &&
          o.payment_status !== 'paid' &&
          !o.cash_transaction_id
      ).length,
    [shiftOverrides]
  );

  const isHonorKeamananCategory =
    formJenis === 'pengeluaran' && isHonorKeamananPos(kategori);

  const goToShiftLemburTab = () => {
    setKeuanganSubTab('shift_lembur');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Filter & Search Daftar Transaksi Kas
  const [filterJenis, setFilterJenis] = useState<'semua' | JenisTransaksiKas>('semua');
  const [filterStatus, setFilterStatus] = useState<'semua' | StatusVerifikasi>('semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKwitansi, setSelectedKwitansi] = useState<TransaksiKas | null>(null);
  const [selectedProofUrl, setSelectedProofUrl] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [actionNoteModal, setActionNoteModal] = useState<{
    mode: 'bendahara_reject' | 'ketua_return';
    item: TransaksiKas;
  } | null>(null);
  const [actionNoteText, setActionNoteText] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cashSummary = useMemo(
    () => calculateGlobalCashSummary(transaksiList, transaksiKasList),
    [transaksiList, transaksiKasList]
  );

  const parsedNominal = useMemo(() => {
    const clean = nominalStr.replace(/\D/g, '');
    return clean ? Number(clean) : 0;
  }, [nominalStr]);

  const switchJenisForm = (next: JenisTransaksiKas) => {
    setFormJenis(next);
    setEditingItem(null);
    setKategori(
      next === 'pengeluaran' ? DEFAULT_NON_HONOR_PENGELUARAN : KATEGORI_PEMASUKAN_LAIN_LIST[0]
    );
    setTermin(TERMIN_PENGELUARAN_LIST[0]);
  };

  const resetForm = (keepJenis = formJenis) => {
    setEditingItem(null);
    setFormJenis(keepJenis);
    setKategori(
      keepJenis === 'pengeluaran' ? DEFAULT_NON_HONOR_PENGELUARAN : KATEGORI_PEMASUKAN_LAIN_LIST[0]
    );
    setTermin(TERMIN_PENGELUARAN_LIST[0]);
    setTanggal(todayIso);
    setNominalStr('');
    setPenerimaAtauSumber('');
    setKeterangan('');
    setBuktiFile(null);
    setBuktiPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleStartEdit = (item: TransaksiKas) => {
    if (!canEditDelete) return;
    setEditingItem(item);
    setFormJenis(item.jenis);
    setKategori(item.kategori);
    setTermin(item.termin || TERMIN_PENGELUARAN_LIST[0]);
    setTanggal(item.tanggal);
    setNominalStr(String(item.nominal));
    setPenerimaAtauSumber(item.penerima_atau_sumber);
    setKeterangan(item.keterangan || '');
    setBuktiFile(null);
    setBuktiPreview(item.bukti_url || null);
    setKeuanganSubTab('buku_kas');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onToast('error', 'Bukti nota harus berupa gambar (JPG, PNG, atau WebP).');
      return;
    }
    try {
      const compressed = await compressProofImage(file, 1280, 0.78);
      setBuktiFile(compressed.file);
      const url = URL.createObjectURL(compressed.file);
      setBuktiPreview(url);
    } catch {
      setBuktiFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    // Satu pintu input anti double-input: Honor & Lembur Keamanan dipusatkan di tab Kelola Shift & Lembur
    if (!editingItem && isHonorKeamananCategory) {
      onToast(
        'info',
        'Pengelolaan shift, lembur, dan pencairan honor petugas kini terpusat di tab Kelola Shift & Lembur Keamanan.'
      );
      goToShiftLemburTab();
      return;
    }

    if (parsedNominal <= 0) {
      onToast('error', 'Masukkan nominal transaksi yang valid (> Rp 0).');
      return;
    }

    setSaving(true);
    try {
      if (editingItem) {
        const res = await updateTransaksiKasAdmin(session, editingItem.id, {
          kategori,
          termin: formJenis === 'pengeluaran' ? termin : null,
          tanggal,
          nominal: parsedNominal,
          penerima_atau_sumber: penerimaAtauSumber,
          keterangan,
          buktiFile,
          bukti_url: buktiPreview,
          petugas_id: editingItem.petugas_id ?? null,
          jenis_honor: editingItem.jenis_honor ?? null,
        });
        if (res.error) {
          onToast('error', res.error);
        } else {
          onToast('success', `Transaksi ${editingItem.no_bukti} berhasil diperbarui.`);
          resetForm(formJenis);
          await onRefresh();
        }
      } else {
        const res = await createTransaksiKasAdmin(session, {
          jenis: formJenis,
          kategori,
          termin: formJenis === 'pengeluaran' ? termin : null,
          tanggal,
          nominal: parsedNominal,
          penerima_atau_sumber: penerimaAtauSumber,
          keterangan,
          buktiFile,
        });
        if (res.error || !res.data) {
          onToast('error', res.error || 'Gagal menyimpan transaksi kas.');
        } else {
          onToast(
            'success',
            `${
              formJenis === 'pengeluaran' ? 'Pengeluaran anggaran' : 'Pemasukan lain'
            } ${formatRupiah(res.data.nominal)} dicatat (${res.data.no_bukti}) — berstatus Menunggu Verifikasi Bendahara.`
          );
          resetForm(formJenis);
          await onRefresh();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleBendaharaAccKas = async (item: TransaksiKas) => {
    setVerifyingId(item.id);
    try {
      const res = await verifyTransaksiKasBendaharaAdmin(session, item, 'ACC Bendahara');
      if (res.error) onToast('error', res.error);
      else {
        const updatedKas = res.data;
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiKasList: prev.transaksiKasList.map((k) =>
            k.id === item.id ? updatedKas || { ...k, status_verifikasi: 'ACC Bendahara' } : k
          ),
        }));
        onToast(
          'success',
          `ACC Bendahara untuk ${item.no_bukti} berhasil — diteruskan ke Antrean Verifikasi Ketua.`
        );
        await onRefresh();
      }
    } finally {
      setVerifyingId(null);
    }
  };

  const handleKetuaApproveKas = async (item: TransaksiKas) => {
    setVerifyingId(item.id);
    try {
      const res = await verifyTransaksiKasKetuaAdmin(session, item, 'Terverifikasi');
      if (res.error) onToast('error', res.error);
      else {
        const updatedKas = res.data;
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiKasList: prev.transaksiKasList.map((k) =>
            k.id === item.id ? updatedKas || { ...k, status_verifikasi: 'Terverifikasi' } : k
          ),
        }));
        onToast(
          'success',
          `Transaksi kas ${item.no_bukti} disahkan final oleh Ketua & memperbarui Saldo Kas.`
        );
        await onRefresh();
      }
    } finally {
      setVerifyingId(null);
    }
  };

  const handleConfirmActionNote = async () => {
    if (!actionNoteModal || !actionNoteText.trim()) return;
    const modalItem = actionNoteModal.item;
    const modalMode = actionNoteModal.mode;
    const cleanNote = actionNoteText.trim();
    setVerifyingId(modalItem.id);
    try {
      const res =
        modalMode === 'bendahara_reject'
          ? await verifyTransaksiKasBendaharaAdmin(session, modalItem, 'Ditolak', cleanNote)
          : await verifyTransaksiKasKetuaAdmin(session, modalItem, 'Kembalikan', cleanNote);
      if (res.error) {
        onToast('error', res.error);
      } else {
        const updatedKas = res.data;
        const nextStatus: StatusVerifikasi = modalMode === 'bendahara_reject' ? 'Ditolak' : 'Pending';
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiKasList: prev.transaksiKasList.map((k) =>
            k.id === modalItem.id
              ? updatedKas || { ...k, status_verifikasi: nextStatus, ketua_catatan: cleanNote }
              : k
          ),
        }));
        onToast(
          'info',
          modalMode === 'bendahara_reject'
            ? `Transaksi kas ${modalItem.no_bukti} ditolak.`
            : `Transaksi kas ${modalItem.no_bukti} dikembalikan ke Bendahara.`
        );
        setActionNoteModal(null);
        setActionNoteText('');
        await onRefresh();
      }
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDelete = async (item: TransaksiKas) => {
    if (!canEditDelete || deletingId) return;
    setDeletingId(item.id);
    try {
      const res = await deleteTransaksiKasAdmin(session, item);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiKasList: prev.transaksiKasList.filter((k) => k.id !== item.id),
        }));
        // Sinkronisasi Hapus 2-Arah: kembalikan status lembur terkait di Kelola Shift & Lembur menjadi Belum Dibayar
        const revertRes = await revertShiftOverridesByCashTransactionAdmin(
          session,
          item.id,
          item.shift_override_id
        );
        const revertedCount = revertRes.data || 0;
        onToast(
          'info',
          revertedCount > 0
            ? `Transaksi ${item.no_bukti} dihapus & ${revertedCount} jadwal lembur terkait di Kelola Shift & Lembur dikembalikan menjadi Belum Dibayar.`
            : `Transaksi ${item.no_bukti} telah dihapus dari buku kas.`
        );
        await loadSyncedShiftAndOfficers();
        await onRefresh();
      }
    } finally {
      setDeletingId(null);
    }
  };

  const filteredKas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transaksiKasList.filter((item) => {
      if (filterJenis !== 'semua' && item.jenis !== filterJenis) return false;
      const itemStatus: StatusVerifikasi = item.status_verifikasi || 'Terverifikasi';
      if (filterStatus !== 'semua' && itemStatus !== filterStatus) return false;
      if (!q) return true;
      return (
        item.no_bukti.toLowerCase().includes(q) ||
        item.kategori.toLowerCase().includes(q) ||
        item.penerima_atau_sumber.toLowerCase().includes(q) ||
        (item.keterangan || '').toLowerCase().includes(q)
      );
    });
  }, [transaksiKasList, filterJenis, filterStatus, searchQuery]);

  const kategoriOptions =
    formJenis === 'pengeluaran' ? KATEGORI_PENGELUARAN_LIST : KATEGORI_PEMASUKAN_LAIN_LIST;

  return (
    <div className="space-y-6">
      {/* KPI Strip Saldo Kas Real-Time */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="col-span-2 lg:col-span-1 glass-hero bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] shadow-xl shadow-indigo-900/15 text-white rounded-3xl p-4 sm:p-5 relative overflow-hidden">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-indigo-100/90">Saldo Kas Real-Time</p>
            <Wallet className="w-4 h-4 text-emerald-300 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-extrabold font-mono text-white tabular-nums mt-2">
            {formatRupiah(cashSummary.saldoKas)}
          </p>
          <p className="text-[11px] text-indigo-200/90 mt-1">
            IPL + Pemasukan Lain − Pengeluaran
          </p>
        </div>

        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Total IPL Terverifikasi</p>
          <p className="text-lg sm:text-xl font-bold font-mono text-[#047857] tabular-nums mt-2">
            {formatRupiah(cashSummary.totalIplMasuk)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Akumulasi iuran warga lunas</p>
        </div>

        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Total Pemasukan Lain</p>
          <p className="text-lg sm:text-xl font-bold font-mono text-[#3730A3] tabular-nums mt-2">
            {formatRupiah(cashSummary.totalPemasukanLain)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Donasi, kas awal &amp; parsial</p>
        </div>

        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Total Pengeluaran</p>
          <p className="text-lg sm:text-xl font-bold font-mono text-red-700 tabular-nums mt-2">
            {formatRupiah(cashSummary.totalPengeluaran)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Realisasi anggaran lingkungan</p>
        </div>
      </section>

      {/* Sub-Navigasi Keuangan: Buku Kas vs Kelola Shift & Lembur Keamanan */}
      <div
        role="tablist"
        aria-label="Submenu Keuangan Admin"
        className="flex flex-wrap items-center gap-1.5 p-1.5 bg-indigo-50/80 border border-indigo-100/90 backdrop-blur-md rounded-2xl w-full sm:w-fit"
      >
        <button
          type="button"
          role="tab"
          aria-selected={keuanganSubTab === 'buku_kas'}
          onClick={() => setKeuanganSubTab('buku_kas')}
          className={`flex-1 sm:flex-initial min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap ${
            keuanganSubTab === 'buku_kas'
              ? 'bg-[#4C1D95] text-white shadow-sm'
              : 'text-slate-600 hover:text-[#4C1D95]'
          }`}
        >
          <Wallet className={`w-4 h-4 shrink-0 ${keuanganSubTab === 'buku_kas' ? 'text-emerald-300' : 'text-[#4C1D95]'}`} />
          <span>Buku Kas &amp; Arus Dana</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={keuanganSubTab === 'shift_lembur'}
          onClick={() => setKeuanganSubTab('shift_lembur')}
          className={`flex-1 sm:flex-initial min-h-[42px] px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap ${
            keuanganSubTab === 'shift_lembur'
              ? 'bg-[#4C1D95] text-white shadow-sm'
              : 'text-slate-600 hover:text-[#4C1D95]'
          }`}
        >
          <Moon className={`w-4 h-4 shrink-0 ${keuanganSubTab === 'shift_lembur' ? 'text-amber-300' : 'text-[#4C1D95]'}`} />
          <span>Kelola Shift &amp; Lembur Keamanan</span>
          {unpaidOvertimeCount > 0 && (
            <span className={`text-[11px] font-mono font-bold tabular-nums ${keuanganSubTab === 'shift_lembur' ? 'text-amber-200' : 'text-amber-700'}`}>
              ({unpaidOvertimeCount} blm bayar)
            </span>
          )}
        </button>
      </div>

      {/* PANEL KELOLA SHIFT & LEMBUR KEAMANAN (SATU-SATUNYA PUSAT INPUT SHIFT, LEMBUR & HONOR KEAMANAN) */}
      <div key={keuanganSubTab} className="animate-page-enter">
      {keuanganSubTab === 'shift_lembur' ? (
        <AdminShiftOvertimePanel
          session={session}
          petugasList={livePetugasList}
          transaksiKasList={transaksiKasList}
          onCashChanged={async () => {
            await loadSyncedShiftAndOfficers();
            await onRefresh();
          }}
          onToast={onToast}
        />
      ) : (
        /* Grid Utama: Form Input Cepat (Kiri) + Daftar Riwayat Kas (Kanan) */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Pencatatan Pengeluaran Anggaran / Pemasukan Lain */}
        <section className="lg:col-span-5 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-indigo-100/80 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#0F172A]">
                {editingItem
                  ? `Edit Transaksi (${editingItem.no_bukti})`
                  : 'Catat Arus Kas Lingkungan'}
              </h2>
              {editingItem && (
                <button
                  type="button"
                  onClick={() => resetForm(formJenis)}
                  className="text-xs font-semibold text-slate-500 hover:text-[#4C1D95] cursor-pointer"
                >
                  Batal Edit
                </button>
              )}
            </div>

            {!editingItem && (
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-indigo-50/80 rounded-2xl">
                <button
                  type="button"
                  onClick={() => switchJenisForm('pengeluaran')}
                  className={`min-h-[40px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    formJenis === 'pengeluaran'
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Pengeluaran</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchJenisForm('pemasukan_lain')}
                  className={`min-h-[40px] rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    formJenis === 'pemasukan_lain'
                      ? 'bg-[#3730A3] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>Pemasukan Lain</span>
                </button>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4">
            {/* Kategori Cepat */}
            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                {formJenis === 'pengeluaran'
                  ? 'Pos Anggaran / Kategori Pengeluaran'
                  : 'Kategori Pemasukan Non-Iuran'}
              </label>
              <select
                value={kategori}
                onChange={(e) => setKategori(e.target.value)}
                className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
              >
                {kategoriOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* SATU PINTU INPUT (ANTI DOUBLE-INPUT): Arahkan Honor & Lembur Keamanan ke Tab Terpusat */}
            {!editingItem && isHonorKeamananCategory ? (
              <div className="rounded-2xl bg-indigo-50/80 border border-indigo-200 p-4 space-y-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-[#4C1D95] text-white flex items-center justify-center shrink-0 mt-0.5">
                    <Moon className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-bold text-[#0F172A] leading-snug">
                      Pencatatan Honor &amp; Lembur Keamanan Terpusat
                    </p>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      Pengelolaan shift, lembur, dan pencairan honor petugas kini terpusat di tab{' '}
                      <strong>Kelola Shift &amp; Lembur Keamanan</strong> agar tidak terjadi input
                      ganda.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={goToShiftLemburTab}
                  className="w-full min-h-[44px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer shadow-xs"
                >
                  <Moon className="w-4 h-4 shrink-0" />
                  <span>Buka Kelola Shift &amp; Lembur Keamanan</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>

                <p className="text-[11px] text-indigo-900/80 leading-snug">
                  Setiap pembayaran Honor Rutin maupun Uang Lembur di tab tersebut otomatis
                  tercatat di Buku Kas, memotong Saldo Kas Real-Time, masuk LPJ Triwulanan, dan
                  langsung tampil di Tab Honor Portal Petugas.
                </p>
              </div>
            ) : (
              <>
                {/* Tanggal & Termin */}
                <div className={`grid grid-cols-1 ${formJenis === 'pengeluaran' ? 'sm:grid-cols-2' : ''} gap-3`}>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                      Tanggal Transaksi
                    </label>
                    <div className="relative">
                      <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="date"
                        required
                        value={tanggal}
                        onChange={(e) => setTanggal(e.target.value)}
                        className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 pl-9 pr-3 text-sm font-mono text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                      />
                    </div>
                  </div>

                  {formJenis === 'pengeluaran' && (
                    <div>
                      <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                        Termin / Periode
                      </label>
                      <select
                        value={termin}
                        onChange={(e) => setTermin(e.target.value)}
                        className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3 text-sm text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                      >
                        {TERMIN_PENGELUARAN_LIST.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Nominal + Terbilang Live */}
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                    Nominal (Rupiah)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                      Rp
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      value={
                        parsedNominal > 0 ? new Intl.NumberFormat('id-ID').format(parsedNominal) : ''
                      }
                      onChange={(e) => setNominalStr(e.target.value.replace(/\D/g, ''))}
                      placeholder="Contoh: 500.000"
                      className="w-full min-h-[46px] rounded-2xl border border-indigo-200/80 bg-white/90 pl-10 pr-4 text-base font-mono font-bold text-[#0F172A] tabular-nums focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                    />
                  </div>
                  {parsedNominal > 0 && (
                    <p className="text-[11px] italic text-emerald-700 mt-1">
                      Terbilang: {terbilangRupiah(parsedNominal)}
                    </p>
                  )}
                </div>

                {/* Penerima Dana / Sumber Dana */}
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                    {formJenis === 'pengeluaran' ? 'Dibayarkan Kepada (Penerima)' : 'Sumber / Penyetor Dana'}
                  </label>
                  <input
                    type="text"
                    required
                    value={penerimaAtauSumber}
                    onChange={(e) => setPenerimaAtauSumber(e.target.value)}
                    placeholder={
                      formJenis === 'pengeluaran'
                        ? 'Contoh: Petugas Kebersihan / PLN / Toko Material'
                        : 'Contoh: Donatur Warga Blok B3 / Sisa Kas 2025'
                    }
                    className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                  />
                </div>

                {/* Keterangan */}
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                    Uraian / Keterangan Detail
                  </label>
                  <textarea
                    rows={2}
                    value={keterangan}
                    onChange={(e) => setKeterangan(e.target.value)}
                    placeholder="Rincian penggunaan anggaran atau keterangan penerimaan dana..."
                    className="w-full rounded-2xl border border-indigo-200/80 bg-white/90 p-3 text-sm text-[#0F172A] resize-none focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                  />
                </div>

                {/* Upload Foto Nota / Bukti */}
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                    Foto Nota / Bukti Transfer (Opsional)
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  {buktiPreview ? (
                    <div className="rounded-xl border border-slate-200 p-2.5 bg-slate-50 flex items-center justify-between gap-3">
                      <img
                        src={buktiPreview}
                        alt="Pratinjau Nota"
                        className="w-14 h-14 object-cover rounded-lg border border-slate-200 bg-white"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#0F172A] truncate">
                          Bukti nota terlampir
                        </p>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-[11px] font-semibold text-emerald-700 hover:underline cursor-pointer"
                        >
                          Ganti foto
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setBuktiFile(null);
                          setBuktiPreview(null);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="p-2 text-slate-400 hover:text-red-600 cursor-pointer"
                        aria-label="Hapus foto nota"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full min-h-[44px] rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 hover:border-[#4C1D95] hover:bg-indigo-50/80 text-xs font-semibold text-slate-600 inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <Camera className="w-4 h-4 text-slate-500" />
                      <span>Unggah Foto Nota / Bukti Kas</span>
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className={`w-full min-h-[46px] rounded-full text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 shadow-sm ${
                    formJenis === 'pengeluaran'
                      ? 'bg-[#4C1D95] hover:bg-[#3B0764]'
                      : 'bg-[#3730A3] hover:bg-[#312E81]'
                  }`}
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>
                    {saving
                      ? 'Menyimpan...'
                      : editingItem
                        ? 'Simpan Perubahan Transaksi'
                        : formJenis === 'pengeluaran'
                          ? 'Simpan Pengeluaran Anggaran'
                          : 'Simpan Pemasukan Lain'}
                  </span>
                </button>

                {!editingItem && (
                  <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                    Transaksi kas baru berstatus <strong>Menunggu Verifikasi Bendahara</strong> dan
                    memperbarui Saldo Kas Real-Time setelah disahkan <strong>Bendahara &amp; Ketua</strong>.
                  </p>
                )}
              </>
            )}
          </form>
        </section>

        {/* Daftar Riwayat Pengeluaran & Pemasukan Lain */}
        <section className="lg:col-span-7 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-indigo-100/80 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#0F172A]">
                  Riwayat Pengeluaran &amp; Pemasukan Lain
                </h2>
                <p className="text-xs text-slate-500">
                  {filteredKas.length} catatan ditampilkan · Tersinkron otomatis ke Rekap &amp; LPJ
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-indigo-50/80 rounded-2xl w-fit">
                {(
                  [
                    { id: 'semua', label: 'Semua' },
                    { id: 'pengeluaran', label: 'Pengeluaran' },
                    { id: 'pemasukan_lain', label: 'Pemasukan Lain' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterJenis(f.id)}
                    className={`min-h-[32px] px-3 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                      filterJenis === f.id
                        ? 'bg-[#4C1D95] text-white shadow-sm'
                        : 'text-slate-600 hover:text-[#4C1D95]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Tahap Verifikasi Berjenjang */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-indigo-50/80 rounded-2xl w-fit">
              {(
                [
                  { id: 'semua', label: 'Semua Status' },
                  { id: 'Pending', label: 'Menunggu Bendahara' },
                  { id: 'ACC Bendahara', label: 'ACC Bendahara' },
                  { id: 'Terverifikasi', label: 'Sah Final' },
                  { id: 'Ditolak', label: 'Ditolak' },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setFilterStatus(st.id)}
                  className={`min-h-[30px] px-3 rounded-xl text-[11px] font-semibold cursor-pointer transition-colors ${
                    filterStatus === st.id
                      ? 'bg-[#4C1D95] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#4C1D95]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-indigo-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nomor bukti, pos anggaran, penerima, atau keterangan..."
                className="w-full min-h-[42px] rounded-2xl border border-indigo-100 bg-white/95 pl-10 pr-4 text-sm focus:border-[#4C1D95] focus:outline-none"
              />
            </div>
          </div>

          <div className="divide-y divide-indigo-100/70">
            {filteredKas.length === 0 ? (
              <div className="p-10 text-center">
                <Wallet className="w-9 h-9 text-indigo-300 mx-auto" />
                <p className="text-sm font-semibold text-slate-700 mt-2">
                  Belum Ada Catatan Kas
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Catat pengeluaran operasional (Satpam, Sampah, Listrik PJU, Fasum) atau pemasukan
                  lain melalui formulir di samping.
                </p>
              </div>
            ) : (
              filteredKas.map((item) => {
                const isOut = item.jenis === 'pengeluaran';
                const statusVerif: StatusVerifikasi = item.status_verifikasi || 'Terverifikasi';
                const isBusy = verifyingId === item.id;
                return (
                  <article key={item.id} className="p-4 sm:p-5 hover:bg-white/50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span
                            className={`font-bold ${
                              isOut ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {isOut ? 'Pengeluaran' : 'Pemasukan Lain'}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-semibold text-[#0F172A]">{item.kategori}</span>
                          {item.termin && (
                            <>
                              <span aria-hidden="true" className="text-slate-300">·</span>
                              <span className="text-slate-500">{item.termin}</span>
                            </>
                          )}
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          {statusVerif === 'Terverifikasi' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {getStatusVerifikasiShortLabel('Terverifikasi')}
                            </span>
                          ) : statusVerif === 'ACC Bendahara' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-sky-700">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              ACC Bendahara — Menunggu Ketua
                            </span>
                          ) : statusVerif === 'Ditolak' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                              <XCircle className="w-3.5 h-3.5" />
                              Ditolak
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
                              <Clock className="w-3.5 h-3.5" />
                              Menunggu Bendahara
                            </span>
                          )}
                        </div>

                        <p className="text-sm font-bold text-[#0F172A]">
                          {item.penerima_atau_sumber}
                        </p>

                        {item.keterangan && (
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {item.keterangan}
                          </p>
                        )}
                        {item.ketua_catatan && statusVerif !== 'Terverifikasi' && (
                          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 inline-block">
                            Catatan: {item.ketua_catatan}
                          </p>
                        )}

                        <p className="text-[11px] text-slate-500 font-mono">
                          {item.no_bukti} · {formatTanggalSingkat(item.tanggal)} · {item.created_by_name}
                        </p>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                        <p
                          className={`text-base font-extrabold font-mono tabular-nums ${
                            isOut ? 'text-red-700' : 'text-[#059669]'
                          }`}
                        >
                          {isOut ? '−' : '+'} {formatRupiah(item.nominal)}
                        </p>

                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {/* Tahap 1: ACC / Tolak oleh Bendahara */}
                          {statusVerif === 'Pending' && isBendahara && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleBendaharaAccKas(item)}
                                className="min-h-[34px] px-3 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>{isBusy ? '...' : 'ACC Bendahara'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setActionNoteModal({ mode: 'bendahara_reject', item });
                                  setActionNoteText('');
                                }}
                                className="min-h-[34px] px-3 rounded-full border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                <span>Tolak</span>
                              </button>
                            </>
                          )}

                          {/* Tahap 2: Sahkan Final / Kembalikan oleh Ketua */}
                          {statusVerif === 'ACC Bendahara' && isKetua && (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => void handleKetuaApproveKas(item)}
                                className="min-h-[34px] px-3 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>{isBusy ? '...' : 'Sahkan Final'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  setActionNoteModal({ mode: 'ketua_return', item });
                                  setActionNoteText('');
                                }}
                                className="min-h-[34px] px-3 rounded-full border border-amber-300 bg-[#FEF3C7] hover:bg-amber-200/80 text-[#B45309] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                <span>Kembalikan</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setSelectedKwitansi(item)}
                            className="min-h-[34px] px-3 rounded-full bg-[#4C1D95] hover:bg-[#3B0764] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Kwitansi</span>
                          </button>

                          {item.bukti_url && (
                            <button
                              type="button"
                              onClick={() => setSelectedProofUrl(item.bukti_url || null)}
                              className="min-h-[34px] px-3 rounded-full border border-slate-200 bg-white/95 hover:bg-indigo-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <ImageIcon className="w-3.5 h-3.5" />
                              <span>Nota</span>
                            </button>
                          )}

                          {canEditDelete && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStartEdit(item)}
                                aria-label={`Edit ${item.no_bukti}`}
                                className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 inline-flex items-center justify-center cursor-pointer"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={deletingId === item.id}
                                onClick={() => void handleDelete(item)}
                                aria-label={`Hapus ${item.no_bukti}`}
                                className="min-h-[34px] min-w-[34px] rounded-lg border border-slate-200 bg-white hover:border-red-300 hover:bg-red-50 text-slate-500 hover:text-red-700 inline-flex items-center justify-center cursor-pointer disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
      )}
      </div>

      {/* Modal Kwitansi Kas Resmi + Stempel + PDF A4 */}
      {selectedKwitansi && (
        <KwitansiDigitalModal
          mode="kas"
          trxKas={selectedKwitansi}
          onClose={() => setSelectedKwitansi(null)}
        />
      )}

      {/* Modal Pratinjau Foto Nota */}
      {selectedProofUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => setSelectedProofUrl(null)}
        >
          <div
            className="bg-white/95 backdrop-blur-xl rounded-3xl max-w-xl w-full overflow-hidden border border-white/90 shadow-2xl animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-indigo-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A]">Lampiran Nota / Bukti Kas</h3>
              <button
                type="button"
                onClick={() => setSelectedProofUrl(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-indigo-50 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center">
              <img
                src={selectedProofUrl}
                alt="Bukti nota kas"
                referrerPolicy="no-referrer"
                className="max-h-[70vh] w-auto object-contain rounded-2xl border border-slate-200 bg-white"
              />
            </div>
          </div>
        </div>
      )}
      {/* Modal Catatan Tolak / Kembalikan Kas */}
      {actionNoteModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => !verifyingId && setActionNoteModal(null)}
        >
          <div
            className="bg-white/95 backdrop-blur-xl rounded-3xl max-w-md w-full border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-indigo-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A]">
                {actionNoteModal.mode === 'bendahara_reject'
                  ? 'Tolak Transaksi Kas'
                  : 'Kembalikan Kas ke Bendahara'}
              </h3>
              <button
                type="button"
                disabled={Boolean(verifyingId)}
                onClick={() => setActionNoteModal(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:bg-indigo-50 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-600">
                Bukti <strong>{actionNoteModal.item.no_bukti}</strong> (
                {actionNoteModal.item.penerima_atau_sumber} ·{' '}
                {formatRupiah(actionNoteModal.item.nominal)})
              </p>
              <textarea
                rows={3}
                value={actionNoteText}
                onChange={(e) => setActionNoteText(e.target.value)}
                placeholder={
                  actionNoteModal.mode === 'bendahara_reject'
                    ? 'Tulis alasan penolakan transaksi kas...'
                    : 'Tulis catatan Ketua untuk pemeriksaan ulang Bendahara...'
                }
                className="w-full rounded-2xl border border-indigo-100 p-3 text-sm focus:border-[#4C1D95] focus:outline-none"
              />
            </div>
            <div className="px-5 py-3.5 bg-indigo-50/40 border-t border-indigo-100 flex justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(verifyingId)}
                onClick={() => setActionNoteModal(null)}
                className="min-h-[40px] px-4 rounded-full border border-slate-200 bg-white text-xs font-semibold text-slate-700 disabled:opacity-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!actionNoteText.trim() || Boolean(verifyingId)}
                aria-busy={Boolean(verifyingId)}
                onClick={() => void handleConfirmActionNote()}
                className={`min-h-[40px] px-5 rounded-full text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer ${
                  actionNoteModal.mode === 'bendahara_reject'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {Boolean(verifyingId) && <LoadingSpinner size="xs" tone="white" />}
                <span>{Boolean(verifyingId) ? 'Memproses...' : 'Konfirmasi'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
