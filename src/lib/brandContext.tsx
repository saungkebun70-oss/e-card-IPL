import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_APP_BRAND_CONFIG, type AppBrandConfig } from '../types';
import { fetchAppBrandConfig, readLocalAppBrandConfig } from './dataService';
import { isSimulationSessionActive, subscribeSimulationChanges } from './simulationStore';

interface BrandContextValue {
  brand: AppBrandConfig;
  setBrand: (next: AppBrandConfig) => void;
  refreshBrand: () => Promise<void>;
}

const BrandContext = createContext<BrandContextValue>({
  brand: DEFAULT_APP_BRAND_CONFIG,
  setBrand: () => undefined,
  refreshBrand: async () => undefined,
});

function syncDocumentHead(brand: AppBrandConfig) {
  if (typeof document === 'undefined') return;
  try {
    document.title = `${brand.app_name} — ${brand.app_subtitle}`;

    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) {
      appleTitle.setAttribute('content', brand.app_name);
    }

    const customLogo = brand.logo_url || '';
    const iconLink = document.querySelector('link[rel="icon"]');
    if (iconLink) {
      iconLink.setAttribute('href', customLogo || '/icon.svg');
    }
    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleLink) {
      appleLink.setAttribute('href', customLogo || '/apple-touch-icon.png');
    }
  } catch {
    // Abaikan bila lingkungan browser membatasi modifikasi head
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrandState] = useState<AppBrandConfig>(() => readLocalAppBrandConfig());

  const applyBrandIfChanged = useCallback((next: AppBrandConfig) => {
    setBrandState((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(next)) {
        return prev;
      }
      return next;
    });
  }, []);

  const setBrand = useCallback((next: AppBrandConfig) => {
    setBrandState(next);
    syncDocumentHead(next);
  }, []);

  const refreshBrand = useCallback(async () => {
    if (isSimulationSessionActive()) {
      applyBrandIfChanged(readLocalAppBrandConfig());
      return;
    }
    const latest = await fetchAppBrandConfig(null);
    applyBrandIfChanged(latest);
  }, [applyBrandIfChanged]);

  useEffect(() => {
    syncDocumentHead(brand);
  }, [brand]);

  useEffect(() => {
    let active = true;
    const syncBrand = () => {
      if (isSimulationSessionActive()) {
        applyBrandIfChanged(readLocalAppBrandConfig());
        return;
      }
      void fetchAppBrandConfig(null).then((latest) => {
        if (active) {
          applyBrandIfChanged(latest);
        }
      });
    };
    syncBrand();
    const unsub = subscribeSimulationChanges(() => {
      if (isSimulationSessionActive()) {
        applyBrandIfChanged(readLocalAppBrandConfig());
      } else {
        syncBrand();
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [applyBrandIfChanged]);

  return (
    <BrandContext.Provider value={{ brand, setBrand, refreshBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useAppBrand(): BrandContextValue {
  return useContext(BrandContext);
}
