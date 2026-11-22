import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { BrandProvider } from './lib/brandContext.tsx';
import { AppUpdateProvider } from './lib/appUpdate.tsx';
import { AppUpdateBanner, OfflineOverlay } from './components/AppUpdateSystem.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AppUpdateProvider>
      <BrandProvider>
        <AppUpdateBanner />
        <OfflineOverlay />
        <App />
      </BrandProvider>
    </AppUpdateProvider>
  </ErrorBoundary>
);
