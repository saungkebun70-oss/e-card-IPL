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
  Trash2,
  User,
  X,
} from 'lucide-react';
import type { SessionUser } from '../../types';
import {
  BUG_CATEGORY_LABELS,
  BUG_STATUS_LABELS,
  deleteBugReportAdmin,
  deleteBugReportsBatchAdmin,
  fetchBugReports,
  isBugReportResolved,
  subscribeBugReportsRealtime,
  updateBugReportStatusAdmin,
  type BugReportCategory,
  type BugReportRecord,
  type BugReportStatus,
} from '../../lib/bugReportService';
import { formatBlokRumah, formatTanggalWaktu } from '../../lib/format';

interface AdminBugReportsSlideProps {
  session: SessionUser;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type StatusFilter = 'all' | 'pending' | 'resolved';

const STATUS_BADGE_CLASSES: Record<BugReportStatus, string> = {
  baru: 'bg-[#F2D8A7]/45 text-[#4A3410] border-[#E2C285]',
  diproses: 'bg-[#E5EEE3]/75 text-[#384E35] border-[#C6D2BF]',
  selesai: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [bulkDeleteMode, setBulkDeleteMode] = useState<'resolved' | 'all' | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
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

  const handleDeleteSingle = async (report: BugReportRecord) => {
    if (deletingId || bulkDeleting) return;
    setDeletingId(report.id);
    try {
      await deleteBugReportAdmin(session, report);
      setReports((prev) => prev.filter((item) => item.id !== report.id));
      setConfirmDeleteId(null);
      onToast?.('success', `Laporan bug "${report.title}" berhasil dihapus.`);
    } catch (err) {
      onToast?.(
        'error',
        err instanceof Error ? err.message : 'Gagal menghapus laporan bug.'
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async (mode: 'resolved' | 'all') => {
    if (bulkDeleting || deletingId) return;
    const targets =
      mode === 'resolved'
        ? reports.filter((r) => isBugReportResolved(r.status))
        : reports;
    if (targets.length === 0) {
      setBulkDeleteMode(null);
      return;
    }

    setBulkDeleting(true);
    try {
      const deletedCount = await deleteBugReportsBatchAdmin(session, targets);
      const targetIds = new Set(targets.map((r) => r.id));
      setReports((prev) => prev.filter((item) => !targetIds.has(item.id)));
      setBulkDeleteMode(null);
      onToast?.(
        'success',
        mode === 'resolved'
          ? `${deletedCount} laporan bug berstatus Selesai berhasil dihapus.`
          : `Seluruh ${deletedCount} laporan bug berhasil dihapus.`
      );
    } catch (err) {
      onToast?.(
        'error',
        err instanceof Error ? err.message : 'Gagal menghapus laporan bug.'
      );
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Tombol Refresh */}
      <section className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5 sm:p-6 shadow-[0_8px_24px_-12px_rgba(27,39,27,0.08)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0 shadow-xs">
              <Bug className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1B271B]">
                Laporan Bug Pengguna
              </h2>
              <p className="text-xs sm:text-sm text-[#6E786D] mt-0.5 leading-relaxed">
                Pantau kendala teknis, screenshot layar, dan snapshot error dari Warga maupun
                Pengurus, lalu tandai selesai setelah ditangani.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center shrink-0">
            {stats.resolved > 0 && !bulkDeleteMode && (
              <button
                type="button"
                disabled={bulkDeleting || loading}
                onClick={() => {
                  setConfirmDeleteId(null);
                  setBulkDeleteMode('resolved');
                }}
                className="min-h-[40px] px-3.5 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-xs font-semibold text-[#9A422B] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Selesai ({stats.resolved})</span>
              </button>
            )}
            {stats.total > 0 && !bulkDeleteMode && (
              <button
                type="button"
                disabled={bulkDeleting || loading}
                onClick={() => {
                  setConfirmDeleteId(null);
                  setBulkDeleteMode('all');
                }}
                className="min-h-[40px] px-3.5 rounded-full border border-[#E2A898] bg-[#FFFDF8] hover:bg-[#C87058]/10 text-xs font-semibold text-[#9A422B] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Semua</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadBugReports(true)}
              disabled={refreshing || loading}
              className="min-h-[40px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3] text-xs font-semibold text-[#243825] inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Muat Ulang</span>
            </button>
          </div>
        </div>

        {bulkDeleteMode && (
          <div className="mt-4 rounded-2xl border border-[#E2A898] bg-[#C87058]/10 px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 text-xs">
            <p className="font-semibold text-[#7A311E]">
              {bulkDeleteMode === 'resolved'
                ? `Hapus permanen ${stats.resolved} laporan bug yang sudah berstatus Selesai (Resolved)?`
                : `Hapus permanen seluruh ${stats.total} laporan bug beserta lampiran screenshot-nya?`}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => setBulkDeleteMode(null)}
                className="px-3 py-1.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-[#4A554A] font-semibold hover:bg-[#F6F3EA] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => void handleBulkDelete(bulkDeleteMode)}
                className="px-3.5 py-1.5 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {bulkDeleting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>Ya, Hapus Permanen</span>
              </button>
            </div>
          </div>
        )}

        {/* Ringkasan KPI */}
        <div className="grid grid-cols-3 gap-3 mt-5">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`text-left rounded-2xl border p-3.5 transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? 'border-[#2B3F29] bg-[#E5EEE3]/75'
                : 'border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA]'
            }`}
          >
            <p className="text-[11px] font-semibold text-[#6E786D]">Total Laporan</p>
            <p className="text-xl sm:text-2xl font-bold font-mono text-[#1B271B] mt-1 tabular-nums">
              {stats.total}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`text-left rounded-2xl border p-3.5 transition-colors cursor-pointer ${
              statusFilter === 'pending'
                ? 'border-[#E2C285] bg-[#F2D8A7]/65'
                : 'border-[#E2C285]/70 bg-[#F2D8A7]/25 hover:bg-[#F2D8A7]/45'
            }`}
          >
            <p className="text-[11px] font-semibold text-[#6E4D12]">Pending</p>
            <p className="text-xl sm:text-2xl font-bold font-mono text-[#4A3410] mt-1 tabular-nums">
              {stats.pending}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('resolved')}
            className={`text-left rounded-2xl border p-3.5 transition-colors cursor-pointer ${
              statusFilter === 'resolved'
                ? 'border-[#2B3F29] bg-[#E5EEE3]'
                : 'border-[#C6D2BF] bg-[#E5EEE3]/45 hover:bg-[#E5EEE3]/75'
            }`}
          >
            <p className="text-[11px] font-semibold text-[#243825]">Selesai (Resolved)</p>
            <p className="text-xl sm:text-2xl font-bold font-mono text-[#243825] mt-1 tabular-nums">
              {stats.resolved}
            </p>
          </button>
        </div>
      </section>

      {/* Filter & Pencarian */}
      <section className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          {/* Tab Status */}
          <div className="inline-flex rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6] p-1 shrink-0 self-start">
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
                    ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                    : 'text-[#4A554A] hover:text-[#243825]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Pencarian & Kategori */}
          <div className="flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#6E786D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari judul, deskripsi, nama pelapor, atau blok..."
                className="w-full min-h-[40px] pl-9 pr-3.5 rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] text-xs sm:text-sm text-[#1B271B] placeholder:text-[#6E786D] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20 focus:border-[#2B3F29]"
              />
            </div>

            <div className="relative shrink-0">
              <Filter className="w-4 h-4 text-[#6E786D] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                aria-label="Filter kategori laporan bug"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as 'all' | BugReportCategory)}
                className="w-full sm:w-auto min-h-[40px] pl-9 pr-8 rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] text-xs sm:text-sm text-[#1B271B] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20 focus:border-[#2B3F29]"
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
        <div className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-10 flex flex-col items-center justify-center gap-2.5 text-[#6E786D]">
          <Loader2 className="w-6 h-6 animate-spin text-[#2B3F29]" />
          <p className="text-sm font-medium">Memuat laporan bug dari database...</p>
        </div>
      ) : filteredReports.length === 0 ? (
        <div className="bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center mx-auto shadow-xs">
            {statusFilter === 'pending' ? (
              <CheckCircle2 className="w-6 h-6" />
            ) : (
              <Bug className="w-6 h-6" />
            )}
          </div>
          <h3 className="text-sm font-bold text-[#1B271B] mt-3">
            {statusFilter === 'pending'
              ? 'Semua Laporan Bug Sudah Terselesaikan'
              : 'Tidak Ada Laporan Bug Ditemukan'}
          </h3>
          <p className="text-xs text-[#6E786D] mt-1 max-w-md mx-auto leading-relaxed">
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
                className={`bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-4 sm:p-5 space-y-3.5 transition-colors shadow-[0_6px_20px_-10px_rgba(27,39,27,0.06)] ${
                  resolved ? '' : 'ring-1 ring-[#E2C285]'
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
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[#F6F3EA] border border-[#E6E2D6] text-[#4A554A]">
                        {BUG_CATEGORY_LABELS[item.category]}
                      </span>
                      <span className="text-[11px] font-mono text-[#6E786D]">
                        #{item.id.slice(0, 8).toUpperCase()}
                      </span>
                      {item.is_local_only && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#E5EEE3] text-[#243825]">
                          Lokal
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm sm:text-base font-bold text-[#1B271B] mt-2 break-words">
                      {item.title}
                    </h3>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-[#6E786D]">
                      <span className="inline-flex items-center gap-1 font-semibold text-[#1B271B]">
                        <User className="w-3.5 h-3.5 text-[#6E786D]" />
                        {item.reporter_name} (
                        {item.reporter_role === 'warga'
                          ? `Blok ${formatBlokRumah(item.blok_rumah)}`
                          : item.reporter_role}
                        )
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#6E786D]" />
                        {formatTanggalWaktu(item.created_at)}
                      </span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                        <Monitor className="w-3.5 h-3.5 text-[#6E786D]" />
                        v{item.app_version} · {item.platform}
                      </span>
                    </div>
                  </div>

                  {/* Thumbnail Screenshot */}
                  {item.screenshot_url && (
                    <button
                      type="button"
                      onClick={() => setLightboxImageUrl(item.screenshot_url)}
                      className="group relative w-full sm:w-28 h-24 sm:h-20 rounded-xl overflow-hidden border border-[#E6E2D6] bg-[#F6F3EA] shrink-0 cursor-pointer"
                      title="Klik untuk memperbesar screenshot"
                    >
                      <img
                        src={item.screenshot_url}
                        alt={`Screenshot ${item.title}`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                      <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-[#1B271B]/75 text-[#FFFDF8] text-[10px] font-semibold inline-flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" />
                        <span>Lihat</span>
                      </span>
                    </button>
                  )}
                </div>

                {/* Deskripsi */}
                <p className="text-xs sm:text-sm text-[#4A554A] whitespace-pre-line leading-relaxed bg-[#F6F3EA]/70 border border-[#E6E2D6] rounded-xl p-3">
                  {item.description}
                </p>

                {/* Catatan Penanganan Admin (jika sudah ada) */}
                {item.admin_note && !isNoteOpen && (
                  <div className="flex items-start gap-2 rounded-xl bg-[#E5EEE3]/70 border border-[#C6D2BF] px-3 py-2 text-xs text-[#243825]">
                    <MessageSquareText className="w-4 h-4 text-[#2B3F29] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Catatan Penanganan: </span>
                      <span>{item.admin_note}</span>
                    </div>
                  </div>
                )}

                {/* Input Catatan Opsional Admin */}
                {isNoteOpen && (
                  <div className="rounded-xl border border-[#E6E2D6] bg-[#F6F3EA] p-3 space-y-2">
                    <label
                      htmlFor={`admin-note-${item.id}`}
                      className="block text-xs font-semibold text-[#1B271B]"
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
                      className="w-full min-h-[38px] px-3 rounded-lg border border-[#E6E2D6] bg-[#FFFDF8] text-xs sm:text-sm text-[#1B271B] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/25 focus:border-[#2B3F29]"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenNoteInputId(null)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#4A554A] hover:bg-[#E6E2D6]/60 cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => void handleUpdateStatus(item, 'selesai', draftNote)}
                        className="px-4 py-1.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#E6E2D6]">
                  <button
                    type="button"
                    onClick={() => toggleSnapshot(item.id)}
                    className="text-xs font-semibold text-[#4A554A] hover:text-[#243825] inline-flex items-center gap-1.5 self-start cursor-pointer"
                  >
                    <FileCode2 className="w-4 h-4 text-[#384E35]" />
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
                            className="min-h-[36px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3]/65 hover:bg-[#E5EEE3] text-[#243825] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
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
                          className="min-h-[36px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-[#4A554A] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                        >
                          <MessageSquareText className="w-3.5 h-3.5 text-[#384E35]" />
                          <span>Catatan</span>
                        </button>

                        <button
                          type="button"
                          disabled={isUpdating}
                          onClick={() => void handleUpdateStatus(item, 'selesai')}
                          className="min-h-[36px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
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
                        disabled={isUpdating || deletingId === item.id}
                        onClick={() => void handleUpdateStatus(item, 'baru')}
                        className="min-h-[36px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-[#4A554A] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {isUpdating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                        <span>Buka Kembali (Pending)</span>
                      </button>
                    )}

                    {confirmDeleteId === item.id ? (
                      <div className="inline-flex items-center gap-1.5 bg-[#C87058]/10 border border-[#E2A898] rounded-full px-2.5 py-1">
                        <span className="text-[11px] font-semibold text-[#7A311E] pl-0.5">
                          Hapus?
                        </span>
                        <button
                          type="button"
                          disabled={deletingId === item.id}
                          onClick={() => void handleDeleteSingle(item)}
                          className="px-2.5 py-1 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                        >
                          {deletingId === item.id && (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          )}
                          <span>Ya</span>
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === item.id}
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 rounded-full bg-[#FFFDF8] border border-[#E6E2D6] text-[#4A554A] text-[11px] font-semibold hover:bg-[#F6F3EA] cursor-pointer"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isUpdating || bulkDeleting || deletingId === item.id}
                        onClick={() => {
                          setBulkDeleteMode(null);
                          setConfirmDeleteId(item.id);
                        }}
                        aria-label={`Hapus laporan ${item.title}`}
                        title="Hapus laporan bug ini"
                        className="min-h-[36px] px-3 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#9A422B] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Panel Detail Snapshot Error */}
                {snapshotExpanded && (
                  <div className="rounded-xl bg-[#1B271B] text-[#FFFDF8] p-3.5 text-[11px] font-mono space-y-1.5 overflow-x-auto">
                    {item.error_snapshot ? (
                      <>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#E5EEE3]/90">
                          <span>URL: {item.error_snapshot.url}</span>
                          <span>Layar: {item.error_snapshot.viewport}</span>
                          <span>Build: {item.error_snapshot.build_id}</span>
                          <span>
                            Koneksi: {item.error_snapshot.online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                        <p className="text-[#C6D2BF] break-all">
                          UA: {item.error_snapshot.user_agent}
                        </p>
                        <div className="pt-2 mt-1.5 border-t border-[#384E35] space-y-1.5">
                          <p className="text-[#E5EEE3] font-semibold">
                            Riwayat Error Terekam ({item.error_snapshot.recent_errors.length}):
                          </p>
                          {item.error_snapshot.recent_errors.length === 0 ? (
                            <p className="text-[#C6D2BF]">
                              Tidak ada exception JavaScript terekam pada sesi pelapor.
                            </p>
                          ) : (
                            item.error_snapshot.recent_errors.map((err, idx) => (
                              <div
                                key={`${err.timestamp}-${idx}`}
                                className="rounded-lg bg-[#243825]/85 p-2 border border-[#384E35] space-y-0.5"
                              >
                                <p className="text-[#F2D8A7] break-words">
                                  [{err.source}] {err.message}
                                </p>
                                {err.location && (
                                  <p className="text-[#C6D2BF] text-[10px] break-all">
                                    Lokasi: {err.location}
                                  </p>
                                )}
                                {err.stack && (
                                  <pre className="text-[#E5EEE3]/85 text-[10px] whitespace-pre-wrap break-words mt-1 max-h-28 overflow-y-auto">
                                    {err.stack}
                                  </pre>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="text-[#C6D2BF]">
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
          className="fixed inset-0 z-50 bg-[#1B271B]/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxImageUrl(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-[#FFFDF8] rounded-3xl overflow-hidden shadow-2xl border border-[#E6E2D6]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-[#E6E2D6] flex items-center justify-between">
              <span className="text-xs sm:text-sm font-bold text-[#1B271B]">
                Screenshot Laporan Bug
              </span>
              <button
                type="button"
                onClick={() => setLightboxImageUrl(null)}
                className="p-1.5 rounded-xl text-[#4A554A] hover:bg-[#E5EEE3] cursor-pointer"
                aria-label="Tutup pratinjau screenshot"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-[#F6F3EA] max-h-[78dvh] overflow-auto flex items-center justify-center">
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
