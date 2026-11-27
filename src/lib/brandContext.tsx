import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_APP_BRAND_CONFIG, type AppBrandConfig } from '../types';
import { fetchAppBrandConfig, readLocalAppBrandConfig } from './dataService';

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

    const iconLink = document.querySelector('link[rel="icon"]');
    if (iconLink) {
      iconLink.setAttribute('href', '/favicon.ico');
    }
    const appleLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleLink) {
      appleLink.setAttribute('href', '/apple-touch-icon.png');
    }
  } catch {
    // Abaikan bila lingkungan browser membatasi modifikasi head
  }
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrandState] = useState<AppBrandConfig>(() => readLocalAppBrandConfig());

  const setBrand = useCallback((next: AppBrandConfig) => {
    setBrandState(next);
    syncDocumentHead(next);
  }, []);

  const refreshBrand = useCallback(async () => {
    const latest = await fetchAppBrandConfig(null);
    setBrandState(latest);
    syncDocumentHead(latest);
  }, []);

  useEffect(() => {
    syncDocumentHead(brand);
  }, [brand]);

  useEffect(() => {
    let active = true;
    void fetchAppBrandConfig(null).then((latest) => {
      if (active) {
        setBrandState(latest);
        syncDocumentHead(latest);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <BrandContext.Provider value={{ brand, setBrand, refreshBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useAppBrand(): BrandContextValue {
  return useContext(BrandContext);
}
