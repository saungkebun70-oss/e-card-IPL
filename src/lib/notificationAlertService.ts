import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ActivityNotification, SessionUser } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import {
  buildNotificationContentSignature,
  buildNotificationDedupKey,
  createNotificationUuid,
  deduplicateNotifications,
} from './notificationDedup';

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
  webPushConfigured: boolean;
  channelId: string;
  isBackgroundSyncFallback: boolean;
  fallbackReason: string | null;
  isHuaweiDevice: boolean;
  periodicSyncSupported: boolean;
  periodicSyncRegistered: boolean;
  lastBackgroundPollAt: number | null;
}

export interface ForegroundPushToastPayload {
  title: string;
  body: string;
  targetUrl?: string;
}

export interface AdminTestPushResult {
  ok: boolean;
  sent: number;
  failed: number;
  matchedDevices: number;
  skipped?: boolean;
  message: string;
}

const PREFS_STORAGE_KEY = 'app_notif_prefs_v1';
const LAST_FCM_TOKEN_KEY = 'ecard_last_fcm_token_v1';
const PUSH_DEVICE_ID_KEY = 'ecard_push_device_id_v1';
const BG_POLL_SEEN_PREFIX = 'ecard_bg_poll_seen_v1:';
const LOCAL_BROADCAST_READ_PREFIX = 'ecard_broadcast_read_v1:';
const LOCAL_DISMISSED_NOTIF_PREFIX = 'ecard_notif_dismissed_v1:';
const PREFS_CHANGED_EVENT = 'ecard-notif-prefs-changed';
const PUSH_RUNTIME_CHANGED_EVENT = 'ecard-push-runtime-changed';
const BELL_SHAKE_EVENT = 'ecard-bell-shake';
const NOTIF_NAVIGATE_EVENT = 'ecard-notif-navigate';
const NOTIF_LIST_CHANGED_EVENT = 'ecard-activity-notifications-changed';
const FOREGROUND_PUSH_TOAST_EVENT = 'ecard-foreground-push-toast';
const PERIODIC_SYNC_TAG = 'ecard-notif-periodic-sync';
const ONE_OFF_SYNC_TAG = 'ecard-notif-bg-sync';

export const ANDROID_NOTIFICATION_CHANNEL_ID = 'saung_kebun_notif';
const LEGACY_ANDROID_CHANNEL_ID = 'saung_kebun_alerts';

const DEFAULT_PREFS: NotificationPreferences = {
  soundEnabled: true,
  vibrationEnabled: true,
  permissionPromptDismissed: false,
};

interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
}

const alertedIds = new Set<string>();
const alertedSignatures = new Map<string, number>();
const toastedSignatures = new Map<string, number>();
const ALERT_SIG_STORAGE_KEY = 'ecard_recent_alert_sigs_v1';
const ALERT_DEDUP_TTL_MS = 25_000;
const TOAST_DEDUP_TTL_MS = 20_000;
let pollDedupColMissing = false;
let sharedAudioContext: AudioContext | null = null;
let audioUnlockInstalled = false;
let androidChannelInitialized = false;
let nativeLaunchInitPromise: Promise<OsNotificationPermissionState> | null = null;
let pushListenersInstalled = false;
let pushListenersInstallPromise: Promise<boolean> | null = null;
let webPushSwRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let webForegroundListenerInstalled = false;
let swMessageListenerInstalled = false;
let wakeupSyncInstalled = false;
let wakeupPollIntervalId: number | null = null;
let cachedFcmToken: string | null = null;
let activePushSession: SessionUser | null = null;
let lastSyncedTokenSignature = '';
let fcmFallbackActive = false;
let fcmFallbackReason: string | null = null;
let periodicSyncRegistered = false;
let lastBackgroundPollAt: number | null = null;
let lastUnreadPollTriggeredAt = 0;
let inFlightUnreadPollPromise: Promise<{
  checked: boolean;
  unreadCount: number;
  newCount: number;
}> | null = null;
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

function getNativePlatformName(): 'android' | 'ios' | 'web' {
  try {
    if (Capacitor && typeof Capacitor.getPlatform === 'function') {
      const p = String(Capacitor.getPlatform() || 'web').toLowerCase();
      if (p === 'android' || p === 'ios') return p;
    }
  } catch {
    // Fallback web
  }
  return 'web';
}

function getFirebaseWebConfig(): FirebaseWebConfig | null {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
    const apiKey = (env.VITE_FIREBASE_API_KEY || '').trim();
    const projectId = (env.VITE_FIREBASE_PROJECT_ID || '').trim();
    const messagingSenderId = (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();
    const appId = (env.VITE_FIREBASE_APP_ID || '').trim();
    const vapidKey = (env.VITE_FIREBASE_VAPID_KEY || '').trim();

    if (!apiKey || !projectId || !messagingSenderId || !appId || !vapidKey) {
      return null;
    }

    return {
      apiKey,
      authDomain: (env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`).trim(),
      projectId,
      storageBucket: (env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`).trim(),
      messagingSenderId,
      appId,
      vapidKey,
    };
  } catch {
    return null;
  }
}

function normalizeIdPart(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Format standar user_id untuk tabel `user_push_tokens`:
 * - warga    -> warga:<blok>
 * - admin    -> admin:<id_atau_blok>
 * - keamanan -> keamanan:<id_atau_nama>
 */
export function resolveCanonicalUserIdForPush(session: SessionUser): string {
  if (session.role === 'warga') {
    return `warga:${normalizeIdPart(session.blok_rumah)}`;
  }
  if (session.role === 'admin') {
    const clean = normalizeIdPart(session.blok_rumah);
    return `admin:${clean === 'admin' ? 'andriansyah' : clean}`;
  }
  return `keamanan:${normalizeIdPart(session.petugas_id || session.blok_rumah || session.nama_warga)}`;
}

function resolvePushRole(session: SessionUser): 'warga' | 'admin' | 'keamanan' {
  if (session.role === 'admin') return 'admin';
  if (session.role === 'warga') return 'warga';
  return 'keamanan';
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

function getOrCreatePushDeviceId(): string {
  const platform = getNativePlatformName();
  try {
    if (typeof window === 'undefined') return `${platform}-ssr`;
    const existing = window.localStorage.getItem(PUSH_DEVICE_ID_KEY)?.trim() || '';
    if (existing) return existing;
    const generated = `${platform}-${createNotificationUuid()}`;
    window.localStorage.setItem(PUSH_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return `${platform}-${createNotificationUuid()}`;
  }
}

/**
 * Mengembalikan `true` jika perangkat sudah memiliki token FCM aktif (atau perangkat Android/iOS
 * dengan GMS yang dikelola oleh FCM), sehingga polling/Realtime tidak menembakkan
 * LocalNotifications / OS popup duplikat di atas push notification FCM.
 */
export function shouldSuppressOsPopupWhenFcmActive(): boolean {
  if (fcmFallbackActive) return false;
  if (readCachedFcmToken()) return true;
  if (isNativeApp() && !isLikelyHuaweiDevice()) return true;
  return false;
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

function readRecentAlertSigMap(): Record<string, number> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(ALERT_SIG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function claimAlertDedupKeys(keys: string[], ttlMs: number): boolean {
  const cleanKeys = keys.filter(Boolean);
  if (cleanKeys.length === 0) return true;
  const now = Date.now();

  if (alertedSignatures.size > 300) {
    for (const [k, ts] of alertedSignatures.entries()) {
      if (now - ts > ttlMs) alertedSignatures.delete(k);
    }
  }

  for (const k of cleanKeys) {
    const memTs = alertedSignatures.get(k);
    if (memTs && now - memTs < ttlMs) {
      return false;
    }
  }

  const stored = readRecentAlertSigMap();
  const pruned: Record<string, number> = {};
  for (const [k, ts] of Object.entries(stored)) {
    if (typeof ts === 'number' && now - ts < ttlMs) {
      pruned[k] = ts;
    }
  }

  for (const k of cleanKeys) {
    if (typeof pruned[k] === 'number' && now - pruned[k] < ttlMs) {
      alertedSignatures.set(k, pruned[k]);
      return false;
    }
  }

  for (const k of cleanKeys) {
    alertedSignatures.set(k, now);
    pruned[k] = now;
  }

  try {
    if (typeof window !== 'undefined') {
      const entries = Object.entries(pruned).slice(-80);
      window.localStorage.setItem(ALERT_SIG_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    }
  } catch {
    // Abaikan keterbatasan storage
  }
  return true;
}

export function emitForegroundPushToast(
  payload: ForegroundPushToastPayload & { id?: string; dedupKey?: string }
): void {
  try {
    if (typeof window === 'undefined') return;
    const now = Date.now();
    const contentSig = buildNotificationContentSignature({
      category: 'system',
      title: payload.title,
      message: payload.body,
    });
    const keys = [
      payload.id ? `id:${payload.id}` : '',
      payload.dedupKey ? `dk:${payload.dedupKey.toLowerCase()}` : '',
      `sig:${contentSig}`,
    ].filter(Boolean);

    if (toastedSignatures.size > 200) {
      for (const [k, ts] of toastedSignatures.entries()) {
        if (now - ts > TOAST_DEDUP_TTL_MS) toastedSignatures.delete(k);
      }
    }
    if (keys.some((k) => {
      const prev = toastedSignatures.get(k);
      return Boolean(prev && now - prev < TOAST_DEDUP_TTL_MS);
    })) {
      return;
    }
    keys.forEach((k) => toastedSignatures.set(k, now));

    window.dispatchEvent(
      new CustomEvent(FOREGROUND_PUSH_TOAST_EVENT, {
        detail: {
          title: payload.title,
          body: payload.body,
          targetUrl: payload.targetUrl,
        },
      })
    );
  } catch {
    // Abaikan
  }
}

export function subscribeForegroundPushToast(
  callback: (payload: ForegroundPushToastPayload) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ForegroundPushToastPayload>).detail;
    if (detail && (detail.title || detail.body)) {
      callback(detail);
    }
  };
  window.addEventListener(FOREGROUND_PUSH_TOAST_EVENT, handler);
  return () => window.removeEventListener(FOREGROUND_PUSH_TOAST_EVENT, handler);
}

export function isLikelyHuaweiDevice(): boolean {
  try {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '');
    return /huawei|harmonyos|emui|honor|hms|huaweibrowser|petal|bah[0-9]|ags[0-9]|db[rs]-|btk-|agr-|kob2|mrx-|wgr-|scm-|dby-|tgr-|bg2-|jdn2|cmr-/i.test(
      ua
    );
  } catch {
    return false;
  }
}

function emitPushRuntimeChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(PUSH_RUNTIME_CHANGED_EVENT));
    }
  } catch {
    // Abaikan
  }
}

function markFcmFallback(active: boolean, reason?: string | null): void {
  const nextReason = active ? reason || 'Perangkat tidak memiliki layanan GMS/FCM aktif.' : null;
  if (fcmFallbackActive === active && fcmFallbackReason === nextReason) return;
  fcmFallbackActive = active;
  fcmFallbackReason = nextReason;
  emitPushRuntimeChanged();
}

export function subscribePushRuntimeInfoChange(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener(PUSH_RUNTIME_CHANGED_EVENT, handler);
  return () => window.removeEventListener(PUSH_RUNTIME_CHANGED_EVENT, handler);
}

/**
 * Pembungkus aman `isSupported()` Firebase Messaging untuk perangkat non-GMS (Huawei EMUI/HarmonyOS).
 * Tidak pernah melempar error atau menggantung jika Google Play Services / Push API dibatasi.
 */
export async function safeCheckFirebaseMessagingSupported(
  isSupportedFn?: () => Promise<boolean>
): Promise<boolean> {
  try {
    let checker = isSupportedFn;
    if (!checker) {
      const messagingMod = await import('firebase/messaging');
      checker = messagingMod.isSupported;
    }
    if (typeof checker !== 'function') return false;

    const supported = await Promise.race<boolean>([
      Promise.resolve()
        .then(() => checker!())
        .catch(() => false),
      new Promise<boolean>((resolve) => {
        if (typeof window !== 'undefined') {
          window.setTimeout(() => resolve(false), 4000);
        } else {
          setTimeout(() => resolve(false), 4000);
        }
      }),
    ]);
    return Boolean(supported);
  } catch {
    return false;
  }
}

/**
 * Pembungkus aman `getToken()` Firebase Messaging dengan proteksi try-catch dan timeout
 * agar perangkat Huawei tanpa Google Play Services (GMS) otomatis jatuh ke mode Background Sync Fallback.
 */
export async function safeGetFirebaseMessagingToken<TMessaging, TOptions>(
  getTokenFn: (messaging: TMessaging, options?: TOptions) => Promise<string>,
  messaging: TMessaging,
  options?: TOptions,
  timeoutMs = 8000
): Promise<{ token: string | null; error?: string }> {
  try {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ token: null; error: string }>((resolve) => {
      timerId = setTimeout(() => {
        resolve({
          token: null,
          error: 'Permintaan token FCM melewati batas waktu (perangkat tanpa GMS).',
        });
      }, timeoutMs);
    });

    const tokenPromise = Promise.resolve()
      .then(() => getTokenFn(messaging, options))
      .then((tok) => ({
        token: typeof tok === 'string' && tok.trim() ? tok.trim() : null,
        error: typeof tok === 'string' && tok.trim() ? undefined : 'Token FCM tidak dikembalikan.',
      }))
      .catch((err: unknown) => ({
        token: null,
        error: err instanceof Error ? err.message : String(err),
      }));

    const result = await Promise.race([tokenPromise, timeoutPromise]);
    if (timerId !== null) clearTimeout(timerId);
    return result;
  } catch (err) {
    return {
      token: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getNativePushRuntimeInfo(): NativePushRuntimeInfo {
  const isNative = isNativeApp();
  const platform = getNativePlatformName();
  const isHuaweiDevice = isLikelyHuaweiDevice();
  const webPushConfigured = Boolean(getFirebaseWebConfig());
  const webSupported =
    !isNative &&
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator;
  const periodicSyncSupported =
    !isNative &&
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PeriodicSyncManager' in window;
  const token = readCachedFcmToken();
  const hasToken = Boolean(token);
  const tokenPreview = token
    ? token.length > 20
      ? `${token.slice(0, 12)}...${token.slice(-6)}`
      : token
    : null;
  const isBackgroundSyncFallback = !hasToken && (fcmFallbackActive || isHuaweiDevice);

  return {
    isNative,
    platform,
    supported: isNative || webSupported,
    hasToken,
    hasFcmToken: hasToken,
    token,
    tokenPreview,
    webPushConfigured,
    channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
    isBackgroundSyncFallback,
    fallbackReason: isBackgroundSyncFallback
      ? fcmFallbackReason ||
        (isHuaweiDevice
          ? 'Perangkat Huawei (EMUI/HarmonyOS) menggunakan Background Sync Fallback.'
          : 'Token FCM belum tersedia, menggunakan Background Sync Fallback.')
      : null,
    isHuaweiDevice,
    periodicSyncSupported,
    periodicSyncRegistered,
    lastBackgroundPollAt,
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
 * Membuat Notification Channel Android `saung_kebun_notif` dengan importance: 5 (High / Pop-up & Suara aktif)
 * melalui LocalNotifications DAN PushNotifications agar notifikasi selalu tampil di layar kunci & status bar
 * meskipun aplikasi ditutup total (killed).
 */
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (!isNativeApp() || androidChannelInitialized) return;
  const platform = getNativePlatformName();
  if (platform !== 'android') {
    androidChannelInitialized = true;
    return;
  }

  const channels = [
    {
      id: ANDROID_NOTIFICATION_CHANNEL_ID,
      name: 'Notifikasi Saung Kebun',
      description: 'Notifikasi real-time IPL, Kas Lingkungan, Patroli Keamanan & Pengumuman',
      importance: 5 as const,
      visibility: 1 as const,
      sound: 'default',
      vibration: true,
      lights: true,
      lightColor: '#059669',
    },
    {
      id: LEGACY_ANDROID_CHANNEL_ID,
      name: 'Peringatan Saung Kebun',
      description: 'Channel kompatibilitas notifikasi Saung Kebun',
      importance: 5 as const,
      visibility: 1 as const,
      sound: 'default',
      vibration: true,
      lights: true,
      lightColor: '#059669',
    },
  ];

  let createdAny = false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (typeof LocalNotifications.createChannel === 'function') {
      for (const ch of channels) {
        await LocalNotifications.createChannel(ch);
      }
      createdAny = true;
    }
  } catch {
    // Abaikan jika LocalNotifications belum siap
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (typeof PushNotifications.createChannel === 'function') {
      for (const ch of channels) {
        await PushNotifications.createChannel(ch);
      }
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
 * Menyimpan/memperbarui token FCM/APNs/Web Push ke tabel Supabase `user_push_tokens`
 * dengan deduplikasi ketat:
 * - Menghapus token usang milik `device_id` yang sama saat rotasi token / ganti akun.
 * - Upsert berdasarkan `token` (UNIQUE per perangkat fisik) agar 1 HP tidak pernah memiliki
 *   lebih dari 1 token atau baris akun ganda di database.
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
  const role = resolvePushRole(session);
  const blokVal = session.blok_rumah?.trim() || null;
  const platform = getNativePlatformName();
  const deviceId = getOrCreatePushDeviceId();
  const signature = `${userId}::${role}::${blokVal || ''}::${platform}::${deviceId}::${cleanToken}`;

  if (signature === lastSyncedTokenSignature) {
    return { synced: true };
  }

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return { synced: false, error: 'Supabase belum terkonfigurasi' };
  }

  const nowIso = new Date().toISOString();
  const fullPayload = {
    user_id: userId,
    role,
    blok: blokVal,
    blok_rumah: blokVal,
    platform,
    device_id: deviceId,
    token: cleanToken,
    updated_at: nowIso,
  };

  const v8Payload = {
    user_id: userId,
    role,
    blok: blokVal,
    blok_rumah: blokVal,
    platform,
    token: cleanToken,
    updated_at: nowIso,
  };

  const legacyPayload = {
    user_id: userId,
    role: role === 'keamanan' ? 'petugas' : role,
    blok_rumah: blokVal,
    platform,
    token: cleanToken,
    updated_at: nowIso,
  };

  try {
    // Langkah 1: Bersihkan token lama pada device_id ini (jika kolom device_id tersedia)
    try {
      await supabase
        .from('user_push_tokens')
        .delete()
        .eq('device_id', deviceId)
        .neq('token', cleanToken);
    } catch {
      // Abaikan jika kolom device_id belum dimigrasi
    }

    // Langkah 2: Hapus baris akun lain yang masih menempel pada token fisik yang sama
    try {
      await supabase
        .from('user_push_tokens')
        .delete()
        .eq('token', cleanToken)
        .neq('user_id', userId);
    } catch {
      // Abaikan bila gagal
    }

    // Langkah 3a: Upsert berdasarkan `token` dengan `device_id` (skema v11)
    const { error: upsertTokenV11Err } = await supabase
      .from('user_push_tokens')
      .upsert(fullPayload, { onConflict: 'token' });

    if (!upsertTokenV11Err) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }

    // Langkah 3b: Upsert berdasarkan `(user_id, token)` dengan `device_id` bila constraint DB masih v8
    const { error: upsertCompositeV11Err } = await supabase
      .from('user_push_tokens')
      .upsert(fullPayload, { onConflict: 'user_id,token' });

    if (!upsertCompositeV11Err) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }

    // Langkah 3c: Fallback skema v8 (tanpa kolom `device_id`)
    const { error: upsertV8TokenErr } = await supabase
      .from('user_push_tokens')
      .upsert(v8Payload, { onConflict: 'token' });
    if (!upsertV8TokenErr) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }

    const { error: upsertV8CompositeErr } = await supabase
      .from('user_push_tokens')
      .upsert(v8Payload, { onConflict: 'user_id,token' });
    if (!upsertV8CompositeErr) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }

    // Langkah 4: Cek eksistensi token secara manual lalu update/insert
    const { data: existingRows } = await supabase
      .from('user_push_tokens')
      .select('id')
      .eq('token', cleanToken)
      .limit(1);

    if (Array.isArray(existingRows) && existingRows.length > 0 && existingRows[0]?.id) {
      const { error: updateErr } = await supabase
        .from('user_push_tokens')
        .update(v8Payload)
        .eq('id', existingRows[0].id);
      if (!updateErr) {
        lastSyncedTokenSignature = signature;
        return { synced: true };
      }
      const { error: legacyUpdateErr } = await supabase
        .from('user_push_tokens')
        .update(legacyPayload)
        .eq('id', existingRows[0].id);
      if (!legacyUpdateErr) {
        lastSyncedTokenSignature = signature;
        return { synced: true };
      }
      return { synced: false, error: legacyUpdateErr.message };
    }

    const { error: insertErr } = await supabase.from('user_push_tokens').insert(v8Payload);
    if (!insertErr) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }

    const { error: legacyUpsertErr } = await supabase
      .from('user_push_tokens')
      .upsert(legacyPayload, { onConflict: 'token' });
    if (!legacyUpsertErr) {
      lastSyncedTokenSignature = signature;
      return { synced: true };
    }

    return { synced: false, error: insertErr.message || legacyUpsertErr.message };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Menghapus HANYA token milik perangkat saat ini dari tabel `user_push_tokens` ketika user menekan tombol Keluar (Logout).
 * Perangkat lain milik akun yang sama (mis. Web saat logout di HP) tidak ikut terhapus.
 */
export async function removeCurrentDevicePushToken(session?: SessionUser | null): Promise<void> {
  const token = readCachedFcmToken();
  const deviceId = getOrCreatePushDeviceId();
  const targetSession = session || activePushSession;
  activePushSession = null;
  lastSyncedTokenSignature = '';
  void syncServiceWorkerPollingContext(null);

  if (!targetSession) return;

  const supabase = getSupabaseClient(targetSession);
  if (!supabase || !isSupabaseConfigured()) return;

  const userId = resolveCanonicalUserIdForPush(targetSession);
  try {
    if (token) {
      await supabase
        .from('user_push_tokens')
        .delete()
        .eq('token', token)
        .eq('user_id', userId);
    }
    await supabase
      .from('user_push_tokens')
      .delete()
      .eq('device_id', deviceId)
      .eq('user_id', userId);
  } catch {
    if (token) {
      try {
        await supabase.from('user_push_tokens').delete().eq('token', token);
      } catch {
        // Abaikan jika offline saat logout
      }
    }
  }
}

function buildSessionMatchUserIdsForPolling(session: SessionUser): string[] {
  const ids = new Set<string>(['broadcast:all']);
  if (session.role === 'warga') {
    ids.add('broadcast:warga');
    ids.add('role:warga');
    const cleanBlok = normalizeIdPart(session.blok_rumah);
    if (cleanBlok) {
      ids.add(`warga:${cleanBlok}`);
      ids.add(`warga:${cleanBlok.toUpperCase()}`);
      const parts = cleanBlok.split('/');
      if (parts.length === 2) {
        const prefixMatch = parts[0].match(/^([a-z]+)0*(\d+)$/i);
        const numMatch = parts[1].match(/^0*(\d+)$/);
        if (prefixMatch && numMatch) {
          const prefix = prefixMatch[1].toLowerCase();
          const bNum = Number(prefixMatch[2]);
          const hNum = Number(numMatch[1]);
          const unpadded = `${prefix}${bNum}/${hNum}`;
          const padded = `${prefix}${String(bNum).padStart(2, '0')}/${String(hNum).padStart(2, '0')}`;
          ids.add(`warga:${unpadded}`);
          ids.add(`warga:${unpadded.toUpperCase()}`);
          ids.add(`warga:${padded}`);
          ids.add(`warga:${padded.toUpperCase()}`);
        }
      }
    }
  } else if (session.role === 'admin') {
    ids.add('broadcast:admin');
    ids.add('role:admin');
    const rawBlok = normalizeIdPart(session.blok_rumah);
    if (rawBlok) {
      ids.add(`admin:${rawBlok === 'admin' ? 'andriansyah' : rawBlok}`);
      ids.add(`admin:${rawBlok}`);
    }
    if (session.jabatan === 'Bendahara' || session.admin_permission === 'full' || rawBlok === 'admin') {
      ids.add('admin:andriansyah');
      ids.add('admin:admin');
      ids.add('role:bendahara');
    }
    if (session.jabatan === 'Ketua' || rawBlok === 'erlangga') {
      ids.add('admin:erlangga');
      ids.add('role:ketua');
    }
  } else {
    ids.add('broadcast:petugas');
    ids.add('broadcast:keamanan');
    ids.add('role:petugas');
    ids.add('role:keamanan');
    if (session.petugas_id) {
      const cleanPid = normalizeIdPart(session.petugas_id);
      ids.add(`petugas:${cleanPid}`);
      ids.add(`keamanan:${cleanPid}`);
    }
    if (session.blok_rumah) {
      const cleanBlok = normalizeIdPart(session.blok_rumah);
      ids.add(`petugas:${cleanBlok}`);
      ids.add(`keamanan:${cleanBlok}`);
    }
    if (session.nama_warga) {
      const cleanNama = normalizeIdPart(session.nama_warga);
      ids.add(`petugas:${cleanNama}`);
      ids.add(`keamanan:${cleanNama}`);
    }
  }
  return Array.from(ids);
}

function resolveCanonicalNotificationActorId(session: SessionUser): string {
  if (session.role === 'warga') {
    return `warga:${normalizeIdPart(session.blok_rumah)}`;
  }
  if (session.role === 'admin') {
    const clean = normalizeIdPart(session.blok_rumah);
    return `admin:${clean === 'admin' ? 'andriansyah' : clean}`;
  }
  return `petugas:${normalizeIdPart(session.petugas_id || session.blok_rumah)}`;
}

function readStoredIdSet(storageKey: string): Set<string> | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set<string>();
  } catch {
    return null;
  }
}

function writeStoredIdSet(storageKey: string, set: Set<string>, maxItems = 250): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(set).slice(-maxItems)));
  } catch {
    // Abaikan keterbatasan storage
  }
}

/**
 * Mendaftarkan Periodic Background Sync & one-off Background Sync pada Service Worker
 * bila didukung oleh browser/WebView (termasuk fallback perangkat Huawei non-GMS).
 */
export async function registerPeriodicNotificationSync(
  registration?: ServiceWorkerRegistration | null
): Promise<boolean> {
  if (isNativeApp()) return false;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;

  try {
    const reg =
      registration ||
      (await Promise.race<ServiceWorkerRegistration | null>([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 2500)),
      ]));
    if (!reg) return false;

    let registered = false;
    const regWithSync = reg as ServiceWorkerRegistration & {
      periodicSync?: {
        register: (tag: string, options?: { minInterval?: number }) => Promise<void>;
      };
      sync?: {
        register: (tag: string) => Promise<void>;
      };
    };

    if (regWithSync.periodicSync && typeof regWithSync.periodicSync.register === 'function') {
      try {
        let canRegister = true;
        if (navigator.permissions && typeof navigator.permissions.query === 'function') {
          try {
            const status = await navigator.permissions.query({
              name: 'periodic-background-sync' as PermissionName,
            });
            if (status.state === 'denied') {
              canRegister = false;
            }
          } catch {
            // Browser/WebView tertentu tetap mengizinkan register meski query permission tidak mendukung nama ini
          }
        }
        if (canRegister) {
          await regWithSync.periodicSync.register(PERIODIC_SYNC_TAG, {
            minInterval: 15 * 60 * 1000,
          });
          registered = true;
        }
      } catch {
        // Periodic Sync dibatasi browser/OS — fallback tetap berjalan melalui wake-up listener
      }
    }

    if (regWithSync.sync && typeof regWithSync.sync.register === 'function') {
      try {
        await regWithSync.sync.register(ONE_OFF_SYNC_TAG);
      } catch {
        // Abaikan jika Background Sync belum didukung
      }
    }

    if (registered !== periodicSyncRegistered) {
      periodicSyncRegistered = registered;
      emitPushRuntimeChanged();
    }
    return registered;
  } catch {
    return false;
  }
}

/**
 * Mengirim konteks sesi (non-rahasia: URL publik, anon key, dan matchIds user) ke Service Worker
 * agar Periodic Background Sync bisa memeriksa tabel `notifications` Supabase saat aplikasi di latar belakang.
 */
export async function syncServiceWorkerPollingContext(session: SessionUser | null): Promise<void> {
  if (isNativeApp()) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    const reg = await registerWebPushServiceWorker();
    const targetWorker =
      reg?.active || reg?.waiting || reg?.installing || navigator.serviceWorker.controller;
    if (!targetWorker) return;

    if (!session) {
      targetWorker.postMessage({ type: 'ECARD_CLEAR_SYNC_CONTEXT' });
      return;
    }

    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
    const supabaseUrl = (env.VITE_SUPABASE_URL || '').trim();
    const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();
    if (!supabaseUrl || !supabaseAnonKey) return;

    targetWorker.postMessage({
      type: 'ECARD_SYNC_CONTEXT',
      context: {
        supabaseUrl,
        supabaseAnonKey,
        canonicalUserId: resolveCanonicalNotificationActorId(session),
        matchIds: buildSessionMatchUserIdsForPolling(session),
        headers: {
          'x-blok-rumah': session.blok_rumah || '',
          'x-user-role': session.role || 'anon',
          'x-admin-permission': session.admin_permission || '',
          'x-admin-jabatan': session.jabatan || '',
          'x-petugas-id': session.petugas_id || '',
          'x-petugas-name': session.role === 'petugas' ? session.nama_warga || '' : '',
        },
      },
    });
  } catch {
    // Abaikan jika SW belum siap
  }
}

/**
 * Mengecek langsung notifikasi belum terbaca (`is_read = false`) di tabel Supabase `notifications`
 * segera ketika layar tablet menyala, tab kembali fokus, atau koneksi internet pulih.
 */
export async function pollUnreadNotificationsNow(
  session?: SessionUser | null,
  options?: { silentSeed?: boolean; force?: boolean }
): Promise<{ checked: boolean; unreadCount: number; newCount: number }> {
  const targetSession = session || activePushSession;
  if (!targetSession) {
    return { checked: false, unreadCount: 0, newCount: 0 };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { checked: false, unreadCount: 0, newCount: 0 };
  }

  if (inFlightUnreadPollPromise) {
    return inFlightUnreadPollPromise;
  }

  const now = Date.now();
  if (!options?.force && now - lastUnreadPollTriggeredAt < 2500) {
    return { checked: false, unreadCount: 0, newCount: 0 };
  }
  lastUnreadPollTriggeredAt = now;

  inFlightUnreadPollPromise = (async () => {
    try {
      const supabase = getSupabaseClient(targetSession);
      if (!supabase || !isSupabaseConfigured()) {
        return { checked: false, unreadCount: 0, newCount: 0 };
      }

      const matchIds = buildSessionMatchUserIdsForPolling(targetSession);
      let data: Record<string, unknown>[] | null = null;
      let error: { message?: string } | null = null;

      if (!pollDedupColMissing) {
        const res = await supabase
          .from('notifications')
          .select(
            'id, user_id, actor_id, category, title, message, is_read, target_url, dedup_key, created_at'
          )
          .in('user_id', matchIds)
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(40);
        data = (res.data as Record<string, unknown>[] | null) ?? null;
        error = res.error;
      }

      if (
        pollDedupColMissing ||
        (error && String(error.message || '').toLowerCase().includes('dedup_key'))
      ) {
        pollDedupColMissing = true;
        const retry = await supabase
          .from('notifications')
          .select('id, user_id, actor_id, category, title, message, is_read, target_url, created_at')
          .in('user_id', matchIds)
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(40);
        data = (retry.data as Record<string, unknown>[] | null) ?? null;
        error = retry.error;
      }

      if (error || !Array.isArray(data)) {
        return { checked: false, unreadCount: 0, newCount: 0 };
      }

      const canonicalActorId = resolveCanonicalNotificationActorId(targetSession);
      const selfPersonalIds = new Set(
        matchIds
          .map((m) => normalizeIdPart(m))
          .filter((m) => !m.startsWith('broadcast:') && !m.startsWith('role:'))
      );
      selfPersonalIds.add(normalizeIdPart(canonicalActorId));

      const broadcastReadSet =
        readStoredIdSet(`${LOCAL_BROADCAST_READ_PREFIX}${canonicalActorId}`) || new Set<string>();
      const dismissedSet =
        readStoredIdSet(`${LOCAL_DISMISSED_NOTIF_PREFIX}${canonicalActorId}`) || new Set<string>();

      const seenStorageKey = `${BG_POLL_SEEN_PREFIX}${canonicalActorId}`;
      const existingSeen = readStoredIdSet(seenStorageKey);
      const hasSeededBefore = existingSeen !== null;
      const seenSet = existingSeen || new Set<string>();

      const normalizedCandidates: ActivityNotification[] = [];
      for (const raw of data) {
        const row = raw as Record<string, unknown>;
        const id = String(row.id || '').trim();
        const userId = String(row.user_id || '').trim();
        if (!id || dismissedSet.has(id)) continue;
        if (userId.toLowerCase().startsWith('broadcast:') && broadcastReadSet.has(id)) continue;

        normalizedCandidates.push({
          id,
          user_id: userId,
          actor_id: typeof row.actor_id === 'string' ? row.actor_id : null,
          category: (typeof row.category === 'string'
            ? row.category
            : 'system') as ActivityNotification['category'],
          title: String(row.title || 'Aktivitas Baru · Saung Kebun'),
          message: String(row.message || 'Ketuk untuk melihat detail aktivitas terbaru.'),
          is_read: false,
          target_url: String(row.target_url || ''),
          dedup_key: typeof row.dedup_key === 'string' ? row.dedup_key : null,
          created_at:
            typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
        });
      }

      const deduplicatedUnread = deduplicateNotifications(normalizedCandidates);
      const freshUnreadRows: ActivityNotification[] = [];
      const freshWindowMs = 3 * 60 * 1000;
      const currentMs = Date.now();

      for (const item of deduplicatedUnread) {
        if (seenSet.has(item.id)) continue;
        seenSet.add(item.id);
        if (item.dedup_key) {
          seenSet.add(`dk:${item.dedup_key.toLowerCase()}`);
        }

        const actorId = normalizeIdPart(item.actor_id);
        if (actorId && selfPersonalIds.has(actorId)) {
          continue;
        }

        const createdMs = Date.parse(item.created_at);
        const isRecent = !Number.isNaN(createdMs) && currentMs - createdMs <= freshWindowMs;
        if ((hasSeededBefore && !options?.silentSeed) || isRecent) {
          freshUnreadRows.push(item);
        }
      }

      writeStoredIdSet(seenStorageKey, seenSet, 250);
      lastBackgroundPollAt = Date.now();
      void syncAppIconBadge(deduplicatedUnread.length);

      if (freshUnreadRows.length > 0) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(NOTIF_LIST_CHANGED_EVENT));
        }

        const suppressOsPopup = shouldSuppressOsPopupWhenFcmActive();
        for (const item of freshUnreadRows.slice(0, 3)) {
          if (alertedIds.has(item.id)) continue;
          emitForegroundPushToast({
            id: item.id,
            dedupKey: item.dedup_key || undefined,
            title: item.title,
            body: item.message,
            targetUrl: item.target_url,
          });
          void triggerDeviceAlert(item.title, item.message, {
            id: item.id,
            dedupKey: item.dedup_key || undefined,
            targetUrl: item.target_url,
            skipOsPopup: suppressOsPopup,
          });
        }
      }

      emitPushRuntimeChanged();
      return {
        checked: true,
        unreadCount: deduplicatedUnread.length,
        newCount: freshUnreadRows.length,
      };
    } catch {
      return { checked: false, unreadCount: 0, newCount: 0 };
    } finally {
      inFlightUnreadPollPromise = null;
    }
  })();

  return inFlightUnreadPollPromise;
}

/**
 * Memasang listener agresif `visibilitychange`, `focus`, `pageshow`, `online`, dan `resume`
 * agar begitu layar tablet Huawei menyala atau koneksi internet pulih, aplikasi langsung
 * mengecek notifikasi belum terbaca di Supabase tanpa menunggu FCM GMS.
 */
export function installAggressiveNotificationWakeupSync(session?: SessionUser | null): void {
  if (session) {
    activePushSession = session;
  }
  if (typeof window === 'undefined') return;
  if (wakeupSyncInstalled) return;
  wakeupSyncInstalled = true;

  const triggerWakeupCheck = (reason: 'visible' | 'focus' | 'online' | 'resume' | 'interval') => {
    const currentSession = activePushSession;
    if (!currentSession) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    void pollUnreadNotificationsNow(currentSession, {
      force: reason === 'online' || reason === 'visible' || reason === 'resume',
    });

    // Saat koneksi pulih atau layar menyala di mode fallback, sinkronkan ulang SW & coba token jika belum ada
    if (reason === 'online' || reason === 'visible') {
      void syncServiceWorkerPollingContext(currentSession);
      if (!readCachedFcmToken() && !isNativeApp() && window.Notification?.permission === 'granted') {
        void syncNativePushTokenForSession(currentSession);
      }
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        triggerWakeupCheck('visible');
      }
    });
    document.addEventListener('resume', () => {
      triggerWakeupCheck('resume');
    });
  }

  window.addEventListener('focus', () => {
    triggerWakeupCheck('focus');
  });

  window.addEventListener('pageshow', () => {
    triggerWakeupCheck('visible');
  });

  window.addEventListener('online', () => {
    triggerWakeupCheck('online');
  });

  // Polling berkala saat layar aktif untuk perangkat non-GMS atau saat WebSocket terputus oleh EMUI
  if (wakeupPollIntervalId !== null) {
    window.clearInterval(wakeupPollIntervalId);
  }
  wakeupPollIntervalId = window.setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (!activePushSession) return;
    const intervalMs = fcmFallbackActive || isLikelyHuaweiDevice() ? 20000 : 45000;
    if (Date.now() - lastUnreadPollTriggeredAt >= intervalMs - 1000) {
      triggerWakeupCheck('interval');
    }
  }, 15000);
}

/**
 * Mendaftarkan Service Worker `public/firebase-messaging-sw.js` otomatis pada browser Web (Chrome & Safari).
 */
export async function registerWebPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isNativeApp()) return null;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

  if (!swMessageListenerInstalled) {
    swMessageListenerInstalled = true;
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string; targetUrl?: string } | null;
      if (data?.type === 'ECARD_NOTIFICATION_CLICK') {
        if (data.targetUrl) {
          window.dispatchEvent(
            new CustomEvent(NOTIF_NAVIGATE_EVENT, { detail: { targetUrl: data.targetUrl } })
          );
        }
        window.dispatchEvent(new CustomEvent(NOTIF_LIST_CHANGED_EVENT));
        if (activePushSession) {
          void pollUnreadNotificationsNow(activePushSession, { force: true });
        }
      } else if (data?.type === 'ECARD_BG_SYNC_NEW_NOTIFICATIONS') {
        window.dispatchEvent(new CustomEvent(NOTIF_LIST_CHANGED_EVENT));
      }
    });
  }

  if (webPushSwRegistrationPromise) {
    return webPushSwRegistrationPromise;
  }

  webPushSwRegistrationPromise = (async () => {
    try {
      const cfg = getFirebaseWebConfig();
      const params = new URLSearchParams();
      if (cfg) {
        params.set('apiKey', cfg.apiKey);
        params.set('authDomain', cfg.authDomain);
        params.set('projectId', cfg.projectId);
        params.set('storageBucket', cfg.storageBucket);
        params.set('messagingSenderId', cfg.messagingSenderId);
        params.set('appId', cfg.appId);
      }
      const swUrl = params.toString()
        ? `/firebase-messaging-sw.js?${params.toString()}`
        : '/firebase-messaging-sw.js';

      const registration = await navigator.serviceWorker.register(swUrl, { scope: '/' });

      // Kirim ulang config ke SW aktif apabila SW sudah terpasang sebelumnya
      if (cfg && registration.active) {
        registration.active.postMessage({
          type: 'ECARD_FIREBASE_CONFIG',
          config: {
            apiKey: cfg.apiKey,
            authDomain: cfg.authDomain,
            projectId: cfg.projectId,
            storageBucket: cfg.storageBucket,
            messagingSenderId: cfg.messagingSenderId,
            appId: cfg.appId,
          },
        });
      }

      void registerPeriodicNotificationSync(registration);
      return registration;
    } catch {
      webPushSwRegistrationPromise = null;
      return null;
    }
  })();

  return webPushSwRegistrationPromise;
}

/**
 * Menginisialisasi Firebase Web Push (Chrome & Safari), mengambil token FCM Web secara aman
 * (dengan try-catch `isSupported()` & `getToken()` untuk perangkat Huawei tanpa GMS),
 * memasang listener foreground `onMessage`, dan menyinkronkan token ke `user_push_tokens`.
 */
async function syncWebPushTokenForSession(
  session: SessionUser
): Promise<{ ok: boolean; synced: boolean; token: string | null; error?: string }> {
  if (isNativeApp()) {
    return { ok: false, synced: false, token: null };
  }

  const registration = await registerWebPushServiceWorker();
  void syncServiceWorkerPollingContext(session);
  void registerPeriodicNotificationSync(registration);

  const cfg = getFirebaseWebConfig();
  if (!cfg) {
    if (isLikelyHuaweiDevice()) {
      markFcmFallback(true, 'Mode Background Sync Fallback aktif untuk perangkat Huawei.');
    }
    return {
      ok: false,
      synced: false,
      token: readCachedFcmToken(),
      error: 'Konfigurasi VITE_FIREBASE_* & VITE_FIREBASE_VAPID_KEY belum diatur.',
    };
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    markFcmFallback(true, 'Browser tidak mendukung Web Push FCM, menggunakan Background Sync Fallback.');
    return { ok: false, synced: false, token: null, error: 'Browser tidak mendukung Web Notification.' };
  }

  if (window.Notification.permission !== 'granted') {
    return { ok: false, synced: false, token: null, error: 'Izin notifikasi browser belum diberikan.' };
  }

  try {
    const [{ initializeApp, getApps }, { getMessaging, getToken, isSupported, onMessage }] =
      await Promise.all([import('firebase/app'), import('firebase/messaging')]);

    const supported = await safeCheckFirebaseMessagingSupported(isSupported);
    if (!supported) {
      markFcmFallback(
        true,
        'Browser/perangkat tanpa GMS tidak mendukung FCM Web Push. Menggunakan Background Sync Fallback.'
      );
      return {
        ok: false,
        synced: false,
        token: null,
        error: 'Browser/perangkat ini belum mendukung FCM Web Push.',
      };
    }

    const appName = 'ecard-saung-kebun-webpush';
    const existingApp = getApps().find((a) => a.name === appName);
    const firebaseApp =
      existingApp ||
      initializeApp(
        {
          apiKey: cfg.apiKey,
          authDomain: cfg.authDomain,
          projectId: cfg.projectId,
          storageBucket: cfg.storageBucket,
          messagingSenderId: cfg.messagingSenderId,
          appId: cfg.appId,
        },
        appName
      );

    let messaging;
    try {
      messaging = getMessaging(firebaseApp);
    } catch (msgErr) {
      markFcmFallback(
        true,
        'Layanan Firebase Messaging tidak tersedia (non-GMS). Menggunakan Background Sync Fallback.'
      );
      return {
        ok: false,
        synced: false,
        token: null,
        error: msgErr instanceof Error ? msgErr.message : String(msgErr),
      };
    }

    if (!webForegroundListenerInstalled) {
      try {
        webForegroundListenerInstalled = true;
        onMessage(messaging, (payload) => {
          const data = (payload?.data || {}) as Record<string, string>;
          const title =
            payload?.notification?.title || data.title || 'Aktivitas Baru · Saung Kebun';
          const body =
            payload?.notification?.body ||
            data.body ||
            'Ketuk untuk melihat detail aktivitas terbaru.';
          const targetUrl = data.target_url || '';
          const notifId = data.notification_id || '';
          const dedupKey = data.dedup_key || notifId || '';

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(NOTIF_LIST_CHANGED_EVENT));
          }

          emitForegroundPushToast({
            id: notifId || undefined,
            dedupKey: dedupKey || undefined,
            title,
            body,
            targetUrl,
          });
          void triggerDeviceAlert(title, body, {
            id: notifId || undefined,
            dedupKey: dedupKey || undefined,
            targetUrl,
          });
        });
      } catch {
        webForegroundListenerInstalled = false;
      }
    }

    const tokenRes = await safeGetFirebaseMessagingToken(
      getToken,
      messaging,
      {
        vapidKey: cfg.vapidKey,
        serviceWorkerRegistration: registration || undefined,
      },
      8000
    );

    if (!tokenRes.token) {
      markFcmFallback(
        true,
        'Token FCM gagal diperoleh (perangkat Huawei / non-GMS). Menggunakan Background Sync Fallback.'
      );
      return {
        ok: false,
        synced: false,
        token: null,
        error: tokenRes.error || 'Token FCM Web gagal diperoleh.',
      };
    }

    writeCachedFcmToken(tokenRes.token);
    markFcmFallback(false, null);
    emitPushRuntimeChanged();
    const persistRes = await persistFcmTokenToSupabase(session, tokenRes.token);
    return {
      ok: true,
      synced: persistRes.synced,
      token: tokenRes.token,
      error: persistRes.error,
    };
  } catch (err) {
    markFcmFallback(
      true,
      'Firebase Messaging tidak tersedia pada perangkat ini. Menggunakan Background Sync Fallback.'
    );
    return {
      ok: false,
      synced: false,
      token: readCachedFcmToken(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Mendaftarkan listener `@capacitor/push-notifications` SEBELUM `register()` dipanggil (Android & iOS):
 * - `registration`: simpan token FCM/APNs ke cache lokal & sinkronkan ke `user_push_tokens`
 * - `registrationError`: aktifkan mode Background Sync Fallback tanpa menghentikan aplikasi (aman untuk Huawei non-GMS)
 * - `pushNotificationReceived`: refresh daftar notifikasi, tampilkan toast foreground & picu alert
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
          markFcmFallback(
            true,
            'Token FCM kosong (perangkat non-GMS). Menggunakan Background Sync Fallback.'
          );
          resolvePendingTokenWaiters(null);
          return;
        }
        writeCachedFcmToken(nextToken);
        markFcmFallback(false, null);
        emitPushRuntimeChanged();
        resolvePendingTokenWaiters(nextToken);
        if (activePushSession) {
          void persistFcmTokenToSupabase(activePushSession, nextToken);
        }
      });

      await PushNotifications.addListener('registrationError', () => {
        markFcmFallback(
          true,
          'Google Play Services / FCM tidak tersedia pada perangkat ini. Menggunakan Background Sync Fallback.'
        );
        resolvePendingTokenWaiters(null);
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const data = (notification?.data || {}) as Record<string, unknown>;
        const notifId =
          typeof data.notification_id === 'string' && data.notification_id.trim()
            ? data.notification_id.trim()
            : notification?.id
              ? String(notification.id)
              : '';
        const dedupKey =
          typeof data.dedup_key === 'string' && data.dedup_key.trim()
            ? data.dedup_key.trim()
            : notifId;
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

        emitForegroundPushToast({
          id: notifId || undefined,
          dedupKey: dedupKey || undefined,
          title,
          body,
          targetUrl,
        });

        const isIos = getNativePlatformName() === 'ios';
        const hasFcmNotificationPayload = Boolean(notification?.title || notification?.body);
        void triggerDeviceAlert(title, body, {
          id: notifId || undefined,
          dedupKey: dedupKey || undefined,
          targetUrl,
          // Jika payload FCM sudah membawa objek `notification`, JANGAN panggil LocalNotifications lagi
          skipOsPopup: isIos || hasFcmNotificationPayload,
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
      markFcmFallback(
        true,
        'Plugin Push FCM tidak tersedia di perangkat ini. Menggunakan Background Sync Fallback.'
      );
      return false;
    } finally {
      pushListenersInstallPromise = null;
    }
  })();

  return pushListenersInstallPromise;
}

/**
 * Mendaftarkan perangkat Android/iOS (Capacitor) MAUPUN Web Browser (Chrome/Safari) ke FCM,
 * menyimpan token ke cache lokal, dan menyinkronkannya ke tabel Supabase `user_push_tokens`
 * dengan upsert `(user_id, token)`. Aman di perangkat Huawei tanpa GMS.
 */
export async function syncNativePushTokenForSession(
  session?: SessionUser | null
): Promise<{ ok: boolean; synced: boolean; token: string | null; error?: string }> {
  if (!session) {
    return { ok: false, synced: false, token: null };
  }

  activePushSession = session;

  if (inFlightPushSyncPromise) {
    return inFlightPushSyncPromise;
  }

  inFlightPushSyncPromise = (async () => {
    try {
      if (!isNativeApp()) {
        return await syncWebPushTokenForSession(session);
      }

      await ensureAndroidNotificationChannel();
      const listenersReady = await ensureNativePushListeners();
      if (!listenersReady) {
        markFcmFallback(
          true,
          'Plugin Push FCM tidak tersedia. Menggunakan Background Sync Fallback.'
        );
        return {
          ok: false,
          synced: false,
          token: readCachedFcmToken(),
          error: 'Plugin Push tidak tersedia',
        };
      }

      const { PushNotifications } = await import('@capacitor/push-notifications');
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        return {
          ok: false,
          synced: false,
          token: null,
          error: 'Izin push notification belum diberikan',
        };
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

      try {
        await PushNotifications.register();
      } catch (regErr) {
        markFcmFallback(
          true,
          'Registrasi FCM tidak didukung (non-GMS / Huawei). Menggunakan Background Sync Fallback.'
        );
        return {
          ok: false,
          synced: false,
          token: readCachedFcmToken(),
          error: regErr instanceof Error ? regErr.message : String(regErr),
        };
      }

      const token = (await tokenPromise) || readCachedFcmToken();

      if (!token) {
        markFcmFallback(
          true,
          'Token FCM tidak diperoleh (perangkat Huawei non-GMS). Menggunakan Background Sync Fallback.'
        );
        return { ok: false, synced: false, token: null, error: 'Token FCM/APNs belum diperoleh' };
      }

      writeCachedFcmToken(token);
      markFcmFallback(false, null);
      emitPushRuntimeChanged();
      const persistRes = await persistFcmTokenToSupabase(session, token);
      return {
        ok: true,
        synced: persistRes.synced,
        token,
        error: persistRes.error,
      };
    } catch (err) {
      markFcmFallback(
        true,
        'Gagal terhubung ke layanan FCM. Menggunakan Background Sync Fallback.'
      );
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
 * Dipanggil otomatis saat aplikasi (Android APK, iOS, maupun Web Browser) dibuka atau saat sesi login berubah:
 * - Memasang listener agresif `visibilitychange`/`focus`/`online`/`resume` + Periodic Background Sync
 * - Di Web: mendaftarkan `public/firebase-messaging-sw.js`, mengirim konteks polling SW, & menyinkronkan token FCM Web secara aman
 * - Di Android/iOS: membuat channel `saung_kebun_notif`, memasang listener SEBELUM `register()`, & fallback aman untuk Huawei non-GMS
 */
export async function initNativeNotificationsOnLaunch(
  session?: SessionUser | null
): Promise<OsNotificationPermissionState> {
  if (session) {
    activePushSession = session;
  }

  installAggressiveNotificationWakeupSync(session || null);

  if (!isNativeApp()) {
    void registerWebPushServiceWorker().then((reg) => {
      if (session) {
        void syncServiceWorkerPollingContext(session);
      }
      if (reg) {
        void registerPeriodicNotificationSync(reg);
      }
    });

    const webPerm = await checkOsNotificationPermission();
    if (session) {
      void pollUnreadNotificationsNow(session, { silentSeed: true });
      if (webPerm === 'granted') {
        void syncNativePushTokenForSession(session);
      } else if (webPerm === 'unsupported' || isLikelyHuaweiDevice()) {
        markFcmFallback(
          true,
          'Menggunakan Background Sync Fallback agar notifikasi tetap terpantau di perangkat ini.'
        );
      }
    }
    return webPerm;
  }

  if (!nativeLaunchInitPromise) {
    nativeLaunchInitPromise = (async () => {
      try {
        await ensureAndroidNotificationChannel();
        // Wajib pasang seluruh listener SEBELUM register() dipanggil
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
            try {
              await PushNotifications.register();
            } catch {
              markFcmFallback(
                true,
                'Google Play Services tidak tersedia. Menggunakan Background Sync Fallback.'
              );
            }
          } else if (pushPerm.receive === 'denied') {
            pushStatus = 'denied';
          }
        } catch {
          // Fallback tetap aman dengan LocalNotifications + Background Sync
          markFcmFallback(
            true,
            'Layanan FCM tidak tersedia. Menggunakan Background Sync Fallback & Local Notifications.'
          );
        }

        if (localStatus === 'granted' || pushStatus === 'granted') return 'granted';
        if (localStatus === 'denied' || pushStatus === 'denied') return 'denied';
        return 'prompt';
      } catch {
        return 'unsupported';
      }
    })();
  }

  const permission = await nativeLaunchInitPromise;

  if (session) {
    void pollUnreadNotificationsNow(session, { silentSeed: true });
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
    await registerWebPushServiceWorker();
    const perm = await window.Notification.requestPermission();
    if (perm === 'granted') {
      if (activePushSession) {
        void syncNativePushTokenForSession(activePushSession);
      }
      return 'granted';
    }
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

    const webOptions: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag,
      renotify: true,
      requireInteraction: true,
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

    // Tangani deep-link ?notif_target=... ketika aplikasi dibuka dari Web Push background click
    try {
      const url = new URL(window.location.href);
      const pendingTarget = url.searchParams.get('notif_target')?.trim();
      if (pendingTarget && onNavigateTarget) {
        url.searchParams.delete('notif_target');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
        window.setTimeout(() => onNavigateTarget(pendingTarget), 250);
      }
    } catch {
      // Abaikan
    }
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
  dedupKey?: string;
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
  const safeTitle = title?.trim() || 'Aktivitas Baru · Saung Kebun';
  const safeMessage = message?.trim() || 'Ketuk untuk melihat detail aktivitas terbaru.';
  const notifId = options?.id?.trim();
  const dedupKey = options?.dedupKey?.trim();
  const contentSig = buildNotificationContentSignature({
    category: 'system',
    title: safeTitle,
    message: safeMessage,
  });

  if (!options?.skipDedupe) {
    if (notifId && alertedIds.has(notifId)) {
      const currentPerm = await checkOsNotificationPermission();
      return {
        soundPlayed: false,
        vibrated: false,
        osPopupShown: false,
        permission: currentPerm,
      };
    }

    const keysToClaim = [
      notifId ? `id:${notifId}` : '',
      dedupKey ? `dk:${dedupKey.toLowerCase()}` : '',
      `sig:${contentSig}`,
    ].filter(Boolean);

    if (!claimAlertDedupKeys(keysToClaim, ALERT_DEDUP_TTL_MS)) {
      const currentPerm = await checkOsNotificationPermission();
      return {
        soundPlayed: false,
        vibrated: false,
        osPopupShown: false,
        permission: currentPerm,
      };
    }

    if (notifId) {
      alertedIds.add(notifId);
      if (alertedIds.size > 300) {
        const first = alertedIds.values().next().value;
        if (first) alertedIds.delete(first);
      }
    }
  }

  emitBellShakeEvent();

  const prefs = getNotificationPreferences();
  await ensureAndroidNotificationChannel();

  let permission = await checkOsNotificationPermission();
  if (permission === 'prompt' && (options?.requestPermissionIfPrompt || isNativeApp())) {
    permission = await requestOsNotificationPermission();
  }

  const shouldShowOsPopup = !options?.skipOsPopup && permission === 'granted';
  const stableTag =
    dedupKey ||
    notifId ||
    `sk-${hashToSafeNotificationId(`${safeTitle}::${safeMessage}`)}`;

  const [soundPlayed, vibrated, osPopupShown] = await Promise.all([
    prefs.soundEnabled ? playNotificationChime() : Promise.resolve(false),
    prefs.vibrationEnabled ? triggerNotificationVibration() : Promise.resolve(false),
    shouldShowOsPopup
      ? showOsNotification({
          id: stableTag,
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
      dedupKey: notif.dedup_key || undefined,
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

/**
 * Tombol "Tes Kirim Notifikasi" khusus Pengurus (Admin) untuk menguji jalur server FCM end-to-end
 * (Edge Function `send-push-notification` -> FCM v1 -> Android / iOS / Web) tanpa membuat transaksi palsu.
 */
export async function sendAdminTestPushNotification(
  session: SessionUser,
  mode: 'self' | 'broadcast'
): Promise<AdminTestPushResult> {
  if (session.role !== 'admin') {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      matchedDevices: 0,
      message: 'Fitur tes kirim server push hanya tersedia untuk Pengurus (Admin).',
    };
  }

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      matchedDevices: 0,
      message: 'Supabase belum terkonfigurasi. Hubungkan proyek Supabase untuk menguji server FCM.',
    };
  }

  // Pastikan token perangkat saat ini ikut tersinkron terlebih dahulu sebelum tes dikirim
  await syncNativePushTokenForSession(session).catch(() => {});

  const canonicalAdminId = resolveCanonicalUserIdForPush(session);
  const senderLabel = `${session.nama_warga || 'Pengurus'}${session.jabatan ? ` (${session.jabatan})` : ''}`;
  const testNotifId = createNotificationUuid();
  const testDedupKey = buildNotificationDedupKey({
    dedupKey: `fcm-test:${mode}:${testNotifId}`,
  });

  const bodyPayload =
    mode === 'broadcast'
      ? {
          id: testNotifId,
          dedup_key: testDedupKey,
          broadcast: true,
          include_self: true,
          actor_id: canonicalAdminId,
          category: 'announcement',
          title: 'Tes Broadcast Notifikasi · Saung Kebun',
          body: `Uji coba pengiriman notifikasi real-time oleh ${senderLabel}. Perangkat Anda terhubung dengan sistem push e-Card IPL.`,
          target_url: 'tab:beranda',
          data: {
            test_mode: 'broadcast',
            dedup_key: testDedupKey,
          },
        }
      : {
          id: testNotifId,
          dedup_key: testDedupKey,
          target_user_ids: [canonicalAdminId],
          include_self: true,
          actor_id: canonicalAdminId,
          category: 'system',
          title: 'Tes Push Server FCM · Saung Kebun',
          body: `Halo ${senderLabel}, jalur Push Notification server FCM ke perangkat Anda berhasil & aktif!`,
          target_url: 'tab:dashboard',
          data: {
            test_mode: 'self',
            dedup_key: testDedupKey,
          },
        };

  // Simpan juga 1 riwayat tes ke tabel `notifications` dengan ID & dedup_key yang sama
  const notifTargetUserId = mode === 'broadcast' ? 'broadcast:all' : canonicalAdminId;
  try {
    const baseRow: Record<string, unknown> = {
      id: testNotifId,
      user_id: notifTargetUserId,
      actor_id: 'system:fcm-test',
      actor_name: session.nama_warga || 'Pengurus',
      actor_avatar_url: session.avatar_url || null,
      category: mode === 'broadcast' ? 'announcement' : 'system',
      title: bodyPayload.title,
      message: bodyPayload.body,
      is_read: false,
      target_url: bodyPayload.target_url,
      created_at: new Date().toISOString(),
    };
    const payloadRow: Record<string, unknown> = pollDedupColMissing
      ? baseRow
      : { ...baseRow, dedup_key: testDedupKey };
    const { error: insErr } = await supabase.from('notifications').insert(payloadRow);
    if (
      insErr &&
      !pollDedupColMissing &&
      String(insErr.message || '').toLowerCase().includes('dedup_key')
    ) {
      pollDedupColMissing = true;
      await supabase.from('notifications').insert(baseRow);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(NOTIF_LIST_CHANGED_EVENT));
    }
  } catch {
    // Tetap lanjutkan pengiriman Edge Function FCM meskipun insert riwayat lonceng terkendala
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: bodyPayload,
    });

    if (error) {
      return {
        ok: false,
        sent: 0,
        failed: 0,
        matchedDevices: 0,
        message: `Riwayat tes tercatat di Lonceng, namun gagal memanggil Edge Function send-push-notification: ${error.message}`,
      };
    }

    const res = (data || {}) as {
      ok?: boolean;
      sent?: number;
      failed?: number;
      matchedDevices?: number;
      skipped?: boolean;
      reason?: string;
      error?: string;
    };

    if (res.skipped) {
      return {
        ok: false,
        sent: 0,
        failed: 0,
        matchedDevices: 0,
        skipped: true,
        message:
          res.reason ||
          'Secret FIREBASE_SERVICE_ACCOUNT belum diatur di Supabase Edge Functions.',
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        sent: res.sent || 0,
        failed: res.failed || 0,
        matchedDevices: res.matchedDevices || 0,
        message: res.error || 'Server push mengembalikan kesalahan.',
      };
    }

    const sent = Number(res.sent || 0);
    const failed = Number(res.failed || 0);
    const matched = Number(res.matchedDevices || 0);

    if (sent === 0 && matched === 0) {
      return {
        ok: true,
        sent: 0,
        failed: 0,
        matchedDevices: 0,
        message:
          mode === 'self'
            ? 'Server FCM aktif, namun belum ada token perangkat untuk akun Anda di user_push_tokens. Pastikan izin notifikasi sudah aktif.'
            : 'Server FCM aktif, namun belum ada token perangkat terdaftar di tabel user_push_tokens.',
      };
    }

    return {
      ok: true,
      sent,
      failed,
      matchedDevices: matched,
      message:
        mode === 'broadcast'
          ? `Broadcast tes FCM terkirim ke ${sent} perangkat aktif${failed > 0 ? ` (${failed} gagal/kedaluwarsa)` : ''}.`
          : `Push tes server FCM berhasil dikirim ke ${sent} perangkat milik Anda${failed > 0 ? ` (${failed} gagal)` : ''}.`,
    };
  } catch (err) {
    return {
      ok: false,
      sent: 0,
      failed: 0,
      matchedDevices: 0,
      message: err instanceof Error ? err.message : 'Terjadi kesalahan saat mengirim tes push FCM.',
    };
  }
}
