import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ActivityNotification, SessionUser } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

export interface NotificationPreferences {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  permissionPromptDismissed: boolean;
}

export type OsNotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface NativePushRuntimeInfo {
  isNative: boolean;
  platform: string;
  supported: boolean;
  hasToken: boolean;
  hasFcmToken: boolean;
  token: string | null;
  tokenPreview: string | null;
}

const PREFS_STORAGE_KEY = 'app_notif_prefs_v1';
const LAST_FCM_TOKEN_KEY = 'ecard_last_fcm_token_v1';
const PREFS_CHANGED_EVENT = 'ecard-notif-prefs-changed';
const BELL_SHAKE_EVENT = 'ecard-bell-shake';
const NOTIF_NAVIGATE_EVENT = 'ecard-notif-navigate';
const NOTIF_LIST_CHANGED_EVENT = 'ecard-activity-notifications-changed';
export const ANDROID_NOTIFICATION_CHANNEL_ID = 'saung_kebun_alerts';

const DEFAULT_PREFS: NotificationPreferences = {
  soundEnabled: true,
  vibrationEnabled: true,
  permissionPromptDismissed: false,
};

const alertedIds = new Set<string>();
let sharedAudioContext: AudioContext | null = null;
let audioUnlockInstalled = false;
let androidChannelInitialized = false;
let nativeLaunchInitPromise: Promise<OsNotificationPermissionState> | null = null;
let pushListenersInstalled = false;
let pushListenersInstallPromise: Promise<boolean> | null = null;
let cachedFcmToken: string | null = null;
let activePushSession: SessionUser | null = null;
let lastSyncedTokenSignature = '';
let inFlightPushSyncPromise: Promise<{
  ok: boolean;
  synced: boolean;
  token: string | null;
  error?: string;
}> | null = null;
const pendingTokenWaiters: Array<(token: string | null) => void> = [];

function isNativeApp(): boolean {
  try {
    return Boolean(
      Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()
    );
  } catch {
    return false;
  }
}

function getNativePlatformName(): string {
  try {
    if (Capacitor && typeof Capacitor.getPlatform === 'function') {
      return Capacitor.getPlatform() || 'web';
    }
  } catch {
    // Fallback web
  }
  return 'web';
}

function normalizeIdPart(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function resolveCanonicalUserIdForPush(session: SessionUser): string {
  if (session.role === 'warga') {
    return `warga:${normalizeIdPart(session.blok_rumah)}`;
  }
  if (session.role === 'admin') {
    const clean = normalizeIdPart(session.blok_rumah);
    return `admin:${clean === 'admin' ? 'andriansyah' : clean}`;
  }
  return `petugas:${normalizeIdPart(session.petugas_id || session.blok_rumah)}`;
}

function readCachedFcmToken(): string | null {
  if (cachedFcmToken) return cachedFcmToken;
  try {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(LAST_FCM_TOKEN_KEY)?.trim() || '';
    if (stored) {
      cachedFcmToken = stored;
      return stored;
    }
  } catch {
    // Abaikan keterbatasan storage
  }
  return null;
}

function writeCachedFcmToken(token: string | null): void {
  const clean = token?.trim() || null;
  cachedFcmToken = clean;
  try {
    if (typeof window === 'undefined') return;
    if (clean) {
      window.localStorage.setItem(LAST_FCM_TOKEN_KEY, clean);
    } else {
      window.localStorage.removeItem(LAST_FCM_TOKEN_KEY);
    }
  } catch {
    // Abaikan keterbatasan storage
  }
}

function resolvePendingTokenWaiters(token: string | null): void {
  while (pendingTokenWaiters.length > 0) {
    const waiter = pendingTokenWaiters.shift();
    if (waiter) {
      try {
        waiter(token);
      } catch {
        // Abaikan
      }
    }
  }
}

export function getNativePushRuntimeInfo(): NativePushRuntimeInfo {
  const isNative = isNativeApp();
  const platform = getNativePlatformName();
  const token = isNative ? readCachedFcmToken() : null;
  const hasToken = Boolean(token);
  const tokenPreview = token
    ? token.length > 20
      ? `${token.slice(0, 12)}...${token.slice(-6)}`
      : token
    : null;

  return {
    isNative,
    platform,
    supported: isNative,
    hasToken,
    hasFcmToken: hasToken,
    token,
    tokenPreview,
  };
}

export function getNotificationPreferences(): NotificationPreferences {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_PREFS };
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      soundEnabled: typeof parsed.soundEnabled === 'boolean' ? parsed.soundEnabled : true,
      vibrationEnabled: typeof parsed.vibrationEnabled === 'boolean' ? parsed.vibrationEnabled : true,
      permissionPromptDismissed: Boolean(parsed.permissionPromptDismissed),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function updateNotificationPreferences(
  patch: Partial<NotificationPreferences>
): NotificationPreferences {
  const next: NotificationPreferences = {
    ...getNotificationPreferences(),
    ...patch,
  };
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(PREFS_CHANGED_EVENT, { detail: next }));
    }
  } catch {
    // Abaikan keterbatasan storage
  }
  return next;
}

export function useNotificationPreferences() {
  const [prefs, setPrefs] = useState<NotificationPreferences>(() => getNotificationPreferences());

  useEffect(() => {
    const sync = () => setPrefs(getNotificationPreferences());
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_STORAGE_KEY) sync();
    };
    window.addEventListener(PREFS_CHANGED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(PREFS_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setPref = useCallback((patch: Partial<NotificationPreferences>) => {
    const next = updateNotificationPreferences(patch);
    setPrefs(next);
  }, []);

  return { prefs, setPref };
}

export function emitBellShakeEvent(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(BELL_SHAKE_EVENT));
    }
  } catch {
    // Abaikan
  }
}

export function subscribeBellShakeEvent(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener(BELL_SHAKE_EVENT, handler);
  return () => window.removeEventListener(BELL_SHAKE_EVENT, handler);
}

function getOrCreateAudioContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
      sharedAudioContext = new AudioCtx();
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

export function initNotificationAudioUnlock(): void {
  if (audioUnlockInstalled || typeof window === 'undefined') return;
  audioUnlockInstalled = true;

  const unlock = () => {
    try {
      const ctx = getOrCreateAudioContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
    } catch {
      // Abaikan
    }
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
}

export async function playNotificationChime(): Promise<boolean> {
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    if (ctx.state !== 'running') return false;

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.28, now);
    masterGain.connect(ctx.destination);

    const playTone = (
      freq: number,
      startTime: number,
      duration: number,
      peakGain: number,
      type: OscillatorType = 'sine'
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(masterGain);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.02);
    };

    playTone(880, now, 0.32, 0.8, 'sine');
    playTone(1760, now, 0.18, 0.22, 'triangle');

    playTone(1318.51, now + 0.12, 0.42, 0.9, 'sine');
    playTone(2637.02, now + 0.12, 0.22, 0.18, 'triangle');

    return true;
  } catch {
    return false;
  }
}

export async function triggerNotificationVibration(): Promise<boolean> {
  let didVibrate = false;

  if (isNativeApp()) {
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Success });
      await Haptics.vibrate({ duration: 200 });
      window.setTimeout(() => {
        void Haptics.vibrate({ duration: 200 }).catch(() => {});
      }, 300);
      didVibrate = true;
    } catch {
      // Lanjut fallback navigator.vibrate
    }
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const ok = navigator.vibrate([200, 100, 200]);
      if (ok) didVibrate = true;
    }
  } catch {
    // Abaikan
  }

  return didVibrate;
}

/**
 * Membuat Notification Channel Android `saung_kebun_alerts` dengan importance: 5 (High),
 * suara & getaran bawaan aktif melalui LocalNotifications DAN PushNotifications.
 * Pada iOS, pemanggilan `createChannel` dilewati secara otomatis tanpa error.
 */
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (!isNativeApp() || androidChannelInitialized) return;
  const platform = getNativePlatformName();
  if (platform !== 'android') {
    androidChannelInitialized = true;
    return;
  }

  const channelConfig = {
    id: ANDROID_NOTIFICATION_CHANNEL_ID,
    name: 'Notifikasi Saung Kebun',
    description: 'Notifikasi real-time IPL, Kas Lingkungan, Patroli Keamanan & Pengumuman',
    importance: 5 as const,
    visibility: 1 as const,
    sound: 'default',
    vibration: true,
    lights: true,
    lightColor: '#059669',
  };

  let createdAny = false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (typeof LocalNotifications.createChannel === 'function') {
      await LocalNotifications.createChannel(channelConfig);
      createdAny = true;
    }
  } catch {
    // Abaikan jika LocalNotifications belum siap
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (typeof PushNotifications.createChannel === 'function') {
      await PushNotifications.createChannel(channelConfig);
      createdAny = true;
    }
  } catch {
    // Abaikan jika PushNotifications belum siap
  }

  if (createdAny) {
    androidChannelInitialized = true;
  }
}

/**
 * Menyimpan/memperbarui token FCM/APNs perangkat ke tabel Supabase `user_push_tokens`
 * dengan seluruh kolom wajib (`user_id`, `role`, `blok_rumah`, `token`, `platform`, `updated_at`).
 */
async function persistFcmTokenToSupabase(
  session: SessionUser,
  fcmToken: string
): Promise<{ synced: boolean; error?: string }> {
  const cleanToken = fcmToken.trim();
  if (!cleanToken || !session) {
    return { synced: false, error: 'Token atau sesi tidak valid' };
  }

  const userId = resolveCanonicalUserIdForPush(session);
  const role = session.role;
  const blokRumah = session.blok_rumah?.trim() || null;
  const platform = getNativePlatformName();
  const signature = `${userId}::${role}::${blokRumah || ''}::${platform}::${cleanToken}`;

  if (signature === lastSyncedTokenSignature) {
    return { synced: true };
  }

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return { synced: false, error: 'Supabase belum terkonfigurasi' };
  }

  const payload = {
    user_id: userId,
    role,
    blok_rumah: blokRumah,
    token: cleanToken,
    platform,
    updated_at: new Date().toISOString(),
  };

  try {
    // 1. Coba upsert langsung berdasarkan unique constraint kolom `token`
    const { error: upsertErr } = await supabase
      .from('user_push_tokens')
      .upsert(payload, { onConflict: 'token' });

    if (!upsertErr) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }

    // 2. Fallback select -> update/insert jika tabel tidak memiliki unique constraint di kolom `token`
    const { data: existingRows, error: selectErr } = await supabase
      .from('user_push_tokens')
      .select('id')
      .eq('token', cleanToken)
      .limit(1);

    if (!selectErr && Array.isArray(existingRows) && existingRows.length > 0 && existingRows[0]?.id) {
      const { error: updateErr } = await supabase
        .from('user_push_tokens')
        .update(payload)
        .eq('id', existingRows[0].id);
      if (!updateErr) {
        lastSyncedTokenSignature = signature;
        return { synced: true };
      }
      return { synced: false, error: updateErr.message };
    }

    const { error: insertErr } = await supabase.from('user_push_tokens').insert(payload);
    if (!insertErr) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }
    return { synced: false, error: insertErr.message };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Mendaftarkan listener `@capacitor/push-notifications` SATU KALI per lifecycle aplikasi (Android & iOS):
 * - `registration`: simpan token FCM/APNs ke cache lokal & sinkronkan ke `user_push_tokens`
 * - `registrationError`: selesaikan waiter tanpa menghentikan aplikasi
 * - `pushNotificationReceived`: refresh daftar notifikasi & picu alert foreground (suara/getar/status bar)
 * - `pushNotificationActionPerformed`: buka `target_url` saat notifikasi diketuk dari Status Bar
 */
async function ensureNativePushListeners(): Promise<boolean> {
  if (!isNativeApp()) return false;
  if (pushListenersInstalled) return true;
  if (pushListenersInstallPromise) return pushListenersInstallPromise;

  pushListenersInstallPromise = (async () => {
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      await PushNotifications.addListener('registration', (tokenData) => {
        const nextToken = tokenData?.value?.trim() || '';
        if (!nextToken) {
          resolvePendingTokenWaiters(null);
          return;
        }
        writeCachedFcmToken(nextToken);
        resolvePendingTokenWaiters(nextToken);
        if (activePushSession) {
          void persistFcmTokenToSupabase(activePushSession, nextToken);
        }
      });

      await PushNotifications.addListener('registrationError', () => {
        resolvePendingTokenWaiters(null);
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const data = (notification?.data || {}) as Record<string, unknown>;
        const notifId =
          typeof data.notification_id === 'string' && data.notification_id.trim()
            ? data.notification_id.trim()
            : notification?.id
              ? String(notification.id)
              : `fcm-${Date.now()}`;
        const title =
          notification?.title ||
          (typeof data.title === 'string' ? data.title : '') ||
          'Aktivitas Baru · Saung Kebun';
        const body =
          notification?.body ||
          (typeof data.body === 'string' ? data.body : '') ||
          'Ketuk untuk melihat detail aktivitas terbaru.';
        const targetUrl = typeof data.target_url === 'string' ? data.target_url : '';

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(NOTIF_LIST_CHANGED_EVENT));
        }

        // Pada iOS, `PushNotifications.presentationOptions` di capacitor.config.ts sudah menampilkan banner OS,
        // sehingga pada iOS kita tetap goyangkan lonceng + suara/getar tanpa menjadwalkan LocalNotification ganda.
        const isIos = getNativePlatformName() === 'ios';
        void triggerDeviceAlert(title, body, {
          id: notifId,
          targetUrl,
          skipOsPopup: isIos,
        });
      });

      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = (action?.notification?.data || {}) as Record<string, unknown>;
        const targetUrl = typeof data.target_url === 'string' ? data.target_url : '';
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(NOTIF_LIST_CHANGED_EVENT));
          if (targetUrl) {
            window.dispatchEvent(
              new CustomEvent(NOTIF_NAVIGATE_EVENT, { detail: { targetUrl } })
            );
          }
        }
      });

      pushListenersInstalled = true;
      return true;
    } catch {
      pushListenersInstalled = false;
      return false;
    } finally {
      pushListenersInstallPromise = null;
    }
  })();

  return pushListenersInstallPromise;
}

/**
 * Mendaftarkan perangkat Android/iOS ke FCM/APNs via `@capacitor/push-notifications`,
 * menyimpan token ke cache lokal, dan menyinkronkannya ke tabel Supabase `user_push_tokens`.
 * Aman dipanggil berulang kali (deduplikasi in-flight) & otomatis menjadi no-op pada Web.
 */
export async function syncNativePushTokenForSession(
  session?: SessionUser | null
): Promise<{ ok: boolean; synced: boolean; token: string | null; error?: string }> {
  if (!isNativeApp() || !session) {
    return { ok: false, synced: false, token: null };
  }

  activePushSession = session;

  if (inFlightPushSyncPromise) {
    return inFlightPushSyncPromise;
  }

  inFlightPushSyncPromise = (async () => {
    try {
      await ensureAndroidNotificationChannel();
      const listenersReady = await ensureNativePushListeners();
      if (!listenersReady) {
        return { ok: false, synced: false, token: readCachedFcmToken(), error: 'Plugin Push tidak tersedia' };
      }

      const { PushNotifications } = await import('@capacitor/push-notifications');
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        return { ok: false, synced: false, token: null, error: 'Izin push notification belum diberikan' };
      }

      const tokenPromise = new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (val: string | null) => {
          if (!settled) {
            settled = true;
            window.clearTimeout(timer);
            resolve(val);
          }
        };
        const timer = window.setTimeout(() => finish(readCachedFcmToken()), 7000);
        pendingTokenWaiters.push(finish);
      });

      await PushNotifications.register();
      const token = (await tokenPromise) || readCachedFcmToken();

      if (!token) {
        return { ok: false, synced: false, token: null, error: 'Token FCM/APNs belum diperoleh' };
      }

      writeCachedFcmToken(token);
      const persistRes = await persistFcmTokenToSupabase(session, token);
      return {
        ok: true,
        synced: persistRes.synced,
        token,
        error: persistRes.error,
      };
    } catch (err) {
      return {
        ok: false,
        synced: false,
        token: readCachedFcmToken(),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      inFlightPushSyncPromise = null;
    }
  })();

  return inFlightPushSyncPromise;
}

/**
 * Dipanggil otomatis saat aplikasi native Android/iOS (Capacitor) dibuka atau saat sesi login berubah:
 * - Membuat Notification Channel Android `saung_kebun_alerts`
 * - Memasang listener FCM/APNs satu kali
 * - Meminta izin notifikasi OS bila masih belum diberikan
 * - Menyinkronkan token perangkat ke Supabase `user_push_tokens` saat `session` tersedia
 */
export async function initNativeNotificationsOnLaunch(
  session?: SessionUser | null
): Promise<OsNotificationPermissionState> {
  if (session) {
    activePushSession = session;
  }

  if (!isNativeApp()) {
    return checkOsNotificationPermission();
  }

  if (!nativeLaunchInitPromise) {
    nativeLaunchInitPromise = (async () => {
      try {
        await ensureAndroidNotificationChannel();
        await ensureNativePushListeners();

        let localStatus: OsNotificationPermissionState = 'prompt';
        try {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          let localPerm = await LocalNotifications.checkPermissions();
          if (localPerm.display !== 'granted') {
            localPerm = await LocalNotifications.requestPermissions();
          }
          if (localPerm.display === 'granted') localStatus = 'granted';
          else if (localPerm.display === 'denied') localStatus = 'denied';
        } catch {
          // Lanjut ke PushNotifications
        }

        let pushStatus: OsNotificationPermissionState = 'prompt';
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');
          let pushPerm = await PushNotifications.checkPermissions();
          if (pushPerm.receive !== 'granted') {
            pushPerm = await PushNotifications.requestPermissions();
          }
          if (pushPerm.receive === 'granted') {
            pushStatus = 'granted';
            await PushNotifications.register();
          } else if (pushPerm.receive === 'denied') {
            pushStatus = 'denied';
          }
        } catch {
          // Fallback tetap aman dengan LocalNotifications
        }

        if (localStatus === 'granted' || pushStatus === 'granted') return 'granted';
        if (localStatus === 'denied' && pushStatus === 'denied') return 'denied';
        if (localStatus === 'denied' || pushStatus === 'denied') return 'denied';
        return 'prompt';
      } catch {
        return 'unsupported';
      }
    })();
  }

  const permission = await nativeLaunchInitPromise;

  if (session) {
    void syncNativePushTokenForSession(session);
  }

  return permission;
}

export async function syncAppIconBadge(unreadCount: number): Promise<void> {
  try {
    if (typeof navigator === 'undefined') return;
    const navWithBadge = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (unreadCount > 0 && typeof navWithBadge.setAppBadge === 'function') {
      await navWithBadge.setAppBadge(unreadCount);
    } else if (unreadCount <= 0 && typeof navWithBadge.clearAppBadge === 'function') {
      await navWithBadge.clearAppBadge();
    }
  } catch {
    // Abaikan
  }
}

export async function checkOsNotificationPermission(): Promise<OsNotificationPermissionState> {
  if (isNativeApp()) {
    let localState: OsNotificationPermissionState = 'unsupported';
    let pushState: OsNotificationPermissionState = 'unsupported';

    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const status = await LocalNotifications.checkPermissions();
      if (status.display === 'granted') localState = 'granted';
      else if (status.display === 'denied') localState = 'denied';
      else localState = 'prompt';
    } catch {
      localState = 'unsupported';
    }

    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const status = await PushNotifications.checkPermissions();
      if (status.receive === 'granted') pushState = 'granted';
      else if (status.receive === 'denied') pushState = 'denied';
      else pushState = 'prompt';
    } catch {
      pushState = 'unsupported';
    }

    if (localState === 'granted' || pushState === 'granted') return 'granted';
    if (localState === 'prompt' || pushState === 'prompt') return 'prompt';
    if (localState === 'denied' || pushState === 'denied') return 'denied';
    return 'unsupported';
  }

  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    const perm = window.Notification.permission;
    if (perm === 'granted') return 'granted';
    if (perm === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

export async function requestOsNotificationPermission(): Promise<OsNotificationPermissionState> {
  if (isNativeApp()) {
    try {
      await ensureAndroidNotificationChannel();
      await ensureNativePushListeners();

      let localGranted = false;
      let localDenied = false;
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const res = await LocalNotifications.requestPermissions();
        localGranted = res.display === 'granted';
        localDenied = res.display === 'denied';
      } catch {
        // Abaikan
      }

      let pushGranted = false;
      let pushDenied = false;
      try {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const pushRes = await PushNotifications.requestPermissions();
        pushGranted = pushRes.receive === 'granted';
        pushDenied = pushRes.receive === 'denied';
        if (pushGranted) {
          await PushNotifications.register();
        }
      } catch {
        // Fallback aman jika PushNotifications tidak tersedia
      }

      if (localGranted || pushGranted) {
        if (activePushSession) {
          void syncNativePushTokenForSession(activePushSession);
        }
        return 'granted';
      }
      if (localDenied || pushDenied) return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    const perm = await window.Notification.requestPermission();
    if (perm === 'granted') return 'granted';
    if (perm === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'unsupported';
  }
}

function hashToSafeNotificationId(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash) % 2147480000;
  return positive > 0 ? positive : Math.floor(Date.now() % 2147480000);
}

export async function showOsNotification(payload: {
  id?: string;
  title: string;
  body: string;
  targetUrl?: string;
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
}): Promise<boolean> {
  const title = payload.title?.trim() || 'e-Card IPL Saung Kebun';
  const body = payload.body?.trim() || 'Ada aktivitas baru di lingkungan Saung Kebun.';
  const targetUrl = payload.targetUrl || '';
  const tag = payload.id || `sk-${Date.now()}`;

  if (isNativeApp()) {
    try {
      await ensureAndroidNotificationChannel();
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'prompt') {
        perm = await LocalNotifications.requestPermissions();
      }
      if (perm.display !== 'granted') return false;

      const numericId = hashToSafeNotificationId(tag);
      const isAndroid = getNativePlatformName() === 'android';
      await LocalNotifications.schedule({
        notifications: [
          {
            id: numericId,
            title,
            body,
            ...(isAndroid ? { channelId: ANDROID_NOTIFICATION_CHANNEL_ID, iconColor: '#059669' } : {}),
            sound: payload.soundEnabled === false ? undefined : 'default',
            schedule: { at: new Date(Date.now() + 100), allowWhileIdle: true },
            extra: {
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

  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (window.Notification.permission !== 'granted') return false;

    const webOptions: NotificationOptions & { vibrate?: number[] } = {
      body,
      icon: '/app-icon.jpg',
      badge: '/app-icon.jpg',
      tag,
      silent: payload.soundEnabled === false,
      data: { target_url: targetUrl },
    };
    if (payload.vibrationEnabled !== false) {
      webOptions.vibrate = [200, 100, 200];
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
        // Fallback ke new Notification()
      }
    }

    const notif = new window.Notification(title, webOptions);
    notif.onclick = () => {
      try {
        window.focus();
        if (targetUrl) {
          window.dispatchEvent(
            new CustomEvent(NOTIF_NAVIGATE_EVENT, { detail: { targetUrl } })
          );
        }
        notif.close();
      } catch {
        // Abaikan
      }
    };
    return true;
  } catch {
    return false;
  }
}

export function registerOsNotificationTapListener(
  onNavigateTarget?: (targetUrl: string) => void
): () => void {
  const cleanups: Array<() => void> = [];

  if (typeof window !== 'undefined') {
    const onWebNav = (e: Event) => {
      const detail = (e as CustomEvent<{ targetUrl?: string }>).detail;
      if (detail?.targetUrl && onNavigateTarget) {
        onNavigateTarget(detail.targetUrl);
      }
    };
    window.addEventListener(NOTIF_NAVIGATE_EVENT, onWebNav);
    cleanups.push(() => window.removeEventListener(NOTIF_NAVIGATE_EVENT, onWebNav));
  }

  if (isNativeApp()) {
    let removed = false;
    let handleRemove: (() => Promise<void>) | null = null;
    void (async () => {
      try {
        await ensureNativePushListeners();
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        const handle = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (action) => {
            const extra = action?.notification?.extra as { target_url?: string } | undefined;
            if (extra?.target_url && onNavigateTarget) {
              onNavigateTarget(extra.target_url);
            }
          }
        );
        if (removed) {
          await handle.remove();
        } else {
          handleRemove = () => handle.remove();
        }
      } catch {
        // Abaikan
      }
    })();

    cleanups.push(() => {
      removed = true;
      if (handleRemove) {
        void handleRemove().catch(() => {});
      }
    });
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

export interface TestNotificationResult {
  soundPlayed: boolean;
  vibrated: boolean;
  osPopupShown: boolean;
  permission: OsNotificationPermissionState;
}

export interface TriggerDeviceAlertOptions {
  id?: string;
  targetUrl?: string;
  requestPermissionIfPrompt?: boolean;
  skipDedupe?: boolean;
  skipOsPopup?: boolean;
}

export async function triggerDeviceAlert(
  title: string,
  message: string,
  options?: TriggerDeviceAlertOptions
): Promise<TestNotificationResult> {
  const notifId = options?.id?.trim();
  if (notifId && !options?.skipDedupe) {
    if (alertedIds.has(notifId)) {
      const currentPerm = await checkOsNotificationPermission();
      return {
        soundPlayed: false,
        vibrated: false,
        osPopupShown: false,
        permission: currentPerm,
      };
    }
    alertedIds.add(notifId);
    if (alertedIds.size > 300) {
      const first = alertedIds.values().next().value;
      if (first) alertedIds.delete(first);
    }
  }

  emitBellShakeEvent();

  const prefs = getNotificationPreferences();
  await ensureAndroidNotificationChannel();

  let permission = await checkOsNotificationPermission();
  if (permission === 'prompt' && (options?.requestPermissionIfPrompt || isNativeApp())) {
    permission = await requestOsNotificationPermission();
  }

  const safeTitle = title?.trim() || 'Aktivitas Baru · Saung Kebun';
  const safeMessage = message?.trim() || 'Ketuk untuk melihat detail aktivitas terbaru.';

  const shouldShowOsPopup = !options?.skipOsPopup && permission === 'granted';

  const [soundPlayed, vibrated, osPopupShown] = await Promise.all([
    prefs.soundEnabled ? playNotificationChime() : Promise.resolve(false),
    prefs.vibrationEnabled ? triggerNotificationVibration() : Promise.resolve(false),
    shouldShowOsPopup
      ? showOsNotification({
          id: notifId || `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: safeTitle,
          body: safeMessage,
          targetUrl: options?.targetUrl,
          soundEnabled: prefs.soundEnabled,
          vibrationEnabled: prefs.vibrationEnabled,
        })
      : Promise.resolve(false),
  ]);

  return { soundPlayed, vibrated, osPopupShown, permission };
}

export async function triggerIncomingNotificationAlert(
  notif: ActivityNotification
): Promise<TestNotificationResult | null> {
  if (!notif || !notif.id) return null;
  return triggerDeviceAlert(
    notif.title || 'Aktivitas Baru · Saung Kebun',
    notif.message || 'Ketuk untuk melihat detail aktivitas terbaru.',
    {
      id: notif.id,
      targetUrl: notif.target_url,
    }
  );
}

export async function triggerTestNotificationAlert(
  session: SessionUser
): Promise<TestNotificationResult> {
  return triggerDeviceAlert(
    'Tes Notifikasi · Saung Kebun',
    `Halo ${session.nama_warga || 'Pengguna'}, suara, getaran, dan pop-up notifikasi HP Anda berfungsi dengan baik!`,
    {
      id: `test-${Date.now()}`,
      targetUrl:
        session.role === 'admin'
          ? 'tab:dashboard'
          : session.role === 'petugas'
            ? 'tab:info'
            : 'tab:beranda',
      requestPermissionIfPrompt: true,
      skipDedupe: true,
    }
  );
}
