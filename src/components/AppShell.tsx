import React from 'react';
import { Building2, LogOut, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { KOP_RESMI, NAMA_APLIKASI, type SessionUser } from '../types';

export interface NavItem {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  badgeCount?: number;
}

interface AppShellProps {
  session: SessionUser;
  navItems: NavItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  onLogout: () => void;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({
  session,
  navItems,
  activeTab,
  onTabChange,
  onLogout,
  headerAction,
  children,
}: AppShellProps) {
  const activeNav = navItems.find((item) => item.id === activeTab) || navItems[0];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col lg:flex-row">
      {/* Desktop Sidebar Tetap (>= 1024px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 xl:w-72 lg:fixed lg:inset-y-0 lg:left-0 bg-[#0F172A] text-white border-r border-slate-800 z-30">
        <div className="px-6 py-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#059669] flex items-center justify-center shrink-0">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight text-white truncate">{NAMA_APLIKASI}</p>
              <p className="text-xs text-slate-400 truncate">Perumahan Saung Kebun</p>
            </div>
          </div>
        </div>

        {/* Info Akun Aktif */}
        <div className="px-6 py-4 border-b border-slate-800/80 bg-slate-900/50">
          <p className="text-xs text-slate-400">
            {session.role === 'admin'
              ? `Pengurus · ${session.jabatan || 'Admin'}`
              : 'Unit Rumah Terverifikasi'}
          </p>
          <p className="text-sm font-semibold text-white truncate mt-0.5">{session.nama_warga}</p>
          <p className="text-xs font-mono text-emerald-400 mt-0.5">
            {session.role === 'admin'
              ? session.admin_permission === 'full'
                ? 'Akses Penuh (Add/Edit/Hapus)'
                : 'Akses Tambah Data (Add)'
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
        <div className="p-4 border-t border-slate-800 space-y-3">
          <p className="text-[11px] text-slate-400 leading-relaxed px-2">{KOP_RESMI}</p>
          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border border-slate-700 text-slate-200 hover:bg-slate-800 hover:text-white text-sm font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Area Kerja Utama */}
      <div className="flex-1 lg:pl-64 xl:pl-72 flex flex-col min-w-0">
        {/* Header Kontekstual (Non-sticky di mobile agar mematuhi batas sticky <= 15%) */}
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="truncate">Perumahan Saung Kebun</span>
                <span aria-hidden="true">/</span>
                <span className="font-mono text-slate-700 shrink-0">
                  {session.role === 'admin'
                    ? `${session.nama_warga} (${session.jabatan || 'Admin'})`
                    : session.blok_rumah}
                </span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-[#0F172A] tracking-tight truncate mt-0.5">
                {activeNav?.label}
              </h1>
            </div>

            {headerAction ? (
              <div className="shrink-0">{headerAction}</div>
            ) : session.role === 'admin' ? (
              <div className="flex items-center gap-3 shrink-0">
                <span className="hidden sm:inline text-xs font-medium text-slate-500">
                  {session.admin_permission === 'full'
                    ? 'Akses Penuh · Bendahara'
                    : `Tambah Data · ${session.jabatan || 'Pengurus'}`}
                </span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="lg:hidden min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Keluar</span>
                </button>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 shrink-0">
                <span>Sekretariat Blok B03/07</span>
              </div>
            )}
          </div>
        </header>

        {/* Single-View Slide Content per Tab */}
        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-5 sm:py-6 pb-24 lg:pb-10">
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
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-4 h-16 max-w-2xl mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeTab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative flex flex-col items-center justify-center min-h-[48px] px-1 transition-colors cursor-pointer ${
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
                <span className="text-[11px] font-semibold mt-1 leading-none truncate max-w-full">
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
