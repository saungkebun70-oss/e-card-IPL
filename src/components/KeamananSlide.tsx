import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  MapPin,
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
  type TitikPatroli,
} from '../types';
import { formatTanggalWaktu } from '../lib/format';
import {
  EmergencySecurityContactCard,
  SecurityPatrolFeedCard,
} from './SecurityLiveWidgets';
import {
  SecurityPatrolMapSvg,
  type CheckpointKondisiState,
  type CheckpointStatusItem,
} from './SecurityPatrolMapSvg';

interface KeamananSlideProps {
  role: 'warga' | 'admin';
  senderName: string;
  senderBlok?: string;
  senderJabatan?: string;
  petugasKontak: PetugasKontakDarurat[];
  patroliFeed: LogPatroli[];
  titikPatroliList?: TitikPatroli[];
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
  titikPatroliList = [],
  notifications,
  isRefreshing = false,
  onRefresh,
  onOpenPetugasSettings,
  onToast,
}: KeamananSlideProps) {
  const [kondisiFilter, setKondisiFilter] = useState<'semua' | 'Aman' | 'Ada Catatan'>('semua');
  const [checkpointFilter, setCheckpointFilter] = useState<
    'semua' | CheckpointKondisiState
  >('semua');

  const scanHariIni = useMemo(
    () => patroliFeed.filter((log) => isTodayLocal(log.waktu_scan)).length,
    [patroliFeed]
  );

  const catatanKhususCount = useMemo(
    () => patroliFeed.filter((log) => log.status_kondisi === 'Ada Catatan').length,
    [patroliFeed]
  );

  const latestLog = patroliFeed[0] || null;

  const checkpointStatuses = useMemo<CheckpointStatusItem[]>(() => {
    const activePoints = titikPatroliList.filter((t) => t.aktif !== false);
    const sortedLogs = [...patroliFeed].sort(
      (a, b) => new Date(b.waktu_scan).getTime() - new Date(a.waktu_scan).getTime()
    );

    return activePoints.map((titik) => {
      const normalizedName = titik.nama_lokasi.trim().toLowerCase();
      const matched =
        sortedLogs.find(
          (log) =>
            (log.titik_id && log.titik_id === titik.id) ||
            log.nama_lokasi.trim().toLowerCase() === normalizedName
        ) || null;

      if (!matched) {
        return {
          titik,
          latestLog: null,
          state: 'belum_dipatroli',
          scannedToday: false,
        };
      }

      const state: CheckpointKondisiState =
        matched.status_kondisi === 'Ada Catatan' ? 'perlu_perhatian' : 'aman';

      return {
        titik,
        latestLog: matched,
        state,
        scannedToday: isTodayLocal(matched.waktu_scan),
      };
    });
  }, [titikPatroliList, patroliFeed]);

  const checkpointSummary = useMemo(() => {
    const total = checkpointStatuses.length;
    const aman = checkpointStatuses.filter((c) => c.state === 'aman').length;
    const perluPerhatian = checkpointStatuses.filter((c) => c.state === 'perlu_perhatian').length;
    const belumDipatroli = checkpointStatuses.filter((c) => c.state === 'belum_dipatroli').length;
    const terpantauHariIni = checkpointStatuses.filter((c) => c.scannedToday).length;
    return { total, aman, perluPerhatian, belumDipatroli, terpantauHariIni };
  }, [checkpointStatuses]);

  const filteredCheckpoints = useMemo(() => {
    if (checkpointFilter === 'semua') return checkpointStatuses;
    return checkpointStatuses.filter((c) => c.state === checkpointFilter);
  }, [checkpointStatuses, checkpointFilter]);

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

      {/* Denah Blok Perumahan Interaktif (SVG) — Hijau Aman, Merah Perlu Perhatian */}
      <SecurityPatrolMapSvg
        role={role}
        checkpoints={checkpointStatuses}
        onOpenPetugasSettings={onOpenPetugasSettings}
      />

      {/* Visualisasi Status Kondisi Terkini Titik Checkpoint Patroli (Khusus Admin) */}
      {role === 'admin' && (
        <section
          aria-label="Status Kondisi Terkini Titik Checkpoint Patroli"
          className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
        >
          {/* Header & Ringkasan Kondisi Titik */}
          <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <MapPin className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#0F172A] leading-tight">
                  Status Kondisi Titik Checkpoint Patroli
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Ringkasan kondisi terkini setiap titik NFC/RFID sebelum &amp; selama petugas
                  melakukan patroli.
                </p>
              </div>
            </div>

            {/* Filter Cepat Status Titik */}
            {checkpointSummary.total > 0 && (
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
                {(
                  [
                    { id: 'semua', label: `Semua (${checkpointSummary.total})` },
                    { id: 'aman', label: `Aman (${checkpointSummary.aman})` },
                    {
                      id: 'perlu_perhatian',
                      label: `Perlu Perhatian (${checkpointSummary.perluPerhatian})`,
                    },
                    {
                      id: 'belum_dipatroli',
                      label: `Belum Dicek (${checkpointSummary.belumDipatroli})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCheckpointFilter(tab.id)}
                    className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      checkpointFilter === tab.id
                        ? 'bg-white text-[#0F172A] shadow-sm'
                        : 'text-slate-600 hover:text-[#0F172A]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bar Proporsi Status Titik Checkpoint */}
          {checkpointSummary.total > 0 && (
            <div className="px-4 sm:px-5 py-3 bg-slate-50/70 border-b border-slate-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                    <span className="w-2 h-2 rounded-full bg-[#059669]" aria-hidden="true" />
                    Aman: <span className="font-mono tabular-nums">{checkpointSummary.aman}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
                    <span className="w-2 h-2 rounded-full bg-[#DC2626]" aria-hidden="true" />
                    Perlu Perhatian:{' '}
                    <span className="font-mono tabular-nums">
                      {checkpointSummary.perluPerhatian}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-600">
                    <span className="w-2 h-2 rounded-full bg-slate-400" aria-hidden="true" />
                    Belum Dipatroli:{' '}
                    <span className="font-mono tabular-nums">
                      {checkpointSummary.belumDipatroli}
                    </span>
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold text-slate-600 tabular-nums">
                  Cakupan hari ini: {checkpointSummary.terpantauHariIni}/{checkpointSummary.total}{' '}
                  titik
                </span>
              </div>

              <div
                className="h-2 w-full rounded-full bg-slate-200 overflow-hidden flex"
                aria-hidden="true"
              >
                {checkpointSummary.aman > 0 && (
                  <div
                    className="bg-[#059669] h-full transition-all"
                    style={{ width: `${(checkpointSummary.aman / checkpointSummary.total) * 100}%` }}
                  />
                )}
                {checkpointSummary.perluPerhatian > 0 && (
                  <div
                    className="bg-[#DC2626] h-full transition-all"
                    style={{
                      width: `${
                        (checkpointSummary.perluPerhatian / checkpointSummary.total) * 100
                      }%`,
                    }}
                  />
                )}
                {checkpointSummary.belumDipatroli > 0 && (
                  <div
                    className="bg-slate-300 h-full transition-all"
                    style={{
                      width: `${
                        (checkpointSummary.belumDipatroli / checkpointSummary.total) * 100
                      }%`,
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Grid Kartu Setiap Titik Checkpoint */}
          {checkpointSummary.total === 0 ? (
            <div className="px-5 py-6 text-center space-y-2">
              <MapPin className="w-7 h-7 text-slate-300 mx-auto" />
              <p className="text-xs font-semibold text-slate-700">
                Belum Ada Titik Checkpoint Patroli Terdaftar
              </p>
              <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                Tambahkan lokasi pos atau sudut blok beserta UID stiker RFID/NFC melalui tombol
                Kelola Petugas &amp; NFC agar status patroli setiap titik dapat dipantau di sini.
              </p>
            </div>
          ) : filteredCheckpoints.length === 0 ? (
            <div className="px-5 py-6 text-center text-xs text-slate-500">
              Tidak ada titik checkpoint pada filter status ini.
            </div>
          ) : (
            <div className="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredCheckpoints.map(({ titik, latestLog: lastScan, state, scannedToday }) => {
                const isAman = state === 'aman';
                const isAttention = state === 'perlu_perhatian';

                return (
                  <article
                    key={titik.id}
                    className={`rounded-xl border p-3.5 sm:p-4 flex flex-col justify-between gap-2.5 transition-colors ${
                      isAttention
                        ? 'border-red-300 bg-red-50/50'
                        : isAman
                          ? 'border-emerald-200/80 bg-emerald-50/25'
                          : 'border-slate-200 bg-slate-50/60'
                    }`}
                  >
                    {/* Baris Judul Lokasi & Status Kondisi */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#0F172A] leading-snug flex items-center gap-1.5">
                          <MapPin
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isAttention
                                ? 'text-red-600'
                                : isAman
                                  ? 'text-[#059669]'
                                  : 'text-slate-400'
                            }`}
                          />
                          <span className="truncate">{titik.nama_lokasi}</span>
                        </h3>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
                          UID: {titik.rfid_uid}
                          {titik.keterangan ? ` · ${titik.keterangan}` : ''}
                        </p>
                      </div>

                      <span
                        className={`text-xs font-bold inline-flex items-center gap-1 shrink-0 whitespace-nowrap ${
                          isAttention
                            ? 'text-red-700'
                            : isAman
                              ? 'text-emerald-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {isAttention ? (
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        ) : isAman ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>
                          {isAttention
                            ? 'Perlu Perhatian'
                            : isAman
                              ? 'Aman'
                              : 'Belum Dipatroli'}
                        </span>
                      </span>
                    </div>

                    {/* Info Scan Terakhir / Catatan Perhatian */}
                    {lastScan ? (
                      <div className="pt-2 border-t border-slate-200/70 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-slate-600">
                          <span>
                            Petugas:{' '}
                            <strong className="text-[#0F172A]">{lastScan.nama_petugas}</strong>
                          </span>
                          <span className="font-mono tabular-nums text-slate-500 inline-flex items-center gap-1">
                            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                            {formatTanggalWaktu(lastScan.waktu_scan)}
                          </span>
                        </div>

                        {lastScan.catatan ? (
                          <p
                            className={`text-xs rounded-lg px-2.5 py-1.5 leading-relaxed ${
                              isAttention
                                ? 'bg-white border border-red-200 text-red-950 font-medium'
                                : 'bg-white border border-slate-200/80 text-slate-700'
                            }`}
                          >
                            {lastScan.catatan}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500">
                            {scannedToday
                              ? 'Sudah dipatroli hari ini tanpa catatan kendala.'
                              : 'Scan terakhir sebelum hari ini — jadwalkan pengecekan ulang pada shift berjalan.'}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="pt-2 border-t border-slate-200/70">
                        <p className="text-[11px] text-slate-500">
                          Belum ada laporan scan NFC/manual pada titik ini. Prioritaskan pada rute
                          patroli berikutnya.
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
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
