export type UserRole = 'warga' | 'admin';

export type AdminJabatan =
  | 'Ketua'
  | 'Bendahara'
  | 'Humas'
  | 'Seksi Olahraga'
  | 'Pembina';

export type AdminPermission = 'full' | 'add_only';

export type StatusHunian = 'Tetap' | 'Kontrak' | 'Kosong';

export type StatusBulanEcard =
  | 'Lunas'
  | 'Menunggu Verifikasi'
  | 'Jatuh Tempo'
  | 'Belum Bayar'
  | 'Belum Tagihan';

export type MetodeBayar = 'QRIS' | 'Transfer Bank' | 'E-Wallet' | 'Setor Tunai';

export type StatusVerifikasi = 'Pending' | 'Terverifikasi' | 'Ditolak';

export type BotProvider = 'Fonnte' | 'Wablas';

export interface RekeningPembayaran {
  id: string;
  bank: string;
  nomor: string;
  atasNama: string;
  tipe: 'Transfer Bank' | 'E-Wallet';
}

export interface PaymentConfig {
  id: string;
  qris_aktif: boolean;
  qris_image_url: string | null;
  qris_label: string;
  qris_catatan: string;
  rekening_list: RekeningPembayaran[];
  updated_at: string;
  updated_by?: string | null;
}

export interface PengurusItem {
  jabatan: AdminJabatan;
  nama: string;
  username: string;
  blokRumah: string;
  permission: AdminPermission;
}

export interface SessionUser {
  role: UserRole;
  blok_rumah: string;
  nama_warga: string;
  jabatan?: AdminJabatan;
  admin_permission?: AdminPermission;
  status_hunian?: StatusHunian;
  no_wa?: string;
  nominal_iuran?: number;
  login_at: string;
}

export function isBendaharaFullAccess(session?: SessionUser | null): boolean {
  return session?.role === 'admin' && session.admin_permission === 'full';
}

export interface Warga {
  id: string;
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  status_hunian: StatusHunian;
  nominal_iuran: number;
  pin_akses: string;
  aktif: boolean;
  created_at: string;
}

export interface StatusEcardBulanan {
  id: string;
  blok_rumah: string;
  tahun: number;
  bulan: number; // 1 - 12
  status: StatusBulanEcard;
  transaksi_id?: string | null;
  updated_at: string;
}

export interface TransaksiIPL {
  id: string;
  no_kwitansi: string;
  blok_rumah: string;
  nama_warga: string;
  tahun: number;
  bulan_dibayar: number[];
  nominal: number;
  metode_bayar: MetodeBayar;
  petugas_penerima?: string | null;
  bukti_url?: string | null;
  status_verifikasi: StatusVerifikasi;
  catatan_admin?: string | null;
  keterangan?: string | null;
  tanggal_setor: string;
  verified_at?: string | null;
  verified_by?: string | null;
}

export interface BotWaConfig {
  id: string;
  aktif: boolean;
  provider: BotProvider;
  api_endpoint: string;
  api_token: string;
  jadwal_tgl_1: boolean;
  jadwal_tgl_6: boolean;
  jadwal_tgl_7: boolean;
  jadwal_tgl_8_plus: boolean;
  template_pesan: string;
  updated_at: string;
}

export interface BotWaLog {
  id: string;
  created_at: string;
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  jenis_pesan: string;
  status_kirim: 'Terkirim' | 'Gagal';
  respon_gateway: string;
  pesan: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor_role: 'admin' | 'warga' | 'system';
  actor_id: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export type NotificationCategory =
  | 'Perawatan & Fasilitas'
  | 'Pengumuman Umum'
  | 'Keamanan'
  | 'Keuangan & IPL';

export type NotificationTargetScope = 'all_active' | 'all_units';

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  target_scope: NotificationTargetScope;
  recipient_count: number;
  recipient_blocks?: string[];
  sender_name: string;
  sender_jabatan: string;
  created_at: string;
}

export const BULK_NOTIFICATION_TEMPLATES: Array<{
  label: string;
  category: NotificationCategory;
  title: string;
  message: string;
}> = [
  {
    label: 'Jadwal Perawatan / Kerja Bakti',
    category: 'Perawatan & Fasilitas',
    title: 'Jadwal Perawatan Saluran & Kerja Bakti Lingkungan',
    message:
      'Diberitahukan kepada seluruh warga Perumahan Saung Kebun bahwa akan dilaksanakan perawatan saluran air dan kerja bakti lingkungan pada hari Minggu pukul 07.30 WIB. Mohon partisipasi warga dan pastikan kendaraan tidak menghalangi area saluran utama.',
  },
  {
    label: 'Pemeliharaan Air / Listrik',
    category: 'Perawatan & Fasilitas',
    title: 'Informasi Pemeliharaan Jaringan Air & Penerangan Jalan',
    message:
      'Akan dilakukan pengecekan dan perawatan instalasi penerangan jalan serta pompa lingkungan besok pukul 09.00–12.00 WIB. Mohon maaf atas ketidaknyamanan sementara selama proses pekerjaan berlangsung.',
  },
  {
    label: 'Rapat & Koordinasi Warga',
    category: 'Pengumuman Umum',
    title: 'Undangan Pertemuan Rutin Warga Perumahan Saung Kebun',
    message:
      'Mengundang seluruh kepala keluarga Perumahan Saung Kebun untuk menghadiri pertemuan rutin warga di area Sekretariat Blok B03/07 pada hari Sabtu pukul 19.30 WIB guna membahas program kebersihan dan keamanan lingkungan.',
  },
];

export const TAHUN_AKTIF = 2026;
export const NOMINAL_IPL_STANDAR = 100000;
export const TANGGAL_TERBIT_TAGIHAN = 1;
export const TANGGAL_JATUH_TEMPO = 7;

export const NAMA_APLIKASI = 'e-Card Verifikasi';
export const SUB_NAMA_APLIKASI = 'IPL Digital — Perumahan Saung Kebun';
export const KOP_RESMI =
  'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B03/07)';
export const WA_PENGURUS = '6281234567890';

export const SUSUNAN_PENGURUS: PengurusItem[] = [
  { jabatan: 'Pembina', nama: 'Bp. Iwan', username: 'bpiwan', blokRumah: 'B8/5', permission: 'add_only' },
  { jabatan: 'Ketua', nama: 'Erlangga', username: 'erlangga', blokRumah: 'B3/7', permission: 'add_only' },
  { jabatan: 'Bendahara', nama: 'Andriansyah', username: 'andriansyah', blokRumah: 'B7/16', permission: 'full' },
  { jabatan: 'Humas', nama: 'Doni', username: 'doni', blokRumah: 'B5/21', permission: 'add_only' },
  { jabatan: 'Humas', nama: 'Wahyu', username: 'wahyu', blokRumah: 'B5/24', permission: 'add_only' },
  { jabatan: 'Seksi Olahraga', nama: 'Deny', username: 'deny', blokRumah: 'B8/6', permission: 'add_only' },
];

export const PETUGAS_PENERIMA: string[] = SUSUNAN_PENGURUS.map(
  (p) => `${p.nama} (${p.jabatan})`
);

export const REKENING_KAS: RekeningPembayaran[] = [
  {
    id: 'rek-bca-default',
    bank: 'Bank BCA',
    nomor: '7401829304',
    atasNama: 'Kas Lingkungan Perumahan Saung Kebun (Bendahara Andriansyah)',
    tipe: 'Transfer Bank',
  },
  {
    id: 'rek-mandiri-default',
    bank: 'Bank Mandiri',
    nomor: '1730009845120',
    atasNama: 'Pengurus Lingkungan Perumahan Saung Kebun',
    tipe: 'Transfer Bank',
  },
  {
    id: 'rek-ewallet-default',
    bank: 'DANA / GoPay / OVO',
    nomor: '081234567890',
    atasNama: 'Bendahara Saung Kebun (Andriansyah)',
    tipe: 'E-Wallet',
  },
];

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  id: 'default-payment-config',
  qris_aktif: false,
  qris_image_url: null,
  qris_label: 'QRIS Kas Lingkungan Perumahan Saung Kebun',
  qris_catatan: 'Scan kode QRIS di atas via m-Banking atau E-Wallet, lalu unggah bukti bayar di bawah.',
  rekening_list: REKENING_KAS,
  updated_at: '2026-11-01T07:00:00.000Z',
  updated_by: 'andriansyah',
};

export const BULAN_LIST = [
  { angka: 1, nama: 'Januari', singkat: 'Jan' },
  { angka: 2, nama: 'Februari', singkat: 'Feb' },
  { angka: 3, nama: 'Maret', singkat: 'Mar' },
  { angka: 4, nama: 'April', singkat: 'Apr' },
  { angka: 5, nama: 'Mei', singkat: 'Mei' },
  { angka: 6, nama: 'Juni', singkat: 'Jun' },
  { angka: 7, nama: 'Juli', singkat: 'Jul' },
  { angka: 8, nama: 'Agustus', singkat: 'Agu' },
  { angka: 9, nama: 'September', singkat: 'Sep' },
  { angka: 10, nama: 'Oktober', singkat: 'Okt' },
  { angka: 11, nama: 'November', singkat: 'Nov' },
  { angka: 12, nama: 'Desember', singkat: 'Des' },
] as const;

export const TEMPLATE_VARIABLES = [
  '{nama_warga}',
  '{blok_rumah}',
  '{bulan_tagihan}',
  '{nominal_tagihan}',
  '{link_aplikasi}',
] as const;
