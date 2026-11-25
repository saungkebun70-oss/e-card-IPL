// Vercel Serverless Function: POST /api/storage/config
// Self-contained (tanpa relative import lintas folder agar kompatibel dengan Node ESM di Vercel).

const DEFAULT_TARGET_DRIVE_EMAIL = 'saungkebun70@gmail.com';
const DEFAULT_SUPABASE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB
const DEFAULT_SUPABASE_DB_LIMIT_BYTES = 500 * 1024 * 1024; // 500 MB
const DEFAULT_THRESHOLD_PERCENT = 80;

interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
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

function sanitizeThresholdSettings(
  base: HybridThresholdSettings,
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
        : base.thresholdPercent,
    storageLimitBytes:
      Number.isFinite(storageLimit) && storageLimit >= 50 * 1024 * 1024
        ? Math.round(storageLimit)
        : base.storageLimitBytes,
    dbLimitBytes:
      Number.isFinite(dbLimit) && dbLimit >= 50 * 1024 * 1024
        ? Math.round(dbLimit)
        : base.dbLimitBytes,
    autoRouteOnNearLimit:
      typeof raw?.autoRouteOnNearLimit === 'boolean'
        ? raw.autoRouteOnNearLimit
        : base.autoRouteOnNearLimit,
    forceRouteToDrive:
      typeof raw?.forceRouteToDrive === 'boolean'
        ? raw.forceRouteToDrive
        : base.forceRouteToDrive,
  };
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method tidak diizinkan. Gunakan POST.' });
    return;
  }

  const roleHeader = getHeader(req.headers, 'x-user-role').trim().toLowerCase();
  const permHeader = getHeader(req.headers, 'x-admin-permission').trim().toLowerCase();
  const jabatanHeader = getHeader(req.headers, 'x-admin-jabatan').trim().toLowerCase();
  if (roleHeader !== 'admin' || (permHeader !== 'full' && jabatanHeader !== 'ketua')) {
    res.status(403).json({
      error: 'Pengaturan ambang batas penyimpanan khusus akun Bendahara atau Ketua.',
    });
    return;
  }

  let body: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'Body JSON tidak valid.' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as Record<string, unknown>;
  }

  try {
    const env = getSupabaseEnv();
    let currentSettings: HybridThresholdSettings = {
      targetEmail: DEFAULT_TARGET_DRIVE_EMAIL,
      thresholdPercent: DEFAULT_THRESHOLD_PERCENT,
      storageLimitBytes: DEFAULT_SUPABASE_STORAGE_LIMIT_BYTES,
      dbLimitBytes: DEFAULT_SUPABASE_DB_LIMIT_BYTES,
      autoRouteOnNearLimit: true,
      forceRouteToDrive: false,
    };

    if (env) {
      try {
        const readRes = await fetch(
          `${env.url}/rest/v1/app_settings?id=eq.default-app-brand&select=hybrid_drive_config&limit=1`,
          {
            method: 'GET',
            headers: {
              apikey: env.apiKey,
              Authorization: `Bearer ${env.apiKey}`,
              'x-user-role': 'admin',
            },
          }
        );
        if (readRes.ok) {
          const rows = (await readRes.json()) as Array<{
            hybrid_drive_config?: Partial<HybridThresholdSettings> | null;
          }>;
          if (rows?.[0]?.hybrid_drive_config) {
            currentSettings = sanitizeThresholdSettings(
              currentSettings,
              rows[0].hybrid_drive_config
            );
          }
        }
      } catch {
        // Abaikan jika kolom belum tersedia
      }
    }

    const nextSettings = sanitizeThresholdSettings(currentSettings, {
      thresholdPercent:
        typeof body.thresholdPercent === 'number' ? body.thresholdPercent : undefined,
      storageLimitBytes:
        typeof body.storageLimitMb === 'number' && Number.isFinite(body.storageLimitMb)
          ? Math.round(body.storageLimitMb * 1024 * 1024)
          : undefined,
      autoRouteOnNearLimit:
        typeof body.autoRouteOnNearLimit === 'boolean' ? body.autoRouteOnNearLimit : undefined,
      forceRouteToDrive:
        typeof body.forceRouteToDrive === 'boolean' ? body.forceRouteToDrive : undefined,
    });

    let persistedToDb = false;
    let dbWarning: string | undefined;

    if (env) {
      try {
        const patchRes = await fetch(`${env.url}/rest/v1/app_settings?id=eq.default-app-brand`, {
          method: 'PATCH',
          headers: {
            apikey: env.apiKey,
            Authorization: `Bearer ${env.apiKey}`,
            'x-user-role': 'admin',
            'x-admin-permission': 'full',
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ hybrid_drive_config: nextSettings }),
        });
        persistedToDb = patchRes.ok;
        if (!patchRes.ok) {
          dbWarning = await patchRes.text().catch(() => `HTTP ${patchRes.status}`);
        }
      } catch (err) {
        dbWarning = err instanceof Error ? err.message : 'Gagal PATCH app_settings';
      }
    }

    // Hitung status penyimpanan terbaru untuk dikembalikan ke UI
    let storageUsedBytes = 0;
    let dbUsedBytes = 0;
    let totalObjects = 0;
    let buckets: Array<{ bucket: string; fileCount: number; usedBytes: number }> = [];
    let measuredVia: 'rpc_exact' | 'table_estimate' | 'unconfigured' = env
      ? 'table_estimate'
      : 'unconfigured';

    if (env) {
      try {
        const rpcRes = await fetch(`${env.url}/rest/v1/rpc/get_supabase_storage_status`, {
          method: 'POST',
          headers: {
            apikey: env.apiKey,
            Authorization: `Bearer ${env.apiKey}`,
            'x-user-role': 'admin',
            'Content-Type': 'application/json',
          },
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
        // Fallback jika RPC v15 belum terpasang
      }
    }

    const storageUsagePercent =
      nextSettings.storageLimitBytes > 0
        ? Number(((storageUsedBytes / nextSettings.storageLimitBytes) * 100).toFixed(2))
        : 0;
    const dbUsagePercent =
      nextSettings.dbLimitBytes > 0
        ? Number(((dbUsedBytes / nextSettings.dbLimitBytes) * 100).toFixed(2))
        : 0;
    const isNearLimit =
      storageUsagePercent >= nextSettings.thresholdPercent ||
      dbUsagePercent >= nextSettings.thresholdPercent;
    const shouldRouteNewMediaToDrive =
      nextSettings.forceRouteToDrive || (nextSettings.autoRouteOnNearLimit && isNearLimit);

    let routeReason = 'Penyimpanan Supabase dalam kondisi aman; media baru disimpan di Supabase.';
    if (nextSettings.forceRouteToDrive) {
      routeReason = 'Pengalihan langsung aktif: media baru diarahkan ke Google Drive OAuth2.';
    } else if (shouldRouteNewMediaToDrive) {
      routeReason = `Pemakaian Supabase mencapai batas (${Math.max(
        storageUsagePercent,
        dbUsagePercent
      ).toFixed(1)}% >= ${nextSettings.thresholdPercent}%): media baru dialihkan otomatis ke Google Drive.`;
    }

    res.status(200).json({
      ok: true,
      settings: nextSettings,
      persistedToDb,
      dbWarning,
      monitor: {
        ok: true,
        configured: Boolean(env),
        measuredVia,
        status: isNearLimit ? 'near_limit' : 'normal',
        shouldRouteNewMediaToDrive,
        routeReason,
        storageUsedBytes,
        storageLimitBytes: nextSettings.storageLimitBytes,
        storageUsagePercent,
        dbUsedBytes,
        dbLimitBytes: nextSettings.dbLimitBytes,
        dbUsagePercent,
        totalObjects,
        buckets,
        settings: nextSettings,
        measuredAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui aturan penyimpanan.',
    });
  }
}
