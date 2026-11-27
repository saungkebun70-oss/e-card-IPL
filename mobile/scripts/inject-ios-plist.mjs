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
  NSPhotoLibraryAddUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun memerlukan izin menyimpan dokumen laporan LPJ dan bukti transaksi ke perangkat Anda.',
  NSLocationWhenInUseUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun memerlukan akses lokasi GPS untuk kalibrasi titik pos dan live tracking patroli petugas keamanan.',
  NFCReaderUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun memerlukan pembaca NFC untuk memindai tag titik checkpoint patroli keamanan lingkungan.',
  NSFaceIDUsageDescription:
    'Aplikasi e-Card IPL Saung Kebun menggunakan Face ID / Touch ID agar Petugas Keamanan dapat masuk ke Portal Patroli secara cepat dan aman tanpa mengetik ulang PIN.',
};

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function insertBeforeClosingDict(plistText, block) {
  const lastDictIndex = plistText.lastIndexOf('</dict>');
  if (lastDictIndex === -1) {
    console.error('[inject-ios-plist] Tag </dict> tidak ditemukan di Info.plist.');
    process.exit(1);
  }
  return `${plistText.slice(0, lastDictIndex)}${block}${plistText.slice(lastDictIndex)}`;
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
    plist = insertBeforeClosingDict(plist, entry);
    updatedCount += 1;
  }
}

// Pastikan UIBackgroundModes mencakup remote-notification agar Push Notification iOS (APNs/FCM) berjalan di background
const bgModesRegex = /(<key>UIBackgroundModes<\/key>\s*<array>)([\s\S]*?)(<\/array>)/m;
if (bgModesRegex.test(plist)) {
  const match = plist.match(bgModesRegex);
  if (match && !match[2].includes('<string>remote-notification</string>')) {
    plist = plist.replace(
      bgModesRegex,
      `$1$2\t\t<string>remote-notification</string>\n\t$3`
    );
    console.log('[inject-ios-plist] Menambahkan remote-notification ke UIBackgroundModes.');
  }
} else {
  const bgBlock =
    `\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>remote-notification</string>\n\t</array>\n`;
  plist = insertBeforeClosingDict(plist, bgBlock);
  console.log('[inject-ios-plist] Menambahkan UIBackgroundModes (remote-notification) ke Info.plist.');
}

// Pastikan CFBundleURLTypes mendukung deep link callback OAuth (com.saungkebun.ecardipl://oauth-callback)
if (!plist.includes('<string>com.saungkebun.ecardipl</string>')) {
  const urlTypesBlock = `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>com.saungkebun.ecardipl</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>com.saungkebun.ecardipl</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n`;
  plist = insertBeforeClosingDict(plist, urlTypesBlock);
  console.log('[inject-ios-plist] Menambahkan CFBundleURLTypes (com.saungkebun.ecardipl) ke Info.plist.');
}

fs.writeFileSync(plistPath, plist, 'utf8');
console.log(`[inject-ios-plist] Berhasil memperbarui ${updatedCount} deskripsi izin & background push mode di Info.plist.`);
