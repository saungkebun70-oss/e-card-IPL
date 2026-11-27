import { useState } from 'react';
import {
  LogOut,
  ShieldCheck,
  Home,
  Phone,
  User,
  Building2,
  Bot,
  BookOpen,
} from 'lucide-react';
import { Icon3D } from '../Icon3D';
import { type SessionUser, type Warga } from '../../types';
import { buildWhatsAppLink, formatBlokRumah, formatRupiah } from '../../lib/format';
import { useAppBrand } from '../../lib/brandContext';
import { PanduanBotWaModal } from './PanduanBotWaModal';
import { PanduanAplikasiModal } from './PanduanAplikasiModal';
import { ProfileAvatarEditor } from '../ProfileAvatarEditor';
import { ThemePicker } from '../ThemePicker';
import { NotificationSettingsCard } from '../NotificationSettingsCard';
import { BugReportCard } from '../BugReportCard';

interface WargaProfilSlideProps {
  session: SessionUser;
  profil: Warga;
  onAvatarUpdated: (nextUrl: string | null) => void;
  onGoToBeranda?: () => void;
  onOpenLingkungan?: () => void;
  onGoToSetor?: () => void;
  onGoToRiwayat?: () => void;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
  onLogout: () => void;
}

export function WargaProfilSlide({
  session,
  profil,
  onAvatarUpdated,
  onGoToBeranda,
  onOpenLingkungan,
  onGoToSetor,
  onGoToRiwayat,
  onToast,
  onLogout,
}: WargaProfilSlideProps) {
  const { brand } = useAppBrand();
  const [panduanWaOpen, setPanduanWaOpen] = useState(false);
  const [panduanAppOpen, setPanduanAppOpen] = useState(false);
  const displayBlok = formatBlokRumah(profil.blok_rumah);
  const waMessage = `Halo ${brand.wa_pengurus_label || 'Pengurus Lingkungan Perumahan Saung Kebun'}, saya ${profil.nama_warga} dari Blok ${displayBlok} ingin mengajukan bantuan terkait PIN / perubahan nomor WhatsApp pada portal ${brand.app_name}.`;
  const waHref = buildWhatsAppLink(brand.wa_pengurus, waMessage);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Kolom Kiri: Data Profil Rumah & Tema Tampilan */}
      <div className="lg:col-span-7 space-y-6">
        <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-[#E6E2D6] bg-[#F7F4EC]">
            <ProfileAvatarEditor
              session={session}
              avatarUrl={profil.avatar_url ?? session.avatar_url ?? null}
              subtitle={`Blok ${displayBlok} · Status ${profil.status_hunian}`}
              onAvatarUpdated={onAvatarUpdated}
              onToast={onToast}
            />
          </div>

          <dl className="divide-y divide-[#E6E2D6] px-5 sm:px-6 text-sm">
            <div className="py-3.5 flex items-center justify-between gap-4">
              <dt className="text-[#6E786D] flex items-center gap-2">
                <User className="w-4 h-4 text-[#2B3F29]" />
                Nama Kepala Keluarga
              </dt>
              <dd className="font-semibold text-[#1B271B] text-right">{profil.nama_warga}</dd>
            </div>
            <div className="py-3.5 flex items-center justify-between gap-4">
              <dt className="text-[#6E786D] flex items-center gap-2">
                <Home className="w-4 h-4 text-[#2B3F29]" />
                Blok / No. Rumah
              </dt>
              <dd className="font-mono font-bold text-[#1B271B] text-right">{displayBlok}</dd>
            </div>
            <div className="py-3.5 flex items-center justify-between gap-4">
              <dt className="text-[#6E786D]">Status Hunian</dt>
              <dd className="font-semibold text-[#1B271B] text-right">{profil.status_hunian}</dd>
            </div>
            <div className="py-3.5 flex items-center justify-between gap-4">
              <dt className="text-[#6E786D] flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#2B3F29]" />
                Nomor WhatsApp Terdaftar
              </dt>
              <dd className="font-mono font-semibold text-[#1B271B] text-right tabular-nums">
                +{profil.no_wa}
              </dd>
            </div>
            <div className="py-3.5 flex items-center justify-between gap-4">
              <dt className="text-[#6E786D]">Iuran Wajib Bulanan</dt>
              <dd className="font-mono font-bold text-[#243825] text-right tabular-nums">
                {formatRupiah(profil.nominal_iuran)} / bulan
              </dd>
            </div>
          </dl>
        </section>

        {/* Pemilih Tema Tampilan */}
        <section
          aria-label="Tema Tampilan"
          className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5 sm:p-6"
        >
          <ThemePicker onToast={onToast} />
        </section>

        {/* Pengaturan Notifikasi, Suara & Getaran */}
        <section
          aria-label="Pengaturan Notifikasi, Suara & Getaran"
          className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5 sm:p-6"
        >
          <NotificationSettingsCard session={session} onToast={onToast} />
        </section>

        {/* Pelaporan Bug Cepat */}
        <section
          aria-label="Pelaporan Bug Cepat"
          className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5 sm:p-6"
        >
          <BugReportCard session={session} onToast={onToast} />
        </section>
      </div>

      {/* Keamanan Akun & Bantuan Pengurus */}
      <section className="lg:col-span-5 glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#2B3F29] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-serif-brand font-bold text-[#1B271B]">
              Keamanan &amp; Privasi Akun
            </h3>
            <p className="text-xs text-[#4A554A] mt-1 leading-relaxed">
              Akun ini terkunci secara eksklusif untuk unit{' '}
              <span className="font-mono font-semibold text-[#1B271B]">{displayBlok}</span>. Demi keamanan
              data warga, permintaan reset PIN 6 digit atau pembaruan nomor WhatsApp diproses
              langsung oleh Pengurus Lingkungan.
            </p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          {onOpenLingkungan && (
            <button
              type="button"
              onClick={onOpenLingkungan}
              className="w-full min-h-[46px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-[#1B271B] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Building2 className="w-4 h-4 text-[#2B3F29]" />
              <span>Lihat Profil Lingkungan &amp; Pengurus</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setPanduanAppOpen(true)}
            className="w-full min-h-[46px] rounded-full border border-[#C6D2BF] bg-[#E5EEE3]/70 hover:bg-[#E5EEE3] text-[#243825] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-[#243825]" />
            <span>Panduan Aplikasi (Warga Baru)</span>
          </button>

          <button
            type="button"
            onClick={() => setPanduanWaOpen(true)}
            className="w-full min-h-[46px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-[#1B271B] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Bot className="w-4 h-4 text-[#2B3F29]" />
            <span>Panduan Bot WA Warga</span>
          </button>

          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[52px] px-4 py-2.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] font-semibold text-sm flex flex-col items-center justify-center transition-colors text-center shadow-sm"
          >
            <span className="inline-flex items-center gap-2">
              <Icon3D name="kirim_wa" className="w-4 h-4 rounded-sm shrink-0" />
              <span>Hubungi Pengurus via WhatsApp</span>
            </span>
            <span className="text-[11px] font-normal text-[#E5EEE3]/85 mt-0.5">
              {brand.wa_pengurus_label} · <span className="font-mono">+{brand.wa_pengurus}</span>
            </span>
          </a>

          <button
            type="button"
            onClick={onLogout}
            className="w-full min-h-[46px] rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#A44831] font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Keluar (Logout)</span>
          </button>
        </div>

        <p className="text-[11px] text-[#6E786D] pt-3 border-t border-[#E6E2D6] leading-relaxed">
          {brand.kop_resmi}
        </p>
      </section>

      <PanduanAplikasiModal
        open={panduanAppOpen}
        onClose={() => setPanduanAppOpen(false)}
        profil={profil}
        onGoToBeranda={onGoToBeranda}
        onGoToSetor={onGoToSetor}
        onGoToRiwayat={onGoToRiwayat}
        onOpenLingkungan={onOpenLingkungan}
      />

      <PanduanBotWaModal
        open={panduanWaOpen}
        onClose={() => setPanduanWaOpen(false)}
        profil={profil}
        onGoToSetor={onGoToSetor}
        onToast={onToast}
      />
    </div>
  );
}
