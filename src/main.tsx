import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './lib/themeContext.tsx';
import { BrandProvider } from './lib/brandContext.tsx';
import { SimulationProvider } from './lib/simulationContext.tsx';
import { AppUpdateProvider } from './lib/appUpdate.tsx';
import { AppUpdateBanner, OfflineOverlay } from './components/AppUpdateSystem.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { initBugReportErrorCollector } from './lib/bugReportService.ts';
import './index.css';

declare global {
  interface Window {
    __ECARD_APP_MOUNTED__?: boolean;
    __ECARD_RENDER_BOOT_FALLBACK__?: (reason?: string) => void;
    __ECARD_TRY_CHUNK_RECOVERY__?: () => boolean;
  }
}

try {
  initBugReportErrorCollector();
} catch {
  // Abaikan agar error collector tidak pernah memblokir render awal
}

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    if (!window.__ECARD_TRY_CHUNK_RECOVERY__?.()) {
      window.location.reload();
    }
  });
}

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Elemen #root tidak ditemukan di halaman.');
  }

  createRoot(rootElement).render(
    <ErrorBoundary>
      <ThemeProvider>
        <AppUpdateProvider>
          <SimulationProvider>
            <BrandProvider>
              <AppUpdateBanner />
              <OfflineOverlay />
              <App />
            </BrandProvider>
          </SimulationProvider>
        </AppUpdateProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );

  if (typeof window !== 'undefined') {
    window.__ECARD_APP_MOUNTED__ = true;
  }
} catch (err) {
  const message = err instanceof Error ? err.message : 'Gagal memulai antarmuka aplikasi.';
  if (typeof window !== 'undefined' && typeof window.__ECARD_RENDER_BOOT_FALLBACK__ === 'function') {
    window.__ECARD_RENDER_BOOT_FALLBACK__(message);
  }
  console.error('[BOOT_ERROR]', err);
}
