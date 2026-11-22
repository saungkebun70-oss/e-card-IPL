import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Home,
  Lock,
  Shield,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
  UserCog,
} from 'lucide-react';
import { type SessionUser } from '../types';
import { loginAdminAccount } from '../lib/dataService';
import { useAppBrand } from '../lib/brandContext';
import { BrandLogo } from './BrandLogo';

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await loginAdminAccount(username, pin);
      if (result.error || !result.data) {
        setErrorMsg(result.error || 'Username pengurus atau PIN 6 digit tidak valid.');
      } else {
        onLoginSuccess(result.data);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Panel Identitas Khusus Admin / Pengurus */}
      <section className="bg-slate-950 text-white lg:w-[46%] xl:w-[44%] flex flex-col justify-between px-6 pb-6 sm:px-10 sm:pb-10 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1.5rem)] lg:p-14 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-slate-700/25 blur-3xl"
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
                Portal Admin &amp; Pengurus · {brand.app_subtitle}
              </p>
            </div>
          </div>

          <div className="mt-7 lg:mt-12 max-w-md">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
              Panel Manajemen Kas &amp; Verifikasi IPL Pengurus
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
              Halaman autentikasi khusus jajaran Pengurus Lingkungan Perumahan Saung Kebun untuk
              verifikasi pembayaran warga, pengaturan QRIS/rekening, Bot WhatsApp, dan rekap
              laporan keuangan.
            </p>
          </div>

          <div className="hidden lg:grid grid-cols-1 gap-4 mt-10 pt-8 border-t border-slate-800 max-w-md">
            <div>
              <p className="text-sm font-semibold text-white">Pembagian Hak Akses Pengurus</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Bendahara memiliki akses penuh (verifikasi, QRIS/rekening, Bot WA, ubah/hapus).
                Pembina, Ketua, Humas, dan Seksi Olahraga memiliki akses pencatatan &amp; tambah
                data.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Audit Log Otomatis</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Setiap aktivitas login, verifikasi setoran, dan perubahan data tercatat otomatis
                untuk transparansi kas lingkungan.
              </p>
            </div>
          </div>
        </div>

        <footer className="relative z-10 mt-8 lg:mt-12 pt-5 border-t border-slate-800/80">
          <p className="text-xs text-slate-400 leading-relaxed">{brand.kop_resmi}</p>
        </footer>
      </section>

      {/* Form Login Khusus Admin / Pengurus */}
      <main className="flex-1 flex items-center justify-center p-5 sm:p-8 lg:p-14">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col lg:items-center lg:text-center">
            <BrandLogo size="lg" className="hidden lg:flex mb-4" />
            <p className="text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#059669]" />
              <span>Halaman Masuk Khusus Pengurus</span>
            </p>
            <h2 className="text-2xl font-bold text-[#0F172A] tracking-tight mt-1">
              Masuk ke Portal Admin
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Gunakan username resmi pengurus dan PIN akses 6 digit Anda.
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
                htmlFor="admin-username"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
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
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white pl-10 pr-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-900/15 font-mono"
                />
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                Khusus Pembina, Ketua, Bendahara, Humas, dan Seksi Olahraga Saung Kebun.
              </p>
            </div>

            <div>
              <label
                htmlFor="admin-pin"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
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
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-sm text-[#0F172A] placeholder:text-slate-400 tracking-[0.25em] font-mono focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((prev) => !prev)}
                  aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-[#0F172A] hover:bg-slate-800 active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>{loading ? 'Memverifikasi...' : 'Masuk ke Portal Admin'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {onSwitchPortal && (
            <div className="mt-5 pt-5 border-t border-slate-200 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onSwitchPortal('warga')}
                className="min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Home className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                <span>Portal Warga</span>
              </button>
              <button
                type="button"
                onClick={() => onSwitchPortal('petugas')}
                className="min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-xs font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                <span>Petugas Keamanan</span>
              </button>
            </div>
          )}

          <p className="text-xs text-slate-500 text-center mt-4 pb-safe leading-relaxed">
            Akses terbatas khusus Pengurus Lingkungan Perumahan Saung Kebun yang terdaftar.
          </p>
        </div>
      </main>
    </div>
  );
}
