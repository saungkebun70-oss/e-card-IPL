import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bug,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileCode2,
  Filter,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Monitor,
  RefreshCw,
  RotateCcw,
  Search,
  User,
  X,
} from 'lucide-react';
import type { SessionUser } from '../../types';
import {
  BUG_CATEGORY_LABELS,
  BUG_STATUS_LABELS,
  fetchBugReports,
  isBugReportResolved,
  subscribeBugReportsRealtime,
  updateBugReportStatusAdmin,
  type BugReportCategory,
  type BugReportRecord,
  type BugReportStatus,
} from '../../lib/bugReportService';
import { formatTanggalWaktu } from '../../lib/format';

interface AdminBugReportsSlideProps {
  session: SessionUser;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type StatusFilter = 'all' | 'pending' | 'resolved';

const STATUS_BADGE_CLASSES: Record<BugReportStatus, string> = {
  baru: 'bg-amber-50 text-amber-800 border-amber-200',
  diproses: 'bg-sky-50 text-sky-800 border-sky-200',
  selesai: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

const CATEGORY_FILTER_OPTIONS: Array<{ value: 'all' | BugReportCategory; label: string }> = [
  { value: 'all', label: 'Semua Kategori' },
  { value: 'error_crash', label: BUG_CATEGORY_LABELS.error_crash },
  { value: 'ui_tampilan', label: BUG_CATEGORY_LABELS.ui_tampilan },
  { value: 'pembayaran_ipl', label: BUG_CATEGORY_LABELS.pembayaran_ipl },
  { value: 'notifikasi', label: BUG_CATEGORY_LABELS.notifikasi },
  { value: 'lainnya', label: BUG_CATEGORY_LABELS.lainnya },
];

export function AdminBugReportsSlide({ session, onToast }: AdminBugReportsSlideProps) {
  const [reports, setReports] = useState<BugReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | BugReportCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [expandedSnapshotIds, setExpandedSnapshotIds] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [openNoteInputId, setOpenNoteInputId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  const loadBugReports = useCallback(
    async (silent = false) => {
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const list = await fetchBugReports(session);
        setReports(list);
      } catch (err) {
        onToast?.(
          'error',
          err instanceof Error ? err.message : 'Gagal memuat daftar laporan bug.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, onToast]
  );

  useEffect(() => {
    void loadBugReports(false);
    const unsub = subscribeBugReportsRealtime(session, () => {
      void loadBugReports(true);
    });
    return () => {
      unsub();
    };
  }, [session, loadBugReports]);

  const stats = useMemo(() => {
    const total = reports.length;
    const resolved = reports.filter((r) => isBugReportResolved(r.status)).length;
    const pending = total - resolved;
    return { total, pending, resolved };
  }, [reports]);

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reports.filter((item) => {
      const resolved = isBugReportResolved(item.status);
      if (statusFilter === 'pending' && resolved) return false;
      if (statusFilter === 'resolved' && !resolved) return false;
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

      if (q) {
        const haystack = [
          item.id,
          item.title,
          item.description,
          item.reporter_name,
          item.blok_rumah,
          item.reporter_role,
          BUG_CATEGORY_LABELS[item.category],
          item.admin_note || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [reports, statusFilter, categoryFilter, searchQuery]);

  const handleUpdateStatus = async (
    report: BugReportRecord,
    nextStatus: BugReportStatus,
    overrideNote?: string
  ) => {
    if (updatingId) return;
    setUpdatingId(report.id);
    const adminNote =
      overrideNote !== undefined
        ? overrideNote
        : noteDrafts[report.id] !== undefined
          ? noteDrafts[report.id]
          : undefined;

    try {
      await updateBugReportStatusAdmin(session, report.id, nextStatus, adminNote);
      const nowIso = new Date().toISOString();
      setReports((prev) =>
        prev.map((item) =>
          item.id === report.id
            ? {
                ...item,
                status: nextStatus,
                admin_note:
                  adminNote !== undefined ? adminNote.trim() || null : item.admin_note,
                updated_at: nowIso,
              }
            : item
        )
      );
      if (openNoteInputId === report.id) {
        setOpenNoteInputId(null);
      }
      onToast?.(
        'success',
        nextStatus === 'selesai'
          ? `Laporan "${report.title}" ditandai Selesai (Resolved).`
          : `Status laporan diperbarui menjadi "${BUG_STATUS_LABELS[nextStatus]}".`
      );
    } catch (err) {
      onToast?.(
        'error',
        err instanceof Error ? err.message : 'Gagal memperbarui status laporan bug.'
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleSnapshot = (id: string) => {
    setExpandedSnapshotIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-5">
      {/* Header & Tombol Refresh */}
      <section className="glass-card rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
              <Bug className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#0F172A]">
                Laporan Bug Pengguna
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5 leading-relaxed">
                Pantau kendala teknis, screenshot layar, dan snapshot error dari Warga maupun
                Pengurus, lalu tandai selesai setelah ditangani.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadBugReports(true)}
            disabled={refreshing || loading}
            className="min-h-[40px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#4C1D95] inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60 self-start sm:self-center shrink-0"
          >
            <RefreshCw className={`w-4 h-4 text-[#4C1D95] ${refreshing ? 'animate-spin' : ''}`} />
            <span>Muat Ulang</span>
          </button>
        </div>

        {/* Ringkasan KPI */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`text-left rounded-2xl border p-3.5 transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? 'border-[#4C1D95] bg-indigo-50/70'
                : 'border-indigo-100 bg-white/80 hover:bg-indigo-50/40'
            }`}
          >
            <p className="text-[11px] font-semibold text-slate-500">Total Laporan</p>
            <p className="text-xl sm:text-2xl font-bold font-mono text-[#0F172A] mt-1 tabular-nums">
              {stats.total}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`text-left rounded-2xl border p-3.5 transition-colors cursor-pointer ${
              statusFilter === 'pending'
                ? 'border-amber-400 bg-[#FEF3C7]/90'
                : 'border-amber-200/80 bg-amber-50/40 hover:bg-[#FEF3C7]/60'
            }`}
          >
            <p className="text-[11px] font-semibold text-[#B45309]">Pending</p>
            <p className="text-xl sm:text-2xl font-bold font-mono text-[#B45309] mt-1 tabular-nums">
              {stats.pending}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('resolved')}
            className={`text-left rounded-2xl border p-3.5 transition-colors cursor-pointer ${
              statusFilter === 'resolved'
                ? 'border-emerald-500 bg-[#D1FAE5]/90'
                : 'border-emerald-200/80 bg-emerald-50/40 hover:bg-[#D1FAE5]/60'
            }`}
          >
            <p className="text-[11px] font-semibold text-[#047857]">Selesai (Resolved)</p>
            <p className="text-xl sm:text-2xl font-bold font-mono text-[#047857] mt-1 tabular-nums">
              {stats.resolved}
            </p>
          </button>
        </div>
      </section>

      {/* Filter & Pencarian */}
      <section className="glass-card rounded-3xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Tab Status */}
          <div className="inline-flex rounded-2xl bg-indigo-50/80 p-1 shrink-0 self-start">
            {(
              [
                { id: 'all', label: `Semua (${stats.total})` },
                { id: 'pending', label: `Pending (${stats.pending})` },
                { id: 'resolved', label: `Resolved (${stats.resolved})` },
              ] as Array<{ id: StatusFilter; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[#4C1D95] text-white shadow-xs'
                    : 'text-slate-600 hover:text-[#4C1D95]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Pencarian & Kategori */}
          <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari judul, deskripsi, nama pelapor, atau blok..."
                className="w-full min-h-[40px] pl-9 pr-3.5 rounded-2xl border border-indigo-100 bg-white/95 text-xs sm:text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
              />
            </div>

            <div className="relative shrink-0">
              <Filter className="w-3.5 h-3.5 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                aria-label="Filter kategori laporan bug"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'all' | BugReportCategory)}
                className="w-full sm:w-auto min-h-[40px] pl-8 pr-8 rounded-2xl border border-indigo-100 bg-white/95 text-xs sm:text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
              >
                {CATEGORY_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Daftar Laporan Bug */}
      {loading ? (
        <div className="glass-card rounded-3xl p-10 flex flex-col items-center justify-center gap-2.5 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-[#4C1D95]" />
          <p className="text-sm font-medium">Memuat laporan bug dari database...</p>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="glass-card rounded-3xl p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto">
            {statusFilter === 'pending' ? (
              <CheckCircle2 className="w-6 h-6 text-emerald-600" />
            ) : (
              <Bug className="w-6 h-6 text-indigo-400" />
            )}
          </div>
          <h3 className="text-sm font-bold text-[#0F172A] mt-3">
            {statusFilter === 'pending'
              ? 'Semua Laporan Bug Sudah Terselesaikan'
              : 'Tidak Ada Laporan Bug Ditemukan'}
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">
            {searchQuery || categoryFilter !== 'all'
              ? 'Coba ubah kata kunci pencarian atau pilih kategori lain.'
              : 'Laporan kendala yang dikirim Warga atau Pengurus melalui menu Profil / Pengaturan akan tampil otomatis di sini.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3.5">
          {filteredReports.map((item) => {
            const resolved = isBugReportResolved(item.status);
            const snapshotExpanded = Boolean(expandedSnapshotIds[item.id]);
            const errorCount = item.error_snapshot?.recent_errors?.length || 0;
            const isUpdating = updatingId === item.id;
            const isNoteOpen = openNoteInputId === item.id;
            const draftNote =
              noteDrafts[item.id] !== undefined ? noteDrafts[item.id] : item.admin_note || '';

            return (
              <article
                key={item.id}
                className={`glass-card rounded-3xl p-4 sm:p-5 space-y-3.5 transition-colors ${
                  resolved ? '' : 'ring-1 ring-amber-300/70'
                }`}
              >
                {/* Header Item */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${STATUS_BADGE_CLASSES[item.status]}`}
                      >
                        {BUG_STATUS_LABELS[item.status]}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                        {BUG_CATEGORY_LABELS[item.category]}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        #{item.id.slice(0, 8).toUpperCase()}
                      </span>
                      {item.is_local_only && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                          Lokal
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm sm:text-base font-bold text-[#0F172A] mt-2 break-words">
                      {item.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {item.reporter_name} (
                        {item.reporter_role === 'warga'
                          ? `Blok ${item.blok_rumah}`
                          : item.reporter_role}
                        )
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        {formatTanggalWaktu(item.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <Monitor className="w-3.5 h-3.5 text-slate-400" />
                        v{item.app_version} · {item.platform}
                      </span>
                    </div>
                  </div>

                  {/* Thumbnail Screenshot */}
                  {item.screenshot_url && (
                    <button
                      type="button"
                      onClick={() => setLightboxImageUrl(item.screenshot_url)}
                      className="group relative w-full sm:w-28 h-24 sm:h-20 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0 cursor-pointer"
                      title="Klik untuk memperbesar screenshot"
                    >
                      <img
                        src={item.screenshot_url}
                        alt={`Screenshot ${item.title}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-slate-900/75 text-white text-[10px] font-semibold inline-flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />
                        <span>Lihat</span>
                      </span>
                    </button>
                  )}
                </div>

                {/* Deskripsi */}
                <p className="text-xs sm:text-sm text-slate-700 whitespace-pre-line leading-relaxed bg-slate-50/70 border border-slate-100 rounded-xl p-3">
                  {item.description}
                </p>

                {/* Catatan Penanganan Admin (jika sudah ada) */}
                {item.admin_note && !isNoteOpen && (
                  <div className="flex items-start gap-2 rounded-xl bg-emerald-50/70 border border-emerald-200/80 px-3 py-2 text-xs text-emerald-900">
                    <MessageSquareText className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Catatan Penanganan: </span>
                      <span>{item.admin_note}</span>
                    </div>
                  </div>
                )}

                {/* Input Catatan Opsional Admin */}
                {isNoteOpen && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                    <label
                      htmlFor={`admin-note-${item.id}`}
                      className="block text-xs font-semibold text-slate-700"
                    >
                      Catatan Penyelesaian (Opsional)
                    </label>
                    <input
                      id={`admin-note-${item.id}`}
                      type="text"
                      maxLength={300}
                      value={draftNote}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                      placeholder="Misal: Sudah diperbaiki pada versi terbaru / masalah jaringan warga."
                      className="w-full min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white text-xs sm:text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenNoteInputId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/60 cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => void handleUpdateStatus(item, 'selesai', draftNote)}
                        className="px-4 py-1.5 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        <span>Simpan &amp; Tandai Resolved</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Footer Aksi Admin & Snapshot Toggle */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-indigo-100/80">
                  <button
                    type="button"
                    onClick={() => toggleSnapshot(item.id)}
                    className="text-xs font-semibold text-slate-600 hover:text-[#4C1D95] inline-flex items-center gap-1.5 self-start cursor-pointer"
                  >
                    <FileCode2 className="w-4 h-4 text-indigo-400" />
                    <span>
                      Snapshot Error &amp; Perangkat ({errorCount} error)
                    </span>
                    {snapshotExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    {!resolved ? (
                      <>
                        {item.status !== 'diproses' && (
                          <button
                            type="button"
                            disabled={isUpdating}
                            onClick={() => void handleUpdateStatus(item, 'diproses')}
                            className="min-h-[36px] px-3.5 rounded-full border border-sky-200 bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                          >
                            <span>Tandai Diproses</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() =>
                            setOpenNoteInputId(isNoteOpen ? null : item.id)
                          }
                          className="min-h-[36px] px-3.5 rounded-full border border-slate-200 bg-white/95 hover:bg-indigo-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          <MessageSquareText className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Catatan</span>
                        </button>

                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => void handleUpdateStatus(item, 'selesai')}
                          className="min-h-[36px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          {isUpdating ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          <span>Tandai Selesai (Resolved)</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => void handleUpdateStatus(item, 'baru')}
                        className="min-h-[36px] px-3.5 rounded-full border border-slate-200 bg-white/95 hover:bg-indigo-50 text-slate-600 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                        <span>Buka Kembali (Pending)</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Panel Detail Snapshot Error */}
                {snapshotExpanded && (
                  <div className="rounded-xl bg-slate-900 text-slate-100 p-3.5 text-[11px] font-mono space-y-1.5 overflow-x-auto">
                    {item.error_snapshot ? (
                      <>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
                          <span>URL: {item.error_snapshot.url}</span>
                          <span>Layar: {item.error_snapshot.viewport}</span>
                          <span>Build: {item.error_snapshot.build_id}</span>
                          <span>
                            Koneksi: {item.error_snapshot.online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <p className="text-slate-400 break-all">
                          UA: {item.error_snapshot.user_agent}
                        </p>
                        <div className="pt-2 mt-1.5 border-t border-slate-700/80 space-y-1.5">
                          <p className="text-emerald-300 font-semibold">
                            Riwayat Error Terekam ({item.error_snapshot.recent_errors.length}):
                          </p>
                          {item.error_snapshot.recent_errors.length === 0 ? (
                            <p className="text-slate-400">
                              Tidak ada exception JavaScript terekam pada sesi pelapor.
                            </p>
                          ) : (
                            item.error_snapshot.recent_errors.map((err, idx) => (
                              <div
                                key={`${err.timestamp}-${idx}`}
                                className="rounded-lg bg-slate-950/70 p-2 border border-slate-800 space-y-0.5"
                              >
                                <p className="text-rose-300 break-words">
                                  [{err.source}] {err.message}
                                </p>
                                {err.location && (
                                  <p className="text-slate-400 text-[10px] break-all">
                                    Lokasi: {err.location}
                                  </p>
                                )}
                                {err.stack && (
                                  <pre className="text-slate-400 text-[10px] whitespace-pre-wrap break-words mt-1 max-h-28 overflow-y-auto">
                                    {err.stack}
                                  </pre>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-slate-400">
                        Pelapor tidak menyertakan snapshot perangkat pada laporan ini.
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Lightbox Screenshot */}
      {lightboxImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxImageUrl(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-white/95 backdrop-blur-xl rounded-3xl overflow-hidden shadow-2xl border border-white/90"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-indigo-100 flex items-center justify-between">
              <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                Screenshot Laporan Bug
              </span>
              <button
                type="button"
                onClick={() => setLightboxImageUrl(null)}
                className="p-1.5 rounded-xl text-slate-500 hover:bg-indigo-50 cursor-pointer"
                aria-label="Tutup pratinjau screenshot"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-slate-100 max-h-[78dvh] overflow-auto flex items-center justify-center">
              <img
                src={lightboxImageUrl}
                alt="Screenshot laporan bug"
                className="max-w-full max-h-[70dvh] rounded-2xl object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
