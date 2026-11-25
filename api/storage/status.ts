// Vercel Serverless Function: GET /api/storage/status
// Self-contained (tanpa relative import lintas folder agar kompatibel dengan Node ESM di Vercel).

const DEFAULT_TARGET_DRIVE_EMAIL = 'saungkebun70@gmail.com';
const DEFAULT_SUPABASE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB
const DEFAULT_SUPABASE_DB_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB
const DEFAULT_THRESHOLD_PERCENT = 80;

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

interface HybridThresholdSettings {
  targetEmail: string;
  thresholdPercent: number;
  storageLimitBytes: number;
  dbLimitBytes: number;
  autoRouteOnNearLimit: boolean;
  forceRouteToDrive: boolean;
}

interface SupabaseBucketUsage {
  bucket: string;
  fileCount: number;
  usedBytes: number;
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
}

function getSupabaseEnv(): { url: string; apiKey: string } | null {
  const rawUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const anonKey = (
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();

  if (!rawUrl || (!serviceKey && !anonKey)) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return {
      url: rawUrl.replace(/\/+$/, ''),
      apiKey: serviceKey || anonKey,
    };
  } catch {
    return null;
  }
}

function buildSupabaseHeaders(apiKey: string, portalRole: string): Record<string, string> {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'x-user-role': portalRole || 'admin',
    'Content-Type': 'application/json',
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
        : DEFAULT_THRESHOLD_PERCENT,
    storageLimitBytes:
      Number.isFinite(storageLimit) && storageLimit >= 50 * 1024 * 1024
        ? Math.round(storageLimit)
        : DEFAULT_SUPABASE_STORAGE_LIMIT_BYTES,
    dbLimitBytes:
      Number.isFinite(dbLimit) && dbLimit >= 50 * 1024 * 1024
        ? Math.round(dbLimit)
        : DEFAULT_SUPABASE_DB_LIMIT_BYTES,
    autoRouteOnNearLimit:
      typeof raw?.autoRouteOnNearLimit === 'boolean' ? raw.autoRouteOnNearLimit : true,
    forceRouteToDrive:
      typeof raw?.forceRouteToDrive === 'boolean' ? raw.forceRouteToDrive : false,
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
    if (res.ok) {
      const rows = (await res.json()) as Array<{
        hybrid_drive_config?: Partial<HybridThresholdSettings> | null;
      }>;
      const cfg = rows?.[0]?.hybrid_drive_config;
      if (cfg && typeof cfg === 'object') {
        return sanitizeThresholdSettings(cfg);
      }
    }
  } catch {
    // Abaikan jika kolom belum dimigrasi
  }
  return sanitizeThresholdSettings(null);
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
    if (!res.ok) return { bucket, fileCount: 0, usedBytes: 0 };
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
    // Abaikan jika bucket belum ada
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

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method tidak diizinkan. Gunakan GET.' });
    return;
  }

  const roleHeader = getHeader(req.headers, 'x-user-role').trim().toLowerCase();
  if (!['admin', 'warga', 'petugas', 'keamanan'].includes(roleHeader)) {
    res.status(401).json({ error: 'Akses monitor penyimpanan hanya untuk pengguna portal aktif.' });
    return;
  }

  try {
    const nowIso = new Date().toISOString();
    const env = getSupabaseEnv();

    if (!env) {
      const defaults = sanitizeThresholdSettings(null);
      res.status(200).json({
        ok: true,
        configured: false,
        measuredVia: 'unconfigured',
        status: 'normal',
        shouldRouteNewMediaToDrive: false,
        routeReason: 'Variabel Supabase server belum dikonfigurasi.',
        storageUsedBytes: 0,
        storageLimitBytes: defaults.storageLimitBytes,
        storageUsagePercent: 0,
        dbUsedBytes: 0,
        dbLimitBytes: defaults.dbLimitBytes,
        dbUsagePercent: 0,
        totalObjects: 0,
        buckets: [],
        settings: defaults,
        measuredAt: nowIso,
      });
      return;
    }

    const settings = await loadHybridSettingsFromSupabase(env, roleHeader);
    let measuredVia: 'rpc_exact' | 'storage_api_scan' | 'table_estimate' = 'table_estimate';
    let storageUsedBytes = 0;
    let dbUsedBytes = 0;
    let totalObjects = 0;
    let buckets: SupabaseBucketUsage[] = [];

    let rpcSucceeded = false;
    try {
      const rpcRes = await fetch(`${env.url}/rest/v1/rpc/get_supabase_storage_status`, {
        method: 'POST',
        headers: buildSupabaseHeaders(env.apiKey, roleHeader),
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

    if (!rpcSucceeded) {
      const bucketResults = await Promise.all(
        ['bukti-ipl', 'bug-reports', 'avatars'].map((b) =>
          listBucketRecursiveUsage(env, b, roleHeader)
        )
      );
      const apiFiles = bucketResults.reduce((s, b) => s + b.fileCount, 0);
      const apiBytes = bucketResults.reduce((s, b) => s + b.usedBytes, 0);
      if (apiFiles > 0) {
        measuredVia = 'storage_api_scan';
        buckets = bucketResults;
        totalObjects = apiFiles;
        storageUsedBytes = apiBytes;
      } else {
        const est = await estimateMediaCountFromTables(env, roleHeader);
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
      storageUsagePercent >= settings.thresholdPercent ||
      dbUsagePercent >= settings.thresholdPercent;
    const isWarning =
      !isNearLimit &&
      (storageUsagePercent >= Math.max(50, settings.thresholdPercent - 15) ||
        dbUsagePercent >= Math.max(50, settings.thresholdPercent - 15));

    const status = isNearLimit ? 'near_limit' : isWarning ? 'warning' : 'normal';
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

    if (roleHeader !== 'admin') {
      res.status(200).json({
        ok: true,
        status,
        shouldRouteNewMediaToDrive,
        storageUsagePercent,
        dbUsagePercent,
        thresholdPercent: settings.thresholdPercent,
        measuredAt: nowIso,
      });
      return;
    }

    res.status(200).json({
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
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal memantau status penyimpanan Supabase.',
    });
  }
}
