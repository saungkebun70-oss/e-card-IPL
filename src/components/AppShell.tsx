import React, { useEffect, useState } from 'react';
import {
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
  headerAction,
  children,
}: AppShellProps) {
  const { brand } = useAppBrand();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isAdmin = session.role === 'admin';
  const canAccessBotWa = isBendaharaOnly(session);
  const adminIdentityLabel = `${session.nama_warga} — ${session.jabatan || 'Pengurus'}`;
  const isLpjActive = activeTab === 'lpj';

  const activePageTitle = isLpjActive
    ? 'Laporan Pertanggungjawaban (LPJ)'
    : navItems.find((item) => item.id === activeTab)?.label || navItems[0]?.label || '';

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  const handleOpenLpj = () => {
    setDrawerOpen(false);
    onTabChange('lpj');
  };

  const handleOpenSettingsFromSidebar = () => {
    setDrawerOpen(false);
    onOpenSettings?.();
  };

  const handleLogoutFromSidebar = () => {
    setDrawerOpen(false);
    onLogout();
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] text-[#0F172A] flex flex-col lg:flex-row">
      {/* Desktop Sidebar Tetap (>= 1024px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-72 lg:fixed lg:inset-y-0 lg:left-0 bg-[#0F172A] text-white border-r border-slate-800 z-30 no-print">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" variant="dark" />
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-white truncate">{brand.app_name}</p>
              <p className="text-xs text-slate-400 truncate">{brand.app_subtitle}</p>
            </div>
          </div>
        </div>

        {/* Info Akun Aktif */}
        <div className="px-5 py-4 border-b border-slate-800/80 bg-slate-900/50">
          <p className="text-[11px] font-medium text-slate-400">
            {isAdmin ? 'Pengurus Aktif' : 'Unit Rumah Terverifikasi'}
          </p>
          <p className="text-sm font-bold text-white mt-0.5 leading-snug">
            {isAdmin ? adminIdentityLabel : session.nama_warga}
          </p>
          <p className="text-xs font-mono text-emerald-400 mt-0.5">
            {isAdmin
              ? session.admin_permission === 'full'
                ? 'Bendahara · Akses Penuh'
                : `${session.jabatan || 'Pengurus'} · Akses Tambah Data`
              : `Blok ${session.blok_rumah}`}
          </p>
        </div>

        {/* Menu Navigasi Desktop */}
        <nav aria-label="Navigasi Utama" className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
          <div className="space-y-1">
            <p className="px-3 text-[11px] font-semibold text-slate-400 mb-1.5">Menu Utama</p>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={`w-full min-h-[44px] flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-[#059669] text-white'
                      : item.isCenterFab
                        ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/70 hover:bg-emerald-900/70 hover:text-white'
                        : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md ${
                        isActive ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-300'
                      }`}
                    >
                      {item.badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {isAdmin && (
            <>
              {/* Kelompok Menu Laporan (LPJ) */}
              <div className="space-y-1 pt-2 border-t border-slate-800/80">
                <p className="px-3 text-[11px] font-semibold text-slate-400 mb-1.5">Menu Laporan</p>
                <button
                  type="button"
                  onClick={handleOpenLpj}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl flex items-start gap-3 transition-colors cursor-pointer ${
                    isLpjActive
                      ? 'bg-[#059669] text-white'
                      : 'text-slate-200 hover:bg-slate-800/80'
                  }`}
                >
                  <FileCheck2
                    className={`w-4 h-4 shrink-0 mt-0.5 ${
                      isLpjActive ? 'text-white' : 'text-emerald-400'
                    }`}
                  />
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
                </button>
              </div>

              {/* Kelompok Menu Sistem (Pengaturan Terpusat) */}
              {onOpenSettings && (
                <div className="space-y-1 pt-2 border-t border-slate-800/80">
                  <p className="px-3 text-[11px] font-semibold text-slate-400 mb-1.5">Menu Sistem</p>
                  <button
                    type="button"
                    onClick={handleOpenSettingsFromSidebar}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl flex items-start gap-3 text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
                  >
                    <Settings className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold leading-snug">
                        Pengaturan Sistem Terpusat
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                        {canAccessBotWa
                          ? 'Identitas & Stempel, Bayar/QRIS, Bot WA, Petugas & Peta RFID, PIN & Log'
                          : 'Identitas & Stempel, Bayar/QRIS, Petugas & Peta RFID, PIN & Log'}
                      </p>
                    </div>
                  </button>
                </div>
              )}
            </>
          )}
        </nav>

        {/* Footer Sidebar Desktop */}
        <div className="p-4 border-t border-slate-800 space-y-2.5">
          <p className="text-[11px] text-slate-400 leading-relaxed px-2">{brand.kop_resmi}</p>
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[42px] flex items-center justify-center gap-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-200 hover:text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar / Logout</span>
          </button>
        </div>
      </aside>

      {/* Slide-Over Sidebar Drawer (Mobile & Tablet < 1024px) */}
      <AnimatePresence>
        {drawerOpen && isAdmin && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu Sidebar Pengurus"
            className="lg:hidden fixed inset-0 z-50 flex no-print"
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
              {/* Header Sidebar dengan Jarak Aman Atas & Gradasi Halus */}
              <div className="px-5 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1rem)] pb-5 bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-white shrink-0">
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <BrandLogo size="sm" variant="dark" className="shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white leading-tight truncate">
                        {brand.app_name}
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

                {/* Kartu Profil Elegan — Avatar Inisial + Nama + 1 Badge Status Aktif */}
                <div className="mt-4 p-3 rounded-2xl bg-white/[0.07] border border-white/10 flex items-center gap-3">
                  <div
                    aria-hidden="true"
                    className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-400/35 text-emerald-100 font-bold text-sm flex items-center justify-center shrink-0 uppercase"
                  >
                    {session.nama_warga
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join('') || 'P'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white leading-tight truncate">
                      {session.nama_warga}
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
                </div>
              </div>

              {/* Isi Kelompok Menu Sidebar (Kompak & Rapi) */}
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
                            ? 'Identitas, QRIS, Bot WA, Petugas & Peta RFID'
                            : 'Identitas, QRIS, Petugas & Peta RFID, PIN'}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </button>
                  </div>
                )}
              </div>

              {/* Footer Dasar Sidebar (mt-auto): Alamat Sekretariat & Tombol Logout */}
              <div className="mt-auto px-4 pt-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-slate-100 bg-slate-50/70 space-y-3 shrink-0">
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
      <div className="flex-1 lg:pl-72 flex flex-col min-w-0">
        {/* Header Kontekstual Bersih — Tanpa Ikon Gerigi, Hamburger Menu di Kiri Atas */}
        <header className="bg-white border-b border-slate-200 px-3.5 sm:px-6 lg:px-8 pb-2.5 sm:pb-3 pt-safe-header no-print">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Buka Menu Sidebar"
                  title="Buka Menu Sidebar"
                  className="lg:hidden min-h-[42px] min-w-[42px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[#0F172A] flex items-center justify-center transition-colors cursor-pointer shrink-0"
                >
                  <Menu className="w-5 h-5" />
                </button>
              )}

              <BrandLogo size="sm" className="lg:hidden shrink-0" />

              <div className="min-w-0 flex-1">
                {isAdmin ? (
                  <>
                    <p className="text-[11px] sm:text-xs font-semibold text-emerald-700 leading-tight truncate">
                      {adminIdentityLabel}
                    </p>
                    <h1 className="text-sm sm:text-lg font-bold text-[#0F172A] tracking-tight leading-tight truncate mt-0.5">
                      {activePageTitle}
                    </h1>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-slate-500 leading-tight">
                      <span className="truncate">{brand.app_name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-emerald-700 shrink-0">
                        Blok {session.blok_rumah}
                      </span>
                    </div>
                    <h1 className="text-sm sm:text-lg font-bold text-[#0F172A] tracking-tight leading-tight truncate mt-0.5">
                      {activePageTitle}
                    </h1>
                  </>
                )}
              </div>
            </div>

            {headerAction ? (
              <div className="shrink-0">{headerAction}</div>
            ) : isAdmin ? (
              <button
                type="button"
                onClick={onLogout}
                aria-label="Keluar dari Portal Admin"
                className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span>Keluar</span>
              </button>
            ) : (
              <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 shrink-0">
                <span>Sekretariat Blok B3/7</span>
              </div>
            )}
          </div>
        </header>

        {/* Single-View Slide Content per Tab */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-28 lg:pb-10">
          <div className="max-w-7xl mx-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
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
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe no-print"
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
                    } rounded-full border-4 border-white shadow-lg flex items-center justify-center transition-all group-active:scale-95 ${
                      isActive
                        ? 'bg-[#0F172A] text-white shadow-slate-900/25'
                        : 'bg-[#059669] text-white shadow-emerald-600/30 hover:bg-emerald-700'
                    }`}
                  >
                    <Icon className={isCompactSix ? 'w-5 h-5' : 'w-6 h-6'} strokeWidth={2.5} />
                  </span>
                  <span
                    className={`text-[11px] font-bold mt-1 leading-none truncate max-w-full ${
                      isActive ? 'text-[#0F172A]' : 'text-emerald-700'
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
                className={`relative flex flex-col items-center justify-center h-16 px-0.5 transition-colors cursor-pointer min-w-0 ${
                  isActive ? 'text-[#059669]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[#059669]"
                  />
                )}
                <div className="relative">
                  <Icon className="w-5 h-5" strokeWidth={isActive ? 2.4 : 1.9} />
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
