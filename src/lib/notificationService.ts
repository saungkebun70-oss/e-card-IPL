import {
  SUSUNAN_PENGURUS,
  type ActivityNotification,
  type ActivityNotificationCategory,
  type SessionUser,
  type UserRole,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
export {
  triggerDeviceAlert,
  initNativeNotificationsOnLaunch as initializeAndroidNotificationsOnLaunch,
} from './notificationAlertService';

const LOCAL_NOTIF_KEY = 'ecard_activity_notifications_v1';
const LOCAL_BROADCAST_READ_PREFIX = 'ecard_broadcast_read_v1:';
const LOCAL_DISMISSED_NOTIF_PREFIX = 'ecard_notif_dismissed_v1:';
const NOTIF_EVENT = 'ecard-activity-notifications-changed';
const MAX_LOCAL_NOTIFICATIONS = 250;

// Penyimpanan module-level ID notifikasi yang sudah pernah dilihat per sesi akun
// agar tidak berbunyi ulang saat komponen NotificationBell remount antar halaman/tab.
const sessionSeenNotificationIdsMap = new Map<string, Set<string>>();

export function getSessionSeenNotificationIds(session: SessionUser): Set<string> {
  const key = getCanonicalUserId(session);
  let set = sessionSeenNotificationIdsMap.get(key);
  if (!set) {
    set = new Set<string>();
    sessionSeenNotificationIdsMap.set(key, set);
  }
  return set;
}

export interface CreateActivityNotificationInput {
  user_id: string;
  category: ActivityNotificationCategory;
  title: string;
  message: string;
  target_url: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_avatar_url?: string | null;
}

export interface DirectPushDispatchInput {
  id?: string;
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
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
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
    const selfCanonicalId = normalizeIdToken(getCanonicalUserId(session));
    if (actor && actor === selfCanonicalId) {
      return false;
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
  const id = String(row.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
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
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
  };
}

function createUuidFallback(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback manual
  }
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Mengambil seluruh notifikasi milik sesi aktif (terisolasi ketat per role/unit).
 */
export async function fetchActivityNotifications(
  session: SessionUser
): Promise<ActivityNotification[]> {
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
    return localFiltered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  try {
    const matchArray = getQueryMatchUserIds(session);
    const { data, error } = await supabase
      .from('notifications')
      .select(
        'id, user_id, actor_id, actor_name, actor_avatar_url, category, title, message, is_read, target_url, created_at'
      )
      .in('user_id', matchArray)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error || !Array.isArray(data)) {
      return localFiltered.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    const remoteRows = data
      .map((row) => normalizeNotificationRow(row as Record<string, unknown>, broadcastReadSet))
      .filter((n) => allowedIds.has(normalizeIdToken(n.user_id)) && !dismissedSet.has(n.id));

    // Gabungkan fallback lokal yang belum ada di server (mis. jika tabel baru saja dibuat)
    const remoteIds = new Set(remoteRows.map((r) => r.id));
    const merged = [
      ...remoteRows,
      ...localFiltered.filter((l) => !remoteIds.has(l.id) && l.id.startsWith('notif-')),
    ];

    return merged
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 80);
  } catch {
    return localFiltered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
}

/**
 * Mengambil jumlah notifikasi yang belum dibaca (`is_read = false`) langsung dari tabel `notifications`
 * di database Supabase (beserta fallback lokal saat offline) untuk badge counter Lonceng di Header.
 */
export async function fetchUnreadNotificationCount(session: SessionUser): Promise<number> {
  const allowedIds = new Set(getUserNotificationMatchIds(session));
  const broadcastReadSet = getBroadcastReadSet(session);
  const dismissedSet = getDismissedNotificationSet(session);

  const localUnread = readLocalNotifications().filter((n) => {
    if (!allowedIds.has(normalizeIdToken(n.user_id)) || dismissedSet.has(n.id)) return false;
    const isRead = n.user_id.toLowerCase().startsWith('broadcast:')
      ? broadcastReadSet.has(n.id)
      : Boolean(n.is_read);
    return !isRead;
  });

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return localUnread.length;
  }

  try {
    const matchArray = getQueryMatchUserIds(session);
    const { data, error } = await supabase
      .from('notifications')
      .select('id, user_id, is_read')
      .in('user_id', matchArray)
      .eq('is_read', false)
      .limit(120);

    if (error || !Array.isArray(data)) {
      return localUnread.length;
    }

    const remoteUnreadIds = new Set<string>();
    for (const raw of data) {
      const row = raw as Record<string, unknown>;
      const id = String(row.id || '');
      const userId = String(row.user_id || '');
      if (!id || dismissedSet.has(id) || !allowedIds.has(normalizeIdToken(userId))) continue;
      if (userId.toLowerCase().startsWith('broadcast:') && broadcastReadSet.has(id)) continue;
      remoteUnreadIds.add(id);
    }

    let extraLocal = 0;
    for (const item of localUnread) {
      if (item.id.startsWith('notif-') && !remoteUnreadIds.has(item.id)) {
        extraLocal += 1;
      }
    }

    return remoteUnreadIds.size + extraLocal;
  } catch {
    return localUnread.length;
  }
}

/**
 * Memanggil Supabase Edge Function `send-push-notification` secara langsung dan non-blocking.
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
    .map((item) => ({
      id: item.id || createUuidFallback(),
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
      data: item.data,
    }));

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
 * sekaligus memicu Edge Function `send-push-notification` untuk Android/iOS/Web (foreground, background, killed).
 * Aman dipanggil dari aktivitas apa pun tanpa melempar error ke alur utama.
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

  const nowIso = new Date().toISOString();
  const actorId = actorSession ? getCanonicalUserId(actorSession) : 'system';
  const actorName = actorSession?.nama_warga || 'Sistem';
  const actorAvatar = actorSession?.avatar_url || null;

  // Deduplikasi berdasarkan (user_id + title + message) dalam batch yang sama
  const seen = new Set<string>();
  const rows: ActivityNotification[] = [];
  for (const item of inputs) {
    const cleanRecipient = normalizeIdToken(item.user_id);
    if (!cleanRecipient) continue;
    const dedupeKey = `${cleanRecipient}::${item.title}::${item.message}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    rows.push({
      id: createUuidFallback(),
      user_id: cleanRecipient,
      actor_id: item.actor_id ?? actorId,
      actor_name: item.actor_name ?? actorName,
      actor_avatar_url: item.actor_avatar_url ?? actorAvatar,
      category: item.category,
      title: item.title.trim(),
      message: item.message.trim(),
      is_read: false,
      target_url: item.target_url || '',
      created_at: nowIso,
    });
  }

  if (rows.length === 0) {
    if (pushOverride) {
      void sendDirectPushNotification(actorSession, pushOverride);
    }
    return;
  }

  // Langkah (a): Simpan baris ke tabel `notifications` Supabase (TANPA .select() agar tidak
  // terkena blokir RLS SELECT saat pengirim berbeda peran dengan penerima, mis. Warga -> Admin)
  let savedToRemote = false;
  const supabase = getSupabaseClient(actorSession || null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const dbPayload = rows.map((r) => ({
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
      }));
      const { error } = await supabase.from('notifications').insert(dbPayload);
      if (!error) {
        savedToRemote = true;
      }
    } catch {
      // Lanjut fallback lokal
    }

    // Langkah (b): Wajib panggil langsung Edge Function `send-push-notification` secara non-blocking
    // tanpa bergantung pada database webhook agar push FCM langsung masuk ke HP/browser.
    if (pushOverride) {
      void sendDirectPushNotification(actorSession, pushOverride);
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
    writeLocalNotifications([...rows, ...existing]);
  }

  emitNotificationsChanged(rows);
}

/**
 * Menandai 1 notifikasi sebagai sudah dibaca.
 */
export async function markActivityNotificationRead(
  session: SessionUser,
  notif: ActivityNotification
): Promise<void> {
  if (!notif || notif.is_read) return;

  const isBroadcast = notif.user_id.toLowerCase().startsWith('broadcast:');
  if (isBroadcast) {
    addBroadcastReadIds(session, [notif.id]);
    emitNotificationsChanged();
    return;
  }

  // Update cache lokal
  const local = readLocalNotifications();
  if (local.some((item) => item.id === notif.id)) {
    writeLocalNotifications(
      local.map((item) => (item.id === notif.id ? { ...item, is_read: true } : item))
    );
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !notif.id.startsWith('notif-')) {
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
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
  const unread = currentList.filter((n) => !n.is_read);
  if (unread.length === 0) return;

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
  const unreadSet = new Set(unread.map((u) => u.id));
  if (local.some((item) => unreadSet.has(item.id))) {
    writeLocalNotifications(
      local.map((item) => (unreadSet.has(item.id) ? { ...item, is_read: true } : item))
    );
  }

  const supabase = getSupabaseClient(session);
  const remoteDirectIds = directIds.filter((id) => !id.startsWith('notif-'));
  if (supabase && isSupabaseConfigured() && remoteDirectIds.length > 0) {
    try {
      await supabase.from('notifications').update({ is_read: true }).in('id', remoteDirectIds);
    } catch {
      // Abaikan jika offline
    }
  }

  emitNotificationsChanged();
}

/**
 * Menghapus 1 notifikasi (mendukung Swipe-to-Delete & tombol Trash).
 * Notifikasi personal dihapus langsung dari Supabase + cache lokal;
 * notifikasi broadcast disembunyikan permanen khusus untuk akun aktif agar tidak menghapus milik warga lain.
 */
export async function deleteNotification(
  session: SessionUser,
  notifOrId: ActivityNotification | string
): Promise<void> {
  const id = typeof notifOrId === 'string' ? notifOrId : notifOrId?.id;
  if (!id) return;

  const isBroadcast =
    typeof notifOrId !== 'string' && notifOrId.user_id.toLowerCase().startsWith('broadcast:');

  // Catat di daftar dismissed per akun agar langsung hilang secara persisten (offline/broadcast/fallback)
  addDismissedNotificationIds(session, [id]);

  // Hapus dari cache lokal jika ada
  const local = readLocalNotifications();
  if (local.some((item) => item.id === id)) {
    writeLocalNotifications(local.filter((item) => item.id !== id));
  }

  // Hapus baris personal di Supabase
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !isBroadcast && !id.startsWith('notif-')) {
    try {
      await supabase.from('notifications').delete().eq('id', id);
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

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && remoteDirectIds.length > 0) {
    try {
      await supabase.from('notifications').delete().in('id', remoteDirectIds);
    } catch {
      // Tetap aman karena sudah masuk daftar dismissed lokal
    }
  }

  emitNotificationsChanged();
}

/**
 * Berlangganan pembaruan notifikasi secara real-time via Supabase Realtime + event lokal.
 * Callback opsional `onInsert` dipanggil tepat saat ada notifikasi BARU yang ditujukan ke akun/role ini
 * (untuk memicu bunyi lonceng, getaran, animasi shake, dan pop-up sistem HP).
 */
export function subscribeActivityNotificationsRealtime(
  session: SessionUser,
  onChange: () => void,
  onInsert?: (notif: ActivityNotification) => void
): () => void {
  const cleanups: Array<() => void> = [];
  const allowedIds = new Set(getUserNotificationMatchIds(session).map((id) => normalizeIdToken(id)));
  const broadcastReadSet = getBroadcastReadSet(session);

  const handleCandidateInsert = (notif: ActivityNotification) => {
    if (!onInsert) return;
    if (!isNotificationMatchingSession(notif, session, { excludeSelfActor: true })) return;
    if (notif.is_read) return;
    onInsert(notif);
  };

  const onLocalEvent = (e: Event) => {
    onChange();
    const detail = (e as CustomEvent<{ inserted?: ActivityNotification[] }>).detail;
    if (detail?.inserted && Array.isArray(detail.inserted)) {
      detail.inserted.forEach((item) => handleCandidateInsert(item));
    }
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_NOTIF_KEY) {
      onChange();
      try {
        if (e.newValue) {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const latest = parsed[0] as ActivityNotification;
            if (latest?.created_at && Date.now() - Date.parse(latest.created_at) < 15000) {
              handleCandidateInsert(latest);
            }
          }
        }
      } catch {
        // Abaikan
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(NOTIF_EVENT, onLocalEvent);
    window.addEventListener('storage', onStorage);
    cleanups.push(() => {
      window.removeEventListener(NOTIF_EVENT, onLocalEvent);
      window.removeEventListener('storage', onStorage);
    });
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const channelName = `notifications-${getCanonicalUserId(session).replace(/[^a-z0-9]/gi, '_')}-${Date.now()}`;
      const channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications' },
          (payload) => {
            const nextRow = (payload.new || payload.old) as Record<string, unknown> | undefined;
            const targetUserId = normalizeIdToken(
              typeof nextRow?.user_id === 'string' ? nextRow.user_id : ''
            );
            if (!targetUserId || allowedIds.has(targetUserId)) {
              onChange();
              if (payload.eventType === 'INSERT' && payload.new && onInsert) {
                const normalized = normalizeNotificationRow(
                  payload.new as Record<string, unknown>,
                  broadcastReadSet
                );
                handleCandidateInsert(normalized);
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

  return () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        // Abaikan
      }
    });
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
