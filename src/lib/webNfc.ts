export interface WebNdefRecord {
  recordType?: string;
  mediaType?: string;
  id?: string;
  data?: DataView;
  encoding?: string;
  lang?: string;
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

export interface WebNdefReader extends EventTarget {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  write: (
    message: string | { records: WebNdefWriteRecord[] },
    options?: { overwrite?: boolean; signal?: AbortSignal }
  ) => Promise<void>;
  onreading: ((event: WebNdefReadingEvent) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
}

interface WindowWithNdef extends Window {
  NDEFReader?: new () => WebNdefReader;
}

export function getNdefReaderConstructor(): (new () => WebNdefReader) | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as WindowWithNdef).NDEFReader;
  return typeof ctor === 'function' ? ctor : null;
}

export function isWebNfcSupported(): boolean {
  return getNdefReaderConstructor() !== null;
}

export function isSecureContextForNfc(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.isSecureContext);
}

/**
 * Standarisasi UID tag NFC/RFID menjadi huruf kapital tanpa titik dua / spasi.
 * Contoh: "04:a1:b2:c3" -> "04A1B2C3"
 */
export function normalizeNfcUid(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/^SKB-CP:/i, '')
    .split('|')[0]
    .replace(/[:\s]/g, '');
}

/**
 * Ekstrak UID hardware (event.serialNumber) dan token NDEF teks/URL dari pembacaan tag NFC.
 */
export function extractNfcReadingData(rawEvent: Event): {
  uid: string | null;
  rawSerialNumber: string | null;
  allNormalizedTokens: string[];
} {
  const event = rawEvent as WebNdefReadingEvent;
  const allNormalizedTokens: string[] = [];
  const rawSerialNumber = event.serialNumber?.trim() || null;

  if (rawSerialNumber) {
    const cleanSerial = normalizeNfcUid(rawSerialNumber);
    if (cleanSerial) {
      allNormalizedTokens.push(cleanSerial);
    }
  }

  const records = event.message?.records || [];
  for (const rec of records) {
    if (!rec.data) continue;
    try {
      const decoder = new TextDecoder(rec.encoding || 'utf-8');
      const decoded = decoder.decode(rec.data).trim();
      if (!decoded) continue;

      if (/^SKB-CP:/i.test(decoded)) {
        const cleanCode = normalizeNfcUid(decoded);
        if (cleanCode && !allNormalizedTokens.includes(cleanCode)) {
          allNormalizedTokens.push(cleanCode);
        }
      } else {
        const matchQuery = decoded.match(/[?&]checkpoint=([^&\s]+)/i);
        if (matchQuery?.[1]) {
          const fromQuery = normalizeNfcUid(decodeURIComponent(matchQuery[1]));
          if (fromQuery && !allNormalizedTokens.includes(fromQuery)) {
            allNormalizedTokens.push(fromQuery);
          }
        }
        const normalized = normalizeNfcUid(decoded);
        if (normalized && normalized.length <= 48 && !allNormalizedTokens.includes(normalized)) {
          allNormalizedTokens.push(normalized);
        }
      }
    } catch {
      // Abaikan record biner non-teks
    }
  }

  return {
    uid: allNormalizedTokens[0] || null,
    rawSerialNumber,
    allNormalizedTokens,
  };
}

/**
 * Getaran haptik singkat ([100, 50, 100] ms) sebagai konfirmasi sentuhan saat tag NFC terbaca.
 */
export function triggerNfcVibrate(pattern: number | number[] = [100, 50, 100]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Abaikan bila perangkat/browser membatasi getaran
    }
  }
}

/**
 * Pesan error Web NFC berbahasa Indonesia yang jelas untuk Chrome Android / NFC nonaktif.
 */
export function describeWebNfcError(err: unknown): string {
  if (!isSecureContextForNfc()) {
    return 'Web NFC hanya dapat berjalan pada halaman HTTPS yang aman (buka langsung di Google Chrome Android).';
  }

  if (err instanceof DOMException || (err instanceof Error && 'name' in err)) {
    const name = err.name;
    if (name === 'NotAllowedError') {
      return 'Izin NFC ditolak oleh Chrome. Ketuk ikon pengaturan situs di bilah alamat Chrome, izinkan NFC, lalu coba lagi.';
    }
    if (name === 'NotSupportedError') {
      return 'Fitur NFC di HP Anda sedang mati atau perangkat tidak memiliki sensor NFC. Aktifkan NFC pada Pengaturan HP Android terlebih dahulu.';
    }
    if (name === 'NotReadableError') {
      return 'Gagal membaca tag NFC. Pastikan stiker menempel stabil di belakang HP dan tidak terhalang casing logam.';
    }
    if (name === 'SecurityError') {
      return 'Web NFC memerlukan halaman aktif (top-level HTTPS) di Google Chrome Android.';
    }
  }

  const msg = err instanceof Error ? err.message : '';
  return (
    msg ||
    'Gagal memulai sensor NFC. Pastikan fitur NFC HP dalam keadaan menyala dan Anda menggunakan Google Chrome Android.'
  );
}
