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

if (linesToInsert.length > 0) {
  const block = `\n    <!-- Izin & Fitur Aplikasi e-Card IPL Saung Kebun -->\n${linesToInsert.join('\n')}\n`;
  if (xml.includes('</manifest>')) {
    xml = xml.replace('</manifest>', `${block}</manifest>`);
  } else {
    console.error('[inject-android-manifest] Tag </manifest> tidak ditemukan.');
    process.exit(1);
  }
  fs.writeFileSync(manifestPath, xml, 'utf8');
  console.log(`[inject-android-manifest] Berhasil menyuntikkan ${linesToInsert.length} entri izin/fitur ke AndroidManifest.xml.`);
} else {
  console.log('[inject-android-manifest] Seluruh izin Android sudah terpasang.');
}
