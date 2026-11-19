import { useCallback, useEffect, useState } from 'react';
import {
  CreditCard,
  Upload,
  ReceiptText,
  Building2,
  UserCircle2,
  LayoutDashboard,
  Users,
  Bot,
  TableProperties,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import {
  type PaymentConfig,
  type SessionUser,
  type StatusEcardBulanan,
  type SystemNotification,
  type TransaksiIPL,
  type Warga,
} from './types';
import {
  clearStoredSession,
  fetchAdminSnapshot,
  fetchWargaOwnData,
  loadStoredSession,
  type AdminSnapshot,
} from './lib/dataService';
import { WargaLoginPage } from './components/WargaLoginPage';
import { AdminLoginPage } from './components/AdminLoginPage';
import { AppShell, type NavItem } from './components/AppShell';
import { ToastContainer, type ToastMessage } from './components/Toast';
import { WargaHomeSlide } from './components/warga/WargaHomeSlide';
import { WargaSetorSlide } from './components/warga/WargaSetorSlide';
import { WargaRiwayatSlide } from './components/warga/WargaRiwayatSlide';
import { ProfilLingkungan } from './components/warga/ProfilLingkungan';
import { WargaProfilSlide } from './components/warga/WargaProfilSlide';
import { AdminDashboardSlide } from './components/admin/AdminDashboardSlide';
import { AdminWargaSlide } from './components/admin/AdminWargaSlide';
import { AdminBotWaSlide } from './components/admin/AdminBotWaSlide';
import { AdminRekapSlide } from './components/admin/AdminRekapSlide';

type PortalRoute = 'warga' | 'admin';

function resolvePortalRouteFromPath(pathname: string): PortalRoute {
  const clean = pathname.trim().toLowerCase();
  return clean === '/admin' || clean.startsWith('/admin/') ? 'admin' : 'warga';
}

export default function App() {
  const [portalRoute, setPortalRoute] = useState<PortalRoute>(() =>
    typeof window !== 'undefined' ? resolvePortalRouteFromPath(window.location.pathname) : 'warga'
  );
  const [session, setSession] = useState<SessionUser | null>(() => {
    const initialRoute =
      typeof window !== 'undefined' ? resolvePortalRouteFromPath(window.location.pathname) : 'warga';
    return loadStoredSession(initialRoute);
  });
  const [activeTab, setActiveTab] = useState<string>('beranda');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // State Portal Warga (terisolasi 1 rumah)
  const [wargaData, setWargaData] = useState<{
    profil: Warga;
    statusBulanan: StatusEcardBulanan[];
    riwayat: TransaksiIPL[];
    notifications: SystemNotification[];
    paymentConfig: PaymentConfig;
  } | null>(null);
  const [preselectedMonth, setPreselectedMonth] = useState<number | null>(null);
  const [preselectedPetugas, setPreselectedPetugas] = useState<string | null>(null);

  // State Portal Admin
  const [adminData, setAdminData] = useState<AdminSnapshot | null>(null);

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

  const loadPortalData = useCallback(async (activeSession: SessionUser) => {
    setLoadingData(true);
    setDataError(null);
    try {
      if (activeSession.role === 'warga') {
        const res = await fetchWargaOwnData(activeSession);
        if (res.error || !res.data) {
          setDataError(res.error || 'Gagal memuat data rumah Anda.');
        } else {
          setWargaData(res.data);
        }
      } else {
        const res = await fetchAdminSnapshot(activeSession);
        if (res.error || !res.data) {
          setDataError(res.error || 'Gagal memuat data Pengurus.');
        } else {
          setAdminData(res.data);
        }
      }
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = resolvePortalRouteFromPath(window.location.pathname);
      setPortalRoute(nextRoute);
      setSession(loadStoredSession(nextRoute));
      setWargaData(null);
      setAdminData(null);
      setDataError(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!session || session.role !== portalRoute) return;
    setActiveTab(session.role === 'admin' ? 'dashboard' : 'beranda');
    void loadPortalData(session);
  }, [session, portalRoute, loadPortalData]);

  const handleLoginSuccess = (newSession: SessionUser) => {
    if (newSession.role !== portalRoute) return;
    setSession(newSession);
    pushToast(
      'success',
      newSession.role === 'admin'
        ? `Selamat datang, ${newSession.nama_warga} (${newSession.jabatan || 'Pengurus'} — ${
            newSession.admin_permission === 'full' ? 'Akses Penuh' : 'Akses Tambah Data'
          }).`
        : `Selamat datang, ${newSession.nama_warga} (Blok ${newSession.blok_rumah}).`
    );
  };

  const handleLogout = () => {
    clearStoredSession(session, portalRoute);
    setSession(null);
    setWargaData(null);
    setAdminData(null);
    setDataError(null);
    pushToast('info', 'Anda telah keluar dari sesi portal.');
  };

  if (!session || session.role !== portalRoute) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        {portalRoute === 'admin' ? (
          <AdminLoginPage onLoginSuccess={handleLoginSuccess} />
        ) : (
          <WargaLoginPage onLoginSuccess={handleLoginSuccess} />
        )}
      </>
    );
  }

  // Konfigurasi Navigasi 4 Slide untuk Warga & 4 Slide untuk Admin
  const pendingCount =
    adminData?.transaksiList.filter((t) => t.status_verifikasi === 'Pending').length || 0;

  const navItems: NavItem[] =
    session.role === 'warga'
      ? [
          { id: 'beranda', label: 'Beranda & e-Card', shortLabel: 'e-Card', icon: CreditCard },
          { id: 'setor', label: 'Setor Iuran', shortLabel: 'Setor', icon: Upload },
          { id: 'riwayat', label: 'Riwayat & Kwitansi', shortLabel: 'Riwayat', icon: ReceiptText },
          { id: 'lingkungan', label: 'Profil Lingkungan', shortLabel: 'Lingkungan', icon: Building2 },
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
          { id: 'bot', label: 'Bot WhatsApp', shortLabel: 'Bot WA', icon: Bot },
          { id: 'rekap', label: 'Rekap & Laporan', shortLabel: 'Rekap', icon: TableProperties },
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
        <div className="space-y-4">
          <div className="h-56 rounded-2xl bg-slate-200/70 animate-pulse" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="h-28 rounded-2xl bg-slate-200/70 animate-pulse" />
            <div className="h-28 rounded-2xl bg-slate-200/70 animate-pulse" />
            <div className="h-28 rounded-2xl bg-slate-200/70 animate-pulse" />
            <div className="h-28 rounded-2xl bg-slate-200/70 animate-pulse" />
          </div>
        </div>
      );
    }

    if (session.role === 'warga' && wargaData) {
      switch (activeTab) {
        case 'beranda':
          return (
            <WargaHomeSlide
              profil={wargaData.profil}
              statusBulanan={wargaData.statusBulanan}
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
              profil={wargaData.profil}
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
              statusList={adminData.statusList}
              notifications={adminData.notifications}
              paymentConfig={adminData.paymentConfig}
              onRefresh={() => loadPortalData(session)}
              onToast={pushToast}
            />
          );
        case 'warga':
          return (
            <AdminWargaSlide
              session={session}
              wargaList={adminData.wargaList}
              onRefresh={() => loadPortalData(session)}
              onToast={pushToast}
            />
          );
        case 'bot':
          return (
            <AdminBotWaSlide
              session={session}
              botConfig={adminData.botConfig}
              botLogs={adminData.botLogs}
              wargaList={adminData.wargaList}
              statusList={adminData.statusList}
              paymentConfig={adminData.paymentConfig}
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
              onRefresh={() => loadPortalData(session)}
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
      <AppShell
        session={session}
        navItems={navItems}
        activeTab={activeTab}
        onTabChange={setActiveTab}
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
    </>
  );
}
