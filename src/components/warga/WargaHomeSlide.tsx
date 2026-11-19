import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  ArrowRight,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import {
  BULAN_LIST,
  KOP_RESMI,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  TANGGAL_TERBIT_TAGIHAN,
  type StatusBulanEcard,
  type StatusEcardBulanan,
  type Warga,
} from '../../types';
import { formatRupiah, getCurrentBillingMonth, getNamaBulan } from '../../lib/format';

interface WargaHomeSlideProps {
  profil: Warga;
  statusBulanan: StatusEcardBulanan[];
  onQuickPayMonth: (bulan: number) => void;
}

function getMonthCellStyles(status: StatusBulanEcard) {
  switch (status) {
    case 'Lunas':
      return {
        box: 'bg-emerald-50 border-emerald-200 text-emerald-900',
        label: 'Lunas',
        labelColor: 'text-emerald-700',
        icon: CheckCircle2,
      };
    case 'Menunggu Verifikasi':
      return {
        box: 'bg-amber-50 border-amber-200 text-amber-900',
        label: 'Menunggu',
        labelColor: 'text-amber-700',
        icon: Clock,
      };
    case 'Jatuh Tempo':
    case 'Belum Bayar':
      return {
        box: 'bg-red-50 border-red-200 text-red-900 hover:border-red-400',
        label: status === 'Jatuh Tempo' ? 'Jatuh Tempo' : 'Belum Bayar',
        labelColor: 'text-red-700',
        icon: AlertTriangle,
      };
    default:
      return {
        box: 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300',
        label: 'Belum Tagihan',
        labelColor: 'text-slate-500',
        icon: Calendar,
      };
  }
}

export function WargaHomeSlide({
  profil,
  statusBulanan,
  onQuickPayMonth,
}: WargaHomeSlideProps) {
  const currentMonth = getCurrentBillingMonth();
  const currentMonthName = getNamaBulan(currentMonth);

  const currentStatusObj = statusBulanan.find((s) => s.bulan === currentMonth);
  const rawCurrentStatus = currentStatusObj?.status || 'Belum Bayar';

  const ecardBadge =
    rawCurrentStatus === 'Lunas'
      ? {
          text: 'LUNAS',
          bg: 'bg-emerald-500 text-white',
          icon: CheckCircle2,
        }
      : rawCurrentStatus === 'Menunggu Verifikasi'
        ? {
            text: 'MENUNGGU VERIFIKASI',
            bg: 'bg-amber-500 text-slate-950',
            icon: Clock,
          }
        : {
            text: 'BELUM BAYAR',
            bg: 'bg-red-600 text-white',
            icon: AlertTriangle,
          };

  const BadgeIcon = ecardBadge.icon;
  const jumlahLunas = statusBulanan.filter((s) => s.status === 'Lunas').length;
  const jumlahTunggakan = statusBulanan.filter(
    (s) => s.status === 'Jatuh Tempo' || s.status === 'Belum Bayar'
  ).length;

  return (
    <div className="space-y-6">
      {/* Baris Atas: e-Card Verifikasi (Focal Anchor) + Ringkasan Siklus Tagihan */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* e-Card Verifikasi Digital */}
        <section className="lg:col-span-7 rounded-2xl bg-[#0F172A] text-white p-6 sm:p-7 relative overflow-hidden flex flex-col justify-between min-h-[248px]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full bg-emerald-600/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-1.5 bg-[#059669]"
          />

          {/* Header Kartu */}
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight text-white">e-Card Verifikasi IPL</p>
                <p className="text-xs text-slate-400">Perumahan Saung Kebun · Tahun {TAHUN_AKTIF}</p>
              </div>
            </div>
            <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
          </div>

          {/* Identitas Utama Rumah */}
          <div className="relative z-10 mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-400">Nama Kepala Keluarga</p>
              <p className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
                {profil.nama_warga}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs text-slate-400">Blok / No. Rumah</p>
              <p className="text-2xl sm:text-3xl font-bold font-mono text-emerald-400 tracking-tight tabular-nums mt-0.5">
                {profil.blok_rumah}
              </p>
            </div>
          </div>

          {/* Footer Kartu: Status Hunian + Badge Bulan Berjalan */}
          <div className="relative z-10 mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <span>Status Hunian:</span>
              <span className="font-semibold text-white">{profil.status_hunian}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>Periode {currentMonthName} {TAHUN_AKTIF}</span>
            </div>

            <div
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide whitespace-nowrap ${ecardBadge.bg}`}
            >
              <BadgeIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{ecardBadge.text}</span>
            </div>
          </div>
        </section>

        {/* Panel Info Siklus Tagihan */}
        <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Informasi Siklus Tagihan IPL</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{KOP_RESMI}</p>

            <dl className="mt-5 divide-y divide-slate-100 text-sm">
              <div className="py-2.5 flex items-center justify-between gap-4">
                <dt className="text-slate-600">Nominal Standar IPL</dt>
                <dd className="font-mono font-bold text-[#0F172A] tabular-nums">
                  {formatRupiah(profil.nominal_iuran || NOMINAL_IPL_STANDAR)} / bln
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-4">
                <dt className="text-slate-600">Terbit Tagihan</dt>
                <dd className="font-semibold text-[#0F172A] tabular-nums">
                  Tanggal {TANGGAL_TERBIT_TAGIHAN} setiap bulan
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-4">
                <dt className="text-slate-600">Batas Jatuh Tempo</dt>
                <dd className="font-semibold text-red-700 tabular-nums">
                  Tanggal {TANGGAL_JATUH_TEMPO} setiap bulan
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-4">
                <dt className="text-slate-600">Rekap Tahun {TAHUN_AKTIF}</dt>
                <dd className="font-mono text-xs font-semibold tabular-nums">
                  <span className="text-emerald-700">{jumlahLunas} Lunas</span>
                  <span className="text-slate-300 mx-1.5">/</span>
                  <span className={jumlahTunggakan > 0 ? 'text-red-700' : 'text-slate-600'}>
                    {jumlahTunggakan} Belum Bayar
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          {rawCurrentStatus !== 'Lunas' && rawCurrentStatus !== 'Menunggu Verifikasi' && (
            <button
              type="button"
              onClick={() => onQuickPayMonth(currentMonth)}
              className="mt-5 w-full min-h-[44px] rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <span>Setor Iuran {currentMonthName} Sekarang</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </aside>
      </div>

      {/* Matriks Status 12 Bulan (Januari – Desember 2026) */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-[#0F172A]">
              Matriks Status 12 Bulan ({TAHUN_AKTIF})
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Ketuk bulan yang belum lunas untuk langsung menyetor iuran.
            </p>
          </div>

          {/* Legenda Status (warna + teks eksplisit) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600" />
              Lunas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />
              Menunggu Verifikasi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-600" />
              Jatuh Tempo / Belum Bayar
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-300" />
              Belum Tagihan
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {BULAN_LIST.map((b) => {
            const stObj = statusBulanan.find((s) => s.bulan === b.angka);
            const status: StatusBulanEcard = stObj?.status || 'Belum Tagihan';
            const style = getMonthCellStyles(status);
            const CellIcon = style.icon;
            const canClick = status !== 'Lunas' && status !== 'Menunggu Verifikasi';
            const isCurrent = b.angka === currentMonth;

            return (
              <button
                key={b.angka}
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onQuickPayMonth(b.angka)}
                className={`text-left rounded-xl border p-3.5 transition-all min-h-[88px] flex flex-col justify-between ${style.box} ${
                  canClick ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'
                } ${isCurrent ? 'ring-2 ring-[#0F172A]/20' : ''}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-bold">{b.singkat}</span>
                  <CellIcon className={`w-4 h-4 shrink-0 ${style.labelColor}`} />
                </div>
                <div className="mt-2">
                  <p className={`text-[11px] font-semibold leading-tight ${style.labelColor}`}>
                    {style.label}
                  </p>
                  <p className="text-[10px] opacity-70 font-mono tabular-nums mt-0.5">
                    {b.nama}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
