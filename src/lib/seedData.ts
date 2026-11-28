import {
  DEFAULT_PAYMENT_CONFIG,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  type AdminJabatan,
  type AdminPermission,
  type BotWaConfig,
  type BotWaLog,
  type PaymentConfig,
  type StatusEcardBulanan,
  type StatusHunian,
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

/**
 * Susunan Pengurus Lingkungan Perumahan Saung Kebun:
 * - Bendahara (Andriansyah): Akses penuh (add, edit, hapus, verifikasi, upload QR & norek, Bot WA)
 * - Pembina (Bp. Iwan), Ketua (Erlangga), Humas (Doni & Wahyu), Seksi Olahraga (Deny): Akses tambah data (add_only)
 */
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
    nama: 'Andriansyah (Bendahara)',
    jabatan: 'Bendahara',
    permission: 'full',
  },
  {
    username: 'bpiwan',
    pin: '500001',
    nama: 'Bp. Iwan',
    jabatan: 'Pembina',
    permission: 'add_only',
  },
  {
    username: 'paiwan',
    pin: '500001',
    nama: 'Bp. Iwan',
    jabatan: 'Pembina',
    permission: 'add_only',
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

// Daftar Lengkap 109 Unit Rumah Perumahan Saung Kebun (Blok B3, B5, B6, B7, B8)
const RAW_WARGA_ROSTER: Array<[string, string, StatusHunian]> = [
  // Blok B3 (23 unit)
  ['B3/1', 'ASEP SUKARMA', 'Tetap'],
  ['B3/2', 'SUBHAN HUMAMI', 'Tetap'],
  ['B3/3', 'UNIT KOSONG B3/3', 'Kosong'],
  ['B3/4', 'ADITYA PRAYOGA', 'Tetap'],
  ['B3/5', 'UNIT KOSONG B3/5', 'Kosong'],
  ['B3/6', 'AFAN', 'Tetap'],
  ['B3/7', 'DION YULIANA / ERLANGGA', 'Tetap'],
  ['B3/8', 'RAKA', 'Tetap'],
  ['B3/9', 'UNIT KOSONG B3/9', 'Kosong'],
  ['B3/10', 'WARGA B3/10', 'Tetap'],
  ['B3/11', 'UNIT KOSONG B3/11', 'Kosong'],
  ['B3/12', 'PUGUH DWI', 'Tetap'],
  ['B3/13', 'UNIT KOSONG B3/13', 'Kosong'],
  ['B3/14', 'ARDI MAULANA', 'Tetap'],
  ['B3/15', 'WENDY ROCHIMAT S', 'Tetap'],
  ['B3/16', 'TRI SEPTIONO', 'Tetap'],
  ['B3/17', 'UNIT KOSONG B3/17', 'Kosong'],
  ['B3/18', 'CASMAT', 'Tetap'],
  ['B3/19', 'SARMA', 'Tetap'],
  ['B3/20', 'ARDIANSYAH ZEIN', 'Tetap'],
  ['B3/21', 'CECEP SUGIANTO', 'Tetap'],
  ['B3/22', 'DICKY YANDA ALVIANA', 'Tetap'],
  ['B3/23', 'FAISAL', 'Tetap'],

  // Blok B5 (29 unit)
  ['B5/1', 'UNIT KOSONG B5/1', 'Kosong'],
  ['B5/2', 'AHMAD NIZAR', 'Tetap'],
  ['B5/3', 'WARGA B5/3', 'Tetap'],
  ['B5/4', 'WARGA B5/4', 'Tetap'],
  ['B5/5', 'WARGA B5/5', 'Tetap'],
  ['B5/6', 'WARGA B5/6', 'Tetap'],
  ['B5/7', 'TINA', 'Kosong'],
  ['B5/8', 'UNIT KOSONG B5/8', 'Kosong'],
  ['B5/9', 'UNIT KOSONG B5/9', 'Kosong'],
  ['B5/10', 'UNIT KOSONG B5/10', 'Kosong'],
  ['B5/11', 'UNIT KOSONG B5/11', 'Kosong'],
  ['B5/12', 'UNIT KOSONG B5/12', 'Kosong'],
  ['B5/13', 'UNIT KOSONG B5/13', 'Kosong'],
  ['B5/14', 'UNIT KOSONG B5/14', 'Kosong'],
  ['B5/15', 'UNIT KOSONG B5/15', 'Kosong'],
  ['B5/16', 'UNIT KOSONG B5/16', 'Kosong'],
  ['B5/17', 'KURNIAWAN', 'Tetap'],
  ['B5/18', 'DARMA', 'Tetap'],
  ['B5/19', 'HERRIS RIZKI', 'Tetap'],
  ['B5/20', 'DWI ARDIYANTO', 'Tetap'],
  ['B5/21', 'DONI', 'Tetap'],
  ['B5/22', 'TOMA', 'Tetap'],
  ['B5/23', 'ADITYA', 'Tetap'],
  ['B5/24', 'DEDI WAHYUDI', 'Tetap'],
  ['B5/25', 'SIGIT', 'Tetap'],
  ['B5/26', 'HARTONO', 'Tetap'],
  ['B5/27', 'SYAHRI', 'Tetap'],
  ['B5/28', 'UNIT KOSONG B5/28', 'Kosong'],
  ['B5/29', 'ALINUR', 'Tetap'],

  // Blok B6 (23 unit)
  ['B6/1', 'UNIT KOSONG B6/1', 'Kosong'],
  ['B6/2', 'DEFRY', 'Tetap'],
  ['B6/3', 'BUDYANTO', 'Tetap'],
  ['B6/4', 'RIDWAN', 'Tetap'],
  ['B6/5', 'ABIDZAR', 'Tetap'],
  ['B6/6', 'ANGKASA', 'Tetap'],
  ['B6/7', 'NOVI', 'Tetap'],
  ['B6/8', 'M JODI RAMADHAN', 'Tetap'],
  ['B6/9', 'HASMI', 'Tetap'],
  ['B6/10', 'AJE', 'Tetap'],
  ['B6/11', 'JODI KURNIAWAN', 'Tetap'],
  ['B6/12', 'RULLY', 'Tetap'],
  ['B6/13', 'UNIT KOSONG B6/13', 'Kosong'],
  ['B6/14', 'ADE JAHIDI', 'Tetap'],
  ['B6/15', 'UNIT KOSONG B6/15', 'Kosong'],
  ['B6/16', 'WIDODO', 'Tetap'],
  ['B6/17', 'UNIT KOSONG B6/17', 'Kosong'],
  ['B6/18', 'SUTRISMAN', 'Tetap'],
  ['B6/19', 'MUHAMMAD SIDIK', 'Tetap'],
  ['B6/20', 'UNIT KOSONG B6/20', 'Kosong'],
  ['B6/21', 'CHOLIL', 'Tetap'],
  ['B6/22', 'UNIT KOSONG B6/22', 'Kosong'],
  ['B6/23', 'MULYONO', 'Tetap'],

  // Blok B7 (23 unit)
  ['B7/1', 'UNIT KOSONG B7/1', 'Kosong'],
  ['B7/2', 'NAUFAL', 'Kosong'],
  ['B7/3', 'DEDE NURHIDAYAT', 'Tetap'],
  ['B7/4', 'DEVI', 'Tetap'],
  ['B7/5', 'UNIT KOSONG B7/5', 'Kosong'],
  ['B7/6', 'ANDRI', 'Tetap'],
  ['B7/7', 'BAGAS A', 'Tetap'],
  ['B7/8', 'UNIT KOSONG B7/8', 'Kosong'],
  ['B7/9', 'UNIT KOSONG B7/9', 'Kosong'],
  ['B7/10', 'AKBAR', 'Tetap'],
  ['B7/11', 'YUKI', 'Tetap'],
  ['B7/12', 'ARGA', 'Tetap'],
  ['B7/13', 'UNIT KOSONG B7/13', 'Kosong'],
  ['B7/14', 'ABDU NAFI', 'Tetap'],
  ['B7/15', 'UNIT KOSONG B7/15', 'Kosong'],
  ['B7/16', 'ANDRIANSYAH', 'Tetap'],
  ['B7/17', 'MUTIARA', 'Tetap'],
  ['B7/18', 'ADITYA', 'Tetap'],
  ['B7/19', 'SAMSURI', 'Tetap'],
  ['B7/20', 'RISKY ALVIN NOVIANTO', 'Tetap'],
  ['B7/21', 'RIZKI NURMANSYAH', 'Tetap'],
  ['B7/22', 'UNIT KOSONG B7/22', 'Kosong'],
  ['B7/23', 'SUGIH', 'Tetap'],

  // Blok B8 (11 unit)
  ['B8/1', 'CANDRA ARIS SANDI', 'Tetap'],
  ['B8/2', 'SUBANDI', 'Tetap'],
  ['B8/3', 'DICKY', 'Tetap'],
  ['B8/4', 'UNIT KOSONG B8/4', 'Kosong'],
  ['B8/5', 'IWAN', 'Tetap'],
  ['B8/6', 'DENY', 'Tetap'],
  ['B8/7', 'ANI FATIMAH', 'Tetap'],
  ['B8/8', 'BINTANG', 'Tetap'],
  ['B8/9', 'UNIT KOSONG B8/9', 'Kosong'],
  ['B8/10', 'ROSTINI', 'Tetap'],
  ['B8/11', 'PA HUSNI', 'Tetap'],
];

function generateDefaultPinForIndex(blok: string, index: number): string {
  if (blok === 'B3/7') return '112233';
  const base = 100100 + ((index + 1) * 733) % 899000;
  return String(base).padStart(6, '0');
}

export const SEED_WARGA: Warga[] = RAW_WARGA_ROSTER.map(([blok, nama, status], idx) => ({
  id: `warga-${blok.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
  blok_rumah: blok,
  nama_warga: nama,
  no_wa: '6281200000000',
  status_hunian: status,
  nominal_iuran: status === 'Kosong' ? 0 : 100000,
  pin_akses: generateDefaultPinForIndex(blok, idx),
  aktif: true,
  created_at: '2026-01-01T08:00:00.000Z',
}));

export const SEED_TRANSAKSI: TransaksiIPL[] = [
  {
    id: 'trx-001',
    no_kwitansi: 'SKB/20261004/B37/101',
    blok_rumah: 'B3/7',
    nama_warga: 'DION YULIANA / ERLANGGA',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    nominal: 1000000,
    metode_bayar: 'Transfer Bank',
    petugas_penerima: null,
    bukti_url: createSampleReceiptDataUri('BUKTI TRANSFER BANK BCA', 'B3/7', 'Rp 1.000.000', 'BCA-261004-001'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Pembayaran IPL Jan–Okt 2026 diterima lengkap.',
    keterangan: 'IPL Reguler 10 bulan',
    tanggal_setor: '2026-10-04T09:20:00.000Z',
    verified_at: '2026-10-04T11:10:00.000Z',
    verified_by: 'andriansyah',
  },
  {
    id: 'trx-002',
    no_kwitansi: 'SKB/20261103/B37/114',
    blok_rumah: 'B3/7',
    nama_warga: 'DION YULIANA / ERLANGGA',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [11],
    nominal: 100000,
    metode_bayar: 'Transfer Bank',
    petugas_penerima: null,
    bukti_url: createSampleReceiptDataUri('BUKTI TRANSFER BANK BCA', 'B3/7', 'Rp 100.000', 'BCA-261103-114'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Lunas tepat waktu.',
    keterangan: 'IPL November 2026',
    tanggal_setor: '2026-11-03T08:40:00.000Z',
    verified_at: '2026-11-03T10:05:00.000Z',
    verified_by: 'andriansyah',
  },
  {
    id: 'trx-003',
    no_kwitansi: 'SKB/20261105/B716/208',
    blok_rumah: 'B7/16',
    nama_warga: 'ANDRIANSYAH',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    nominal: 1100000,
    metode_bayar: 'Setor Tunai',
    petugas_penerima: 'Andriansyah (Bendahara)',
    bukti_url: createSampleReceiptDataUri('KWITANSI SETOR TUNAI', 'B7/16', 'Rp 1.100.000', 'TUNAI-261105-208'),
    status_verifikasi: 'Terverifikasi',
    catatan_admin: 'Terverifikasi oleh Bendahara.',
    keterangan: 'IPL Jan–Nov 2026',
    tanggal_setor: '2026-11-05T16:15:00.000Z',
    verified_at: '2026-11-05T18:00:00.000Z',
    verified_by: 'andriansyah',
  },
  {
    id: 'trx-004',
    no_kwitansi: 'SKB/20261116/B88/229',
    blok_rumah: 'B8/8',
    nama_warga: 'BINTANG',
    tahun: TAHUN_AKTIF,
    bulan_dibayar: [11],
    nominal: 100000,
    metode_bayar: 'QRIS',
    petugas_penerima: null,
    bukti_url: createSampleReceiptDataUri('BUKTI PEMBAYARAN QRIS', 'B8/8', 'Rp 100.000', 'QRIS-261116-229'),
    status_verifikasi: 'Pending',
    catatan_admin: null,
    keterangan: 'Setoran IPL November 2026 via QRIS',
    tanggal_setor: '2026-11-16T13:45:00.000Z',
    verified_at: null,
    verified_by: null,
  },
];

export const SEED_PAYMENT_CONFIG: PaymentConfig = DEFAULT_PAYMENT_CONFIG;

export function buildInitialStatusBulanan(
  wargaList: Warga[],
  transaksiList: TransaksiIPL[]
): StatusEcardBulanan[] {
  const result: StatusEcardBulanan[] = [];
  const nowIso = new Date().toISOString();

  for (const w of wargaList) {
    const trxWarga = transaksiList.filter((t) => t.blok_rumah === w.blok_rumah && t.tahun === TAHUN_AKTIF);
    for (let bulan = 1; bulan <= 12; bulan++) {
      const verifiedList = trxWarga.filter(
        (t) => t.status_verifikasi === 'Terverifikasi' && t.bulan_dibayar.includes(bulan)
      );
      const verifiedPaidAmount = verifiedList.reduce((sum, t) => {
        const div = Math.max(t.bulan_dibayar.length, 1);
        return sum + Math.round((Number(t.nominal) || 0) / div);
      }, 0);
      const pending = trxWarga.find(
        (t) =>
          (t.status_verifikasi === 'Pending' || t.status_verifikasi === 'ACC Bendahara') &&
          t.bulan_dibayar.includes(bulan)
      );

      let status = getDefaultUnpaidStatusForMonth(bulan);
      let transaksiId: string | null = null;

      if (verifiedPaidAmount >= NOMINAL_IPL_STANDAR && verifiedList.length > 0) {
        status = 'Lunas';
        transaksiId = verifiedList[0].id;
      } else if (pending) {
        status = 'Menunggu Verifikasi';
        transaksiId = pending.id;
      } else if (verifiedList.length > 0) {
        transaksiId = verifiedList[0].id;
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
    blok_rumah: 'B8/8',
    nama_warga: 'BINTANG',
    no_wa: '6281200000000',
    jenis_pesan: 'Tagihan Awal Bulan (Tgl 1)',
    status_kirim: 'Terkirim',
    respon_gateway: 'OK (200) — Pesan masuk antrean Fonnte',
    pesan: 'Pengingat tagihan IPL November 2026 sebesar Rp 100.000',
  },
];
