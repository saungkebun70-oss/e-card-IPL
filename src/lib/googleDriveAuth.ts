import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_TARGET_EMAIL = 'saungkebun70@gmail.com';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

let cachedFirebaseApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let isSigningIn = false;
// Access token hanya disimpan di memori (tidak pernah di localStorage/sessionStorage).
let cachedAccessToken: string | null = null;

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
  const auth = getFirebaseDriveAuth();
  const provider = buildGoogleDriveProvider();
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal memperoleh token akses Google Drive dari autentikasi Google.');
    }
    cachedAccessToken = credential.accessToken;
    return {
      user: result.user,
      accessToken: cachedAccessToken,
    };
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
