import { Capacitor, registerPlugin } from '@capacitor/core';
import type { SessionUser } from '../types';
import {
  applyRefreshedGoogleDriveSession,
  connectGoogleDriveViaServer,
  DRIVE_TARGET_EMAIL,
  getGoogleDriveAccessToken,
  getGoogleDriveTokenExpiresAt,
  hasExplicitGoogleDriveLogout,
  isNativeCapacitorRuntime,
  type DriveConnectedAccount,
} from './googleDriveAuth';

const EDGE_REFRESH_FUNCTION_NAME = 'drive-oauth-refresh';
export const DRIVE_OAUTH_REFRESH_BUFFER_MS = 3 * 60 * 1000; // Refresh otomatis 3 menit sebelum kedaluwarsa
const DEFAULT_REFRESH_BUFFER_MS = DRIVE_OAUTH_REFRESH_BUFFER_MS;
const DEFAULT_WATCHER_INTERVAL_MS = 60 * 1000; // Cek setiap 60 detik saat drawer aktif

export type DriveOAuthHealthState = 'connected' | 'needs_refresh' | 'expired';

export interface DriveOAuthHealthSnapshot {
  state: DriveOAuthHealthState;
  label: 'Terhubung' | 'Perlu Refresh' | 'Kedaluwarsa';
  description: string;
  remainingMs: number | null;
  expiresAt: number | null;
  source: string | null;
  needsResync: boolean;
}

export function getDriveOAuthHealthSnapshot(params: {
  accessToken: string | null;
  account: DriveConnectedAccount | null;
  tokenInvalidReason?: string | null;
  isRefreshing?: boolean;
  now?: number;
}): DriveOAuthHealthSnapshot {
  const now = params.now ?? Date.now();
  const expiresAt = params.account?.expiresAt ?? getGoogleDriveTokenExpiresAt();
  const remainingMs = expiresAt !== null ? expiresAt - now : null;
  const source = params.account?.source ?? null;

  if (params.tokenInvalidReason) {
    return {
      state: 'expired',
      label: 'Kedaluwarsa',
      description: params.tokenInvalidReason,
      remainingMs,
      expiresAt,
      source,
      needsResync: true,
    };
  }

  if (params.isRefreshing) {
    return {
      state: 'needs_refresh',
      label: 'Perlu Refresh',
      description: 'Sedang menyinkronkan ulang token OAuth Google Drive melalui server...',
      remainingMs,
      expiresAt,
      source,
      needsResync: true,
    };
  }

  if (!params.accessToken) {
    if (hasExplicitGoogleDriveLogout()) {
      return {
        state: 'expired',
        label: 'Kedaluwarsa',
        description:
          'Sesi Google Drive telah keluar atau tidak aktif. Klik "Sinkronisasi Ulang" untuk menyambungkan token kembali.',
        remainingMs: null,
        expiresAt: null,
        source: null,
        needsResync: true,
      };
    }

    if (expiresAt !== null && expiresAt <= now) {
      return {
        state: 'expired',
        label: 'Kedaluwarsa',
        description:
          'Masa berlaku access token OAuth Google Drive telah habis. Klik "Sinkronisasi Ulang" untuk memperbarui sesi.',
        remainingMs,
        expiresAt,
        source,
        needsResync: true,
      };
    }

    return {
      state: 'needs_refresh',
      label: 'Perlu Refresh',
      description:
        'Token akses Google Drive belum termuat pada sesi ini. Klik "Sinkronisasi Ulang" untuk memuat token terbaru.',
      remainingMs,
      expiresAt,
      source,
      needsResync: true,
    };
  }

  if (remainingMs !== null && remainingMs <= 0) {
    return {
      state: 'expired',
      label: 'Kedaluwarsa',
      description:
        'Token akses OAuth sudah melewati batas masa berlaku. Klik "Sinkronisasi Ulang" untuk memperbarui token.',
      remainingMs,
      expiresAt,
      source,
      needsResync: true,
    };
  }

  if (remainingMs !== null && remainingMs <= DRIVE_OAUTH_REFRESH_BUFFER_MS) {
    const secs = Math.max(1, Math.ceil(remainingMs / 1000));
    const timeLabel = secs >= 60 ? `~${Math.ceil(secs / 60)} menit` : `${secs} detik`;
    return {
      state: 'needs_refresh',
      label: 'Perlu Refresh',
      description: `Masa berlaku token tersisa ${timeLabel}. Sistem akan refresh otomatis atau klik "Sinkronisasi Ulang".`,
      remainingMs,
      expiresAt,
      source,
      needsResync: true,
    };
  }

  const validMinutes =
    remainingMs !== null ? Math.max(1, Math.floor(remainingMs / 60000)) : null;
  return {
    state: 'connected',
    label: 'Terhubung',
    description:
      validMinutes !== null
        ? `Token OAuth Google Drive sehat & aktif (berlaku ~${validMinutes} menit lagi).`
        : 'Token OAuth Google Drive sehat & aktif pada sesi ini.',
    remainingMs,
    expiresAt,
    source,
    needsResync: false,
  };
}

interface CapacitorAppPluginLike {
  addListener?: (
    eventName: string,
    listener: (state?: { isActive?: boolean }) => void
  ) => Promise<{ remove?: () => Promise<void> | void }>;
}

const NativeAppPlugin = registerPlugin<CapacitorAppPluginLike>('App');

let activeManagerSession: SessionUser | null = null;
let inFlightRefreshPromise: Promise<{ account: DriveConnectedAccount; accessToken: string }> | null =
  null;
let lastFailureAt = 0;
const FAILURE_COOLDOWN_MS = 15_000;

function getSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '') || '';
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
  if (!url || !anonKey || !url.startsWith('http')) return null;
  return { url, anonKey };
}

export function setDriveAutoRefreshSession(session?: SessionUser | null): void {
  if (session && session.role === 'admin') {
    activeManagerSession = session;
  } else if (session === null) {
    activeManagerSession = null;
  }
}

export function getDriveAutoRefreshSession(): SessionUser | null {
  return activeManagerSession;
}

export async function isGoogleDriveTokenExpiredOrExpiring(
  bufferMs = DEFAULT_REFRESH_BUFFER_MS
): Promise<boolean> {
  const currentToken = await getGoogleDriveAccessToken();
  if (!currentToken) return true;
  const expiresAt = getGoogleDriveTokenExpiresAt();
  if (!expiresAt) return false;
  return expiresAt - Date.now() <= Math.max(0, bufferMs);
}

async function invokeEdgeDriveOAuthRefresh(
  session: SessionUser | null,
  reason: string
): Promise<{ account: DriveConnectedAccount; accessToken: string }> {
  const sb = getSupabasePublicEnv();
  if (!sb) {
    throw new Error('Konfigurasi Supabase client belum tersedia untuk Edge Function.');
  }

  const res = await fetch(`${sb.url}/functions/v1/${EDGE_REFRESH_FUNCTION_NAME}`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      apikey: sb.anonKey,
      Authorization: `Bearer ${sb.anonKey}`,
      'x-user-role': session?.role || 'admin',
      'x-blok-rumah': session?.blok_rumah || '',
      'x-admin-permission': session?.admin_permission || '',
      'x-admin-jabatan': session?.jabatan || '',
    },
    body: JSON.stringify({
      action: 'refresh_token',
      reason,
      sender: session
        ? {
            role: session.role,
            blokRumah: session.blok_rumah,
            namaWarga: session.nama_warga,
            jabatan: session.jabatan,
            adminPermission: session.admin_permission,
          }
        : undefined,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    accessToken?: string;
    expiresIn?: number;
    email?: string;
    displayName?: string;
    photoLink?: string | null;
  };

  if (!res.ok || !data.ok || !data.accessToken) {
    const err = new Error(
      data.error || `Edge Function ${EDGE_REFRESH_FUNCTION_NAME} gagal (HTTP ${res.status}).`
    ) as Error & { statusCode?: number };
    err.statusCode = res.status;
    throw err;
  }

  const account = applyRefreshedGoogleDriveSession({
    accessToken: data.accessToken,
    email: data.email || DRIVE_TARGET_EMAIL,
    displayName: data.displayName || 'Google Drive Pusat Saung Kebun',
    photoLink: data.photoLink ?? null,
    source: 'supabase_edge_function',
    expiresIn: data.expiresIn || 3600,
  });

  return { account, accessToken: data.accessToken };
}

/**
 * Menyegarkan access token Google Drive OAuth2 secara senyap melalui
 * Supabase Edge Function (`drive-oauth-refresh`), dengan fallback aman ke `/api/storage/drive-oauth`.
 * Menggunakan single-flight lock agar panggilan paralel tidak memicu refresh ganda.
 */
export async function refreshGoogleDriveTokenViaEdge(
  session?: SessionUser | null,
  options?: { force?: boolean; reason?: string }
): Promise<{ account: DriveConnectedAccount; accessToken: string }> {
  const effectiveSession = session ?? activeManagerSession;
  if (effectiveSession && effectiveSession.role === 'admin') {
    activeManagerSession = effectiveSession;
  }

  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  const reason = options?.reason || 'auto_refresh';
  inFlightRefreshPromise = (async () => {
    try {
      // Prioritas 1: Supabase Edge Function `drive-oauth-refresh`
      try {
        const edgeResult = await invokeEdgeDriveOAuthRefresh(effectiveSession, reason);
        lastFailureAt = 0;
        return edgeResult;
      } catch (edgeErr) {
        const statusCode = (edgeErr as { statusCode?: number })?.statusCode;
        // Jika otorisasi admin ditolak tegas oleh server (403), jangan bypass ke fallback
        if (statusCode === 403) {
          throw edgeErr;
        }
        // Fallback ke endpoint server lokal/Vercel (`/api/storage/drive-oauth`) bila Edge Function belum di-deploy
        const serverResult = await connectGoogleDriveViaServer(effectiveSession);
        lastFailureAt = 0;
        return serverResult;
      }
    } catch (err) {
      lastFailureAt = Date.now();
      throw err;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

/**
 * Mengembalikan token Google Drive yang valid; otomatis melakukan refresh melalui
 * Supabase Edge Function jika token belum ada, kedaluwarsa, atau hampir kedaluwarsa.
 */
export async function ensureFreshGoogleDriveToken(
  session?: SessionUser | null,
  options?: { force?: boolean; bufferMs?: number; respectExplicitLogout?: boolean; reason?: string }
): Promise<string | null> {
  if (session && session.role === 'admin') {
    activeManagerSession = session;
  }

  if (options?.respectExplicitLogout && hasExplicitGoogleDriveLogout()) {
    return null;
  }

  if (!options?.force) {
    const existing = await getGoogleDriveAccessToken();
    const expiring = await isGoogleDriveTokenExpiredOrExpiring(
      options?.bufferMs ?? DEFAULT_REFRESH_BUFFER_MS
    );
    if (existing && !expiring) {
      return existing;
    }
    if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
      return existing;
    }
  }

  try {
    const refreshed = await refreshGoogleDriveTokenViaEdge(session ?? activeManagerSession, {
      force: options?.force,
      reason: options?.reason || (options?.force ? 'force_refresh' : 'expired_or_missing'),
    });
    return refreshed.accessToken;
  } catch {
    return null;
  }
}

/**
 * Memasang pengawas otomatis di AdminSettingsDrawer (atau komponen admin lain):
 * memantau masa berlaku token OAuth Google Drive dan menyegarkannya via Supabase Edge Function
 * tanpa interaksi pengguna saat drawer dibuka, saat interval berjalan, maupun saat app kembali aktif.
 */
export function startDriveAutoRefreshWatcher(params: {
  session: SessionUser;
  enabled: boolean;
  checkIntervalMs?: number;
  refreshBufferMs?: number;
  onRefreshed?: (account: DriveConnectedAccount, accessToken: string) => void;
  onError?: (err: Error) => void;
}): () => void {
  if (!params.enabled || params.session.role !== 'admin') {
    return () => {};
  }

  setDriveAutoRefreshSession(params.session);
  const bufferMs = params.refreshBufferMs ?? DEFAULT_REFRESH_BUFFER_MS;
  const intervalMs = params.checkIntervalMs ?? DEFAULT_WATCHER_INTERVAL_MS;
  let disposed = false;

  const checkAndRefresh = async (reason: string) => {
    if (disposed || hasExplicitGoogleDriveLogout()) return;
    const needsRefresh = await isGoogleDriveTokenExpiredOrExpiring(bufferMs);
    if (!needsRefresh) return;
    if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) return;

    try {
      const res = await refreshGoogleDriveTokenViaEdge(params.session, { reason });
      if (!disposed) {
        params.onRefreshed?.(res.account, res.accessToken);
      }
    } catch (err) {
      if (!disposed && err instanceof Error) {
        params.onError?.(err);
      }
    }
  };

  void checkAndRefresh('drawer_open');

  const timerId = window.setInterval(() => {
    void checkAndRefresh('periodic_expiry_check');
  }, intervalMs);

  const handleWake = () => {
    if (document.visibilityState === 'visible') {
      void checkAndRefresh('window_wake');
    }
  };

  window.addEventListener('focus', handleWake);
  document.addEventListener('visibilitychange', handleWake);

  const nativeCleanups: Array<() => void> = [];
  if (isNativeCapacitorRuntime() || (Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform())) {
    try {
      const capPlugins = (
        window as unknown as { Capacitor?: { Plugins?: { App?: CapacitorAppPluginLike } } }
      ).Capacitor?.Plugins;
      const appPlugin = capPlugins?.App || NativeAppPlugin;

      const register = (eventName: string, cb: (st?: { isActive?: boolean }) => void) => {
        if (!appPlugin || typeof appPlugin.addListener !== 'function') return;
        const p = appPlugin.addListener(eventName, cb);
        void Promise.resolve(p)
          .then((h) => {
            if (h && typeof h.remove === 'function') {
              nativeCleanups.push(() => {
                void Promise.resolve(h.remove?.()).catch(() => {});
              });
            }
          })
          .catch(() => {});
      };

      register('appStateChange', (st) => {
        if (st?.isActive) void checkAndRefresh('capacitor_app_active');
      });
      register('resume', () => {
        void checkAndRefresh('capacitor_resume');
      });
    } catch {
      // Abaikan jika plugin App belum tersedia
    }
  }

  return () => {
    disposed = true;
    window.clearInterval(timerId);
    window.removeEventListener('focus', handleWake);
    document.removeEventListener('visibilitychange', handleWake);
    for (const fn of nativeCleanups) {
      try {
        fn();
      } catch {
        // Abaikan cleanup error
      }
    }
  };
}
