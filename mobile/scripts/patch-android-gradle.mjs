import fs from 'node:fs';
import path from 'node:path';

const androidDir = path.resolve(process.cwd(), 'android');
const rootGradlePath = path.join(androidDir, 'build.gradle');
const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
const googleServicesPath = path.join(androidDir, 'app', 'google-services.json');

if (!fs.existsSync(googleServicesPath)) {
  console.log('[patch-android-gradle] google-services.json tidak ditemukan, lewati patch FCM.');
  process.exit(0);
}

console.log('[patch-android-gradle] google-services.json ditemukan, memverifikasi konfigurasi Gradle FCM...');

if (fs.existsSync(rootGradlePath)) {
  let rootGradle = fs.readFileSync(rootGradlePath, 'utf8');
  if (!rootGradle.includes('com.google.gms:google-services')) {
    rootGradle = rootGradle.replace(
      /dependencies\s*\{/,
      "dependencies {\n        classpath 'com.google.gms:google-services:4.4.2'"
    );
    fs.writeFileSync(rootGradlePath, rootGradle, 'utf8');
    console.log('[patch-android-gradle] Menambahkan classpath google-services ke android/build.gradle');
  }
}

if (fs.existsSync(appGradlePath)) {
  let appGradle = fs.readFileSync(appGradlePath, 'utf8');
  if (!appGradle.includes('com.google.gms.google-services')) {
    appGradle += `
try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied.")
}
`;
    fs.writeFileSync(appGradlePath, appGradle, 'utf8');
    console.log('[patch-android-gradle] Menambahkan plugin google-services ke android/app/build.gradle');
  }
}

console.log('[patch-android-gradle] Selesai.');
