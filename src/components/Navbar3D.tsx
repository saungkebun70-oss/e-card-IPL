import React, { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Icon3D, type Icon3DName } from './Icon3D';

export interface Navbar3DItem {
  id: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  icon3d?: Icon3DName;
  badgeCount?: number;
  isCenterFab?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  isScanning?: boolean;
  isLoading?: boolean;
}

interface Navbar3DProps {
  items: Navbar3DItem[];
  activeId: string;
  onSelect: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

export type NB2EmblemName =
  | 'dasbor'
  | 'warga'
  | 'plus_kas'
  | 'rekap'
  | 'keamanan'
  | 'ecard'
  | 'riwayat'
  | 'setor'
  | 'info'
  | 'scan_nfc'
  | 'honor'
  | 'peta';

function resolveEmblemName(item: Navbar3DItem): NB2EmblemName {
  if (item.id === 'lingkungan') return 'info';
  if (item.id === 'honor') return 'honor';
  if (item.id === 'peta') return 'peta';
  if (item.id === 'scan') return 'scan_nfc';
  if (item.id === 'riwayat' && item.icon3d === 'rekap') return 'rekap';

  switch (item.icon3d) {
    case 'dasbor':
      return 'dasbor';
    case 'warga':
      return 'warga';
    case 'plus_kas':
      return 'plus_kas';
    case 'rekap':
      return 'rekap';
    case 'keamanan':
      return 'keamanan';
    case 'ecard':
      return 'ecard';
    case 'riwayat':
      return 'riwayat';
    case 'setor':
      return 'setor';
    case 'scan_nfc':
      return 'scan_nfc';
    case 'info':
      return 'info';
    default:
      return 'dasbor';
  }
}

/**
 * Ikon 3D NB2 bergaya Soft Clay / Porcelain (tanpa kotak persegi luar)
 * untuk Navbar 3D Floating Dock (Portal Pengurus, Portal Warga, Portal Petugas).
 */
export const Navbar3DEmblem: React.FC<{
  name: NB2EmblemName;
  active?: boolean;
  isCenter?: boolean;
  isLoading?: boolean;
}> = ({ name, active = false, isCenter = false, isLoading = false }) => {
  const uid = useId().replace(/:/g, '');
  const darkGrad = `nb2d-${uid}`;
  const midGrad = `nb2m-${uid}`;
  const lightGrad = `nb2l-${uid}`;
  const creamGrad = `nb2c-${uid}`;

  if (isCenter && isLoading) {
    return (
      <svg viewBox="0 0 32 32" className="w-7 h-7 animate-spin" aria-hidden="true">
        <circle
          cx="16"
          cy="16"
          r="11"
          fill="none"
          stroke="rgba(244,239,224,0.28)"
          strokeWidth="3.5"
        />
        <path
          d="M16 5 A11 11 0 0 1 27 16"
          fill="none"
          stroke="#F4EFE0"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 32 32"
      className={
        isCenter
          ? 'w-[26px] h-[26px] sm:w-[28px] sm:h-[28px] drop-shadow-[0_2px_2px_rgba(12,24,12,0.45)]'
          : `w-[22px] h-[22px] sm:w-[24px] sm:h-[24px] transition-transform duration-200 ${
              active
                ? 'scale-105 drop-shadow-[0_2px_3px_rgba(28,45,27,0.28)]'
                : 'drop-shadow-[0_1.5px_2px_rgba(28,45,27,0.20)]'
            }`
      }
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={darkGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4F664B" />
          <stop offset="55%" stopColor="#354A31" />
          <stop offset="100%" stopColor="#233420" />
        </linearGradient>
        <linearGradient id={midGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8AA085" />
          <stop offset="55%" stopColor="#6D8368" />
          <stop offset="100%" stopColor="#4E644A" />
        </linearGradient>
        <linearGradient id={lightGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#B8C8B3" />
          <stop offset="100%" stopColor="#859A80" />
        </linearGradient>
        <linearGradient id={creamGrad} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFDF6" />
          <stop offset="60%" stopColor="#ECE5D2" />
          <stop offset="100%" stopColor="#D4CCB7" />
        </linearGradient>
      </defs>

      {name === 'plus_kas' && (
        <path
          d="M16 5.5c1.52 0 2.75 1.23 2.75 2.75v5h5a2.75 2.75 0 1 1 0 5.5h-5v5a2.75 2.75 0 1 1-5.5 0v-5h-5a2.75 2.75 0 1 1 0-5.5h5v-5C13.25 6.73 14.48 5.5 16 5.5Z"
          fill={`url(#${creamGrad})`}
        />
      )}

      {name === 'setor' && (
        <path
          d="M16 5.2c.78 0 1.52.31 2.06.87l6.75 6.9a2.65 2.65 0 0 1-3.78 3.71l-2.38-2.42v9.94a2.65 2.65 0 1 1-5.3 0v-9.94l-2.38 2.42a2.65 2.65 0 0 1-3.78-3.71l6.75-6.9A2.88 2.88 0 0 1 16 5.2Z"
          fill={`url(#${creamGrad})`}
        />
      )}

      {name === 'scan_nfc' && (
        <>
          <rect x="7" y="6" width="18" height="20" rx="4" fill={`url(#${creamGrad})`} />
          <path
            d="M12 13.5a5.8 5.8 0 0 1 8 0M13.8 16.5a3.2 3.2 0 0 1 4.4 0"
            fill="none"
            stroke="#2B3F29"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <circle cx="16" cy="19.5" r="1.5" fill="#2B3F29" />
        </>
      )}

      {name === 'dasbor' && (
        <>
          <rect x="4.5" y="4.5" width="10" height="10" rx="3" fill={`url(#${darkGrad})`} />
          <rect x="17.5" y="4.5" width="10" height="10" rx="3" fill={`url(#${lightGrad})`} />
          <rect x="4.5" y="17.5" width="10" height="10" rx="3" fill={`url(#${lightGrad})`} />
          <rect x="17.5" y="17.5" width="10" height="10" rx="3" fill={`url(#${darkGrad})`} />
          <rect x="19.8" y="23.2" width="1.6" height="2.4" rx="0.8" fill={`url(#${creamGrad})`} />
          <rect x="22.1" y="21.4" width="1.6" height="4.2" rx="0.8" fill={`url(#${creamGrad})`} />
          <rect x="24.4" y="19.6" width="1.6" height="6" rx="0.8" fill="#A6BC9F" />
        </>
      )}

      {name === 'warga' && (
        <>
          <circle cx="20.5" cy="11.2" r="3.6" fill={`url(#${lightGrad})`} />
          <path
            d="M15.2 24.5c0-3.2 2.4-5.4 5.4-5.4 3 0 5.4 2.2 5.4 5.4 0 1-.8 1.8-1.8 1.8h-7.2c-1 0-1.8-.8-1.8-1.8Z"
            fill={`url(#${lightGrad})`}
          />
          <circle cx="12.5" cy="10.2" r="4.3" fill={`url(#${midGrad})`} />
          <path
            d="M4.8 25c0-4 3.4-6.8 7.7-6.8 4.3 0 7.7 2.8 7.7 6.8 0 1.15-.92 2-2.05 2H6.85C5.72 27 4.8 26.15 4.8 25Z"
            fill={`url(#${midGrad})`}
          />
        </>
      )}

      {name === 'rekap' && (
        <>
          <rect x="5" y="5" width="22" height="22" rx="5.5" fill={`url(#${darkGrad})`} />
          <rect x="8.5" y="9.5" width="10" height="2.6" rx="1.3" fill={`url(#${creamGrad})`} />
          <circle cx="22.2" cy="10.8" r="1.45" fill={`url(#${creamGrad})`} />
          <rect x="8.5" y="14.7" width="10" height="2.6" rx="1.3" fill={`url(#${creamGrad})`} />
          <circle cx="22.2" cy="16" r="1.45" fill={`url(#${creamGrad})`} />
          <rect x="8.5" y="19.9" width="10" height="2.6" rx="1.3" fill={`url(#${creamGrad})`} />
          <circle cx="22.2" cy="21.2" r="1.45" fill={`url(#${creamGrad})`} />
        </>
      )}

      {name === 'keamanan' && (
        <>
          <path
            d="M16 3.8c-.4 0-.8.1-1.15.3l-8.4 3.7C5.55 8.2 5 9.1 5 10.1v5.6c0 6.1 4.4 10.6 10.2 12.3.52.16 1.08.16 1.6 0C22.6 26.3 27 21.8 27 15.7v-5.6c0-1-.55-1.9-1.45-2.3l-8.4-3.7A2.8 2.8 0 0 0 16 3.8Z"
            fill={`url(#${darkGrad})`}
          />
          <path
            d="M13 13.8v-1.7a3 3 0 0 1 6 0v1.7"
            fill="none"
            stroke={`url(#${creamGrad})`}
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          <rect x="11.2" y="13.5" width="9.6" height="7.6" rx="2.1" fill={`url(#${creamGrad})`} />
          <circle cx="16" cy="16.7" r="1.15" fill="#2A3F27" />
          <rect x="15.35" y="17.2" width="1.3" height="2" rx="0.65" fill="#2A3F27" />
        </>
      )}

      {name === 'ecard' && (
        <>
          <rect x="3.5" y="7" width="25" height="18" rx="4.2" fill={`url(#${darkGrad})`} />
          <rect x="3.5" y="10.8" width="25" height="3.2" fill="#1D2B1B" />
          <rect x="6.5" y="17.2" width="7.2" height="2" rx="1" fill={`url(#${lightGrad})`} />
          <rect x="6.5" y="20.6" width="5" height="1.6" rx="0.8" fill={`url(#${lightGrad})`} />
          <circle cx="22.8" cy="19.3" r="2.6" fill={`url(#${creamGrad})`} />
        </>
      )}

      {name === 'riwayat' && (
        <>
          <path
            d="M8.5 5.2h15c1.1 0 2 .9 2 2v18.9c0 .55-.65.85-1.08.5l-2.3-1.85-2.3 1.85a.8.8 0 0 1-1.02 0l-2.3-1.85-2.3 1.85a.8.8 0 0 1-1.02 0l-2.3-1.85-2.3 1.85c-.43.35-1.08.05-1.08-.5V7.2c0-1.1.9-2 2-2Z"
            fill={`url(#${midGrad})`}
          />
          <rect x="11.2" y="9.5" width="9.6" height="2.2" rx="1.1" fill={`url(#${creamGrad})`} />
          <rect x="11.2" y="13.7" width="9.6" height="2.2" rx="1.1" fill={`url(#${creamGrad})`} />
          <rect x="11.2" y="17.9" width="6.2" height="2.2" rx="1.1" fill={`url(#${creamGrad})`} />
        </>
      )}

      {name === 'info' && (
        <>
          <rect x="5" y="24" width="22" height="2.8" rx="1.4" fill={`url(#${darkGrad})`} />
          <rect x="7" y="15" width="3.6" height="9.2" rx="1.5" fill={`url(#${midGrad})`} />
          <rect x="12.2" y="13.5" width="3.6" height="10.7" rx="1.5" fill={`url(#${midGrad})`} />
          <rect x="17.4" y="13.5" width="3.6" height="10.7" rx="1.5" fill={`url(#${midGrad})`} />
          <rect x="22.2" y="15" width="3.6" height="9.2" rx="1.5" fill={`url(#${midGrad})`} />
          <rect x="10.2" y="4.8" width="11.6" height="10.2" rx="3" fill={`url(#${darkGrad})`} />
          <circle cx="16" cy="7.6" r="1.2" fill={`url(#${creamGrad})`} />
          <rect x="15" y="9.8" width="2" height="3.6" rx="1" fill={`url(#${creamGrad})`} />
        </>
      )}

      {name === 'honor' && (
        <>
          <rect x="4.5" y="7.5" width="23" height="17" rx="4.5" fill={`url(#${darkGrad})`} />
          <path
            d="M19 13h8.5v6H19a3 3 0 0 1 0-6Z"
            fill={`url(#${lightGrad})`}
          />
          <circle cx="19.5" cy="16" r="1.45" fill={`url(#${creamGrad})`} />
        </>
      )}

      {name === 'peta' && (
        <>
          <path
            d="M5 8.5 12.2 6l7.6 2.5L27 6v17.5L19.8 26l-7.6-2.5L5 26V8.5Z"
            fill={`url(#${midGrad})`}
          />
          <path d="M12.2 6v17.5M19.8 8.5V26" stroke={`url(#${creamGrad})`} strokeWidth="1.6" />
          <circle cx="16" cy="14" r="3" fill={`url(#${creamGrad})`} />
        </>
      )}
    </svg>
  );
};

/**
 * Emblem 3D Petir-Chat untuk 3D Chat FAB (mengikuti spesifikasi NB2).
 */
export const ChatFab3DEmblem: React.FC<{ className?: string }> = ({
  className = 'w-7 h-7 sm:w-8 sm:h-8',
}) => {
  const uid = useId().replace(/:/g, '');
  const bubbleGrad = `nb2cb-${uid}`;
  const boltGrad = `nb2cl-${uid}`;

  return (
    <svg
      viewBox="0 0 36 36"
      className={`${className} drop-shadow-[0_2px_3px_rgba(12,22,12,0.45)] pointer-events-none`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={bubbleGrad} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A1B69B" />
          <stop offset="55%" stopColor="#7A9175" />
          <stop offset="100%" stopColor="#586E53" />
        </linearGradient>
        <linearGradient id={boltGrad} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFDF7" />
          <stop offset="100%" stopColor="#E6DCC3" />
        </linearGradient>
      </defs>
      <path
        d="M18 5.5c7.45 0 13.5 4.82 13.5 10.76 0 5.95-6.05 10.77-13.5 10.77-1.66 0-3.24-.24-4.7-.68l-4.62 3.1a.9.9 0 0 1-1.37-.97l.98-4.1C6.02 22.42 4.5 19.5 4.5 16.26 4.5 10.32 10.55 5.5 18 5.5Z"
        fill={`url(#${bubbleGrad})`}
      />
      <rect x="10.2" y="12.2" width="5.6" height="2" rx="1" fill={`url(#${boltGrad})`} />
      <rect x="8.6" y="15.3" width="6.5" height="2" rx="1" fill={`url(#${boltGrad})`} />
      <rect x="10.8" y="18.4" width="4.6" height="2" rx="1" fill={`url(#${boltGrad})`} />
      <path
        d="M22.2 10.1c.4-.46 1.16-.12 1.07.48l-.6 3.7h2.78c.54 0 .84.62.5 1.04l-4.55 5.65c-.39.48-1.17.16-1.1-.45l.52-3.92h-2.54c-.54 0-.84-.62-.5-1.04l4.42-5.46Z"
        fill={`url(#${boltGrad})`}
      />
    </svg>
  );
};

export const Navbar3D: React.FC<Navbar3DProps> = ({
  items,
  activeId,
  onSelect,
  ariaLabel = 'Navigasi Bawah NP11 Liquid Pearl-Glass',
  className = '',
}) => {
  const dockItems = items.slice(0, 5);

  return (
    <nav
      aria-label={ariaLabel}
      className={`np11-dock lg:hidden fixed bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-4 max-w-md mx-auto z-40 overflow-visible rounded-full px-2 py-2 bg-gradient-to-b from-[#FFFFFF]/80 via-[#F5F2E9]/70 to-[#E9E4D8]/75 backdrop-blur-xl border border-white/90 shadow-[0_14px_32px_rgba(36,56,37,0.16),inset_0_2px_4px_rgba(255,255,255,0.95),inset_0_-2px_6px_rgba(36,56,37,0.06)] no-print select-none ${className}`.trim()}
    >
      <div className="relative z-10 h-[44px] grid grid-cols-5 items-end overflow-visible">
        {dockItems.map((item) => {
          const isActive = item.id === activeId;
          const dockLabel = item.id === 'dashboard' ? 'Dasbor' : item.shortLabel;
          const emblemName = resolveEmblemName(item);

          if (item.isCenterFab) {
            const isScanning = Boolean(item.isScanning);
            return (
              <div
                key={item.id}
                className="relative h-full flex flex-col items-center justify-end overflow-visible"
              >
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={() => onSelect(item.id)}
                  aria-label={item.ariaLabel || item.label}
                  aria-pressed={item.ariaPressed}
                  title={item.label}
                  className={`relative h-full w-full flex flex-col items-center justify-end pb-1 overflow-visible cursor-pointer group focus-visible:outline-none disabled:opacity-70 ${
                    isActive || isScanning ? 'scale-[1.03]' : ''
                  } transition-transform duration-200`}
                >
                  <div
                    className={`np11-center-orb -mt-8 w-16 h-16 shrink-0 rounded-full flex items-center justify-center bg-gradient-to-b from-[#E5EEE3]/85 to-[#B9CEB4]/75 backdrop-blur-lg border-2 border-white/90 shadow-[0_10px_24px_rgba(36,56,37,0.24),inset_0_2px_5px_rgba(255,255,255,0.9)] relative transition-transform duration-200 group-hover:scale-[1.03] group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-[#243825] ${
                      isActive || isScanning
                        ? 'ring-2 ring-[#243825]/25'
                        : ''
                    }`}
                  >
                    {isScanning && (
                      <>
                        <span
                          aria-hidden="true"
                          className="absolute -inset-2 rounded-full bg-[#384E35]/35 animate-ping pointer-events-none"
                        />
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-full bg-[#C6D2BF]/40 animate-ping [animation-delay:300ms] pointer-events-none"
                        />
                      </>
                    )}
                    <span className="relative z-10 flex items-center justify-center">
                      {item.isLoading ? (
                        <Navbar3DEmblem
                          name={emblemName}
                          active={isActive || isScanning}
                          isCenter
                          isLoading={item.isLoading}
                        />
                      ) : item.icon3d ? (
                        <Icon3D
                          name={item.icon3d}
                          className="w-11 h-11 object-contain drop-shadow-[0_4px_8px_rgba(36,56,37,0.25)]"
                        />
                      ) : (
                        <Navbar3DEmblem
                          name={emblemName}
                          active={isActive || isScanning}
                          isCenter
                          isLoading={item.isLoading}
                        />
                      )}
                    </span>
                  </div>

                  <span
                    className={`mt-0.5 text-[11px] font-semibold tracking-tight leading-none whitespace-nowrap ${
                      isActive
                        ? 'text-[#243825] font-bold dark:text-[#ECFDF5]'
                        : 'text-[#2B3B2B] dark:text-[#D5E2D4]'
                    }`}
                  >
                    {dockLabel}
                  </span>

                  <span
                    aria-hidden="true"
                    className={`w-1.5 h-1.5 rounded-full mt-0.5 transition-all duration-200 ${
                      isActive
                        ? 'bg-[#243825] dark:bg-[#86EFAC] opacity-100 scale-100'
                        : 'bg-transparent opacity-0 scale-0'
                    }`}
                  />
                </button>
              </div>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              aria-label={item.ariaLabel || item.label}
              className="relative h-full flex flex-col items-center justify-end overflow-visible cursor-pointer group focus-visible:outline-none"
            >
              <div
                className={`relative flex flex-col items-center justify-end px-2.5 pb-1.5 rounded-3xl overflow-visible transition-all duration-200 active:scale-[0.95] group-focus-visible:ring-2 group-focus-visible:ring-[#243825] ${
                  isActive
                    ? 'np11-active-aura bg-[#D9EAD3]/65 shadow-[0_0_20px_rgba(168,198,159,0.55),inset_0_1px_3px_rgba(255,255,255,0.9)]'
                    : 'bg-transparent group-hover:bg-[#E5EEE3]/35'
                }`}
              >
                <div className="relative -mt-6 mb-0.5 flex items-center justify-center overflow-visible">
                  {item.icon3d ? (
                    <Icon3D
                      name={item.icon3d}
                      className={`w-11 h-11 drop-shadow-[0_6px_10px_rgba(36,56,37,0.22)] transition-transform duration-200 ${
                        isActive ? 'scale-[1.04]' : 'group-hover:scale-[1.03]'
                      }`}
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-[22%] bg-[#2B3F29] flex items-center justify-center drop-shadow-[0_6px_10px_rgba(36,56,37,0.22)]">
                      <Navbar3DEmblem name={emblemName} active={isActive} />
                    </div>
                  )}
                  {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C87058] text-white text-[9.5px] font-bold font-mono flex items-center justify-center tabular-nums ring-2 ring-[#FFFDF8] shadow-xs">
                      {item.badgeCount > 9 ? '9+' : item.badgeCount}
                    </span>
                  )}
                </div>

                <span
                  className={`text-[11px] font-semibold tracking-tight leading-none whitespace-nowrap max-w-full truncate ${
                    isActive
                      ? 'text-[#243825] font-bold dark:text-[#ECFDF5]'
                      : 'text-[#324232] dark:text-[#CBD5C9]'
                  }`}
                >
                  {dockLabel}
                </span>

                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full mt-0.5 transition-all duration-200 ${
                    isActive
                      ? 'bg-[#243825] dark:bg-[#86EFAC] opacity-100 scale-100'
                      : 'bg-transparent opacity-0 scale-0'
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
