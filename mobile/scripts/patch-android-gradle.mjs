import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const appGradlePath = path.resolve(cwd, 'android/app/build.gradle');
const rootGradlePath = path.resolve(cwd, 'android/build.gradle');
const sourceGoogleServices = path.resolve(cwd, 'google-services.json');
const targetGoogleServices = path.resolve(cwd, 'android/app/google-services.json');

// Salin google-services.json jika tersedia di folder mobile/
if (fs.existsSync(sourceGoogleServices) && fs.existsSync(path.dirname(targetGoogleServices))) {
  fs.copyFileSync(sourceGoogleServices, targetGoogleServices);
  console.log('[patch-android-gradle] google-services.json disalin ke android/app/google-services.json.');
}

// Pastikan classpath google-services tersedia di android/build.gradle (aman meski tanpa google-services.json)
if (fs.existsSync(rootGradlePath)) {
  let rootGradle = fs.readFileSync(rootGradlePath, 'utf8');
  if (!rootGradle.includes('com.google.gms:google-services')) {
    const depMatch = rootGradle.match(/dependencies\s*\{/);
    if (depMatch) {
      rootGradle = rootGradle.replace(
        /dependencies\s*\{/,
        `dependencies {\n        classpath 'com.google.gms:google-services:4.4.2'`
      );
      fs.writeFileSync(rootGradlePath, rootGradle, 'utf8');
      console.log('[patch-android-gradle] Menambahkan classpath com.google.gms:google-services:4.4.2 ke android/build.gradle.');
    }
  }
}

if (!fs.existsSync(appGradlePath)) {
  console.error(`[patch-android-gradle] File tidak ditemukan: ${appGradlePath}`);
  process.exit(1);
}

let appGradle = fs.readFileSync(appGradlePath, 'utf8');

const SAFE_GMS_BLOCK = `
// Anti-error GitHub Actions: pasang plugin Google Services (FCM) hanya jika google-services.json ada
if (file('google-services.json').exists()) {
    apply plugin: 'com.google.gms.google-services'
}
`.trim();

// Hapus blok apply plugin google-services lama (baik tanpa syarat maupun blok try/catch bawaan Capacitor)
const legacyTryBlockRegex =
  /try\s*\{[\s\S]*?google-services\.json[\s\S]*?com\.google\.gms\.google-services[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}/g;
const bareApplyRegex = /^\s*apply\s+plugin\s*:\s*['"]com\.google\.gms\.google-services['"]\s*$/gm;
const existingSafeRegex =
  /\/\/\s*Anti-error GitHub Actions:[\s\S]*?if\s*\(\s*file\(['"]google-services\.json['"]\)\.exists\(\)\s*\)\s*\{[\s\S]*?com\.google\.gms\.google-services[\s\S]*?\}/g;

const cleaned = appGradle
  .replace(existingSafeRegex, '')
  .replace(legacyTryBlockRegex, '')
  .replace(bareApplyRegex, '')
  .trimEnd();

const nextGradle = `${cleaned}\n\n${SAFE_GMS_BLOCK}\n`;

fs.writeFileSync(appGradlePath, nextGradle, 'utf8');
console.log(
  `[patch-android-gradle] android/app/build.gradle berhasil dipatch dengan kondisi if (file('google-services.json').exists()).`
);
