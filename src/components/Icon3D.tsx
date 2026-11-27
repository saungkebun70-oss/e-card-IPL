import React from 'react';

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
  | 'video';

export const ICON_3D_PATHS: Record<Icon3DName, string> = {
  dasbor: '/assets/aistudio/icon_dasbor_f171fdfc.png',
  laporan_lpj: '/assets/aistudio/icon_laporan_lpj_d2da1140.png',
  chat_cepat: '/assets/aistudio/icon_chat_cepat_bfc94b13.png',
  notifikasi: '/assets/aistudio/icon_notifikasi_3010fa29.png',
  keamanan: '/assets/aistudio/icon_keamanan_2e9e08a2.png',
  pengaturan: '/assets/aistudio/icon_pengaturan_ed982fed.png',
  keluar: '/assets/aistudio/icon_keluar_50413a21.png',
  sidik_jari: '/assets/aistudio/icon_sidik_jari_a4a50052.png',
  rekap: '/assets/aistudio/icon_rekap_8a2fce4b.png',
  plus_kas: '/assets/aistudio/icon_plus_kas_daf95d60.png',
  scan_nfc: '/assets/aistudio/icon_scan_nfc_619337ad.png',
  warga: '/assets/aistudio/icon_warga_db2c9d36.png',
  hapus: '/assets/aistudio/icon_hapus_7238d9b4.png',
  inbox: '/assets/aistudio/icon_inbox_f952402f.png',
  pengumuman: '/assets/aistudio/icon_pengumuman_e3e05d5e.png',
  kirim: '/assets/aistudio/icon_kirim_8d66a277.png',
  ecard: '/assets/aistudio/icon_ecard_ec05cabc.png',
  dokumen: '/assets/aistudio/icon_dokumen_fdbdf6e8.png',
  galeri: '/assets/aistudio/icon_galeri_33f2f23a.png',
  kamera: '/assets/aistudio/icon_kamera_adca9c4f.png',
  riwayat: '/assets/aistudio/icon_riwayat_bbce9fa8.png',
  setor: '/assets/aistudio/icon_setor_55959636.png',
  video: '/assets/aistudio/icon_video_011a0c30.png',
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
  return (
    <img
      src={ICON_3D_PATHS[name]}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={false}
      loading="eager"
      decoding="async"
      className={`object-contain select-none pointer-events-none shrink-0 rounded-[22%] ${className}`.trim()}
    />
  );
};
