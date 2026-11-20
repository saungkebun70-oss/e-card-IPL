/**
 * Utility Web NFC API (Chrome Android) untuk pembacaan & penulisan tag NFC/RFID
 * dengan foreground dispatch (AbortController) agar OS Android tidak menampilkan
 * pop-up aplikasi pihak ketiga (DANA/GoPay/LinkAja/OVO) saat scan aktif.
 */

export interface WebNdefRecord {
  recordType?: string;
  mediaType?: string;
  data?: DataView;
}

export interface WebNdefReadingEvent extends Event {
  serialNumber?: string;
  message?: {
    records?: WebNdefRecord[];
  };
}

export interface WebNdefWriteRecord {
  recordType: 'text' | 'url';
  data: string;
}

export interface WebNdefReader {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  write: (
    message: string | { records: WebNdefWriteRecord[] },
    options?: { signal?: AbortSignal; overwrite?: boolean }
  ) => Promise<void>;
  addEventListener: (
    type: 'reading' | 'readingerror',
    listener: (event: WebNdefReadingEvent) => void,
    options?: { signal?: AbortSignal }
  ) => void;
  onreading: ((event: WebNdefReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
}

interface WindowWithNdef extends Window {
  NDEFReader?: new () => WebNdefReader;
}

export function isWebNfcSupported(): boolean {
  return typeof window !== 'undefined' && 'NDEFReader' in window;
}

export function getNdefReaderConstructor(): (new () => WebNdefReader) | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as WindowWithNdef).NDEFReader || null;
}

/**
 * Standarisasi UID tag NFC/RFID menjadi huruf kapital tanpa titik dua, strip, atau spasi.
 * Contoh: "04:a1:b2:c3" -> "04A1B2C3"
 */
export function normalizeNfcUid(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Ekstrak UID utama (serialNumber terstandarisasi) dan daftar token teks dari record NDEF.
 */
export function extractNfcReadingData(event: WebNdefReadingEvent): {
  uid: string;
  rawSerial: string;
  ndefTokens: string[];
  allNormalizedTokens: string[];
} {
  const rawSerial = (event.serialNumber || '').trim();
  const normalizedSerial = normalizeNfcUid(rawSerial);
  const ndefTokens: string[] = [];
  const decoder = new TextDecoder();

  const records = event.message?.records || [];
  for (const rec of records) {
    if (!rec.data) continue;
    try {
      const decoded = decoder.decode(rec.data).trim();
      if (!decoded) continue;
      ndefTokens.push(decoded);
      // Dukung format payload khusus: "SKB-CP:04A1B2C3" atau URL "?checkpoint=04A1B2C3"
      if (decoded.toUpperCase().startsWith('SKB-CP:')) {
        const extracted = decoded.slice(7).split('|')[0]?.trim();
        if (extracted) ndefTokens.push(extracted);
      }
      if (decoded.includes('checkpoint=')) {
        try {
          const parsedUrl = new URL(decoded);
          const cp = parsedUrl.searchParams.get('checkpoint');
          if (cp) ndefTokens.push(cp);
        } catch {
          // Bukan URL valid
        }
      }
    } catch {
      // Abaikan record biner non-teks
    }
  }

  const normalizedSet = new Set<string>();
  if (normalizedSerial) normalizedSet.add(normalizedSerial);
  for (const tok of ndefTokens) {
    const norm = normalizeNfcUid(tok);
    if (norm) normalizedSet.add(norm);
  }

  const uid = normalizedSerial || normalizeNfcUid(ndefTokens[0] || '');

  return {
    uid,
    rawSerial,
    ndefTokens,
    allNormalizedTokens: Array.from(normalizedSet),
  };
}

/**
 * Trigger umpan balik getaran halus di HP saat tag NFC berhasil terbaca.
 */
export function triggerNfcVibrate(durationMs = 100): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(durationMs);
    } catch {
      // Abaikan jika browser membatasi vibration API
    }
  }
}

/**
 * Terjemahkan error Web NFC menjadi pesan Bahasa Indonesia yang jelas dan actionable.
 */
export function describeWebNfcError(err: unknown): string {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Web NFC hanya berjalan pada koneksi HTTPS yang aman.';
  }

  if (err instanceof DOMException || err instanceof Error) {
    const name = err.name;
    const msg = (err.message || '').toLowerCase();

    if (name === 'AbortError') {
      return 'Pemindaian NFC dibatalkan.';
    }
    if (name === 'NotAllowedError') {
      return 'Izin akses NFC ditolak. Izinkan akses NFC untuk Chrome di pengaturan situs lalu coba lagi.';
    }
    if (name === 'NotSupportedError' || msg.includes('not supported') || msg.includes('nfc adapter')) {
      return 'Fitur NFC pada HP Anda tidak tersedia atau sedang NONAKTIF. Aktifkan NFC di Pengaturan HP lalu ulangi.';
    }
    if (name === 'NotReadableError') {
      return 'Sensor NFC sedang nonaktif atau gagal membaca tag. Pastikan NFC HP aktif dan tidak tertutup casing logam.';
    }
    if (name === 'InvalidStateError') {
      return 'Pastikan halaman aplikasi berada di layar aktif (foreground) saat memulai scan NFC.';
    }
    if (name === 'NetworkError') {
      return 'Koneksi ke tag terputus saat membaca/menulis. Tempelkan stiker NFC diam 1–2 detik di belakang HP.';
    }
    if (err.message) {
      return `Gagal memulai sensor NFC: ${err.message}`;
    }
  }

  return 'Tidak dapat mengakses sensor NFC. Pastikan Anda memakai Chrome Android dan fitur NFC HP dalam keadaan aktif.';
}
