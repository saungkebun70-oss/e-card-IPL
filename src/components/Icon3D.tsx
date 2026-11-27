import React, { useEffect, useState } from 'react';
import iconChatCepat from '../assets/icons/icon_chat_cepat.png';
import iconDasbor from '../assets/icons/icon_dasbor.png';
import iconDokumen from '../assets/icons/icon_dokumen.png';
import iconEcard from '../assets/icons/icon_ecard.png';
import iconGaleri from '../assets/icons/icon_galeri.png';
import iconHapus from '../assets/icons/icon_hapus.png';
import iconInbox from '../assets/icons/icon_inbox.png';
import iconKamera from '../assets/icons/icon_kamera.png';
import iconKeamanan from '../assets/icons/icon_keamanan.png';
import iconKeluar from '../assets/icons/icon_keluar.png';
import iconKirim from '../assets/icons/icon_kirim.png';
import iconLaporanLpj from '../assets/icons/icon_laporan_lpj.png';
import iconNotifikasi from '../assets/icons/icon_notifikasi.png';
import iconPengaturan from '../assets/icons/icon_pengaturan.png';
import iconPengumuman from '../assets/icons/icon_pengumuman.png';
import iconPlusKas from '../assets/icons/icon_plus_kas.png';
import iconRekap from '../assets/icons/icon_rekap.png';
import iconRiwayat from '../assets/icons/icon_riwayat.png';
import iconScanNfc from '../assets/icons/icon_scan_nfc.png';
import iconSetor from '../assets/icons/icon_setor.png';
import iconSidikJari from '../assets/icons/icon_sidik_jari.png';
import iconVideo from '../assets/icons/icon_video.png';
import iconWarga from '../assets/icons/icon_warga.png';

export type Icon3DName =
  | 'dasbor'
  | 'laporan_lpj'
  | 'chat_cepat'
  | 'notifikasi'
  | 'keamanan'
  | 'pengaturan'
  | 'keluar'
  | 'sidik_jari'
  | 'rekap'
  | 'plus_kas'
  | 'scan_nfc'
  | 'warga'
  | 'hapus'
  | 'inbox'
  | 'pengumuman'
  | 'kirim'
  | 'ecard'
  | 'dokumen'
  | 'galeri'
  | 'kamera'
  | 'riwayat'
  | 'setor'
  | 'video'
  | 'info';

export const ICON_3D_PATHS: Partial<Record<Icon3DName, string>> = {
  dasbor: iconDasbor,
  laporan_lpj: iconLaporanLpj,
  chat_cepat: iconChatCepat,
  notifikasi: iconNotifikasi,
  keamanan: iconKeamanan,
  pengaturan: iconPengaturan,
  keluar: iconKeluar,
  sidik_jari: iconSidikJari,
  rekap: iconRekap,
  plus_kas: iconPlusKas,
  scan_nfc: iconScanNfc,
  warga: iconWarga,
  hapus: iconHapus,
  inbox: iconInbox,
  pengumuman: iconPengumuman,
  kirim: iconKirim,
  ecard: iconEcard,
  dokumen: iconDokumen,
  galeri: iconGaleri,
  kamera: iconKamera,
  riwayat: iconRiwayat,
  setor: iconSetor,
  video: iconVideo,
};

function FallbackInfo3D({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={`select-none pointer-events-none shrink-0 ${className || 'w-6 h-6'}`.trim()}
    >
      <defs>
        <linearGradient id="sk-info3d-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#384E35" />
          <stop offset="100%" stopColor="#243825" />
        </linearGradient>
        <linearGradient id="sk-info3d-cream" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFDF8" />
          <stop offset="100%" stopColor="#E5EEE3" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="9" fill="url(#sk-info3d-bg)" />
      <rect x="8" y="27.5" width="24" height="3.2" rx="1.6" fill="#A6BC9F" />
      <rect x="11" y="18.5" width="3.8" height="9" rx="1.5" fill="url(#sk-info3d-cream)" opacity="0.9" />
      <rect x="18.1" y="18.5" width="3.8" height="9" rx="1.5" fill="url(#sk-info3d-cream)" opacity="0.9" />
      <rect x="25.2" y="18.5" width="3.8" height="9" rx="1.5" fill="url(#sk-info3d-cream)" opacity="0.9" />
      <path d="M9 17.5L20 10L31 17.5Z" fill="url(#sk-info3d-cream)" />
      <circle cx="20" cy="14.2" r="1.4" fill="#243825" />
    </svg>
  );
}

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
    if (name === 'info') {
      return <FallbackInfo3D className={className} />;
    }
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
