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
  const key = `${roleHeader}::${blokHeader}::${permHeader}::${jabatanHeader}`;

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
      },
    },
  });

  clientCache.set(key, client);
  return client;
}
