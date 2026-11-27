/**
 * Supabase Edge Function: drive-oauth-refresh (Standalone Ready-to-Deploy)
 *
 * Melakukan refresh access token Google OAuth2 secara otomatis di server
 * menggunakan `GOOGLE_OAUTH_REFRESH_TOKEN` untuk akun Pengurus terotorisasi
 * (Bendahara, Ketua, atau Pengurus dengan izin modul `settings.system_integrations`)
 * agar akses ke Folder Drive tetap konsisten tanpa interaksi pengguna.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEFAULT_TARGET_DRIVE_EMAIL = 'saungkebun70@gmail.com';

const ALLOWED_STATIC_ORIGINS = new Set([
  'https://e-card-ipl.vercel.app',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

interface SenderCallerHint {
  role?: string;
  blokRumah?: string;
  pengurusUsername?: string;
  namaWarga?: string;
  jabatan?: string;
  adminPermission?: string;
}

interface UsersWargaRow {
  blok_rumah?: string | null;
  nama_warga?: string | null;
  role?: string | null;
  bot_role?: string | null;
  jabatan?: string | null;
  admin_permission?: string | null;
  aktif?: boolean | null;
}

const KNOWN_PENGURUS_DIRECTORY = [
  { username: 'bpiwan', nama: 'Bp. Iwan', jabatan: 'Pembina', linkedBlock: 'B8/5' },
  { username: 'erlangga', nama: 'Erlangga', jabatan: 'Ketua', linkedBlock: 'B3/7' },
  { username: 'andriansyah', nama: 'Andriansyah', jabatan: 'Bendahara', linkedBlock: 'B7/16' },
  { username: 'doni', nama: 'Doni', jabatan: 'Humas', linkedBlock: 'B5/21' },
  { username: 'wahyu', nama: 'Wahyu', jabatan: 'Humas', linkedBlock: 'B5/24' },
  { username: 'deny', nama: 'Deny', jabatan: 'Seksi Olahraga', linkedBlock: 'B8/6' },
] as const;

function stripOuterQuotes(raw?: string | null): string {
  let clean = String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  while (clean.length >= 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`')
    ) {
      clean = clean.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return clean;
}

function readFirstSecretEnv(names: string[]): string {
  for (const name of names) {
    const val = stripOuterQuotes(Deno.env.get(name));
    if (val) return val;
  }
  return '';
}

function normalizeToken(raw?: string | null): string {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
}

function canonicalBlockKey(raw?: string | null): string {
  const clean = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/^BLOK\s*/i, '')
    .replace(/\s+/g, '');
  if (!clean) return '';
  const m = clean.match(/^([A-Z]+)0*(\d+)[\/-]0*(\d+)$/);
  return m ? `${m[1]}${Number(m[2])}/${Number(m[3])}` : clean;
}

function canonicalAdminUsername(raw?: string | null): string {
  const clean = normalizeToken(raw);
  if (clean === 'admin' || clean === 'andriansyah' || clean === 'bendahara') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan' || clean === 'iwan' || clean === 'pembina') return 'bpiwan';
  if (clean === 'ketua') return 'erlangga';
  if (clean === 'deni') return 'deny';
  return clean;
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = (req.headers.get('origin') || '').trim();
  const configuredPublicUrl = stripOuterQuotes(
    Deno.env.get('PUBLIC_APP_URL') || Deno.env.get('APP_URL')
  ).replace(/\/+$/, '');
  let allowedOrigin = configuredPublicUrl || 'https://e-card-ipl.vercel.app';

  if (origin) {
    try {
      const parsed = new URL(origin);
      const host = parsed.hostname.toLowerCase();
      if (
        ALLOWED_STATIC_ORIGINS.has(origin) ||
        (configuredPublicUrl && origin === configuredPublicUrl) ||
        host.endsWith('.vercel.app') ||
        host.endsWith('.run.app') ||
        host.endsWith('.stackblitz.io') ||
        host.endsWith('.webcontainer.io') ||
        ((host === 'localhost' || host === '127.0.0.1') &&
          (parsed.protocol === 'http:' || parsed.protocol === 'https:'))
      ) {
        allowedOrigin = origin;
      }
    } catch {
      allowedOrigin = configuredPublicUrl || 'https://e-card-ipl.vercel.app';
    }
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, cache-control, pragma, x-user-role, x-blok-rumah, x-admin-permission, x-admin-jabatan, x-pengurus-username',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    Vary: 'Origin',
  };
}

function jsonResponse(
  req: Request,
  status: number,
  payload: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      'Content-Type': 'application/json',
    },
  });
}

function resolvePengurusUsername(
  rawBlok: string,
  rawJabatan: string,
  hint?: SenderCallerHint | null
): string {
  const candidates = [hint?.pengurusUsername, rawBlok, hint?.blokRumah];
  for (const cand of candidates) {
    const clean = String(cand || '').trim();
    if (!clean) continue;
    const canonBlock = canonicalBlockKey(clean);
    const byBlock = KNOWN_PENGURUS_DIRECTORY.find(
      (p) => canonicalBlockKey(p.linkedBlock) === canonBlock
    );
    if (byBlock) return byBlock.username;
    const canon = canonicalAdminUsername(clean);
    if (canon) return canon;
  }
  const jab = normalizeToken(rawJabatan || hint?.jabatan);
  if (jab === 'bendahara') return 'andriansyah';
  if (jab === 'ketua') return 'erlangga';
  if (jab === 'pembina') return 'bpiwan';
  if (jab === 'seksiolahraga') return 'deny';
  return '';
}

async function verifyAuthorizedManagerCaller(
  req: Request,
  hint?: SenderCallerHint | null
): Promise<{ ok: true; username: string } | { ok: false; status: number; error: string }> {
  const roleHeader = normalizeToken(req.headers.get('x-user-role') || hint?.role);
  const permHeader = normalizeToken(req.headers.get('x-admin-permission') || hint?.adminPermission);
  const jabatanHeader = normalizeToken(req.headers.get('x-admin-jabatan') || hint?.jabatan);
  const blokHeader = String(
    req.headers.get('x-blok-rumah') ||
      req.headers.get('x-pengurus-username') ||
      hint?.blokRumah ||
      ''
  ).trim();

  if (roleHeader !== 'admin') {
    return {
      ok: false,
      status: 403,
      error: 'Pembaruan sesi Google Drive hanya tersedia untuk akun Pengurus aktif.',
    };
  }

  const username = resolvePengurusUsername(blokHeader, jabatanHeader, hint);
  const isPrivilegedManager = permHeader === 'full' || jabatanHeader === 'ketua';

  const sbUrl = readFirstSecretEnv(['SUPABASE_URL', 'VITE_SUPABASE_URL']).replace(/\/+$/, '');
  const sbServiceKey = readFirstSecretEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']);
  if (!sbUrl || !sbServiceKey) {
    if (!isPrivilegedManager) {
      return {
        ok: false,
        status: 403,
        error: 'Akses refresh Google Drive khusus Bendahara, Ketua, atau Pengurus terdelegasi.',
      };
    }
    return { ok: true, username: username || 'andriansyah' };
  }

  const supabase = createClient(sbUrl, sbServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rows, error: wargaErr } = await supabase
    .from('users_warga')
    .select('blok_rumah,nama_warga,role,bot_role,jabatan,admin_permission,aktif');

  if (wargaErr || !Array.isArray(rows)) {
    if (!isPrivilegedManager) {
      return { ok: false, status: 403, error: 'Gagal memverifikasi status Pengurus di database.' };
    }
    return { ok: true, username: username || 'andriansyah' };
  }

  const activeAdminRow = (rows as UsersWargaRow[]).find((r) => {
    const rRole = normalizeToken(r.role);
    const bRole = normalizeToken(r.bot_role);
    const isAdmin =
      ['admin', 'bendahara', 'pengurus'].includes(rRole) ||
      ['admin', 'bendahara', 'pengurus'].includes(bRole);
    if (!isAdmin || r.aktif === false) return false;
    const canonRowUser = canonicalAdminUsername(r.blok_rumah);
    if (username && canonRowUser === username) return true;
    if (
      jabatanHeader === 'ketua' &&
      normalizeToken(r.jabatan) === 'ketua'
    ) {
      return true;
    }
    if (
      permHeader === 'full' &&
      (normalizeToken(r.admin_permission) === 'full' || normalizeToken(r.jabatan) === 'bendahara')
    ) {
      return true;
    }
    return false;
  });

  if (!activeAdminRow) {
    return {
      ok: false,
      status: 403,
      error: 'Akun Pengurus aktif tidak ditemukan di users_warga.',
    };
  }

  const rowIsPrivileged =
    normalizeToken(activeAdminRow.admin_permission) === 'full' ||
    normalizeToken(activeAdminRow.jabatan) === 'ketua' ||
    normalizeToken(activeAdminRow.jabatan) === 'bendahara';

  if (!rowIsPrivileged) {
    // Cek apakah Pengurus mendapat delegasi modul `settings.system_integrations`
    const { data: permRow } = await supabase
      .from('central_setting_permissions')
      .select('status')
      .eq('module_key', 'settings.system_integrations')
      .in('target_blok', [blokHeader, username, activeAdminRow.blok_rumah || ''].filter(Boolean))
      .eq('status', 'granted')
      .limit(1)
      .maybeSingle();

    if (!permRow) {
      return {
        ok: false,
        status: 403,
        error:
          'Akses refresh token Google Drive hanya untuk Bendahara, Ketua, atau Pengurus dengan izin Arsip Drive.',
      };
    }
  }

  return { ok: true, username: username || canonicalAdminUsername(activeAdminRow.blok_rumah) || 'pengurus' };
}

async function fetchGoogleProfile(accessToken: string): Promise<{
  email: string;
  displayName: string;
  photoLink: string | null;
}> {
  try {
    const aboutRes = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink)',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (aboutRes.ok) {
      const aboutJson = (await aboutRes.json()) as {
        user?: { emailAddress?: string; displayName?: string; photoLink?: string };
      };
      if (aboutJson.user?.emailAddress) {
        return {
          email: aboutJson.user.emailAddress,
          displayName: aboutJson.user.displayName || 'Google Drive Saung Kebun',
          photoLink: aboutJson.user.photoLink || null,
        };
      }
    }
  } catch {
    // Fallback ke userinfo
  }

  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (infoRes.ok) {
      const infoJson = (await infoRes.json()) as {
        email?: string;
        name?: string;
        picture?: string;
      };
      return {
        email: infoJson.email || DEFAULT_TARGET_DRIVE_EMAIL,
        displayName: infoJson.name || 'Google Drive Pusat Saung Kebun',
        photoLink: infoJson.picture || null,
      };
    }
  } catch {
    // Fallback default
  }

  return {
    email: DEFAULT_TARGET_DRIVE_EMAIL,
    displayName: 'Google Drive Pusat Saung Kebun',
    photoLink: null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: buildCorsHeaders(req) });
  }

  if (req.method !== 'POST') {
    return jsonResponse(req, 405, { ok: false, error: 'Method tidak diizinkan. Gunakan POST.' });
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw.trim()) {
      body = JSON.parse(raw) as Record<string, unknown>;
    }
  } catch {
    return jsonResponse(req, 400, { ok: false, error: 'Payload JSON tidak valid.' });
  }

  const senderHint =
    body.sender && typeof body.sender === 'object' ? (body.sender as SenderCallerHint) : null;
  const authResult = await verifyAuthorizedManagerCaller(req, senderHint);
  if (!authResult.ok) {
    return jsonResponse(req, authResult.status, { ok: false, error: authResult.error });
  }

  const clientId = readFirstSecretEnv(['GOOGLE_OAUTH_CLIENT_ID']);
  const clientSecret = readFirstSecretEnv(['GOOGLE_OAUTH_CLIENT_SECRET']);
  const refreshToken = readFirstSecretEnv(['GOOGLE_OAUTH_REFRESH_TOKEN']);

  if (!clientId || !clientSecret || !refreshToken) {
    return jsonResponse(req, 503, {
      ok: false,
      code: 'oauth_server_unconfigured',
      error:
        'Secret GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, atau GOOGLE_OAUTH_REFRESH_TOKEN belum lengkap di Supabase Edge Function Secrets.',
    });
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenRes.ok) {
      const errText = (await tokenRes.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 180);
      return jsonResponse(req, 502, {
        ok: false,
        error: `Google OAuth2 menolak pembaruan refresh_token (${tokenRes.status}): ${errText}`,
      });
    }

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!tokenJson.access_token) {
      return jsonResponse(req, 502, {
        ok: false,
        error: 'Google OAuth2 tidak mengembalikan access_token baru.',
      });
    }

    const profile = await fetchGoogleProfile(tokenJson.access_token);
    const expiresIn =
      typeof tokenJson.expires_in === 'number' && Number.isFinite(tokenJson.expires_in)
        ? tokenJson.expires_in
        : 3600;

    return jsonResponse(req, 200, {
      ok: true,
      source: 'supabase_edge_function',
      accessToken: tokenJson.access_token,
      expiresIn,
      email: profile.email || DEFAULT_TARGET_DRIVE_EMAIL,
      displayName: profile.displayName,
      photoLink: profile.photoLink,
      refreshedBy: authResult.username,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    return jsonResponse(req, 500, {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Terjadi kesalahan saat menyegarkan token Google Drive.',
    });
  }
});
