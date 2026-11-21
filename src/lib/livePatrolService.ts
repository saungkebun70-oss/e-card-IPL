import type {
  PatrolGpsCalibration,
  PatrolLiveSession,
  SessionUser,
  TrailPoint,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { clampMapPercent } from './patrolGpsUtils';

const LOCAL_KEYS = {
  CALIBRATION: 'skb_patrol_gps_calibration_v1',
  SESSIONS: 'skb_patrol_live_sessions_v1',
};

const LIVE_PATROL_EVENT = 'skb-live-patrol-3d-changed';
const MAX_TRAIL_POINTS = 180;

export interface LivePatrolResult<T = unknown> {
  ok: boolean;
  message: string;
  data?: T;
  usedFallback?: boolean;
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

function writeLocalJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Abaikan jika penyimpanan lokal dibatasi browser
  }
}

function emitLivePatrolEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(LIVE_PATROL_EVENT));
  } catch {
    // Abaikan
  }
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `live-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeTrailPoints(raw: unknown): TrailPoint[] {
  if (!Array.isArray(raw)) return [];
  const points: TrailPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const x = Number(obj.x);
    const y = Number(obj.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      points.push({
        x: clampMapPercent(x, 1, 99),
        y: clampMapPercent(y, 1, 99),
        time: typeof obj.time === 'string' ? obj.time : undefined,
      });
    }
  }
  return points.slice(-MAX_TRAIL_POINTS);
}

function normalizeCalibrationRow(row: Record<string, unknown>): PatrolGpsCalibration | null {
  const posId = String(row.pos_id ?? '').trim();
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!posId || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    pos_id: posId,
    lat,
    lng,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
  };
}

function normalizeLiveSessionRow(row: Record<string, unknown>): PatrolLiveSession {
  const status: 'active' | 'completed' =
    row.status === 'active' ? 'active' : 'completed';
  const currentX = Number(row.current_x);
  const currentY = Number(row.current_y);
  const currentLat = row.current_lat != null ? Number(row.current_lat) : null;
  const currentLng = row.current_lng != null ? Number(row.current_lng) : null;
  const accuracy = row.accuracy != null ? Number(row.accuracy) : null;
  const startedAt = String(row.started_at ?? new Date().toISOString());
  const lastPingAt = String(row.last_ping_at ?? startedAt);

  return {
    id: String(row.id ?? createId()),
    officer_id: String(row.officer_id ?? ''),
    officer_name: String(row.officer_name ?? 'Petugas Keamanan'),
    status,
    current_x: Number.isFinite(currentX) ? clampMapPercent(currentX, 1, 99) : 12.5,
    current_y: Number.isFinite(currentY) ? clampMapPercent(currentY, 1, 99) : 76.0,
    current_lat: currentLat !== null && Number.isFinite(currentLat) ? currentLat : null,
    current_lng: currentLng !== null && Number.isFinite(currentLng) ? currentLng : null,
    accuracy: accuracy !== null && Number.isFinite(accuracy) ? accuracy : null,
    trail_points: normalizeTrailPoints(row.trail_points),
    started_at: startedAt,
    ended_at: row.ended_at ? String(row.ended_at) : null,
    last_ping_at: lastPingAt,
  };
}

/**
 * Feedback audio lembut (Web Audio API) + getar ringan saat scan NFC atau kunci GPS berhasil.
 */
export function playScanSuccessFeedback(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(180);
    }
  } catch {
    // Browser tidak mendukung vibration API
  }

  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, duration: number, gainPeak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    };

    playTone(880, now, 0.12, 0.14);
    playTone(1318.5, now + 0.11, 0.18, 0.16);

    window.setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        // Abaikan
      }
    }, 500);
  } catch {
    // Web Audio tidak tersedia
  }
}

/**
 * Membaca seluruh kalibrasi GPS per Pos (patrol_gps_calibration) dengan fallback localStorage.
 */
export async function fetchGpsCalibrations(
  session?: SessionUser | null
): Promise<Record<string, PatrolGpsCalibration>> {
  const localMap = readLocalJson<Record<string, PatrolGpsCalibration>>(
    LOCAL_KEYS.CALIBRATION,
    {}
  );

  if (!isSupabaseConfigured()) {
    return localMap;
  }

  try {
    const supabase = getSupabaseClient(session || null);
    if (!supabase) return localMap;
    const { data, error } = await supabase
      .from('patrol_gps_calibration')
      .select('pos_id, lat, lng, updated_at, updated_by');

    if (error || !Array.isArray(data)) {
      return localMap;
    }

    const mapped: Record<string, PatrolGpsCalibration> = {};
    for (const row of data) {
      const normalized = normalizeCalibrationRow(row as Record<string, unknown>);
      if (normalized) {
        mapped[normalized.pos_id] = normalized;
      }
    }

    writeLocalJson(LOCAL_KEYS.CALIBRATION, mapped);
    return mapped;
  } catch {
    return localMap;
  }
}

/**
 * Menyimpan atau memperbarui koordinat GPS asli (lat, lng) untuk satu Pos di Peta 3D.
 */
export async function saveGpsCalibration(
  session: SessionUser | null,
  payload: { pos_id: string; lat: number; lng: number }
): Promise<LivePatrolResult<PatrolGpsCalibration>> {
  const nowIso = new Date().toISOString();
  const record: PatrolGpsCalibration = {
    pos_id: payload.pos_id,
    lat: Number(payload.lat.toFixed(7)),
    lng: Number(payload.lng.toFixed(7)),
    updated_at: nowIso,
    updated_by: session?.nama_warga || 'Admin',
  };

  // Simpan juga ke cache lokal agar langsung responsif
  const localMap = readLocalJson<Record<string, PatrolGpsCalibration>>(
    LOCAL_KEYS.CALIBRATION,
    {}
  );
  localMap[record.pos_id] = record;
  writeLocalJson(LOCAL_KEYS.CALIBRATION, localMap);

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session || null);
      if (supabase) {
        const { data, error } = await supabase
          .from('patrol_gps_calibration')
          .upsert(record, { onConflict: 'pos_id' })
          .select('pos_id, lat, lng, updated_at, updated_by')
          .maybeSingle();

        if (!error && data) {
          const saved = normalizeCalibrationRow(data as Record<string, unknown>) || record;
          localMap[saved.pos_id] = saved;
          writeLocalJson(LOCAL_KEYS.CALIBRATION, localMap);
          emitLivePatrolEvent();
          return {
            ok: true,
            message: 'Koordinat GPS asli berhasil dikunci ke Supabase.',
            data: saved,
          };
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  emitLivePatrolEvent();
  return {
    ok: true,
    message:
      'Koordinat GPS asli tersimpan di perangkat (jalankan SQL migrasi v4 agar tersinkron ke Supabase).',
    data: record,
    usedFallback: true,
  };
}

/**
 * Mengambil sesi Live Tracking Patroli terbaru yang sedang aktif (status = 'active').
 */
export async function fetchActiveLiveSession(
  session?: SessionUser | null
): Promise<PatrolLiveSession | null> {
  const localSessions = readLocalJson<PatrolLiveSession[]>(LOCAL_KEYS.SESSIONS, []);
  const localActive =
    localSessions
      .filter((s) => s.status === 'active')
      .sort((a, b) => new Date(b.last_ping_at).getTime() - new Date(a.last_ping_at).getTime())[0] ||
    null;

  if (!isSupabaseConfigured()) {
    return localActive;
  }

  try {
    const supabase = getSupabaseClient(session || null);
    if (!supabase) return localActive;
    const { data, error } = await supabase
      .from('patrol_live_sessions')
      .select(
        'id, officer_id, officer_name, status, current_x, current_y, current_lat, current_lng, accuracy, trail_points, started_at, ended_at, last_ping_at'
      )
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1);

    if (error) {
      return localActive;
    }

    if (Array.isArray(data) && data.length > 0) {
      const normalized = normalizeLiveSessionRow(data[0] as Record<string, unknown>);
      // Sinkronkan cache lokal
      const merged = [
        normalized,
        ...localSessions.filter((s) => s.id !== normalized.id && s.status !== 'active'),
      ].slice(0, 20);
      writeLocalJson(LOCAL_KEYS.SESSIONS, merged);
      return normalized;
    }

    // Tidak ada sesi aktif di server -> pastikan cache lokal tidak menyimpan sesi aktif basi
    if (localActive) {
      const cleaned = localSessions.map((s) =>
        s.status === 'active'
          ? { ...s, status: 'completed' as const, ended_at: s.ended_at || new Date().toISOString() }
          : s
      );
      writeLocalJson(LOCAL_KEYS.SESSIONS, cleaned);
    }
    return null;
  } catch {
    return localActive;
  }
}

/**
 * Memulai sesi Patroli Live baru (menutup sesi aktif lama jika ada agar selalu bersih).
 */
export async function startLivePatrolSession(
  session: SessionUser,
  initial: {
    current_x: number;
    current_y: number;
    current_lat?: number | null;
    current_lng?: number | null;
    accuracy?: number | null;
  }
): Promise<LivePatrolResult<PatrolLiveSession>> {
  const nowIso = new Date().toISOString();
  const officerId = session.petugas_id || session.blok_rumah || 'petugas';
  const officerName = session.nama_warga || 'Petugas Keamanan';
  const startX = clampMapPercent(initial.current_x, 3, 97);
  const startY = clampMapPercent(initial.current_y, 3, 97);
  const initialTrail: TrailPoint[] = [{ x: startX, y: startY, time: nowIso }];

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        // Tandai sesi lama milik petugas ini sebagai selesai jika tertinggal
        await supabase
          .from('patrol_live_sessions')
          .update({ status: 'completed', ended_at: nowIso })
          .eq('officer_id', officerId)
          .eq('status', 'active');

        const { data, error } = await supabase
          .from('patrol_live_sessions')
          .insert({
            officer_id: officerId,
            officer_name: officerName,
            status: 'active',
            current_x: startX,
            current_y: startY,
            current_lat: initial.current_lat ?? null,
            current_lng: initial.current_lng ?? null,
            accuracy: initial.accuracy ?? null,
            trail_points: initialTrail,
            started_at: nowIso,
            last_ping_at: nowIso,
          })
          .select(
            'id, officer_id, officer_name, status, current_x, current_y, current_lat, current_lng, accuracy, trail_points, started_at, ended_at, last_ping_at'
          )
          .single();

        if (!error && data) {
          const created = normalizeLiveSessionRow(data as Record<string, unknown>);
          const localSessions = readLocalJson<PatrolLiveSession[]>(LOCAL_KEYS.SESSIONS, []).map((s) =>
            s.status === 'active' ? { ...s, status: 'completed' as const, ended_at: nowIso } : s
          );
          writeLocalJson(LOCAL_KEYS.SESSIONS, [created, ...localSessions].slice(0, 20));
          emitLivePatrolEvent();
          return {
            ok: true,
            message: 'Patroli Live aktif! Lokasi Anda kini tampil real-time di Peta 3D.',
            data: created,
          };
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  const created: PatrolLiveSession = {
    id: createId(),
    officer_id: officerId,
    officer_name: officerName,
    status: 'active',
    current_x: startX,
    current_y: startY,
    current_lat: initial.current_lat ?? null,
    current_lng: initial.current_lng ?? null,
    accuracy: initial.accuracy ?? null,
    trail_points: initialTrail,
    started_at: nowIso,
    ended_at: null,
    last_ping_at: nowIso,
  };

  const localSessions = readLocalJson<PatrolLiveSession[]>(LOCAL_KEYS.SESSIONS, []).map((s) =>
    s.status === 'active' ? { ...s, status: 'completed' as const, ended_at: nowIso } : s
  );
  writeLocalJson(LOCAL_KEYS.SESSIONS, [created, ...localSessions].slice(0, 20));
  emitLivePatrolEvent();

  return {
    ok: true,
    message: 'Patroli Live dimulai (mode lokal — jalankan SQL migrasi v4 agar realtime ke semua perangkat).',
    data: created,
    usedFallback: true,
  };
}

/**
 * Memperbarui posisi (current_x, current_y) + jejak rute (trail_points) pada sesi aktif.
 */
export async function updateLivePatrolPosition(
  session: SessionUser,
  sessionId: string,
  payload: {
    current_x: number;
    current_y: number;
    current_lat?: number | null;
    current_lng?: number | null;
    accuracy?: number | null;
    trail_points: TrailPoint[];
  }
): Promise<LivePatrolResult<PatrolLiveSession>> {
  const nowIso = new Date().toISOString();
  const nextX = clampMapPercent(payload.current_x, 3, 97);
  const nextY = clampMapPercent(payload.current_y, 3, 97);
  const trimmedTrail = payload.trail_points.slice(-MAX_TRAIL_POINTS);

  // Perbarui cache lokal langsung
  const localSessions = readLocalJson<PatrolLiveSession[]>(LOCAL_KEYS.SESSIONS, []);
  let updatedLocal: PatrolLiveSession | undefined;
  const nextLocal = localSessions.map((s) => {
    if (s.id !== sessionId) return s;
    updatedLocal = {
      ...s,
      current_x: nextX,
      current_y: nextY,
      current_lat: payload.current_lat !== undefined ? payload.current_lat : s.current_lat,
      current_lng: payload.current_lng !== undefined ? payload.current_lng : s.current_lng,
      accuracy: payload.accuracy !== undefined ? payload.accuracy : s.accuracy,
      trail_points: trimmedTrail,
      last_ping_at: nowIso,
    };
    return updatedLocal;
  });
  writeLocalJson(LOCAL_KEYS.SESSIONS, nextLocal);

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const updateBody: Record<string, unknown> = {
          current_x: nextX,
          current_y: nextY,
          trail_points: trimmedTrail,
          last_ping_at: nowIso,
        };
        if (payload.current_lat !== undefined) updateBody.current_lat = payload.current_lat;
        if (payload.current_lng !== undefined) updateBody.current_lng = payload.current_lng;
        if (payload.accuracy !== undefined) updateBody.accuracy = payload.accuracy;

        const { data, error } = await supabase
          .from('patrol_live_sessions')
          .update(updateBody)
          .eq('id', sessionId)
          .select(
            'id, officer_id, officer_name, status, current_x, current_y, current_lat, current_lng, accuracy, trail_points, started_at, ended_at, last_ping_at'
          )
          .maybeSingle();

        if (!error && data) {
          const synced = normalizeLiveSessionRow(data as Record<string, unknown>);
          emitLivePatrolEvent();
          return { ok: true, message: 'Posisi live diperbarui.', data: synced };
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  emitLivePatrolEvent();
  return {
    ok: true,
    message: 'Posisi live diperbarui secara lokal.',
    data: updatedLocal,
    usedFallback: true,
  };
}

/**
 * Mengakhiri sesi Patroli Live (status = 'completed', ended_at = NOW()).
 */
export async function completeLivePatrolSession(
  session: SessionUser,
  sessionId: string
): Promise<LivePatrolResult<null>> {
  const nowIso = new Date().toISOString();

  const localSessions = readLocalJson<PatrolLiveSession[]>(LOCAL_KEYS.SESSIONS, []).map((s) =>
    s.id === sessionId || s.status === 'active'
      ? { ...s, status: 'completed' as const, ended_at: nowIso, last_ping_at: nowIso }
      : s
  );
  writeLocalJson(LOCAL_KEYS.SESSIONS, localSessions);

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const { error } = await supabase
          .from('patrol_live_sessions')
          .update({
            status: 'completed',
            ended_at: nowIso,
            last_ping_at: nowIso,
          })
          .eq('id', sessionId);

        if (!error) {
          emitLivePatrolEvent();
          return {
            ok: true,
            message: 'Sesi Patroli Live selesai. Terima kasih telah menjaga keamanan lingkungan!',
          };
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  emitLivePatrolEvent();
  return {
    ok: true,
    message: 'Sesi Patroli Live selesai.',
    usedFallback: true,
  };
}

/**
 * Berlangganan pembaruan real-time pada tabel patrol_live_sessions & patrol_gps_calibration.
 * Menjamin pembersihan supabase.removeChannel(channel) agar bebas memory leak.
 */
export function subscribeLivePatrolSessions(
  session: SessionUser | null,
  onChange: () => void
): () => void {
  const onLocalEvent = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_KEYS.SESSIONS || e.key === LOCAL_KEYS.CALIBRATION) {
      onChange();
    }
  };

  window.addEventListener(LIVE_PATROL_EVENT, onLocalEvent);
  window.addEventListener('storage', onStorage);

  if (!isSupabaseConfigured()) {
    return () => {
      window.removeEventListener(LIVE_PATROL_EVENT, onLocalEvent);
      window.removeEventListener('storage', onStorage);
    };
  }

  const supabase = getSupabaseClient(session || null);
  if (!supabase) {
    return () => {
      window.removeEventListener(LIVE_PATROL_EVENT, onLocalEvent);
      window.removeEventListener('storage', onStorage);
    };
  }
  const channelName = `live-patrol-3d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'patrol_live_sessions' },
      () => {
        onChange();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'patrol_gps_calibration' },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    window.removeEventListener(LIVE_PATROL_EVENT, onLocalEvent);
    window.removeEventListener('storage', onStorage);
    try {
      void supabase.removeChannel(channel);
    } catch {
      // Abaikan error saat channel sudah ditutup
    }
  };
}
