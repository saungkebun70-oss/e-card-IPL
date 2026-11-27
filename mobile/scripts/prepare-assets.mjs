import fs from 'node:fs';
import path from 'node:path';

const resourcesDir = path.resolve(process.cwd(), 'resources');
const iconPath = path.join(resourcesDir, 'icon.png');
const iconOnlyPath = path.join(resourcesDir, 'icon-only.png');
const iconBackgroundPath = path.join(resourcesDir, 'icon-background.png');
const splashPath = path.join(resourcesDir, 'splash.png');

async function main() {
  if (!fs.existsSync(iconPath)) {
    console.log('[prepare-assets] resources/icon.png tidak ditemukan, lewati konversi.');
    return;
  }

  let sharpModule = null;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default || mod;
  } catch {
    console.log('[prepare-assets] sharp tidak tersedia langsung, lanjutkan dengan file resources yang ada.');
    return;
  }

  // Pastikan resources/icon.png valid PNG 1024x1024 tanpa menimpa desain Glass Square dengan latar krem
  const iconBuffer = fs.readFileSync(iconPath);
  const meta = await sharpModule(iconBuffer).metadata();
  if (meta.width !== 1024 || meta.height !== 1024 || meta.format !== 'png') {
    const normalizedIcon = await sharpModule(iconBuffer)
      .resize(1024, 1024, { fit: 'cover' })
      .png()
      .toBuffer();
    fs.writeFileSync(iconPath, normalizedIcon);
  }

  // Pastikan splash.png tersedia (2732x2732) dengan tema hutan hijau gelap Saung Kebun bila belum ada
  if (!fs.existsSync(splashPath)) {
    const splashLogoSource = fs.existsSync(iconOnlyPath) ? fs.readFileSync(iconOnlyPath) : iconBuffer;
    const splashLogo = await sharpModule(splashLogoSource)
      .resize(860, 860, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const splashBg = fs.existsSync(iconBackgroundPath)
      ? await sharpModule(fs.readFileSync(iconBackgroundPath))
          .resize(2732, 2732, { fit: 'cover' })
          .png()
          .toBuffer()
      : {
          create: {
            width: 2732,
            height: 2732,
            channels: 4,
            background: { r: 30, g: 51, b: 31, alpha: 1 },
          },
        };

    const splashBuffer = await sharpModule(splashBg)
      .composite([{ input: splashLogo, gravity: 'center' }])
      .png()
      .toBuffer();

    fs.writeFileSync(splashPath, splashBuffer);
  }

  console.log('[prepare-assets] icon.png, adaptive foreground/background & splash.png siap untuk @capacitor/assets.');
}

main().catch((err) => {
  console.warn('[prepare-assets] Peringatan:', err?.message || err);
});
