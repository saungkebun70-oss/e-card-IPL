import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Calendar,
  ArrowRight,
  ShieldCheck,
  Check,
  Bot,
  Megaphone,
} from 'lucide-react';
import {
  BULAN_LIST,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  TANGGAL_TERBIT_TAGIHAN,
  type StatusEcardBulanan,
  type SessionUser,
  type SystemNotification,
  type TransaksiIPL,
  type Warga,
} from '../../types';
import {
  formatBillingStartLabel,
  formatBlokRumah,
  formatRupiah,
  formatTanggalWaktu,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import {
  buildBillingCellKey,
  buildPaidAmountLookup,
  formatDaruratBadgeLabel,
  getStatusBadgeStyle,
  resolveUnitMonthBillingStatus,
  type CellStatus,
} from '../../lib/billingStatus';
import { useAppBrand } from '../../lib/brandContext';
import { useSimulation } from '../../lib/simulationContext';
import { BrandLogo, SaungKebunWatermark } from '../BrandLogo';
import { PanduanBotWaModal } from './PanduanBotWaModal';
import { SimulationDateSwitcher } from '../SimulationDateSwitcher';

interface WargaHomeSlideProps {
  session?: SessionUser;
  profil: Warga;
  statusBulanan: StatusEcardBulanan[];
  riwayat?: TransaksiIPL[];
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

function getMonthCellStyles(status: CellStatus, isPending: boolean, paidAmount = 0) {
  if (
    isPending &&
    status !== 'LUNAS' &&
    status !== 'DANA_DARURAT' &&
    status !== 'KOSONG' &&
    status !== 'PRA_RILIS'
  ) {
    return {
      box: 'bg-amber-50 border-amber-300 text-amber-900',
      label: 'Menunggu',
      labelColor: 'text-amber-800',
      icon: Clock,
    };
  }

  const badge = getStatusBadgeStyle(status);

  switch (status) {
    case 'LUNAS':
      return {
        box: 'bg-emerald-50 border-emerald-300 text-emerald-900',
        label: badge.label,
        labelColor: 'text-emerald-800',
        icon: CheckCircle2,
      };
    case 'DANA_DARURAT':
      return {
        box: 'bg-purple-50 border-purple-300 text-purple-900 hover:border-purple-400',
        label: formatDaruratBadgeLabel(paidAmount),
        labelColor: 'text-purple-800',
        icon: ShieldCheck,
      };
    case 'BERJALAN':
      return {
        box: 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300',
        label: badge.label,
        labelColor: 'text-slate-600',
        icon: Clock,
      };
    case 'MASA_TAGIH':
      return {
        box: 'bg-amber-50 border-amber-300 text-amber-900 hover:border-amber-400',
        label: badge.label,
        labelColor: 'text-amber-800',
        icon: Clock,
      };
    case 'TUNGGAK':
      return {
        box: 'bg-rose-50 border-rose-300 text-rose-900 hover:border-rose-400',
        label: badge.label,
        labelColor: 'text-rose-800',
        icon: AlertTriangle,
      };
    case 'PRA_RILIS':
      return {
        box: 'bg-stone-100 border-stone-200 text-stone-500',
        label: badge.label,
        labelColor: 'text-stone-500',
        icon: Calendar,
      };
    default:
      return {
        box: 'bg-[#FFFDF8] border-[#E6E2D6] text-slate-500 hover:border-[#C6D2BF]',
        label: badge.label,
        labelColor: 'text-slate-400',
        icon: Calendar,
      };
  }
}

export function WargaHomeSlide({
  session,
  profil,
  statusBulanan,
  riwayat = [],
  notifications,
  onQuickPayMonth,
  onToast,
}: WargaHomeSlideProps) {
  const { brand } = useAppBrand();
  const { simNow } = useSimulation();
  const isSimulation = Boolean(session?.is_simulation);
  const effectiveNow = isSimulation ? simNow : undefined;
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

  const currentMonth = getCurrentBillingMonth(effectiveNow);
  const currentMonthName = getNamaBulan(currentMonth);

  const { paidAmountByKey, pendingKeys } = buildPaidAmountLookup(riwayat, statusBulanan);

  const currentCellKey = buildBillingCellKey(profil.blok_rumah, TAHUN_AKTIF, currentMonth);
  const currentPaidAmount = paidAmountByKey.get(currentCellKey) ?? 0;
  const currentCellStatus = resolveUnitMonthBillingStatus({
    warga: profil,
    targetYear: TAHUN_AKTIF,
    targetMonth: currentMonth,
    paidAmount: currentPaidAmount,
    billingStart: brand,
    now: effectiveNow,
  });
  const isCurrentPending =
    currentPaidAmount === 0 &&
    currentCellStatus !== 'KOSONG' &&
    currentCellStatus !== 'PRA_RILIS' &&
    pendingKeys.has(currentCellKey);

  const currentMonthTrx = riwayat.find(
    (t) =>
      t.tahun === TAHUN_AKTIF &&
      t.bulan_dibayar.includes(currentMonth) &&
      (t.status_verifikasi === 'ACC Bendahara' || t.status_verifikasi === 'Pending')
  );

  const ecardBadge =
    currentCellStatus === 'LUNAS'
      ? {
          text: 'LUNAS · SAH BEND & KETUA',
          bg: 'bg-emerald-100 text-emerald-900 border border-emerald-300',
          icon: CheckCircle2,
        }
      : currentCellStatus === 'DANA_DARURAT'
        ? {
            text: `ALOKASI DANA DARURAT · ${formatRupiah(currentPaidAmount)}`,
            bg: 'bg-purple-100 text-purple-900 border border-purple-300',
            icon: ShieldCheck,
          }
        : isCurrentPending
          ? currentMonthTrx?.status_verifikasi === 'ACC Bendahara'
            ? {
                text: 'ACC BENDAHARA · MENUNGGU KETUA',
                bg: 'bg-amber-100 text-amber-900 border border-amber-300',
                icon: ShieldCheck,
              }
            : {
                text: 'MENUNGGU BENDAHARA',
                bg: 'bg-amber-100 text-amber-900 border border-amber-300',
                icon: Clock,
              }
          : currentCellStatus === 'PRA_RILIS'
            ? {
                text: 'PRA-RILIS · BELUM BERLAKU',
                bg: 'bg-[#384E35] text-[#E5EEE3] border border-[#C6D2BF]/30',
                icon: Calendar,
              }
            : currentCellStatus === 'KOSONG'
              ? {
                  text: 'UNIT KOSONG',
                  bg: 'bg-stone-100 text-stone-700 border border-stone-300',
                  icon: Calendar,
                }
              : currentCellStatus === 'BERJALAN'
                ? {
                    text: 'BULAN BERJALAN · BELUM BAYAR',
                    bg: 'bg-slate-100 text-slate-800 border border-slate-300',
                    icon: Clock,
                  }
                : currentCellStatus === 'MASA_TAGIH'
                  ? {
                      text: 'MASA TAGIH · TGL 1–7',
                      bg: 'bg-amber-100 text-amber-900 border border-amber-300',
                      icon: Clock,
                    }
                  : {
                      text: 'TUNGGAK · LEWAT JATUH TEMPO',
                      bg: 'bg-rose-600 text-white border border-rose-400',
                      icon: AlertTriangle,
                    };

  const BadgeIcon = ecardBadge.icon;
  const monthStatuses = BULAN_LIST.map((b) => {
    const key = buildBillingCellKey(profil.blok_rumah, TAHUN_AKTIF, b.angka);
    const paid = paidAmountByKey.get(key) ?? 0;
    const cellStatus = resolveUnitMonthBillingStatus({
      warga: profil,
      targetYear: TAHUN_AKTIF,
      targetMonth: b.angka,
      paidAmount: paid,
      billingStart: brand,
      now: effectiveNow,
    });
    const pending =
      paid === 0 &&
      cellStatus !== 'KOSONG' &&
      cellStatus !== 'PRA_RILIS' &&
      pendingKeys.has(key);
    return { bulan: b.angka, cellStatus, pending };
  });

  const jumlahLunas = monthStatuses.filter((m) => m.cellStatus === 'LUNAS').length;
  const jumlahDarurat = monthStatuses.filter((m) => m.cellStatus === 'DANA_DARURAT').length;
  const jumlahTunggakan = monthStatuses.filter(
    (m) =>
      !m.pending &&
      (m.cellStatus === 'TUNGGAK' ||
        m.cellStatus === 'MASA_TAGIH' ||
        m.cellStatus === 'BERJALAN')
  ).length;

  return (
    <div className="space-y-6">
      {isSimulation && <SimulationDateSwitcher compact />}
      {/* Pengumuman / Pesan Sistem Resmi dari Pengurus */}
      {notifications.length > 0 && (
        <section
          aria-label="Pengumuman Pengurus Lingkungan"
          className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#1B271B]">
              <span className="w-7 h-7 rounded-lg bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0">
                <Megaphone className="w-4 h-4" />
              </span>
              <span>Pengumuman Pengurus</span>
              {unreadNotifications.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-[#C6D2BF] font-normal">·</span>
                  <span className="text-xs font-mono font-semibold text-[#243825] tabular-nums">
                    {unreadNotifications.length} baru
                  </span>
                </>
              )}
            </div>
            {notifications.length > unreadNotifications.length && (
              <button
                type="button"
                onClick={() => setShowReadHistory((v) => !v)}
                className="text-xs font-semibold text-[#4A554A] hover:text-[#243825] cursor-pointer whitespace-nowrap"
              >
                {showReadHistory
                  ? 'Sembunyikan yang sudah dibaca'
                  : `Lihat semua (${notifications.length})`}
              </button>
            )}
          </div>

          {displayedNotifications.length === 0 ? (
            <div className="px-5 py-3.5 text-xs text-[#6E786D] flex items-center justify-between gap-2">
              <span>Semua pengumuman terbaru sudah Anda baca.</span>
              <button
                type="button"
                onClick={() => setShowReadHistory(true)}
                className="font-semibold text-[#2B3F29] hover:underline cursor-pointer whitespace-nowrap"
              >
                Lihat arsip
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#E6E2D6]">
              {displayedNotifications.map((notif) => {
                const isRead = readIds.includes(notif.id);
                return (
                  <article
                    key={notif.id}
                    className={`px-5 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                      isRead ? 'bg-[#F7F4EC]/50' : 'bg-[#FFFDF8]'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#6E786D]">
                        <span className="font-semibold text-[#2B3F29]">{notif.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatTanggalWaktu(notif.created_at)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {notif.sender_name} ({notif.sender_jabatan})
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-[#1B271B]">{notif.title}</h3>
                      <p className="text-xs text-[#4A554A] leading-relaxed whitespace-pre-line">
                        {notif.message}
                      </p>
                    </div>
                    {!isRead && (
                      <button
                        type="button"
                        onClick={() => markAsRead(notif.id)}
                        className="min-h-[36px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3]/50 hover:bg-[#E5EEE3] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 self-start whitespace-nowrap"
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
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">
        {/* e-Card Verifikasi Digital */}
        <section className="lg:col-span-7 glass-hero bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] shadow-xl shadow-[#243825]/15 rounded-3xl text-[#FFFDF8] p-4 sm:p-7 relative overflow-hidden flex flex-col justify-between min-h-[228px] sm:min-h-[248px]">
          <SaungKebunWatermark className="right-3 bottom-2 w-36 h-36 opacity-[0.11]" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full bg-[#E5EEE3]/10 blur-3xl"
          />

          {/* Header Kartu */}
          <div className="relative z-10 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <BrandLogo size="sm" variant="dark" className="shrink-0" />
              <div>
                <p className="text-sm font-serif-brand font-bold tracking-tight text-[#FFFDF8]">
                  e-Card Verifikasi IPL
                </p>
                <p className="text-xs text-[#E5EEE3]/80">Perumahan Saung Kebun · Tahun {TAHUN_AKTIF}</p>
              </div>
            </div>
            <ShieldCheck className="w-6 h-6 shrink-0 text-[#E5EEE3]" />
          </div>

          {/* Identitas Utama Rumah */}
          <div className="relative z-10 mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-[#E5EEE3]/75">Nama Kepala Keluarga</p>
              <p className="text-xl sm:text-2xl font-serif-brand font-bold text-[#FFFDF8] tracking-tight mt-0.5">
                {profil.nama_warga}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs text-[#E5EEE3]/75">Blok / No. Rumah</p>
              <p className="text-2xl sm:text-3xl font-bold font-mono text-[#E5EEE3] tracking-tight tabular-nums mt-0.5">
                {formatBlokRumah(profil.blok_rumah)}
              </p>
            </div>
          </div>

          {/* Footer Kartu: Status Hunian + Badge Bulan Berjalan */}
          <div className="relative z-10 mt-6 pt-4 border-t border-[#E5EEE3]/15 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-[#E5EEE3]/85">
              <span>Status Hunian:</span>
              <span className="font-semibold text-[#FFFDF8]">{profil.status_hunian}</span>
              <span aria-hidden="true" className="text-[#E5EEE3]/40">·</span>
              <span>Periode {currentMonthName} {TAHUN_AKTIF}</span>
            </div>

            <div
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold tracking-wide whitespace-nowrap shadow-xs ${ecardBadge.bg}`}
            >
              <BadgeIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{ecardBadge.text}</span>
            </div>
          </div>
        </section>

        {/* Panel Info Siklus Tagihan */}
        <aside className="lg:col-span-5 glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-serif-brand font-bold text-[#1B271B]">
              Informasi Siklus Tagihan IPL
            </h2>
            <p className="text-xs text-[#6E786D] mt-1 leading-relaxed">{brand.kop_resmi}</p>

            <dl className="mt-4 divide-y divide-[#E6E2D6] text-xs sm:text-sm">
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[#4A554A] shrink-0">Nominal Standar IPL</dt>
                <dd className="font-mono font-bold text-[#1B271B] tabular-nums whitespace-nowrap text-right">
                  {formatRupiah(profil.nominal_iuran || NOMINAL_IPL_STANDAR)} / bln
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[#4A554A] shrink-0">Terbit Tagihan</dt>
                <dd className="font-semibold text-[#1B271B] tabular-nums whitespace-nowrap text-right">
                  Tgl {TANGGAL_TERBIT_TAGIHAN} setiap bulan
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[#4A554A] shrink-0">Batas Jatuh Tempo</dt>
                <dd className="font-semibold text-[#A44831] tabular-nums whitespace-nowrap text-right">
                  Tgl {TANGGAL_JATUH_TEMPO} setiap bulan
                </dd>
              </div>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <dt className="text-[#4A554A] shrink-0">Rekap {TAHUN_AKTIF}</dt>
                <dd className="flex items-center justify-end gap-1.5 font-mono text-[11px] sm:text-xs font-semibold tabular-nums whitespace-nowrap">
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {jumlahLunas} Lunas
                  </span>
                  {jumlahDarurat > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300">
                      {jumlahDarurat} Darurat
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      jumlahTunggakan > 0
                        ? 'bg-rose-100 text-rose-800 border-rose-300'
                        : 'bg-[#F7F4EC] text-[#6E786D] border-[#E6E2D6]'
                    }`}
                  >
                    {jumlahTunggakan} Belum
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          <div className="mt-5 space-y-2.5">
            {currentCellStatus !== 'LUNAS' &&
              currentCellStatus !== 'PRA_RILIS' &&
              currentCellStatus !== 'KOSONG' &&
              !isCurrentPending && (
              <button
                type="button"
                onClick={() => onQuickPayMonth(currentMonth)}
                className="w-full min-h-[46px] rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-md shadow-[#243825]/15"
              >
                <span>Setor Iuran {currentMonthName} Sekarang</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            )}
            {currentCellStatus === 'PRA_RILIS' && (
              <div className="rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] px-3.5 py-2.5 text-xs text-[#4A554A] text-center">
                Penagihan aktif dimulai{' '}
                <strong className="text-[#1B271B]">{formatBillingStartLabel(brand)}</strong>.
              </div>
            )}

            <button
              type="button"
              onClick={() => setPanduanWaOpen(true)}
              className="w-full min-h-[44px] rounded-full border border-[#C6D2BF] bg-[#F7F4EC] hover:bg-[#E5EEE3] text-[#243825] text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Bot className="w-4 h-4 text-[#2B3F29] shrink-0" />
              <span>Panduan Bot WA (Cek Saldo &amp; Setor)</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Matriks Status 12 Bulan (Januari – Desember 2026) */}
      <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-base sm:text-lg font-serif-brand font-bold text-[#1B271B]">
              Matriks Status 12 Bulan ({TAHUN_AKTIF})
            </h2>
            <p className="text-xs sm:text-sm text-[#6E786D] mt-0.5">
              Ketuk bulan yang belum lunas untuk langsung menyetor iuran (mulai penagihan:{' '}
              <span className="font-semibold text-[#1B271B]">{formatBillingStartLabel(brand)}</span>).
            </p>
          </div>

          {/* Legenda Status (warna + teks eksplisit) */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#4A554A]">
            {(
              ['LUNAS', 'DANA_DARURAT', 'BERJALAN', 'MASA_TAGIH', 'TUNGGAK', 'PRA_RILIS'] as const
            ).map((stKey) => {
              const b = getStatusBadgeStyle(stKey);
              return (
                <span
                  key={stKey}
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-semibold ${b.className}`}
                >
                  {b.label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
          {BULAN_LIST.map((b) => {
            const cellKey = buildBillingCellKey(profil.blok_rumah, TAHUN_AKTIF, b.angka);
            const paidAmount = paidAmountByKey.get(cellKey) ?? 0;
            const status = resolveUnitMonthBillingStatus({
              warga: profil,
              targetYear: TAHUN_AKTIF,
              targetMonth: b.angka,
              paidAmount,
              billingStart: brand,
              now: effectiveNow,
            });
            const isPending =
              paidAmount === 0 &&
              status !== 'KOSONG' &&
              status !== 'PRA_RILIS' &&
              pendingKeys.has(cellKey);
            const style = getMonthCellStyles(status, isPending, paidAmount);
            const CellIcon = style.icon;
            const canClick =
              status !== 'LUNAS' &&
              status !== 'PRA_RILIS' &&
              status !== 'KOSONG' &&
              !isPending;
            const isCurrent = b.angka === currentMonth;

            return (
              <button
                key={b.angka}
                type="button"
                disabled={!canClick}
                onClick={() => canClick && onQuickPayMonth(b.angka)}
                className={`text-left rounded-2xl border p-3.5 transition-all min-h-[88px] flex flex-col justify-between ${style.box} ${
                  canClick ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'
                } ${isCurrent ? 'ring-2 ring-[#2B3F29]/35' : ''}`}
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
