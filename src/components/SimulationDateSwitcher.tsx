import React from 'react';
import { CalendarClock } from 'lucide-react';
import { useSimulation } from '../lib/simulationContext';
import type { SimDateOption } from '../lib/simulationStore';

interface SimulationDateSwitcherProps {
  compact?: boolean;
  className?: string;
}

const DATE_OPTIONS: {
  iso: SimDateOption;
  label: string;
  hint: string;
  activeClass: string;
}[] = [
  {
    iso: '2026-11-28',
    label: '28 Nov 2026 (Bulan Berjalan)',
    hint: 'Nov abu-abu Berjalan, Menunggak = 0',
    activeClass: 'bg-[#2B3F29] text-white border-[#2B3F29] shadow-xs',
  },
  {
    iso: '2026-12-05',
    label: '5 Des 2026 (Masa Tagih Tgl 1-7)',
    hint: 'Nov kuning Masa Tagih, Menunggak = 0',
    activeClass: 'bg-amber-600 text-white border-amber-600 shadow-xs',
  },
  {
    iso: '2026-12-10',
    label: '10 Des 2026 (Lewat Tgl 7)',
    hint: 'Nov belum bayar menjadi merah Tunggak',
    activeClass: 'bg-rose-600 text-white border-rose-600 shadow-xs',
  },
];

export const SimulationDateSwitcher: React.FC<SimulationDateSwitcherProps> = ({
  compact = false,
  className = '',
}) => {
  const { simDateIso, setSimDateIso } = useSimulation();
  const activeMeta = DATE_OPTIONS.find((d) => d.iso === simDateIso) || DATE_OPTIONS[0];

  return (
    <div
      className={`rounded-2xl border border-[#DCE3D7] bg-[#F4F6EF] p-2.5 sm:p-3.5 no-print ${className}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-[#E4ECE1] text-[#243825] flex items-center justify-center shrink-0">
          <CalendarClock className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#1B271B] leading-tight">
            Simulator Tanggal Tagihan (Demo Jatuh Tempo)
          </p>
          {!compact && (
            <p className="text-[11px] text-[#5B685B] leading-snug mt-0.5">
              Efek aktif: <span className="font-semibold text-[#243825]">{activeMeta.hint}</span>
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 sm:gap-2">
        {DATE_OPTIONS.map((opt) => {
          const isSelected = simDateIso === opt.iso;
          return (
            <button
              key={opt.iso}
              type="button"
              onClick={() => setSimDateIso(opt.iso)}
              className={`min-h-[38px] px-3 py-1.5 rounded-xl border text-xs font-bold transition-colors text-left sm:text-center cursor-pointer ${
                isSelected
                  ? opt.activeClass
                  : 'bg-white text-[#2F3E2F] border-[#DDE3D7] hover:bg-[#EDF1E8]'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
