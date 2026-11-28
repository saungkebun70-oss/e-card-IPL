import { Capacitor } from '@capacitor/core';
import type { SessionUser } from '../types';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { compressProofImage } from './imageCompressor';
import { routeNewMediaUploadAuto } from './googleDriveHybridService';
import {
  dispatchActivityNotifications,
  getAllAdminUserIds,
  getCanonicalUserId,
} from './notificationService';
import { isSimulationMode } from './simulationStore';

export type BugReportCategory =
  | 'error_crash'
  | 'ui_tampilan'
  | 'pembayaran_ipl'
  | 'notifikasi'
  | 'lainnya';

export type BugReportStatus = 'baru' | 'diproses' | 'selesai';

export interface CapturedErrorEntry {
  timestamp: string;
  source:
    | 'window_error'
    | 'unhandled_rejection'
    | 'react_error_boundary'
    | 'console_error'
    | 'manual';
  message: string;
  stack?: string;
  location?: string;
}

export interface BugErrorSnapshot {
  captured_at: string;
  app_version: string;
  build_id: string;
  platform: string;
  is_native: boolean;
  url: string;
  viewport: string;
  user_agent: string;
  language: string;
  online: boolean;
  role: string;
  reporter_label: string;
  recent_errors: CapturedErrorEntry[];
}

export interface BugReportRecord {
  id: string;
  reporter_role: string;
  reporter_id: string;
  reporter_name: string;
  blok_rumah: string;
  category: BugReportCategory;
  title: string;
  description: string;
  screenshot_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  error_snapshot: BugErrorSnapshot | null;
  app_version: string;
  platform: string;
  status: BugReportStatus;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
  is_local_only?: boolean;
}

export interface SubmitBugReportInput {
  category: BugReportCategory;
  title: string;
  description: string;
  screenshotFile?: File | null;
  includeSnapshot?: boolean;
}

export interface SubmitBugReportResult {
  report: BugReportRecord;
  savedRemote: boolean;
  screenshotStorage: 'supabase' | 'local_fallback' | 'none';
}

export const BUG_CATEGORY_LABELS: Record<BugReportCategory, string> = {
  error_crash: 'Error / Crash',
  ui_tampilan: 'Tampilan / UI',
  pembayaran_ipl: 'Pembayaran & Verifikasi IPL',
  notifikasi: 'Notifikasi & Lonceng',
  lainnya: 'Lainnya',
};

export const BUG_STATUS_LABELS: Record<BugReportStatus, string> = {
  baru: 'Pending',
  diproses: 'Diproses',
  selesai: 'Selesai (Resolved)',
};

const BUG_REPORTS_EVENT = 'ecard-bug-reports-changed';

export function isBugReportResolved(status?: string | null): boolean {
  const clean = String(status || '').trim().toLowerCase();
  return clean === 'selesai' || clean === 'resolved';
}

function emitBugReportsChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(BUG_REPORTS_EVENT));
  } catch {
    // Abaikan
  }
}

const ERROR_BUFFER_STORAGE_KEY = 'ecard_bug_error_buffer_v1';
const LOCAL_BUG_REPORTS_KEY = 'ecard_bug_reports_local_v1';
const MAX_CAPTURED_ERRORS = 25;
const MAX_LOCAL_REPORTS = 40;
const PRIMARY_BUCKET = 'bug-reports';
const FALLBACK_BUCKET = 'bukti-ipl';

let collectorInitialized = false;
let memoryErrorBuffer: CapturedErrorEntry[] = [];

function getAppVersionSafe(): string {
  try {
    return typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function getAppBuildIdSafe(): string {
  try {
    return typeof __APP_BUILD_ID__ === 'string' && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : 'dev';
  } catch {
    return 'dev';
  }
}

function getPlatformSafe(): { platform: string; isNative: boolean } {
  try {
    const isNative = Boolean(
      Capacitor && typeof Capacitor.isNativePlatform === 'function' && Capacitor.isNativePlatform()
    );
    const platform =
      Capacitor && typeof Capacitor.getPlatform === 'function' ? Capacitor.getPlatform() : 'web';
    return { platform: platform || 'web', isNative };
  } catch {
    return { platform: 'web', isNative: false };
  }
}

function sanitizeErrorText(raw: string, maxLen = 600): string {
  return String(raw || '')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(pin_akses|apikey|api_key|token|password|secret)["'\s:=]+[^\s,}"']+/gi, '$1=[REDACTED]')
    .trim()
    .slice(0, maxLen);
}

function createUuidSafe(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fallback below
  }
  return `bug-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadErrorBufferFromStorage(): CapturedErrorEntry[] {
  if (memoryErrorBuffer.length > 0) return memoryErrorBuffer;
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return [];
    const raw = window.sessionStorage.getItem(ERROR_BUFFER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memoryErrorBuffer = parsed.slice(-MAX_CAPTURED_ERRORS) as CapturedErrorEntry[];
      return memoryErrorBuffer;
    }
  } catch {
    // ignore storage errors
  }
  return [];
}

function persistErrorBuffer(entries: CapturedErrorEntry[]): void {
  memoryErrorBuffer = entries.slice(-MAX_CAPTURED_ERRORS);
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(ERROR_BUFFER_STORAGE_KEY, JSON.stringify(memoryErrorBuffer));
    }
  } catch {
    // ignore quota errors
  }
}

export function recordCapturedError(
  source: CapturedErrorEntry['source'],
  message: string,
  stack?: string,
  location?: string
): void {
  const cleanMessage = sanitizeErrorText(message || 'Unknown error', 500);
  if (!cleanMessage) return;

  const existing = loadErrorBufferFromStorage();
  const last = existing[existing.length - 1];
  // Hindari spam duplikat identik dalam 3 detik terakhir
  if (
    last &&
    last.message === cleanMessage &&
    last.source === source &&
    Date.now() - Date.parse(last.timestamp) < 3000
  ) {
    return;
  }

  const nextEntry: CapturedErrorEntry = {
    timestamp: new Date().toISOString(),
    source,
    message: cleanMessage,
    ...(stack ? { stack: sanitizeErrorText(stack, 900) } : {}),
    ...(location ? { location: sanitizeErrorText(location, 200) } : {}),
  };

  persistErrorBuffer([...existing, nextEntry]);
}

export function getCapturedErrors(): CapturedErrorEntry[] {
  return [...loadErrorBufferFromStorage()].reverse();
}

export function clearCapturedErrors(): void {
  persistErrorBuffer([]);
}

/**
 * Memasang listener global (sekali saat startup) untuk menangkap runtime error,
 * unhandled promise rejection, dan console.error secara aman agar dapat dilampirkan
 * sebagai snapshot otomatis ketika pengguna melapor bug.
 */
export function initBugReportErrorCollector(): void {
  if (collectorInitialized || typeof window === 'undefined') return;
  collectorInitialized = true;
  loadErrorBufferFromStorage();

  try {
    window.addEventListener('error', (event: ErrorEvent) => {
      const msg = event.error?.message || event.message || 'Runtime window error';
      const stack = event.error?.stack;
      const loc =
        event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : undefined;
      recordCapturedError('window_error', msg, stack, loc);
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : JSON.stringify(reason || 'Unhandled promise rejection');
      const stack = reason instanceof Error ? reason.stack : undefined;
      recordCapturedError('unhandled_rejection', msg, stack);
    });

    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      try {
        const text = args
          .map((item) => {
            if (item instanceof Error) return item.message;
            if (typeof item === 'string') return item;
            try {
              return JSON.stringify(item);
            } catch {
              return String(item);
            }
          })
          .join(' ');
        // Abaikan error WebSocket HMR dev atau pesan kosong
        if (text && !text.includes('[vite]') && !text.includes('WebSocket')) {
          const errObj = args.find((a) => a instanceof Error) as Error | undefined;
          recordCapturedError('console_error', text, errObj?.stack);
        }
      } catch {
        // Jangan pernah ganggu console.error asli
      }
      originalConsoleError(...args);
    };
  } catch {
    // Abaikan jika browser membatasi override
  }
}

export function collectErrorSnapshot(session: SessionUser): BugErrorSnapshot {
  const { platform, isNative } = getPlatformSafe();
  const viewport =
    typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight} (dpr ${window.devicePixelRatio || 1})`
      : 'unknown';
  const currentUrl =
    typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.hash || ''}`
      : '/';

  const reporterLabel =
    session.role === 'warga'
      ? `${session.nama_warga} (Blok ${session.blok_rumah})`
      : `${session.nama_warga} (${session.jabatan || session.role})`;

  return {
    captured_at: new Date().toISOString(),
    app_version: getAppVersionSafe(),
    build_id: getAppBuildIdSafe(),
    platform,
    is_native: isNative,
    url: currentUrl,
    viewport,
    user_agent:
      typeof navigator !== 'undefined' ? sanitizeErrorText(navigator.userAgent, 260) : 'unknown',
    language: typeof navigator !== 'undefined' ? navigator.language || 'id-ID' : 'id-ID',
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    role: session.role,
    reporter_label: reporterLabel,
    recent_errors: getCapturedErrors().slice(0, 15),
  };
}

export function canCaptureDisplayScreen(): boolean {
  const { isNative } = getPlatformSafe();
  if (isNative) return false;
  if (typeof navigator === 'undefined') return false;
  return Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
}

/**
 * Mengambil tangkapan layar 1 frame melalui browser Screen Capture API (desktop web).
 * Otomatis menghentikan stream segera setelah 1 frame diambil.
 */
export async function captureScreenToFile(): Promise<File> {
  if (!canCaptureDisplayScreen()) {
    throw new Error('Perangkat ini tidak mendukung tangkapan layar langsung. Gunakan unggah gambar.');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: false,
  });

  try {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        void video
          .play()
          .then(() => resolve())
          .catch(reject);
      };
      video.onerror = () => reject(new Error('Gagal membaca frame layar.'));
    });

    // Beri jeda singkat agar frame pertama benar-benar ter-render
    await new Promise((r) => window.setTimeout(r, 120));

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas tidak tersedia pada browser ini.');
    }
    ctx.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b);
          else reject(new Error('Gagal membuat file screenshot.'));
        },
        'image/jpeg',
        0.85
      );
    });

    return new File([blob], `screenshot-bug-${Date.now()}.jpg`, { type: 'image/jpeg' });
  } finally {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // Abaikan
      }
    });
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
}

function sanitizePathSegment(raw: string): string {
  return String(raw || 'user')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 48);
}

/**
 * Mengunggah screenshot laporan bug ke Supabase Storage.
 * Prioritas bucket: `bug-reports`, dengan fallback otomatis ke bucket publik `bukti-ipl`
 * (folder `bug-reports/...`) bila bucket khusus belum dibuat di Supabase.
 */
export async function uploadBugScreenshot(
  session: SessionUser,
  rawFile: File
): Promise<{
  url: string;
  bucket: string | null;
  path: string | null;
  storageMode: 'supabase' | 'local_fallback';
}> {
  if (!rawFile.type.startsWith('image/')) {
    throw new Error('File screenshot harus berupa gambar (JPG, PNG, atau WebP).');
  }
  if (rawFile.size > 10 * 1024 * 1024) {
    throw new Error('Ukuran gambar terlalu besar (maksimal 10 MB).');
  }

  let uploadFile: File = rawFile;
  try {
    const compressed = await compressProofImage(rawFile, 1280, 0.8);
    uploadFile = compressed.file;
  } catch {
    uploadFile = rawFile;
  }

  const ext = (uploadFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const ownerSeg = sanitizePathSegment(session.blok_rumah || session.petugas_id || session.nama_warga);
  const roleSeg = sanitizePathSegment(session.role);
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const primaryPath = `${roleSeg}/${ownerSeg}/${fileName}`;
  const fallbackPath = `bug-reports/${roleSeg}/${ownerSeg}/${fileName}`;

  const routedDrive = await routeNewMediaUploadAuto({
    session,
    folderKey: 'bug_reports',
    file: uploadFile,
    labelPrefix: `bug-${roleSeg}-${ownerSeg}`,
    description: `Screenshot laporan bug dari ${session.nama_warga}`,
  });
  if (routedDrive?.url) {
    return {
      url: routedDrive.url,
      bucket: null,
      path: null,
      storageMode: 'supabase',
    };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    // 1. Coba bucket utama `bug-reports`
    try {
      const { error: primaryErr } = await supabase.storage
        .from(PRIMARY_BUCKET)
        .upload(primaryPath, uploadFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: uploadFile.type || 'image/jpeg',
        });

      if (!primaryErr) {
        const { data } = supabase.storage.from(PRIMARY_BUCKET).getPublicUrl(primaryPath);
        if (data?.publicUrl) {
          return {
            url: data.publicUrl,
            bucket: PRIMARY_BUCKET,
            path: primaryPath,
            storageMode: 'supabase',
          };
        }
      }
    } catch {
      // Lanjut ke bucket fallback
    }

    // 2. Fallback ke bucket publik `bukti-ipl` yang sudah aktif di proyek
    try {
      const { error: fallbackErr } = await supabase.storage
        .from(FALLBACK_BUCKET)
        .upload(fallbackPath, uploadFile, {
          cacheControl: '3600',
          upsert: false,
          contentType: uploadFile.type || 'image/jpeg',
        });

      if (!fallbackErr) {
        const { data } = supabase.storage.from(FALLBACK_BUCKET).getPublicUrl(fallbackPath);
        if (data?.publicUrl) {
          return {
            url: data.publicUrl,
            bucket: FALLBACK_BUCKET,
            path: fallbackPath,
            storageMode: 'supabase',
          };
        }
      }
    } catch {
      // Lanjut fallback lokal saat offline
    }
  }

  // 3. Fallback lokal jika Supabase belum dikonfigurasi / perangkat offline
  const dataUrl = await fileToDataUrl(uploadFile);
  return {
    url: dataUrl,
    bucket: null,
    path: null,
    storageMode: 'local_fallback',
  };
}

function readLocalBugReports(): BugReportRecord[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(LOCAL_BUG_REPORTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BugReportRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocalBugReports(list: BugReportRecord[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      LOCAL_BUG_REPORTS_KEY,
      JSON.stringify(list.slice(0, MAX_LOCAL_REPORTS))
    );
  } catch {
    // Abaikan keterbatasan kuota localStorage
  }
}

function normalizeBugStatus(raw?: unknown): BugReportStatus {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'selesai' || clean === 'resolved') return 'selesai';
  if (clean === 'diproses' || clean === 'in_progress') return 'diproses';
  return 'baru';
}

function normalizeRemoteBugRow(row: Record<string, unknown>): BugReportRecord {
  const rawCategory = String(row.category || 'lainnya') as BugReportCategory;
  const category: BugReportCategory =
    rawCategory in BUG_CATEGORY_LABELS ? rawCategory : 'lainnya';
  const status: BugReportStatus = normalizeBugStatus(row.status);

  return {
    id: String(row.id || createUuidSafe()),
    reporter_role: String(row.reporter_role || 'warga'),
    reporter_id: String(row.reporter_id || ''),
    reporter_name: String(row.reporter_name || 'Pengguna'),
    blok_rumah: String(row.blok_rumah || '-'),
    category,
    title: String(row.title || 'Laporan Kendala'),
    description: String(row.description || ''),
    screenshot_url: typeof row.screenshot_url === 'string' ? row.screenshot_url : null,
    storage_bucket: typeof row.storage_bucket === 'string' ? row.storage_bucket : null,
    storage_path: typeof row.storage_path === 'string' ? row.storage_path : null,
    error_snapshot:
      row.error_snapshot && typeof row.error_snapshot === 'object'
        ? (row.error_snapshot as BugErrorSnapshot)
        : null,
    app_version: String(row.app_version || getAppVersionSafe()),
    platform: String(row.platform || 'web'),
    status,
    admin_note: typeof row.admin_note === 'string' ? row.admin_note : null,
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: String(row.updated_at || row.created_at || new Date().toISOString()),
    is_local_only: false,
  };
}

/**
 * Mengirim laporan bug beserta screenshot (Supabase Storage) dan snapshot error otomatis.
 */
export async function submitBugReport(
  session: SessionUser,
  input: SubmitBugReportInput
): Promise<SubmitBugReportResult> {
  const title = input.title.trim();
  const description = input.description.trim();

  if (title.length < 3) {
    throw new Error('Judul laporan minimal 3 karakter.');
  }
  if (description.length < 8) {
    throw new Error('Mohon jelaskan kendala yang dialami minimal 8 karakter.');
  }

  let screenshotUrl: string | null = null;
  let storageBucket: string | null = null;
  let storagePath: string | null = null;
  let screenshotStorage: 'supabase' | 'local_fallback' | 'none' = 'none';

  if (input.screenshotFile) {
    const uploaded = await uploadBugScreenshot(session, input.screenshotFile);
    screenshotUrl = uploaded.url;
    storageBucket = uploaded.bucket;
    storagePath = uploaded.path;
    screenshotStorage = uploaded.storageMode;
  }

  const snapshot = input.includeSnapshot === false ? null : collectErrorSnapshot(session);
  const { platform } = getPlatformSafe();
  const nowIso = new Date().toISOString();
  const reportId = createUuidSafe();
  const reporterId = getCanonicalUserId(session);

  const reportRecord: BugReportRecord = {
    id: reportId,
    reporter_role: session.role,
    reporter_id: reporterId,
    reporter_name: session.nama_warga || 'Pengguna',
    blok_rumah: session.blok_rumah || '-',
    category: input.category,
    title,
    description,
    screenshot_url: screenshotUrl,
    storage_bucket: storageBucket,
    storage_path: storagePath,
    error_snapshot: snapshot,
    app_version: getAppVersionSafe(),
    platform,
    status: 'baru',
    admin_note: null,
    created_at: nowIso,
    updated_at: nowIso,
    is_local_only: false,
  };

  let savedRemote = false;
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { error } = await supabase.from('bug_reports').insert({
        id: reportRecord.id,
        reporter_role: reportRecord.reporter_role,
        reporter_id: reportRecord.reporter_id,
        reporter_name: reportRecord.reporter_name,
        blok_rumah: reportRecord.blok_rumah,
        category: reportRecord.category,
        title: reportRecord.title,
        description: reportRecord.description,
        screenshot_url: reportRecord.screenshot_url,
        storage_bucket: reportRecord.storage_bucket,
        storage_path: reportRecord.storage_path,
        error_snapshot: reportRecord.error_snapshot,
        app_version: reportRecord.app_version,
        platform: reportRecord.platform,
        status: reportRecord.status,
        created_at: reportRecord.created_at,
        updated_at: reportRecord.updated_at,
      });

      if (!error) {
        savedRemote = true;
      }
    } catch {
      // Lanjut fallback lokal bila tabel belum dimigrasi
    }
  }

  if (!savedRemote) {
    reportRecord.is_local_only = true;
    const existingLocal = readLocalBugReports();
    writeLocalBugReports([reportRecord, ...existingLocal]);
  }

  // Kirim notifikasi ke seluruh Pengurus/Admin (Lonceng + Push FCM)
  const reporterBadge =
    session.role === 'warga'
      ? `${session.nama_warga} (Blok ${session.blok_rumah})`
      : `${session.nama_warga} (${session.jabatan || 'Admin'})`;
  const notifTitle = 'Laporan Bug Baru';
  const notifMsg = `${reporterBadge} melaporkan "${title}" (${BUG_CATEGORY_LABELS[input.category]}).`;

  const adminRecipientIds = getAllAdminUserIds();
  const bugNotifDedupKey = `bug-report:${reportRecord.id}:created`;

  void dispatchActivityNotifications(
    session,
    adminRecipientIds.map((uid) => ({
      user_id: uid,
      category: 'system',
      title: notifTitle,
      message: notifMsg,
      target_url: 'tab:laporan_bug',
      dedup_key: bugNotifDedupKey,
    })),
    {
      dedup_key: bugNotifDedupKey,
      title: notifTitle,
      body: notifMsg,
      target_roles: ['admin'],
      target_url: 'tab:laporan_bug',
      category: 'system',
    }
  );

  emitBugReportsChanged();

  return {
    report: reportRecord,
    savedRemote,
    screenshotStorage,
  };
}

/**
 * Mengambil daftar laporan bug:
 * - Admin melihat seluruh laporan dari Warga & Pengurus.
 * - Warga/Petugas hanya melihat laporan miliknya sendiri.
 */
export async function fetchBugReports(session: SessionUser): Promise<BugReportRecord[]> {
  const reporterId = getCanonicalUserId(session);
  const localAll = readLocalBugReports();
  const localFiltered =
    session.role === 'admin'
      ? localAll
      : localAll.filter((r) => r.reporter_id === reporterId || r.blok_rumah === session.blok_rumah);

  if (isSimulationMode(session)) {
    return localFiltered.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return localFiltered.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }

  try {
    let query = supabase
      .from('bug_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (session.role !== 'admin') {
      query = query.eq('reporter_id', reporterId);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      return localFiltered.sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
      );
    }

    const remoteRows = data.map((row) => normalizeRemoteBugRow(row as Record<string, unknown>));
    const remoteIds = new Set(remoteRows.map((r) => r.id));
    const merged = [
      ...remoteRows,
      ...localFiltered.filter((item) => !remoteIds.has(item.id)),
    ];

    return merged.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  } catch {
    return localFiltered.sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );
  }
}

/**
 * Memperbarui status penanganan laporan bug (khusus Admin/Pengurus).
 */
export async function updateBugReportStatusAdmin(
  session: SessionUser,
  reportId: string,
  status: BugReportStatus,
  adminNote?: string
): Promise<void> {
  if (session.role !== 'admin') {
    throw new Error('Hanya Pengurus/Admin yang dapat memperbarui status laporan bug.');
  }

  const nowIso = new Date().toISOString();
  const cleanNote = typeof adminNote === 'string' ? adminNote.trim() : undefined;

  // Update cache lokal jika ada
  const local = readLocalBugReports();
  if (local.some((item) => item.id === reportId)) {
    writeLocalBugReports(
      local.map((item) =>
        item.id === reportId
          ? {
              ...item,
              status,
              admin_note: cleanNote !== undefined ? cleanNote || null : item.admin_note,
              updated_at: nowIso,
            }
          : item
      )
    );
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !reportId.startsWith('bug-')) {
    const updatePayload: Record<string, unknown> = {
      status,
      updated_at: nowIso,
    };
    if (cleanNote !== undefined) {
      updatePayload.admin_note = cleanNote || null;
    }

    const { error } = await supabase
      .from('bug_reports')
      .update(updatePayload)
      .eq('id', reportId);

    if (error) {
      throw new Error(error.message || 'Gagal memperbarui status laporan bug.');
    }
  }

  emitBugReportsChanged();
}

/**
 * Menghapus satu laporan bug beserta screenshot di Supabase Storage (jika ada). Khusus Admin.
 */
export async function deleteBugReportAdmin(
  session: SessionUser,
  report: Pick<BugReportRecord, 'id' | 'storage_bucket' | 'storage_path' | 'is_local_only'>
): Promise<void> {
  if (session.role !== 'admin') {
    throw new Error('Hanya Pengurus/Admin yang dapat menghapus laporan bug.');
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !report.is_local_only && !report.id.startsWith('bug-')) {
    const { error } = await supabase.from('bug_reports').delete().eq('id', report.id);
    if (error) {
      throw new Error(
        error.message || 'Gagal menghapus laporan bug di server. Pastikan migrasi v13 sudah dijalankan.'
      );
    }

    if (report.storage_bucket && report.storage_path) {
      try {
        await supabase.storage.from(report.storage_bucket).remove([report.storage_path]);
      } catch {
        // Jangan gagalkan penghapusan data bila file storage sudah tidak ada
      }
    }
  }

  const remainingLocal = readLocalBugReports().filter((item) => item.id !== report.id);
  writeLocalBugReports(remainingLocal);
  emitBugReportsChanged();
}

/**
 * Menghapus beberapa laporan bug sekaligus (misal semua yang sudah Resolved atau semua laporan). Khusus Admin.
 */
export async function deleteBugReportsBatchAdmin(
  session: SessionUser,
  reports: Array<Pick<BugReportRecord, 'id' | 'storage_bucket' | 'storage_path' | 'is_local_only'>>
): Promise<number> {
  if (session.role !== 'admin') {
    throw new Error('Hanya Pengurus/Admin yang dapat menghapus laporan bug.');
  }
  if (reports.length === 0) return 0;

  const remoteIds = reports
    .filter((r) => !r.is_local_only && !r.id.startsWith('bug-'))
    .map((r) => r.id);
  const allIdSet = new Set(reports.map((r) => r.id));

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && remoteIds.length > 0) {
    const { error } = await supabase.from('bug_reports').delete().in('id', remoteIds);
    if (error) {
      throw new Error(
        error.message || 'Gagal menghapus laporan bug di server. Pastikan migrasi v13 sudah dijalankan.'
      );
    }

    // Bersihkan file screenshot di storage per bucket (best-effort)
    const bucketPaths = new Map<string, string[]>();
    for (const r of reports) {
      if (r.storage_bucket && r.storage_path) {
        const list = bucketPaths.get(r.storage_bucket) || [];
        list.push(r.storage_path);
        bucketPaths.set(r.storage_bucket, list);
      }
    }
    for (const [bucket, paths] of bucketPaths.entries()) {
      try {
        await supabase.storage.from(bucket).remove(paths);
      } catch {
        // Abaikan error pembersihan storage
      }
    }
  }

  const remainingLocal = readLocalBugReports().filter((item) => !allIdSet.has(item.id));
  writeLocalBugReports(remainingLocal);
  emitBugReportsChanged();
  return reports.length;
}

/**
 * Menghitung jumlah laporan bug yang masih Pending (belum Selesai/Resolved) untuk badge tab Admin.
 */
export async function fetchPendingBugReportCount(session: SessionUser): Promise<number> {
  if (session.role !== 'admin') return 0;
  try {
    const reports = await fetchBugReports(session);
    return reports.filter((r) => !isBugReportResolved(r.status)).length;
  } catch {
    return 0;
  }
}

/**
 * Listener real-time perubahan tabel `bug_reports` + event lokal untuk sinkronisasi badge & daftar Admin.
 */
export function subscribeBugReportsRealtime(
  session: SessionUser,
  onChange: () => void
): () => void {
  const cleanups: Array<() => void> = [];

  if (typeof window !== 'undefined') {
    const onLocal = () => onChange();
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_BUG_REPORTS_KEY) onChange();
    };
    window.addEventListener(BUG_REPORTS_EVENT, onLocal);
    window.addEventListener('storage', onStorage);
    cleanups.push(() => {
      window.removeEventListener(BUG_REPORTS_EVENT, onLocal);
      window.removeEventListener('storage', onStorage);
    });
  }

  if (!isSimulationMode(session)) {
    const supabase = getSupabaseClient(session);
    if (supabase && isSupabaseConfigured()) {
      try {
        const channel = supabase
        .channel(`bug-reports-${session.role}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'bug_reports' },
          () => {
            onChange();
          }
        )
        .subscribe();

      cleanups.push(() => {
        try {
          void supabase.removeChannel(channel);
        } catch {
          // Abaikan
        }
      });
      } catch {
        // Abaikan bila realtime WebSocket dibatasi
      }
    }
  }

  return () => {
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        // Abaikan
      }
    });
  };
}
