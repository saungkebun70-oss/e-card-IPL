import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { BrandProvider } from './lib/brandContext.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrandProvider>
      <App />
    </BrandProvider>
  </ErrorBoundary>
);
