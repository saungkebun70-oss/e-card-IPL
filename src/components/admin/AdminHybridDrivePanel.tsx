import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  DatabaseBackup,
  ExternalLink,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  checkFirebaseDomainAuthorization,
  DRIVE_TARGET_EMAIL,
  FIREBASE_AUTH_SETTINGS_URL,
  getGoogleDriveAccessToken,
  googleDriveLogout,
  initGoogleDriveAuth,
  isEmbeddedWebView,
  signInGoogleDrive,
  type DomainAuthCheckResult,
} from '../../lib/googleDriveAuth';
import {
  backupDatabaseSnapshotToDrive,
  deleteHybridDriveFile,
  ensureHybridFolderStructure,
  fetchBackendStorageStatus,
  fetchDriveAbout,
  formatBytesCompact,
  HYBRID_ROOT_FOLDER_NAME,
  HYBRID_SUBFOLDER_NAMES,
  listHybridDriveFiles,
  loadHybridDriveConfig,
  runHybridArchiveBatch,
  saveHybridDriveConfig,
  scanHybridMediaInventory,
  updateBackendHybridThresholdConfig,
  type BackendStorageStatus,
  type DriveAboutInfo,
  type DriveManagedFile,
  type HybridDriveConfig,
  type HybridFolderKey,
  type HybridMediaScanSummary,
} from '../../lib/googleDriveHybridService';
import { formatTanggalWaktu } from '../../lib/format';
import { isBendaharaFullAccess, type SessionUser } from '../../types';

interface AdminHybridDrivePanelProps {
  session: SessionUser;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const RETENTION_OPTIONS = [
  { value: 30, label: 'Lebih dari 30 Hari' },
  { value: 90, label: 'Lebih dari 90 Hari (Disarankan)' },
  { value: 180, label: 'Lebih dari 6 Bulan (180 Hari)' },
  { value: 365, label: 'Lebih dari 1 Tahun (365 Hari)' },
  { value: 0, label: 'Semua Media Final di Supabase' },
];

const FOLDER_FILTER_LABELS: Array<{ key: HybridFolderKey | 'all'; label: string }> = [
  { key: 'all', label: 'Semua Folder' },
  { key: 'bukti_ipl', label: 'Bukti IPL' },
  { key: 'pengeluaran_kas', label: 'Nota Kas' },
  { key: 'absensi_keamanan', label: 'Absensi Keamanan' },
  { key: 'bug_reports', label: 'Laporan Bug' },
  { key: 'avatars', label: 'Foto Profil' },
  { key: 'backup_database', label: 'Backup DB' },
];

const THRESHOLD_PERCENT_OPTIONS = [60, 70, 75, 80, 85, 90];

export function AdminHybridDrivePanel({
  session,
  onRefresh,
  onToast,
}: AdminHybridDrivePanelProps) {
  const canManage = isBendaharaFullAccess(session) || session.jabatan === 'Ketua';

  const [config, setConfig] = useState<HybridDriveConfig>(() => loadHybridDriveConfig());
  const [needsAuth, setNeedsAuth] = useState(true);
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInErrorMsg, setSignInErrorMsg] = useState<string | null>(null);
  const [domainStatus, setDomainStatus] = useState<DomainAuthCheckResult | null>(null);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const [inWebView] = useState(() => isEmbeddedWebView());

  const [driveAbout, setDriveAbout] = useState<DriveAboutInfo | null>(null);
  const [loadingDriveInfo, setLoadingDriveInfo] = useState(false);

  const [scanSummary, setScanSummary] = useState<HybridMediaScanSummary | null>(null);
  const [scanning, setScanning] = useState(false);
  const [backendMonitor, setBackendMonitor] = useState<BackendStorageStatus | null>(null);
  const [loadingMonitor, setLoadingMonitor] = useState(false);
  const [savingThreshold, setSavingThreshold] = useState(false);

  const [driveFiles, setDriveFiles] = useState<DriveManagedFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [folderFilter, setFolderFilter] = useState<HybridFolderKey | 'all'>('all');

  const [archiving, setArchiving] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);

  const [backingUp, setBackingUp] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);

  // Dialog konfirmasi eksplisit (wajib sebelum mutasi/hapus ke API Workspace)
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [confirmDeleteFile, setConfirmDeleteFile] = useState<DriveManagedFile | null>(null);
  const [previewImageFile, setPreviewImageFile] = useState<DriveManagedFile | null>(null);

  const updateConfig = (patch: Partial<HybridDriveConfig>) => {
    const next = saveHybridDriveConfig(patch);
    setConfig(next);
  };

  const refreshBackendMonitor = useCallback(
    async (forceRefresh = true) => {
      setLoadingMonitor(true);
      try {
        const res = await fetchBackendStorageStatus(session, forceRefresh);
        if (res) setBackendMonitor(res);
      } finally {
        setLoadingMonitor(false);
      }
    },
    [session]
  );

  const handleSaveBackendRule = async (patch: {
    thresholdPercent?: number;
    autoRouteOnNearLimit?: boolean;
    forceRouteToDrive?: boolean;
  }) => {
    if (!canManage || savingThreshold) return;
    setSavingThreshold(true);
    try {
      const updated = await updateBackendHybridThresholdConfig(session, patch);
      setBackendMonitor(updated);
      onToast('success', 'Aturan pemantauan penyimpanan backend diperbarui.');
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Gagal memperbarui aturan monitor backend.'
      );
    } finally {
      setSavingThreshold(false);
    }
  };

  const runInventoryScan = useCallback(
    async (retentionDays: number) => {
      setScanning(true);
      try {
        const res = await scanHybridMediaInventory(session, retentionDays);
        setScanSummary(res);
      } catch (err) {
        onToast(
          'error',
          err instanceof Error ? err.message : 'Gagal memindai media penyimpanan Supabase.'
        );
      } finally {
        setScanning(false);
      }
    },
    [session, onToast]
  );

  const loadDriveWorkspace = useCallback(
    async (token: string, filter: HybridFolderKey | 'all' = folderFilter) => {
      setLoadingDriveInfo(true);
      setLoadingFiles(true);
      try {
        const [about] = await Promise.all([
          fetchDriveAbout(token),
          ensureHybridFolderStructure(token),
        ]);
        setDriveAbout(about);
        const files = await listHybridDriveFiles(token, filter, 50);
        setDriveFiles(files);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat status Google Drive.';
        onToast('error', msg);
        if (msg.includes('Sesi Google Drive telah berakhir')) {
          setAccessToken(null);
          setNeedsAuth(true);
        }
      } finally {
        setLoadingDriveInfo(false);
        setLoadingFiles(false);
      }
    },
    [folderFilter, onToast]
  );

  useEffect(() => {
    const unsub = initGoogleDriveAuth(
      (user, token) => {
        setGoogleUser(user);
        setAccessToken(token);
        setNeedsAuth(false);
      },
      (user) => {
        setGoogleUser(user);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );

    void getGoogleDriveAccessToken().then((token) => {
      if (token) {
        setAccessToken(token);
        setNeedsAuth(false);
        void loadDriveWorkspace(token, folderFilter);
      }
    });

    void checkFirebaseDomainAuthorization(false).then((res) => {
      setDomainStatus(res);
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void runInventoryScan(config.retentionDays);
    void refreshBackendMonitor(true);
  }, [config.retentionDays, runInventoryScan, refreshBackendMonitor]);

  const handleRecheckDomain = async () => {
    if (checkingDomain) return;
    setCheckingDomain(true);
    try {
      const res = await checkFirebaseDomainAuthorization(true);
      setDomainStatus(res);
      if (res.checked && res.authorized) {
        setSignInErrorMsg(null);
        onToast('success', `Domain ${res.hostname} sudah terdaftar dan siap untuk login Google.`);
      } else if (res.checked && !res.authorized) {
        onToast('error', `Domain ${res.hostname} masih belum terdaftar di Firebase Authorized Domains.`);
      }
    } finally {
      setCheckingDomain(false);
    }
  };

  const handleCopyHostname = async (hostname: string) => {
    try {
      await navigator.clipboard.writeText(hostname);
      onToast('success', `Domain "${hostname}" disalin.`);
    } catch {
      onToast('info', `Salin manual domain ini: ${hostname}`);
    }
  };

  const handleGoogleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setSignInErrorMsg(null);
    try {
      const { user, accessToken: token } = await signInGoogleDrive();
      setGoogleUser(user);
      setAccessToken(token);
      setNeedsAuth(false);
      setSignInErrorMsg(null);
      await loadDriveWorkspace(token, folderFilter);

      const signedEmail = (user.email || '').toLowerCase();
      if (signedEmail === DRIVE_TARGET_EMAIL.toLowerCase()) {
        onToast('success', `Google Drive ${DRIVE_TARGET_EMAIL} berhasil terhubung.`);
      } else {
        onToast(
          'info',
          `Terhubung ke ${user.email || 'akun Google'}. Disarankan memakai ${DRIVE_TARGET_EMAIL}.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login Google Drive dibatalkan atau gagal.';
      setSignInErrorMsg(msg);
      onToast('error', msg);
    } finally {
      setSigningIn(false);
    }
  };

  const handleGoogleSignOut = async () => {
    await googleDriveLogout();
    setAccessToken(null);
    setGoogleUser(null);
    setDriveAbout(null);
    setDriveFiles([]);
    setNeedsAuth(true);
    onToast('info', 'Koneksi Google Drive telah diputuskan dari sesi ini.');
  };

  const handleFilterChange = async (nextFilter: HybridFolderKey | 'all') => {
    setFolderFilter(nextFilter);
    if (!accessToken) return;
    setLoadingFiles(true);
    try {
      const files = await listHybridDriveFiles(accessToken, nextFilter, 50);
      setDriveFiles(files);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Gagal menyaring daftar file Drive.'
      );
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleConfirmExecuteArchive = async () => {
    if (!accessToken || !scanSummary || scanSummary.eligibleCandidates.length === 0) return;
    setConfirmArchiveOpen(false);
    setArchiving(true);
    setArchiveProgress({
      current: 0,
      total: scanSummary.eligibleCandidates.length,
      label: 'Menyiapkan folder Google Drive...',
    });

    try {
      const res = await runHybridArchiveBatch({
        session,
        accessToken,
        candidates: scanSummary.eligibleCandidates,
        deleteFromSupabase: config.deleteSupabaseAfterArchive,
        onProgress: (current, total, label) => {
          setArchiveProgress({ current, total, label });
        },
      });

      setConfig(loadHybridDriveConfig());

      if (res.archivedCount > 0) {
        onToast(
          'success',
          `${res.archivedCount} foto berhasil diarsipkan ke Google Drive${
            res.freedSupabaseCount > 0
              ? ` dan ${res.freedSupabaseCount} file lama dibersihkan dari Supabase.`
              : '.'
          }`
        );
      }
      if (res.failedCount > 0) {
        onToast(
          'error',
          `${res.failedCount} item gagal diproses (${res.errors[0] || 'periksa koneksi'}).`
        );
      }

      await Promise.all([
        runInventoryScan(config.retentionDays),
        loadDriveWorkspace(accessToken, folderFilter),
        onRefresh(),
      ]);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Terjadi kendala saat mengarsipkan ke Drive.'
      );
    } finally {
      setArchiving(false);
      setArchiveProgress(null);
    }
  };

  const handleBackupDatabase = async () => {
    if (!accessToken || backingUp) return;
    setBackingUp(true);
    try {
      const res = await backupDatabaseSnapshotToDrive(session, accessToken);
      setConfig(loadHybridDriveConfig());
      onToast(
        'success',
        `Cadangan database ${res.fileName} (${formatBytesCompact(res.sizeBytes)}) tersimpan di Google Drive.`
      );
      await loadDriveWorkspace(accessToken, folderFilter);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Gagal membuat cadangan database ke Drive.'
      );
    } finally {
      setBackingUp(false);
    }
  };

  const handleConfirmDeleteDriveFile = async () => {
    if (!accessToken || !confirmDeleteFile || deletingFileId) return;
    const target = confirmDeleteFile;
    setDeletingFileId(target.id);
    try {
      await deleteHybridDriveFile(accessToken, target.id);
      setDriveFiles((prev) => prev.filter((item) => item.id !== target.id));
      setConfirmDeleteFile(null);
      onToast('success', `File "${target.name}" berhasil dihapus dari Google Drive.`);
      const about = await fetchDriveAbout(accessToken);
      setDriveAbout(about);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error ? err.message : 'Gagal menghapus file di Google Drive.'
      );
    } finally {
      setDeletingFileId(null);
    }
  };

  const activeEmail = driveAbout?.emailAddress || googleUser?.email || '';
  const isTargetEmailMatched =
    Boolean(activeEmail) && activeEmail.toLowerCase() === DRIVE_TARGET_EMAIL.toLowerCase();

  const quotaLimit = driveAbout?.limitBytes || 15 * 1024 * 1024 * 1024;
  const quotaUsed = driveAbout?.usageBytes || 0;
  const quotaPct = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Banner Penjelasan Mode Hybrid */}
      <div className="glass-card rounded-3xl p-5 border border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 via-white to-emerald-50/50 space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#4C1D95] text-emerald-300 flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-[#0F172A]">
                Penyimpanan Mode Hybrid (Supabase + Google Drive)
              </h3>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                Target: {DRIVE_TARGET_EMAIL}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              Transaksi harian Warga dan patroli Keamanan tetap masuk ke{' '}
              <strong>Supabase Storage</strong> tanpa perlu login Google. Saat kuota menumpuk,
              Pengurus dapat mengarsipkan foto lama secara batch ke{' '}
              <strong>Google Drive ({DRIVE_TARGET_EMAIL})</strong> dan membersihkan salinan lama
              agar ruang Supabase selalu lega sementara seluruh gambar tetap tampil di aplikasi.
            </p>
          </div>
        </div>
      </div>

      {!canManage && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-[#FEF3C7] border border-amber-200 px-4 py-3 text-xs text-amber-900">
          <ShieldAlert className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
          <span>
            Mode lihat saja ({session.jabatan || 'Pengurus'}). Pengarsipan &amp; koneksi Google Drive
            khusus akun <strong>Bendahara</strong> atau <strong>Ketua</strong>.
          </span>
        </div>
      )}

      {/* Kartu Koneksi Akun Google Drive saungkebun70@gmail.com */}
      <div className="glass-card rounded-3xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-[#4C1D95]" />
              <span>Koneksi Google Drive Pusat Pengurus</span>
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Hubungkan dengan akun Google{' '}
              <span className="font-mono font-semibold text-slate-700">{DRIVE_TARGET_EMAIL}</span>{' '}
              untuk mengelola folder{' '}
              <span className="font-mono text-[#4C1D95]">{HYBRID_ROOT_FOLDER_NAME}</span>.
            </p>
          </div>

          {!needsAuth && accessToken && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loadingDriveInfo}
                onClick={() => void loadDriveWorkspace(accessToken, folderFilter)}
                className="min-h-[36px] px-3 rounded-full border border-indigo-100 bg-white hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDriveInfo ? 'animate-spin' : ''}`} />
                <span>Segarkan Drive</span>
              </button>
              <button
                type="button"
                onClick={handleGoogleSignOut}
                className="min-h-[36px] px-3.5 rounded-full border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Keluar Google</span>
              </button>
            </div>
          )}
        </div>

        {needsAuth || !accessToken ? (
          <div className="space-y-3">
            {inWebView && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-xs text-amber-950 space-y-1.5">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Gunakan Google Chrome (Bukan APK/WebView) untuk Login Google Drive</span>
                </p>
                <p className="leading-relaxed">
                  Google memblokir login OAuth di dalam WebView aplikasi Android. Buka alamat portal{' '}
                  <span className="font-mono font-semibold">
                    https://{typeof window !== 'undefined' ? window.location.hostname : 'e-card-ipl.vercel.app'}
                  </span>{' '}
                  melalui browser <strong>Google Chrome</strong> untuk menghubungkan akun{' '}
                  <strong>{DRIVE_TARGET_EMAIL}</strong>.
                </p>
              </div>
            )}

            {domainStatus?.checked && !domainStatus.authorized && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50/85 p-4 text-xs text-rose-950 space-y-2.5">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">
                      Domain &quot;{domainStatus.hostname}&quot; Belum Didaftarkan di Firebase
                    </p>
                    <p className="leading-relaxed text-rose-900">
                      Jika muncul pesan <em>&quot;The requested action is invalid.&quot;</em> saat
                      login Google, penyebabnya adalah domain di bawah ini belum masuk ke{' '}
                      <strong>Authorized domains</strong> pada project Firebase{' '}
                      <span className="font-mono font-semibold">{domainStatus.projectId}</span>:
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 bg-white/90 border border-rose-200 rounded-xl px-3 py-2">
                  <code className="font-mono font-bold text-xs text-[#0F172A] flex-1 truncate">
                    {domainStatus.hostname}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopyHostname(domainStatus.hostname)}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-800 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Salin Domain</span>
                  </button>
                </div>

                <ol className="list-decimal list-inside space-y-1 text-[11px] text-rose-900">
                  <li>
                    Buka <strong>Firebase Console → Authentication → Settings → Authorized domains</strong>.
                  </li>
                  <li>
                    Klik <strong>Add domain</strong> lalu tempel <span className="font-mono font-semibold">{domainStatus.hostname}</span>.
                  </li>
                  <li>
                    Simpan, lalu klik tombol <strong>Cek Ulang Domain</strong> di bawah sebelum klik <em>Sign in with Google</em>.
                  </li>
                </ol>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <a
                    href={FIREBASE_AUTH_SETTINGS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[34px] px-3.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold inline-flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Buka Pengaturan Firebase</span>
                  </a>
                  <button
                    type="button"
                    disabled={checkingDomain}
                    onClick={() => void handleRecheckDomain()}
                    className="min-h-[34px] px-3.5 rounded-full border border-rose-200 bg-white hover:bg-rose-100 text-rose-800 text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkingDomain ? 'animate-spin' : ''}`} />
                    <span>{checkingDomain ? 'Memeriksa...' : 'Cek Ulang Domain'}</span>
                  </button>
                </div>
              </div>
            )}

            {signInErrorMsg && (!domainStatus?.checked || domainStatus.authorized) && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/85 px-4 py-3 text-xs text-amber-950 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{signInErrorMsg}</span>
              </div>
            )}

            <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-bold text-[#0F172A]">
                  Google Drive belum terhubung di sesi ini
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Klik tombol resmi Google di samping untuk masuk menggunakan{' '}
                  <span className="font-mono font-semibold">{DRIVE_TARGET_EMAIL}</span>. Token hanya
                  disimpan sementara di memori selama tab aktif.
                </p>
              </div>

              <button
                type="button"
                disabled={!canManage || signingIn}
                onClick={handleGoogleSignIn}
                className="gsi-material-button inline-flex items-center justify-center gap-3 min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 shadow-sm text-sm font-semibold text-slate-800 cursor-pointer disabled:opacity-50 shrink-0 transition-colors"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper flex items-center gap-2.5">
                  <div className="gsi-material-button-icon w-5 h-5 shrink-0">
                    {signingIn ? (
                      <Loader2 className="w-5 h-5 animate-spin text-[#4C1D95]" />
                    ) : (
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        style={{ display: 'block', width: '20px', height: '20px' }}
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                        <path fill="none" d="M0 0h48v48H0z" />
                      </svg>
                    )}
                  </div>
                  <span className="gsi-material-button-contents">
                    {signingIn ? 'Menghubungkan...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                isTargetEmailMatched
                  ? 'border-emerald-200 bg-emerald-50/70'
                  : 'border-amber-200 bg-amber-50/70'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    isTargetEmailMatched
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 text-white'
                  }`}
                >
                  {isTargetEmailMatched ? (
                    <ShieldCheck className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0F172A] truncate">
                    {driveAbout?.displayName || googleUser?.displayName || 'Akun Google Terhubung'}
                  </p>
                  <p className="text-xs font-mono text-slate-700 truncate">
                    {activeEmail || DRIVE_TARGET_EMAIL}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <span
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                    isTargetEmailMatched
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border border-amber-300'
                  }`}
                >
                  {isTargetEmailMatched
                    ? 'Sesuai Akun Pusat Saung Kebun'
                    : `Bukan ${DRIVE_TARGET_EMAIL}`}
                </span>
                {!isTargetEmailMatched && (
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="px-3 py-1 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold cursor-pointer"
                  >
                    Ganti Akun
                  </button>
                )}
              </div>
            </div>

            {/* Kuota Google Drive */}
            <div className="rounded-2xl border border-indigo-100 bg-white/90 p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700">
                  Kapasitas Google Drive ({activeEmail || DRIVE_TARGET_EMAIL})
                </span>
                <span className="font-mono font-bold text-[#4C1D95] tabular-nums">
                  {formatBytesCompact(quotaUsed)} /{' '}
                  {quotaLimit > 0 ? formatBytesCompact(quotaLimit) : 'Tak Terbatas'} ({quotaPct}%)
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-indigo-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#4C1D95] to-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.max(quotaPct, 2)}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-0.5">
                <span>
                  Folder Arsip:{' '}
                  <strong className="text-slate-700">{HYBRID_ROOT_FOLDER_NAME}</strong> (5
                  subfolder otomatis)
                </span>
                {config.lastBackupAt && (
                  <span>Backup DB terakhir: {formatTanggalWaktu(config.lastBackupAt)}</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Kartu Pemantauan Backend Supabase & Pengalihan Otomatis ke Google Drive */}
      <div className="glass-card rounded-3xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#4C1D95]" />
              <span>Monitor Backend Penyimpanan Supabase &amp; Routing OAuth2</span>
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Backend memantau kuota Storage &amp; Database Supabase secara real-time dan mengalihkan
              upload media baru ke Google Drive bila mendekati batas.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingMonitor}
            onClick={() => void refreshBackendMonitor(true)}
            className="min-h-[36px] px-3.5 rounded-full border border-indigo-100 bg-white hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMonitor ? 'animate-spin' : ''}`} />
            <span>Cek Kuota</span>
          </button>
        </div>

        {/* Status Routing Aktif */}
        {backendMonitor && (
          <div
            className={`rounded-2xl border p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-xs ${
              backendMonitor.shouldRouteNewMediaToDrive
                ? 'border-amber-200 bg-amber-50/80 text-amber-950'
                : 'border-emerald-200 bg-emerald-50/70 text-emerald-950'
            }`}
          >
            <div className="space-y-0.5">
              <p className="font-bold flex items-center gap-1.5">
                <span>
                  {backendMonitor.shouldRouteNewMediaToDrive
                    ? 'Pengalihan Otomatis ke Google Drive AKTIF'
                    : 'Mode Normal: Media Baru Disimpan di Supabase'}
                </span>
              </p>
              <p className="text-[11px] opacity-90">{backendMonitor.routeReason}</p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-[11px] font-bold shrink-0 self-start sm:self-center ${
                backendMonitor.shouldRouteNewMediaToDrive
                  ? accessToken
                    ? 'bg-emerald-600 text-white'
                    : 'bg-amber-600 text-white'
                  : 'bg-white border border-emerald-200 text-emerald-800'
              }`}
            >
              {backendMonitor.shouldRouteNewMediaToDrive
                ? accessToken
                  ? 'OAuth2 Drive Siap'
                  : 'Perlu Sign in Google'
                : `Batas Peringatan ${backendMonitor.settings?.thresholdPercent ?? 80}%`}
            </span>
          </div>
        )}

        {/* Meter Storage & Database Supabase */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="rounded-2xl border border-indigo-100 bg-white/90 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">Supabase Storage Bucket</span>
              <span className="font-mono font-bold text-[#4C1D95] tabular-nums">
                {formatBytesCompact(backendMonitor?.storageUsedBytes ?? 0)} /{' '}
                {formatBytesCompact(backendMonitor?.storageLimitBytes ?? 1024 * 1024 * 1024)} (
                {backendMonitor?.storageUsagePercent ?? 0}%)
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-indigo-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  (backendMonitor?.storageUsagePercent ?? 0) >=
                  (backendMonitor?.settings?.thresholdPercent ?? 80)
                    ? 'bg-rose-500'
                    : 'bg-[#4C1D95]'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(backendMonitor?.storageUsagePercent ?? 0, 2))}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Total objek: <strong>{backendMonitor?.totalObjects ?? 0} file</strong>
            </p>
          </div>

          <div className="rounded-2xl border border-indigo-100 bg-white/90 p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">Database PostgreSQL Supabase</span>
              <span className="font-mono font-bold text-emerald-700 tabular-nums">
                {formatBytesCompact(backendMonitor?.dbUsedBytes ?? 0)} /{' '}
                {formatBytesCompact(backendMonitor?.dbLimitBytes ?? 500 * 1024 * 1024)} (
                {backendMonitor?.dbUsagePercent ?? 0}%)
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-emerald-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  (backendMonitor?.dbUsagePercent ?? 0) >=
                  (backendMonitor?.settings?.thresholdPercent ?? 80)
                    ? 'bg-rose-500'
                    : 'bg-emerald-500'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(backendMonitor?.dbUsagePercent ?? 0, 2))}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Sumber ukur:{' '}
              <strong>
                {backendMonitor?.measuredVia === 'rpc_exact'
                  ? 'RPC SQL Akurat'
                  : backendMonitor?.measuredVia === 'storage_api_scan'
                    ? 'Scan Storage API'
                    : 'Estimasi Tabel Media'}
              </strong>
            </p>
          </div>
        </div>

        {/* Pengaturan Ambang Batas Otomatis */}
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/35 p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5 items-center">
          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-1">
              Ambang Batas Pemakaian Supabase untuk Pindah Otomatis
            </label>
            <select
              disabled={!canManage || savingThreshold}
              value={backendMonitor?.settings?.thresholdPercent ?? 80}
              onChange={(e) =>
                void handleSaveBackendRule({ thresholdPercent: Number(e.target.value) })
              }
              className="w-full min-h-[40px] rounded-xl border border-indigo-200 bg-white px-3 text-xs font-semibold text-[#0F172A] disabled:bg-slate-100"
            >
              {THRESHOLD_PERCENT_OPTIONS.map((pct) => (
                <option key={pct} value={pct}>
                  Mulai alihkan saat pemakaian &gt;= {pct}%
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                disabled={!canManage || savingThreshold}
                checked={backendMonitor?.settings?.autoRouteOnNearLimit ?? true}
                onChange={(e) =>
                  void handleSaveBackendRule({ autoRouteOnNearLimit: e.target.checked })
                }
                className="mt-0.5 rounded border-indigo-300 text-[#4C1D95] focus:ring-[#4C1D95]"
              />
              <span className="text-xs text-slate-700 leading-snug">
                <strong>Alihkan otomatis file baru ke Google Drive OAuth2</strong> jika kuota
                Supabase melewati ambang batas.
              </span>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                disabled={!canManage || savingThreshold}
                checked={backendMonitor?.settings?.forceRouteToDrive ?? false}
                onChange={(e) =>
                  void handleSaveBackendRule({ forceRouteToDrive: e.target.checked })
                }
                className="mt-0.5 rounded border-indigo-300 text-[#4C1D95] focus:ring-[#4C1D95]"
              />
              <span className="text-xs text-slate-700 leading-snug">
                <strong>Paksa arahkan semua media baru ke Google Drive sekarang</strong> (aktif
                langsung tanpa menunggu kuota penuh).
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Kartu Audit & Kontrol Mode Hybrid Supabase -> Google Drive */}
      <div className="glass-card rounded-3xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <Archive className="w-4 h-4 text-[#4C1D95]" />
              <span>Audit Media &amp; Arsip Otomatis ke Google Drive</span>
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Pindahkan foto lama dari Supabase Storage ke Google Drive tanpa memutus tampilan di
              aplikasi.
            </p>
          </div>
          <button
            type="button"
            disabled={scanning}
            onClick={() => void runInventoryScan(config.retentionDays)}
            className="min-h-[36px] px-3.5 rounded-full border border-indigo-100 bg-white hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            <span>Pindai Ulang</span>
          </button>
        </div>

        {/* Statistik Ringkas Supabase vs Google Drive */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-indigo-100 bg-white/90 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500">Masih di Supabase</p>
            <p className="text-lg font-extrabold text-[#0F172A] tabular-nums mt-0.5">
              {scanning ? '...' : scanSummary?.supabaseCount ?? 0} file
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Est. {formatBytesCompact(scanSummary?.estimatedSupabaseBytes ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5">
            <p className="text-[11px] font-semibold text-emerald-800">Sudah di Google Drive</p>
            <p className="text-lg font-extrabold text-emerald-900 tabular-nums mt-0.5">
              {scanning ? '...' : scanSummary?.driveCount ?? 0} file
            </p>
            <p className="text-[11px] text-emerald-700 mt-0.5">Tersimpan di Drive pusat</p>
          </div>
          <div className="rounded-2xl border border-violet-200 bg-violet-50/70 p-3.5">
            <p className="text-[11px] font-semibold text-violet-900">Siap Diarsipkan</p>
            <p className="text-lg font-extrabold text-[#4C1D95] tabular-nums mt-0.5">
              {scanning ? '...' : scanSummary?.eligibleCount ?? 0} file
            </p>
            <p className="text-[11px] text-violet-800 mt-0.5">Sesuai filter umur arsip</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5">
            <p className="text-[11px] font-semibold text-slate-500">Arsip Terakhir</p>
            <p className="text-sm font-bold text-[#0F172A] mt-1 truncate">
              {config.lastArchiveAt
                ? `${config.lastArchiveCount} file`
                : 'Belum pernah'}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 truncate">
              {config.lastArchiveAt ? formatTanggalWaktu(config.lastArchiveAt) : 'Siap dijalankan'}
            </p>
          </div>
        </div>

        {/* Rincian Per Kategori */}
        {scanSummary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
            {(
              [
                { key: 'bukti_ipl', label: 'Bukti Setoran IPL' },
                { key: 'pengeluaran_kas', label: 'Nota / Bukti Kas' },
                { key: 'absensi_keamanan', label: 'Foto Absensi Patroli' },
                { key: 'bug_reports', label: 'Screenshot Laporan Bug' },
              ] as const
            ).map((cat) => {
              const stat = scanSummary.byCategory[cat.key];
              return (
                <div
                  key={cat.key}
                  className="rounded-2xl border border-indigo-100/80 bg-indigo-50/35 px-3 py-2.5"
                >
                  <p className="font-semibold text-[#0F172A] truncate">{cat.label}</p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    Supabase: <strong>{stat.supabase}</strong> · Drive:{' '}
                    <strong className="text-emerald-700">{stat.drive}</strong>
                  </p>
                  <p className="text-[11px] text-[#4C1D95] font-semibold">
                    Siap pindah: {stat.eligible}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Pengaturan Aturan Mode Hybrid */}
        <div className="rounded-2xl border border-indigo-100 bg-white/85 p-4 space-y-3.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-center">
            <div>
              <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                Batas Umur Foto Sebelum Dipindahkan ke Google Drive
              </label>
              <select
                disabled={!canManage || archiving}
                value={config.retentionDays}
                onChange={(e) => updateConfig({ retentionDays: Number(e.target.value) })}
                className="w-full min-h-[42px] rounded-xl border border-indigo-200 bg-white px-3 text-xs font-semibold text-[#0F172A] disabled:bg-slate-100"
              >
                {RETENTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!canManage || archiving}
                  checked={config.deleteSupabaseAfterArchive}
                  onChange={(e) =>
                    updateConfig({ deleteSupabaseAfterArchive: e.target.checked })
                  }
                  className="mt-0.5 rounded border-indigo-300 text-[#4C1D95] focus:ring-[#4C1D95]"
                />
                <span className="text-xs text-slate-700 leading-snug">
                  <strong>Hapus salinan lama di Supabase</strong> setelah berhasil diunggah &amp;
                  tautan database diperbarui ke Google Drive (hemat kuota 1 GB Supabase).
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!canManage || archiving}
                  checked={config.directUploadWhenConnected}
                  onChange={(e) =>
                    updateConfig({ directUploadWhenConnected: e.target.checked })
                  }
                  className="mt-0.5 rounded border-indigo-300 text-[#4C1D95] focus:ring-[#4C1D95]"
                />
                <span className="text-xs text-slate-700 leading-snug">
                  <strong>Upload nota kas langsung ke Google Drive</strong> saat Admin sedang
                  terhubung di sesi ini (otomatis fallback ke Supabase jika tidak login Google).
                </span>
              </label>
            </div>
          </div>

          {/* Progress Arsip Batch */}
          {archiveProgress && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-[#4C1D95]">
                <span className="truncate">{archiveProgress.label}</span>
                <span className="font-mono tabular-nums shrink-0">
                  {archiveProgress.current}/{archiveProgress.total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-indigo-200 overflow-hidden">
                <div
                  className="h-full bg-[#4C1D95] transition-all duration-200"
                  style={{
                    width: `${
                      archiveProgress.total > 0
                        ? Math.round((archiveProgress.current / archiveProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Tombol Aksi Utama */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              disabled={!canManage || !accessToken || backingUp || archiving}
              onClick={handleBackupDatabase}
              className="min-h-[42px] px-4 rounded-full border border-indigo-200 bg-white hover:bg-indigo-50 disabled:opacity-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-2 cursor-pointer transition-colors"
            >
              {backingUp ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#4C1D95]" />
              ) : (
                <DatabaseBackup className="w-4 h-4 text-[#4C1D95]" />
              )}
              <span>{backingUp ? 'Membuat Backup...' : 'Backup Database JSON ke Drive'}</span>
            </button>

            <button
              type="button"
              disabled={
                !canManage ||
                !accessToken ||
                archiving ||
                !scanSummary ||
                scanSummary.eligibleCount === 0
              }
              onClick={() => setConfirmArchiveOpen(true)}
              className="min-h-[44px] px-5 rounded-full bg-[#4C1D95] hover:bg-[#3B0764] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
            >
              {archiving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4 text-emerald-300" />
              )}
              <span>
                {archiving
                  ? 'Mengarsipkan...'
                  : `Arsipkan ${scanSummary?.eligibleCount ?? 0} Media ke Drive`}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Daftar File Tersimpan di Folder Hybrid Google Drive */}
      {accessToken && !needsAuth && (
        <div className="glass-card rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-indigo-100/70 bg-indigo-50/40 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-[#4C1D95]" />
                <span>Isi Folder Google Drive ({HYBRID_ROOT_FOLDER_NAME})</span>
              </h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Menampilkan file arsip media dan cadangan database yang dikelola aplikasi.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FOLDER_FILTER_LABELS.map((item) => {
                const active = folderFilter === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => void handleFilterChange(item.key)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#4C1D95] text-white'
                        : 'bg-white border border-indigo-100 text-slate-600 hover:bg-indigo-50'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-indigo-100/60">
            {loadingFiles ? (
              <div className="p-8 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#4C1D95]" />
                <span>Memuat file dari Google Drive...</span>
              </div>
            ) : driveFiles.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                Belum ada file arsip di folder ini.
              </div>
            ) : (
              driveFiles.map((file) => {
                const isImage = file.mimeType.startsWith('image/');
                const folderLabel =
                  file.folderKey !== 'root' && file.folderKey !== 'other'
                    ? HYBRID_SUBFOLDER_NAMES[file.folderKey]
                    : 'root';
                return (
                  <div
                    key={file.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-indigo-50/30"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {isImage ? (
                        <button
                          type="button"
                          onClick={() => setPreviewImageFile(file)}
                          className="w-11 h-11 rounded-xl border border-indigo-100 bg-white overflow-hidden shrink-0 cursor-pointer"
                          title="Pratinjau gambar"
                        >
                          <img
                            src={file.directImageUrl}
                            alt={file.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ) : (
                        <div className="w-11 h-11 rounded-xl border border-indigo-100 bg-indigo-50 flex items-center justify-center shrink-0 text-[#4C1D95]">
                          <DatabaseBackup className="w-5 h-5" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#0F172A] truncate">{file.name}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          <span className="font-mono text-[#4C1D95]">{folderLabel}</span> ·{' '}
                          {formatBytesCompact(file.sizeBytes)} ·{' '}
                          {formatTanggalWaktu(file.createdTime)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isImage && (
                        <button
                          type="button"
                          onClick={() => setPreviewImageFile(file)}
                          className="p-2 rounded-full border border-indigo-100 bg-white hover:bg-indigo-50 text-slate-600 cursor-pointer"
                          title="Lihat Gambar"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {file.webViewLink && (
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-full border border-indigo-100 bg-white hover:bg-indigo-50 text-slate-600"
                          title="Buka di Google Drive"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteFile(file)}
                          className="p-2 rounded-full border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 cursor-pointer"
                          title="Hapus file dari Google Drive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* DIALOG KONFIRMASI EKSPLISIT: ARSIPKAN KE GOOGLE DRIVE */}
      {confirmArchiveOpen && scanSummary && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmArchiveOpen(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-indigo-100 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#4C1D95] text-emerald-300 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#0F172A]">
                  Konfirmasi Arsip Media ke Google Drive
                </h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Sebanyak <strong>{scanSummary.eligibleCount} file</strong> akan diunggah ke folder{' '}
                  <span className="font-mono font-semibold">{HYBRID_ROOT_FOLDER_NAME}</span> pada
                  akun <strong>{activeEmail || DRIVE_TARGET_EMAIL}</strong> dan tautannya di
                  database Supabase akan diperbarui.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-indigo-50/70 border border-indigo-100 p-3 text-xs space-y-1 text-slate-700">
              <p>• Bukti IPL: {scanSummary.byCategory.bukti_ipl.eligible} file</p>
              <p>• Nota Kas: {scanSummary.byCategory.pengeluaran_kas.eligible} file</p>
              <p>• Absensi Keamanan: {scanSummary.byCategory.absensi_keamanan.eligible} file</p>
              <p>• Laporan Bug: {scanSummary.byCategory.bug_reports.eligible} file</p>
            </div>

            {config.deleteSupabaseAfterArchive && (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Setelah sukses masuk Google Drive dan link database diperbarui, salinan asli di{' '}
                  <strong>Supabase Storage akan dihapus</strong> untuk menghemat kuota 1 GB.
                </span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmArchiveOpen(false)}
                className="min-h-[40px] px-4 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExecuteArchive()}
                className="min-h-[40px] px-5 rounded-full bg-[#4C1D95] hover:bg-[#3B0764] text-white text-xs font-semibold cursor-pointer"
              >
                Ya, Arsipkan Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG KONFIRMASI EKSPLISIT: HAPUS FILE GOOGLE DRIVE */}
      {confirmDeleteFile && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !deletingFileId && setConfirmDeleteFile(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-rose-100 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#0F172A]">
                  Hapus File dari Google Drive?
                </h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Anda akan menghapus file{' '}
                  <strong className="break-all">{confirmDeleteFile.name}</strong> dari Google Drive{' '}
                  <strong>{activeEmail || DRIVE_TARGET_EMAIL}</strong>. Tindakan ini tidak dapat
                  dibatalkan.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(deletingFileId)}
                onClick={() => setConfirmDeleteFile(null)}
                className="min-h-[40px] px-4 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={Boolean(deletingFileId)}
                onClick={() => void handleConfirmDeleteDriveFile()}
                className="min-h-[40px] px-5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {deletingFileId && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Ya, Hapus Permanen</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIGHTBOX PRATINJAU GAMBAR DRIVE */}
      {previewImageFile && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setPreviewImageFile(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-[#0F172A] truncate">{previewImageFile.name}</p>
              <button
                type="button"
                onClick={() => setPreviewImageFile(null)}
                className="px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Tutup
              </button>
            </div>
            <div className="p-4 bg-slate-900 flex items-center justify-center">
              <img
                src={previewImageFile.directImageUrl}
                alt={previewImageFile.name}
                referrerPolicy="no-referrer"
                className="max-h-[70dvh] w-auto object-contain rounded-xl"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
