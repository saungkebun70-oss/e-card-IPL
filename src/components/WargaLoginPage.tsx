import React, { useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  Fingerprint,
  Home,
  Loader2,
  Lock,
  ScanFace,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  Shield,
  Trash2,
} from 'lucide-react';
import { type SessionUser } from '../types';
import { loginWargaAccount, loginWargaWithBiometric } from '../lib/dataService';
import {
  authenticateWargaBiometric,
  checkDeviceBiometryAvailability,
  clearWargaBiometricEnrollment,
  enrollWargaBiometric,
  loadWargaBiometricEnrollment,
  subscribeBiometryResume,
  type BiometricAvailability,
  type WargaBiometricEnrollmentProfile,
} from '../lib/biometricAuth';
import { useAppBrand } from '../lib/brandContext';
import { BrandLogo } from './BrandLogo';
import { AppVersionFooter } from './AppUpdateSystem';
import { LoadingSpinner } from './LoadingSpinner';

interface WargaLoginPageProps {
  onLoginSuccess: (session: SessionUser) => void;
  onSwitchPortal?: (route: 'warga' | 'admin' | 'petugas') => void;
}

export function WargaLoginPage({ onLoginSuccess, onSwitchPortal }: WargaLoginPageProps) {
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
  const [enrolledProfile, setEnrolledProfile] = useState<WargaBiometricEnrollmentProfile | null>(
    () => loadWargaBiometricEnrollment()
  );
  const [enableBiometricAfterPin, setEnableBiometricAfterPin] = useState<boolean>(
    () => !loadWargaBiometricEnrollment()
  );

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    const init = async () => {
      try {
        const avail = await checkDeviceBiometryAvailability();
        if (!active) return;
        setBiometryAvailability(avail);
        const stored = loadWargaBiometricEnrollment();
        setEnrolledProfile(stored);
        if (stored?.blok_rumah) {
          setUsername((prev) => prev || stored.blok_rumah);
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
      const authRes = await authenticateWargaBiometric(enrolledProfile, biometryAvailability);
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

      const sessionRes = await loginWargaWithBiometric(enrolledProfile);
      if (sessionRes?.error || !sessionRes?.data) {
        const msg = sessionRes?.error || 'Akun warga tidak aktif atau perlu verifikasi PIN ulang.';
        if (msg.toLowerCase().includes('dinonaktifkan') || msg.toLowerCase().includes('tidak ditemukan')) {
          clearWargaBiometricEnrollment();
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
    clearWargaBiometricEnrollment();
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
      const result = await loginWargaAccount(username, pin);
      if (result?.error || !result?.data) {
        setErrorMsg(result?.error || 'Blok rumah atau PIN 6 digit tidak sesuai.');
        return;
      }

      const loggedInSession = result.data;

      // Jika unit rumah lain masuk pada perangkat yang sama, bersihkan profil biometrik lama
      if (
        enrolledProfile &&
        enrolledProfile.blok_rumah.toLowerCase() !== loggedInSession.blok_rumah.toLowerCase()
      ) {
        clearWargaBiometricEnrollment();
        setEnrolledProfile(null);
      }

      // Aktifkan biometrik otomatis pasca login PIN jika dicentang dan perangkat mendukung
      if (enableBiometricAfterPin && biometryAvailability?.isAvailable) {
        try {
          const enrollRes = await enrollWargaBiometric(loggedInSession, biometryAvailability);
          if (enrollRes?.ok && enrollRes?.profile) {
            setEnrolledProfile(enrollRes.profile);
          }
        } catch {
          // Tetap lanjutkan masuk portal meskipun aktivasi biometrik dilewati
        }
      }

      onLoginSuccess(loggedInSession);
    } catch {
      setErrorMsg('Terjadi kendala koneksi saat memverifikasi akun. Silakan coba lagi.');
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
    <div className="min-h-[100dvh] w-full glass-canvas bg-gradient-to-br from-[#EEF2FF] via-[#F3E8FF] to-[#E0F2FE] flex flex-col lg:flex-row overflow-y-auto overflow-x-clip touch-pan-y">
      {/* Panel Identitas Portal Warga */}
      <section className="shrink-0 glass-hero bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] shadow-xl shadow-indigo-900/15 text-white lg:w-[46%] xl:w-[44%] flex flex-col justify-between px-6 pb-6 sm:px-10 sm:pb-10 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1.5rem)] lg:p-14 relative overflow-hidden lg:rounded-r-3xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-indigo-400/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-emerald-400/15 blur-3xl"
        />

        <div className="relative z-10">
          <div className="flex items-center gap-4">
            <BrandLogo size="xl" variant="dark" />
            <div className="min-w-0">
              <p className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {brand?.app_name || 'e-Card IPL Saung Kebun'}
              </p>
              <p className="text-xs sm:text-sm text-[#A7F3D0] font-medium mt-0.5 leading-snug">
                Portal Warga · {brand?.app_subtitle || 'Perumahan Saung Kebun'}
              </p>
            </div>
          </div>

          <div className="mt-7 lg:mt-12 max-w-md">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
              Cek e-Card &amp; Setor IPL Digital Unit Anda
            </h1>
            <p className="mt-4 text-sm sm:text-base text-indigo-100/90 leading-relaxed">
              Pantau status pembayaran Iuran Pemeliharaan Lingkungan (IPL) 12 bulan, setor via
              QRIS, transfer, atau titip pengurus, dan unduh kwitansi digital resmi rumah Anda.
            </p>
          </div>

          <div className="hidden lg:grid grid-cols-1 gap-4 mt-10 pt-8 border-t border-white/15 max-w-md">
            <div>
              <p className="text-sm font-semibold text-white">Privasi Ketat (1 Akun = 1 Rumah)</p>
              <p className="text-xs text-indigo-200/85 mt-1 leading-relaxed">
                Akun warga terkunci eksklusif untuk satu unit rumah dan tidak dapat melihat data
                atau tagihan unit warga lainnya.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Fingerprint className="w-5 h-5 text-[#A7F3D0] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Masuk Cepat Face ID / Sidik Jari</p>
                <p className="text-xs text-indigo-200/85 mt-1 leading-relaxed">
                  Aktifkan autentikasi biometrik perangkat agar masuk portal warga berikutnya cukup
                  pakai Sidik Jari / Face ID tanpa mengetik ulang PIN (PIN tidak disimpan di
                  perangkat).
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Siklus Tagihan Bulanan</p>
              <p className="text-xs text-indigo-200/85 mt-1 leading-relaxed">
                Nominal standar Rp 100.000/bulan · Terbit setiap tanggal 1 · Jatuh tempo tanggal 7.
              </p>
            </div>
          </div>
        </div>

        <footer className="relative z-10 mt-8 lg:mt-12 pt-5 border-t border-white/15">
          <p className="text-xs text-indigo-200/80 leading-relaxed">{brand?.kop_resmi || ''}</p>
        </footer>
      </section>

      {/* Form Login Khusus Warga */}
      <main className="flex-1 flex items-start lg:items-center justify-center px-5 pt-6 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] sm:px-8 sm:pt-8 sm:pb-20 lg:p-14">
        <div className="w-full max-w-md animate-page-enter">
          <div className="mb-6 flex flex-col lg:items-center lg:text-center">
            <BrandLogo size="lg" className="hidden lg:flex mb-4" />
            <p className="text-xs font-semibold text-[#4C1D95] inline-flex items-center gap-1.5">
              <Home className="w-3.5 h-3.5" />
              <span>Halaman Masuk Khusus Warga</span>
            </p>
            <h2 className="text-2xl font-bold text-[#0F172A] tracking-tight mt-1">
              Masuk ke Portal Warga
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              {canQuickUnlock
                ? `Gunakan ${biometryLabel} untuk masuk cepat atau ketik PIN 6 digit unit Anda.`
                : 'Masukkan Blok/No. Rumah dan PIN 6 digit resmi rumah Anda.'}
            </p>
          </div>

          {/* Kartu Masuk Cepat Biometrik (Face ID / Sidik Jari) */}
          {canQuickUnlock && enrolledProfile && (
            <section
              aria-label="Masuk Cepat Biometrik Warga"
              className="mb-4 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 space-y-3.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-[#3730A3] text-[#A7F3D0] flex items-center justify-center shrink-0 shadow-xs">
                    <BiometricIcon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-[#4C1D95]">
                      Masuk Cepat Aktif
                    </p>
                    <p className="text-sm font-bold text-[#0F172A] truncate">
                      {enrolledProfile.nama}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      Blok {enrolledProfile.blok_rumah}
                      {enrolledProfile.status_hunian ? ` · ${enrolledProfile.status_hunian}` : ''}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearBiometricProfile}
                  title="Hapus akses biometrik di perangkat ini"
                  aria-label="Hapus akses biometrik di perangkat ini"
                  className="min-h-[38px] min-w-[38px] rounded-2xl border border-indigo-100 bg-white/90 hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 flex items-center justify-center transition cursor-pointer shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                disabled={biometricLoading || loading}
                onClick={() => void handleBiometricLogin()}
                className="w-full min-h-[50px] rounded-full bg-[#3730A3] hover:bg-[#312E81] active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-sm"
              >
                {biometricLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-[#A7F3D0]" />
                    <span>Memverifikasi {biometryLabel}...</span>
                  </>
                ) : (
                  <>
                    <BiometricIcon className="w-5 h-5 text-[#A7F3D0]" />
                    <span>Masuk dengan {biometryLabel}</span>
                  </>
                )}
              </button>
            </section>
          )}

          <form
            onSubmit={handleSubmit}
            className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-6 sm:p-7 space-y-5"
          >
            {canQuickUnlock && (
              <div className="flex items-center gap-3 -mt-1">
                <div className="h-px flex-1 bg-indigo-100/80" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Atau Masuk dengan PIN
                </span>
                <div className="h-px flex-1 bg-indigo-100/80" />
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-2xl bg-red-50 border border-red-200 px-3.5 py-3 text-sm text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {infoMsg && !errorMsg && (
              <div
                role="status"
                className="flex items-start gap-2.5 rounded-2xl bg-emerald-50 border border-emerald-200 px-3.5 py-3 text-xs text-emerald-800"
              >
                <BiometricIcon className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{infoMsg}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="warga-username"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                Username (Blok &amp; No. Rumah)
              </label>
              <input
                id="warga-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Contoh: B3/7"
                className="w-full min-h-[46px] rounded-2xl border border-indigo-200/80 bg-white/90 px-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15 font-mono uppercase"
              />
              <p className="text-xs text-slate-500 mt-1.5">
                Gunakan format Blok dan Nomor Rumah sesuai data pengurus, misalnya{' '}
                <span className="font-mono text-slate-700">B3/7</span> atau{' '}
                <span className="font-mono text-slate-700">B7/16</span>.
              </p>
            </div>

            <div>
              <label
                htmlFor="warga-pin"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                PIN Akses (6 Digit)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="warga-pin"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="current-password"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full min-h-[46px] rounded-2xl border border-indigo-200/80 bg-white/90 pl-10 pr-12 text-sm text-[#0F172A] placeholder:text-slate-400 tracking-[0.25em] font-mono focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((prev) => !prev)}
                  aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-500 hover:text-[#4C1D95] hover:bg-indigo-50 transition-colors cursor-pointer"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {biometryAvailability?.isAvailable ? (
              <label className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-3 cursor-pointer hover:border-indigo-300 transition">
                <input
                  type="checkbox"
                  checked={enableBiometricAfterPin}
                  onChange={(e) => setEnableBiometricAfterPin(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-indigo-300 text-[#4C1D95] focus:ring-[#4C1D95]/30 cursor-pointer accent-[#4C1D95]"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                    <BiometricIcon className="w-3.5 h-3.5 text-[#4C1D95] shrink-0" />
                    <span>Aktifkan masuk cepat dengan {biometryLabel}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    Masuk portal warga berikutnya cukup pakai {biometryLabel} tanpa mengetik ulang
                    PIN (PIN tidak disimpan di perangkat).
                  </p>
                </div>
              </label>
            ) : (
              biometryAvailability !== null && (
                <div className="flex items-start gap-2.5 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-3">
                  <BiometricIcon className="w-4 h-4 text-[#4C1D95] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A]">
                      Aktifkan masuk cepat dengan {biometryLabel}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                      Masuk portal warga berikutnya cukup pakai {biometryLabel} tanpa mengetik ulang
                      PIN (PIN tidak disimpan di perangkat). Aktifkan kunci biometrik di Pengaturan
                      HP untuk menggunakan fitur ini.
                    </p>
                  </div>
                </div>
              )
            )}

            <button
              type="submit"
              disabled={loading || biometricLoading}
              aria-busy={loading}
              className="w-full min-h-[48px] rounded-full bg-[#3730A3] hover:bg-[#312E81] active:scale-[0.98] disabled:opacity-70 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer shadow-sm"
            >
              {loading && <LoadingSpinner size="sm" tone="white" label="Memverifikasi akun warga" />}
              <span>{loading ? 'Memverifikasi...' : 'Masuk ke Portal Warga'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {/* Opsi Akses Khusus Pengurus / Admin & Petugas Keamanan */}
          {onSwitchPortal && (
            <div className="mt-5 pt-5 border-t border-indigo-100/80 space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 text-center">
                Akses Portal Khusus Pengurus &amp; Keamanan
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onSwitchPortal('admin')}
                  className="min-h-[48px] px-3.5 py-2.5 rounded-2xl glass-card hover:bg-white/95 active:scale-[0.98] text-left flex items-center gap-2.5 transition-all duration-200 cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-xl bg-[#3730A3] text-[#A7F3D0] flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[#0F172A] leading-tight truncate">
                      Login Pengurus / Admin
                    </p>
                    <p className="text-[11px] text-slate-500 leading-tight truncate mt-0.5">
                      Ketua, Bendahara, Humas
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onSwitchPortal('petugas')}
                  className="min-h-[48px] px-3.5 py-2.5 rounded-2xl glass-card hover:bg-white/95 active:scale-[0.98] text-left flex items-center gap-2.5 transition-all duration-200 cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 text-[#4C1D95] flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-[#0F172A] leading-tight truncate">
                      Login Petugas Keamanan
                    </p>
                    <p className="text-[11px] text-slate-500 leading-tight truncate mt-0.5">
                      Patroli &amp; Scan NFC
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-slate-500 text-center mt-5 leading-relaxed">
            Belum memiliki PIN atau lupa PIN akses? Hubungi Pengurus Lingkungan di Sekretariat Blok{' '}
            <span className="font-mono font-semibold text-slate-700">B3/7</span> atau Bendahara.
          </p>

          <AppVersionFooter className="mt-4 pt-3.5 pb-safe border-t border-indigo-100/80" />
        </div>
      </main>
    </div>
  );
}
