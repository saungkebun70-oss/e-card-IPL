import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  ChevronRight,
  Menu,
  PhoneCall,
  UserCircle2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { isBendaharaOnly, type SessionUser } from '../types';
import { useAppBrand } from '../lib/brandContext';
import { formatBlokRumah } from '../lib/format';
import { BrandLogo, SaungKebunWatermark } from './BrandLogo';
import { AppVersionFooter } from './AppUpdateSystem';
import { Icon3D, type Icon3DName } from './Icon3D';
import { Navbar3D } from './Navbar3D';
import { NotificationBell } from './NotificationBell';
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
  const adminIdentityLabel = `${session.nama_warga} — ${session.jabatan || 'Pengurus'}`;
  const isLpjActive = activeTab === 'lpj';
  const isBugReportsActive = activeTab === 'laporan_bug';
  const isProfilActive = activeTab === 'profil';
  const effectiveAvatarUrl = avatarUrl !== undefined ? avatarUrl : session.avatar_url || null;

  const currentMonthBadge = useMemo(() => {
    const now = new Date();
    return `${SHORT_MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`;
  }, []);

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
  }, [sessionKey]);

  // Sinkronisasi jumlah Laporan Bug yang masih Pending khusus Admin
  useEffect(() => {
    if (!isAdmin) {
      setPendingBugCount(0);
      return;
    }
    let active = true;
    const syncBugCount = async () => {
      const count = await fetchPendingBugReportCount(session);
      if (active) {
        setPendingBugCount(count);
      }
    };

    void syncBugCount();
    const unsub = subscribeBugReportsRealtime(session, () => {
      void syncBugCount();
    });
    return () => {
      active = false;
      unsub();
    };
  }, [isAdmin, session]);

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

  const activePageTitle = isLpjActive
    ? 'Laporan Pertanggungjawaban (LPJ)'
    : isBugReportsActive
      ? 'Laporan Bug'
      : isProfilActive
        ? 'Profil & Akun Warga'
        : navItems.find((item) => item.id === activeTab)?.label || navItems[0]?.label || '';

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
    <div className="flex-1 overflow-y-auto px-4 md:px-5 lg:px-4 py-4 md:py-5 lg:py-4 space-y-5">
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
                  ? 'bg-[#2B3F29] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              {item.icon3d ? (
                <Icon3D
                  name={item.icon3d}
                  className={`w-8 h-8 shadow-xs transition-transform duration-200 ${
                    isActive ? 'scale-[1.03]' : ''
                  }`}
                />
              ) : (
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                    isActive
                      ? 'bg-white/15 text-[#FFFDF8]'
                      : 'bg-[#E5EEE3] text-[#243825]'
                  }`}
                >
                  <Icon className="w-[17px] h-[17px]" strokeWidth={isActive ? 2.3 : 2} />
                </span>
              )}
              <span className="truncate flex-1">{labelText}</span>
              {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                <span
                  className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded-full tabular-nums shrink-0 ${
                    isActive
                      ? 'bg-[#F2D8A7] text-[#3F2C0D]'
                      : 'bg-[#F2D8A7] text-[#4A3410]'
                  }`}
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
              ? 'bg-[#2B3F29] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
              : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
          }`}
        >
          <Icon3D name="chat_cepat" className="w-8 h-8 shadow-xs" />
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
                  ? 'bg-[#2B3F29] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              <Icon3D name="laporan_lpj" className="w-8 h-8 shadow-xs" />
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
                  ? 'bg-[#2B3F29] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isBugReportsActive
                    ? 'bg-white/15 text-[#FFFDF8]'
                    : 'bg-[#C87058]/15 text-[#A94E38]'
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
              <span className="w-8 h-8 rounded-xl bg-[#E5EEE3] text-[#243825] flex items-center justify-center shrink-0">
                <UserCircle2 className="w-[17px] h-[17px]" />
              </span>
              <span className="truncate flex-1">Profil Pengurus</span>
            </button>

            {onOpenSettings && (
              <button
                type="button"
                onClick={handleOpenSettingsFromSidebar}
                className="w-full min-h-[46px] px-3.5 py-2.5 rounded-2xl text-left flex items-center gap-3 text-[13.5px] leading-snug font-medium text-[#3A473A] hover:bg-[#E5EEE3]/70 hover:text-[#1B271B] transition-all duration-200 cursor-pointer"
              >
                <Icon3D name="pengaturan" className="w-8 h-8 shadow-xs" />
                <div className="min-w-0 flex-1">
                  <p className="truncate leading-tight">Pengaturan Sistem</p>
                  <p className="text-[11px] text-[#6E786D] font-normal truncate mt-0.5">
                    {canAccessBotWa
                      ? 'Tarif IPL, QRIS, Bot WA & Identitas'
                      : 'Tema, Identitas, QRIS & Petugas'}
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
                  ? 'bg-[#2B3F29] text-[#FFFDF8] font-bold shadow-sm shadow-[#243825]/20'
                  : 'text-[#3A473A] font-medium hover:bg-[#E5EEE3]/70 hover:text-[#1B271B]'
              }`}
            >
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isProfilActive
                    ? 'bg-white/15 text-[#FFFDF8]'
                    : 'bg-[#E5EEE3] text-[#243825]'
                }`}
              >
                <UserCircle2 className="w-[17px] h-[17px]" />
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
              <Icon3D name="riwayat" className="w-8 h-8 shadow-xs" />
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

  return (
    <div className="min-h-[100dvh] w-full max-w-[100vw] bg-[#F6F3EA] glass-canvas text-[var(--theme-text)] flex flex-col overflow-x-hidden">
      {/* SIDEBAR TETAP — DESKTOP (lg+, lebar 260px) */}
      <aside
        aria-label="Navigasi Sidebar Utama"
        className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-[260px] z-30 bg-[#F6F3EA] border-r border-[#E6E2D6] shadow-[6px_0_24px_-12px_rgba(36,56,37,0.12)] no-print"
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

        {/* Daftar Menu Lengkap di Tengah */}
        {renderSidebarNavigation()}

        {/* Footer Sidebar: Logout Terakota Lembut + Versi */}
        <div className="mt-auto px-4 pt-3 pb-4 border-t border-[#E6E2D6] bg-[#FFFDF8]/75 space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={handleLogoutFromSidebar}
            className="w-full min-h-[42px] px-3.5 rounded-2xl bg-[#C87058]/14 hover:bg-[#C87058] text-[#A44831] hover:text-white border border-[#C87058]/35 text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.98]"
          >
            <Icon3D name="keluar" className="w-5 h-5 rounded-md shadow-2xs" />
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
              className="fixed inset-0 bg-[#142015]/55 backdrop-blur-sm"
            />

            {/* Panel Drawer Kiri (~80% lebar viewport, sudut kanan membulat) */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-[80vw] max-w-[330px] h-full bg-[#F6F3EA] rounded-r-3xl border-r border-[#E6E2D6] shadow-[0_25px_50px_-12px_rgba(20,32,21,0.45)] flex flex-col overflow-hidden"
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

              {/* Menu Utama & Menu Tambahan */}
              {renderSidebarNavigation()}

              {/* Footer Drawer + Logout Terakota */}
              <div className="mt-auto px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[#E6E2D6] bg-[#FFFDF8]/80 space-y-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleLogoutFromSidebar}
                  className="w-full min-h-[44px] px-4 rounded-2xl bg-[#C87058] hover:bg-[#B75F47] active:scale-[0.98] font-bold text-sm text-[#FFFDF8] shadow-sm inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <Icon3D name="keluar" className="w-5 h-5 rounded-md shadow-2xs" />
                  <span>Keluar / Logout</span>
                </button>
                <AppVersionFooter compact className="px-1" />
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* HEADER COMPACT MOBILE/TABLET DENGAN FOTO LINGKUNGAN + PIL KACA MENGAMBANG */}
      <div className="lg:hidden relative z-30 no-print">
        <header className="relative overflow-hidden rounded-b-[28px] shadow-[0_10px_26px_-12px_rgba(27,39,27,0.35)] pt-[calc(max(env(safe-area-inset-top,0px),14px)+0.55rem)] pb-9 px-3.5 sm:px-5">
          {/* Foto Latar Jalan Rindang Saung Kebun */}
          <img
            src={HEADER_BG_SRC}
            alt="Suasana Perumahan Saung Kebun"
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-[#1A291B]/82 via-[#243825]/66 to-[#243825]/86"
          />

          {/* Bar Atas Header */}
          <div className="relative z-10 flex items-center justify-between gap-2">
            {/* Tombol Hamburger Kaca Bulat (Kiri) */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka Menu Sidebar"
              title="Menu Profil, Layanan & Keluar"
              className="relative h-10 w-10 rounded-full border border-white/25 bg-white/15 backdrop-blur-md hover:bg-white/25 text-[#FFFDF8] flex items-center justify-center transition-colors cursor-pointer shrink-0 active:scale-95"
            >
              <Menu className="w-4.5 h-4.5" />
              {isAdmin && pendingBugCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#C87058] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-[#243825]">
                  {pendingBugCount > 9 ? '9+' : pendingBugCount}
                </span>
              )}
            </button>

            {/* Logo Transparan + Judul Tengah */}
            <button
              type="button"
              onClick={() => onTabChange(isAdmin ? 'dashboard' : 'beranda')}
              className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
            >
              <BrandLogo size="xs" variant="dark" className="shrink-0" />
              <div className="min-w-0">
                <p className="font-serif-brand text-[15px] font-bold tracking-tight text-[#FFFDF8] leading-tight truncate">
                  {brand.app_name || 'e-Card Verifikasi'}
                </p>
                <p className="text-[10.5px] font-medium text-[#E5EEE3]/90 leading-tight truncate">
                  {brand.app_subtitle || 'Perumahan Saung Kebun'}
                </p>
              </div>
            </button>

            {/* Lonceng Notifikasi + Aksi Kanan */}
            <div className="flex items-center gap-1.5 shrink-0">
              {headerAction && <div className="shrink-0">{headerAction}</div>}
              {isAdmin && onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  aria-label="Pengaturan Sistem"
                  title="Pengaturan Sistem Terpusat"
                  className="hidden sm:inline-flex h-10 w-10 rounded-full border border-white/25 bg-white/15 backdrop-blur-md hover:bg-white/25 text-[#FFFDF8] items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <Icon3D name="pengaturan" className="w-6 h-6 rounded-lg" />
                </button>
              )}
              <NotificationBell
                session={session}
                variant="dark"
                externalUnreadCount={unreadNotificationCount}
                onUnreadCountChange={setUnreadNotificationCount}
                onNavigateTarget={onNavigateTarget}
              />
            </div>
          </div>
        </header>

        {/* Pil Kaca Mengambang di Bawah Header Compact */}
        <div className="relative z-20 -mt-5 px-3.5 sm:px-5">
          <div className="max-w-3xl mx-auto rounded-full bg-[#FFFDF8]/95 backdrop-blur-xl border border-[#E6E2D6] shadow-[0_10px_24px_-10px_rgba(36,56,37,0.20)] px-2.5 py-1.5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
            >
              <UserAvatar
                name={session.nama_warga}
                src={effectiveAvatarUrl}
                size="xs"
                className="shrink-0 ring-1 ring-[#C6D2BF]"
              />
              <span className="text-xs font-bold text-[#1B271B] truncate">
                {compactIdentityLabel}
              </span>
            </button>
            <span className="shrink-0 px-3 py-1 rounded-full bg-[#2B3F29] text-[#FFFDF8] text-[11px] font-bold tracking-tight whitespace-nowrap">
              {currentMonthBadge}
            </span>
          </div>
        </div>
      </div>

      {/* HEADER DESKTOP BERSIH (lg+, sejajar konten di kanan sidebar 260px) */}
      <div className="hidden lg:block fixed top-0 left-[260px] right-0 z-30 px-8 pt-3 pointer-events-none no-print">
        <header className="max-w-7xl mx-auto rounded-2xl bg-[#FFFDF8]/92 backdrop-blur-xl border border-[#E6E2D6] shadow-[0_8px_24px_-10px_rgba(36,56,37,0.12)] px-5 py-2.5 flex items-center justify-between gap-4 pointer-events-auto">
          <div className="min-w-0">
            <p className="font-serif-brand text-base font-bold text-[#1B271B] leading-tight truncate">
              {activePageTitle}
            </p>
            <p className="text-[11px] font-medium text-[#6E786D] truncate">
              {isAdmin ? adminIdentityLabel : `Rumah Blok ${displayWargaBlok} · ${session.nama_warga}`}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {headerAction && <div className="shrink-0">{headerAction}</div>}

            <span className="px-3 py-1.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] text-xs font-bold whitespace-nowrap">
              {currentMonthBadge}
            </span>

            <NotificationBell
              session={session}
              variant="light"
              externalUnreadCount={unreadNotificationCount}
              onUnreadCountChange={setUnreadNotificationCount}
              onNavigateTarget={onNavigateTarget}
            />

            {isAdmin && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Pengaturan Sistem"
                title="Pengaturan Sistem Terpusat"
                className="h-10 w-10 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3] text-[#243825] inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Icon3D name="pengaturan" className="w-6 h-6 rounded-lg" />
              </button>
            )}

            <button
              type="button"
              onClick={handleOpenProfileFromSidebar}
              aria-label={`Profil ${session.nama_warga}`}
              className="flex items-center gap-2 p-1 pr-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 transition-colors cursor-pointer shrink-0"
            >
              <UserAvatar name={session.nama_warga} src={effectiveAvatarUrl} size="sm" />
              <span className="text-xs font-bold text-[#1B271B] max-w-[120px] truncate">
                {session.nama_warga}
              </span>
            </button>
          </div>
        </header>
      </div>

      {/* AREA KONTEN UTAMA (pb-28 agar tidak tertutup Bottom Nav maupun Floating Chat FAB) */}
      <main className="flex-1 lg:pl-[260px] px-3.5 pt-3.5 sm:px-6 lg:px-8 lg:pt-[5.5rem] pb-28 lg:pb-10 w-full max-w-full min-w-0 overflow-x-hidden">
        <div className="max-w-7xl mx-auto w-full min-w-0">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="w-full min-w-0"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

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
