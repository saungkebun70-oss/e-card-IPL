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
import { formatBlokRumah, formatTanggalWaktu } from '../lib/format';

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
  baru: 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]',
  diproses: 'bg-[#F7F4EC] text-[#384E35] border-[#C6D2BF]',
  selesai: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
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
          <div className="w-10 h-10 rounded-2xl bg-[#C87058]/15 border border-[#E2A898] flex items-center justify-center shrink-0">
            <Bug className="w-5 h-5 text-[#9A422B]" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#1B271B]">
              Pelaporan Bug Cepat
            </h3>
            <p className="text-xs text-[#6E786D] mt-0.5 leading-relaxed">
              Kirim snapshot error otomatis &amp; screenshot layar langsung ke pengurus saat
              menemukan kendala aplikasi.
            </p>
          </div>
        </div>

        {/* Switcher Tab Form / Riwayat */}
        <div className="inline-flex rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] p-1 self-start sm:self-center shrink-0">
          <button
            type="button"
            onClick={() => setActiveView('form')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeView === 'form'
                ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                : 'text-[#4A554A] hover:text-[#243825]'
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
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              activeView === 'history'
                ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                : 'text-[#4A554A] hover:text-[#243825]'
            }`}
          >
            <span>{isAdmin ? 'Daftar Laporan' : 'Riwayat Saya'}</span>
            {reports.length > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold tabular-nums ${
                  activeView === 'history'
                    ? 'bg-white/20 text-[#FFFDF8]'
                    : openReportCount > 0
                      ? 'bg-[#C87058]/20 text-[#7A311E]'
                      : 'bg-[#E5EEE3] text-[#243825]'
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
            <div className="flex items-start justify-between gap-2 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] px-3.5 py-2.5 text-xs text-[#243825]">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#243825] shrink-0 mt-0.5" />
                <span>
                  Laporan terkirim dengan kode{' '}
                  <strong className="font-mono">#{lastSubmittedId}</strong>. Terima kasih telah
                  membantu perbaikan aplikasi.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLastSubmittedId(null)}
                className="text-[#384E35] hover:text-[#243825] cursor-pointer"
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
                className="block text-xs font-semibold text-[#4A554A] mb-1"
              >
                Kategori Kendala
              </label>
              <select
                id="bug-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as BugReportCategory)}
                className="w-full min-h-[42px] px-3.5 rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] text-sm text-[#1B271B] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20 focus:border-[#2B3F29]"
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
                className="block text-xs font-semibold text-[#4A554A] mb-1"
              >
                Ringkasan Masalah <span className="text-[#C87058]">*</span>
              </label>
              <input
                id="bug-title"
                type="text"
                maxLength={100}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Contoh: Tombol upload bukti transfer tidak merespons"
                className="w-full min-h-[42px] px-3.5 rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] text-sm text-[#1B271B] placeholder:text-[#6E786D]/70 focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20 focus:border-[#2B3F29]"
                required
              />
            </div>
          </div>

          {/* Deskripsi */}
          <div>
            <label
              htmlFor="bug-description"
              className="block text-xs font-semibold text-[#4A554A] mb-1"
            >
              Detail &amp; Langkah Kejadian <span className="text-[#C87058]">*</span>
            </label>
            <textarea
              id="bug-description"
              rows={3}
              maxLength={1200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ceritakan menu yang dibuka, tombol yang ditekan, serta pesan error yang muncul..."
              className="w-full px-3.5 py-2.5 rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] text-sm text-[#1B271B] placeholder:text-[#6E786D]/70 focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/20 focus:border-[#2B3F29] resize-y"
              required
            />
          </div>

          {/* Upload / Tangkap Screenshot Layar */}
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F7F4EC] p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-[#1B271B]">
                  Screenshot Layar (Opsional)
                </p>
                <p className="text-[11px] text-[#6E786D]">
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
                  className="min-h-[38px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <ImagePlus className="w-3.5 h-3.5 text-[#243825]" />
                  <span>{screenshotFile ? 'Ganti Gambar' : 'Unggah Screenshot'}</span>
                </button>

                {screenCaptureSupported && (
                  <button
                    type="button"
                    disabled={capturingScreen}
                    onClick={() => void handleCaptureScreen()}
                    className="min-h-[38px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
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
              <div className="flex items-center gap-3 rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-2.5">
                <button
                  type="button"
                  onClick={() => setLightboxImageUrl(screenshotPreviewUrl)}
                  className="w-16 h-12 rounded-xl overflow-hidden border border-[#E6E2D6] bg-[#F7F4EC] shrink-0 cursor-pointer"
                  title="Perbesar screenshot"
                >
                  <img
                    src={screenshotPreviewUrl}
                    alt="Pratinjau screenshot bug"
                    className="w-full h-full object-cover"
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#1B271B] truncate">
                    {screenshotFile.name}
                  </p>
                  <p className="text-[11px] text-[#6E786D] font-mono">
                    {formatFileSize(screenshotFile.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => attachScreenshotFile(null)}
                  className="p-2 rounded-full text-[#6E786D] hover:text-[#9A422B] hover:bg-[#C87058]/15 transition-colors cursor-pointer"
                  aria-label="Hapus screenshot"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Snapshot Error Otomatis */}
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-3.5 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeSnapshot}
                  onChange={(e) => setIncludeSnapshot(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-[#C6D2BF] text-[#2B3F29] accent-[#2B3F29] focus:ring-[#2B3F29]"
                />
                <span>
                  <span className="block text-xs font-bold text-[#1B271B]">
                    Lampirkan Snapshot Error &amp; Info Perangkat Otomatis
                  </span>
                  <span className="block text-[11px] text-[#6E786D] mt-0.5">
                    Versi v{currentSnapshot.app_version} · {currentSnapshot.platform} ·{' '}
                    {currentSnapshot.recent_errors.length} catatan error terekam di sesi ini
                  </span>
                </span>
              </label>

              <button
                type="button"
                onClick={() => setShowSnapshotPreview((v) => !v)}
                className="text-[11px] font-semibold text-[#243825] hover:text-[#1B271B] inline-flex items-center gap-1 shrink-0 cursor-pointer"
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
              <div className="rounded-2xl bg-[#1B271B] text-[#F6F3EA] p-3 text-[11px] font-mono space-y-1.5 overflow-x-auto">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[#C6D2BF]">
                  <span>Versi: v{currentSnapshot.app_version} ({currentSnapshot.build_id})</span>
                  <span>Platform: {currentSnapshot.platform}</span>
                  <span>Layar: {currentSnapshot.viewport}</span>
                  <span>URL: {currentSnapshot.url}</span>
                </div>
                <div className="pt-1.5 border-t border-white/15">
                  <p className="text-[#E5EEE3] font-semibold mb-1">
                    Log Error Sesi ({currentSnapshot.recent_errors.length}):
                  </p>
                  {currentSnapshot.recent_errors.length === 0 ? (
                    <p className="text-[#C6D2BF]/80">
                      Belum ada crash/exception JavaScript terekam pada sesi aktif ini.
                    </p>
                  ) : (
                    <ul className="space-y-1 max-h-32 overflow-y-auto">
                      {currentSnapshot.recent_errors.slice(0, 5).map((err, idx) => (
                        <li key={`${err.timestamp}-${idx}`} className="text-[#F2D8A7] break-words">
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
              className="w-full sm:w-auto min-h-[44px] px-6 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm whitespace-nowrap"
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
            <p className="text-xs text-[#6E786D]">
              {isAdmin
                ? 'Menampilkan seluruh laporan bug yang dikirim Warga & Pengurus.'
                : 'Menampilkan laporan bug yang pernah Anda kirimkan.'}
            </p>
            <button
              type="button"
              onClick={() => void loadReports()}
              disabled={loadingReports}
              className="min-h-[36px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-xs font-semibold text-[#243825] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingReports ? 'animate-spin' : ''}`} />
              <span>Muat Ulang</span>
            </button>
          </div>

          {loadingReports && reports.length === 0 ? (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-[#6E786D]">
              <Loader2 className="w-4 h-4 animate-spin text-[#243825]" />
              <span>Memuat daftar laporan bug...</span>
            </div>
          ) : reports.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#C6D2BF] bg-[#F7F4EC] p-6 text-center">
              <Bug className="w-6 h-6 text-[#6E786D] mx-auto" />
              <p className="text-xs font-semibold text-[#4A554A] mt-2">
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
                    className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${STATUS_BADGE_CLASSES[item.status]}`}
                          >
                            {BUG_STATUS_LABELS[item.status]}
                          </span>
                          <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825]">
                            {BUG_CATEGORY_LABELS[item.category]}
                          </span>
                          {item.is_local_only && (
                            <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#F7F4EC] border border-[#E6E2D6] text-[#4A554A]">
                              Lokal
                            </span>
                          )}
                        </div>
                        <h4 className="text-sm font-bold text-[#1B271B] mt-1.5 break-words">
                          {item.title}
                        </h4>
                        <p className="text-[11px] text-[#6E786D] mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {isAdmin && (
                            <span className="font-semibold text-[#4A554A]">
                              {item.reporter_name} ({item.reporter_role === 'warga' ? `Blok ${formatBlokRumah(item.blok_rumah)}` : item.reporter_role})
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
                          className="w-14 h-12 rounded-xl overflow-hidden border border-[#E6E2D6] bg-[#FFFDF8] shrink-0 cursor-pointer hover:opacity-90"
                          title="Lihat screenshot"
                        >
                          <img
                            src={item.screenshot_url}
                            alt={`Screenshot ${item.title}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      )}
                    </div>

                    <p className="text-xs text-[#4A554A] whitespace-pre-line leading-relaxed">
                      {item.description}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E6E2D6]">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedReportId(isExpanded ? null : item.id)
                        }
                        className="text-[11px] font-semibold text-[#243825] hover:text-[#1B271B] inline-flex items-center gap-1 cursor-pointer"
                      >
                        <FileCode2 className="w-3.5 h-3.5 text-[#384E35]" />
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
                              className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer disabled:cursor-default ${
                                item.status === st
                                  ? STATUS_BADGE_CLASSES[st]
                                  : 'bg-[#FFFDF8] border-[#E6E2D6] text-[#4A554A] hover:bg-[#F7F4EC]'
                              }`}
                            >
                              {BUG_STATUS_LABELS[st]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="rounded-2xl bg-[#1B271B] text-[#F6F3EA] p-3 text-[11px] font-mono space-y-1 overflow-x-auto">
                        {item.error_snapshot ? (
                          <>
                            <p className="text-[#C6D2BF]">
                              URL: {item.error_snapshot.url} · Layar: {item.error_snapshot.viewport}
                            </p>
                            <p className="text-[#C6D2BF]/75 break-all">
                              UA: {item.error_snapshot.user_agent}
                            </p>
                            {item.error_snapshot.recent_errors.length > 0 ? (
                              <div className="pt-1.5 mt-1.5 border-t border-white/15 space-y-1">
                                {item.error_snapshot.recent_errors.map((err, idx) => (
                                  <div key={`${err.timestamp}-${idx}`} className="text-[#F2D8A7] break-words">
                                    [{err.source}] {err.message}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[#C6D2BF]/80 pt-1">
                                Tidak ada exception JavaScript terekam saat laporan dikirim.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-[#C6D2BF]/80">
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
          className="fixed inset-0 z-50 bg-[#1B271B]/65 backdrop-blur-md animate-modal-backdrop flex items-center justify-center p-4"
          onClick={() => setLightboxImageUrl(null)}
        >
          <div
            className="relative max-w-3xl w-full bg-[#FFFDF8] backdrop-blur-xl border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-2xl animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC] flex items-center justify-between">
              <span className="text-xs font-bold text-[#1B271B]">Pratinjau Screenshot Laporan Bug</span>
              <button
                type="button"
                onClick={() => setLightboxImageUrl(null)}
                className="p-1.5 rounded-full text-[#4A554A] hover:bg-[#E5EEE3]/70 cursor-pointer"
                aria-label="Tutup pratinjau screenshot"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 bg-[#F6F3EA] max-h-[75dvh] overflow-auto flex items-center justify-center">
              <img
                src={lightboxImageUrl}
                alt="Screenshot laporan bug"
                className="max-w-full max-h-[68dvh] rounded-2xl object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
