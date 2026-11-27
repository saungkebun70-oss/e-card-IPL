import { Capacitor, registerPlugin } from '@capacitor/core';
import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import type { SessionUser } from '../types';

export const DRIVE_TARGET_EMAIL = 'saungkebun70@gmail.com';
export const PUBLIC_APP_ORIGIN = 'https://e-card-ipl.vercel.app';
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_AUTH_SETTINGS_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`;

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

export type DriveAuthSource =
  | 'firebase_popup'
  | 'server_oauth2'
  | 'supabase_edge_function'
  | 'external_browser_oauth';

export interface DriveConnectedAccount {
  email: string;
  displayName: string;
  photoLink: string | null;
  source: DriveAuthSource;
  expiresAt: number | null;
}

export interface DomainAuthCheckResult {
  checked: boolean;
  authorized: boolean;
  hostname: string;
  projectId: string;
  authorizedDomains: string[];
  errorMessage?: string;
}

interface CapacitorBrowserPluginLike {
  open?: (options: { url: string; presentationStyle?: 'fullscreen' | 'popover' }) => Promise<void>;
  close?: () => Promise<void>;
  addListener?: (
    eventName: 'browserFinished' | 'browserPageLoaded',
    listener: () => void
  ) => Promise<{ remove?: () => Promise<void> | void }>;
}

interface CapacitorAppPluginLike {
  addListener?: (
    eventName: string,
    listener: (data?: { url?: string; isActive?: boolean }) => void
  ) => Promise<{ remove?: () => Promise<void> | void }>;
}

const NativeBrowserPlugin = registerPlugin<CapacitorBrowserPluginLike>('Browser');
const NativeAppPlugin = registerPlugin<CapacitorAppPluginLike>('App');

let cachedFirebaseApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let isSigningIn = false;
// Access token hanya disimpan di memori (tidak pernah di localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let cachedConnectedAccount: DriveConnectedAccount | null = null;
let cachedDomainCheck: DomainAuthCheckResult | null = null;
let explicitlyLoggedOut = false;

type AuthListener = {
  onSuccess?: (user: User | null, token: string, account?: DriveConnectedAccount | null) => void;
  onFailure?: (user: User | null) => void;
};
const authListeners = new Set<AuthListener>();

let pendingExternalOAuthAbort: (() => void) | null = null;

function notifyAuthSuccess(user: User | null, token: string, account: DriveConnectedAccount | null) {
  for (const listener of authListeners) {
    try {
      listener.onSuccess?.(user, token, account);
    } catch {
      // Abaikan error callback subscriber
    }
  }
}

function notifyAuthFailure(user: User | null) {
  for (const listener of authListeners) {
    try {
      listener.onFailure?.(user);
    } catch {
      // Abaikan error callback subscriber
    }
  }
}

function getOrInitDefaultFirebaseApp(): FirebaseApp {
  if (cachedFirebaseApp) return cachedFirebaseApp;
  const existingDefault = getApps().find((app) => app.name === '[DEFAULT]');
  cachedFirebaseApp = existingDefault || initializeApp(firebaseConfig);
  return cachedFirebaseApp;
}

function getFirebaseDriveAuth(): Auth {
  if (cachedAuth) return cachedAuth;
  const app = getOrInitDefaultFirebaseApp();
  cachedAuth = getAuth(app);
  return cachedAuth;
}

function buildGoogleDriveProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  provider.setCustomParameters({
    login_hint: DRIVE_TARGET_EMAIL,
    prompt: 'select_account',
  });
  return provider;
}

function matchesAuthorizedDomain(authorizedDomains: string[], hostname: string): boolean {
  const cleanHost = hostname.trim().toLowerCase();
  if (!cleanHost) return false;
  const ipv4Regex = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
  for (const entry of authorizedDomains) {
    const cleanEntry = String(entry || '').trim().toLowerCase();
    if (!cleanEntry) continue;
    if (ipv4Regex.test(cleanEntry)) {
      if (cleanHost === cleanEntry) return true;
    } else {
      const escaped = cleanEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^(.+\\.${escaped}|${escaped})$`, 'i');
      if (regex.test(cleanHost)) return true;
    }
  }
  return false;
}

export function isNativeCapacitorRuntime(): boolean {
  try {
    if (Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()) {
      return true;
    }
    const winCap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return Boolean(winCap && typeof winCap.isNativePlatform === 'function' && winCap.isNativePlatform());
  } catch {
    return false;
  }
}

export function getPlatformOAuthMode(): 'capacitor' | 'android_webview' | 'ios_webview' | 'web' {
  if (typeof window === 'undefined') return 'web';
  if (isNativeCapacitorRuntime()) return 'capacitor';
  try {
    const ua = navigator.userAgent || '';
    if (/\bwv\b/i.test(ua) && /Android/i.test(ua)) {
      return 'android_webview';
    }
    const isIosDevice = /(iPhone|iPad|iPod)/i.test(ua);
    const isStandalone = Boolean((navigator as { standalone?: boolean }).standalone);
    if (isIosDevice && (!/Safari/i.test(ua) || isStandalone)) {
      return 'ios_webview';
    }
  } catch {
    // Abaikan error deteksi UA
  }
  return 'web';
}

export function isEmbeddedWebView(): boolean {
  return getPlatformOAuthMode() !== 'web';
}

function resolveApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin || '';
  if (
    origin.startsWith('capacitor://') ||
    origin.startsWith('ionic://') ||
    origin.startsWith('file://') ||
    (isNativeCapacitorRuntime() && origin.includes('localhost'))
  ) {
    return PUBLIC_APP_ORIGIN;
  }
  return '';
}

function buildManagerHeaders(session?: SessionUser | null): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-user-role': session?.role || 'admin',
    'x-blok-rumah': session?.blok_rumah || '',
    'x-pengurus-username': session?.blok_rumah || '',
    'x-admin-permission': session?.admin_permission || 'full',
    'x-admin-jabatan': session?.jabatan || '',
  };
}

function buildSenderPayload(session?: SessionUser | null) {
  if (!session) return undefined;
  return {
    role: session.role,
    blokRumah: session.blok_rumah,
    pengurusUsername: session.blok_rumah,
    namaWarga: session.nama_warga,
    jabatan: session.jabatan,
    adminPermission: session.admin_permission,
    is_active_pengurus: session.is_active_pengurus,
    central_settings_permissions: session.central_settings_permissions,
  };
}

export function getCachedDomainAuthStatus(): DomainAuthCheckResult | null {
  return cachedDomainCheck;
}

export async function checkFirebaseDomainAuthorization(
  forceRefresh = false
): Promise<DomainAuthCheckResult> {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  if (!forceRefresh && cachedDomainCheck && cachedDomainCheck.hostname === hostname) {
    return cachedDomainCheck;
  }
  if (!hostname || hostname === 'localhost' || isEmbeddedWebView()) {
    return {
      checked: false,
      authorized: true,
      hostname,
      projectId: firebaseConfig.projectId,
      authorizedDomains: [],
    };
  }
  try {
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(
        firebaseConfig.apiKey
      )}`,
      { method: 'GET', cache: 'no-store' }
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as { authorizedDomains?: string[] };
    const domains = Array.isArray(json.authorizedDomains) ? json.authorizedDomains : [];
    const authorized = matchesAuthorizedDomain(domains, hostname);
    cachedDomainCheck = {
      checked: true,
      authorized,
      hostname,
      projectId: firebaseConfig.projectId,
      authorizedDomains: domains,
    };
    return cachedDomainCheck;
  } catch (err) {
    return {
      checked: false,
      authorized: true,
      hostname,
      projectId: firebaseConfig.projectId,
      authorizedDomains: [],
      errorMessage: err instanceof Error ? err.message : 'Gagal memeriksa domain Firebase.',
    };
  }
}

function mapFirebaseAuthErrorMessage(err: unknown, hostname: string): string {
  const rawCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const rawMsg = err instanceof Error ? err.message : String(err || '');

  if (
    rawCode === 'auth/unauthorized-domain' ||
    rawCode === 'auth/bad-request' ||
    rawMsg.includes('The requested action is invalid')
  ) {
    return `Domain "${hostname || 'aplikasi ini'}" belum terdaftar di Authorized Domains Firebase (${firebaseConfig.projectId}). Anda tetap dapat memakai tombol "Hubungkan Langsung via Server".`;
  }
  if (rawCode === 'auth/popup-blocked') {
    return 'Popup login Google diblokir browser. Izinkan pop-up atau gunakan tombol "Hubungkan Langsung via Server".';
  }
  if (rawCode === 'auth/popup-closed-by-user') {
    return 'Jendela login Google ditutup sebelum proses masuk selesai.';
  }
  if (rawCode === 'auth/cancelled-popup-request') {
    return 'Permintaan login sebelumnya masih terbuka. Tutup tab login lama lalu klik satu kali lagi.';
  }
  if (rawCode === 'auth/network-request-failed') {
    return 'Koneksi internet terputus saat menghubungi server login Google.';
  }
  return rawMsg || 'Login Google Drive gagal atau dibatalkan.';
}

export function initGoogleDriveAuth(
  onAuthSuccess?: (
    user: User | null,
    token: string,
    account?: DriveConnectedAccount | null
  ) => void,
  onAuthFailure?: (user: User | null) => void
): () => void {
  const entry: AuthListener = { onSuccess: onAuthSuccess, onFailure: onAuthFailure };
  authListeners.add(entry);

  const auth = getFirebaseDriveAuth();
  const unsubFirebase = onAuthStateChanged(auth, (user: User | null) => {
    if (cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken, cachedConnectedAccount);
      return;
    }
    if (user && !isSigningIn) {
      cachedAccessToken = null;
      cachedConnectedAccount = null;
      onAuthFailure?.(user);
    } else if (!user && !isSigningIn) {
      onAuthFailure?.(null);
    }
  });

  return () => {
    authListeners.delete(entry);
    unsubFirebase();
  };
}

function setConnectedSession(params: {
  accessToken: string;
  email: string;
  displayName: string;
  photoLink?: string | null;
  source: DriveAuthSource;
  expiresIn?: number;
  firebaseUser?: User | null;
}): DriveConnectedAccount {
  const expiresAt =
    typeof params.expiresIn === 'number' && params.expiresIn > 30
      ? Date.now() + (params.expiresIn - 30) * 1000
      : null;

  const account: DriveConnectedAccount = {
    email: params.email || DRIVE_TARGET_EMAIL,
    displayName: params.displayName || 'Akun Google Terhubung',
    photoLink: params.photoLink || null,
    source: params.source,
    expiresAt,
  };

  cachedAccessToken = params.accessToken;
  cachedConnectedAccount = account;
  explicitlyLoggedOut = false;
  notifyAuthSuccess(params.firebaseUser ?? null, params.accessToken, account);
  return account;
}

export function applyRefreshedGoogleDriveSession(params: {
  accessToken: string;
  email?: string | null;
  displayName?: string | null;
  photoLink?: string | null;
  source?: DriveAuthSource;
  expiresIn?: number;
}): DriveConnectedAccount {
  return setConnectedSession({
    accessToken: params.accessToken,
    email: params.email || DRIVE_TARGET_EMAIL,
    displayName: params.displayName || 'Google Drive Pusat Saung Kebun',
    photoLink: params.photoLink ?? null,
    source: params.source || 'supabase_edge_function',
    expiresIn: params.expiresIn || 3600,
    firebaseUser: getGoogleDriveSignedInUser(),
  });
}

/**
 * Jalur Utama (APK, iOS, & Web):
 * Menghubungkan panel Arsip Drive langsung melalui OAuth2 Server (`GOOGLE_OAUTH_REFRESH_TOKEN`)
 * tanpa popup login Google di WebView.
 */
export async function connectGoogleDriveViaServer(
  session?: SessionUser | null
): Promise<{ account: DriveConnectedAccount; accessToken: string }> {
  const res = await fetch(`${resolveApiBaseUrl()}/api/storage/drive-oauth`, {
    method: 'POST',
    headers: buildManagerHeaders(session),
    body: JSON.stringify({
      action: 'server_token',
      sender: buildSenderPayload(session),
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
    throw new Error(
      data.error || `Gagal menghubungkan Google Drive via server (HTTP ${res.status}).`
    );
  }

  const account = setConnectedSession({
    accessToken: data.accessToken,
    email: data.email || DRIVE_TARGET_EMAIL,
    displayName: data.displayName || 'Google Drive Pusat Saung Kebun',
    photoLink: data.photoLink || null,
    source: 'server_oauth2',
    expiresIn: data.expiresIn || 3600,
    firebaseUser: null,
  });

  return { account, accessToken: data.accessToken };
}

function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

async function openUrlInSystemBrowser(url: string): Promise<'capacitor_browser' | 'chrome_intent' | 'window_open'> {
  // 1. Prioritas Capacitor @capacitor/browser (Custom Tabs Android / SFSafariViewController iOS)
  if (isNativeCapacitorRuntime()) {
    try {
      const capPlugins = (
        window as unknown as { Capacitor?: { Plugins?: { Browser?: CapacitorBrowserPluginLike } } }
      ).Capacitor?.Plugins;
      const browserImpl = capPlugins?.Browser || NativeBrowserPlugin;
      if (browserImpl && typeof browserImpl.open === 'function') {
        await browserImpl.open({ url, presentationStyle: 'popover' });
        return 'capacitor_browser';
      }
    } catch {
      // Lanjut ke intent / window.open
    }
  }

  // 2. Android WebView murni -> buka di Google Chrome via skema Intent
  if (isAndroidDevice() && getPlatformOAuthMode() === 'android_webview') {
    try {
      const withoutProto = url.replace(/^https?:\/\//i, '');
      const intentUrl = `intent://${withoutProto}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(
        url
      )};end`;
      const anchor = document.createElement('a');
      anchor.href = intentUrl;
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return 'chrome_intent';
    } catch {
      // Fallback ke window.open
    }
  }

  // 3. iOS Safari / WebView atau browser standar -> buka tab browser eksternal
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    window.location.assign(url);
  }
  return 'window_open';
}

async function closeSystemBrowserIfPossible(): Promise<void> {
  if (!isNativeCapacitorRuntime()) return;
  try {
    const capPlugins = (
      window as unknown as { Capacitor?: { Plugins?: { Browser?: CapacitorBrowserPluginLike } } }
    ).Capacitor?.Plugins;
    const browserImpl = capPlugins?.Browser || NativeBrowserPlugin;
    if (browserImpl && typeof browserImpl.close === 'function') {
      await browserImpl.close();
    }
  } catch {
    // Abaikan jika browser sudah tertutup oleh pengguna
  }
}

export function cancelPendingExternalGoogleOAuth(): void {
  if (pendingExternalOAuthAbort) {
    pendingExternalOAuthAbort();
    pendingExternalOAuthAbort = null;
  }
}

async function exchangeExternalOAuthResult(params: {
  session?: SessionUser | null;
  state: string;
  sealed?: string | null;
}): Promise<{
  status: 'pending' | 'completed' | 'error';
  accessToken?: string;
  expiresIn?: number;
  email?: string;
  displayName?: string;
  photoLink?: string | null;
  error?: string;
}> {
  const action = params.sealed ? 'exchange_sealed' : 'poll_oauth';
  const res = await fetch(`${resolveApiBaseUrl()}/api/storage/drive-oauth`, {
    method: 'POST',
    headers: buildManagerHeaders(params.session),
    body: JSON.stringify({
      action,
      state: params.state,
      ...(params.sealed ? { sealed: params.sealed } : {}),
      sender: buildSenderPayload(params.session),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: 'pending' | 'completed' | 'error';
    accessToken?: string;
    expiresIn?: number;
    email?: string;
    displayName?: string;
    photoLink?: string | null;
    error?: string;
  };
  if (!res.ok) {
    return {
      status: 'error',
      error: data.error || `Gagal memverifikasi sesi OAuth (HTTP ${res.status}).`,
    };
  }
  return {
    status: data.status || (data.ok ? 'completed' : 'error'),
    accessToken: data.accessToken,
    expiresIn: data.expiresIn,
    email: data.email,
    displayName: data.displayName,
    photoLink: data.photoLink,
    error: data.error,
  };
}

/**
 * Mencoba menyelesaikan sesi OAuth jika aplikasi dibuka kembali lewat URL web
 * (`?drive_oauth_state=...&drive_oauth_sealed=...`) atau deep link APK.
 */
export async function tryCompleteOAuthFromUrl(
  rawUrl: string,
  session?: SessionUser | null
): Promise<{ account: DriveConnectedAccount; accessToken: string } | null> {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl, PUBLIC_APP_ORIGIN);
    const state =
      parsed.searchParams.get('drive_oauth_state') || parsed.searchParams.get('state') || '';
    const sealed =
      parsed.searchParams.get('drive_oauth_sealed') || parsed.searchParams.get('sealed') || '';
    const errParam = parsed.searchParams.get('error') || '';

    if (errParam && state) {
      throw new Error(errParam);
    }
    if (!state) return null;

    const result = await exchangeExternalOAuthResult({
      session,
      state,
      sealed: sealed || null,
    });
    if (result.status === 'completed' && result.accessToken) {
      const account = setConnectedSession({
        accessToken: result.accessToken,
        email: result.email || DRIVE_TARGET_EMAIL,
        displayName: result.displayName || 'Akun Google Terhubung',
        photoLink: result.photoLink || null,
        source: 'external_browser_oauth',
        expiresIn: result.expiresIn || 3600,
        firebaseUser: null,
      });
      await closeSystemBrowserIfPossible();

      // Bersihkan query parameter di browser web jika ada
      if (typeof window !== 'undefined' && window.location.search.includes('drive_oauth_')) {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('drive_oauth_state');
        cleanUrl.searchParams.delete('drive_oauth_sealed');
        window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
      }

      return { account, accessToken: result.accessToken };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Jalur Login Google Interaktif di Android APK & iOS:
 * Membuka halaman OAuth2 Google di sistem browser eksternal (Custom Tabs / Chrome / Safari),
 * lalu menunggu deep link (`com.saungkebun.ecardipl://oauth-callback`) atau polling state.
 */
async function signInGoogleDriveViaExternalBrowser(
  session?: SessionUser | null
): Promise<{ user: User | null; account: DriveConnectedAccount; accessToken: string }> {
  cancelPendingExternalGoogleOAuth();

  const initRes = await fetch(`${resolveApiBaseUrl()}/api/storage/drive-oauth`, {
    method: 'POST',
    headers: buildManagerHeaders(session),
    body: JSON.stringify({
      action: 'init_oauth',
      sender: buildSenderPayload(session),
    }),
  });
  const initJson = (await initRes.json().catch(() => ({}))) as {
    ok?: boolean;
    state?: string;
    oauthUrl?: string;
    error?: string;
  };
  if (!initRes.ok || !initJson.ok || !initJson.oauthUrl || !initJson.state) {
    throw new Error(
      initJson.error || 'Gagal menyiapkan tautan autentikasi Google di browser sistem.'
    );
  }

  const targetState = initJson.state;
  await openUrlInSystemBrowser(initJson.oauthUrl);

  return new Promise<{ user: User | null; account: DriveConnectedAccount; accessToken: string }>(
    (resolve, reject) => {
      let settled = false;
      let pollInFlight = false;
      const cleanups: Array<() => void> = [];

      const cleanupAll = () => {
        for (const fn of cleanups) {
          try {
            fn();
          } catch {
            // Abaikan error pelepasan listener
          }
        }
        pendingExternalOAuthAbort = null;
      };

      const finishSuccess = (result: {
        accessToken: string;
        expiresIn?: number;
        email?: string;
        displayName?: string;
        photoLink?: string | null;
      }) => {
        if (settled) return;
        settled = true;
        cleanupAll();
        void closeSystemBrowserIfPossible();
        const account = setConnectedSession({
          accessToken: result.accessToken,
          email: result.email || DRIVE_TARGET_EMAIL,
          displayName: result.displayName || 'Akun Google Terhubung',
          photoLink: result.photoLink || null,
          source: 'external_browser_oauth',
          expiresIn: result.expiresIn || 3600,
          firebaseUser: null,
        });
        resolve({ user: null, account, accessToken: result.accessToken });
      };

      const finishError = (message: string) => {
        if (settled) return;
        settled = true;
        cleanupAll();
        reject(new Error(message));
      };

      pendingExternalOAuthAbort = () => {
        finishError('Proses login Google dibatalkan oleh pengguna.');
      };

      const checkServerState = async (sealed?: string | null) => {
        if (settled || (pollInFlight && !sealed)) return;
        pollInFlight = true;
        try {
          const res = await exchangeExternalOAuthResult({
            session,
            state: targetState,
            sealed,
          });
          if (settled) return;
          if (res.status === 'completed' && res.accessToken) {
            finishSuccess({
              accessToken: res.accessToken,
              expiresIn: res.expiresIn,
              email: res.email,
              displayName: res.displayName,
              photoLink: res.photoLink,
            });
          } else if (res.status === 'error') {
            finishError(res.error || 'Autentikasi Google gagal diselesaikan.');
          }
        } catch {
          // Abaikan gangguan jaringan sementara selama polling
        } finally {
          pollInFlight = false;
        }
      };

      const pollTimer = window.setInterval(() => {
        void checkServerState(null);
      }, 1600);
      cleanups.push(() => window.clearInterval(pollTimer));

      const timeoutTimer = window.setTimeout(() => {
        finishError(
          'Waktu menunggu login Google di browser sistem habis (3 menit). Silakan coba lagi atau gunakan Hubungkan Langsung via Server.'
        );
      }, 180_000);
      cleanups.push(() => window.clearTimeout(timeoutTimer));

      const handleFocusOrVisible = () => {
        if (document.visibilityState === 'visible') {
          void checkServerState(null);
        }
      };
      window.addEventListener('focus', handleFocusOrVisible);
      document.addEventListener('visibilitychange', handleFocusOrVisible);
      cleanups.push(() => {
        window.removeEventListener('focus', handleFocusOrVisible);
        document.removeEventListener('visibilitychange', handleFocusOrVisible);
      });

      if (isNativeCapacitorRuntime()) {
        try {
          const capPlugins = (
            window as unknown as {
              Capacitor?: {
                Plugins?: {
                  App?: CapacitorAppPluginLike;
                  Browser?: CapacitorBrowserPluginLike;
                };
              };
            }
          ).Capacitor?.Plugins;
          const appPlugin = capPlugins?.App || NativeAppPlugin;
          const browserPlugin = capPlugins?.Browser || NativeBrowserPlugin;

          if (appPlugin && typeof appPlugin.addListener === 'function') {
            const urlHandlePromise = appPlugin.addListener('appUrlOpen', (event) => {
              const incomingUrl = String(event?.url || '').trim();
              if (!incomingUrl) return;
              try {
                const parsed = new URL(incomingUrl);
                const urlState =
                  parsed.searchParams.get('state') ||
                  parsed.searchParams.get('drive_oauth_state') ||
                  '';
                const sealed =
                  parsed.searchParams.get('sealed') ||
                  parsed.searchParams.get('drive_oauth_sealed') ||
                  '';
                const errMsg = parsed.searchParams.get('error') || '';
                if (urlState && urlState !== targetState) return;
                if (errMsg) {
                  finishError(errMsg);
                  return;
                }
                void checkServerState(sealed || null);
              } catch {
                void checkServerState(null);
              }
            });
            cleanups.push(() => {
              void Promise.resolve(urlHandlePromise)
                .then((h) => h?.remove?.())
                .catch(() => {});
            });

            const stateHandlePromise = appPlugin.addListener('appStateChange', (st) => {
              if (st?.isActive) {
                void checkServerState(null);
              }
            });
            cleanups.push(() => {
              void Promise.resolve(stateHandlePromise)
                .then((h) => h?.remove?.())
                .catch(() => {});
            });
          }

          if (browserPlugin && typeof browserPlugin.addListener === 'function') {
            const finishHandlePromise = browserPlugin.addListener('browserFinished', () => {
              void checkServerState(null);
            });
            cleanups.push(() => {
              void Promise.resolve(finishHandlePromise)
                .then((h) => h?.remove?.())
                .catch(() => {});
            });
          }
        } catch {
          // Listener web + interval polling tetap aktif sebagai fallback
        }
      }
    }
  );
}

export async function signInGoogleDrive(
  session?: SessionUser | null
): Promise<{ user: User | null; account: DriveConnectedAccount; accessToken: string }> {
  // Jika berjalan di Android APK / WebView / iOS WebView -> alihkan ke browser sistem eksternal
  if (isEmbeddedWebView()) {
    try {
      isSigningIn = true;
      return await signInGoogleDriveViaExternalBrowser(session);
    } finally {
      isSigningIn = false;
    }
  }

  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  if (
    cachedDomainCheck?.checked &&
    cachedDomainCheck.hostname === hostname &&
    !cachedDomainCheck.authorized
  ) {
    throw new Error(
      `Domain "${hostname}" belum terdaftar di Authorized Domains Firebase (${firebaseConfig.projectId}). Anda tetap dapat memakai tombol "Hubungkan Langsung via Server".`
    );
  }

  const auth = getFirebaseDriveAuth();
  const provider = buildGoogleDriveProvider();
  try {
    isSigningIn = true;
    // Panggil langsung tanpa await sebelumnya agar user-gesture popup tidak diblokir Chrome
    const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal memperoleh token akses Google Drive dari autentikasi Google.');
    }
    const account = setConnectedSession({
      accessToken: credential.accessToken,
      email: result.user.email || DRIVE_TARGET_EMAIL,
      displayName: result.user.displayName || 'Akun Google Terhubung',
      photoLink: result.user.photoURL || null,
      source: 'firebase_popup',
      expiresIn: 3500,
      firebaseUser: result.user,
    });
    return {
      user: result.user,
      account,
      accessToken: credential.accessToken,
    };
  } catch (err) {
    throw new Error(mapFirebaseAuthErrorMessage(err, hostname));
  } finally {
    isSigningIn = false;
  }
}

export async function getGoogleDriveAccessToken(): Promise<string | null> {
  if (
    cachedAccessToken &&
    cachedConnectedAccount?.expiresAt &&
    Date.now() > cachedConnectedAccount.expiresAt
  ) {
    cachedAccessToken = null;
  }
  return cachedAccessToken;
}

export function getGoogleDriveTokenExpiresAt(): number | null {
  return cachedConnectedAccount?.expiresAt ?? null;
}

export function hasExplicitGoogleDriveLogout(): boolean {
  return explicitlyLoggedOut;
}

export function getGoogleDriveConnectedAccount(): DriveConnectedAccount | null {
  return cachedConnectedAccount;
}

export function getGoogleDriveSignedInUser(): User | null {
  try {
    return getFirebaseDriveAuth().currentUser;
  } catch {
    return null;
  }
}

export function clearGoogleDriveAccessToken(): void {
  cachedAccessToken = null;
  cachedConnectedAccount = null;
}

export async function googleDriveLogout(): Promise<void> {
  cancelPendingExternalGoogleOAuth();
  explicitlyLoggedOut = true;
  cachedAccessToken = null;
  cachedConnectedAccount = null;
  try {
    const auth = getFirebaseDriveAuth();
    await auth.signOut();
  } catch {
    // Abaikan error signOut
  }
  notifyAuthFailure(null);
}
