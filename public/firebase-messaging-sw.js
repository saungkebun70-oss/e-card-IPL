/* eslint-disable no-undef */
/**
 * Firebase Cloud Messaging Service Worker — e-Card IPL Perumahan Saung Kebun
 * Menangani Web Push Notification real-time di Chrome & Safari saat tab
 * di latar belakang (background) maupun browser ditutup total (killed).
 *
 * Konfigurasi Firebase diterima otomatis melalui URL query parameter saat registrasi
 * dari aplikasi utama (src/lib/notificationAlertService.ts), sehingga selalu sinkron
 * dengan proyek Firebase utama tanpa menyimpan kunci statis di repository.
 */

const APP_ICON_URL = '/app-icon.jpg';
const DEFAULT_TITLE = 'e-Card IPL · Perumahan Saung Kebun';
const DEFAULT_BODY = 'Ada pembaruan aktivitas terbaru. Ketuk untuk membuka aplikasi.';

let firebaseInitialized = false;
let lastNotifKey = '';
let lastNotifAt = 0;

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

function showSaungKebunNotification(payload) {
  const data = (payload && payload.data) || {};
  const notif = (payload && payload.notification) || {};

  const title = String(notif.title || data.title || DEFAULT_TITLE).trim();
  const body = String(notif.body || data.body || data.message || DEFAULT_BODY).trim();
  const targetUrl = String(data.target_url || data.url || '').trim();
  const notifId = String(
    data.notification_id || notif.tag || `sk-web-${Date.now()}`
  ).trim();

  // Deduplikasi singkat (3 detik) agar tidak muncul ganda bila FCM + push event sama-sama terpicu
  const dedupeKey = `${notifId}::${title}::${body}`;
  const now = Date.now();
  if (dedupeKey === lastNotifKey && now - lastNotifAt < 3000) {
    return Promise.resolve();
  }
  lastNotifKey = dedupeKey;
  lastNotifAt = now;

  const options = {
    body,
    icon: notif.icon || APP_ICON_URL,
    badge: APP_ICON_URL,
    tag: notifId,
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      target_url: targetUrl,
      url: data.click_action || '/',
      notification_id: notifId,
      category: data.category || 'system',
    },
  };

  return self.registration.showNotification(title, options);
}

function initFirebaseMessaging(config) {
  if (firebaseInitialized || !config) return;
  try {
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

    if (!self.firebase) return;
    if (!self.firebase.apps || self.firebase.apps.length === 0) {
      self.firebase.initializeApp(config);
    }
    const messaging = self.firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      return showSaungKebunNotification(payload);
    });
    firebaseInitialized = true;
  } catch {
    // Fallback tetap ditangani oleh listener 'push' standar di bawah
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
  if (event && event.data && event.data.type === 'ECARD_FIREBASE_CONFIG' && event.data.config) {
    initFirebaseMessaging(event.data.config);
  }
});

// Fallback handler untuk Web Push standar apabila Firebase compat SDK belum termuat / offline
self.addEventListener('push', (event) => {
  if (firebaseInitialized) return;
  if (!event.data) return;

  let parsed = {};
  try {
    parsed = event.data.json();
  } catch {
    parsed = {
      notification: {
        title: DEFAULT_TITLE,
        body: event.data.text() || DEFAULT_BODY,
      },
    };
  }

  event.waitUntil(showSaungKebunNotification(parsed));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = (event.notification && event.notification.data) || {};
  const targetUrl = String(notifData.target_url || '').trim();
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
            if (targetUrl) {
              client.postMessage({
                type: 'ECARD_NOTIFICATION_CLICK',
                targetUrl,
              });
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
