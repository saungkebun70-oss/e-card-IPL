interface CapacitorServerConfig {
  url?: string;
  androidScheme?: string;
  iosScheme?: string;
  allowNavigation?: string[];
  cleartext?: boolean;
}

interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: CapacitorServerConfig;
  android?: {
    allowMixedContent?: boolean;
    backgroundColor?: string;
  };
  ios?: {
    contentInset?: 'automatic' | 'scrollableAxes' | 'never' | 'always';
    backgroundColor?: string;
  };
  plugins?: Record<string, Record<string, unknown>>;
}

const config: CapacitorConfig = {
  appId: 'com.saungkebun.ecardipl',
  appName: 'e-Card IPL Saung Kebun',
  webDir: 'www',
  server: {
    url: 'https://e-card-ipl.vercel.app',
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: ['e-card-ipl.vercel.app', '*.supabase.co'],
  },
  android: {
    backgroundColor: '#0F172A',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0F172A',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#0F172A',
    },
  },
};

export default config;
