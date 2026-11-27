import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  DownloadCloud,
  Eye,
  EyeOff,
  Fingerprint,
  Loader2,
  Lock,
  RefreshCw,
  ScanFace,
  Shield,
  Trash2,
  UserCheck,
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
import { useAppUpdate } from '../lib/appUpdate';
import { BrandLogo, SaungKebunWatermark } from './BrandLogo';
import { LoadingSpinner } from './LoadingSpinner';

const LOGIN_BG_SRC = '/assets/aistudio/1795778728405_5f9ccccc.jpg';

interface PetugasLoginPageProps {
  onLoginSuccess: (session: SessionUser) => void;
  onSwitchPortal?: (route: 'warga' | 'admin' | 'petugas') => void;
}

export function PetugasLoginPage({ onLoginSuccess, onSwitchPortal }: PetugasLoginPageProps) {
  const { brand } = useAppBrand();
  const { currentVersion, updateAvailable, checking, updating, checkForUpdate, applyUpdate } =
    useAppUpdate();
  const [updateFeedback, setUpdateFeedback] = useState<string | null>(null);

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

      if (enrolledProfile && enrolledProfile.petugas_id !== loggedInSession.petugas_id) {
        clearPetugasBiometricEnrollment();
        setEnrolledProfile(null);
      }

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
  const biometryLabel = biometryAvailability?.label || 'Sidik Jari';

  const kopResmiText =
    brand?.kop_resmi ||
    'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)';

  const profileCardName = enrolledProfile?.nama || 'Petugas Keamanan';
  const profileCardSub = enrolledProfile
    ? `${enrolledProfile.shift || 'Keamanan'} · @${enrolledProfile.username}`
    : username.trim()
      ? `Keamanan · @${username.trim()}`
      : 'Patroli NFC & Honorarium Petugas';

  const profileInitials = enrolledProfile?.nama
    ? enrolledProfile.nama
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() || '')
        .join('')
    : '';

  return (
    <div className="relative min-h-[100dvh] w-full flex flex-col justify-between overflow-x-hidden overflow-y-auto text-[#FFFDF8]">
      {/* Background Foto Penuh Fasad Rumah Saung Kebun + Overlay Hijau Lumut */}
      <div className="fixed inset-0 -z-10">
        <img
          src={LOGIN_BG_SRC}
          alt="Fasad Rumah & Taman Perumahan Saung Kebun"
          className="w-full h-full object-cover object-center"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-[#172618]/80 via-[#243825]/60 to-[#142015]/92"
        />
      </div>

      {/* Bar Atas */}
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
            className="min-h-[36px] px-3.5 rounded-full bg-[#FFFDF8]/88 hover:bg-[#FFFDF8] backdrop-blur-md border border-white/40 text-[#243825] text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition active:scale-95 cursor-pointer"
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
            <Bell className="w-4 h-4" />
            {updateAvailable && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#C87058]" />
            )}
          </button>
        </div>
      </header>

      {/* Konten Utama Login */}
      <main className="relative z-10 w-full max-w-md mx-auto px-4 sm:px-6 py-5 flex-1 flex flex-col justify-center gap-5 animate-page-enter">
        {/* Kartu Profil Frosted Glass Hijau Lumut Ber-Watermark */}
        <section
          aria-label="Profil Akses Keamanan"
          className="relative overflow-hidden rounded-3xl bg-[#243825]/68 backdrop-blur-md border border-white/20 p-4 shadow-2xl"
        >
          <SaungKebunWatermark className="absolute -right-5 -bottom-4 w-32 h-24" tone="cream" />
          <div className="relative z-10 flex items-center gap-3.5">
            <div className="w-13 h-13 rounded-full bg-[#FFFDF8]/18 border-2 border-[#E5EEE3]/60 flex items-center justify-center text-base font-bold text-[#FFFDF8] shrink-0 shadow-inner">
              {profileInitials || <Shield className="w-6 h-6 text-[#FFFDF8]" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-serif-brand text-lg sm:text-xl font-bold text-[#FFFDF8] leading-tight truncate">
                {profileCardName}
              </p>
              <p className="text-xs font-medium text-[#E5EEE3]/90 truncate mt-0.5">
                {profileCardSub}
              </p>
            </div>
            {canQuickUnlock && enrolledProfile && (
              <button
                type="button"
                onClick={handleClearBiometricProfile}
                title="Hapus akses biometrik di perangkat ini"
                aria-label="Hapus akses biometrik di perangkat ini"
                className="h-9 w-9 rounded-full bg-white/10 hover:bg-[#C87058]/80 text-[#E5EEE3] hover:text-white flex items-center justify-center transition cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </section>

        {/* Form Langsung di Atas Background */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl bg-[#7E2B1C]/90 backdrop-blur-md border border-[#C87058]/60 px-4 py-3 text-xs sm:text-sm text-[#FFFDF8] shadow-lg"
            >
              <AlertCircle className="w-4 h-4 text-[#F2D8A7] shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoMsg && !errorMsg && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-2xl bg-[#243825]/85 backdrop-blur-md border border-[#C6D2BF]/40 px-4 py-3 text-xs text-[#E5EEE3] shadow-lg"
            >
              <BiometricIcon className="w-4 h-4 text-[#E5EEE3] shrink-0 mt-0.5" />
              <span>{infoMsg}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="petugas-username"
              className="block text-xs font-bold tracking-wide text-[#FFFDF8] mb-1.5 px-1 drop-shadow-xs"
            >
              Username / Nama Petugas
            </label>
            <div className="relative">
              <UserCheck className="w-4 h-4 text-[#4A554A] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="petugas-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Contoh: asep"
                className="w-full min-h-[50px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] pl-11 pr-4 text-base text-[#1B271B] placeholder:text-[#6E786D] focus:border-[#C6D2BF] focus:outline-none focus:ring-4 focus:ring-[#E5EEE3]/35 shadow-md transition"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="petugas-pin"
              className="block text-xs font-bold tracking-wide text-[#FFFDF8] mb-1.5 px-1 drop-shadow-xs"
            >
              PIN 6 Digit
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#4A554A] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
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
                className="w-full min-h-[50px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] pl-11 pr-12 text-base text-[#1B271B] placeholder:text-[#6E786D] tracking-[0.28em] font-mono focus:border-[#C6D2BF] focus:outline-none focus:ring-4 focus:ring-[#E5EEE3]/35 shadow-md transition"
              />
              <button
                type="button"
                onClick={() => setShowPin((prev) => !prev)}
                aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/60 transition-colors cursor-pointer"
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Toggle Masuk cepat Sidik Jari */}
          <label className="flex items-center justify-between gap-3 rounded-2xl bg-[#243825]/55 backdrop-blur-md border border-white/15 px-4 py-2.5 cursor-pointer">
            <div className="flex items-center gap-2.5 min-w-0">
              <BiometricIcon className="w-4 h-4 text-[#E5EEE3] shrink-0" />
              <span className="text-xs font-semibold text-[#FFFDF8] truncate">
                Masuk cepat {biometryLabel}
              </span>
            </div>
            <div className="relative inline-flex items-center shrink-0">
              <input
                type="checkbox"
                checked={enableBiometricAfterPin}
                onChange={(e) => setEnableBiometricAfterPin(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-10 h-6 rounded-full bg-white/25 peer-checked:bg-[#E5EEE3] transition-colors relative after:content-[''] after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:rounded-full after:bg-[#FFFDF8] peer-checked:after:bg-[#243825] peer-checked:after:translate-x-4 after:transition-transform" />
            </div>
          </label>

          {/* Baris Aksi Utama */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading || biometricLoading}
              aria-busy={loading}
              className="flex-1 min-h-[52px] px-6 rounded-full bg-[#2B3F29] hover:bg-[#384E35] border border-white/20 active:scale-[0.99] disabled:opacity-70 text-[#FFFDF8] font-bold text-sm inline-flex items-center justify-center gap-2 shadow-xl transition cursor-pointer"
            >
              {loading && (
                <LoadingSpinner size="sm" tone="white" label="Memverifikasi akun petugas" />
              )}
              <span>{loading ? 'Memverifikasi...' : 'Masuk Portal'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>

            <button
              type="button"
              disabled={biometricLoading || loading}
              onClick={() => {
                if (canQuickUnlock) {
                  void handleBiometricLogin();
                } else {
                  setInfoMsg(
                    biometryAvailability?.isAvailable
                      ? `Masuk dengan PIN 6 digit satu kali untuk mengaktifkan akses cepat ${biometryLabel}.`
                      : `Perangkat ini belum mengaktifkan ${biometryLabel}. Masuk menggunakan PIN 6 digit.`
                  );
                }
              }}
              aria-label={`Masuk dengan ${biometryLabel}`}
              title={
                canQuickUnlock
                  ? `Masuk cepat ${biometryLabel}`
                  : `Aktifkan ${biometryLabel} setelah login PIN`
              }
              className="w-[52px] h-[52px] rounded-full bg-[#FFFDF8] hover:bg-[#E5EEE3] border border-[#E6E2D6] text-[#243825] flex items-center justify-center shadow-xl transition active:scale-95 cursor-pointer shrink-0 disabled:opacity-60"
            >
              {biometricLoading ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#2B3F29]" />
              ) : (
                <BiometricIcon className="w-6 h-6 text-[#243825]" />
              )}
            </button>
          </div>

          <p className="text-[11px] text-[#E5EEE3]/85 text-center leading-relaxed px-2">
            Lupa PIN atau belum memiliki akun petugas? Hubungi Ketua atau Bendahara Lingkungan.
          </p>
        </form>
      </main>

      {/* Bar Bawah Pemindah Peran */}
      <footer className="relative z-10 w-full max-w-md mx-auto px-4 sm:px-6 pb-[calc(max(env(safe-area-inset-bottom,0px),14px)+0.5rem)] space-y-3 text-center">
        {onSwitchPortal && (
          <div className="inline-flex items-center justify-center rounded-full bg-[#FFFDF8]/88 backdrop-blur-md border border-white/40 px-4 py-2 shadow-lg">
            <button
              type="button"
              onClick={() => onSwitchPortal('warga')}
              className="text-xs font-bold text-[#243825] hover:text-[#384E35] px-2.5 py-0.5 cursor-pointer transition"
            >
              Portal Warga
            </button>
            <span className="text-[#C6D2BF] select-none">|</span>
            <button
              type="button"
              onClick={() => onSwitchPortal('admin')}
              className="text-xs font-bold text-[#243825] hover:text-[#384E35] px-2.5 py-0.5 cursor-pointer transition"
            >
              Portal Pengurus
            </button>
          </div>
        )}

        <p className="text-[10.5px] text-[#E5EEE3]/75 leading-relaxed line-clamp-2">
          {kopResmiText} · v{currentVersion}
        </p>
      </footer>
    </div>
  );
}
