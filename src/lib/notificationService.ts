import { Capacitor } from '@capacitor/core';
import {
  SUSUNAN_PENGURUS,
  type ActivityNotification,
  type ActivityNotificationCategory,
  type SessionUser,
  type UserRole,
} from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

const LOCAL_NOTIF_KEY = 'ecard_activity_notifications_v1';
const LOCAL_BROADCAST_READ_PREFIX = 'ecard_broadcast_read_v1:';
const LOCAL_DISMISSED_NOTIF_PREFIX = 'ecard_notif_dismissed_v1:';
const NOTIF_EVENT = 'ecard-activity-notifications-changed';
const NOTIF_NAVIGATE_EVENT = 'ecard-notif-navigate';
const MAX_LOCAL_NOTIFICATIONS = 250;

export const NOTIFICATION_CHANNEL_ID = 'saung_kebun_alerts';

export type DeviceNotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface RealtimeNotificationOptions {
  /**
   * Otomatis memunculkan LocalNotifications (Android) / Web Notifications saat event INSERT diterima.
   * Default: `true` jika pemanggil tidak menyediakan callback `onInsert` kustom.
   */
  autoShowDeviceNotification?: boolean;
  /**
   * Interval polling cadangan dalam milidetik (opsional, misal 10000 untuk 10 detik)
   * agar notifikasi tetap masuk meski koneksi WebSocket Supabase sempat terputus di HP.
   */
  pollingIntervalMs?: number;
}

const dispatchedDeviceAlertIds = new Set<string>();
let androidChannelReady = false;
let androidLaunchInitPromise: Promise<DeviceNotificationPermission> | null = null;
let pushRegistrationListenersBound = false;
let cachedNativeFcmToken: string | null = null;
let currentNotificationSession: SessionUser | null = null;

function isNativeCapacitor(): boolean {
  try {
    return Boolean(
      Capacitor &&
        typeof Capacitor.isNativePlatform === 'function' &&
        Capacitor.isNativePlatform()
    );
  } catch {
    return false;
  }
}

function hashNotificationId(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash) % 2147480000;
  return positive > 0 ? positive : Math.floor(Date.now() % 2147480000);
}

export function markDeviceNotificationDispatched(notificationId: string): boolean {
  if (!notificationId) return false;
  if (dispatchedDeviceAlertIds.has(notificationId)) return false;
  dispatchedDeviceAlertIds.add(notificationId);
  if (dispatchedDeviceAlertIds.size > 300) {
    const oldest = dispatchedDeviceAlertIds.values().next().value;
    if (oldest) dispatchedDeviceAlertIds.delete(oldest);
  }
  return true;
}

/**
 * Membuat Notification Channel Android (`saung_kebun_alerts`) berprioritas tinggi (importance: 5)
 * agar notifikasi muncul sebagai banner heads-up di Status Bar disertai suara & getaran bawaan HP.
 */
export async function createAndroidNotificationChannel(): Promise<void> {
  if (!isNativeCapacitor() || androidChannelReady) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (typeof LocalNotifications.createChannel === 'function') {
      await LocalNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'Notifikasi Saung Kebun',
        description: 'Notifikasi real-time IPL, Kas Lingkungan, Patroli Keamanan & Pengumuman',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
        lights: true,
        lightColor: '#059669',
      });
    }
    androidChannelReady = true;
  } catch {
    // Aman diabaikan pada platform non-Android / Web
  }
}

async function initNativeFcmPushRegistration(): Promise<void> {
  if (!isNativeCapacitor()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (typeof PushNotifications.createChannel === 'function') {
      await PushNotifications.createChannel({
        id: NOTIFICATION_CHANNEL_ID,
        name: 'Notifikasi Saung Kebun',
        description: 'Notifikasi real-time IPL, Kas Lingkungan, Patroli Keamanan & Pengumuman',
        importance: 5,
        visibility: 1,
        sound: 'default',
        vibration: true,
        lights: true,
        lightColor: '#059669',
      }).catch(() => {});
    }

    if (!pushRegistrationListenersBound) {
      pushRegistrationListenersBound = true;
      await PushNotifications.addListener('registration', (token) => {
        const value = token?.value?.trim();
        if (!value) return;
        cachedNativeFcmToken = value;
        if (currentNotificationSession) {
          const platform =
            typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'android';
          void saveUserPushToken(currentNotificationSession, value, platform);
        }
      });
      await PushNotifications.addListener('registrationError', () => {
        // Tetap aman jika google-services.json belum dipasang
      });
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = (action?.notification?.data || {}) as { target_url?: string };
        if (data.target_url && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(NOTIF_NAVIGATE_EVENT, { detail: { targetUrl: data.target_url } })
          );
        }
      });
    }

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive === 'granted') {
      await PushNotifications.register();
    }
  } catch {
    // Aman jika dijalankan di Web atau perangkat tanpa GMS
  }
}

/**
 * Memeriksa status izin notifikasi perangkat saat ini (Android Native & Web Browser).
 */
export async function checkDeviceNotificationPermission(): Promise<DeviceNotificationPermission> {
  if (isNativeCapacitor()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const status = await LocalNotifications.checkPermissions();
      if (status.display === 'granted') return 'granted';
      if (status.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    const perm = window.Notification.permission;
    if (perm === 'granted') return 'granted';
    if (perm === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

/**
 * Meminta izin notifikasi sistem (LocalNotifications + PushNotifications di Android,
 * atau Web Notification API di Browser).
 */
export async function requestDeviceNotificationPermission(): Promise<DeviceNotificationPermission> {
  if (isNativeCapacitor()) {
    try {
      await createAndroidNotificationChannel();
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const res = await LocalNotifications.requestPermissions();
      void initNativeFcmPushRegistration();
      if (res.display === 'granted') return 'granted';
      if (res.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    const perm = await window.Notification.requestPermission();
    if (perm === 'granted') return 'granted';
    if (perm === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

/**
 * Inisialisasi otomatis saat aplikasi pertama kali dibuka:
 * - Di Android Native (Capacitor): langsung membuat channel `saung_kebun_alerts`,
 *   memanggil `LocalNotifications.requestPermissions()` secara otomatis (Android 13+ POST_NOTIFICATIONS),
 *   serta mendaftarkan PushNotifications (FCM) ke tabel `user_push_tokens` jika sesi login aktif.
 * - Di Web Browser: hanya membaca status izin saat ini tanpa mengganggu kebijakan gesture browser.
 */
export function initializeAndroidNotificationsOnLaunch(
  session?: SessionUser | null
): Promise<DeviceNotificationPermission> {
  if (session !== undefined) {
    currentNotificationSession = session;
  }

  if (!isNativeCapacitor()) {
    return checkDeviceNotificationPermission();
  }

  if (session && cachedNativeFcmToken) {
    const platform =
      typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'android';
    void saveUserPushToken(session, cachedNativeFcmToken, platform);
  }

  if (androidLaunchInitPromise) {
    return androidLaunchInitPromise;
  }

  androidLaunchInitPromise = (async () => {
    try {
      await createAndroidNotificationChannel();
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      let status = await LocalNotifications.checkPermissions();
      if (status.display !== 'granted') {
        status = await LocalNotifications.requestPermissions();
      }

      // Daftarkan juga PushNotifications (FCM) secara paralel & aman
      void initNativeFcmPushRegistration();

      if (status.display === 'granted') return 'granted';
      if (status.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  })();

  return androidLaunchInitPromise;
}

/**
 * Mengirimkan notifikasi sistem perangkat untuk 1 objek `ActivityNotification`:
 * - Android Native (Capacitor): `LocalNotifications.schedule` ke channel `saung_kebun_alerts`
 *   disertai suara & getaran bawaan HP.
 * - Web / PWA: Service Worker `showNotification` (Chrome Android PWA) atau `new Notification()`.
 */
export async function showDeviceSystemNotification(
  notif: Pick<ActivityNotification, 'id' | 'title' | 'message' | 'category' | 'target_url'>,
  options?: { soundEnabled?: boolean; vibrationEnabled?: boolean; force?: boolean }
): Promise<boolean> {
  const id = notif.id || `sk-${Date.now()}`;
  if (!options?.force && !markDeviceNotificationDispatched(id)) {
    return false;
  }

  const title = notif.title?.trim() || 'e-Card IPL Saung Kebun';
  const body = notif.message?.trim() || 'Ada aktivitas baru di lingkungan Saung Kebun.';
  const targetUrl = notif.target_url || '';

  if (isNativeCapacitor()) {
    try {
      await createAndroidNotificationChannel();
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'prompt') {
        perm = await LocalNotifications.requestPermissions();
      }
      if (perm.display !== 'granted') return false;

      await LocalNotifications.schedule({
        notifications: [
          {
            id: hashNotificationId(id),
            title,
            body,
            channelId: NOTIFICATION_CHANNEL_ID,
            sound: options?.soundEnabled === false ? undefined : 'default',
            iconColor: '#059669',
            schedule: { at: new Date(Date.now() + 100), allowWhileIdle: true },
            extra: {
              notification_id: id,
              category: notif.category || 'system',
              target_url: targetUrl,
            },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  // Web / PWA Notification API
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (window.Notification.permission !== 'granted') return false;

    const webOptions: NotificationOptions & { vibrate?: number[] } = {
      body,
      icon: '/app-icon.jpg',
      badge: '/app-icon.jpg',
      tag: id,
      silent: options?.soundEnabled === false,
      data: { target_url: targetUrl },
    };
    if (options?.vibrationEnabled !== false) {
      webOptions.vibrate = [250, 100, 250];
    }

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 500)),
        ]);
        if (reg && typeof reg.showNotification === 'function') {
          await reg.showNotification(title, webOptions);
          return true;
        }
      } catch {
        // Fallback ke new window.Notification
      }
    }

    const webNotif = new window.Notification(title, webOptions);
    webNotif.onclick = () => {
      try {
        window.focus();
        if (targetUrl) {
          window.dispatchEvent(
            new CustomEvent(NOTIF_NAVIGATE_EVENT, { detail: { targetUrl } })
          );
        }
        webNotif.close();
      } catch {
        // Abaikan
      }
    };
    return true;
  } catch {
    return false;
  }
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
      ids.add('role:bendahara');
    }
    if (session.jabatan === 'Ketua' || rawBlok === 'erlangga') {
      ids.add('admin:erlangga');
      ids.add('role:ketua');
    }
  } else if (session.role === 'petugas') {
    ids.add('broadcast:petugas');
    if (session.petugas_id) {
      ids.add(`petugas:${normalizeIdToken(session.petugas_id)}`);
    }
    if (session.blok_rumah) {
      ids.add(`petugas:${normalizeIdToken(session.blok_rumah)}`);
    }
  }

  return Array.from(ids);
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
    const matchArray = Array.from(allowedIds);
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
 * Mengirim 1 atau banyak notifikasi aktivitas sekaligus secara real-time ke Supabase + cache lokal.
 * Aman dipanggil dari aktivitas apa pun tanpa melempar error ke alur utama.
 */
export async function dispatchActivityNotifications(
  actorSession: SessionUser | null | undefined,
  inputs: CreateActivityNotificationInput[]
): Promise<void> {
  if (!inputs || inputs.length === 0) return;

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

  if (rows.length === 0) return;

  // Simpan ke Supabase terlebih dahulu jika terkonfigurasi
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
 * Berlangganan pembaruan notifikasi secara real-time via Supabase Realtime + event lokal,
 * terintegrasi langsung dengan Android `LocalNotifications` (`saung_kebun_alerts`) & Web Notifications.
 * - Saat dipanggil di Android Native, otomatis memastikan channel & izin notifikasi aktif.
 * - Setiap event `INSERT` pada tabel `public.notifications` untuk akun/role ini akan memicu
 *   `onInsert` serta (jika `autoShowDeviceNotification` aktif) langsung memunculkan notifikasi OS.
 */
export function subscribeActivityNotificationsRealtime(
  session: SessionUser,
  onChange: () => void,
  onInsert?: (notif: ActivityNotification) => void,
  options?: RealtimeNotificationOptions
): () => void {
  const cleanups: Array<() => void> = [];
  const allowedIds = new Set(getUserNotificationMatchIds(session));
  const selfCanonicalId = getCanonicalUserId(session);
  const broadcastReadSet = getBroadcastReadSet(session);
  const autoShowDeviceNotification = options?.autoShowDeviceNotification ?? !onInsert;

  // Pastikan inisialisasi Android channel + requestPermission + sinkronisasi token FCM berjalan untuk sesi aktif
  void initializeAndroidNotificationsOnLaunch(session);

  const handleCandidateInsert = (notif: ActivityNotification) => {
    const recipient = normalizeIdToken(notif.user_id);
    if (!recipient || !allowedIds.has(recipient)) return;
    // Jangan membunyikan notifikasi ke perangkat pelaku sendiri untuk aksi yang baru saja ia tekan
    const actor = normalizeIdToken(notif.actor_id);
    if (actor && actor === normalizeIdToken(selfCanonicalId)) return;

    if (!notif.is_read && autoShowDeviceNotification) {
      void showDeviceSystemNotification(notif);
    }
    if (onInsert) {
      onInsert(notif);
    }
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
              if (payload.eventType === 'INSERT' && payload.new) {
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

  // Polling cadangan opsional langsung di service bila diminta oleh pemanggil
  const pollingMs = options?.pollingIntervalMs ?? 0;
  if (pollingMs > 0 && typeof window !== 'undefined') {
    const seenIds = new Set<string>();
    let primed = false;

    const runPoll = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const list = await fetchActivityNotifications(session);
        if (!primed) {
          list.forEach((n) => seenIds.add(n.id));
          primed = true;
          return;
        }
        const newlyUnread = list.filter((n) => !seenIds.has(n.id) && !n.is_read);
        list.forEach((n) => seenIds.add(n.id));
        if (newlyUnread.length > 0) {
          onChange();
          newlyUnread.slice(0, 3).forEach((item) => handleCandidateInsert(item));
        }
      } catch {
        // Abaikan error jaringan sementara
      }
    };

    void runPoll();
    const timerId = window.setInterval(() => {
      void runPoll();
    }, pollingMs);
    cleanups.push(() => window.clearInterval(timerId));
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

const LOCAL_PUSH_TOKEN_KEY = 'ecard_fcm_push_token_v1';

/**
 * Menyimpan token FCM perangkat (Android/iOS Capacitor) ke tabel Supabase `user_push_tokens`
 * agar server/trigger dapat mengirimkan push notification meski aplikasi di background.
 * Dibungkus try/catch penuh agar aman di Web Browser maupun saat offline.
 */
export async function saveUserPushToken(
  session: SessionUser,
  token: string,
  platform: string = 'android'
): Promise<boolean> {
  const cleanToken = String(token || '').trim();
  if (!session || !cleanToken) return false;

  const userId = getCanonicalUserId(session);
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(
        LOCAL_PUSH_TOKEN_KEY,
        JSON.stringify({ user_id: userId, token: cleanToken, platform, updated_at: new Date().toISOString() })
      );
    }
  } catch {
    // Abaikan keterbatasan storage
  }

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) return false;

  try {
    const payload = {
      user_id: userId,
      role: session.role,
      blok_rumah: session.blok_rumah || null,
      token: cleanToken,
      platform: platform || 'android',
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('user_push_tokens')
      .upsert(payload, { onConflict: 'user_id,token' });

    if (error) {
      // Fallback insert jika constraint unik belum dibuat
      const { error: insertErr } = await supabase.from('user_push_tokens').insert(payload);
      return !insertErr;
    }
    return true;
  } catch {
    return false;
  }
}

