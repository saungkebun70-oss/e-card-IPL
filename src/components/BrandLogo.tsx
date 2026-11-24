import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import defaultLogoAsset from '../assets/images/saung_kebun_logo_1795360829159.jpg';
import { useAppBrand } from '../lib/brandContext';

export const LOGO_SAUNG_KEBUN_SRC = defaultLogoAsset;

interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'light' | 'dark';
  className?: string;
  srcOverride?: string | null;
  altOverride?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'w-10 h-10 rounded-xl',
  sm: 'w-11 h-11 sm:w-12 sm:h-12 rounded-xl',
  md: 'w-14 h-14 rounded-2xl',
  lg: 'w-20 h-20 sm:w-24 sm:h-24 rounded-2xl',
  xl: 'w-24 h-24 sm:w-[104px] sm:h-[104px] rounded-2xl',
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
  const resolvedAlt = altOverride || `Logo ${brand.app_name || 'Saung Kebun'}`;

  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (failed) {
    return (
      <div
        className={`bg-[#4A583E] flex items-center justify-center shrink-0 shadow-md border border-[#EAE4D3]/40 ${SIZE_CLASSES[size]} ${className}`}
      >
        <Building2 className="w-1/2 h-1/2 text-[#F5F2E4]" />
      </div>
    );
  }

  // Bingkai krem hangat (#F4F0E0 / #EAE4D3) menyatu mulus dengan logo resmi SAUNG KEBUN
  const frameSurface = isDefaultAsset
    ? variant === 'dark'
      ? 'bg-[#F4F0E0] p-0 shadow-md shadow-black/20 border border-[#EAE4D3]/60'
      : 'bg-[#F4F0E0] p-0 shadow-md shadow-[#4A583E]/10 border border-[#4A583E]/15'
    : variant === 'dark'
      ? 'bg-white/95 p-1 shadow-md shadow-black/20 border border-white/40'
      : 'bg-white p-1 shadow-md shadow-slate-900/5 border border-slate-200/90';

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
        className={`w-full h-full object-contain rounded-[inherit] ${
          isDefaultAsset ? 'scale-[1.16]' : ''
        }`}
      />
    </div>
  );
}
