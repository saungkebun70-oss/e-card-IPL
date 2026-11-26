import { Capacitor } from '@capacitor/core';
import {
  AndroidBiometryStrength,
  BiometricAuth,
  BiometryError,
  BiometryErrorType,
  BiometryType,
  type CheckBiometryResult,
} from '@aparajita/capacitor-biometric-auth';
import type { SessionUser } from '../types';
import { formatBlokRumah } from './phoneAndBlockUtils';

const PETUGAS_BIOMETRIC_STORAGE_KEY = 'saungkebun_petugas_biometric_v1';
const WARGA_BIOMETRIC_STORAGE_KEY = 'saungkebun_warga_biometric_v1';
const ADMIN_BIOMETRIC_STORAGE_KEY = 'saungkebun_admin_biometric_v1';
const BIOMETRIC_ENROLLMENT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 hari sebelum wajib verifikasi PIN ulang

export type BiometricProvider = 'capacitor' | 'webauthn' | 'none';

export interface BiometricAvailability {
  isAvailable: boolean;
  isNative: boolean;
  provider: BiometricProvider;
  biometryType: BiometryType;
  label: string;
  isFace: boolean;
  reason?: string;
}

export interface BiometricEnrollmentProfile {
  petugas_id: string;
  username: string;
  nama: string;
  shift: string;
  enrolled_at: string;
  expires_at: string;
  provider: Exclude<BiometricProvider, 'none'>;
  webauthn_credential_id?: string;
}

export interface WargaBiometricEnrollmentProfile {
  blok_rumah: string;
  nama: string;
  status_hunian?: string;
  enrolled_at: string;
  expires_at: string;
  provider: Exclude<BiometricProvider, 'none'>;
  webauthn_credential_id?: string;
}

export interface AdminBiometricEnrollmentProfile {
  username: string;
  nama: string;
  jabatan?: string;
  admin_permission?: 'full' | 'add_only';
  enrolled_at: string;
  expires_at: string;
  provider: Exclude<BiometricProvider, 'none'>;
  webauthn_credential_id?: string;
}

export function getBiometryLabel(type: BiometryType): string {
  switch (type) {
    case BiometryType.faceId:
      return 'Face ID';
    case BiometryType.touchId:
      return 'Touch ID';
    case BiometryType.fingerprintAuthentication:
      return 'Sidik Jari';
    case BiometryType.faceAuthentication:
      return 'Pengenalan Wajah';
    case BiometryType.irisAuthentication:
      return 'Pemindai Iris';
    default:
      return 'Sidik Jari / Face ID';
  }
}

export function isFaceBiometry(type: BiometryType): boolean {
  return (
    type === BiometryType.faceId ||
    type === BiometryType.faceAuthentication ||
    type === BiometryType.irisAuthentication
  );
}

function mapNativeCheckResult(result: CheckBiometryResult): BiometricAvailability {
  const usable = Boolean(result.isAvailable || result.deviceIsSecure);
  const label =
    result.biometryType !== BiometryType.none
      ? getBiometryLabel(result.biometryType)
      : result.deviceIsSecure
        ? 'Kunci Layar Perangkat'
        : 'Biometrik';

  return {
    isAvailable: usable,
    isNative: true,
    provider: usable ? 'capacitor' : 'none',
    biometryType: result.biometryType,
    label,
    isFace: isFaceBiometry(result.biometryType),
    reason: usable ? undefined : result.reason || 'Biometrik belum diaktifkan di perangkat ini.',
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isSafeNativePlatform(): boolean {
  try {
    return Boolean(
      Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()
    );
  } catch {
    return false;
  }
}

async function isWebAuthnPlatformAvailable(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.isSecureContext) return false;
    if (
      typeof window.PublicKeyCredential === 'undefined' ||
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
    ) {
      return false;
    }
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function checkPetugasBiometryAvailability(): Promise<BiometricAvailability> {
  if (isSafeNativePlatform()) {
    try {
      const result = await BiometricAuth.checkBiometry();
      if (result) {
        return mapNativeCheckResult(result);
      }
    } catch {
      return {
        isAvailable: false,
        isNative: true,
        provider: 'none',
        biometryType: BiometryType.none,
        label: 'Sidik Jari / Face ID',
        isFace: false,
        reason: 'Sensor biometrik tidak terdeteksi pada perangkat ini.',
      };
    }
  }

  try {
    const webAuthnReady = await isWebAuthnPlatformAvailable();
    if (webAuthnReady) {
      return {
        isAvailable: true,
        isNative: false,
        provider: 'webauthn',
        biometryType: BiometryType.fingerprintAuthentication,
        label: 'Sidik Jari / Face ID',
        isFace: false,
      };
    }
  } catch {
    // Abaikan jika WebAuthn tidak didukung browser
  }

  return {
    isAvailable: false,
    isNative: false,
    provider: 'none',
    biometryType: BiometryType.none,
    label: 'Sidik Jari / Face ID',
    isFace: false,
    reason: 'Gunakan aplikasi Android/iOS atau perangkat dengan sensor biometrik aktif.',
  };
}

export const checkDeviceBiometryAvailability = checkPetugasBiometryAvailability;

export async function subscribeBiometryResume(
  callback: (availability: BiometricAvailability) => void
): Promise<() => void> {
  if (!isSafeNativePlatform()) {
    return () => {};
  }
  try {
    // checkBiometry() wajib dipanggil minimal sekali sebelum addResumeListener()
    await BiometricAuth.checkBiometry();
    const handle = await Promise.resolve(
      BiometricAuth.addResumeListener((info) => {
        try {
          if (info) {
            callback(mapNativeCheckResult(info));
          }
        } catch {
          // Abaikan error callback resume
        }
      })
    );
    return () => {
      try {
        if (handle && typeof handle.remove === 'function') {
          void Promise.resolve(handle.remove()).catch(() => {});
        }
      } catch {
        // Abaikan error pelepasan listener
      }
    };
  } catch {
    return () => {};
  }
}

/**
 * Membaca profil pendaftaran biometrik Petugas Keamanan (TANPA menyimpan PIN sama sekali).
 */
export function loadPetugasBiometricEnrollment(): BiometricEnrollmentProfile | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(PETUGAS_BIOMETRIC_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<BiometricEnrollmentProfile>;
    if (
      !parsed ||
      typeof parsed.petugas_id !== 'string' ||
      !parsed.petugas_id.trim() ||
      typeof parsed.username !== 'string' ||
      !parsed.username.trim() ||
      typeof parsed.nama !== 'string' ||
      !parsed.nama.trim() ||
      typeof parsed.expires_at !== 'string'
    ) {
      clearPetugasBiometricEnrollment();
      return null;
    }

    const expiresAtMs = Date.parse(parsed.expires_at);
    if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
      clearPetugasBiometricEnrollment();
      return null;
    }

    const provider: Exclude<BiometricProvider, 'none'> =
      parsed.provider === 'webauthn' ? 'webauthn' : 'capacitor';

    // Hindari ketidakcocokan profil WebAuthn saat dibuka dari native atau sebaliknya
    if (isSafeNativePlatform() && provider === 'webauthn') {
      return {
        petugas_id: parsed.petugas_id,
        username: parsed.username,
        nama: parsed.nama,
        shift: typeof parsed.shift === 'string' ? parsed.shift : '',
        enrolled_at: parsed.enrolled_at || new Date().toISOString(),
        expires_at: parsed.expires_at,
        provider: 'capacitor',
      };
    }

    return {
      petugas_id: parsed.petugas_id,
      username: parsed.username,
      nama: parsed.nama,
      shift: typeof parsed.shift === 'string' ? parsed.shift : '',
      enrolled_at: parsed.enrolled_at || new Date().toISOString(),
      expires_at: parsed.expires_at,
      provider,
      webauthn_credential_id:
        typeof parsed.webauthn_credential_id === 'string'
          ? parsed.webauthn_credential_id
          : undefined,
    };
  } catch {
    return null;
  }
}

export function clearPetugasBiometricEnrollment(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(PETUGAS_BIOMETRIC_STORAGE_KEY);
    }
  } catch {
    // Abaikan jika storage diblokir
  }
}

function savePetugasBiometricEnrollment(profile: BiometricEnrollmentProfile): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PETUGAS_BIOMETRIC_STORAGE_KEY, JSON.stringify(profile));
    }
  } catch {
    // Abaikan jika kuota penuh
  }
}

function formatBiometryError(err: unknown): { cancelled: boolean; message: string } {
  if (err instanceof BiometryError || (typeof err === 'object' && err !== null && 'code' in err)) {
    const code = String((err as { code?: unknown }).code || '');
    switch (code) {
      case BiometryErrorType.userCancel:
      case BiometryErrorType.systemCancel:
      case BiometryErrorType.appCancel:
      case BiometryErrorType.userFallback:
        return { cancelled: true, message: 'Verifikasi biometrik dibatalkan.' };
      case BiometryErrorType.biometryLockout:
        return {
          cancelled: false,
          message:
            'Sensor biometrik terkunci sementara karena terlalu banyak percobaan gagal. Silakan masuk menggunakan PIN 6 digit.',
        };
      case BiometryErrorType.biometryNotEnrolled:
        return {
          cancelled: false,
          message:
            'Sidik jari atau Face ID belum didaftarkan di Pengaturan HP Anda. Gunakan PIN 6 digit.',
        };
      case BiometryErrorType.biometryNotAvailable:
      case BiometryErrorType.passcodeNotSet:
      case BiometryErrorType.noDeviceCredential:
        return {
          cancelled: false,
          message:
            'Keamanan biometrik tidak tersedia pada perangkat ini. Silakan masuk menggunakan PIN 6 digit.',
        };
      case BiometryErrorType.authenticationFailed:
        return {
          cancelled: false,
          message: 'Sidik jari / wajah tidak cocok. Coba lagi atau gunakan PIN 6 digit.',
        };
      default:
        break;
    }
  }

  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
    return { cancelled: true, message: 'Verifikasi biometrik dibatalkan.' };
  }

  const fallback =
    err instanceof Error && err.message
      ? err.message
      : 'Gagal memverifikasi biometrik. Silakan gunakan PIN 6 digit.';
  return { cancelled: false, message: fallback };
}

async function createWebAuthnCredential(session: SessionUser): Promise<string> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(
    `${session.role}:${session.petugas_id || session.blok_rumah}`.slice(0, 64)
  );
  const rpId = window.location.hostname;

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rp: {
        name: 'e-Card IPL Saung Kebun',
        id: rpId,
      },
      user: {
        id: toArrayBuffer(userIdBytes),
        name: session.blok_rumah,
        displayName: session.nama_warga,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('Pendaftaran biometrik perangkat dibatalkan.');
  }
  return bytesToBase64Url(new Uint8Array(credential.rawId));
}

async function verifyWebAuthnCredential(credentialId: string): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId = base64UrlToBytes(credentialId);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rpId: window.location.hostname,
      allowCredentials: [
        {
          id: toArrayBuffer(rawId),
          type: 'public-key',
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  if (!assertion) {
    throw new Error('Verifikasi biometrik tidak diselesaikan.');
  }
}

/**
 * Mengaktifkan masuk cepat biometrik untuk sesi Petugas Keamanan saat ini.
 * Meminta verifikasi biometrik langsung agar hanya pemilik perangkat yang dapat mengaktifkan.
 */
export async function enrollPetugasBiometric(
  session: SessionUser,
  availability: BiometricAvailability
): Promise<{ ok: boolean; cancelled?: boolean; profile?: BiometricEnrollmentProfile; error?: string }> {
  if (session.role !== 'petugas' || !session.petugas_id) {
    return { ok: false, error: 'Hanya akun Petugas Keamanan yang dapat mengaktifkan fitur ini.' };
  }
  if (!availability.isAvailable || availability.provider === 'none') {
    return {
      ok: false,
      error: availability.reason || 'Perangkat belum mendukung autentikasi biometrik.',
    };
  }

  try {
    let webAuthnCredentialId: string | undefined;

    if (availability.provider === 'capacitor') {
      await BiometricAuth.authenticate({
        reason: `Aktifkan masuk cepat ${availability.label} untuk ${session.nama_warga}`,
        cancelTitle: 'Batal',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Gunakan Kode Sandi HP',
        androidTitle: 'Aktifkan Masuk Cepat Keamanan',
        androidSubtitle: `Konfirmasi ${availability.label} untuk ${session.nama_warga}`,
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
    } else {
      webAuthnCredentialId = await createWebAuthnCredential(session);
    }

    const now = Date.now();
    const profile: BiometricEnrollmentProfile = {
      petugas_id: session.petugas_id,
      username: session.blok_rumah,
      nama: session.nama_warga,
      shift: session.shift || '',
      enrolled_at: new Date(now).toISOString(),
      expires_at: new Date(now + BIOMETRIC_ENROLLMENT_TTL_MS).toISOString(),
      provider: availability.provider,
      webauthn_credential_id: webAuthnCredentialId,
    };

    savePetugasBiometricEnrollment(profile);
    return { ok: true, profile };
  } catch (err) {
    const parsed = formatBiometryError(err);
    return { ok: false, cancelled: parsed.cancelled, error: parsed.message };
  }
}

/**
 * Memicu dialog biometrik OS (Face ID / Touch ID / Sidik Jari Android) untuk membuka Portal Petugas.
 */
export async function authenticatePetugasBiometric(
  profile: BiometricEnrollmentProfile,
  availability: BiometricAvailability
): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
  if (!availability.isAvailable || availability.provider === 'none') {
    return {
      ok: false,
      error: availability.reason || 'Sensor biometrik tidak tersedia di perangkat ini.',
    };
  }

  try {
    if (availability.provider === 'capacitor') {
      await BiometricAuth.authenticate({
        reason: `Verifikasi ${availability.label} untuk masuk sebagai ${profile.nama}`,
        cancelTitle: 'Gunakan PIN',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Gunakan Kode Sandi HP',
        androidTitle: 'Masuk Portal Keamanan',
        androidSubtitle: `${profile.nama}${profile.shift ? ` · ${profile.shift}` : ''}`,
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
      return { ok: true };
    }

    if (!profile.webauthn_credential_id) {
      return {
        ok: false,
        error: 'Profil biometrik browser perlu didaftarkan ulang menggunakan PIN 6 digit.',
      };
    }

    await verifyWebAuthnCredential(profile.webauthn_credential_id);
    return { ok: true };
  } catch (err) {
    const parsed = formatBiometryError(err);
    return { ok: false, cancelled: parsed.cancelled, error: parsed.message };
  }
}

// =========================================================================
// Biometrik Portal Warga (Terisolasi dari Petugas & Admin, TANPA simpan PIN)
// =========================================================================

export function loadWargaBiometricEnrollment(): WargaBiometricEnrollmentProfile | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(WARGA_BIOMETRIC_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<WargaBiometricEnrollmentProfile>;
    if (
      !parsed ||
      typeof parsed.blok_rumah !== 'string' ||
      !parsed.blok_rumah.trim() ||
      typeof parsed.nama !== 'string' ||
      !parsed.nama.trim() ||
      typeof parsed.expires_at !== 'string'
    ) {
      clearWargaBiometricEnrollment();
      return null;
    }

    const expiresAtMs = Date.parse(parsed.expires_at);
    if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
      clearWargaBiometricEnrollment();
      return null;
    }

    const provider: Exclude<BiometricProvider, 'none'> =
      parsed.provider === 'webauthn' ? 'webauthn' : 'capacitor';

    if (isSafeNativePlatform() && provider === 'webauthn') {
      return {
        blok_rumah: parsed.blok_rumah,
        nama: parsed.nama,
        status_hunian: typeof parsed.status_hunian === 'string' ? parsed.status_hunian : undefined,
        enrolled_at: parsed.enrolled_at || new Date().toISOString(),
        expires_at: parsed.expires_at,
        provider: 'capacitor',
      };
    }

    return {
      blok_rumah: parsed.blok_rumah,
      nama: parsed.nama,
      status_hunian: typeof parsed.status_hunian === 'string' ? parsed.status_hunian : undefined,
      enrolled_at: parsed.enrolled_at || new Date().toISOString(),
      expires_at: parsed.expires_at,
      provider,
      webauthn_credential_id:
        typeof parsed.webauthn_credential_id === 'string'
          ? parsed.webauthn_credential_id
          : undefined,
    };
  } catch {
    return null;
  }
}

export function clearWargaBiometricEnrollment(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(WARGA_BIOMETRIC_STORAGE_KEY);
    }
  } catch {
    // Abaikan jika storage diblokir
  }
}

function saveWargaBiometricEnrollment(profile: WargaBiometricEnrollmentProfile): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(WARGA_BIOMETRIC_STORAGE_KEY, JSON.stringify(profile));
    }
  } catch {
    // Abaikan jika kuota penuh
  }
}

export async function enrollWargaBiometric(
  session: SessionUser,
  availability: BiometricAvailability
): Promise<{
  ok: boolean;
  cancelled?: boolean;
  profile?: WargaBiometricEnrollmentProfile;
  error?: string;
}> {
  if (session.role !== 'warga' || !session.blok_rumah) {
    return { ok: false, error: 'Hanya akun Warga yang dapat mengaktifkan fitur ini.' };
  }
  if (!availability.isAvailable || availability.provider === 'none') {
    return {
      ok: false,
      error: availability.reason || 'Perangkat belum mendukung autentikasi biometrik.',
    };
  }

  try {
    let webAuthnCredentialId: string | undefined;

    if (availability.provider === 'capacitor') {
      const displayBlok = formatBlokRumah(session.blok_rumah) || session.blok_rumah;
      await BiometricAuth.authenticate({
        reason: `Aktifkan masuk cepat ${availability.label} untuk Blok ${displayBlok}`,
        cancelTitle: 'Batal',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Gunakan Kode Sandi HP',
        androidTitle: 'Aktifkan Masuk Cepat Portal Warga',
        androidSubtitle: `Konfirmasi ${availability.label} · ${session.nama_warga} (${displayBlok})`,
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
    } else {
      webAuthnCredentialId = await createWebAuthnCredential(session);
    }

    const now = Date.now();
    const profile: WargaBiometricEnrollmentProfile = {
      blok_rumah: session.blok_rumah,
      nama: session.nama_warga || session.blok_rumah,
      status_hunian: session.status_hunian,
      enrolled_at: new Date(now).toISOString(),
      expires_at: new Date(now + BIOMETRIC_ENROLLMENT_TTL_MS).toISOString(),
      provider: availability.provider,
      webauthn_credential_id: webAuthnCredentialId,
    };

    saveWargaBiometricEnrollment(profile);
    return { ok: true, profile };
  } catch (err) {
    const parsed = formatBiometryError(err);
    return { ok: false, cancelled: parsed.cancelled, error: parsed.message };
  }
}

export async function authenticateWargaBiometric(
  profile: WargaBiometricEnrollmentProfile,
  availability: BiometricAvailability
): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
  if (!availability.isAvailable || availability.provider === 'none') {
    return {
      ok: false,
      error: availability.reason || 'Sensor biometrik tidak tersedia di perangkat ini.',
    };
  }

  try {
    if (availability.provider === 'capacitor') {
      const displayBlok = formatBlokRumah(profile.blok_rumah) || profile.blok_rumah;
      await BiometricAuth.authenticate({
        reason: `Verifikasi ${availability.label} untuk masuk Portal Warga (${displayBlok})`,
        cancelTitle: 'Gunakan PIN',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Gunakan Kode Sandi HP',
        androidTitle: 'Masuk Portal Warga',
        androidSubtitle: `${profile.nama} · Blok ${displayBlok}`,
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
      return { ok: true };
    }

    if (!profile.webauthn_credential_id) {
      return {
        ok: false,
        error: 'Profil biometrik browser perlu didaftarkan ulang menggunakan PIN 6 digit.',
      };
    }

    await verifyWebAuthnCredential(profile.webauthn_credential_id);
    return { ok: true };
  } catch (err) {
    const parsed = formatBiometryError(err);
    return { ok: false, cancelled: parsed.cancelled, error: parsed.message };
  }
}

// =========================================================================
// Biometrik Portal Admin / Pengurus (Terisolasi, TANPA simpan PIN)
// =========================================================================

export function loadAdminBiometricEnrollment(): AdminBiometricEnrollmentProfile | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = window.localStorage.getItem(ADMIN_BIOMETRIC_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AdminBiometricEnrollmentProfile>;
    if (
      !parsed ||
      typeof parsed.username !== 'string' ||
      !parsed.username.trim() ||
      typeof parsed.nama !== 'string' ||
      !parsed.nama.trim() ||
      typeof parsed.expires_at !== 'string'
    ) {
      clearAdminBiometricEnrollment();
      return null;
    }

    const expiresAtMs = Date.parse(parsed.expires_at);
    if (Number.isNaN(expiresAtMs) || Date.now() > expiresAtMs) {
      clearAdminBiometricEnrollment();
      return null;
    }

    const provider: Exclude<BiometricProvider, 'none'> =
      parsed.provider === 'webauthn' ? 'webauthn' : 'capacitor';

    if (isSafeNativePlatform() && provider === 'webauthn') {
      return {
        username: parsed.username,
        nama: parsed.nama,
        jabatan: typeof parsed.jabatan === 'string' ? parsed.jabatan : undefined,
        admin_permission:
          parsed.admin_permission === 'full' || parsed.admin_permission === 'add_only'
            ? parsed.admin_permission
            : undefined,
        enrolled_at: parsed.enrolled_at || new Date().toISOString(),
        expires_at: parsed.expires_at,
        provider: 'capacitor',
      };
    }

    return {
      username: parsed.username,
      nama: parsed.nama,
      jabatan: typeof parsed.jabatan === 'string' ? parsed.jabatan : undefined,
      admin_permission:
        parsed.admin_permission === 'full' || parsed.admin_permission === 'add_only'
          ? parsed.admin_permission
          : undefined,
      enrolled_at: parsed.enrolled_at || new Date().toISOString(),
      expires_at: parsed.expires_at,
      provider,
      webauthn_credential_id:
        typeof parsed.webauthn_credential_id === 'string'
          ? parsed.webauthn_credential_id
          : undefined,
    };
  } catch {
    return null;
  }
}

export function clearAdminBiometricEnrollment(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(ADMIN_BIOMETRIC_STORAGE_KEY);
    }
  } catch {
    // Abaikan jika storage diblokir
  }
}

function saveAdminBiometricEnrollment(profile: AdminBiometricEnrollmentProfile): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(ADMIN_BIOMETRIC_STORAGE_KEY, JSON.stringify(profile));
    }
  } catch {
    // Abaikan jika kuota penuh
  }
}

export async function enrollAdminBiometric(
  session: SessionUser,
  availability: BiometricAvailability
): Promise<{
  ok: boolean;
  cancelled?: boolean;
  profile?: AdminBiometricEnrollmentProfile;
  error?: string;
}> {
  if (session.role !== 'admin' || !session.blok_rumah) {
    return { ok: false, error: 'Hanya akun Pengurus / Admin yang dapat mengaktifkan fitur ini.' };
  }
  if (!availability.isAvailable || availability.provider === 'none') {
    return {
      ok: false,
      error: availability.reason || 'Perangkat belum mendukung autentikasi biometrik.',
    };
  }

  try {
    let webAuthnCredentialId: string | undefined;

    if (availability.provider === 'capacitor') {
      await BiometricAuth.authenticate({
        reason: `Aktifkan masuk cepat ${availability.label} untuk ${session.nama_warga}`,
        cancelTitle: 'Batal',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Gunakan Kode Sandi HP',
        androidTitle: 'Aktifkan Masuk Cepat Pengurus',
        androidSubtitle: `Konfirmasi ${availability.label} · ${session.nama_warga}${session.jabatan ? ` (${session.jabatan})` : ''}`,
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
    } else {
      webAuthnCredentialId = await createWebAuthnCredential(session);
    }

    const now = Date.now();
    const profile: AdminBiometricEnrollmentProfile = {
      username: session.blok_rumah,
      nama: session.nama_warga || session.blok_rumah,
      jabatan: session.jabatan,
      admin_permission: session.admin_permission,
      enrolled_at: new Date(now).toISOString(),
      expires_at: new Date(now + BIOMETRIC_ENROLLMENT_TTL_MS).toISOString(),
      provider: availability.provider,
      webauthn_credential_id: webAuthnCredentialId,
    };

    saveAdminBiometricEnrollment(profile);
    return { ok: true, profile };
  } catch (err) {
    const parsed = formatBiometryError(err);
    return { ok: false, cancelled: parsed.cancelled, error: parsed.message };
  }
}

export async function authenticateAdminBiometric(
  profile: AdminBiometricEnrollmentProfile,
  availability: BiometricAvailability
): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
  if (!availability.isAvailable || availability.provider === 'none') {
    return {
      ok: false,
      error: availability.reason || 'Sensor biometrik tidak tersedia di perangkat ini.',
    };
  }

  try {
    if (availability.provider === 'capacitor') {
      await BiometricAuth.authenticate({
        reason: `Verifikasi ${availability.label} untuk masuk Portal Pengurus sebagai ${profile.nama}`,
        cancelTitle: 'Gunakan PIN',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Gunakan Kode Sandi HP',
        androidTitle: 'Masuk Portal Pengurus / Admin',
        androidSubtitle: `${profile.nama}${profile.jabatan ? ` · ${profile.jabatan}` : ''}`,
        androidConfirmationRequired: false,
        androidBiometryStrength: AndroidBiometryStrength.weak,
      });
      return { ok: true };
    }

    if (!profile.webauthn_credential_id) {
      return {
        ok: false,
        error: 'Profil biometrik browser perlu didaftarkan ulang menggunakan PIN 6 digit.',
      };
    }

    await verifyWebAuthnCredential(profile.webauthn_credential_id);
    return { ok: true };
  } catch (err) {
    const parsed = formatBiometryError(err);
    return { ok: false, cancelled: parsed.cancelled, error: parsed.message };
  }
}
