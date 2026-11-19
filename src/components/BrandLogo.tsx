import { useState } from 'react';
import { Building2 } from 'lucide-react';

export const LOGO_SAUNG_KEBUN_SRC = '/src/assets/images/logo_saung_kebun_1795079984583.jpg';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<BrandLogoProps['size']>, string> = {
  sm: 'w-10 h-10 rounded-xl p-1',
  md: 'w-12 h-12 rounded-xl p-1',
  lg: 'w-20 h-20 rounded-2xl p-1.5',
  xl: 'w-24 h-24 sm:w-28 sm:h-28 rounded-2xl p-2',
};

export function BrandLogo({ size = 'md', className = '' }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

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
        src={LOGO_SAUNG_KEBUN_SRC}
        alt="Logo e-Card Verifikasi & IPL Digital Perumahan Saung Kebun"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-contain scale-125"
      />
    </div>
  );
}
