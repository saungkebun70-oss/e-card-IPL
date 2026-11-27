import React, { useEffect, useState } from 'react';
import iconCari from '../assets/icons/icon_cari.png';
import iconCentang from '../assets/icons/icon_centang.png';
import iconCetak from '../assets/icons/icon_cetak.png';
import iconChatCepat from '../assets/icons/icon_chat_cepat.png';
import iconDasbor from '../assets/icons/icon_dasbor.png';
import iconDelegasi from '../assets/icons/icon_delegasi.png';
import iconDokumen from '../assets/icons/icon_dokumen.png';
import iconEcard from '../assets/icons/icon_ecard.png';
import iconExcel from '../assets/icons/icon_excel.png';
import iconFilter from '../assets/icons/icon_filter.png';
import iconGaleri from '../assets/icons/icon_galeri.png';
import iconGantiPin from '../assets/icons/icon_ganti_pin.png';
import iconHapus from '../assets/icons/icon_hapus.png';
import iconIdentitas from '../assets/icons/icon_identitas.png';
import iconInbox from '../assets/icons/icon_inbox.png';
import iconInfo from '../assets/icons/icon_info.png';
import iconKamera from '../assets/icons/icon_kamera.png';
import iconKeamanan from '../assets/icons/icon_keamanan.png';
import iconKeluar from '../assets/icons/icon_keluar.png';
import iconKirim from '../assets/icons/icon_kirim.png';
import iconKirimWa from '../assets/icons/icon_kirim_wa.png';
import iconLaporanBug from '../assets/icons/icon_laporan_bug.png';
import iconLaporanLpj from '../assets/icons/icon_laporan_lpj.png';
import iconNotifikasi from '../assets/icons/icon_notifikasi.png';
import iconPengaturan from '../assets/icons/icon_pengaturan.png';
import iconPengumuman from '../assets/icons/icon_pengumuman.png';
import iconPlusKas from '../assets/icons/icon_plus_kas.png';
import iconProfil from '../assets/icons/icon_profil.png';
import iconRefresh from '../assets/icons/icon_refresh.png';
import iconRekap from '../assets/icons/icon_rekap.png';
import iconRiwayat from '../assets/icons/icon_riwayat.png';
import iconScanNfc from '../assets/icons/icon_scan_nfc.png';
import iconSetor from '../assets/icons/icon_setor.png';
import iconSidikJari from '../assets/icons/icon_sidik_jari.png';
import iconUnduhPdf from '../assets/icons/icon_unduh_pdf.png';
import iconVideo from '../assets/icons/icon_video.png';
import iconWarga from '../assets/icons/icon_warga.png';

export type Icon3DName =
  | 'dasbor'
  | 'laporan_lpj'
  | 'laporan_bug'
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
  | 'kirim_wa'
  | 'ecard'
  | 'dokumen'
  | 'galeri'
  | 'kamera'
  | 'riwayat'
  | 'setor'
  | 'video'
  | 'info'
  | 'profil'
  | 'delegasi'
  | 'identitas'
  | 'refresh'
  | 'ganti_pin'
  | 'cari'
  | 'filter'
  | 'cetak'
  | 'unduh_pdf'
  | 'excel'
  | 'centang';

export const ICON_3D_PATHS: Record<Icon3DName, string> = {
  dasbor: iconDasbor,
  laporan_lpj: iconLaporanLpj,
  laporan_bug: iconLaporanBug,
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
  kirim_wa: iconKirimWa,
  ecard: iconEcard,
  dokumen: iconDokumen,
  galeri: iconGaleri,
  kamera: iconKamera,
  riwayat: iconRiwayat,
  setor: iconSetor,
  video: iconVideo,
  info: iconInfo,
  profil: iconProfil,
  delegasi: iconDelegasi,
  identitas: iconIdentitas,
  refresh: iconRefresh,
  ganti_pin: iconGantiPin,
  cari: iconCari,
  filter: iconFilter,
  cetak: iconCetak,
  unduh_pdf: iconUnduhPdf,
  excel: iconExcel,
  centang: iconCentang,
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
