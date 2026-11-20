import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import defaultLogoAsset from '../assets/images/logo_saung_kebun_1795079984583.jpg';
import { useAppBrand } from '../lib/brandContext';

export const LOGO_SAUNG_KEBUN_SRC = defaultLogoAsset;

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'light' | 'dark';
  className?: string;
  srcOverride?: string | null;
  altOverride?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'w-10 h-10 rounded-xl',
  md: 'w-12 h-12 rounded-xl',
  lg: 'w-16 h-16 sm:w-20 sm:h-20 rounded-2xl',
  xl: 'w-20 h-20 sm:w-24 sm:h-24 rounded-2xl',
};

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
  const resolvedAlt = altOverride || `Logo ${brand.app_name}`;

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (failed) {
    return (
      <div
        className={`bg-[#059669] flex items-center justify-center shrink-0 shadow-md ring-1 ring-emerald-400/30 ${SIZE_CLASSES[size]} ${className}`}
      >
        <Building2 className="w-1/2 h-1/2 text-white" />
      </div>
    );
  }

  // Wadah proporsional tanpa padding putih berlebih agar menyatu elegan dengan latar gelap/emerald
  const frameSurface = isDefaultAsset
    ? variant === 'dark'
      ? 'bg-[#F5F4D8] p-0.5 shadow-lg ring-1 ring-emerald-400/35'
      : 'bg-[#F5F4D8] p-0.5 shadow-sm ring-1 ring-slate-200/90'
    : variant === 'dark'
      ? 'bg-white/95 p-1 shadow-lg ring-1 ring-emerald-400/30'
      : 'bg-white p-1 shadow-sm ring-1 ring-slate-200/90';

  return (
    <div
      className={`flex items-center justify-center shrink-0 overflow-hidden ${SIZE_CLASSES[size]} ${frameSurface} ${className}`}
    >
      <img
        src={resolvedSrc}
        alt={resolvedAlt}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailed(true)}
        className={`w-full h-full rounded-[inherit] ${
          isDefaultAsset ? 'object-cover scale-[1.06]' : 'object-contain'
        }`}
      />
    </div>
  );
}
