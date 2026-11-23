import fs from 'node:fs';
import path from 'node:path';

/**
 * Menyuntikkan pembuatan Android Notification Channel `saung_kebun_notif` (IMPORTANCE_HIGH)
 * dan channel kompatibilitas `saung_kebun_alerts` secara native di `MainActivity.java` `onCreate()`.
 *
 * Ini menjamin pada Android 8–15 (termasuk Samsung One UI) channel notifikasi sudah langsung
 * terdaftar di OS sejak aplikasi dibuka pertama kali — bahkan sebelum WebView/JS selesai memuat —
 * sehingga push FCM background & force-close tidak pernah dibuang diam-diam oleh Android OS.
 */

const javaRoot = path.resolve(process.cwd(), 'android/app/src/main/java');

function findMainActivity(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findMainActivity(full);
      if (found) return found;
    } else if (entry.name === 'MainActivity.java') {
      return full;
    }
  }
  return null;
}

const mainActivityPath = findMainActivity(javaRoot);
if (!mainActivityPath) {
  console.warn('[patch-android-mainactivity] MainActivity.java tidak ditemukan — lewati.');
  process.exit(0);
}

let src = fs.readFileSync(mainActivityPath, 'utf8');

if (src.includes('saung_kebun_notif')) {
  console.log('[patch-android-mainactivity] Channel native saung_kebun_notif sudah terpasang.');
  process.exit(0);
}

const requiredImports = [
  'import android.app.NotificationChannel;',
  'import android.app.NotificationManager;',
  'import android.graphics.Color;',
  'import android.os.Build;',
  'import android.os.Bundle;',
];

for (const imp of requiredImports) {
  if (!src.includes(imp)) {
    src = src.replace(/(package\s+[^;]+;\s*)/, `$1\n${imp}`);
  }
}

const channelHelperMethod = `
    private void ensureSaungKebunNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            NotificationChannel primary = new NotificationChannel(
                "saung_kebun_notif",
                "Notifikasi Saung Kebun",
                NotificationManager.IMPORTANCE_HIGH
            );
            primary.setDescription("Notifikasi real-time IPL, Kas Lingkungan, Patroli Keamanan & Pengumuman");
            primary.enableVibration(true);
            primary.setVibrationPattern(new long[]{0, 250, 150, 250});
            primary.enableLights(true);
            primary.setLightColor(Color.parseColor("#059669"));
            primary.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(primary);

            NotificationChannel legacy = new NotificationChannel(
                "saung_kebun_alerts",
                "Peringatan Saung Kebun",
                NotificationManager.IMPORTANCE_HIGH
            );
            legacy.setDescription("Channel kompatibilitas notifikasi e-Card IPL Saung Kebun");
            legacy.enableVibration(true);
            legacy.enableLights(true);
            legacy.setLightColor(Color.parseColor("#059669"));
            legacy.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            manager.createNotificationChannel(legacy);
        }
    }
`;

if (/onCreate\s*\(\s*Bundle\s+\w+\s*\)/.test(src)) {
  src = src.replace(
    /(super\.onCreate\([^)]*\);)/,
    `$1\n        ensureSaungKebunNotificationChannels();`
  );
  const lastBrace = src.lastIndexOf('}');
  src = `${src.slice(0, lastBrace)}\n${channelHelperMethod}\n}\n`;
} else {
  const onCreateOverride = `
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureSaungKebunNotificationChannels();
    }
${channelHelperMethod}
`;
  const lastBrace = src.lastIndexOf('}');
  src = `${src.slice(0, lastBrace)}\n${onCreateOverride}\n}\n`;
}

fs.writeFileSync(mainActivityPath, src, 'utf8');
console.log(
  `[patch-android-mainactivity] Berhasil menyuntikkan pembuatan channel saung_kebun_notif ke ${mainActivityPath}.`
);
