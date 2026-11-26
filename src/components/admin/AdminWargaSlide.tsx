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
  MessageCircle,
  Database,
  Bot,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Home,
  Building,
  ArrowLeftRight,
} from 'lucide-react';
import {
  isBendaharaFullAccess,
  isBendaharaOnly,
  NOMINAL_IPL_STANDAR,
  resolveOccupancyStatus,
  type BotAccessRole,
  type BotWaConfig,
  type OccupancyStatus,
  type SessionUser,
  type StatusHunian,
  type Warga,
} from '../../types';
import {
  buildWargaAccessWaMessage,
  buildWargaBotActivationMessage,
  buildWhatsAppLink,
  canonicalizeBlokKey,
  compareBlokRumah,
  copyToClipboard,
  formatBlokRumah,
  formatPhoneDisplay,
  formatRupiah,
  generateRandomPin,
  isRealRegisteredPhone,
  matchesBlockSearch,
  normalizeBlockCode,
  normalizePhoneNumber,
} from '../../lib/format';
import {
  deleteWargaAdmin,
  importMasterWargaToDatabase,
  resetPinWargaAdmin,
  saveWargaAdmin,
  sendWargaBotActivationWaAdmin,
  toggleWargaOccupancyAdmin,
} from '../../lib/dataService';
import { SEED_WARGA } from '../../lib/seedData';
import { buildAvatarKey, useAvatarMap } from '../../lib/avatarService';
import { UserAvatar } from '../UserAvatar';
import { LoadingSpinner } from '../LoadingSpinner';

interface AdminWargaSlideProps {
  session: SessionUser;
  wargaList: Warga[];
  botConfig?: BotWaConfig;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface WargaFormState {
  id?: string;
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  secondary_whatsapp: string;
  bot_role: BotAccessRole;
  status_hunian: StatusHunian;
  nominal_iuran: number;
  pin_akses: string;
  aktif: boolean;
}

const EMPTY_FORM: WargaFormState = {
  blok_rumah: '',
  nama_warga: '',
  no_wa: '',
  secondary_whatsapp: '',
  bot_role: 'warga',
  status_hunian: 'Tetap',
  nominal_iuran: NOMINAL_IPL_STANDAR,
  pin_akses: '',
  aktif: true,
};

export function AdminWargaSlide({
  session,
  wargaList,
  botConfig,
  onRefresh,
  onToast,
}: AdminWargaSlideProps) {
  const PAGE_SIZE = 20;
  const canManageFull = isBendaharaFullAccess(session);
  const canAccessBotWa = isBendaharaOnly(session);
  const hasGatewayToken = Boolean(botConfig?.api_token?.trim());
  const avatarMap = useAvatarMap();
  const [search, setSearch] = useState('');
  const [occupancyFilter, setOccupancyFilter] = useState<'all' | OccupancyStatus>('all');
  const [optimisticStatusMap, setOptimisticStatusMap] = useState<
    Record<string, { status_hunian: StatusHunian; occupancy_status: OccupancyStatus; nominal_iuran?: number }>
  >({});
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<WargaFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Warga | null>(null);
  const [deletingWarga, setDeletingWarga] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importingMaster, setImportingMaster] = useState(false);
  const [syncExistingNames, setSyncExistingNames] = useState(false);

  // Sinkronkan optimistic override setiap kali data utama dari parent/Supabase diperbarui
  useEffect(() => {
    setOptimisticStatusMap({});
  }, [wargaList]);

  const effectiveWargaList = useMemo(() => {
    const hasOverrides = Object.keys(optimisticStatusMap).length > 0;
    if (!hasOverrides) return wargaList;
    return wargaList.map((w) => {
      const ov = optimisticStatusMap[w.id];
      if (!ov) return w;
      return {
        ...w,
        status_hunian: ov.status_hunian,
        occupancy_status: ov.occupancy_status,
        nominal_iuran: ov.nominal_iuran ?? w.nominal_iuran,
      };
    });
  }, [wargaList, optimisticStatusMap]);

  const unitCounts = useMemo(() => {
    let aktif = 0;
    let kosong = 0;
    for (const w of effectiveWargaList) {
      if (resolveOccupancyStatus(w) === 'kosong') {
        kosong += 1;
      } else {
        aktif += 1;
      }
    }
    return {
      total: effectiveWargaList.length,
      aktif,
      kosong,
    };
  }, [effectiveWargaList]);

  const rosterStats = useMemo(() => {
    const existingKeys = new Set(effectiveWargaList.map((w) => canonicalizeBlokKey(w.blok_rumah)));
    let alreadyRegistered = 0;
    let missingCount = 0;
    for (const seed of SEED_WARGA) {
      if (existingKeys.has(canonicalizeBlokKey(seed.blok_rumah))) {
        alreadyRegistered += 1;
      } else {
        missingCount += 1;
      }
    }
    const tetapCount = SEED_WARGA.filter((w) => w.status_hunian === 'Tetap').length;
    const kosongCount = SEED_WARGA.filter((w) => w.status_hunian === 'Kosong').length;
    return {
      total: SEED_WARGA.length,
      alreadyRegistered,
      missingCount,
      tetapCount,
      kosongCount,
    };
  }, [effectiveWargaList]);

  const filteredWarga = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qNormPhone = normalizePhoneNumber(search);
    return effectiveWargaList
      .filter((w) => {
        const occupancy = resolveOccupancyStatus(w);
        const matchOccupancy = occupancyFilter === 'all' || occupancy === occupancyFilter;
        const matchSearch =
          !q ||
          matchesBlockSearch(w.blok_rumah, search) ||
          w.nama_warga.toLowerCase().includes(q) ||
          w.no_wa.includes(q) ||
          (w.secondary_whatsapp || '').includes(q) ||
          (qNormPhone.length >= 4 &&
            (normalizePhoneNumber(w.no_wa).includes(qNormPhone) ||
              normalizePhoneNumber(w.secondary_whatsapp).includes(qNormPhone)));
        return matchOccupancy && matchSearch;
      })
      .sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah));
  }, [effectiveWargaList, search, occupancyFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, occupancyFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredWarga.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedWarga = useMemo(
    () => filteredWarga.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredWarga, safePage]
  );

  // Validasi live duplikat nomor WA lintas unit & format nomor
  const waValidation = useMemo(() => {
    const normPrimary = normalizePhoneNumber(form.no_wa);
    const normSecondary = normalizePhoneNumber(form.secondary_whatsapp);

    if (form.no_wa.trim() && !isRealRegisteredPhone(normPrimary)) {
      return {
        error:
          'Format No. WhatsApp Utama belum valid. Masukkan nomor aktif (contoh: 0812xxxxxxxx / 62812xxxxxxxx).',
      };
    }

    if (form.secondary_whatsapp.trim() && !isRealRegisteredPhone(normSecondary)) {
      return {
        error:
          'Format No. WhatsApp Cadangan belum valid. Masukkan nomor aktif (contoh: 0857xxxxxxxx).',
      };
    }

    if (
      isRealRegisteredPhone(normPrimary) &&
      isRealRegisteredPhone(normSecondary) &&
      normPrimary === normSecondary
    ) {
      return {
        error: 'No. WhatsApp Utama dan No. WhatsApp Cadangan tidak boleh sama persis.',
      };
    }

    for (const w of wargaList) {
      if (form.id && w.id === form.id) continue;
      const otherPrimary = normalizePhoneNumber(w.no_wa);
      const otherSecondary = normalizePhoneNumber(w.secondary_whatsapp);

      if (
        isRealRegisteredPhone(normPrimary) &&
        ((isRealRegisteredPhone(otherPrimary) && otherPrimary === normPrimary) ||
          (isRealRegisteredPhone(otherSecondary) && otherSecondary === normPrimary))
      ) {
        return {
          error: `No. WA +${normPrimary} sudah terdaftar pada unit ${w.blok_rumah} (${w.nama_warga}). Satu nomor WA tidak boleh dipakai untuk dua rumah berbeda.`,
        };
      }

      if (
        isRealRegisteredPhone(normSecondary) &&
        ((isRealRegisteredPhone(otherPrimary) && otherPrimary === normSecondary) ||
          (isRealRegisteredPhone(otherSecondary) && otherSecondary === normSecondary))
      ) {
        return {
          error: `No. WA Cadangan +${normSecondary} sudah terdaftar pada unit ${w.blok_rumah} (${w.nama_warga}).`,
        };
      }
    }

    return { error: null };
  }, [form.id, form.no_wa, form.secondary_whatsapp, wargaList]);

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
      blok_rumah: normalizeBlockCode(warga.blok_rumah) || warga.blok_rumah,
      nama_warga: warga.nama_warga,
      no_wa: isRealRegisteredPhone(warga.no_wa) ? normalizePhoneNumber(warga.no_wa) : '',
      secondary_whatsapp: isRealRegisteredPhone(warga.secondary_whatsapp)
        ? normalizePhoneNumber(warga.secondary_whatsapp)
        : '',
      bot_role:
        warga.bot_role === 'admin' || warga.bot_role === 'bendahara' ? warga.bot_role : 'warga',
      status_hunian: warga.status_hunian,
      nominal_iuran: warga.nominal_iuran,
      pin_akses: warga.pin_akses,
      aktif: warga.aktif,
    });
    setModalOpen(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (waValidation.error) {
      onToast('error', waValidation.error);
      return;
    }

    const cleanBlok = normalizeBlockCode(form.blok_rumah) || form.blok_rumah.trim().toUpperCase();
    const fallbackKosongName =
      form.status_hunian === 'Kosong' && !form.nama_warga.trim()
        ? `UNIT KOSONG ${cleanBlok}`
        : form.nama_warga;

    const normalizedPayload: WargaFormState = {
      ...form,
      blok_rumah: cleanBlok,
      nama_warga: fallbackKosongName,
      no_wa: normalizePhoneNumber(form.no_wa),
      secondary_whatsapp: normalizePhoneNumber(form.secondary_whatsapp),
    };

    setSaving(true);
    try {
      const res = await saveWargaAdmin(session, normalizedPayload);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          form.id
            ? `Data warga Blok ${normalizedPayload.blok_rumah} berhasil diperbarui.`
            : `Warga baru Blok ${normalizedPayload.blok_rumah} berhasil ditambahkan.`
        );
        setModalOpen(false);
        await onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleQuickToggleOccupancy = async (warga: Warga) => {
    if (!canManageFull || togglingId) return;
    const currentOccupancy = resolveOccupancyStatus(warga);
    const nextOccupancy: OccupancyStatus = currentOccupancy === 'kosong' ? 'aktif' : 'kosong';
    const nextStatusHunian: StatusHunian =
      nextOccupancy === 'kosong'
        ? 'Kosong'
        : warga.status_hunian === 'Kontrak'
          ? 'Kontrak'
          : 'Tetap';

    setTogglingId(warga.id);
    setOptimisticStatusMap((prev) => ({
      ...prev,
      [warga.id]: {
        status_hunian: nextStatusHunian,
        occupancy_status: nextOccupancy,
        nominal_iuran:
          nextOccupancy === 'aktif' && (!warga.nominal_iuran || warga.nominal_iuran <= 0)
            ? NOMINAL_IPL_STANDAR
            : warga.nominal_iuran,
      },
    }));

    try {
      const res = await toggleWargaOccupancyAdmin(session, warga, nextOccupancy);
      if (res.error || !res.data) {
        setOptimisticStatusMap((prev) => {
          const copy = { ...prev };
          delete copy[warga.id];
          return copy;
        });
        onToast('error', res.error || 'Gagal memperbarui status hunian unit.');
      } else {
        onToast(
          'success',
          nextOccupancy === 'kosong'
            ? `Unit ${warga.blok_rumah} ditandai Rumah Kosong (riwayat IPL tetap tersimpan).`
            : `Unit ${warga.blok_rumah} diaktifkan sebagai Dihuni / Aktif.`
        );
        await onRefresh();
      }
    } finally {
      setTogglingId(null);
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
    const message = buildWargaAccessWaMessage(warga);
    const ok = await copyToClipboard(message);
    if (ok) {
      setCopiedId(warga.id);
      onToast(
        'success',
        `Template WA akses & PIN Blok ${warga.blok_rumah} (e-card-ipl.vercel.app) berhasil disalin.`
      );
      setTimeout(() => setCopiedId(null), 2000);
    } else {
      onToast('error', 'Gagal menyalin info login.');
    }
  };

  const handleSendBotActivationGateway = async (warga: Warga) => {
    if (!botConfig) return;
    setActivatingId(warga.id);
    try {
      const res = await sendWargaBotActivationWaAdmin(session, botConfig, warga);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengirim info aktivasi Bot WA.');
      } else {
        onToast('success', res.data.message);
        await onRefresh();
      }
    } finally {
      setActivatingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deletingWarga) return;
    setDeletingWarga(true);
    try {
      const res = await deleteWargaAdmin(session, deleteTarget);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast('info', `Data unit ${deleteTarget.blok_rumah} berhasil dihapus.`);
        setDeleteTarget(null);
        await onRefresh();
      }
    } finally {
      setDeletingWarga(false);
    }
  };

  const handleBulkImportMaster = async () => {
    setImportingMaster(true);
    try {
      const res = await importMasterWargaToDatabase(session, {
        syncExisting: canManageFull && syncExistingNames,
      });
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengimpor data warga ke database.');
      } else {
        const { insertedCount, updatedCount, skippedCount } = res.data;
        if (insertedCount === 0 && updatedCount === 0) {
          onToast(
            'info',
            `Seluruh ${res.data.totalRoster} unit warga Saung Kebun sudah tersimpan di database.`
          );
        } else {
          onToast(
            'success',
            `Berhasil menyimpan ke database: ${insertedCount} unit baru ditambahkan` +
              (updatedCount > 0 ? `, ${updatedCount} unit diperbarui` : '') +
              (skippedCount > 0 ? `, ${skippedCount} sudah ada.` : '.')
          );
        }
        setImportModalOpen(false);
        await onRefresh();
      }
    } finally {
      setImportingMaster(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5 pb-[100px] w-full max-w-full min-w-0">
      {/* Toolbar Pencarian & Tombol Aksi */}
      <div className="relative z-10 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-3 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3 w-full max-w-full min-w-0">
        <div className="relative w-full lg:flex-1 lg:max-w-md min-w-0">
          <Search className="w-4 h-4 text-indigo-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari blok, nama warga, atau WA..."
            className="w-full min-h-[40px] sm:min-h-[42px] rounded-2xl border border-indigo-100 bg-white/95 pl-10 pr-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
          />
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
          <button
            type="button"
            onClick={() => {
              setSyncExistingNames(false);
              setImportModalOpen(true);
            }}
            className="min-h-[38px] sm:min-h-[42px] px-3 py-1.5 sm:px-4 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-[#064E3B] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 sm:gap-2 transition-colors cursor-pointer whitespace-nowrap shadow-xs min-w-0"
          >
            <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">
              Import 109 Warga
              {rosterStats.missingCount > 0 ? ` (+${rosterStats.missingCount})` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={openAddModal}
            className="min-h-[38px] sm:min-h-[42px] px-3 py-1.5 sm:px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 sm:gap-2 transition-colors cursor-pointer whitespace-nowrap shadow-sm min-w-0"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Tambah Warga Baru</span>
          </button>
        </div>
      </div>

      {/* Bar Filter Status Hunian & Counter Unit Real-Time */}
      <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-3 sm:p-3.5 space-y-2 w-full max-w-full min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOccupancyFilter('all')}
            className={`min-h-[34px] sm:min-h-[38px] px-3 py-1.5 sm:px-4 rounded-full border text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap ${
              occupancyFilter === 'all'
                ? 'bg-[#4C1D95] text-white border-[#4C1D95] shadow-sm'
                : 'bg-white/90 text-slate-700 border-indigo-100 hover:bg-indigo-50/60'
            }`}
          >
            <Home className="w-3.5 h-3.5 shrink-0" />
            <span>Semua Unit ({unitCounts.total})</span>
          </button>

          <button
            type="button"
            onClick={() => setOccupancyFilter('aktif')}
            className={`min-h-[34px] sm:min-h-[38px] px-3 py-1.5 sm:px-4 rounded-full border text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap ${
              occupancyFilter === 'aktif'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-[#D1FAE5]/85 text-[#047857] border-emerald-200 hover:bg-[#D1FAE5]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full shrink-0 ${
                occupancyFilter === 'aktif' ? 'bg-white' : 'bg-emerald-600'
              }`}
            />
            <span>Dihuni / Aktif ({unitCounts.aktif})</span>
          </button>

          <button
            type="button"
            onClick={() => setOccupancyFilter('kosong')}
            className={`min-h-[34px] sm:min-h-[38px] px-3 py-1.5 sm:px-4 rounded-full border text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap ${
              occupancyFilter === 'kosong'
                ? 'bg-amber-600 text-white border-amber-600 shadow-sm'
                : 'bg-[#FEF3C7]/90 text-[#B45309] border-amber-200 hover:bg-[#FEF3C7]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full shrink-0 ${
                occupancyFilter === 'kosong' ? 'bg-white' : 'bg-amber-600'
              }`}
            />
            <span>Rumah Kosong ({unitCounts.kosong})</span>
          </button>
        </div>

        {search.trim() !== '' && (
          <p className="text-[11px] text-slate-500 px-1 tabular-nums">
            Menampilkan <span className="font-semibold text-[#0F172A]">{filteredWarga.length}</span>{' '}
            unit yang cocok dengan pencarian &ldquo;{search.trim()}&rdquo; pada tab ini.
          </p>
        )}
      </div>

      {!canManageFull && (
        <div className="rounded-2xl bg-indigo-50/80 border border-indigo-200/80 px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs text-slate-700">
          <span className="font-semibold text-[#4C1D95]">
            Hak Akses {session.jabatan || 'Pengurus'}:
          </span>{' '}
          Anda dapat menambahkan data warga baru dan menyalin info login warga. Pengubahan data
          (Edit), Reset PIN, Hapus unit, ubah status hunian cepat, dan fitur Bot WA hanya tersedia
          untuk akun <span className="font-semibold">Bendahara</span>.
        </div>
      )}

      {/* Mobile Card List (< 768px) agar pas di layar HP tanpa overflow */}
      <div className="md:hidden space-y-3 w-full max-w-full min-w-0">
        {pagedWarga.length === 0 ? (
          <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-6 text-center text-sm text-slate-500">
            Tidak ada unit rumah yang cocok dengan filter pencarian.
          </div>
        ) : (
          pagedWarga.map((w) => {
            const occupancy = resolveOccupancyStatus(w);
            const isKosong = occupancy === 'kosong';
            const hasPrimaryWa = isRealRegisteredPhone(w.no_wa);
            const hasSecondaryWa = isRealRegisteredPhone(w.secondary_whatsapp);
            const hasAnyRealWa = hasPrimaryWa || hasSecondaryWa;
            const primaryLinkNumber = hasPrimaryWa
              ? normalizePhoneNumber(w.no_wa)
              : hasSecondaryWa
                ? normalizePhoneNumber(w.secondary_whatsapp)
                : '';
            const isPrivilegedBot = w.bot_role === 'admin' || w.bot_role === 'bendahara';

            return (
              <article
                key={w.id}
                className="glass-card bg-white/85 backdrop-blur-xl border border-white/90 rounded-3xl p-3.5 w-full max-w-full min-w-0 space-y-2.5 overflow-hidden"
              >
                {/* Baris Atas: Kiri (Badge Blok + Nama Warga) | Kanan (Badge Status Hunian + Iuran Wajib) */}
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <UserAvatar
                      name={w.nama_warga}
                      src={
                        w.avatar_url ||
                        avatarMap[buildAvatarKey('warga', w.blok_rumah)] ||
                        null
                      }
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-[#F5F3FF] border border-indigo-200/80 font-mono font-bold text-xs text-[#4C1D95] whitespace-nowrap">
                          {formatBlokRumah(w.blok_rumah) || w.blok_rumah}
                        </span>
                        {isPrivilegedBot && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-semibold whitespace-nowrap">
                            <ShieldCheck className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                            {w.bot_role === 'bendahara' ? 'Bendahara Bot' : 'Pengurus Bot'}
                          </span>
                        )}
                        {!w.aktif && (
                          <span className="text-[10px] font-semibold text-red-600 whitespace-nowrap">
                            Nonaktif
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-[#0F172A] leading-snug line-clamp-2 mt-1 break-words">
                        {w.nama_warga}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1 text-right">
                    {isKosong ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />
                        Kosong
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                        Dihuni{w.status_hunian === 'Kontrak' ? ' · Kontrak' : ''}
                      </span>
                    )}
                    <p className="font-mono text-xs font-bold text-[#0F172A] tabular-nums whitespace-nowrap">
                      {formatRupiah(w.nominal_iuran)}
                    </p>
                  </div>
                </div>

                {/* Baris Tengah: 2 Kotak Abu-Abu Lembut Sejajar (No. WhatsApp & PIN) */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-100/90 dark:bg-slate-800/75 border border-slate-200/70 dark:border-slate-700 px-2.5 py-2 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      No. WhatsApp
                    </p>
                    <p
                      className={`font-mono text-xs font-semibold truncate tabular-nums mt-0.5 ${
                        hasAnyRealWa ? 'text-[#0F172A]' : 'text-slate-400 font-sans font-medium'
                      }`}
                    >
                      {hasAnyRealWa ? formatPhoneDisplay(primaryLinkNumber) : 'Belum Ada WA'}
                    </p>
                    {hasSecondaryWa && hasPrimaryWa && (
                      <p className="font-mono text-[10px] text-slate-500 truncate tabular-nums">
                        +{formatPhoneDisplay(w.secondary_whatsapp)}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-100/90 dark:bg-slate-800/75 border border-slate-200/70 dark:border-slate-700 px-2.5 py-2 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      PIN (6 Digit)
                    </p>
                    <p className="font-mono text-xs font-bold text-emerald-700 tracking-wider tabular-nums mt-0.5">
                      {w.pin_akses}
                    </p>
                  </div>
                </div>

                {/* Baris Kelola Cepat (Toggle Status, Edit, Hapus sesuai hak akses) */}
                {canManageFull && (
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <button
                      type="button"
                      disabled={togglingId === w.id}
                      onClick={() => void handleQuickToggleOccupancy(w)}
                      className={`min-h-[30px] px-2.5 py-1 rounded-xl border font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60 whitespace-nowrap ${
                        isKosong
                          ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
                          : 'border-slate-200 bg-white hover:bg-amber-50 hover:border-amber-200 text-slate-700 hover:text-amber-800'
                      }`}
                    >
                      {togglingId === w.id ? (
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                      ) : (
                        <ArrowLeftRight className="w-3 h-3 shrink-0" />
                      )}
                      <span>{isKosong ? 'Aktifkan Unit' : 'Tandai Kosong'}</span>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditModal(w)}
                        className="min-h-[30px] px-2.5 py-1 rounded-xl border border-indigo-100 bg-white hover:bg-indigo-50 font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Pencil className="w-3 h-3 shrink-0" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(w)}
                        aria-label={`Hapus ${w.blok_rumah}`}
                        className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-xl border border-indigo-100 bg-white hover:bg-red-50 hover:border-red-200 text-red-600 cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Baris Bawah: 4 Tombol Aksi (Grid 2 Kolom Kompak) */}
                <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-indigo-100/70">
                  {canManageFull && (
                    <button
                      type="button"
                      onClick={() => void handleResetPin(w)}
                      className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span>Reset PIN</span>
                    </button>
                  )}

                  {canAccessBotWa &&
                    (!hasAnyRealWa ? (
                      <button
                        type="button"
                        disabled
                        title="Daftarkan nomor WA warga terlebih dahulu untuk mengaktifkan Bot"
                        className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-not-allowed whitespace-nowrap"
                      >
                        <Bot className="w-3.5 h-3.5 shrink-0" />
                        <span>Aktivasi Bot</span>
                      </button>
                    ) : hasGatewayToken ? (
                      <button
                        type="button"
                        disabled={activatingId === w.id}
                        onClick={() => void handleSendBotActivationGateway(w)}
                        className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-xs font-semibold text-emerald-800 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {activatingId === w.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        ) : (
                          <Bot className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>Aktivasi Bot</span>
                      </button>
                    ) : (
                      <a
                        href={buildWhatsAppLink(
                          primaryLinkNumber,
                          buildWargaBotActivationMessage(w)
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <Bot className="w-3.5 h-3.5 shrink-0" />
                        <span>Aktivasi Bot</span>
                      </a>
                    ))}

                  {hasAnyRealWa ? (
                    <a
                      href={buildWhatsAppLink(primaryLinkNumber, buildWargaAccessWaMessage(w))}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[34px] py-1.5 px-2.5 rounded-xl bg-[#3730A3] hover:bg-[#312E81] text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Kirim WA</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleCopyLoginInfo(w)}
                      className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Kirim WA</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleCopyLoginInfo(w)}
                    className="min-h-[34px] py-1.5 px-2.5 rounded-xl bg-[#A7F3D0]/85 hover:bg-[#6EE7B7] text-xs font-semibold text-[#064E3B] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    {copiedId === w.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 shrink-0" />
                        <span>Salin</span>
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {/* Daftar / Tabel Master Data Warga (Desktop & Tablet >= md) */}
      <section className="hidden md:block w-full min-w-0 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-max text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] dark:border-slate-700 bg-[#F5F3FF] dark:bg-slate-800 text-xs font-semibold text-[#4C1D95] dark:text-indigo-200">
                <th className="sticky left-0 z-20 bg-[#F5F3FF] dark:bg-slate-800 py-3.5 px-4 whitespace-nowrap align-middle border-r border-[#E2E8F0] dark:border-slate-700 shadow-[4px_0_12px_-4px_rgba(15,23,42,0.08)]">
                  Blok / Username
                </th>
                <th className="py-3.5 px-4 min-w-[180px] whitespace-nowrap align-middle">
                  Nama Warga
                </th>
                <th className="py-3.5 px-4 whitespace-nowrap align-middle">
                  No. WhatsApp Terdaftar
                </th>
                <th className="py-3.5 px-4 whitespace-nowrap align-middle">Status Hunian</th>
                <th className="py-3.5 px-4 text-right whitespace-nowrap align-middle">
                  Iuran Wajib
                </th>
                <th className="py-3.5 px-4 whitespace-nowrap align-middle">PIN (6 Digit)</th>
                <th className="py-3.5 px-4 pr-5 text-left whitespace-nowrap align-middle">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800 text-sm">
              {pagedWarga.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    Tidak ada unit rumah yang cocok dengan filter pencarian.
                  </td>
                </tr>
              ) : (
                pagedWarga.map((w) => {
                  const occupancy = resolveOccupancyStatus(w);
                  const isKosong = occupancy === 'kosong';
                  const hasPrimaryWa = isRealRegisteredPhone(w.no_wa);
                  const hasSecondaryWa = isRealRegisteredPhone(w.secondary_whatsapp);
                  const hasAnyRealWa = hasPrimaryWa || hasSecondaryWa;
                  const primaryLinkNumber = hasPrimaryWa
                    ? normalizePhoneNumber(w.no_wa)
                    : hasSecondaryWa
                      ? normalizePhoneNumber(w.secondary_whatsapp)
                      : '';
                  const isPrivilegedBot = w.bot_role === 'admin' || w.bot_role === 'bendahara';

                  return (
                    <tr
                      key={w.id}
                      className="group bg-white dark:bg-[#111827] hover:bg-[#F8FAFC] dark:hover:bg-slate-800/80 transition-colors"
                    >
                      <td className="sticky left-0 z-10 bg-[var(--theme-surface-solid)] group-hover:bg-[#F8FAFC] dark:group-hover:bg-[#1e293b] py-3.5 px-4 font-mono font-bold text-[#0F172A] whitespace-nowrap align-middle border-r border-[#E2E8F0]/80 dark:border-slate-800 shadow-[4px_0_12px_-4px_rgba(15,23,42,0.08)] transition-colors">
                        {formatBlokRumah(w.blok_rumah) || w.blok_rumah}
                      </td>
                      <td className="py-3.5 px-4 min-w-[180px] max-w-[250px] whitespace-normal align-middle">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar
                            name={w.nama_warga}
                            src={
                              w.avatar_url ||
                              avatarMap[buildAvatarKey('warga', w.blok_rumah)] ||
                              null
                            }
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-semibold text-[#0F172A] leading-snug line-clamp-2">
                                {w.nama_warga}
                              </p>
                              {isPrivilegedBot && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-semibold whitespace-nowrap">
                                  <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                                  {w.bot_role === 'bendahara' ? 'Bendahara Bot' : 'Pengurus Bot'}
                                </span>
                              )}
                            </div>
                            {!w.aktif && (
                              <span className="text-[11px] font-semibold text-red-600">Nonaktif</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                        {hasAnyRealWa ? (
                          <div className="flex flex-col items-start gap-1">
                            {hasPrimaryWa && (
                              <span className="inline-flex items-center h-7 px-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-xs font-semibold tabular-nums whitespace-nowrap">
                                {formatPhoneDisplay(w.no_wa)}
                              </span>
                            )}
                            {hasSecondaryWa && (
                              <span className="inline-flex items-center h-6 px-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[11px] tabular-nums whitespace-nowrap">
                                {formatPhoneDisplay(w.secondary_whatsapp)} (Cadangan)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center h-7 px-2.5 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 text-xs font-medium whitespace-nowrap">
                            Belum Ada WA
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-1.5">
                          {isKosong ? (
                            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold leading-none whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0" />
                              Kosong
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold leading-none whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0" />
                              Dihuni
                              {w.status_hunian === 'Kontrak' && (
                                <span className="text-[10px] font-medium text-emerald-600">
                                  (Kontrak)
                                </span>
                              )}
                            </span>
                          )}

                          {canManageFull && (
                            <button
                              type="button"
                              disabled={togglingId === w.id}
                              onClick={() => void handleQuickToggleOccupancy(w)}
                              title={
                                isKosong
                                  ? 'Ubah cepat menjadi Dihuni / Aktif'
                                  : 'Ubah cepat menjadi Rumah Kosong'
                              }
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-600 hover:text-[#0F172A] leading-none transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                            >
                              {togglingId === w.id ? (
                                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                              ) : (
                                <ArrowLeftRight className="w-3 h-3 shrink-0" />
                              )}
                              <span>{isKosong ? 'Aktifkan' : 'Kosongkan'}</span>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[#0F172A] tabular-nums whitespace-nowrap align-middle">
                        {formatRupiah(w.nominal_iuran)}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-700 tracking-wider tabular-nums whitespace-nowrap align-middle">
                        {w.pin_akses}
                      </td>
                      <td className="py-3.5 px-4 pr-5 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-[6px]">
                          {canManageFull && (
                            <button
                              type="button"
                              onClick={() => void handleResetPin(w)}
                              title="Acak / Reset PIN 6 Digit"
                              className="min-h-[34px] px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              <span>Reset PIN</span>
                            </button>
                          )}

                          {/* Tombol Kirim Info Aktivasi Bot (Eksklusif Bendahara) */}
                          {canAccessBotWa &&
                            (!hasAnyRealWa ? (
                              <button
                                type="button"
                                disabled
                                title="Daftarkan nomor WA warga terlebih dahulu untuk mengaktifkan Bot"
                                className="min-h-[34px] px-2.5 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 text-xs font-semibold inline-flex items-center gap-1.5 cursor-not-allowed whitespace-nowrap shrink-0"
                              >
                                <Bot className="w-3.5 h-3.5 shrink-0" />
                                <span>Aktivasi Bot</span>
                              </button>
                            ) : hasGatewayToken ? (
                              <button
                                type="button"
                                disabled={activatingId === w.id}
                                onClick={() => void handleSendBotActivationGateway(w)}
                                title={`Kirim Info Aktivasi Bot WA (perintah CEK) via ${botConfig?.provider || 'Fonnte'}`}
                                className="min-h-[34px] px-2.5 py-1.5 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                {activatingId === w.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                                ) : (
                                  <Bot className="w-3.5 h-3.5 shrink-0" />
                                )}
                                <span>Aktivasi Bot</span>
                              </button>
                            ) : (
                              <a
                                href={buildWhatsAppLink(
                                  primaryLinkNumber,
                                  buildWargaBotActivationMessage(w)
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Kirim Info Aktivasi Bot WA ke warga bahwa perintah CEK sudah aktif"
                                className="min-h-[34px] px-2.5 py-1.5 rounded-xl border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                              >
                                <Bot className="w-3.5 h-3.5 shrink-0" />
                                <span>Aktivasi Bot</span>
                              </a>
                            ))}

                          {hasAnyRealWa ? (
                            <a
                              href={buildWhatsAppLink(primaryLinkNumber, buildWargaAccessWaMessage(w))}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Kirim Template Akses Akun & PIN langsung ke WhatsApp warga"
                              className="min-h-[34px] px-3 py-1.5 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                            >
                              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Kirim WA</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleCopyLoginInfo(w)}
                              title="Belum ada nomor WA terdaftar — salin template untuk dikirim manual"
                              className="min-h-[34px] px-3 py-1.5 rounded-full border border-slate-200 bg-white/95 hover:bg-slate-50 text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Kirim WA</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleCopyLoginInfo(w)}
                            title="Salin Template WA Akses Akun & PIN (e-card-ipl.vercel.app)"
                            className="min-h-[34px] px-3 py-1.5 rounded-full bg-[#A7F3D0]/85 hover:bg-[#6EE7B7] text-xs font-semibold text-[#064E3B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            {copiedId === w.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 shrink-0" />
                                <span>Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 shrink-0" />
                                <span>Salin</span>
                              </>
                            )}
                          </button>

                          {canManageFull && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(w)}
                                aria-label={`Edit ${w.blok_rumah}`}
                                title={`Edit data ${w.blok_rumah}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-full border border-slate-200 bg-white/95 hover:bg-indigo-50 text-slate-600 cursor-pointer shrink-0 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => setDeleteTarget(w)}
                                aria-label={`Hapus ${w.blok_rumah}`}
                                title={`Hapus unit ${w.blok_rumah}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-full border border-slate-200 bg-white/95 hover:bg-red-50 hover:border-red-200 text-slate-600 hover:text-red-700 cursor-pointer shrink-0 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {filteredWarga.length > PAGE_SIZE && (
        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-slate-600">
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
              <span className="px-2 font-mono font-semibold tabular-nums text-[#4C1D95] whitespace-nowrap shrink-0">
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

      {/* Modal Tambah / Edit Warga */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          onClick={() => setModalOpen(false)}
        >
          <form
            onSubmit={handleSubmitForm}
            className="bg-white/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] flex flex-col border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 sm:px-5 py-4 border-b border-indigo-100/80 bg-indigo-50/40 flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-bold text-[#0F172A] truncate">
                {form.id ? `Edit Data Warga — ${formatBlokRumah(form.blok_rumah) || form.blok_rumah}` : 'Tambah Unit Warga Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-indigo-100/60 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
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
                    onBlur={() =>
                      setForm((prev) => ({
                        ...prev,
                        blok_rumah: normalizeBlockCode(prev.blok_rumah) || prev.blok_rumah.trim().toUpperCase(),
                      }))
                    }
                    placeholder="Contoh: B07/12"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono uppercase focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Kategori Hunian
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200">
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          status_hunian: prev.status_hunian === 'Kontrak' ? 'Kontrak' : 'Tetap',
                          nominal_iuran:
                            prev.nominal_iuran <= 0 ? NOMINAL_IPL_STANDAR : prev.nominal_iuran,
                        }))
                      }
                      className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        form.status_hunian !== 'Kosong'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-[#0F172A]'
                      }`}
                    >
                      <Home className="w-3.5 h-3.5" />
                      <span>Dihuni / Aktif</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          status_hunian: 'Kosong',
                        }))
                      }
                      className={`min-h-[36px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        form.status_hunian === 'Kosong'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-slate-600 hover:text-[#0F172A]'
                      }`}
                    >
                      <Building className="w-3.5 h-3.5" />
                      <span>Rumah Kosong</span>
                    </button>
                  </div>
                </div>
              </div>

              {form.status_hunian !== 'Kosong' && (
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Tipe Penghuni Aktif
                  </label>
                  <select
                    value={form.status_hunian}
                    onChange={(e) =>
                      setForm({ ...form, status_hunian: e.target.value as StatusHunian })
                    }
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  >
                    <option value="Tetap">Penghuni Tetap (Dihuni / Aktif)</option>
                    <option value="Kontrak">Kontrak / Sewa (Dihuni / Aktif)</option>
                  </select>
                </div>
              )}

              {form.id && (
                <p className="text-[11px] text-slate-500 -mt-1">
                  Perubahan status hunian tetap mempertahankan seluruh riwayat transaksi IPL unit
                  ini.
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Nama Kepala Keluarga / Penghuni{' '}
                  {form.status_hunian === 'Kosong' && (
                    <span className="font-normal text-slate-400">(opsional untuk rumah kosong)</span>
                  )}
                </label>
                <input
                  type="text"
                  required={form.status_hunian !== 'Kosong'}
                  value={form.nama_warga}
                  onChange={(e) => setForm({ ...form, nama_warga: e.target.value })}
                  placeholder={
                    form.status_hunian === 'Kosong'
                      ? 'Kosongkan atau isi UNIT KOSONG'
                      : 'Nama lengkap warga'
                  }
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    No. WhatsApp Utama
                  </label>
                  <input
                    type="tel"
                    value={form.no_wa}
                    onChange={(e) => setForm({ ...form, no_wa: e.target.value })}
                    onBlur={() =>
                      setForm((prev) => ({
                        ...prev,
                        no_wa: normalizePhoneNumber(prev.no_wa),
                      }))
                    }
                    placeholder="Contoh: 0812xxxxxxxx"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Otomatis dikonversi ke format 628xxx saat disimpan.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    No. WhatsApp Cadangan / Pasangan
                  </label>
                  <input
                    type="tel"
                    value={form.secondary_whatsapp}
                    onChange={(e) => setForm({ ...form, secondary_whatsapp: e.target.value })}
                    onBlur={() =>
                      setForm((prev) => ({
                        ...prev,
                        secondary_whatsapp: normalizePhoneNumber(prev.secondary_whatsapp),
                      }))
                    }
                    placeholder="Contoh: 0857xxxxxxxx (opsional)"
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Opsional (misal nomor pasangan dalam 1 unit yang sama).
                  </p>
                </div>
              </div>

              {waValidation.error && (
                <div
                  role="alert"
                  className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-800 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{waValidation.error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Hak Akses Bot WhatsApp
                  </label>
                  <select
                    value={form.bot_role}
                    onChange={(e) =>
                      setForm({ ...form, bot_role: e.target.value as BotAccessRole })
                    }
                    className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  >
                    <option value="warga">Warga (Hanya Blok Sendiri)</option>
                    <option value="admin">Pengurus (Akses Semua Blok)</option>
                    <option value="bendahara">Bendahara (Akses Semua Blok)</option>
                  </select>
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
                <div className="flex items-center gap-2 min-w-0">
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
                    className="flex-1 min-w-0 w-full min-h-[44px] rounded-xl border border-indigo-200/80 bg-white/95 px-3.5 text-sm font-mono tracking-[0.2em] font-bold focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, pin_akses: generateRandomPin() })}
                    className="shrink-0 min-h-[44px] px-3 sm:px-3.5 rounded-xl border border-indigo-200/80 bg-indigo-50/70 hover:bg-indigo-100/70 text-xs font-semibold text-[#4C1D95] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
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
                    className="w-4 h-4 rounded accent-[#4C1D95] shrink-0"
                  />
                  <span>Akun rumah ini aktif dan dapat login ke Portal Warga</span>
                </label>
              )}
            </div>

            <div className="shrink-0 px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-indigo-50/40 border-t border-indigo-100 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[42px] px-4 rounded-full border border-indigo-100 bg-white text-sm font-semibold text-slate-700 hover:bg-indigo-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || Boolean(waValidation.error)}
                aria-busy={saving}
                className="min-h-[42px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {saving && <LoadingSpinner size="xs" tone="white" />}
                <span>{saving ? 'Menyimpan...' : 'Simpan Data'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Konfirmasi Import 109 Warga Master Saung Kebun */}
      {importModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          onClick={() => !importingMaster && setImportModalOpen(false)}
        >
          <div
            className="bg-white/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] flex flex-col border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 sm:px-5 py-4 border-b border-indigo-100/80 bg-indigo-50/40 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Database className="w-4 h-4 text-[#059669] shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-[#0F172A] truncate">
                  Import 109 Data Warga ke Database
                </h3>
              </div>
              <button
                type="button"
                disabled={importingMaster}
                onClick={() => setImportModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-indigo-100/60 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              <p className="text-sm text-slate-600 leading-relaxed">
                Sistem akan memasukkan daftar lengkap{' '}
                <span className="font-bold text-[#0F172A]">{rosterStats.total} unit rumah</span>{' '}
                Perumahan Saung Kebun (Blok B3, B5, B6, B7, dan B8) langsung ke database Supabase.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Total Daftar</p>
                  <p className="text-lg font-bold text-[#0F172A] tabular-nums">
                    {rosterStats.total}
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                  <p className="text-[11px] font-semibold text-emerald-700">Siap Ditambah</p>
                  <p className="text-lg font-bold text-emerald-800 tabular-nums">
                    +{rosterStats.missingCount}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Sudah Ada</p>
                  <p className="text-lg font-bold text-[#0F172A] tabular-nums">
                    {rosterStats.alreadyRegistered}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Tetap / Kosong</p>
                  <p className="text-sm font-bold text-[#0F172A] tabular-nums mt-1">
                    {rosterStats.tetapCount} / {rosterStats.kosongCount}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 px-3.5 py-2.5 text-xs text-emerald-900 leading-relaxed">
                <span className="font-semibold">Aman untuk data yang sudah ada:</span> Nomor
                WhatsApp, PIN akses, dan blok dengan format nol depan (misal{' '}
                <span className="font-mono font-semibold">B05/02</span>) yang sudah Anda input
                sebelumnya tidak akan digandakan atau tertimpa.
              </div>

              {canManageFull && rosterStats.alreadyRegistered > 0 && (
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={syncExistingNames}
                    onChange={(e) => setSyncExistingNames(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded accent-[#059669]"
                  />
                  <span>
                    Perbarui juga nama warga, status hunian (Tetap/Kosong), dan nominal iuran untuk{' '}
                    <span className="font-semibold">{rosterStats.alreadyRegistered} unit</span> yang
                    sudah terdaftar (No. WA &amp; PIN tetap dipertahankan).
                  </span>
                </label>
              )}
            </div>

            <div className="shrink-0 px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-indigo-50/40 border-t border-indigo-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={importingMaster}
                onClick={() => setImportModalOpen(false)}
                className="min-h-[42px] px-4 rounded-full border border-indigo-100 bg-white text-sm font-semibold text-slate-700 hover:bg-indigo-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={importingMaster}
                aria-busy={importingMaster}
                onClick={() => void handleBulkImportMaster()}
                className="min-h-[42px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {importingMaster ? (
                  <LoadingSpinner size="xs" tone="white" />
                ) : (
                  <Database className="w-4 h-4" />
                )}
                <span>
                  {importingMaster ? 'Menyimpan ke Database...' : 'Masukkan ke Database'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi Hapus */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => !deletingWarga && setDeleteTarget(null)}
        >
          <div
            className="bg-white/95 backdrop-blur-xl rounded-3xl max-w-md w-full border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <h3 className="text-base font-bold text-[#0F172A]">Hapus Data Unit Rumah?</h3>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                Anda akan menghapus unit{' '}
                <span className="font-mono font-bold text-[#0F172A]">
                  {formatBlokRumah(deleteTarget.blok_rumah) || deleteTarget.blok_rumah}
                </span>{' '}
                atas nama <span className="font-semibold">{deleteTarget.nama_warga}</span>. Tindakan
                ini akan mencabut akses login e-Card rumah tersebut.
              </p>
            </div>
            <div className="px-5 py-4 bg-indigo-50/40 border-t border-indigo-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deletingWarga}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[42px] px-4 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700 disabled:opacity-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingWarga}
                aria-busy={deletingWarga}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[42px] px-5 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {deletingWarga && <LoadingSpinner size="xs" tone="white" />}
                <span>{deletingWarga ? 'Menghapus...' : 'Ya, Hapus Unit'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
