import { useEffect, useState } from 'react';

export interface UserAvatarProps {
  name?: string | null;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  ringClassName?: string;
}

const SIZE_MAP: Record<NonNullable<UserAvatarProps['size']>, string> = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-9 h-9 text-xs',
  lg: 'w-14 h-14 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

const GREEN_PALETTES = [
  'bg-emerald-100 text-emerald-800 border-emerald-200',
  'bg-teal-100 text-teal-800 border-teal-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-lime-100 text-lime-900 border-lime-200',
];

function computeInitials(name?: string | null): string {
  const clean = String(name || '')
    .replace(/^(bp\.?|bpk\.?|pak|ibu|bu)\s+/i, '')
    .trim();
  if (!clean) return 'SK';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function pickPalette(name?: string | null): string {
  const str = String(name || 'Saung Kebun');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return GREEN_PALETTES[hash % GREEN_PALETTES.length];
}

export function UserAvatar({
  name,
  src,
  size = 'md',
  className = '',
  ringClassName = '',
}: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [src]);

  const cleanSrc = typeof src === 'string' && src.trim() ? src.trim() : null;
  const initials = computeInitials(name);
  const palette = pickPalette(name);
  const sizeCls = SIZE_MAP[size];

  if (cleanSrc && !imgError) {
    return (
      <div
        className={`relative rounded-full overflow-hidden shrink-0 border border-emerald-200/80 bg-[#F5F3E7] ${sizeCls} ${ringClassName} ${className}`}
      >
        <img
          src={cleanSrc}
          alt={`Foto profil ${name || 'Pengguna'}`}
          referrerPolicy="no-referrer"
          decoding="async"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      aria-label={`Avatar ${name || 'Pengguna'}`}
      className={`relative rounded-full overflow-hidden shrink-0 border font-bold tracking-tight flex items-center justify-center select-none uppercase ${palette} ${sizeCls} ${ringClassName} ${className}`}
    >
      <span>{initials}</span>
    </div>
  );
}
