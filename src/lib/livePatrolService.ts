import {
  DEFAULT_PATROL_CHECKPOINTS,
  type PatrolCheckpoint,
  type PatrolScan,
  type PatrolSession,
  type RoutePathPoint,
  type SessionUser,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { normalizeNfcUid } from './webNfc';

const LOCAL_KEYS = {
  CHECKPOINTS: 'saungkebun_live_patrol_checkpoints_v1',
  SESSIONS: 'saungkebun_live_patrol_sessions_v1',
  SCANS: 'saungkebun_live_patrol_scans_v1',
} as const;

const LOCAL_SYNC_EVENT = 'saungkebun:live-patrol-updated';

function emitLocalSync() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_SYNC_EVENT));
  }
}

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Abaikan kuota storage penuh
  }
  emitLocalSync();
}

export interface LivePatrolSnapshot {
  checkpoints: PatrolCheckpoint[];
  activeSession: PatrolSession | null;
  activeScans: PatrolScan[];
  completedSessions: PatrolSession[];
  allScans: PatrolScan[];
}

export interface LivePatrolResult<T> {
  data?: T;
  error?: string;
}

function parseRoutePath(raw: unknown): RoutePathPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: RoutePathPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const lat = Number(obj.lat);
    const lng = Number(obj.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    points.push({
      lat,
      lng,
      time: typeof obj.time === 'string' ? obj.time : new Date().toISOString(),
    });
  }
  return points;
}

function normalizeCheckpointRow(row: Record<string, unknown>, idx: number): PatrolCheckpoint {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const orderIndex = Number(row.order_index);
  return {
    id: String(row.id || `cp-pos-${idx + 1}`),
    name: String(row.name || `Pos ${idx + 1}`),
    nfc_tag_id: String(row.nfc_tag_id || ''),
    lat: Number.isFinite(lat) ? lat : DEFAULT_PATROL_CHECKPOINTS[idx % 5].lat,
    lng: Number.isFinite(lng) ? lng : DEFAULT_PATROL_CHECKPOINTS[idx % 5].lng,
    order_index: Number.isFinite(orderIndex) ? orderIndex : idx + 1,
  };
}

function normalizeSessionRow(row: Record<string, unknown>): PatrolSession {
  const lat = row.current_lat === null || row.current_lat === undefined ? null : Number(row.current_lat);
  const lng = row.current_lng === null || row.current_lng === undefined ? null : Number(row.current_lng);
  return {
    id: String(row.id || ''),
    officer_id: String(row.officer_id || ''),
    officer_name: String(row.officer_name || 'Petugas Keamanan'),
    status: row.status === 'active' ? 'active' : 'completed',
    current_lat: lat !== null && Number.isFinite(lat) ? lat : null,
    current_lng: lng !== null && Number.isFinite(lng) ? lng : null,
    route_path: parseRoutePath(row.route_path),
    started_at: String(row.started_at || new Date().toISOString()),
    ended_at: typeof row.ended_at === 'string' ? row.ended_at : null,
    last_ping_at: typeof row.last_ping_at === 'string' ? row.last_ping_at : null,
  };
}

function normalizeScanRow(row: Record<string, unknown>): PatrolScan {
  const lat = row.lat === null || row.lat === undefined ? null : Number(row.lat);
  const lng = row.lng === null || row.lng === undefined ? null : Number(row.lng);
  return {
    id: String(row.id || ''),
    session_id: String(row.session_id || ''),
    checkpoint_id: String(row.checkpoint_id || ''),
    officer_name: String(row.officer_name || 'Petugas Keamanan'),
    nfc_serial: typeof row.nfc_serial === 'string' ? row.nfc_serial : null,
    lat: lat !== null && Number.isFinite(lat) ? lat : null,
    lng: lng !== null && Number.isFinite(lng) ? lng : null,
    scanned_at: String(row.scanned_at || new Date().toISOString()),
  };
}

/**
 * Menghitung jarak Haversine dalam meter antara dua titik koordinat GPS.
 */
export function calculateDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Mencari pos checkpoint terdekat dari koordinat GPS saat ini.
 */
export function findNearestCheckpoint(
  lat: number,
  lng: number,
  checkpoints: PatrolCheckpoint[]
): { checkpoint: PatrolCheckpoint; distanceMeters: number } | null {
  if (!checkpoints.length) return null;
  let best: { checkpoint: PatrolCheckpoint; distanceMeters: number } | null = null;
  for (const cp of checkpoints) {
    const dist = calculateDistanceMeters(lat, lng, cp.lat, cp.lng);
    if (!best || dist < best.distanceMeters) {
      best = { checkpoint: cp, distanceMeters: dist };
    }
  }
  return best;
}

/**
 * Memutar bunyi beep konfirmasi sukses via Web Audio API + getaran HP (200ms).
 * Aman di semua browser (dibungkus try/catch).
 */
export function playScanSuccessFeedback(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(200);
    }
  } catch {
    // Abaikan bila perangkat tidak mendukung vibrasi
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.28);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Abaikan bila AudioContext dibatasi autoplay browser
  }
}

/**
 * Pesan error GPS berbahasa Indonesia yang ramah beserta panduan singkat mengaktifkan izin lokasi.
 */
export function describeGeolocationError(err: GeolocationPositionError | unknown): {
  title: string;
  message: string;
  guide: string;
} {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? Number((err as { code?: number }).code)
      : 0;

  if (code === 1) {
    return {
      title: 'Izin Lokasi GPS Ditolak',
      message: 'Browser belum diizinkan mengakses lokasi GPS perangkat Anda.',
      guide:
        'Cara aktifkan: Ketuk ikon gembok / pengaturan situs di sebelah alamat URL browser → pilih "Izin" → aktifkan "Lokasi (Izinkan)" → lalu muat ulang atau klik Mulai Patroli lagi.',
    };
  }
  if (code === 2) {
    return {
      title: 'Sinyal GPS Tidak Tersedia',
      message: 'Perangkat belum dapat menentukan posisi satelit GPS saat ini.',
      guide:
        'Pastikan fitur Lokasi / GPS HP Anda sudah aktif (mode Akurasi Tinggi) dan coba bergerak ke area terbuka.',
    };
  }
  if (code === 3) {
    return {
      title: 'Waktu Pencarian GPS Habis',
      message: 'Permintaan koordinat GPS melebihi batas waktu.',
      guide: 'Pastikan GPS HP aktif dan sinyal internet stabil, lalu coba lagi.',
    };
  }
  return {
    title: 'Gagal Mengakses GPS',
    message:
      err instanceof Error
        ? err.message
        : 'Browser atau perangkat ini tidak mendukung pelacakan GPS.',
    guide:
      'Gunakan browser Google Chrome atau Safari versi terbaru pada halaman HTTPS dengan GPS aktif.',
  };
}

/**
 * Escape karakter HTML untuk keamanan konten string di dalam L.divIcon dan L.popup Leaflet.
 */
export function escapeLeafletHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatWibTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const formatted = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(d);
  return `${formatted} WIB`;
}

export function formatWibDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return (
    new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta',
    }).format(d) + ' WIB'
  );
}

export function formatRelativePing(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return 'baru saja';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'baru saja';
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 5) return 'baru saja';
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} jam lalu`;
}

export function formatDurationIndo(startedIso: string, endedIso: string | null): string {
  const start = new Date(startedIso).getTime();
  const end = endedIso ? new Date(endedIso).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '-';
  const totalSec = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours} jam ${mins} mnt`;
  if (mins > 0) return `${mins} mnt ${secs} dtk`;
  return `${secs} detik`;
}

function getLocalSnapshot(): LivePatrolSnapshot {
  const checkpoints = readLocalJson<PatrolCheckpoint[]>(
    LOCAL_KEYS.CHECKPOINTS,
    DEFAULT_PATROL_CHECKPOINTS
  ).sort((a, b) => a.order_index - b.order_index);

  const sessions = readLocalJson<PatrolSession[]>(LOCAL_KEYS.SESSIONS, []).sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  const allScans = readLocalJson<PatrolScan[]>(LOCAL_KEYS.SCANS, []).sort(
    (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
  );

  const activeSession = sessions.find((s) => s.status === 'active') || null;
  const completedSessions = sessions.filter((s) => s.status === 'completed').slice(0, 30);
  const activeScans = activeSession
    ? allScans.filter((sc) => sc.session_id === activeSession.id)
    : [];

  return {
    checkpoints: checkpoints.length > 0 ? checkpoints : DEFAULT_PATROL_CHECKPOINTS,
    activeSession,
    activeScans,
    completedSessions,
    allScans,
  };
}

/**
 * Mengambil snapshot lengkap Live Patroli (5 checkpoint, sesi aktif, scan aktif, & riwayat sesi selesai).
 */
export async function fetchLivePatrolSnapshot(
  session?: SessionUser | null
): Promise<LivePatrolSnapshot> {
  const supabase = getSupabaseClient(session || null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const [cpRes, sessionsRes, scansRes] = await Promise.all([
        supabase.from('patrol_checkpoints').select('*').order('order_index', { ascending: true }),
        supabase
          .from('patrol_sessions')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(40),
        supabase
          .from('patrol_scans')
          .select('*')
          .order('scanned_at', { ascending: false })
          .limit(200),
      ]);

      if (!cpRes.error && !sessionsRes.error && !scansRes.error) {
        const checkpoints =
          Array.isArray(cpRes.data) && cpRes.data.length > 0
            ? (cpRes.data as Record<string, unknown>[]).map(normalizeCheckpointRow)
            : readLocalJson<PatrolCheckpoint[]>(LOCAL_KEYS.CHECKPOINTS, DEFAULT_PATROL_CHECKPOINTS);

        const sessions = ((sessionsRes.data || []) as Record<string, unknown>[]).map(
          normalizeSessionRow
        );
        const allScans = ((scansRes.data || []) as Record<string, unknown>[]).map(normalizeScanRow);
        const activeSession = sessions.find((s) => s.status === 'active') || null;
        const completedSessions = sessions.filter((s) => s.status === 'completed').slice(0, 30);
        const activeScans = activeSession
          ? allScans.filter((sc) => sc.session_id === activeSession.id)
          : [];

        return {
          checkpoints: checkpoints.sort((a, b) => a.order_index - b.order_index),
          activeSession,
          activeScans,
          completedSessions,
          allScans,
        };
      }
    } catch {
      // Lanjut fallback lokal jika tabel belum tersedia atau jaringan terputus
    }
  }

  return getLocalSnapshot();
}

/**
 * Memulai sesi patroli live baru (status = 'active') pada tabel patrol_sessions.
 */
export async function startLivePatrolSession(
  session: SessionUser,
  coords: { lat: number; lng: number }
): Promise<LivePatrolResult<PatrolSession>> {
  const nowIso = new Date().toISOString();
  const initialPoint: RoutePathPoint = { lat: coords.lat, lng: coords.lng, time: nowIso };
  const officerId = session.petugas_id || session.blok_rumah || 'petugas';
  const officerName = session.nama_warga || 'Petugas Keamanan';

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      // Tutup sesi lama yang mungkin masih tertinggal 'active' untuk petugas ini
      await supabase
        .from('patrol_sessions')
        .update({ status: 'completed', ended_at: nowIso })
        .eq('officer_id', officerId)
        .eq('status', 'active');

      const { data, error } = await supabase
        .from('patrol_sessions')
        .insert({
          officer_id: officerId,
          officer_name: officerName,
          status: 'active',
          current_lat: coords.lat,
          current_lng: coords.lng,
          route_path: [initialPoint],
          started_at: nowIso,
          last_ping_at: nowIso,
        })
        .select('*')
        .single();

      if (!error && data) {
        return { data: normalizeSessionRow(data as Record<string, unknown>) };
      }
    } catch {
      // Lanjut ke penyimpanan lokal jika tabel Supabase belum dibuat
    }
  }

  const localSessions = readLocalJson<PatrolSession[]>(LOCAL_KEYS.SESSIONS, []).map((s) =>
    s.officer_id === officerId && s.status === 'active'
      ? { ...s, status: 'completed' as const, ended_at: nowIso }
      : s
  );
  const created: PatrolSession = {
    id: `local-session-${Date.now()}`,
    officer_id: officerId,
    officer_name: officerName,
    status: 'active',
    current_lat: coords.lat,
    current_lng: coords.lng,
    route_path: [initialPoint],
    started_at: nowIso,
    ended_at: null,
    last_ping_at: nowIso,
  };
  writeLocalJson(LOCAL_KEYS.SESSIONS, [created, ...localSessions].slice(0, 40));
  return { data: created };
}

/**
 * Mengirim pembaruan koordinat GPS petugas ke patrol_sessions + menambahkan titik ke route_path.
 */
export async function pingLivePatrolLocation(
  session: SessionUser,
  patrolSessionId: string,
  coords: { lat: number; lng: number },
  nextRoutePath: RoutePathPoint[]
): Promise<LivePatrolResult<boolean>> {
  const nowIso = new Date().toISOString();
  // Batasi panjang route_path maksimum 400 titik agar payload ringan
  const trimmedPath = nextRoutePath.slice(-400);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !patrolSessionId.startsWith('local-session-')) {
    try {
      const { error } = await supabase
        .from('patrol_sessions')
        .update({
          current_lat: coords.lat,
          current_lng: coords.lng,
          route_path: trimmedPath,
          last_ping_at: nowIso,
        })
        .eq('id', patrolSessionId)
        .eq('status', 'active');

      if (!error) return { data: true };
    } catch {
      // Lanjut update lokal
    }
  }

  const localSessions = readLocalJson<PatrolSession[]>(LOCAL_KEYS.SESSIONS, []);
  const updated = localSessions.map((s) =>
    s.id === patrolSessionId
      ? {
          ...s,
          current_lat: coords.lat,
          current_lng: coords.lng,
          route_path: trimmedPath,
          last_ping_at: nowIso,
        }
      : s
  );
  writeLocalJson(LOCAL_KEYS.SESSIONS, updated);
  return { data: true };
}

/**
 * Mengakhiri sesi patroli aktif (status = 'completed', ended_at = NOW()).
 */
export async function completeLivePatrolSession(
  session: SessionUser,
  patrolSessionId: string
): Promise<LivePatrolResult<boolean>> {
  const nowIso = new Date().toISOString();
  const supabase = getSupabaseClient(session);

  if (supabase && isSupabaseConfigured() && !patrolSessionId.startsWith('local-session-')) {
    try {
      const { error } = await supabase
        .from('patrol_sessions')
        .update({
          status: 'completed',
          ended_at: nowIso,
          last_ping_at: nowIso,
        })
        .eq('id', patrolSessionId);

      if (!error) return { data: true };
    } catch {
      // Lanjut update lokal
    }
  }

  const localSessions = readLocalJson<PatrolSession[]>(LOCAL_KEYS.SESSIONS, []);
  const updated = localSessions.map((s) =>
    s.id === patrolSessionId
      ? { ...s, status: 'completed' as const, ended_at: nowIso, last_ping_at: nowIso }
      : s
  );
  writeLocalJson(LOCAL_KEYS.SESSIONS, updated);
  return { data: true };
}

/**
 * Menyimpan hasil scan checkpoint NFC / Verifikasi GPS ke tabel patrol_scans.
 */
export async function recordLivePatrolScan(
  session: SessionUser,
  payload: {
    sessionId: string;
    checkpoint: PatrolCheckpoint;
    nfcSerial?: string | null;
    lat?: number | null;
    lng?: number | null;
  }
): Promise<LivePatrolResult<PatrolScan>> {
  const nowIso = new Date().toISOString();
  const officerName = session.nama_warga || 'Petugas Keamanan';
  const serialClean = payload.nfcSerial ? normalizeNfcUid(payload.nfcSerial) : null;

  const supabase = getSupabaseClient(session);
  if (
    supabase &&
    isSupabaseConfigured() &&
    !payload.sessionId.startsWith('local-session-') &&
    !payload.checkpoint.id.startsWith('cp-pos-')
  ) {
    try {
      const { data, error } = await supabase
        .from('patrol_scans')
        .insert({
          session_id: payload.sessionId,
          checkpoint_id: payload.checkpoint.id,
          officer_name: officerName,
          nfc_serial: serialClean || payload.checkpoint.nfc_tag_id || 'GPS-VERIFIED',
          lat: payload.lat ?? payload.checkpoint.lat,
          lng: payload.lng ?? payload.checkpoint.lng,
          scanned_at: nowIso,
        })
        .select('*')
        .single();

      if (!error && data) {
        return { data: normalizeScanRow(data as Record<string, unknown>) };
      }
    } catch {
      // Lanjut ke fallback lokal
    }
  }

  const localScans = readLocalJson<PatrolScan[]>(LOCAL_KEYS.SCANS, []);
  const created: PatrolScan = {
    id: `local-scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    session_id: payload.sessionId,
    checkpoint_id: payload.checkpoint.id,
    officer_name: officerName,
    nfc_serial: serialClean || payload.checkpoint.nfc_tag_id || 'GPS-VERIFIED',
    lat: payload.lat ?? payload.checkpoint.lat,
    lng: payload.lng ?? payload.checkpoint.lng,
    scanned_at: nowIso,
  };
  writeLocalJson(LOCAL_KEYS.SCANS, [created, ...localScans].slice(0, 250));
  return { data: created };
}

/**
 * Menyimpan hasil kalibrasi GPS & ID Stiker NFC untuk Pos 1..5 (khusus Admin / Ketua).
 */
export async function savePatrolCheckpointCalibration(
  session: SessionUser,
  checkpoint: PatrolCheckpoint
): Promise<LivePatrolResult<PatrolCheckpoint>> {
  if (session.role !== 'admin') {
    return { error: 'Hanya Ketua / Pengurus Admin yang dapat mengkalibrasi titik pos patroli.' };
  }

  const cleanName = checkpoint.name.trim() || `Pos ${checkpoint.order_index}`;
  const cleanNfc = normalizeNfcUid(checkpoint.nfc_tag_id || '') || `NFC-POS-0${checkpoint.order_index}`;
  const cleanLat = Number(checkpoint.lat);
  const cleanLng = Number(checkpoint.lng);

  if (!Number.isFinite(cleanLat) || !Number.isFinite(cleanLng)) {
    return { error: 'Koordinat Latitude & Longitude tidak valid.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        checkpoint.id
      );

      if (isUuid) {
        const { data, error } = await supabase
          .from('patrol_checkpoints')
          .update({
            name: cleanName,
            nfc_tag_id: cleanNfc,
            lat: cleanLat,
            lng: cleanLng,
            order_index: checkpoint.order_index,
          })
          .eq('id', checkpoint.id)
          .select('*')
          .single();

        if (!error && data) {
          return { data: normalizeCheckpointRow(data as Record<string, unknown>, checkpoint.order_index - 1) };
        }
      } else {
        // Coba cari berdasarkan order_index dulu di DB
        const { data: existingByOrder } = await supabase
          .from('patrol_checkpoints')
          .select('id')
          .eq('order_index', checkpoint.order_index)
          .maybeSingle();

        if (existingByOrder?.id) {
          const { data, error } = await supabase
            .from('patrol_checkpoints')
            .update({
              name: cleanName,
              nfc_tag_id: cleanNfc,
              lat: cleanLat,
              lng: cleanLng,
            })
            .eq('id', existingByOrder.id)
            .select('*')
            .single();

          if (!error && data) {
            return { data: normalizeCheckpointRow(data as Record<string, unknown>, checkpoint.order_index - 1) };
          }
        } else {
          const { data, error } = await supabase
            .from('patrol_checkpoints')
            .insert({
              name: cleanName,
              nfc_tag_id: cleanNfc,
              lat: cleanLat,
              lng: cleanLng,
              order_index: checkpoint.order_index,
            })
            .select('*')
            .single();

          if (!error && data) {
            return { data: normalizeCheckpointRow(data as Record<string, unknown>, checkpoint.order_index - 1) };
          }
        }
      }
    } catch {
      // Lanjut fallback lokal jika tabel belum dibuat
    }
  }

  const current = readLocalJson<PatrolCheckpoint[]>(
    LOCAL_KEYS.CHECKPOINTS,
    DEFAULT_PATROL_CHECKPOINTS
  );
  const updatedItem: PatrolCheckpoint = {
    ...checkpoint,
    name: cleanName,
    nfc_tag_id: cleanNfc,
    lat: cleanLat,
    lng: cleanLng,
  };
  const exists = current.some(
    (c) => c.id === checkpoint.id || c.order_index === checkpoint.order_index
  );
  const nextList = exists
    ? current.map((c) =>
        c.id === checkpoint.id || c.order_index === checkpoint.order_index ? updatedItem : c
      )
    : [...current, updatedItem];

  writeLocalJson(
    LOCAL_KEYS.CHECKPOINTS,
    nextList.sort((a, b) => a.order_index - b.order_index)
  );
  return { data: updatedItem };
}

/**
 * Subscribe Supabase Realtime (postgres_changes pada patrol_sessions, patrol_scans, patrol_checkpoints)
 * dengan cleanup wajib `supabase.removeChannel(channel)`.
 */
export function subscribeLivePatrolRealtime(
  session: SessionUser | null | undefined,
  onChange: () => void
): () => void {
  let debounceTimer: number | null = null;
  const trigger = () => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      onChange();
    }, 300);
  };

  const handleLocalEvent = () => trigger();
  const handleStorage = (e: StorageEvent) => {
    if (
      e.key === LOCAL_KEYS.CHECKPOINTS ||
      e.key === LOCAL_KEYS.SESSIONS ||
      e.key === LOCAL_KEYS.SCANS
    ) {
      trigger();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(LOCAL_SYNC_EVENT, handleLocalEvent);
    window.addEventListener('storage', handleStorage);
  }

  const supabase = getSupabaseClient(session || null);
  let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

  if (supabase && isSupabaseConfigured()) {
    const channelName = `live-patrol-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'patrol_sessions' },
        () => trigger()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'patrol_scans' },
        () => trigger()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'patrol_checkpoints' },
        () => trigger()
      )
      .subscribe();
  }

  return () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener(LOCAL_SYNC_EVENT, handleLocalEvent);
      window.removeEventListener('storage', handleStorage);
    }
    if (supabase && channel) {
      void supabase.removeChannel(channel);
    }
  };
}
