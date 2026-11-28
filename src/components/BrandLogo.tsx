import { useEffect, useState } from 'react';
import transparentLogoAsset from '../assets/saung-kebun-logo-transparent.png';
import watermarkMossAsset from '../assets/saung-kebun-watermark-moss.png';
import watermarkCreamAsset from '../assets/saung-kebun-watermark-cream.png';
import { useAppBrand } from '../lib/brandContext';

export const LOGO_SAUNG_KEBUN_SRC = transparentLogoAsset;

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'light' | 'dark' | 'transparent';
  className?: string;
  srcOverride?: string | null;
  altOverride?: string;
  showWordmark?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'w-12 h-12',
  sm: 'w-14 h-14',
  md: 'w-16 h-16 sm:w-[4.5rem] sm:h-[4.5rem]',
  lg: 'w-20 h-20 sm:w-24 sm:h-24',
  xl: 'w-24 h-24 sm:w-32 sm:h-32',
};

/**
 * Emblem vektor cadangan Saung Kebun apabila aset gambar kustom gagal dimuat.
 */
export function SaungKebunEmblem({
  className = 'w-10 h-10',
  tone = 'cream',
}: {
  className?: string;
  tone?: 'cream' | 'moss';
}) {
  const fill = tone === 'cream' ? '#E5EEE3' : '#243825';
  const leafHighlight = tone === 'cream' ? '#C6D2BF' : '#384E35';

  return (
    <svg
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M60 10C47 22 31 32 14 37C24 41 37 40 48 34C53 31 57 27 60 23C63 27 67 31 72 34C83 40 96 41 106 37C89 32 73 22 60 10Z"
        fill={fill}
      />
      <path
        d="M60 28C48 37 33 44 18 47C29 51 42 50 53 45L60 41L67 45C78 50 91 51 102 47C87 44 72 37 60 28Z"
        fill={fill}
        opacity="0.92"
      />
      <path
        d="M36 49H43V76H36V49ZM77 49H84V76H77V49Z"
        fill={fill}
      />
      <path
        d="M24 76C48 73 72 73 96 76C82 81 38 81 24 76Z"
        fill={fill}
      />
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

export const WATERMARK_MOSS_SRC = watermarkMossAsset;
export const WATERMARK_CREAM_SRC = watermarkCreamAsset;

/**
 * Watermark transparan (tanpa background) menggunakan logo resmi Saung Kebun
 * untuk latar kartu, sidebar, header drawer, laporan bulanan, dan LPJ.
 */
export function SaungKebunWatermark({
  className = 'right-3 bottom-2 w-28 h-36',
  tone = 'cream',
}: {
  className?: string;
  tone?: 'cream' | 'moss';
}) {
  const hasPosition = /\b(absolute|fixed|relative|static)\b/.test(className);
  const hasOpacity = /\bopacity-/.test(className);
  const src = tone === 'moss' ? WATERMARK_MOSS_SRC : WATERMARK_CREAM_SRC;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none ${hasPosition ? '' : 'absolute'} ${
        hasOpacity ? '' : tone === 'moss' ? 'opacity-[0.07]' : 'opacity-[0.12]'
      } ${className}`.trim()}
    >
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="w-full h-full object-contain"
      />
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
  const rawCustomSrc = hasCustomOverride ? srcOverride : brand.logo_url;
  const isDarkGlass = variant === 'dark' || variant === 'transparent';
  const defaultAsset = transparentLogoAsset;
  const resolvedAlt = altOverride || `Logo ${brand.app_name || 'Saung Kebun'}`;

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [rawCustomSrc]);

  const activeSrc = !failed && rawCustomSrc ? rawCustomSrc : defaultAsset;

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 ${SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src={activeSrc}
        alt={resolvedAlt}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => {
          if (!failed) setFailed(true);
        }}
        className={`w-full h-full object-contain ${
          isDarkGlass
            ? '[filter:drop-shadow(0_0_5px_rgba(255,255,255,0.9))_drop-shadow(0_2px_6px_rgba(10,22,12,0.35))]'
            : ''
        }`}
      />
    </div>
  );
}
