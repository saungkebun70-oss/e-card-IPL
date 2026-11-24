import React, { useEffect, useState } from 'react';
import {
  Bug,
  ChevronRight,
  FileCheck2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState<number>(0);
  const [pendingBugCount, setPendingBugCount] = useState<number>(0);

  const isAdmin = session.role === 'admin';
  const isPetugas = session.role === 'petugas';
  const canAccessBotWa = isBendaharaOnly(session);
  const adminIdentityLabel = `${session.nama_warga} — ${session.jabatan || 'Pengurus'}`;
  const isLpjActive = activeTab === 'lpj';
  const isBugReportsActive = activeTab === 'laporan_bug';
  const effectiveAvatarUrl = avatarUrl !== undefined ? avatarUrl : session.avatar_url || null;

  // Ambil jumlah notifikasi belum dibaca (is_read = false) langsung dari tabel `notifications` untuk badge Lonceng Header
  useEffect(() => {
    let active = true;
    const syncUnreadCount = async () => {
      const count = await fetchUnreadNotificationCount(session);
      if (active) {
        setUnreadNotificationCount(count);
      }
    };

    void syncUnreadCount();
    const unsub = subscribeActivityNotificationsRealtime(session, () => {
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
  }, [session]);

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
    <div className="min-h-[100dvh] w-full max-w-full bg-[#F8FAFC] text-[#0F172A] flex flex-col lg:flex-row overflow-x-hidden">
      {/* Desktop Sidebar Tetap (>= 1024px) — Mendukung mode Collapsed tanpa menggeser Header */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 bg-[#0F172A] text-white border-r border-slate-800 z-30 transition-[width] duration-200 ease-out no-print ${
          sidebarCollapsed ? 'lg:w-20' : 'lg:w-72'
        }`}
      >
        <div
          className={`h-16 border-b border-slate-800 flex items-center shrink-0 ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4 gap-2'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo size="sm" variant="dark" className="shrink-0" />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-tight text-white truncate">
                  {brand.app_name}
                </p>
                <p className="text-[11px] text-slate-400 truncate">{brand.app_subtitle}</p>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(true)}
              aria-label="Perkecil sidebar"
              title="Perkecil sidebar"
              className="w-8 h-8 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Info Akun Aktif (Klik untuk buka Profil & Foto Akun) */}
        <button
          type="button"
          onClick={handleOpenProfileFromSidebar}
          title="Buka Profil & Foto Akun"
          className={`w-full text-left border-b border-slate-800/80 bg-slate-900/50 hover:bg-slate-800/60 transition-colors cursor-pointer shrink-0 ${
            sidebarCollapsed
              ? 'py-3.5 px-2 flex flex-col items-center gap-2'
              : 'px-4 py-3.5 flex items-center gap-3'
          }`}
        >
          <UserAvatar
            name={session.nama_warga}
            src={effectiveAvatarUrl}
            size="md"
            ringClassName="ring-2 ring-emerald-500/35"
          />
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-slate-400 truncate">
                {isAdmin
                  ? 'Pengurus Aktif'
                  : isPetugas
                    ? 'Petugas Keamanan Aktif'
                    : 'Unit Rumah Terverifikasi'}
              </p>
              <p className="text-sm font-bold text-white mt-0.5 leading-snug truncate">
                {isAdmin ? adminIdentityLabel : session.nama_warga}
              </p>
              <p className="text-xs font-mono text-emerald-400 mt-0.5 truncate">
                {isAdmin
                  ? session.admin_permission === 'full'
                    ? 'Bendahara · Akses Penuh'
                    : `${session.jabatan || 'Pengurus'} · Akses Tambah Data`
                  : isPetugas
                    ? `Keamanan · ${session.jabatan || session.blok_rumah || 'Petugas'}`
                    : `Blok ${session.blok_rumah}`}
              </p>
            </div>
          )}
        </button>

        {/* Tombol Perluas saat Sidebar Collapsed */}
        {sidebarCollapsed && (
          <div className="px-2 pt-3 flex justify-center shrink-0">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Perluas sidebar"
              title="Perluas sidebar"
              className="w-10 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Menu Navigasi Desktop */}
        <nav aria-label="Navigasi Utama" className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          <div className="space-y-1">
            {!sidebarCollapsed && (
              <p className="px-3 text-[11px] font-semibold text-slate-400 mb-1.5">Menu Utama</p>
            )}
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={sidebarCollapsed ? item.label : undefined}
                  onClick={() => onTabChange(item.id)}
                  className={`relative w-full min-h-[44px] flex items-center ${
                    sidebarCollapsed ? 'justify-center px-2' : 'justify-between gap-3 px-3.5'
                  } py-2.5 rounded-xl text-sm font-medium transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#059669] text-white shadow-xs'
                      : item.isCenterFab
                        ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/70 hover:bg-emerald-900/70 hover:text-white'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {typeof item.badgeCount === 'number' &&
                    item.badgeCount > 0 &&
                    (sidebarCollapsed ? (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400" />
                    ) : (
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md ${
                          isActive ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {item.badgeCount}
                      </span>
                    ))}
                </button>
              );
            })}
          </div>

          {isAdmin && (
            <>
              {/* Kelompok Menu Laporan (LPJ) */}
              <div className="space-y-1 pt-2 border-t border-slate-800/80">
                {!sidebarCollapsed && (
                  <p className="px-3 text-[11px] font-semibold text-slate-400 mb-1.5">Menu Laporan</p>
                )}
                <button
                  type="button"
                  title={sidebarCollapsed ? 'Laporan Pertanggungjawaban (LPJ)' : undefined}
                  onClick={handleOpenLpj}
                  className={`w-full text-left rounded-xl flex ${
                    sidebarCollapsed
                      ? 'items-center justify-center min-h-[44px] px-2'
                      : 'items-start gap-3 px-3.5 py-2.5'
                  } transition-all duration-200 active:scale-[0.97] cursor-pointer ${
                    isLpjActive
                      ? 'bg-[#059669] text-white'
                      : 'text-slate-200 hover:bg-slate-800/80'
                  }`}
                >
                  <FileCheck2
                    className={`w-4 h-4 shrink-0 ${!sidebarCollapsed ? 'mt-0.5' : ''} ${
                      isLpjActive ? 'text-white' : 'text-emerald-400'
                    }`}
                  />
                  {!sidebarCollapsed && (
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug">
                        Laporan Pertanggungjawaban (LPJ)
                      </p>
                      <p
                        className={`text-[11px] mt-0.5 leading-snug ${
                          isLpjActive ? 'text-emerald-100' : 'text-slate-400'
                        }`}
                      >
                        Rekapitulasi &amp; Cetak PDF A4
                      </p>
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  title={sidebarCollapsed ? 'Laporan Bug' : undefined}
                  onClick={handleOpenBugReports}
                  className={`relative w-full text-left rounded-xl flex ${
                    sidebarCollapsed
                      ? 'items-center justify-center min-h-[44px] px-2'
                      : 'items-start gap-3 px-3.5 py-2.5'
                  } transition-all duration-200 active:scale-[0.97] cursor-pointer ${
                    isBugReportsActive
                      ? 'bg-[#059669] text-white'
                      : 'text-slate-200 hover:bg-slate-800/80'
                  }`}
                >
                  <Bug
                    className={`w-4 h-4 shrink-0 ${!sidebarCollapsed ? 'mt-0.5' : ''} ${
                      isBugReportsActive ? 'text-white' : 'text-rose-400'
                    }`}
                  />
                  {!sidebarCollapsed && (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug truncate">
                          Laporan Bug
                        </p>
                        {pendingBugCount > 0 && (
                          <span
                            className={`font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md shrink-0 ${
                              isBugReportsActive
                                ? 'bg-white/20 text-white'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {pendingBugCount}
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-[11px] mt-0.5 leading-snug ${
                          isBugReportsActive ? 'text-emerald-100' : 'text-slate-400'
                        }`}
                      >
                        Kendala &amp; Snapshot Error Pengguna
                      </p>
                    </div>
                  )}
                  {sidebarCollapsed && pendingBugCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-400" />
                  )}
                </button>
              </div>

              {/* Kelompok Menu Sistem (Pengaturan Terpusat) */}
              {onOpenSettings && (
                <div className="space-y-1 pt-2 border-t border-slate-800/80">
                  {!sidebarCollapsed && (
                    <p className="px-3 text-[11px] font-semibold text-slate-400 mb-1.5">
                      Menu Sistem
                    </p>
                  )}
                  <button
                    type="button"
                    title={sidebarCollapsed ? 'Pengaturan Sistem Terpusat' : undefined}
                    onClick={handleOpenSettingsFromSidebar}
                    className={`w-full text-left rounded-xl flex ${
                      sidebarCollapsed
                        ? 'items-center justify-center min-h-[44px] px-2'
                        : 'items-start gap-3 px-3.5 py-2.5'
                    } text-slate-200 hover:bg-slate-800/80 transition-all duration-200 active:scale-[0.97] cursor-pointer`}
                  >
                    <Settings
                      className={`w-4 h-4 shrink-0 text-emerald-400 ${!sidebarCollapsed ? 'mt-0.5' : ''}`}
                    />
                    {!sidebarCollapsed && (
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug">
                          Pengaturan Sistem Terpusat
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {canAccessBotWa
                            ? 'Profil, Tema, Identitas, QRIS, Bot WA, Petugas & Log'
                            : 'Profil, Tema, Identitas, QRIS, Petugas & Log'}
                        </p>
                      </div>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </nav>

        {/* Footer Sidebar Desktop */}
        <div className="p-3 border-t border-slate-800 space-y-2.5 shrink-0">
          {!sidebarCollapsed && (
            <p className="text-[11px] text-slate-400 leading-relaxed px-2">{brand.kop_resmi}</p>
          )}
          <button
            type="button"
            title={sidebarCollapsed ? 'Keluar / Logout' : undefined}
            onClick={onLogout}
            className="w-full min-h-[42px] flex items-center justify-center gap-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-200 hover:text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Keluar / Logout</span>}
          </button>
        </div>
      </aside>

      {/* Slide-Over Sidebar Drawer (Mobile & Tablet < 1024px) — Overlay Penuh Tanpa Menggeser Header */}
      <AnimatePresence>
        {drawerOpen && isAdmin && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu Sidebar Pengurus"
            className="lg:hidden fixed inset-0 z-[60] flex no-print"
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

            {/* Panel Sidebar Slide-Over Modern */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-[84vw] max-w-[324px] h-full bg-white/95 backdrop-blur-xl rounded-r-3xl border-r border-slate-200/80 shadow-2xl flex flex-col overflow-hidden"
            >
              {/* Header Sidebar dengan Jarak Aman Atas & Gradasi Halus Sesuai Tema */}
              <div
                className="px-5 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1rem)] pb-5 text-white shrink-0"
                style={{
                  backgroundImage:
                    'linear-gradient(135deg, var(--theme-accent) 0%, var(--theme-accent-2) 100%)',
                }}
              >
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <BrandLogo size="sm" variant="dark" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-tight truncate">
                        {brand?.app_name || 'e-Card IPL Saung Kebun'}
                      </p>
                      <p className="text-[11px] text-slate-300/80 truncate mt-0.5">
                        Perumahan Saung Kebun
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    aria-label="Tutup menu sidebar"
                    className="h-9 w-9 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-slate-200 flex items-center justify-center transition cursor-pointer shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Kartu Profil Elegan — Avatar Foto / Inisial + Nama + Status */}
                <button
                  type="button"
                  onClick={handleOpenProfileFromSidebar}
                  className="mt-4 w-full text-left p-3 rounded-2xl bg-white/[0.08] hover:bg-white/[0.13] border border-white/10 flex items-center gap-3 transition-colors cursor-pointer"
                >
                  <UserAvatar
                    name={session?.nama_warga || 'Pengurus'}
                    src={effectiveAvatarUrl}
                    size="md"
                    ringClassName="ring-2 ring-emerald-400/40"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white leading-tight truncate">
                      {session?.nama_warga || 'Pengurus'}
                    </p>
                    <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/25 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200 max-w-full">
                      <span
                        aria-hidden="true"
                        className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                      />
                      <span className="truncate">
                        {session.jabatan || 'Pengurus'} •{' '}
                        {session.admin_permission === 'full' ? 'Akses Penuh' : 'Akses Pengurus'}
                      </span>
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </button>
              </div>

              {/* Isi Kelompok Menu Sidebar */}
              <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
                {/* Kelompok 1: Menu Laporan */}
                <div className="space-y-2">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Menu Laporan
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenLpj}
                    className={`w-full text-left px-3.5 py-3 rounded-2xl shadow-sm border flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer ${
                      isLpjActive
                        ? 'bg-emerald-50/90 border-emerald-200'
                        : 'bg-white border-slate-100 hover:bg-slate-50/80'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isLpjActive
                          ? 'bg-[#059669] text-white'
                          : 'bg-emerald-50 text-emerald-600'
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
                    className={`w-full text-left px-3.5 py-3 rounded-2xl shadow-sm border flex items-center gap-3 active:scale-[0.98] transition-all cursor-pointer ${
                      isBugReportsActive
                        ? 'bg-emerald-50/90 border-emerald-200'
                        : 'bg-white border-slate-100 hover:bg-slate-50/80'
                    }`}
                  >
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isBugReportsActive
                          ? 'bg-[#059669] text-white'
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
                          <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded-md bg-rose-100 text-rose-700 tabular-nums">
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

                {/* Kelompok 2: Menu Sistem */}
                {onOpenSettings && (
                  <div className="space-y-2">
                    <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Menu Sistem
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenSettingsFromSidebar}
                      className="w-full text-left px-3.5 py-3 rounded-2xl shadow-sm border border-slate-100 bg-white hover:bg-slate-50/80 active:scale-[0.98] flex items-center gap-3 transition-all cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-xl bg-sky-50 text-slate-700 flex items-center justify-center shrink-0">
                        <Settings className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-800 leading-snug">
                          Pengaturan Sistem Terpusat
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                          {canAccessBotWa
                            ? 'Profil, Identitas, QRIS, Bot WA, Petugas & PIN'
                            : 'Profil, Identitas, QRIS, Petugas & PIN'}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </button>
                  </div>
                )}
              </div>

              {/* Footer Dasar Sidebar */}
              <div className="mt-auto px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-slate-100 bg-slate-50/70 space-y-3 shrink-0">
                <AppVersionFooter compact className="px-1" />
                <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                  {brand.kop_resmi}
                </p>
                <button
                  type="button"
                  onClick={handleLogoutFromSidebar}
                  className="w-full py-2.5 px-4 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 active:scale-[0.98] font-medium text-sm border border-red-100/80 inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4 shrink-0" />
                  <span>Keluar / Logout</span>
                </button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Area Kerja Utama */}
      <div
        className={`flex-1 flex flex-col min-w-0 overflow-x-hidden transition-[padding] duration-200 ease-out ${
          sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-72'
        }`}
      >
        {/* Header Tetap & Anti-Geser (Fixed Top-0, Tinggi Konstan h-16, Flex-Nowrap) */}
        <header
          className={`fixed top-0 left-0 right-0 z-40 h-[calc(4rem+env(safe-area-inset-top,0px))] lg:h-16 pt-[env(safe-area-inset-top,0px)] lg:pt-0 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-6 lg:px-8 flex items-center transition-[left] duration-200 ease-out no-print ${
            sidebarCollapsed ? 'lg:left-20' : 'lg:left-72'
          }`}
        >
          <div className="max-w-7xl w-full mx-auto flex flex-nowrap items-center justify-between gap-2 sm:gap-3 min-w-0">
            {/* Kiri: Hamburger (Mobile Admin) + Logo Saung Kebun + Judul Halaman */}
            <div className="flex flex-nowrap items-center gap-2 sm:gap-3 min-w-0 flex-1">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Buka Menu Sidebar"
                  title="Buka Menu Sidebar"
                  className="lg:hidden h-10 w-10 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[#0F172A] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <Menu className="w-5 h-5" />
                </button>
              )}

              <BrandLogo size="xs" className="lg:hidden shrink-0" />

              <div className="min-w-0 flex-1">
                {isAdmin ? (
                  <>
                    <p className="text-[11px] sm:text-xs font-semibold text-emerald-700 leading-tight truncate">
                      {adminIdentityLabel}
                    </p>
                    <h1 className="text-sm sm:text-base lg:text-lg font-bold text-[#0F172A] tracking-tight leading-tight truncate mt-0.5">
                      {activePageTitle}
                    </h1>
                  </>
                ) : isPetugas ? (
                  <>
                    <div className="flex flex-nowrap items-center gap-1.5 text-[11px] sm:text-xs text-slate-500 leading-tight min-w-0">
                      <span className="truncate">{brand.app_name}</span>
                      <span aria-hidden="true" className="shrink-0">
                        ·
                      </span>
                      <span className="font-semibold text-emerald-700 shrink-0 whitespace-nowrap">
                        Keamanan
                      </span>
                    </div>
                    <h1 className="text-sm sm:text-base lg:text-lg font-bold text-[#0F172A] tracking-tight leading-tight truncate mt-0.5">
                      {activePageTitle}
                    </h1>
                  </>
                ) : (
                  <>
                    <div className="flex flex-nowrap items-center gap-1.5 text-[11px] sm:text-xs text-slate-500 leading-tight min-w-0">
                      <span className="truncate">{brand.app_name}</span>
                      <span aria-hidden="true" className="shrink-0">
                        ·
                      </span>
                      <span className="font-mono font-semibold text-[var(--theme-primary-text)] shrink-0 whitespace-nowrap">
                        Blok {session.blok_rumah}
                      </span>
                    </div>
                    <h1 className="text-sm sm:text-base lg:text-lg font-bold text-[#0F172A] tracking-tight leading-tight truncate mt-0.5">
                      {activePageTitle}
                    </h1>
                  </>
                )}
              </div>
            </div>

            {/* Kanan: Lonceng Semua Aktivitas (Wajib Tampil di Semua Peran & Ukuran Layar) + Foto Profil Akun + Aksi Tambahan */}
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

              <button
                type="button"
                onClick={() => onOpenProfile?.()}
                aria-label={`Profil ${session.nama_warga}`}
                title="Profil & Foto Akun"
                className="flex flex-nowrap items-center gap-2 p-0.5 sm:pr-2.5 rounded-full sm:rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 transition-colors cursor-pointer shrink-0"
              >
                <UserAvatar
                  name={session.nama_warga}
                  src={effectiveAvatarUrl}
                  size="sm"
                  className="shrink-0"
                />
                <span className="hidden md:inline text-xs font-semibold text-[#0F172A] max-w-[112px] truncate">
                  {session.nama_warga}
                </span>
              </button>

              {isAdmin && !headerAction && (
                <button
                  type="button"
                  onClick={onLogout}
                  aria-label="Keluar dari Portal Admin"
                  title="Keluar"
                  className="hidden sm:inline-flex h-10 px-3 rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold text-slate-700 items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span>Keluar</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Single-View Slide Content per Tab — Padding Atas Menyesuaikan Header Fixed h-16 */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-[calc(4rem+env(safe-area-inset-top,0px)+1.25rem)] lg:pt-[5.25rem] pb-28 lg:pb-10 min-w-0 overflow-x-hidden">
          <div className="max-w-7xl mx-auto w-full min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Bottom Navigation Bar Tetap untuk Mobile & Tablet (< 1024px) */}
      <nav
        aria-label="Navigasi Bawah"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe pb-[env(safe-area-inset-bottom)] no-print"
      >
        <div
          className={`grid ${
            navItems.length >= 6
              ? 'grid-cols-6'
              : navItems.length === 5
                ? 'grid-cols-5'
                : 'grid-cols-4'
          } h-16 max-w-2xl mx-auto items-end`}
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeTab;
            const isCompactSix = navItems.length >= 6;

            if (item.isCenterFab) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  aria-label={item.label}
                  className="relative flex flex-col items-center justify-end pb-1.5 px-0.5 cursor-pointer group min-w-0"
                >
                  <span
                    className={`${
                      isCompactSix ? 'w-12 h-12 -mt-5' : 'w-14 h-14 -mt-6'
                    } rounded-full border-4 border-[var(--theme-surface)] shadow-lg flex items-center justify-center transition-all group-active:scale-95 ${
                      isActive
                        ? 'bg-[#0F172A] text-white shadow-slate-900/25'
                        : 'bg-[#059669] text-white shadow-black/20 hover:opacity-95'
                    }`}
                  >
                    <Icon className={isCompactSix ? 'w-5 h-5' : 'w-6 h-6'} strokeWidth={2.5} />
                  </span>
                  <span
                    className={`text-[11px] font-bold mt-1 leading-none truncate max-w-full ${
                      isActive ? 'text-[var(--theme-text)]' : 'text-[var(--theme-primary)]'
                    }`}
                  >
                    {item.shortLabel}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative flex flex-col items-center justify-center h-16 px-0.5 transition-all duration-200 active:scale-[0.95] cursor-pointer min-w-0 ${
                  isActive ? 'text-[#059669]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="bottom-nav-active-bar"
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    aria-hidden="true"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[#059669]"
                  />
                )}
                <div className="relative transition-transform duration-200">
                  <Icon
                    className={`w-5 h-5 transition-transform duration-200 ${isActive ? 'scale-105' : ''}`}
                    strokeWidth={isActive ? 2.4 : 1.9}
                  />
                  {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-600 text-white text-[10px] font-bold font-mono flex items-center justify-center tabular-nums">
                      {item.badgeCount > 9 ? '9+' : item.badgeCount}
                    </span>
                  )}
                </div>
                <span
                  className={`${
                    isCompactSix ? 'text-[10px]' : 'text-[11px]'
                  } font-semibold mt-1 leading-none truncate max-w-full`}
                >
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
