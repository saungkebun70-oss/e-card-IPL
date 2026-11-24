/* eslint-disable no-undef */
/**
 * Firebase Cloud Messaging & Background Sync Service Worker — e-Card IPL Perumahan Saung Kebun
 * Menangani:
 * 1. Web Push Notification real-time (Chrome, Safari, Edge, dan fallback Huawei non-GMS)
 *    dengan `requireInteraction: true` & `vibrate: [200, 100, 200]`.
 * 2. Pemanggilan langsung `self.registration.showNotification()` tanpa menunggu proses async
 *    agar tidak terputus oleh sistem hemat daya EMUI / HarmonyOS.
 * 3. Periodic Background Sync (`periodicsync`) & Background Sync (`sync`) untuk memeriksa
 *    notifikasi belum terbaca di tabel Supabase `notifications` pada perangkat tanpa GMS.
 */

const APP_ICON_URL = '/app-icon.jpg';
const DEFAULT_TITLE = 'e-Card IPL · Perumahan Saung Kebun';
const DEFAULT_BODY = 'Ada pembaruan aktivitas terbaru. Ketuk untuk membuka aplikasi.';

const SYNC_CACHE_NAME = 'ecard-sw-sync-v1';
const SYNC_CONTEXT_CACHE_KEY = '/__ecard_sw_sync_context__';
const SYNC_SEEN_IDS_CACHE_KEY = '/__ecard_sw_seen_notifs__';
const PERIODIC_SYNC_TAG = 'ecard-notif-periodic-sync';
const ONE_OFF_SYNC_TAG = 'ecard-notif-bg-sync';

let firebaseInitialized = false;
const RECENT_SW_NOTIF_TTL_MS = 20000;
const recentSwNotifMap = new Map();

function normalizeSwText(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function claimSwNotifKeys(keys) {
  const now = Date.now();
  for (const [k, ts] of recentSwNotifMap.entries()) {
    if (now - ts > RECENT_SW_NOTIF_TTL_MS) {
      recentSwNotifMap.delete(k);
    }
  }
  for (const key of keys) {
    if (!key) continue;
    const prev = recentSwNotifMap.get(key);
    if (prev && now - prev < RECENT_SW_NOTIF_TTL_MS) {
      return false;
    }
  }
  for (const key of keys) {
    if (key) recentSwNotifMap.set(key, now);
  }
  if (recentSwNotifMap.size > 120) {
    const oldest = recentSwNotifMap.keys().next().value;
    if (oldest) recentSwNotifMap.delete(oldest);
  }
  return true;
}

function readFirebaseConfigFromLocation() {
  try {
    const url = new URL(self.location.href);
    const apiKey = (url.searchParams.get('apiKey') || '').trim();
    const projectId = (url.searchParams.get('projectId') || '').trim();
    const messagingSenderId = (url.searchParams.get('messagingSenderId') || '').trim();
    const appId = (url.searchParams.get('appId') || '').trim();
    const authDomain = (url.searchParams.get('authDomain') || '').trim();
    const storageBucket = (url.searchParams.get('storageBucket') || '').trim();

    if (!apiKey || !projectId || !messagingSenderId || !appId) {
      return null;
    }

    return {
      apiKey,
      authDomain: authDomain || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: storageBucket || `${projectId}.appspot.com`,
      messagingSenderId,
      appId,
    };
  } catch {
    return null;
  }
}

/**
 * Menampilkan notifikasi sistem SECARA LANGSUNG (sinkron sebelum showNotification)
 * tanpa menunggu operasi async tambahan yang berisiko dihentikan oleh EMUI / HarmonyOS.
 */
function showSaungKebunNotification(payload) {
  const data = (payload && payload.data) || {};
  const notif = (payload && payload.notification) || {};

  const title = String(notif.title || data.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE;
  const body =
    String(notif.body || data.body || data.message || DEFAULT_BODY).trim() || DEFAULT_BODY;
  const targetUrl = String(data.target_url || data.url || '').trim();
  const dedupKey = String(data.dedup_key || '').trim();
  const notifId = String(
    data.notification_id || notif.tag || dedupKey || `sk-web-${Date.now()}`
  ).trim();
  const tag = dedupKey || notifId;
  const now = Date.now();

  // Deduplikasi lintas jalur (FCM onBackgroundMessage, push event, dan Periodic Sync) dalam 20 detik
  const keysToClaim = [
    dedupKey ? `dk:${dedupKey}` : '',
    data.notification_id ? `id:${String(data.notification_id).trim()}` : '',
    `sig:${normalizeSwText(title)}::${normalizeSwText(body)}`,
  ];
  if (!claimSwNotifKeys(keysToClaim)) {
    return Promise.resolve();
  }

  const options = {
    body,
    icon: notif.icon || APP_ICON_URL,
    badge: APP_ICON_URL,
    tag,
    renotify: true,
    requireInteraction: true,
    silent: false,
    vibrate: [200, 100, 200],
    timestamp: now,
    data: {
      target_url: targetUrl,
      url: data.click_action || '/',
      notification_id: notifId,
      dedup_key: dedupKey || undefined,
      category: data.category || 'system',
      requireInteraction: true,
      vibrate: [200, 100, 200],
    },
  };

  return self.registration.showNotification(title, options);
}

function initFirebaseMessaging(config) {
  if (firebaseInitialized || !config) return;
  try {
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

    if (!self.firebase || typeof self.firebase.messaging !== 'function') return;
    if (!self.firebase.apps || self.firebase.apps.length === 0) {
      self.firebase.initializeApp(config);
    }
    const messaging = self.firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      // Langsung panggil showNotification tanpa operasi async terlebih dahulu
      return showSaungKebunNotification(payload);
    });
    firebaseInitialized = true;
  } catch {
    // Aman untuk perangkat Huawei non-GMS: tetap dilayani listener 'push' & Periodic Sync
    firebaseInitialized = false;
  }
}

async function writeSwCacheJson(cacheKey, value) {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(SYNC_CACHE_NAME);
    const body = JSON.stringify(value);
    await cache.put(
      cacheKey,
      new Response(body, {
        headers: { 'Content-Type': 'application/json' },
      })
    );
  } catch {
    // Abaikan keterbatasan storage browser/WebView
  }
}

async function readSwCacheJson(cacheKey) {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(SYNC_CACHE_NAME);
    const res = await cache.match(cacheKey);
    if (!res) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function clearSwSyncCache() {
  try {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(SYNC_CACHE_NAME);
    await cache.delete(SYNC_CONTEXT_CACHE_KEY);
    await cache.delete(SYNC_SEEN_IDS_CACHE_KEY);
  } catch {
    // Abaikan
  }
}

function normalizeSwToken(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * Polling latar belakang (Periodic Background Sync / Background Sync Fallback)
 * untuk mengecek notifikasi belum terbaca di tabel Supabase `notifications`
 * pada perangkat Huawei (EMUI/HarmonyOS) tanpa Google Play Services (GMS).
 */
async function pollSupabaseUnreadNotifications() {
  try {
    const ctx = await readSwCacheJson(SYNC_CONTEXT_CACHE_KEY);
    if (
      !ctx ||
      !ctx.supabaseUrl ||
      !ctx.supabaseAnonKey ||
      !Array.isArray(ctx.matchIds) ||
      ctx.matchIds.length === 0
    ) {
      return;
    }

    const baseUrl = String(ctx.supabaseUrl).replace(/\/+$/, '');
    const escapedMatchList = ctx.matchIds
      .map((id) => `"${String(id).replace(/"/g, '')}"`)
      .join(',');
    const queryUrl =
      `${baseUrl}/rest/v1/notifications` +
      `?select=id,user_id,actor_id,category,title,message,is_read,target_url,created_at` +
      `&is_read=eq.false` +
      `&user_id=in.(${encodeURIComponent(escapedMatchList)})` +
      `&order=created_at.desc` +
      `&limit=15`;

    const reqHeaders = Object.assign(
      {
        apikey: ctx.supabaseAnonKey,
        Authorization: `Bearer ${ctx.supabaseAnonKey}`,
        Accept: 'application/json',
      },
      ctx.headers || {}
    );

    const response = await fetch(queryUrl, {
      method: 'GET',
      headers: reqHeaders,
      cache: 'no-store',
    });

    if (!response.ok) return;
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return;

    const storedSeen = await readSwCacheJson(SYNC_SEEN_IDS_CACHE_KEY);
    const hasSeededBefore = Array.isArray(storedSeen);
    const seenSet = new Set(hasSeededBefore ? storedSeen.map(String) : []);
    const selfActor = normalizeSwToken(ctx.canonicalUserId);
    const now = Date.now();
    const freshThresholdMs = 5 * 60 * 1000;

    const freshToShow = [];
    const batchContentSigs = new Set();
    for (const row of rows) {
      const id = String((row && row.id) || '').trim();
      if (!id || seenSet.has(id)) continue;

      const actor = normalizeSwToken(row && row.actor_id);
      if (actor && selfActor && actor === selfActor) {
        seenSet.add(id);
        continue;
      }

      const contentSig = `${normalizeSwText(row && row.category)}::${normalizeSwText(row && row.title)}::${normalizeSwText(row && row.message)}`;
      if (batchContentSigs.has(contentSig)) {
        seenSet.add(id);
        continue;
      }
      batchContentSigs.add(contentSig);

      const createdAtMs = row && row.created_at ? Date.parse(String(row.created_at)) : now;
      const isRecent = !Number.isNaN(createdAtMs) && now - createdAtMs <= freshThresholdMs;

      seenSet.add(id);
      if (hasSeededBefore || isRecent) {
        freshToShow.push(row);
      }
    }

    await writeSwCacheJson(SYNC_SEEN_IDS_CACHE_KEY, Array.from(seenSet).slice(-250));

    if (freshToShow.length === 0) return;

    // Tampilkan maksimal 3 notifikasi terbaru agar tidak membanjiri layar kunci tablet
    const batch = freshToShow.slice(0, 3);
    for (const item of batch) {
      await showSaungKebunNotification({
        notification: {
          title: item.title || DEFAULT_TITLE,
          body: item.message || DEFAULT_BODY,
        },
        data: {
          notification_id: String(item.id || `bg-sync-${Date.now()}`),
          title: item.title || DEFAULT_TITLE,
          body: item.message || DEFAULT_BODY,
          target_url: item.target_url || '',
          category: item.category || 'system',
        },
      });
    }

    // Beritahu tab/WebView yang sedang terbuka agar badge & daftar lonceng ikut tersinkron
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try {
        client.postMessage({
          type: 'ECARD_BG_SYNC_NEW_NOTIFICATIONS',
          count: freshToShow.length,
        });
      } catch {
        // Abaikan
      }
    }
  } catch {
    // Jangan lempar error dari background sync SW
  }
}

const initialConfig = readFirebaseConfigFromLocation();
if (initialConfig) {
  initFirebaseMessaging(initialConfig);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const msg = event && event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'ECARD_FIREBASE_CONFIG' && msg.config) {
    initFirebaseMessaging(msg.config);
    return;
  }

  if (msg.type === 'ECARD_SYNC_CONTEXT' && msg.context) {
    const task = writeSwCacheJson(SYNC_CONTEXT_CACHE_KEY, msg.context);
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(task);
    }
    return;
  }

  if (msg.type === 'ECARD_CLEAR_SYNC_CONTEXT') {
    const task = clearSwSyncCache();
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(task);
    }
    return;
  }

  if (msg.type === 'ECARD_POLL_NOTIFICATIONS') {
    const task = pollSupabaseUnreadNotifications();
    if (typeof event.waitUntil === 'function') {
      event.waitUntil(task);
    }
  }
});

// Handler Web Push: langsung parse sinkron & panggil showNotification tanpa proses async
// agar sistem hemat daya EMUI / HarmonyOS tidak memutus notifikasi sebelum tampil.
self.addEventListener('push', (event) => {
  if (firebaseInitialized) return;

  let parsed = {
    notification: {
      title: DEFAULT_TITLE,
      body: DEFAULT_BODY,
    },
  };

  if (event && event.data) {
    try {
      parsed = event.data.json();
    } catch {
      try {
        const textBody = event.data.text();
        parsed = {
          notification: {
            title: DEFAULT_TITLE,
            body: textBody || DEFAULT_BODY,
          },
        };
      } catch {
        // Gunakan default payload
      }
    }
  }

  event.waitUntil(showSaungKebunNotification(parsed));
});

// Periodic Background Sync (Chrome / Edge / WebView modern & Huawei fallback)
self.addEventListener('periodicsync', (event) => {
  if (!event || !event.tag || event.tag === PERIODIC_SYNC_TAG) {
    event.waitUntil(pollSupabaseUnreadNotifications());
  }
});

// One-off Background Sync saat koneksi internet pulih
self.addEventListener('sync', (event) => {
  if (!event || !event.tag || event.tag === ONE_OFF_SYNC_TAG) {
    event.waitUntil(pollSupabaseUnreadNotifications());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = (event.notification && event.notification.data) || {};
  const targetUrl = String(notifData.target_url || '').trim();
  const notificationId = String(notifData.notification_id || '').trim();
  const basePath =
    typeof notifData.url === 'string' && notifData.url.startsWith('/') ? notifData.url : '/';
  const destinationUrl = targetUrl
    ? `${basePath}${basePath.includes('?') ? '&' : '?'}notif_target=${encodeURIComponent(targetUrl)}`
    : basePath;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            try {
              client.postMessage({
                type: 'ECARD_NOTIFICATION_CLICK',
                targetUrl,
                notificationId,
                requireInteraction: true,
                vibrate: [200, 100, 200],
              });
            } catch {
              // Abaikan
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(destinationUrl);
        }
        return undefined;
      })
  );
});
