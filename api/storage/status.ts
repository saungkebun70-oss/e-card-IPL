import { inspectSupabaseStorageStatus } from '../../src/server/storageHybridBackend';

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

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
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
    const status = await inspectSupabaseStorageStatus(roleHeader);
    if (roleHeader !== 'admin') {
      res.status(200).json({
        ok: true,
        status: status.status,
        shouldRouteNewMediaToDrive: status.shouldRouteNewMediaToDrive,
        storageUsagePercent: status.storageUsagePercent,
        dbUsagePercent: status.dbUsagePercent,
        thresholdPercent: status.settings.thresholdPercent,
        measuredAt: status.measuredAt,
      });
      return;
    }
    res.status(200).json(status);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal memantau status penyimpanan Supabase.',
    });
  }
}
