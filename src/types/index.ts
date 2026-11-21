export type UserRole = 'warga' | 'admin' | 'petugas';

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

export type StatusVerifikasi =
  | 'Pending'
  | 'ACC Bendahara'
  | 'Terverifikasi'
  | 'Ditolak';

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
  nominal_ipl_bulanan?: number;
  updated_at: string;
  updated_by?: string | null;
}

export interface AppBrandConfig {
  id: string;
  app_name: string;
  app_subtitle: string;
  kop_resmi: string;
  logo_url: string | null;
  stempel_url?: string | null;
  wa_pengurus: string;
  wa_pengurus_label: string;
  wa_bot: string;
  pengurus_wa_map: Record<string, string>;
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

export interface PengurusAccountInfo extends PengurusItem {
  pin_akses?: string;
  no_wa?: string;
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
  petugas_id?: string;
  shift?: string;
  login_at: string;
}

export function isBendaharaFullAccess(session?: SessionUser | null): boolean {
  return session?.role === 'admin' && session.admin_permission === 'full';
}

export function isBendaharaOnly(session?: SessionUser | null): boolean {
  return (
    session?.role === 'admin' &&
    (session.jabatan === 'Bendahara' || session.admin_permission === 'full')
  );
}

export function isKetuaRole(session?: SessionUser | null): boolean {
  return session?.role === 'admin' && session.jabatan === 'Ketua';
}

export function getStatusVerifikasiLabel(status?: StatusVerifikasi | string | null): string {
  switch (status) {
    case 'Pending':
      return 'Menunggu Verifikasi Bendahara';
    case 'ACC Bendahara':
      return 'ACC Bendahara — Menunggu Verifikasi Ketua';
    case 'Terverifikasi':
      return 'Terverifikasi Sah (Bendahara & Ketua)';
    case 'Ditolak':
      return 'Ditolak';
    default:
      return 'Terverifikasi Sah (Bendahara & Ketua)';
  }
}

export function getStatusVerifikasiShortLabel(status?: StatusVerifikasi | string | null): string {
  switch (status) {
    case 'Pending':
      return 'Menunggu Bendahara';
    case 'ACC Bendahara':
      return 'ACC Bendahara';
    case 'Terverifikasi':
      return 'Sah Disetujui Ketua';
    case 'Ditolak':
      return 'Ditolak';
    default:
      return 'Sah Disetujui Ketua';
  }
}

export type BotAccessRole = 'warga' | 'admin' | 'bendahara';

export interface Warga {
  id: string;
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  secondary_whatsapp?: string | null;
  status_hunian: StatusHunian;
  nominal_iuran: number;
  pin_akses: string;
  bot_role?: BotAccessRole | null;
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
  bendahara_approved_at?: string | null;
  bendahara_approved_by?: string | null;
  ketua_approved_at?: string | null;
  ketua_approved_by?: string | null;
  ketua_catatan?: string | null;
}

export type JenisTransaksiKas = 'pengeluaran' | 'pemasukan_lain';

export type KategoriPengeluaran =
  | 'Honorarium Keamanan / Satpam'
  | 'Lembur Petugas Keamanan'
  | 'Kebersihan & Pengangkutan Sampah'
  | 'Listrik PJU & Pos Keamanan'
  | 'Perbaikan Fasilitas Umum'
  | 'ATK & Administrasi Sekretariat'
  | 'Kegiatan Warga & Sosial'
  | 'Lain-lain';

export type JenisHonorPetugas = 'honor_rutin' | 'lembur';

export type TerminPengeluaran =
  | 'Termin Tgl 7'
  | 'Termin Tgl 18'
  | 'Bulanan'
  | 'Insidental';

export type KategoriPemasukanLain =
  | 'Dana Darurat / Setoran Parsial'
  | 'Sumbangan / Donasi Warga'
  | 'Saldo Kas Awal'
  | 'Pemasukan Lain-lain';

export interface TransaksiKas {
  id: string;
  no_bukti: string;
  jenis: JenisTransaksiKas;
  kategori: string;
  termin?: string | null;
  tanggal: string; // YYYY-MM-DD
  nominal: number;
  penerima_atau_sumber: string;
  keterangan?: string | null;
  bukti_url?: string | null;
  petugas_id?: string | null;
  jenis_honor?: JenisHonorPetugas | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at?: string;
  status_verifikasi?: StatusVerifikasi;
  bendahara_approved_at?: string | null;
  bendahara_approved_by?: string | null;
  ketua_approved_at?: string | null;
  ketua_approved_by?: string | null;
  ketua_catatan?: string | null;
  catatan_verifikasi?: string | null;
}

export const KATEGORI_PENGELUARAN_LIST: KategoriPengeluaran[] = [
  'Honorarium Keamanan / Satpam',
  'Lembur Petugas Keamanan',
  'Kebersihan & Pengangkutan Sampah',
  'Listrik PJU & Pos Keamanan',
  'Perbaikan Fasilitas Umum',
  'ATK & Administrasi Sekretariat',
  'Kegiatan Warga & Sosial',
  'Lain-lain',
];

export const TERMIN_PENGELUARAN_LIST: TerminPengeluaran[] = [
  'Termin Tgl 7',
  'Termin Tgl 18',
  'Bulanan',
  'Insidental',
];

export const KATEGORI_PEMASUKAN_LAIN_LIST: KategoriPemasukanLain[] = [
  'Dana Darurat / Setoran Parsial',
  'Sumbangan / Donasi Warga',
  'Saldo Kas Awal',
  'Pemasukan Lain-lain',
];

export const TRIWULAN_LIST = [
  { id: 1, label: 'Triwulan I', rentang: 'Januari – Maret', bulan: [1, 2, 3] as const },
  { id: 2, label: 'Triwulan II', rentang: 'April – Juni', bulan: [4, 5, 6] as const },
  { id: 3, label: 'Triwulan III', rentang: 'Juli – September', bulan: [7, 8, 9] as const },
  { id: 4, label: 'Triwulan IV', rentang: 'Oktober – Desember', bulan: [10, 11, 12] as const },
] as const;

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
  actor_role: 'admin' | 'warga' | 'petugas' | 'system';
  actor_id: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id?: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

// =========================================================================
// Portal Petugas Keamanan, Titik Checkpoint RFID/NFC & Log Patroli
// =========================================================================

export type StatusKondisiPatroli = 'Aman' | 'Ada Catatan';
export type MetodeScanPatroli = 'NFC Tap' | 'Input Manual';

export interface PetugasKeamanan {
  id: string;
  nama: string;
  username: string;
  pin?: string;
  no_hp: string;
  shift: string;
  aktif: boolean;
  created_at: string;
}

export interface PetugasKontakDarurat {
  id: string;
  nama: string;
  no_hp: string;
  shift: string;
}

export interface TitikPatroli {
  id: string;
  nama_lokasi: string;
  rfid_uid: string;
  keterangan?: string | null;
  x_percent?: number | null;
  y_percent?: number | null;
  aktif: boolean;
  created_at: string;
}

export interface PatrolPinCoordinate {
  x_percent: number;
  y_percent: number;
}

export interface PatrolMapConfig {
  map_image_url: string | null;
  cycle_reset_at: string | null;
  pin_positions: Record<string, PatrolPinCoordinate>;
  updated_at?: string;
  updated_by?: string | null;
}

export interface LogPatroli {
  id: string;
  petugas_id: string;
  nama_petugas: string;
  titik_id?: string | null;
  nama_lokasi: string;
  waktu_scan: string;
  metode_scan: MetodeScanPatroli;
  status_kondisi: StatusKondisiPatroli;
  catatan?: string | null;
}

export interface RoutePathPoint {
  lat: number;
  lng: number;
  time: string;
}

export interface PatrolCheckpoint {
  id: string;
  name: string;
  nfc_tag_id: string;
  lat: number;
  lng: number;
  order_index: number;
}

export type PatrolSessionStatus = 'active' | 'completed';

export interface PatrolSession {
  id: string;
  officer_id: string;
  officer_name: string;
  status: PatrolSessionStatus;
  current_lat: number | null;
  current_lng: number | null;
  route_path: RoutePathPoint[];
  started_at: string;
  ended_at: string | null;
  last_ping_at: string | null;
}

export interface PatrolScan {
  id: string;
  session_id: string;
  checkpoint_id: string;
  officer_name: string;
  nfc_serial: string | null;
  lat: number | null;
  lng: number | null;
  scanned_at: string;
}

/**
 * 5 Pos Checkpoint default Perumahan Saung Kebun (Desa Bengle, Kec. Majalaya, Kab. Karawang).
 * Ketua/Admin dapat langsung mengkalibrasi koordinat GPS & ID Stiker NFC di lapangan.
 */
export const DEFAULT_PATROL_CHECKPOINTS: PatrolCheckpoint[] = [
  {
    id: 'cp-pos-1',
    name: 'Pos 1 — Gerbang Utama & Pos Jaga',
    nfc_tag_id: 'NFC-POS-01',
    lat: -6.32745,
    lng: 107.33965,
    order_index: 1,
  },
  {
    id: 'cp-pos-2',
    name: 'Pos 2 — Sudut Blok A',
    nfc_tag_id: 'NFC-POS-02',
    lat: -6.32712,
    lng: 107.34025,
    order_index: 2,
  },
  {
    id: 'cp-pos-3',
    name: 'Pos 3 — Blok B Tengah & Sekretariat',
    nfc_tag_id: 'NFC-POS-03',
    lat: -6.32668,
    lng: 107.34018,
    order_index: 3,
  },
  {
    id: 'cp-pos-4',
    name: 'Pos 4 — Fasum & Taman Warga',
    nfc_tag_id: 'NFC-POS-04',
    lat: -6.32642,
    lng: 107.33978,
    order_index: 4,
  },
  {
    id: 'cp-pos-5',
    name: 'Pos 5 — Pagar Utara & Blok Belakang',
    nfc_tag_id: 'NFC-POS-05',
    lat: -6.32625,
    lng: 107.34052,
    order_index: 5,
  },
];

export const SHIFT_PETUGAS_OPTIONS = [
  'Shift Pagi (07.00 – 19.00)',
  'Shift Malam (19.00 – 07.00)',
  'Shift Pagi (06.00 – 14.00)',
  'Shift Siang (14.00 – 22.00)',
  'Shift Malam (22.00 – 06.00)',
  'Siaga 24 Jam / Cadangan',
] as const;

export const SEED_TITIK_PATROLI: TitikPatroli[] = [
  {
    id: 'titik-gerbang',
    nama_lokasi: 'Pos Utama',
    rfid_uid: 'NFC-GERBANG-01',
    keterangan: 'Pintu masuk utama & pos jaga depan',
    x_percent: 12.5,
    y_percent: 76.0,
    aktif: true,
    created_at: '2026-11-01T07:00:00.000Z',
  },
  {
    id: 'titik-bloka',
    nama_lokasi: 'Checkpoint 2 (Blok A)',
    rfid_uid: 'NFC-BLOKA-02',
    keterangan: 'Sudut jalan ujung Blok A & batas pagar barat',
    x_percent: 64.0,
    y_percent: 76.0,
    aktif: true,
    created_at: '2026-11-01T07:00:00.000Z',
  },
  {
    id: 'titik-blokb',
    nama_lokasi: 'Checkpoint 3 (Blok B Tengah)',
    rfid_uid: 'NFC-BLOKB-03',
    keterangan: 'Area persimpangan Blok B3–B7 & Sekretariat',
    x_percent: 62.5,
    y_percent: 45.5,
    aktif: true,
    created_at: '2026-11-01T07:00:00.000Z',
  },
  {
    id: 'titik-fasum',
    nama_lokasi: 'Checkpoint 4 (Fasum & Taman)',
    rfid_uid: 'NFC-FASUM-04',
    keterangan: 'Area fasilitas umum, taman, dan lapangan warga',
    x_percent: 62.0,
    y_percent: 29.0,
    aktif: true,
    created_at: '2026-11-01T07:00:00.000Z',
  },
  {
    id: 'titik-belakang',
    nama_lokasi: 'Checkpoint 5 (Blok Belakang)',
    rfid_uid: 'NFC-BELAKANG-05',
    keterangan: 'Batas pagar belakang & penerangan jalan utara',
    x_percent: 84.0,
    y_percent: 29.0,
    aktif: true,
    created_at: '2026-11-01T07:00:00.000Z',
  },
];

export const SEED_PETUGAS_KEAMANAN: PetugasKeamanan[] = [
  {
    id: 'petugas-seed-1',
    nama: 'Pak Asep',
    username: 'asep',
    pin: '112233',
    no_hp: '6281234567801',
    shift: 'Shift Pagi (07.00 – 19.00)',
    aktif: true,
    created_at: '2026-11-01T07:00:00.000Z',
  },
  {
    id: 'petugas-seed-2',
    nama: 'Pak Ujang',
    username: 'ujang',
    pin: '445566',
    no_hp: '6281234567802',
    shift: 'Shift Malam (19.00 – 07.00)',
    aktif: true,
    created_at: '2026-11-01T07:00:00.000Z',
  },
];

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
export const APP_PORTAL_URL = 'https://e-card-ipl.vercel.app';
export const APP_ADMIN_PORTAL_URL = `${APP_PORTAL_URL}/admin`;
export const APP_PETUGAS_PORTAL_URL = `${APP_PORTAL_URL}/petugas`;
export const KOP_RESMI =
  'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)';
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
    id: 'rek-blu-default',
    bank: 'Blu (BCA Digital)',
    nomor: '006424363822',
    atasNama: 'Andriansyah',
    tipe: 'Transfer Bank',
  },
];

export const DEFAULT_PAYMENT_CONFIG: PaymentConfig = {
  id: 'default-payment-config',
  qris_aktif: false,
  qris_image_url: null,
  qris_label: 'QRIS Kas Lingkungan Perumahan Saung Kebun',
  qris_catatan: 'Scan kode QRIS di atas via m-Banking atau E-Wallet, lalu unggah bukti bayar di bawah.',
  rekening_list: REKENING_KAS,
  nominal_ipl_bulanan: NOMINAL_IPL_STANDAR,
  updated_at: '2026-11-01T07:00:00.000Z',
  updated_by: 'andriansyah',
};

export const DEFAULT_APP_BRAND_CONFIG: AppBrandConfig = {
  id: 'default-app-brand',
  app_name: NAMA_APLIKASI,
  app_subtitle: SUB_NAMA_APLIKASI,
  kop_resmi: KOP_RESMI,
  logo_url: null,
  stempel_url: null,
  wa_pengurus: WA_PENGURUS,
  wa_pengurus_label: 'Andriansyah (Bendahara)',
  wa_bot: '',
  pengurus_wa_map: {},
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
  '{pin_akses}',
  '{bulan_tagihan}',
  '{nominal_tagihan}',
  '{link_aplikasi}',
  '{link_admin}',
] as const;

export const WA_TAGIHAN_TEMPLATE_DEFAULT = `Yth. Bapak/Ibu {nama_warga} (Blok {blok_rumah}),

Berikut pengingat Iuran Pemeliharaan Lingkungan (IPL) Perumahan Saung Kebun untuk bulan {bulan_tagihan} sebesar {nominal_tagihan}.

Mohon melakukan penyetoran sebelum tanggal 7 dan mengunggah bukti pembayaran melalui portal e-Card Digital:
{link_aplikasi}

Terima kasih atas partisipasi Anda.
Pengurus Lingkungan Perumahan Saung Kebun`;

export const WA_ACCESS_TEMPLATE_DEFAULT = `Yth. Bapak/Ibu {nama_warga} (Blok {blok_rumah}),

Berikut informasi akses akun resmi *Portal e-Card Verifikasi & IPL Digital Perumahan Saung Kebun*:

🌐 *Link Portal Warga:* {link_aplikasi}
🏠 *Username (Blok/No. Rumah):* {blok_rumah}
🔐 *PIN Akses (6 Digit):* {pin_akses}

*Cara Masuk:*
1. Buka halaman Portal Warga di {link_aplikasi}
2. Masukkan Username *{blok_rumah}* dan PIN *{pin_akses}*
3. Cek status e-Card bulanan, setor iuran (QRIS / Transfer / Titip Pengurus), dan unduh kwitansi digital.

Mohon simpan PIN ini dengan baik dan jangan dibagikan kepada pihak lain.
Terima kasih,
*Pengurus Lingkungan Perumahan Saung Kebun*`;

export const WA_PENGURUS_ACCESS_TEMPLATE_DEFAULT = `Yth. Bapak/Ibu {nama_pengurus} ({jabatan}),

Berikut informasi akses resmi *Portal Admin / Pengurus — {nama_aplikasi}*:

🔗 *Link Portal Pengurus (Khusus Admin):* {link_admin}
👤 *Username Pengurus:* {username_pengurus}
🔐 *PIN Akses (6 Digit):* {pin_pengurus}
🛡️ *Hak Akses:* {hak_akses}

*Cara Masuk Portal Pengurus:*
1. Buka link khusus pengurus: {link_admin}
2. Masukkan Username *{username_pengurus}* dan PIN 6 digit Anda
3. Gunakan portal ini untuk memantau setoran IPL warga, master data unit, dan rekap kas lingkungan.

⚠️ *Penting:* Link {link_admin} bersifat internal khusus Pengurus Lingkungan, mohon tidak dibagikan ke grup umum warga (untuk warga gunakan {link_aplikasi}).

Terima kasih atas kerja samanya,
*Pengurus Lingkungan Perumahan Saung Kebun*`;

export const WA_BOT_PRESET_TEMPLATES: Array<{
  id: 'tagihan' | 'akses_pin' | 'akses_pengurus';
  label: string;
  deskripsi: string;
  template: string;
}> = [
  {
    id: 'tagihan',
    label: 'Template Tagihan IPL',
    deskripsi: 'Pengingat tagihan bulanan & jatuh tempo tanggal 7',
    template: WA_TAGIHAN_TEMPLATE_DEFAULT,
  },
  {
    id: 'akses_pin',
    label: 'Template Akses Warga',
    deskripsi: 'Kirim link Portal Warga, Username Blok & PIN 6 digit warga',
    template: WA_ACCESS_TEMPLATE_DEFAULT,
  },
  {
    id: 'akses_pengurus',
    label: 'Template Link Pengurus (/admin)',
    deskripsi: 'Kirim link khusus Portal Pengurus (/admin), Username & PIN pengurus',
    template: WA_PENGURUS_ACCESS_TEMPLATE_DEFAULT,
  },
];
