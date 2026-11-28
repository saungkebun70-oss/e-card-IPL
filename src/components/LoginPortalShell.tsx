import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, DownloadCloud, FlaskConical, Loader2, RefreshCw } from 'lucide-react';
import { type SessionUser } from '../types';
import { useAppBrand } from '../lib/brandContext';
import { useAppUpdate } from '../lib/appUpdate';
import { useSimulation } from '../lib/simulationContext';
import { BrandLogo } from './BrandLogo';
import { WargaLoginPage } from './WargaLoginPage';
import { AdminLoginPage } from './AdminLoginPage';
import { PetugasLoginPage } from './PetugasLoginPage';
import { SimulationRoleModal } from './SimulationRoleModal';
import bgLoginAsset from '../assets/bg-login.jpg';

export type LoginPortalRoute = 'warga' | 'admin' | 'petugas';

interface LoginPortalShellProps {
  portalRoute: LoginPortalRoute;
  onLoginSuccess: (session: SessionUser) => void;
  onSimulationLogin?: (session: SessionUser) => void;
  onSwitchPortal: (route: LoginPortalRoute) => void;
}

const ROLE_SWITCH_ITEMS: ReadonlyArray<{
  route: LoginPortalRoute;
  label: string;
}> = [
  { route: 'warga', label: 'Warga' },
  { route: 'admin', label: 'Admin / Pengurus' },
  { route: 'petugas', label: 'Keamanan' },
];

const FLIP_LOCK_DURATION_MS = 380;

export function LoginPortalShell({
  portalRoute,
  onLoginSuccess,
  onSimulationLogin,
  onSwitchPortal,
}: LoginPortalShellProps) {
  const { brand } = useAppBrand();
  const { simEnabled } = useSimulation();
  const [simModalOpen, setSimModalOpen] = useState(false);
  const { currentVersion, updateAvailable, checking, updating, checkForUpdate, applyUpdate } =
    useAppUpdate();
  const [updateFeedback, setUpdateFeedback] = useState<string | null>(null);

  const [flipDirection, setFlipDirection] = useState<'left' | 'right'>('right');
  const [hasFlippedOnce, setHasFlippedOnce] = useState(false);

  const prevRouteRef = useRef<LoginPortalRoute>(portalRoute);
  const isFlipLockedRef = useRef(false);
  const flipTimerRef = useRef<number | null>(null);

  const activeIndex = Math.max(
    0,
    ROLE_SWITCH_ITEMS.findIndex((item) => item.route === portalRoute)
  );

  // Sinkronkan arah putar 3D jika portalRoute berubah dari luar (misal popstate / hash / link langsung)
  useEffect(() => {
    const prevRoute = prevRouteRef.current;
    if (prevRoute !== portalRoute) {
      const prevIdx = ROLE_SWITCH_ITEMS.findIndex((item) => item.route === prevRoute);
      const nextIdx = ROLE_SWITCH_ITEMS.findIndex((item) => item.route === portalRoute);
      setFlipDirection(nextIdx >= prevIdx ? 'right' : 'left');
      setHasFlippedOnce(true);
      prevRouteRef.current = portalRoute;
    }
  }, [portalRoute]);

  useEffect(() => {
    return () => {
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
      }
    };
  }, []);

  const handleRoleSwitch = useCallback(
    (targetRoute: LoginPortalRoute) => {
      if (targetRoute === portalRoute || isFlipLockedRef.current) return;

      const currentIdx = ROLE_SWITCH_ITEMS.findIndex((item) => item.route === portalRoute);
      const nextIdx = ROLE_SWITCH_ITEMS.findIndex((item) => item.route === targetRoute);

      setFlipDirection(nextIdx >= currentIdx ? 'right' : 'left');
      setHasFlippedOnce(true);

      isFlipLockedRef.current = true;
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
      }
      flipTimerRef.current = window.setTimeout(() => {
        isFlipLockedRef.current = false;
        flipTimerRef.current = null;
      }, FLIP_LOCK_DURATION_MS);

      prevRouteRef.current = targetRoute;
      onSwitchPortal(targetRoute);
    },
    [onSwitchPortal, portalRoute]
  );

  const handleManualUpdateCheck = async () => {
    setUpdateFeedback(null);
    if (updateAvailable) {
      await applyUpdate();
      return;
    }
    const status = await checkForUpdate({ manual: true });
    if (status === 'up_to_date') {
      setUpdateFeedback('Sudah versi terbaru');
      window.setTimeout(() => setUpdateFeedback(null), 3200);
    } else if (status === 'offline') {
      setUpdateFeedback('Offline');
      window.setTimeout(() => setUpdateFeedback(null), 3200);
    } else if (status === 'error') {
      setUpdateFeedback('Gagal cek');
      window.setTimeout(() => setUpdateFeedback(null), 3200);
    }
  };

  const kopResmiText =
    brand?.kop_resmi ||
    'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)';

  const flipAnimationClass = hasFlippedOnce
    ? flipDirection === 'right'
      ? 'animate-glass-flip-right'
      : 'animate-glass-flip-left'
    : 'animate-page-enter';

  return (
    <div className="relative isolate z-0 min-h-[100dvh] w-full flex flex-col justify-between overflow-x-clip bg-[#162619] text-[#FFFDF8]">
      {/* Layer Background Fasad Rumah Terkunci GPU (Anti-Flicker untuk backdrop-blur kartu kaca) */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          transform: 'translate3d(0, 0, 0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          willChange: 'transform',
        }}
      >
        <img
          src={bgLoginAsset}
          alt=""
          className="w-full h-full object-cover object-center"
          style={{
            transform: 'translate3d(0, 0, 0)',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
        />
        <div
          className="absolute inset-0 bg-[#162619]/35"
          style={{
            transform: 'translate3d(0, 0, 0)',
          }}
        />
        <div
          className="absolute inset-0 bg-gradient-to-b from-[#162619]/75 via-[#162619]/45 to-[#162619]/90"
          style={{
            transform: 'translate3d(0, 0, 0)',
          }}
        />
      </div>

      {/* Bar Atas Persisten */}
      <header className="relative z-10 w-full max-w-lg mx-auto px-4 sm:px-6 pt-[calc(max(env(safe-area-inset-top,0px),14px)+0.5rem)] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <BrandLogo size="sm" variant="dark" className="shrink-0" />
          <span className="font-serif-brand text-xl font-bold tracking-tight text-[#FFFDF8] truncate drop-shadow-xs">
            Saung Kebun
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={checking || updating}
            onClick={() => void handleManualUpdateCheck()}
            className="min-h-[36px] px-3.5 rounded-full bg-[#FFFDF8]/88 hover:bg-[#FFFDF8] backdrop-blur-md border border-white/40 text-[#243825] text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer whitespace-nowrap"
          >
            {checking || updating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : updateAvailable ? (
              <DownloadCloud className="w-3.5 h-3.5 text-[#2B3F29]" />
            ) : updateFeedback ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-[#2B3F29]" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 text-[#2B3F29]" />
            )}
            <span>
              {updating
                ? 'Memuat...'
                : updateAvailable
                  ? 'Update'
                  : updateFeedback || 'Cek Update'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => void handleManualUpdateCheck()}
            aria-label="Status pembaruan aplikasi"
            title={`Versi v${currentVersion}`}
            className="relative h-9 w-9 rounded-full bg-[#FFFDF8]/88 hover:bg-[#FFFDF8] backdrop-blur-md border border-white/40 text-[#243825] flex items-center justify-center shadow-sm transition active:scale-95 cursor-pointer"
          >
            <Bell className="w-4 h-4 text-[#243825]" />
            {updateAvailable && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#C87058]" />
            )}
          </button>
        </div>
      </header>

      {/* Konten Utama Login dengan Stabilitas Tinggi + Animasi 3D Glass Card Flip */}
      <main className="relative z-10 w-full max-w-md mx-auto px-4 sm:px-6 py-4 flex-1 flex flex-col justify-center">
        <div
          className="grid min-h-[430px] sm:min-h-[448px] items-center transition-[min-height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
          style={{
            gridTemplateRows: '1fr',
          }}
        >
          <div
            key={portalRoute}
            className={`w-full transform-gpu will-change-[transform,opacity] ${flipAnimationClass}`}
          >
            {portalRoute === 'admin' ? (
              <AdminLoginPage
                embeddedInShell
                onLoginSuccess={onLoginSuccess}
                onSwitchPortal={handleRoleSwitch}
              />
            ) : portalRoute === 'petugas' ? (
              <PetugasLoginPage
                embeddedInShell
                onLoginSuccess={onLoginSuccess}
                onSwitchPortal={handleRoleSwitch}
              />
            ) : (
              <WargaLoginPage
                embeddedInShell
                onLoginSuccess={onLoginSuccess}
                onSwitchPortal={handleRoleSwitch}
              />
            )}
          </div>
        </div>
      </main>

      {/* Switcher Bawah 3 Peran dengan Kapsul Meluncur Halus */}
      <footer className="relative z-10 w-full max-w-md mx-auto px-4 sm:px-6 pb-[calc(max(env(safe-area-inset-bottom,0px),14px)+0.5rem)] space-y-3 text-center">
        {simEnabled && (
          <div className="w-full max-w-[380px] mx-auto">
            <button
              type="button"
              onClick={() => setSimModalOpen(true)}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-2xl bg-[#E5EEE3]/18 hover:bg-[#E5EEE3]/28 backdrop-blur-md border border-[#E5EEE3]/40 text-[#FFFDF8] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 shadow-lg transition active:scale-[0.98] cursor-pointer"
            >
              <FlaskConical className="w-4 h-4 text-[#C6E8BC] shrink-0" />
              <span>Coba Mode Simulasi (Demo Tanpa Database)</span>
            </button>
          </div>
        )}

        <nav
          aria-label="Pilih Portal Masuk"
          className="relative grid grid-cols-3 p-1 w-full max-w-[380px] mx-auto rounded-full bg-[#FFFDF8]/90 backdrop-blur-md border border-white/40 shadow-lg"
        >
          {/* Indikator Kapsul Aktif Meluncur 60fps */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 bottom-1 left-1 rounded-full bg-[#2B3F29] shadow-sm motion-reduce:transition-none"
            style={{
              width: 'calc((100% - 8px) / 3)',
              transform: `translate3d(${activeIndex * 100}%, 0, 0)`,
              transition: 'transform 380ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: 'transform',
            }}
          />

          {ROLE_SWITCH_ITEMS.map((item) => {
            const isActive = item.route === portalRoute;
            return (
              <button
                key={item.route}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleRoleSwitch(item.route)}
                className={`relative z-10 min-h-[40px] px-1.5 rounded-full text-[11px] sm:text-xs font-bold whitespace-nowrap transition-colors duration-200 cursor-pointer flex items-center justify-center ${
                  isActive
                    ? 'text-[#FFFDF8]'
                    : 'text-[#243825] hover:text-[#162619]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <p className="text-[10.5px] text-[#E5EEE3]/75 leading-relaxed line-clamp-2">
          {kopResmiText} · v{currentVersion}
        </p>
      </footer>

      <SimulationRoleModal
        open={simModalOpen}
        onClose={() => setSimModalOpen(false)}
        onSelectSession={(simSession) => {
          if (onSimulationLogin) {
            onSimulationLogin(simSession);
          } else {
            onLoginSuccess(simSession);
          }
        }}
      />
    </div>
  );
}
