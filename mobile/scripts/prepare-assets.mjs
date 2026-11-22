import fs from 'node:fs';
import path from 'node:path';

const resourcesDir = path.resolve(process.cwd(), 'resources');
const iconPath = path.join(resourcesDir, 'icon.png');
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

  const iconBuffer = fs.readFileSync(iconPath);

  // Pastikan icon.png berformat PNG asli 1024x1024 agar kompatibel penuh dengan @capacitor/assets
  const normalizedIcon = await sharpModule(iconBuffer)
    .resize(1024, 1024, { fit: 'cover' })
    .png()
    .toBuffer();
  fs.writeFileSync(iconPath, normalizedIcon);

  // Buat splash.png berformat PNG asli 2732x2732 dengan ikon di tengah pada latar navy #0F172A
  const splashLogo = await sharpModule(normalizedIcon)
    .resize(760, 760, { fit: 'contain' })
    .png()
    .toBuffer();

  const splashBuffer = await sharpModule({
    create: {
      width: 2732,
      height: 2732,
      channels: 4,
      background: { r: 15, g: 23, b: 42, alpha: 1 },
    },
  })
    .composite([{ input: splashLogo, gravity: 'center' }])
    .png()
    .toBuffer();

  fs.writeFileSync(splashPath, splashBuffer);
  console.log('[prepare-assets] icon.png (1024x1024) & splash.png (2732x2732) siap digunakan.');
}

main().catch((err) => {
  console.warn('[prepare-assets] Peringatan:', err?.message || err);
});
