import React, { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Fingerprint,
  Home,
  Loader2,
  Lock,
  ScanFace,
  Shield,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
  UserCheck,
  Radio,
  Trash2,
} from 'lucide-react';
import { type SessionUser } from '../types';
import { loginPetugasKeamanan, loginPetugasWithBiometric } from '../lib/dataService';
import {
  authenticatePetugasBiometric,
  checkPetugasBiometryAvailability,
  clearPetugasBiometricEnrollment,
  enrollPetugasBiometric,
  loadPetugasBiometricEnrollment,
  subscribeBiometryResume,
  type BiometricAvailability,
  type BiometricEnrollmentProfile,
} from '../lib/biometricAuth';
import { useAppBrand } from '../lib/brandContext';
import { BrandLogo } from './BrandLogo';
import { AppVersionFooter } from './AppUpdateSystem';
import { LoadingSpinner } from './LoadingSpinner';

interface PetugasLoginPageProps {
  onLoginSuccess: (session: SessionUser) => void;
  onSwitchPortal?: (route: 'warga' | 'admin' | 'petugas') => void;
}

export function PetugasLoginPage({ onLoginSuccess, onSwitchPortal }: PetugasLoginPageProps) {
  const { brand } = useAppBrand();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const [biometryAvailability, setBiometryAvailability] = useState<BiometricAvailability | null>(
    null
  );
  const [enrolledProfile, setEnrolledProfile] = useState<BiometricEnrollmentProfile | null>(() =>
    loadPetugasBiometricEnrollment()
  );
  const [enableBiometricAfterPin, setEnableBiometricAfterPin] = useState<boolean>(
    () => !loadPetugasBiometricEnrollment()
  );

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    const init = async () => {
      try {
        const avail = await checkPetugasBiometryAvailability();
        if (!active) return;
        setBiometryAvailability(avail);
        const stored = loadPetugasBiometricEnrollment();
        setEnrolledProfile(stored);
        if (stored?.username) {
          setUsername((prev) => prev || stored.username);
        }

        unsubscribe = await subscribeBiometryResume((nextAvail) => {
          if (!active) return;
          setBiometryAvailability(nextAvail);
        });
      } catch {
        // Biometrik opsional — abaikan jika tidak tersedia
      }
    };

    void init();
    return () => {
      active = false;
      try {
        unsubscribe();
      } catch {
        // Abaikan
      }
    };
  }, []);

  const handleBiometricLogin = async () => {
    if (!enrolledProfile || !biometryAvailability?.isAvailable) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setBiometricLoading(true);
    try {
      const authRes = await authenticatePetugasBiometric(enrolledProfile, biometryAvailability);
      if (!authRes?.ok) {
        if (authRes?.cancelled) {
          setInfoMsg('Verifikasi biometrik dibatalkan. Anda tetap bisa masuk dengan PIN 6 digit.');
        } else {
          setErrorMsg(
            authRes?.error || 'Gagal memverifikasi biometrik. Silakan masuk menggunakan PIN 6 digit.'
          );
        }
        return;
      }

      const sessionRes = await loginPetugasWithBiometric(enrolledProfile);
      if (sessionRes?.error || !sessionRes?.data) {
        const msg = sessionRes?.error || 'Akun petugas tidak aktif atau perlu verifikasi PIN ulang.';
        if (msg.toLowerCase().includes('dinonaktifkan') || msg.toLowerCase().includes('tidak ditemukan')) {
          clearPetugasBiometricEnrollment();
          setEnrolledProfile(null);
        }
        setErrorMsg(msg);
        return;
      }

      onLoginSuccess(sessionRes.data);
    } catch {
      setErrorMsg('Gagal memverifikasi biometrik. Silakan masuk menggunakan PIN 6 digit.');
    } finally {
      setBiometricLoading(false);
    }
  };

  const handleClearBiometricProfile = () => {
    clearPetugasBiometricEnrollment();
    setEnrolledProfile(null);
    setEnableBiometricAfterPin(true);
    setErrorMsg(null);
    setInfoMsg('Akses cepat biometrik di perangkat ini dihapus. Silakan masuk dengan PIN 6 digit.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const result = await loginPetugasKeamanan(username, pin);
      if (result?.error || !result?.data) {
        setErrorMsg(result?.error || 'Username petugas atau PIN 6 digit tidak sesuai.');
        return;
      }

      const loggedInSession = result.data;

      // Jika petugas lain masuk pada perangkat yang sama, bersihkan profil biometrik lama
      if (enrolledProfile && enrolledProfile.petugas_id !== loggedInSession.petugas_id) {
        clearPetugasBiometricEnrollment();
        setEnrolledProfile(null);
      }

      // Aktifkan biometrik otomatis pasca login PIN jika dicentang dan perangkat mendukung
      if (enableBiometricAfterPin && biometryAvailability?.isAvailable) {
        try {
          const enrollRes = await enrollPetugasBiometric(loggedInSession, biometryAvailability);
          if (enrollRes?.ok && enrollRes?.profile) {
            setEnrolledProfile(enrollRes.profile);
          }
        } catch {
          // Tetap lanjutkan masuk portal meskipun aktivasi biometrik dilewati
        }
      }

      onLoginSuccess(loggedInSession);
    } catch {
      setErrorMsg('Terjadi kendala koneksi saat memverifikasi akun petugas. Silakan coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const canQuickUnlock = Boolean(
    enrolledProfile &&
      biometryAvailability?.isAvailable &&
      (biometryAvailability.provider === 'capacitor' ||
        (biometryAvailability.provider === 'webauthn' && enrolledProfile.webauthn_credential_id))
  );
  const BiometricIcon = biometryAvailability?.isFace ? ScanFace : Fingerprint;
  const biometryLabel = biometryAvailability?.label || 'Sidik Jari / Face ID';

  return (
    <div className="min-h-[100dvh] w-full bg-[#F8FAFC] flex flex-col lg:flex-row overflow-y-auto overflow-x-clip touch-pan-y">
      {/* Panel Identitas Khusus Portal Petugas Keamanan (Terisolasi Penuh) */}
      <section className="shrink-0 bg-[#0F172A] text-white lg:w-[46%] xl:w-[44%] flex flex-col justify-between px-6 pb-6 sm:px-10 sm:pb-10 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1.5rem)] lg:p-14 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-600/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 bg-[#059669]"
        />

        <div className="relative z-10">
          <div className="flex items-center gap-4">
            <BrandLogo size="xl" variant="dark" />
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {brand?.app_name || 'e-Card IPL Saung Kebun'}
              </p>
              <p className="text-xs sm:text-sm text-emerald-400 font-medium mt-0.5 leading-snug">
                Portal Petugas Keamanan · {brand?.app_subtitle || 'Perumahan Saung Kebun'}
              </p>
            </div>
          </div>

          <div className="mt-7 lg:mt-12 max-w-md">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
              Patroli NFC Checkpoint &amp; Slip Honorarium Petugas
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
              Portal khusus satuan pengamanan Perumahan Saung Kebun untuk scan tag RFID/NFC titik
              patroli, melihat instruksi tugas shift, dan memantau riwayat honorarium pribadi.
            </p>
          </div>

          <div className="hidden lg:grid grid-cols-1 gap-4 mt-10 pt-8 border-t border-slate-800 max-w-md">
            <div className="flex items-start gap-3">
              <Radio className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Scan NFC Langsung dari HP</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Tempelkan ponsel ber-NFC pada stiker RFID di setiap titik patroli. Jam dan lokasi
                  otomatis tersinkronisasi secara real-time.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Fingerprint className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Masuk Cepat Face ID / Sidik Jari</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Aktifkan autentikasi biometrik perangkat agar tidak perlu mengetik ulang PIN 6
                  digit setiap kali bertugas patroli.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Privasi Akun Terisolasi</p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Setiap petugas hanya melihat catatan patroli dan kwitansi honorarium miliknya
                  sendiri.
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="relative z-10 mt-8 lg:mt-12 pt-5 border-t border-slate-800/80">
          <p className="text-xs text-slate-400 leading-relaxed">{brand?.kop_resmi || ''}</p>
        </footer>
      </section>

      {/* Form Login Khusus Petugas Keamanan */}
      <main className="flex-1 flex items-start lg:items-center justify-center px-5 pt-6 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] sm:px-8 sm:pt-8 sm:pb-20 lg:p-14">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col lg:items-center lg:text-center">
            <BrandLogo size="lg" className="hidden lg:flex mb-4" />
            <p className="text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#059669]" />
              <span>Halaman Masuk Khusus Petugas Keamanan</span>
            </p>
            <h2 className="text-2xl font-bold text-[#0F172A] tracking-tight mt-1">
              Masuk Portal Keamanan
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {canQuickUnlock
                ? `Gunakan ${biometryLabel} untuk masuk cepat atau ketik PIN 6 digit Anda.`
                : 'Masukkan Username / Nama Petugas dan PIN 6 digit yang diberikan Pengurus.'}
            </p>
          </div>

          {/* Kartu Masuk Cepat Biometrik (Face ID / Sidik Jari) */}
          {canQuickUnlock && enrolledProfile && (
            <section
              aria-label="Masuk Cepat Biometrik"
              className="mb-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-white to-slate-50 p-5 shadow-xs space-y-3.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0">
                    <BiometricIcon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                      Masuk Cepat Aktif
                    </p>
                    <p className="text-sm font-bold text-[#0F172A] truncate">
                      {enrolledProfile.nama}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      @{enrolledProfile.username}
                      {enrolledProfile.shift ? ` · ${enrolledProfile.shift}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearBiometricProfile}
                  title="Hapus akses biometrik di perangkat ini"
                  aria-label="Hapus akses biometrik di perangkat ini"
                  className="min-h-[38px] min-w-[38px] rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 flex items-center justify-center transition cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                disabled={biometricLoading || loading}
                onClick={() => void handleBiometricLogin()}
                className="w-full min-h-[52px] rounded-xl bg-[#0F172A] hover:bg-slate-800 active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-sm"
              >
                {biometricLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    <span>Memverifikasi {biometryLabel}...</span>
                  </>
                ) : (
                  <>
                    <BiometricIcon className="w-5 h-5 text-emerald-400" />
                    <span>Masuk dengan {biometryLabel}</span>
                  </>
                )}
              </button>
            </section>
          )}

          <form
            onSubmit={handleSubmit}
            className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-5"
          >
            {canQuickUnlock && (
              <div className="flex items-center gap-3 -mt-1">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Atau Masuk dengan PIN
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-sm text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {infoMsg && !errorMsg && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-3 text-xs text-emerald-800"
              >
                <BiometricIcon className="w-4 h-4 text-[#059669] shrink-0 mt-0.5" />
                <span>{infoMsg}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="petugas-username"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                Username / Nama Petugas
              </label>
              <div className="relative">
                <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="petugas-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Contoh: asep"
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="petugas-pin"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                PIN Petugas (6 Digit)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="petugas-pin"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="current-password"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full min-h-[48px] rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-sm text-[#0F172A] placeholder:text-slate-400 tracking-[0.25em] font-mono focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((prev) => !prev)}
                  aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {biometryAvailability?.isAvailable && (
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-3 cursor-pointer hover:border-emerald-300 transition">
                <input
                  type="checkbox"
                  checked={enableBiometricAfterPin}
                  onChange={(e) => setEnableBiometricAfterPin(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#059669] focus:ring-emerald-600/30 cursor-pointer"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                    <BiometricIcon className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                    <span>Aktifkan masuk cepat dengan {biometryLabel}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    Masuk portal patroli berikutnya cukup pakai {biometryLabel} tanpa mengetik ulang
                    PIN (PIN tidak disimpan di perangkat).
                  </p>
                </div>
              </label>
            )}

            <button
              type="submit"
              disabled={loading || biometricLoading}
              aria-busy={loading}
              className="w-full min-h-[48px] rounded-xl bg-[#059669] hover:bg-emerald-700 active:scale-[0.97] disabled:opacity-70 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
            >
              {loading && <LoadingSpinner size="sm" tone="white" label="Memverifikasi akun petugas" />}
              <span>{loading ? 'Memverifikasi...' : 'Masuk Portal Keamanan'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {onSwitchPortal && (
            <div className="mt-5 pt-5 border-t border-slate-200 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onSwitchPortal('warga')}
                className="min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 active:scale-[0.97] text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer"
              >
                <Home className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                <span>Portal Warga</span>
              </button>
              <button
                type="button"
                onClick={() => onSwitchPortal('admin')}
                className="min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.97] text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#0F172A] shrink-0" />
                <span>Pengurus / Admin</span>
              </button>
            </div>
          )}

          <p className="text-xs text-slate-500 text-center mt-4 leading-relaxed">
            Lupa PIN atau belum memiliki akun petugas? Hubungi Ketua atau Bendahara Lingkungan
            Perumahan Saung Kebun.
          </p>

          <AppVersionFooter className="mt-4 pt-3.5 pb-safe border-t border-slate-200/80" />
        </div>
      </main>
    </div>
  );
}

