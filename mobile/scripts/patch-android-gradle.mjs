import fs from 'node:fs';
import path from 'node:path';

const androidDir = path.resolve(process.cwd(), 'android');
const rootGradlePath = path.join(androidDir, 'build.gradle');
const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
const googleServicesPath = path.join(androidDir, 'app', 'google-services.json');

const GOOGLE_SERVICES_CLASSPATH = "classpath 'com.google.gms:google-services:4.4.2'";
const GOOGLE_SERVICES_PLUGIN = "apply plugin: 'com.google.gms.google-services'";

if (!fs.existsSync(googleServicesPath)) {
  console.log(
    '[patch-android-gradle] android/app/google-services.json tidak ditemukan — lewati patch plugin FCM (build tetap aman).'
  );
  process.exit(0);
}

// Validasi JSON agar file google-services.json yang kosong/rusak tidak menggagalkan build Gradle
try {
  const rawJson = fs.readFileSync(googleServicesPath, 'utf8').trim();
  const parsed = JSON.parse(rawJson);
  if (!parsed || typeof parsed !== 'object' || !parsed.project_info) {
    throw new Error('Struktur project_info tidak ditemukan di google-services.json');
  }
} catch (err) {
  console.warn(
    `[patch-android-gradle] Peringatan: google-services.json tidak valid (${err instanceof Error ? err.message : String(err)}). Menghapus file rusak agar build APK tidak gagal.`
  );
  fs.unlinkSync(googleServicesPath);
  process.exit(0);
}

console.log(
  '[patch-android-gradle] google-services.json valid ditemukan — menyinkronkan konfigurasi Gradle FCM...'
);

// 1. Suntikkan classpath com.google.gms:google-services:4.4.2 tepat di dalam buildscript { dependencies { ... } }
if (fs.existsSync(rootGradlePath)) {
  let rootGradle = fs.readFileSync(rootGradlePath, 'utf8');
  if (!rootGradle.includes('com.google.gms:google-services')) {
    const buildscriptDepsPattern = /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/m;
    if (buildscriptDepsPattern.test(rootGradle)) {
      rootGradle = rootGradle.replace(
        buildscriptDepsPattern,
        `$1\n        ${GOOGLE_SERVICES_CLASSPATH}`
      );
      fs.writeFileSync(rootGradlePath, rootGradle, 'utf8');
      console.log(
        `[patch-android-gradle] Menambahkan ${GOOGLE_SERVICES_CLASSPATH} ke android/build.gradle.`
      );
    } else {
      console.warn(
        '[patch-android-gradle] Blok buildscript.dependencies tidak ditemukan di android/build.gradle.'
      );
    }
  } else {
    console.log(
      '[patch-android-gradle] Classpath com.google.gms:google-services sudah terpasang di android/build.gradle.'
    );
  }
}

// 2. Suntikkan apply plugin: 'com.google.gms.google-services' secara kondisional ke android/app/build.gradle
if (fs.existsSync(appGradlePath)) {
  let appGradle = fs.readFileSync(appGradlePath, 'utf8');
  if (!appGradle.includes('com.google.gms.google-services')) {
    const conditionalBlock = `
try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        ${GOOGLE_SERVICES_PLUGIN}
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied.")
}
`;
    appGradle = `${appGradle.trimEnd()}\n${conditionalBlock}`;
    fs.writeFileSync(appGradlePath, appGradle, 'utf8');
    console.log(
      '[patch-android-gradle] Menambahkan plugin kondisional google-services ke android/app/build.gradle.'
    );
  } else {
    console.log(
      '[patch-android-gradle] Plugin com.google.gms.google-services sudah terpasang di android/app/build.gradle.'
    );
  }
}

console.log('[patch-android-gradle] Selesai.');
