import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ImagePlus,
  Loader2,
  Monitor,
  RefreshCw,
  Send,
  Trash2,
  X,
  FileCode2,
} from 'lucide-react';
import type { SessionUser } from '../types';
import {
  BUG_CATEGORY_LABELS,
  BUG_STATUS_LABELS,
  canCaptureDisplayScreen,
  captureScreenToFile,
  collectErrorSnapshot,
  fetchBugReports,
  submitBugReport,
  updateBugReportStatusAdmin,
  type BugReportCategory,
  type BugReportRecord,
  type BugReportStatus,
} from '../lib/bugReportService';
import { formatFileSize } from '../lib/imageCompressor';
import { formatTanggalWaktu } from '../lib/format';

interface BugReportCardProps {
  session: SessionUser;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const CATEGORY_OPTIONS: BugReportCategory[] = [
  'error_crash',
  'ui_tampilan',
  'pembayaran_ipl',
  'notifikasi',
  'lainnya',
];

const STATUS_BADGE_CLASSES: Record<BugReportStatus, string> = {
  baru: 'bg-amber-50 text-amber-800 border-amber-200',
  diproses: 'bg-sky-50 text-sky-800 border-sky-200',
  selesai: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export function BugReportCard({ session, onToast }: BugReportCardProps) {
  const isAdmin = session.role === 'admin';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeView, setActiveView] = useState<'form' | 'history'>('form');
  const [category, setCategory] = useState<BugReportCategory>('error_crash');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [includeSnapshot, setIncludeSnapshot] = useState(true);
  const [showSnapshotPreview, setShowSnapshotPreview] = useState(false);

  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreviewUrl, setScreenshotPreviewUrl] = useState<string | null>(null);
  const [capturingScreen, setCapturingScreen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmittedId, setLastSubmittedId] = useState<string | null>(null);

  const [reports, setReports] = useState<BugReportRecord[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(null);

  const screenCaptureSupported = useMemo(() => canCaptureDisplayScreen(), []);
  const currentSnapshot = useMemo(() => collectErrorSnapshot(session), [session, showSnapshotPreview, activeView]);

  const loadReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      const list = await fetchBugReports(session);
      setReports(list);
    } catch {
      // Abaikan diam-diam saat offline
    } finally {
      setLoadingReports(false);
    }
  }, [session]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  useEffect(() => {
    return () => {
      if (screenshotPreviewUrl) {
        URL.revokeObjectURL(screenshotPreviewUrl);
      }
    };
  }, [screenshotPreviewUrl]);

  const attachScreenshotFile = (file: File | null) => {
    if (screenshotPreviewUrl) {
      URL.revokeObjectURL(screenshotPreviewUrl);
    }
    if (!file) {
      setScreenshotFile(null);
      setScreenshotPreviewUrl(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      onToast?.('error', 'Harap pilih file gambar (JPG, PNG, atau WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      onToast?.('error', 'Ukuran gambar maksimal 10 MB.');
      return;
    }
    setScreenshotFile(file);
    setScreenshotPreviewUrl(URL.createObjectURL(file));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      attachScreenshotFile(file);
    }
    e.target.value = '';
  };

  const handleCaptureScreen = async () => {
    if (capturingScreen) return;
    setCapturingScreen(true);
    try {
      const capturedFile = await captureScreenToFile();
      attachScreenshotFile(capturedFile);
      onToast?.('success', 'Screenshot layar berhasil diambil dan siap dikirim.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('permission')) {
        onToast?.('info', 'Pengambilan screenshot dibatalkan.');
      } else {
        onToast?.('error', msg || 'Gagal menangkap layar. Silakan unggah gambar dari galeri.');
      }
    } finally {
      setCapturingScreen(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (title.trim().length < 3) {
      onToast?.('error', 'Isi ringkasan kendala minimal 3 karakter.');
      return;
    }
    if (description.trim().length < 8) {
      onToast?.('error', 'Jelaskan detail kendala minimal 8 karakter.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitBugReport(session, {
        category,
        title,
        description,
        screenshotFile,
        includeSnapshot,
      });

      setLastSubmittedId(res.report.id.slice(0, 8).toUpperCase());
      setTitle('');
      setDescription('');
      attachScreenshotFile(null);
      setReports((prev) => [res.report, ...prev.filter((r) => r.id !== res.report.id)]);

      if (res.savedRemote) {
        onToast?.(
          'success',
          screenshotFile
            ? 'Laporan bug & screenshot berhasil dikirim ke Supabase.'
            : 'Laporan bug berhasil dikirim ke pengurus.'
        );
      } else {
        onToast?.(
          'info',
          'Laporan tersimpan di perangkat (mode lokal). Jalankan migrasi SQL v9 agar tersinkron ke server.'
        );
      }
    } catch (err) {
      onToast?.(
        'error',
        err instanceof Error ? err.message : 'Gagal mengirim laporan bug. Coba lagi.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (reportId: string, nextStatus: BugReportStatus) => {
    if (!isAdmin || updatingStatusId) return;
    setUpdatingStatusId(reportId);
    try {
      await updateBugReportStatusAdmin(session, reportId, nextStatus);
      setReports((prev) =>
        prev.map((item) =>
          item.id === reportId
            ? { ...item, status: nextStatus, updated_at: new Date().toISOString() }
            : item
        )
      );
      onToast?.('success', `Status laporan diperbarui menjadi "${BUG_STATUS_LABELS[nextStatus]}".`);
    } catch (err) {
      onToast?.(
        'error',
        err instanceof Error ? err.message : 'Gagal memperbarui status laporan.'
      );
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const openReportCount = reports.filter((r) => r.status !== 'selesai').length;

  return (
    <div className="space-y-4">
      {/* Header Kartu */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
            <Bug className="w-5 h-5 text-rose-600" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#0F172A]">
              Pelaporan Bug Cepat
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Kirim snapshot error otomatis &amp; screenshot layar langsung ke pengurus saat
              menemukan kendala aplikasi.
            </p>
          </div>
        </div>

        {/* Switcher Tab Form / Riwayat */}
        <div className="inline-flex rounded-xl bg-slate-100 p-1 self-start sm:self-center shrink-0">
          <button
            type="button"
            onClick={() => setActiveView('form')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              activeView === 'form'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            Lapor Bug
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveView('history');
              void loadReports();
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer ${
              activeView === 'history'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-slate-600 hover:text-[#0F172A]'
            }`}
          >
            <span>{isAdmin ? 'Daftar Laporan' : 'Riwayat Saya'}</span>
            {reports.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                  openReportCount > 0
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {reports.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* VIEW 1: FORM PELAPORAN */}
      {activeView === 'form' && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {lastSubmittedId && (
            <div className="flex items-start justify-between gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs text-emerald-900">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Laporan terkirim dengan kode{' '}
                  <strong className="font-mono">#{lastSubmittedId}</strong>. Terima kasih telah
                  membantu perbaikan aplikasi.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLastSubmittedId(null)}
                className="text-emerald-700 hover:text-emerald-900 cursor-pointer"
                aria-label="Tutup notifikasi terkirim"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Kategori & Judul */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-5">
              <label
                htmlFor="bug-category"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Kategori Kendala
              </label>
              <select
                id="bug-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BugReportCategory)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-slate-200 bg-white text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {BUG_CATEGORY_LABELS[opt]}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-7">
              <label
                htmlFor="bug-title"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ringkasan Masalah <span className="text-rose-500">*</span>
              </label>
              <input
                id="bug-title"
                type="text"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: Tombol upload bukti transfer tidak merespons"
                className="w-full min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                required
              />
            </div>
          </div>

          {/* Deskripsi */}
          <div>
            <label
              htmlFor="bug-description"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Detail &amp; Langkah Kejadian <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="bug-description"
              rows={3}
              maxLength={1200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ceritakan menu yang dibuka, tombol yang ditekan, serta pesan error yang muncul..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-sm text-[#0F172A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-y"
              required
            />
          </div>

          {/* Upload / Tangkap Screenshot Layar */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-[#0F172A]">
                  Screenshot Layar (Opsional)
                </p>
                <p className="text-[11px] text-slate-500">
                  Otomatis dikompresi dan diunggah aman ke Supabase Storage.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[36px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ImagePlus className="w-3.5 h-3.5 text-[#059669]" />
                  <span>{screenshotFile ? 'Ganti Gambar' : 'Unggah Screenshot'}</span>
                </button>

                {screenCaptureSupported && (
                  <button
                    type="button"
                    disabled={capturingScreen}
                    onClick={() => void handleCaptureScreen()}
                    className="min-h-[36px] px-3 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {capturingScreen ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                    <span>Tangkap Layar</span>
                  </button>
                )}
              </div>
            </div>

            {screenshotFile && screenshotPreviewUrl && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5">
                <button
                  type="button"
                  onClick={() => setLightboxImageUrl(screenshotPreviewUrl)}
                  className="w-16 h-12 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0 cursor-pointer"
                  title="Perbesar screenshot"
                >
                  <img
                    src={screenshotPreviewUrl}
                    alt="Pratinjau screenshot bug"
                    className="w-full h-full object-cover"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#0F172A] truncate">
                    {screenshotFile.name}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {formatFileSize(screenshotFile.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => attachScreenshotFile(null)}
                  className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  aria-label="Hapus screenshot"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Snapshot Error Otomatis */}
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSnapshot}
                  onChange={(e) => setIncludeSnapshot(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#059669] focus:ring-emerald-500"
                />
                <span>
                  <span className="block text-xs font-bold text-[#0F172A]">
                    Lampirkan Snapshot Error &amp; Info Perangkat Otomatis
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    Versi v{currentSnapshot.app_version} · {currentSnapshot.platform} ·{' '}
                    {currentSnapshot.recent_errors.length} catatan error terekam di sesi ini
                  </span>
                </span>
              </label>

              <button
                type="button"
                onClick={() => setShowSnapshotPreview((v) => !v)}
                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <span>Detail</span>
                {showSnapshotPreview ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {showSnapshotPreview && (
              <div className="rounded-lg bg-slate-900 text-slate-100 p-3 text-[11px] font-mono space-y-1.5 overflow-x-auto">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
                  <span>Versi: v{currentSnapshot.app_version} ({currentSnapshot.build_id})</span>
                  <span>Platform: {currentSnapshot.platform}</span>
                  <span>Layar: {currentSnapshot.viewport}</span>
                  <span>URL: {currentSnapshot.url}</span>
                </div>
                <div className="pt-1.5 border-t border-slate-700/80">
                  <p className="text-emerald-300 font-semibold mb-1">
                    Log Error Sesi ({currentSnapshot.recent_errors.length}):
                  </p>
                  {currentSnapshot.recent_errors.length === 0 ? (
                    <p className="text-slate-400">
                      Belum ada crash/exception JavaScript terekam pada sesi aktif ini.
                    </p>
                  ) : (
                    <ul className="space-y-1 max-h-32 overflow-y-auto">
                      {currentSnapshot.recent_errors.slice(0, 5).map((err, idx) => (
                        <li key={`${err.timestamp}-${idx}`} className="text-rose-300 break-words">
                          [{err.source}] {err.message}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Tombol Kirim */}
          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Mengirim Laporan...</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  <span>Kirim Laporan Bug</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* VIEW 2: RIWAYAT / DAFTAR LAPORAN BUG */}
      {activeView === 'history' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {isAdmin
                ? 'Menampilkan seluruh laporan bug yang dikirim Warga & Pengurus.'
                : 'Menampilkan laporan bug yang pernah Anda kirimkan.'}
            </p>
            <button
              type="button"
              onClick={() => void loadReports()}
              disabled={loadingReports}
              className="min-h-[34px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingReports ? 'animate-spin' : ''}`} />
              <span>Muat Ulang</span>
            </button>
          </div>

          {loadingReports && reports.length === 0 ? (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              <span>Memuat daftar laporan bug...</span>
            </div>
          ) : reports.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
              <Bug className="w-6 h-6 text-slate-300 mx-auto" />
              <p className="text-xs font-semibold text-slate-600 mt-2">
                Belum ada laporan bug yang tercatat.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-0.5">
              {reports.map((item) => {
                const isExpanded = expandedReportId === item.id;
                const errorCount = item.error_snapshot?.recent_errors?.length || 0;
                return (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${STATUS_BADGE_CLASSES[item.status]}`}
                          >
                            {BUG_STATUS_LABELS[item.status]}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                            {BUG_CATEGORY_LABELS[item.category]}
                          </span>
                          {item.is_local_only && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-700">
                              Lokal
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold text-[#0F172A] mt-1.5 break-words">
                          {item.title}
                        </h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {isAdmin && (
                            <span className="font-semibold text-slate-700">
                              {item.reporter_name} ({item.reporter_role === 'warga' ? `Blok ${item.blok_rumah}` : item.reporter_role})
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTanggalWaktu(item.created_at)}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Monitor className="w-3 h-3" />
                            v{item.app_version} · {item.platform}
                          </span>
                        </p>
                      </div>

                      {item.screenshot_url && (
                        <button
                          type="button"
                          onClick={() => setLightboxImageUrl(item.screenshot_url)}
                          className="w-14 h-12 rounded-lg overflow-hidden border border-slate-200 bg-white shrink-0 cursor-pointer hover:opacity-90"
                          title="Lihat screenshot"
                        >
                          <img
                            src={item.screenshot_url}
                            alt={`Screenshot ${item.title}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                      {item.description}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedReportId(isExpanded ? null : item.id)
                        }
                        className="text-[11px] font-semibold text-slate-600 hover:text-[#0F172A] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          Snapshot ({errorCount} error)
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {isAdmin && (
                        <div className="inline-flex items-center gap-1">
                          {(['baru', 'diproses', 'selesai'] as BugReportStatus[]).map((st) => (
                            <button
                              key={st}
                              type="button"
                              disabled={updatingStatusId === item.id || item.status === st}
                              onClick={() => void handleStatusChange(item.id, st)}
                              className={`px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer disabled:cursor-default ${
                                item.status === st
                                  ? STATUS_BADGE_CLASSES[st]
                                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {BUG_STATUS_LABELS[st]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="rounded-lg bg-slate-900 text-slate-100 p-2.5 text-[11px] font-mono space-y-1 overflow-x-auto">
                        {item.error_snapshot ? (
                          <>
                            <p className="text-slate-300">
                              URL: {item.error_snapshot.url} · Layar: {item.error_snapshot.viewport}
                            </p>
                            <p className="text-slate-400 break-all">
                              UA: {item.error_snapshot.user_agent}
                            </p>
                            {item.error_snapshot.recent_errors.length > 0 ? (
                              <div className="pt-1.5 mt-1.5 border-t border-slate-700 space-y-1">
                                {item.error_snapshot.recent_errors.map((err, idx) => (
                                  <div key={`${err.timestamp}-${idx}`} className="text-rose-300 break-words">
                                    [{err.source}] {err.message}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-slate-400 pt-1">
                                Tidak ada exception JavaScript terekam saat laporan dikirim.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-slate-400">
                            Pengguna tidak menyertakan snapshot perangkat pada laporan ini.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal Pratinjau Screenshot (In-App Lightbox) */}
      {lightboxImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setLightboxImageUrl(null)}
        >
          <div
            className="relative max-w-3xl w-full bg-white rounded-2xl overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-xs font-bold text-[#0F172A]">Pratinjau Screenshot Laporan Bug</span>
              <button
                type="button"
                onClick={() => setLightboxImageUrl(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer"
                aria-label="Tutup pratinjau screenshot"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-slate-100 max-h-[75dvh] overflow-auto flex items-center justify-center">
              <img
                src={lightboxImageUrl}
                alt="Screenshot laporan bug"
                className="max-w-full max-h-[68dvh] rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
