import React, { useEffect, useRef, useState } from 'react';
import {
  Bug,
  ChevronRight,
  FileCheck2,
  LogOut,
  Menu,
  PhoneCall,
  ReceiptText,
  Settings,
  UserCircle2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { isBendaharaOnly, type SessionUser } from '../types';
import { useAppBrand } from '../lib/brandContext';
import { BrandLogo } from './BrandLogo';
import { AppVersionFooter } from './AppUpdateSystem';
import { NotificationBell } from './NotificationBell';
import { UserAvatar } from './UserAvatar';
import {
  fetchUnreadNotificationCount,
  getCanonicalUserId,
  subscribeActivityNotificationsRealtime,
} from '../lib/notificationService';
import {
  fetchPendingBugReportCount,
  subscribeBugReportsRealtime,
} from '../lib/bugReportService';

export interface NavItem {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
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
  avatarUrl?: string | null;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({
  session,
  navItems,
  activeTab,
  onTabChange,
  onLogout,
  onOpenSettings,
  onOpenProfile,
  onNavigateTarget,
  avatarUrl,
  headerAction,
  children,
}: AppShellProps) {
  const { brand } = useAppBrand();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  const [pendingBugCount, setPendingBugCount] = useState<number>(0);

  const isAdmin = session.role === 'admin';
  const isWarga = session.role === 'warga';
  const isPetugas = session.role === 'petugas';
  const canAccessBotWa = isBendaharaOnly(session);
  const adminIdentityLabel = `${session.nama_warga} — ${session.jabatan || 'Pengurus'}`;
  const isLpjActive = activeTab === 'lpj';
  const isBugReportsActive = activeTab === 'laporan_bug';
  const isProfilActive = activeTab === 'profil';
  const effectiveAvatarUrl = avatarUrl !== undefined ? avatarUrl : session.avatar_url || null;

  // Batasi dock bawah maksimal 5 ikon agar Dual-Ring Floating Orb Dock selalu simetris
  const bottomDockItems = navItems.slice(0, 5);

  const sessionRef = useRef<SessionUser>(session);
  sessionRef.current = session;
  const sessionKey = getCanonicalUserId(session);

  // Ambil jumlah notifikasi belum dibaca (is_read = false) langsung dari tabel `notifications` untuk badge Lonceng Header
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

  const roleSubtitleLabel = isAdmin
    ? `${session.jabatan || 'Pengurus'} · ${session.admin_permission === 'full' ? 'Akses Penuh' : 'Pengurus'}`
    : isPetugas
      ? `Keamanan · ${session.shift || 'Petugas'}`
      : `Warga · Blok ${session.blok_rumah}`;

  const renderSidebarNavigation = () => (
    <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-5">
      {/* Daftar Menu Utama */}
      <div className="space-y-1">
        <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
              className={`w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm transition-all duration-150 cursor-pointer ${
                isActive
                  ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 text-[#312E81] font-bold border border-sky-200/80 shadow-2xs'
                  : 'text-slate-600 font-medium hover:bg-white/80 hover:text-[#0F172A] border border-transparent'
              }`}
            >
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                  isActive
                    ? 'bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white shadow-xs'
                    : 'bg-slate-100/80 text-slate-500'
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={isActive ? 2.4 : 2} />
              </span>
              <span className="truncate flex-1">{labelText}</span>
              {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 tabular-nums shrink-0">
                  {item.badgeCount > 9 ? '9+' : item.badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Menu Tambahan Sesuai Role (Di Luar 5 Ikon Bawah) */}
      <div className="space-y-1">
        <p className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {isAdmin ? 'Laporan & Pengaturan' : 'Profil & Layanan'}
        </p>

        {isAdmin ? (
          <>
            <button
              type="button"
              onClick={() => handleSelectNav('lpj')}
              className={`w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm transition-all duration-150 cursor-pointer ${
                isLpjActive
                  ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 text-[#312E81] font-bold border border-sky-200/80 shadow-2xs'
                  : 'text-slate-600 font-medium hover:bg-white/80 hover:text-[#0F172A] border border-transparent'
              }`}
            >
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isLpjActive
                    ? 'bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white shadow-xs'
                    : 'bg-indigo-50 text-[#312E81]'
                }`}
              >
                <FileCheck2 className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight">Laporan LPJ (PDF)</p>
                <p className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
                  Rekap Triwulanan A4
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectNav('laporan_bug')}
              className={`w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm transition-all duration-150 cursor-pointer ${
                isBugReportsActive
                  ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 text-[#312E81] font-bold border border-sky-200/80 shadow-2xs'
                  : 'text-slate-600 font-medium hover:bg-white/80 hover:text-[#0F172A] border border-transparent'
              }`}
            >
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isBugReportsActive
                    ? 'bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white shadow-xs'
                    : 'bg-rose-50 text-rose-600'
                }`}
              >
                <Bug className="w-4 h-4" />
              </span>
              <span className="truncate flex-1">Laporan Bug</span>
              {pendingBugCount > 0 && (
                <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 tabular-nums shrink-0">
                  {pendingBugCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={handleOpenProfileFromSidebar}
              className="w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm font-medium text-slate-600 hover:bg-white/80 hover:text-[#0F172A] border border-transparent transition-all duration-150 cursor-pointer"
            >
              <span className="w-8 h-8 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center shrink-0">
                <UserCircle2 className="w-4 h-4" />
              </span>
              <span className="truncate flex-1">Profil Pengurus</span>
            </button>

            {onOpenSettings && (
              <button
                type="button"
                onClick={handleOpenSettingsFromSidebar}
                className="w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm font-medium text-slate-600 hover:bg-white/80 hover:text-[#0F172A] border border-transparent transition-all duration-150 cursor-pointer"
              >
                <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <Settings className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate leading-tight">Pengaturan Sistem</p>
                  <p className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
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
              className={`w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm transition-all duration-150 cursor-pointer ${
                isProfilActive
                  ? 'bg-gradient-to-r from-[#312E81]/12 via-[#1D4ED8]/10 to-[#0284C7]/12 text-[#312E81] font-bold border border-sky-200/80 shadow-2xs'
                  : 'text-slate-600 font-medium hover:bg-white/80 hover:text-[#0F172A] border border-transparent'
              }`}
            >
              <span
                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isProfilActive
                    ? 'bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white shadow-xs'
                    : 'bg-sky-50 text-sky-700'
                }`}
              >
                <UserCircle2 className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate leading-tight">Profil Warga</p>
                <p className="text-[11px] text-slate-400 font-normal truncate mt-0.5">
                  Foto, PIN, Tema &amp; Notifikasi
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectNav('riwayat')}
              className="w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm font-medium text-slate-600 hover:bg-white/80 hover:text-[#0F172A] border border-transparent transition-all duration-150 cursor-pointer"
            >
              <span className="w-8 h-8 rounded-xl bg-indigo-50 text-[#312E81] flex items-center justify-center shrink-0">
                <ReceiptText className="w-4 h-4" />
              </span>
              <span className="truncate flex-1">Kwitansi Digital</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectNav('lingkungan')}
              className="w-full min-h-[42px] px-3 py-2.5 rounded-2xl text-left flex items-center gap-3 text-sm font-medium text-slate-600 hover:bg-white/80 hover:text-[#0F172A] border border-transparent transition-all duration-150 cursor-pointer"
            >
              <span className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <PhoneCall className="w-4 h-4" />
              </span>
              <span className="truncate flex-1">Hubungi Pengurus</span>
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] w-full max-w-full bg-gradient-to-br from-[#EEF2FF] via-[#F3E8FF] to-[#E0F2FE] glass-canvas text-[var(--theme-text)] flex flex-col overflow-x-hidden">
      {/* SIDEBAR KACA ESTETIK TETAP — DESKTOP (lg+, lebar 260px) */}
      <aside
        aria-label="Navigasi Sidebar Utama"
        className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-[260px] z-30 bg-white/75 backdrop-blur-2xl border-r border-white/85 shadow-[8px_0_32px_-16px_rgba(49,46,129,0.12)] no-print"
      >
        {/* Brand Header Sidebar */}
        <div className="px-4 pt-5 pb-4 border-b border-indigo-100/70 shrink-0">
          <button
            type="button"
            onClick={() => handleSelectNav(isAdmin ? 'dashboard' : 'beranda')}
            className="w-full flex items-center gap-3 text-left cursor-pointer group"
          >
            <BrandLogo size="md" variant="light" className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-extrabold tracking-tight text-[#0F172A] leading-tight truncate">
                {brand.app_name || 'Perumahan Saung Kebun'}
              </p>
              <p className="text-[11px] font-medium text-slate-500 truncate mt-0.5">
                {isAdmin ? 'Portal Pengurus' : 'Portal Warga IPL'}
              </p>
            </div>
          </button>
        </div>

        {/* Daftar Menu Lengkap di Tengah */}
        {renderSidebarNavigation()}

        {/* Kartu Mini Profil Pengguna Aktif + Logout di Bawah Sidebar */}
        <div className="mt-auto px-3.5 pt-3 pb-4 border-t border-indigo-100/70 bg-white/45 space-y-2.5 shrink-0">
          <button
            type="button"
            onClick={handleOpenProfileFromSidebar}
            className="w-full p-2.5 rounded-2xl bg-white/80 hover:bg-white border border-white/90 shadow-2xs flex items-center gap-2.5 text-left transition-colors cursor-pointer"
          >
            <UserAvatar
              name={session.nama_warga}
              src={effectiveAvatarUrl}
              size="sm"
              className="shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#0F172A] truncate leading-tight">
                {session.nama_warga}
              </p>
              <p className="text-[11px] text-slate-500 truncate mt-0.5 leading-tight">
                {roleSubtitleLabel}
              </p>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={handleLogoutFromSidebar}
            className="w-full min-h-[40px] px-3.5 rounded-2xl bg-red-50/90 hover:bg-red-100 text-red-600 border border-red-100 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.98]"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Keluar / Logout</span>
          </button>

          <AppVersionFooter compact className="px-1 pt-0.5" />
        </div>
      </aside>

      {/* SLIDE-OVER GLASS SIDEBAR — MOBILE & TABLET (< lg) UNTUK SEMUA ROLE */}
      <AnimatePresence>
        {drawerOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu Sidebar & Profil"
            className="lg:hidden fixed inset-0 z-[60] flex no-print"
          >
            {/* Backdrop Blur */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm"
            />

            {/* Panel Drawer Frosted Spatial Glass */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-[84vw] max-w-[320px] h-full bg-white/85 backdrop-blur-2xl rounded-r-3xl border-r border-white/90 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header Drawer + Kartu Profil Lengkap */}
              <div
                className="px-4 pt-[calc(max(env(safe-area-inset-top,0px),18px)+0.75rem)] pb-4 bg-gradient-to-tr from-[#312E81] via-[#3730A3] to-[#0284C7] text-white shrink-0"
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <BrandLogo size="md" variant="dark" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-tight truncate">
                        {brand?.app_name || 'Perumahan Saung Kebun'}
                      </p>
                      <p className="text-[11px] text-sky-100/90 truncate mt-0.5">
                        {brand?.app_subtitle || 'e-Card Verifikasi & IPL Digital'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Tutup menu sidebar"
                    className="h-9 w-9 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 text-white flex items-center justify-center transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Kartu Profil Lengkap Pengguna */}
                <button
                  type="button"
                  onClick={handleOpenProfileFromSidebar}
                  className="mt-4 w-full text-left p-3 rounded-2xl bg-white/15 hover:bg-white/20 border border-white/20 flex items-center gap-3 transition-colors cursor-pointer"
                >
                  <UserAvatar
                    name={session?.nama_warga || 'Pengguna'}
                    src={effectiveAvatarUrl}
                    size="md"
                    ringClassName="ring-2 ring-sky-200/70"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white leading-tight truncate">
                      {session?.nama_warga || 'Pengguna'}
                    </p>
                    <p className="mt-0.5 text-[11px] font-medium text-sky-100 truncate">
                      {roleSubtitleLabel}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-sky-100 shrink-0" />
                </button>
              </div>

              {/* Menu Utama & Menu Tambahan */}
              {renderSidebarNavigation()}

              {/* Footer Drawer + Logout */}
              <div className="mt-auto px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-indigo-100/80 bg-white/60 space-y-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleLogoutFromSidebar}
                  className="w-full min-h-[44px] px-4 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 active:scale-[0.98] font-semibold text-sm border border-red-100 inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
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

      {/* FLOATING GLASS HEADER BAR (Offset lg:left-[260px] pada Desktop) */}
      <div className="fixed top-0 left-0 right-0 lg:left-[260px] z-40 px-3 sm:px-6 lg:px-8 pt-[calc(env(safe-area-inset-top,0px)+0.65rem)] pointer-events-none no-print">
        <header className="max-w-7xl mx-auto glass-header bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl px-3.5 sm:px-5 min-h-14 sm:min-h-16 py-2 flex flex-nowrap items-center justify-between gap-2.5 sm:gap-4 pointer-events-auto">
          {/* Zona Kiri: Tombol Menu Sidebar (Mobile/Tablet) + Brand/Judul Halaman */}
          <div className="flex flex-nowrap items-center gap-2.5 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka Menu Sidebar"
              title="Menu Profil, Layanan & Keluar"
              className="lg:hidden relative h-10 w-10 rounded-xl border border-indigo-200/70 bg-white/80 hover:bg-white text-[#312E81] flex items-center justify-center transition-colors cursor-pointer shrink-0 active:scale-95"
            >
              <Menu className="w-5 h-5" />
              {isAdmin && pendingBugCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                  {pendingBugCount > 9 ? '9+' : pendingBugCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onTabChange(isAdmin ? 'dashboard' : 'beranda')}
              className="flex flex-nowrap items-center gap-2.5 min-w-0 text-left cursor-pointer group"
            >
              <span className="lg:hidden shrink-0 flex">
                <BrandLogo size="xs" className="shrink-0 sm:hidden" />
                <BrandLogo size="sm" className="shrink-0 hidden sm:flex" />
              </span>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-extrabold tracking-tight text-[var(--theme-text)] leading-tight truncate">
                  <span className="lg:hidden">{brand.app_name || 'Perumahan Saung Kebun'}</span>
                  <span className="hidden lg:inline">{activePageTitle}</span>
                </p>
                <p className="text-[11px] font-medium text-[var(--theme-text-muted)] leading-tight truncate">
                  <span className="lg:hidden">
                    {isAdmin
                      ? activePageTitle
                      : isPetugas
                        ? `Keamanan · ${activePageTitle}`
                        : `Blok ${session.blok_rumah} · ${activePageTitle}`}
                  </span>
                  <span className="hidden lg:inline">
                    {isAdmin
                      ? adminIdentityLabel
                      : `Rumah Blok ${session.blok_rumah} · ${session.nama_warga}`}
                  </span>
                </p>
              </div>
            </button>
          </div>

          {/* Zona Kanan: Lonceng Notifikasi + Pengaturan Cepat + Avatar Profil */}
          <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 shrink-0">
            {headerAction && <div className="shrink-0">{headerAction}</div>}

            <div className="inline-flex items-center visible opacity-100 shrink-0">
              <NotificationBell
                session={session}
                variant="light"
                externalUnreadCount={unreadNotificationCount}
                onUnreadCountChange={setUnreadNotificationCount}
                onNavigateTarget={onNavigateTarget}
              />
            </div>

            {isAdmin && onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                aria-label="Pengaturan Sistem"
                title="Pengaturan Sistem Terpusat"
                className="hidden sm:inline-flex h-9 w-9 rounded-xl border border-indigo-200/70 bg-white/80 hover:bg-white text-[var(--theme-text-secondary)] hover:text-[#312E81] items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setDrawerOpen(true);
                } else {
                  handleOpenProfileFromSidebar();
                }
              }}
              aria-label={`Profil ${session.nama_warga}`}
              title={isAdmin ? adminIdentityLabel : 'Profil & Akun'}
              className="flex flex-nowrap items-center gap-2 p-0.5 sm:pr-2.5 rounded-full border border-indigo-200/70 bg-white/85 hover:bg-white transition-colors cursor-pointer shrink-0"
            >
              <UserAvatar
                name={session.nama_warga}
                src={effectiveAvatarUrl}
                size="sm"
                className="shrink-0"
              />
              <span className="hidden sm:inline text-xs font-semibold text-[var(--theme-text)] max-w-[110px] truncate">
                {session.nama_warga}
              </span>
            </button>
          </div>
        </header>
      </div>

      {/* AREA KONTEN UTAMA (pb-28 agar tidak tertutup Dual-Ring Floating Orb Dock) */}
      <main className="flex-1 lg:pl-[260px] px-3.5 sm:px-6 lg:px-8 pt-[calc(env(safe-area-inset-top,0px)+5.5rem)] sm:pt-[6rem] pb-28 lg:pb-10 min-w-0 overflow-x-clip">
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

      {/* 7. DUAL-RING FLOATING ORB DOCK — MOBILE & TABLET (< lg, Maksimal 5 Ikon) */}
      <nav
        aria-label="Navigasi Bawah Floating Orb Dock"
        className="lg:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-4 max-w-md mx-auto rounded-full bg-white/80 backdrop-blur-2xl border border-white/90 shadow-[0_14px_38px_-8px_rgba(49,46,129,0.22),0_4px_14px_-2px_rgba(2,132,199,0.16)] px-3 sm:px-4 py-2 grid grid-cols-5 items-center z-40 no-print"
      >
        {bottomDockItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTab;
          const dockLabel = item.id === 'dashboard' ? 'Dasbor' : item.shortLabel;

          if (item.isCenterFab) {
            return (
              <div key={item.id} className="flex flex-col items-center justify-center relative">
                <button
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  aria-label={item.label}
                  title={item.label}
                  className={`w-16 h-16 -mt-8 rounded-full bg-gradient-to-tr from-[#312E81] to-[#0284C7] text-white shadow-xl shadow-sky-900/25 flex flex-col items-center justify-center gap-0.5 ring-4 ring-white/90 relative cursor-pointer transition-all duration-200 active:scale-95 before:content-[''] before:absolute before:-inset-1.5 before:rounded-full before:border before:border-sky-400/40 before:bg-sky-400/10 before:-z-10 ${
                    isActive ? 'scale-[1.04] shadow-sky-500/35' : 'hover:scale-[1.02]'
                  }`}
                >
                  <Icon className="w-6 h-6 shrink-0" strokeWidth={2.4} />
                  <span className="text-[9px] font-bold tracking-wide leading-none text-sky-50">
                    {dockLabel}
                  </span>
                </button>
                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full mt-1.5 transition-all duration-200 ${
                    isActive
                      ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)] opacity-100 scale-100'
                      : 'bg-transparent opacity-0 scale-0'
                  }`}
                />
              </div>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`relative flex flex-col items-center justify-center py-0.5 px-0.5 transition-all duration-150 active:scale-[0.94] cursor-pointer min-w-0 ${
                isActive ? 'text-[#312E81]' : 'text-slate-500 hover:text-[#312E81]'
              }`}
            >
              <div className="relative">
                <Icon
                  className={`w-[20px] h-[20px] transition-transform duration-150 ${
                    isActive ? 'scale-105' : ''
                  }`}
                  strokeWidth={isActive ? 2.4 : 1.9}
                />
                {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[15px] h-3.5 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold font-mono flex items-center justify-center tabular-nums shadow-xs">
                    {item.badgeCount > 9 ? '9+' : item.badgeCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] mt-1 leading-none truncate max-w-full ${
                  isActive ? 'font-bold text-[#312E81]' : 'font-medium text-slate-600'
                }`}
              >
                {dockLabel}
              </span>
              <span
                aria-hidden="true"
                className={`w-1.5 h-1.5 rounded-full mt-1 transition-all duration-200 ${
                  isActive
                    ? 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.95)] opacity-100 scale-100'
                    : 'bg-transparent opacity-0 scale-0'
                }`}
              />
            </button>
          );
        })}
      </nav>
    </div>
  );
}
