import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  ChevronRight,
  FileSpreadsheet,
  LogOut,
  MessageCircle,
  PhoneCall,
  ReceiptText,
  Settings,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { isBendaharaOnly, type SessionUser } from '../types';
import { useAppBrand } from '../lib/brandContext';
import { useSimulation } from '../lib/simulationContext';
import { formatBlokRumah } from '../lib/format';
import { BrandLogo, SaungKebunWatermark } from './BrandLogo';
import { AppVersionFooter } from './AppUpdateSystem';
import type { Icon3DName } from './Icon3D';
import { Navbar3D } from './Navbar3D';
import { PortalHeader } from './PortalHeader';
import { UserAvatar } from './UserAvatar';
import bgHeaderAsset from '../assets/bg-header.jpg';

const HEADER_BG_SRC = bgHeaderAsset;
import {
  fetchUnreadNotificationCount,
  getCanonicalUserId,
  subscribeActivityNotificationsRealtime,
} from '../lib/notificationService';
import {
  fetchPendingBugReportCount,
  subscribeBugReportsRealtime,
} from '../lib/bugReportService';
import {
  fetchChatUnreadSummary,
  subscribeChatMessagesRealtime,
  type ChatRoomId,
} from '../lib/chatService';
import { FloatingChatWidget } from './FloatingChatWidget';
import { AdminStorageUsageWidget } from './admin/AdminStorageUsageWidget';

export interface NavItem {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  icon3d?: Icon3DName;
  badgeCount?: number;
  isCenterFab?: boolean;
}

interface AppShellProps {
  session: SessionUser;
  navItems: NavItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenStorageInfo?: () => void;
  onOpenProfile?: () => void;
  onNavigateTarget?: (targetUrl: string) => void;
  chatOpen?: boolean;
  onChatOpenChange?: (open: boolean) => void;
  chatInitialRoomId?: ChatRoomId | null;
  isPickingAttachmentRef?: React.MutableRefObject<boolean>;
  onAttachmentPickingChange?: (picking: boolean) => void;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
  avatarUrl?: string | null;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

const SHORT_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function AppShell({
  session,
  navItems,
  activeTab,
  onTabChange,
  onLogout,
  onOpenSettings,
  onOpenStorageInfo,
  onOpenProfile,
  onNavigateTarget,
  chatOpen: controlledChatOpen,
  onChatOpenChange,
  chatInitialRoomId,
  isPickingAttachmentRef,
  onAttachmentPickingChange,
  onToast,
  avatarUrl,
  headerAction,
  children,
}: AppShellProps) {
  const { brand } = useAppBrand();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [internalChatOpen, setInternalChatOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  const [pendingBugCount, setPendingBugCount] = useState<number>(0);
  const [unreadChatCount, setUnreadChatCount] = useState<number>(0);

  const isChatModalOpen = controlledChatOpen !== undefined ? controlledChatOpen : internalChatOpen;
  const setChatModalOpen = (next: boolean) => {
    if (onChatOpenChange) {
      onChatOpenChange(next);
    }
    if (controlledChatOpen === undefined) {
      setInternalChatOpen(next);
    }
  };

  const isAdmin = session.role === 'admin';
  const isWarga = session.role === 'warga';
  const isPetugas = session.role === 'petugas';
  const canAccessBotWa = isBendaharaOnly(session);
  const isLpjActive = activeTab === 'lpj';
  const isBugReportsActive = activeTab === 'laporan_bug';
  const isProfilActive = activeTab === 'profil';
  const effectiveAvatarUrl = avatarUrl !== undefined ? avatarUrl : session.avatar_url || null;

  const { simNow } = useSimulation();
  const currentMonthBadge = useMemo(() => {
    const now = session.is_simulation ? simNow : new Date();
    return `${SHORT_MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`;
  }, [session.is_simulation, simNow]);

  // Batasi dock bawah maksimal 5 ikon agar Floating Dock selalu simetris
  const bottomDockItems = navItems.slice(0, 5);

  const sessionRef = useRef<SessionUser>(session);
  sessionRef.current = session;
  const sessionKey = getCanonicalUserId(session);

  // Ambil jumlah notifikasi belum dibaca (is_read = false) langsung dari tabel `notifications`
  useEffect(() => {
    let active = true;
    const syncUnreadCount = async () => {
      const count = await fetchUnreadNotificationCount(sessionRef.current);
      if (active) {
        setUnreadNotificationCount(count);
      }
    };

    void syncUnreadCount();
    const unsub = subscribeActivityNotificationsRealtime(sessionRef.current, () => {
      void syncUnreadCount();
    });

    if (session.is_simulation) {
      return () => {
        active = false;
        unsub();
      };
    }

    const pollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void syncUnreadCount();
      }
    }, 15000);
    const onFocusOrVisible = () => {
      if (document.visibilityState !== 'hidden') {
        void syncUnreadCount();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      active = false;
      unsub();
      window.clearInterval(pollTimer);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [sessionKey, session.is_simulation]);

  // Sinkronisasi jumlah Laporan Bug yang masih Pending khusus Admin
  useEffect(() => {
    if (!isAdmin) {
      setPendingBugCount(0);
      return;
    }
    let active = true;
    const activeSession = sessionRef.current;
    const syncBugCount = async () => {
      const count = await fetchPendingBugReportCount(sessionRef.current);
      if (active) {
        setPendingBugCount(count);
      }
    };

    void syncBugCount();
    const unsub = subscribeBugReportsRealtime(activeSession, () => {
      void syncBugCount();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [isAdmin, sessionKey, session.is_simulation]);

  // Sinkronisasi jumlah pesan belum dibaca untuk Chat Lingkungan
  useEffect(() => {
    let active = true;
    const syncChatUnread = async () => {
      const summary = await fetchChatUnreadSummary(sessionRef.current);
      if (active) {
        setUnreadChatCount(summary.totalUnread);
      }
    };

    void syncChatUnread();
    const unsub = subscribeChatMessagesRealtime(sessionRef.current, {
      onAnyChange: () => {
        void syncChatUnread();
      },
    });
    return () => {
      active = false;
      unsub();
    };
  }, [sessionKey]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    const onBackOverlay = (e: Event) => {
      const detail = (e as CustomEvent<{ handled?: boolean }>).detail;
      if (detail && !detail.handled) {
        detail.handled = true;
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('ecard-handle-back-overlay', onBackOverlay);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('ecard-handle-back-overlay', onBackOverlay);
    };
  }, [drawerOpen]);

  const handleSelectNav = (id: string) => {
    setDrawerOpen(false);
    onTabChange(id);
  };

  const handleOpenSettingsFromSidebar = () => {
    setDrawerOpen(false);
    onOpenSettings?.();
  };

  const handleOpenStorageFromSidebar = () => {
    setDrawerOpen(false);
    if (onOpenStorageInfo) {
      onOpenStorageInfo();
    } else {
      onOpenSettings?.();
    }
  };

  const handleOpenProfileFromSidebar = () => {
    setDrawerOpen(false);
    if (isWarga) {
      onTabChange('profil');
    } else {
      onOpenProfile?.();
    }
  };

  const handleLogoutFromSidebar = () => {
    setDrawerOpen(false);
    onLogout();
  };

  const displayWargaBlok = formatBlokRumah(session.blok_rumah) || session.blok_rumah;
  const roleSubtitleLabel = isAdmin
    ? `${session.jabatan || 'Pengurus'} · ${session.admin_permission === 'full' ? 'Akses Penuh' : 'Pengurus'}`
    : isPetugas
      ? `Keamanan · ${session.shift || 'Petugas'}`
      : `Warga · Blok ${displayWargaBlok}`;

  const compactIdentityLabel = isAdmin
    ? `${session.nama_warga} · ${session.jabatan || 'Pengurus'}`
    : isPetugas
      ? `${session.nama_warga} · Keamanan`
      : `${session.nama_warga} · Blok ${displayWargaBlok}`;

  const renderSidebarNavigation = () => (
    <div className="saung-table-scroll flex-1 overflow-y-auto px-4 md:px-5 lg:px-4 py-4 md:py-5 lg:py-4 space-y-5">
      {/* Daftar Menu Utama */}
      <div className="space-y-1.5">
        <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#6E786D]">
          Menu Utama
        </p>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTab;
          const labelText = item.id === 'dashboard' ? 'Dasbor & Verifikasi' : item.label;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectNav(item.id)}
              className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-[#243825] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isActive
                    ? 'bg-white/15 text-[#FFFDF8]'
                    : 'bg-[#E5EEE3] text-[#243825]'
                }`}
              >
                <Icon className="w-[17px] h-[17px]" strokeWidth={isActive ? 2.3 : 2} />
              </span>
              <span className="truncate flex-1">{labelText}</span>
              {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                <span
                  className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums shrink-0 bg-[#F4E4C4] text-[#243825]"
                >
                  {item.badgeCount > 9 ? '9+' : item.badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Menu Tambahan Sesuai Role */}
      <div className="space-y-1.5">
        <p className="px-3 pb-1 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[#6E786D]">
          {isAdmin ? 'Komunikasi & Pengaturan' : 'Komunikasi & Profil'}
        </p>

        {/* Chat Lingkungan Real-Time */}
        <button
          type="button"
          onClick={() => {
            setDrawerOpen(false);
            setChatModalOpen(true);
          }}
          className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug transition-all duration-200 cursor-pointer ${
            isChatModalOpen
              ? 'bg-[#243825] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
              : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
          }`}
        >
          <span
            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              isChatModalOpen
                ? 'bg-white/15 text-[#FFFDF8]'
                : 'bg-[#E5EEE3] text-[#243825]'
            }`}
          >
            <MessageCircle className="w-[17px] h-[17px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate leading-tight">Chat Cepat Lingkungan</p>
            <p
              className={`text-[11px] font-normal truncate mt-0.5 ${
                isChatModalOpen ? 'text-[#E5EEE3]/85' : 'text-[#6E786D]'
              }`}
            >
              DM &amp; Group (Pengurus · Warga · Keamanan)
            </p>
          </div>
          {unreadChatCount > 0 && !isChatModalOpen && (
            <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#C87058] text-white tabular-nums shrink-0">
              {unreadChatCount > 99 ? '99+' : unreadChatCount}
            </span>
          )}
        </button>

        {isAdmin ? (
          <>
            <button
              type="button"
              onClick={() => handleSelectNav('lpj')}
              className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug transition-all duration-200 cursor-pointer ${
                isLpjActive
                  ? 'bg-[#243825] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isLpjActive
                    ? 'bg-white/15 text-[#FFFDF8]'
                    : 'bg-[#E5EEE3] text-[#243825]'
                }`}
              >
                <FileSpreadsheet className="w-[17px] h-[17px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight">Laporan LPJ (PDF)</p>
                <p
                  className={`text-[11px] font-normal truncate mt-0.5 ${
                    isLpjActive ? 'text-[#E5EEE3]/85' : 'text-[#6E786D]'
                  }`}
                >
                  Rekap Triwulanan A4
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectNav('laporan_bug')}
              className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug transition-all duration-200 cursor-pointer ${
                isBugReportsActive
                  ? 'bg-[#243825] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isBugReportsActive
                    ? 'bg-white/15 text-[#FFFDF8]'
                    : 'bg-[#E5EEE3] text-[#243825]'
                }`}
              >
                <Bug className="w-[17px] h-[17px]" />
              </span>
              <span className="truncate flex-1">Laporan Bug</span>
              {pendingBugCount > 0 && (
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#C87058] text-white tabular-nums shrink-0">
                  {pendingBugCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleOpenProfileFromSidebar}
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug font-medium text-[#3A473A] hover:bg-[#E5EEE3]/70 hover:text-[#1B271B] transition-all duration-200 cursor-pointer"
            >
              <span className="w-7 h-7 rounded-xl bg-[#E5EEE3] text-[#243825] flex items-center justify-center shrink-0">
                <User className="w-[17px] h-[17px]" />
              </span>
              <span className="truncate flex-1">Profil Pengurus</span>
            </button>

            {onOpenSettings && (
              <button
                type="button"
                onClick={handleOpenSettingsFromSidebar}
                className="w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug font-medium text-[#3A473A] hover:bg-[#E5EEE3]/70 hover:text-[#1B271B] transition-all duration-200 cursor-pointer"
              >
                <span className="w-8 h-8 rounded-xl bg-[#E5EEE3] text-[#243825] flex items-center justify-center shrink-0">
                  <Settings className="w-[17px] h-[17px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate leading-tight">Pengaturan Sistem</p>
                  <p className="text-[11px] text-[#6E786D] font-normal truncate mt-0.5">
                    {canAccessBotWa
                      ? 'Tarif IPL, QRIS, Penyimpanan & Bot WA'
                      : 'Tema, Identitas, Penyimpanan & QRIS'}
                  </p>
                </div>
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => handleSelectNav('profil')}
              className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug transition-all duration-200 cursor-pointer ${
                isProfilActive
                  ? 'bg-[#243825] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              <span
                className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isProfilActive
                    ? 'bg-white/15 text-[#FFFDF8]'
                    : 'bg-[#E5EEE3] text-[#243825]'
                }`}
              >
                <User className="w-[17px] h-[17px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight">Profil Warga</p>
                <p
                  className={`text-[11px] font-normal truncate mt-0.5 ${
                    isProfilActive ? 'text-[#E5EEE3]/85' : 'text-[#6E786D]'
                  }`}
                >
                  Foto, PIN, Tema &amp; Notifikasi
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectNav('riwayat')}
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug font-medium text-[#3A473A] hover:bg-[#E5EEE3]/70 hover:text-[#1B271B] transition-all duration-200 cursor-pointer"
            >
              <span className="w-8 h-8 rounded-xl bg-[#E5EEE3] text-[#243825] flex items-center justify-center shrink-0">
                <ReceiptText className="w-[17px] h-[17px]" />
              </span>
              <span className="truncate flex-1">Kwitansi Digital</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectNav('lingkungan')}
              className="w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug font-medium text-[#3A473A] hover:bg-[#E5EEE3]/70 hover:text-[#1B271B] transition-all duration-200 cursor-pointer"
            >
              <span className="w-8 h-8 rounded-xl bg-[#E5EEE3] text-[#243825] flex items-center justify-center shrink-0">
                <PhoneCall className="w-[17px] h-[17px]" />
              </span>
              <span className="truncate flex-1">Hubungi Pengurus</span>
            </button>
          </>
        )}
      </div>
    </div>
  );

  const isFullHeightTableTab = isAdmin && activeTab === 'warga';

  return (
    <div
      className={`min-h-[100dvh] w-full max-w-[100vw] bg-[#F6F3EA] glass-canvas text-[var(--theme-text)] flex flex-col lg:flex-row lg:w-full lg:overflow-hidden overflow-x-clip print:h-auto print:overflow-visible print:block ${
        session.is_simulation ? 'lg:h-[calc(100vh-49px)]' : 'lg:h-screen'
      }`}
    >
      {/* SIDEBAR TETAP — DESKTOP (lg+, lebar w-72 / 288px) */}
      <aside
        aria-label="Navigasi Sidebar Utama"
        className="hidden lg:flex lg:flex-col lg:w-72 lg:shrink-0 lg:h-full lg:overflow-y-auto saung-table-scroll z-30 bg-[#F6F3EA] border-r border-[#E6E2D6] shadow-[6px_0_24px_-12px_rgba(36,56,37,0.12)] no-print"
      >
        {/* Brand Header Sidebar Velvety Moss Green + Foto Lingkungan + Watermark */}
        <div className="relative overflow-hidden px-4 pt-5 pb-4 bg-[#243825] text-[#FFFDF8] shrink-0">
          <img
            src={HEADER_BG_SRC}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover object-center opacity-35"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-br from-[#243825]/90 via-[#2B3F29]/82 to-[#384E35]/90"
          />
          <SaungKebunWatermark className="absolute -right-6 -bottom-4 w-32 h-24" tone="cream" />
          <button
            type="button"
            onClick={() => handleSelectNav(isAdmin ? 'dashboard' : 'beranda')}
            className="relative z-10 w-full flex items-center gap-3 text-left cursor-pointer group"
          >
            <BrandLogo size="sm" variant="dark" className="shrink-0" />
            <div className="min-w-0">
              <p className="font-serif-brand text-base font-bold tracking-tight text-[#FFFDF8] leading-tight truncate">
                {brand.app_name || 'e-Card Verifikasi'}
              </p>
              <p className="text-[11px] font-medium text-[#E5EEE3]/85 truncate mt-0.5">
                {brand.app_subtitle || 'IPL Digital — Perumahan Saung Kebun'}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleOpenProfileFromSidebar}
            className="relative z-10 group mt-3.5 w-full text-left p-2.5 rounded-2xl bg-white/10 hover:bg-white/16 border border-white/15 flex items-center gap-2.5 transition-all duration-200 cursor-pointer"
          >
            <UserAvatar
              name={session.nama_warga}
              src={effectiveAvatarUrl}
              size="sm"
              ringClassName="ring-2 ring-[#E5EEE3]/50"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#FFFDF8] truncate leading-tight">
                {session.nama_warga}
              </p>
              <p className="text-[10.5px] text-[#E5EEE3]/85 truncate mt-0.5 leading-tight">
                {roleSubtitleLabel}
              </p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-[#E5EEE3]/80 group-hover:translate-x-0.5 shrink-0 transition-transform" />
          </button>
        </div>

        {/* Daftar Menu Lengkap di Tengah dengan Watermark Logo Saung Kebun */}
        <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
          <SaungKebunWatermark
            tone="moss"
            className="inset-x-0 bottom-6 mx-auto w-44 h-60 opacity-[0.06]"
          />
          <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
            {renderSidebarNavigation()}
          </div>
        </div>

        {/* Footer Sidebar: Ringkasan Penyimpanan (Admin) + Logout Terakota Lembut + Versi */}
        <div className="relative z-10 mt-auto px-4 pt-3 pb-4 border-t border-[#E6E2D6] bg-[#FFFDF8]/75 space-y-2.5 shrink-0">
          {isAdmin && (
            <AdminStorageUsageWidget
              session={session}
              variant="sidebar"
              onOpenStorageInfo={handleOpenStorageFromSidebar}
            />
          )}

          <button
            type="button"
            onClick={handleLogoutFromSidebar}
            className="w-full min-h-[42px] px-3.5 rounded-2xl bg-[#C87058]/14 hover:bg-[#C87058] text-[#A44831] hover:text-white border border-[#C87058]/35 text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.98]"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Keluar / Logout</span>
          </button>

          <AppVersionFooter compact className="px-1 pt-0.5" />
        </div>
      </aside>

      {/* SLIDE-OVER LEFT DRAWER — MOBILE & TABLET (< lg) */}
      <AnimatePresence>
        {drawerOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu Sidebar & Profil"
            className="lg:hidden fixed inset-0 z-[60] flex no-print"
          >
            {/* Backdrop Gelap Semi-Transparan */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-[#142015]/55"
            />

            {/* Panel Drawer Kiri (~80% lebar viewport, sudut kanan membulat) */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-[82vw] max-w-xs h-full bg-[#F6F3EA] rounded-r-[28px] border-r border-[#E6E2D6] shadow-[0_25px_50px_-12px_rgba(20,32,21,0.45)] flex flex-col overflow-hidden"
            >
              {/* Header Drawer Velvety Moss Green dengan Watermark Saung Kebun */}
              <div className="relative overflow-hidden px-4 pt-[calc(max(env(safe-area-inset-top,0px),18px)+0.75rem)] pb-4 bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] text-[#FFFDF8] shrink-0">
                <SaungKebunWatermark className="absolute -right-6 -bottom-4 w-36 h-28" tone="cream" />
                <div className="relative z-10 flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <BrandLogo size="sm" variant="dark" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="font-serif-brand text-base font-bold text-[#FFFDF8] leading-tight truncate">
                        {brand?.app_name || 'e-Card Verifikasi'}
                      </p>
                      <p className="text-[11px] text-[#E5EEE3]/90 truncate mt-0.5">
                        {brand?.app_subtitle || 'IPL Digital — Perumahan Saung Kebun'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Tutup menu sidebar"
                    className="h-9 w-9 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 text-[#FFFDF8] flex items-center justify-center transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Kartu Profil Pengguna Bulat */}
                <button
                  type="button"
                  onClick={handleOpenProfileFromSidebar}
                  className="relative z-10 group mt-4 w-full text-left p-3 rounded-2xl bg-white/12 hover:bg-white/20 border border-white/20 flex items-center gap-3 transition-all duration-200 cursor-pointer"
                >
                  <UserAvatar
                    name={session?.nama_warga || 'Pengguna'}
                    src={effectiveAvatarUrl}
                    size="md"
                    ringClassName="ring-2 ring-[#E5EEE3]/70"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-[#FFFDF8] leading-tight truncate">
                      {session?.nama_warga || 'Pengguna'}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-[#E5EEE3]/90 truncate">
                      {roleSubtitleLabel}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#E5EEE3] group-hover:translate-x-0.5 transition-transform shrink-0" />
                </button>
              </div>

              {/* Menu Utama & Menu Tambahan dengan Watermark Logo Saung Kebun */}
              <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                <SaungKebunWatermark
                  tone="moss"
                  className="inset-x-0 bottom-6 mx-auto w-44 h-60 opacity-[0.06]"
                />
                <div className="relative z-10 flex-1 min-h-0 flex flex-col overflow-hidden">
                  {renderSidebarNavigation()}
                </div>
              </div>

              {/* Footer Drawer: Ringkasan Penyimpanan (Admin) + Logout Terakota */}
              <div className="relative z-10 mt-auto px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[#E6E2D6] bg-[#FFFDF8]/80 space-y-2.5 shrink-0">
                {isAdmin && (
                  <AdminStorageUsageWidget
                    session={session}
                    variant="sidebar"
                    onOpenStorageInfo={handleOpenStorageFromSidebar}
                  />
                )}

                <button
                  type="button"
                  onClick={handleLogoutFromSidebar}
                  className="w-full min-h-[44px] px-4 rounded-2xl bg-[#C87058] hover:bg-[#B75F47] active:scale-[0.98] font-bold text-sm text-[#FFFDF8] shadow-sm inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Keluar / Logout</span>
                </button>
                <AppVersionFooter compact className="px-1" />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* PANEL KANAN FULLSCREEN (HEADER + KONTEN UTAMA) */}
      <div className="flex-1 min-w-0 flex flex-col lg:h-full lg:overflow-hidden print:h-auto print:overflow-visible">
        {/* HEADER IDENTIK SCENIC SAUNG KEBUN + PIL PROFIL KACA MENGAMBANG */}
        <div className="relative z-30 shrink-0 no-print">
          <PortalHeader
            session={session}
            appTitle={brand.app_name || 'e-Card Verifikasi'}
            appSubtitle="Perumahan Saung Kebun"
            displayName={session.nama_warga}
            identityLabel={compactIdentityLabel}
            avatarUrl={effectiveAvatarUrl}
            activePeriodLabel={currentMonthBadge}
            menuBadgeCount={isAdmin ? pendingBugCount : 0}
            externalUnreadCount={unreadNotificationCount}
            onUnreadCountChange={setUnreadNotificationCount}
            onOpenMenu={() => setDrawerOpen(true)}
            onLogoClick={() => onTabChange(isAdmin ? 'dashboard' : 'beranda')}
            onProfileClick={() => {
              if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                handleOpenProfileFromSidebar();
              } else {
                setDrawerOpen(true);
              }
            }}
            onNavigateTarget={onNavigateTarget}
          />
        </div>

        {/* AREA KONTEN UTAMA FULL-WIDTH (tanpa max-w sempit di PC/Tablet; Mobile aman dengan pb-28+) */}
        <main
          className={`flex-1 min-h-0 w-full max-w-none min-w-0 px-4 md:px-6 overflow-x-clip print:overflow-visible print:p-0 ${
            isFullHeightTableTab
              ? 'flex flex-col pt-3 pb-[calc(7.5rem+env(safe-area-inset-bottom,0px))] lg:pt-3 lg:pb-3 lg:overflow-hidden'
              : 'pt-3 pb-[calc(8.5rem+env(safe-area-inset-bottom,0px))] lg:py-4 lg:pb-6 lg:overflow-y-auto saung-table-scroll'
          }`}
        >
          <div
            key={activeTab}
            className={`w-full max-w-none min-w-0 animate-page-enter ${
              isFullHeightTableTab ? 'flex-1 min-h-0 flex flex-col' : ''
            }`}
          >
            {children}
          </div>
        </main>
      </div>

      {/* IKON CHAT MELAYANG + PANEL CHAT CEPAT (DM & GROUP) */}
      <FloatingChatWidget
        session={session}
        unreadCount={unreadChatCount}
        open={isChatModalOpen}
        onOpenChange={setChatModalOpen}
        initialRoomId={chatInitialRoomId}
        isPickingAttachmentRef={isPickingAttachmentRef}
        onAttachmentPickingChange={onAttachmentPickingChange}
        onToast={onToast}
      />

      {/* FLOATING BOTTOM DOCK — NB2 3D SOFT PORCELAIN (MOBILE & TABLET < lg) */}
      <Navbar3D
        items={bottomDockItems}
        activeId={activeTab}
        onSelect={onTabChange}
        ariaLabel="Navigasi Bawah Floating Dock"
      />
    </div>
  );
}
