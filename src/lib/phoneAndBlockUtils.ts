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

function parseBlockCodeComponents(rawBlok: string | null | undefined): {
  isBlock: boolean;
  prefix: string;
  blockNum: number;
  houseNum: number | null;
  suffix: string;
  cleaned: string;
} {
  const rawTrimmed = String(rawBlok || '').trim();
  if (!rawTrimmed) {
    return {
      isBlock: false,
      prefix: '',
      blockNum: Number.MAX_SAFE_INTEGER,
      houseNum: null,
      suffix: '',
      cleaned: '',
    };
  }

  const cleaned = rawTrimmed
    .toUpperCase()
    .replace(/^BLOK\s+/i, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '/');

  const fullMatch = cleaned.match(/^([A-Z]+)0*(\d+)\/0*(\d+)([A-Z]*)$/);
  if (fullMatch) {
    return {
      isBlock: true,
      prefix: fullMatch[1],
      blockNum: Number(fullMatch[2]),
      houseNum: Number(fullMatch[3]),
      suffix: fullMatch[4] || '',
      cleaned,
    };
  }

  const prefixOnlyMatch = cleaned.match(/^([A-Z]+)0*(\d+)$/);
  if (prefixOnlyMatch) {
    return {
      isBlock: true,
      prefix: prefixOnlyMatch[1],
      blockNum: Number(prefixOnlyMatch[2]),
      houseNum: null,
      suffix: '',
      cleaned,
    };
  }

  return {
    isBlock: false,
    prefix: cleaned,
    blockNum: Number.MAX_SAFE_INTEGER,
    houseNum: null,
    suffix: '',
    cleaned,
  };
}

/**
 * Format tampilan kode blok rumah menjadi dua digit dengan nol di depan (UI/display layer only):
 * - `B3/1` atau `B03/1` -> `B03/01`
 * - `B3/2` -> `B03/02`
 * - `B12/5` -> `B12/05`
 * - `B3` -> `B03`
 * Nilai non-blok (seperti username pengurus `andriansyah`, `BOT-WA`, `TES-WA`) dikembalikan apa adanya.
 */
export function formatBlokRumah(rawBlok: string | null | undefined): string {
  const rawTrimmed = String(rawBlok || '').trim();
  if (!rawTrimmed) return '';

  const parsed = parseBlockCodeComponents(rawTrimmed);
  if (!parsed.isBlock) {
    return rawTrimmed;
  }

  const paddedBlock = String(parsed.blockNum).padStart(2, '0');
  if (parsed.houseNum === null) {
    return `${parsed.prefix}${paddedBlock}`;
  }
  const paddedHouse = String(parsed.houseNum).padStart(2, '0');
  return `${parsed.prefix}${paddedBlock}/${paddedHouse}${parsed.suffix}`;
}

/**
 * Pengurutan numerik blok rumah dari terkecil ke terbesar (`B03/01`, `B03/02`, ..., `B03/10`, `B12/05`).
 * Memecah huruf blok, angka blok, dan nomor urut rumah secara numerik.
 */
export function compareBlokRumah(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const pa = parseBlockCodeComponents(a);
  const pb = parseBlockCodeComponents(b);

  if (pa.isBlock !== pb.isBlock) {
    return pa.isBlock ? -1 : 1;
  }

  if (pa.isBlock && pb.isBlock) {
    const prefixCmp = pa.prefix.localeCompare(pb.prefix, 'id');
    if (prefixCmp !== 0) return prefixCmp;

    if (pa.blockNum !== pb.blockNum) {
      return pa.blockNum - pb.blockNum;
    }

    const ha = pa.houseNum ?? -1;
    const hb = pb.houseNum ?? -1;
    if (ha !== hb) {
      return ha - hb;
    }

    const suffixCmp = pa.suffix.localeCompare(pb.suffix, 'id');
    if (suffixCmp !== 0) return suffixCmp;
  }

  return pa.cleaned.localeCompare(pb.cleaned, 'id', { numeric: true });
}

/**
 * Standarisasi kode blok rumah agar `B3/7` dan `B03/07` terbaca identik sebagai `B03/07`.
 * - Huruf kapital, tanpa spasi berlebih, pemisah `-` disamakan menjadi `/`.
 * - Nomor blok & nomor rumah di-pad 2 digit bila berupa angka (contoh: B3/7 -> B03/07, B7/16 -> B07/16).
 */
export function normalizeBlockCode(block: string | null | undefined): string {
  if (!block) return '';
  const formatted = formatBlokRumah(block);
  if (formatted && formatted !== String(block).trim()) {
    return formatted;
  }
  return String(block)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '/');
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
 * Pencarian blok toleran terhadap nol di depan (`B3/1` maupun `B03/01` menemukan unit yang sama).
 */
export function matchesBlockSearch(
  targetBlockOrText: string | null | undefined,
  query: string | null | undefined
): boolean {
  const qRaw = String(query || '').trim().toLowerCase();
  if (!qRaw) return true;

  const targetRaw = String(targetBlockOrText || '').trim().toLowerCase();
  if (!targetRaw) return false;
  if (targetRaw.includes(qRaw)) return true;

  const targetFormatted = formatBlokRumah(targetBlockOrText).toLowerCase();
  const targetCanonical = canonicalBlockKey(targetBlockOrText).toLowerCase();
  const qNormalized = qRaw.replace(/^blok\s+/i, '').replace(/\s+/g, '').replace(/-/g, '/');
  const qFormatted = formatBlokRumah(qNormalized).toLowerCase();
  const qCanonical = canonicalBlockKey(qNormalized).toLowerCase();

  return (
    targetFormatted.includes(qRaw) ||
    targetFormatted.includes(qNormalized) ||
    targetFormatted.includes(qFormatted) ||
    targetCanonical.includes(qRaw) ||
    targetCanonical.includes(qNormalized) ||
    targetCanonical.includes(qCanonical) ||
    (qFormatted.length > 0 && targetFormatted === qFormatted) ||
    (qCanonical.length > 0 && targetCanonical === qCanonical)
  );
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
