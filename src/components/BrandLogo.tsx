import { useEffect, useId, useState } from 'react';
import watermarkMossAsset from '../assets/saung-kebun-watermark-moss.png';
import watermarkCreamAsset from '../assets/saung-kebun-watermark-cream.png';
import { useAppBrand } from '../lib/brandContext';

export const LOGO_SAUNG_KEBUN_SRC = watermarkMossAsset;

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'light' | 'dark' | 'transparent';
  className?: string;
  srcOverride?: string | null;
  altOverride?: string;
  showWordmark?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'w-10 h-11',
  sm: 'w-11 h-12 sm:w-12 sm:h-13',
  md: 'w-13 h-15 sm:w-14 sm:h-16',
  lg: 'w-18 h-20 sm:w-20 sm:h-24',
  xl: 'w-24 h-28 sm:w-28 sm:h-32',
};

/**
 * Logo SVG transparan resmi Saung Kebun (100% tanpa background & tanpa kotak pembungkus):
 * - Siluet rumah hijau tua (#105C2B) dengan potongan dua helai daun kecil di dalam rumah
 * - Siluet daun hijau daun (#598226) melengkung di sisi kiri beserta 3 helai tunas & tulang daun
 * - Teks "SAUNG" dan "KEBUN" berwarna hijau daun (#496E24) di bawah emblem
 */
export function SaungKebunEmblem({
  className = 'w-11 h-12',
  ariaLabel,
}: {
  className?: string;
  tone?: 'cream' | 'moss';
  ariaLabel?: string;
}) {
  const uid = useId().replace(/:/g, '');
  const veinMaskId = `sk-vein-${uid}`;
  const houseLeavesMaskId = `sk-house-leaves-${uid}`;

  return (
    <svg
      viewBox="0 0 220 296"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel || undefined}
      aria-hidden={ariaLabel ? undefined : true}
      className={className}
    >
      <defs>
        <mask id={veinMaskId}>
          <rect width="220" height="296" fill="white" />
          <path
            d="M 63 88 C 66 122 81 146 111 164 L 106 168 C 74 148 59 122 59 88 Z"
            fill="black"
          />
        </mask>
        <mask id={houseLeavesMaskId}>
          <rect width="220" height="296" fill="white" />
          <path
            d="M 146 95 C 134 102 132 117 140 126 C 147 119 150 106 146 95 Z"
            fill="black"
          />
          <path
            d="M 171 124 C 155 121 141 129 138 142 C 151 144 162 134 171 124 Z"
            fill="black"
          />
          <path
            d="M 110 165 C 122 162 132 152 137 140 C 141 131 149 128 158 130 C 148 134 142 141 139 151 C 135 162 126 167 112 168 Z"
            fill="black"
          />
        </mask>
      </defs>

      {/* Daun kecil melengkung di kiri puncak atap */}
      <path
        d="M 79 44 C 72 34 75 21 89 19 C 85 26 83 34 83 41 C 86 38 92 31 99 27 C 90 36 85 43 79 44 Z"
        fill="#105C2B"
      />

      {/* Siluet rumah hijau tua + potongan dua helai daun kecil di dalam rumah */}
      <path
        mask={`url(#${houseLeavesMaskId})`}
        d="M 73 48 C 77 52 84 52 91 46 L 122 22 L 210 93 L 176 93 L 176 164 L 116 164 L 110 160 C 127 153 135 136 128 119 C 120 100 94 84 78 65 C 73 59 71 53 73 48 Z"
        fill="#105C2B"
      />

      {/* Tunas 3 helai daun atas & daun utama melengkung di sisi kiri */}
      <g mask={`url(#${veinMaskId})`}>
        <path
          d="M 65 44 C 55 31 50 16 52 3 C 62 12 68 26 67 42 Z"
          fill="#598226"
        />
        <path
          d="M 61 48 C 46 47 34 40 27 30 C 40 31 53 37 63 46 Z"
          fill="#598226"
        />
        <path
          d="M 68 43 C 69 32 74 22 81 16 C 78 26 75 35 70 44 Z"
          fill="#598226"
        />
        <path
          d="M 68 44 C 66 56 76 74 93 92 C 113 113 128 130 123 149 C 120 158 112 162 104 164 C 76 158 55 137 52 108 C 50 85 57 62 68 44 Z"
          fill="#598226"
        />
      </g>

      {/* Teks SAUNG dan KEBUN */}
      <text
        x="110"
        y="218"
        textAnchor="middle"
        fill="#496E24"
        fontFamily="'Optima', 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif"
        fontSize="40"
        fontWeight="500"
        letterSpacing="3.2"
      >
        SAUNG
      </text>
      <text
        x="110"
        y="274"
        textAnchor="middle"
        fill="#496E24"
        fontFamily="'Optima', 'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif"
        fontSize="40"
        fontWeight="500"
        letterSpacing="3.2"
      >
        KEBUN
      </text>
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
  const customSrc = hasCustomOverride ? srcOverride : null;
  const isDarkSurface = variant === 'dark' || variant === 'transparent';
  const resolvedAlt = altOverride || `Logo ${brand.app_name || 'Saung Kebun'}`;

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [customSrc]);

  const contrastFilter = isDarkSurface
    ? 'drop-shadow-sm [filter:drop-shadow(0_0_2.5px_rgba(255,253,248,0.88))_drop-shadow(0_1px_2px_rgba(0,0,0,0.28))]'
    : '';

  if (customSrc && !failed) {
    return (
      <img
        src={customSrc}
        alt={resolvedAlt}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailed(true)}
        className={`shrink-0 object-contain select-none ${SIZE_CLASSES[size]} ${contrastFilter} ${className}`.trim()}
      />
    );
  }

  return (
    <SaungKebunEmblem
      ariaLabel={resolvedAlt}
      className={`shrink-0 select-none ${SIZE_CLASSES[size]} ${contrastFilter} ${className}`.trim()}
    />
  );
}
