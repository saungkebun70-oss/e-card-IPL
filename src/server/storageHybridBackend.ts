import crypto from 'crypto';

export const HYBRID_ROOT_FOLDER_NAME = 'eCard-Saung-Kebun-Hybrid';
export const DEFAULT_TARGET_DRIVE_EMAIL = 'saungkebun70@gmail.com';
export const DEFAULT_SUPABASE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB Free Tier
export const DEFAULT_SUPABASE_DB_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB Free Tier
export const DEFAULT_THRESHOLD_PERCENT = 80;
export const MAX_DRIVE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

export type HybridBackendFolderKey =
  | 'bukti_ipl'
  | 'pengeluaran_kas'
  | 'absensi_keamanan'
  | 'bug_reports'
  | 'avatars'
  | 'backup_database';

export const HYBRID_SUBFOLDER_MAP: Record<HybridBackendFolderKey, string> = {
  bukti_ipl: 'bukti-ipl',
  pengeluaran_kas: 'pengeluaran-kas',
  absensi_keamanan: 'absensi-keamanan',
  bug_reports: 'bug-reports',
  avatars: 'avatars',
  backup_database: 'backup-database',
};

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/json',
]);

export interface HybridThresholdSettings {
  targetEmail: string;
  thresholdPercent: number;
  storageLimitBytes: number;
  dbLimitBytes: number;
  autoRouteOnNearLimit: boolean;
  forceRouteToDrive: boolean;
}

export interface SupabaseBucketUsage {
  bucket: string;
  fileCount: number;
  usedBytes: number;
}

export interface SupabaseStorageMonitorStatus {
  ok: boolean;
  configured: boolean;
  measuredVia: 'rpc_exact' | 'storage_api_scan' | 'table_estimate' | 'unconfigured';
  status: 'normal' | 'warning' | 'near_limit';
  shouldRouteNewMediaToDrive: boolean;
  routeReason: string;
  storageUsedBytes: number;
  storageLimitBytes: number;
  storageUsagePercent: number;
  dbUsedBytes: number;
  dbLimitBytes: number;
  dbUsagePercent: number;
  totalObjects: number;
  buckets: SupabaseBucketUsage[];
  settings: HybridThresholdSettings;
  measuredAt: string;
}

let memoryHybridSettings: HybridThresholdSettings = {
  targetEmail: DEFAULT_TARGET_DRIVE_EMAIL,
  thresholdPercent: DEFAULT_THRESHOLD_PERCENT,
  storageLimitBytes: DEFAULT_SUPABASE_STORAGE_LIMIT_BYTES,
  dbLimitBytes: DEFAULT_SUPABASE_DB_LIMIT_BYTES,
  autoRouteOnNearLimit: true,
  forceRouteToDrive: false,
};

function getSupabaseEnv(): { url: string; apiKey: string; isServiceRole: boolean } | null {
  const rawUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || '').trim();

  if (!rawUrl || (!serviceKey && !anonKey)) return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return {
      url: rawUrl.replace(/\/+$/, ''),
      apiKey: serviceKey || anonKey,
      isServiceRole: Boolean(serviceKey),
    };
  } catch {
    return null;
  }
}

function buildSupabaseHeaders(
  apiKey: string,
  portalRole: string,
  extra?: Record<string, string>
): Record<string, string> {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'x-user-role': portalRole || 'admin',
    'Content-Type': 'application/json',
    ...(extra || {}),
  };
}

function sanitizeThresholdSettings(
  raw?: Partial<HybridThresholdSettings> | null
): HybridThresholdSettings {
  const threshold = Number(raw?.thresholdPercent);
  const storageLimit = Number(raw?.storageLimitBytes);
  const dbLimit = Number(raw?.dbLimitBytes);

  return {
    targetEmail: DEFAULT_TARGET_DRIVE_EMAIL,
    thresholdPercent:
      Number.isFinite(threshold) && threshold >= 50 && threshold <= 95
        ? Math.round(threshold)
        : memoryHybridSettings.thresholdPercent,
    storageLimitBytes:
      Number.isFinite(storageLimit) && storageLimit >= 50 * 1024 * 1024
        ? Math.round(storageLimit)
        : memoryHybridSettings.storageLimitBytes,
    dbLimitBytes:
      Number.isFinite(dbLimit) && dbLimit >= 50 * 1024 * 1024
        ? Math.round(dbLimit)
        : memoryHybridSettings.dbLimitBytes,
    autoRouteOnNearLimit:
      typeof raw?.autoRouteOnNearLimit === 'boolean'
        ? raw.autoRouteOnNearLimit
        : memoryHybridSettings.autoRouteOnNearLimit,
    forceRouteToDrive:
      typeof raw?.forceRouteToDrive === 'boolean'
        ? raw.forceRouteToDrive
        : memoryHybridSettings.forceRouteToDrive,
  };
}

async function loadHybridSettingsFromSupabase(
  env: { url: string; apiKey: string },
  portalRole: string
): Promise<HybridThresholdSettings> {
  try {
    const res = await fetch(
      `${env.url}/rest/v1/app_settings?id=eq.default-app-brand&select=hybrid_drive_config&limit=1`,
      {
        method: 'GET',
        headers: buildSupabaseHeaders(env.apiKey, portalRole),
      }
    );
    if (!res.ok) {
      return memoryHybridSettings;
    }
    const rows = (await res.json()) as Array<{
      hybrid_drive_config?: Partial<HybridThresholdSettings> | null;
    }>;
    const cfg = rows?.[0]?.hybrid_drive_config;
    if (cfg && typeof cfg === 'object') {
      memoryHybridSettings = sanitizeThresholdSettings(cfg);
    }
  } catch {
    // Gunakan cache memori bila kolom belum dimigrasi
  }
  return memoryHybridSettings;
}

export async function saveHybridThresholdSettings(
  patch: Partial<HybridThresholdSettings>,
  portalHeaders?: { role?: string; permission?: string }
): Promise<{ settings: HybridThresholdSettings; persistedToDb: boolean }> {
  const next = sanitizeThresholdSettings({ ...memoryHybridSettings, ...patch });
  memoryHybridSettings = next;

  const env = getSupabaseEnv();
  if (!env) {
    return { settings: next, persistedToDb: false };
  }

  try {
    const res = await fetch(`${env.url}/rest/v1/app_settings?id=eq.default-app-brand`, {
      method: 'PATCH',
      headers: {
        ...buildSupabaseHeaders(env.apiKey, portalHeaders?.role || 'admin'),
        'x-admin-permission': portalHeaders?.permission || 'full',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ hybrid_drive_config: next }),
    });
    return { settings: next, persistedToDb: res.ok };
  } catch {
    return { settings: next, persistedToDb: false };
  }
}

async function listBucketRecursiveUsage(
  env: { url: string; apiKey: string },
  bucket: string,
  portalRole: string,
  prefix = '',
  depth = 0
): Promise<SupabaseBucketUsage> {
  if (depth > 3) return { bucket, fileCount: 0, usedBytes: 0 };

  let fileCount = 0;
  let usedBytes = 0;

  try {
    const res = await fetch(`${env.url}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: buildSupabaseHeaders(env.apiKey, portalRole),
      body: JSON.stringify({
        prefix,
        limit: 1000,
        offset: 0,
        sortBy: { column: 'name', order: 'asc' },
      }),
    });

    if (!res.ok) {
      return { bucket, fileCount: 0, usedBytes: 0 };
    }

    const items = (await res.json()) as Array<{
      id?: string | null;
      name?: string;
      metadata?: { size?: number } | null;
    }>;

    if (!Array.isArray(items)) return { bucket, fileCount: 0, usedBytes: 0 };

    for (const item of items) {
      if (!item?.name) continue;
      if (item.id === null) {
        const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
        const sub = await listBucketRecursiveUsage(env, bucket, portalRole, subPrefix, depth + 1);
        fileCount += sub.fileCount;
        usedBytes += sub.usedBytes;
      } else {
        fileCount += 1;
        usedBytes += Number(item.metadata?.size || 0);
      }
    }
  } catch {
    // Kembalikan nol jika bucket tidak ada
  }

  return { bucket, fileCount, usedBytes };
}

async function estimateMediaCountFromTables(
  env: { url: string; apiKey: string },
  portalRole: string
): Promise<{ fileCount: number; estimatedBytes: number }> {
  const queries = [
    `${env.url}/rest/v1/transaksi_ipl?bukti_url=ilike.*supabase.co/storage*&select=id`,
    `${env.url}/rest/v1/transaksi_kas?bukti_url=ilike.*supabase.co/storage*&select=id`,
    `${env.url}/rest/v1/security_attendance?clock_in_photo_url=ilike.*supabase.co/storage*&select=id`,
    `${env.url}/rest/v1/bug_reports?screenshot_url=ilike.*supabase.co/storage*&select=id`,
  ];

  let count = 0;
  await Promise.all(
    queries.map(async (q) => {
      try {
        const res = await fetch(q, {
          method: 'HEAD',
          headers: {
            ...buildSupabaseHeaders(env.apiKey, portalRole),
            Prefer: 'count=exact',
          },
        });
        const range = res.headers.get('content-range');
        if (range && range.includes('/')) {
          const total = Number(range.split('/')[1]);
          if (Number.isFinite(total)) count += total;
        }
      } catch {
        // Abaikan error per tabel
      }
    })
  );

  return { fileCount: count, estimatedBytes: count * 135 * 1024 };
}

export async function inspectSupabaseStorageStatus(
  portalRole = 'admin'
): Promise<SupabaseStorageMonitorStatus> {
  const nowIso = new Date().toISOString();
  const env = getSupabaseEnv();

  if (!env) {
    return {
      ok: true,
      configured: false,
      measuredVia: 'unconfigured',
      status: memoryHybridSettings.forceRouteToDrive ? 'near_limit' : 'normal',
      shouldRouteNewMediaToDrive: memoryHybridSettings.forceRouteToDrive,
      routeReason: memoryHybridSettings.forceRouteToDrive
        ? 'Pengalihan manual ke Google Drive aktif.'
        : 'Supabase belum dikonfigurasi di server.',
      storageUsedBytes: 0,
      storageLimitBytes: memoryHybridSettings.storageLimitBytes,
      storageUsagePercent: 0,
      dbUsedBytes: 0,
      dbLimitBytes: memoryHybridSettings.dbLimitBytes,
      dbUsagePercent: 0,
      totalObjects: 0,
      buckets: [],
      settings: memoryHybridSettings,
      measuredAt: nowIso,
    };
  }

  const settings = await loadHybridSettingsFromSupabase(env, portalRole);

  let measuredVia: SupabaseStorageMonitorStatus['measuredVia'] = 'table_estimate';
  let storageUsedBytes = 0;
  let dbUsedBytes = 0;
  let totalObjects = 0;
  let buckets: SupabaseBucketUsage[] = [];

  // 1. Prioritas utama: panggil RPC SQL exact `get_supabase_storage_status`
  let rpcSucceeded = false;
  try {
    const rpcRes = await fetch(`${env.url}/rest/v1/rpc/get_supabase_storage_status`, {
      method: 'POST',
      headers: buildSupabaseHeaders(env.apiKey, portalRole),
      body: JSON.stringify({}),
    });

    if (rpcRes.ok) {
      const rpcData = (await rpcRes.json()) as {
        total_objects?: number;
        storage_used_bytes?: number;
        db_used_bytes?: number;
        buckets?: Array<{ bucket?: string; fileCount?: number; usedBytes?: number }>;
      };
      if (rpcData && typeof rpcData === 'object') {
        rpcSucceeded = true;
        measuredVia = 'rpc_exact';
        totalObjects = Number(rpcData.total_objects || 0);
        storageUsedBytes = Number(rpcData.storage_used_bytes || 0);
        dbUsedBytes = Number(rpcData.db_used_bytes || 0);
        buckets = Array.isArray(rpcData.buckets)
          ? rpcData.buckets.map((b) => ({
              bucket: String(b.bucket || 'lainnya'),
              fileCount: Number(b.fileCount || 0),
              usedBytes: Number(b.usedBytes || 0),
            }))
          : [];
      }
    }
  } catch {
    rpcSucceeded = false;
  }

  // 2. Fallback: scan Storage API per bucket bila RPC v15 belum dipasang
  if (!rpcSucceeded) {
    const bucketNames = ['bukti-ipl', 'bug-reports', 'avatars'];
    const bucketResults = await Promise.all(
      bucketNames.map((name) => listBucketRecursiveUsage(env, name, portalRole))
    );
    const apiTotalFiles = bucketResults.reduce((sum, b) => sum + b.fileCount, 0);
    const apiTotalBytes = bucketResults.reduce((sum, b) => sum + b.usedBytes, 0);

    if (apiTotalFiles > 0) {
      measuredVia = 'storage_api_scan';
      buckets = bucketResults;
      totalObjects = apiTotalFiles;
      storageUsedBytes = apiTotalBytes;
    } else {
      // 3. Fallback estimasi dari tabel media aktif
      const est = await estimateMediaCountFromTables(env, portalRole);
      measuredVia = 'table_estimate';
      totalObjects = est.fileCount;
      storageUsedBytes = est.estimatedBytes;
      buckets = [{ bucket: 'bukti-ipl', fileCount: est.fileCount, usedBytes: est.estimatedBytes }];
    }
  }

  const storageUsagePercent =
    settings.storageLimitBytes > 0
      ? Number(((storageUsedBytes / settings.storageLimitBytes) * 100).toFixed(2))
      : 0;
  const dbUsagePercent =
    settings.dbLimitBytes > 0
      ? Number(((dbUsedBytes / settings.dbLimitBytes) * 100).toFixed(2))
      : 0;

  const isNearLimit =
    storageUsagePercent >= settings.thresholdPercent || dbUsagePercent >= settings.thresholdPercent;
  const isWarning =
    !isNearLimit &&
    (storageUsagePercent >= Math.max(50, settings.thresholdPercent - 15) ||
      dbUsagePercent >= Math.max(50, settings.thresholdPercent - 15));

  const status: SupabaseStorageMonitorStatus['status'] = isNearLimit
    ? 'near_limit'
    : isWarning
      ? 'warning'
      : 'normal';

  const shouldRouteNewMediaToDrive =
    settings.forceRouteToDrive || (settings.autoRouteOnNearLimit && isNearLimit);

  let routeReason = 'Penyimpanan Supabase dalam kondisi aman; media baru disimpan di Supabase.';
  if (settings.forceRouteToDrive) {
    routeReason =
      'Pengalihan langsung aktif: media baru diarahkan ke Google Drive OAuth2.';
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
    storageLimitBytes: settings.storageLimitBytes,
    storageUsagePercent,
    dbUsedBytes,
    dbLimitBytes: settings.dbLimitBytes,
    dbUsagePercent,
    totalObjects,
    buckets,
    settings,
    measuredAt: nowIso,
  };
}

function sanitizeUploadFileName(rawName: string): string {
  const base = pathSafeBasename(rawName).replace(/[^a-zA-Z0-9._-]+/g, '-');
  return (base || `media-${Date.now()}.jpg`).slice(0, 120);
}

function pathSafeBasename(input: string): string {
  const parts = String(input || '').split(/[\\/]/);
  return parts[parts.length - 1] || '';
}

async function driveApiJson<T>(
  url: string,
  accessToken: string,
  init?: RequestInit
): Promise<{ status: number; data: T | null; errorText?: string }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    return { status: res.status, data: null, errorText };
  }
  if (res.status === 204) {
    return { status: 204, data: null };
  }
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

async function ensureFolderOnDrive(
  accessToken: string,
  folderName: string,
  parentId?: string | null
): Promise<string> {
  const safeName = folderName.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : ` and 'root' in parents`;
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentClause}`;
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name)',
    pageSize: '5',
    spaces: 'drive',
  });

  const existing = await driveApiJson<{ files?: Array<{ id: string }> }>(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    accessToken
  );
  if (existing.status === 401) {
    throw Object.assign(new Error('Token OAuth2 Google Drive tidak valid atau kedaluwarsa.'), {
      statusCode: 401,
    });
  }
  if (existing.data?.files?.[0]?.id) {
    return existing.data.files[0].id;
  }

  const body: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) body.parents = [parentId];

  const created = await driveApiJson<{ id: string }>(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!created.data?.id) {
    throw new Error(`Gagal membuat folder Drive "${folderName}": ${created.errorText || ''}`);
  }
  return created.data.id;
}

export async function uploadMediaViaConnectedDriveOAuth(params: {
  bearerToken: string;
  folderKey: string;
  fileName: string;
  mimeType: string;
  fileBase64: string;
  description?: string;
  makePublicReader?: boolean;
}): Promise<{
  ok: true;
  fileId: string;
  directImageUrl: string;
  webViewLink: string;
  sizeBytes: number;
  driveEmail: string;
  folderName: string;
}> {
  const token = params.bearerToken.trim();
  if (!token) {
    throw Object.assign(new Error('Token Bearer Google OAuth2 wajib disertakan.'), {
      statusCode: 401,
    });
  }

  const folderKey = params.folderKey as HybridBackendFolderKey;
  const subfolderName = HYBRID_SUBFOLDER_MAP[folderKey];
  if (!subfolderName) {
    throw Object.assign(new Error('Kategori folder tujuan Google Drive tidak valid.'), {
      statusCode: 400,
    });
  }

  const cleanMime = String(params.mimeType || '').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.has(cleanMime)) {
    throw Object.assign(new Error('Tipe file tidak diizinkan untuk unggahan Drive.'), {
      statusCode: 400,
    });
  }

  const cleanBase64 = String(params.fileBase64 || '').replace(/^data:[^;]+;base64,/i, '').trim();
  if (!cleanBase64) {
    throw Object.assign(new Error('Konten file kosong.'), { statusCode: 400 });
  }

  const binaryBuffer = Buffer.from(cleanBase64, 'base64');
  if (binaryBuffer.length === 0 || binaryBuffer.length > MAX_DRIVE_UPLOAD_BYTES) {
    throw Object.assign(
      new Error('Ukuran file melebihi batas maksimal 5 MB per berkas.'),
      { statusCode: 400 }
    );
  }

  // 1. Validasi token OAuth2 di Google Drive API
  const about = await driveApiJson<{ user?: { emailAddress?: string } }>(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    token
  );
  if (about.status === 401 || !about.data) {
    throw Object.assign(new Error('Token OAuth2 Google Drive tidak valid atau telah berakhir.'), {
      statusCode: 401,
    });
  }
  const driveEmail = about.data.user?.emailAddress || DEFAULT_TARGET_DRIVE_EMAIL;

  // 2. Pastikan folder eCard-Saung-Kebun-Hybrid/<subfolder> ada
  const rootId = await ensureFolderOnDrive(token, HYBRID_ROOT_FOLDER_NAME, null);
  const targetFolderId = await ensureFolderOnDrive(token, subfolderName, rootId);

  // 3. Multipart upload sesuai RFC 2387 ke Google Drive v3
  const safeFileName = sanitizeUploadFileName(params.fileName);
  const boundary = `ecard_${crypto.randomBytes(12).toString('hex')}`;
  const metadataPart = JSON.stringify({
    name: safeFileName,
    parents: [targetFolderId],
    description:
      params.description ||
      'Diarahkan otomatis oleh backend monitor penyimpanan e-Card Saung Kebun',
  });

  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n--${boundary}\r\nContent-Type: ${cleanMime}\r\n\r\n`,
    'utf-8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf-8');
  const multipartBody = Buffer.concat([head, binaryBuffer, tail]);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    throw Object.assign(
      new Error(`Gagal mengunggah berkas ke Google Drive (${uploadRes.status}): ${errText.slice(0, 140)}`),
      { statusCode: uploadRes.status === 401 ? 401 : 502 }
    );
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    name: string;
    size?: string;
    webViewLink?: string;
  };

  if (params.makePublicReader !== false && cleanMime !== 'application/json') {
    await driveApiJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}/permissions`,
      token,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    );
  }

  return {
    ok: true,
    fileId: uploaded.id,
    directImageUrl: `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w1600`,
    webViewLink:
      uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    sizeBytes: Number(uploaded.size || binaryBuffer.length),
    driveEmail,
    folderName: `${HYBRID_ROOT_FOLDER_NAME}/${subfolderName}`,
  };
}
