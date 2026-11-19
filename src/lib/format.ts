import { BULAN_LIST, TAHUN_AKTIF, type StatusBulanEcard } from '../types';

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

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
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
