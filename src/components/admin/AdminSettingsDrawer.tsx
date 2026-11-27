import React, { useEffect, useRef, useState } from 'react';
import {
  X,
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
  Eye,
  EyeOff,
  Phone,
  AlertTriangle,
  Calendar,
} from 'lucide-react';
import { Icon3D, type Icon3DName } from '../Icon3D';
import {
  BULAN_LIST,
  DEFAULT_APP_BRAND_CONFIG,
  DEFAULT_BILLING_START_MONTH,
  DEFAULT_BILLING_START_YEAR,
  isBendaharaOnly,
  NOMINAL_IPL_STANDAR,
  SUSUNAN_PENGURUS,
  TAHUN_AKTIF,
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
import {
  formatBillingStartLabel,
  formatRupiah,
  formatTanggalWaktu,
  normalizeWaNumber,
} from '../../lib/format';
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
import { AdminDelegationPermissionsPanel } from './AdminDelegationPermissionsPanel';
import { fetchMySettingPermissions } from '../../lib/centralSettingsService';
import {
  useCentralSettingsAccess,
  type CentralSettingPermissionMap,
} from '../../lib/accessControl';
import {
  setDriveAutoRefreshSession,
  startDriveAutoRefreshWatcher,
} from '../../lib/googleDriveAutoRefresh';

export type SettingsDrawerTab =
  | 'profil'
  | 'terpusat'
  | 'delegasi'
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
  onCentralPermissionsUpdated?: (nextMap: CentralSettingPermissionMap) => void;
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
  onCentralPermissionsUpdated,
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

  const delegationAccessControl = useCentralSettingsAccess(session, {
    enabled: open && activeTab === 'delegasi',
    onPermissionsLoaded: onCentralPermissionsUpdated,
  });

  const reloadMyPermissions = async () => {
    const latest = await fetchMySettingPermissions(session);
    setMyPermissions(latest);
    onCentralPermissionsUpdated?.(latest);
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
    setDriveAutoRefreshSession(session);
  }, [session]);

  useEffect(() => {
    const canManageDriveOAuth =
      isBendahara ||
      session.jabatan === 'Ketua' ||
      (session.role as string) === 'pengurus' ||
      canAccessSystemIntegrations;

    return startDriveAutoRefreshWatcher({
      session,
      enabled: open && canManageDriveOAuth,
    });
  }, [open, session, isBendahara, canAccessSystemIntegrations]);

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
        billing_start_month: brandDraft.billing_start_month ?? DEFAULT_BILLING_START_MONTH,
        billing_start_year: brandDraft.billing_start_year ?? DEFAULT_BILLING_START_YEAR,
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
      className="fixed inset-0 z-50 bg-[#243825]/55 backdrop-blur-md flex items-end sm:items-center justify-center sm:p-4 no-print animate-modal-backdrop"
      onClick={onClose}
    >
      <div
        className="bg-[#FFFDF8] rounded-t-3xl sm:rounded-3xl w-full max-w-5xl max-h-[93dvh] border border-[#E6E2D6] shadow-2xl flex flex-col overflow-hidden animate-modal-pop pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag Handle Mobile */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#C6D2BF]" aria-hidden="true" />
        </div>

        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex items-start sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            <Icon3D name="pengaturan" className="w-10 h-10 shrink-0 shadow-xs" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <h2
                id="central-settings-title"
                className="text-base sm:text-lg font-bold text-[#1B271B] tracking-tight leading-snug"
              >
                Pengaturan Sistem Terpusat
              </h2>
              <p className="text-[11px] sm:text-xs text-[#6E786D] leading-relaxed">
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
            className="min-h-[40px] min-w-[40px] rounded-full text-[#6E786D] hover:text-[#1B271B] hover:bg-[#E5EEE3] flex items-center justify-center cursor-pointer shrink-0 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bar Tab Navigasi Atas — Bebas Clipping Kiri/Kanan di Mobile, Tablet & Laptop */}
        <nav
          aria-label="Navigasi Modul Pengaturan Sistem"
          className="border-b border-[#E6E2D6] bg-[#F6F3EA]/80 shrink-0"
        >
          <div
            role="tablist"
            className="flex items-center gap-2 overflow-x-auto no-scrollbar px-3 sm:px-6 py-2 scroll-px-3 sm:scroll-px-6"
          >
            {(
              [
                {
                  id: 'terpusat' as const,
                  label: isBendahara ? 'Delegasi & Pusat' : 'Pusat Modul',
                  icon3d: 'delegasi' as Icon3DName,
                  locked: false,
                },
                {
                  id: 'profil' as const,
                  label: 'Profil Saya',
                  icon3d: 'profil' as Icon3DName,
                  locked: false,
                },
                {
                  id: 'identitas' as const,
                  label: 'Identitas',
                  icon3d: 'identitas' as Icon3DName,
                  locked: !canEditResidentsBlocks,
                },
                {
                  id: 'pembayaran' as const,
                  label: 'Pembayaran',
                  icon3d: 'pembayaran' as Icon3DName,
                  locked: !canEditIplBilling,
                },
                {
                  id: 'bot_wa' as const,
                  label: 'Bot WA',
                  icon3d: 'bot_wa' as Icon3DName,
                  locked: session.role !== 'admin' || session.is_active_pengurus === false,
                },
                {
                  id: 'arsip_drive' as const,
                  label: 'Arsip Drive',
                  icon3d: 'arsip_drive' as Icon3DName,
                  locked: !canAccessSystemIntegrations,
                },
                {
                  id: 'petugas_nfc' as const,
                  label: 'Petugas & Peta',
                  icon3d: 'petugas_peta' as Icon3DName,
                  locked: !canAccessSecurityPatrol,
                },
                {
                  id: 'keamanan' as const,
                  label: 'PIN & Log',
                  icon3d: 'keamanan' as Icon3DName,
                  locked: false,
                },
              ] as const
            ).map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.id)}
                  className={`h-9 min-h-[36px] px-3.5 rounded-xl text-xs font-semibold leading-none inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-all duration-200 active:scale-[0.97] cursor-pointer border ${
                    active
                      ? 'bg-[#2B3F29] border-[#2B3F29] text-white shadow-sm'
                      : tab.locked
                        ? 'bg-[#FFFDF8]/70 border-[#E6E2D6] text-[#6E786D] hover:text-[#4A554A]'
                        : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:text-[#243825] hover:border-[#C6D2BF] hover:bg-[#E5EEE3]/50'
                  }`}
                >
                  <Icon3D name={tab.icon3d} className="w-4 h-4 rounded-sm shrink-0" />
                  <span>{tab.label}</span>
                  {tab.locked && (
                    <Lock
                      className={`w-3 h-3 shrink-0 ${active ? 'text-[#F2D8A7]' : 'text-[#6E786D]'}`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

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
          {/* TAB DELEGASI MATRIKS KHUSUS */}
          {activeTab === 'delegasi' && (
            <AdminDelegationPermissionsPanel
              session={session}
              wargaList={wargaList}
              pengurusAccounts={pengurusAccounts}
              accessControl={delegationAccessControl}
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
                <div className="px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-[#1B271B]">Daftar Akun Pengurus Aktif</h3>
                    <p className="text-xs text-[#6E786D] mt-0.5">
                      Foto profil tiap pengurus langsung tampil di Header, Sidebar, Daftar Pengurus,
                      dan Log Aktivitas.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('keamanan')}
                    className="min-h-[36px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/70 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
                  >
                    <Icon3D name="ganti_pin" className="w-4 h-4 rounded-sm shrink-0" />
                    <span>Ganti PIN</span>
                  </button>
                </div>
                <div className="divide-y divide-[#E6E2D6]">
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
                            <p className="text-sm font-bold text-[#1B271B] truncate">
                              {acc.nama}{' '}
                              {isSelf && (
                                <span className="text-[11px] font-semibold text-[#2B3F29]">
                                  (Anda)
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[#6E786D] truncate">
                              {acc.jabatan} · Blok {acc.blokRumah} ·{' '}
                              <span className="font-mono">@{acc.username}</span>
                            </p>
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-[#243825] bg-[#E5EEE3] border border-[#C6D2BF] px-2.5 py-0.5 rounded-full shrink-0">
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
            <div className="max-w-xl mx-auto rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6] text-[#6E786D] flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#1B271B]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-[#4A554A] leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.residents_blocks</span>{' '}
                (Identitas, Logo, Stempel &amp; Kontak WA) belum didelegasikan ke akun Anda. Hubungi
                Bendahara untuk mengaktifkan akses modul ini.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'identitas' && canEditResidentsBlocks && (
            <form onSubmit={handleSaveBrand} className="space-y-5 max-w-3xl mx-auto">
              {!isBendahara && (
                <div className="flex items-start gap-2.5 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] px-4 py-3 text-xs text-[#243825]">
                  <ShieldCheck className="w-4 h-4 text-[#2B3F29] shrink-0 mt-0.5" />
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
                      <p className="text-sm font-bold text-[#1B271B]">Logo Perumahan / Aplikasi</p>
                      <p className="text-xs text-[#6E786D] mt-0.5 leading-relaxed">
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
                        className="min-h-[38px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
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
                          className="min-h-[38px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1 cursor-pointer transition-colors"
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
                    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border border-dashed border-[#C6D2BF] bg-[#E5EEE3]/40 flex items-center justify-center shrink-0 overflow-hidden p-1">
                      <OfficialStamp srcOverride={brandDraft.stempel_url ?? null} size="sm" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#1B271B] flex items-center gap-1.5">
                        <Stamp className="w-4 h-4 text-[#2B3F29] shrink-0" />
                        <span>Stempel Resmi Pengurus</span>
                      </p>
                      <p className="text-xs text-[#6E786D] mt-0.5 leading-relaxed">
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
                        className="min-h-[38px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
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
                          className="min-h-[38px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1 cursor-pointer transition-colors"
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
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1.5">
                      Nama Aplikasi / Perumahan
                    </label>
                    <input
                      type="text"
                      required
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.app_name}
                      onChange={(e) => setBrandDraft((p) => ({ ...p, app_name: e.target.value }))}
                      className="w-full min-h-[44px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1.5">
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
                      className="w-full min-h-[44px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1B271B] mb-1.5">
                    Kop Resmi &amp; Alamat Sekretariat (Kwitansi &amp; LPJ PDF)
                  </label>
                  <textarea
                    rows={2}
                    disabled={!canEditResidentsBlocks}
                    value={brandDraft.kop_resmi}
                    onChange={(e) => setBrandDraft((p) => ({ ...p, kop_resmi: e.target.value }))}
                    className="w-full rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] p-3 text-sm text-[#1B271B] disabled:bg-[#F6F3EA] resize-none focus:border-[#2B3F29] focus:outline-none"
                  />
                </div>
              </div>

              {/* Bulan & Tahun Mulai Penagihan Aktif (Filter Pra-Rilis) */}
              <div className="glass-card rounded-3xl p-5 space-y-4 border border-[#C6D2BF] bg-[#E5EEE3]/35">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-[#1B271B]">
                      Bulan &amp; Tahun Mulai Penagihan (Start Aplikasi)
                    </h3>
                    <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
                      Bulan sebelum periode mulai penagihan otomatis dianggap{' '}
                      <strong>Pra-Rilis (Belum Berlaku)</strong> dan tidak dihitung sebagai
                      Belum Setor maupun Tunggakan di e-Card Warga, Matriks 12 Bulan, LPJ, dan Bot
                      WhatsApp.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="billing-start-month"
                      className="block text-xs font-semibold text-[#1B271B] mb-1.5"
                    >
                      Bulan Mulai Penagihan Aktif
                    </label>
                    <select
                      id="billing-start-month"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.billing_start_month ?? DEFAULT_BILLING_START_MONTH}
                      onChange={(e) =>
                        setBrandDraft((p) => ({
                          ...p,
                          billing_start_month: Number(e.target.value),
                        }))
                      }
                      className="w-full min-h-[42px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-sm text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    >
                      {BULAN_LIST.map((b) => (
                        <option key={b.angka} value={b.angka}>
                          {b.nama}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="billing-start-year"
                      className="block text-xs font-semibold text-[#1B271B] mb-1.5"
                    >
                      Tahun Mulai Penagihan
                    </label>
                    <select
                      id="billing-start-year"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.billing_start_year ?? DEFAULT_BILLING_START_YEAR}
                      onChange={(e) =>
                        setBrandDraft((p) => ({
                          ...p,
                          billing_start_year: Number(e.target.value),
                        }))
                      }
                      className="w-full min-h-[42px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-sm font-mono text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    >
                      {[2026, 2027, 2028]
                        .concat(
                          [TAHUN_AKTIF].filter((y) => y < 2026 || y > 2028)
                        )
                        .sort((a, b) => a - b)
                        .map((yr) => (
                          <option key={yr} value={yr}>
                            {yr}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-2xl bg-[#FFFDF8] border border-[#C6D2BF] px-3.5 py-2.5 text-xs text-[#4A554A] flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Penagihan aktif dimulai:{' '}
                    <strong className="text-[#243825]">
                      {formatBillingStartLabel(brandDraft)}
                    </strong>
                  </span>
                  <span className="text-[11px] font-medium text-[#6E786D]">
                    Periode sebelumnya = Pra-Rilis
                  </span>
                </div>
              </div>

              {/* Nomor WA Pengurus & Bot */}
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <div className="flex items-center gap-2 text-sm font-bold text-[#1B271B]">
                  <Phone className="w-4 h-4 text-[#2B3F29]" />
                  <span>Nomor WhatsApp Pengurus &amp; Bot Terpisah</span>
                </div>

                {isSameAsBot && (
                  <div className="flex items-start gap-2 rounded-xl bg-[#C87058]/10 border border-[#E2A898] px-3.5 py-2.5 text-xs text-[#7A311E]">
                    <AlertTriangle className="w-4 h-4 text-[#C87058] shrink-0 mt-0.5" />
                    <span>
                      Nomor WA Pengurus tidak boleh sama dengan Nomor WA Bot agar pesan warga tidak
                      masuk ke bot otomatis.
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                      WA Utama Pengurus (Bukan Bot)
                    </label>
                    <input
                      type="tel"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.wa_pengurus}
                      onChange={(e) =>
                        setBrandDraft((p) => ({ ...p, wa_pengurus: e.target.value }))
                      }
                      className="w-full min-h-[42px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-sm font-mono text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                      Label Penerima WA Pengurus
                    </label>
                    <input
                      type="text"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.wa_pengurus_label}
                      onChange={(e) =>
                        setBrandDraft((p) => ({ ...p, wa_pengurus_label: e.target.value }))
                      }
                      className="w-full min-h-[42px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-sm text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                      Nomor WA Khusus Bot (Opsional)
                    </label>
                    <input
                      type="tel"
                      disabled={!canEditResidentsBlocks}
                      value={brandDraft.wa_bot}
                      onChange={(e) => setBrandDraft((p) => ({ ...p, wa_bot: e.target.value }))}
                      placeholder="0851xxxx"
                      className="w-full min-h-[42px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-sm font-mono text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                  {SUSUNAN_PENGURUS.map((p) => (
                    <div key={p.username} className="rounded-2xl border border-[#E6E2D6] p-2.5 bg-[#F6F3EA]/70">
                      <p className="text-[11px] font-semibold text-[#4A554A] truncate">
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
                        className="mt-1.5 w-full min-h-[36px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-2.5 text-xs font-mono text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
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
                    className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Default</span>
                  </button>
                  <button
                    type="submit"
                    disabled={savingBrand || uploadingLogo || uploadingStempel || isSameAsBot}
                    className="min-h-[44px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
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
            <div className="max-w-xl mx-auto rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6] text-[#6E786D] flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#1B271B]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-[#4A554A] leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.ipl_billing</span> (Nominal
                IPL, QRIS, dan Rekening Kas) belum didelegasikan ke akun Anda.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'pembayaran' && canEditIplBilling && (
            <form onSubmit={handleSavePayment} className="space-y-5 max-w-3xl mx-auto">
              {!isBendahara && (
                <div className="flex items-start gap-2.5 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] px-4 py-3 text-xs text-[#243825]">
                  <ShieldCheck className="w-4 h-4 text-[#2B3F29] shrink-0 mt-0.5" />
                  <span>
                    Akses modul <span className="font-mono font-semibold">settings.ipl_billing</span>{' '}
                    aktif melalui delegasi Bendahara.
                  </span>
                </div>
              )}

              {/* Nominal IPL Standar Bulanan */}
              <div className="glass-card rounded-3xl p-5 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-[#1B271B]">Nominal IPL Bulanan Standar</h3>
                  <p className="text-xs text-[#6E786D] mt-0.5">
                    Acuan nominal iuran bulanan standar warga Perumahan Saung Kebun (default Rp
                    100.000).
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#6E786D]">
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
                      className="w-full min-h-[44px] rounded-2xl border border-[#D9D4C5] bg-[#FFFDF8] pl-10 pr-4 text-sm font-mono font-bold text-[#1B271B] tabular-nums disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                  <span className="text-xs font-mono text-[#243825] font-semibold">
                    = {formatRupiah(payDraft.nominal_ipl_bulanan || NOMINAL_IPL_STANDAR)} / bulan
                  </span>
                </div>
              </div>

              {/* QRIS */}
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#1B271B]">Pembayaran QR / QRIS</h3>
                    <p className="text-xs text-[#6E786D]">
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
                      payDraft.qris_aktif ? 'bg-[#2B3F29]' : 'bg-[#C6D2BF]'
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
                  <div className="rounded-2xl border border-[#E6E2D6] p-4 bg-[#F6F3EA]/70 flex flex-col sm:flex-row items-center gap-4">
                    <img
                      src={payDraft.qris_image_url}
                      alt="QRIS Kas Lingkungan"
                      referrerPolicy="no-referrer"
                      className="w-36 h-36 object-contain rounded-xl border border-[#E6E2D6] bg-white"
                    />
                    {canEditIplBilling && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => qrisInputRef.current?.click()}
                          className="min-h-[38px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Icon3D name="upload" className="w-4 h-4 shrink-0" />
                          <span>Ganti QRIS</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPayDraft((p) => ({ ...p, qris_image_url: null, qris_aktif: false }))
                          }
                          className="min-h-[38px] px-4 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#7A311E] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Icon3D name="hapus" className="w-4 h-4 shrink-0" />
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
                    className="w-full min-h-[110px] rounded-2xl border-2 border-dashed border-[#C6D2BF] bg-[#E5EEE3]/35 hover:border-[#2B3F29] hover:bg-[#E5EEE3]/65 flex flex-col items-center justify-center gap-1.5 text-xs font-semibold text-[#243825] cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    {uploadingQris ? (
                      <Loader2 className="w-6 h-6 text-[#2B3F29] animate-spin" />
                    ) : (
                      <QrCode className="w-6 h-6 text-[#384E35]" />
                    )}
                    <span>
                      {uploadingQris ? 'Mengunggah QRIS...' : 'Klik untuk Upload Gambar QRIS'}
                    </span>
                  </button>
                )}
              </div>

              {/* Nomor Rekening Bendahara */}
              <div className="glass-card rounded-3xl p-5 space-y-4">
                <h3 className="text-sm font-bold text-[#1B271B]">
                  Daftar Rekening Transfer &amp; E-Wallet Resmi (Tersinkron ke Bot WA)
                </h3>

                <div className="divide-y divide-[#E6E2D6] border border-[#E6E2D6] rounded-2xl overflow-hidden bg-[#FFFDF8]">
                  {payDraft.rekening_list.map((rek) => (
                    <div key={rek.id} className="p-3.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-[#6E786D]">
                          <span className="font-semibold text-[#2B3F29]">{rek.tipe}</span> ·{' '}
                          <span className="font-semibold text-[#1B271B]">{rek.bank}</span>
                        </p>
                        <p className="text-sm font-mono font-bold text-[#1B271B] tabular-nums mt-0.5">
                          {rek.nomor}
                        </p>
                        <p className="text-xs text-[#4A554A]">a.n. {rek.atasNama}</p>
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
                          className="min-h-[36px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:border-[#E2A898] hover:bg-[#C87058]/10 text-[#6E786D] hover:text-[#7A311E] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Icon3D name="hapus" className="w-4 h-4 shrink-0" />
                          <span>Hapus</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {canEditIplBilling && (
                  <div className="rounded-2xl bg-[#F6F3EA]/80 border border-[#E6E2D6] p-4 space-y-3">
                    <p className="text-xs font-bold text-[#1B271B]">Tambah Rekening Baru</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <select
                        value={newTipe}
                        onChange={(e) =>
                          setNewTipe(e.target.value as 'Transfer Bank' | 'E-Wallet')
                        }
                        className="min-h-[40px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-xs text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                      >
                        <option value="Transfer Bank">Transfer Bank</option>
                        <option value="E-Wallet">E-Wallet</option>
                      </select>
                      <input
                        type="text"
                        value={newBank}
                        onChange={(e) => setNewBank(e.target.value)}
                        placeholder="Nama Bank / E-Wallet (cth: Blu BCA)"
                        className="min-h-[40px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-xs text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                      />
                      <input
                        type="text"
                        value={newNomor}
                        onChange={(e) => setNewNomor(e.target.value)}
                        placeholder="Nomor Rekening"
                        className="min-h-[40px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-xs font-mono text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                      />
                      <input
                        type="text"
                        value={newAtasNama}
                        onChange={(e) => setNewAtasNama(e.target.value)}
                        placeholder="Atas Nama"
                        className="min-h-[40px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-xs text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleAddRekening}
                      className="min-h-[38px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
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
                    className="min-h-[44px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
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

          {/* TAB 3: KONFIGURASI BOT WHATSAPP & KIRIM AKUN/PIN (PENGURUS AKTIF) */}
          {activeTab === 'bot_wa' &&
            (session.role !== 'admin' || session.is_active_pengurus === false) && (
            <div className="max-w-xl mx-auto rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6] text-[#6E786D] flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#1B271B]">
                Akses Dibatasi — Khusus Pengurus Aktif
              </h3>
              <p className="text-xs text-[#4A554A] leading-relaxed">
                Modul Bot WhatsApp &amp; Pengiriman Akun/PIN hanya dapat diakses oleh pengurus aktif.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'bot_wa' &&
            session.role === 'admin' &&
            session.is_active_pengurus !== false && (
            <AdminBotWaSlide
              session={session}
              botConfig={botConfig}
              botLogs={botLogs}
              wargaList={wargaList}
              pengurusAccounts={pengurusAccounts}
              petugasList={petugasList}
              statusList={statusList}
              paymentConfig={paymentConfig}
              canManageOverride={canAccessSystemIntegrations}
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
                    <h3 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
                      <Icon3D name="ganti_pin" className="w-5 h-5 rounded-md shrink-0" />
                      <span>Ganti PIN 6 Digit Pengurus ({session.nama_warga})</span>
                    </h3>
                    <p className="text-xs text-[#6E786D] mt-0.5">
                      Ubah PIN akses akun pengurus{' '}
                      <span className="font-mono font-semibold text-[#4A554A]">
                        {session.blok_rumah}
                      </span>{' '}
                      Anda untuk menjaga keamanan portal admin.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPins((p) => !p)}
                    className="min-h-[34px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
                  >
                    {showPins ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showPins ? 'Sembunyikan' : 'Tampilkan'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1">
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
                      className="w-full min-h-[42px] rounded-2xl border border-[#D9D4C5] bg-[#FFFDF8] px-3.5 text-sm font-mono tracking-widest text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1">
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
                      className="w-full min-h-[42px] rounded-2xl border border-[#D9D4C5] bg-[#FFFDF8] px-3.5 text-sm font-mono tracking-widest text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#1B271B] mb-1">
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
                      className="w-full min-h-[42px] rounded-2xl border border-[#D9D4C5] bg-[#FFFDF8] px-3.5 text-sm font-mono tracking-widest text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingPin || oldPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6}
                    className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
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
                <div className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-5 flex items-start gap-3">
                  <Lock className="w-4 h-4 text-[#6E786D] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1B271B]">
                      Log Aktivitas &amp; Audit Sistem — Terkunci (Atur oleh Bendahara)
                    </p>
                    <p className="text-xs text-[#4A554A] mt-1 leading-relaxed">
                      Anda tetap dapat mengganti PIN akun pribadi di atas. Akses ke modul{' '}
                      <span className="font-mono font-semibold">settings.reports_audit</span>{' '}
                      diatur melalui delegasi Bendahara.
                    </p>
                  </div>
                </div>
              ) : (
              <div className="glass-card rounded-3xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
                      <History className="w-4 h-4 text-[#2B3F29]" />
                      <span>Log Aktivitas &amp; Audit Sistem</span>
                      {auditLogs.length > 0 && (
                        <span className="text-[11px] font-mono font-semibold text-[#243825] bg-[#E5EEE3] border border-[#C6D2BF] px-2 py-0.5 rounded-full tabular-nums">
                          {auditLogs.length}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-[#6E786D] mt-0.5">
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
                        className="min-h-[36px] px-3.5 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-xs font-semibold text-[#7A311E] inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
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
                      className="min-h-[36px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Icon3D name="refresh" className={`w-4 h-4 rounded-sm ${loadingLogs ? 'animate-spin' : ''}`} />
                      <span>Muat Ulang</span>
                    </button>
                  </div>
                </div>

                {confirmClearAudit && (
                  <div className="px-5 py-3 bg-[#C87058]/10 border-b border-[#E2A898] flex flex-wrap items-center justify-between gap-2.5 text-xs">
                    <p className="font-semibold text-[#7A311E]">
                      Hapus seluruh {auditLogs.length} catatan log aktivitas sistem secara permanen?
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={clearingAllAudit}
                        onClick={() => setConfirmClearAudit(false)}
                        className="px-3 py-1.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-[#4A554A] font-semibold hover:bg-[#F6F3EA] cursor-pointer"
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
                        className="px-3.5 py-1.5 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
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

                <div className="max-h-96 overflow-y-auto divide-y divide-[#E6E2D6]">
                  {loadingLogs ? (
                    <div className="p-8 text-center text-xs text-[#6E786D]">
                      Memuat log aktivitas sistem...
                    </div>
                  ) : auditLogs.length === 0 ? (
                    <div className="p-8 text-center text-xs text-[#6E786D]">
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
                        <div key={log.id} className="px-5 py-3 text-xs flex items-start gap-3 hover:bg-[#F6F3EA]/70 transition-colors">
                          <UserAvatar
                            name={log.actor_name}
                            src={actorAvatar}
                            size="xs"
                            className="mt-0.5 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-[#1B271B]">
                                {log.actor_name}{' '}
                                <span className="font-mono font-normal text-[#6E786D]">
                                  ({log.actor_id})
                                </span>
                              </span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono text-[11px] text-[#6E786D]">
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
                                      className="px-2 py-0.5 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                                    >
                                      {isDeletingThis && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                                      <span>Hapus</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDeletingThis}
                                      onClick={() => setConfirmDeleteAuditId(null)}
                                      className="px-2 py-0.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-[#4A554A] text-[10px] font-semibold hover:bg-[#F6F3EA] cursor-pointer"
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
                                    className="p-1 rounded-lg text-[#6E786D] hover:text-[#7A311E] hover:bg-[#C87058]/10 transition-colors cursor-pointer disabled:opacity-40"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <p className="text-[#4A554A] mt-0.5 leading-relaxed">{log.summary}</p>
                            <p className="text-[10px] font-mono text-[#384E35] mt-0.5">
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
            <div className="max-w-xl mx-auto rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6] text-[#6E786D] flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#1B271B]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-[#4A554A] leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.system_integrations</span>{' '}
                (Arsip Hybrid Google Drive &amp; Bot WA) belum didelegasikan ke akun Anda.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold cursor-pointer transition-colors"
              >
                Kembali ke Pusat Modul
              </button>
            </div>
          )}

          {activeTab === 'arsip_drive' && canAccessSystemIntegrations && (
            <AdminHybridDrivePanel
              session={session}
              canManageOverride={canAccessSystemIntegrations}
              onRefresh={onRefresh}
              onToast={onToast}
            />
          )}

          {/* TAB 6: PETUGAS KEAMANAN, TITIK CHECKPOINT NFC & PETA MAPPING (settings.security_patrol) */}
          {activeTab === 'petugas_nfc' && !canAccessSecurityPatrol && (
            <div className="max-w-xl mx-auto rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-6 text-center space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6] text-[#6E786D] flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-[#1B271B]">
                Terkunci — Atur oleh Bendahara
              </h3>
              <p className="text-xs text-[#4A554A] leading-relaxed">
                Modul <span className="font-mono font-semibold">settings.security_patrol</span>{' '}
                (Petugas Keamanan, Titik Checkpoint NFC &amp; Peta Patroli) belum didelegasikan ke
                akun Anda.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('terpusat')}
                className="min-h-[40px] px-4 rounded-xl bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold cursor-pointer transition-colors"
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
