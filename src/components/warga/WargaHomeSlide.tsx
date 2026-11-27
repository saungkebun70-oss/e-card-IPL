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
} from 'lucide-react';
import { Icon3D } from '../Icon3D';
import {
  BULAN_LIST,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  TANGGAL_TERBIT_TAGIHAN,
  type EffectiveStatusBulanEcard,
  type StatusEcardBulanan,
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
  isCountableUnpaidStatus,
  resolveEffectiveMonthStatus,
} from '../../lib/format';
import { useAppBrand } from '../../lib/brandContext';
import { BrandLogo, SaungKebunWatermark } from '../BrandLogo';
import { PanduanBotWaModal } from './PanduanBotWaModal';

interface WargaHomeSlideProps {
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

function getMonthCellStyles(status: EffectiveStatusBulanEcard) {
  switch (status) {
    case 'Lunas':
      return {
        box: 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]',
        label: 'Lunas',
        labelColor: 'text-[#243825]',
        icon: CheckCircle2,
      };
    case 'Menunggu Verifikasi':
      return {
        box: 'bg-[#F2D8A7]/45 border-[#E2C285] text-[#4A3410]',
        label: 'Menunggu',
        labelColor: 'text-[#6E4D12]',
        icon: Clock,
      };
    case 'Jatuh Tempo':
    case 'Belum Bayar':
      return {
        box: 'bg-[#C87058]/15 border-[#E2A898] text-[#7A311E] hover:border-[#C87058]',
        label: status === 'Jatuh Tempo' ? 'Jatuh Tempo' : 'Belum Bayar',
        labelColor: 'text-[#A44831]',
        icon: AlertTriangle,
      };
    case 'Pra-Rilis':
      return {
        box: 'bg-[#EFECE2] border-[#E0DCCE] text-[#6E786D]',
        label: 'Pra-Rilis',
        labelColor: 'text-[#6E786D]',
        icon: Calendar,
      };
    default:
      return {
        box: 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:border-[#C6D2BF]',
        label: 'Belum Tagihan',
        labelColor: 'text-[#6E786D]',
        icon: Calendar,
      };
  }
}

export function WargaHomeSlide({
  profil,
  statusBulanan,
  riwayat = [],
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
  const rawCurrentStatus = resolveEffectiveMonthStatus({
    dbStatus: currentStatusObj?.status,
    tahun: TAHUN_AKTIF,
    bulan: currentMonth,
    billingStart: brand,
  });
  const currentMonthTrx = riwayat.find(
    (t) =>
      t.tahun === TAHUN_AKTIF &&
      t.bulan_dibayar.includes(currentMonth) &&
      (t.status_verifikasi === 'ACC Bendahara' || t.status_verifikasi === 'Pending')
  );

  const ecardBadge =
    rawCurrentStatus === 'Lunas'
      ? {
          text: 'LUNAS · SAH BEND & KETUA',
          bg: 'bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]',
          icon: CheckCircle2,
        }
      : rawCurrentStatus === 'Menunggu Verifikasi'
        ? currentMonthTrx?.status_verifikasi === 'ACC Bendahara'
          ? {
              text: 'ACC BENDAHARA · MENUNGGU KETUA',
              bg: 'bg-[#F2D8A7] text-[#4A3410]',
              icon: ShieldCheck,
            }
          : {
              text: 'MENUNGGU BENDAHARA',
              bg: 'bg-[#F2D8A7] text-[#4A3410]',
              icon: Clock,
            }
        : rawCurrentStatus === 'Pra-Rilis'
          ? {
              text: 'PRA-RILIS · BELUM BERLAKU',
              bg: 'bg-[#384E35] text-[#E5EEE3] border border-[#C6D2BF]/30',
              icon: Calendar,
            }
          : {
              text: 'BELUM BAYAR',
              bg: 'bg-[#C87058] text-[#FFFDF8]',
              icon: AlertTriangle,
            };

  const BadgeIcon = ecardBadge.icon;
  const jumlahLunas = statusBulanan.filter((s) => s.status === 'Lunas').length;
  const jumlahTunggakan = BULAN_LIST.filter((b) => b.angka <= currentMonth).filter((b) => {
    const st = statusBulanan.find((s) => s.bulan === b.angka)?.status;
    return isCountableUnpaidStatus(
      resolveEffectiveMonthStatus({
        dbStatus: st,
        tahun: TAHUN_AKTIF,
        bulan: b.angka,
        billingStart: brand,
      })
    );
  }).length;

  return (
    <div className="space-y-6">
      {/* Pengumuman / Pesan Sistem Resmi dari Pengurus */}
      {notifications.length > 0 && (
        <section
          aria-label="Pengumuman Pengurus Lingkungan"
          className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#1B271B]">
              <Icon3D name="pengumuman" className="w-7 h-7 rounded-lg shadow-2xs" />
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
                  <span className="px-2 py-0.5 rounded-full bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]">
                    {jumlahLunas} Lunas
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full border ${
                      jumlahTunggakan > 0
                        ? 'bg-[#C87058]/15 text-[#A44831] border-[#E2A898]'
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
            {rawCurrentStatus !== 'Lunas' &&
              rawCurrentStatus !== 'Menunggu Verifikasi' &&
              rawCurrentStatus !== 'Pra-Rilis' && (
              <button
                type="button"
                onClick={() => onQuickPayMonth(currentMonth)}
                className="w-full min-h-[46px] rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-md shadow-[#243825]/15"
              >
                <span>Setor Iuran {currentMonthName} Sekarang</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </button>
            )}
            {rawCurrentStatus === 'Pra-Rilis' && (
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#4A554A]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#2B3F29]" />
              Lunas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#D9A754]" />
              Menunggu Verifikasi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#C87058]" />
              Jatuh Tempo / Belum Bayar
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#C6C2B5]" />
              Pra-Rilis / Belum Berlaku
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
          {BULAN_LIST.map((b) => {
            const stObj = statusBulanan.find((s) => s.bulan === b.angka);
            const status = resolveEffectiveMonthStatus({
              dbStatus: stObj?.status,
              tahun: TAHUN_AKTIF,
              bulan: b.angka,
              billingStart: brand,
            });
            const style = getMonthCellStyles(status);
            const CellIcon = style.icon;
            const canClick =
              status !== 'Lunas' && status !== 'Menunggu Verifikasi' && status !== 'Pra-Rilis';
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
