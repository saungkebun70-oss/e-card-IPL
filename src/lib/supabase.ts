import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from '../types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

export function isSupabaseConfigured(): boolean {
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseAnonKey) &&
    supabaseUrl.startsWith('http') &&
    !supabaseUrl.includes('YOUR_SUPABASE')
  );
}

const clientCache = new Map<string, SupabaseClient>();

/**
 * Menghasilkan instance Supabase client terisolasi per (role, blok, permission)
 * dengan custom headers `x-blok-rumah` dan `x-user-role` agar panggilan anon (mis. BrandProvider)
 * tidak pernah menimpa header sesi Admin atau Warga.
 */
export function getSupabaseClient(session?: SessionUser | null): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const blokHeader = session?.blok_rumah || '';
  const roleHeader = session?.role || 'anon';
  const permHeader = session?.admin_permission || '';
  const jabatanHeader = session?.jabatan || '';
  const petugasIdHeader = session?.petugas_id || '';
  const petugasNameHeader = session?.role === 'petugas' ? session.nama_warga || '' : '';
  const key = `${roleHeader}::${blokHeader}::${permHeader}::${jabatanHeader}::${petugasIdHeader}::${petugasNameHeader}`;

  const existing = clientCache.get(key);
  if (existing) {
    return existing;
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-blok-rumah': blokHeader,
        'x-user-role': roleHeader,
        'x-admin-permission': permHeader,
        'x-admin-jabatan': jabatanHeader,
        'x-petugas-id': petugasIdHeader,
        'x-petugas-name': petugasNameHeader,
      },
    },
  });

  clientCache.set(key, client);
  return client;
}

export interface SupabaseProbeHeaders {
  role?: 'warga' | 'admin' | 'petugas' | 'anon';
  blokRumah?: string;
  petugasId?: string;
  adminPermission?: string;
  adminJabatan?: string;
}

/**
 * Menghasilkan instance Supabase client dengan header identitas sesi (`x-user-role`, `x-blok-rumah`, `x-petugas-id`)
 * untuk panggilan pre-login / validasi RPC (`validate_login_account_status`, `login_ecard`)
 * agar kebijakan RLS dan fungsi RPC berbasis header selalu menerima konteks yang konsisten.
 */
export function getSupabaseProbeClient(probe?: SupabaseProbeHeaders | null): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const roleHeader = probe?.role || 'anon';
  const blokHeader = (probe?.blokRumah || '').trim();
  const petugasIdHeader = (probe?.petugasId || '').trim();
  const permHeader = (probe?.adminPermission || '').trim();
  const jabatanHeader = (probe?.adminJabatan || '').trim();
  const key = `probe::${roleHeader}::${blokHeader}::${permHeader}::${jabatanHeader}::${petugasIdHeader}`;

  const existing = clientCache.get(key);
  if (existing) {
    return existing;
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-blok-rumah': blokHeader,
        'x-user-role': roleHeader,
        'x-admin-permission': permHeader,
        'x-admin-jabatan': jabatanHeader,
        'x-petugas-id': petugasIdHeader,
        'x-petugas-name': '',
      },
    },
  });

  clientCache.set(key, client);
  return client;
}
