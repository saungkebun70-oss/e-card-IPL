import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Check,
  CreditCard,
  HardDrive,
  History,
  Home,
  Loader2,
  Lock,
  MessageSquare,
  Radio,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Unlock,
  UserCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import {
  CENTRAL_SETTING_MODULES,
  SUSUNAN_PENGURUS,
  isBendaharaOnly,
  type AuditLogEntry,
  type CentralSettingModuleKey,
  type ChatModerationPolicy,
  type PengurusAccountInfo,
  type PengurusSettingPermissionRecord,
  type PengurusWargaSyncStatus,
  type SessionUser,
  type SettingPermissionStatus,
  type Warga,
} from '../../types';
import {
  fetchAllPengurusSettingPermissions,
  fetchPengurusWargaSyncList,
  getChatModerationPolicy,
  saveChatModerationPolicy,
  setPengurusSettingPermission,
  syncPengurusToWargaStatus,
} from '../../lib/centralSettingsService';
import { fetchAuditLogs } from '../../lib/auditLogger';
import { formatTanggalWaktu } from '../../lib/format';
import { buildAvatarKey, useAvatarMap } from '../../lib/avatarService';
import { UserAvatar } from '../UserAvatar';

export type CentralNavigateTab =
  | 'profil'
  | 'terpusat'
  | 'identitas'
  | 'pembayaran'
  | 'bot_wa'
  | 'arsip_drive'
  | 'petugas_nfc'
  | 'keamanan';

interface AdminCentralSettingsPanelProps {
  session: SessionUser;
  pengurusAccounts: PengurusAccountInfo[];
  wargaList: Warga[];
  myPermissions: Record<CentralSettingModuleKey, SettingPermissionStatus>;
  onPermissionsChanged: () => Promise<void>;
  onNavigateTab: (tab: CentralNavigateTab) => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type CentralSubView = 'modules' | 'delegation' | 'sync_audit';

const MODULE_ICONS: Record<CentralSettingModuleKey, React.ComponentType<{ className?: string }>> = {
  'settings.ipl_billing': CreditCard,
  'settings.security_patrol': Radio,
  'settings.residents_blocks': Sparkles,
  'settings.chat_moderation': MessageSquare,
  'settings.reports_audit': History,
  'settings.system_integrations': Bot,
};

const AUDIT_DELEGATION_ACTIONS = new Set([
  'GRANT_SETTING_PERMISSION',
  'REVOKE_SETTING_PERMISSION',
  'SYNC_PENGURUS_TO_WARGA_STATUS',
  'LOGIN_BLOCKED_ACTIVE_PENGURUS',
  'LOGIN_BLOCKED_PENGURUS_REVOKED',
  'UPDATE_CHAT_MODERATION_POLICY',
]);

export function AdminCentralSettingsPanel({
  session,
  pengurusAccounts,
  wargaList,
  myPermissions,
  onPermissionsChanged,
  onNavigateTab,
  onRefresh,
  onToast,
}: AdminCentralSettingsPanelProps) {
  const isBendahara = isBendaharaOnly(session);
  const avatarMap = useAvatarMap();

  const [subView, setSubView] = useState<CentralSubView>('modules');
  const [allPermMap, setAllPermMap] = useState<
    Record<string, Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>>
  >({});
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [savingPermKey, setSavingPermKey] = useState<string | null>(null);
  const [batchSavingUser, setBatchSavingUser] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Status Pengurus <-> Warga Sync
  const [syncList, setSyncList] = useState<PengurusWargaSyncStatus[]>([]);
  const [loadingSync, setLoadingSync] = useState(false);
  const [confirmSyncTarget, setConfirmSyncTarget] = useState<{
    username: string;
    nextActivePengurus: boolean;
  } | null>(null);
  const [syncReason, setSyncReason] = useState('');
  const [submittingSyncUser, setSubmittingSyncUser] = useState<string | null>(null);

  // Audit logs
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [auditFilter, setAuditFilter] = useState<'delegation' | 'all'>('delegation');

  // Inline Chat Moderation Policy (settings.chat_moderation)
  const [chatModExpanded, setChatModExpanded] = useState(false);
  const [chatPolicy, setChatPolicy] = useState<ChatModerationPolicy>(() => getChatModerationPolicy());
  const [savingChatPolicy, setSavingChatPolicy] = useState(false);

  const nonBendaharaPengurus = useMemo(
    () =>
      SUSUNAN_PENGURUS.filter(
        (p) => p.permission !== 'full' && p.jabatan !== 'Bendahara'
      ),
    []
  );

  const filteredPengurus = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return nonBendaharaPengurus;
    return nonBendaharaPengurus.filter(
      (p) =>
        p.nama.toLowerCase().includes(q) ||
        p.jabatan.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        p.blokRumah.toLowerCase().includes(q)
    );
  }, [nonBendaharaPengurus, searchQuery]);

  const loadBendaharaData = useCallback(async () => {
    if (!isBendahara) return;
    setLoadingPerms(true);
    setLoadingSync(true);
    setLoadingLogs(true);
    try {
      const [perms, syncRows, logs] = await Promise.all([
        fetchAllPengurusSettingPermissions(session),
        fetchPengurusWargaSyncList(session, pengurusAccounts, wargaList),
        fetchAuditLogs(session),
      ]);
      setAllPermMap(perms);
      setSyncList(syncRows);
      setAuditLogs(logs);
    } finally {
      setLoadingPerms(false);
      setLoadingSync(false);
      setLoadingLogs(false);
    }
  }, [isBendahara, session, pengurusAccounts, wargaList]);

  useEffect(() => {
    if (isBendahara) {
      void loadBendaharaData();
    }
  }, [isBendahara, loadBendaharaData]);

  const myGrantedCount = useMemo(() => {
    if (isBendahara) return CENTRAL_SETTING_MODULES.length;
    return CENTRAL_SETTING_MODULES.filter((m) => myPermissions[m.key] === 'granted').length;
  }, [isBendahara, myPermissions]);

  const handleTogglePermission = async (
    pengurusUsername: string,
    moduleKey: CentralSettingModuleKey,
    currentStatus: SettingPermissionStatus
  ) => {
    const nextStatus: SettingPermissionStatus = currentStatus === 'granted' ? 'revoked' : 'granted';
    const busyKey = `${pengurusUsername}:${moduleKey}`;
    setSavingPermKey(busyKey);
    try {
      const res = await setPengurusSettingPermission(session, {
        pengurusUsername,
        moduleKey,
        status: nextStatus,
      });
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal memperbarui delegasi hak pengaturan.');
        return;
      }

      setAllPermMap((prev) => ({
        ...prev,
        [pengurusUsername]: {
          ...(prev[pengurusUsername] || {}),
          [moduleKey]: res.data!,
        } as Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>,
      }));

      const modLabel =
        CENTRAL_SETTING_MODULES.find((m) => m.key === moduleKey)?.shortLabel || moduleKey;
      const targetName =
        SUSUNAN_PENGURUS.find((p) => p.username === pengurusUsername)?.nama || pengurusUsername;
      onToast(
        'success',
        nextStatus === 'granted'
          ? `Akses "${modLabel}" diberikan ke ${targetName}.`
          : `Akses "${modLabel}" dicabut dari ${targetName}.`
      );
      await onPermissionsChanged();
      const latestLogs = await fetchAuditLogs(session);
      setAuditLogs(latestLogs);
    } finally {
      setSavingPermKey(null);
    }
  };

  const handleBatchPermission = async (
    pengurusUsername: string,
    targetStatus: SettingPermissionStatus
  ) => {
    setBatchSavingUser(pengurusUsername);
    try {
      let failedMsg: string | null = null;
      const updatedUserMap = { ...(allPermMap[pengurusUsername] || {}) } as Record<
        CentralSettingModuleKey,
        PengurusSettingPermissionRecord
      >;

      for (const mod of CENTRAL_SETTING_MODULES) {
        const cur = updatedUserMap[mod.key]?.status || 'revoked';
        if (cur === targetStatus) continue;
        const res = await setPengurusSettingPermission(session, {
          pengurusUsername,
          moduleKey: mod.key,
          status: targetStatus,
        });
        if (res.error || !res.data) {
          failedMsg = res.error || 'Sebagian delegasi gagal diperbarui.';
          break;
        }
        updatedUserMap[mod.key] = res.data;
      }

      setAllPermMap((prev) => ({ ...prev, [pengurusUsername]: updatedUserMap }));
      if (failedMsg) {
        onToast('error', failedMsg);
      } else {
        const targetName =
          SUSUNAN_PENGURUS.find((p) => p.username === pengurusUsername)?.nama || pengurusUsername;
        onToast(
          'success',
          targetStatus === 'granted'
            ? `Seluruh 6 modul pengaturan diberikan ke ${targetName}.`
            : `Seluruh delegasi modul pengaturan dicabut dari ${targetName}.`
        );
      }
      await onPermissionsChanged();
      const latestLogs = await fetchAuditLogs(session);
      setAuditLogs(latestLogs);
    } finally {
      setBatchSavingUser(null);
    }
  };

  const handleConfirmSyncStatus = async (item: PengurusWargaSyncStatus, nextActivePengurus: boolean) => {
    setSubmittingSyncUser(item.pengurus_username);
    try {
      const res = await syncPengurusToWargaStatus(session, {
        pengurusUsername: item.pengurus_username,
        linkedBlokRumah: item.linked_blok_rumah,
        isActivePengurus: nextActivePengurus,
        reason: syncReason.trim() || undefined,
      });
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal menyinkronkan status Pengurus ↔ Warga.');
        return;
      }

      setSyncList((prev) =>
        prev.map((row) =>
          row.pengurus_username === item.pengurus_username ? res.data! : row
        )
      );
      setConfirmSyncTarget(null);
      setSyncReason('');
      onToast(
        'success',
        nextActivePengurus
          ? `Akun Pengurus ${item.pengurus_nama} diaktifkan kembali (eksklusif Portal Pengurus).`
          : `Hak Pengurus ${item.pengurus_nama} dinonaktifkan. Akun Warga Blok ${item.linked_blok_rumah} otomatis aktif kembali.`
      );
      await onRefresh();
      const latestLogs = await fetchAuditLogs(session);
      setAuditLogs(latestLogs);
    } finally {
      setSubmittingSyncUser(null);
    }
  };

  const handleSaveChatModeration = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingChatPolicy(true);
    try {
      const res = await saveChatModerationPolicy(session, chatPolicy, myPermissions);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal menyimpan kebijakan moderasi chat.');
        return;
      }
      setChatPolicy(res.data);
      onToast('success', 'Kebijakan moderasi chat lingkungan berhasil diperbarui.');
      if (isBendahara) {
        const latestLogs = await fetchAuditLogs(session);
        setAuditLogs(latestLogs);
      }
    } finally {
      setSavingChatPolicy(false);
    }
  };

  const visibleAuditLogs = useMemo(() => {
    if (auditFilter === 'all') return auditLogs.slice(0, 60);
    return auditLogs
      .filter(
        (log) =>
          AUDIT_DELEGATION_ACTIONS.has(log.action) ||
          log.entity === 'pengurus_setting_permissions' ||
          log.summary.toLowerCase().includes('delegasi') ||
          log.summary.toLowerCase().includes('pengurus')
      )
      .slice(0, 60);
  }, [auditLogs, auditFilter]);

  return (
    <div className="space-y-5 max-w-4xl mx-auto min-w-0">
      {/* Header Status Kepemilikan Pengaturan Terpusat */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#4A583E]">
              {isBendahara
                ? 'Otoritas Penuh Bendahara · Pemilik Pengaturan Terpusat'
                : `${session.jabatan || 'Pengurus'} · Akses Pengaturan Terdelegasi`}
            </p>
            <h3 className="text-base sm:text-lg font-bold text-[#0F172A] tracking-tight mt-0.5">
              Pusat Pengaturan &amp; Delegasi Hak Pengurus
            </h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              {isBendahara
                ? 'Kelola seluruh 6 modul pengaturan sistem, delegasikan hak modul ke Pengurus lain, serta sinkronkan pemulihan otomatis akun Warga.'
                : 'Hanya modul yang diberi status Diizinkan (granted) oleh Bendahara yang dapat diakses dan diubah pada sesi Anda.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-right">
              <p className="text-[11px] font-medium text-slate-500">Modul Aktif</p>
              <p className="text-sm font-bold font-mono tabular-nums text-[#0F172A]">
                {myGrantedCount} / {CENTRAL_SETTING_MODULES.length}
              </p>
            </div>
            {isBendahara && (
              <button
                type="button"
                onClick={() => void loadBendaharaData()}
                disabled={loadingPerms || loadingSync}
                className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loadingPerms || loadingSync ? 'animate-spin' : ''}`}
                />
                <span className="whitespace-nowrap">Sinkronkan</span>
              </button>
            )}
          </div>
        </div>

        {/* Sub-navigasi Segmented (Khusus Bendahara menampilkan 3 panel; Pengurus lain fokus pada 6 Modul) */}
        {isBendahara && (
          <div
            role="tablist"
            aria-label="Sub-panel Pengaturan Terpusat"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar p-1 rounded-xl bg-slate-100 border border-slate-200/70"
          >
            {(
              [
                { id: 'modules', label: '6 Modul Sistem', icon: SlidersHorizontal },
                { id: 'delegation', label: 'Delegasi Hak Pengurus', icon: Users },
                { id: 'sync_audit', label: 'Status Pengurus ↔ Warga & Audit', icon: ShieldCheck },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const active = subView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSubView(item.id)}
                  className={`min-h-[40px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                    active
                      ? 'bg-[#4C1D95] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#0F172A] hover:bg-white/70'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-emerald-300' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* SUB-VIEW 1: 6 MODUL PENGATURAN TERPUSAT                           */}
      {/* ================================================================= */}
      {subView === 'modules' && (
        <section aria-label="Daftar 6 Modul Pengaturan Terpusat" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {CENTRAL_SETTING_MODULES.map((mod) => {
              const Icon = MODULE_ICONS[mod.key];
              const isGranted = isBendahara || myPermissions[mod.key] === 'granted';
              const isChatMod = mod.key === 'settings.chat_moderation';
              const isIntegrations = mod.key === 'settings.system_integrations';

              return (
                <article
                  key={mod.key}
                  className={`rounded-2xl border p-4 flex flex-col justify-between gap-3.5 transition-colors ${
                    isGranted
                      ? 'border-slate-200/90 bg-white'
                      : 'border-slate-200/70 bg-slate-50/85'
                  }`}
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isGranted
                              ? 'bg-indigo-50 text-[#4C1D95] border border-indigo-100'
                              : 'bg-slate-200/70 text-slate-500 border border-slate-200'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-[#0F172A] leading-snug">
                            {mod.label}
                          </h4>
                          <p className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                            {mod.key}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 ${
                          isGranted ? 'text-emerald-700' : 'text-slate-500'
                        }`}
                      >
                        {isGranted ? (
                          <>
                            <Unlock className="w-3.5 h-3.5" />
                            <span>{isBendahara ? 'Penuh' : 'Diizinkan'}</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-3.5 h-3.5" />
                            <span>Terkunci</span>
                          </>
                        )}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">{mod.description}</p>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      {isGranted
                        ? `${mod.scopeNote} · ${
                            isBendahara ? 'Otoritas Bendahara' : 'Delegasi Bendahara'
                          }`
                        : 'Terkunci — Atur oleh Bendahara'}
                    </span>

                    {isGranted ? (
                      isChatMod ? (
                        <button
                          type="button"
                          onClick={() => setChatModExpanded((prev) => !prev)}
                          className="min-h-[38px] px-3.5 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <span>{chatModExpanded ? 'Tutup Kebijakan' : 'Atur Moderasi'}</span>
                        </button>
                      ) : isIntegrations ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onNavigateTab('bot_wa')}
                            className="min-h-[38px] px-3 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Bot className="w-3.5 h-3.5" />
                            <span>Bot WA</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigateTab('arsip_drive')}
                            className="min-h-[38px] px-3 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-[#4C1D95] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <HardDrive className="w-3.5 h-3.5" />
                            <span>Arsip Drive</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onNavigateTab(mod.drawerTab)}
                          className="min-h-[38px] px-3.5 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <span>Buka Modul</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      )
                    ) : (
                      <span className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-slate-100 text-slate-500 text-[11px] font-semibold inline-flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Terkunci</span>
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Panel Kebijakan Moderasi Chat (settings.chat_moderation) */}
          {chatModExpanded && (isBendahara || myPermissions['settings.chat_moderation'] === 'granted') && (
            <form
              onSubmit={handleSaveChatModeration}
              className="rounded-2xl border border-indigo-200/80 bg-white p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-[#4C1D95]" />
                    <span>Pengaturan Modul Moderasi Chat (`settings.chat_moderation`)</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Berlaku untuk ruang obrolan Pengurus, Pengurus &amp; Keamanan, serta Pengurus &amp; Warga.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 cursor-pointer hover:bg-slate-50/70">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A]">
                      Izinkan Lampiran Media di Chat Warga
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Warga dapat mengirim foto bukti/laporan di ruang Pengurus &amp; Warga.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={chatPolicy.allow_warga_attachments}
                    onChange={(e) =>
                      setChatPolicy((prev) => ({
                        ...prev,
                        allow_warga_attachments: e.target.checked,
                      }))
                    }
                    className="mt-1 h-4 w-4 rounded accent-[#4C1D95] cursor-pointer shrink-0"
                  />
                </label>

                <label className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 p-3.5 cursor-pointer hover:bg-slate-50/70">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A]">
                      Pengumuman Resmi Khusus Pengurus
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Hanya Pengurus aktif yang dapat menyematkan pengumuman lingkungan.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={chatPolicy.pengurus_only_announcements}
                    onChange={(e) =>
                      setChatPolicy((prev) => ({
                        ...prev,
                        pengurus_only_announcements: e.target.checked,
                      }))
                    }
                    className="mt-1 h-4 w-4 rounded accent-[#4C1D95] cursor-pointer shrink-0"
                  />
                </label>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2.5">
                  <label
                    htmlFor="chat-retention-days"
                    className="text-xs font-semibold text-[#0F172A] whitespace-nowrap"
                  >
                    Retensi Riwayat Chat (Hari)
                  </label>
                  <input
                    id="chat-retention-days"
                    type="number"
                    min={7}
                    max={365}
                    value={chatPolicy.retention_days}
                    onChange={(e) =>
                      setChatPolicy((prev) => ({
                        ...prev,
                        retention_days: Math.max(7, Math.min(365, Number(e.target.value) || 90)),
                      }))
                    }
                    className="w-24 min-h-[38px] rounded-xl border border-slate-300 px-3 text-xs font-mono font-semibold tabular-nums text-[#0F172A]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingChatPolicy}
                  className="min-h-[40px] px-4 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  {savingChatPolicy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Simpan Kebijakan Moderasi</span>
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* SUB-VIEW 2: DELEGASI HAK PENGATURAN PENGURUS (KHUSUS BENDAHARA)   */}
      {/* ================================================================= */}
      {subView === 'delegation' && isBendahara && (
        <section aria-label="Delegasi Hak Pengaturan Pengurus" className="space-y-4">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-[#0F172A]">
                  Delegasi Hak Modul Pengaturan per Pengurus
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bendahara (<span className="font-semibold text-slate-700">Bp. Andriansyah</span>)
                  selalu memiliki akses penuh 6/6 modul. Atur izin modul{' '}
                  <span className="font-mono text-slate-700">granted</span> /{' '}
                  <span className="font-mono text-slate-700">revoked</span> untuk Pengurus lainnya.
                </p>
              </div>
              <div className="relative w-full sm:w-64 shrink-0">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari nama, jabatan, atau blok..."
                  className="w-full min-h-[40px] rounded-xl border border-slate-200 bg-slate-50 focus:bg-white pl-9 pr-3 text-xs text-[#0F172A] focus:border-[#4C1D95] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {loadingPerms && Object.keys(allPermMap).length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#4C1D95]" />
              <span>Memuat matriks delegasi hak pengaturan...</span>
            </div>
          ) : filteredPengurus.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              Tidak ada pengurus yang cocok dengan pencarian &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredPengurus.map((pengurus) => {
                const uname = pengurus.username.toLowerCase();
                const userPerms = allPermMap[uname] || {};
                const grantedCount = CENTRAL_SETTING_MODULES.filter(
                  (m) => userPerms[m.key]?.status === 'granted'
                ).length;
                const isBatchBusy = batchSavingUser === uname;
                const avatarSrc =
                  pengurusAccounts.find((a) => a.username.toLowerCase() === uname)?.avatar_url ||
                  avatarMap[buildAvatarKey('admin', uname)] ||
                  null;

                return (
                  <article
                    key={uname}
                    className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden"
                  >
                    <div className="px-4 py-3.5 bg-slate-50/80 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar name={pengurus.nama} src={avatarSrc} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#0F172A] truncate">
                            {pengurus.nama}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {pengurus.jabatan} · Blok {pengurus.blokRumah} ·{' '}
                            <span className="font-mono">@{pengurus.username}</span> ·{' '}
                            <span className="font-mono font-semibold tabular-nums text-[#4C1D95]">
                              {grantedCount}/{CENTRAL_SETTING_MODULES.length} modul
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isBatchBusy || grantedCount === CENTRAL_SETTING_MODULES.length}
                          onClick={() => void handleBatchPermission(uname, 'granted')}
                          className="min-h-[36px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-45 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {isBatchBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                          <span>Beri Semua</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBatchBusy || grantedCount === 0}
                          onClick={() => void handleBatchPermission(uname, 'revoked')}
                          className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 disabled:opacity-45 text-slate-600 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          <span>Cabut Semua</span>
                        </button>
                      </div>
                    </div>

                    <div className="p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {CENTRAL_SETTING_MODULES.map((mod) => {
                        const currentStatus: SettingPermissionStatus =
                          userPerms[mod.key]?.status === 'granted' ? 'granted' : 'revoked';
                        const isGranted = currentStatus === 'granted';
                        const isBusy = savingPermKey === `${uname}:${mod.key}` || isBatchBusy;
                        return (
                          <div
                            key={mod.key}
                            className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2.5 transition-colors ${
                              isGranted
                                ? 'border-emerald-200/90 bg-emerald-50/40'
                                : 'border-slate-200/80 bg-white'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[#0F172A] truncate">
                                {mod.label}
                              </p>
                              <p className="text-[11px] font-mono text-slate-500 truncate">
                                {mod.key}
                              </p>
                            </div>

                            <button
                              type="button"
                              role="switch"
                              aria-checked={isGranted}
                              aria-label={`${mod.label} untuk ${pengurus.nama}`}
                              disabled={isBusy}
                              onClick={() =>
                                void handleTogglePermission(uname, mod.key, currentStatus)
                              }
                              className={`min-h-[36px] px-3 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer disabled:opacity-50 ${
                                isGranted
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                              }`}
                            >
                              {isBusy ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : isGranted ? (
                                <Unlock className="w-3 h-3" />
                              ) : (
                                <Lock className="w-3 h-3" />
                              )}
                              <span>{isGranted ? 'Granted' : 'Revoked'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ================================================================= */}
      {/* SUB-VIEW 3: SINKRONISASI PENGURUS <-> WARGA & AUDIT LOGS          */}
      {/* ================================================================= */}
      {subView === 'sync_audit' && isBendahara && (
        <section aria-label="Sinkronisasi Status Pengurus ke Warga dan Audit Log" className="space-y-4">
          {/* Sinkronisasi Status Pengurus <-> Pemulihan Akun Warga */}
          <div className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden">
            <div className="px-4 sm:px-5 py-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-[#0F172A]">
                  Sinkronisasi Status Pengurus ↔ Pemulihan Akun Warga
                </h4>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Menonaktifkan akun Pengurus akan otomatis mengaktifkan kembali akun Warga / Blok
                  terkait melalui <span className="font-mono text-slate-700">sync_pengurus_to_warga_status</span>.
                </p>
              </div>
              <button
                type="button"
                disabled={loadingSync}
                onClick={() => void loadBendaharaData()}
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingSync ? 'animate-spin' : ''}`} />
                <span>Perbarui</span>
              </button>
            </div>

            <div className="divide-y divide-slate-200/70">
              {syncList.map((item) => {
                const isSelfBendahara =
                  item.jabatan === 'Bendahara' || item.pengurus_username === 'andriansyah';
                const isConfirming = confirmSyncTarget?.username === item.pengurus_username;
                const isBusy = submittingSyncUser === item.pengurus_username;
                const avatarSrc =
                  pengurusAccounts.find(
                    (a) => a.username.toLowerCase() === item.pengurus_username
                  )?.avatar_url ||
                  avatarMap[buildAvatarKey('admin', item.pengurus_username)] ||
                  null;

                return (
                  <div key={item.pengurus_username} className="p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start sm:items-center gap-3 min-w-0">
                        <UserAvatar name={item.pengurus_nama} src={avatarSrc} size="sm" />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#0F172A] truncate">
                            {item.pengurus_nama}{' '}
                            <span className="font-normal text-slate-500">· {item.jabatan}</span>
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-mono">@{item.pengurus_username}</span>
                            <span>·</span>
                            <span className="font-mono">Blok {item.linked_blok_rumah}</span>
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold">
                            <span
                              className={
                                item.is_active_pengurus ? 'text-emerald-700' : 'text-rose-700'
                              }
                            >
                              Pengurus: {item.is_active_pengurus ? 'Aktif' : 'Nonaktif / Dicabut'}
                            </span>
                            <span className="text-slate-300">|</span>
                            <span
                              className={
                                item.is_active_warga ? 'text-emerald-700' : 'text-amber-700'
                              }
                            >
                              Warga Blok {item.linked_blok_rumah}:{' '}
                              {item.is_active_warga
                                ? 'Aktif Otomatis (Jalur Warga)'
                                : 'Terkunci (Eksklusif Pengurus)'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0">
                        {isSelfBendahara ? (
                          <span className="min-h-[36px] px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 text-[11px] font-semibold inline-flex items-center gap-1.5">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Bendahara Utama (Dilindungi)</span>
                          </span>
                        ) : item.is_active_pengurus ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmSyncTarget({
                                username: item.pengurus_username,
                                nextActivePengurus: false,
                              });
                              setSyncReason('');
                            }}
                            className="min-h-[40px] px-3.5 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                          >
                            <UserMinus className="w-3.5 h-3.5" />
                            <span>Nonaktifkan Pengurus → Pulihkan Warga</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setConfirmSyncTarget({
                                username: item.pengurus_username,
                                nextActivePengurus: true,
                              });
                              setSyncReason('');
                            }}
                            className="min-h-[40px] px-3.5 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Aktifkan Kembali Pengurus</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Konfirmasi Inline (Tanpa window.confirm) */}
                    {isConfirming && confirmSyncTarget && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 space-y-2.5">
                        <p className="text-xs font-semibold text-amber-950 leading-relaxed">
                          {confirmSyncTarget.nextActivePengurus
                            ? `Aktifkan kembali hak Pengurus ${item.pengurus_nama} (@${item.pengurus_username})? Login jalur Warga untuk Blok ${item.linked_blok_rumah} akan diblokir sesuai aturan eksklusivitas.`
                            : `Nonaktifkan hak Pengurus ${item.pengurus_nama} (@${item.pengurus_username})? Akun Warga Blok ${item.linked_blok_rumah} akan otomatis diaktifkan kembali agar dapat login via Portal Warga.`}
                        </p>
                        <input
                          type="text"
                          value={syncReason}
                          onChange={(e) => setSyncReason(e.target.value)}
                          placeholder="Catatan/alasan perubahan status (opsional, mis. pergantian kepengurusan)"
                          className="w-full min-h-[38px] rounded-xl border border-amber-200 bg-white px-3 text-xs text-[#0F172A] focus:border-[#4C1D95] focus:outline-none"
                        />
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmSyncTarget(null)}
                            className="min-h-[36px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                          >
                            Batal
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleConfirmSyncStatus(
                                item,
                                confirmSyncTarget.nextActivePengurus
                              )
                            }
                            className="min-h-[36px] px-4 rounded-xl bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : confirmSyncTarget.nextActivePengurus ? (
                              <UserCheck className="w-3.5 h-3.5" />
                            ) : (
                              <Home className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {confirmSyncTarget.nextActivePengurus
                                ? 'Ya, Aktifkan Pengurus'
                                : 'Ya, Pulihkan Akun Warga'}
                            </span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Log Audit Delegasi & Sinkronisasi (audit_logs) */}
          <div className="rounded-2xl border border-slate-200/90 bg-white overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5">
              <div className="min-w-0">
                <h4 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                  <History className="w-4 h-4 text-[#4C1D95]" />
                  <span>Riwayat Audit (`audit_logs`)</span>
                  <span className="text-xs font-mono font-semibold tabular-nums text-slate-500">
                    ({visibleAuditLogs.length})
                  </span>
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Catatan perubahan delegasi hak pengaturan, sinkronisasi status Pengurus ↔ Warga, dan blokir eksklusivitas login.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5">
                  <button
                    type="button"
                    onClick={() => setAuditFilter('delegation')}
                    className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                      auditFilter === 'delegation'
                        ? 'bg-white text-[#0F172A] shadow-2xs'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    Delegasi &amp; Status
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuditFilter('all')}
                    className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                      auditFilter === 'all'
                        ? 'bg-white text-[#0F172A] shadow-2xs'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    Semua Audit
                  </button>
                </div>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
              {loadingLogs ? (
                <div className="p-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[#4C1D95]" />
                  <span>Memuat riwayat audit_logs...</span>
                </div>
              ) : visibleAuditLogs.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  Belum ada catatan audit delegasi atau sinkronisasi status pada filter ini.
                </div>
              ) : (
                visibleAuditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="px-4 sm:px-5 py-3 text-xs hover:bg-slate-50/70 transition-colors"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-[#0F172A]">
                        {log.actor_name}{' '}
                        <span className="font-mono font-normal text-slate-500">
                          ({log.actor_id})
                        </span>
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-400">
                        {formatTanggalWaktu(log.timestamp)}
                      </span>
                    </div>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">{log.summary}</p>
                    <p className="text-[10px] font-mono text-[#4C1D95] mt-0.5">
                      {log.action} · {log.entity}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
