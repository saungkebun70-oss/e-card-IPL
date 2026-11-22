import { useEffect, useState } from 'react';
import type { SessionUser, UserRole } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { compressLogoImage } from './imageCompressor';
import { dispatchActivityNotifications, getCanonicalUserId } from './notificationService';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

const LOCAL_AVATARS_KEY = 'ecard_account_avatars_v1';
const AVATARS_CHANGED_EVENT = 'ecard-account-avatars-changed';

export interface AvatarValidationResult {
  valid: boolean;
  error?: string;
}

export interface AvatarUpdateResult {
  avatarUrl?: string | null;
  error?: string;
}

function normalizeToken(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function buildAvatarKey(role: UserRole, identifier?: string | null): string {
  const clean = normalizeToken(identifier);
  if (role === 'admin' && clean === 'admin') {
    return 'admin:andriansyah';
  }
  return `${role}:${clean}`;
}

export function getSessionAvatarKey(session?: SessionUser | null): string {
  if (!session) return '';
  if (session.role === 'petugas') {
    return buildAvatarKey('petugas', session.petugas_id || session.blok_rumah);
  }
  return buildAvatarKey(session.role, session.blok_rumah);
}

export function readAvatarMap(): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(LOCAL_AVATARS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeAvatarMap(next: Record<string, string>): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_AVATARS_KEY, JSON.stringify(next));
  } catch {
    // Abaikan keterbatasan storage
  }
}

function emitAvatarsChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AVATARS_CHANGED_EVENT));
    }
  } catch {
    // Abaikan
  }
}

export function cacheAccountAvatars(entries: Array<{ key: string; url?: string | null }>): void {
  if (!entries.length) return;
  const current = readAvatarMap();
  let changed = false;
  for (const { key, url } of entries) {
    if (!key) continue;
    const cleanUrl = typeof url === 'string' && url.trim() ? url.trim() : '';
    if (cleanUrl) {
      if (current[key] !== cleanUrl) {
        current[key] = cleanUrl;
        changed = true;
      }
    } else if (url === null && key in current) {
      delete current[key];
      changed = true;
    }
  }
  if (changed) {
    writeAvatarMap(current);
    emitAvatarsChanged();
  }
}

export function getCachedAvatarUrl(role: UserRole, identifier?: string | null): string | null {
  if (!identifier) return null;
  const map = readAvatarMap();
  const key = buildAvatarKey(role, identifier);
  return map[key] || null;
}

export function useAvatarMap(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>(() => readAvatarMap());

  useEffect(() => {
    const sync = () => setMap(readAvatarMap());
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_AVATARS_KEY) sync();
    };
    window.addEventListener(AVATARS_CHANGED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(AVATARS_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return map;
}

/**
 * Validasi ketat file foto profil: JPG, JPEG, PNG, atau WebP maksimal 2 MB.
 */
export function validateAvatarFile(file: File | null | undefined): AvatarValidationResult {
  if (!file) {
    return { valid: false, error: 'Pilih file foto terlebih dahulu.' };
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const mime = (file.type || '').toLowerCase();
  const mimeOk = mime ? ALLOWED_MIME_TYPES.has(mime) : false;
  const extOk = ALLOWED_EXTENSIONS.has(ext);

  if (!mimeOk && !extOk) {
    return {
      valid: false,
      error: 'Format foto tidak didukung. Hanya menerima file JPG, JPEG, PNG, atau WebP.',
    };
  }

  if (file.size > MAX_AVATAR_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `Ukuran file terlalu besar (${sizeMb} MB). Maksimal ukuran foto profil adalah 2 MB.`,
    };
  }

  return { valid: true };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
}

async function persistAvatarUrlToDatabase(
  session: SessionUser,
  avatarUrl: string | null
): Promise<boolean> {
  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) return false;

  const identifier =
    session.role === 'petugas' ? session.petugas_id || session.blok_rumah : session.blok_rumah;

  // 1. Coba RPC aman update_account_avatar (SECURITY DEFINER di migration_v7)
  try {
    const { data, error } = await supabase.rpc('update_account_avatar', {
      p_role: session.role,
      p_identifier: identifier,
      p_avatar_url: avatarUrl,
    });
    if (!error && data === true) {
      return true;
    }
  } catch {
    // Fallback ke update langsung
  }

  // 2. Fallback update langsung (bekerja untuk Bendahara / table dengan policy update)
  try {
    if (session.role === 'petugas') {
      const { error } = await supabase
        .from('petugas_keamanan')
        .update({ avatar_url: avatarUrl })
        .eq('id', identifier);
      return !error;
    }
    const { error } = await supabase
      .from('users_warga')
      .update({ avatar_url: avatarUrl })
      .eq('blok_rumah', session.blok_rumah);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Mengunggah foto profil ke Supabase Storage (bucket 'avatars' dengan fallback aman)
 * lalu menyimpan avatar_url ke profil akun & memicu notifikasi konfirmasi sistem.
 */
export async function uploadAccountAvatar(
  session: SessionUser,
  rawFile: File
): Promise<AvatarUpdateResult> {
  const validation = validateAvatarFile(rawFile);
  if (!validation.valid) {
    return { error: validation.error };
  }

  try {
    const optimized = await compressLogoImage(rawFile, 512);
    const uploadFile = optimized.file;
    const ext = uploadFile.name.split('.').pop()?.toLowerCase() || 'jpg';
    const rawId =
      session.role === 'petugas' ? session.petugas_id || session.blok_rumah : session.blok_rumah;
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const filePath = `${session.role}/${safeId}_${Date.now()}.${ext}`;

    let finalUrl = '';
    const supabase = getSupabaseClient(session);

    if (supabase && isSupabaseConfigured()) {
      // Coba upload ke bucket khusus 'avatars' terlebih dahulu
      const { error: avatarBucketErr } = await supabase.storage
        .from('avatars')
        .upload(filePath, uploadFile, {
          cacheControl: '3600',
          upsert: true,
        });

      if (!avatarBucketErr) {
        const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
        finalUrl = data.publicUrl;
      } else {
        // Fallback aman ke bucket publik 'bukti-ipl' bila bucket 'avatars' belum dibuat di Supabase
        const fallbackPath = `avatars/${filePath}`;
        const { error: fallbackErr } = await supabase.storage
          .from('bukti-ipl')
          .upload(fallbackPath, uploadFile, {
            cacheControl: '3600',
            upsert: true,
          });
        if (!fallbackErr) {
          const { data } = supabase.storage.from('bukti-ipl').getPublicUrl(fallbackPath);
          finalUrl = data.publicUrl;
        }
      }
    }

    if (!finalUrl) {
      finalUrl = await fileToDataUrl(uploadFile);
    }

    await persistAvatarUrlToDatabase(session, finalUrl);

    const cacheKey = getSessionAvatarKey(session);
    const cacheEntries: Array<{ key: string; url: string | null }> = [
      { key: cacheKey, url: finalUrl },
    ];
    if (session.role === 'petugas' && session.blok_rumah) {
      cacheEntries.push({
        key: buildAvatarKey('petugas', session.blok_rumah),
        url: finalUrl,
      });
    }
    cacheAccountAvatars(cacheEntries);

    // Kirim notifikasi konfirmasi ke akun terkait
    const targetUrl =
      session.role === 'warga'
        ? 'tab:profil'
        : session.role === 'petugas'
          ? 'tab:info'
          : 'settings:profil';

    void dispatchActivityNotifications(
      { ...session, avatar_url: finalUrl },
      [
        {
          user_id: getCanonicalUserId(session),
          category: 'system',
          title: 'Foto Profil Diperbarui',
          message: `Foto profil akun ${session.nama_warga} berhasil disimpan dan ditampilkan di seluruh portal.`,
          target_url: targetUrl,
          actor_avatar_url: finalUrl,
        },
      ]
    );

    return { avatarUrl: finalUrl };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'Gagal mengunggah foto profil. Silakan coba lagi.',
    };
  }
}

/**
 * Menghapus foto profil akun (avatar_url = null) sehingga kembali ke avatar inisial hijau.
 */
export async function removeAccountAvatar(session: SessionUser): Promise<AvatarUpdateResult> {
  try {
    await persistAvatarUrlToDatabase(session, null);

    const cacheKey = getSessionAvatarKey(session);
    const cacheEntries: Array<{ key: string; url: string | null }> = [{ key: cacheKey, url: null }];
    if (session.role === 'petugas' && session.blok_rumah) {
      cacheEntries.push({
        key: buildAvatarKey('petugas', session.blok_rumah),
        url: null,
      });
    }
    cacheAccountAvatars(cacheEntries);

    const targetUrl =
      session.role === 'warga'
        ? 'tab:profil'
        : session.role === 'petugas'
          ? 'tab:info'
          : 'settings:profil';

    void dispatchActivityNotifications(
      { ...session, avatar_url: null },
      [
        {
          user_id: getCanonicalUserId(session),
          category: 'system',
          title: 'Foto Profil Dihapus',
          message: `Foto profil akun ${session.nama_warga} telah dihapus dan kembali menggunakan avatar inisial.`,
          target_url: targetUrl,
          actor_avatar_url: null,
        },
      ]
    );

    return { avatarUrl: null };
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? err.message
          : 'Gagal menghapus foto profil. Silakan coba lagi.',
    };
  }
}
