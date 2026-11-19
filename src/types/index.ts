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

export type MetodeBayar = 'Transfer Bank' | 'E-Wallet' | 'Setor Tunai';

export type StatusVerifikasi = 'Pending' | 'Terverifikasi' | 'Ditolak';

export type BotProvider = 'Fonnte' | 'Wablas';

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

export const TAHUN_AKTIF = 2026;
export const NOMINAL_IPL_STANDAR = 100000;
export const TANGGAL_TERBIT_TAGIHAN = 1;
export const TANGGAL_JATUH_TEMPO = 7;

export const NAMA_APLIKASI = 'e-Card Verifikasi';
export const SUB_NAMA_APLIKASI = 'IPL Digital — Perumahan Saung Kebun';
export const KOP_RESMI =
  'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B03/07)';
export const WA_PENGURUS = '6281234567890';

export const PETUGAS_PENERIMA: string[] = [
  'Erlangga',
  'Andriansyah',
  'Doni',
  'Wahyu',
  'Pa Iwan',
  'Deny',
];

export const REKENING_KAS = [
  {
    bank: 'Bank BCA',
    nomor: '7401829304',
    atasNama: 'Kas Lingkungan Perumahan Saung Kebun',
    tipe: 'Transfer Bank' as const,
  },
  {
    bank: 'Bank Mandiri',
    nomor: '1730009845120',
    atasNama: 'Pengurus Lingkungan Saung Kebun',
    tipe: 'Transfer Bank' as const,
  },
  {
    bank: 'DANA / GoPay / OVO',
    nomor: '081234567890',
    atasNama: 'Bendahara Saung Kebun (Erlangga)',
    tipe: 'E-Wallet' as const,
  },
];

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
