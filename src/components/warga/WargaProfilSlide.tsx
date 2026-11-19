import { MessageCircle, LogOut, ShieldCheck, Home, Phone, User } from 'lucide-react';
import { KOP_RESMI, WA_PENGURUS, type Warga } from '../../types';
import { buildWhatsAppLink, formatRupiah } from '../../lib/format';

interface WargaProfilSlideProps {
  profil: Warga;
  onLogout: () => void;
}

export function WargaProfilSlide({ profil, onLogout }: WargaProfilSlideProps) {
  const waMessage = `Halo Pengurus Lingkungan Perumahan Saung Kebun, saya ${profil.nama_warga} dari Blok ${profil.blok_rumah} ingin mengajukan bantuan terkait PIN / perubahan nomor WhatsApp pada portal e-Card IPL Digital.`;
  const waHref = buildWhatsAppLink(WA_PENGURUS, waMessage);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Data Profil Rumah */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-slate-200 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-[#059669]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#0F172A] truncate">{profil.nama_warga}</h2>
            <p className="text-xs text-slate-500">
              Blok <span className="font-mono font-semibold text-slate-700">{profil.blok_rumah}</span> · Status {profil.status_hunian}
            </p>
          </div>
        </div>

        <dl className="divide-y divide-slate-100 px-5 sm:px-6 text-sm">
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-slate-500 flex items-center gap-2">
              <User className="w-4 h-4 text-slate-400" />
              Nama Kepala Keluarga
            </dt>
            <dd className="font-semibold text-[#0F172A] text-right">{profil.nama_warga}</dd>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-slate-500 flex items-center gap-2">
              <Home className="w-4 h-4 text-slate-400" />
              Blok / No. Rumah
            </dt>
            <dd className="font-mono font-bold text-[#0F172A] text-right">{profil.blok_rumah}</dd>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-slate-500">Status Hunian</dt>
            <dd className="font-semibold text-[#0F172A] text-right">{profil.status_hunian}</dd>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-slate-500 flex items-center gap-2">
              <Phone className="w-4 h-4 text-slate-400" />
              Nomor WhatsApp Terdaftar
            </dt>
            <dd className="font-mono font-semibold text-[#0F172A] text-right tabular-nums">
              +{profil.no_wa}
            </dd>
          </div>
          <div className="py-3.5 flex items-center justify-between gap-4">
            <dt className="text-slate-500">Iuran Wajib Bulanan</dt>
            <dd className="font-mono font-bold text-emerald-700 text-right tabular-nums">
              {formatRupiah(profil.nominal_iuran)} / bulan
            </dd>
          </div>
        </dl>
      </section>

      {/* Keamanan Akun & Bantuan Pengurus */}
      <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#059669] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-bold text-[#0F172A]">Keamanan &amp; Privasi Akun</h3>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Akun ini terkunci secara eksklusif untuk unit{' '}
              <span className="font-mono font-semibold">{profil.blok_rumah}</span>. Demi keamanan
              data warga, permintaan reset PIN 6 digit atau pembaruan nomor WhatsApp diproses
              langsung oleh Pengurus Lingkungan.
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[48px] rounded-xl bg-[#059669] hover:bg-emerald-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Hubungi Pengurus via WhatsApp</span>
          </a>

          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[46px] rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar (Logout)</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-400 pt-3 border-t border-slate-100 leading-relaxed">
          {KOP_RESMI}
        </p>
      </section>
    </div>
  );
}
