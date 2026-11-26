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
  Trash2,
  UserCog,
} from 'lucide-react';
import { type LoginAccountValidationStatus, type SessionUser } from '../types';
import { loginAdminAccount, loginAdminWithBiometric } from '../lib/dataService';
import {
  authenticateAdminBiometric,
  checkDeviceBiometryAvailability,
  clearAdminBiometricEnrollment,
  enrollAdminBiometric,
  loadAdminBiometricEnrollment,
  subscribeBiometryResume,
  type AdminBiometricEnrollmentProfile,
  type BiometricAvailability,
} from '../lib/biometricAuth';
import { useAppBrand } from '../lib/brandContext';
import { BrandLogo } from './BrandLogo';
import { AppVersionFooter } from './AppUpdateSystem';
import { LoadingSpinner } from './LoadingSpinner';
import { formatBlokRumah } from '../lib/format';

interface AdminLoginPageProps {
  onLoginSuccess: (session: SessionUser) => void;
  onSwitchPortal?: (route: 'warga' | 'admin' | 'petugas') => void;
}

export function AdminLoginPage({ onLoginSuccess, onSwitchPortal }: AdminLoginPageProps) {
  const { brand } = useAppBrand();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [revokedNotice, setRevokedNotice] = useState<{
    message: string;
    validation?: LoginAccountValidationStatus;
  } | null>(null);

  const [biometryAvailability, setBiometryAvailability] = useState<BiometricAvailability | null>(
    null
  );
  const [enrolledProfile, setEnrolledProfile] = useState<AdminBiometricEnrollmentProfile | null>(
    () => loadAdminBiometricEnrollment()
  );
  const [enableBiometricAfterPin, setEnableBiometricAfterPin] = useState<boolean>(
    () => !loadAdminBiometricEnrollment()
  );

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    const init = async () => {
      try {
        const avail = await checkDeviceBiometryAvailability();
        if (!active) return;
        setBiometryAvailability(avail);
        const stored = loadAdminBiometricEnrollment();
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
    setRevokedNotice(null);
    setBiometricLoading(true);
    try {
      const authRes = await authenticateAdminBiometric(enrolledProfile, biometryAvailability);
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

      const sessionRes = await loginAdminWithBiometric(enrolledProfile);
      if (sessionRes?.error || !sessionRes?.data) {
        const msg =
          sessionRes?.error || 'Akun pengurus tidak aktif atau perlu verifikasi PIN ulang.';
        if (sessionRes?.code === 'PENGURUS_REVOKED_WARGA_RESTORED') {
          clearAdminBiometricEnrollment();
          setEnrolledProfile(null);
          setRevokedNotice({ message: msg, validation: sessionRes.validation });
          return;
        }
        if (msg.toLowerCase().includes('dinonaktifkan') || msg.toLowerCase().includes('tidak ditemukan')) {
          clearAdminBiometricEnrollment();
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
    clearAdminBiometricEnrollment();
    setEnrolledProfile(null);
    setEnableBiometricAfterPin(true);
    setErrorMsg(null);
    setInfoMsg('Akses cepat biometrik di perangkat ini dihapus. Silakan masuk dengan PIN 6 digit.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setRevokedNotice(null);
    setLoading(true);
    try {
      const result = await loginAdminAccount(username, pin);
      if (result?.error || !result?.data) {
        if (result?.code === 'PENGURUS_REVOKED_WARGA_RESTORED') {
          setRevokedNotice({
            message:
              result.error ||
              'Hak akses Pengurus Anda telah dicabut dan akun Warga/Blok otomatis aktif kembali.',
            validation: result.validation,
          });
          return;
        }
        setErrorMsg(result?.error || 'Username pengurus atau PIN 6 digit tidak valid.');
        return;
      }

      const loggedInSession = result.data;

      // Jika pengurus lain masuk pada perangkat yang sama, bersihkan profil biometrik lama
      if (
        enrolledProfile &&
        enrolledProfile.username.toLowerCase() !== loggedInSession.blok_rumah.toLowerCase()
      ) {
        clearAdminBiometricEnrollment();
        setEnrolledProfile(null);
      }

      // Aktifkan biometrik otomatis pasca login PIN jika dicentang dan perangkat mendukung
      if (enableBiometricAfterPin && biometryAvailability?.isAvailable) {
        try {
          const enrollRes = await enrollAdminBiometric(loggedInSession, biometryAvailability);
          if (enrollRes?.ok && enrollRes?.profile) {
            setEnrolledProfile(enrollRes.profile);
          }
        } catch {
          // Tetap lanjutkan masuk portal meskipun aktivasi biometrik dilewati
        }
      }

      onLoginSuccess(loggedInSession);
    } catch {
      setErrorMsg('Terjadi kendala koneksi saat memverifikasi akun pengurus. Silakan coba lagi.');
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

  const kopResmiText =
    brand?.kop_resmi ||
    'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)';

  return (
    <div className="min-h-dvh w-full bg-gradient-to-b from-[#F7F6F2] via-[#F8FAFC] to-[#F1F5F9] text-[#0F172A] flex flex-col lg:flex-row overflow-y-auto overflow-x-clip touch-pan-y">
      {/* Panel Identitas Desktop (>= lg) — Nuansa Krem Hangat & Hijau Zaitun Selaras Logo */}
      <aside className="hidden lg:flex lg:w-[44%] xl:w-[42%] shrink-0 bg-gradient-to-br from-[#F3EFE2] via-[#F7F5ED] to-[#EAE4D3]/75 border-r border-[#4A583E]/12 flex-col justify-between p-12 xl:p-14 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-[#4A583E]/8 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -left-16 w-64 h-64 rounded-full bg-[#3730A3]/6 blur-3xl"
        />

        <div className="relative z-10">
          <div className="flex items-center gap-5">
            <BrandLogo size="xl" variant="light" className="w-[104px] h-[104px] shrink-0" />
            <div className="min-w-0">
              <p className="text-2xl font-bold tracking-tight text-[#0F172A] leading-tight">
                {brand?.app_name || 'e-Card Verifikasi'}
              </p>
              <p className="text-sm font-medium text-[#4A583E] mt-1 leading-snug">
                Portal Admin &amp; Pengurus · {brand?.app_subtitle || 'IPL Digital — Perumahan Saung Kebun'}
              </p>
            </div>
          </div>

          <div className="mt-10 max-w-md">
            <h1 className="text-3xl xl:text-4xl font-bold tracking-tight text-[#0F172A] leading-tight [text-wrap:balance]">
              Manajemen Kas &amp; Verifikasi IPL
            </h1>
            <p className="mt-3.5 text-sm xl:text-base text-slate-600 leading-relaxed">
              Verifikasi pembayaran warga, pengaturan QRIS/rekening, Bot WhatsApp, dan rekap
              laporan keuangan pengurus dalam satu portal terpadu.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 mt-10 pt-8 border-t border-[#4A583E]/15 max-w-md">
            <div>
              <p className="text-sm font-semibold text-[#0F172A]">Pembagian Hak Akses Pengurus</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Bendahara memiliki akses penuh (verifikasi, QRIS/rekening, Bot WA, ubah/hapus).
                Pembina, Ketua, Humas, dan Seksi Olahraga memiliki akses pencatatan &amp; tambah
                data.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Fingerprint className="w-5 h-5 text-[#4A583E] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-[#0F172A]">Masuk Cepat Face ID / Sidik Jari</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Aktifkan biometrik perangkat agar masuk portal pengurus berikutnya cukup sekali
                  sentuh tanpa mengetik ulang PIN (PIN tidak disimpan di perangkat).
                </p>
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#0F172A]">Audit Log Otomatis</p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                Setiap aktivitas login, verifikasi setoran, dan perubahan data tercatat otomatis
                untuk transparansi kas lingkungan.
              </p>
            </div>
          </div>
        </div>

        <footer className="relative z-10 mt-10 pt-5 border-t border-[#4A583E]/15">
          <p className="text-xs text-slate-500 leading-relaxed">{kopResmiText}</p>
        </footer>
      </aside>

      {/* Kolom Utama Login Mobile, Tablet & Desktop */}
      <main className="flex-1 flex flex-col justify-between lg:justify-center items-center px-4 sm:px-6 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] lg:py-12">
        <div className="w-full max-w-md mx-auto animate-page-enter">
          {/* Header Identitas Mobile & Tablet (Seimbang, Proporsional & Anti-Tumpuk) */}
          <header className="lg:hidden flex flex-col items-center text-center mb-5">
            <BrandLogo size="xl" variant="light" className="mb-3.5" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A] leading-tight">
              {brand?.app_name || 'e-Card Verifikasi'}
            </h1>
            <p className="text-xs sm:text-[13px] font-medium text-[#4A583E] mt-1 leading-snug max-w-xs sm:max-w-sm">
              Portal Admin &amp; Pengurus · {brand?.app_subtitle || 'IPL Digital — Perumahan Saung Kebun'}
            </p>
            <div className="mt-3 pt-3 border-t border-[#EAE4D3] w-full max-w-sm">
              <p className="text-sm font-semibold text-[#1E293B]">
                Manajemen Kas &amp; Verifikasi IPL
              </p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Verifikasi pembayaran warga, QRIS/rekening, Bot WhatsApp, dan rekap keuangan.
              </p>
            </div>
          </header>

          {/* Kartu Login Putih Bersih (Biometrik + PIN 6 Digit) */}
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.08)] p-5 sm:p-6 space-y-5">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#4A583E] inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Akses Khusus Pengurus</span>
              </p>
              <h2 className="text-lg sm:text-xl font-bold text-[#0F172A] tracking-tight">
                Masuk ke Portal Admin
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 leading-snug">
                {canQuickUnlock
                  ? `Gunakan ${biometryLabel} atau masukkan username & PIN 6 digit.`
                  : 'Masukkan username resmi pengurus dan PIN akses 6 digit Anda.'}
              </p>
            </div>

            {/* Bagian MASUK CEPAT AKTIF (Biometrik) */}
            {canQuickUnlock && enrolledProfile && (
              <section
                aria-label="Masuk Cepat Biometrik Pengurus"
                className="rounded-xl bg-[#F7F6F2] border border-[#EAE4D3] p-4 space-y-3.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-[#4A583E] text-[#F5F2E4] flex items-center justify-center shrink-0 shadow-xs">
                      <BiometricIcon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold tracking-wider uppercase text-[#4A583E]">
                        Masuk Cepat Aktif
                      </p>
                      <p className="text-sm font-bold text-[#0F172A] truncate mt-0.5">
                        {enrolledProfile.nama}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        @{enrolledProfile.username}
                        {enrolledProfile.jabatan ? ` · ${enrolledProfile.jabatan}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearBiometricProfile}
                    title="Hapus akses biometrik di perangkat ini"
                    aria-label="Hapus akses biometrik di perangkat ini"
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200/90 bg-white hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <button
                  type="button"
                  disabled={biometricLoading || loading}
                  onClick={() => void handleBiometricLogin()}
                  className="w-full min-h-[48px] rounded-xl bg-[#4A583E] hover:bg-[#3C4832] active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2.5 transition-all cursor-pointer shadow-sm"
                >
                  {biometricLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#EAE4D3]" />
                      <span>Memverifikasi {biometryLabel}...</span>
                    </>
                  ) : (
                    <>
                      <BiometricIcon className="w-5 h-5 text-[#EAE4D3]" />
                      <span>Masuk dengan {biometryLabel}</span>
                    </>
                  )}
                </button>
              </section>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {canQuickUnlock && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] font-medium text-slate-400 whitespace-nowrap">
                    Atau masuk dengan PIN
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>
              )}

              {revokedNotice && (
                <div
                  role="alert"
                  className="rounded-xl bg-amber-50 border border-amber-300/90 p-3.5 space-y-2.5 text-amber-950"
                >
                  <div className="flex items-start gap-2.5">
                    <Home className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs sm:text-sm font-bold text-amber-950 leading-snug">
                        Hak Pengurus Dicabut — Akun Warga Aktif Kembali
                      </p>
                      <p className="text-xs text-amber-900 leading-relaxed">
                        {revokedNotice.message}
                      </p>
                      {revokedNotice.validation?.linked_blok_rumah && (
                        <p className="text-[11px] font-mono text-emerald-800 font-semibold">
                          Akun Warga Aktif: Blok{' '}
                          {formatBlokRumah(revokedNotice.validation.linked_blok_rumah) ||
                            revokedNotice.validation.linked_blok_rumah}{' '}
                          · Status: {revokedNotice.validation.warga_account_status || 'active'}
                        </p>
                      )}
                    </div>
                  </div>
                  {onSwitchPortal && (
                    <button
                      type="button"
                      onClick={() => onSwitchPortal('warga')}
                      className="w-full min-h-[42px] px-3.5 rounded-xl bg-[#4A583E] hover:bg-[#3C4832] text-white text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <Home className="w-4 h-4 shrink-0" />
                      <span>Masuk Lewat Portal Warga</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  )}
                </div>
              )}

              {errorMsg && !revokedNotice && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-xs sm:text-sm text-red-800"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {infoMsg && !errorMsg && !revokedNotice && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-3 text-xs text-emerald-800"
                >
                  <BiometricIcon className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{infoMsg}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="admin-username"
                  className="block text-xs sm:text-sm font-semibold text-[#0F172A] mb-1.5"
                >
                  Username Admin / Pengurus
                </label>
                <div className="relative">
                  <UserCog className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="admin-username"
                    type="text"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masukkan username pengurus"
                    className="w-full min-h-[48px] rounded-xl border border-slate-200 bg-slate-50/60 focus:bg-white pl-10 pr-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4A583E] focus:outline-none focus:ring-2 focus:ring-[#4A583E]/15 font-mono transition-colors"
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Khusus Pembina, Ketua, Bendahara, Humas, dan Seksi Olahraga Saung Kebun.
                </p>
              </div>

              <div>
                <label
                  htmlFor="admin-pin"
                  className="block text-xs sm:text-sm font-semibold text-[#0F172A] mb-1.5"
                >
                  PIN Akses Pengurus (6 Digit)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="admin-pin"
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="current-password"
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    className="w-full min-h-[48px] rounded-xl border border-slate-200 bg-slate-50/60 focus:bg-white pl-10 pr-12 text-sm text-[#0F172A] placeholder:text-slate-400 tracking-[0.28em] font-mono focus:border-[#4A583E] focus:outline-none focus:ring-2 focus:ring-[#4A583E]/15 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((prev) => !prev)}
                    aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-[#4A583E] hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {biometryAvailability?.isAvailable ? (
                <label className="flex items-start gap-3 rounded-xl border border-[#EAE4D3] bg-[#FAF9F5] px-3.5 py-3 cursor-pointer hover:border-[#4A583E]/40 transition-colors">
                  <input
                    type="checkbox"
                    checked={enableBiometricAfterPin}
                    onChange={(e) => setEnableBiometricAfterPin(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#4A583E] focus:ring-[#4A583E]/30 cursor-pointer accent-[#4A583E]"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                      <BiometricIcon className="w-3.5 h-3.5 text-[#4A583E] shrink-0" />
                      <span>Aktifkan masuk cepat dengan {biometryLabel}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                      Masuk portal pengurus berikutnya cukup pakai {biometryLabel} tanpa mengetik
                      ulang PIN (PIN tidak disimpan di perangkat).
                    </p>
                  </div>
                </label>
              ) : (
                biometryAvailability !== null && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-[#EAE4D3] bg-[#FAF9F5] px-3.5 py-3">
                    <BiometricIcon className="w-4 h-4 text-[#4A583E] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0F172A]">
                        Aktifkan masuk cepat dengan {biometryLabel}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                        Masuk portal pengurus berikutnya cukup pakai {biometryLabel} tanpa mengetik
                        ulang PIN (PIN tidak disimpan di perangkat). Aktifkan kunci biometrik di
                        Pengaturan HP untuk menggunakan fitur ini.
                      </p>
                    </div>
                  </div>
                )
              )}

              <button
                type="submit"
                disabled={loading || biometricLoading}
                aria-busy={loading}
                className={`w-full min-h-[48px] rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer active:scale-[0.99] disabled:opacity-70 shadow-sm ${
                  canQuickUnlock
                    ? 'bg-[#3730A3] hover:bg-[#312E81] text-white'
                    : 'bg-[#4A583E] hover:bg-[#3C4832] text-white'
                }`}
              >
                {loading && <LoadingSpinner size="sm" tone="white" label="Memverifikasi akun pengurus" />}
                <span>{loading ? 'Memverifikasi...' : 'Masuk ke Portal Admin'}</span>
                {!loading && <ArrowRight className="w-4 h-4" />}
              </button>
            </form>
          </div>

          {onSwitchPortal && (
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onSwitchPortal('warga')}
                className="min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-200/90 hover:border-[#4A583E]/40 hover:bg-[#FAF9F5] active:scale-[0.98] text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer shadow-2xs"
              >
                <Home className="w-3.5 h-3.5 text-[#4A583E] shrink-0" />
                <span className="whitespace-nowrap">Portal Warga</span>
              </button>
              <button
                type="button"
                onClick={() => onSwitchPortal('petugas')}
                className="min-h-[44px] px-3.5 rounded-xl bg-white border border-slate-200/90 hover:border-[#4A583E]/40 hover:bg-[#FAF9F5] active:scale-[0.98] text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition-all duration-200 cursor-pointer shadow-2xs"
              >
                <Shield className="w-3.5 h-3.5 text-[#4A583E] shrink-0" />
                <span className="whitespace-nowrap">Petugas Keamanan</span>
              </button>
            </div>
          )}

          {/* Catatan Kaki Minimalis (Alamat Pengurus + Versi Aplikasi) */}
          <footer className="mt-6 pt-4 border-t border-slate-200/80 text-center space-y-2">
            <p className="text-[11px] text-slate-500 leading-relaxed">{kopResmiText}</p>
            <AppVersionFooter className="pt-1" />
          </footer>
        </div>
      </main>
    </div>
  );
}
