import React, { useState } from 'react';
import { Eye, EyeOff, Home, Lock, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { KOP_RESMI, NAMA_APLIKASI, type SessionUser } from '../types';
import { loginPortal } from '../lib/dataService';
import { BrandLogo } from './BrandLogo';

interface LoginViewProps {
  onLoginSuccess: (session: SessionUser) => void;
}

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [tab, setTab] = useState<'warga' | 'admin'>('warga');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleTabSwitch = (nextTab: 'warga' | 'admin') => {
    setTab(nextTab);
    setUsername('');
    setPin('');
    setErrorMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await loginPortal(tab, username, pin);
      if (result.error || !result.data) {
        setErrorMsg(result.error || 'Gagal melakukan autentikasi. Silakan coba lagi.');
      } else {
        onLoginSuccess(result.data);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Panel Identitas Resmi (Desktop kiri / Mobile atas ringkas) */}
      <section className="bg-[#0F172A] text-white lg:w-[46%] xl:w-[44%] flex flex-col justify-between p-6 sm:p-10 lg:p-14 relative overflow-hidden">
        {/* Aksen geometris arsitektural halus */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-600/15 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-1 bg-emerald-600"
        />

        <div className="relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <BrandLogo size="xl" className="border-white/15 shadow-lg shadow-black/25" />
            <div>
              <p className="text-lg sm:text-xl font-bold tracking-tight text-white">
                {NAMA_APLIKASI}
              </p>
              <p className="text-xs sm:text-sm text-emerald-400 font-medium mt-0.5">
                IPL Digital — Perumahan Saung Kebun
              </p>
            </div>
          </div>

          <div className="mt-7 lg:mt-12 max-w-md">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
              Verifikasi e-Card &amp; Iuran Lingkungan Digital
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
              Portal resmi pengelolaan Iuran Pemeliharaan Lingkungan (IPL) bagi warga dan pengurus
              Perumahan Saung Kebun secara transparan, aman, dan terisolasi per unit rumah.
            </p>
          </div>

          <div className="hidden lg:grid grid-cols-1 gap-4 mt-10 pt-8 border-t border-slate-800 max-w-md">
            <div>
              <p className="text-sm font-semibold text-white">Privasi Ketat (1 Akun = 1 Rumah)</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Setiap akun warga hanya dapat melihat status e-Card, riwayat setoran, dan e-Kwitansi
                milik unit rumahnya sendiri.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Siklus Tagihan Bulanan</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Nominal standar Rp 100.000/bulan · Terbit setiap tanggal 1 · Jatuh tempo tanggal 7.
              </p>
            </div>
          </div>
        </div>

        <footer className="relative z-10 mt-8 lg:mt-12 pt-5 border-t border-slate-800/80">
          <p className="text-xs text-slate-400 leading-relaxed">{KOP_RESMI}</p>
        </footer>
      </section>

      {/* Panel Form Login Tunggal */}
      <main className="flex-1 flex items-center justify-center p-5 sm:p-8 lg:p-14">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col lg:items-center lg:text-center">
            <BrandLogo size="lg" className="hidden lg:flex mb-4" />
            <h2 className="text-2xl font-bold text-[#0F172A] tracking-tight">Masuk ke Portal</h2>
            <p className="text-sm text-slate-500 mt-1">
              Pilih jenis akses dan masukkan kredensial yang terdaftar oleh Pengurus.
            </p>
          </div>

          {/* Switch Tab Portal Warga vs Portal Admin */}
          <div
            role="tablist"
            aria-label="Pilih Portal Masuk"
            className="grid grid-cols-2 gap-1.5 p-1.5 bg-slate-200/70 rounded-xl mb-6"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'warga'}
              onClick={() => handleTabSwitch('warga')}
              className={`min-h-[44px] flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                tab === 'warga'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <Home className="w-4 h-4 shrink-0" />
              <span>Portal Warga</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'admin'}
              onClick={() => handleTabSwitch('admin')}
              className={`min-h-[44px] flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                tab === 'admin'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Portal Admin</span>
            </button>
          </div>

          {/* Kartu Form */}
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
                htmlFor="login-username"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                {tab === 'warga' ? 'Username (Blok & No. Rumah)' : 'Username Admin / Pengurus'}
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={tab === 'warga' ? 'Contoh: B03/07' : 'Masukkan username pengurus'}
                className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 font-mono"
              />
              {tab === 'warga' && (
                <p className="text-xs text-slate-500 mt-1.5">
                  Gunakan format Blok dan Nomor Rumah sesuai data pengurus, misalnya <span className="font-mono text-slate-700">B03/07</span>.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="login-pin"
                className="block text-sm font-semibold text-[#0F172A] mb-1.5"
              >
                PIN Akses (6 Digit)
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="login-pin"
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="current-password"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-sm text-[#0F172A] placeholder:text-slate-400 tracking-[0.25em] font-mono focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((prev) => !prev)}
                  aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
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
              <span>{loading ? 'Memverifikasi...' : tab === 'warga' ? 'Masuk ke Portal Warga' : 'Masuk ke Portal Admin'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <p className="text-xs text-slate-500 text-center mt-5 leading-relaxed">
            Belum memiliki PIN atau lupa PIN akses? Silakan hubungi Pengurus Lingkungan di
            Sekretariat Blok B03/07 untuk mendapatkan PIN resmi rumah Anda.
          </p>
        </div>
      </main>
    </div>
  );
}
