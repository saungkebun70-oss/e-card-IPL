import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Image as ImageIcon,
  Loader2,
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
  type JenisHonorPetugas,
  type JenisTransaksiKas,
  type PetugasKeamanan,
  type SessionUser,
  type StatusVerifikasi,
  type TransaksiIPL,
  type TransaksiKas,
} from '../../types';
import {
  createTransaksiKasAdmin,
  deleteTransaksiKasAdmin,
  updateTransaksiKasAdmin,
  verifyTransaksiKasBendaharaAdmin,
  verifyTransaksiKasKetuaAdmin,
} from '../../lib/dataService';
import { calculateGlobalCashSummary } from '../../lib/financeUtils';
import {
  formatRupiah,
  formatTanggalSingkat,
  terbilangRupiah,
} from '../../lib/format';
import { compressProofImage } from '../../lib/imageCompressor';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';

interface AdminKeuanganSlideProps {
  session: SessionUser;
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  petugasList?: PetugasKeamanan[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminKeuanganSlide({
  session,
  transaksiList,
  transaksiKasList,
  petugasList = [],
  onRefresh,
  onToast,
}: AdminKeuanganSlideProps) {
  const canEditDelete = isBendaharaFullAccess(session);
  const isBendahara = isBendaharaOnly(session);
  const isKetua = isKetuaRole(session);
  const todayIso = new Date().toISOString().slice(0, 10);

  // Form Pengeluaran / Pemasukan Lain
  const [formJenis, setFormJenis] = useState<JenisTransaksiKas>('pengeluaran');
  const [editingItem, setEditingItem] = useState<TransaksiKas | null>(null);
  const [kategori, setKategori] = useState<string>(KATEGORI_PENGELUARAN_LIST[0]);
  const [termin, setTermin] = useState<string>(TERMIN_PENGELUARAN_LIST[0]);
  const [tanggal, setTanggal] = useState<string>(todayIso);
  const [nominalStr, setNominalStr] = useState<string>('');
  const [penerimaAtauSumber, setPenerimaAtauSumber] = useState<string>('');
  const [keterangan, setKeterangan] = useState<string>('');
  const [buktiFile, setBuktiFile] = useState<File | null>(null);
  const [buktiPreview, setBuktiPreview] = useState<string | null>(null);
  const [selectedPetugasId, setSelectedPetugasId] = useState<string>('');
  const [jenisHonor, setJenisHonor] = useState<JenisHonorPetugas>('honor_rutin');
  const [saving, setSaving] = useState(false);

  const isHonorKeamananCategory =
    formJenis === 'pengeluaran' &&
    (kategori === 'Honorarium Keamanan / Satpam' || kategori === 'Lembur Petugas Keamanan');

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
      next === 'pengeluaran' ? KATEGORI_PENGELUARAN_LIST[0] : KATEGORI_PEMASUKAN_LAIN_LIST[0]
    );
    setTermin(TERMIN_PENGELUARAN_LIST[0]);
    setSelectedPetugasId('');
    setJenisHonor('honor_rutin');
  };

  const resetForm = (keepJenis = formJenis) => {
    setEditingItem(null);
    setFormJenis(keepJenis);
    setKategori(
      keepJenis === 'pengeluaran' ? KATEGORI_PENGELUARAN_LIST[0] : KATEGORI_PEMASUKAN_LAIN_LIST[0]
    );
    setTermin(TERMIN_PENGELUARAN_LIST[0]);
    setTanggal(todayIso);
    setNominalStr('');
    setPenerimaAtauSumber('');
    setKeterangan('');
    setBuktiFile(null);
    setBuktiPreview(null);
    setSelectedPetugasId('');
    setJenisHonor('honor_rutin');
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
    setSelectedPetugasId(item.petugas_id || '');
    setJenisHonor(
      item.jenis_honor ||
        (item.kategori === 'Lembur Petugas Keamanan' ? 'lembur' : 'honor_rutin')
    );
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

    if (parsedNominal <= 0) {
      onToast('error', 'Masukkan nominal transaksi yang valid (> Rp 0).');
      return;
    }

    setSaving(true);
    try {
      const linkedPetugasId = isHonorKeamananCategory && selectedPetugasId ? selectedPetugasId : null;
      const linkedJenisHonor = linkedPetugasId ? jenisHonor : null;

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
          petugas_id: linkedPetugasId,
          jenis_honor: linkedJenisHonor,
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
          petugas_id: linkedPetugasId,
          jenis_honor: linkedJenisHonor,
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
    setVerifyingId(actionNoteModal.item.id);
    try {
      const res =
        actionNoteModal.mode === 'bendahara_reject'
          ? await verifyTransaksiKasBendaharaAdmin(
              session,
              actionNoteModal.item,
              'Ditolak',
              actionNoteText.trim()
            )
          : await verifyTransaksiKasKetuaAdmin(
              session,
              actionNoteModal.item,
              'Kembalikan',
              actionNoteText.trim()
            );
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'info',
          actionNoteModal.mode === 'bendahara_reject'
            ? `Transaksi kas ${actionNoteModal.item.no_bukti} ditolak.`
            : `Transaksi kas ${actionNoteModal.item.no_bukti} dikembalikan ke Bendahara.`
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
        onToast('info', `Transaksi ${item.no_bukti} telah dihapus dari buku kas.`);
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
        <div className="col-span-2 lg:col-span-1 bg-[#0F172A] text-white rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-300">Saldo Kas Real-Time</p>
            <Wallet className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-extrabold font-mono text-emerald-400 tabular-nums mt-2">
            {formatRupiah(cashSummary.saldoKas)}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">
            IPL + Pemasukan Lain − Pengeluaran
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Total IPL Terverifikasi</p>
          <p className="text-lg sm:text-xl font-bold font-mono text-[#059669] tabular-nums mt-2">
            {formatRupiah(cashSummary.totalIplMasuk)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Akumulasi iuran warga lunas</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Total Pemasukan Lain</p>
          <p className="text-lg sm:text-xl font-bold font-mono text-sky-700 tabular-nums mt-2">
            {formatRupiah(cashSummary.totalPemasukanLain)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Donasi, kas awal &amp; parsial</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Total Pengeluaran</p>
          <p className="text-lg sm:text-xl font-bold font-mono text-red-700 tabular-nums mt-2">
            {formatRupiah(cashSummary.totalPengeluaran)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Realisasi anggaran lingkungan</p>
        </div>
      </section>

      {/* Grid Utama: Form Input Cepat (Kiri) + Daftar Riwayat Kas (Kanan) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Form Pencatatan Pengeluaran Anggaran / Pemasukan Lain */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3">
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
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Batal Edit
                </button>
              )}
            </div>

            {!editingItem && (
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => switchJenisForm('pengeluaran')}
                  className={`min-h-[40px] rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
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
                  className={`min-h-[40px] rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    formJenis === 'pemasukan_lain'
                      ? 'bg-[#059669] text-white shadow-sm'
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
                onChange={(e) => {
                  const nextKat = e.target.value;
                  setKategori(nextKat);
                  if (nextKat === 'Lembur Petugas Keamanan') {
                    setJenisHonor('lembur');
                  } else if (nextKat === 'Honorarium Keamanan / Satpam') {
                    setJenisHonor('honor_rutin');
                  }
                }}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-[#0F172A] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
              >
                {kategoriOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Integrasi 2-Arah: Hubungkan Honorarium / Lembur ke Akun Petugas Keamanan */}
            {isHonorKeamananCategory && (
              <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3.5 space-y-2.5">
                <p className="text-xs font-bold text-emerald-900">
                  Sinkronisasi Otomatis ke Portal Petugas Keamanan
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-semibold text-emerald-900 mb-1">
                      Pilih Petugas Penerima
                    </label>
                    <select
                      value={selectedPetugasId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setSelectedPetugasId(nextId);
                        const found = petugasList.find((p) => p.id === nextId);
                        if (found) {
                          setPenerimaAtauSumber(`${found.nama} (Petugas Keamanan)`);
                        }
                      }}
                      className="w-full min-h-[40px] rounded-lg border border-emerald-300 bg-white px-2.5 text-xs text-[#0F172A]"
                    >
                      <option value="">-- Tidak ditautkan (Manual) --</option>
                      {petugasList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nama} ({p.shift})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-emerald-900 mb-1">
                      Jenis Pencairan
                    </label>
                    <select
                      value={jenisHonor}
                      onChange={(e) => setJenisHonor(e.target.value as JenisHonorPetugas)}
                      className="w-full min-h-[40px] rounded-lg border border-emerald-300 bg-white px-2.5 text-xs text-[#0F172A]"
                    >
                      <option value="honor_rutin">Honor Rutin (Termin / Bulanan)</option>
                      <option value="lembur">Uang Lembur Petugas</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-emerald-800 leading-snug">
                  Bila petugas dipilih, nominal &amp; e-Kwitansi langsung tampil di akun petugas
                  terkait sekaligus memotong Saldo Kas &amp; masuk LPJ Triwulanan.
                </p>
              </div>
            )}

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
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm font-mono text-[#0F172A]"
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
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A]"
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
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-base font-mono font-bold text-[#0F172A] tabular-nums focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
                    ? 'Contoh: Pak Asep (Petugas Keamanan) / PLN'
                    : 'Contoh: Donatur Warga Blok B3 / Sisa Kas 2025'
                }
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-[#0F172A]"
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
                className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-[#0F172A] resize-none"
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
                  className="w-full min-h-[44px] rounded-xl border border-dashed border-slate-300 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/40 text-xs font-semibold text-slate-600 inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-slate-500" />
                  <span>Unggah Foto Nota / Bukti Kas</span>
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={saving}
              className={`w-full min-h-[46px] rounded-xl text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                formJenis === 'pengeluaran'
                  ? 'bg-[#0F172A] hover:bg-slate-800'
                  : 'bg-[#059669] hover:bg-emerald-700'
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
          </form>
        </section>

        {/* Daftar Riwayat Pengeluaran & Pemasukan Lain */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-[#0F172A]">
                  Riwayat Pengeluaran &amp; Pemasukan Lain
                </h2>
                <p className="text-xs text-slate-500">
                  {filteredKas.length} catatan ditampilkan · Tersinkron otomatis ke Rekap &amp; LPJ
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
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
                    className={`min-h-[32px] px-2.5 rounded-lg text-xs font-semibold cursor-pointer ${
                      filterJenis === f.id
                        ? 'bg-white text-[#0F172A] shadow-sm'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Tahap Verifikasi Berjenjang */}
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
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
                  className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer ${
                    filterStatus === st.id
                      ? 'bg-white text-[#0F172A] shadow-sm'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nomor bukti, pos anggaran, penerima, atau keterangan..."
                className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm focus:bg-white focus:border-[#059669] focus:outline-none"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {filteredKas.length === 0 ? (
              <div className="p-10 text-center">
                <Wallet className="w-9 h-9 text-slate-300 mx-auto" />
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
                  <article key={item.id} className="p-4 sm:p-5 hover:bg-slate-50/70 transition-colors">
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
                                className="min-h-[34px] px-2.5 rounded-lg bg-[#059669] hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
                                className="min-h-[34px] px-2.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
                                className="min-h-[34px] px-2.5 rounded-lg bg-[#059669] hover:bg-emerald-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
                                className="min-h-[34px] px-2.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                <span>Kembalikan</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            onClick={() => setSelectedKwitansi(item)}
                            className="min-h-[34px] px-2.5 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Kwitansi</span>
                          </button>

                          {item.bukti_url && (
                            <button
                              type="button"
                              onClick={() => setSelectedProofUrl(item.bukti_url || null)}
                              className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
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
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedProofUrl(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-xl w-full overflow-hidden border border-slate-200 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A]">Lampiran Nota / Bukti Kas</h3>
              <button
                type="button"
                onClick={() => setSelectedProofUrl(null)}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center">
              <img
                src={selectedProofUrl}
                alt="Bukti nota kas"
                referrerPolicy="no-referrer"
                className="max-h-[70vh] w-auto object-contain rounded-lg border border-slate-200 bg-white"
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
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActionNoteModal(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#0F172A]">
                {actionNoteModal.mode === 'bendahara_reject'
                  ? 'Tolak Transaksi Kas'
                  : 'Kembalikan Kas ke Bendahara'}
              </h3>
              <button
                type="button"
                onClick={() => setActionNoteModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
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
                className="w-full rounded-xl border border-slate-300 p-3 text-sm"
              />
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionNoteModal(null)}
                className="min-h-[40px] px-4 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!actionNoteText.trim() || Boolean(verifyingId)}
                onClick={() => void handleConfirmActionNote()}
                className={`min-h-[40px] px-4 rounded-xl text-white text-xs font-semibold disabled:opacity-50 ${
                  actionNoteModal.mode === 'bendahara_reject'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                Konfirmasi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
