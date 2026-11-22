import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';

export interface VersionManifest {
  version: string;
  buildId: string;
  builtAt: string;
}

export type UpdateCheckStatus = 'idle' | 'up_to_date' | 'update_available' | 'offline' | 'error';

interface AppUpdateContextValue {
  currentVersion: string;
  currentBuildId: string;
  currentBuiltAt: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  bannerDismissed: boolean;
  checking: boolean;
  updating: boolean;
  isOffline: boolean;
  retryingConnection: boolean;
  lastCheckStatus: UpdateCheckStatus;
  checkForUpdate: (options?: { manual?: boolean }) => Promise<UpdateCheckStatus>;
  applyUpdate: () => Promise<void>;
  dismissBanner: () => void;
  retryConnection: () => Promise<boolean>;
}

const CURRENT_VERSION =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '1.0.0';
const CURRENT_BUILD_ID =
  typeof __APP_BUILD_ID__ === 'string' && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : 'dev';
const CURRENT_BUILT_AT =
  typeof __APP_BUILT_AT__ === 'string' && __APP_BUILT_AT__
    ? __APP_BUILT_AT__
    : new Date().toISOString();

const AUTO_CHECK_COOLDOWN_MS = 30_000;

interface CapacitorAppPluginLike {
  addListener?: (
    eventName: string,
    listenerFunc: (state: { isActive?: boolean }) => void
  ) => Promise<{ remove: () => Promise<void> }>;
}

function isNewerManifest(remote: VersionManifest): boolean {
  if (!remote.buildId && !remote.builtAt && !remote.version) return false;

  const remoteTime = Date.parse(remote.builtAt || '');
  const localTime = Date.parse(CURRENT_BUILT_AT || '');

  // Di mode pengembangan (dev), hanya anggap update jika timestamp server benar-benar lebih baru
  if (import.meta.env.DEV) {
    return (
      !Number.isNaN(remoteTime) &&
      !Number.isNaN(localTime) &&
      remoteTime > localTime + 5000 &&
      remote.buildId !== CURRENT_BUILD_ID
    );
  }

  if (remote.buildId && CURRENT_BUILD_ID && remote.buildId !== CURRENT_BUILD_ID) {
    // Pastikan tidak memicu update mundur jika build lokal lebih baru dari edge cache
    if (!Number.isNaN(remoteTime) && !Number.isNaN(localTime) && remoteTime + 2000 < localTime) {
      return false;
    }
    return true;
  }

  if (!Number.isNaN(remoteTime) && !Number.isNaN(localTime) && remoteTime > localTime + 2000) {
    return true;
  }

  return false;
}

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );
  const [retryingConnection, setRetryingConnection] = useState(false);
  const [lastCheckStatus, setLastCheckStatus] = useState<UpdateCheckStatus>('idle');

  const lastAutoCheckRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

  // Bersihkan parameter cache-buster ?_v=... setelah reload pembaruan agar URL tetap rapi
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('_v')) {
        url.searchParams.delete('_v');
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, '', nextUrl || '/');
      }
    } catch {
      // Abaikan jika URL tidak standar
    }
  }, []);

  const fetchServerVersion = useCallback(async (): Promise<VersionManifest | null> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/version.json?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json') && !contentType.includes('text/plain')) {
        return null;
      }
      const data = (await response.json()) as Partial<VersionManifest>;
      if (!data || (typeof data.version !== 'string' && typeof data.buildId !== 'string')) {
        return null;
      }
      return {
        version: String(data.version || CURRENT_VERSION),
        buildId: String(data.buildId || ''),
        builtAt: String(data.builtAt || ''),
      };
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, []);

  const checkForUpdate = useCallback(
    async (options?: { manual?: boolean }): Promise<UpdateCheckStatus> => {
      const manual = Boolean(options?.manual);
      if (inFlightRef.current) {
        return updateAvailable ? 'update_available' : lastCheckStatus;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setIsOffline(true);
        if (manual) setLastCheckStatus('offline');
        return 'offline';
      }

      const now = Date.now();
      if (!manual && now - lastAutoCheckRef.current < AUTO_CHECK_COOLDOWN_MS) {
        return updateAvailable ? 'update_available' : lastCheckStatus;
      }

      inFlightRef.current = true;
      lastAutoCheckRef.current = now;
      if (manual) {
        setChecking(true);
      }

      try {
        const remote = await fetchServerVersion();
        if (!remote) {
          const status: UpdateCheckStatus =
            typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error';
          if (status === 'offline') setIsOffline(true);
          if (manual) setLastCheckStatus(status);
          return status;
        }

        setIsOffline(false);
        if (isNewerManifest(remote)) {
          setLatestVersion(remote.version);
          setUpdateAvailable(true);
          setBannerDismissed(false);
          setLastCheckStatus('update_available');
          return 'update_available';
        }

        setLastCheckStatus('up_to_date');
        return 'up_to_date';
      } finally {
        inFlightRef.current = false;
        if (manual) {
          setChecking(false);
        }
      }
    },
    [fetchServerVersion, lastCheckStatus, updateAvailable]
  );

  const applyUpdate = useCallback(async () => {
    if (updating) return;
    setUpdating(true);
    try {
      // 1. Bersihkan seluruh Cache Storage browser/WebView jika ada
      if (typeof window !== 'undefined' && 'caches' in window) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
      }

      // 2. Lepaskan Service Worker lama jika pernah terdaftar
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
      }
    } catch {
      // Tetap lanjutkan reload meskipun pembersihan cache dibatasi WebView
    }

    // 3. Muat ulang halaman dengan cache-buster query agar WebView mengambil versi terbaru Vercel
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('_v', String(Date.now()));
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
    }
  }, [updating]);

  const dismissBanner = useCallback(() => {
    setBannerDismissed(true);
  }, []);

  const retryConnection = useCallback(async (): Promise<boolean> => {
    setRetryingConnection(true);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setIsOffline(true);
        return false;
      }
      const remote = await fetchServerVersion();
      if (!remote) {
        setIsOffline(true);
        return false;
      }
      setIsOffline(false);
      if (isNewerManifest(remote)) {
        setLatestVersion(remote.version);
        setUpdateAvailable(true);
        setBannerDismissed(false);
        setLastCheckStatus('update_available');
      } else {
        setLastCheckStatus('up_to_date');
      }
      return true;
    } finally {
      setRetryingConnection(false);
    }
  }, [fetchServerVersion]);

  // Pengecekan otomatis saat aplikasi dibuka, kembali aktif (resume), focus, dan online/offline
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const initialTimer = window.setTimeout(() => {
      void checkForUpdate();
    }, 1200);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate();
      }
    };

    const handleFocus = () => {
      void checkForUpdate();
    };

    const handleOnline = () => {
      setIsOffline(false);
      void checkForUpdate();
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Daftarkan listener native Capacitor App (resume & appStateChange) jika berjalan di APK/iOS
    const cleanups: Array<() => void> = [];
    if (Capacitor.isNativePlatform()) {
      const capPlugins = (window as unknown as { Capacitor?: { Plugins?: { App?: CapacitorAppPluginLike } } })
        .Capacitor?.Plugins;
      const appPlugin = capPlugins?.App;
      if (appPlugin?.addListener) {
        void appPlugin
          .addListener('appStateChange', ({ isActive }) => {
            if (isActive) {
              void checkForUpdate();
            }
          })
          .then((handle) => {
            cleanups.push(() => {
              void handle.remove();
            });
          })
          .catch(() => {});

        void appPlugin
          .addListener('resume', () => {
            void checkForUpdate();
          })
          .then((handle) => {
            cleanups.push(() => {
              void handle.remove();
            });
          })
          .catch(() => {});
      }
    }

    return () => {
      window.clearTimeout(initialTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      cleanups.forEach((fn) => fn());
    };
  }, [checkForUpdate]);

  return (
    <AppUpdateContext.Provider
      value={{
        currentVersion: CURRENT_VERSION,
        currentBuildId: CURRENT_BUILD_ID,
        currentBuiltAt: CURRENT_BUILT_AT,
        latestVersion,
        updateAvailable,
        bannerDismissed,
        checking,
        updating,
        isOffline,
        retryingConnection,
        lastCheckStatus,
        checkForUpdate,
        applyUpdate,
        dismissBanner,
        retryConnection,
      }}
    >
      {children}
    </AppUpdateContext.Provider>
  );
}

export function useAppUpdate(): AppUpdateContextValue {
  const ctx = useContext(AppUpdateContext);
  if (!ctx) {
    throw new Error('useAppUpdate harus digunakan di dalam AppUpdateProvider.');
  }
  return ctx;
}
