import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  KeyRound,
  Copy,
  Pencil,
  Trash2,
  X,
  Check,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  isBendaharaFullAccess,
  NOMINAL_IPL_STANDAR,
  type SessionUser,
  type StatusHunian,
  type Warga,
} from '../../types';
import { copyToClipboard, formatRupiah, generateRandomPin } from '../../lib/format';
import {
  deleteWargaAdmin,
  resetPinWargaAdmin,
  saveWargaAdmin,
} from '../../lib/dataService';

interface AdminWargaSlideProps {
  session: SessionUser;
  wargaList: Warga[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface WargaFormState {
  id?: string;
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  status_hunian: StatusHunian;
  nominal_iuran: number;
  pin_akses: string;
  aktif: boolean;
}

const EMPTY_FORM: WargaFormState = {
  blok_rumah: '',
  nama_warga: '',
  no_wa: '628',
  status_hunian: 'Tetap',
  nominal_iuran: NOMINAL_IPL_STANDAR,
  pin_akses: '',
  aktif: true,
};

export function AdminWargaSlide({
  session,
  wargaList,
  onRefresh,
  onToast,
}: AdminWargaSlideProps) {
  const PAGE_SIZE = 20;
  const canManageFull = isBendaharaFullAccess(session);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Semua' | StatusHunian>('Semua');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<WargaFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Warga | null>(null);

  const filteredWarga = useMemo(() => {
    const q = search.trim().toLowerCase();
    return wargaList.filter((w) => {
      const matchStatus = statusFilter === 'Semua' || w.status_hunian === statusFilter;
      const matchSearch =
        !q ||
        w.blok_rumah.toLowerCase().includes(q) ||
        w.nama_warga.toLowerCase().includes(q) ||
        w.no_wa.includes(q);
      return matchStatus && matchSearch;
    });
  }, [wargaList, search, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredWarga.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedWarga = useMemo(
    () => filteredWarga.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredWarga, safePage]
  );

  const openAddModal = () => {
    setForm({
      ...EMPTY_FORM,
      pin_akses: generateRandomPin(),
    });
    setModalOpen(true);
  };

  const openEditModal = (warga: Warga) => {
    setForm({
      id: warga.id,
      blok_rumah: warga.blok_rumah,
      nama_warga: warga.nama_warga,
      no_wa: warga.no_wa,
      status_hunian: warga.status_hunian,
      nominal_iuran: warga.nominal_iuran,
      pin_akses: warga.pin_akses,
      aktif: warga.aktif,
    });
    setModalOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await saveWargaAdmin(session, form);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          form.id
            ? `Data warga Blok ${form.blok_rumah.toUpperCase()} berhasil diperbarui.`
            : `Warga baru Blok ${form.blok_rumah.toUpperCase()} berhasil ditambahkan.`
        );
        setModalOpen(false);
        await onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleResetPin = async (warga: Warga) => {
    const res = await resetPinWargaAdmin(session, warga);
    if (res.error || !res.data) {
      onToast('error', res.error || 'Gagal mereset PIN warga.');
    } else {
      onToast(
        'success',
        `PIN baru untuk ${warga.blok_rumah} (${warga.nama_warga}): ${res.data.pin_akses}`
      );
      await onRefresh();
    }
  };

  const handleCopyLoginInfo = async (warga: Warga) => {
    const appUrl = window.location.origin;
    const message = [
      `Yth. Bapak/Ibu ${warga.nama_warga} (Blok ${warga.blok_rumah}),`,
      ``,
      `Berikut informasi akses resmi Portal e-Card Verifikasi & IPL Digital Perumahan Saung Kebun:`,
      `Link Aplikasi: ${appUrl}`,
      `Username (Blok/No. Rumah): ${warga.blok_rumah}`,
      `PIN Akses (6 Digit): ${warga.pin_akses}`,
      ``,
      `Mohon simpan PIN ini dengan baik dan jangan dibagikan kepada pihak lain.`,
      `Terima kasih — Pengurus Lingkungan Perumahan Saung Kebun.`,
    ].join('\n');

    const ok = await copyToClipboard(message);
    if (ok) {
      setCopiedId(warga.id);
      onToast('success', `Info login WA untuk Blok ${warga.blok_rumah} berhasil disalin.`);
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      onToast('error', 'Gagal menyalin info login.');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await deleteWargaAdmin(session, deleteTarget);
    if (res.error) {
      onToast('error', res.error);
    } else {
      onToast('info', `Data unit ${deleteTarget.blok_rumah} berhasil dihapus.`);
      setDeleteTarget(null);
      await onRefresh();
    }
  };

  return (
    <div className="space-y-5">
      {/* Toolbar Pencarian, Filter & Tombol Tambah */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari Blok, Nama Warga, atau WA..."
              className="w-full min-h-[42px] rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl w-fit">
            {(['Semua', 'Tetap', 'Kontrak', 'Kosong'] as const).map((st) => (
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

        <button
          type="button"
          onClick={openAddModal}
          className="min-h-[44px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Tambah Warga Baru</span>
        </button>
      </div>

      {!canManageFull && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-700">
          <span className="font-semibold text-[#0F172A]">
            Hak Akses {session.jabatan || 'Pengurus'} (Tambah Data):
          </span>{' '}
          Anda dapat menambahkan data warga baru dan menyalin info login. Pengubahan data (Edit),
          Reset PIN, dan Hapus unit hanya tersedia untuk akun <span className="font-semibold">Bendahara</span>.
        </div>
      )}

      {/* Daftar / Tabel Master Data Warga */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3.5 px-4 whitespace-nowrap">Blok / Username</th>
                <th className="py-3.5 px-4">Nama Warga</th>
                <th className="py-3.5 px-4 whitespace-nowrap">No. WhatsApp</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Hunian</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap">Iuran Wajib</th>
                <th className="py-3.5 px-4 whitespace-nowrap">PIN (6 Digit)</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {pagedWarga.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    Tidak ada unit rumah yang cocok dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                pagedWarga.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-[#0F172A] whitespace-nowrap">
                      {w.blok_rumah}
                    </td>
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-[#0F172A]">{w.nama_warga}</p>
                      {!w.aktif && (
                        <span className="text-[11px] font-semibold text-red-600">Nonaktif</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {w.no_wa}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-slate-700 whitespace-nowrap">
                      {w.status_hunian}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-semibold text-[#0F172A] tabular-nums whitespace-nowrap">
                      {formatRupiah(w.nominal_iuran)}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-emerald-700 tracking-wider tabular-nums whitespace-nowrap">
                      {w.pin_akses}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {canManageFull && (
                          <button
                            type="button"
                            onClick={() => void handleResetPin(w)}
                            title="Acak / Reset PIN 6 Digit"
                            className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-amber-600" />
                            <span className="hidden xl:inline">Reset PIN</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => void handleCopyLoginInfo(w)}
                          title="Salin Info Login Siap Kirim ke WA"
                          className="min-h-[36px] px-2.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1 cursor-pointer"
                        >
                          {copiedId === w.id ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Tersalin</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Salin Info Login</span>
                            </>
                          )}
                        </button>

                        {canManageFull && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(w)}
                              aria-label={`Edit ${w.blok_rumah}`}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => setDeleteTarget(w)}
                              aria-label={`Hapus ${w.blok_rumah}`}
                              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 text-slate-600 hover:text-red-700 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
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

      {/* Modal Tambah / Edit Warga */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setModalOpen(false)}
        >
          <form
            onSubmit={handleSubmitForm}
            className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-base font-bold text-[#0F172A]">
                {form.id ? `Edit Data Warga — ${form.blok_rumah}` : 'Tambah Unit Warga Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Blok &amp; No. Rumah (Username)
                  </label>
                  <input
                    type="text"
                    required
                    value={form.blok_rumah}
                    onChange={(e) => setForm({ ...form, blok_rumah: e.target.value })}
                    placeholder="Contoh: B07/12"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono uppercase focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Status Hunian
                  </label>
                  <select
                    value={form.status_hunian}
                    onChange={(e) =>
                      setForm({ ...form, status_hunian: e.target.value as StatusHunian })
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  >
                    <option value="Tetap">Tetap</option>
                    <option value="Kontrak">Kontrak</option>
                    <option value="Kosong">Kosong</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Nama Kepala Keluarga / Penghuni
                </label>
                <input
                  type="text"
                  required
                  value={form.nama_warga}
                  onChange={(e) => setForm({ ...form, nama_warga: e.target.value })}
                  placeholder="Nama lengkap warga"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    No. WhatsApp (Format 628xxx)
                  </label>
                  <input
                    type="tel"
                    required
                    value={form.no_wa}
                    onChange={(e) => setForm({ ...form, no_wa: e.target.value })}
                    placeholder="6281234567890"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Nominal Iuran Wajib (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={5000}
                    required
                    value={form.nominal_iuran}
                    onChange={(e) =>
                      setForm({ ...form, nominal_iuran: Number(e.target.value) || 0 })
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono tabular-nums focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  PIN Akses (6 Digit Angka)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={form.pin_akses}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pin_akses: e.target.value.replace(/\D/g, '').slice(0, 6),
                      })
                    }
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono tracking-[0.2em] font-bold focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, pin_akses: generateRandomPin() })}
                    className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Acak PIN</span>
                  </button>
                </div>
              </div>

              {form.id && (
                <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={form.aktif}
                    onChange={(e) => setForm({ ...form, aktif: e.target.checked })}
                    className="w-4 h-4 rounded accent-[#059669]"
                  />
                  <span>Akun rumah ini aktif dan dapat login ke Portal Warga</span>
                </label>
              )}
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[42px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
              >
                {saving ? 'Menyimpan...' : 'Simpan Data'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Konfirmasi Hapus */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <h3 className="text-base font-bold text-[#0F172A]">Hapus Data Unit Rumah?</h3>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                Anda akan menghapus unit{' '}
                <span className="font-mono font-bold text-[#0F172A]">
                  {deleteTarget.blok_rumah}
                </span>{' '}
                atas nama <span className="font-semibold">{deleteTarget.nama_warga}</span>. Tindakan
                ini akan mencabut akses login e-Card rumah tersebut.
              </p>
            </div>
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold cursor-pointer"
              >
                Ya, Hapus Unit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
