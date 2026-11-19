import { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import defaultLogoAsset from '../assets/images/logo_saung_kebun_1795079984583.jpg';
import { useAppBrand } from '../lib/brandContext';

export const LOGO_SAUNG_KEBUN_SRC = defaultLogoAsset;

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  srcOverride?: string | null;
  altOverride?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'w-10 h-10 rounded-xl p-1',
  md: 'w-12 h-12 rounded-xl p-1',
  lg: 'w-20 h-20 rounded-2xl p-1.5',
  xl: 'w-24 h-24 sm:w-28 sm:h-28 rounded-2xl p-2',
};

export function BrandLogo({
  size = 'md',
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
        className={`bg-[#059669] flex items-center justify-center shrink-0 ${SIZE_CLASSES[size]} ${className}`}
      >
        <Building2 className="w-1/2 h-1/2 text-white" />
      </div>
    );
  }

  return (
    <div
      className={`bg-white flex items-center justify-center shrink-0 overflow-hidden border border-slate-200/80 shadow-sm ${SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src={resolvedSrc}
        alt={resolvedAlt}
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailed(true)}
        className={`w-full h-full object-contain ${isDefaultAsset ? 'scale-125' : ''}`}
      />
    </div>
  );
}
