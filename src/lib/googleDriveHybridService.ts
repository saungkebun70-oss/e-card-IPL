import {
  clearGoogleDriveAccessToken,
  DRIVE_TARGET_EMAIL,
  getGoogleDriveAccessToken,
} from './googleDriveAuth';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { recordAuditLog } from './auditLogger';
import type { SessionUser } from '../types';

export const HYBRID_ROOT_FOLDER_NAME = 'eCard-Saung-Kebun-Hybrid';

export type HybridFolderKey =
  | 'bukti_ipl'
  | 'pengeluaran_kas'
  | 'absensi_keamanan'
  | 'bug_reports'
  | 'backup_database';

export const HYBRID_SUBFOLDER_NAMES: Record<HybridFolderKey, string> = {
  bukti_ipl: 'bukti-ipl',
  pengeluaran_kas: 'pengeluaran-kas',
  absensi_keamanan: 'absensi-keamanan',
  bug_reports: 'bug-reports',
  backup_database: 'backup-database',
};

export interface HybridDriveConfig {
  targetEmail: string;
  retentionDays: number; // 0 = semua media Supabase, 30, 90, 180, 365
  deleteSupabaseAfterArchive: boolean;
  directUploadWhenConnected: boolean;
  autoArchivePrompt: boolean;
  rootFolderId: string | null;
  subFolderIds: Partial<Record<HybridFolderKey, string>>;
  lastArchiveAt: string | null;
  lastArchiveCount: number;
  lastBackupAt: string | null;
}

const HYBRID_CONFIG_STORAGE_KEY = 'ecard_hybrid_drive_config_v1';

const DEFAULT_HYBRID_CONFIG: HybridDriveConfig = {
  targetEmail: DRIVE_TARGET_EMAIL,
  retentionDays: 90,
  deleteSupabaseAfterArchive: true,
  directUploadWhenConnected: false,
  autoArchivePrompt: true,
  rootFolderId: null,
  subFolderIds: {},
  lastArchiveAt: null,
  lastArchiveCount: 0,
  lastBackupAt: null,
};

export function loadHybridDriveConfig(): HybridDriveConfig {
  try {
    const raw = localStorage.getItem(HYBRID_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_HYBRID_CONFIG };
    const parsed = JSON.parse(raw) as Partial<HybridDriveConfig>;
    return {
      ...DEFAULT_HYBRID_CONFIG,
      ...parsed,
      targetEmail: DRIVE_TARGET_EMAIL,
      subFolderIds: { ...(parsed.subFolderIds || {}) },
    };
  } catch {
    return { ...DEFAULT_HYBRID_CONFIG };
  }
}

export function saveHybridDriveConfig(patch: Partial<HybridDriveConfig>): HybridDriveConfig {
  const next: HybridDriveConfig = {
    ...loadHybridDriveConfig(),
    ...patch,
    targetEmail: DRIVE_TARGET_EMAIL,
  };
  try {
    localStorage.setItem(HYBRID_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Abaikan kuota storage penuh
  }
  return next;
}

export interface DriveAboutInfo {
  emailAddress: string;
  displayName: string;
  photoLink: string | null;
  limitBytes: number;
  usageBytes: number;
  usageInDriveBytes: number;
}

export interface DriveManagedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdTime: string;
  webViewLink: string | null;
  thumbnailLink: string | null;
  directImageUrl: string;
  parentId: string | null;
  folderKey: HybridFolderKey | 'root' | 'other';
}

export type HybridMediaSourceTable =
  | 'transaksi_ipl'
  | 'transaksi_kas'
  | 'security_attendance'
  | 'bug_reports';

export interface HybridMediaCandidate {
  id: string;
  table: HybridMediaSourceTable;
  column: 'bukti_url' | 'clock_in_photo_url' | 'screenshot_url';
  folderKey: Exclude<HybridFolderKey, 'backup_database'>;
  label: string;
  sublabel: string;
  dateIso: string;
  ageDays: number;
  url: string;
  storageLocation: 'supabase' | 'drive' | 'data_url' | 'other';
  supabaseBucket: string | null;
  supabasePath: string | null;
  isFinalStatus: boolean;
}

export interface HybridMediaScanSummary {
  totalMediaCount: number;
  supabaseCount: number;
  driveCount: number;
  dataUrlCount: number;
  eligibleCount: number;
  estimatedSupabaseBytes: number;
  byCategory: Record<
    Exclude<HybridFolderKey, 'backup_database'>,
    { supabase: number; drive: number; eligible: number }
  >;
  candidates: HybridMediaCandidate[];
  eligibleCandidates: HybridMediaCandidate[];
}

export function isGoogleDriveImageUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.includes('lh3.googleusercontent.com/d/') ||
    trimmed.includes('drive.google.com/')
  );
}

export function parseSupabasePublicObjectUrl(
  url?: string | null
): { bucket: string; path: string } | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  const match = trimmed.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(?:\?.*)?$/i);
  if (!match) return null;
  try {
    return {
      bucket: decodeURIComponent(match[1]),
      path: decodeURIComponent(match[2]),
    };
  } catch {
    return {
      bucket: match[1],
      path: match[2],
    };
  }
}

export function buildDriveDirectImageUrl(fileId: string): string {
  return `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}=w1600`;
}

export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function driveFetchJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    clearGoogleDriveAccessToken();
    throw new Error('Sesi Google Drive telah berakhir. Silakan masuk kembali dengan Google.');
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let msg = `Google Drive API error (${res.status})`;
    try {
      const parsed = JSON.parse(errText) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        msg = parsed.error.message;
      }
    } catch {
      if (errText) msg = errText.slice(0, 180);
    }
    throw new Error(msg);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export async function fetchDriveAbout(accessToken: string): Promise<DriveAboutInfo> {
  const data = await driveFetchJson<{
    user?: { emailAddress?: string; displayName?: string; photoLink?: string };
    storageQuota?: { limit?: string; usage?: string; usageInDrive?: string };
  }>(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink),storageQuota(limit,usage,usageInDrive)',
    accessToken
  );

  return {
    emailAddress: data.user?.emailAddress || '',
    displayName: data.user?.displayName || 'Pengguna Google',
    photoLink: data.user?.photoLink || null,
    limitBytes: Number(data.storageQuota?.limit || 0),
    usageBytes: Number(data.storageQuota?.usage || 0),
    usageInDriveBytes: Number(data.storageQuota?.usageInDrive || 0),
  };
}

async function findFolderByName(
  accessToken: string,
  folderName: string,
  parentId?: string | null
): Promise<string | null> {
  const safeName = folderName.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : ` and 'root' in parents`;
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    pageSize: '5',
    spaces: 'drive',
  });

  const data = await driveFetchJson<{ files?: Array<{ id: string; name: string }> }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );
  return data.files?.[0]?.id || null;
}

async function createDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string | null
): Promise<string> {
  const body: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    body.parents = [parentId];
  }

  const created = await driveFetchJson<{ id: string }>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  return created.id;
}

export async function ensureHybridFolderStructure(
  accessToken: string
): Promise<{ rootFolderId: string; subFolderIds: Record<HybridFolderKey, string> }> {
  let rootFolderId = await findFolderByName(accessToken, HYBRID_ROOT_FOLDER_NAME, null);
  if (!rootFolderId) {
    rootFolderId = await createDriveFolder(accessToken, HYBRID_ROOT_FOLDER_NAME, null);
  }

  const subFolderIds = {} as Record<HybridFolderKey, string>;
  const keys = Object.keys(HYBRID_SUBFOLDER_NAMES) as HybridFolderKey[];

  for (const key of keys) {
    const folderName = HYBRID_SUBFOLDER_NAMES[key];
    let folderId = await findFolderByName(accessToken, folderName, rootFolderId);
    if (!folderId) {
      folderId = await createDriveFolder(accessToken, folderName, rootFolderId);
    }
    subFolderIds[key] = folderId;
  }

  saveHybridDriveConfig({ rootFolderId, subFolderIds });
  return { rootFolderId, subFolderIds };
}

async function setDriveFileAnyoneReadable(accessToken: string, fileId: string): Promise<void> {
  await driveFetchJson(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    }
  );
}

export async function uploadBlobToHybridDrive(params: {
  accessToken: string;
  folderKey: HybridFolderKey;
  fileName: string;
  blob: Blob;
  mimeType?: string;
  makePublicReader?: boolean;
  description?: string;
}): Promise<{
  fileId: string;
  directImageUrl: string;
  webViewLink: string | null;
  sizeBytes: number;
}> {
  const { subFolderIds } = await ensureHybridFolderStructure(params.accessToken);
  const parentId = subFolderIds[params.folderKey];
  const resolvedMime =
    params.mimeType || params.blob.type || 'application/octet-stream';

  const metadata = {
    name: params.fileName,
    parents: [parentId],
    description:
      params.description ||
      'Diunggah otomatis oleh e-Card Verifikasi Perumahan Saung Kebun (Mode Hybrid)',
  };

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' })
  );
  form.append('file', params.blob, params.fileName);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType,webViewLink,thumbnailLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: form,
    }
  );

  if (uploadRes.status === 401) {
    clearGoogleDriveAccessToken();
    throw new Error('Sesi Google Drive telah berakhir. Silakan login Google kembali.');
  }

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw new Error(
      `Gagal mengunggah ke Google Drive (${uploadRes.status}): ${errText.slice(0, 160)}`
    );
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    name: string;
    size?: string;
    webViewLink?: string;
  };

  if (params.makePublicReader !== false) {
    await setDriveFileAnyoneReadable(params.accessToken, uploaded.id);
  }

  return {
    fileId: uploaded.id,
    directImageUrl: buildDriveDirectImageUrl(uploaded.id),
    webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    sizeBytes: Number(uploaded.size || params.blob.size || 0),
  };
}

export async function listHybridDriveFiles(
  accessToken: string,
  filterKey: HybridFolderKey | 'all' = 'all',
  pageSize = 40
): Promise<DriveManagedFile[]> {
  const { subFolderIds } = await ensureHybridFolderStructure(accessToken);

  const folderIdToKey = new Map<string, HybridFolderKey>();
  (Object.keys(subFolderIds) as HybridFolderKey[]).forEach((key) => {
    folderIdToKey.set(subFolderIds[key], key);
  });

  let parentQuery = '';
  if (filterKey === 'all') {
    const clauses = (Object.values(subFolderIds) as string[])
      .filter(Boolean)
      .map((id) => `'${id}' in parents`);
    if (clauses.length === 0) return [];
    parentQuery = `(${clauses.join(' or ')})`;
  } else {
    const targetId = subFolderIds[filterKey];
    if (!targetId) return [];
    parentQuery = `'${targetId}' in parents`;
  }

  const q = `${parentQuery} and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
  const params = new URLSearchParams({
    q,
    orderBy: 'createdTime desc',
    pageSize: String(Math.min(Math.max(pageSize, 1), 100)),
    fields: 'files(id,name,mimeType,size,createdTime,webViewLink,thumbnailLink,parents)',
  });

  const data = await driveFetchJson<{
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      createdTime?: string;
      webViewLink?: string;
      thumbnailLink?: string;
      parents?: string[];
    }>;
  }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, accessToken);

  return (data.files || []).map((f) => {
    const parentId = f.parents?.[0] || null;
    const folderKey = (parentId && folderIdToKey.get(parentId)) || 'other';
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: Number(f.size || 0),
      createdTime: f.createdTime || new Date().toISOString(),
      webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      thumbnailLink: f.thumbnailLink || null,
      directImageUrl: buildDriveDirectImageUrl(f.id),
      parentId,
      folderKey,
    };
  });
}

export async function deleteHybridDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  await driveFetchJson(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    accessToken,
    { method: 'DELETE' }
  );
}

function computeAgeDays(isoOrDate?: string | null): number {
  if (!isoOrDate) return 0;
  const ts = new Date(isoOrDate).getTime();
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function classifyMediaUrl(url: string): {
  storageLocation: HybridMediaCandidate['storageLocation'];
  supabaseBucket: string | null;
  supabasePath: string | null;
} {
  if (url.startsWith('data:image/')) {
    return { storageLocation: 'data_url', supabaseBucket: null, supabasePath: null };
  }
  if (isGoogleDriveImageUrl(url)) {
    return { storageLocation: 'drive', supabaseBucket: null, supabasePath: null };
  }
  const sb = parseSupabasePublicObjectUrl(url);
  if (sb) {
    return {
      storageLocation: 'supabase',
      supabaseBucket: sb.bucket,
      supabasePath: sb.path,
    };
  }
  return { storageLocation: 'other', supabaseBucket: null, supabasePath: null };
}

export async function scanHybridMediaInventory(
  session: SessionUser,
  retentionDays: number
): Promise<HybridMediaScanSummary> {
  const emptySummary: HybridMediaScanSummary = {
    totalMediaCount: 0,
    supabaseCount: 0,
    driveCount: 0,
    dataUrlCount: 0,
    eligibleCount: 0,
    estimatedSupabaseBytes: 0,
    byCategory: {
      bukti_ipl: { supabase: 0, drive: 0, eligible: 0 },
      pengeluaran_kas: { supabase: 0, drive: 0, eligible: 0 },
      absensi_keamanan: { supabase: 0, drive: 0, eligible: 0 },
      bug_reports: { supabase: 0, drive: 0, eligible: 0 },
    },
    candidates: [],
    eligibleCandidates: [],
  };

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return emptySummary;
  }

  const [iplRes, kasRes, attRes, bugRes] = await Promise.all([
    supabase
      .from('transaksi_ipl')
      .select('id, no_kwitansi, blok_rumah, nama_warga, bukti_url, status_verifikasi, tanggal_setor')
      .not('bukti_url', 'is', null)
      .order('tanggal_setor', { ascending: true })
      .limit(1000),
    supabase
      .from('transaksi_kas')
      .select('id, no_bukti, kategori, tanggal, bukti_url, status_verifikasi')
      .not('bukti_url', 'is', null)
      .order('tanggal', { ascending: true })
      .limit(1000),
    supabase
      .from('security_attendance')
      .select('id, officer_name, shift_date, shift_name, clock_in_at, clock_in_photo_url, status')
      .not('clock_in_photo_url', 'is', null)
      .order('clock_in_at', { ascending: true })
      .limit(1000),
    supabase
      .from('bug_reports')
      .select('id, title, reporter_name, screenshot_url, storage_bucket, storage_path, created_at, status')
      .not('screenshot_url', 'is', null)
      .order('created_at', { ascending: true })
      .limit(500),
  ]);

  const candidates: HybridMediaCandidate[] = [];

  for (const row of (iplRes.data || []) as Array<Record<string, unknown>>) {
    const url = typeof row.bukti_url === 'string' ? row.bukti_url.trim() : '';
    if (!url) continue;
    const cls = classifyMediaUrl(url);
    const dateIso = String(row.tanggal_setor || '');
    const status = String(row.status_verifikasi || '');
    candidates.push({
      id: String(row.id),
      table: 'transaksi_ipl',
      column: 'bukti_url',
      folderKey: 'bukti_ipl',
      label: `IPL ${String(row.blok_rumah || '')} · ${String(row.no_kwitansi || '')}`,
      sublabel: `${String(row.nama_warga || '')} (${status})`,
      dateIso,
      ageDays: computeAgeDays(dateIso),
      url,
      ...cls,
      isFinalStatus: status === 'Terverifikasi' || status === 'Ditolak',
    });
  }

  for (const row of (kasRes.data || []) as Array<Record<string, unknown>>) {
    const url = typeof row.bukti_url === 'string' ? row.bukti_url.trim() : '';
    if (!url) continue;
    const cls = classifyMediaUrl(url);
    const dateIso = String(row.tanggal || '');
    const status = String(row.status_verifikasi || 'Terverifikasi');
    candidates.push({
      id: String(row.id),
      table: 'transaksi_kas',
      column: 'bukti_url',
      folderKey: 'pengeluaran_kas',
      label: `Kas ${String(row.no_bukti || '')}`,
      sublabel: `${String(row.kategori || '')} (${status})`,
      dateIso,
      ageDays: computeAgeDays(dateIso),
      url,
      ...cls,
      isFinalStatus: status === 'Terverifikasi' || status === 'Ditolak',
    });
  }

  for (const row of (attRes.data || []) as Array<Record<string, unknown>>) {
    const url = typeof row.clock_in_photo_url === 'string' ? row.clock_in_photo_url.trim() : '';
    if (!url) continue;
    const cls = classifyMediaUrl(url);
    const dateIso = String(row.clock_in_at || row.shift_date || '');
    const status = String(row.status || '');
    candidates.push({
      id: String(row.id),
      table: 'security_attendance',
      column: 'clock_in_photo_url',
      folderKey: 'absensi_keamanan',
      label: `Absen ${String(row.officer_name || '')}`,
      sublabel: `${String(row.shift_name || '')} (${String(row.shift_date || '')})`,
      dateIso,
      ageDays: computeAgeDays(dateIso),
      url,
      ...cls,
      isFinalStatus: status === 'completed' || computeAgeDays(dateIso) >= 2,
    });
  }

  for (const row of (bugRes.data || []) as Array<Record<string, unknown>>) {
    const url = typeof row.screenshot_url === 'string' ? row.screenshot_url.trim() : '';
    if (!url) continue;
    const cls = classifyMediaUrl(url);
    const dateIso = String(row.created_at || '');
    candidates.push({
      id: String(row.id),
      table: 'bug_reports',
      column: 'screenshot_url',
      folderKey: 'bug_reports',
      label: `Laporan ${String(row.title || 'Bug')}`,
      sublabel: `Pelapor: ${String(row.reporter_name || '')}`,
      dateIso,
      ageDays: computeAgeDays(dateIso),
      url,
      storageLocation: cls.storageLocation,
      supabaseBucket: (typeof row.storage_bucket === 'string' && row.storage_bucket) || cls.supabaseBucket,
      supabasePath: (typeof row.storage_path === 'string' && row.storage_path) || cls.supabasePath,
      isFinalStatus: true,
    });
  }

  const eligibleCandidates = candidates.filter((item) => {
    if (item.storageLocation !== 'supabase') return false;
    if (retentionDays > 0) {
      return item.ageDays >= retentionDays && item.isFinalStatus;
    }
    return item.isFinalStatus;
  });

  const byCategory = { ...emptySummary.byCategory };
  let supabaseCount = 0;
  let driveCount = 0;
  let dataUrlCount = 0;

  for (const item of candidates) {
    if (item.storageLocation === 'supabase') {
      supabaseCount += 1;
      byCategory[item.folderKey].supabase += 1;
    } else if (item.storageLocation === 'drive') {
      driveCount += 1;
      byCategory[item.folderKey].drive += 1;
    } else if (item.storageLocation === 'data_url') {
      dataUrlCount += 1;
    }
  }

  for (const item of eligibleCandidates) {
    byCategory[item.folderKey].eligible += 1;
  }

  return {
    totalMediaCount: candidates.length,
    supabaseCount,
    driveCount,
    dataUrlCount,
    eligibleCount: eligibleCandidates.length,
    // Rata-rata ukuran foto terkompresi di Supabase ~135 KB
    estimatedSupabaseBytes: supabaseCount * 135 * 1024,
    byCategory,
    candidates,
    eligibleCandidates,
  };
}

function buildArchiveFileName(candidate: HybridMediaCandidate): string {
  const safeSlug = candidate.label
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const datePart = (candidate.dateIso || new Date().toISOString()).slice(0, 10);
  const extMatch = candidate.url.match(/\.([a-zA-Z0-9]{3,4})(?:\?.*)?$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
  return `${datePart}-${safeSlug || candidate.id.slice(0, 8)}.${ext}`;
}

export async function runHybridArchiveBatch(params: {
  session: SessionUser;
  accessToken: string;
  candidates: HybridMediaCandidate[];
  deleteFromSupabase: boolean;
  onProgress?: (current: number, total: number, currentLabel: string) => void;
}): Promise<{
  archivedCount: number;
  freedSupabaseCount: number;
  failedCount: number;
  errors: string[];
}> {
  const { session, accessToken, candidates, deleteFromSupabase, onProgress } = params;
  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Koneksi Supabase belum tersedia.');
  }

  await ensureHybridFolderStructure(accessToken);

  let archivedCount = 0;
  let freedSupabaseCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    onProgress?.(i + 1, candidates.length, item.label);

    try {
      const fetchRes = await fetch(item.url);
      if (!fetchRes.ok) {
        throw new Error(`Gagal mengunduh media (${fetchRes.status})`);
      }
      const blob = await fetchRes.blob();
      const fileName = buildArchiveFileName(item);

      const uploaded = await uploadBlobToHybridDrive({
        accessToken,
        folderKey: item.folderKey,
        fileName,
        blob,
        mimeType: blob.type || 'image/jpeg',
        makePublicReader: true,
        description: `Arsip ${item.label} — ${item.sublabel}`,
      });

      const updatePayload: Record<string, unknown> = {
        [item.column]: uploaded.directImageUrl,
      };
      if (item.table === 'bug_reports' && deleteFromSupabase) {
        updatePayload.storage_bucket = null;
        updatePayload.storage_path = null;
      }

      const { error: dbErr } = await supabase
        .from(item.table)
        .update(updatePayload)
        .eq('id', item.id);

      if (dbErr) {
        throw new Error(`Gagal memperbarui link database (${item.table}): ${dbErr.message}`);
      }

      archivedCount += 1;

      if (deleteFromSupabase && item.supabaseBucket && item.supabasePath) {
        const { error: rmErr } = await supabase.storage
          .from(item.supabaseBucket)
          .remove([item.supabasePath]);
        if (!rmErr) {
          freedSupabaseCount += 1;
        }
      }
    } catch (err) {
      failedCount += 1;
      const msg = err instanceof Error ? err.message : 'Gagal mengarsipkan item';
      errors.push(`${item.label}: ${msg}`);
      if (msg.includes('Sesi Google Drive telah berakhir')) {
        break;
      }
    }
  }

  if (archivedCount > 0) {
    saveHybridDriveConfig({
      lastArchiveAt: new Date().toISOString(),
      lastArchiveCount: archivedCount,
    });
    void recordAuditLog({
      session,
      action: 'ARCHIVE_MEDIA_DRIVE',
      entity: 'hybrid_google_drive',
      summary: `Mengarsipkan ${archivedCount} media ke Google Drive (${DRIVE_TARGET_EMAIL})${
        freedSupabaseCount > 0 ? ` & membebaskan ${freedSupabaseCount} file Supabase Storage` : ''
      }.`,
    });
  }

  return { archivedCount, freedSupabaseCount, failedCount, errors };
}

export async function backupDatabaseSnapshotToDrive(
  session: SessionUser,
  accessToken: string
): Promise<{ fileId: string; fileName: string; webViewLink: string | null; sizeBytes: number }> {
  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    throw new Error('Koneksi Supabase belum aktif.');
  }

  const [wargaRes, iplRes, statusRes, kasRes, petugasRes, patrolRes, absenRes] =
    await Promise.all([
      supabase.from('users_warga').select('*').order('blok_rumah', { ascending: true }),
      supabase.from('transaksi_ipl').select('*').order('tanggal_setor', { ascending: false }),
      supabase.from('status_ecard_bulanan').select('*'),
      supabase.from('transaksi_kas').select('*').order('tanggal', { ascending: false }),
      supabase
        .from('petugas_keamanan')
        .select('id, nama, username, no_hp, shift, aktif, created_at'),
      supabase.from('log_patroli').select('*').order('waktu_scan', { ascending: false }).limit(1500),
      supabase
        .from('security_attendance')
        .select('*')
        .order('clock_in_at', { ascending: false })
        .limit(1000),
    ]);

  const snapshot = {
    exported_at: new Date().toISOString(),
    exported_by: `${session.nama_warga} (${session.jabatan || session.blok_rumah})`,
    target_drive_account: DRIVE_TARGET_EMAIL,
    app: 'e-Card Verifikasi & IPL Digital — Perumahan Saung Kebun',
    counts: {
      users_warga: (wargaRes.data || []).length,
      transaksi_ipl: (iplRes.data || []).length,
      status_ecard_bulanan: (statusRes.data || []).length,
      transaksi_kas: (kasRes.data || []).length,
      petugas_keamanan: (petugasRes.data || []).length,
      log_patroli: (patrolRes.data || []).length,
      security_attendance: (absenRes.data || []).length,
    },
    data: {
      users_warga: wargaRes.data || [],
      transaksi_ipl: iplRes.data || [],
      status_ecard_bulanan: statusRes.data || [],
      transaksi_kas: kasRes.data || [],
      petugas_keamanan: petugasRes.data || [],
      log_patroli: patrolRes.data || [],
      security_attendance: absenRes.data || [],
    },
  };

  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
  const fileName = `backup-saung-kebun-${stamp}.json`;
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });

  const uploaded = await uploadBlobToHybridDrive({
    accessToken,
    folderKey: 'backup_database',
    fileName,
    blob,
    mimeType: 'application/json',
    makePublicReader: false,
    description: 'Snapshot cadangan database e-Card Verifikasi Saung Kebun',
  });

  saveHybridDriveConfig({ lastBackupAt: new Date().toISOString() });

  void recordAuditLog({
    session,
    action: 'BACKUP_DB_DRIVE',
    entity: 'hybrid_google_drive',
    summary: `Membuat cadangan database JSON (${fileName}) ke Google Drive ${DRIVE_TARGET_EMAIL}.`,
  });

  return {
    fileId: uploaded.fileId,
    fileName,
    webViewLink: uploaded.webViewLink,
    sizeBytes: uploaded.sizeBytes,
  };
}

/**
 * Opsional Mode Hybrid Langsung:
 * Jika Pengurus sedang terhubung ke sesi Google Drive dan opsi "directUploadWhenConnected" aktif,
 * nota kas baru dapat diunggah langsung ke Google Drive (dengan fallback otomatis ke Supabase Storage).
 */
export async function tryDirectDriveUploadIfConnected(params: {
  folderKey: Exclude<HybridFolderKey, 'backup_database'>;
  file: File;
  labelPrefix?: string;
}): Promise<string | null> {
  const cfg = loadHybridDriveConfig();
  if (!cfg.directUploadWhenConnected) return null;

  const accessToken = await getGoogleDriveAccessToken();
  if (!accessToken) return null;

  try {
    const ext = params.file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const stamp = new Date().toISOString().slice(0, 10);
    const prefix = params.labelPrefix ? `${params.labelPrefix}-` : '';
    const fileName = `${stamp}-${prefix}${Date.now()}.${ext}`;
    const uploaded = await uploadBlobToHybridDrive({
      accessToken,
      folderKey: params.folderKey,
      fileName,
      blob: params.file,
      mimeType: params.file.type || 'image/jpeg',
      makePublicReader: true,
    });
    return uploaded.directImageUrl;
  } catch {
    return null;
  }
}
