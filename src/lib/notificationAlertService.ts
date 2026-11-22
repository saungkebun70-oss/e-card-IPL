import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { ActivityNotification, SessionUser } from '../types';
import { saveUserPushToken } from './notificationService';

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
let pushListenersRegistered = false;
let latestNativePushToken: string | null = null;
let activePushSession: SessionUser | null = null;

function isNativeApp(): boolean {
  try {
    return Boolean(Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
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

/**
 * Membuka kunci Web AudioContext secara otomatis pada interaksi sentuhan/klik pertama pengguna
 * agar bunyi notifikasi real-time dapat berbunyi lancar di Chrome Mobile, Safari, & WebView.
 */
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

/**
 * Memutar bunyi lonceng/chime dua nada yang jernih menggunakan Web Audio API synthesizer
 * (tanpa ketergantungan file .mp3 eksternal yang rawan gagal load/offline).
 */
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

    // Nada 1: A5 (880 Hz) — lonceng jernih lembut
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

    // Chime 2 nada (A5 -> E6) + harmonik bell halus
    playTone(880, now, 0.32, 0.8, 'sine');
    playTone(1760, now, 0.18, 0.22, 'triangle');

    playTone(1318.51, now + 0.12, 0.42, 0.9, 'sine');
    playTone(2637.02, now + 0.12, 0.22, 0.18, 'triangle');

    return true;
  } catch {
    return false;
  }
}

/**
 * Menjalankan pola getaran notifikasi HP (Web Vibration API + Capacitor Haptics di APK).
 */
export async function triggerNotificationVibration(): Promise<boolean> {
  let didVibrate = false;

  if (isNativeApp()) {
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Success });
      await Haptics.vibrate({ duration: 250 });
      window.setTimeout(() => {
        void Haptics.vibrate({ duration: 250 }).catch(() => {});
      }, 350);
      didVibrate = true;
    } catch {
      // Lanjut fallback navigator.vibrate
    }
  }

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const ok = navigator.vibrate([250, 100, 250]);
      if (ok) didVibrate = true;
    }
  } catch {
    // Abaikan jika browser memblokir vibration
  }

  return didVibrate;
}

/**
 * Membuat Notification Channel Android dengan importance: 5 (High), suara & getaran bawaan aktif.
 * Aman dipanggil berulang kali (idempoten) dan hanya berjalan di APK Capacitor.
 */
export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (!isNativeApp() || androidChannelInitialized) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (typeof LocalNotifications.createChannel === 'function') {
      await LocalNotifications.createChannel({
        id: ANDROID_NOTIFICATION_CHANNEL_ID,
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
    androidChannelInitialized = true;
  } catch {
    // Abaikan jika platform tidak mendukung channel (misal iOS/Web)
  }
}

async function setupNativePushNotifications(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    if (typeof PushNotifications.createChannel === 'function') {
      await PushNotifications.createChannel({
        id: ANDROID_NOTIFICATION_CHANNEL_ID,
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

    if (!pushListenersRegistered) {
      pushListenersRegistered = true;

      await PushNotifications.addListener('registration', (token) => {
        const value = token?.value?.trim();
        if (!value) return;
        latestNativePushToken = value;
        if (activePushSession) {
          const platform =
            typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'android';
          void saveUserPushToken(activePushSession, value, platform);
        }
      });

      await PushNotifications.addListener('registrationError', () => {
        // Aman bila google-services.json belum dipasang; LocalNotifications tetap jalan penuh
      });

      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const prefs = getNotificationPreferences();
        emitBellShakeEvent();
        if (prefs.soundEnabled) void playNotificationChime();
        if (prefs.vibrationEnabled) void triggerNotificationVibration();
        const dataObj = (notification?.data || {}) as { target_url?: string };
        void showOsNotification({
          id: notification?.id || `fcm-${Date.now()}`,
          title: notification?.title || 'Notifikasi Baru · Saung Kebun',
          body: notification?.body || 'Ada pembaruan aktivitas di lingkungan Saung Kebun.',
          targetUrl: dataObj.target_url || '',
          soundEnabled: prefs.soundEnabled,
          vibrationEnabled: prefs.vibrationEnabled,
        });
      });

      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const dataObj = (action?.notification?.data || {}) as { target_url?: string };
        if (dataObj.target_url && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(NOTIF_NAVIGATE_EVENT, { detail: { targetUrl: dataObj.target_url } })
          );
        }
      });
    }

    let pushPerm = await PushNotifications.checkPermissions();
    if (pushPerm.receive !== 'granted') {
      pushPerm = await PushNotifications.requestPermissions();
    }
    if (pushPerm.receive === 'granted') {
      await PushNotifications.register();
    }
  } catch {
    // Aman di Web atau perangkat tanpa Firebase/GMS
  }
}

/**
 * Menyinkronkan sesi login aktif dengan pendaftaran Push Notifications (FCM)
 * lalu menyimpan token FCM ke tabel `user_push_tokens` di Supabase.
 */
export async function syncNativePushTokenForSession(
  session: SessionUser | null
): Promise<boolean> {
  activePushSession = session;
  if (!session || !isNativeApp()) return false;

  try {
    await setupNativePushNotifications();
    if (latestNativePushToken) {
      const platform =
        typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'android';
      return await saveUserPushToken(session, latestNativePushToken, platform);
    }
  } catch {
    // Abaikan agar tidak mengganggu UI
  }
  return false;
}

export function getNativePushRuntimeInfo(): {
  isNative: boolean;
  platform: string;
  hasFcmToken: boolean;
} {
  const native = isNativeApp();
  let platform = 'web';
  try {
    if (native && typeof Capacitor.getPlatform === 'function') {
      platform = Capacitor.getPlatform();
    }
  } catch {
    platform = native ? 'android' : 'web';
  }
  return {
    isNative: native,
    platform,
    hasFcmToken: Boolean(latestNativePushToken),
  };
}

/**
 * Dipanggil otomatis saat aplikasi APK Android (Capacitor) pertama kali dibuka:
 * langsung membuat Notification Channel `saung_kebun_alerts` (importance: 5, suara & getar aktif),
 * meminta izin `LocalNotifications.requestPermissions()` dan `PushNotifications.requestPermissions()`,
 * serta mendaftarkan token FCM bila tersedia.
 * Tidak meminta izin otomatis di Web Browser agar tidak melanggar kebijakan browser.
 */
export function initNativeNotificationsOnLaunch(): Promise<OsNotificationPermissionState> {
  if (!isNativeApp()) {
    return checkOsNotificationPermission();
  }
  if (nativeLaunchInitPromise) {
    return nativeLaunchInitPromise;
  }

  nativeLaunchInitPromise = (async () => {
    try {
      await ensureAndroidNotificationChannel();
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      let localPerm = await LocalNotifications.checkPermissions();
      if (localPerm.display !== 'granted') {
        localPerm = await LocalNotifications.requestPermissions();
      }

      // Jalankan juga inisialisasi PushNotifications (FCM) secara paralel/aman
      void setupNativePushNotifications();

      if (localPerm.display === 'granted') return 'granted';
      if (localPerm.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  })();

  return nativeLaunchInitPromise;
}

/**
 * Menyinkronkan titik/angka badge ikon aplikasi (Web/PWA App Badging API bila didukung).
 * Pada APK Android, Android Launcher otomatis memunculkan badge dot ikon aplikasi
 * ketika notifikasi aktif pada channel dengan importance: 5 (`saung_kebun_alerts`).
 */
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
    // Abaikan jika browser/OS tidak mendukung App Badging API
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
      void setupNativePushNotifications();
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

/**
 * Menampilkan Pop-up Notifikasi Sistem HP (Status Bar + Bunyi & Getar Bawaan HP)
 * baik pada APK Android/iOS (Capacitor LocalNotifications) maupun Web/PWA (Web Notification API).
 */
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

  // Web / PWA (Chrome / Edge / Android Browser)
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
      webOptions.vibrate = [250, 100, 250];
    }

    // Coba tampilkan via Service Worker bila aktif (wajib di Android Chrome PWA)
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

/**
 * Mendaftarkan listener ketukan notifikasi sistem (Capacitor APK & Web Notification)
 * agar ketika notifikasi diketuk dari Status Bar HP, aplikasi langsung membuka halaman tujuan.
 */
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
        // Abaikan jika plugin tidak tersedia
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

/**
 * Dipanggil ketika notifikasi aktivitas baru masuk via Supabase Realtime.
 * Memicu animasi goyang lonceng, bunyi chime, getaran HP, dan pop-up sistem HP.
 */
export async function triggerIncomingNotificationAlert(
  notif: ActivityNotification
): Promise<void> {
  if (!notif || !notif.id) return;
  if (alertedIds.has(notif.id)) return;
  alertedIds.add(notif.id);
  if (alertedIds.size > 250) {
    const first = alertedIds.values().next().value;
    if (first) alertedIds.delete(first);
  }

  emitBellShakeEvent();

  const prefs = getNotificationPreferences();

  const tasks: Promise<unknown>[] = [];
  if (prefs.soundEnabled) {
    tasks.push(playNotificationChime());
  }
  if (prefs.vibrationEnabled) {
    tasks.push(triggerNotificationVibration());
  }

  tasks.push(
    showOsNotification({
      id: notif.id,
      title: notif.title || 'Aktivitas Baru · Saung Kebun',
      body: notif.message || 'Ketuk untuk melihat detail aktivitas terbaru.',
      targetUrl: notif.target_url,
      soundEnabled: prefs.soundEnabled,
      vibrationEnabled: prefs.vibrationEnabled,
    })
  );

  await Promise.allSettled(tasks);
}

export interface TestNotificationResult {
  soundPlayed: boolean;
  vibrated: boolean;
  osPopupShown: boolean;
  permission: OsNotificationPermissionState;
}

/**
 * Tombol uji coba di halaman Profil/Pengaturan: langsung membunyikan chime, menggetarkan HP,
 * menggoyangkan ikon lonceng di header, dan memunculkan pop-up notifikasi sistem HP.
 */
export async function triggerTestNotificationAlert(
  session: SessionUser
): Promise<TestNotificationResult> {
  const prefs = getNotificationPreferences();
  emitBellShakeEvent();

  let permission = await checkOsNotificationPermission();
  if (permission === 'prompt') {
    permission = await requestOsNotificationPermission();
  }

  const [soundPlayed, vibrated, osPopupShown] = await Promise.all([
    prefs.soundEnabled ? playNotificationChime() : Promise.resolve(false),
    prefs.vibrationEnabled ? triggerNotificationVibration() : Promise.resolve(false),
    permission === 'granted'
      ? showOsNotification({
          id: `test-${Date.now()}`,
          title: 'Tes Notifikasi · Saung Kebun',
          body: `Halo ${session.nama_warga || 'Pengguna'}, suara, getaran, dan pop-up notifikasi HP Anda berfungsi dengan baik!`,
          targetUrl:
            session.role === 'admin'
              ? 'tab:dashboard'
              : session.role === 'petugas'
                ? 'tab:info'
                : 'tab:beranda',
          soundEnabled: prefs.soundEnabled,
          vibrationEnabled: prefs.vibrationEnabled,
        })
      : Promise.resolve(false),
  ]);

  return { soundPlayed, vibrated, osPopupShown, permission };
}
