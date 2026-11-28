import { Menu } from 'lucide-react';
import type { SessionUser } from '../types';
import bgHeaderAsset from '../assets/bg-header.jpg';
import { BrandLogo } from './BrandLogo';
import { NotificationBell } from './NotificationBell';
import { UserAvatar } from './UserAvatar';

export interface PortalHeaderProps {
  session: SessionUser;
  appTitle?: string;
  appSubtitle?: string;
  displayName: string;
  identityLabel: string;
  avatarUrl?: string | null;
  activePeriodLabel: string;
  menuBadgeCount?: number;
  externalUnreadCount?: number;
  onUnreadCountChange?: (count: number) => void;
  onOpenMenu: () => void;
  onLogoClick: () => void;
  onProfileClick: () => void;
  onNavigateTarget?: (targetUrl: string) => void;
}

export function PortalHeader({
  session,
  appTitle = 'e-Card Verifikasi',
  appSubtitle = 'Perumahan Saung Kebun',
  displayName,
  identityLabel,
  avatarUrl,
  activePeriodLabel,
  menuBadgeCount = 0,
  externalUnreadCount,
  onUnreadCountChange,
  onOpenMenu,
  onLogoClick,
  onProfileClick,
  onNavigateTarget,
}: PortalHeaderProps) {
  return (
    <header className="relative w-full overflow-hidden rounded-b-[28px] bg-[#1B2D1E] shadow-sm min-h-[188px] flex flex-col justify-between">
      {/* Background Foto Perumahan Saung Kebun */}
      <img
        src={bgHeaderAsset}
        alt="Suasana Perumahan Saung Kebun"
        className="absolute inset-0 w-full h-full object-cover object-center"
      />

      {/* Overlay Gradien Atas & Bawah */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-[#132215]/85 via-[#182B1A]/30 to-[#132215]/25"
      />

      {/* Bar Atas Header (Menu — Logo & Judul — Notifikasi) */}
      <div className="relative z-10 flex items-center justify-between px-4 pt-[max(0.85rem,env(safe-area-inset-top))] gap-2">
        {/* Kiri: Tombol Menu Bulat Kaca Buram (disembunyikan di desktop saat sidebar permanen aktif) */}
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Buka Menu Sidebar"
          title="Menu Profil, Layanan & Keluar"
          className="relative w-10 h-10 rounded-full bg-white/18 backdrop-blur-md border border-white/25 text-white flex items-center justify-center shadow-sm hover:bg-white/25 active:scale-95 transition-colors cursor-pointer shrink-0 lg:invisible"
        >
          <Menu className="w-[18px] h-[18px]" strokeWidth={2.1} />
          {menuBadgeCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#C87058] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-[#1B2D1E]">
              {menuBadgeCount > 9 ? '9+' : menuBadgeCount}
            </span>
          )}
        </button>

        {/* Tengah: Logo Transparan Krem + Judul 2 Baris */}
        <button
          type="button"
          onClick={onLogoClick}
          className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
        >
          <BrandLogo
            size="sm"
            variant="cream"
            showWordmark={false}
            className="w-9 h-9 object-contain shrink-0"
          />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[#F6F3EA] leading-tight tracking-tight drop-shadow-sm truncate">
              {appTitle}
            </p>
            <p className="text-[11px] font-normal text-[#E5EEE3]/90 leading-tight truncate">
              {appSubtitle}
            </p>
          </div>
        </button>

        {/* Kanan: Tombol Notifikasi Lonceng Bulat Kaca Buram */}
        <NotificationBell
          session={session}
          variant="dark"
          externalUnreadCount={externalUnreadCount}
          onUnreadCountChange={onUnreadCountChange}
          onNavigateTarget={onNavigateTarget}
        />
      </div>

      {/* Pil Profil Kaca Mengambang di Bawah Foto Header */}
      <div className="relative z-10 mx-4 mb-3.5 mt-8 rounded-full bg-[#FAF7F0]/78 backdrop-blur-md border border-white/65 px-2.5 py-1.5 shadow-[0_6px_20px_rgba(18,30,19,0.22)] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onProfileClick}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
        >
          <UserAvatar
            name={displayName}
            src={avatarUrl}
            size="sm"
            className="w-8 h-8 rounded-full object-cover border border-white/80 shrink-0"
            fallbackClassName="bg-[#243825] text-[#F6F3EA] border-white/80"
          />
          <span className="text-[13px] font-medium text-[#1D2D1E] truncate">
            {identityLabel}
          </span>
        </button>
        <span className="shrink-0 rounded-full bg-[#4B633F] text-[#F6F3EA] text-[11px] font-semibold px-3 py-1 shadow-sm whitespace-nowrap">
          {activePeriodLabel}
        </span>
      </div>
    </header>
  );
}
