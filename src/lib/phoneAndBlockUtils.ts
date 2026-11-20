/**
 * Utilitas normalisasi nomor WhatsApp (628xxxxxxxxxx) dan kode blok rumah (B03/07)
 * untuk e-Card Verifikasi & IPL Digital — Perumahan Saung Kebun.
 * Digunakan seragam di Frontend, Panel Admin, dan Webhook Fonnte.
 */

export const PLACEHOLDER_WA_NUMBERS = new Set([
  '6281200000000',
  '6281200000001',
  '6281200000002',
  '6281200000003',
  '6281200000004',
  '6281200000005',
  '6281200000006',
  '6281234567890',
]);

/**
 * Standarisasi nomor telepon/WhatsApp ke format `628xxxxxxxxxx`.
 * - Menghapus spasi, tanda hubung (-), tanda plus (+), titik, dan akhiran `@s.whatsapp.net` / `@c.us` / `@g.us`.
 * - Awalan `0` diubah menjadi `62`.
 * - Awalan `8` ditambahkan `62` di depan.
 */
export function normalizePhoneNumber(phone: string | null | undefined): string {
  if (!phone) return '';
  let cleaned = String(phone)
    .trim()
    .replace(/@(s\.whatsapp\.net|c\.us|g\.us|lid)$/i, '')
    .replace(/[\s\-+.]/g, '')
    .replace(/\D/g, '');

  if (!cleaned) return '';

  if (cleaned.startsWith('0')) {
    cleaned = `62${cleaned.slice(1)}`;
  } else if (cleaned.startsWith('8')) {
    cleaned = `62${cleaned}`;
  }

  return cleaned;
}

/**
 * Memastikan nomor WhatsApp valid & bukan nomor dummy bawaan seed.
 */
export function isRealRegisteredPhone(phone: string | null | undefined): boolean {
  const normalized = normalizePhoneNumber(phone);
  if (normalized.length < 10 || normalized.length > 15) return false;
  if (!normalized.startsWith('62')) return false;
  if (PLACEHOLDER_WA_NUMBERS.has(normalized)) return false;
  return true;
}

/**
 * Format nomor WA untuk ditampilkan di UI/pesan.
 */
export function formatPhoneDisplay(phone: string | null | undefined): string {
  const normalized = normalizePhoneNumber(phone);
  if (!isRealRegisteredPhone(normalized)) return '';
  return `+${normalized}`;
}

/**
 * Standarisasi kode blok rumah agar `B3/7` dan `B03/07` terbaca identik sebagai `B03/07`.
 * - Huruf kapital, tanpa spasi berlebih, pemisah `-` disamakan menjadi `/`.
 * - Nomor blok & nomor rumah di-pad 2 digit bila berupa angka (contoh: B3/7 -> B03/07, B7/16 -> B07/16).
 */
export function normalizeBlockCode(block: string | null | undefined): string {
  if (!block) return '';
  const cleaned = String(block)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '/');

  if (!cleaned) return '';

  const match = cleaned.match(/^([A-Z]+)0*(\d+)\/0*(\d+)([A-Z]*)$/);
  if (match) {
    const [, prefix, blockNum, houseNum, suffix] = match;
    const paddedBlock = blockNum.length < 2 ? blockNum.padStart(2, '0') : blockNum;
    const paddedHouse = houseNum.length < 2 ? houseNum.padStart(2, '0') : houseNum;
    return `${prefix}${paddedBlock}/${paddedHouse}${suffix}`;
  }

  return cleaned;
}

/**
 * Bentuk kunci kanonik tanpa nol depan (contoh `B03/07` -> `B3/7`)
 * untuk pencocokan silang data lama di database yang belum ter-padding.
 */
export function canonicalBlockKey(block: string | null | undefined): string {
  if (!block) return '';
  const cleaned = String(block)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '/');

  const match = cleaned.match(/^([A-Z]+)0*(\d+)\/0*(\d+)([A-Z]*)$/);
  if (match) {
    return `${match[1]}${Number(match[2])}/${Number(match[3])}${match[4]}`;
  }
  return cleaned;
}

/**
 * Membandingkan dua kode blok rumah secara ekuivalen (`B3/7` === `B03/07`).
 */
export function isSameBlockCode(
  blockA: string | null | undefined,
  blockB: string | null | undefined
): boolean {
  const normA = normalizeBlockCode(blockA);
  const normB = normalizeBlockCode(blockB);
  if (!normA || !normB) return false;
  return normA === normB || canonicalBlockKey(blockA) === canonicalBlockKey(blockB);
}
