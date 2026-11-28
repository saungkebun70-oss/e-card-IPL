import React, { useEffect, useState } from 'react';
import iconDasbor from '../assets/icons/icon_dasbor.png';
import iconEcard from '../assets/icons/icon_ecard.png';
import iconInfo from '../assets/icons/icon_info.png';
import iconKeamanan from '../assets/icons/icon_keamanan.png';
import iconPembayaran from '../assets/icons/icon_pembayaran.png';
import iconPetugasPeta from '../assets/icons/icon_petugas_peta.png';
import iconPlusKas from '../assets/icons/icon_plus_kas.png';
import iconRekap from '../assets/icons/icon_rekap.png';
import iconRiwayat from '../assets/icons/icon_riwayat.png';
import iconScanNfc from '../assets/icons/icon_scan_nfc.png';
import iconSetor from '../assets/icons/icon_setor.png';
import iconWarga from '../assets/icons/icon_warga.png';

export type Icon3DName =
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
  | 'pembayaran'
  | 'petugas_peta';

export const ICON_3D_PATHS: Record<Icon3DName, string> = {
  dasbor: iconDasbor,
  warga: iconWarga,
  plus_kas: iconPlusKas,
  rekap: iconRekap,
  keamanan: iconKeamanan,
  ecard: iconEcard,
  riwayat: iconRiwayat,
  setor: iconSetor,
  info: iconInfo,
  scan_nfc: iconScanNfc,
  pembayaran: iconPembayaran,
  petugas_peta: iconPetugasPeta,
};

interface Icon3DProps {
  name: Icon3DName;
  alt?: string;
  className?: string;
}

export const Icon3D: React.FC<Icon3DProps> = ({
  name,
  alt = '',
  className = 'w-6 h-6',
}) => {
  const src = ICON_3D_PATHS[name];
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src, name]);

  if (!src || failed) {
    return (
      <span
        aria-hidden={alt ? undefined : true}
        aria-label={alt || undefined}
        className={`inline-flex items-center justify-center rounded-[22%] bg-gradient-to-br from-[#384E35] to-[#243825] text-[#FFFDF8] font-bold text-[10px] select-none pointer-events-none shrink-0 ${className}`.trim()}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      loading="eager"
      decoding="async"
      onError={() => setFailed(true)}
      className={`object-contain select-none pointer-events-none shrink-0 rounded-[22%] ${className}`.trim()}
    />
  );
};
