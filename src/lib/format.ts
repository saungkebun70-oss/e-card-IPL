import {
  APP_PORTAL_URL,
  BULAN_LIST,
  TAHUN_AKTIF,
  WA_ACCESS_TEMPLATE_DEFAULT,
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

export function getDefaultUnpaidStatusForMonth(bulan: number): StatusBulanEcard {
  const now = new Date();
  const currentMonth = getCurrentBillingMonth();
  if (bulan > currentMonth) {
    return 'Belum Tagihan';
  }
  if (bulan < currentMonth) {
    return 'Jatuh Tempo';
  }
  // Bulan berjalan: jatuh tempo setelah tanggal 7
  return now.getDate() > 7 ? 'Jatuh Tempo' : 'Belum Bayar';
}

export function extractBlokPrefix(blokRumah: string): string {
  const clean = blokRumah.trim().toUpperCase();
  const slashIdx = clean.indexOf('/');
  if (slashIdx > 0) {
    return clean.slice(0, slashIdx);
  }
  return clean.slice(0, 3) || 'LAIN';
}

export function generateRandomPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function normalizeBlok(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizeWaNumber(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `62${digits.slice(1)}`;
  }
  if (digits.startsWith('8')) {
    return `62${digits}`;
  }
  return digits;
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const normalized = normalizeWaNumber(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function buildWargaAccessWaMessage(warga: Pick<Warga, 'nama_warga' | 'blok_rumah' | 'pin_akses'>): string {
  return WA_ACCESS_TEMPLATE_DEFAULT
    .replaceAll('{nama_warga}', warga.nama_warga)
    .replaceAll('{blok_rumah}', warga.blok_rumah)
    .replaceAll('{pin_akses}', warga.pin_akses)
    .replaceAll('{link_aplikasi}', APP_PORTAL_URL);
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
