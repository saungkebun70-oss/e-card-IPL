import React, { useEffect } from 'react';
import {
  CheckCircle2,
  Coins,
  Crown,
  FlaskConical,
  Shield,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import type { SessionUser } from '../types';
import {
  buildSimulationSession,
  type SimPresetRoleId,
} from '../lib/simulationStore';

interface SimulationRoleModalProps {
  open: boolean;
  onClose: () => void;
  onSelectSession: (session: SessionUser) => void;
  currentSession?: SessionUser | null;
}

interface RolePresetCard {
  id: SimPresetRoleId;
  badge: string;
  title: string;
  identity: string;
  description: string;
  accentClass: string;
  badgeClass: string;
  icon: React.ReactNode;
}

const ROLE_PRESETS: RolePresetCard[] = [
  {
    id: 'warga_lunas',
    badge: 'a. Warga • IPL Normal',
    title: 'Warga — Tes Bayar Normal',
    identity: 'Unit SIM/01 • A/n Simulasi Warga Lunas',
    description:
      'Uji upload bukti bayar Rp100.000 -> status e-Card otomatis berubah Hijau ("Lunas") dan masuk ke Kas IPL Reguler.',
    accentClass: 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50',
    badgeClass: 'bg-emerald-100 text-emerald-800',
    icon: <CheckCircle2 className="w-5 h-5 text-emerald-700" />,
  },
  {
    id: 'warga_darurat',
    badge: 'b. Warga • Dana Darurat',
    title: 'Warga — Tes Dana Darurat',
    identity: 'Unit SIM/02 • A/n Simulasi Dana Darurat',
    description:
      'Uji upload bukti bayar di bawah Rp100.000 (misal Rp50.000) -> otomatis dialihkan ke pos Dana Darurat warna Ungu ("Rp50rb • Darurat").',
    accentClass: 'border-purple-200 bg-purple-50/60 hover:bg-purple-50',
    badgeClass: 'bg-purple-100 text-purple-800',
    icon: <Coins className="w-5 h-5 text-purple-700" />,
  },
  {
    id: 'keamanan',
    badge: 'c. Keamanan • Patroli',
    title: 'Keamanan — Petugas Patroli',
    identity: 'Simulasi Petugas Keamanan',
    description:
      'Tampilkan jadwal shift (Pa Nurdenih, Pa Warta, Pa Sishantoyo), rute patroli 5 titik (Pos Utama - Checkpoint 5), dan chat Keamanan-Pengurus.',
    accentClass: 'border-sky-200 bg-sky-50/60 hover:bg-sky-50',
    badgeClass: 'bg-sky-100 text-sky-800',
    icon: <Shield className="w-5 h-5 text-sky-700" />,
  },
  {
    id: 'admin_bendahara',
    badge: 'd1. Pengurus • Bendahara',
    title: 'Pengurus — Bendahara (Bp Andriansyah)',
    identity: 'Bp Andriansyah • Akses Penuh',
    description:
      'Uji verifikasi Tahap 1 (ACC Bendahara), simulasi tanggal penagihan, LPJ/Laporan Bulanan, dan kontrol penuh penghapusan Mode Simulasi.',
    accentClass: 'border-amber-200 bg-amber-50/60 hover:bg-amber-50',
    badgeClass: 'bg-amber-100 text-amber-800',
    icon: <Wallet className="w-5 h-5 text-amber-700" />,
  },
  {
    id: 'admin_ketua',
    badge: 'd2. Pengurus • Ketua',
    title: 'Pengurus — Ketua (Bp Erlangga)',
    identity: 'Bp Erlangga • Otoritas Stempel Final',
    description:
      'Uji verifikasi Tahap 2 (Stempel Final Ketua untuk mengesahkan setoran yang telah di-ACC Bendahara), serta ringkasan eksekutif LPJ.',
    accentClass: 'border-[#C9D6C4] bg-[#F4F7F2] hover:bg-[#EAF1E6]',
    badgeClass: 'bg-[#E2EDE0] text-[#243825]',
    icon: <Crown className="w-5 h-5 text-[#243825]" />,
  },
];

export const SimulationRoleModal: React.FC<SimulationRoleModalProps> = ({
  open,
  onClose,
  onSelectSession,
  currentSession,
}) => {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!open) {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    };
  }, [open]);

  if (!open) return null;

  const isCurrentPreset = (presetId: SimPresetRoleId): boolean => {
    if (!currentSession?.is_simulation) return false;
    switch (presetId) {
      case 'warga_lunas':
        return currentSession.role === 'warga' && currentSession.blok_rumah === 'SIM/01';
      case 'warga_darurat':
        return currentSession.role === 'warga' && currentSession.blok_rumah === 'SIM/02';
      case 'keamanan':
        return currentSession.role === 'petugas';
      case 'admin_bendahara':
        return currentSession.role === 'admin' && currentSession.blok_rumah === 'andriansyah';
      case 'admin_ketua':
        return currentSession.role === 'admin' && currentSession.blok_rumah === 'erlangga';
    }
  };

  const handleCloseModal = () => {
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sim-role-modal-title"
      onClick={handleCloseModal}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#FAF9F5] border border-[#E2E6DC] shadow-2xl p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#E5ECE3] text-[#243825] flex items-center justify-center shrink-0">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="sim-role-modal-title"
                className="text-lg font-bold text-[#1B271B] leading-snug"
              >
                Pilih Peran Mode Simulasi (1-Tap Login)
              </h2>
              <p className="text-xs text-[#5B685B] mt-0.5 leading-relaxed">
                Berjalan 100% di memori browser tanpa PIN dan tanpa mengubah data Supabase.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="w-10 h-10 rounded-full bg-[#EFECE3] text-[#3E4C3E] hover:bg-[#E4E0D4] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
            aria-label="Tutup pilihan peran simulasi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {ROLE_PRESETS.map((preset) => {
            const active = isCurrentPreset(preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  if (typeof document !== 'undefined') {
                    document.body.style.overflow = 'auto';
                    document.documentElement.style.overflow = 'auto';
                  }
                  const nextSession = buildSimulationSession(preset.id);
                  onClose();
                  onSelectSession(nextSession);
                }}
                className={`w-full text-left rounded-2xl border p-3.5 sm:p-4 transition-colors cursor-pointer ${
                  preset.accentClass
                } ${active ? 'ring-2 ring-[#2B3F29] ring-offset-1' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-white/90 border border-black/5 flex items-center justify-center shrink-0 shadow-xs mt-0.5">
                    {preset.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${preset.badgeClass}`}
                      >
                        {preset.badge}
                      </span>
                      {active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#243825]">
                          <UserCheck className="w-3.5 h-3.5" />
                          Sedang Aktif
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-[#2B3F29] whitespace-nowrap">
                          Masuk 1-Tap &rarr;
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-bold text-[#1B271B] mt-1">{preset.title}</p>
                    <p className="text-xs font-semibold text-[#4B584B]">{preset.identity}</p>
                    <p className="text-xs text-[#5E6B5E] mt-1 leading-relaxed">
                      {preset.description}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
