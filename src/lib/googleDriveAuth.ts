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

export const DRIVE_TARGET_EMAIL = 'saungkebun70@gmail.com';
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_AUTH_SETTINGS_URL = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`;

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

export interface DomainAuthCheckResult {
  checked: boolean;
  authorized: boolean;
  hostname: string;
  projectId: string;
  authorizedDomains: string[];
  errorMessage?: string;
}

let cachedFirebaseApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let isSigningIn = false;
// Access token hanya disimpan di memori (tidak pernah di localStorage/sessionStorage).
let cachedAccessToken: string | null = null;
let cachedDomainCheck: DomainAuthCheckResult | null = null;

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

export function isEmbeddedWebView(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
      return true;
    }
    const ua = navigator.userAgent || '';
    // Deteksi Android WebView (; wv) yang sering diblokir Google OAuth (disallowed_useragent)
    if (/\bwv\b/i.test(ua) && /Android/i.test(ua)) {
      return true;
    }
  } catch {
    // Abaikan error deteksi UA
  }
  return false;
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
  if (!hostname) {
    return {
      checked: false,
      authorized: true,
      hostname: '',
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
    return `Domain "${hostname || 'aplikasi ini'}" belum terdaftar di Authorized Domains Firebase (${firebaseConfig.projectId}). Tambahkan domain tersebut di Firebase Console → Authentication → Settings → Authorized domains lalu coba lagi.`;
  }
  if (rawCode === 'auth/popup-blocked') {
    return 'Popup login Google diblokir browser. Izinkan pop-up untuk situs ini di setelan Chrome lalu klik tombol Sign in with Google lagi.';
  }
  if (rawCode === 'auth/popup-closed-by-user') {
    return 'Jendela login Google ditutup sebelum proses masuk selesai.';
  }
  if (rawCode === 'auth/cancelled-popup-request') {
    return 'Permintaan login sebelumnya masih terbuka. Tutup tab login lama lalu klik satu kali lagi.';
  }
  if (rawCode === 'auth/operation-not-supported-in-this-environment') {
    return 'Browser/WebView ini tidak mendukung popup login Google. Buka aplikasi langsung melalui Google Chrome.';
  }
  if (rawCode === 'auth/network-request-failed') {
    return 'Koneksi internet terputus saat menghubungi server login Google.';
  }
  return rawMsg || 'Login Google Drive gagal atau dibatalkan.';
}

export function initGoogleDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: (user: User | null) => void
): () => void {
  const auth = getFirebaseDriveAuth();
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.(user);
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.(null);
    }
  });
}

export async function signInGoogleDrive(): Promise<{ user: User; accessToken: string }> {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  if (isEmbeddedWebView()) {
    throw new Error(
      `Login akun Google tidak didukung di dalam WebView/APK. Buka https://${hostname || 'e-card-ipl.vercel.app'} langsung di Google Chrome untuk menghubungkan Google Drive.`
    );
  }
  if (cachedDomainCheck?.checked && cachedDomainCheck.hostname === hostname && !cachedDomainCheck.authorized) {
    throw new Error(
      `Domain "${hostname}" belum terdaftar di Authorized Domains Firebase (${firebaseConfig.projectId}). Tambahkan domain ini di Firebase Console terlebih dahulu agar tidak muncul error "The requested action is invalid."`
    );
  }

  const auth = getFirebaseDriveAuth();
  const provider = buildGoogleDriveProvider();
  try {
    isSigningIn = true;
    // Panggil langsung tanpa await sebelumnya agar user-gesture popup tidak diblokir Chrome Android
    const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal memperoleh token akses Google Drive dari autentikasi Google.');
    }
    cachedAccessToken = credential.accessToken;
    return {
      user: result.user,
      accessToken: cachedAccessToken,
    };
  } catch (err) {
    throw new Error(mapFirebaseAuthErrorMessage(err, hostname));
  } finally {
    isSigningIn = false;
  }
}

export async function getGoogleDriveAccessToken(): Promise<string | null> {
  return cachedAccessToken;
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
}

export async function googleDriveLogout(): Promise<void> {
  cachedAccessToken = null;
  try {
    const auth = getFirebaseDriveAuth();
    await auth.signOut();
  } catch {
    // Abaikan error signOut
  }
}
