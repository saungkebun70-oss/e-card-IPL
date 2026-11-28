import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  DatabaseBackup,
  ExternalLink,
  Folder,
  FolderOpen,
  FolderTree,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Loader2,
  LogOut,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import {
  cancelPendingExternalGoogleOAuth,
  checkFirebaseDomainAuthorization,
  DRIVE_TARGET_EMAIL,
  FIREBASE_AUTH_SETTINGS_URL,
  getGoogleDriveAccessToken,
  getGoogleDriveConnectedAccount,
  googleDriveLogout,
  hasExplicitGoogleDriveLogout,
  initGoogleDriveAuth,
  isEmbeddedWebView,
  signInGoogleDrive,
  tryCompleteOAuthFromUrl,
  type DomainAuthCheckResult,
  type DriveConnectedAccount,
} from '../../lib/googleDriveAuth';
import {
  ensureFreshGoogleDriveToken,
  getDriveOAuthHealthSnapshot,
  refreshGoogleDriveTokenViaEdge,
  setDriveAutoRefreshSession,
} from '../../lib/googleDriveAutoRefresh';
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
  organizeDriveFilesIntoYearFolders,
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
  canManageOverride?: boolean;
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
  canManageOverride,
  onRefresh,
  onToast,
}: AdminHybridDrivePanelProps) {
  const canManage =
    canManageOverride !== undefined
      ? canManageOverride
      : isBendaharaFullAccess(session) ||
        session.jabatan === 'Bendahara' ||
        session.jabatan === 'Ketua' ||
        (session.role as string) === 'pengurus' ||
        session.central_settings_permissions?.['settings.system_integrations'] === 'granted';

  const [config, setConfig] = useState<HybridDriveConfig>(() => loadHybridDriveConfig());
  const [needsAuth, setNeedsAuth] = useState(true);
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [connectedAccount, setConnectedAccount] = useState<DriveConnectedAccount | null>(() =>
    getGoogleDriveConnectedAccount()
  );
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [connectingServer, setConnectingServer] = useState(false);
  const [resyncingOAuth, setResyncingOAuth] = useState(false);
  const [serverOAuthReady, setServerOAuthReady] = useState<boolean>(() => {
    const acc = getGoogleDriveConnectedAccount();
    return acc?.source === 'supabase_edge_function' || acc?.source === 'server_oauth2';
  });
  const [tokenInvalidReason, setTokenInvalidReason] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [healthTick, setHealthTick] = useState(() => Date.now());
  const [waitingExternalBrowser, setWaitingExternalBrowser] = useState(false);
  const [signInErrorMsg, setSignInErrorMsg] = useState<string | null>(null);
  const [domainStatus, setDomainStatus] = useState<DomainAuthCheckResult | null>(null);
  const [checkingDomain, setCheckingDomain] = useState(false);
  const embeddedMode = isEmbeddedWebView();

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
  const [selectedYearFilter, setSelectedYearFilter] = useState<string>('all');
  const [explorerViewMode, setExplorerViewMode] = useState<'yearly' | 'flat'>('yearly');
  const [expandedYears, setExpandedYears] = useState<Record<string, boolean>>({});
  const [organizingYearFolders, setOrganizingYearFolders] = useState(false);

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
    async (
      token: string,
      filter: HybridFolderKey | 'all' = folderFilter,
      allowAutoRefreshRetry = true
    ) => {
      setLoadingDriveInfo(true);
      setLoadingFiles(true);
      try {
        const [about] = await Promise.all([
          fetchDriveAbout(token),
          ensureHybridFolderStructure(token),
        ]);
        setDriveAbout(about);
        const files = await listHybridDriveFiles(token, filter, 100);
        setDriveFiles(files);
        setTokenInvalidReason(null);
        setLastSyncedAt((prev) => prev || new Date().toISOString());
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat status Google Drive.';
        const isAuthFailure =
          msg.includes('Sesi Google Drive telah berakhir') ||
          msg.includes('401') ||
          /invalid|expired|kedaluwarsa|unauthorized/i.test(msg);

        if (allowAutoRefreshRetry && canManage && isAuthFailure) {
          const refreshedToken = await ensureFreshGoogleDriveToken(session, {
            force: true,
            respectExplicitLogout: true,
            reason: 'workspace_load_expired',
          });
          if (refreshedToken) {
            setConnectedAccount(getGoogleDriveConnectedAccount());
            setAccessToken(refreshedToken);
            setNeedsAuth(false);
            setTokenInvalidReason(null);
            setLastSyncedAt(new Date().toISOString());
            await loadDriveWorkspace(refreshedToken, filter, false);
            return;
          }
        }
        onToast('error', msg);
        if (isAuthFailure) {
          setTokenInvalidReason(msg);
          setAccessToken(null);
          setNeedsAuth(true);
        }
      } finally {
        setLoadingDriveInfo(false);
        setLoadingFiles(false);
      }
    },
    [folderFilter, onToast, canManage, session]
  );

  useEffect(() => {
    setDriveAutoRefreshSession(session);
  }, [session]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setHealthTick(Date.now());
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const unsub = initGoogleDriveAuth(
      (user, token, account) => {
        const resolvedAcc = account ?? getGoogleDriveConnectedAccount();
        setGoogleUser(user);
        setConnectedAccount(resolvedAcc);
        setAccessToken(token);
        setNeedsAuth(false);
        setTokenInvalidReason(null);
        setSignInErrorMsg(null);
        if (
          resolvedAcc?.source === 'supabase_edge_function' ||
          resolvedAcc?.source === 'server_oauth2'
        ) {
          setServerOAuthReady(true);
        }
        setLastSyncedAt(new Date().toISOString());
      },
      (user) => {
        setGoogleUser(user);
        setConnectedAccount(null);
        setAccessToken(null);
        setNeedsAuth(true);
      }
    );

    const bootstrapConnection = async () => {
      // 1. Cek jika kembali dari callback browser eksternal via URL query
      if (typeof window !== 'undefined' && window.location.search.includes('drive_oauth_')) {
        const urlResult = await tryCompleteOAuthFromUrl(window.location.href, session);
        if (urlResult) {
          setConnectedAccount(urlResult.account);
          setAccessToken(urlResult.accessToken);
          setNeedsAuth(false);
          setTokenInvalidReason(null);
          await loadDriveWorkspace(urlResult.accessToken, folderFilter);
          return;
        }
      }

      // 2. Cek token yang sudah aktif di memori sesi; segarkan otomatis melalui Edge Function / Server
      const existingToken = canManage
        ? await ensureFreshGoogleDriveToken(session, {
            respectExplicitLogout: true,
            reason: 'hybrid_panel_bootstrap',
          })
        : await getGoogleDriveAccessToken();

      if (existingToken) {
        const activeAcc = getGoogleDriveConnectedAccount();
        setConnectedAccount(activeAcc);
        setAccessToken(existingToken);
        setNeedsAuth(false);
        setTokenInvalidReason(null);
        if (
          activeAcc?.source === 'supabase_edge_function' ||
          activeAcc?.source === 'server_oauth2'
        ) {
          setServerOAuthReady(true);
        }
        await loadDriveWorkspace(existingToken, folderFilter);
        return;
      }

      // 3. Jalur Utama Otomatis Lintas Web, APK Android & iOS:
      //    Hubungkan langsung lewat Edge Function / OAuth2 Server jika belum logout eksplisit
      if (canManage && !hasExplicitGoogleDriveLogout()) {
        try {
          setConnectingServer(true);
          const srv = await refreshGoogleDriveTokenViaEdge(session, {
            force: true,
            reason: 'auto_bootstrap_all_platforms',
          });
          setConnectedAccount(srv.account);
          setAccessToken(srv.accessToken);
          setNeedsAuth(false);
          setServerOAuthReady(true);
          setTokenInvalidReason(null);
          setSignInErrorMsg(null);
          await loadDriveWorkspace(srv.accessToken, folderFilter);
        } catch {
          // Jangan memunculkan toast/error merah saat auto-connect pasif awal;
          // tombol Hubungkan Langsung via Server / Masuk Google tetap tersedia
        } finally {
          setConnectingServer(false);
        }
      }
    };

    void bootstrapConnection();

    void checkFirebaseDomainAuthorization(false).then((res) => {
      setDomainStatus(res);
    });

    return () => {
      cancelPendingExternalGoogleOAuth();
      unsub();
    };
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

  const handleConnectViaServer = async () => {
    if (connectingServer || signingIn || resyncingOAuth || !canManage) return;
    setConnectingServer(true);
    setSignInErrorMsg(null);
    setTokenInvalidReason(null);
    try {
      const { account, accessToken: token } = await refreshGoogleDriveTokenViaEdge(session, {
        force: true,
        reason: 'manual_server_connect',
      });
      setGoogleUser(null);
      setConnectedAccount(account);
      setAccessToken(token);
      setNeedsAuth(false);
      setServerOAuthReady(true);
      setSignInErrorMsg(null);
      setTokenInvalidReason(null);
      setLastSyncedAt(new Date().toISOString());
      await loadDriveWorkspace(token, folderFilter);
      onToast(
        'success',
        `Google Drive ${account.email || DRIVE_TARGET_EMAIL} berhasil terhubung langsung via Server OAuth2.`
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Gagal menghubungkan Google Drive via server.';
      setSignInErrorMsg(msg);
      setTokenInvalidReason(msg);
      onToast('error', msg);
    } finally {
      setConnectingServer(false);
    }
  };

  const handleResyncOAuth = async () => {
    if (resyncingOAuth || connectingServer || signingIn || !canManage) return;
    setResyncingOAuth(true);
    setSignInErrorMsg(null);
    try {
      const { account, accessToken: token } = await refreshGoogleDriveTokenViaEdge(session, {
        force: true,
        reason: 'manual_resync_button',
      });
      setGoogleUser(null);
      setConnectedAccount(account);
      setAccessToken(token);
      setNeedsAuth(false);
      setServerOAuthReady(
        account.source === 'supabase_edge_function' || account.source === 'server_oauth2'
      );
      setTokenInvalidReason(null);
      setSignInErrorMsg(null);
      setLastSyncedAt(new Date().toISOString());
      await loadDriveWorkspace(token, folderFilter, false);
      onToast('success', 'Sesi token OAuth Google Drive berhasil disinkronkan ulang.');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Gagal melakukan sinkronisasi ulang token OAuth Google Drive.';
      setTokenInvalidReason(msg);
      setSignInErrorMsg(msg);
      setAccessToken(null);
      setNeedsAuth(true);
      onToast('error', msg);
    } finally {
      setResyncingOAuth(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (signingIn || connectingServer || resyncingOAuth) return;
    setSigningIn(true);
    setWaitingExternalBrowser(embeddedMode);
    setSignInErrorMsg(null);
    setTokenInvalidReason(null);
    try {
      const { user, account, accessToken: token } = await signInGoogleDrive(session);
      setGoogleUser(user);
      setConnectedAccount(account);
      setAccessToken(token);
      setNeedsAuth(false);
      setSignInErrorMsg(null);
      setTokenInvalidReason(null);
      setLastSyncedAt(new Date().toISOString());
      await loadDriveWorkspace(token, folderFilter);

      const signedEmail = (account?.email || user?.email || '').toLowerCase();
      if (signedEmail === DRIVE_TARGET_EMAIL.toLowerCase()) {
        onToast('success', `Google Drive ${DRIVE_TARGET_EMAIL} berhasil terhubung.`);
      } else {
        onToast(
          'info',
          `Terhubung ke ${account?.email || user?.email || 'akun Google'}. Disarankan memakai ${DRIVE_TARGET_EMAIL}.`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login Google Drive dibatalkan atau gagal.';
      setSignInErrorMsg(msg);
      setTokenInvalidReason(msg);
      onToast('error', msg);
    } finally {
      setWaitingExternalBrowser(false);
      setSigningIn(false);
    }
  };

  const handleCancelExternalBrowser = () => {
    cancelPendingExternalGoogleOAuth();
    setWaitingExternalBrowser(false);
    setSigningIn(false);
  };

  const handleGoogleSignOut = async () => {
    await googleDriveLogout();
    setAccessToken(null);
    setGoogleUser(null);
    setConnectedAccount(null);
    setServerOAuthReady(false);
    setDriveAbout(null);
    setDriveFiles([]);
    setTokenInvalidReason(null);
    setNeedsAuth(true);
    onToast('info', 'Koneksi Google Drive telah diputuskan dari sesi ini.');
  };

  const handleFilterChange = async (nextFilter: HybridFolderKey | 'all') => {
    setFolderFilter(nextFilter);
    setSelectedYearFilter('all');
    if (!accessToken) return;
    setLoadingFiles(true);
    try {
      const files = await listHybridDriveFiles(accessToken, nextFilter, 100);
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

  const handleOrganizeIntoYearFolders = async () => {
    if (!accessToken || !canManage || organizingYearFolders) return;
    setOrganizingYearFolders(true);
    try {
      const res = await organizeDriveFilesIntoYearFolders(accessToken, driveFiles);
      if (res.movedCount === 0) {
        onToast('info', 'Semua file arsip sudah berada di dalam folder tahunannya.');
      } else {
        onToast(
          'success',
          `${res.movedCount} file berhasil disusun ke folder tahunan (${res.createdFolders.length > 0 ? `folder baru: ${res.createdFolders.join(', ')}` : 'folder tahun siap'}).`
        );
      }
      const updated = await listHybridDriveFiles(accessToken, folderFilter, 100);
      setDriveFiles(updated);
    } catch (err) {
      onToast(
        'error',
        err instanceof Error
          ? err.message
          : 'Gagal mengelompokkan file ke subfolder tahunan di Google Drive.'
      );
    } finally {
      setOrganizingYearFolders(false);
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

  const availableYears = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of driveFiles) {
      const y = file.archiveYear || 'Lainnya';
      counts.set(y, (counts.get(y) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort(([a], [b]) => {
        if (a === 'Lainnya') return 1;
        if (b === 'Lainnya') return -1;
        return Number(b) - Number(a);
      })
      .map(([year, count]) => ({ year, count }));
  }, [driveFiles]);

  const filteredDriveFiles = useMemo(() => {
    if (selectedYearFilter === 'all') return driveFiles;
    return driveFiles.filter((file) => file.archiveYear === selectedYearFilter);
  }, [driveFiles, selectedYearFilter]);

  const yearlyGroupedFolders = useMemo(() => {
    const groups = new Map<
      string,
      { year: string; files: DriveManagedFile[]; totalBytes: number; physicalCount: number }
    >();

    for (const file of filteredDriveFiles) {
      const year = file.archiveYear || 'Lainnya';
      const existing = groups.get(year) || {
        year,
        files: [],
        totalBytes: 0,
        physicalCount: 0,
      };
      existing.files.push(file);
      existing.totalBytes += file.sizeBytes || 0;
      if (file.yearFolderName) {
        existing.physicalCount += 1;
      }
      groups.set(year, existing);
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.year === 'Lainnya') return 1;
      if (b.year === 'Lainnya') return -1;
      return Number(b.year) - Number(a.year);
    });
  }, [filteredDriveFiles]);

  const flatFilesNeedingYearFolderCount = useMemo(
    () =>
      driveFiles.filter(
        (f) => !f.yearFolderName && Boolean(f.parentId) && /^(19|20)\d{2}$/.test(f.archiveYear)
      ).length,
    [driveFiles]
  );

  const toggleYearExpanded = (year: string) => {
    setExpandedYears((prev) => {
      const currentlyOpen = prev[year] !== false;
      return { ...prev, [year]: !currentlyOpen };
    });
  };

  const oauthHealth = getDriveOAuthHealthSnapshot({
    accessToken,
    account: connectedAccount,
    tokenInvalidReason,
    isRefreshing: resyncingOAuth || connectingServer,
    serverOAuthReady,
    now: healthTick,
  });

  const activeEmail =
    driveAbout?.emailAddress || connectedAccount?.email || googleUser?.email || '';
  const isTargetEmailMatched =
    Boolean(activeEmail) && activeEmail.toLowerCase() === DRIVE_TARGET_EMAIL.toLowerCase();

  const quotaLimit = driveAbout?.limitBytes || 15 * 1024 * 1024 * 1024;
  const quotaUsed = driveAbout?.usageBytes || 0;
  const quotaPct = quotaLimit > 0 ? Math.min(100, Math.round((quotaUsed / quotaLimit) * 100)) : 0;

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      {/* Banner Penjelasan Mode Hybrid */}
      <div className="glass-card rounded-3xl p-5 border border-[#C6D2BF] bg-gradient-to-br from-[#E5EEE3]/70 via-[#FFFDF8] to-[#F6F3EA] space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#243825] text-[#E5EEE3] flex items-center justify-center shrink-0">
            <HardDrive className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-[#1B271B]">
                Penyimpanan Mode Hybrid (Supabase + Google Drive)
              </h3>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]">
                Target: {DRIVE_TARGET_EMAIL}
              </span>
            </div>
            <p className="text-xs text-[#4A554A] mt-1 leading-relaxed">
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
        <div className="flex items-start gap-2.5 rounded-2xl bg-[#F2D8A7]/45 border border-[#E2C285] px-4 py-3 text-xs text-[#4A3410]">
          <ShieldAlert className="w-4 h-4 text-[#8A5F16] shrink-0 mt-0.5" />
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
            <h4 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-[#2B3F29]" />
              <span>Koneksi Google Drive Pusat Pengurus</span>
            </h4>
            <p className="text-xs text-[#6E786D] mt-0.5">
              Hubungkan dengan akun Google{' '}
              <span className="font-mono font-semibold text-[#4A554A]">{DRIVE_TARGET_EMAIL}</span>{' '}
              untuk mengelola folder{' '}
              <span className="font-mono text-[#2B3F29]">{HYBRID_ROOT_FOLDER_NAME}</span>.
            </p>
          </div>

          {!needsAuth && accessToken && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loadingDriveInfo}
                onClick={() => void loadDriveWorkspace(accessToken, folderFilter)}
                className="min-h-[36px] px-3 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDriveInfo ? 'animate-spin' : ''}`} />
                <span>Segarkan Drive</span>
              </button>
              <button
                type="button"
                onClick={handleGoogleSignOut}
                className="min-h-[36px] px-3.5 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-xs font-semibold text-[#7A311E] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Keluar Google</span>
              </button>
            </div>
          )}
        </div>

        {/* Indikator Kesehatan Koneksi OAuth (Terhubung / Perlu Refresh / Kedaluwarsa) */}
        <div
          data-testid="drive-oauth-health-indicator"
          className={`rounded-2xl border p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 transition-colors ${
            oauthHealth.state === 'connected'
              ? 'border-[#C6D2BF] bg-[#E5EEE3]/75 text-[#1B271B]'
              : oauthHealth.state === 'needs_refresh'
                ? 'border-[#E2C285] bg-[#F2D8A7]/45 text-[#4A3410]'
                : 'border-[#E2A898] bg-[#C87058]/12 text-[#7A311E]'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                oauthHealth.state === 'connected'
                  ? 'bg-[#2B3F29] text-[#E5EEE3]'
                  : oauthHealth.state === 'needs_refresh'
                    ? 'bg-[#D99B38] text-white'
                    : 'bg-[#C87058] text-white'
              }`}
            >
              {oauthHealth.state === 'connected' ? (
                <ShieldCheck className="w-4 h-4" />
              ) : oauthHealth.state === 'needs_refresh' ? (
                <Clock className="w-4 h-4" />
              ) : (
                <ShieldAlert className="w-4 h-4" />
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold">Status Kesehatan OAuth:</span>
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                    oauthHealth.state === 'connected'
                      ? 'bg-[#2B3F29] text-[#E5EEE3]'
                      : oauthHealth.state === 'needs_refresh'
                        ? 'bg-[#F2D8A7] text-[#4A3410] border border-[#E2C285]'
                        : 'bg-[#C87058] text-white'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      oauthHealth.state === 'needs_refresh' ? 'bg-[#4A3410]' : 'bg-white'
                    } ${oauthHealth.state !== 'connected' ? 'animate-pulse' : ''}`}
                  />
                  <span>{oauthHealth.label}</span>
                </span>
                {lastSyncedAt && oauthHealth.state === 'connected' && (
                  <span className="text-[11px] text-[#384E35]">
                    Disinkronkan: {formatTanggalWaktu(lastSyncedAt)}
                  </span>
                )}
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">{oauthHealth.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
            {canManage && oauthHealth.needsResync && (
              <button
                type="button"
                disabled={resyncingOAuth || connectingServer || signingIn}
                onClick={() => void handleResyncOAuth()}
                className={`min-h-[38px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors disabled:opacity-50 ${
                  oauthHealth.state === 'expired'
                    ? 'bg-[#C87058] hover:bg-[#B25C45] text-white'
                    : 'bg-[#2B3F29] hover:bg-[#243825] text-white'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${resyncingOAuth ? 'animate-spin' : ''}`} />
                <span>{resyncingOAuth ? 'Menyinkronkan...' : 'Sinkronisasi Ulang'}</span>
              </button>
            )}
          </div>
        </div>

        {needsAuth || !accessToken ? (
          <div className="space-y-3">
            {/* Informasi Jalur OAuth2 Server (Web, Android APK, iOS) */}
            <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/45 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[#243825] text-[#E5EEE3] flex items-center justify-center shrink-0">
                  <Server className="w-5 h-5" />
                </div>
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-bold text-[#1B271B]">
                    Jalur OAuth2 Server (Web, APK Android &amp; iOS)
                  </p>
                  <p className="text-xs text-[#4A554A] leading-relaxed">
                    Penyimpanan arsip &amp; lampiran ke{' '}
                    <span className="font-mono font-semibold text-[#1B271B]">
                      {DRIVE_TARGET_EMAIL}
                    </span>{' '}
                    didukung otomatis oleh Supabase Edge Function &amp; Server OAuth2 tanpa perlu
                    login ulang di perangkat.
                  </p>
                </div>
              </div>
              <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF] shrink-0 self-start sm:self-center">
                Edge Refresh Siap
              </span>
            </div>

            {domainStatus?.checked && !domainStatus.authorized && (
              <div className="rounded-2xl border border-[#E2A898] bg-[#C87058]/10 p-4 text-xs text-[#7A311E] space-y-2.5">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="w-4 h-4 text-[#C87058] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">
                      Domain &quot;{domainStatus.hostname}&quot; Belum Didaftarkan di Firebase
                    </p>
                    <p className="leading-relaxed text-[#7A311E]/90">
                      Jika ingin membuka penjelajah file manual di browser, pastikan domain di bawah
                      ini masuk ke <strong>Authorized domains</strong> pada project Firebase{' '}
                      <span className="font-mono font-semibold">{domainStatus.projectId}</span>:
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 bg-[#FFFDF8] border border-[#E2A898] rounded-xl px-3 py-2">
                  <code className="font-mono font-bold text-xs text-[#1B271B] flex-1 truncate">
                    {domainStatus.hostname}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopyHostname(domainStatus.hostname)}
                    className="px-2.5 py-1 rounded-lg bg-[#F6F3EA] hover:bg-[#E5EEE3] text-[11px] font-semibold text-[#1B271B] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Salin Domain</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <a
                    href={FIREBASE_AUTH_SETTINGS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[34px] px-3.5 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-white text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Buka Pengaturan Firebase</span>
                  </a>
                  <button
                    type="button"
                    disabled={checkingDomain}
                    onClick={() => void handleRecheckDomain()}
                    className="min-h-[34px] px-3.5 rounded-full border border-[#E2A898] bg-[#FFFDF8] hover:bg-[#C87058]/10 text-[#7A311E] text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkingDomain ? 'animate-spin' : ''}`} />
                    <span>{checkingDomain ? 'Memeriksa...' : 'Cek Ulang Domain'}</span>
                  </button>
                </div>
              </div>
            )}

            {waitingExternalBrowser && signingIn && (
              <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/70 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-[#243825]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#2B3F29] shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-bold">Menunggu Login Google di Browser Sistem...</p>
                    <p className="text-[11px] text-[#384E35] leading-relaxed">
                      Selesaikan login akun Google pada jendela browser aman (Chrome / Safari).
                      Setelah berhasil, Anda akan kembali ke aplikasi dengan status{' '}
                      <strong>Terhubung</strong> secara otomatis.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCancelExternalBrowser}
                  className="min-h-[38px] px-4 rounded-full border border-[#C6D2BF] bg-[#FFFDF8] hover:bg-[#E5EEE3] text-xs font-semibold text-[#243825] shrink-0 cursor-pointer self-start sm:self-center"
                >
                  Batal
                </button>
              </div>
            )}

            {signInErrorMsg && (!domainStatus?.checked || domainStatus.authorized) && (
              <div className="rounded-2xl border border-[#E2C285] bg-[#F2D8A7]/45 px-4 py-3 text-xs text-[#4A3410] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#8A5F16] shrink-0 mt-0.5" />
                <span>{signInErrorMsg}</span>
              </div>
            )}

            <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/75 p-4 space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-bold text-[#1B271B]">
                  Penjelajah Folder &amp; Arsip Google Drive (Web, Android APK &amp; iOS)
                </p>
                <p className="text-[11px] text-[#4A554A] leading-relaxed">
                  {embeddedMode
                    ? `Di Android APK / iOS, gunakan "Hubungkan Langsung via Server" untuk langsung menjelajahi folder ${HYBRID_ROOT_FOLDER_NAME} (${DRIVE_TARGET_EMAIL}), atau pilih "Masuk dengan Akun Google" untuk membuka jendela autentikasi browser aman (Chrome / Safari).`
                    : `Hubungkan langsung lewat OAuth2 Server atau masuk menggunakan akun Google ${DRIVE_TARGET_EMAIL} untuk menjelajahi isi folder dan menjalankan arsip batch.`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  disabled={!canManage || connectingServer || signingIn}
                  onClick={() => void handleConnectViaServer()}
                  className="min-h-[44px] px-4 rounded-xl bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm"
                >
                  {connectingServer ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Server className="w-4 h-4 text-[#E5EEE3]" />
                  )}
                  <span>
                    {connectingServer
                      ? 'Menghubungkan Server...'
                      : 'Hubungkan Langsung via Server'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!canManage || signingIn || connectingServer}
                  onClick={handleGoogleSignIn}
                  className="gsi-material-button inline-flex items-center justify-center gap-2.5 min-h-[44px] px-4 rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] hover:bg-[#F6F3EA] shadow-2xs text-xs font-semibold text-[#1B271B] cursor-pointer disabled:opacity-50 shrink-0 transition-colors"
                >
                  <div className="gsi-material-button-state" />
                  <div className="gsi-material-button-content-wrapper flex items-center gap-2">
                    <div className="gsi-material-button-icon w-4 h-4 shrink-0">
                      {signingIn ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#2B3F29]" />
                      ) : (
                        <svg
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 48 48"
                          style={{ display: 'block', width: '16px', height: '16px' }}
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
                      {signingIn ? 'Menghubungkan...' : 'Masuk dengan Akun Google'}
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                isTargetEmailMatched
                  ? 'border-[#C6D2BF] bg-[#E5EEE3]/70'
                  : 'border-[#E2C285] bg-[#F2D8A7]/45'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    isTargetEmailMatched
                      ? 'bg-[#2B3F29] text-[#E5EEE3]'
                      : 'bg-[#D99B38] text-white'
                  }`}
                >
                  {isTargetEmailMatched ? (
                    <ShieldCheck className="w-5 h-5" />
                  ) : (
                    <AlertTriangle className="w-5 h-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#1B271B] truncate">
                    {driveAbout?.displayName ||
                      connectedAccount?.displayName ||
                      googleUser?.displayName ||
                      'Akun Google Terhubung'}
                  </p>
                  <p className="text-xs font-mono text-[#4A554A] truncate">
                    {activeEmail || DRIVE_TARGET_EMAIL}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <span
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                    isTargetEmailMatched
                      ? 'bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]'
                      : 'bg-[#F2D8A7] text-[#4A3410] border border-[#E2C285]'
                  }`}
                >
                  {connectedAccount?.source === 'supabase_edge_function'
                    ? 'Terhubung via Edge Function'
                    : connectedAccount?.source === 'server_oauth2'
                      ? 'Terhubung via OAuth2 Server'
                      : isTargetEmailMatched
                        ? 'Sesuai Akun Pusat Saung Kebun'
                        : `Bukan ${DRIVE_TARGET_EMAIL}`}
                </span>
                {!isTargetEmailMatched && (
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    className="px-3 py-1 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-[11px] font-semibold cursor-pointer"
                  >
                    Ganti Akun
                  </button>
                )}
              </div>
            </div>

            {/* Kuota Google Drive */}
            <div className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-4 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#4A554A]">
                  Kapasitas Google Drive ({activeEmail || DRIVE_TARGET_EMAIL})
                </span>
                <span className="font-mono font-bold text-[#243825] tabular-nums">
                  {formatBytesCompact(quotaUsed)} /{' '}
                  {quotaLimit > 0 ? formatBytesCompact(quotaLimit) : 'Tak Terbatas'} ({quotaPct}%)
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-[#E5EEE3] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#243825] to-[#384E35] transition-all duration-300"
                  style={{ width: `${Math.max(quotaPct, 2)}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6E786D] pt-0.5">
                <span>
                  Folder Arsip:{' '}
                  <strong className="text-[#1B271B]">{HYBRID_ROOT_FOLDER_NAME}</strong> (5
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
            <h4 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#2B3F29]" />
              <span>Monitor Backend Penyimpanan Supabase &amp; Routing OAuth2</span>
            </h4>
            <p className="text-xs text-[#6E786D] mt-0.5">
              Backend memantau kuota Storage &amp; Database Supabase secara real-time dan mengalihkan
              upload media baru ke Google Drive bila mendekati batas.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingMonitor}
            onClick={() => void refreshBackendMonitor(true)}
            className="min-h-[36px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
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
                ? 'border-[#E2C285] bg-[#F2D8A7]/45 text-[#4A3410]'
                : 'border-[#C6D2BF] bg-[#E5EEE3]/70 text-[#243825]'
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
                  ? 'bg-[#2B3F29] text-[#E5EEE3]'
                  : 'bg-[#FFFDF8] border border-[#C6D2BF] text-[#243825]'
              }`}
            >
              {backendMonitor.shouldRouteNewMediaToDrive
                ? 'Terhubung Otomatis (Server Aktif)'
                : `Batas Peringatan ${backendMonitor.settings?.thresholdPercent ?? 80}%`}
            </span>
          </div>
        )}

        {/* Meter Storage & Database Supabase */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#4A554A]">Supabase Storage Bucket</span>
              <span className="font-mono font-bold text-[#2B3F29] tabular-nums">
                {formatBytesCompact(backendMonitor?.storageUsedBytes ?? 0)} /{' '}
                {formatBytesCompact(backendMonitor?.storageLimitBytes ?? 1024 * 1024 * 1024)} (
                {backendMonitor?.storageUsagePercent ?? 0}%)
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#E5EEE3] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  (backendMonitor?.storageUsagePercent ?? 0) >=
                  (backendMonitor?.settings?.thresholdPercent ?? 80)
                    ? 'bg-[#C87058]'
                    : 'bg-[#2B3F29]'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(backendMonitor?.storageUsagePercent ?? 0, 2))}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-[#6E786D]">
              Total objek: <strong>{backendMonitor?.totalObjects ?? 0} file</strong>
            </p>
          </div>

          <div className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#4A554A]">Database PostgreSQL Supabase</span>
              <span className="font-mono font-bold text-[#243825] tabular-nums">
                {formatBytesCompact(backendMonitor?.dbUsedBytes ?? 0)} /{' '}
                {formatBytesCompact(backendMonitor?.dbLimitBytes ?? 500 * 1024 * 1024)} (
                {backendMonitor?.dbUsagePercent ?? 0}%)
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#E5EEE3] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  (backendMonitor?.dbUsagePercent ?? 0) >=
                  (backendMonitor?.settings?.thresholdPercent ?? 80)
                    ? 'bg-[#C87058]'
                    : 'bg-[#384E35]'
                }`}
                style={{
                  width: `${Math.min(100, Math.max(backendMonitor?.dbUsagePercent ?? 0, 2))}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-[#6E786D]">
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
        <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/75 p-4 grid grid-cols-1 md:grid-cols-2 gap-3.5 items-center">
          <div>
            <label className="block text-xs font-semibold text-[#1B271B] mb-1">
              Ambang Batas Pemakaian Supabase untuk Pindah Otomatis
            </label>
            <select
              disabled={!canManage || savingThreshold}
              value={backendMonitor?.settings?.thresholdPercent ?? 80}
              onChange={(e) =>
                void handleSaveBackendRule({ thresholdPercent: Number(e.target.value) })
              }
              className="w-full min-h-[40px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-xs font-semibold text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
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
                className="mt-0.5 rounded border-[#C6D2BF] accent-[#2B3F29]"
              />
              <span className="text-xs text-[#4A554A] leading-snug">
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
                className="mt-0.5 rounded border-[#C6D2BF] accent-[#2B3F29]"
              />
              <span className="text-xs text-[#4A554A] leading-snug">
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
            <h4 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
              <Archive className="w-4 h-4 text-[#2B3F29]" />
              <span>Audit Media &amp; Arsip Otomatis ke Google Drive</span>
            </h4>
            <p className="text-xs text-[#6E786D] mt-0.5">
              Pindahkan foto lama dari Supabase Storage ke Google Drive tanpa memutus tampilan di
              aplikasi.
            </p>
          </div>
          <button
            type="button"
            disabled={scanning}
            onClick={() => void runInventoryScan(config.retentionDays)}
            className="min-h-[36px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            <span>Pindai Ulang</span>
          </button>
        </div>

        {/* Statistik Ringkas Supabase vs Google Drive */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-3.5">
            <p className="text-[11px] font-semibold text-[#6E786D]">Masih di Supabase</p>
            <p className="text-lg font-extrabold text-[#1B271B] tabular-nums mt-0.5">
              {scanning ? '...' : scanSummary?.supabaseCount ?? 0} file
            </p>
            <p className="text-[11px] text-[#6E786D] mt-0.5">
              Est. {formatBytesCompact(scanSummary?.estimatedSupabaseBytes ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/70 p-3.5">
            <p className="text-[11px] font-semibold text-[#243825]">Sudah di Google Drive</p>
            <p className="text-lg font-extrabold text-[#243825] tabular-nums mt-0.5">
              {scanning ? '...' : scanSummary?.driveCount ?? 0} file
            </p>
            <p className="text-[11px] text-[#384E35] mt-0.5">Tersimpan di Drive pusat</p>
          </div>
          <div className="rounded-2xl border border-[#E2C285] bg-[#F2D8A7]/40 p-3.5">
            <p className="text-[11px] font-semibold text-[#4A3410]">Siap Diarsipkan</p>
            <p className="text-lg font-extrabold text-[#4A3410] tabular-nums mt-0.5">
              {scanning ? '...' : scanSummary?.eligibleCount ?? 0} file
            </p>
            <p className="text-[11px] text-[#6B4E1A] mt-0.5">Sesuai filter umur arsip</p>
          </div>
          <div className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/80 p-3.5">
            <p className="text-[11px] font-semibold text-[#6E786D]">Arsip Terakhir</p>
            <p className="text-sm font-bold text-[#1B271B] mt-1 truncate">
              {config.lastArchiveAt
                ? `${config.lastArchiveCount} file`
                : 'Belum pernah'}
            </p>
            <p className="text-[10px] text-[#6E786D] mt-0.5 truncate">
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
                  className="rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/70 px-3 py-2.5"
                >
                  <p className="font-semibold text-[#1B271B] truncate">{cat.label}</p>
                  <p className="text-[11px] text-[#4A554A] mt-1">
                    Supabase: <strong>{stat.supabase}</strong> · Drive:{' '}
                    <strong className="text-[#243825]">{stat.drive}</strong>
                  </p>
                  <p className="text-[11px] text-[#2B3F29] font-semibold">
                    Siap pindah: {stat.eligible}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {/* Pengaturan Aturan Mode Hybrid */}
        <div className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] p-4 space-y-3.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-center">
            <div>
              <label className="block text-xs font-semibold text-[#1B271B] mb-1">
                Batas Umur Foto Sebelum Dipindahkan ke Google Drive
              </label>
              <select
                disabled={!canManage || archiving}
                value={config.retentionDays}
                onChange={(e) => updateConfig({ retentionDays: Number(e.target.value) })}
                className="w-full min-h-[42px] rounded-xl border border-[#D9D4C5] bg-[#FFFDF8] px-3 text-xs font-semibold text-[#1B271B] disabled:bg-[#F6F3EA] focus:border-[#2B3F29] focus:outline-none"
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
                  className="mt-0.5 rounded border-[#C6D2BF] accent-[#2B3F29]"
                />
                <span className="text-xs text-[#4A554A] leading-snug">
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
                  className="mt-0.5 rounded border-[#C6D2BF] accent-[#2B3F29]"
                />
                <span className="text-xs text-[#4A554A] leading-snug">
                  <strong>Upload nota kas langsung ke Google Drive</strong> saat Admin sedang
                  terhubung di sesi ini (otomatis fallback ke Supabase jika tidak login Google).
                </span>
              </label>
            </div>
          </div>

          {/* Progress Arsip Batch */}
          {archiveProgress && (
            <div className="rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/70 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs font-semibold text-[#243825]">
                <span className="truncate">{archiveProgress.label}</span>
                <span className="font-mono tabular-nums shrink-0">
                  {archiveProgress.current}/{archiveProgress.total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-[#FFFDF8] overflow-hidden border border-[#C6D2BF]">
                <div
                  className="h-full bg-[#2B3F29] transition-all duration-200"
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
              className="min-h-[42px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 disabled:opacity-50 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-2 cursor-pointer transition-colors"
            >
              {backingUp ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#2B3F29]" />
              ) : (
                <DatabaseBackup className="w-4 h-4 text-[#2B3F29]" />
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
              className="min-h-[44px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
            >
              {archiving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Archive className="w-4 h-4 text-[#E5EEE3]" />
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

      {/* Penjelajah Folder Manual — Dikelompokkan Berdasarkan Folder Tahunan */}
      {accessToken && !needsAuth && (
        <div className="glass-card rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/75 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-[#1B271B] flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-[#2B3F29]" />
                  <span>Penjelajah Folder Manual ({HYBRID_ROOT_FOLDER_NAME})</span>
                </h4>
                <p className="text-xs text-[#6E786D] mt-0.5">
                  File arsip otomatis dikelompokkan berdasarkan folder tahunan (mis.{' '}
                  <span className="font-mono font-semibold text-[#4A554A]">2023</span>,{' '}
                  <span className="font-mono font-semibold text-[#4A554A]">2024</span>,{' '}
                  <span className="font-mono font-semibold text-[#4A554A]">2026</span>) agar mudah
                  ditelusuri.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canManage && flatFilesNeedingYearFolderCount > 0 && (
                  <button
                    type="button"
                    disabled={organizingYearFolders || loadingFiles}
                    onClick={() => void handleOrganizeIntoYearFolders()}
                    className="min-h-[34px] px-3 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                    title="Pindahkan file lama di Drive ke dalam subfolder tahunan (2023, 2024, dst.)"
                  >
                    {organizingYearFolders ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FolderTree className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {organizingYearFolders
                        ? 'Menyusun Folder...'
                        : `Susun ke Folder Tahun (${flatFilesNeedingYearFolderCount})`}
                    </span>
                  </button>
                )}

                <div className="inline-flex rounded-full bg-[#FFFDF8] border border-[#E6E2D6] p-0.5">
                  <button
                    type="button"
                    onClick={() => setExplorerViewMode('yearly')}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      explorerViewMode === 'yearly'
                        ? 'bg-[#2B3F29] text-white'
                        : 'text-[#4A554A] hover:text-[#243825]'
                    }`}
                  >
                    <Calendar className="w-3 h-3" />
                    <span>Per Tahun</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExplorerViewMode('flat')}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                      explorerViewMode === 'flat'
                        ? 'bg-[#2B3F29] text-white'
                        : 'text-[#4A554A] hover:text-[#243825]'
                    }`}
                  >
                    <Layers className="w-3 h-3" />
                    <span>Daftar Semua</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Filter Kategori Folder */}
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
                        ? 'bg-[#2B3F29] text-white'
                        : 'bg-[#FFFDF8] border border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]/60'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {/* Filter Pill Folder Tahunan */}
            {availableYears.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[#E6E2D6]">
                <span className="text-[11px] font-semibold text-[#6E786D] mr-1 inline-flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-[#2B3F29]" />
                  <span>Tahun Arsip:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedYearFilter('all')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                    selectedYearFilter === 'all'
                      ? 'bg-[#2B3F29] text-white'
                      : 'bg-[#FFFDF8] border border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]'
                  }`}
                >
                  Semua ({driveFiles.length})
                </button>
                {availableYears.map(({ year, count }) => {
                  const active = selectedYearFilter === year;
                  return (
                    <button
                      key={year}
                      type="button"
                      onClick={() => setSelectedYearFilter(year)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                        active
                          ? 'bg-[#2B3F29] text-white'
                          : 'bg-[#FFFDF8] border border-[#E6E2D6] text-[#4A554A] hover:bg-[#E5EEE3]'
                      }`}
                    >
                      <span>{year}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                          active ? 'bg-white/20 text-white' : 'bg-[#E5EEE3] text-[#243825]'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="max-h-[460px] overflow-y-auto">
            {loadingFiles ? (
              <div className="p-8 text-center text-xs text-[#6E786D] flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#2B3F29]" />
                <span>Memuat file dan struktur folder tahunan Google Drive...</span>
              </div>
            ) : filteredDriveFiles.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#6E786D]">
                Belum ada file arsip pada filter kategori/tahun ini.
              </div>
            ) : explorerViewMode === 'yearly' ? (
              <div className="p-3.5 space-y-3">
                {yearlyGroupedFolders.map((group) => {
                  const isExpanded = expandedYears[group.year] !== false;
                  const allInPhysicalYearFolder =
                    group.physicalCount > 0 && group.physicalCount === group.files.length;

                  return (
                    <div
                      key={group.year}
                      className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] overflow-hidden shadow-2xs"
                    >
                      <button
                        type="button"
                        onClick={() => toggleYearExpanded(group.year)}
                        className="w-full px-4 py-3 bg-gradient-to-r from-[#F6F3EA] via-[#FFFDF8] to-[#E5EEE3]/45 hover:from-[#E5EEE3]/70 flex items-center justify-between gap-3 text-left cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[#2B3F29] shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[#6E786D] shrink-0" />
                          )}
                          <div className="w-8 h-8 rounded-xl bg-[#243825] text-[#F2D8A7] flex items-center justify-center shrink-0">
                            {isExpanded ? (
                              <FolderOpen className="w-4 h-4" />
                            ) : (
                              <Folder className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs sm:text-sm font-bold text-[#1B271B] font-mono">
                                Folder Tahun {group.year}
                              </span>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]">
                                {group.files.length} file
                              </span>
                              <span className="text-[10px] font-semibold text-[#6E786D] tabular-nums">
                                {formatBytesCompact(group.totalBytes)}
                              </span>
                            </div>
                            <p className="text-[11px] text-[#6E786D] truncate mt-0.5">
                              {allInPhysicalYearFolder
                                ? `Tersimpan rapi di subfolder Drive /${group.year}`
                                : group.physicalCount > 0
                                  ? `${group.physicalCount} di subfolder /${group.year} · ${group.files.length - group.physicalCount} di folder kategori`
                                  : `Dikelompokkan berdasarkan tahun arsip ${group.year}`}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 hidden sm:inline-flex ${
                            allInPhysicalYearFolder
                              ? 'bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]'
                              : 'bg-[#F6F3EA] text-[#4A554A] border border-[#E6E2D6]'
                          }`}
                        >
                          /{group.year}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="divide-y divide-[#E6E2D6] border-t border-[#E6E2D6]">
                          {group.files.map((file) => {
                            const isImage = file.mimeType.startsWith('image/');
                            const folderLabel =
                              file.folderKey !== 'root' && file.folderKey !== 'other'
                                ? HYBRID_SUBFOLDER_NAMES[file.folderKey]
                                : 'root';
                            const displayPath = file.yearFolderName
                              ? `${folderLabel}/${file.yearFolderName}`
                              : folderLabel;

                            return (
                              <div
                                key={file.id}
                                className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#F6F3EA]/60"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  {isImage ? (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewImageFile(file)}
                                      className="w-11 h-11 rounded-xl border border-[#E6E2D6] bg-white overflow-hidden shrink-0 cursor-pointer"
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
                                    <div className="w-11 h-11 rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/70 flex items-center justify-center shrink-0 text-[#2B3F29]">
                                      <DatabaseBackup className="w-5 h-5" />
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-[#1B271B] truncate">
                                      {file.name}
                                    </p>
                                    <p className="text-[11px] text-[#6E786D] truncate">
                                      <span className="font-mono text-[#2B3F29]">{displayPath}</span>{' '}
                                      · {formatBytesCompact(file.sizeBytes)} ·{' '}
                                      {formatTanggalWaktu(file.createdTime)}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isImage && (
                                    <button
                                      type="button"
                                      onClick={() => setPreviewImageFile(file)}
                                      className="p-2 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-[#4A554A] cursor-pointer"
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
                                      className="p-2 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-[#4A554A]"
                                      title="Buka di Google Drive"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                  {canManage && (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteFile(file)}
                                      className="p-2 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#7A311E] cursor-pointer"
                                      title="Hapus file dari Google Drive"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="divide-y divide-[#E6E2D6]">
                {filteredDriveFiles.map((file) => {
                  const isImage = file.mimeType.startsWith('image/');
                  const folderLabel =
                    file.folderKey !== 'root' && file.folderKey !== 'other'
                      ? HYBRID_SUBFOLDER_NAMES[file.folderKey]
                      : 'root';
                  const displayPath = file.yearFolderName
                    ? `${folderLabel}/${file.yearFolderName}`
                    : folderLabel;
                  return (
                    <div
                      key={file.id}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#F6F3EA]/60"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isImage ? (
                          <button
                            type="button"
                            onClick={() => setPreviewImageFile(file)}
                            className="w-11 h-11 rounded-xl border border-[#E6E2D6] bg-white overflow-hidden shrink-0 cursor-pointer"
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
                          <div className="w-11 h-11 rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/70 flex items-center justify-center shrink-0 text-[#2B3F29]">
                            <DatabaseBackup className="w-5 h-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-xs font-bold text-[#1B271B] truncate">{file.name}</p>
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-[#E5EEE3] text-[#243825] shrink-0">
                              {file.archiveYear}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#6E786D] truncate">
                            <span className="font-mono text-[#2B3F29]">{displayPath}</span> ·{' '}
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
                            className="p-2 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-[#4A554A] cursor-pointer"
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
                            className="p-2 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-[#4A554A]"
                            title="Buka di Google Drive"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteFile(file)}
                            className="p-2 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#7A311E] cursor-pointer"
                            title="Hapus file dari Google Drive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* DIALOG KONFIRMASI EKSPLISIT: ARSIPKAN KE GOOGLE DRIVE */}
      {confirmArchiveOpen && scanSummary && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[70] bg-[#243825]/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setConfirmArchiveOpen(false)}
        >
          <div
            className="bg-[#FFFDF8] rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-[#E6E2D6] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#243825] text-[#E5EEE3] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#1B271B]">
                  Konfirmasi Arsip Media ke Google Drive
                </h4>
                <p className="text-xs text-[#4A554A] mt-1 leading-relaxed">
                  Sebanyak <strong>{scanSummary.eligibleCount} file</strong> akan diunggah ke folder{' '}
                  <span className="font-mono font-semibold">{HYBRID_ROOT_FOLDER_NAME}</span> pada
                  akun <strong>{activeEmail || DRIVE_TARGET_EMAIL}</strong> dan tautannya di
                  database Supabase akan diperbarui.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-[#F6F3EA] border border-[#E6E2D6] p-3 text-xs space-y-1 text-[#4A554A]">
              <p>• Bukti IPL: {scanSummary.byCategory.bukti_ipl.eligible} file</p>
              <p>• Nota Kas: {scanSummary.byCategory.pengeluaran_kas.eligible} file</p>
              <p>• Absensi Keamanan: {scanSummary.byCategory.absensi_keamanan.eligible} file</p>
              <p>• Laporan Bug: {scanSummary.byCategory.bug_reports.eligible} file</p>
            </div>

            {config.deleteSupabaseAfterArchive && (
              <div className="rounded-2xl bg-[#F2D8A7]/45 border border-[#E2C285] p-3 text-xs text-[#4A3410] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#8A5F16] shrink-0 mt-0.5" />
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
                className="min-h-[40px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-xs font-semibold text-[#4A554A] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExecuteArchive()}
                className="min-h-[40px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-semibold cursor-pointer transition-colors"
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
          className="fixed inset-0 z-[70] bg-[#243825]/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !deletingFileId && setConfirmDeleteFile(null)}
        >
          <div
            className="bg-[#FFFDF8] rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-[#E2A898] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#C87058]/15 text-[#7A311E] flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-bold text-[#1B271B]">
                  Hapus File dari Google Drive?
                </h4>
                <p className="text-xs text-[#4A554A] mt-1 leading-relaxed">
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
                className="min-h-[40px] px-4 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F6F3EA] text-xs font-semibold text-[#4A554A] cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={Boolean(deletingFileId)}
                onClick={() => void handleConfirmDeleteDriveFile()}
                className="min-h-[40px] px-5 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 transition-colors"
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
          className="fixed inset-0 z-[70] bg-[#243825]/75 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setPreviewImageFile(null)}
        >
          <div
            className="bg-[#FFFDF8] rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl border border-[#E6E2D6]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/75 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-[#1B271B] truncate">{previewImageFile.name}</p>
              <button
                type="button"
                onClick={() => setPreviewImageFile(null)}
                className="px-3 py-1 rounded-full bg-[#E5EEE3] hover:bg-[#D5E4D2] text-xs font-semibold text-[#243825] cursor-pointer transition-colors"
              >
                Tutup
              </button>
            </div>
            <div className="p-4 bg-[#1B271B] flex items-center justify-center">
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
