import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CreditCard,
  Upload,
  ReceiptText,
  Building2,
  UserCircle2,
  LayoutDashboard,
  Users,
  Plus,
  TableProperties,
  AlertCircle,
  RefreshCw,
  Shield,
} from 'lucide-react';
import {
  isKetuaRole,
  type LogPatroli,
  type PatrolMapConfig,
  type PaymentConfig,
  type PetugasKontakDarurat,
  type SessionUser,
  type StatusEcardBulanan,
  type SystemNotification,
  type TitikPatroli,
  type TransaksiIPL,
  type Warga,
} from './types';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  clearStoredSession,
  fetchAdminSnapshot,
  fetchWargaOwnData,
  loadLastActiveSession,
  loadStoredSession,
  saveStoredSession,
  subscribeAdminRealtime,
  subscribePatroliRealtime,
  type AdminSnapshot,
} from './lib/dataService';
import { WargaLoginPage } from './components/WargaLoginPage';
import { AdminLoginPage } from './components/AdminLoginPage';
import { PetugasLoginPage } from './components/PetugasLoginPage';
import { PetugasPortalPage } from './components/petugas/PetugasPortalPage';
import { AppShell, type NavItem } from './components/AppShell';
import { ToastContainer, type ToastMessage } from './components/Toast';
import { WargaHomeSlide } from './components/warga/WargaHomeSlide';
import { WargaSetorSlide } from './components/warga/WargaSetorSlide';
import { WargaRiwayatSlide } from './components/warga/WargaRiwayatSlide';
import { ProfilLingkungan } from './components/warga/ProfilLingkungan';
import { WargaProfilSlide } from './components/warga/WargaProfilSlide';
import { AdminDashboardSlide } from './components/admin/AdminDashboardSlide';
import { AdminWargaSlide } from './components/admin/AdminWargaSlide';
import { AdminKeuanganSlide } from './components/admin/AdminKeuanganSlide';
import { AdminRekapSlide } from './components/admin/AdminRekapSlide';
import { AdminLpjSlide } from './components/admin/AdminLpjSlide';
import {
  AdminSettingsDrawer,
  type SettingsDrawerTab,
} from './components/admin/AdminSettingsDrawer';
import { KeamananSlide } from './components/KeamananSlide';
import { ContentLoadingState, LoadingOverlay } from './components/LoadingSpinner';
import {
  initNativeNotificationsOnLaunch,
  initNotificationAudioUnlock,
  removeCurrentDevicePushToken,
  subscribeForegroundPushToast,
} from './lib/notificationAlertService';

type PortalRoute = 'warga' | 'admin' | 'petugas';

interface WargaPortalData {
  profil: Warga;
  statusBulanan: StatusEcardBulanan[];
  riwayat: TransaksiIPL[];
  notifications: SystemNotification[];
  paymentConfig: PaymentConfig;
  petugasKontak: PetugasKontakDarurat[];
  patroliFeed: LogPatroli[];
  titikPatroli: TitikPatroli[];
  patrolMapConfig?: PatrolMapConfig;
}

const REALTIME_DEBOUNCE_MS = 2000;
const REALTIME_THROTTLE_MS = 2000;
const REALTIME_MAX_WAIT_MS = 5000;

/**
 * Menghasilkan sidik jari ringkas (O(n)) dari data Admin agar pembaruan state
 * hanya dipicu saat terdapat perubahan data yang signifikan.
 */
function computeAdminSnapshotFingerprint(data: AdminSnapshot): string {
  const wargaSig = `${data.wargaList.length}:${data.wargaList
    .map((w) => `${w.id}|${w.blok_rumah}|${w.aktif ? 1 : 0}|${w.nominal_iuran}|${w.status_hunian}|${w.avatar_url || ''}`)
    .join(',')}`;
  const trxSig = `${data.transaksiList.length}:${data.transaksiList
    .map((t) => `${t.id}|${t.status_verifikasi}|${t.nominal}|${t.verified_at || ''}`)
    .join(',')}`;
  const kasSig = `${data.transaksiKasList.length}:${data.transaksiKasList
    .map((k) => `${k.id}|${k.status_verifikasi || ''}|${k.nominal}|${k.tanggal}`)
    .join(',')}`;
  const statusSig = `${data.statusList.length}:${data.statusList
    .map((s) => `${s.blok_rumah}|${s.tahun}|${s.bulan}|${s.status}`)
    .join(',')}`;
  const patroliSig = `${data.patroliFeed.length}:${data.patroliFeed
    .slice(0, 60)
    .map((p) => `${p.id}|${p.waktu_scan}|${p.status_kondisi}|${p.catatan || ''}`)
    .join(',')}`;
  const titikSig = `${data.titikPatroliList.length}:${data.titikPatroliList
    .map((t) => `${t.id}|${t.aktif ? 1 : 0}|${t.x_percent ?? ''}|${t.y_percent ?? ''}|${t.nama_lokasi}`)
    .join(',')}`;
  const petugasSig = `${data.petugasList.length}:${data.petugasList
    .map((p) => `${p.id}|${p.aktif ? 1 : 0}|${p.shift}|${p.nama}|${p.avatar_url || ''}`)
    .join(',')}`;
  const notifSig = `${data.notifications.length}:${data.notifications
    .slice(0, 20)
    .map((n) => n.id)
    .join(',')}`;
  const botLogSig = `${data.botLogs.length}:${data.botLogs[0]?.id || ''}`;
  const mapSig = `${data.patrolMapConfig?.updated_at || ''}|${data.patrolMapConfig?.cycle_reset_at || ''}|${data.patrolMapConfig?.map_image_url?.length || 0}`;
  const paySig = `${data.paymentConfig.updated_at}|${data.paymentConfig.qris_aktif ? 1 : 0}|${data.paymentConfig.rekening_list.length}`;
  const botSig = `${data.botConfig.aktif ? 1 : 0}|${data.botConfig.updated_at}`;

  return [
    wargaSig,
    trxSig,
    kasSig,
    statusSig,
    patroliSig,
    titikSig,
    petugasSig,
    notifSig,
    botLogSig,
    mapSig,
    paySig,
    botSig,
  ].join('#');
}

/**
 * Menghasilkan sidik jari ringkas (O(n)) dari data Warga agar state tidak
 * diperbarui ulang apabila tidak ada perubahan signifikan pada data rumah/patroli.
 */
function computeWargaDataFingerprint(data: WargaPortalData): string {
  const profilSig = `${data.profil.id}|${data.profil.nama_warga}|${data.profil.blok_rumah}|${data.profil.aktif ? 1 : 0}|${data.profil.nominal_iuran}|${data.profil.status_hunian}|${data.profil.avatar_url || ''}`;
  const statusSig = `${data.statusBulanan.length}:${data.statusBulanan
    .map((s) => `${s.tahun}|${s.bulan}|${s.status}`)
    .join(',')}`;
  const riwayatSig = `${data.riwayat.length}:${data.riwayat
    .map((r) => `${r.id}|${r.status_verifikasi}|${r.nominal}|${r.verified_at || ''}`)
    .join(',')}`;
  const patroliSig = `${data.patroliFeed.length}:${data.patroliFeed
    .slice(0, 60)
    .map((p) => `${p.id}|${p.waktu_scan}|${p.status_kondisi}|${p.catatan || ''}`)
    .join(',')}`;
  const titikSig = `${data.titikPatroli.length}:${data.titikPatroli
    .map((t) => `${t.id}|${t.aktif ? 1 : 0}|${t.x_percent ?? ''}|${t.y_percent ?? ''}|${t.nama_lokasi}`)
    .join(',')}`;
  const notifSig = `${data.notifications.length}:${data.notifications
    .slice(0, 20)
    .map((n) => n.id)
    .join(',')}`;
  const mapSig = `${data.patrolMapConfig?.updated_at || ''}|${data.patrolMapConfig?.cycle_reset_at || ''}|${data.patrolMapConfig?.map_image_url?.length || 0}`;
  const kontakSig = `${data.petugasKontak.length}:${data.petugasKontak
    .map((k) => `${k.id}|${k.shift}|${k.no_hp}`)
    .join(',')}`;

  return [profilSig, statusSig, riwayatSig, patroliSig, titikSig, notifSig, mapSig, kontakSig].join(
    '#'
  );
}

interface CapacitorAppBridge {
  addListener(
    eventName: 'backButton',
    listenerFunc: (event: { canGoBack: boolean }) => void
  ): Promise<{ remove: () => Promise<void> }>;
  minimizeApp?: () => Promise<void>;
}

const NativeAppPlugin = registerPlugin<CapacitorAppBridge>('App');
const BACK_OVERLAY_EVENT = 'ecard-handle-back-overlay';

function getPathForPortalRoute(route: PortalRoute): string {
  if (route === 'admin') return '/admin';
  if (route === 'petugas') return '/petugas';
  return '/';
}

function resolvePortalRouteFromPath(pathname: string): PortalRoute {
  const clean = pathname.trim().toLowerCase();
  if (clean === '/admin' || clean.startsWith('/admin/')) return 'admin';
  if (
    clean === '/petugas' ||
    clean.startsWith('/petugas/') ||
    clean === '/keamanan' ||
    clean.startsWith('/keamanan/')
  ) {
    return 'petugas';
  }
  return 'warga';
}

function resolveInitialPortalAndSession(): { route: PortalRoute; session: SessionUser | null } {
  if (typeof window === 'undefined') {
    return { route: 'warga', session: null };
  }
  const pathname = window.location.pathname || '/';
  const pathRoute = resolvePortalRouteFromPath(pathname);
  const directSession = loadStoredSession(pathRoute);
  if (directSession) {
    return { route: pathRoute, session: directSession };
  }

  // Saat membuka ulang aplikasi / APK atau kembali ke URL utama (/),
  // pulihkan otomatis sesi akun terakhir yang masih aktif (Warga / Pengurus / Petugas)
  // agar tidak langsung keluar login sebelum tombol Keluar ditekan.
  const isRootEntry = pathname === '/' || pathname === '' || pathname === '/index.html';
  if (isRootEntry) {
    const lastActive = loadLastActiveSession();
    if (lastActive) {
      const targetPath = getPathForPortalRoute(lastActive.role);
      if (window.location.pathname !== targetPath) {
        window.history.replaceState({ ecardSessionGuard: true, route: lastActive.role }, '', targetPath);
      }
      return { route: lastActive.role, session: lastActive };
    }
  }

  return { route: pathRoute, session: null };
}

export default function App() {
  const initialAuthRef = useRef<{ route: PortalRoute; session: SessionUser | null } | null>(null);
  if (initialAuthRef.current === null) {
    initialAuthRef.current = resolveInitialPortalAndSession();
  }

  const [portalRoute, setPortalRoute] = useState<PortalRoute>(initialAuthRef.current.route);
  const [session, setSession] = useState<SessionUser | null>(initialAuthRef.current.session);
  const [activeTab, setActiveTab] = useState<string>(() =>
    initialAuthRef.current?.session?.role === 'admin' ? 'dashboard' : 'beranda'
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsDrawerTab>('identitas');
  const settingsOpenRef = useRef(false);
  const sessionRef = useRef<SessionUser | null>(session);
  const portalRouteRef = useRef<PortalRoute>(portalRoute);
  const activeTabRef = useRef<string>(activeTab);
  const lastHomeBackNoticeRef = useRef<number>(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    settingsOpenRef.current = settingsOpen;
  }, [settingsOpen]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    portalRouteRef.current = portalRoute;
  }, [portalRoute]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // State Portal Warga (terisolasi 1 rumah)
  const [wargaData, setWargaData] = useState<WargaPortalData | null>(null);
  const [preselectedMonth, setPreselectedMonth] = useState<number | null>(null);
  const [preselectedPetugas, setPreselectedPetugas] = useState<string | null>(null);

  // State Portal Admin
  const [adminData, setAdminData] = useState<AdminSnapshot | null>(null);

  // Sidik jari snapshot terakhir untuk menghindari pembaruan state yang tidak signifikan
  const lastAdminFingerprintRef = useRef<string | null>(null);
  const lastWargaFingerprintRef = useRef<string | null>(null);
  const syncInFlightRef = useRef<boolean>(false);

  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const pushToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const loadPortalData = useCallback(
    async (activeSession: SessionUser, options?: { silent?: boolean; force?: boolean }) => {
      const silent = Boolean(options?.silent);
      const force = Boolean(options?.force);

      // Cegah fetch silent bertumpuk saat sinkronisasi sebelumnya masih berjalan
      if (silent && syncInFlightRef.current) {
        return;
      }

      if (!silent) {
        setLoadingData(true);
        setDataError(null);
      }

      syncInFlightRef.current = true;
      try {
        if (activeSession.role === 'petugas') {
          return;
        }
        if (activeSession.role === 'warga') {
          const res = await fetchWargaOwnData(activeSession);
          if (res.error || !res.data) {
            if (!silent) setDataError(res.error || 'Gagal memuat data rumah Anda.');
          } else {
            const nextFingerprint = computeWargaDataFingerprint(res.data);
            if (force || !silent || nextFingerprint !== lastWargaFingerprintRef.current) {
              lastWargaFingerprintRef.current = nextFingerprint;
              setWargaData(res.data);
            }
            setDataError(null);
          }
        } else {
          const res = await fetchAdminSnapshot(activeSession);
          if (res.error || !res.data) {
            if (!silent) setDataError(res.error || 'Gagal memuat data Pengurus.');
          } else {
            const nextFingerprint = computeAdminSnapshotFingerprint(res.data);
            if (force || !silent || nextFingerprint !== lastAdminFingerprintRef.current) {
              lastAdminFingerprintRef.current = nextFingerprint;
              setAdminData(res.data);
            }
            setDataError(null);
          }
        }
      } finally {
        syncInFlightRef.current = false;
        if (!silent) setLoadingData(false);
      }
    },
    []
  );

  const handleInAppBackAction = useCallback(
    (source: 'popstate' | 'native') => {
      const currentSession = sessionRef.current;
      const currentRoute = portalRouteRef.current;

      // Jika belum login, biarkan navigasi standar antar halaman login berjalan
      if (!currentSession || currentSession.role !== currentRoute) {
        if (source === 'popstate' && typeof window !== 'undefined') {
          const nextRoute = resolvePortalRouteFromPath(window.location.pathname);
          setPortalRoute(nextRoute);
          setSession(loadStoredSession(nextRoute));
          setSettingsOpen(false);
          lastAdminFingerprintRef.current = null;
          lastWargaFingerprintRef.current = null;
          setWargaData(null);
          setAdminData(null);
          setDataError(null);
        }
        return;
      }

      // Saat sedang login: JANGAN PERNAH keluar dari login atau berpindah ke halaman login!
      // Jika dipicu oleh tombol Back browser/WebView (popstate), pasang ulang entri guard history.
      if (source === 'popstate' && typeof window !== 'undefined') {
        const activePath = getPathForPortalRoute(currentRoute);
        window.history.pushState(
          { ecardSessionGuard: true, route: currentRoute },
          '',
          activePath
        );
      }

      // 1. Tutup drawer Pengaturan Admin jika sedang terbuka
      if (settingsOpenRef.current) {
        setSettingsOpen(false);
        return;
      }

      // 2. Tutup panel/drawer/modal/sub-tab aktif di AppShell, NotificationBell, atau PetugasPortalPage
      if (typeof window !== 'undefined') {
        const overlayDetail = { handled: false };
        window.dispatchEvent(new CustomEvent(BACK_OVERLAY_EVENT, { detail: overlayDetail }));
        if (overlayDetail.handled) {
          return;
        }
      }

      // 3. Jika berada di sub-tab (bukan menu utama), kembali ke menu utama portal (tetap login)
      if (currentSession.role === 'warga' && activeTabRef.current !== 'beranda') {
        setActiveTab('beranda');
        return;
      }
      if (currentSession.role === 'admin' && activeTabRef.current !== 'dashboard') {
        setActiveTab('dashboard');
        return;
      }

      // 4. Sudah berada di Menu Utama: JANGAN logout!
      // Di APK Android: tekan Back 2x cepat hanya me-minimize app ke background (login tetap tersimpan).
      // Di Browser/Web: tetap di menu utama dan beri tahu cara keluar lewat tombol Keluar / Logout.
      const now = Date.now();
      const isNativeAndroid =
        Capacitor &&
        typeof Capacitor.isNativePlatform === 'function' &&
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === 'android';

      if (isNativeAndroid && source === 'native' && now - lastHomeBackNoticeRef.current < 2500) {
        lastHomeBackNoticeRef.current = 0;
        if (typeof NativeAppPlugin.minimizeApp === 'function') {
          void NativeAppPlugin.minimizeApp().catch(() => {});
        }
        return;
      }

      if (now - lastHomeBackNoticeRef.current > 1800) {
        lastHomeBackNoticeRef.current = now;
        pushToast(
          'info',
          isNativeAndroid
            ? 'Sesi login tetap aktif. Tekan kembali lagi untuk ke layar HP, atau tekan tombol Keluar untuk logout.'
            : 'Anda sudah di menu utama. Untuk keluar dari akun, silakan tekan tombol Keluar / Logout.'
        );
      } else {
        lastHomeBackNoticeRef.current = now;
      }
    },
    [pushToast]
  );

  // Pasang entri guard history setiap kali sesi login aktif agar tombol Back HP/Browser tidak keluar login
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!session || session.role !== portalRoute) return;
    const activePath = getPathForPortalRoute(portalRoute);
    const currentState = window.history.state as { ecardSessionGuard?: boolean; route?: string } | null;
    if (!currentState?.ecardSessionGuard || currentState.route !== portalRoute || window.location.pathname !== activePath) {
      window.history.pushState({ ecardSessionGuard: true, route: portalRoute }, '', activePath);
    }
  }, [session, portalRoute]);

  // Tangkap tombol Back Browser / WebView (popstate)
  useEffect(() => {
    const handlePopState = () => {
      handleInAppBackAction('popstate');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [handleInAppBackAction]);

  // Tangkap tombol Back fisik/gestur Android pada APK Capacitor (@capacitor/app)
  useEffect(() => {
    let isNative = false;
    try {
      isNative = Boolean(
        Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()
      );
    } catch {
      isNative = false;
    }
    if (!isNative) return;

    let removed = false;
    let removeHandle: (() => Promise<void>) | null = null;

    void (async () => {
      try {
        const handle = await NativeAppPlugin.addListener('backButton', () => {
          handleInAppBackAction('native');
        });
        if (removed) {
          await handle.remove();
        } else {
          removeHandle = () => handle.remove();
        }
      } catch {
        // Abaikan jika plugin App tidak tersedia
      }
    })();

    return () => {
      removed = true;
      if (removeHandle) {
        void removeHandle().catch(() => {});
      }
    };
  }, [handleInAppBackAction]);

  // Inisialisasi audio unlock, Android Notification Channel, Service Worker Web Push & sinkronisasi FCM/APNs
  useEffect(() => {
    initNotificationAudioUnlock();
    void initNativeNotificationsOnLaunch(session);
  }, [session]);

  // Tampilkan toast in-app setiap kali push notification tiba saat aplikasi sedang dibuka (foreground)
  useEffect(() => {
    return subscribeForegroundPushToast((payload) => {
      const text = payload.body
        ? `${payload.title} — ${payload.body}`
        : payload.title;
      pushToast('info', text);
    });
  }, [pushToast]);

  useEffect(() => {
    if (!session || session.role !== portalRoute || session.role === 'petugas') return;
    lastAdminFingerprintRef.current = null;
    lastWargaFingerprintRef.current = null;
    setActiveTab(session.role === 'admin' ? 'dashboard' : 'beranda');
    void loadPortalData(session, { force: true });
  }, [session, portalRoute, loadPortalData]);

  // Sinkronisasi realtime dengan debouncing (2 detik), throttling, dan deteksi perubahan signifikan
  useEffect(() => {
    if (!session || session.role !== portalRoute || session.role === 'petugas') return;

    let debounceTimer: number | null = null;
    let throttleTimer: number | null = null;
    let maxWaitTimer: number | null = null;
    let lastSyncExecutedAt = 0;
    let disposed = false;

    const clearSyncTimers = () => {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (throttleTimer !== null) {
        window.clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      if (maxWaitTimer !== null) {
        window.clearTimeout(maxWaitTimer);
        maxWaitTimer = null;
      }
    };

    const runThrottledSync = () => {
      if (disposed) return;
      clearSyncTimers();

      if (document.visibilityState !== 'visible') return;
      if (session.role === 'admin' && settingsOpenRef.current) return;

      const now = Date.now();
      const elapsed = now - lastSyncExecutedAt;

      if (lastSyncExecutedAt > 0 && elapsed < REALTIME_THROTTLE_MS) {
        const remaining = REALTIME_THROTTLE_MS - elapsed;
        throttleTimer = window.setTimeout(() => {
          throttleTimer = null;
          runThrottledSync();
        }, remaining);
        return;
      }

      lastSyncExecutedAt = now;
      void loadPortalData(session, { silent: true });
    };

    const scheduleDebouncedSync = () => {
      if (disposed) return;
      if (document.visibilityState !== 'visible') return;
      if (session.role === 'admin' && settingsOpenRef.current) return;

      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        runThrottledSync();
      }, REALTIME_DEBOUNCE_MS);

      if (maxWaitTimer === null) {
        maxWaitTimer = window.setTimeout(() => {
          maxWaitTimer = null;
          runThrottledSync();
        }, REALTIME_MAX_WAIT_MS);
      }
    };

    const handleFocus = () => scheduleDebouncedSync();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        scheduleDebouncedSync();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    let unsubscribeRealtime = () => {};
    let intervalId: number | null = null;

    // Jeda debounce (2 detik) & throttle (2 detik) dikoordinasikan terpusat di App.tsx
    // agar event realtime, focus, dan visibility digabung tanpa double-delay.
    const passthroughOptions = {
      debounceMs: 0,
      minIntervalMs: 0,
      maxWaitMs: 0,
    };

    if (session.role === 'admin') {
      unsubscribeRealtime = subscribeAdminRealtime(
        session,
        () => {
          if (!settingsOpenRef.current) {
            scheduleDebouncedSync();
          }
        },
        passthroughOptions
      );
      intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible' && !settingsOpenRef.current) {
          runThrottledSync();
        }
      }, 20000);
    } else if (session.role === 'warga') {
      unsubscribeRealtime = subscribePatroliRealtime(
        session,
        () => {
          scheduleDebouncedSync();
        },
        passthroughOptions
      );
    }

    return () => {
      disposed = true;
      clearSyncTimers();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      unsubscribeRealtime();
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [session, portalRoute, loadPortalData]);

  const handleTabChange = useCallback(
    (nextTab: string) => {
      setActiveTab(nextTab);
      if (session && session.role === portalRoute && session.role !== 'petugas') {
        void loadPortalData(session, { silent: true });
      }
    },
    [session, portalRoute, loadPortalData]
  );

  const handleAvatarUpdated = useCallback(
    (nextAvatarUrl: string | null) => {
      setSession((prev) => {
        if (!prev) return prev;
        const updated: SessionUser = { ...prev, avatar_url: nextAvatarUrl };
        saveStoredSession(updated);
        return updated;
      });
      setWargaData((prev) =>
        prev
          ? {
              ...prev,
              profil: { ...prev.profil, avatar_url: nextAvatarUrl },
            }
          : prev
      );
      setAdminData((prev) =>
        prev && session?.role === 'admin'
          ? {
              ...prev,
              pengurusAccounts: prev.pengurusAccounts.map((acc) =>
                acc.username.toLowerCase() === session.blok_rumah.toLowerCase()
                  ? { ...acc, avatar_url: nextAvatarUrl }
                  : acc
              ),
            }
          : prev
      );
    },
    [session?.role, session?.blok_rumah]
  );

  const handleNavigateNotificationTarget = useCallback(
    (targetUrl: string) => {
      if (!targetUrl || !session) return;
      if (targetUrl.startsWith('settings:') && session.role === 'admin') {
        const sub = targetUrl.replace('settings:', '') as SettingsDrawerTab;
        const validSettingsTabs: SettingsDrawerTab[] = [
          'profil',
          'identitas',
          'pembayaran',
          'bot_wa',
          'petugas_nfc',
          'keamanan',
        ];
        setSettingsTab(validSettingsTabs.includes(sub) ? sub : 'profil');
        setSettingsOpen(true);
        return;
      }
      if (targetUrl.startsWith('tab:')) {
        const tabId = targetUrl.replace('tab:', '');
        setSettingsOpen(false);
        const wargaValid = ['beranda', 'setor', 'riwayat', 'keamanan', 'lingkungan', 'profil'];
        const adminValid = ['dashboard', 'warga', 'keuangan', 'rekap', 'keamanan', 'lpj'];
        if (session.role === 'warga' && wargaValid.includes(tabId)) {
          handleTabChange(tabId);
        } else if (session.role === 'admin' && adminValid.includes(tabId)) {
          handleTabChange(tabId);
        }
      }
    },
    [session, handleTabChange]
  );

  const handleLoginSuccess = (newSession: SessionUser) => {
    if (newSession.role !== portalRoute) return;
    saveStoredSession(newSession);
    setSession(newSession);
    if (typeof window !== 'undefined') {
      const activePath = getPathForPortalRoute(portalRoute);
      window.history.pushState({ ecardSessionGuard: true, route: portalRoute }, '', activePath);
    }
    pushToast(
      'success',
      newSession.role === 'admin'
        ? `Selamat datang, ${newSession.nama_warga} (${newSession.jabatan || 'Pengurus'} — ${
            newSession.admin_permission === 'full' ? 'Akses Penuh' : 'Akses Tambah Data'
          }).`
        : newSession.role === 'petugas'
          ? `Selamat bertugas, ${newSession.nama_warga} (${newSession.shift || 'Petugas Keamanan'}).`
          : `Selamat datang, ${newSession.nama_warga} (Blok ${newSession.blok_rumah}).`
    );
  };

  const handleLogout = () => {
    // Hapus HANYA token perangkat ini dari user_push_tokens agar perangkat lain milik akun ini tetap aktif
    void removeCurrentDevicePushToken(session);
    clearStoredSession(session, portalRoute);
    setSession(null);
    setSettingsOpen(false);
    lastAdminFingerprintRef.current = null;
    lastWargaFingerprintRef.current = null;
    setWargaData(null);
    setAdminData(null);
    setDataError(null);
    if (typeof window !== 'undefined') {
      const loginPath = getPathForPortalRoute(portalRoute);
      window.history.replaceState({}, '', loginPath);
    }
    pushToast('info', 'Anda telah keluar dari sesi portal.');
  };

  const navigatePortalRoute = useCallback((nextRoute: PortalRoute) => {
    const targetPath = getPathForPortalRoute(nextRoute);
    if (typeof window !== 'undefined' && window.location.pathname !== targetPath) {
      window.history.replaceState({}, '', targetPath);
    }
    setPortalRoute(nextRoute);
    setSession(loadStoredSession(nextRoute));
    setSettingsOpen(false);
    lastAdminFingerprintRef.current = null;
    lastWargaFingerprintRef.current = null;
    setWargaData(null);
    setAdminData(null);
    setDataError(null);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  if (!session || session.role !== portalRoute) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <div key={`login-${portalRoute}`} className="animate-page-enter">
          {portalRoute === 'admin' ? (
            <AdminLoginPage
              onLoginSuccess={handleLoginSuccess}
              onSwitchPortal={navigatePortalRoute}
            />
          ) : portalRoute === 'petugas' ? (
            <PetugasLoginPage
              onLoginSuccess={handleLoginSuccess}
              onSwitchPortal={navigatePortalRoute}
            />
          ) : (
            <WargaLoginPage
              onLoginSuccess={handleLoginSuccess}
              onSwitchPortal={navigatePortalRoute}
            />
          )}
        </div>
      </>
    );
  }

  // Isolasi Mutlak Portal Petugas Keamanan — Tanpa AppShell Admin/Warga sama sekali
  if (session.role === 'petugas') {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <div key="portal-petugas" className="animate-page-enter">
          <PetugasPortalPage
            session={session}
            onAvatarUpdated={handleAvatarUpdated}
            onLogout={handleLogout}
            onToast={pushToast}
          />
        </div>
      </>
    );
  }

  // Konfigurasi Navigasi 6 Slide Warga & 5 Menu Utama Simetris Admin (LPJ & Pengaturan di Sidebar)
  const isKetuaSession = isKetuaRole(session);
  const pendingCount = isKetuaSession
    ? (adminData?.transaksiList.filter((t) => t.status_verifikasi === 'ACC Bendahara').length ||
        0) +
      (adminData?.transaksiKasList.filter((k) => k.status_verifikasi === 'ACC Bendahara').length ||
        0)
    : (adminData?.transaksiList.filter(
        (t) => String(t.status_verifikasi || '').trim().toLowerCase() === 'pending'
      ).length || 0) +
      (adminData?.transaksiKasList.filter(
        (k) => String(k.status_verifikasi || '').trim().toLowerCase() === 'pending'
      ).length || 0);

  const navItems: NavItem[] =
    session.role === 'warga'
      ? [
          { id: 'beranda', label: 'Beranda & e-Card', shortLabel: 'e-Card', icon: CreditCard },
          { id: 'setor', label: 'Setor Iuran', shortLabel: 'Setor', icon: Upload },
          { id: 'riwayat', label: 'Riwayat & Kwitansi', shortLabel: 'Riwayat', icon: ReceiptText },
          { id: 'keamanan', label: 'Keamanan & Patroli', shortLabel: 'Keamanan', icon: Shield },
          { id: 'lingkungan', label: 'Profil Lingkungan', shortLabel: 'Info', icon: Building2 },
          { id: 'profil', label: 'Profil & Akun', shortLabel: 'Profil', icon: UserCircle2 },
        ]
      : [
          {
            id: 'dashboard',
            label: 'Dashboard & Verifikasi',
            shortLabel: 'Verifikasi',
            icon: LayoutDashboard,
            badgeCount: pendingCount,
          },
          { id: 'warga', label: 'Master Warga & PIN', shortLabel: 'Warga', icon: Users },
          {
            id: 'keuangan',
            label: 'Pengeluaran & Kas Lain',
            shortLabel: 'Kas',
            icon: Plus,
            isCenterFab: true,
          },
          { id: 'rekap', label: 'Rekapitulasi Bulanan', shortLabel: 'Rekap', icon: TableProperties },
          { id: 'keamanan', label: 'Keamanan & Patroli', shortLabel: 'Keamanan', icon: Shield },
        ];

  const renderContent = () => {
    if (dataError && !wargaData && !adminData) {
      return (
        <section className="bg-white border border-red-200 rounded-2xl p-8 text-center max-w-lg mx-auto">
          <AlertCircle className="w-10 h-10 text-red-600 mx-auto" />
          <h2 className="text-base font-bold text-[#0F172A] mt-3">Gagal Memuat Data</h2>
          <p className="text-sm text-slate-600 mt-1">{dataError}</p>
          <button
            type="button"
            onClick={() => void loadPortalData(session)}
            className="mt-5 min-h-[44px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Coba Muat Ulang</span>
          </button>
        </section>
      );
    }

    if (loadingData && !wargaData && !adminData) {
      return (
        <ContentLoadingState
          message={
            session.role === 'admin'
              ? 'Memuat Dashboard Pengurus...'
              : `Memuat Data Rumah Blok ${session.blok_rumah}...`
          }
          subMessage="Mengambil status e-Card, kas, dan aktivitas terbaru dari Supabase"
        />
      );
    }

    if (session.role === 'warga' && wargaData) {
      switch (activeTab) {
        case 'beranda':
          return (
            <WargaHomeSlide
              profil={wargaData.profil}
              statusBulanan={wargaData.statusBulanan}
              riwayat={wargaData.riwayat}
              notifications={wargaData.notifications}
              onQuickPayMonth={(bulan) => {
                setPreselectedMonth(bulan);
                setActiveTab('setor');
              }}
              onToast={pushToast}
            />
          );
        case 'setor':
          return (
            <WargaSetorSlide
              session={session}
              profil={wargaData.profil}
              statusBulanan={wargaData.statusBulanan}
              paymentConfig={wargaData.paymentConfig}
              preselectedMonth={preselectedMonth}
              onClearPreselected={() => setPreselectedMonth(null)}
              preselectedPetugas={preselectedPetugas}
              onClearPreselectedPetugas={() => setPreselectedPetugas(null)}
              onSuccessSubmit={async () => {
                await loadPortalData(session);
                setActiveTab('riwayat');
              }}
              onToast={pushToast}
            />
          );
        case 'riwayat':
          return (
            <WargaRiwayatSlide
              profil={wargaData.profil}
              riwayat={wargaData.riwayat}
              onGoToSetor={() => setActiveTab('setor')}
            />
          );
        case 'keamanan':
          return (
            <KeamananSlide
              role="warga"
              session={session}
              senderName={wargaData.profil.nama_warga}
              senderBlok={wargaData.profil.blok_rumah}
              petugasKontak={wargaData.petugasKontak}
              patroliFeed={wargaData.patroliFeed}
              titikPatroliList={wargaData.titikPatroli}
              patrolMapConfig={wargaData.patrolMapConfig}
              notifications={wargaData.notifications}
              isRefreshing={loadingData}
              onRefresh={() => loadPortalData(session)}
              onToast={pushToast}
            />
          );
        case 'lingkungan':
          return (
            <ProfilLingkungan
              profil={wargaData.profil}
              onSelectTitipPengurus={(petugasLabel) => {
                setPreselectedPetugas(petugasLabel);
                setActiveTab('setor');
                pushToast('info', `Metode Titip Pengurus diarahkan ke ${petugasLabel}.`);
              }}
              onToast={pushToast}
            />
          );
        case 'profil':
          return (
            <WargaProfilSlide
              session={session}
              profil={wargaData.profil}
              onAvatarUpdated={handleAvatarUpdated}
              onGoToBeranda={() => setActiveTab('beranda')}
              onOpenLingkungan={() => setActiveTab('lingkungan')}
              onGoToSetor={() => setActiveTab('setor')}
              onGoToRiwayat={() => setActiveTab('riwayat')}
              onToast={pushToast}
              onLogout={handleLogout}
            />
          );
        default:
          return null;
      }
    }

    if (session.role === 'admin' && adminData) {
      switch (activeTab) {
        case 'dashboard':
          return (
            <AdminDashboardSlide
              session={session}
              wargaList={adminData.wargaList}
              transaksiList={adminData.transaksiList}
              transaksiKasList={adminData.transaksiKasList}
              statusList={adminData.statusList}
              notifications={adminData.notifications}
              isRefreshing={loadingData}
              onRefresh={() => loadPortalData(session)}
              onToast={pushToast}
            />
          );
        case 'warga':
          return (
            <AdminWargaSlide
              session={session}
              wargaList={adminData.wargaList}
              botConfig={adminData.botConfig}
              onRefresh={() => loadPortalData(session)}
              onToast={pushToast}
            />
          );
        case 'keuangan':
          return (
            <AdminKeuanganSlide
              session={session}
              transaksiList={adminData.transaksiList}
              transaksiKasList={adminData.transaksiKasList}
              petugasList={adminData.petugasList}
              onRefresh={() => loadPortalData(session)}
              onToast={pushToast}
            />
          );
        case 'rekap':
          return (
            <AdminRekapSlide
              session={session}
              wargaList={adminData.wargaList}
              statusList={adminData.statusList}
              transaksiList={adminData.transaksiList}
              transaksiKasList={adminData.transaksiKasList}
              onRefresh={() => loadPortalData(session)}
              onToast={pushToast}
            />
          );
        case 'lpj':
          return (
            <AdminLpjSlide
              wargaList={adminData.wargaList}
              statusList={adminData.statusList}
              transaksiList={adminData.transaksiList}
              transaksiKasList={adminData.transaksiKasList}
              onToast={pushToast}
            />
          );
        case 'keamanan':
          return (
            <KeamananSlide
              role="admin"
              session={session}
              senderName={session.nama_warga}
              senderJabatan={session.jabatan || 'Pengurus'}
              petugasKontak={adminData.petugasList
                .filter((p) => p.aktif)
                .map(({ id, nama, no_hp, shift, avatar_url }) => ({
                  id,
                  nama,
                  no_hp,
                  shift,
                  avatar_url,
                }))}
              patroliFeed={adminData.patroliFeed}
              titikPatroliList={adminData.titikPatroliList}
              patrolMapConfig={adminData.patrolMapConfig}
              notifications={adminData.notifications}
              isRefreshing={loadingData}
              onRefresh={() => loadPortalData(session, { silent: true })}
              onOpenPetugasSettings={() => {
                setSettingsTab('petugas_nfc');
                setSettingsOpen(true);
              }}
              onToast={pushToast}
            />
          );
        default:
          return null;
      }
    }

    return null;
  };

  return (
    <>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <LoadingOverlay
        visible={loadingData && Boolean(wargaData || adminData)}
        message="Menyinkronkan data..."
        subMessage="Memperbarui informasi terbaru dari server"
      />
      <AppShell
        session={session}
        navItems={navItems}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        avatarUrl={
          session.role === 'warga'
            ? wargaData?.profil.avatar_url ?? session.avatar_url ?? null
            : session.avatar_url ?? null
        }
        onOpenProfile={() => {
          if (session.role === 'warga') {
            handleTabChange('profil');
          } else {
            setSettingsTab('profil');
            setSettingsOpen(true);
          }
        }}
        onNavigateTarget={handleNavigateNotificationTarget}
        onOpenSettings={
          session.role === 'admin'
            ? () => {
                setSettingsTab('identitas');
                setSettingsOpen(true);
              }
            : undefined
        }
        onLogout={handleLogout}
      >
        {dataError && (wargaData || adminData) && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-800"
          >
            <span>{dataError}</span>
            <button
              type="button"
              onClick={() => void loadPortalData(session)}
              className="font-semibold underline shrink-0 cursor-pointer"
            >
              Coba Lagi
            </button>
          </div>
        )}
        {renderContent()}
      </AppShell>

      {/* Drawer Pengaturan Terpusat Admin (Profil Saya, Identitas, Pembayaran, Bot WA, Petugas, Keamanan) */}
      {session.role === 'admin' && adminData && (
        <AdminSettingsDrawer
          open={settingsOpen}
          initialTab={settingsTab}
          session={session}
          paymentConfig={adminData.paymentConfig}
          botConfig={adminData.botConfig}
          botLogs={adminData.botLogs}
          wargaList={adminData.wargaList}
          pengurusAccounts={adminData.pengurusAccounts}
          statusList={adminData.statusList}
          petugasList={adminData.petugasList}
          titikPatroliList={adminData.titikPatroliList}
          patrolMapConfig={adminData.patrolMapConfig}
          onAvatarUpdated={handleAvatarUpdated}
          onClose={() => setSettingsOpen(false)}
          onRefresh={() => loadPortalData(session, { silent: true })}
          onToast={pushToast}
        />
      )}
    </>
  );
}
