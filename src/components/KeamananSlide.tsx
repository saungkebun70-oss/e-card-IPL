import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Megaphone,
  Radio,
  RefreshCw,
  Settings,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import {
  APP_PETUGAS_PORTAL_URL,
  type LogPatroli,
  type PetugasKontakDarurat,
  type SystemNotification,
} from '../types';
import { formatTanggalWaktu } from '../lib/format';
import {
  EmergencySecurityContactCard,
  SecurityPatrolFeedCard,
} from './SecurityLiveWidgets';

interface KeamananSlideProps {
  role: 'warga' | 'admin';
  senderName: string;
  senderBlok?: string;
  senderJabatan?: string;
  petugasKontak: PetugasKontakDarurat[];
  patroliFeed: LogPatroli[];
  notifications: SystemNotification[];
  isRefreshing?: boolean;
  onRefresh: () => Promise<void>;
  onOpenPetugasSettings?: () => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

function isTodayLocal(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function KeamananSlide({
  role,
  senderName,
  senderBlok,
  senderJabatan,
  petugasKontak,
  patroliFeed,
  notifications,
  isRefreshing = false,
  onRefresh,
  onOpenPetugasSettings,
  onToast,
}: KeamananSlideProps) {
  const [kondisiFilter, setKondisiFilter] = useState<'semua' | 'Aman' | 'Ada Catatan'>('semua');

  const scanHariIni = useMemo(
    () => patroliFeed.filter((log) => isTodayLocal(log.waktu_scan)).length,
    [patroliFeed]
  );

  const catatanKhususCount = useMemo(
    () => patroliFeed.filter((log) => log.status_kondisi === 'Ada Catatan').length,
    [patroliFeed]
  );

  const latestLog = patroliFeed[0] || null;

  const filteredPatroli = useMemo(() => {
    if (kondisiFilter === 'semua') return patroliFeed;
    return patroliFeed.filter((log) => log.status_kondisi === kondisiFilter);
  }, [patroliFeed, kondisiFilter]);

  const securityAnnouncements = useMemo(
    () => notifications.filter((n) => n.category === 'Keamanan'),
    [notifications]
  );

  const handleCopyPetugasLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_PETUGAS_PORTAL_URL);
      onToast('success', `Link Portal Petugas (${APP_PETUGAS_PORTAL_URL}) berhasil disalin.`);
    } catch {
      onToast('info', `Link Portal Petugas: ${APP_PETUGAS_PORTAL_URL}`);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Aksi Halaman Keamanan */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Pusat informasi keamanan, kontak darurat 24 jam, dan log patroli NFC Perumahan Saung
            Kebun.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {role === 'admin' && onOpenPetugasSettings && (
            <button
              type="button"
              onClick={onOpenPetugasSettings}
              className="min-h-[42px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span>Kelola Petugas &amp; NFC</span>
            </button>
          )}
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void onRefresh()}
            className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs sm:text-sm font-semibold text-[#0F172A] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw
              className={`w-4 h-4 text-slate-500 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            <span>{isRefreshing ? 'Memuat...' : 'Muat Ulang'}</span>
          </button>
        </div>
      </div>

      {/* Ringkasan KPI Keamanan Lingkungan */}
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
        <div className="bg-[#0F172A] text-white rounded-2xl p-4 sm:p-5 border border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-300">Petugas Siaga Aktif</p>
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-bold text-emerald-400 tabular-nums mt-2">
            {petugasKontak.length}{' '}
            <span className="text-xs font-sans font-normal text-slate-400">personel</span>
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Siaga panggilan darurat 24 jam</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Scan Patroli Hari Ini</p>
            <Radio className="w-4 h-4 text-[#059669] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-bold text-[#0F172A] tabular-nums mt-2">
            {scanHariIni}{' '}
            <span className="text-xs font-sans font-normal text-slate-500">titik</span>
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {catatanKhususCount > 0 ? `${catatanKhususCount} log ada catatan` : 'Semua terpantau aman'}
          </p>
        </div>

        <div className="col-span-2 lg:col-span-1 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Patroli Terakhir</p>
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
          </div>
          {latestLog ? (
            <>
              <p className="text-sm sm:text-base font-bold text-[#0F172A] truncate mt-2">
                {latestLog.nama_lokasi}
              </p>
              <p className="text-[11px] text-slate-500 mt-1 truncate font-mono tabular-nums">
                {latestLog.nama_petugas} · {formatTanggalWaktu(latestLog.waktu_scan)}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-slate-600 mt-2">Belum ada scan terbaru</p>
              <p className="text-[11px] text-slate-400 mt-1">
                Otomatis terisi saat petugas tap NFC
              </p>
            </>
          )}
        </div>
      </section>

      {/* Banner Tautan Portal Petugas (Khusus Admin) */}
      {role === 'admin' && (
        <section className="rounded-2xl bg-emerald-50/70 border border-emerald-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#059669] text-white flex items-center justify-center shrink-0 mt-0.5">
              <Shield className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-emerald-950">
                Link Login Khusus Petugas Keamanan (Terisolasi)
              </p>
              <p className="text-xs font-mono font-semibold text-emerald-800 truncate mt-0.5">
                {APP_PETUGAS_PORTAL_URL}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyPetugasLink()}
            className="min-h-[40px] px-3.5 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-900 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Salin Link /petugas</span>
          </button>
        </section>
      )}

      {/* Kontak Darurat Keamanan (24 Jam) */}
      <EmergencySecurityContactCard
        petugasList={petugasKontak}
        senderContext={{
          role,
          nama: senderName,
          blokRumah: senderBlok,
          jabatan: senderJabatan,
        }}
      />

      {/* Info & Instruksi Keamanan dari Pengurus (Jika Ada) */}
      {securityAnnouncements.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-amber-600 shrink-0" />
            <h2 className="text-sm font-bold text-[#0F172A]">
              Imbauan &amp; Info Keamanan Lingkungan
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {securityAnnouncements.slice(0, 4).map((notif) => (
              <article key={notif.id} className="px-4 sm:px-5 py-3.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-amber-700">{notif.sender_name} ({notif.sender_jabatan})</span>
                  <span className="font-mono tabular-nums">{formatTanggalWaktu(notif.created_at)}</span>
                </div>
                <h3 className="text-sm font-bold text-[#0F172A]">{notif.title}</h3>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                  {notif.message}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Filter & Daftar Lengkap Log Patroli Lingkungan Real-Time */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Filter Riwayat Patroli
          </p>
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
            {(
              [
                { id: 'semua', label: `Semua (${patroliFeed.length})` },
                {
                  id: 'Aman',
                  label: `Aman (${patroliFeed.filter((l) => l.status_kondisi === 'Aman').length})`,
                  icon: CheckCircle2,
                },
                {
                  id: 'Ada Catatan',
                  label: `Catatan (${catatanKhususCount})`,
                  icon: AlertTriangle,
                },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setKondisiFilter(opt.id)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  kondisiFilter === opt.id
                    ? 'bg-white text-[#0F172A] shadow-sm'
                    : 'text-slate-600 hover:text-[#0F172A]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <SecurityPatrolFeedCard patroliFeed={filteredPatroli} maxItems={25} />
      </div>
    </div>
  );
}
