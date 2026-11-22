import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve(
  process.cwd(),
  'android/app/src/main/AndroidManifest.xml'
);

if (!fs.existsSync(manifestPath)) {
  console.error(`[inject-android-manifest] File tidak ditemukan: ${manifestPath}`);
  process.exit(1);
}

const REQUIRED_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.CAMERA',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.NFC',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.VIBRATE',
  'android.permission.WAKE_LOCK',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const OPTIONAL_FEATURES = [
  'android.hardware.nfc',
  'android.hardware.camera',
  'android.hardware.location.gps',
  'android.hardware.fingerprint',
  'android.hardware.biometrics.face',
];

let xml = fs.readFileSync(manifestPath, 'utf8');

const linesToInsert = [];

for (const perm of REQUIRED_PERMISSIONS) {
  if (!xml.includes(`android:name="${perm}"`)) {
    linesToInsert.push(`    <uses-permission android:name="${perm}" />`);
  }
}

for (const feat of OPTIONAL_FEATURES) {
  if (!xml.includes(`android:name="${feat}"`)) {
    linesToInsert.push(`    <uses-feature android:name="${feat}" android:required="false" />`);
  }
}

let modified = false;

if (linesToInsert.length > 0) {
  const block = `\n    <!-- Izin & Fitur Aplikasi e-Card IPL Saung Kebun -->\n${linesToInsert.join('\n')}\n`;
  if (xml.includes('</manifest>')) {
    xml = xml.replace('</manifest>', `${block}</manifest>`);
    modified = true;
    console.log(
      `[inject-android-manifest] Berhasil menyuntikkan ${linesToInsert.length} entri izin/fitur ke AndroidManifest.xml.`
    );
  } else {
    console.error('[inject-android-manifest] Tag </manifest> tidak ditemukan.');
    process.exit(1);
  }
} else {
  console.log('[inject-android-manifest] Seluruh izin Android sudah terpasang.');
}

// Suntikkan default_notification_channel_id = saung_kebun_alerts di dalam tag <application>
const DEFAULT_CHANNEL_META_NAME =
  'com.google.firebase.messaging.default_notification_channel_id';
const DEFAULT_CHANNEL_ID = 'saung_kebun_alerts';

if (!xml.includes(DEFAULT_CHANNEL_META_NAME)) {
  const metaBlock = `\n        <!-- Default Notification Channel untuk FCM & Local Notifications -->\n        <meta-data\n            android:name="${DEFAULT_CHANNEL_META_NAME}"\n            android:value="${DEFAULT_CHANNEL_ID}" />\n    `;
  if (xml.includes('</application>')) {
    xml = xml.replace('</application>', `${metaBlock}</application>`);
    modified = true;
    console.log(
      `[inject-android-manifest] Berhasil menyuntikkan default_notification_channel_id=${DEFAULT_CHANNEL_ID}.`
    );
  } else {
    console.warn('[inject-android-manifest] Tag </application> tidak ditemukan.');
  }
} else {
  console.log(
    `[inject-android-manifest] default_notification_channel_id sudah terpasang.`
  );
}

if (modified) {
  fs.writeFileSync(manifestPath, xml, 'utf8');
}
