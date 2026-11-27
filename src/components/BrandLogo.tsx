import { useEffect, useState } from 'react';
import defaultLogoAsset from '../assets/images/saung_kebun_logo_1795360829159.jpg';
import { useAppBrand } from '../lib/brandContext';

export const LOGO_SAUNG_KEBUN_SRC = defaultLogoAsset;

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'light' | 'dark' | 'transparent';
  className?: string;
  srcOverride?: string | null;
  altOverride?: string;
  showWordmark?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'w-8 h-8',
  sm: 'w-10 h-10',
  md: 'w-12 h-12',
  lg: 'w-16 h-16 sm:w-20 sm:h-20',
  xl: 'w-20 h-20 sm:w-24 sm:h-24',
};

/**
 * Emblem vektor resmi Saung Kebun (atap pendopo saung tradisional + daun melengkung)
 * Dirender sepenuhnya transparan TANPA kotak latar kuning, berwarna krem hangat di atas
 * permukaan gelap/foto, atau hijau lumut beludru (#243825) di atas latar terang.
 */
export function SaungKebunEmblem({
  className = 'w-10 h-10',
  tone = 'cream',
}: {
  className?: string;
  tone?: 'cream' | 'moss';
}) {
  const fill = tone === 'cream' ? '#FFFDF8' : '#243825';
  const leafHighlight = tone === 'cream' ? '#E5EEE3' : '#384E35';

  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      {/* Atap pendopo saung bagian atas */}
      <path
        d="M60 10C47 22 31 32 14 37C24 41 37 40 48 34C53 31 57 27 60 23C63 27 67 31 72 34C83 40 96 41 106 37C89 32 73 22 60 10Z"
        fill={fill}
      />
      {/* Lapisan atap kedua */}
      <path
        d="M60 28C48 37 33 44 18 47C29 51 42 50 53 45L60 41L67 45C78 50 91 51 102 47C87 44 72 37 60 28Z"
        fill={fill}
        opacity="0.92"
      />
      {/* Tiang kiri & kanan saung */}
      <path
        d="M36 49H43V76H36V49ZM77 49H84V76H77V49Z"
        fill={fill}
      />
      {/* Garis lantai / teras saung */}
      <path
        d="M24 76C48 73 72 73 96 76C82 81 38 81 24 76Z"
        fill={fill}
      />
      {/* Daun melengkung khas Saung Kebun di tengah bawah */}
      <path
        d="M60 48C52 54 49 64 56 72C62 67 66 60 66 52C64 50 62 49 60 48Z"
        fill={leafHighlight}
      />
      <path
        d="M62 56C69 57 74 63 72 71C66 69 61 64 62 56Z"
        fill={fill}
        opacity="0.88"
      />
    </svg>
  );
}

/**
 * Watermark transparan (opacity ~8-12%) untuk kartu hero hijau lumut, profil login, dan header drawer.
 */
export function SaungKebunWatermark({
  className = 'w-40 h-32',
  tone = 'cream',
}: {
  className?: string;
  tone?: 'cream' | 'moss';
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none opacity-[0.10] ${className}`}
    >
      <SaungKebunEmblem className="w-full h-full" tone={tone} />
    </div>
  );
}

export function BrandLogo({
  size = 'md',
  variant = 'light',
  className = '',
  srcOverride,
  altOverride,
}: BrandLogoProps) {
  const { brand } = useAppBrand();
  const hasCustomOverride = srcOverride !== undefined;
  const resolvedSrc = hasCustomOverride
    ? srcOverride || LOGO_SAUNG_KEBUN_SRC
    : brand.logo_url || LOGO_SAUNG_KEBUN_SRC;
  const isDefaultAsset = resolvedSrc === LOGO_SAUNG_KEBUN_SRC;
  const resolvedAlt = altOverride || `Logo ${brand.app_name || 'Saung Kebun'}`;

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  const tone: 'cream' | 'moss' = variant === 'dark' ? 'cream' : 'moss';

  // Gunakan emblem transparan tanpa kotak latar kuning untuk logo resmi default
  if (isDefaultAsset || failed) {
    return (
      <div
        role="img"
        aria-label={resolvedAlt}
        className={`flex items-center justify-center shrink-0 bg-transparent ${SIZE_CLASSES[size]} ${className}`}
      >
        <SaungKebunEmblem className="w-full h-full drop-shadow-xs" tone={tone} />
      </div>
    );
  }

  // Jika pengurus mengunggah logo kustom di pengaturan, tampilkan rapi tanpa bingkai kuning
  return (
    <div
      className={`flex items-center justify-center shrink-0 overflow-hidden rounded-2xl ${SIZE_CLASSES[size]} ${
        variant === 'dark'
          ? 'bg-white/15 backdrop-blur-sm p-1 border border-white/25'
          : 'bg-[#FFFDF8] p-1 border border-[#E6E2D6] shadow-xs'
      } ${className}`}
    >
      <img
        src={resolvedSrc}
        alt={resolvedAlt}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain rounded-[inherit]"
      />
    </div>
  );
}
