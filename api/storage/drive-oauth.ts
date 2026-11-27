// Vercel Serverless Function: GET/POST /api/storage/drive-oauth
// Self-contained (kompatibel penuh dengan Node ESM di Vercel & Express dev server).
import crypto from 'crypto';

const DEFAULT_TARGET_DRIVE_EMAIL = 'saungkebun70@gmail.com';
const APP_SCHEME = 'com.saungkebun.ecardipl';
const DEFAULT_PUBLIC_APP_URL = 'https://e-card-ipl.vercel.app';
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');
const EPHEMERAL_FALLBACK_KEY = crypto.randomBytes(32).toString('hex');

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
  body?: unknown;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  send?: (body: unknown) => void;
  end: (body?: string | Buffer) => void;
}

interface OAuthSessionRecord {
  state: string;
  status: 'pending' | 'completed' | 'error';
  accessToken?: string;
  expiresIn?: number;
  email?: string;
  displayName?: string;
  photoLink?: string | null;
  errorMessage?: string;
  expiresAt: number;
}

const memoryOAuthSessions = new Map<string, OAuthSessionRecord>();

function cleanupExpiredMemorySessions(): void {
  const now = Date.now();
  for (const [k, v] of memoryOAuthSessions.entries()) {
    if (v.expiresAt <= now) {
      memoryOAuthSessions.delete(k);
    }
  }
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
}

function getQueryParam(req: VercelReq, key: string): string {
  if (req.query && key in req.query) {
    const v = req.query[key];
    return Array.isArray(v) ? v[0] || '' : v || '';
  }
  if (req.url && req.url.includes('?')) {
    const qs = req.url.slice(req.url.indexOf('?'));
    return new URLSearchParams(qs).get(key) || '';
  }
  return '';
}

function stripOuterQuotes(raw?: string | null): string {
  let clean = String(raw || '')
    .replace(/[\u0000-\u001F\u007F\u00A0\u200B-\u200D\u2060\uFEFF]/g, '')
    .trim();
  while (clean.length >= 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
      clean = clean.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return clean;
}

function readFirstSecretEnv(names: string[]): string {
  for (const name of names) {
    const cleaned = stripOuterQuotes(process.env[name]);
    if (cleaned) return cleaned;
  }
  return '';
}

function isAllowedCorsOrigin(origin: string): boolean {
  const clean = origin.trim();
  if (!clean) return false;
  if (clean === 'capacitor://localhost' || clean === 'ionic://localhost') return true;
  const configuredPublicUrl = stripOuterQuotes(
    process.env.PUBLIC_APP_URL || process.env.APP_URL || DEFAULT_PUBLIC_APP_URL
  ).replace(/\/+$/, '');
  if (configuredPublicUrl && clean === configuredPublicUrl) return true;
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === 'https:' &&
      (host === 'e-card-ipl.vercel.app' ||
        host === 'localhost' ||
        host.endsWith('.vercel.app') ||
        host.endsWith('.run.app'))
    ) {
      return true;
    }
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1')) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function applyCorsHeaders(req: VercelReq, res: VercelRes): void {
  const reqOrigin = getHeader(req.headers, 'origin').trim();
  const configuredPublicUrl =
    stripOuterQuotes(process.env.PUBLIC_APP_URL || process.env.APP_URL || DEFAULT_PUBLIC_APP_URL).replace(
      /\/+$/,
      ''
    ) || DEFAULT_PUBLIC_APP_URL;
  const allowOrigin = isAllowedCorsOrigin(reqOrigin) ? reqOrigin : configuredPublicUrl;
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'content-type, authorization, x-user-role, x-blok-rumah, x-admin-jabatan, x-admin-permission, x-pengurus-username'
  );
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
}

function getSupabaseEnv(): { url: string; serviceKey: string } | null {
  const url = readFirstSecretEnv(['SUPABASE_URL', 'VITE_SUPABASE_URL']).replace(/\/+$/, '');
  const serviceKey = readFirstSecretEnv(['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY']);
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

function getOAuthServerConfig(): {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
} {
  const clientId = readFirstSecretEnv(['GOOGLE_OAUTH_CLIENT_ID']);
  const clientSecret = readFirstSecretEnv(['GOOGLE_OAUTH_CLIENT_SECRET']);
  const refreshToken = readFirstSecretEnv(['GOOGLE_OAUTH_REFRESH_TOKEN']);
  return { clientId, clientSecret, refreshToken };
}

function getCryptoSecretKey(): Buffer {
  const seed =
    readFirstSecretEnv([
      'CHAT_MEDIA_SIGNING_SECRET',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SERVICE_ROLE_KEY',
    ]) || EPHEMERAL_FALLBACK_KEY;
  return crypto.createHash('sha256').update(seed).digest();
}

function createSignedState(): string {
  const rawId = crypto.randomBytes(18).toString('hex');
  const sig = crypto
    .createHmac('sha256', getCryptoSecretKey())
    .update(rawId)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, 24);
  return `${rawId}.${sig}`;
}

function verifySignedState(state: string): boolean {
  const clean = String(state || '').trim();
  const dotIdx = clean.indexOf('.');
  if (dotIdx <= 0) return false;
  const rawId = clean.slice(0, dotIdx);
  const sig = clean.slice(dotIdx + 1);
  if (!/^[a-f0-9]{16,64}$/i.test(rawId) || !sig) return false;
  const expected = crypto
    .createHmac('sha256', getCryptoSecretKey())
    .update(rawId)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
    .slice(0, 24);
  const a = Buffer.from(sig, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sealTokenPayload(payload: {
  state: string;
  accessToken: string;
  expiresIn: number;
  email: string;
  displayName: string;
  photoLink: string | null;
  exp: number;
}): string {
  const key = getCryptoSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(json, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted])
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function unsealTokenPayload(sealed: string): {
  state: string;
  accessToken: string;
  expiresIn: number;
  email: string;
  displayName: string;
  photoLink: string | null;
  exp: number;
} | null {
  try {
    const b64 = String(sealed || '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const buf = Buffer.from(b64 + pad, 'base64');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getCryptoSecretKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
    const parsed = JSON.parse(decrypted) as {
      state?: string;
      accessToken?: string;
      expiresIn?: number;
      email?: string;
      displayName?: string;
      photoLink?: string | null;
      exp?: number;
    };
    if (!parsed.state || !parsed.accessToken || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return {
      state: parsed.state,
      accessToken: parsed.accessToken,
      expiresIn: Number(parsed.expiresIn || 3600),
      email: parsed.email || DEFAULT_TARGET_DRIVE_EMAIL,
      displayName: parsed.displayName || 'Google Drive',
      photoLink: parsed.photoLink || null,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

function resolvePublicOriginFromReq(req: VercelReq): string {
  const configured = stripOuterQuotes(process.env.PUBLIC_APP_URL || process.env.APP_URL || '').replace(
    /\/+$/,
    ''
  );
  const host = (getHeader(req.headers, 'x-forwarded-host') || getHeader(req.headers, 'host') || '').trim();
  const protoHeader = getHeader(req.headers, 'x-forwarded-proto').split(',')[0]?.trim().toLowerCase();
  if (host) {
    const isLocal = /^localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/i.test(host);
    const proto = protoHeader || (isLocal ? 'http' : 'https');
    if (isLocal || host.toLowerCase() === 'e-card-ipl.vercel.app' || host.toLowerCase().endsWith('.vercel.app')) {
      return `${proto}://${host}`;
    }
  }
  return configured || DEFAULT_PUBLIC_APP_URL;
}

function normalizeToken(raw?: string | null): string {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
}

function canonicalAdminUsername(raw?: string | null): string {
  const clean = normalizeToken(raw);
  if (clean === 'admin' || clean === 'andriansyah' || clean === 'bendahara') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'bpiwan' || clean === 'iwan' || clean === 'pembina') return 'bpiwan';
  if (clean === 'ketua') return 'erlangga';
  if (clean === 'deni') return 'deny';
  return clean;
}

async function verifyAuthorizedDriveManager(
  req: VercelReq,
  senderHint?: Record<string, unknown> | null
): Promise<{ ok: true; username: string; role: string } | { ok: false; status: number; error: string }> {
  const roleHeader = normalizeToken(getHeader(req.headers, 'x-user-role') || String(senderHint?.role || ''));
  const permHeader = normalizeToken(
    getHeader(req.headers, 'x-admin-permission') || String(senderHint?.adminPermission || '')
  );
  const jabatanHeader = normalizeToken(
    getHeader(req.headers, 'x-admin-jabatan') || String(senderHint?.jabatan || '')
  );
  const blokHeader = String(
    getHeader(req.headers, 'x-blok-rumah') ||
      getHeader(req.headers, 'x-pengurus-username') ||
      String(senderHint?.blokRumah || senderHint?.pengurusUsername || '')
  ).trim();

  if (roleHeader !== 'admin' || (permHeader !== 'full' && jabatanHeader !== 'ketua')) {
    return {
      ok: false,
      status: 403,
      error: 'Koneksi Google Drive pusat khusus akun Pengurus Bendahara atau Ketua.',
    };
  }

  const sb = getSupabaseEnv();
  if (!sb) {
    // Izinkan jika server berjalan di mode dev minimal tanpa SUPABASE_SERVICE_ROLE_KEY,
    // namun tetap wajib header Bendahara/Ketua.
    return {
      ok: true,
      username: canonicalAdminUsername(blokHeader) || (jabatanHeader === 'ketua' ? 'erlangga' : 'andriansyah'),
      role: roleHeader,
    };
  }

  const candidateUsername =
    canonicalAdminUsername(blokHeader) || (jabatanHeader === 'ketua' ? 'erlangga' : 'andriansyah');

  try {
    const res = await fetch(
      `${sb.url}/rest/v1/users_warga?select=blok_rumah,role,bot_role,jabatan,admin_permission,aktif`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          apikey: sb.serviceKey,
          Authorization: `Bearer ${sb.serviceKey}`,
        },
      }
    );
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        blok_rumah?: string | null;
        role?: string | null;
        bot_role?: string | null;
        jabatan?: string | null;
        admin_permission?: string | null;
        aktif?: boolean | null;
      }>;
      const matched = rows.find((r) => {
        const isAdminRow =
          ['admin', 'bendahara', 'pengurus'].includes(normalizeToken(r.role)) ||
          ['admin', 'bendahara', 'pengurus'].includes(normalizeToken(r.bot_role));
        if (!isAdminRow || r.aktif === false) return false;
        const can = canonicalAdminUsername(r.blok_rumah);
        const jab = normalizeToken(r.jabatan);
        const perm = normalizeToken(r.admin_permission);
        return (
          can === candidateUsername ||
          (jabatanHeader === 'ketua' && jab === 'ketua') ||
          (permHeader === 'full' && (perm === 'full' || jab === 'bendahara'))
        );
      });
      if (!matched) {
        return {
          ok: false,
          status: 403,
          error: 'Akun Pengurus aktif (Bendahara/Ketua) tidak ditemukan pada database.',
        };
      }
    }
  } catch {
    // Jika verifikasi jaringan ke Supabase gagal sementara, jangan memblokir Bendahara/Ketua
  }

  return { ok: true, username: candidateUsername, role: roleHeader };
}

async function saveSessionToSupabase(record: OAuthSessionRecord): Promise<void> {
  const sb = getSupabaseEnv();
  if (!sb) return;
  try {
    await fetch(`${sb.url}/rest/v1/drive_oauth_sessions`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        apikey: sb.serviceKey,
        Authorization: `Bearer ${sb.serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        state: record.state,
        status: record.status,
        access_token: record.accessToken || null,
        expires_in: record.expiresIn || null,
        email: record.email || null,
        display_name: record.displayName || null,
        photo_link: record.photoLink || null,
        error_message: record.errorMessage || null,
        expires_at: new Date(record.expiresAt).toISOString(),
      }),
    });
  } catch {
    // Abaikan bila migration_v21 belum dijalankan — fallback memory & sealed payload tetap jalan
  }
}

async function readAndConsumeSessionFromSupabase(state: string): Promise<OAuthSessionRecord | null> {
  const sb = getSupabaseEnv();
  if (!sb) return null;
  try {
    const res = await fetch(
      `${sb.url}/rest/v1/drive_oauth_sessions?state=eq.${encodeURIComponent(state)}&limit=1`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: {
          apikey: sb.serviceKey,
          Authorization: `Bearer ${sb.serviceKey}`,
        },
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      state: string;
      status: 'pending' | 'completed' | 'error';
      access_token?: string | null;
      expires_in?: number | null;
      email?: string | null;
      display_name?: string | null;
      photo_link?: string | null;
      error_message?: string | null;
      expires_at?: string | null;
      consumed_at?: string | null;
    }>;
    const row = rows?.[0];
    if (!row) return null;
    const expMs = row.expires_at ? Date.parse(row.expires_at) : Date.now() + 60_000;
    if (row.consumed_at || expMs <= Date.now()) {
      return null;
    }
    if (row.status === 'completed' || row.status === 'error') {
      await fetch(
        `${sb.url}/rest/v1/drive_oauth_sessions?state=eq.${encodeURIComponent(state)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: sb.serviceKey,
            Authorization: `Bearer ${sb.serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ consumed_at: new Date().toISOString() }),
        }
      ).catch(() => undefined);
    }
    return {
      state: row.state,
      status: row.status,
      accessToken: row.access_token || undefined,
      expiresIn: row.expires_in || 3600,
      email: row.email || undefined,
      displayName: row.display_name || undefined,
      photoLink: row.photo_link || null,
      errorMessage: row.error_message || undefined,
      expiresAt: expMs,
    };
  } catch {
    return null;
  }
}

async function fetchGoogleProfileForToken(accessToken: string): Promise<{
  email: string;
  displayName: string;
  photoLink: string | null;
}> {
  try {
    const aboutRes = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink)',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
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
    // Lanjut ke userinfo
  }

  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    if (infoRes.ok) {
      const info = (await infoRes.json()) as {
        email?: string;
        name?: string;
        picture?: string;
      };
      return {
        email: info.email || DEFAULT_TARGET_DRIVE_EMAIL,
        displayName: info.name || 'Akun Google Terhubung',
        photoLink: info.picture || null,
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

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderOAuthResultHtml(params: {
  ok: boolean;
  title: string;
  message: string;
  email?: string;
  deepLinkUrl?: string;
  webReturnUrl?: string;
}): string {
  const safeTitle = escapeHtml(params.title);
  const safeMsg = escapeHtml(params.message);
  const safeEmail = params.email ? escapeHtml(params.email) : '';
  const deepLinkJson = JSON.stringify(params.deepLinkUrl || '');
  const webReturnJson = JSON.stringify(params.webReturnUrl || DEFAULT_PUBLIC_APP_URL);
  const safeDeepLinkHref = params.deepLinkUrl ? escapeHtml(params.deepLinkUrl) : '';
  const safeWebReturnHref = escapeHtml(params.webReturnUrl || DEFAULT_PUBLIC_APP_URL);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${safeTitle} — e-Card IPL Saung Kebun</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #0f172a; min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { width: 100%; max-width: 420px; background: #ffffff; border-radius: 24px; padding: 28px 24px; box-shadow: 0 24px 48px rgba(15, 23, 42, 0.35); text-align: center; }
    .badge { width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 18px; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 700; background: ${
      params.ok ? '#ecfdf5' : '#fff1f2'
    }; color: ${params.ok ? '#059669' : '#e11d48'}; }
    h1 { margin: 0 0 8px; font-size: 19px; font-weight: 800; color: #0f172a; }
    p { margin: 0 0 14px; font-size: 13.5px; line-height: 1.55; color: #475569; }
    .email { display: inline-block; padding: 6px 12px; border-radius: 999px; background: #f1f5f9; font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 18px; }
    .btn { display: block; width: 100%; box-sizing: border-box; padding: 13px 16px; border-radius: 999px; text-decoration: none; font-size: 14px; font-weight: 700; margin-top: 10px; }
    .btn-primary { background: #4c1d95; color: #ffffff; }
    .btn-secondary { background: #f8fafc; color: #334155; border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${params.ok ? '✓' : '!'}</div>
    <h1>${safeTitle}</h1>
    ${safeEmail ? `<div class="email">${safeEmail}</div>` : ''}
    <p>${safeMsg}</p>
    ${
      safeDeepLinkHref
        ? `<a class="btn btn-primary" href="${safeDeepLinkHref}">Kembali ke Aplikasi APK</a>`
        : ''
    }
    <a class="btn btn-secondary" href="${safeWebReturnHref}">Lanjutkan di Browser</a>
  </div>
  <script>
    (function () {
      var deepLink = ${deepLinkJson};
      var webReturn = ${webReturnJson};
      if (deepLink) {
        setTimeout(function () {
          try { window.location.href = deepLink; } catch (e) {}
        }, 250);
      }
      setTimeout(function () {
        try {
          if (window.opener && !window.opener.closed) {
            window.close();
          }
        } catch (e) {}
      }, 1400);
    })();
  </script>
</body>
</html>`;
}

export default async function handler(req: VercelReq, res: VercelRes) {
  applyCorsHeaders(req, res);
  cleanupExpiredMemorySessions();

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // 1. GET Callback dari Google OAuth2 (redirect_uri = /api/storage/drive-oauth)
  if (req.method === 'GET') {
    const state = getQueryParam(req, 'state').trim();
    const code = getQueryParam(req, 'code').trim();
    const oauthErr = getQueryParam(req, 'error').trim();
    const oauthErrDesc = getQueryParam(req, 'error_description').trim();
    const publicOrigin = resolvePublicOriginFromReq(req);
    const redirectUri = `${publicOrigin}/api/storage/drive-oauth`;

    if (!state || !verifySignedState(state)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(400).end(
        renderOAuthResultHtml({
          ok: false,
          title: 'Sesi Autentikasi Tidak Valid',
          message:
            'Parameter keamanan OAuth tidak cocok atau telah kedaluwarsa. Silakan ulangi dari aplikasi e-Card IPL Saung Kebun.',
          webReturnUrl: publicOrigin,
        })
      );
      return;
    }

    if (oauthErr || !code) {
      const errMsg =
        oauthErr === 'access_denied'
          ? 'Login akun Google dibatalkan oleh pengguna.'
          : oauthErrDesc || oauthErr || 'Kode otorisasi Google tidak diterima.';
      const errRec: OAuthSessionRecord = {
        state,
        status: 'error',
        errorMessage: errMsg,
        expiresAt: Date.now() + 3 * 60_000,
      };
      memoryOAuthSessions.set(state, errRec);
      await saveSessionToSupabase(errRec);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).end(
        renderOAuthResultHtml({
          ok: false,
          title: 'Autentikasi Google Dibatalkan',
          message: errMsg,
          deepLinkUrl: `${APP_SCHEME}://oauth-callback?state=${encodeURIComponent(state)}&error=${encodeURIComponent(errMsg)}`,
          webReturnUrl: `${publicOrigin}/?drive_oauth_state=${encodeURIComponent(state)}`,
        })
      );
      return;
    }

    const cfg = getOAuthServerConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      const errMsg = 'Konfigurasi Google OAuth2 Client di server belum lengkap.';
      const errRec: OAuthSessionRecord = {
        state,
        status: 'error',
        errorMessage: errMsg,
        expiresAt: Date.now() + 3 * 60_000,
      };
      memoryOAuthSessions.set(state, errRec);
      await saveSessionToSupabase(errRec);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(500).end(
        renderOAuthResultHtml({
          ok: false,
          title: 'Konfigurasi Server Belum Lengkap',
          message: errMsg,
          deepLinkUrl: `${APP_SCHEME}://oauth-callback?state=${encodeURIComponent(state)}&error=${encodeURIComponent(errMsg)}`,
          webReturnUrl: publicOrigin,
        })
      );
      return;
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        cache: 'no-store',
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const rawText = (await tokenRes.text().catch(() => '')).slice(0, 220);
        throw new Error(`Penukaran kode OAuth ditolak Google (${tokenRes.status}): ${rawText}`);
      }

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!tokenJson.access_token) {
        throw new Error('Google tidak mengembalikan access_token.');
      }

      const profile = await fetchGoogleProfileForToken(tokenJson.access_token);
      const expiresIn =
        typeof tokenJson.expires_in === 'number' && Number.isFinite(tokenJson.expires_in)
          ? tokenJson.expires_in
          : 3600;
      const expMs = Date.now() + 5 * 60_000;

      const completedRec: OAuthSessionRecord = {
        state,
        status: 'completed',
        accessToken: tokenJson.access_token,
        expiresIn,
        email: profile.email,
        displayName: profile.displayName,
        photoLink: profile.photoLink,
        expiresAt: expMs,
      };
      memoryOAuthSessions.set(state, completedRec);
      await saveSessionToSupabase(completedRec);

      const sealed = sealTokenPayload({
        state,
        accessToken: tokenJson.access_token,
        expiresIn,
        email: profile.email,
        displayName: profile.displayName,
        photoLink: profile.photoLink,
        exp: expMs,
      });

      const deepLinkUrl = `${APP_SCHEME}://oauth-callback?state=${encodeURIComponent(
        state
      )}&sealed=${encodeURIComponent(sealed)}`;
      const webReturnUrl = `${publicOrigin}/?drive_oauth_state=${encodeURIComponent(
        state
      )}&drive_oauth_sealed=${encodeURIComponent(sealed)}`;

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).end(
        renderOAuthResultHtml({
          ok: true,
          title: 'Login Google Berhasil',
          email: profile.email,
          message:
            'Koneksi Google Drive siap digunakan. Aplikasi e-Card IPL Saung Kebun akan terbuka kembali secara otomatis.',
          deepLinkUrl,
          webReturnUrl,
        })
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyelesaikan autentikasi Google.';
      const errRec: OAuthSessionRecord = {
        state,
        status: 'error',
        errorMessage: msg,
        expiresAt: Date.now() + 3 * 60_000,
      };
      memoryOAuthSessions.set(state, errRec);
      await saveSessionToSupabase(errRec);

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).end(
        renderOAuthResultHtml({
          ok: false,
          title: 'Gagal Menghubungkan Google Drive',
          message: msg,
          deepLinkUrl: `${APP_SCHEME}://oauth-callback?state=${encodeURIComponent(state)}&error=${encodeURIComponent(msg)}`,
          webReturnUrl: publicOrigin,
        })
      );
      return;
    }
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method tidak diizinkan.' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      res.status(400).json({ ok: false, error: 'Payload JSON tidak valid.' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as Record<string, unknown>;
  }

  const senderHint =
    body.sender && typeof body.sender === 'object' ? (body.sender as Record<string, unknown>) : null;
  const authCheck = await verifyAuthorizedDriveManager(req, senderHint);
  if (!authCheck.ok) {
    res.status(authCheck.status).json({ ok: false, error: authCheck.error });
    return;
  }

  const action = String(body.action || '').trim().toLowerCase();
  const cfg = getOAuthServerConfig();

  // 2. Jalur Utama: Hubungkan Langsung via Server OAuth2 (GOOGLE_OAUTH_REFRESH_TOKEN)
  if (action === 'server_token') {
    if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
      res.status(503).json({
        ok: false,
        code: 'oauth_server_unconfigured',
        error:
          'Kredensial OAuth2 server Google Drive belum lengkap. Gunakan tombol Masuk dengan Akun Google atau lengkapi environment server.',
      });
      return;
    }

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        cache: 'no-store',
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          refresh_token: cfg.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!tokenRes.ok) {
        const rawErr = (await tokenRes.text().catch(() => '')).slice(0, 180);
        res.status(502).json({
          ok: false,
          error: `Token server Google Drive tidak dapat diperbarui (${tokenRes.status}): ${rawErr}`,
        });
        return;
      }

      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!tokenJson.access_token) {
        res.status(502).json({
          ok: false,
          error: 'Google OAuth2 tidak mengembalikan access token.',
        });
        return;
      }

      const profile = await fetchGoogleProfileForToken(tokenJson.access_token);
      res.status(200).json({
        ok: true,
        source: 'server_oauth2',
        accessToken: tokenJson.access_token,
        expiresIn: Number(tokenJson.expires_in || 3600),
        email: profile.email || DEFAULT_TARGET_DRIVE_EMAIL,
        displayName: profile.displayName || 'Google Drive Pusat Saung Kebun',
        photoLink: profile.photoLink || null,
      });
      return;
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal menghubungkan ke Google Drive via server.',
      });
      return;
    }
  }

  // 3. Inisiasi OAuth Interaktif untuk System Browser APK / iOS
  if (action === 'init_oauth') {
    if (!cfg.clientId || !cfg.clientSecret) {
      res.status(503).json({
        ok: false,
        error:
          'GOOGLE_OAUTH_CLIENT_ID atau GOOGLE_OAUTH_CLIENT_SECRET belum dikonfigurasi di server.',
      });
      return;
    }

    const state = createSignedState();
    const publicOrigin = resolvePublicOriginFromReq(req);
    const redirectUri = `${publicOrigin}/api/storage/drive-oauth`;

    const pendingRecord: OAuthSessionRecord = {
      state,
      status: 'pending',
      expiresAt: Date.now() + 5 * 60_000,
    };
    memoryOAuthSessions.set(state, pendingRecord);
    await saveSessionToSupabase(pendingRecord);

    const authParams = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: OAUTH_SCOPES,
      access_type: 'online',
      prompt: 'select_account',
      login_hint: DEFAULT_TARGET_DRIVE_EMAIL,
      state,
    });

    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${authParams.toString()}`;
    res.status(200).json({
      ok: true,
      state,
      oauthUrl,
      redirectUri,
    });
    return;
  }

  // 4. Polling Status OAuth oleh APK / iOS / Web setelah user kembali dari Browser Sistem
  if (action === 'poll_oauth') {
    const state = String(body.state || '').trim();
    if (!state || !verifySignedState(state)) {
      res.status(400).json({ ok: false, error: 'State OAuth tidak valid.' });
      return;
    }

    const mem = memoryOAuthSessions.get(state);
    if (mem && mem.expiresAt > Date.now() && mem.status !== 'pending') {
      memoryOAuthSessions.delete(state);
      if (mem.status === 'error') {
        res.status(200).json({
          ok: false,
          status: 'error',
          error: mem.errorMessage || 'Login Google gagal.',
        });
        return;
      }
      res.status(200).json({
        ok: true,
        status: 'completed',
        source: 'external_browser_oauth',
        accessToken: mem.accessToken,
        expiresIn: mem.expiresIn || 3600,
        email: mem.email || DEFAULT_TARGET_DRIVE_EMAIL,
        displayName: mem.displayName || 'Akun Google Terhubung',
        photoLink: mem.photoLink || null,
      });
      return;
    }

    const dbRec = await readAndConsumeSessionFromSupabase(state);
    if (dbRec && dbRec.status !== 'pending') {
      memoryOAuthSessions.delete(state);
      if (dbRec.status === 'error') {
        res.status(200).json({
          ok: false,
          status: 'error',
          error: dbRec.errorMessage || 'Login Google gagal.',
        });
        return;
      }
      res.status(200).json({
        ok: true,
        status: 'completed',
        source: 'external_browser_oauth',
        accessToken: dbRec.accessToken,
        expiresIn: dbRec.expiresIn || 3600,
        email: dbRec.email || DEFAULT_TARGET_DRIVE_EMAIL,
        displayName: dbRec.displayName || 'Akun Google Terhubung',
        photoLink: dbRec.photoLink || null,
      });
      return;
    }

    res.status(200).json({ ok: true, status: 'pending' });
    return;
  }

  // 5. Penukaran payload terenkripsi dari Deep Link `com.saungkebun.ecardipl://oauth-callback`
  if (action === 'exchange_sealed') {
    const state = String(body.state || '').trim();
    const sealed = String(body.sealed || '').trim();
    if (!state || !sealed || !verifySignedState(state)) {
      res.status(400).json({ ok: false, error: 'Token callback OAuth tidak valid.' });
      return;
    }

    const unsealed = unsealTokenPayload(sealed);
    if (!unsealed || unsealed.state !== state) {
      res.status(400).json({
        ok: false,
        error: 'Sesi callback Google telah kedaluwarsa. Silakan ulangi login.',
      });
      return;
    }

    memoryOAuthSessions.delete(state);
    res.status(200).json({
      ok: true,
      status: 'completed',
      source: 'external_browser_oauth',
      accessToken: unsealed.accessToken,
      expiresIn: unsealed.expiresIn,
      email: unsealed.email,
      displayName: unsealed.displayName,
      photoLink: unsealed.photoLink,
    });
    return;
  }

  res.status(400).json({ ok: false, error: 'Aksi OAuth tidak dikenal.' });
}
