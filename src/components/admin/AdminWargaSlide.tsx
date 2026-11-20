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
} from 'lucide-react';
import {
  isBendaharaFullAccess,
  NOMINAL_IPL_STANDAR,
  type BotAccessRole,
  type BotWaConfig,
  type SessionUser,
  type StatusHunian,
  type Warga,
} from '../../types';
import {
  buildWargaAccessWaMessage,
  buildWargaBotActivationMessage,
  buildWhatsAppLink,
  canonicalizeBlokKey,
  copyToClipboard,
  formatPhoneDisplay,
  formatRupiah,
  generateRandomPin,
  isRealRegisteredPhone,
  normalizeBlockCode,
  normalizePhoneNumber,
} from '../../lib/format';
import {
  deleteWargaAdmin,
  importMasterWargaToDatabase,
  resetPinWargaAdmin,
  saveWargaAdmin,
  sendWargaBotActivationWaAdmin,
} from '../../lib/dataService';
import { SEED_WARGA } from '../../lib/seedData';

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
  const hasGatewayToken = Boolean(botConfig?.api_token?.trim());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Semua' | StatusHunian>('Semua');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<WargaFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Warga | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importingMaster, setImportingMaster] = useState(false);
  const [syncExistingNames, setSyncExistingNames] = useState(false);

  const rosterStats = useMemo(() => {
    const existingKeys = new Set(wargaList.map((w) => canonicalizeBlokKey(w.blok_rumah)));
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
  }, [wargaList]);

  const filteredWarga = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qNormPhone = normalizePhoneNumber(search);
    return wargaList.filter((w) => {
      const matchStatus = statusFilter === 'Semua' || w.status_hunian === statusFilter;
      const matchSearch =
        !q ||
        w.blok_rumah.toLowerCase().includes(q) ||
        w.nama_warga.toLowerCase().includes(q) ||
        w.no_wa.includes(q) ||
        (w.secondary_whatsapp || '').includes(q) ||
        (qNormPhone.length >= 4 &&
          (normalizePhoneNumber(w.no_wa).includes(qNormPhone) ||
            normalizePhoneNumber(w.secondary_whatsapp).includes(qNormPhone)));
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

    const normalizedPayload: WargaFormState = {
      ...form,
      blok_rumah: normalizeBlockCode(form.blok_rumah) || form.blok_rumah.trim().toUpperCase(),
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

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setSyncExistingNames(false);
              setImportModalOpen(true);
            }}
            className="min-h-[44px] px-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Database className="w-4 h-4" />
            <span>
              Import 109 Warga
              {rosterStats.missingCount > 0 ? ` (+${rosterStats.missingCount})` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={openAddModal}
            className="min-h-[44px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Warga Baru</span>
          </button>
        </div>
      </div>

      {!canManageFull && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-700">
          <span className="font-semibold text-[#0F172A]">
            Hak Akses {session.jabatan || 'Pengurus'} (Tambah Data):
          </span>{' '}
          Anda dapat menambahkan data warga baru, menyalin info login, dan mengirim aktivasi Bot WA.
          Pengubahan data (Edit), Reset PIN, dan Hapus unit hanya tersedia untuk akun{' '}
          <span className="font-semibold">Bendahara</span>.
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
                <th className="py-3.5 px-4 whitespace-nowrap">No. WhatsApp Terdaftar</th>
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
                pagedWarga.map((w) => {
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
                    <tr key={w.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-bold text-[#0F172A] whitespace-nowrap">
                        {w.blok_rumah}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="font-semibold text-[#0F172A]">{w.nama_warga}</p>
                          {isPrivilegedBot && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 text-white text-[10px] font-semibold">
                              <ShieldCheck className="w-3 h-3 text-emerald-400" />
                              {w.bot_role === 'bendahara' ? 'Bendahara Bot' : 'Pengurus Bot'}
                            </span>
                          )}
                        </div>
                        {!w.aktif && (
                          <span className="text-[11px] font-semibold text-red-600">Nonaktif</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {hasAnyRealWa ? (
                          <div className="flex flex-col items-start gap-1">
                            {hasPrimaryWa && (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-mono text-xs font-semibold tabular-nums">
                                {formatPhoneDisplay(w.no_wa)}
                              </span>
                            )}
                            {hasSecondaryWa && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[11px] tabular-nums">
                                {formatPhoneDisplay(w.secondary_whatsapp)} (Cadangan)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-500 text-xs font-medium">
                            Belum Ada WA
                          </span>
                        )}
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

                          {/* Tombol Kirim Info Aktivasi Bot */}
                          {!hasAnyRealWa ? (
                            <button
                              type="button"
                              disabled
                              title="Daftarkan nomor WA warga terlebih dahulu untuk mengaktifkan Bot"
                              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 text-xs font-semibold inline-flex items-center gap-1 cursor-not-allowed"
                            >
                              <Bot className="w-3.5 h-3.5" />
                              <span className="hidden 2xl:inline">Aktivasi Bot</span>
                            </button>
                          ) : canManageFull && hasGatewayToken ? (
                            <button
                              type="button"
                              disabled={activatingId === w.id}
                              onClick={() => void handleSendBotActivationGateway(w)}
                              title={`Kirim Info Aktivasi Bot WA (perintah CEK) via ${botConfig?.provider || 'Fonnte'}`}
                              className="min-h-[36px] px-2.5 rounded-lg border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              {activatingId === w.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Bot className="w-3.5 h-3.5" />
                              )}
                              <span className="hidden 2xl:inline">Aktivasi Bot</span>
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
                              className="min-h-[36px] px-2.5 rounded-lg border border-emerald-600 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1 transition-colors"
                            >
                              <Bot className="w-3.5 h-3.5" />
                              <span className="hidden 2xl:inline">Aktivasi Bot</span>
                            </a>
                          )}

                          {hasAnyRealWa ? (
                            <a
                              href={buildWhatsAppLink(primaryLinkNumber, buildWargaAccessWaMessage(w))}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Kirim Template Akses Akun & PIN langsung ke WhatsApp warga"
                              className="min-h-[36px] px-2.5 rounded-lg bg-[#059669] hover:bg-emerald-700 text-xs font-semibold text-white inline-flex items-center gap-1 transition-colors"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Kirim WA</span>
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleCopyLoginInfo(w)}
                              title="Belum ada nomor WA terdaftar — salin template untuk dikirim manual"
                              className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span className="hidden xl:inline">Kirim WA</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => void handleCopyLoginInfo(w)}
                            title="Salin Template WA Akses Akun & PIN (e-card-ipl.vercel.app)"
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
                                <span className="hidden xl:inline">Salin</span>
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
                  );
                })
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
                disabled={saving || Boolean(waValidation.error)}
                className="min-h-[42px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer"
              >
                {saving ? 'Menyimpan...' : 'Simpan Data'}
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
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !importingMaster && setImportModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#059669]" />
                <h3 className="text-base font-bold text-[#0F172A]">
                  Import 109 Data Warga ke Database
                </h3>
              </div>
              <button
                type="button"
                disabled={importingMaster}
                onClick={() => setImportModalOpen(false)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
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

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={importingMaster}
                onClick={() => setImportModalOpen(false)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={importingMaster}
                onClick={() => void handleBulkImportMaster()}
                className="min-h-[42px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Database className="w-4 h-4" />
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
