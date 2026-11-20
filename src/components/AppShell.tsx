import React from 'react';
import { LogOut, Settings, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type SessionUser } from '../types';
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
  const activeNav = navItems.find((item) => item.id === activeTab) || navItems[0];
  const isAdmin = session.role === 'admin';
  const adminIdentityLabel = `${session.nama_warga} — ${session.jabatan || 'Pengurus'}`;

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] text-[#0F172A] flex flex-col lg:flex-row">
      {/* Desktop Sidebar Tetap (>= 1024px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 xl:w-72 lg:fixed lg:inset-y-0 lg:left-0 bg-[#0F172A] text-white border-r border-slate-800 z-30 no-print">
        <div className="px-6 py-5 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" variant="dark" />
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-white truncate">{brand.app_name}</p>
              <p className="text-xs text-slate-400 truncate">{brand.app_subtitle}</p>
            </div>
          </div>
        </div>

        {/* Info Akun Aktif */}
        <div className="px-6 py-4 border-b border-slate-800/80 bg-slate-900/50">
          <p className="text-xs text-slate-400">
            {isAdmin ? 'Pengurus Aktif' : 'Unit Rumah Terverifikasi'}
          </p>
          <p className="text-sm font-semibold text-white mt-0.5 leading-snug">
            {isAdmin ? adminIdentityLabel : session.nama_warga}
          </p>
          <p className="text-xs font-mono text-emerald-400 mt-0.5">
            {isAdmin
              ? session.admin_permission === 'full'
                ? 'Akses Penuh (Bendahara)'
                : `Akses Tambah Data (${session.jabatan || 'Pengurus'})`
              : `Blok ${session.blok_rumah}`}
          </p>
        </div>

        {/* Menu Navigasi Desktop */}
        <nav aria-label="Navigasi Utama" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
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
        </nav>

        {/* Footer Sidebar */}
        <div className="p-4 border-t border-slate-800 space-y-2.5">
          <p className="text-[11px] text-slate-400 leading-relaxed px-2">{brand.kop_resmi}</p>
          {isAdmin && onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-full min-h-[42px] flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-sm font-medium transition-colors cursor-pointer"
            >
              <Settings className="w-4 h-4 text-emerald-400" />
              <span>Pengaturan Sistem</span>
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[42px] flex items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Area Kerja Utama */}
      <div className="flex-1 lg:pl-64 xl:pl-72 flex flex-col min-w-0">
        {/* Header Kontekstual — Kompak & Tidak Memanjang Vertikal di Mobile/Tablet */}
        <header className="bg-white border-b border-slate-200 px-3.5 sm:px-6 lg:px-8 py-2.5 sm:py-3 pt-safe no-print">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2.5 sm:gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
              <BrandLogo size="sm" className="lg:hidden shrink-0" />
              <div className="min-w-0 flex-1">
                {isAdmin ? (
                  <>
                    <p className="text-[11px] sm:text-xs font-semibold text-emerald-700 leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
                      {adminIdentityLabel}
                    </p>
                    <h1 className="text-sm sm:text-lg font-bold text-[#0F172A] tracking-tight leading-tight truncate mt-0.5">
                      {activeNav?.label}
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
                      {activeNav?.label}
                    </h1>
                  </>
                )}
              </div>
            </div>

            {headerAction ? (
              <div className="shrink-0">{headerAction}</div>
            ) : isAdmin ? (
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    aria-label="Buka Pengaturan Sistem"
                    title="Pengaturan Sistem"
                    className="min-h-[38px] min-w-[38px] sm:min-h-[40px] px-2 sm:px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-slate-700 hover:text-emerald-800 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Settings className="w-4 h-4 shrink-0" />
                    <span className="hidden md:inline text-xs font-semibold">Pengaturan</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onLogout}
                  aria-label="Keluar dari Portal Admin"
                  className="min-h-[38px] sm:min-h-[40px] px-2.5 sm:px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5 shrink-0" />
                  <span>Keluar</span>
                </button>
              </div>
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
                        : 'bg-emerald-600 text-white shadow-emerald-600/30 hover:bg-emerald-700'
                    }`}
                  >
                    <Icon className={isCompactSix ? 'w-5 h-5' : 'w-6 h-6'} strokeWidth={2.4} />
                  </span>
                  <span
                    className={`text-[10px] font-bold mt-1 leading-none truncate max-w-full ${
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
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-7 h-0.5 rounded-full bg-[#059669]"
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
