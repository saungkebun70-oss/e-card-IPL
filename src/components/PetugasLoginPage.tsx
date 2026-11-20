import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  Shield,
  ArrowRight,
  AlertCircle,
  UserCheck,
  Radio,
} from 'lucide-react';
import { type SessionUser } from '../types';
import { loginPetugasKeamanan } from '../lib/dataService';
import { useAppBrand } from '../lib/brandContext';
import { BrandLogo } from './BrandLogo';

interface PetugasLoginPageProps {
  onLoginSuccess: (session: SessionUser) => void;
}

export function PetugasLoginPage({ onLoginSuccess }: PetugasLoginPageProps) {
  const { brand } = useAppBrand();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await loginPetugasKeamanan(username, pin);
      if (result.error || !result.data) {
        setErrorMsg(result.error || 'Username petugas atau PIN 6 digit tidak sesuai.');
      } else {
        onLoginSuccess(result.data);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Panel Identitas Khusus Portal Petugas Keamanan (Terisolasi Penuh) */}
      <section className="bg-[#0F172A] text-white lg:w-[46%] xl:w-[44%] flex flex-col justify-between p-6 sm:p-10 lg:p-14 pt-safe relative overflow-hidden">
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
                {brand.app_name}
              </p>
              <p className="text-xs sm:text-sm text-emerald-400 font-medium mt-0.5 leading-snug">
                Portal Petugas Keamanan · {brand.app_subtitle}
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
          <p className="text-xs text-slate-400 leading-relaxed">{brand.kop_resmi}</p>
        </footer>
      </section>

      {/* Form Login Khusus Petugas Keamanan */}
      <main className="flex-1 flex items-center justify-center p-5 sm:p-8 lg:p-14">
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
              Masukkan Username / Nama Petugas dan PIN 6 digit yang diberikan Pengurus.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 space-y-5"
          >
            {errorMsg && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-sm text-red-800"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
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

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-[#059669] hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>{loading ? 'Memverifikasi...' : 'Masuk Portal Keamanan'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <p className="text-xs text-slate-500 text-center mt-5 leading-relaxed">
            Lupa PIN atau belum memiliki akun petugas? Hubungi Ketua atau Bendahara Lingkungan
            Perumahan Saung Kebun.
          </p>
        </div>
      </main>
    </div>
  );
}
