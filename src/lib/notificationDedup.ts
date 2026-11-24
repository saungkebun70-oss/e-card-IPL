import type { ActivityNotification } from '../types';

export function normalizeNotifText(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeNotifRecipientToken(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function isValidUuid(value?: string | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

/**
 * Menghasilkan UUID v4 standar RFC 4122 agar ID klien identik dengan kolom `id uuid` di Postgres,
 * sehingga event lokal dan Supabase Realtime `INSERT` selalu berbagi `id` yang sama persis.
 */
export function createNotificationUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
  } catch {
    // Fallback pseudo-UUID v4
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function fnv1aHashHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Membentuk `dedup_key` deterministik untuk mencegah duplikasi notifikasi pada DB, Edge Function, maupun UI.
 * Catatan: tidak menyertakan `user_id` di dalamnya agar dua penerima berbeda tetap menerima 1 baris masing-masing,
 * namun 1 penerima (beserta alias role-nya) hanya dapat menerima 1 notifikasi per event.
 */
export function buildNotificationDedupKey(params: {
  dedupKey?: string | null;
  category?: string | null;
  title?: string | null;
  message?: string | null;
  targetUrl?: string | null;
  windowMs?: number;
  timestampMs?: number;
}): string {
  const explicit = String(params.dedupKey || '').trim();
  if (explicit) {
    return `evt:${explicit.toLowerCase().replace(/\s+/g, '_').slice(0, 140)}`;
  }
  const normalizedPayload = [
    normalizeNotifText(params.category || 'system'),
    normalizeNotifText(params.title),
    normalizeNotifText(params.message),
    normalizeNotifText(params.targetUrl),
  ].join('::');
  const windowMs = params.windowMs && params.windowMs > 0 ? params.windowMs : 30_000;
  const nowMs = params.timestampMs && params.timestampMs > 0 ? params.timestampMs : Date.now();
  const bucket = Math.floor(nowMs / windowMs);
  return `h:${fnv1aHashHex(normalizedPayload)}:${bucket}`;
}

export function buildNotificationContentSignature(notif: {
  category?: string | null;
  title?: string | null;
  message?: string | null;
}): string {
  return [
    normalizeNotifText(notif.category || 'system'),
    normalizeNotifText(notif.title),
    normalizeNotifText(notif.message),
  ].join('::');
}

function getRowPriority(row: Pick<ActivityNotification, 'id' | 'user_id'>): number {
  let score = 0;
  if (!row.id.startsWith('notif-')) score += 4;
  const uid = normalizeNotifRecipientToken(row.user_id);
  if (uid && !uid.startsWith('broadcast:') && !uid.startsWith('role:')) score += 2;
  return score;
}

/**
 * Menghapus duplikasi notifikasi pada daftar & penghitungan badge berdasarkan:
 * 1) `id` identik
 * 2) `dedup_key` identik (lintas alias role/user_id maupun double insert)
 * 3) kombinasi `(category, title, message)` dalam rentang waktu berdekatan (default 90 detik)
 */
export function deduplicateNotifications<
  T extends Pick<
    ActivityNotification,
    'id' | 'user_id' | 'category' | 'title' | 'message' | 'is_read' | 'created_at' | 'dedup_key'
  >,
>(list: T[], proximityWindowMs = 90_000): T[] {
  if (!Array.isArray(list) || list.length === 0) return [];

  // Langkah 1: gabungkan baris dengan ID yang sama persis
  const byId = new Map<string, T>();
  for (const item of list) {
    if (!item || !item.id) continue;
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const preferCandidate = getRowPriority(item) > getRowPriority(existing);
    const base = preferCandidate ? item : existing;
    byId.set(item.id, {
      ...base,
      is_read: Boolean(existing.is_read || item.is_read),
    });
  }

  // Urutkan dari terbaru -> terlama, dan prioritaskan baris DB/langsung jika timestamp sama
  const sorted = Array.from(byId.values()).sort((a, b) => {
    const timeDiff = (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
    if (timeDiff !== 0) return timeDiff;
    return getRowPriority(b) - getRowPriority(a);
  });

  // Langkah 2: deduplikasi berdasarkan `dedup_key` & kedekatan konten+waktu
  const kept: T[] = [];
  const indexByDedupKey = new Map<string, number>();
  const indicesBySignature = new Map<string, number[]>();

  for (const item of sorted) {
    const dk = typeof item.dedup_key === 'string' ? item.dedup_key.trim().toLowerCase() : '';
    const sig = buildNotificationContentSignature(item);
    const itemMs = Date.parse(item.created_at) || 0;

    let matchIdx: number | undefined;
    if (dk && indexByDedupKey.has(dk)) {
      matchIdx = indexByDedupKey.get(dk);
    }

    if (matchIdx === undefined) {
      const candidateIndices = indicesBySignature.get(sig);
      if (candidateIndices) {
        for (const idx of candidateIndices) {
          const existing = kept[idx];
          const existingMs = Date.parse(existing.created_at) || 0;
          if (
            itemMs === 0 ||
            existingMs === 0 ||
            Math.abs(existingMs - itemMs) <= proximityWindowMs
          ) {
            matchIdx = idx;
            break;
          }
        }
      }
    }

    if (matchIdx !== undefined) {
      const existing = kept[matchIdx];
      const preferCandidate = getRowPriority(item) > getRowPriority(existing);
      const winner = preferCandidate ? item : existing;
      kept[matchIdx] = {
        ...winner,
        is_read: Boolean(existing.is_read || item.is_read),
        dedup_key: winner.dedup_key || existing.dedup_key || item.dedup_key || null,
      };
      if (dk && !indexByDedupKey.has(dk)) {
        indexByDedupKey.set(dk, matchIdx);
      }
      continue;
    }

    const newIdx = kept.length;
    kept.push(item);
    if (dk) {
      indexByDedupKey.set(dk, newIdx);
    }
    const listForSig = indicesBySignature.get(sig);
    if (listForSig) {
      listForSig.push(newIdx);
    } else {
      indicesBySignature.set(sig, [newIdx]);
    }
  }

  return kept;
}
