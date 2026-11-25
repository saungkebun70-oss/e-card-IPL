import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Settings,
  Sparkles,
  CreditCard,
  Bot,
  ShieldCheck,
  Upload,
  RotateCcw,
  Save,
  Loader2,
  Stamp,
  QrCode,
  Plus,
  Trash2,
  Lock,
  History,
  RefreshCw,
  Eye,
  EyeOff,
  Phone,
  AlertTriangle,
  Radio,
  UserCircle2,
  HardDrive,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DEFAULT_APP_BRAND_CONFIG,
  isBendaharaOnly,
  NOMINAL_IPL_STANDAR,
  SUSUNAN_PENGURUS,
  type AppBrandConfig,
  type AuditLogEntry,
  type BotWaConfig,
  type BotWaLog,
  type CentralSettingModuleKey,
  type PatrolMapConfig,
  type PaymentConfig,
  type PengurusAccountInfo,
  type PetugasKeamanan,
  type RekeningPembayaran,
  type SessionUser,
  type SettingPermissionStatus,
  type StatusEcardBulanan,
  type TitikPatroli,
  type Warga,
} from '../../types';
import { useAppBrand } from '../../lib/brandContext';
import { compressLogoImage, compressProofImage } from '../../lib/imageCompressor';
import {
  changeOwnAdminPinAdmin,
  saveAppBrandConfigAdmin,
  savePaymentConfigAdmin,
  uploadAppLogoAdmin,
  uploadQrisImageAdmin,
  uploadStempelImageAdmin,
} from '../../lib/dataService';
import {
  deleteAllAuditLogs,
  deleteAuditLogEntry,
  fetchAuditLogs,
} from '../../lib/auditLogger';
import { formatRupiah, formatTanggalWaktu, normalizeWaNumber } from '../../lib/format';
import { BrandLogo } from '../BrandLogo';
import { OfficialStamp } from '../OfficialStamp';
import { AdminBotWaSlide } from './AdminBotWaSlide';
import { AdminSecurityManagePanel } from './AdminSecurityManagePanel';
import { ProfileAvatarEditor } from '../ProfileAvatarEditor';
import { ThemePicker } from '../ThemePicker';
import { NotificationSettingsCard } from '../NotificationSettingsCard';
import { BugReportCard } from '../BugReportCard';
import { UserAvatar } from '../UserAvatar';
import { buildAvatarKey, useAvatarMap } from '../../lib/avatarService';
import { AdminHybridDrivePanel } from './AdminHybridDrivePanel';
import { AdminCentralSettingsPanel } from './AdminCentralSettingsPanel';
import { fetchMySettingPermissions } from '../../lib/centralSettingsService';

export type SettingsDrawerTab =
  | 'profil'
  | 'terpusat'
  | 'identitas'
  | 'pembayaran'
  | 'bot_wa'
  | 'arsip_drive'
  | 'petugas_nfc'
  | 'keamanan';

interface AdminSettingsDrawerProps {
  open: boolean;
  initialTab?: SettingsDrawerTab;
  session: SessionUser;
  paymentConfig: PaymentConfig;
  botConfig: BotWaConfig;
  botLogs: BotWaLog[];
  wargaList: Warga[];
  pengurusAccounts: PengurusAccountInfo[];
  statusList: StatusEcardBulanan[];
  petugasList: PetugasKeamanan[];
  titikPatroliList: TitikPatroli[];
  patrolMapConfig?: PatrolMapConfig | null;
  onAvatarUpdated?: (nextUrl: string | null) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminSettingsDrawer({
  open,
  initialTab = 'identitas',
  session,
  paymentConfig,
  botConfig,
  botLogs,
  wargaList,
  pengurusAccounts,
  statusList,
  petugasList,
  titikPatroliList,
  patrolMapConfig,
  onAvatarUpdated,
  onClose,
  onRefresh,
  onToast,
}: AdminSettingsDrawerProps) {
  const { brand, setBrand } = useAppBrand();
  const avatarMap = useAvatarMap();
  const isBendahara = isBendaharaOnly(session);

  const [myPermissions, setMyPermissions] = useState<
    Record<CentralSettingModuleKey, SettingPermissionStatus>
  >(() => ({
    'settings.ipl_billing': isBendahara ? 'granted' : 'revoked',
    'settings.security_patrol': isBendahara ? 'granted' : 'revoked',
    'settings.residents_blocks': isBendahara ? 'granted' : 'revoked',
    'settings.chat_moderation': isBendahara ? 'granted' : 'revoked',
    'settings.reports_audit': isBendahara ? 'granted' : 'revoked',
    'settings.system_integrations': isBendahara ? 'granted' : 'revoked',
  }));

  const canEditResidentsBlocks =
    isBendahara || myPermissions['settings.residents_blocks'] === 'granted';
  const canEditIplBilling = isBendahara || myPermissions['settings.ipl_billing'] === 'granted';
  const canAccessSecurityPatrol =
    isBendahara || myPermissions['settings.security_patrol'] === 'granted';
  const canAccessSystemIntegrations =
    isBendahara || myPermissions['settings.system_integrations'] === 'granted';
  const canAccessReportsAudit =
    isBendahara || myPermissions['settings.reports_audit'] === 'granted';

  const resolveSafeTab = (tab: SettingsDrawerTab): SettingsDrawerTab => tab;

  const [activeTab, setActiveTab] = useState<SettingsDrawerTab>(resolveSafeTab(initialTab));

  const reloadMyPermissions = async () => {
    const latest = await fetchMySettingPermissions(session);
    setMyPermissions(latest);
  };

  // Tab 1: Identitas, Logo, Stempel & WA Pengurus
  const [brandDraft, setBrandDraft] = useState<AppBrandConfig>(brand);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingStempel, setUploadingStempel] = useState(false);
  const [savingBrand, setSavingBrand] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const stempelInputRef = useRef<HTMLInputElement | null>(null);

  // Tab 2: Metode Pembayaran (QRIS, Rekening, Nominal IPL)
  const [payDraft, setPayDraft] = useState<PaymentConfig>(paymentConfig);
  const [uploadingQris, setUploadingQris] = useState(false);
  const [savingPay, setSavingPay] = useState(false);
  const [newBank, setNewBank] = useState('');
  const [newNomor, setNewNomor] = useState('');
  const [newAtasNama, setNewAtasNama] = useState('');
  const [newTipe, setNewTipe] = useState<'Transfer Bank' | 'E-Wallet'>('Transfer Bank');
  const qrisInputRef = useRef<HTMLInputElement | null>(null);

  // Tab 4: Keamanan (Ganti PIN) & Log Aktivitas
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPins, setShowPins] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [deletingAuditId, setDeletingAuditId] = useState<string | null>(null);
  const [confirmDeleteAuditId, setConfirmDeleteAuditId] = useState<string | null>(null);
  const [confirmClearAudit, setConfirmClearAudit] = useState(false);
  const [clearingAllAudit, setClearingAllAudit] = useState(false);

  const wasOpenRef = useRef(false);

  // Hanya inisialisasi tab aktif & draft form tepat saat drawer baru dibuka (false -> true).
  // Mencegah sinkronisasi latar belakang (realtime / polling 20 detik / onRefresh)
  // me-reset activeTab kembali ke menu awal atau menghapus ketikan yang belum disimpan.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    setActiveTab(resolveSafeTab(initialTab));
    setBrandDraft({
      ...brand,
      pengurus_wa_map: { ...(brand.pengurus_wa_map || {}) },
    });
    setPayDraft({
      ...paymentConfig,
      nominal_ipl_bulanan: paymentConfig.nominal_ipl_bulanan || NOMINAL_IPL_STANDAR,
    });
    setOldPin('');
    setNewPin('');
    setConfirmPin('');
    void reloadMyPermissions();
  }, [open, initialTab, brand, paymentConfig]);

  useEffect(() => {
    if (!open || activeTab !== 'keamanan' || !canAccessReportsAudit) return;
    setLoadingLogs(true);
    void fetchAuditLogs(session)
      .then((logs) => setAuditLogs(logs))
      .finally(() => setLoadingLogs(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab, session.blok_rumah, canAccessReportsAudit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const normWaPengurus = normalizeWaNumber(brandDraft.wa_pengurus || '');
  const normWaBot = brandDraft.wa_bot?.trim() ? normalizeWaNumber(brandDraft.wa_bot) : '';
  const isSameAsBot = Boolean(normWaPengurus && normWaBot && normWaPengurus === normWaBot);

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canEditResidentsBlocks) return;
    setUploadingLogo(true);
    try {
      const optimized = await compressLogoImage(file, 512);
      const res = await uploadAppLogoAdmin(session, optimized.file);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengunggah logo.');
      } else {
        setBrandDraft((prev) => ({ ...prev, logo_url: res.data || null }));
        onToast('success', 'Logo siap diterapkan. Klik "Simpan Identitas & Stempel".');
      }
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const handleUploadStempel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canEditResidentsBlocks) return;
    if (file.type && !file.type.startsWith('image/')) {
      onToast('error', 'Stempel harus berupa gambar (disarankan PNG transparan).');
      return;
    }
    setUploadingStempel(true);
    try {
      const optimized = await compressLogoImage(file, 512);
      const res = await uploadStempelImageAdmin(session, optimized.file);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengunggah stempel pengurus.');
      } else {
        setBrandDraft((prev) => ({ ...prev, stempel_url: res.data || null }));
        onToast('success', 'Stempel digital siap. Klik "Simpan Identitas & Stempel".');
      }
    } finally {
      setUploadingStempel(false);
      if (stempelInputRef.current) stempelInputRef.current.value = '';
    }
  };

  const handleSaveBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditResidentsBlocks || savingBrand) return;
    if (isSameAsBot) {
      onToast('error', 'Nomor WA Pengurus tidak boleh sama dengan Nomor WA Bot.');
      return;
    }
    setSavingBrand(true);
    try {
      const res = await saveAppBrandConfigAdmin(session, {
        app_name: brandDraft.app_name,
        app_subtitle: brandDraft.app_subtitle,
        kop_resmi: brandDraft.kop_resmi,
        logo_url: brandDraft.logo_url,
        stempel_url: brandDraft.stempel_url ?? null,
        wa_pengurus: brandDraft.wa_pengurus,
        wa_pengurus_label: brandDraft.wa_pengurus_label,
        wa_bot: brandDraft.wa_bot,
        pengurus_wa_map: brandDraft.pengurus_wa_map,
      });
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal menyimpan identitas & stempel.');
      } else {
        setBrand(res.data);
        onToast('success', 'Identitas, logo, stempel resmi & kontak WA berhasil disimpan.');
      }
    } finally {
      setSavingBrand(false);
    }
  };

  const handleUploadQris = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canEditIplBilling) return;
    setUploadingQris(true);
    try {
      const compressed = await compressProofImage(file, 1080, 0.85);
      const res = await uploadQrisImageAdmin(session, compressed.file);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengunggah QRIS.');
      } else {
        setPayDraft((prev) => ({ ...prev, qris_image_url: res.data || null, qris_aktif: true }));
        onToast('success', 'Gambar QRIS siap. Klik "Simpan Metode Pembayaran".');
      }
    } finally {
      setUploadingQris(false);
      if (qrisInputRef.current) qrisInputRef.current.value = '';
    }
  };

  const handleAddRekening = () => {
    if (!canEditIplBilling) return;
    if (!newBank.trim() || !newNomor.trim() || !newAtasNama.trim()) {
      onToast('error', 'Lengkapi Nama Bank/E-Wallet, Nomor Rekening, dan Atas Nama.');
      return;
    }
    const item: RekeningPembayaran = {
      id: `rek-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bank: newBank.trim(),
      nomor: newNomor.trim(),
      atasNama: newAtasNama.trim(),
      tipe: newTipe,
    };
    setPayDraft((prev) => ({ ...prev, rekening_list: [...prev.rekening_list, item] }));
    setNewBank('');
    setNewNomor('');
    setNewAtasNama('');
    onToast('info', 'Rekening ditambahkan. Klik "Simpan Metode Pembayaran" untuk menerapkan.');
  };

  const handleSavePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditIplBilling || savingPay) return;
    setSavingPay(true);
    try {
      const res = await savePaymentConfigAdmin(session, payDraft);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast('success', 'Pengaturan QRIS, Nomor Rekening & Nominal IPL berhasil diperbarui.');
        await onRefresh();
      }
    } finally {
      setSavingPay(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingPin) return;
    if (newPin !== confirmPin) {
      onToast('error', 'Konfirmasi PIN baru tidak cocok.');
      return;
    }
    setSavingPin(true);
    try {
      const res = await changeOwnAdminPinAdmin(session, oldPin, newPin);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast('success', 'PIN 6 digit pengurus Anda berhasil diperbarui.');
        setOldPin('');
        setNewPin('');
        setConfirmPin('');
        const latestLogs = await fetchAuditLogs(session);
        setAuditLogs(latestLogs);
      }
    } finally {
      setSavingPin(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="central-settings-title"
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4 no-print animate-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="bg-white/95 backdrop-blur-xl rounded-t-3xl sm:rounded-3xl w-full max-w-5xl max-h-[93dvh] border border-white/90 shadow-2xl flex flex-col overflow-hidden animate-modal-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle Mobile */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-indigo-200" aria-hidden="true" />
        </div>

        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-indigo-100/70 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl glass-hero text-emerald-300 flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="central-settings-title"
                className="text-base sm:text-lg font-bold text-[#0F172A] tracking-tight truncate"
              >
                Pengaturan Sistem Terpusat
              </h2>
              <p className="text-xs text-slate-500 truncate">
                {isBendahara
                  ? '6 Modul Terpusat, Delegasi Hak Pengurus, Sinkronisasi Status & Audit'
                  : 'Pusat Pengaturan Terdelegasi — Modul dikelola oleh Bendahara'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Pengaturan Sistem"
            className="min-h-[40px] min-w-[40px] rounded-full text-slate-500 hover:text-slate-900 hover:bg-indigo-50 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigasi Pengaturan Terpusat — Scroll Horizontal Halus Bebas Overflow */}
        <div className="px-3 sm:px-6 py-2.5 sm:py-3 border-b border-indigo-100/70 bg-indigo-50/40 shrink-0">
          <div
            role="tablist"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar p-1 bg-indigo-100/60 rounded-2xl"
          >
            {(
              [
                {
                  id: 'terpusat' as const,
                  label: isBendahara ? 'Pusat & Delegasi' : 'Pusat Modul',
                  icon: SlidersHorizontal,
                  locked: false,
                },
                { id: 'profil' as const, label: 'Profil Saya', icon: UserCircle2, locked: false },
                {
                  id: 'identitas' as const,
                  label: 'Identitas',
                  icon: Sparkles,
                  locked: !canEditResidentsBlocks,
                },
                {
                  id: 'pembayaran' as const,
                  label: 'Pembayaran',
                  icon: CreditCard,
                  locked: !canEditIplBilling,
                },
                {
                  id: 'bot_wa' as const,
                  label: 'Bot WA',
                  icon: Bot,
                  locked: !canAccessSystemIntegrations,
                },
                {
                  id: 'arsip_drive' as const,
                  label: 'Arsip Drive',
                  icon: HardDrive,
                  locked: !canAccessSystemIntegrations,
                },
                {
                  id: 'petugas_nfc' as const,
                  label: 'Petugas & Peta',
                  icon: Radio,
                  locked: !canAccessSecurityPatrol,
                },
                {
                  id: 'keamanan' as const,
                  label: 'PIN & Log',
                  icon: ShieldCheck,
                  locked: false,
                },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-[40px] px-3 rounded-xl text-xs font-semibold leading-tight inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all duration-200 active:scale-[0.97] cursor-pointer ${
                    active
                      ? 'bg-[#4C1D95] text-white shadow-sm'
                      : tab.locked
                        ? 'text-slate-400 hover:text-slate-600'
                        : 'text-slate-600 hover:text-[#4C1D95] hover:bg-white/60'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      active ? 'text-emerald-300' : tab.locked ? 'text-slate-400' : 'text-slate-500'
                    }`}
                  />
                  <span>{tab.label}</span>
                  {tab.locked && (
                    <Lock
                      className={`w-3 h-3 shrink-0 ${active ? 'text-amber-300' : 'text-slate-400'}`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Konten Tab */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 glass-canvas">
          <div key={activeTab} className="animate-page-enter">
          {/* TAB UTAMA: PUSAT PENGATURAN TERPUSAT & DELEGASI BENDAHARA */}
          {activeTab === 'terpusat' && (
            <AdminCentralSettingsPanel
              session={session}
              pengurusAccounts={pengurusAccounts}
              wargaList={wargaList}
              myPermissions={myPermissions}
              onPermissionsChanged={reloadMyPermissions}
              onNavigateTab={(nextTab) => setActiveTab(nextTab)}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}
          {/* TAB 0: PROFIL SAYA & FOTO PROFIL (AKTIF UNTUK SEMUA PENGURUS: KETUA, BENDAHARA, HUMAS, DLL.) */}
          {activeTab === 'profil' && (
            <div className="space-y-5 max-w-3xl mx-auto">
              <div className="glass-card rounded-3xl p-5 sm:p-6">
                <ProfileAvatarEditor
                  session={session}
                  avatarUrl={
                    session.avatar_url ||
                    avatarMap[buildAvatarKey('admin', session.blok_rumah)] ||
                    null
                  }
                  subtitle={`${session.jabatan || 'Pengurus'} · Username @${session.blok_rumah} · ${
                    session.admin_permission === 'full' ? 'Akses Penuh' : 'Akses Pengurus'
                  }`}
                  onAvatarUpdated={(nextUrl) => {
                    onAvatarUpdated?.(nextUrl);
                    void onRefresh();
                  }}
                  onToast={onToast}
                />
              </div>

              <div className="glass-card rounded-3xl p-5 sm:p-6">
                <ThemePicker onToast={onToast} />
              </div>

              <div className="glass-card rounded-3xl p-5 sm:p-6">
                <NotificationSettingsCard session={session} onToast={onToast} />
              </div>

              <div className="glass-card rounded-3xl p-5 sm:p-6">
                <BugReportCard session={session} onToast={onToast} />
              </div>

              <div className="glass-card rounded-3xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-indigo-100/70 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Daftar Akun Pengurus Aktif</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Foto profil tiap pengurus langsung tampil di Header, Sidebar, Daftar Pengurus,
                      dan Log Aktivitas.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('keamanan')}
                    className="min-h-[36px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Lock className="w-3.5 h-3.5 text-[#4C1D95]" />
                    <span>Ganti PIN</span>
                  </button>
                </div>
                <div className="divide-y divide-indigo-100/60">
                  {pengurusAccounts.map((acc) => {
                    const accAvatar =
                      acc.avatar_url || avatarMap[buildAvatarKey('admin', acc.username)] || null;
                    const isSelf =
                      acc.username.toLowerCase() === session.blok_rumah.toLowerCase();
                    return (
                      <div
                        key={acc.username}
                        className="px-5 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <UserAvatar name={acc.nama} src={accAvatar} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#0F172A] truncate">
                              {acc.nama}{' '}
                              {isSelf && (
                                <span className="text-[11px] font-semibold text-emerald-700">
                                  (Anda)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {acc.jabatan} · Blok {acc.blokRumah} ·{' '}
                              <span className="font-mono">@{acc.username}</span>
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-[#047857] bg-[#D1FAE5] border border-emerald-200 px-2.5 py-0.5 rounded-full shrink-0">
                          {acc.permission === 'full' ? 'Akses Penuh' : 'Pengurus'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          {/* TAB 1: IDENTITAS, LOGO, STEMPEL & KONTAK WA (settings.residents_blocks) */}
          {activeTab === 'identitas' && !canEditResidentsBlocks && (
            <div className="max-w-xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.residents_blocks</span>{' '}
                (Identitas, Logo, Stempel &amp; Kontak WA) belum didelegasikan ke akun Anda. Hubungi
                Bendahara untuk mengaktifkan akses modul ini.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold cursor-pointer"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'identitas' && canEditResidentsBlocks && (
            <form onSubmit={handleSaveBrand} className="space-y-5 max-w-3xl mx-auto">
              {!isBendahara && (
                <div className="flex items-start gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-900">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>
                    Akses modul <span className="font-mono font-semibold">settings.residents_blocks</span>{' '}
                    aktif melalui delegasi Bendahara.
                  </span>
                </div>
              )}

              {/* Upload Logo & Upload Stempel PNG Transparan */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Kartu Logo */}
                <div className="glass-card rounded-3xl p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <BrandLogo
                      size="lg"
                      srcOverride={brandDraft.logo_url}
                      altOverride={`Logo ${brandDraft.app_name}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#0F172A]">Logo Perumahan / Aplikasi</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        Tampil di cover login, header, kop kwitansi &amp; laporan PDF.
                      </p>
                    </div>
                  </div>
                  {canEditResidentsBlocks && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleUploadLogo}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={uploadingLogo}
                        onClick={() => logoInputRef.current?.click()}
                        className="min-h-[38px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {uploadingLogo ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>{uploadingLogo ? 'Mengunggah...' : 'Unggah Logo'}</span>
                      </button>
                      {brandDraft.logo_url && (
                        <button
                          type="button"
                          onClick={() => setBrandDraft((p) => ({ ...p, logo_url: null }))}
                          className="min-h-[38px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reset</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Kartu Stempel Digital Resmi (PNG Transparan) */}
                <div className="glass-card rounded-3xl p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border border-dashed border-indigo-300 bg-indigo-50/40 flex items-center justify-center shrink-0 overflow-hidden p-1">
                      <OfficialStamp srcOverride={brandDraft.stempel_url ?? null} size="sm" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#0F172A] flex items-center gap-1.5">
                        <Stamp className="w-4 h-4 text-[#4C1D95] shrink-0" />
                        <span>Stempel Resmi Pengurus</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                        Unggah gambar PNG transparan untuk disematkan otomatis pada kwitansi &amp;
                        LPJ PDF.
                      </p>
                    </div>
                  </div>
                  {canEditResidentsBlocks && (
                    <div className="flex flex-wrap gap-2">
                      <input
                        ref={stempelInputRef}
                        type="file"
                        accept="image/png,image/webp,image/svg+xml"
                        onChange={handleUploadStempel}
                        className="hidden"
                      />
                      <button
                        type="button"
                        disabled={uploadingStempel}
                        onClick={() => stempelInputRef.current?.click()}
                        className="min-h-[38px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {uploadingStempel ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>{uploadingStempel ? 'Mengunggah...' : 'Unggah Stempel PNG'}</span>
                      </button>
                      {brandDraft.stempel_url && (
                        <button
                          type="button"
                          onClick={() => setBrandDraft((p) => ({ ...p, stempel_url: null }))}
                          className="min-h-[38px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Stempel Default</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Form Teks Identitas */}
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                      Nama Aplikasi / Perumahan
                    </label>
                    <input
                      type="text"
                      required
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.app_name}
                      onChange={(e) => setBrandDraft((p) => ({ ...p, app_name: e.target.value }))}
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                      Subjudul Portal
                    </label>
                    <input
                      type="text"
                      required
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.app_subtitle}
                      onChange={(e) =>
                        setBrandDraft((p) => ({ ...p, app_subtitle: e.target.value }))
                      }
                      className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm disabled:bg-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1.5">
                    Kop Resmi &amp; Alamat Sekretariat (Kwitansi &amp; LPJ PDF)
                  </label>
                  <textarea
                    rows={2}
                    disabled={!canEditResidentsBlocks}
                    value={brandDraft.kop_resmi}
                    onChange={(e) => setBrandDraft((p) => ({ ...p, kop_resmi: e.target.value }))}
                    className="w-full rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100 resize-none"
                  />
                </div>
              </div>

              {/* Nomor WA Pengurus & Bot */}
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
                  <Phone className="w-4 h-4 text-[#4C1D95]" />
                  <span>Nomor WhatsApp Pengurus &amp; Bot Terpisah</span>
                </div>

                {isSameAsBot && (
                  <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-800">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>
                      Nomor WA Pengurus tidak boleh sama dengan Nomor WA Bot agar pesan warga tidak
                      masuk ke bot otomatis.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      WA Utama Pengurus (Bukan Bot)
                    </label>
                    <input
                      type="tel"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.wa_pengurus}
                      onChange={(e) =>
                        setBrandDraft((p) => ({ ...p, wa_pengurus: e.target.value }))
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm font-mono disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Label Penerima WA Pengurus
                    </label>
                    <input
                      type="text"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.wa_pengurus_label}
                      onChange={(e) =>
                        setBrandDraft((p) => ({ ...p, wa_pengurus_label: e.target.value }))
                      }
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Nomor WA Khusus Bot (Opsional)
                    </label>
                    <input
                      type="tel"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.wa_bot}
                      onChange={(e) => setBrandDraft((p) => ({ ...p, wa_bot: e.target.value }))}
                      placeholder="0851xxxx"
                      className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm font-mono disabled:bg-slate-100"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                  {SUSUNAN_PENGURUS.map((p) => (
                    <div key={p.username} className="rounded-2xl border border-indigo-100/80 p-2.5 bg-indigo-50/40">
                      <p className="text-[11px] font-semibold text-slate-700 truncate">
                        {p.nama} · {p.jabatan}
                      </p>
                      <input
                        type="tel"
                        disabled={!canEditResidentsBlocks}
                        value={brandDraft.pengurus_wa_map?.[p.username] || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBrandDraft((prev) => {
                            const nextMap = { ...(prev.pengurus_wa_map || {}) };
                            if (!val.trim()) delete nextMap[p.username];
                            else nextMap[p.username] = val;
                            return { ...prev, pengurus_wa_map: nextMap };
                          });
                        }}
                        placeholder={`Default +${normWaPengurus || '628...'}`}
                        className="mt-1.5 w-full min-h-[36px] rounded-xl border border-indigo-200/80 bg-white/90 px-2.5 text-xs font-mono text-[#0F172A] disabled:bg-slate-100"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {canEditResidentsBlocks && (
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setBrandDraft({
                        ...DEFAULT_APP_BRAND_CONFIG,
                        pengurus_wa_map: {},
                      })
                    }
                    className="min-h-[42px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Default</span>
                  </button>
                  <button
                    type="submit"
                    disabled={savingBrand || uploadingLogo || uploadingStempel || isSameAsBot}
                    className="min-h-[44px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    {savingBrand ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>{savingBrand ? 'Menyimpan...' : 'Simpan Identitas & Stempel'}</span>
                  </button>
                </div>
              )}
            </form>
          )}

          {/* TAB 2: METODE PEMBAYARAN (QRIS, REKENING, NOMINAL IPL) — settings.ipl_billing */}
          {activeTab === 'pembayaran' && !canEditIplBilling && (
            <div className="max-w-xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.ipl_billing</span> (Nominal
                IPL, QRIS, dan Rekening Kas) belum didelegasikan ke akun Anda.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold cursor-pointer"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'pembayaran' && canEditIplBilling && (
            <form onSubmit={handleSavePayment} className="space-y-5 max-w-3xl mx-auto">
              {!isBendahara && (
                <div className="flex items-start gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs text-emerald-900">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>
                    Akses modul <span className="font-mono font-semibold">settings.ipl_billing</span>{' '}
                    aktif melalui delegasi Bendahara.
                  </span>
                </div>
              )}

              {/* Nominal IPL Standar Bulanan */}
              <div className="glass-card rounded-3xl p-5 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A]">Nominal IPL Bulanan Standar</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Acuan nominal iuran bulanan standar warga Perumahan Saung Kebun (default Rp
                    100.000).
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500">
                      Rp
                    </span>
                    <input
                      type="number"
                      min={10000}
                      step={5000}
                      disabled={!canEditIplBilling}
                      value={payDraft.nominal_ipl_bulanan || NOMINAL_IPL_STANDAR}
                      onChange={(e) =>
                        setPayDraft((p) => ({
                          ...p,
                          nominal_ipl_bulanan: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 pl-10 pr-4 text-sm font-mono font-bold text-[#0F172A] tabular-nums disabled:bg-slate-100 focus:border-[#4C1D95] focus:outline-none"
                    />
                  </div>
                  <span className="text-xs font-mono text-[#047857] font-semibold">
                    = {formatRupiah(payDraft.nominal_ipl_bulanan || NOMINAL_IPL_STANDAR)} / bulan
                  </span>
                </div>
              </div>

              {/* QRIS */}
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A]">Pembayaran QR / QRIS</h3>
                    <p className="text-xs text-slate-500">
                      Tampilkan gambar kode QRIS resmi pada halaman Setor Iuran warga.
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={payDraft.qris_aktif}
                    disabled={!canEditIplBilling}
                    onClick={() => setPayDraft((p) => ({ ...p, qris_aktif: !p.qris_aktif }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      payDraft.qris_aktif ? 'bg-[#4C1D95]' : 'bg-slate-300'
                    } ${canEditIplBilling ? 'cursor-pointer' : 'opacity-50'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        payDraft.qris_aktif ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <input
                  ref={qrisInputRef}
                  type="file"
                  accept="image/*"
                  disabled={!canEditIplBilling || uploadingQris}
                  onChange={handleUploadQris}
                  className="hidden"
                />

                {payDraft.qris_image_url ? (
                  <div className="rounded-2xl border border-indigo-100/80 p-4 bg-indigo-50/40 flex flex-col sm:flex-row items-center gap-4">
                    <img
                      src={payDraft.qris_image_url}
                      alt="QRIS Kas Lingkungan"
                      referrerPolicy="no-referrer"
                      className="w-36 h-36 object-contain rounded-xl border border-indigo-100 bg-white"
                    />
                    {canEditIplBilling && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => qrisInputRef.current?.click()}
                          className="min-h-[38px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          <span>Ganti QRIS</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPayDraft((p) => ({ ...p, qris_image_url: null, qris_aktif: false }))
                          }
                          className="min-h-[38px] px-4 rounded-full border border-red-200 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={!canEditIplBilling || uploadingQris}
                    onClick={() => qrisInputRef.current?.click()}
                    className="w-full min-h-[110px] rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 hover:border-[#4C1D95] hover:bg-indigo-50/80 flex flex-col items-center justify-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    {uploadingQris ? (
                      <Loader2 className="w-6 h-6 text-[#4C1D95] animate-spin" />
                    ) : (
                      <QrCode className="w-6 h-6 text-indigo-400" />
                    )}
                    <span>
                      {uploadingQris ? 'Mengunggah QRIS...' : 'Klik untuk Upload Gambar QRIS'}
                    </span>
                  </button>
                )}
              </div>

              {/* Nomor Rekening Bendahara */}
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Daftar Rekening Transfer &amp; E-Wallet Resmi (Tersinkron ke Bot WA)
                </h3>

                <div className="divide-y divide-indigo-100/70 border border-indigo-100/80 rounded-2xl overflow-hidden bg-white/80">
                  {payDraft.rekening_list.map((rek) => (
                    <div key={rek.id} className="p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-500">
                          <span className="font-semibold text-[#4C1D95]">{rek.tipe}</span> ·{' '}
                          <span className="font-semibold text-[#0F172A]">{rek.bank}</span>
                        </p>
                        <p className="text-sm font-mono font-bold text-[#0F172A] tabular-nums mt-0.5">
                          {rek.nomor}
                        </p>
                        <p className="text-xs text-slate-600">a.n. {rek.atasNama}</p>
                      </div>
                      {canEditIplBilling && (
                        <button
                          type="button"
                          onClick={() =>
                            setPayDraft((p) => ({
                              ...p,
                              rekening_list: p.rekening_list.filter((r) => r.id !== rek.id),
                            }))
                          }
                          className="min-h-[36px] px-3 rounded-full border border-indigo-100 bg-white hover:border-red-300 hover:bg-red-50 text-slate-500 hover:text-red-700 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {canEditIplBilling && (
                  <div className="rounded-2xl bg-indigo-50/50 border border-indigo-100/80 p-4 space-y-3">
                    <p className="text-xs font-bold text-[#0F172A]">Tambah Rekening Baru</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <select
                        value={newTipe}
                        onChange={(e) =>
                          setNewTipe(e.target.value as 'Transfer Bank' | 'E-Wallet')
                        }
                        className="min-h-[40px] rounded-xl border border-indigo-200/80 bg-white px-3 text-xs text-[#0F172A]"
                      >
                        <option value="Transfer Bank">Transfer Bank</option>
                        <option value="E-Wallet">E-Wallet</option>
                      </select>
                      <input
                        type="text"
                        value={newBank}
                        onChange={(e) => setNewBank(e.target.value)}
                        placeholder="Nama Bank / E-Wallet (cth: Blu BCA)"
                        className="min-h-[40px] rounded-xl border border-indigo-200/80 bg-white px-3 text-xs text-[#0F172A]"
                      />
                      <input
                        type="text"
                        value={newNomor}
                        onChange={(e) => setNewNomor(e.target.value)}
                        placeholder="Nomor Rekening"
                        className="min-h-[40px] rounded-xl border border-indigo-200/80 bg-white px-3 text-xs font-mono text-[#0F172A]"
                      />
                      <input
                        type="text"
                        value={newAtasNama}
                        onChange={(e) => setNewAtasNama(e.target.value)}
                        placeholder="Atas Nama"
                        className="min-h-[40px] rounded-xl border border-indigo-200/80 bg-white px-3 text-xs text-[#0F172A]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddRekening}
                      className="min-h-[38px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Tambah ke Daftar</span>
                    </button>
                  </div>
                )}
              </div>

              {canEditIplBilling && (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingPay || uploadingQris}
                    className="min-h-[44px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    {savingPay ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>{savingPay ? 'Menyimpan...' : 'Simpan Metode Pembayaran'}</span>
                  </button>
                </div>
              )}
            </form>
          )}

          {/* TAB 3: KONFIGURASI BOT WHATSAPP (settings.system_integrations) */}
          {activeTab === 'bot_wa' && !canAccessSystemIntegrations && (
            <div className="max-w-xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.system_integrations</span>{' '}
                (Bot WhatsApp Gateway &amp; Arsip Drive) hanya dapat diakses Bendahara atau Pengurus
                yang diberi izin.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold cursor-pointer"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'bot_wa' && canAccessSystemIntegrations && (
            <AdminBotWaSlide
              session={session}
              botConfig={botConfig}
              botLogs={botLogs}
              wargaList={wargaList}
              pengurusAccounts={pengurusAccounts}
              statusList={statusList}
              paymentConfig={paymentConfig}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}

          {/* TAB 4: KEAMANAN (GANTI PIN) & LOG AKTIVITAS */}
          {activeTab === 'keamanan' && (
            <div className="space-y-5 max-w-4xl mx-auto">
              {/* Ganti PIN 6 Digit Pengurus */}
              <form
                onSubmit={handleChangePin}
                className="glass-card rounded-3xl p-5 space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                      <Lock className="w-4 h-4 text-[#4C1D95]" />
                      <span>Ganti PIN 6 Digit Pengurus ({session.nama_warga})</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Ubah PIN akses akun pengurus{' '}
                      <span className="font-mono font-semibold text-slate-700">
                        {session.blok_rumah}
                      </span>{' '}
                      Anda untuk menjaga keamanan portal admin.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPins((p) => !p)}
                    className="min-h-[34px] px-3 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
                  >
                    {showPins ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showPins ? 'Sembunyikan' : 'Tampilkan'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      PIN Saat Ini (6 Digit)
                    </label>
                    <input
                      type={showPins ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={oldPin}
                      onChange={(e) => setOldPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      className="w-full min-h-[42px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm font-mono tracking-widest text-[#0F172A] focus:border-[#4C1D95] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      PIN Baru (6 Digit)
                    </label>
                    <input
                      type={showPins ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      className="w-full min-h-[42px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm font-mono tracking-widest text-[#0F172A] focus:border-[#4C1D95] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Ulangi PIN Baru
                    </label>
                    <input
                      type={showPins ? 'text' : 'password'}
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="••••••"
                      className="w-full min-h-[42px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm font-mono tracking-widest text-[#0F172A] focus:border-[#4C1D95] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingPin || oldPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6}
                    className="min-h-[42px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
                  >
                    {savingPin ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>{savingPin ? 'Menyimpan PIN...' : 'Perbarui PIN Pengurus'}</span>
                  </button>
                </div>
              </form>

              {/* Log Aktivitas Sistem (settings.reports_audit) */}
              {!canAccessReportsAudit ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 flex items-start gap-3">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F172A]">
                      Log Aktivitas &amp; Audit Sistem — Terkunci (Atur oleh Bendahara)
                    </p>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Anda tetap dapat mengganti PIN akun pribadi di atas. Akses ke modul{' '}
                      <span className="font-mono font-semibold">settings.reports_audit</span>{' '}
                      diatur melalui delegasi Bendahara.
                    </p>
                  </div>
                </div>
              ) : (
              <div className="glass-card rounded-3xl overflow-hidden">
                <div className="px-5 py-4 border-b border-indigo-100/70 bg-indigo-50/40 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                      <History className="w-4 h-4 text-[#4C1D95]" />
                      <span>Log Aktivitas &amp; Audit Sistem</span>
                      {auditLogs.length > 0 && (
                        <span className="text-[11px] font-mono font-semibold text-[#4C1D95] bg-white/90 border border-indigo-100 px-2 py-0.5 rounded-full tabular-nums">
                          {auditLogs.length}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Rekam jejak login, verifikasi setoran, pengeluaran kas, dan perubahan pengaturan.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {auditLogs.length > 0 && !confirmClearAudit && (
                      <button
                        type="button"
                        disabled={clearingAllAudit || loadingLogs}
                        onClick={() => {
                          setConfirmDeleteAuditId(null);
                          setConfirmClearAudit(true);
                        }}
                        className="min-h-[36px] px-3.5 rounded-full border border-rose-200 bg-rose-50/90 hover:bg-rose-100 text-xs font-semibold text-rose-700 inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus Semua</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setLoadingLogs(true);
                        void fetchAuditLogs(session)
                          .then((logs) => setAuditLogs(logs))
                          .finally(() => setLoadingLogs(false));
                      }}
                      className="min-h-[36px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                      <span>Muat Ulang</span>
                    </button>
                  </div>
                </div>

                {confirmClearAudit && (
                  <div className="px-5 py-3 bg-rose-50/90 border-b border-rose-200/80 flex flex-wrap items-center justify-between gap-2.5 text-xs">
                    <p className="font-semibold text-rose-900">
                      Hapus seluruh {auditLogs.length} catatan log aktivitas sistem secara permanen?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={clearingAllAudit}
                        onClick={() => setConfirmClearAudit(false)}
                        className="px-3 py-1.5 rounded-full border border-rose-200 bg-white text-slate-700 font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={clearingAllAudit}
                        onClick={async () => {
                          setClearingAllAudit(true);
                          try {
                            const res = await deleteAllAuditLogs(session);
                            if (!res.ok) {
                              onToast('error', res.error || 'Gagal menghapus log aktivitas.');
                              return;
                            }
                            setAuditLogs([]);
                            setConfirmClearAudit(false);
                            onToast('success', 'Seluruh log aktivitas sistem berhasil dihapus.');
                          } finally {
                            setClearingAllAudit(false);
                          }
                        }}
                        className="px-3.5 py-1.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        {clearingAllAudit ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Ya, Hapus Semua</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="max-h-96 overflow-y-auto divide-y divide-indigo-100/60">
                  {loadingLogs ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Memuat log aktivitas sistem...
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Belum ada catatan aktivitas sistem.
                    </div>
                  ) : (
                    auditLogs.map((log) => {
                      const actorAvatar =
                        avatarMap[buildAvatarKey('admin', log.actor_id)] ||
                        avatarMap[buildAvatarKey('warga', log.actor_id)] ||
                        avatarMap[buildAvatarKey('petugas', log.actor_id)] ||
                        null;
                      const isDeletingThis = deletingAuditId === log.id;
                      const isConfirmingThis = confirmDeleteAuditId === log.id;
                      return (
                        <div key={log.id} className="px-5 py-3 text-xs flex items-start gap-3 hover:bg-indigo-50/30 transition-colors">
                          <UserAvatar
                            name={log.actor_name}
                            src={actorAvatar}
                            size="xs"
                            className="mt-0.5 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-[#0F172A]">
                                {log.actor_name}{' '}
                                <span className="font-mono font-normal text-slate-500">
                                  ({log.actor_id})
                                </span>
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-[11px] text-slate-400">
                                  {formatTanggalWaktu(log.timestamp)}
                                </span>
                                {isConfirmingThis ? (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      disabled={isDeletingThis}
                                      onClick={async () => {
                                        setDeletingAuditId(log.id);
                                        try {
                                          const res = await deleteAuditLogEntry(session, log.id);
                                          if (!res.ok) {
                                            onToast('error', res.error || 'Gagal menghapus log.');
                                            return;
                                          }
                                          setAuditLogs((prev) => prev.filter((item) => item.id !== log.id));
                                          setConfirmDeleteAuditId(null);
                                          onToast('success', 'Catatan log aktivitas dihapus.');
                                        } finally {
                                          setDeletingAuditId(null);
                                        }
                                      }}
                                      className="px-2 py-0.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                                    >
                                      {isDeletingThis && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                      <span>Hapus</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeletingThis}
                                      onClick={() => setConfirmDeleteAuditId(null)}
                                      className="px-2 py-0.5 rounded-full border border-slate-200 bg-white text-slate-600 text-[10px] font-semibold hover:bg-slate-50 cursor-pointer"
                                    >
                                      Batal
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={isDeletingThis || clearingAllAudit}
                                    onClick={() => {
                                      setConfirmClearAudit(false);
                                      setConfirmDeleteAuditId(log.id);
                                    }}
                                    aria-label="Hapus catatan log"
                                    title="Hapus catatan log ini"
                                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-40"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-slate-600 mt-0.5 leading-relaxed">{log.summary}</p>
                            <p className="text-[10px] font-mono text-[#4C1D95] mt-0.5">
                              {log.action} · {log.entity}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              )}
            </div>
          )}

          {/* TAB 5: ARSIP MODE HYBRID GOOGLE DRIVE (settings.system_integrations) */}
          {activeTab === 'arsip_drive' && !canAccessSystemIntegrations && (
            <div className="max-w-xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.system_integrations</span>{' '}
                (Arsip Hybrid Google Drive &amp; Bot WA) belum didelegasikan ke akun Anda.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold cursor-pointer"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'arsip_drive' && canAccessSystemIntegrations && (
            <AdminHybridDrivePanel
              session={session}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}

          {/* TAB 6: PETUGAS KEAMANAN, TITIK CHECKPOINT NFC & PETA MAPPING (settings.security_patrol) */}
          {activeTab === 'petugas_nfc' && !canAccessSecurityPatrol && (
            <div className="max-w-xl mx-auto rounded-2xl border border-slate-200 bg-white p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#0F172A]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.security_patrol</span>{' '}
                (Petugas Keamanan, Titik Checkpoint NFC &amp; Peta Patroli) belum didelegasikan ke
                akun Anda.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold cursor-pointer"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'petugas_nfc' && canAccessSecurityPatrol && (
            <AdminSecurityManagePanel
              session={session}
              petugasList={petugasList}
              titikPatroliList={titikPatroliList}
              patrolMapConfig={patrolMapConfig}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
