import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  ArrowRight,
  ShieldCheck,
  Building2,
  Megaphone,
  Check,
  Bot,
} from 'lucide-react';
import {
  BULAN_LIST,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  TANGGAL_TERBIT_TAGIHAN,
  type StatusBulanEcard,
  type StatusEcardBulanan,
  type SystemNotification,
  type Warga,
} from '../../types';
import {
  formatRupiah,
  formatTanggalWaktu,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import { useAppBrand } from '../../lib/brandContext';

import { PanduanBotWaModal } from './PanduanBotWaModal';

interface WargaHomeSlideProps {
  profil: Warga;
  statusBulanan: StatusEcardBulanan[];
  notifications: SystemNotification[];
  onQuickPayMonth: (bulan: number) => void;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

function loadReadNotificationIds(blokRumah: string): string[] {
  try {
    const raw = localStorage.getItem(`saungkebun_notif_read_v1:${blokRumah}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  notifications,
  onQuickPayMonth,
  onToast,
}: WargaHomeSlideProps) {
  const { brand } = useAppBrand();
  const [readIds, setReadIds] = useState<string[]>(() =>
    loadReadNotificationIds(profil.blok_rumah)
  );
  const [showReadHistory, setShowReadHistory] = useState(false);
  const [panduanWaOpen, setPanduanWaOpen] = useState(false);

  const markAsRead = (notifId: string) => {
    setReadIds((prev) => {
      if (prev.includes(notifId)) return prev;
      const next = [...prev, notifId];
      try {
        localStorage.setItem(
          `saungkebun_notif_read_v1:${profil.blok_rumah}`,
          JSON.stringify(next.slice(-100))
        );
      } catch {
        // Abaikan jika penyimpanan penuh
      }
      return next;
    });
  };

  const unreadNotifications = notifications.filter((n) => !readIds.includes(n.id));
  const displayedNotifications = showReadHistory ? notifications.slice(0, 5) : unreadNotifications.slice(0, 3);

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
      {/* Pengumuman / Pesan Sistem Resmi dari Pengurus */}
      {notifications.length > 0 && (
        <section
          aria-label="Pengumuman Pengurus Lingkungan"
          className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
              <Megaphone className="w-4 h-4 text-[#059669] shrink-0" />
              <span>Pengumuman Pengurus</span>
              {unreadNotifications.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-300 font-normal">·</span>
                  <span className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
                    {unreadNotifications.length} baru
                  </span>
                </>
              )}
            </div>
            {notifications.length > unreadNotifications.length && (
              <button
                type="button"
                onClick={() => setShowReadHistory((v) => !v)}
                className="text-xs font-semibold text-slate-600 hover:text-[#0F172A] cursor-pointer whitespace-nowrap"
              >
                {showReadHistory
                  ? 'Sembunyikan yang sudah dibaca'
                  : `Lihat semua (${notifications.length})`}
              </button>
            )}
          </div>

          {displayedNotifications.length === 0 ? (
            <div className="px-5 py-3.5 text-xs text-slate-500 flex items-center justify-between gap-2">
              <span>Semua pengumuman terbaru sudah Anda baca.</span>
              <button
                type="button"
                onClick={() => setShowReadHistory(true)}
                className="font-semibold text-emerald-700 hover:underline cursor-pointer whitespace-nowrap"
              >
                Lihat arsip
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {displayedNotifications.map((notif) => {
                const isRead = readIds.includes(notif.id);
                return (
                  <article
                    key={notif.id}
                    className={`px-5 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                      isRead ? 'bg-slate-50/50' : 'bg-white'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                        <span className="font-semibold text-emerald-700">{notif.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatTanggalWaktu(notif.created_at)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {notif.sender_name} ({notif.sender_jabatan})
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-[#0F172A]">{notif.title}</h3>
                      <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                        {notif.message}
                      </p>
                    </div>
                    {!isRead && (
                      <button
                        type="button"
                        onClick={() => markAsRead(notif.id)}
                        className="min-h-[36px] px-3 rounded-lg border border-slate-200 bg-white hover:border-emerald-500 hover:text-emerald-700 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 self-start whitespace-nowrap"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Tandai Dibaca</span>
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

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
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{brand.kop_resmi}</p>

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

          <div className="mt-5 space-y-2.5">
            {rawCurrentStatus !== 'Lunas' && rawCurrentStatus !== 'Menunggu Verifikasi' && (
              <button
                type="button"
                onClick={() => onQuickPayMonth(currentMonth)}
                className="w-full min-h-[44px] rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <span>Setor Iuran {currentMonthName} Sekarang</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setPanduanWaOpen(true)}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[#0F172A] text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Bot className="w-4 h-4 text-[#059669]" />
              <span>Panduan Bot WA (Cek Saldo &amp; Setor)</span>
            </button>
          </div>
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

      <PanduanBotWaModal
        open={panduanWaOpen}
        onClose={() => setPanduanWaOpen(false)}
        profil={profil}
        onGoToSetor={() => onQuickPayMonth(currentMonth)}
        onToast={onToast}
      />
    </div>
  );
}
