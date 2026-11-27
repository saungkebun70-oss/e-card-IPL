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
          error: `No. WA +${normPrimary} sudah terdaftar pada unit ${formatBlokRumah(w.blok_rumah) || w.blok_rumah} (${w.nama_warga}). Satu nomor WA tidak boleh dipakai untuk dua rumah berbeda.`,
        };
      }

      if (
        isRealRegisteredPhone(normSecondary) &&
        ((isRealRegisteredPhone(otherPrimary) && otherPrimary === normSecondary) ||
          (isRealRegisteredPhone(otherSecondary) && otherSecondary === normSecondary))
      ) {
        return {
          error: `No. WA Cadangan +${normSecondary} sudah terdaftar pada unit ${formatBlokRumah(w.blok_rumah) || w.blok_rumah} (${w.nama_warga}).`,
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
            ? `Data warga Blok ${formatBlokRumah(normalizedPayload.blok_rumah) || normalizedPayload.blok_rumah} berhasil diperbarui.`
            : `Warga baru Blok ${formatBlokRumah(normalizedPayload.blok_rumah) || normalizedPayload.blok_rumah} berhasil ditambahkan.`
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
        const displayBlok = formatBlokRumah(warga.blok_rumah) || warga.blok_rumah;
        onToast(
          'success',
          nextOccupancy === 'kosong'
            ? `Unit ${displayBlok} ditandai Rumah Kosong (riwayat IPL tetap tersimpan).`
            : `Unit ${displayBlok} diaktifkan sebagai Dihuni / Aktif.`
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
        `PIN baru untuk ${formatBlokRumah(warga.blok_rumah) || warga.blok_rumah} (${warga.nama_warga}): ${res.data.pin_akses}`
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
        `Template WA akses & PIN Blok ${formatBlokRumah(warga.blok_rumah) || warga.blok_rumah} (e-card-ipl.vercel.app) berhasil disalin.`
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
        onToast('info', `Data unit ${formatBlokRumah(deleteTarget.blok_rumah) || deleteTarget.blok_rumah} berhasil dihapus.`);
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
      <div className="relative z-10 glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-3 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3 w-full max-w-full min-w-0">
        <div className="relative w-full lg:flex-1 lg:max-w-md min-w-0">
          <Search className="w-4 h-4 text-[#2B3F29] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari blok, nama warga, atau WA..."
            className="w-full min-h-[40px] sm:min-h-[42px] rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/55 pl-10 pr-3.5 text-sm text-[#1F2A1E] placeholder:text-[#6B7168] focus:bg-[#FFFDF8] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
          />
        </div>

        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
          <button
            type="button"
            onClick={() => {
              setSyncExistingNames(false);
              setImportModalOpen(true);
            }}
            className="min-h-[38px] sm:min-h-[42px] px-3 py-1.5 sm:px-4 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#d5e5d2] text-[#243825] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 sm:gap-2 transition-colors cursor-pointer whitespace-nowrap shadow-xs min-w-0"
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
            className="min-h-[38px] sm:min-h-[42px] px-3 py-1.5 sm:px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 sm:gap-2 transition-colors cursor-pointer whitespace-nowrap shadow-sm min-w-0"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="truncate">Tambah Warga Baru</span>
          </button>
        </div>
      </div>

      {/* Bar Filter Status Hunian & Counter Unit Real-Time */}
      <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-3 sm:p-3.5 space-y-2 w-full max-w-full min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setOccupancyFilter('all')}
            className={`min-h-[34px] sm:min-h-[38px] px-3 py-1.5 sm:px-4 rounded-full border text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap ${
              occupancyFilter === 'all'
                ? 'bg-[#2B3F29] text-[#FFFDF8] border-[#2B3F29] shadow-sm'
                : 'bg-[#FFFDF8] text-[#4B5549] border-[#E6E2D6] hover:bg-[#F6F3EA]'
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
                ? 'bg-[#2B3F29] text-[#FFFDF8] border-[#2B3F29] shadow-sm'
                : 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF] hover:bg-[#d7e6d4]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full shrink-0 ${
                occupancyFilter === 'aktif' ? 'bg-[#FFFDF8]' : 'bg-[#2B3F29]'
              }`}
            />
            <span>Dihuni / Aktif ({unitCounts.aktif})</span>
          </button>

          <button
            type="button"
            onClick={() => setOccupancyFilter('kosong')}
            className={`min-h-[34px] sm:min-h-[38px] px-3 py-1.5 sm:px-4 rounded-full border text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer whitespace-nowrap ${
              occupancyFilter === 'kosong'
                ? 'bg-[#9C6514] text-white border-[#9C6514] shadow-sm'
                : 'bg-[#F2D8A7]/80 text-[#3F2C0D] border-[#DFC089] hover:bg-[#F2D8A7]'
            }`}
          >
            <span
              aria-hidden="true"
              className={`w-2 h-2 rounded-full shrink-0 ${
                occupancyFilter === 'kosong' ? 'bg-white' : 'bg-[#9C6514]'
              }`}
            />
            <span>Rumah Kosong ({unitCounts.kosong})</span>
          </button>
        </div>

        {search.trim() !== '' && (
          <p className="text-[11px] text-[#6B7168] px-1 tabular-nums">
            Menampilkan <span className="font-semibold text-[#1F2A1E]">{filteredWarga.length}</span>{' '}
            unit yang cocok dengan pencarian &ldquo;{search.trim()}&rdquo; pada tab ini.
          </p>
        )}
      </div>

      {!canManageFull && (
        <div className="rounded-2xl bg-[#E5EEE3]/70 border border-[#C6D2BF] px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs text-[#243825]">
          <span className="font-semibold text-[#243825]">
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
          <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-6 text-center text-sm text-[#6B7168]">
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
                className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-3.5 w-full max-w-full min-w-0 space-y-2.5 overflow-hidden"
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
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-[#E5EEE3] border border-[#C6D2BF] font-mono font-bold text-xs text-[#243825] whitespace-nowrap">
                          {formatBlokRumah(w.blok_rumah) || w.blok_rumah}
                        </span>
                        {isPrivilegedBot && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#243825] text-[#FFFDF8] text-[10px] font-semibold whitespace-nowrap">
                            <ShieldCheck className="w-2.5 h-2.5 text-[#E5EEE3] shrink-0" />
                            {w.bot_role === 'bendahara' ? 'Bendahara Bot' : 'Pengurus Bot'}
                          </span>
                        )}
                        {!w.aktif && (
                          <span className="text-[10px] font-semibold text-[#C87058] whitespace-nowrap">
                            Nonaktif
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-[#1F2A1E] leading-snug line-clamp-2 mt-1 break-words">
                        {w.nama_warga}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1 text-right">
                    {isKosong ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F2D8A7]/75 border border-[#DFC089] text-[#3F2C0D] text-[11px] font-semibold whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#9C6514] shrink-0" />
                        Kosong
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] text-[11px] font-semibold whitespace-nowrap">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#2B3F29] shrink-0" />
                        Dihuni{w.status_hunian === 'Kontrak' ? ' · Kontrak' : ''}
                      </span>
                    )}
                    <p className="font-mono text-xs font-bold text-[#1F2A1E] tabular-nums whitespace-nowrap">
                      {formatRupiah(w.nominal_iuran)}
                    </p>
                  </div>
                </div>

                {/* Baris Tengah: 2 Kotak Hangat Sejajar (No. WhatsApp & PIN) */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-[#F6F3EA] border border-[#E6E2D6] px-2.5 py-2 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7168]">
                      No. WhatsApp
                    </p>
                    <p
                      className={`font-mono text-xs font-semibold truncate tabular-nums mt-0.5 ${
                        hasAnyRealWa ? 'text-[#1F2A1E]' : 'text-[#8E948A] font-sans font-medium'
                      }`}
                    >
                      {hasAnyRealWa ? formatPhoneDisplay(primaryLinkNumber) : 'Belum Ada WA'}
                    </p>
                    {hasSecondaryWa && hasPrimaryWa && (
                      <p className="font-mono text-[10px] text-[#6B7168] truncate tabular-nums">
                        +{formatPhoneDisplay(w.secondary_whatsapp)}
                      </p>
                    )}
                  </div>

                  <div className="rounded-xl bg-[#F6F3EA] border border-[#E6E2D6] px-2.5 py-2 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7168]">
                      PIN (6 Digit)
                    </p>
                    <p className="font-mono text-xs font-bold text-[#243825] tracking-wider tabular-nums mt-0.5">
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
                          ? 'border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#d7e6d4] text-[#243825]'
                          : 'border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F2D8A7]/50 hover:border-[#DFC089] text-[#4B5549] hover:text-[#3F2C0D]'
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
                        className="min-h-[30px] px-2.5 py-1 rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] font-semibold text-[#1F2A1E] inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <Pencil className="w-3 h-3 shrink-0" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(w)}
                        aria-label={`Hapus ${formatBlokRumah(w.blok_rumah) || w.blok_rumah}`}
                        className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-xl border border-[#E5B8AC] bg-[#FFFDF8] hover:bg-[#FDF2EF] text-[#C87058] cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Baris Bawah: 4 Tombol Aksi (Grid 2 Kolom Kompak) */}
                <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-[#E6E2D6]">
                  {canManageFull && (
                    <button
                      type="button"
                      onClick={() => void handleResetPin(w)}
                      className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-xs font-semibold text-[#1F2A1E] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <KeyRound className="w-3.5 h-3.5 text-[#9C6514] shrink-0" />
                      <span>Reset PIN</span>
                    </button>
                  )}

                  {canAccessBotWa &&
                    (!hasAnyRealWa ? (
                      <button
                        type="button"
                        disabled
                        title="Daftarkan nomor WA warga terlebih dahulu untuk mengaktifkan Bot"
                        className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-[#E6E2D6] bg-[#F6F3EA] text-[#8E948A] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-not-allowed whitespace-nowrap"
                      >
                        <Bot className="w-3.5 h-3.5 shrink-0" />
                        <span>Aktivasi Bot</span>
                      </button>
                    ) : hasGatewayToken ? (
                      <button
                        type="button"
                        disabled={activatingId === w.id}
                        onClick={() => void handleSendBotActivationGateway(w)}
                        className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#d7e6d4] disabled:opacity-60 text-xs font-semibold text-[#243825] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
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
                        className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#d7e6d4] text-xs font-semibold text-[#243825] inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
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
                      className="min-h-[34px] py-1.5 px-2.5 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-xs font-semibold text-[#FFFDF8] inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Kirim WA</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleCopyLoginInfo(w)}
                      className="min-h-[34px] py-1.5 px-2.5 rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-xs font-semibold text-[#4B5549] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Kirim WA</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleCopyLoginInfo(w)}
                    className="min-h-[34px] py-1.5 px-2.5 rounded-xl bg-[#E5EEE3] hover:bg-[#d7e6d4] border border-[#C6D2BF] text-xs font-semibold text-[#243825] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
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
      <section className="hidden md:block w-full min-w-0 glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden">
        <div className="w-full overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-max text-left border-collapse">
            <thead>
              <tr className="border-b border-[#C6D2BF] bg-[#E5EEE3]/75 text-xs font-semibold text-[#243825]">
                <th className="sticky left-0 z-20 bg-[#E5EEE3] py-3.5 px-4 whitespace-nowrap align-middle border-r border-[#C6D2BF] shadow-[4px_0_12px_-4px_rgba(36,56,37,0.08)]">
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
            <tbody className="divide-y divide-[#E6E2D6] text-sm">
              {pagedWarga.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-[#6E786D]">
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
                      className="group bg-[#FFFDF8] hover:bg-[#F6F3EA]/80 transition-colors"
                    >
                      <td className="sticky left-0 z-10 bg-[#FFFDF8] group-hover:bg-[#F6F3EA] py-3.5 px-4 font-mono font-bold text-[#1B271B] whitespace-nowrap align-middle border-r border-[#E6E2D6] shadow-[4px_0_12px_-4px_rgba(36,56,37,0.08)] transition-colors">
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
                              <p className="font-semibold text-[#1B271B] leading-snug line-clamp-2">
                                {w.nama_warga}
                              </p>
                              {isPrivilegedBot && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#243825] text-[#FFFDF8] text-[10px] font-semibold whitespace-nowrap">
                                  <ShieldCheck className="w-3 h-3 text-[#E5EEE3] shrink-0" />
                                  {w.bot_role === 'bendahara' ? 'Bendahara Bot' : 'Pengurus Bot'}
                                </span>
                              )}
                            </div>
                            {!w.aktif && (
                              <span className="text-[11px] font-semibold text-[#C87058]">Nonaktif</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                        {hasAnyRealWa ? (
                          <div className="flex flex-col items-start gap-1">
                            {hasPrimaryWa && (
                              <span className="inline-flex items-center h-7 px-2.5 rounded-lg bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] font-mono text-xs font-semibold tabular-nums whitespace-nowrap">
                                {formatPhoneDisplay(w.no_wa)}
                              </span>
                            )}
                            {hasSecondaryWa && (
                              <span className="inline-flex items-center h-6 px-2 rounded-lg bg-[#F6F3EA] border border-[#E6E2D6] text-[#4A554A] font-mono text-[11px] tabular-nums whitespace-nowrap">
                                {formatPhoneDisplay(w.secondary_whatsapp)} (Cadangan)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center h-7 px-2.5 rounded-lg bg-[#F6F3EA] border border-[#E6E2D6] text-[#6E786D] text-xs font-medium whitespace-nowrap">
                            Belum Ada WA
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-1.5">
                          {isKosong ? (
                            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[#F2D8A7]/70 border border-[#E2C285] text-[#4A3410] text-xs font-semibold leading-none whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#8A5F16] shrink-0" />
                              Kosong
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] text-xs font-semibold leading-none whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2B3F29] shrink-0" />
                              Dihuni
                              {w.status_hunian === 'Kontrak' && (
                                <span className="text-[10px] font-medium text-[#384E35]">
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
                              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-xs font-semibold text-[#4A554A] hover:text-[#1B271B] leading-none transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
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
                      <td className="py-3.5 px-4 text-right font-mono font-semibold text-[#1B271B] tabular-nums whitespace-nowrap align-middle">
                        {formatRupiah(w.nominal_iuran)}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-[#243825] tracking-wider tabular-nums whitespace-nowrap align-middle">
                        {w.pin_akses}
                      </td>
                      <td className="py-3.5 px-4 pr-5 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-[6px]">
                          {canManageFull && (
                            <button
                              type="button"
                              onClick={() => void handleResetPin(w)}
                              title="Acak / Reset PIN 6 Digit"
                              className="min-h-[34px] px-2.5 py-1.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 transition-colors"
                            >
                              <KeyRound className="w-3.5 h-3.5 text-[#8A5F16] shrink-0" />
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
                                className="min-h-[34px] px-2.5 py-1.5 rounded-full border border-[#E6E2D6] bg-[#F6F3EA] text-[#8E948A] text-xs font-semibold inline-flex items-center gap-1.5 cursor-not-allowed whitespace-nowrap shrink-0"
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
                                className="min-h-[34px] px-2.5 py-1.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#d7e6d4] disabled:opacity-60 text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
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
                                className="min-h-[34px] px-2.5 py-1.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#d7e6d4] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
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
                              className="min-h-[34px] px-3 py-1.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-xs font-semibold text-[#FFFDF8] inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                            >
                              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Kirim WA</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleCopyLoginInfo(w)}
                              title="Belum ada nomor WA terdaftar — salin template untuk dikirim manual"
                              className="min-h-[34px] px-3 py-1.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-xs font-semibold text-[#4B5549] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                              <span>Kirim WA</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleCopyLoginInfo(w)}
                            title="Salin Template WA Akses Akun & PIN (e-card-ipl.vercel.app)"
                            className="min-h-[34px] px-3 py-1.5 rounded-full bg-[#E5EEE3] hover:bg-[#d7e6d4] border border-[#C6D2BF] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
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
                                aria-label={`Edit ${formatBlokRumah(w.blok_rumah) || w.blok_rumah}`}
                                title={`Edit data ${formatBlokRumah(w.blok_rumah) || w.blok_rumah}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-[#4B5549] cursor-pointer shrink-0 transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => setDeleteTarget(w)}
                                aria-label={`Hapus ${formatBlokRumah(w.blok_rumah) || w.blok_rumah}`}
                                title={`Hapus unit ${formatBlokRumah(w.blok_rumah) || w.blok_rumah}`}
                                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#FDF2EF] hover:border-[#E5B8AC] text-[#6B7168] hover:text-[#C87058] cursor-pointer shrink-0 transition-colors"
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
        <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-[#5F665D]">
            <span className="tabular-nums text-center sm:text-left">
              Menampilkan {(safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, filteredWarga.length)} dari {filteredWarga.length} unit
            </span>
            <div className="flex items-center justify-center sm:justify-end gap-2 w-full sm:w-auto">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex-1 sm:flex-none min-h-[36px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] disabled:opacity-40 inline-flex items-center justify-center gap-1 font-semibold cursor-pointer whitespace-nowrap"
              >
                <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
                <span>Sebelumnya</span>
              </button>
              <span className="px-2 font-mono font-semibold tabular-nums text-[#2B3F29] whitespace-nowrap shrink-0">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="flex-1 sm:flex-none min-h-[36px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] disabled:opacity-40 inline-flex items-center justify-center gap-1 font-semibold cursor-pointer whitespace-nowrap"
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
          className="fixed inset-0 z-[70] bg-[#182419]/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          onClick={() => setModalOpen(false)}
        >
          <form
            onSubmit={handleSubmitForm}
            className="bg-[#FFFDF8] rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] flex flex-col border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F6F3EA]/70 flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-bold text-[#1F2A1E] truncate">
                {form.id ? `Edit Data Warga — ${formatBlokRumah(form.blok_rumah) || form.blok_rumah}` : 'Tambah Unit Warga Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-full text-[#6B7168] hover:text-[#1F2A1E] hover:bg-[#E5EEE3] cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
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
                    className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm font-mono uppercase text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                    Kategori Hunian
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6]">
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
                      className={`min-h-[36px] px-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        form.status_hunian !== 'Kosong'
                          ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                          : 'text-[#4A554A] hover:text-[#1B271B]'
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
                      className={`min-h-[36px] px-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        form.status_hunian === 'Kosong'
                          ? 'bg-[#9C6514] text-white shadow-xs'
                          : 'text-[#4A554A] hover:text-[#1B271B]'
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
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                    Tipe Penghuni Aktif
                  </label>
                  <select
                    value={form.status_hunian}
                    onChange={(e) =>
                      setForm({ ...form, status_hunian: e.target.value as StatusHunian })
                    }
                    className="w-full min-h-[42px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
                  >
                    <option value="Tetap">Penghuni Tetap (Dihuni / Aktif)</option>
                    <option value="Kontrak">Kontrak / Sewa (Dihuni / Aktif)</option>
                  </select>
                </div>
              )}

              {form.id && (
                <p className="text-[11px] text-[#6E786D] -mt-1">
                  Perubahan status hunian tetap mempertahankan seluruh riwayat transaksi IPL unit
                  ini.
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                  Nama Kepala Keluarga / Penghuni{' '}
                  {form.status_hunian === 'Kosong' && (
                    <span className="font-normal text-[#8E948A]">(opsional untuk rumah kosong)</span>
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
                  className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
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
                    className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm font-mono text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
                  />
                  <p className="text-[11px] text-[#6E786D] mt-1">
                    Otomatis dikonversi ke format 628xxx saat disimpan.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
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
                    className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm font-mono text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
                  />
                  <p className="text-[11px] text-[#6E786D] mt-1">
                    Opsional (misal nomor pasangan dalam 1 unit yang sama).
                  </p>
                </div>
              </div>

              {waValidation.error && (
                <div
                  role="alert"
                  className="rounded-2xl bg-[#C87058]/10 border border-[#E2A898] px-3.5 py-2.5 text-xs text-[#7A311E] flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-[#C87058] shrink-0 mt-0.5" />
                  <span>{waValidation.error}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                    Hak Akses Bot WhatsApp
                  </label>
                  <select
                    value={form.bot_role}
                    onChange={(e) =>
                      setForm({ ...form, bot_role: e.target.value as BotAccessRole })
                    }
                    className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
                  >
                    <option value="warga">Warga (Hanya Blok Sendiri)</option>
                    <option value="admin">Pengurus (Akses Semua Blok)</option>
                    <option value="bendahara">Bendahara (Akses Semua Blok)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1">
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
                    className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3.5 text-sm font-mono tabular-nums text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20"
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
                    className="flex-1 min-w-0 w-full min-h-[44px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3.5 text-sm font-mono tracking-[0.2em] font-bold focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, pin_akses: generateRandomPin() })}
                    className="shrink-0 min-h-[44px] px-3 sm:px-3.5 rounded-xl border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#d7e6d4] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                    <span>Acak PIN</span>
                  </button>
                </div>
              </div>

              {form.id && (
                <label className="flex items-center gap-2.5 text-sm text-[#4B5549] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={form.aktif}
                    onChange={(e) => setForm({ ...form, aktif: e.target.checked })}
                    className="w-4 h-4 rounded accent-[#2B3F29] shrink-0"
                  />
                  <span>Akun rumah ini aktif dan dapat login ke Portal Warga</span>
                </label>
              )}
            </div>

            <div className="shrink-0 px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-[#F6F3EA]/70 border-t border-[#E6E2D6] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-sm font-semibold text-[#4B5549] hover:bg-[#F6F3EA] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || Boolean(waValidation.error)}
                aria-busy={saving}
                className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 disabled:cursor-not-allowed text-[#FFFDF8] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
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
          className="fixed inset-0 z-[70] bg-[#182419]/65 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          onClick={() => !importingMaster && setImportModalOpen(false)}
        >
          <div
            className="bg-[#FFFDF8] rounded-t-3xl sm:rounded-3xl max-w-lg w-full max-h-[90dvh] flex flex-col border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F6F3EA]/70 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Database className="w-4 h-4 text-[#2B3F29] shrink-0" />
                <h3 className="text-sm sm:text-base font-bold text-[#1F2A1E] truncate">
                  Import 109 Data Warga ke Database
                </h3>
              </div>
              <button
                type="button"
                disabled={importingMaster}
                onClick={() => setImportModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-full text-[#6B7168] hover:text-[#1F2A1E] hover:bg-[#E5EEE3] cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              <p className="text-sm text-[#4B5549] leading-relaxed">
                Sistem akan memasukkan daftar lengkap{' '}
                <span className="font-bold text-[#1F2A1E]">{rosterStats.total} unit rumah</span>{' '}
                Perumahan Saung Kebun (Blok B3, B5, B6, B7, dan B8) langsung ke database Supabase.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                <div className="rounded-xl bg-[#F6F3EA] border border-[#E6E2D6] p-3">
                  <p className="text-[11px] font-semibold text-[#6B7168]">Total Daftar</p>
                  <p className="text-lg font-bold text-[#1F2A1E] tabular-nums">
                    {rosterStats.total}
                  </p>
                </div>
                <div className="rounded-xl bg-[#E5EEE3] border border-[#C6D2BF] p-3">
                  <p className="text-[11px] font-semibold text-[#243825]">Siap Ditambah</p>
                  <p className="text-lg font-bold text-[#243825] tabular-nums">
                    +{rosterStats.missingCount}
                  </p>
                </div>
                <div className="rounded-xl bg-[#F6F3EA] border border-[#E6E2D6] p-3">
                  <p className="text-[11px] font-semibold text-[#6B7168]">Sudah Ada</p>
                  <p className="text-lg font-bold text-[#1F2A1E] tabular-nums">
                    {rosterStats.alreadyRegistered}
                  </p>
                </div>
                <div className="rounded-xl bg-[#F6F3EA] border border-[#E6E2D6] p-3">
                  <p className="text-[11px] font-semibold text-[#6B7168]">Tetap / Kosong</p>
                  <p className="text-sm font-bold text-[#1F2A1E] tabular-nums mt-1">
                    {rosterStats.tetapCount} / {rosterStats.kosongCount}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-[#E5EEE3]/70 border border-[#C6D2BF] px-3.5 py-2.5 text-xs text-[#243825] leading-relaxed">
                <span className="font-semibold">Aman untuk data yang sudah ada:</span> Nomor
                WhatsApp, PIN akses, dan blok dengan format nol depan (misal{' '}
                <span className="font-mono font-semibold">B05/02</span>) yang sudah Anda input
                sebelumnya tidak akan digandakan atau tertimpa.
              </div>

              {canManageFull && rosterStats.alreadyRegistered > 0 && (
                <label className="flex items-start gap-2.5 text-xs text-[#4B5549] cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={syncExistingNames}
                    onChange={(e) => setSyncExistingNames(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded accent-[#2B3F29]"
                  />
                  <span>
                    Perbarui juga nama warga, status hunian (Tetap/Kosong), dan nominal iuran untuk{' '}
                    <span className="font-semibold">{rosterStats.alreadyRegistered} unit</span> yang
                    sudah terdaftar (No. WA &amp; PIN tetap dipertahankan).
                  </span>
                </label>
              )}
            </div>

            <div className="shrink-0 px-4 sm:px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] bg-[#F6F3EA]/70 border-t border-[#E6E2D6] flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={importingMaster}
                onClick={() => setImportModalOpen(false)}
                className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-sm font-semibold text-[#4B5549] hover:bg-[#F6F3EA] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={importingMaster}
                aria-busy={importingMaster}
                onClick={() => void handleBulkImportMaster()}
                className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
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
          className="fixed inset-0 z-[70] bg-[#182419]/65 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => !deletingWarga && setDeleteTarget(null)}
        >
          <div
            className="bg-[#FFFDF8] rounded-3xl max-w-md w-full border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              <h3 className="text-base font-bold text-[#1F2A1E]">Hapus Data Unit Rumah?</h3>
              <p className="text-sm text-[#5F665D] mt-2 leading-relaxed">
                Anda akan menghapus unit{' '}
                <span className="font-mono font-bold text-[#1F2A1E]">
                  {formatBlokRumah(deleteTarget.blok_rumah) || deleteTarget.blok_rumah}
                </span>{' '}
                atas nama <span className="font-semibold">{deleteTarget.nama_warga}</span>. Tindakan
                ini akan mencabut akses login e-Card rumah tersebut.
              </p>
            </div>
            <div className="px-5 py-4 bg-[#F6F3EA]/70 border-t border-[#E6E2D6] flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deletingWarga}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-sm font-semibold text-[#4B5549] disabled:opacity-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingWarga}
                aria-busy={deletingWarga}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[42px] px-5 rounded-full bg-[#C87058] hover:bg-[#b55e47] disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
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
