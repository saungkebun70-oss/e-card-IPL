import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export type AppThemeId = 'emerald' | 'midnight' | 'ocean' | 'earth' | 'royal';

export interface AppThemeOption {
  id: AppThemeId;
  name: string;
  tagline: string;
  description: string;
  isDark: boolean;
  metaThemeColor: string;
  /** 3 warna preview: [warna utama, warna latar, warna aksen] */
  previewColors: {
    primary: string;
    background: string;
    accent: string;
  };
}

export const APP_THEME_STORAGE_KEY = 'app_theme';

export const APP_THEMES: AppThemeOption[] = [
  {
    id: 'emerald',
    name: 'Saung Kebun',
    tagline: 'Velvety Moss & Cream · Default',
    description: 'Tema resmi Perumahan Saung Kebun: hijau lumut beludru berpadu krem hangat alabaster & sage lembut.',
    isDark: false,
    metaThemeColor: '#F6F3EA',
    previewColors: {
      primary: '#2B3F29',
      background: '#F6F3EA',
      accent: '#E5EEE3',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Moss',
    tagline: 'Dark Mode Estetik',
    description: 'Latar hutan malam gelap elegan dengan aksen hijau lumut lembut, nyaman untuk patroli malam.',
    isDark: true,
    metaThemeColor: '#0b1410',
    previewColors: {
      primary: '#34d399',
      background: '#0b1410',
      accent: '#243825',
    },
  },
  {
    id: 'ocean',
    name: 'Ocean Breeze',
    tagline: 'Biru Profesional',
    description: 'Nuansa biru laut tenang dengan aksen navy dan latar biru lembut.',
    isDark: false,
    metaThemeColor: '#f0f9ff',
    previewColors: {
      primary: '#0284c7',
      background: '#f0f9ff',
      accent: '#0c4a6e',
    },
  },
  {
    id: 'earth',
    name: 'Warm Earth',
    tagline: 'Krem & Terracotta',
    description: 'Nuansa hangat modern terracotta berpadu latar krem yang ramah dan elegan.',
    isDark: false,
    metaThemeColor: '#faf8f5',
    previewColors: {
      primary: '#c2410c',
      background: '#faf8f5',
      accent: '#b45309',
    },
  },
  {
    id: 'royal',
    name: 'Sage Slate',
    tagline: 'Slate Minimalis',
    description: 'Nuansa abu-abu batu modern yang tenang dan profesional.',
    isDark: false,
    metaThemeColor: '#f4f5f2',
    previewColors: {
      primary: '#334155',
      background: '#f4f5f2',
      accent: '#1e293b',
    },
  },
];

const VALID_THEME_IDS = new Set<AppThemeId>(APP_THEMES.map((t) => t.id));

export function isValidAppTheme(value: unknown): value is AppThemeId {
  return typeof value === 'string' && VALID_THEME_IDS.has(value as AppThemeId);
}

export function getThemeOption(id: AppThemeId): AppThemeOption {
  return APP_THEMES.find((t) => t.id === id) || APP_THEMES[0];
}

export function loadStoredTheme(): AppThemeId {
  if (typeof window === 'undefined') return 'emerald';
  try {
    const raw = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (isValidAppTheme(raw)) return raw;
  } catch {
    // Abaikan jika storage tidak tersedia
  }
  return 'emerald';
}

export function applyThemeToDocument(themeId: AppThemeId): void {
  if (typeof document === 'undefined') return;
  const option = getThemeOption(themeId);
  const root = document.documentElement;
  root.setAttribute('data-theme', option.id);
  root.classList.toggle('dark', option.isDark);
  root.style.colorScheme = option.isDark ? 'dark' : 'light';

  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', option.metaThemeColor);
    }
  } catch {
    // Abaikan
  }

  try {
    if (Capacitor.isNativePlatform()) {
      void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      void StatusBar.setStyle({
        style: option.isDark ? Style.Dark : Style.Light,
      }).catch(() => {});
      void StatusBar.setBackgroundColor({
        color: option.isDark ? '#0B1410' : '#F6F3EA',
      }).catch(() => {});
    }
  } catch {
    // Abaikan pada browser web biasa
  }
}

interface ThemeContextValue {
  theme: AppThemeId;
  themeOption: AppThemeOption;
  setTheme: (next: AppThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'emerald',
  themeOption: APP_THEMES[0],
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppThemeId>(() => {
    const initial = loadStoredTheme();
    applyThemeToDocument(initial);
    return initial;
  });

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (e: StorageEvent) => {
      if (e.key === APP_THEME_STORAGE_KEY && isValidAppTheme(e.newValue)) {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setTheme = useCallback((next: AppThemeId) => {
    const safeNext: AppThemeId = isValidAppTheme(next) ? next : 'emerald';
    setThemeState(safeNext);
    applyThemeToDocument(safeNext);
    try {
      window.localStorage.setItem(APP_THEME_STORAGE_KEY, safeNext);
    } catch {
      // Abaikan jika penyimpanan lokal dibatasi
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeOption: getThemeOption(theme),
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
