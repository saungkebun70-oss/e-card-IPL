import React, { useEffect, useRef, useState } from 'react';
import {
  Bug,
  ChevronRight,
  FileCheck2,
  LogOut,
  Menu,
  Settings,
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
  const isPetugas = session.role === 'petugas';
  const canAccessBotWa = isBendaharaOnly(session);
  const adminIdentityLabel = `${session.nama_warga} — ${session.jabatan || 'Pengurus'}`;
  const isLpjActive = activeTab === 'lpj';
  const isBugReportsActive = activeTab === 'laporan_bug';
  const effectiveAvatarUrl = avatarUrl !== undefined ? avatarUrl : session.avatar_url || null;

  const desktopHeaderNavItems = isAdmin
    ? navItems.filter((item) => !item.isCenterFab)
    : navItems.slice(0, 5);

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

  const handleOpenLpj = () => {
    setDrawerOpen(false);
    onTabChange('lpj');
  };

  const handleOpenBugReports = () => {
    setDrawerOpen(false);
    onTabChange('laporan_bug');
  };

  const handleOpenSettingsFromSidebar = () => {
    setDrawerOpen(false);
    onOpenSettings?.();
  };

  const handleOpenProfileFromSidebar = () => {
    setDrawerOpen(false);
    onOpenProfile?.();
  };

  const handleLogoutFromSidebar = () => {
    setDrawerOpen(false);
    onLogout();
  };

  return (
    <div className="min-h-[100dvh] w-full max-w-full bg-gradient-to-br from-[#EEF2FF] via-[#F3E8FF] to-[#E0F2FE] glass-canvas text-[var(--theme-text)] flex flex-col overflow-x-hidden">
      {/* Slide-Over Menu Drawer Admin (Mobile, Tablet & Desktop — Akses LPJ, Laporan Bug & Pengaturan Sistem) */}
      <AnimatePresence>
        {drawerOpen && isAdmin && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu Tambahan Pengurus"
            className="fixed inset-0 z-[60] flex no-print"
          >
            {/* Backdrop Blur */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm"
            />

            {/* Panel Drawer Frosted Glass */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-[85vw] max-w-[336px] h-full bg-white/85 backdrop-blur-2xl rounded-r-3xl border-r border-white/90 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header Drawer Gradasi Ungu-Indigo Tema Aktif */}
              <div
                className="px-5 pt-[calc(max(env(safe-area-inset-top,0px),20px)+1rem)] pb-5 bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] text-white shrink-0"
                style={{ backgroundImage: 'var(--theme-hero-gradient)' }}
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <BrandLogo size="sm" variant="dark" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-tight truncate">
                        {brand?.app_name || 'e-Card IPL Saung Kebun'}
                      </p>
                      <p className="text-[11px] text-purple-100/80 truncate mt-0.5">
                        {brand?.app_subtitle || 'Perumahan Saung Kebun'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Tutup menu pengurus"
                    className="h-9 w-9 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 text-white flex items-center justify-center transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleOpenProfileFromSidebar}
                  className="mt-4 w-full text-left p-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/15 flex items-center gap-3 transition-colors cursor-pointer"
                >
                  <UserAvatar
                    name={session?.nama_warga || 'Pengurus'}
                    src={effectiveAvatarUrl}
                    size="md"
                    ringClassName="ring-2 ring-emerald-300/50"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white leading-tight truncate">
                      {session?.nama_warga || 'Pengurus'}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-emerald-200 truncate">
                      {session.jabatan || 'Pengurus'} ·{' '}
                      {session.admin_permission === 'full' ? 'Akses Penuh' : 'Akses Pengurus'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-purple-100 shrink-0" />
                </button>
              </div>

              {/* Isi Kelompok Menu */}
              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
                <div className="space-y-2">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Navigasi Cepat
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {navItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = item.id === activeTab;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setDrawerOpen(false);
                            onTabChange(item.id);
                          }}
                          className={`min-h-[42px] px-3 py-2 rounded-2xl border text-left flex items-center gap-2 text-xs font-semibold transition-all cursor-pointer ${
                            isActive
                              ? 'bg-[#4C1D95] text-white border-[#4C1D95] shadow-sm'
                              : 'bg-white/90 text-slate-700 border-slate-200/80 hover:bg-indigo-50/70'
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">
                            {item.id === 'dashboard' ? 'Dasbor' : item.shortLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Menu Laporan &amp; Dukungan
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenLpj}
                    className={`w-full text-left px-3.5 py-3 rounded-2xl shadow-xs border flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer ${
                        isLpjActive
                        ? 'bg-[#EDE9FE]/90 border-[#DDD6FE]'
                        : 'bg-white/80 backdrop-blur-md border-white/90 hover:bg-indigo-50/60'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isLpjActive
                          ? 'bg-[#4C1D95] text-white'
                          : 'bg-indigo-50 text-[#4C1D95]'
                      }`}
                    >
                      <FileCheck2 className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 leading-snug">
                        Laporan Pertanggungjawaban (LPJ)
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                        Rekapitulasi &amp; Cetak PDF A4
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenBugReports}
                    className={`w-full text-left px-3.5 py-3 rounded-2xl shadow-xs border flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer ${
                      isBugReportsActive
                        ? 'bg-[#EDE9FE]/90 border-[#DDD6FE]'
                        : 'bg-white/80 backdrop-blur-md border-white/90 hover:bg-indigo-50/60'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isBugReportsActive
                          ? 'bg-[#4C1D95] text-white'
                          : 'bg-rose-50 text-rose-600'
                      }`}
                    >
                      <Bug className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800 leading-snug">
                          Laporan Bug
                        </p>
                        {pendingBugCount > 0 && (
                          <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 tabular-nums">
                            {pendingBugCount}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                        Kendala &amp; Snapshot Error Pengguna
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                </div>

                {onOpenSettings && (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Menu Sistem
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenSettingsFromSidebar}
                      className="w-full text-left px-3.5 py-3 rounded-2xl shadow-xs border border-white/90 bg-white/80 backdrop-blur-md hover:bg-indigo-50/60 active:scale-[0.98] flex items-center gap-3 transition-all cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 leading-snug">
                          Pengaturan Sistem Terpusat
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                          {canAccessBotWa
                            ? 'Profil, Tema, Identitas, QRIS, Bot WA, Petugas & Log'
                            : 'Profil, Tema, Identitas, QRIS, Petugas & Log'}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </button>
                  </div>
                )}
              </div>

              {/* Footer Drawer */}
              <div className="mt-auto px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-slate-100 bg-slate-50/70 space-y-3 shrink-0">
                <AppVersionFooter compact className="px-1" />
                <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                  {brand.kop_resmi}
                </p>
                <button
                  type="button"
                  onClick={handleLogoutFromSidebar}
                  className="w-full py-2.5 px-4 rounded-2xl bg-red-50 text-red-600 hover:bg-red-100 active:scale-[0.98] font-semibold text-sm border border-red-100/80 inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Keluar / Logout</span>
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Glass Header Bar (Mobile, Tablet & Desktop) */}
      <div className="fixed top-0 left-0 right-0 z-40 px-3 sm:px-6 lg:px-8 pt-[calc(env(safe-area-inset-top,0px)+0.65rem)] pointer-events-none no-print">
        <header className="max-w-7xl mx-auto glass-header bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl px-3.5 sm:px-5 min-h-14 sm:min-h-16 py-2 flex flex-wrap lg:flex-nowrap items-center justify-between gap-x-3 gap-y-2 sm:gap-4 pointer-events-auto">
          {/* Zona 1: Brand Lockup (Kiri) */}
          <div className="flex flex-nowrap items-center gap-2.5 min-w-0 shrink-0">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Buka Menu Tambahan"
                title="Menu LPJ, Laporan Bug & Pengaturan"
                className="relative h-9 w-9 sm:h-10 sm:w-10 rounded-xl border border-indigo-200/70 bg-white/75 hover:bg-white text-[var(--theme-primary)] flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
                {pendingBugCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                    {pendingBugCount > 9 ? '9+' : pendingBugCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => onTabChange(isAdmin ? 'dashboard' : 'beranda')}
              className="flex flex-nowrap items-center gap-2.5 min-w-0 text-left cursor-pointer group"
            >
              <BrandLogo size="xs" className="shrink-0 sm:hidden" />
              <BrandLogo size="sm" className="shrink-0 hidden sm:flex" />
              <div className="min-w-0">
                <p className="text-[11px] sm:text-xs font-extrabold tracking-tight text-[var(--theme-text)] uppercase leading-tight whitespace-nowrap truncate max-w-[140px] sm:max-w-[185px]">
                  {brand.app_name || 'Perumahan Saung Kebun'}
                </p>
                <p className="text-[10px] sm:text-[11px] font-medium text-[var(--theme-text-muted)] leading-tight whitespace-nowrap truncate max-w-[140px] sm:max-w-[185px]">
                  {isAdmin
                    ? activePageTitle
                    : isPetugas
                      ? `Keamanan · ${activePageTitle}`
                      : `Blok ${session.blok_rumah} · ${activePageTitle}`}
                </p>
              </div>
            </button>
          </div>

          {/* Zona 2: Navigasi Horizontal Single-Line Desktop (>= 1024px) */}
          <nav
            aria-label="Navigasi Utama"
            className="hidden lg:flex items-center justify-center gap-4 xl:gap-6 min-w-0"
          >
            {desktopHeaderNavItems.map((item) => {
              const isActive = item.id === activeTab;
              const shortHeading = item.id === 'dashboard' ? 'Dasbor' : item.shortLabel;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={`relative py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                    isActive
                      ? 'text-[var(--theme-primary)]'
                      : 'text-[var(--theme-text-secondary)] hover:text-[var(--theme-text)]'
                  }`}
                >
                  <span>{shortHeading}</span>
                  {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                    <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 tabular-nums leading-none">
                      {item.badgeCount}
                    </span>
                  )}
                  {isActive && (
                    <motion.span
                      layoutId="desktop-top-nav-underline"
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      aria-hidden="true"
                      className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-full bg-[var(--theme-primary)]"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zona 3: Identitas Pengguna + Lonceng + Profil + Pengaturan/Keluar (Kanan) */}
          <div className="flex flex-nowrap items-center gap-1.5 sm:gap-2 shrink-0">
            {headerAction && <div className="shrink-0">{headerAction}</div>}

            {isAdmin && (
              <div className="hidden xl:flex flex-col items-end text-right mr-1 min-w-0 max-w-[200px]">
                <span className="text-xs font-bold text-[var(--theme-text)] leading-tight truncate max-w-full">
                  {session.nama_warga} —
                </span>
                <span className="text-[11px] font-medium text-[var(--theme-text-secondary)] leading-tight truncate max-w-full">
                  {session.jabatan || 'Pengurus Lingkungan'}
                </span>
              </div>
            )}

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
                className="hidden sm:inline-flex h-9 w-9 rounded-xl border border-indigo-200/70 bg-white/75 hover:bg-white text-[var(--theme-text-secondary)] hover:text-[var(--theme-primary)] items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <Settings className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenProfile?.()}
              aria-label={`Profil ${session.nama_warga}`}
              title={isAdmin ? adminIdentityLabel : 'Profil & Foto Akun'}
              className="flex flex-nowrap items-center gap-2 p-0.5 sm:pr-2.5 rounded-full border border-indigo-200/70 bg-white/80 hover:bg-white transition-colors cursor-pointer shrink-0"
            >
              <UserAvatar
                name={session.nama_warga}
                src={effectiveAvatarUrl}
                size="sm"
                className="shrink-0"
              />
              <span className="hidden md:inline xl:hidden text-xs font-semibold text-[var(--theme-text)] max-w-[100px] truncate">
                {session.nama_warga}
              </span>
            </button>

            {isAdmin && !headerAction && (
              <button
                type="button"
                onClick={onLogout}
                aria-label="Keluar dari Portal Admin"
                title="Keluar"
                className="hidden md:inline-flex h-9 px-3 rounded-xl border border-red-200/80 bg-white/80 hover:bg-red-50 text-xs font-semibold text-red-700 items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xl:inline">Keluar</span>
              </button>
            )}
          </div>
        </header>
      </div>

      {/* Area Konten Utama */}
      <main className="flex-1 px-3.5 sm:px-6 lg:px-8 pt-[calc(env(safe-area-inset-top,0px)+5.5rem)] sm:pt-[6rem] pb-[104px] md:pb-[108px] min-w-0 overflow-x-clip">
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

      {/* Floating Bottom Dock untuk Tablet & Desktop (>= 768px) */}
      <nav
        aria-label="Dock Navigasi Utama"
        className="hidden md:flex fixed bottom-4 left-1/2 -translate-x-1/2 z-40 glass-dock bg-white/80 backdrop-blur-xl border border-white/90 rounded-2xl px-2.5 py-1.5 items-center gap-1.5 max-w-[94vw] no-print"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === activeTab;
          const dockLabel = item.id === 'dashboard' ? 'Dasbor' : item.shortLabel;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`relative min-w-[76px] px-3.5 py-2 rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-150 active:scale-[0.96] cursor-pointer whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] shadow-xs'
                  : 'text-[var(--theme-text-secondary)] hover:bg-white/70 hover:text-[var(--theme-text)]'
              }`}
            >
              <div className="relative">
                <Icon className="w-[18px] h-[18px]" strokeWidth={isActive ? 2.4 : 2} />
                {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold font-mono flex items-center justify-center tabular-nums">
                    {item.badgeCount > 9 ? '9+' : item.badgeCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold leading-none">{dockLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom Navigation Bar Tetap untuk Mobile (< 768px) dengan Floating Center + Circle */}
      <nav
        aria-label="Navigasi Bawah Mobile"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/85 backdrop-blur-xl border-t border-white/90 shadow-[0_-8px_24px_-8px_rgba(79,70,229,0.14)] pb-[max(0.5rem,env(safe-area-inset-bottom))] no-print"
      >
        <div
          className={`grid ${
            navItems.length >= 6
              ? 'grid-cols-6'
              : navItems.length === 5
                ? 'grid-cols-5'
                : 'grid-cols-4'
          } h-[60px] max-w-md mx-auto items-end`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeTab;
            const isCompactSix = navItems.length >= 6;
            const mobileLabel = item.id === 'dashboard' ? 'Dasbor' : item.shortLabel;

            if (item.isCenterFab) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  aria-label={item.label}
                  className="relative flex flex-col items-center justify-end h-[60px] pb-2 px-0.5 cursor-pointer group min-w-0"
                >
                  <span
                    className={`${
                      isCompactSix ? 'w-11 h-11 -mt-5' : 'w-12 h-12 -mt-6'
                    } rounded-full border-[3.5px] border-white shadow-[0_8px_20px_-4px_rgba(76,29,149,0.45)] flex items-center justify-center transition-all group-active:scale-95 shrink-0 ${
                      isActive
                        ? 'bg-[var(--theme-cta-indigo)] text-white'
                        : 'bg-[var(--theme-primary)] text-white hover:opacity-95'
                    }`}
                  >
                    <Icon className={isCompactSix ? 'w-5 h-5' : 'w-5 h-5'} strokeWidth={2.5} />
                  </span>
                  <span
                    className={`text-[10px] font-bold mt-1 leading-none truncate max-w-full ${
                      isActive ? 'text-[var(--theme-primary)]' : 'text-[var(--theme-text-secondary)]'
                    }`}
                  >
                    {mobileLabel}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative flex flex-col items-center justify-end h-[60px] pb-2 px-0.5 transition-all duration-150 active:scale-[0.95] cursor-pointer min-w-0 ${
                  isActive
                    ? 'text-[var(--theme-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="bottom-nav-active-bar"
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    aria-hidden="true"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[var(--theme-primary)]"
                  />
                )}
                <div className="relative transition-transform duration-150">
                  <Icon
                    className={`w-[19px] h-[19px] transition-transform duration-150 ${isActive ? 'scale-105' : ''}`}
                    strokeWidth={isActive ? 2.4 : 1.9}
                  />
                  {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[15px] h-3.5 px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold font-mono flex items-center justify-center tabular-nums">
                      {item.badgeCount > 9 ? '9+' : item.badgeCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-semibold mt-1 leading-none truncate max-w-full">
                  {mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
