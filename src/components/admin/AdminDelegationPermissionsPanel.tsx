import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  History,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  Loader2,
} from 'lucide-react';
import {
  CENTRAL_SETTING_DEFINITIONS,
  type AuditLogEntry,
  type CentralSettingDefinition,
  type CentralSettingKey,
  type PengurusAccountInfo,
  type PermissionGrantStatus,
  type SessionUser,
  type Warga,
} from '../../types';
import {
  normalizePengurusUsername,
  type UseCentralSettingsAccessResult,
} from '../../lib/accessControl';
import { fetchAuditLogs } from '../../lib/auditLogger';
import { formatTanggalWaktu } from '../../lib/format';
import { buildAvatarKey, useAvatarMap } from '../../lib/avatarService';
import { UserAvatar } from '../UserAvatar';

type DrawerLinkedTab =
  | 'identitas'
  | 'pembayaran'
  | 'bot_wa'
  | 'arsip_drive'
  | 'petugas_nfc'
  | 'keamanan';

const SETTING_KEY_TAB_MAP: Partial<Record<CentralSettingKey, { tab: DrawerLinkedTab; label: string }>> = {
  'settings.ipl_billing': { tab: 'pembayaran', label: 'Buka Pembayaran' },
  'settings.security_patrol': { tab: 'petugas_nfc', label: 'Buka Petugas & Peta' },
  'settings.reports_audit': { tab: 'keamanan', label: 'Buka Audit Log' },
  'settings.system_integrations': { tab: 'identitas', label: 'Buka Identitas & Sistem' },
};

const SHORT_SETTING_LABELS: Record<CentralSettingKey, string> = {
  'settings.ipl_billing': 'Tarif & IPL',
  'settings.security_patrol': 'Keamanan',
  'settings.residents_blocks': 'Warga & Blok',
  'settings.chat_moderation': 'Chat',
  'settings.reports_audit': 'Laporan & Audit',
  'settings.system_integrations': 'Integrasi',
};

const DELEGATION_AUDIT_ACTIONS = new Set([
  'GRANT_PENGURUS_SETTING_PERMISSION',
  'REVOKE_PENGURUS_SETTING_PERMISSION',
  'SYNC_PENGURUS_TO_WARGA',
  'ACTIVATE_PENGURUS_EXCLUSIVE',
  'LOGIN_BLOCKED_EXCLUSIVITY',
]);

interface AdminDelegationPermissionsPanelProps {
  session: SessionUser;
  wargaList: Warga[];
  pengurusAccounts: PengurusAccountInfo[];
  accessControl: UseCentralSettingsAccessResult;
  onNavigateTab?: (tab: DrawerLinkedTab) => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminDelegationPermissionsPanel({
  session,
  wargaList,
  pengurusAccounts,
  accessControl,
  onNavigateTab,
  onRefresh,
  onToast,
}: AdminDelegationPermissionsPanelProps) {
  const avatarMap = useAvatarMap();
  const {
    isBendaharaOwner,
    canAccess,
    getPermissionStatus,
    togglePermission,
    syncAccountStatus,
    loading: loadingPermissions,
    mutatingKey,
    error: permissionsError,
    refresh: refreshPermissions,
  } = accessControl;

  const canManageResidentSync = isBendaharaOwner || canAccess('settings.residents_blocks');
  const canViewAuditLogs = isBendaharaOwner || canAccess('settings.reports_audit');

  const delegablePengurus = useMemo(
    () =>
      pengurusAccounts.filter(
        (acc) => normalizePengurusUsername(acc.username) !== 'andriansyah'
      ),
    [pengurusAccounts]
  );

  const [selectedMobileUsername, setSelectedMobileUsername] = useState<string>(
    () => delegablePengurus[0]?.username || 'erlangga'
  );

  useEffect(() => {
    if (
      delegablePengurus.length > 0 &&
      !delegablePengurus.some(
        (p) =>
          normalizePengurusUsername(p.username) ===
          normalizePengurusUsername(selectedMobileUsername)
      )
    ) {
      setSelectedMobileUsername(delegablePengurus[0].username);
    }
  }, [delegablePengurus, selectedMobileUsername]);

  const [pendingSyncTarget, setPendingSyncTarget] = useState<{
    account: PengurusAccountInfo;
    nextActivePengurus: boolean;
  } | null>(null);
  const [syncReason, setSyncReason] = useState('');

  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadDelegationAudit = useCallback(async () => {
    if (!canViewAuditLogs) {
      setAuditEntries([]);
      return;
    }
    setLoadingAudit(true);
    try {
      const logs = await fetchAuditLogs(session);
      const relevant = logs.filter(
        (entry) =>
          DELEGATION_AUDIT_ACTIONS.has(entry.action) ||
          entry.entity === 'pengurus_settings_permissions'
      );
      setAuditEntries(relevant.slice(0, 25));
    } finally {
      setLoadingAudit(false);
    }
  }, [canViewAuditLogs, session]);

  useEffect(() => {
    void loadDelegationAudit();
  }, [loadDelegationAudit]);

  const handleToggleCell = async (
    account: PengurusAccountInfo,
    settingKey: CentralSettingKey,
    currentStatus: PermissionGrantStatus
  ) => {
    if (!isBendaharaOwner) {
      onToast(
        'error',
        'Hanya Bendahara aktif (Andriansyah) yang dapat mengubah delegasi hak pengaturan.'
      );
      return;
    }
    if (account.is_active_pengurus === false) {
      onToast(
        'error',
        `${account.nama} sedang berstatus nonaktif sebagai Pengurus. Aktifkan status Pengurusnya terlebih dahulu.`
      );
      return;
    }
    const nextStatus: PermissionGrantStatus = currentStatus === 'granted' ? 'revoked' : 'granted';
    const res = await togglePermission({
      pengurusUsername: account.username,
      settingKey,
      status: nextStatus,
      notes:
        nextStatus === 'granted'
          ? `Diaktifkan oleh ${session.nama_warga} (Bendahara)`
          : `Dicabut oleh ${session.nama_warga} (Bendahara)`,
    });
    if (res.error) {
      onToast('error', res.error);
      return;
    }
    const def = CENTRAL_SETTING_DEFINITIONS.find(
      (d: CentralSettingDefinition) => d.key === settingKey
    );
    onToast(
      'success',
      `Izin "${def?.label || settingKey}" untuk ${account.nama} (${account.jabatan}) diubah menjadi ${
        nextStatus === 'granted' ? 'Diizinkan' : 'Dicabut'
      }.`
    );
    await loadDelegationAudit();
  };

  const handleConfirmSyncStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingSyncTarget) return;
    const { account, nextActivePengurus } = pendingSyncTarget;

    const res = await syncAccountStatus({
      targetIdentifier: account.username,
      isActivePengurus: nextActivePengurus,
      reason: syncReason.trim() || undefined,
      accounts: wargaList,
    });
    if (res.error || !res.data) {
      onToast('error', res.error || 'Gagal memperbarui status Pengurus.');
      return;
    }

    const result = res.data;
    setPendingSyncTarget(null);
    setSyncReason('');
    onToast(
      'success',
      nextActivePengurus
        ? `Akun Pengurus ${account.nama} (@${result.pengurusUsername}) diaktifkan eksklusif; jalur Warga Blok ${result.linkedWargaBlok || account.blokRumah} ditangguhkan.`
        : `Status Pengurus ${account.nama} dicabut; akun Warga Blok ${result.linkedWargaBlok || account.blokRumah} aktif kembali & ${result.revokedPermissionsCount} izin pengaturan dicabut.`
    );
    await Promise.all([onRefresh(), loadDelegationAudit()]);
  };

  const selectedMobilePengurus =
    delegablePengurus.find(
      (p) =>
        normalizePengurusUsername(p.username) ===
        normalizePengurusUsername(selectedMobileUsername)
    ) || delegablePengurus[0];

  return (
    <div className="space-y-6 max-w-5xl mx-auto min-w-0">
      {/* Header Status Kepemilikan Hak Pengaturan Terpusat */}
      <section className="rounded-2xl bg-[#FFFDF8] border border-[#E6E2D6] p-4 sm:p-5 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#243825] text-[#E5EEE3] flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-bold text-[#1B271B] leading-snug">
                {isBendaharaOwner
                  ? 'Pusat Delegasi Hak & Eksklusivitas Akun Pengurus'
                  : 'Status Hak Pengaturan Sistem Terpusat'}
              </h3>
              <p className="text-xs text-[#4A554A] mt-1 leading-relaxed">
                {isBendaharaOwner
                  ? 'Pemilik default penuh seluruh pengaturan sistem adalah Bendahara (Andriansyah). Atur modul yang diizinkan untuk Pengurus lain serta kelola pemulihan otomatis akun Warga/Blok saat status Pengurus dicabut.'
                  : 'Pemilik penuh Pengaturan Sistem Terpusat adalah Bendahara. Anda hanya dapat membuka dan mengubah modul yang statusnya Diizinkan oleh Bendahara.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={loadingPermissions}
            onClick={() => void refreshPermissions()}
            className="min-h-[40px] px-3.5 rounded-xl border border-[#E6E2D6] bg-[#F7F4EC] hover:bg-[#E5EEE3] text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#2B3F29] ${loadingPermissions ? 'animate-spin' : ''}`} />
            <span>Segarkan Status</span>
          </button>
        </div>

        {permissionsError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-[#C87058]/10 border border-[#E2A898] px-3.5 py-2.5 text-xs text-[#7A311E]"
          >
            <ShieldAlert className="w-4 h-4 text-[#C87058] shrink-0 mt-0.5" />
            <span>{permissionsError}</span>
          </div>
        )}
      </section>

      {/* Ringkasan 6 Modul Pengaturan Terpusat Untuk Caller */}
      <section className="space-y-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[#6E786D]">
            Ringkasan 6 Modul Pengaturan Terpusat ({session.jabatan || 'Pengurus'})
          </h4>
          <span className="text-xs font-semibold text-[#4A554A] tabular-nums">
            {accessControl.grantedKeys.length} dari {CENTRAL_SETTING_DEFINITIONS.length} modul terbuka
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {CENTRAL_SETTING_DEFINITIONS.map((def: CentralSettingDefinition) => {
            const granted = canAccess(def.key);
            const linkedTab = SETTING_KEY_TAB_MAP[def.key];

            return (
              <div
                key={def.key}
                className={`rounded-2xl border p-4 flex flex-col justify-between gap-3 ${
                  granted
                    ? 'border-[#C6D2BF] bg-[#FFFDF8] shadow-2xs'
                    : 'border-[#E6E2D6] bg-[#F7F4EC]/75'
                }`}
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-[#1B271B] leading-snug">{def.label}</p>
                    {granted ? (
                      <CheckCircle2 className="w-4 h-4 text-[#2B3F29] shrink-0 mt-0.5" />
                    ) : (
                      <Lock className="w-4 h-4 text-[#6E786D] shrink-0 mt-0.5" />
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-[#6E786D] truncate">{def.key}</p>
                  <p className="text-xs text-[#4A554A] leading-relaxed">{def.description}</p>
                </div>

                <div className="pt-2.5 border-t border-[#E6E2D6] flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      granted ? 'text-[#243825]' : 'text-[#6E786D]'
                    }`}
                  >
                    {isBendaharaOwner
                      ? 'Penuh (Bendahara)'
                      : granted
                        ? 'Diizinkan'
                        : 'Terkunci — Atur oleh Bendahara'}
                  </span>

                  {granted && linkedTab && onNavigateTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateTab(linkedTab.tab)}
                      className="min-h-[36px] px-2.5 rounded-lg text-xs font-semibold text-[#2B3F29] hover:bg-[#E5EEE3] inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap transition-colors"
                    >
                      <span>{linkedTab.label}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Matriks Delegasi Hak Pengaturan (Khusus Bendahara) */}
      <section className="rounded-2xl bg-[#FFFDF8] border border-[#E6E2D6] overflow-hidden min-w-0 shadow-xs">
        <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/50 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2B3F29] shrink-0" />
              <span>Matriks Delegasi Hak Pengaturan Pengurus</span>
            </h4>
            <p className="text-xs text-[#6E786D] mt-0.5">
              {isBendaharaOwner
                ? 'Aktifkan atau cabut izin modul per pengurus secara langsung (tersimpan ke pengurus_settings_permissions & audit_logs).'
                : 'Hanya Bendahara (Andriansyah) yang dapat mengubah status delegasi hak pengaturan.'}
            </p>
          </div>
          {!isBendaharaOwner && (
            <span className="text-xs font-semibold text-[#6E786D] inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Khusus Bendahara</span>
            </span>
          )}
        </div>

        {!isBendaharaOwner ? (
          <div className="p-4 sm:p-5 text-xs text-[#4A554A] flex items-start gap-2.5 bg-[#F7F4EC]/70">
            <Lock className="w-4 h-4 text-[#6E786D] shrink-0 mt-0.5" />
            <span>
              Panel pengendali delegasi dikunci karena Anda bukan Bendahara aktif. Hubungi{' '}
              <strong>Andriansyah (Bendahara)</strong> bila memerlukan akses sementara pada modul
              tertentu.
            </span>
          </div>
        ) : (
          <>
            {/* Tampilan Mobile & Tablet (< lg): Pemilih Pengurus + Daftar Switch Vertikal Bebas Overflow */}
            <div className="lg:hidden p-4 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="delegation-pengurus-select"
                  className="block text-xs font-semibold text-[#1B271B]"
                >
                  Pilih Pengurus untuk Diatur Izinnya
                </label>
                <select
                  id="delegation-pengurus-select"
                  value={selectedMobilePengurus?.username || ''}
                  onChange={(e) => setSelectedMobileUsername(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-[#C6D2BF] bg-[#FFFFFF] px-3 text-sm font-semibold text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                >
                  {delegablePengurus.map((acc) => (
                    <option key={acc.username} value={acc.username}>
                      {acc.nama} — {acc.jabatan} (@{acc.username})
                      {acc.is_active_pengurus === false ? ' [Nonaktif]' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selectedMobilePengurus && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E6E2D6]">
                    <div className="flex items-center gap-3 min-w-0">
                      <UserAvatar
                        name={selectedMobilePengurus.nama}
                        src={
                          selectedMobilePengurus.avatar_url ||
                          avatarMap[buildAvatarKey('admin', selectedMobilePengurus.username)] ||
                          null
                        }
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#1B271B] truncate">
                          {selectedMobilePengurus.nama}
                        </p>
                        <p className="text-xs text-[#6E786D] truncate">
                          {selectedMobilePengurus.jabatan} · Blok {selectedMobilePengurus.blokRumah} ·{' '}
                          <span className="font-mono">@{selectedMobilePengurus.username}</span>
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold shrink-0 px-2.5 py-0.5 rounded-full border ${
                        selectedMobilePengurus.is_active_pengurus === false
                          ? 'bg-[#F2D8A7]/45 border-[#E2C285] text-[#4A3410]'
                          : 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]'
                      }`}
                    >
                      {selectedMobilePengurus.is_active_pengurus === false ? 'Nonaktif' : 'Aktif'}
                    </span>
                  </div>

                  {selectedMobilePengurus.is_active_pengurus === false && (
                    <div className="rounded-xl bg-[#F2D8A7]/45 border border-[#E2C285] px-3.5 py-2.5 text-xs text-[#4A3410]">
                      Status Pengurus {selectedMobilePengurus.nama} sedang dinonaktifkan sehingga
                      seluruh izin pengaturan terpusat otomatis dicabut.
                    </div>
                  )}

                  <div className="divide-y divide-[#E6E2D6] border border-[#E6E2D6] rounded-xl overflow-hidden">
                    {CENTRAL_SETTING_DEFINITIONS.map((def: CentralSettingDefinition) => {
                      const status = getPermissionStatus(selectedMobilePengurus.username, def.key);
                      const isGranted = status === 'granted';
                      const cellKey = `perm:${normalizePengurusUsername(selectedMobilePengurus.username)}:${def.key}`;
                      const isBusy = mutatingKey === cellKey;
                      const disabled =
                        selectedMobilePengurus.is_active_pengurus === false || isBusy;

                      return (
                        <div
                          key={def.key}
                          className="p-3.5 flex items-center justify-between gap-3 bg-[#FFFDF8]"
                        >
                          <div className="min-w-0">
                            <p className="text-xs sm:text-sm font-semibold text-[#1B271B]">
                              {def.label}
                            </p>
                            <p className="text-[11px] font-mono text-[#6E786D] truncate mt-0.5">
                              {def.key}
                            </p>
                            <p className="text-[11px] text-[#4A554A] mt-0.5 leading-snug">
                              {def.description}
                            </p>
                          </div>

                          <button
                            type="button"
                            role="switch"
                            aria-checked={isGranted}
                            aria-label={`Ubah izin ${def.label} untuk ${selectedMobilePengurus.nama}`}
                            disabled={disabled}
                            onClick={() =>
                              void handleToggleCell(selectedMobilePengurus, def.key, status)
                            }
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 ${
                              isGranted ? 'bg-[#2B3F29]' : 'bg-[#C6D2BF]'
                            } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-white mx-auto" />
                            ) : (
                              <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform shadow-xs ${
                                  isGranted ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Tampilan Desktop (>= lg): Tabel Matriks Lengkap */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F6F3EA] border-b border-[#E6E2D6] text-[11px] font-bold uppercase tracking-wider text-[#6E786D]">
                    <th className="py-3 px-4 min-w-[210px]">Pengurus</th>
                    {CENTRAL_SETTING_DEFINITIONS.map((def: CentralSettingDefinition) => (
                      <th key={def.key} className="py-3 px-2.5 text-center">
                        <span className="block text-[#1B271B]">{SHORT_SETTING_LABELS[def.key]}</span>
                        <span className="block font-mono font-normal text-[10px] text-[#6E786D] normal-case mt-0.5">
                          {def.key.replace('settings.', '')}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E6E2D6] text-xs">
                  {delegablePengurus.map((acc) => {
                    const accAvatar =
                      acc.avatar_url || avatarMap[buildAvatarKey('admin', acc.username)] || null;
                    const isInactive = acc.is_active_pengurus === false;
                    return (
                      <tr key={acc.username} className="hover:bg-[#F7F4EC]/70 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <UserAvatar name={acc.nama} src={accAvatar} size="xs" />
                            <div className="min-w-0">
                              <p className="font-bold text-[#1B271B] truncate">{acc.nama}</p>
                              <p className="text-[11px] text-[#6E786D] truncate">
                                {acc.jabatan} · <span className="font-mono">@{acc.username}</span>
                                {isInactive ? ' · Nonaktif' : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        {CENTRAL_SETTING_DEFINITIONS.map((def: CentralSettingDefinition) => {
                          const status = getPermissionStatus(acc.username, def.key);
                          const isGranted = status === 'granted';
                          const cellKey = `perm:${normalizePengurusUsername(acc.username)}:${def.key}`;
                          const isBusy = mutatingKey === cellKey;
                          const disabled = isInactive || isBusy;

                          return (
                            <td key={def.key} className="py-3 px-2.5 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={isGranted}
                                  aria-label={`Ubah izin ${def.label} untuk ${acc.nama}`}
                                  disabled={disabled}
                                  onClick={() => void handleToggleCell(acc, def.key, status)}
                                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                    isGranted ? 'bg-[#2B3F29]' : 'bg-[#C6D2BF]'
                                  } ${disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                  {isBusy ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-white mx-auto" />
                                  ) : (
                                    <span
                                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-2xs ${
                                        isGranted ? 'translate-x-6' : 'translate-x-1'
                                      }`}
                                    />
                                  )}
                                </button>
                                <span
                                  className={`text-[10px] font-semibold ${
                                    isInactive
                                      ? 'text-[#6E786D]'
                                      : isGranted
                                        ? 'text-[#243825]'
                                        : 'text-[#6E786D]'
                                  }`}
                                >
                                  {isInactive ? 'Dicabut' : isGranted ? 'Diizinkan' : 'Terkunci'}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Panel Eksklusivitas Akun Pengurus <-> Pemulihan Otomatis Akun Warga/Blok */}
      <section className="rounded-2xl bg-[#FFFDF8] border border-[#E6E2D6] overflow-hidden min-w-0 shadow-xs">
        <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/50 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#2B3F29] shrink-0" />
              <span>Eksklusivitas Akun Pengurus &amp; Pemulihan Otomatis Akun Warga</span>
            </h4>
            <p className="text-xs text-[#6E786D] mt-0.5">
              Pengurus aktif diblokir dari jalur login Warga/Blok. Bila status Pengurus dicabut,
              akun Warga/Blok miliknya otomatis dipulihkan dan seluruh hak Pengurus langsung dicabut.
            </p>
          </div>
          {!canManageResidentSync && (
            <span className="text-xs font-semibold text-[#6E786D] inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Butuh izin settings.residents_blocks</span>
            </span>
          )}
        </div>

        {pendingSyncTarget && (
          <form
            onSubmit={handleConfirmSyncStatus}
            className="p-4 sm:p-5 bg-[#F2D8A7]/35 border-b border-[#E2C285] space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-[#8A5F16] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-bold text-[#4A3410]">
                  {pendingSyncTarget.nextActivePengurus
                    ? `Aktifkan kembali ${pendingSyncTarget.account.nama} (@${pendingSyncTarget.account.username}) sebagai Pengurus eksklusif?`
                    : `Nonaktifkan status Pengurus ${pendingSyncTarget.account.nama} (@${pendingSyncTarget.account.username}) & pulihkan akun Warga Blok ${pendingSyncTarget.account.blokRumah}?`}
                </p>
                <p className="text-xs text-[#4A3410] mt-0.5 leading-relaxed">
                  {pendingSyncTarget.nextActivePengurus
                    ? `Akun Warga Blok ${pendingSyncTarget.account.blokRumah} akan ditangguhkan sehingga tidak bisa masuk lewat Portal Warga.`
                    : `Akun Warga Blok ${pendingSyncTarget.account.blokRumah} akan langsung berstatus aktif kembali dan seluruh izin pengaturan Pengurus akan otomatis dicabut.`}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={syncReason}
                onChange={(e) => setSyncReason(e.target.value)}
                placeholder="Catatan alasan perubahan (opsional, tercatat di audit log)"
                className="flex-1 min-h-[42px] rounded-xl border border-[#E2C285] bg-[#FFFFFF] px-3 text-xs text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
              />
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setPendingSyncTarget(null);
                    setSyncReason('');
                  }}
                  className="min-h-[42px] px-3.5 rounded-xl border border-[#E6E2D6] bg-[#FFFFFF] hover:bg-[#F7F4EC] text-xs font-semibold text-[#1B271B] cursor-pointer transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={Boolean(mutatingKey)}
                  className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors ${
                    pendingSyncTarget.nextActivePengurus
                      ? 'bg-[#2B3F29] hover:bg-[#243825]'
                      : 'bg-[#C87058] hover:bg-[#B25C45]'
                  }`}
                >
                  {mutatingKey?.startsWith('sync:') && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>
                    {pendingSyncTarget.nextActivePengurus
                      ? 'Ya, Aktifkan Pengurus'
                      : 'Ya, Pulihkan ke Warga'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="divide-y divide-[#E6E2D6]">
          {pengurusAccounts.map((acc) => {
            const normUser = normalizePengurusUsername(acc.username);
            const isTargetBendahara =
              acc.jabatan === 'Bendahara' || normUser === 'andriansyah';
            const isActivePengurus = acc.is_active_pengurus !== false;
            const accAvatar =
              acc.avatar_url || avatarMap[buildAvatarKey('admin', acc.username)] || null;
            const isSyncingThis = mutatingKey === `sync:${normUser}`;

            return (
              <div
                key={acc.username}
                className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start sm:items-center gap-3 min-w-0">
                  <UserAvatar name={acc.nama} src={accAvatar} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1B271B] truncate">
                      {acc.nama} · <span className="font-semibold text-[#4A554A]">{acc.jabatan}</span>
                    </p>
                    <p className="text-xs text-[#6E786D] mt-0.5 break-words">
                      <span className="font-mono">@{acc.username}</span> · Blok{' '}
                      <span className="font-mono font-semibold text-[#1B271B]">{acc.blokRumah}</span>{' '}
                      ·{' '}
                      <span
                        className={`font-semibold ${
                          isActivePengurus ? 'text-[#243825]' : 'text-[#8A5F16]'
                        }`}
                      >
                        {isActivePengurus
                          ? 'Pengurus Aktif (Blok Warga Ditangguhkan)'
                          : 'Pengurus Nonaktif (Akun Warga Aktif)'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end shrink-0">
                  {isTargetBendahara ? (
                    <span className="text-xs font-semibold text-[#6E786D]">
                      Bendahara Utama (Wajib Aktif)
                    </span>
                  ) : !canManageResidentSync ? (
                    <span className="text-xs text-[#6E786D] inline-flex items-center gap-1">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Terkunci — Atur oleh Bendahara</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={isSyncingThis}
                      onClick={() => {
                        setSyncReason('');
                        setPendingSyncTarget({
                          account: acc,
                          nextActivePengurus: !isActivePengurus,
                        });
                      }}
                      className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60 whitespace-nowrap ${
                        isActivePengurus
                          ? 'border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#7A311E]'
                          : 'border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] text-[#243825]'
                      }`}
                    >
                      {isSyncingThis ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isActivePengurus ? (
                        <UserX className="w-3.5 h-3.5" />
                      ) : (
                        <UserCheck className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isActivePengurus
                          ? 'Cabut Pengurus & Pulihkan Warga'
                          : 'Aktifkan Pengurus Eksklusif'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Riwayat Audit Delegasi & Status Pengurus */}
      <section className="rounded-2xl bg-[#FFFDF8] border border-[#E6E2D6] overflow-hidden min-w-0 shadow-xs">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/50 flex items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
              <History className="w-4 h-4 text-[#2B3F29] shrink-0" />
              <span>Riwayat Audit Delegasi &amp; Status Pengurus</span>
            </h4>
            <p className="text-xs text-[#6E786D] mt-0.5">
              Rekam jejak perubahan hak oleh Bendahara, sinkronisasi status Pengurus/Warga, dan
              blokir login eksklusif.
            </p>
          </div>
          {canViewAuditLogs && (
            <button
              type="button"
              disabled={loadingAudit}
              onClick={() => void loadDelegationAudit()}
              className="min-h-[36px] px-3 rounded-xl border border-[#E6E2D6] bg-[#FFFFFF] hover:bg-[#E5EEE3] text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#2B3F29] ${loadingAudit ? 'animate-spin' : ''}`} />
              <span>Muat Ulang</span>
            </button>
          )}
        </div>

        {!canViewAuditLogs ? (
          <div className="p-4 sm:p-5 text-xs text-[#6E786D] flex items-center gap-2">
            <Lock className="w-4 h-4 text-[#6E786D] shrink-0" />
            <span>Terkunci — Atur oleh Bendahara (butuh izin settings.reports_audit).</span>
          </div>
        ) : loadingAudit ? (
          <div className="p-6 text-center text-xs text-[#6E786D]">
            Memuat riwayat audit delegasi...
          </div>
        ) : auditEntries.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#6E786D]">
            Belum ada catatan perubahan delegasi izin atau status Pengurus.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-[#E6E2D6]">
            {auditEntries.map((log) => (
              <div key={log.id} className="px-4 sm:px-5 py-3 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#1B271B]">
                    {log.actor_name}{' '}
                    <span className="font-mono font-normal text-[#6E786D]">({log.actor_id})</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#6E786D] tabular-nums">
                    {formatTanggalWaktu(log.timestamp)}
                  </span>
                </div>
                <p className="text-[#4A554A] leading-relaxed">{log.summary}</p>
                <p className="text-[11px] font-mono text-[#384E35]">
                  {log.action} · {log.entity}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
