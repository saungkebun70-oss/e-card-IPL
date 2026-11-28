import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  FlaskConical,
  LogOut,
  RotateCcw,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { isBendaharaOnly, type SessionUser } from '../types';

interface SimulationTopBarProps {
  session: SessionUser;
  onOpenRolePicker: () => void;
  onExitDemo: () => void;
  onResetSimData?: () => void;
  onWipeAndDisable: () => void;
}

function formatRoleLabel(session: SessionUser): string {
  if (session.role === 'petugas') {
    return 'Petugas Patroli';
  }
  if (session.role === 'admin') {
    return `${session.jabatan || 'Pengurus'} · ${session.nama_warga}`;
  }
  return `Warga ${session.blok_rumah}`;
}

export const SimulationTopBar: React.FC<SimulationTopBarProps> = ({
  session,
  onOpenRolePicker,
  onExitDemo,
  onResetSimData,
  onWipeAndDisable,
}) => {
  const [confirmWipeOpen, setConfirmWipeOpen] = useState(false);
  const isBendahara = isBendaharaOnly(session);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!confirmWipeOpen) {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    }
    return () => {
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    };
  }, [confirmWipeOpen]);

  if (!session.is_simulation) return null;

  return (
    <>
      <div
        role="region"
        aria-label="Status Mode Simulasi Aktif"
        className="sticky top-0 z-[55] w-full bg-[#192B1B] text-[#FFFDF8] border-b border-white/15 shadow-sm no-print"
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2 lg:py-0 lg:min-h-[48px] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#E5EEE3]/15 border border-white/20 text-[#D9F0D3] flex items-center justify-center shrink-0">
              <FlaskConical className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] sm:text-xs font-extrabold tracking-tight text-[#FFFDF8] truncate">
                MODE SIMULASI AKTIF (Data sementara, tidak masuk Supabase)
              </p>
              <p className="text-[10px] text-[#CBE0C6] truncate sm:hidden">
                Peran aktif: {formatRoleLabel(session)}
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-md bg-white/12 border border-white/15 text-[11px] font-bold text-[#E7F3E4] whitespace-nowrap shrink-0">
              {formatRoleLabel(session)}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full lg:w-auto max-w-full">
            <button
              type="button"
              onClick={onOpenRolePicker}
              className="min-h-[32px] px-2.5 sm:px-3 rounded-lg bg-white/14 hover:bg-white/22 border border-white/20 text-[#FFFDF8] text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              <span>Ganti Peran</span>
            </button>

            {onResetSimData && (
              <button
                type="button"
                onClick={onResetSimData}
                title="Kembalikan data demo ke kondisi awal"
                className="min-h-[32px] px-2.5 rounded-lg bg-white/10 hover:bg-white/18 border border-white/15 text-[#E5EEE3] text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden md:inline">Reset Demo</span>
              </button>
            )}

            {isBendahara && (
              <button
                type="button"
                onClick={() => setConfirmWipeOpen(true)}
                className="min-h-[32px] px-2.5 sm:px-3 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span className="sm:hidden">Hapus &amp; Tutup Simulasi</span>
                <span className="hidden sm:inline">Hapus Data &amp; Tutup Mode Simulasi</span>
              </button>
            )}

            <button
              type="button"
              onClick={onExitDemo}
              className="min-h-[32px] px-2.5 sm:px-3 rounded-lg bg-[#E5EEE3] hover:bg-white text-[#1B271B] text-[11px] font-bold inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5 shrink-0" />
              <span>Keluar Demo</span>
            </button>
          </div>
        </div>
      </div>

      {confirmWipeOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/60"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-wipe-sim-title"
          onClick={() => setConfirmWipeOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-[#FAF9F5] border border-rose-200 shadow-2xl p-5 sm:p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <button
                type="button"
                onClick={() => setConfirmWipeOpen(false)}
                className="w-9 h-9 rounded-full bg-[#EFECE3] text-[#3E4C3E] hover:bg-[#E4E0D4] flex items-center justify-center cursor-pointer"
                aria-label="Batal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <h3
              id="confirm-wipe-sim-title"
              className="text-base font-bold text-[#1B271B] mt-3 leading-snug"
            >
              Konfirmasi Penutupan Mode Simulasi
            </h3>
            <p className="text-sm text-[#4A554A] mt-2 leading-relaxed">
              Hapus seluruh data simulasi dan nonaktifkan tombol simulasi di halaman login?
            </p>
            <p className="text-xs text-[#6B776B] mt-2 leading-relaxed">
              Data simulasi hanya tersimpan di browser ini dan dapat diaktifkan kembali kapan saja
              dari menu Pengaturan Bendahara.
            </p>

            <div className="mt-5 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmWipeOpen(false)}
                className="min-h-[42px] px-4 rounded-xl border border-[#D7DDD2] bg-white hover:bg-[#F3F5F0] text-xs font-bold text-[#2F3E2F] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmWipeOpen(false);
                  onWipeAndDisable();
                }}
                className="min-h-[42px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                <span>Ya, Hapus &amp; Nonaktifkan</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
