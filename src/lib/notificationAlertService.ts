import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ActivityNotification, SessionUser } from '../types';

export interface NotificationPreferences {
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  permissionPromptDismissed: boolean;
}

export type OsNotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

const PREFS_STORAGE_KEY = 'app_notif_prefs_v1';
const PREFS_CHANGED_EVENT = 'ecard-notif-prefs-changed';
const BELL_SHAKE_EVENT = 'ecard-bell-shake';
const NOTIF_NAVIGATE_EVENT = 'ecard-notif-navigate';
const LAST_FCM_TOKEN_KEY = 'ecard_last_fcm_token_v1';
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

function isNativeApp(): boolean {
  try {
    return Boolean(
      Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()
    );
  } catch {
    return false;
  }
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

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (!isNativeApp() || androidChannelInitialized) return;
  try {
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

    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (typeof LocalNotifications.createChannel === 'function') {
      await LocalNotifications.createChannel(channelConfig);
    }

    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      if (typeof PushNotifications.createChannel === 'function') {
        await PushNotifications.createChannel(channelConfig);
      }
    } catch {
      // Abaikan jika plugin push belum siap
    }

    androidChannelInitialized = true;
  } catch {
    // Abaikan
  }
}

export function initNativeNotificationsOnLaunch(
  session?: SessionUser | null
): Promise<OsNotificationPermissionState> {
  if (!isNativeApp()) {
    return checkOsNotificationPermission();
  }
  if (session) {
    void syncNativePushTokenForSession(session);
  }
  if (nativeLaunchInitPromise) {
    return nativeLaunchInitPromise;
  }

  nativeLaunchInitPromise = (async () => {
    try {
      await ensureAndroidNotificationChannel();
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const current = await LocalNotifications.checkPermissions();
      if (current.display === 'granted') {
        return 'granted';
      }
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display === 'granted') return 'granted';
      if (requested.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  })();

  return nativeLaunchInitPromise;
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
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const res = await LocalNotifications.requestPermissions();
      if (res.display === 'granted') return 'granted';
      if (res.display === 'denied') return 'denied';
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
      await LocalNotifications.schedule({
        notifications: [
          {
            id: numericId,
            title,
            body,
            channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
            sound: payload.soundEnabled === false ? undefined : 'default',
            iconColor: '#059669',
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

  const [soundPlayed, vibrated, osPopupShown] = await Promise.all([
    prefs.soundEnabled ? playNotificationChime() : Promise.resolve(false),
    prefs.vibrationEnabled ? triggerNotificationVibration() : Promise.resolve(false),
    permission === 'granted'
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

// === FCM NATIVE PUSH NOTIFICATION RUNTIME & SYNC (user_push_tokens) ===

export interface NativePushRuntimeInfo {
  isNative: boolean;
  platform: string;
  supported: boolean;
  hasToken: boolean;
  hasFcmToken: boolean;
  token: string | null;
  tokenPreview: string | null;
}

export function getNativePushRuntimeInfo(): NativePushRuntimeInfo {
  const native = isNativeApp();
  let platform = 'web';
  try {
    platform = Capacitor.getPlatform();
  } catch {
    platform = 'web';
  }
  let savedToken: string | null = null;
  try {
    if (typeof window !== 'undefined') {
      savedToken = window.localStorage.getItem(LAST_FCM_TOKEN_KEY);
    }
  } catch {
    savedToken = null;
  }
  return {
    isNative: native,
    platform,
    supported: native,
    hasToken: Boolean(savedToken),
    hasFcmToken: Boolean(savedToken),
    token: savedToken,
    tokenPreview: savedToken ? `${savedToken.slice(0, 12)}...${savedToken.slice(-6)}` : null,
  };
}

export async function syncNativePushTokenForSession(
  session?: SessionUser | null
): Promise<{ ok: boolean; synced: boolean; token: string | null; error?: string }> {
  if (!isNativeApp() || !session) {
    return { ok: false, synced: false, token: null };
  }

  try {
    await ensureAndroidNotificationChannel();

    const [{ PushNotifications }, { getSupabaseClient, isSupabaseConfigured }, { getCanonicalUserId }] =
      await Promise.all([
        import('@capacitor/push-notifications'),
        import('./supabase'),
        import('./notificationService'),
      ]);

    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') {
      return { ok: false, synced: false, token: null, error: 'Izin notifikasi belum diberikan' };
    }

    const token = await new Promise<string | null>((resolve) => {
      let settled = false;
      const done = (val: string | null) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };

      const timeout = window.setTimeout(() => done(null), 8000);

      void PushNotifications.addListener('registration', (t) => {
        window.clearTimeout(timeout);
        done(t?.value || null);
      });

      void PushNotifications.addListener('registrationError', () => {
        window.clearTimeout(timeout);
        done(null);
      });

      void PushNotifications.register().catch(() => {
        window.clearTimeout(timeout);
        done(null);
      });
    });

    if (!token) {
      return { ok: false, synced: false, token: null, error: 'Token FCM gagal diperoleh' };
    }

    try {
      window.localStorage.setItem(LAST_FCM_TOKEN_KEY, token);
    } catch {
      // Abaikan
    }

    const supabase = getSupabaseClient(session);
    if (supabase && isSupabaseConfigured()) {
      const userId = getCanonicalUserId(session);
      const platform = Capacitor.getPlatform();
      const nowIso = new Date().toISOString();
      const payload = {
        user_id: userId,
        role: session.role,
        blok_rumah: session.blok_rumah || null,
        token,
        platform,
        updated_at: nowIso,
      };

      const { data: existingRows } = await supabase
        .from('user_push_tokens')
        .select('id')
        .eq('token', token)
        .limit(1);

      const dbError =
        existingRows && existingRows.length > 0
          ? (
              await supabase
                .from('user_push_tokens')
                .update(payload)
                .eq('id', existingRows[0].id)
            ).error
          : (await supabase.from('user_push_tokens').insert(payload)).error;

      if (dbError) {
        return { ok: false, synced: false, token, error: dbError.message };
      }
      return { ok: true, synced: true, token };
    }

    return { ok: true, synced: false, token };
  } catch (err) {
    return { ok: false, synced: false, token: null, error: String(err) };
  }
}
