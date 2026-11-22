import React, { useState } from 'react';
import {
  Eye,
  EyeOff,
  Home,
  Lock,
  ArrowRight,
  AlertCircle,
  ShieldCheck,
  Shield,
} from 'lucide-react';
import { type SessionUser } from '../types';
import { loginWargaAccount } from '../lib/dataService';
import { useAppBrand } from '../lib/brandContext';
import { BrandLogo } from './BrandLogo';
import { AppVersionFooter } from './AppUpdateSystem';

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const result = await loginWargaAccount(username, pin);
      if (result.error || !result.data) {
        setErrorMsg(result.error || 'Blok rumah atau PIN 6 digit tidak sesuai.');
      } else {
        onLoginSuccess(result.data);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Panel Identitas Portal Warga */}
      <section className="bg-[#0F172A] text-white lg:w-[46%] xl:w-[44%] flex flex-col justify-between px-6 pb-6 sm:px-10 sm:pb-10 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1.5rem)] lg:p-14 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-emerald-600/15 blur-3xl"
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
                Portal Warga · {brand.app_subtitle}
              </p>
            </div>
          </div>

          <div className="mt-7 lg:mt-12 max-w-md">
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white leading-tight [text-wrap:balance]">
              Cek e-Card &amp; Setor IPL Digital Unit Anda
            </h1>
            <p className="mt-4 text-sm sm:text-base text-slate-300 leading-relaxed">
              Pantau status pembayaran Iuran Pemeliharaan Lingkungan (IPL) 12 bulan, setor via
              QRIS, transfer, atau titip pengurus, dan unduh kwitansi digital resmi rumah Anda.
            </p>
          </div>

          <div className="hidden lg:grid grid-cols-1 gap-4 mt-10 pt-8 border-t border-slate-800 max-w-md">
            <div>
              <p className="text-sm font-semibold text-white">Privasi Ketat (1 Akun = 1 Rumah)</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Akun warga terkunci eksklusif untuk satu unit rumah dan tidak dapat melihat data
                atau tagihan unit warga lainnya.
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
          <p className="text-xs text-slate-400 leading-relaxed">{brand.kop_resmi}</p>
        </footer>
      </section>

      {/* Form Login Khusus Warga */}
      <main className="flex-1 flex items-center justify-center p-5 sm:p-8 lg:p-14">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col lg:items-center lg:text-center">
            <BrandLogo size="lg" className="hidden lg:flex mb-4" />
            <p className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1.5">
              <Home className="w-3.5 h-3.5" />
              <span>Halaman Masuk Khusus Warga</span>
            </p>
            <h2 className="text-2xl font-bold text-[#0F172A] tracking-tight mt-1">
              Masuk ke Portal Warga
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Masukkan Blok/No. Rumah dan PIN 6 digit resmi rumah Anda.
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
                className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20 font-mono uppercase"
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
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-sm text-[#0F172A] placeholder:text-slate-400 tracking-[0.25em] font-mono focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
              className="w-full min-h-[48px] rounded-xl bg-[#059669] hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <span>{loading ? 'Memverifikasi...' : 'Masuk ke Portal Warga'}</span>
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {/* Opsi Akses Khusus Pengurus / Admin & Petugas Keamanan */}
          {onSwitchPortal && (
            <div className="mt-5 pt-5 border-t border-slate-200 space-y-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 text-center">
                Akses Portal Khusus Pengurus &amp; Keamanan
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onSwitchPortal('admin')}
                  className="min-h-[46px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.99] text-left flex items-center gap-2.5 transition cursor-pointer shadow-2xs"
                >
                  <div className="w-8 h-8 rounded-lg bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0">
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
                  className="min-h-[46px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50/50 active:scale-[0.99] text-left flex items-center gap-2.5 transition cursor-pointer shadow-2xs"
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-[#059669] flex items-center justify-center shrink-0">
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

          <AppVersionFooter className="mt-4 pt-3.5 pb-safe border-t border-slate-200/80" />
        </div>
      </main>
    </div>
  );
}
