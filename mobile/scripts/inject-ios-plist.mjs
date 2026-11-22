import fs from 'node:fs';
import path from 'node:path';

const plistPath = path.resolve(process.cwd(), 'ios/App/App/Info.plist');

if (!fs.existsSync(plistPath)) {
  console.error(`[inject-ios-plist] File tidak ditemukan: ${plistPath}`);
  process.exit(1);
}

const USAGE_DESCRIPTIONS = {
  NSCameraUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun memerlukan akses kamera untuk mengambil foto bukti pembayaran IPL, absensi jaga, dan dokumentasi patroli keamanan.',
  NSPhotoLibraryUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun memerlukan akses galeri foto untuk mengunggah bukti transfer IPL dan lampiran nota kas lingkungan.',
  NSLocationWhenInUseUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun memerlukan akses lokasi GPS untuk kalibrasi titik pos dan live tracking patroli petugas keamanan.',
  NFCReaderUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun memerlukan pembaca NFC untuk memindai tag titik checkpoint patroli keamanan lingkungan.',
};

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let plist = fs.readFileSync(plistPath, 'utf8');
let updatedCount = 0;

for (const [key, description] of Object.entries(USAGE_DESCRIPTIONS)) {
  const escaped = escapeXml(description);
  const existingRegex = new RegExp(
    `<key>${key}</key>\\s*<string>[\\s\\S]*?</string>`,
    'm'
  );
  if (existingRegex.test(plist)) {
    plist = plist.replace(existingRegex, `<key>${key}</key>\n\t<string>${escaped}</string>`);
    updatedCount += 1;
  } else {
    const entry = `\t<key>${key}</key>\n\t<string>${escaped}</string>\n`;
    const lastDictIndex = plist.lastIndexOf('</dict>');
    if (lastDictIndex === -1) {
      console.error('[inject-ios-plist] Tag </dict> tidak ditemukan di Info.plist.');
      process.exit(1);
    }
    plist = `${plist.slice(0, lastDictIndex)}${entry}${plist.slice(lastDictIndex)}`;
    updatedCount += 1;
  }
}

fs.writeFileSync(plistPath, plist, 'utf8');
console.log(`[inject-ios-plist] Berhasil memperbarui ${updatedCount} deskripsi izin di Info.plist.`);
