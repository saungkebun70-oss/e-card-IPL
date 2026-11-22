import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

function createBuildVersionMetadata() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getUTCFullYear();
  const m = pad(now.getUTCMonth() + 1);
  const d = pad(now.getUTCDate());
  const hh = pad(now.getUTCHours());
  const mm = pad(now.getUTCMinutes());
  const ss = pad(now.getUTCSeconds());
  const buildId = `${y}${m}${d}-${hh}${mm}${ss}`;
  return {
    version: `1.0.${y}${m}${d}${hh}${mm}`,
    buildId,
    builtAt: now.toISOString(),
  };
}

export default defineConfig(() => {
  const versionMeta = createBuildVersionMetadata();
  const versionJsonContent = `${JSON.stringify(versionMeta, null, 2)}\n`;

  return {
    define: {
      __APP_VERSION__: JSON.stringify(versionMeta.version),
      __APP_BUILD_ID__: JSON.stringify(versionMeta.buildId),
      __APP_BUILT_AT__: JSON.stringify(versionMeta.builtAt),
    },
    plugins: [
      react(),
      tailwindcss(),
      // Otomatis memperbarui public/version.json & dist/version.json saat proses build
      // untuk mendeteksi pembaruan OTA (Live Update) pada aplikasi web & mobile Capacitor.
      {
        name: 'generate-version-manifest',
        apply: 'build',
        buildStart(): void {
          const publicDir = path.resolve(__dirname, 'public');
          if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir, {recursive: true});
          }
          fs.writeFileSync(path.resolve(publicDir, 'version.json'), versionJsonContent, 'utf8');
        },
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          if (fs.existsSync(distDir)) {
            fs.writeFileSync(path.resolve(distDir, 'version.json'), versionJsonContent, 'utf8');
          }
        },
      },
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
