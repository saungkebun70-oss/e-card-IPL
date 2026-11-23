import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface IncomingNotificationRecord {
  id?: string;
  user_id?: string;
  actor_id?: string | null;
  actor_name?: string | null;
  category?: string;
  title?: string;
  message?: string;
  body?: string;
  target_url?: string;
  is_read?: boolean;
  created_at?: string;
  target_user_ids?: string[];
  target_roles?: string[];
  broadcast?: boolean;
  include_self?: boolean;
  data?: Record<string, unknown>;
}

interface UserPushTokenRow {
  id: string;
  user_id: string;
  role: string;
  blok?: string | null;
  blok_rumah?: string | null;
  token: string;
  platform: string;
}

interface ServiceAccountCredentials {
  project_id: string;
  client_email: string;
  private_key: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-user-role, x-blok-rumah, x-admin-permission, x-admin-jabatan, x-petugas-id, x-petugas-name',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ANDROID_CHANNEL_ID = 'saung_kebun_notif';

function normalizeToken(raw?: string | null): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function normalizeRoleName(raw?: string | null): string {
  const clean = normalizeToken(raw);
  if (clean === 'petugas' || clean === 'keamanan' || clean === 'security') {
    return 'keamanan';
  }
  if (clean === 'admin' || clean === 'pengurus' || clean === 'ketua' || clean === 'bendahara') {
    return 'admin';
  }
  if (clean === 'warga') {
    return 'warga';
  }
  return clean;
}

/**
 * Menghasilkan seluruh variasi ID blok warga (mis. warga:b3/7 <-> warga:b03/07)
 * agar pencocokan selalu akurat baik format padded maupun non-padded.
 */
function expandWargaAliases(blokOrUserId?: string | null): string[] {
  const clean = normalizeToken(blokOrUserId).replace(/^warga:/, '');
  if (!clean) return [];
  const aliases = new Set<string>([`warga:${clean}`]);
  const parts = clean.split('/');
  if (parts.length === 2) {
    const prefixMatch = parts[0].match(/^([a-z]+)0*(\d+)$/i);
    const numMatch = parts[1].match(/^0*(\d+)$/);
    if (prefixMatch && numMatch) {
      const prefix = prefixMatch[1].toLowerCase();
      const bNum = Number(prefixMatch[2]);
      const hNum = Number(numMatch[1]);
      aliases.add(`warga:${prefix}${bNum}/${hNum}`);
      aliases.add(
        `warga:${prefix}${String(bNum).padStart(2, '0')}/${String(hNum).padStart(2, '0')}`
      );
    }
  }
  return Array.from(aliases);
}

/**
 * Menghasilkan variasi ID petugas keamanan (keamanan:<id> <-> petugas:<id>)
 */
function expandKeamananAliases(raw?: string | null): string[] {
  const clean = normalizeToken(raw);
  if (!clean) return [];
  const bare = clean.replace(/^(keamanan:|petugas:)/, '');
  if (!bare) return [];
  return [`keamanan:${bare}`, `petugas:${bare}`];
}

/**
 * Menghasilkan seluruh target penerima yang cocok untuk 1 baris perangkat di tabel `user_push_tokens`.
 */
function buildDeviceMatchSet(device: UserPushTokenRow): Set<string> {
  const set = new Set<string>(['broadcast:all']);
  const uid = normalizeToken(device.user_id);
  const rawRole = normalizeToken(device.role);
  const role = normalizeRoleName(rawRole);
  const blok = normalizeToken(device.blok || device.blok_rumah);

  if (uid) set.add(uid);

  if (role === 'warga' || uid.startsWith('warga:')) {
    set.add('broadcast:warga');
    set.add('role:warga');
    for (const alias of expandWargaAliases(uid)) set.add(alias);
    for (const alias of expandWargaAliases(blok)) set.add(alias);
  }

  if (role === 'admin' || uid.startsWith('admin:')) {
    set.add('broadcast:admin');
    set.add('role:admin');
    const adminName = uid.replace(/^admin:/, '') || blok;
    if (adminName) set.add(`admin:${adminName}`);
    if (
      adminName === 'andriansyah' ||
      adminName === 'admin' ||
      blok === 'andriansyah' ||
      blok === 'admin'
    ) {
      set.add('admin:andriansyah');
      set.add('admin:admin');
      set.add('role:bendahara');
    }
    if (adminName === 'erlangga' || blok === 'erlangga') {
      set.add('admin:erlangga');
      set.add('role:ketua');
    }
  }

  if (role === 'keamanan' || uid.startsWith('petugas:') || uid.startsWith('keamanan:')) {
    set.add('broadcast:petugas');
    set.add('broadcast:keamanan');
    set.add('role:petugas');
    set.add('role:keamanan');
    for (const alias of expandKeamananAliases(uid)) set.add(alias);
    for (const alias of expandKeamananAliases(blok)) set.add(alias);
  }

  return set;
}

/**
 * Mengecek apakah perangkat adalah pemilik `actor_id` (pengirim aksi sendiri)
 * agar tidak menerima push ganda untuk aksi yang baru saja ditekan.
 */
function isDeviceSelfActor(device: UserPushTokenRow, actorId?: string | null): boolean {
  const cleanActor = normalizeToken(actorId);
  if (!cleanActor || cleanActor === 'system' || cleanActor === 'anon') return false;

  const uid = normalizeToken(device.user_id);
  const blok = normalizeToken(device.blok || device.blok_rumah);
  const role = normalizeRoleName(device.role);

  if (uid === cleanActor) return true;

  // Alias Bendahara (admin:admin <-> admin:andriansyah)
  if (
    (uid === 'admin:andriansyah' && cleanActor === 'admin:admin') ||
    (uid === 'admin:admin' && cleanActor === 'admin:andriansyah')
  ) {
    return true;
  }

  // Alias Warga (warga:b3/7 <-> warga:b03/07)
  if (cleanActor.startsWith('warga:') && (uid.startsWith('warga:') || role === 'warga')) {
    const actorAliases = new Set(expandWargaAliases(cleanActor));
    const deviceAliases = expandWargaAliases(uid || blok);
    if (deviceAliases.some((a) => actorAliases.has(a))) return true;
  }

  // Alias Petugas / Keamanan (keamanan:<id> <-> petugas:<id>)
  if (
    (cleanActor.startsWith('petugas:') || cleanActor.startsWith('keamanan:')) &&
    (uid.startsWith('petugas:') || uid.startsWith('keamanan:') || role === 'keamanan')
  ) {
    const actorAliases = new Set(expandKeamananAliases(cleanActor));
    const deviceAliases = [...expandKeamananAliases(uid), ...expandKeamananAliases(blok)];
    if (deviceAliases.some((a) => actorAliases.has(a))) return true;
  }

  return false;
}

function doesDeviceMatchSingleTarget(device: UserPushTokenRow, targetUserId?: string | null): boolean {
  const cleanTarget = normalizeToken(targetUserId);
  if (!cleanTarget) return false;

  const deviceMatches = buildDeviceMatchSet(device);
  if (deviceMatches.has(cleanTarget)) return true;

  if (cleanTarget.startsWith('warga:')) {
    const targetAliases = expandWargaAliases(cleanTarget);
    if (targetAliases.some((a) => deviceMatches.has(a))) return true;
  }

  if (cleanTarget.startsWith('petugas:') || cleanTarget.startsWith('keamanan:')) {
    const targetAliases = expandKeamananAliases(cleanTarget);
    if (targetAliases.some((a) => deviceMatches.has(a))) return true;
  }

  return false;
}

function doesDeviceMatchRecord(
  device: UserPushTokenRow,
  record: IncomingNotificationRecord
): boolean {
  if (!device.token || !device.token.trim()) return false;

  // 1. Broadcast ke seluruh perangkat terdaftar
  if (record.broadcast === true) {
    return true;
  }

  // 2. Pencocokan berdasarkan target_roles (mis. ['admin'], ['warga'], ['keamanan'])
  if (Array.isArray(record.target_roles) && record.target_roles.length > 0) {
    const deviceRole = normalizeRoleName(device.role);
    const normalizedTargets = new Set(record.target_roles.map((r) => normalizeRoleName(r)));
    if (normalizedTargets.has(deviceRole)) {
      return true;
    }
  }

  // 3. Pencocokan berdasarkan target_user_ids (mis. ['warga:b03/07'] atau ['keamanan:petugas-1'])
  if (Array.isArray(record.target_user_ids) && record.target_user_ids.length > 0) {
    for (const targetUid of record.target_user_ids) {
      if (doesDeviceMatchSingleTarget(device, targetUid)) {
        return true;
      }
    }
  }

  // 4. Kompatibilitas format lama: single record.user_id (termasuk broadcast:all / role:admin)
  if (record.user_id && doesDeviceMatchSingleTarget(device, record.user_id)) {
    return true;
  }

  return false;
}

function normalizePrivateKey(rawKey: string): string {
  return rawKey
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n');
}

function loadServiceAccountCredentials(): ServiceAccountCredentials | null {
  // Prioritas 1: Secret FIREBASE_SERVICE_ACCOUNT (JSON mentah atau Base64)
  const rawServiceAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')?.trim() || '';
  if (rawServiceAccount) {
    try {
      let jsonText = rawServiceAccount;
      if (!jsonText.startsWith('{')) {
        jsonText = atob(rawServiceAccount.replace(/\s+/g, ''));
      }
      const parsed = JSON.parse(jsonText) as Partial<ServiceAccountCredentials>;
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          project_id: String(parsed.project_id).trim(),
          client_email: String(parsed.client_email).trim(),
          private_key: normalizePrivateKey(String(parsed.private_key)),
        };
      }
    } catch (err) {
      console.error('[send-push-notification] Gagal parsing FIREBASE_SERVICE_ACCOUNT:', err);
    }
  }

  // Prioritas 2: 3 Secret terpisah (FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY)
  const projectIdEnv = Deno.env.get('FCM_PROJECT_ID')?.trim() || '';
  const clientEmailEnv = Deno.env.get('FCM_CLIENT_EMAIL')?.trim() || '';
  const privateKeyEnv = Deno.env.get('FCM_PRIVATE_KEY')?.trim() || '';

  if (projectIdEnv && clientEmailEnv && privateKeyEnv) {
    return {
      project_id: projectIdEnv,
      client_email: clientEmailEnv,
      private_key: normalizePrivateKey(privateKeyEnv),
    };
  }

  return null;
}

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getGoogleOAuthAccessToken(creds: ServiceAccountCredentials): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: nowSec,
      exp: nowSec + 3600,
    })
  );
  const signingInput = `${header}.${claimSet}`;

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(creds.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signatureBuffer))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`OAuth token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('OAuth response did not contain access_token');
  }
  return tokenJson.access_token;
}

function isInvalidFcmTokenError(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  return /UNREGISTERED|INVALID_ARGUMENT|NOT_FOUND|SENDER_ID_MISMATCH|registration-token-not-registered/i.test(
    bodyText
  );
}

function stringifyDataMap(raw?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function resolveClickPathForDevice(device: UserPushTokenRow): string {
  const role = normalizeRoleName(device.role);
  if (role === 'admin') return '/admin';
  if (role === 'keamanan') return '/petugas';
  return '/';
}

async function sendSingleFcmMessage(
  projectId: string,
  accessToken: string,
  device: UserPushTokenRow,
  record: IncomingNotificationRecord
): Promise<{ ok: boolean; invalidToken?: boolean; error?: string }> {
  const title = String(record.title || 'Aktivitas Baru · Saung Kebun').trim();
  const body = String(
    record.body || record.message || 'Ketuk untuk melihat detail aktivitas terbaru.'
  ).trim();
  const notificationId = String(record.id || `notif-${Date.now()}`);
  const targetUrl = String(record.target_url || '');
  const category = String(record.category || 'system');
  const userId = String(record.user_id || device.user_id || '');
  const clickPath = resolveClickPathForDevice(device);
  const webLink = targetUrl
    ? `${clickPath}?notif_target=${encodeURIComponent(targetUrl)}`
    : clickPath;

  const extraData = stringifyDataMap(record.data);

  const fcmPayload = {
    message: {
      token: device.token,
      notification: {
        title,
        body,
      },
      data: {
        ...extraData,
        notification_id: notificationId,
        target_url: targetUrl,
        click_action: clickPath,
        category,
        user_id: userId,
        title,
        body,
      },
      android: {
        priority: 'HIGH',
        notification: {
          channel_id: ANDROID_CHANNEL_ID,
          notification_priority: 'PRIORITY_MAX',
          sound: 'default',
          default_vibrate_timings: true,
          color: '#059669',
          tag: notificationId,
        },
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title,
              body,
            },
            sound: 'default',
            badge: 1,
            'mutable-content': 1,
          },
        },
      },
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: '86400',
        },
        notification: {
          title,
          body,
          icon: '/app-icon.jpg',
          badge: '/app-icon.jpg',
          tag: notificationId,
        },
        fcm_options: {
          link: webLink,
        },
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(fcmPayload),
    }
  );

  if (res.ok) {
    return { ok: true };
  }

  const errText = await res.text();
  return {
    ok: false,
    invalidToken: isInvalidFcmTokenError(res.status, errText),
    error: `FCM ${res.status}: ${errText}`,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as IncomingNotificationRecord & {
      record?: IncomingNotificationRecord;
      notification?: IncomingNotificationRecord;
      notifications?: IncomingNotificationRecord[];
    };

    const records: IncomingNotificationRecord[] = [];
    if (Array.isArray(body.notifications) && body.notifications.length > 0) {
      records.push(...body.notifications);
    } else if (body.record) {
      records.push(body.record);
    } else if (body.notification) {
      records.push(body.notification);
    } else if (
      (body.title || body.body || body.message) &&
      (body.broadcast === true ||
        (Array.isArray(body.target_roles) && body.target_roles.length > 0) ||
        (Array.isArray(body.target_user_ids) && body.target_user_ids.length > 0) ||
        Boolean(body.user_id))
    ) {
      records.push({
        id: body.id,
        user_id: body.user_id,
        actor_id: body.actor_id,
        category: body.category,
        title: body.title,
        message: body.message,
        body: body.body,
        target_url: body.target_url,
        target_user_ids: body.target_user_ids,
        target_roles: body.target_roles,
        broadcast: body.broadcast,
        include_self: body.include_self,
        data: body.data,
      });
    }

    if (records.length === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: 'Tidak ada data notifikasi untuk dikirim.' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const creds = loadServiceAccountCredentials();
    if (!creds) {
      return new Response(
        JSON.stringify({
          ok: false,
          skipped: true,
          reason:
            'Kredensial FCM belum diatur di Supabase Edge Function Secrets (set FIREBASE_SERVICE_ACCOUNT atau FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY).',
        }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim() || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ ok: false, error: 'SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diset.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Baca user_push_tokens (mendukung tabel dengan kolom `blok` baru maupun tabel lama `blok_rumah`)
    let tokenRows: UserPushTokenRow[] | null = null;
    let tokenErr: { message: string } | null = null;

    const primaryQuery = await supabaseAdmin
      .from('user_push_tokens')
      .select('id, user_id, role, blok, blok_rumah, token, platform');

    if (primaryQuery.error) {
      const legacyQuery = await supabaseAdmin
        .from('user_push_tokens')
        .select('id, user_id, role, blok_rumah, token, platform');
      tokenRows = (legacyQuery.data || null) as UserPushTokenRow[] | null;
      tokenErr = legacyQuery.error;
    } else {
      tokenRows = (primaryQuery.data || null) as UserPushTokenRow[] | null;
    }

    if (tokenErr) {
      console.error('[send-push-notification] Gagal membaca user_push_tokens:', tokenErr);
      return new Response(
        JSON.stringify({ ok: false, error: tokenErr.message }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const allDevices = (tokenRows || []).filter((d) => Boolean(d.token && d.token.trim()));
    if (allDevices.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          sent: 0,
          failed: 0,
          matchedDevices: 0,
          removedInvalidTokens: 0,
        }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = await getGoogleOAuthAccessToken(creds);
    const invalidTokens = new Set<string>();
    const deliveredPairs = new Set<string>();
    let sentCount = 0;
    let failedCount = 0;

    const sendQueue: Array<{ device: UserPushTokenRow; record: IncomingNotificationRecord }> = [];

    for (const record of records) {
      if (record.is_read) continue;
      const titleKey = String(record.title || '').trim();
      const bodyKey = String(record.body || record.message || '').trim();

      const matchedDevices = allDevices.filter((device) => {
        if (!doesDeviceMatchRecord(device, record)) return false;
        if (!record.include_self && isDeviceSelfActor(device, record.actor_id)) return false;
        return true;
      });

      for (const device of matchedDevices) {
        // Deduplikasi ketat berdasarkan token perangkat agar 1 HP/Browser tidak menerima push ganda
        const pairKey = `${device.token}::${titleKey}::${bodyKey}`;
        if (deliveredPairs.has(pairKey)) continue;
        deliveredPairs.add(pairKey);
        sendQueue.push({ device, record });
      }
    }

    // Kirim secara paralel per chunk (10 perangkat sekaligus) agar broadcast massal cepat & stabil
    const CHUNK_SIZE = 10;
    for (let i = 0; i < sendQueue.length; i += CHUNK_SIZE) {
      const chunk = sendQueue.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (item) => {
          const res = await sendSingleFcmMessage(
            creds.project_id,
            accessToken,
            item.device,
            item.record
          );
          return { token: item.device.token, res };
        })
      );

      for (const { token, res } of results) {
        if (res.ok) {
          sentCount += 1;
        } else {
          failedCount += 1;
          console.warn('[send-push-notification] Gagal kirim ke token:', res.error);
          if (res.invalidToken) {
            invalidTokens.add(token);
          }
        }
      }
    }

    // Hapus otomatis token yang UNREGISTERED / INVALID_ARGUMENT / NOT_FOUND dari user_push_tokens
    let removedCount = 0;
    if (invalidTokens.size > 0) {
      const tokensToRemove = Array.from(invalidTokens);
      const { error: deleteErr } = await supabaseAdmin
        .from('user_push_tokens')
        .delete()
        .in('token', tokensToRemove);
      if (!deleteErr) {
        removedCount = tokensToRemove.length;
      } else {
        console.warn('[send-push-notification] Gagal menghapus token invalid:', deleteErr);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent: sentCount,
        failed: failedCount,
        matchedDevices: sendQueue.length,
        removedInvalidTokens: removedCount,
      }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[send-push-notification] Unexpected error:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
