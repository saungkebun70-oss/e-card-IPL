import {
  SUSUNAN_PENGURUS,
  type ActivityNotification,
  type ActivityNotificationCategory,
  type SessionUser,
  type UserRole,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import {
  SIM_CHANGED_EVENT,
  isSimulationMode,
  isSimulationSessionActive,
  readSimData,
  updateSimData,
  type SimChangeKind,
} from './simulationStore';
import {
  safeCheckFirebaseMessagingSupported,
  syncNativePushTokenForSession,
} from './notificationAlertService';
import {
  buildNotificationContentSignature,
  buildNotificationDedupKey,
  createNotificationUuid,
  deduplicateNotifications,
  isValidUuid,
  normalizeNotifRecipientToken,
} from './notificationDedup';
export {
  triggerDeviceAlert,
  initNativeNotificationsOnLaunch as initializeAndroidNotificationsOnLaunch,
  safeCheckFirebaseMessagingSupported,
  safeGetFirebaseMessagingToken,
  getNativePushRuntimeInfo,
  subscribePushRuntimeInfoChange,
  pollUnreadNotificationsNow,
  registerPeriodicNotificationSync,
  syncNativePushTokenForSession,
  isLikelyHuaweiDevice,
} from './notificationAlertService';
export {
  buildNotificationContentSignature,
  buildNotificationDedupKey,
  deduplicateNotifications,
} from './notificationDedup';

/**
 * Inisialisasi & pengambilan token FCM secara aman (try-catch `isSupported()` & `getToken()`).
 * Tidak pernah menyebabkan crash pada perangkat Huawei (EMUI/HarmonyOS) tanpa Google Play Services (GMS);
 * otomatis kembali ke mode Background Sync Fallback apabila FCM gagal diperoleh.
 */
export async function safeRequestFcmTokenForSession(session: SessionUser): Promise<{
  ok: boolean;
  token: string | null;
  fallbackMode: boolean;
  error?: string;
}> {
  try {
    const supported = await safeCheckFirebaseMessagingSupported();
    if (!supported) {
      const nativeRes = await syncNativePushTokenForSession(session).catch(() => ({
        ok: false,
        synced: false,
        token: null,
        error: 'FCM tidak didukung pada perangkat non-GMS.',
      }));
      return {
        ok: nativeRes.ok,
        token: nativeRes.token,
        fallbackMode: !nativeRes.token,
        error: nativeRes.error,
      };
    }

    const res = await syncNativePushTokenForSession(session);
    return {
      ok: res.ok,
      token: res.token,
      fallbackMode: !res.token,
      error: res.error,
    };
  } catch (err) {
    return {
      ok: false,
      token: null,
      fallbackMode: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const LOCAL_NOTIF_KEY = 'ecard_activity_notifications_v1';
const LOCAL_BROADCAST_READ_PREFIX = 'ecard_broadcast_read_v1:';
const LOCAL_DISMISSED_NOTIF_PREFIX = 'ecard_notif_dismissed_v1:';
const NOTIF_EVENT = 'ecard-activity-notifications-changed';
const MAX_LOCAL_NOTIFICATIONS = 250;
const DISPATCH_IDEMPOTENCY_TTL_MS = 20_000;

let dedupKeyColumnMissing = false;
const recentDispatchTimestamps = new Map<string, number>();

// Penyimpanan module-level ID & signature notifikasi yang sudah pernah dilihat per sesi akun
// agar tidak berbunyi ulang saat komponen NotificationBell remount antar halaman/tab.
const sessionSeenNotificationIdsMap = new Map<string, Set<string>>();
const sessionSeenNotificationSigsMap = new Map<string, Map<string, number>>();

export function getSessionSeenNotificationIds(session: SessionUser): Set<string> {
  const key = getCanonicalUserId(session);
  let set = sessionSeenNotificationIdsMap.get(key);
  if (!set) {
    set = new Set<string>();
    sessionSeenNotificationIdsMap.set(key, set);
  }
  return set;
}

export function getSessionSeenNotificationSignatures(session: SessionUser): Map<string, number> {
  const key = getCanonicalUserId(session);
  let map = sessionSeenNotificationSigsMap.get(key);
  if (!map) {
    map = new Map<string, number>();
    sessionSeenNotificationSigsMap.set(key, map);
  }
  return map;
}

export interface CreateActivityNotificationInput {
  user_id: string;
  category: ActivityNotificationCategory;
  title: string;
  message: string;
  target_url: string;
  dedup_key?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_avatar_url?: string | null;
}

export interface DirectPushDispatchInput {
  id?: string;
  dedup_key?: string | null;
  title: string;
  body: string;
  target_user_ids?: string[];
  target_roles?: Array<'admin' | 'warga' | 'keamanan' | 'petugas'>;
  broadcast?: boolean;
  include_self?: boolean;
  target_url?: string;
  category?: ActivityNotificationCategory;
  actor_id?: string | null;
  data?: Record<string, string>;
}

function normalizeIdToken(raw?: string | null): string {
  return normalizeNotifRecipientToken(raw);
}

function isMissingColumnError(err: unknown, columnName: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; details?: string; hint?: string };
  const code = String(e.code || '').toUpperCase();
  const text = `${e.message || ''} ${e.details || ''} ${e.hint || ''}`.toLowerCase();
  return (
    (code === '42703' || code === 'PGRST204' || text.includes('column')) &&
    text.includes(columnName.toLowerCase())
  );
}

function isUniqueViolationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  return (
    String(e.code || '') === '23505' ||
    String(e.message || '').toLowerCase().includes('duplicate key')
  );
}

function pruneAndCheckRecentDispatch(key: string, ttlMs = DISPATCH_IDEMPOTENCY_TTL_MS): boolean {
  const now = Date.now();
  if (recentDispatchTimestamps.size > 400) {
    for (const [k, ts] of recentDispatchTimestamps.entries()) {
      if (now - ts > ttlMs) recentDispatchTimestamps.delete(k);
    }
  }
  const prev = recentDispatchTimestamps.get(key);
  if (prev && now - prev < ttlMs) {
    return true;
  }
  recentDispatchTimestamps.set(key, now);
  return false;
}

export function buildWargaUserId(blokRumah: string): string {
  return `warga:${normalizeIdToken(blokRumah)}`;
}

export function buildAdminUserId(username: string): string {
  const clean = normalizeIdToken(username);
  return `admin:${clean === 'admin' ? 'andriansyah' : clean}`;
}

export function buildPetugasUserId(petugasIdOrUsername: string): string {
  return `petugas:${normalizeIdToken(petugasIdOrUsername)}`;
}

export function buildKeamananUserId(petugasIdOrUsername: string): string {
  return `keamanan:${normalizeIdToken(petugasIdOrUsername)}`;
}

export function getCanonicalUserId(session?: SessionUser | null): string {
  if (!session) return 'anon';
  if (session.role === 'warga') {
    return buildWargaUserId(session.blok_rumah);
  }
  if (session.role === 'admin') {
    return buildAdminUserId(session.blok_rumah);
  }
  return buildPetugasUserId(session.petugas_id || session.blok_rumah);
}

/**
 * Mengembalikan daftar seluruh user_id yang sah dibaca oleh sesi aktif.
 * Menjamin isolasi ketat: Warga hanya membaca notifikasi unitnya sendiri + broadcast publik/warga.
 */
export function getUserNotificationMatchIds(session?: SessionUser | null): string[] {
  if (!session) return [];
  const ids = new Set<string>(['broadcast:all']);
  const primary = getCanonicalUserId(session);
  ids.add(primary);

  if (session.role === 'warga') {
    ids.add('broadcast:warga');
    ids.add('role:warga');
    const cleanBlok = normalizeIdToken(session.blok_rumah);
    if (cleanBlok) {
      ids.add(`warga:${cleanBlok}`);
      // Kompatibilitas format B3/7 vs B03/07
      const parts = cleanBlok.split('/');
      if (parts.length === 2) {
        const prefixMatch = parts[0].match(/^([a-z]+)0*(\d+)$/i);
        const numMatch = parts[1].match(/^0*(\d+)$/);
        if (prefixMatch && numMatch) {
          const prefix = prefixMatch[1].toLowerCase();
          const bNum = Number(prefixMatch[2]);
          const hNum = Number(numMatch[1]);
          ids.add(`warga:${prefix}${bNum}/${hNum}`);
          ids.add(
            `warga:${prefix}${String(bNum).padStart(2, '0')}/${String(hNum).padStart(2, '0')}`
          );
        }
      }
    }
  } else if (session.role === 'admin') {
    ids.add('broadcast:admin');
    const rawBlok = normalizeIdToken(session.blok_rumah);
    if (rawBlok) ids.add(`admin:${rawBlok}`);
    if (session.jabatan === 'Bendahara' || session.admin_permission === 'full' || rawBlok === 'admin') {
      ids.add('admin:andriansyah');
      ids.add('admin:admin');
      ids.add('role:bendahara');
      ids.add('role:admin');
    }
    if (session.jabatan === 'Ketua' || rawBlok === 'erlangga') {
      ids.add('admin:erlangga');
      ids.add('role:ketua');
      ids.add('role:admin');
    }
    ids.add('role:admin');
  } else if (session.role === 'petugas') {
    ids.add('broadcast:petugas');
    ids.add('broadcast:keamanan');
    ids.add('role:petugas');
    ids.add('role:keamanan');
    if (session.petugas_id) {
      const cleanPid = normalizeIdToken(session.petugas_id);
      ids.add(`petugas:${cleanPid}`);
      ids.add(`keamanan:${cleanPid}`);
    }
    if (session.blok_rumah) {
      const cleanBlok = normalizeIdToken(session.blok_rumah);
      ids.add(`petugas:${cleanBlok}`);
      ids.add(`keamanan:${cleanBlok}`);
    }
    if (session.nama_warga) {
      const cleanNama = normalizeIdToken(session.nama_warga);
      ids.add(`petugas:${cleanNama}`);
      ids.add(`keamanan:${cleanNama}`);
    }
  }

  return Array.from(ids);
}

/**
 * Menghasilkan daftar variasi user_id (termasuk huruf kapital pada blok seperti warga:B3/7 & warga:B03/07)
 * untuk query Supabase `.in('user_id', ...)` agar tahan perbedaan kapitalisasi data.
 */
function getQueryMatchUserIds(session?: SessionUser | null): string[] {
  const baseIds = getUserNotificationMatchIds(session);
  const expanded = new Set<string>(baseIds);

  for (const id of baseIds) {
    if (id.startsWith('warga:')) {
      const suffix = id.slice('warga:'.length);
      expanded.add(`warga:${suffix.toUpperCase()}`);
    }
  }

  return Array.from(expanded);
}

/**
 * Memastikan suatu baris notifikasi benar-benar ditujukan untuk akun/role yang sedang login.
 * Mendukung pencocokan format blok padded/unpadded (B3/7 <-> B03/07) serta seluruh alias Bendahara/Ketua/Admin.
 */
export function isNotificationMatchingSession(
  notif: ActivityNotification,
  session: SessionUser,
  options?: { excludeSelfActor?: boolean }
): boolean {
  if (!notif || !session) return false;
  const allowedIds = new Set(getUserNotificationMatchIds(session).map((id) => normalizeIdToken(id)));
  const recipient = normalizeIdToken(notif.user_id);
  if (!recipient || !allowedIds.has(recipient)) {
    return false;
  }

  if (options?.excludeSelfActor !== false) {
    const actor = normalizeIdToken(notif.actor_id);
    if (actor) {
      const selfPersonalIds = new Set(
        getUserNotificationMatchIds(session)
          .map((id) => normalizeIdToken(id))
          .filter((id) => !id.startsWith('broadcast:') && !id.startsWith('role:'))
      );
      selfPersonalIds.add(normalizeIdToken(getCanonicalUserId(session)));
      if (selfPersonalIds.has(actor)) {
        return false;
      }
    }
  }

  return true;
}

export function getAllAdminUserIds(): string[] {
  return Array.from(new Set(SUSUNAN_PENGURUS.map((p) => buildAdminUserId(p.username))));
}

export function getBendaharaAndKetuaUserIds(): string[] {
  const bendaharaIds = SUSUNAN_PENGURUS.filter((p) => p.jabatan === 'Bendahara').map((p) =>
    buildAdminUserId(p.username)
  );
  const ketuaIds = SUSUNAN_PENGURUS.filter((p) => p.jabatan === 'Ketua').map((p) =>
    buildAdminUserId(p.username)
  );
  return Array.from(new Set([...bendaharaIds, ...ketuaIds]));
}

export function getKetuaUserIds(): string[] {
  return Array.from(
    new Set(
      SUSUNAN_PENGURUS.filter((p) => p.jabatan === 'Ketua').map((p) => buildAdminUserId(p.username))
    )
  );
}

export function getBendaharaUserIds(): string[] {
  return Array.from(
    new Set(
      SUSUNAN_PENGURUS.filter((p) => p.jabatan === 'Bendahara').map((p) =>
        buildAdminUserId(p.username)
      )
    )
  );
}

function readLocalNotifications(): ActivityNotification[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(LOCAL_NOTIF_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActivityNotification[]) : [];
  } catch {
    return [];
  }
}

function writeLocalNotifications(list: ActivityNotification[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      LOCAL_NOTIF_KEY,
      JSON.stringify(list.slice(0, MAX_LOCAL_NOTIFICATIONS))
    );
  } catch {
    // Abaikan keterbatasan storage
  }
}

function getBroadcastReadSet(session: SessionUser): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const key = `${LOCAL_BROADCAST_READ_PREFIX}${getCanonicalUserId(session)}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function addBroadcastReadIds(session: SessionUser, ids: string[]): void {
  try {
    if (typeof window === 'undefined' || ids.length === 0) return;
    const key = `${LOCAL_BROADCAST_READ_PREFIX}${getCanonicalUserId(session)}`;
    const existing = getBroadcastReadSet(session);
    ids.forEach((id) => existing.add(id));
    window.localStorage.setItem(key, JSON.stringify(Array.from(existing).slice(-400)));
  } catch {
    // Abaikan
  }
}

function getDismissedNotificationSet(session: SessionUser): Set<string> {
  try {
    if (typeof window === 'undefined') return new Set();
    const key = `${LOCAL_DISMISSED_NOTIF_PREFIX}${getCanonicalUserId(session)}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function addDismissedNotificationIds(session: SessionUser, ids: string[]): void {
  try {
    if (typeof window === 'undefined' || ids.length === 0) return;
    const key = `${LOCAL_DISMISSED_NOTIF_PREFIX}${getCanonicalUserId(session)}`;
    const existing = getDismissedNotificationSet(session);
    ids.forEach((id) => existing.add(id));
    window.localStorage.setItem(key, JSON.stringify(Array.from(existing).slice(-600)));
  } catch {
    // Abaikan
  }
}

function emitNotificationsChanged(inserted?: ActivityNotification[]): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(NOTIF_EVENT, {
          detail: inserted && inserted.length > 0 ? { inserted } : undefined,
        })
      );
    }
  } catch {
    // Abaikan
  }
}

function normalizeNotificationRow(
  row: Record<string, unknown>,
  broadcastReadSet: Set<string>
): ActivityNotification {
  const id = String(row.id || createNotificationUuid());
  const userId = String(row.user_id || '');
  const isBroadcast = userId.toLowerCase().startsWith('broadcast:');
  const rawCategory = String(row.category || 'system').toLowerCase();
  const validCategories: ActivityNotificationCategory[] = [
    'ipl',
    'finance',
    'patrol',
    'announcement',
    'system',
  ];
  const category: ActivityNotificationCategory = validCategories.includes(
    rawCategory as ActivityNotificationCategory
  )
    ? (rawCategory as ActivityNotificationCategory)
    : 'system';

  return {
    id,
    user_id: userId,
    actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
    actor_name: typeof row.actor_name === 'string' ? row.actor_name : null,
    actor_avatar_url: typeof row.actor_avatar_url === 'string' ? row.actor_avatar_url : null,
    category,
    title: String(row.title || 'Aktivitas Baru'),
    message: String(row.message || ''),
    is_read: isBroadcast ? broadcastReadSet.has(id) : Boolean(row.is_read),
    target_url: String(row.target_url || ''),
    dedup_key: typeof row.dedup_key === 'string' ? row.dedup_key : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  };
}

/**
 * Mengambil seluruh notifikasi milik sesi aktif (terisolasi ketat per role/unit)
 * dan menerapkan deduplikasi terpusat agar 1 event tidak pernah tampil ganda.
 */
export async function fetchActivityNotifications(
  session: SessionUser
): Promise<ActivityNotification[]> {
  if (isSimulationMode(session)) {
    const allowedIds = new Set(getUserNotificationMatchIds(session));
    const simItems = readSimData().activityNotifications.filter((n) =>
      allowedIds.has(normalizeIdToken(n.user_id))
    );
    return deduplicateNotifications(simItems).slice(0, 80);
  }

  const allowedIds = new Set(getUserNotificationMatchIds(session));
  const broadcastReadSet = getBroadcastReadSet(session);
  const dismissedSet = getDismissedNotificationSet(session);
  const localFiltered = readLocalNotifications()
    .filter((n) => allowedIds.has(normalizeIdToken(n.user_id)) && !dismissedSet.has(n.id))
    .map((n) => ({
      ...n,
      is_read: n.user_id.toLowerCase().startsWith('broadcast:')
        ? broadcastReadSet.has(n.id)
        : Boolean(n.is_read),
    }));

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return deduplicateNotifications(localFiltered).slice(0, 80);
  }

  try {
    const matchArray = getQueryMatchUserIds(session);
    let data: Record<string, unknown>[] | null = null;
    let error: unknown = null;

    if (!dedupKeyColumnMissing) {
      const res = await supabase
        .from('notifications')
        .select(
          'id, user_id, actor_id, actor_name, actor_avatar_url, category, title, message, is_read, target_url, dedup_key, created_at'
        )
        .in('user_id', matchArray)
        .order('created_at', { ascending: false })
        .limit(100);
      data = (res.data as Record<string, unknown>[] | null) ?? null;
      error = res.error;
    }

    if (dedupKeyColumnMissing || (error && isMissingColumnError(error, 'dedup_key'))) {
      dedupKeyColumnMissing = true;
      const retry = await supabase
        .from('notifications')
        .select(
          'id, user_id, actor_id, actor_name, actor_avatar_url, category, title, message, is_read, target_url, created_at'
        )
        .in('user_id', matchArray)
        .order('created_at', { ascending: false })
        .limit(100);
      data = (retry.data as Record<string, unknown>[] | null) ?? null;
      error = retry.error;
    }

    if (error || !Array.isArray(data)) {
      return deduplicateNotifications(localFiltered).slice(0, 80);
    }

    const remoteRows = data
      .map((row) => normalizeNotificationRow(row as Record<string, unknown>, broadcastReadSet))
      .filter((n) => allowedIds.has(normalizeIdToken(n.user_id)) && !dismissedSet.has(n.id));

    const remoteIds = new Set(remoteRows.map((r) => r.id));
    const merged = [
      ...remoteRows,
      ...localFiltered.filter((l) => !remoteIds.has(l.id)),
    ];

    return deduplicateNotifications(merged).slice(0, 80);
  } catch {
    return deduplicateNotifications(localFiltered).slice(0, 80);
  }
}

/**
 * Mengambil jumlah notifikasi yang belum dibaca (`is_read = false`) langsung dari tabel `notifications`
 * dengan deduplikasi yang identik dengan daftar notifikasi agar badge selalu sinkron 1:1.
 */
export async function fetchUnreadNotificationCount(session: SessionUser): Promise<number> {
  if (isSimulationMode(session)) {
    const allowedIds = new Set(getUserNotificationMatchIds(session));
    const simUnread = readSimData().activityNotifications.filter(
      (n) => allowedIds.has(normalizeIdToken(n.user_id)) && !n.is_read
    );
    return deduplicateNotifications(simUnread).length;
  }

  const allowedIds = new Set(getUserNotificationMatchIds(session));
  const broadcastReadSet = getBroadcastReadSet(session);
  const dismissedSet = getDismissedNotificationSet(session);

  const localUnread = readLocalNotifications()
    .filter((n) => allowedIds.has(normalizeIdToken(n.user_id)) && !dismissedSet.has(n.id))
    .map((n) => ({
      ...n,
      is_read: n.user_id.toLowerCase().startsWith('broadcast:')
        ? broadcastReadSet.has(n.id)
        : Boolean(n.is_read),
    }))
    .filter((n) => !n.is_read);

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return deduplicateNotifications(localUnread).length;
  }

  try {
    const matchArray = getQueryMatchUserIds(session);
    let data: Record<string, unknown>[] | null = null;
    let error: unknown = null;

    if (!dedupKeyColumnMissing) {
      const res = await supabase
        .from('notifications')
        .select('id, user_id, category, title, message, is_read, dedup_key, created_at')
        .in('user_id', matchArray)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(120);
      data = (res.data as Record<string, unknown>[] | null) ?? null;
      error = res.error;
    }

    if (dedupKeyColumnMissing || (error && isMissingColumnError(error, 'dedup_key'))) {
      dedupKeyColumnMissing = true;
      const retry = await supabase
        .from('notifications')
        .select('id, user_id, category, title, message, is_read, created_at')
        .in('user_id', matchArray)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(120);
      data = (retry.data as Record<string, unknown>[] | null) ?? null;
      error = retry.error;
    }

    if (error || !Array.isArray(data)) {
      return deduplicateNotifications(localUnread).length;
    }

    const remoteUnread: ActivityNotification[] = [];
    for (const raw of data) {
      const normalized = normalizeNotificationRow(raw as Record<string, unknown>, broadcastReadSet);
      if (!normalized.id || dismissedSet.has(normalized.id)) continue;
      if (!allowedIds.has(normalizeIdToken(normalized.user_id))) continue;
      if (normalized.is_read) continue;
      remoteUnread.push(normalized);
    }

    const remoteIds = new Set(remoteUnread.map((r) => r.id));
    const mergedUnread = [
      ...remoteUnread,
      ...localUnread.filter((l) => !remoteIds.has(l.id)),
    ];

    return deduplicateNotifications(mergedUnread).filter((n) => !n.is_read).length;
  } catch {
    return deduplicateNotifications(localUnread).length;
  }
}

/**
 * Memanggil Supabase Edge Function `send-push-notification` secara langsung dan non-blocking
 * dengan proteksi idempotency `dedup_key` agar tidak memicu push ganda.
 */
export async function sendDirectPushNotification(
  actorSession: SessionUser | null | undefined,
  payload: DirectPushDispatchInput | DirectPushDispatchInput[]
): Promise<void> {
  const supabase = getSupabaseClient(actorSession || null);
  if (!supabase || !isSupabaseConfigured()) return;

  const actorId = actorSession ? getCanonicalUserId(actorSession) : 'system';
  const items = Array.isArray(payload) ? payload : [payload];
  const validItems = items
    .filter((item) => Boolean(item && (item.title || item.body)))
    .map((item) => {
      const dedupKey = buildNotificationDedupKey({
        dedupKey: item.dedup_key,
        category: item.category || 'system',
        title: item.title,
        message: item.body,
        targetUrl: item.target_url,
      });
      return {
        id: item.id && isValidUuid(item.id) ? item.id : createNotificationUuid(),
        dedup_key: dedupKey,
        title: item.title.trim(),
        body: item.body.trim(),
        message: item.body.trim(),
        target_user_ids: item.target_user_ids,
        target_roles: item.target_roles,
        broadcast: item.broadcast,
        include_self: item.include_self,
        target_url: item.target_url || '',
        category: item.category || 'system',
        actor_id: item.actor_id ?? actorId,
        data: {
          ...(item.data || {}),
          dedup_key: dedupKey,
        },
      };
    })
    .filter((item) => !pruneAndCheckRecentDispatch(`push::${item.dedup_key}`));

  if (validItems.length === 0) return;

  try {
    await supabase.functions.invoke('send-push-notification', {
      body: validItems.length === 1 ? validItems[0] : { notifications: validItems },
    });
  } catch {
    // Jangan blokir alur utama bila Edge Function belum di-deploy atau offline
  }
}

/**
 * Mengirim 1 atau banyak notifikasi aktivitas sekaligus secara real-time ke Supabase + cache lokal,
 * dengan idempotency `dedup_key`, kesamaan UUID antara client dan DB, dan deduplikasi batch.
 */
export async function dispatchActivityNotifications(
  actorSession: SessionUser | null | undefined,
  inputs: CreateActivityNotificationInput[],
  pushOverride?: DirectPushDispatchInput | DirectPushDispatchInput[]
): Promise<void> {
  if (!inputs || inputs.length === 0) {
    if (pushOverride) {
      void sendDirectPushNotification(actorSession, pushOverride);
    }
    return;
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const actorId = actorSession ? getCanonicalUserId(actorSession) : 'system';
  const actorName = actorSession?.nama_warga || 'Sistem';
  const actorAvatar = actorSession?.avatar_url || null;

  // Deduplikasi batch sekaligus guard idempotency jangka pendek per (penerima + dedup_key)
  const seenInBatch = new Set<string>();
  const rows: ActivityNotification[] = [];

  for (const item of inputs) {
    const cleanRecipient = normalizeIdToken(item.user_id);
    if (!cleanRecipient) continue;

    const cleanTitle = item.title.trim();
    const cleanMessage = item.message.trim();
    const dedupKey = buildNotificationDedupKey({
      dedupKey: item.dedup_key,
      category: item.category,
      title: cleanTitle,
      message: cleanMessage,
      targetUrl: item.target_url,
      timestampMs: nowMs,
    });

    const batchKey = `${cleanRecipient}::${dedupKey}`;
    if (seenInBatch.has(batchKey)) continue;
    seenInBatch.add(batchKey);

    // Cegah pemanggilan ganda beruntun (double-click / fallback retry) untuk event & penerima sama
    if (pruneAndCheckRecentDispatch(batchKey)) {
      continue;
    }

    rows.push({
      id: createNotificationUuid(),
      user_id: cleanRecipient,
      actor_id: item.actor_id ?? actorId,
      actor_name: item.actor_name ?? actorName,
      actor_avatar_url: item.actor_avatar_url ?? actorAvatar,
      category: item.category,
      title: cleanTitle,
      message: cleanMessage,
      is_read: false,
      target_url: item.target_url || '',
      dedup_key: dedupKey,
      created_at: nowIso,
    });
  }

  if (rows.length === 0) {
    return;
  }

  if (isSimulationMode(actorSession)) {
    updateSimData((curr) => ({
      ...curr,
      activityNotifications: deduplicateNotifications([...rows, ...curr.activityNotifications]),
    }));
    emitNotificationsChanged(rows);
    return;
  }

  // Langkah (a): Simpan baris ke tabel `notifications` Supabase dengan menyertakan `id` UUID klien
  // agar event lokal & Postgres Realtime `INSERT` memiliki ID identik 100% (TANPA .select() karena RLS).
  let savedToRemote = false;
  let rejectedAsDuplicate = false;
  const supabase = getSupabaseClient(actorSession || null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const buildPayload = (includeDedupKey: boolean) =>
        rows.map((r) => ({
          id: r.id,
          user_id: r.user_id,
          actor_id: r.actor_id,
          actor_name: r.actor_name,
          actor_avatar_url: r.actor_avatar_url,
          category: r.category,
          title: r.title,
          message: r.message,
          is_read: false,
          target_url: r.target_url,
          created_at: r.created_at,
          ...(includeDedupKey && r.dedup_key ? { dedup_key: r.dedup_key } : {}),
        }));

      let { error } = await supabase
        .from('notifications')
        .insert(buildPayload(!dedupKeyColumnMissing));

      if (error && !dedupKeyColumnMissing && isMissingColumnError(error, 'dedup_key')) {
        dedupKeyColumnMissing = true;
        const retry = await supabase.from('notifications').insert(buildPayload(false));
        error = retry.error;
      }

      if (!error) {
        savedToRemote = true;
      } else if (isUniqueViolationError(error)) {
        // DB unique index (user_id, dedup_key) mendeteksi duplikat: hentikan agar push tidak terkirim dua kali
        savedToRemote = true;
        rejectedAsDuplicate = true;
      }
    } catch {
      // Lanjut fallback lokal
    }

    if (rejectedAsDuplicate) {
      return;
    }

    // Langkah (b): Panggil Edge Function `send-push-notification` secara non-blocking
    // dengan menyertakan `dedup_key` yang identik pada override maupun baris notifikasi.
    if (pushOverride) {
      const baseDedup = rows[0]?.dedup_key || undefined;
      const normalizedOverride = (Array.isArray(pushOverride) ? pushOverride : [pushOverride]).map(
        (p) => ({
          ...p,
          dedup_key: p.dedup_key || baseDedup,
        })
      );
      void sendDirectPushNotification(actorSession, normalizedOverride);
    } else {
      void supabase.functions
        .invoke('send-push-notification', {
          body: { notifications: rows },
        })
        .catch(() => {
          // Jangan blokir transaksi utama bila Edge Function belum di-deploy atau offline
        });
    }
  }

  // Jika mode lokal atau tabel notifications belum dimigrasi di Supabase, simpan di cache lokal
  if (!savedToRemote) {
    const existing = readLocalNotifications();
    writeLocalNotifications(deduplicateNotifications([...rows, ...existing]));
  }

  emitNotificationsChanged(rows);
}

/**
 * Menandai 1 notifikasi sebagai sudah dibaca (termasuk salinan alias / dedup_key yang tergabung).
 */
export async function markActivityNotificationRead(
  session: SessionUser,
  notif: ActivityNotification
): Promise<void> {
  if (!notif || notif.is_read) return;

  if (isSimulationMode(session)) {
    updateSimData((curr) => ({
      ...curr,
      activityNotifications: curr.activityNotifications.map((item) =>
        item.id === notif.id ? { ...item, is_read: true } : item
      ),
    }));
    emitNotificationsChanged();
    return;
  }

  const isBroadcast = notif.user_id.toLowerCase().startsWith('broadcast:');
  if (isBroadcast) {
    addBroadcastReadIds(session, [notif.id]);
    emitNotificationsChanged();
    return;
  }

  const targetSig = buildNotificationContentSignature(notif);
  const targetMs = Date.parse(notif.created_at) || 0;

  // Update cache lokal untuk ID maupun salinan dedup_key/konten yang sama
  const local = readLocalNotifications();
  let localModified = false;
  const nextLocal = local.map((item) => {
    const sameId = item.id === notif.id;
    const sameDedup =
      Boolean(notif.dedup_key && item.dedup_key) && item.dedup_key === notif.dedup_key;
    const sameSig =
      buildNotificationContentSignature(item) === targetSig &&
      Math.abs((Date.parse(item.created_at) || 0) - targetMs) <= 90_000;
    if ((sameId || sameDedup || sameSig) && !item.is_read) {
      localModified = true;
      return { ...item, is_read: true };
    }
    return item;
  });
  if (localModified) {
    writeLocalNotifications(nextLocal);
  }

  const supabase = getSupabaseClient(session);
  const directMatchIds = getQueryMatchUserIds(session).filter(
    (id) => !id.toLowerCase().startsWith('broadcast:')
  );
  if (supabase && isSupabaseConfigured() && !notif.id.startsWith('notif-')) {
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
      if (notif.dedup_key && !dedupKeyColumnMissing && directMatchIds.length > 0) {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('dedup_key', notif.dedup_key)
          .in('user_id', directMatchIds)
          .eq('is_read', false);
      }
    } catch {
      // Abaikan jika offline
    }
  }

  emitNotificationsChanged();
}

/**
 * Menandai semua notifikasi milik sesi aktif sebagai sudah dibaca.
 */
export async function markAllActivityNotificationsRead(
  session: SessionUser,
  currentList: ActivityNotification[]
): Promise<void> {
  if (isSimulationMode(session)) {
    const idSet = new Set(currentList.map((n) => n.id));
    updateSimData((curr) => ({
      ...curr,
      activityNotifications: curr.activityNotifications.map((item) =>
        idSet.has(item.id) ? { ...item, is_read: true } : item
      ),
    }));
    emitNotificationsChanged();
    return;
  }

  const unread = currentList.filter((n) => !n.is_read);

  const broadcastIds = unread
    .filter((n) => n.user_id.toLowerCase().startsWith('broadcast:'))
    .map((n) => n.id);
  if (broadcastIds.length > 0) {
    addBroadcastReadIds(session, broadcastIds);
  }

  const directIds = unread
    .filter((n) => !n.user_id.toLowerCase().startsWith('broadcast:'))
    .map((n) => n.id);

  // Update cache lokal
  const local = readLocalNotifications();
  const allowedIds = new Set(getUserNotificationMatchIds(session).map((id) => normalizeIdToken(id)));
  const unreadSet = new Set(unread.map((u) => u.id));
  if (local.some((item) => unreadSet.has(item.id) || allowedIds.has(normalizeIdToken(item.user_id)))) {
    writeLocalNotifications(
      local.map((item) =>
        unreadSet.has(item.id) || allowedIds.has(normalizeIdToken(item.user_id))
          ? { ...item, is_read: true }
          : item
      )
    );
  }

  const supabase = getSupabaseClient(session);
  const remoteDirectIds = directIds.filter((id) => !id.startsWith('notif-'));
  const directMatchIds = getQueryMatchUserIds(session).filter(
    (id) => !id.toLowerCase().startsWith('broadcast:')
  );
  if (supabase && isSupabaseConfigured()) {
    try {
      if (remoteDirectIds.length > 0) {
        await supabase.from('notifications').update({ is_read: true }).in('id', remoteDirectIds);
      }
      if (directMatchIds.length > 0) {
        await supabase
          .from('notifications')
          .update({ is_read: true })
          .in('user_id', directMatchIds)
          .eq('is_read', false);
      }
    } catch {
      // Abaikan jika offline
    }
  }

  emitNotificationsChanged();
}

/**
 * Menghapus 1 notifikasi (mendukung Swipe-to-Delete & tombol Trash).
 */
export async function deleteNotification(
  session: SessionUser,
  notifOrId: ActivityNotification | string
): Promise<void> {
  const id = typeof notifOrId === 'string' ? notifOrId : notifOrId?.id;
  if (!id) return;

  if (isSimulationMode(session)) {
    updateSimData((curr) => ({
      ...curr,
      activityNotifications: curr.activityNotifications.filter((item) => item.id !== id),
    }));
    emitNotificationsChanged();
    return;
  }

  const isBroadcast =
    typeof notifOrId !== 'string' && notifOrId.user_id.toLowerCase().startsWith('broadcast:');
  const dedupKey = typeof notifOrId !== 'string' ? notifOrId.dedup_key : null;

  addDismissedNotificationIds(session, [id]);

  // Hapus dari cache lokal jika ada
  const local = readLocalNotifications();
  const nextLocal = local.filter((item) => {
    if (item.id === id) return false;
    if (dedupKey && item.dedup_key === dedupKey) return false;
    return true;
  });
  if (nextLocal.length !== local.length) {
    writeLocalNotifications(nextLocal);
  }

  // Hapus baris personal di Supabase (beserta duplikat alias dengan dedup_key sama bila ada)
  const supabase = getSupabaseClient(session);
  const directMatchIds = getQueryMatchUserIds(session).filter(
    (uid) => !uid.toLowerCase().startsWith('broadcast:')
  );
  if (supabase && isSupabaseConfigured() && !isBroadcast && !id.startsWith('notif-')) {
    try {
      await supabase.from('notifications').delete().eq('id', id);
      if (dedupKey && !dedupKeyColumnMissing && directMatchIds.length > 0) {
        await supabase
          .from('notifications')
          .delete()
          .eq('dedup_key', dedupKey)
          .in('user_id', directMatchIds);
      }
    } catch {
      // Tetap aman karena sudah masuk daftar dismissed lokal
    }
  }

  emitNotificationsChanged();
}

/**
 * Menghapus seluruh notifikasi yang tampil untuk sesi aktif sekaligus.
 */
export async function deleteAllNotifications(
  session: SessionUser,
  currentList: ActivityNotification[]
): Promise<void> {
  if (!currentList || currentList.length === 0) return;

  if (isSimulationMode(session)) {
    const idSet = new Set(currentList.map((n) => n.id));
    updateSimData((curr) => ({
      ...curr,
      activityNotifications: curr.activityNotifications.filter((item) => !idSet.has(item.id)),
    }));
    emitNotificationsChanged();
    return;
  }

  const allIds = currentList.map((n) => n.id);
  addDismissedNotificationIds(session, allIds);

  const allIdSet = new Set(allIds);
  const local = readLocalNotifications();
  if (local.some((item) => allIdSet.has(item.id))) {
    writeLocalNotifications(local.filter((item) => !allIdSet.has(item.id)));
  }

  const remoteDirectIds = currentList
    .filter((n) => !n.user_id.toLowerCase().startsWith('broadcast:') && !n.id.startsWith('notif-'))
    .map((n) => n.id);
  const directMatchIds = getQueryMatchUserIds(session).filter(
    (uid) => !uid.toLowerCase().startsWith('broadcast:')
  );

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      if (remoteDirectIds.length > 0) {
        await supabase.from('notifications').delete().in('id', remoteDirectIds);
      }
      if (directMatchIds.length > 0) {
        await supabase.from('notifications').delete().in('user_id', directMatchIds);
      }
    } catch {
      // Tetap aman karena sudah masuk daftar dismissed lokal
    }
  }

  emitNotificationsChanged();
}

// =========================================================================
// Singleton Reference-Counted Realtime Hub per Sesi Pengguna
// Mencegah channel WebSocket / listener window ganda saat berpindah tab atau
// ketika AppShell & NotificationBell berlangganan secara bersamaan.
// =========================================================================
interface RealtimeSubscriber {
  onChange: () => void;
  onInsert?: (notif: ActivityNotification) => void;
}

interface RealtimeHubEntry {
  session: SessionUser;
  subscribers: Set<RealtimeSubscriber>;
  recentInsertIds: Set<string>;
  recentInsertSignatures: Map<string, number>;
  teardown: () => void;
}

const realtimeHubBySessionKey = new Map<string, RealtimeHubEntry>();

function pruneHubMap(map: Map<string, number>, maxAgeMs: number): void {
  if (map.size <= 120) return;
  const now = Date.now();
  for (const [k, ts] of map.entries()) {
    if (now - ts > maxAgeMs) map.delete(k);
  }
}

/**
 * Berlangganan pembaruan notifikasi secara real-time melalui hub singleton terkelola.
 */
export function subscribeActivityNotificationsRealtime(
  session: SessionUser,
  onChange: () => void,
  onInsert?: (notif: ActivityNotification) => void
): () => void {
  const sessionKey = getCanonicalUserId(session);
  const subscriber: RealtimeSubscriber = { onChange, onInsert };

  let entry = realtimeHubBySessionKey.get(sessionKey);
  if (!entry) {
    const subscribers = new Set<RealtimeSubscriber>();
    const recentInsertIds = new Set<string>();
    const recentInsertSignatures = new Map<string, number>();
    const cleanups: Array<() => void> = [];

    const hub: RealtimeHubEntry = {
      session,
      subscribers,
      recentInsertIds,
      recentInsertSignatures,
      teardown: () => {
        cleanups.forEach((fn) => {
          try {
            fn();
          } catch {
            // Abaikan
          }
        });
      },
    };

    const dispatchInsertOnce = (notif: ActivityNotification) => {
      const currentSession = hub.session;
      if (!isNotificationMatchingSession(notif, currentSession, { excludeSelfActor: true })) return;
      if (notif.is_read) return;

      const sig = notif.dedup_key
        ? `dk:${notif.dedup_key.trim().toLowerCase()}`
        : `sig:${buildNotificationContentSignature(notif)}`;
      const now = Date.now();
      pruneHubMap(recentInsertSignatures, 60_000);

      if (recentInsertIds.has(notif.id)) return;
      const lastSigTs = recentInsertSignatures.get(sig);
      if (lastSigTs && now - lastSigTs < 30_000) return;

      recentInsertIds.add(notif.id);
      if (recentInsertIds.size > 250) {
        const first = recentInsertIds.values().next().value;
        if (first) recentInsertIds.delete(first);
      }
      recentInsertSignatures.set(sig, now);

      hub.subscribers.forEach((sub) => {
        try {
          sub.onInsert?.(notif);
        } catch {
          // Abaikan error callback
        }
      });
    };

    const notifyChange = () => {
      hub.subscribers.forEach((sub) => {
        try {
          sub.onChange();
        } catch {
          // Abaikan error callback
        }
      });
    };

    const onLocalEvent = (e: Event) => {
      notifyChange();
      const detail = (e as CustomEvent<{ inserted?: ActivityNotification[] }>).detail;
      if (detail?.inserted && Array.isArray(detail.inserted)) {
        detail.inserted.forEach((item) => dispatchInsertOnce(item));
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_NOTIF_KEY) {
        notifyChange();
        try {
          if (e.newValue) {
            const parsed = JSON.parse(e.newValue);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const latest = parsed[0] as ActivityNotification;
              if (latest?.created_at && Date.now() - Date.parse(latest.created_at) < 15_000) {
                dispatchInsertOnce(latest);
              }
            }
          }
        } catch {
          // Abaikan
        }
      }
    };

    const onSimChanged = (ev: Event) => {
      const kind = (ev as CustomEvent<{ kind?: SimChangeKind }>).detail?.kind;
      if (!kind || kind === 'data' || kind === 'wipe') {
        notifyChange();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(NOTIF_EVENT, onLocalEvent);
      window.addEventListener('storage', onStorage);
      if (isSimulationMode(session) || isSimulationSessionActive()) {
        window.addEventListener(SIM_CHANGED_EVENT, onSimChanged);
      }
      cleanups.push(() => {
        window.removeEventListener(NOTIF_EVENT, onLocalEvent);
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(SIM_CHANGED_EVENT, onSimChanged);
      });
    }

    const supabase =
      isSimulationMode(session) || isSimulationSessionActive()
        ? null
        : getSupabaseClient(session);
    if (supabase && isSupabaseConfigured()) {
      try {
        const channelName = `notifications-hub-${sessionKey.replace(/[^a-z0-9]/gi, '_')}`;
        const channel = supabase
          .channel(channelName)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'notifications' },
            (payload) => {
              const allowedIds = new Set(
                getUserNotificationMatchIds(hub.session).map((id) => normalizeIdToken(id))
              );
              const nextRow = (payload.new || payload.old) as Record<string, unknown> | undefined;
              const targetUserId = normalizeIdToken(
                typeof nextRow?.user_id === 'string' ? nextRow.user_id : ''
              );
              if (!targetUserId || allowedIds.has(targetUserId)) {
                notifyChange();
                if (payload.eventType === 'INSERT' && payload.new) {
                  const broadcastReadSet = getBroadcastReadSet(hub.session);
                  const normalized = normalizeNotificationRow(
                    payload.new as Record<string, unknown>,
                    broadcastReadSet
                  );
                  dispatchInsertOnce(normalized);
                }
              }
            }
          )
          .subscribe();

        cleanups.push(() => {
          try {
            void supabase.removeChannel(channel);
          } catch {
            // Abaikan
          }
        });
      } catch {
        // Abaikan bila WebSocket realtime dibatasi
      }
    }

    entry = hub;
    realtimeHubBySessionKey.set(sessionKey, entry);
  } else {
    entry.session = session;
  }

  entry.subscribers.add(subscriber);

  return () => {
    const activeEntry = realtimeHubBySessionKey.get(sessionKey);
    if (!activeEntry) return;
    activeEntry.subscribers.delete(subscriber);
    if (activeEntry.subscribers.size === 0) {
      realtimeHubBySessionKey.delete(sessionKey);
      activeEntry.teardown();
    }
  };
}

/**
 * Format waktu relatif bahasa Indonesia: "Baru saja", "5 menit lalu", "2 jam lalu", dst.
 */
export function formatRelativeTimeId(isoDate?: string | null): string {
  if (!isoDate) return 'Baru saja';
  try {
    const timeMs = Date.parse(isoDate);
    if (Number.isNaN(timeMs)) return 'Baru saja';
    const diffSec = Math.floor((Date.now() - timeMs) / 1000);
    if (diffSec < 45) return 'Baru saja';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} menit lalu`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} jam lalu`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay === 1) return 'Kemarin';
    if (diffDay < 7) return `${diffDay} hari lalu`;
    return new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
    }).format(new Date(timeMs));
  } catch {
    return 'Baru saja';
  }
}

export function resolveDefaultTargetUrlForRole(role: UserRole): string {
  if (role === 'admin') return 'tab:dashboard';
  if (role === 'petugas') return 'tab:info';
  return 'tab:beranda';
}
