import {
  APP_ADMIN_PORTAL_URL,
  APP_PORTAL_URL,
  BULAN_LIST,
  DEFAULT_BILLING_START_MONTH,
  DEFAULT_BILLING_START_YEAR,
  NAMA_APLIKASI,
  TAHUN_AKTIF,
  WA_ACCESS_TEMPLATE_DEFAULT,
  WA_PENGURUS_ACCESS_TEMPLATE_DEFAULT,
  type EffectiveStatusBulanEcard,
  type PengurusAccountInfo,
  type StatusBulanEcard,
  type Warga,
} from '../types';

export function formatRupiah(nominal: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(nominal) ? nominal : 0);
}

export function formatTanggalWaktu(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatTanggal(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function getNamaBulan(bulan: number): string {
  return BULAN_LIST.find((b) => b.angka === bulan)?.nama || `Bulan ${bulan}`;
}

export function getSingkatBulan(bulan: number): string {
  return BULAN_LIST.find((b) => b.angka === bulan)?.singkat || String(bulan);
}

export function formatDaftarBulan(bulanList: number[], singkat = false): string {
  const sorted = [...bulanList].sort((a, b) => a - b);
  return sorted.map((b) => (singkat ? getSingkatBulan(b) : getNamaBulan(b))).join(', ');
}

export function getCurrentBillingMonth(): number {
  const now = new Date();
  if (now.getFullYear() === TAHUN_AKTIF) {
    return now.getMonth() + 1;
  }
  return now.getFullYear() > TAHUN_AKTIF ? 12 : 1;
}

export interface BillingStartPeriod {
  billing_start_month?: number | null;
  billing_start_year?: number | null;
}

export function resolveBillingStartPeriod(period?: BillingStartPeriod | null): {
  startMonth: number;
  startYear: number;
} {
  const rawMonth = Number(period?.billing_start_month);
  const rawYear = Number(period?.billing_start_year);
  const startMonth =
    Number.isInteger(rawMonth) && rawMonth >= 1 && rawMonth <= 12
      ? rawMonth
      : DEFAULT_BILLING_START_MONTH;
  const startYear =
    Number.isInteger(rawYear) && rawYear >= 2024 && rawYear <= 2100
      ? rawYear
      : DEFAULT_BILLING_START_YEAR;
  return { startMonth, startYear };
}

export function isBeforeBillingStart(
  tahun: number,
  bulan: number,
  period?: BillingStartPeriod | null
): boolean {
  const { startMonth, startYear } = resolveBillingStartPeriod(period);
  return tahun * 100 + bulan < startYear * 100 + startMonth;
}

export function formatBillingStartLabel(period?: BillingStartPeriod | null): string {
  const { startMonth, startYear } = resolveBillingStartPeriod(period);
  return `${getNamaBulan(startMonth)} ${startYear}`;
}

export function getDefaultUnpaidStatusForMonth(
  bulan: number,
  tahun: number = TAHUN_AKTIF,
  now: Date = new Date()
): StatusBulanEcard {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  if (tahun > currentYear || (tahun === currentYear && bulan > currentMonth)) {
    return 'Belum Tagihan';
  }
  if (tahun === currentYear && bulan === currentMonth) {
    return 'Belum Bayar';
  }

  const billingYear = bulan === 12 ? tahun + 1 : tahun;
  const billingMonth = bulan === 12 ? 1 : bulan + 1;
  if (currentYear === billingYear && currentMonth === billingMonth) {
    return currentDay <= 7 ? 'Belum Bayar' : 'Jatuh Tempo';
  }

  return 'Jatuh Tempo';
}

export function resolveEffectiveMonthStatus(params: {
  dbStatus?: StatusBulanEcard | null;
  tahun: number;
  bulan: number;
  billingStart?: BillingStartPeriod | null;
}): EffectiveStatusBulanEcard {
  const { dbStatus, tahun, bulan, billingStart } = params;
  if (dbStatus === 'Lunas' || dbStatus === 'Menunggu Verifikasi') {
    return dbStatus;
  }
  if (isBeforeBillingStart(tahun, bulan, billingStart)) {
    return 'Pra-Rilis';
  }
  return dbStatus || getDefaultUnpaidStatusForMonth(bulan, tahun);
}

export function isCountableUnpaidStatus(
  status: EffectiveStatusBulanEcard | string | null | undefined
): boolean {
  return (
    status !== 'Lunas' &&
    status !== 'Menunggu Verifikasi' &&
    status !== 'Pra-Rilis'
  );
}

export function extractBlokPrefix(blokRumah: string): string {
  const formatted = formatBlokRumah(blokRumah).toUpperCase();
  const slashIdx = formatted.indexOf('/');
  if (slashIdx > 0) {
    return formatted.slice(0, slashIdx);
  }
  return formatted.slice(0, 3) || 'LAIN';
}

export function generateRandomPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

import {
  canonicalBlockKey,
  compareBlokRumah,
  formatBlokRumah,
  formatPhoneDisplay,
  isRealRegisteredPhone,
  isSameBlockCode,
  matchesBlockSearch,
  normalizeBlockCode,
  normalizePhoneNumber,
} from './phoneAndBlockUtils';

export {
  canonicalBlockKey,
  compareBlokRumah,
  formatBlokRumah,
  formatPhoneDisplay,
  isRealRegisteredPhone,
  isSameBlockCode,
  matchesBlockSearch,
  normalizeBlockCode,
  normalizePhoneNumber,
};

export function normalizeBlok(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export function canonicalizeBlokKey(input: string): string {
  return canonicalBlockKey(input);
}

export function normalizeWaNumber(input: string): string {
  return normalizePhoneNumber(input);
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const normalized = normalizePhoneNumber(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function buildWargaAccessWaMessage(warga: Pick<Warga, 'nama_warga' | 'blok_rumah' | 'pin_akses'>): string {
  const displayBlok = formatBlokRumah(warga.blok_rumah) || warga.blok_rumah;
  return WA_ACCESS_TEMPLATE_DEFAULT
    .replaceAll('{nama_warga}', warga.nama_warga)
    .replaceAll('{blok_rumah}', displayBlok)
    .replaceAll('{pin_akses}', warga.pin_akses)
    .replaceAll('{link_aplikasi}', APP_PORTAL_URL);
}

export function buildWargaBotActivationMessage(
  warga: Pick<Warga, 'nama_warga' | 'blok_rumah' | 'bot_role'>
): string {
  const paddedBlock = formatBlokRumah(warga.blok_rumah) || warga.blok_rumah;
  const isPengurus = warga.bot_role === 'admin' || warga.bot_role === 'bendahara';
  return [
    `*Aktivasi Layanan Bot WhatsApp e-Card IPL — Perumahan Saung Kebun*`,
    ``,
    `Yth. Bapak/Ibu *${warga.nama_warga}* (Unit *${paddedBlock}*),`,
    `Nomor WhatsApp Anda telah resmi terdaftar dan aktif pada layanan Bot WhatsApp IPL Perumahan Saung Kebun.`,
    ``,
    `Silakan kirim pesan berikut kapan saja melalui WhatsApp ini:`,
    `• Ketik *CEK* — Melihat status & rincian tagihan IPL unit *${paddedBlock}*`,
    `• Ketik *REKENING* — Melihat informasi QRIS & Transfer Bank resmi`,
    `• Ketik *MENU* — Menampilkan panduan lengkap Bot WA`,
    ...(isPengurus
      ? [`• Ketik *CEK#[KODE_BLOK]* — (Akses Pengurus) Cek status unit warga`]
      : []),
    ``,
    `Demi privasi bersama, nomor Anda hanya terhubung ke unit *${paddedBlock}* dan tidak dapat digunakan untuk mengecek unit warga lain.`,
    ``,
    `Portal e-Card Digital: ${APP_PORTAL_URL}`,
  ].join('\n');
}

export function buildPengurusAccessWaMessage(
  pengurus: Pick<PengurusAccountInfo, 'nama' | 'jabatan' | 'username' | 'permission' | 'pin_akses'>,
  options?: { appName?: string; includePin?: boolean; portalAdminUrl?: string }
): string {
  const appName = options?.appName?.trim() || NAMA_APLIKASI;
  const adminUrl = options?.portalAdminUrl?.trim() || APP_ADMIN_PORTAL_URL;
  const hakAksesLabel =
    pengurus.permission === 'full'
      ? 'Akses Penuh (Verifikasi Setoran, Kelola Warga, QRIS, Rekening & Bot WA)'
      : 'Akses Pengurus (Monitoring Setoran, Tambah Warga & Input Setoran Tunai)';
  const pinLabel =
    options?.includePin !== false && pengurus.pin_akses
      ? pengurus.pin_akses
      : '(Hubungi Bendahara untuk PIN 6 digit Anda)';

  return WA_PENGURUS_ACCESS_TEMPLATE_DEFAULT
    .replaceAll('{nama_pengurus}', pengurus.nama)
    .replaceAll('{jabatan}', pengurus.jabatan)
    .replaceAll('{nama_aplikasi}', appName)
    .replaceAll('{link_admin}', adminUrl)
    .replaceAll('{link_aplikasi}', APP_PORTAL_URL)
    .replaceAll('{username_pengurus}', pengurus.username)
    .replaceAll('{pin_pengurus}', pinLabel)
    .replaceAll('{hak_akses}', hakAksesLabel);
}

export function buildGeneralPengurusLinkMessage(appName?: string): string {
  const cleanName = appName?.trim() || NAMA_APLIKASI;
  return [
    `*Tautan Resmi Portal Pengurus / Admin — ${cleanName}*`,
    ``,
    `🔗 *Link Login Pengurus:* ${APP_ADMIN_PORTAL_URL}`,
    `👤 *Username:* Gunakan username pengurus masing-masing (contoh: erlangga, andriansyah, bpiwan, doni, wahyu, deny)`,
    `🔐 *PIN:* Masukkan PIN 6 digit khusus pengurus`,
    ``,
    `⚠️ Link ${APP_ADMIN_PORTAL_URL} khusus internal Pengurus Lingkungan. Untuk warga tetap gunakan ${APP_PORTAL_URL}.`,
  ].join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Lanjut fallback DOM untuk iOS Safari / WebView
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    ta.style.fontSize = '16px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function generateKwitansiNumber(blokRumah: string, tanggalIso?: string): string {
  const date = tanggalIso ? new Date(tanggalIso) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const blokClean = blokRumah.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const rand = Math.floor(100 + Math.random() * 900);
  return `SKB/${y}${m}${d}/${blokClean}/${rand}`;
}

export function generateBuktiKasNumber(
  jenis: 'pengeluaran' | 'pemasukan_lain',
  tanggalIso?: string
): string {
  const date = tanggalIso ? new Date(tanggalIso) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const y = safeDate.getFullYear();
  const m = String(safeDate.getMonth() + 1).padStart(2, '0');
  const d = String(safeDate.getDate()).padStart(2, '0');
  const prefix = jenis === 'pengeluaran' ? 'BKK' : 'BKM';
  const rand = Math.floor(100 + Math.random() * 900);
  return `${prefix}/SKB/${y}${m}${d}/${rand}`;
}

export function formatTanggalSingkat(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function terbilangAngka(n: number): string {
  const satuan = [
    '',
    'Satu',
    'Dua',
    'Tiga',
    'Empat',
    'Lima',
    'Enam',
    'Tujuh',
    'Delapan',
    'Sembilan',
    'Sepuluh',
    'Sebelas',
  ];
  const val = Math.floor(Math.abs(n));
  if (val < 12) return satuan[val];
  if (val < 20) return `${terbilangAngka(val - 10)} Belas`;
  if (val < 100) {
    const puluh = `${terbilangAngka(Math.floor(val / 10))} Puluh`;
    const sisa = val % 10;
    return sisa ? `${puluh} ${terbilangAngka(sisa)}` : puluh;
  }
  if (val < 200) {
    const sisa = val - 100;
    return sisa ? `Seratus ${terbilangAngka(sisa)}` : 'Seratus';
  }
  if (val < 1000) {
    const ratus = `${terbilangAngka(Math.floor(val / 100))} Ratus`;
    const sisa = val % 100;
    return sisa ? `${ratus} ${terbilangAngka(sisa)}` : ratus;
  }
  if (val < 2000) {
    const sisa = val - 1000;
    return sisa ? `Seribu ${terbilangAngka(sisa)}` : 'Seribu';
  }
  if (val < 1_000_000) {
    const ribu = `${terbilangAngka(Math.floor(val / 1000))} Ribu`;
    const sisa = val % 1000;
    return sisa ? `${ribu} ${terbilangAngka(sisa)}` : ribu;
  }
  if (val < 1_000_000_000) {
    const juta = `${terbilangAngka(Math.floor(val / 1_000_000))} Juta`;
    const sisa = val % 1_000_000;
    return sisa ? `${juta} ${terbilangAngka(sisa)}` : juta;
  }
  if (val < 1_000_000_000_000) {
    const miliar = `${terbilangAngka(Math.floor(val / 1_000_000_000))} Miliar`;
    const sisa = val % 1_000_000_000;
    return sisa ? `${miliar} ${terbilangAngka(sisa)}` : miliar;
  }
  return String(val);
}

export function terbilangRupiah(nominal: number): string {
  if (!Number.isFinite(nominal) || Math.floor(nominal) === 0) {
    return 'Nol Rupiah';
  }
  const prefix = nominal < 0 ? 'Minus ' : '';
  return `${prefix}${terbilangAngka(nominal).replace(/\s+/g, ' ').trim()} Rupiah`;
}

