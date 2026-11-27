import {
  clearGoogleDriveAccessToken,
  DRIVE_TARGET_EMAIL,
  getGoogleDriveAccessToken,
} from './googleDriveAuth';
import {
  ensureFreshGoogleDriveToken,
  refreshGoogleDriveTokenViaEdge,
  setDriveAutoRefreshSession,
} from './googleDriveAutoRefresh';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { recordAuditLog } from './auditLogger';
import type { SessionUser } from '../types';

export const HYBRID_ROOT_FOLDER_NAME = 'eCard-Saung-Kebun-Hybrid';

export type HybridFolderKey =
  | 'bukti_ipl'
  | 'pengeluaran_kas'
  | 'absensi_keamanan'
  | 'bug_reports'
  | 'avatars'
  | 'backup_database';

export type HybridArchiveCategoryKey =
  | 'bukti_ipl'
  | 'pengeluaran_kas'
  | 'absensi_keamanan'
  | 'bug_reports';

export const HYBRID_SUBFOLDER_NAMES: Record<HybridFolderKey, string> = {
  bukti_ipl: 'bukti-ipl',
  pengeluaran_kas: 'pengeluaran-kas',
  absensi_keamanan: 'absensi-keamanan',
  bug_reports: 'bug-reports',
  avatars: 'avatars',
  backup_database: 'backup-database',
};

export interface HybridDriveConfig {
  targetEmail: string;
  retentionDays: number; // 0 = semua media Supabase, 30, 90, 180, 365
  deleteSupabaseAfterArchive: boolean;
  directUploadWhenConnected: boolean;
  autoArchivePrompt: boolean;
  thresholdPercent: number;
  autoRouteOnNearLimit: boolean;
  forceRouteToDrive: boolean;
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
  thresholdPercent: 80,
  autoRouteOnNearLimit: true,
  forceRouteToDrive: false,
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
  archiveYear: string;
  yearFolderName: string | null;
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
  folderKey: HybridArchiveCategoryKey;
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
    HybridArchiveCategoryKey,
    { supabase: number; drive: number; eligible: number }
  >;
  candidates: HybridMediaCandidate[];
  eligibleCandidates: HybridMediaCandidate[];
}

export interface BackendStorageBucketStat {
  bucket: string;
  fileCount: number;
  usedBytes: number;
}

export interface BackendStorageThresholdSettings {
  targetEmail: string;
  thresholdPercent: number;
  storageLimitBytes: number;
  dbLimitBytes: number;
  autoRouteOnNearLimit: boolean;
  forceRouteToDrive: boolean;
}

export interface BackendStorageStatus {
  ok: boolean;
  configured?: boolean;
  measuredVia?: 'rpc_exact' | 'storage_api_scan' | 'table_estimate' | 'unconfigured' | 'client_fallback';
  status: 'normal' | 'warning' | 'near_limit';
  shouldRouteNewMediaToDrive: boolean;
  routeReason?: string;
  storageUsedBytes?: number;
  storageLimitBytes?: number;
  storageUsagePercent: number;
  dbUsedBytes?: number;
  dbLimitBytes?: number;
  dbUsagePercent: number;
  totalObjects?: number;
  buckets?: BackendStorageBucketStat[];
  thresholdPercent?: number;
  settings?: BackendStorageThresholdSettings;
  measuredAt: string;
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
  init?: RequestInit,
  allowAutoRefresh = true
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    if (allowAutoRefresh) {
      try {
        const refreshed = await refreshGoogleDriveTokenViaEdge(null, {
          force: true,
          reason: 'drive_api_401',
        });
        if (refreshed.accessToken && refreshed.accessToken !== accessToken) {
          return await driveFetchJson<T>(url, refreshed.accessToken, init, false);
        }
      } catch {
        // Lanjutkan ke clear token & error bila refresh Edge Function gagal
      }
    }
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

  let activeToken = params.accessToken;
  const performMultipartUpload = async (token: string) => {
    const form = new FormData();
    form.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' })
    );
    form.append('file', params.blob, params.fileName);

    return fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType,webViewLink,thumbnailLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      }
    );
  };

  let uploadRes = await performMultipartUpload(activeToken);

  if (uploadRes.status === 401) {
    try {
      const refreshed = await refreshGoogleDriveTokenViaEdge(null, {
        force: true,
        reason: 'drive_upload_401',
      });
      if (refreshed.accessToken && refreshed.accessToken !== activeToken) {
        activeToken = refreshed.accessToken;
        uploadRes = await performMultipartUpload(activeToken);
      }
    } catch {
      // Biarkan jatuh ke penanganan 401 di bawah
    }
  }

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
    await setDriveFileAnyoneReadable(activeToken, uploaded.id);
  }

  return {
    fileId: uploaded.id,
    directImageUrl: buildDriveDirectImageUrl(uploaded.id),
    webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    sizeBytes: Number(uploaded.size || params.blob.size || 0),
  };
}

const YEAR_FOLDER_REGEX = /^(19|20)\d{2}$/;

function extractArchiveYear(
  createdTime?: string | null,
  fileName?: string | null,
  yearFolderName?: string | null
): string {
  if (yearFolderName && YEAR_FOLDER_REGEX.test(yearFolderName.trim())) {
    return yearFolderName.trim();
  }
  if (createdTime) {
    const parsed = new Date(createdTime);
    if (!Number.isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      if (y >= 2000 && y <= 2099) {
        return String(y);
      }
    }
  }
  if (fileName) {
    const match = fileName.match(/(?:^|[-_\s])(20\d{2})(?:[-_\s.]|$)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return 'Lainnya';
}

interface YearSubfolderMeta {
  id: string;
  year: string;
  folderKey: HybridFolderKey | 'root';
  baseFolderId: string;
}

async function discoverYearSubfolders(
  accessToken: string,
  baseFolders: Array<{ id: string; folderKey: HybridFolderKey | 'root' }>
): Promise<Map<string, YearSubfolderMeta>> {
  const result = new Map<string, YearSubfolderMeta>();
  if (baseFolders.length === 0) return result;

  const baseIdToKey = new Map<string, HybridFolderKey | 'root'>();
  for (const item of baseFolders) {
    if (item.id) baseIdToKey.set(item.id, item.folderKey);
  }

  const parentClauses = baseFolders
    .filter((item) => Boolean(item.id))
    .map((item) => `'${item.id}' in parents`);
  if (parentClauses.length === 0) return result;

  const q = `(${parentClauses.join(' or ')}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const params = new URLSearchParams({
    q,
    pageSize: '100',
    fields: 'files(id,name,parents)',
  });

  const data = await driveFetchJson<{
    files?: Array<{ id: string; name: string; parents?: string[] }>;
  }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, accessToken);

  for (const f of data.files || []) {
    const cleanName = String(f.name || '').trim();
    if (!YEAR_FOLDER_REGEX.test(cleanName)) continue;
    const baseFolderId = f.parents?.[0] || '';
    const folderKey = baseIdToKey.get(baseFolderId);
    if (!baseFolderId || !folderKey) continue;
    result.set(f.id, {
      id: f.id,
      year: cleanName,
      folderKey,
      baseFolderId,
    });
  }

  return result;
}

export async function listHybridDriveFiles(
  accessToken: string,
  filterKey: HybridFolderKey | 'all' = 'all',
  pageSize = 100
): Promise<DriveManagedFile[]> {
  const { rootFolderId, subFolderIds } = await ensureHybridFolderStructure(accessToken);

  const folderIdToKey = new Map<string, HybridFolderKey>();
  (Object.keys(subFolderIds) as HybridFolderKey[]).forEach((key) => {
    folderIdToKey.set(subFolderIds[key], key);
  });

  const baseTargets: Array<{ id: string; folderKey: HybridFolderKey | 'root' }> = [];
  if (filterKey === 'all') {
    if (rootFolderId) {
      baseTargets.push({ id: rootFolderId, folderKey: 'root' });
    }
    (Object.keys(subFolderIds) as HybridFolderKey[]).forEach((key) => {
      if (subFolderIds[key]) {
        baseTargets.push({ id: subFolderIds[key], folderKey: key });
      }
    });
  } else {
    const targetId = subFolderIds[filterKey];
    if (!targetId) return [];
    baseTargets.push({ id: targetId, folderKey: filterKey });
  }

  if (baseTargets.length === 0) return [];

  const yearFolderMap = await discoverYearSubfolders(accessToken, baseTargets);

  // Kumpulkan seluruh folder ID yang perlu dipindai (folder kategori + subfolder tahunan)
  const searchFolderIds = [
    ...baseTargets.filter((b) => filterKey !== 'all' || b.folderKey !== 'root').map((b) => b.id),
    ...Array.from(yearFolderMap.keys()),
  ];

  if (searchFolderIds.length === 0) return [];

  // Pecah query menjadi beberapa chunk aman agar tidak melebihi batas panjang query Google Drive API
  const CHUNK_SIZE = 18;
  const rawFiles: Array<{
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    createdTime?: string;
    webViewLink?: string;
    thumbnailLink?: string;
    parents?: string[];
  }> = [];

  for (let i = 0; i < searchFolderIds.length; i += CHUNK_SIZE) {
    const chunk = searchFolderIds.slice(i, i + CHUNK_SIZE);
    const parentQuery =
      chunk.length === 1
        ? `'${chunk[0]}' in parents`
        : `(${chunk.map((id) => `'${id}' in parents`).join(' or ')})`;

    const q = `${parentQuery} and mimeType != 'application/vnd.google-apps.folder' and trashed = false`;
    const params = new URLSearchParams({
      q,
      orderBy: 'createdTime desc',
      pageSize: String(Math.min(Math.max(pageSize, 1), 100)),
      fields: 'files(id,name,mimeType,size,createdTime,webViewLink,thumbnailLink,parents)',
    });

    const data = await driveFetchJson<{
      files?: typeof rawFiles;
    }>(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, accessToken);

    if (Array.isArray(data.files)) {
      rawFiles.push(...data.files);
    }
  }

  const seenIds = new Set<string>();
  const mapped: DriveManagedFile[] = [];

  for (const f of rawFiles) {
    if (seenIds.has(f.id)) continue;
    seenIds.add(f.id);

    const parentId = f.parents?.[0] || null;
    const yearMeta = parentId ? yearFolderMap.get(parentId) : undefined;
    const folderKey: HybridFolderKey | 'root' | 'other' = yearMeta
      ? yearMeta.folderKey
      : (parentId && folderIdToKey.get(parentId)) || 'other';
    const yearFolderName = yearMeta ? yearMeta.year : null;
    const createdTime = f.createdTime || new Date().toISOString();

    mapped.push({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: Number(f.size || 0),
      createdTime,
      webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
      thumbnailLink: f.thumbnailLink || null,
      directImageUrl: buildDriveDirectImageUrl(f.id),
      parentId,
      folderKey,
      yearFolderName,
      archiveYear: extractArchiveYear(createdTime, f.name, yearFolderName),
    });
  }

  mapped.sort(
    (a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
  );

  return mapped.slice(0, Math.min(Math.max(pageSize, 1), 200));
}

export async function organizeDriveFilesIntoYearFolders(
  accessToken: string,
  files: DriveManagedFile[]
): Promise<{ movedCount: number; createdFolders: string[] }> {
  const candidates = files.filter(
    (file) =>
      !file.yearFolderName &&
      Boolean(file.parentId) &&
      YEAR_FOLDER_REGEX.test(file.archiveYear)
  );

  if (candidates.length === 0) {
    return { movedCount: 0, createdFolders: [] };
  }

  const resolvedYearFolderCache = new Map<string, string>();
  const createdFolders: string[] = [];
  let movedCount = 0;

  for (const file of candidates) {
    const oldParentId = file.parentId as string;
    const yearName = file.archiveYear;
    const cacheKey = `${oldParentId}::${yearName}`;

    let targetYearFolderId = resolvedYearFolderCache.get(cacheKey) || null;
    if (!targetYearFolderId) {
      targetYearFolderId = await findFolderByName(accessToken, yearName, oldParentId);
      if (!targetYearFolderId) {
        targetYearFolderId = await createDriveFolder(accessToken, yearName, oldParentId);
        createdFolders.push(yearName);
      }
      resolvedYearFolderCache.set(cacheKey, targetYearFolderId);
    }

    const patchParams = new URLSearchParams({
      addParents: targetYearFolderId,
      removeParents: oldParentId,
      fields: 'id,parents',
    });

    await driveFetchJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?${patchParams.toString()}`,
      accessToken,
      { method: 'PATCH' }
    );
    movedCount += 1;
  }

  return {
    movedCount,
    createdFolders: Array.from(new Set(createdFolders)).sort(),
  };
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
  setDriveAutoRefreshSession(session);
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

let cachedStorageStatus: { data: BackendStorageStatus; fetchedAt: number } | null = null;
const STORAGE_STATUS_CACHE_TTL_MS = 30_000;

function buildPortalApiHeaders(session?: SessionUser | null): Record<string, string> {
  return {
    'x-user-role': session?.role || 'warga',
    'x-blok-rumah': session?.blok_rumah || '',
    'x-admin-permission': session?.admin_permission || '',
    'x-admin-jabatan': session?.jabatan || '',
  };
}

export function invalidateBackendStorageStatusCache(): void {
  cachedStorageStatus = null;
}

function computeMonitorStatusSnapshot(params: {
  storageUsedBytes: number;
  storageLimitBytes: number;
  dbUsedBytes: number;
  dbLimitBytes: number;
  totalObjects: number;
  buckets: BackendStorageBucketStat[];
  measuredVia: BackendStorageStatus['measuredVia'];
  settings: BackendStorageThresholdSettings;
  measuredAt?: string;
}): BackendStorageStatus {
  const {
    storageUsedBytes,
    storageLimitBytes,
    dbUsedBytes,
    dbLimitBytes,
    totalObjects,
    buckets,
    measuredVia,
    settings,
    measuredAt,
  } = params;

  const storageUsagePercent =
    storageLimitBytes > 0
      ? Number(((storageUsedBytes / storageLimitBytes) * 100).toFixed(2))
      : 0;
  const dbUsagePercent =
    dbLimitBytes > 0 ? Number(((dbUsedBytes / dbLimitBytes) * 100).toFixed(2)) : 0;

  const isNearLimit =
    storageUsagePercent >= settings.thresholdPercent ||
    dbUsagePercent >= settings.thresholdPercent;
  const isWarning =
    !isNearLimit &&
    (storageUsagePercent >= Math.max(50, settings.thresholdPercent - 15) ||
      dbUsagePercent >= Math.max(50, settings.thresholdPercent - 15));

  const status: BackendStorageStatus['status'] = isNearLimit
    ? 'near_limit'
    : isWarning
      ? 'warning'
      : 'normal';

  const shouldRouteNewMediaToDrive =
    settings.forceRouteToDrive || (settings.autoRouteOnNearLimit && isNearLimit);

  let routeReason = 'Penyimpanan Supabase dalam kondisi aman; media baru disimpan di Supabase.';
  if (settings.forceRouteToDrive) {
    routeReason = 'Pengalihan langsung aktif: media baru diarahkan ke Google Drive OAuth2.';
  } else if (shouldRouteNewMediaToDrive) {
    routeReason = `Pemakaian Supabase mencapai batas (${Math.max(
      storageUsagePercent,
      dbUsagePercent
    ).toFixed(1)}% >= ${settings.thresholdPercent}%): media baru dialihkan otomatis ke Google Drive.`;
  } else if (isWarning) {
    routeReason = `Pemakaian Supabase mulai tinggi (${Math.max(
      storageUsagePercent,
      dbUsagePercent
    ).toFixed(1)}%): disarankan mengarsipkan foto lama ke Google Drive.`;
  }

  return {
    ok: true,
    configured: true,
    measuredVia,
    status,
    shouldRouteNewMediaToDrive,
    routeReason,
    storageUsedBytes,
    storageLimitBytes,
    storageUsagePercent,
    dbUsedBytes,
    dbLimitBytes,
    dbUsagePercent,
    totalObjects,
    buckets,
    thresholdPercent: settings.thresholdPercent,
    settings,
    measuredAt: measuredAt || new Date().toISOString(),
  };
}

async function loadThresholdSettingsFromSupabaseClient(
  session?: SessionUser | null
): Promise<BackendStorageThresholdSettings> {
  const localCfg = loadHybridDriveConfig();
  const defaults: BackendStorageThresholdSettings = {
    targetEmail: DRIVE_TARGET_EMAIL,
    thresholdPercent: localCfg.thresholdPercent ?? 80,
    storageLimitBytes: 1024 * 1024 * 1024,
    dbLimitBytes: 500 * 1024 * 1024,
    autoRouteOnNearLimit: localCfg.autoRouteOnNearLimit ?? true,
    forceRouteToDrive: localCfg.forceRouteToDrive ?? false,
  };

  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) {
    return defaults;
  }

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('hybrid_drive_config')
      .eq('id', 'default-app-brand')
      .maybeSingle();

    if (!error && data && typeof (data as Record<string, unknown>).hybrid_drive_config === 'object') {
      const remote = (data as { hybrid_drive_config?: Partial<BackendStorageThresholdSettings> | null })
        .hybrid_drive_config;
      if (remote) {
        return {
          targetEmail: DRIVE_TARGET_EMAIL,
          thresholdPercent:
            typeof remote.thresholdPercent === 'number'
              ? remote.thresholdPercent
              : defaults.thresholdPercent,
          storageLimitBytes:
            typeof remote.storageLimitBytes === 'number'
              ? remote.storageLimitBytes
              : defaults.storageLimitBytes,
          dbLimitBytes:
            typeof remote.dbLimitBytes === 'number'
              ? remote.dbLimitBytes
              : defaults.dbLimitBytes,
          autoRouteOnNearLimit:
            typeof remote.autoRouteOnNearLimit === 'boolean'
              ? remote.autoRouteOnNearLimit
              : defaults.autoRouteOnNearLimit,
          forceRouteToDrive:
            typeof remote.forceRouteToDrive === 'boolean'
              ? remote.forceRouteToDrive
              : defaults.forceRouteToDrive,
        };
      }
    }
  } catch {
    // Abaikan jika kolom hybrid_drive_config belum dimigrasi
  }

  return defaults;
}

/**
 * Memanggil backend GET /api/storage/status untuk mengecek penggunaan kapasitas
 * Supabase Storage & Database serta menentukan apakah upload media baru harus
 * diarahkan otomatis ke Google Drive OAuth2.
 */
export async function fetchBackendStorageStatus(
  session?: SessionUser | null,
  forceRefresh = false
): Promise<BackendStorageStatus | null> {
  if (
    !forceRefresh &&
    cachedStorageStatus &&
    Date.now() - cachedStorageStatus.fetchedAt < STORAGE_STATUS_CACHE_TTL_MS
  ) {
    return cachedStorageStatus.data;
  }

  try {
    const res = await fetch('/api/storage/status', {
      method: 'GET',
      headers: buildPortalApiHeaders(session),
    });
    if (res.ok) {
      const data = (await res.json()) as BackendStorageStatus;
      if (data && typeof data === 'object' && data.configured !== false) {
        if (data.settings) {
          saveHybridDriveConfig({
            thresholdPercent: data.settings.thresholdPercent,
            autoRouteOnNearLimit: data.settings.autoRouteOnNearLimit,
            forceRouteToDrive: data.settings.forceRouteToDrive,
          });
        }
        cachedStorageStatus = { data, fetchedAt: Date.now() };
        return data;
      }
    }
  } catch {
    // Fallback ke Supabase client langsung bila /api/storage/status offline/500
  }

  const settings = await loadThresholdSettingsFromSupabaseClient(session);

  if (session) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase && isSupabaseConfigured()) {
        const { data: rpcData, error: rpcErr } = await supabase.rpc('get_supabase_storage_status');
        if (!rpcErr && rpcData && typeof rpcData === 'object') {
          const raw = rpcData as {
            total_objects?: number;
            storage_used_bytes?: number;
            db_used_bytes?: number;
            buckets?: BackendStorageBucketStat[];
            measured_at?: string;
          };
          const snapshot = computeMonitorStatusSnapshot({
            storageUsedBytes: Number(raw.storage_used_bytes || 0),
            storageLimitBytes: settings.storageLimitBytes,
            dbUsedBytes: Number(raw.db_used_bytes || 0),
            dbLimitBytes: settings.dbLimitBytes,
            totalObjects: Number(raw.total_objects || 0),
            buckets: Array.isArray(raw.buckets) ? raw.buckets : [],
            measuredVia: 'rpc_exact',
            settings,
            measuredAt: raw.measured_at,
          });
          cachedStorageStatus = { data: snapshot, fetchedAt: Date.now() };
          return snapshot;
        }
      }
    } catch {
      // Lanjutkan ke estimasi media tabel jika RPC v15 belum terpasang
    }

    try {
      const inv = await scanHybridMediaInventory(session, 0);
      const snapshot = computeMonitorStatusSnapshot({
        storageUsedBytes: inv.estimatedSupabaseBytes,
        storageLimitBytes: settings.storageLimitBytes,
        dbUsedBytes: 0,
        dbLimitBytes: settings.dbLimitBytes,
        totalObjects: inv.supabaseCount,
        buckets: [
          {
            bucket: 'bukti-ipl',
            fileCount: inv.byCategory.bukti_ipl.supabase + inv.byCategory.pengeluaran_kas.supabase + inv.byCategory.absensi_keamanan.supabase,
            usedBytes:
              (inv.byCategory.bukti_ipl.supabase +
                inv.byCategory.pengeluaran_kas.supabase +
                inv.byCategory.absensi_keamanan.supabase) *
              135 *
              1024,
          },
          {
            bucket: 'bug-reports',
            fileCount: inv.byCategory.bug_reports.supabase,
            usedBytes: inv.byCategory.bug_reports.supabase * 135 * 1024,
          },
        ].filter((b) => b.fileCount > 0),
        measuredVia: 'client_fallback',
        settings,
      });
      cachedStorageStatus = { data: snapshot, fetchedAt: Date.now() };
      return snapshot;
    } catch {
      // Abaikan fallback gagal
    }
  }

  return computeMonitorStatusSnapshot({
    storageUsedBytes: 0,
    storageLimitBytes: settings.storageLimitBytes,
    dbUsedBytes: 0,
    dbLimitBytes: settings.dbLimitBytes,
    totalObjects: 0,
    buckets: [],
    measuredVia: 'client_fallback',
    settings,
  });
}

export async function updateBackendHybridThresholdConfig(
  session: SessionUser,
  patch: {
    thresholdPercent?: number;
    storageLimitMb?: number;
    autoRouteOnNearLimit?: boolean;
    forceRouteToDrive?: boolean;
  }
): Promise<BackendStorageStatus> {
  // 1. Simpan mirror pengaturan secara lokal agar langsung aktif di sesi ini
  const currentLocal = loadHybridDriveConfig();
  saveHybridDriveConfig({
    thresholdPercent:
      typeof patch.thresholdPercent === 'number'
        ? patch.thresholdPercent
        : currentLocal.thresholdPercent,
    autoRouteOnNearLimit:
      typeof patch.autoRouteOnNearLimit === 'boolean'
        ? patch.autoRouteOnNearLimit
        : currentLocal.autoRouteOnNearLimit,
    forceRouteToDrive:
      typeof patch.forceRouteToDrive === 'boolean'
        ? patch.forceRouteToDrive
        : currentLocal.forceRouteToDrive,
  });

  let apiMonitor: BackendStorageStatus | null = null;
  let persistedToDb = false;

  // 2. Prioritas utama: kirim ke endpoint backend `/api/storage/config`
  try {
    const res = await fetch('/api/storage/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildPortalApiHeaders(session),
      },
      body: JSON.stringify(patch),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        persistedToDb?: boolean;
        monitor?: BackendStorageStatus;
      };
      if (data.monitor) {
        apiMonitor = data.monitor;
        persistedToDb = Boolean(data.persistedToDb);
      }
    }
  } catch {
    // Fallback langsung ke Supabase client di bawah
  }

  // 3. Jika backend API gagal atau belum menyimpan ke DB, simpan langsung via Supabase client
  if (!persistedToDb) {
    const baseSettings = await loadThresholdSettingsFromSupabaseClient(session);
    const mergedSettings: BackendStorageThresholdSettings = {
      targetEmail: DRIVE_TARGET_EMAIL,
      thresholdPercent:
        typeof patch.thresholdPercent === 'number'
          ? patch.thresholdPercent
          : baseSettings.thresholdPercent,
      storageLimitBytes:
        typeof patch.storageLimitMb === 'number' && Number.isFinite(patch.storageLimitMb)
          ? Math.round(patch.storageLimitMb * 1024 * 1024)
          : baseSettings.storageLimitBytes,
      dbLimitBytes: baseSettings.dbLimitBytes,
      autoRouteOnNearLimit:
        typeof patch.autoRouteOnNearLimit === 'boolean'
          ? patch.autoRouteOnNearLimit
          : baseSettings.autoRouteOnNearLimit,
      forceRouteToDrive:
        typeof patch.forceRouteToDrive === 'boolean'
          ? patch.forceRouteToDrive
          : baseSettings.forceRouteToDrive,
    };

    const supabase = getSupabaseClient(session);
    if (supabase && isSupabaseConfigured()) {
      try {
        await supabase
          .from('app_settings')
          .update({ hybrid_drive_config: mergedSettings })
          .eq('id', 'default-app-brand');
      } catch {
        // Tetap lanjutkan dengan cache lokal bila kolom migration v15 belum dipasang
      }
    }

    invalidateBackendStorageStatusCache();
    const refreshed = await fetchBackendStorageStatus(session, true);
    if (refreshed) {
      const finalMonitor = computeMonitorStatusSnapshot({
        storageUsedBytes: refreshed.storageUsedBytes ?? 0,
        storageLimitBytes: mergedSettings.storageLimitBytes,
        dbUsedBytes: refreshed.dbUsedBytes ?? 0,
        dbLimitBytes: mergedSettings.dbLimitBytes,
        totalObjects: refreshed.totalObjects ?? 0,
        buckets: refreshed.buckets ?? [],
        measuredVia: refreshed.measuredVia || 'client_fallback',
        settings: mergedSettings,
      });
      cachedStorageStatus = { data: finalMonitor, fetchedAt: Date.now() };
      return finalMonitor;
    }
  }

  if (apiMonitor) {
    cachedStorageStatus = { data: apiMonitor, fetchedAt: Date.now() };
    return apiMonitor;
  }

  const fallbackStatus = await fetchBackendStorageStatus(session, true);
  if (fallbackStatus) {
    return fallbackStatus;
  }

  throw new Error('Gagal menyimpan pengaturan monitor penyimpanan backend.');
}

function blobToBase64Payload(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Gagal membaca file media untuk unggahan Drive.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Router Media Otomatis (Backend Monitor -> Google Drive OAuth2):
 * 1. Memeriksa status penyimpanan Supabase lewat backend (`/api/storage/status`).
 * 2. Jika ukuran penyimpanan mendekati batas (`shouldRouteNewMediaToDrive === true`)
 *    atau opsi upload langsung aktif, dan token OAuth2 Google Drive tersedia di memori,
 *    file media baru dikirim lewat endpoint backend `/api/storage/upload-drive`
 *    (atau fallback langsung ke Drive API bila runtime offline/mobile) dan masuk ke
 *    folder `eCard-Saung-Kebun-Hybrid/<subfolder>`.
 * 3. Mengembalikan `null` bila penyimpanan Supabase aman atau belum ada sesi OAuth2 aktif.
 */
export async function routeNewMediaUploadAuto(params: {
  session?: SessionUser | null;
  folderKey: Exclude<HybridFolderKey, 'backup_database'>;
  file: File;
  labelPrefix?: string;
  description?: string;
}): Promise<{ url: string; routedReason: string } | null> {
  if (params.session) {
    setDriveAutoRefreshSession(params.session);
  }
  const accessToken =
    (await ensureFreshGoogleDriveToken(params.session, { respectExplicitLogout: true })) ||
    (await getGoogleDriveAccessToken());
  if (!accessToken) {
    return null;
  }

  const localCfg = loadHybridDriveConfig();
  const backendStatus = await fetchBackendStorageStatus(params.session, false);
  const shouldRouteByBackend = Boolean(backendStatus?.shouldRouteNewMediaToDrive);
  const shouldRouteByToggle =
    params.folderKey === 'pengeluaran_kas' && localCfg.directUploadWhenConnected;

  if (!shouldRouteByBackend && !shouldRouteByToggle) {
    return null;
  }

  const ext = params.file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const stamp = new Date().toISOString().slice(0, 10);
  const prefix = params.labelPrefix ? `${params.labelPrefix}-` : '';
  const fileName = `${stamp}-${prefix}${Date.now()}.${ext}`;
  const mimeType = params.file.type || 'image/jpeg';

  // Prioritas 1: kirim melalui backend `/api/storage/upload-drive` dengan Bearer OAuth2
  try {
    const fileBase64 = await blobToBase64Payload(params.file);
    const res = await fetch('/api/storage/upload-drive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...buildPortalApiHeaders(params.session),
      },
      body: JSON.stringify({
        folderKey: params.folderKey,
        fileName,
        mimeType,
        fileBase64,
        description: params.description,
        makePublicReader: true,
      }),
    });

    if (res.ok) {
      const uploaded = (await res.json()) as { ok?: boolean; directImageUrl?: string };
      if (uploaded.ok && uploaded.directImageUrl) {
        return {
          url: uploaded.directImageUrl,
          routedReason:
            backendStatus?.routeReason ||
            'Diarahkan otomatis ke Google Drive OAuth2.',
        };
      }
    } else if (res.status === 401) {
      clearGoogleDriveAccessToken();
      return null;
    }
  } catch {
    // Fallback langsung ke Drive API bila runtime tidak memiliki /api server (mis. APK Capacitor)
  }

  // Fallback 2: upload langsung via Google Drive API dengan token OAuth2 aktif
  try {
    const uploaded = await uploadBlobToHybridDrive({
      accessToken,
      folderKey: params.folderKey,
      fileName,
      blob: params.file,
      mimeType,
      makePublicReader: true,
      description: params.description,
    });
    return {
      url: uploaded.directImageUrl,
      routedReason:
        backendStatus?.routeReason ||
        'Diarahkan otomatis ke Google Drive OAuth2.',
    };
  } catch {
    return null;
  }
}

/**
 * Opsional Mode Hybrid Langsung:
 * Mempertahankan kompatibilitas pemanggil lama dengan mendelegasikan ke routeNewMediaUploadAuto.
 */
export async function tryDirectDriveUploadIfConnected(params: {
  session?: SessionUser | null;
  folderKey: Exclude<HybridFolderKey, 'backup_database'>;
  file: File;
  labelPrefix?: string;
}): Promise<string | null> {
  const routed = await routeNewMediaUploadAuto(params);
  return routed ? routed.url : null;
}

