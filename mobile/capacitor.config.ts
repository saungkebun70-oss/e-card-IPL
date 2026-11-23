interface CapacitorServerConfig {
  url?: string;
  androidScheme?: string;
  iosScheme?: string;
  allowNavigation?: string[];
  cleartext?: boolean;
  errorPath?: string;
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
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
    errorPath: 'index.html',
    allowNavigation: ['e-card-ipl.vercel.app', '*.supabase.co'],
  },
  android: {
    backgroundColor: '#FFFFFF',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#FFFFFF',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#FFFFFF',
    },
    LocalNotifications: {
      iconColor: '#059669',
      sound: 'default',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
