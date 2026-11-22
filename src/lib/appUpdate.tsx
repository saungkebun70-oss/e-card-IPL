import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

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

interface CapacitorListenerHandleLike {
  remove?: () => Promise<void> | void;
}

interface CapacitorAppPluginLike {
  addListener?: (
    eventName: string,
    listenerFunc: (state?: { isActive?: boolean }) => void
  ) => Promise<CapacitorListenerHandleLike> | CapacitorListenerHandleLike;
}

function isSafeNativePlatform(): boolean {
  try {
    return Boolean(Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform());
  } catch {
    return false;
  }
}

function isNewerManifest(remote: VersionManifest | null | undefined): boolean {
  try {
    if (!remote || (!remote.buildId && !remote.builtAt && !remote.version)) return false;

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
  } catch {
    return false;
  }
}

const DEFAULT_UPDATE_CONTEXT: AppUpdateContextValue = {
  currentVersion: CURRENT_VERSION,
  currentBuildId: CURRENT_BUILD_ID,
  currentBuiltAt: CURRENT_BUILT_AT,
  latestVersion: null,
  updateAvailable: false,
  bannerDismissed: false,
  checking: false,
  updating: false,
  isOffline: false,
  retryingConnection: false,
  lastCheckStatus: 'idle',
  checkForUpdate: async () => 'idle',
  applyUpdate: async () => undefined,
  dismissBanner: () => undefined,
  retryConnection: async () => true,
};

const AppUpdateContext = createContext<AppUpdateContextValue>(DEFAULT_UPDATE_CONTEXT);

export function AppUpdateProvider({ children }: { children: React.ReactNode }) {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [isOffline, setIsOffline] = useState<boolean>(() => {
    try {
      return typeof navigator !== 'undefined' ? navigator.onLine === false : false;
    } catch {
      return false;
    }
  });
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
      // Abaikan jika URL tidak standar atau history dibatasi
    }
  }, []);

  // Konfigurasi StatusBar Capacitor secara aman khusus saat berjalan di native Android/iOS
  useEffect(() => {
    if (!isSafeNativePlatform()) return;
    const configureNativeStatusBar = async () => {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
      } catch {
        // Abaikan diam-diam bila tidak didukung perangkat
      }
      try {
        await StatusBar.setStyle({ style: Style.Light });
      } catch {
        // Abaikan diam-diam bila tidak didukung perangkat
      }
      try {
        await StatusBar.setBackgroundColor({ color: '#FFFFFF' });
      } catch {
        // Abaikan diam-diam bila tidak didukung perangkat (mis. iOS)
      }
    };
    void configureNativeStatusBar();
  }, []);

  const fetchServerVersion = useCallback(async (): Promise<VersionManifest | null> => {
    let timeoutId: number | null = null;
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (controller && typeof window !== 'undefined') {
        timeoutId = window.setTimeout(() => {
          try {
            controller.abort();
          } catch {
            // Abaikan error abort
          }
        }, 8000);
      }

      const response = await fetch(`/version.json?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache',
        },
        signal: controller?.signal,
      });

      if (!response || !response.ok) {
        return null;
      }

      const contentType = (response.headers?.get('content-type') || '').toLowerCase();
      if (
        contentType &&
        !contentType.includes('application/json') &&
        !contentType.includes('text/plain')
      ) {
        // Hindari mencoba parsing HTML (misal fallback SPA index.html atau halaman 404)
        return null;
      }

      const rawText = (await response.text()).trim();
      if (!rawText.startsWith('{') || !rawText.endsWith('}')) {
        return null;
      }

      const data = JSON.parse(rawText) as Partial<VersionManifest> | null;
      if (!data || typeof data !== 'object') {
        return null;
      }
      if (typeof data.version !== 'string' && typeof data.buildId !== 'string') {
        return null;
      }

      return {
        version: String(data.version || CURRENT_VERSION),
        buildId: String(data.buildId || ''),
        builtAt: String(data.builtAt || ''),
      };
    } catch {
      // Gagal jaringan, offline, atau respons bukan JSON — abaikan diam-diam tanpa melempar error ke UI
      return null;
    } finally {
      if (timeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
    }
  }, []);

  const checkForUpdate = useCallback(
    async (options?: { manual?: boolean }): Promise<UpdateCheckStatus> => {
      const manual = Boolean(options?.manual);
      try {
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
      } catch {
        if (manual) setLastCheckStatus('error');
        return 'error';
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
      if (typeof window !== 'undefined' && 'caches' in window && window.caches) {
        const cacheKeys = await window.caches.keys();
        await Promise.all((cacheKeys || []).map((key) => window.caches.delete(key)));
      }

      // 2. Lepaskan Service Worker lama jika pernah terdaftar
      if (
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        navigator.serviceWorker?.getRegistrations
      ) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all((registrations || []).map((reg) => reg.unregister()));
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
        try {
          window.location.reload();
        } catch {
          setUpdating(false);
        }
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
    } catch {
      setIsOffline(true);
      return false;
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
      try {
        if (document.visibilityState === 'visible') {
          void checkForUpdate();
        }
      } catch {
        // Abaikan
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

    try {
      document.addEventListener('visibilitychange', handleVisibility);
      window.addEventListener('focus', handleFocus);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    } catch {
      // Abaikan jika event listener dibatasi
    }

    // Daftarkan listener native Capacitor App (resume & appStateChange) secara aman khusus di APK/iOS
    const cleanups: Array<() => void> = [];
    if (isSafeNativePlatform()) {
      try {
        const capPlugins = (
          window as unknown as { Capacitor?: { Plugins?: { App?: CapacitorAppPluginLike } } }
        ).Capacitor?.Plugins;
        const appPlugin = capPlugins?.App;

        const registerSafeAppListener = (
          eventName: string,
          handler: (state?: { isActive?: boolean }) => void
        ) => {
          try {
            if (!appPlugin || typeof appPlugin.addListener !== 'function') return;
            const maybeHandle = appPlugin.addListener(eventName, handler);
            void Promise.resolve(maybeHandle)
              .then((handle) => {
                if (handle && typeof handle.remove === 'function') {
                  cleanups.push(() => {
                    try {
                      void Promise.resolve(handle.remove?.()).catch(() => {});
                    } catch {
                      // Abaikan error pelepasan listener
                    }
                  });
                }
              })
              .catch(() => {});
          } catch {
            // Abaikan jika plugin App gagal mendaftarkan listener
          }
        };

        registerSafeAppListener('appStateChange', (state) => {
          if (state?.isActive) {
            void checkForUpdate();
          }
        });

        registerSafeAppListener('resume', () => {
          void checkForUpdate();
        });
      } catch {
        // Abaikan diam-diam agar tidak pernah mengganggu render aplikasi
      }
    }

    return () => {
      try {
        window.clearTimeout(initialTimer);
        document.removeEventListener('visibilitychange', handleVisibility);
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
        cleanups.forEach((fn) => {
          try {
            fn();
          } catch {
            // Abaikan
          }
        });
      } catch {
        // Abaikan
      }
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
  return useContext(AppUpdateContext);
}
