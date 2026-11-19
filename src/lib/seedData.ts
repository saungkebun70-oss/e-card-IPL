import {
  TAHUN_AKTIF,
  type AdminJabatan,
  type AdminPermission,
  type BotWaConfig,
  type BotWaLog,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type Warga,
} from '../types';
import { getDefaultUnpaidStatusForMonth } from './format';

export interface LocalAdminAccount {
  username: string;
  pin: string;
  nama: string;
  jabatan: AdminJabatan;
  permission: AdminPermission;
}

export const LOCAL_ADMIN_ACCOUNTS: LocalAdminAccount[] = [
  {
    username: 'andriansyah',
    pin: '200001',
    nama: 'Andriansyah',
    jabatan: 'Bendahara',
    permission: 'full',
  },
  {
    username: 'admin',
    pin: '123456',
    nama: 'Andriansyah (Admin Bendahara)',
    jabatan: 'Bendahara',
    permission: 'full',
  },
  {
    username: 'erlangga',
    pin: '100001',
    nama: 'Erlangga',
    jabatan: 'Ketua',
    permission: 'add_only',
  },
  {
    username: 'doni',
    pin: '300001',
    nama: 'Doni',
    jabatan: 'Humas',
    permission: 'add_only',
  },
  {
    username: 'wahyu',
    pin: '300002',
    nama: 'Wahyu',
    jabatan: 'Humas',
    permission: 'add_only',
  },
  {
    username: 'deny',
    pin: '400001',
    nama: 'Deny',
    jabatan: 'Seksi Olahraga',
    permission: 'add_only',
  },
  {
    username: 'paiwan',
    pin: '500001',
    nama: 'Pa Iwan',
    jabatan: 'Pembina',
    permission: 'add_only',
  },
];

function createSampleReceiptDataUri(title: string, blok: string, nominalText: string, refCode: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="420" viewBox="0 0 600 420">
    <rect width="600" height="420" fill="#F8FAFC"/>
    <rect x="28" y="24" width="544" height="372" rx="16" fill="#FFFFFF" stroke="#E2E8F0" stroke-width="2"/>
    <rect x="28" y="24" width="544" height="72" rx="16" fill="#059669"/>
    <rect x="28" y="76" width="544" height="20" fill="#059669"/>
    <text x="56" y="58" font-family="sans-serif" font-size="18" font-weight="700" fill="#FFFFFF">${title}</text>
    <text x="56" y="80" font-family="monospace" font-size="12" fill="#D1FAE5">REF: ${refCode}</text>
    <text x="56" y="142" font-family="sans-serif" font-size="13" fill="#64748B">UNIT RUMAH</text>
    <text x="56" y="166" font-family="sans-serif" font-size="18" font-weight="700" fill="#0F172A">Perumahan Saung Kebun — Blok ${blok}</text>
    <line x1="56" y1="192" x2="544" y2="192" stroke="#E2E8F0" stroke-width="1"/>
    <text x="56" y="226" font-family="sans-serif" font-size="13" fill="#64748B">NOMINAL TRANSAKSI</text>
    <text x="56" y="262" font-family="monospace" font-size="30" font-weight="700" fill="#059669">${nominalText}</text>
    <line x1="56" y1="288" x2="544" y2="288" stroke="#E2E8F0" stroke-width="1"/>
    <text x="56" y="320" font-family="sans-serif" font-size="13" fill="#475569">Penerima: Kas Lingkungan Perumahan Saung Kebun</text>
    <text x="56" y="346" font-family="sans-serif" font-size="12" fill="#94A3B8">Dokumen bukti transaksi IPL Digital — Desa Bengle, Majalaya, Karawang</text>
    <rect x="412" y="218" width="132" height="44" rx="8" fill="#ECFDF5" stroke="#059669" stroke-width="1.5"/>
    <text x="478" y="245" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="700" fill="#059669">TERKIRIM</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const SEED_WARGA: Warga[] = [
  {
    id: 'warga-b03-07',
    blok_rumah: 'B03/07',
    nama_warga: 'Erlangga',
    no_wa: '6281234567890',
    status_hunian: 'Tetap',
    nominal_iuran: 100000,
    pin_akses: '112233',
    aktif: true,
    created_at: '2026-01-01T08:00:00.000Z',
  },
  {
    id: 'warga-b05-07',
    blok_rumah: 'B05/07',
    nama_warga: 'Tina',
    no_wa: '6281298765432',
    status_hunian: 'Tetap',
    nominal_iuran: 100000,
    pin_akses: '223344',
    aktif: true,
    created_at: '2026-01-01T08:05:00.000Z',
  },
  {
    id: 'warga-b06-02',
    blok_rumah: 'B06/02',
    nama_warga: 'Bintang',
    no_wa: '6281311223344',
    status_hunian: 'Kontrak',
    nominal_iuran: 100000,
    pin_akses: '334455',
    aktif: true,
    created_at: '2026-01-02T09:15:00.000Z',
  },
];

export const SEED_TRANSAKSI: TransaksiIPL[] = [
  {
    id: 'trx-001',
    no_kwitansi: 'SKB/20261004/B0307/101',
    blok_rumah: 'B03/07',
    nama_warga: 'Erlangga',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    nominal: 1000000,
    metode_bayar: 'Transfer Bank',
    petugas_penerima: null,
    bukti_url: createSampleReceiptDataUri('BUKTI TRANSFER BANK BCA', 'B03/07', 'Rp 1.000.000', 'BCA-261004-001'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Pembayaran IPL Jan–Okt 2026 diterima lengkap.',
    keterangan: 'IPL Reguler 10 bulan',
    tanggal_setor: '2026-10-04T09:20:00.000Z',
    verified_at: '2026-10-04T11:10:00.000Z',
    verified_by: 'admin',
  },
  {
    id: 'trx-002',
    no_kwitansi: 'SKB/20261103/B0307/114',
    blok_rumah: 'B03/07',
    nama_warga: 'Erlangga',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [11],
    nominal: 100000,
    metode_bayar: 'Transfer Bank',
    petugas_penerima: null,
    bukti_url: createSampleReceiptDataUri('BUKTI TRANSFER BANK BCA', 'B03/07', 'Rp 100.000', 'BCA-261103-114'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Lunas tepat waktu.',
    keterangan: 'IPL November 2026',
    tanggal_setor: '2026-11-03T08:40:00.000Z',
    verified_at: '2026-11-03T10:05:00.000Z',
    verified_by: 'admin',
  },
  {
    id: 'trx-003',
    no_kwitansi: 'SKB/20261006/B0507/208',
    blok_rumah: 'B05/07',
    nama_warga: 'Tina',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    nominal: 1000000,
    metode_bayar: 'Setor Tunai',
    petugas_penerima: 'Pa Iwan',
    bukti_url: createSampleReceiptDataUri('KWITANSI SETOR TUNAI', 'B05/07', 'Rp 1.000.000', 'TUNAI-261006-208'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Disetorkan melalui Pa Iwan.',
    keterangan: 'IPL Jan–Okt 2026',
    tanggal_setor: '2026-10-06T16:15:00.000Z',
    verified_at: '2026-10-06T18:00:00.000Z',
    verified_by: 'admin',
  },
  {
    id: 'trx-004',
    no_kwitansi: 'SKB/20261116/B0507/229',
    blok_rumah: 'B05/07',
    nama_warga: 'Tina',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [11],
    nominal: 100000,
    metode_bayar: 'E-Wallet',
    petugas_penerima: null,
    bukti_url: createSampleReceiptDataUri('BUKTI TRANSFER E-WALLET', 'B05/07', 'Rp 100.000', 'EW-261116-229'),
    status_verifikasi: 'Pending',
    catatan_admin: null,
    keterangan: 'Setoran IPL November 2026',
    tanggal_setor: '2026-11-16T13:45:00.000Z',
    verified_at: null,
    verified_by: null,
  },
  {
    id: 'trx-005',
    no_kwitansi: 'SKB/20260905/B0602/311',
    blok_rumah: 'B06/02',
    nama_warga: 'Bintang',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    nominal: 900000,
    metode_bayar: 'Transfer Bank',
    petugas_penerima: null,
    bukti_url: createSampleReceiptDataUri('BUKTI TRANSFER MANDIRI', 'B06/02', 'Rp 900.000', 'MDR-260905-311'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Terverifikasi oleh bendahara.',
    keterangan: 'IPL Jan–Sep 2026',
    tanggal_setor: '2026-09-05T10:12:00.000Z',
    verified_at: '2026-09-05T12:30:00.000Z',
    verified_by: 'admin',
  },
  {
    id: 'trx-006',
    no_kwitansi: 'SKB/20261012/B0602/319',
    blok_rumah: 'B06/02',
    nama_warga: 'Bintang',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [10],
    nominal: 50000,
    metode_bayar: 'Setor Tunai',
    petugas_penerima: 'Andriansyah',
    bukti_url: createSampleReceiptDataUri('SETORAN KHUSUS / DANA DARURAT', 'B06/02', 'Rp 50.000', 'TUNAI-261012-319'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Setoran parsial dialokasikan ke dana darurat lingkungan.',
    keterangan: 'Setoran khusus Oktober 2026',
    tanggal_setor: '2026-10-12T17:00:00.000Z',
    verified_at: '2026-10-12T19:00:00.000Z',
    verified_by: 'admin',
  },
];

export function buildInitialStatusBulanan(
  wargaList: Warga[],
  transaksiList: TransaksiIPL[]
): StatusEcardBulanan[] {
  const result: StatusEcardBulanan[] = [];
  const nowIso = new Date().toISOString();

  for (const w of wargaList) {
    const trxWarga = transaksiList.filter((t) => t.blok_rumah === w.blok_rumah && t.tahun === TAHUN_AKTIF);
    for (let bulan = 1; bulan <= 12; bulan++) {
      const verified = trxWarga.find(
        (t) => t.status_verifikasi === 'Terverifikasi' && t.bulan_dibayar.includes(bulan)
      );
      const pending = trxWarga.find(
        (t) => t.status_verifikasi === 'Pending' && t.bulan_dibayar.includes(bulan)
      );

      let status = getDefaultUnpaidStatusForMonth(bulan);
      let transaksiId: string | null = null;

      if (verified) {
        status = 'Lunas';
        transaksiId = verified.id;
      } else if (pending) {
        status = 'Menunggu Verifikasi';
        transaksiId = pending.id;
      }

      result.push({
        id: `st-${w.blok_rumah}-${TAHUN_AKTIF}-${bulan}`,
        blok_rumah: w.blok_rumah,
        tahun: TAHUN_AKTIF,
        bulan,
        status,
        transaksi_id: transaksiId,
        updated_at: nowIso,
      });
    }
  }

  return result;
}

export const SEED_BOT_WA_CONFIG: BotWaConfig = {
  id: 'default-bot-config',
  aktif: true,
  provider: 'Fonnte',
  api_endpoint: 'https://api.fonnte.com/send',
  api_token: '',
  jadwal_tgl_1: true,
  jadwal_tgl_6: true,
  jadwal_tgl_7: true,
  jadwal_tgl_8_plus: true,
  template_pesan: `Yth. Bapak/Ibu {nama_warga} (Blok {blok_rumah}),\n\nBerikut pengingat Iuran Pemeliharaan Lingkungan (IPL) Perumahan Saung Kebun untuk bulan {bulan_tagihan} sebesar {nominal_tagihan}.\n\nMohon melakukan penyetoran sebelum tanggal 7 dan mengunggah bukti pembayaran melalui portal e-Card Digital:\n{link_aplikasi}\n\nTerima kasih atas partisipasi Anda.\nPengurus Lingkungan Perumahan Saung Kebun`,
  updated_at: '2026-11-01T07:00:00.000Z',
};

export const SEED_BOT_WA_LOGS: BotWaLog[] = [
  {
    id: 'walog-001',
    created_at: '2026-11-01T07:05:00.000Z',
    blok_rumah: 'B05/07',
    nama_warga: 'Tina',
    no_wa: '6281298765432',
    jenis_pesan: 'Tagihan Awal Bulan (Tgl 1)',
    status_kirim: 'Terkirim',
    respon_gateway: 'OK (200) — Pesan masuk antrean Fonnte',
    pesan: 'Pengingat tagihan IPL November 2026 sebesar Rp 100.000',
  },
  {
    id: 'walog-002',
    created_at: '2026-11-07T08:00:00.000Z',
    blok_rumah: 'B06/02',
    nama_warga: 'Bintang',
    no_wa: '6281311223344',
    jenis_pesan: 'Jatuh Tempo Hari H (Tgl 7)',
    status_kirim: 'Terkirim',
    respon_gateway: 'OK (200) — Pesan terkirim ke WhatsApp penerima',
    pesan: 'Pengingat jatuh tempo IPL November 2026 sebesar Rp 100.000',
  },
];
