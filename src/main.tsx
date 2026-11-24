import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ThemeProvider } from './lib/themeContext.tsx';
import { BrandProvider } from './lib/brandContext.tsx';
import { AppUpdateProvider } from './lib/appUpdate.tsx';
import { AppUpdateBanner, OfflineOverlay } from './components/AppUpdateSystem.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { initBugReportErrorCollector } from './lib/bugReportService.ts';
import './index.css';

initBugReportErrorCollector();

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ThemeProvider>
      <AppUpdateProvider>
        <BrandProvider>
          <AppUpdateBanner />
          <OfflineOverlay />
          <App />
        </BrandProvider>
      </AppUpdateProvider>
    </ThemeProvider>
  </ErrorBoundary>
);
