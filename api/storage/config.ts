import {
  inspectSupabaseStorageStatus,
  saveHybridThresholdSettings,
} from '../../src/server/storageHybridBackend';

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
    const saved = await saveHybridThresholdSettings(
      {
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
      },
      { role: roleHeader, permission: permHeader || 'full' }
    );
    const monitor = await inspectSupabaseStorageStatus('admin');
    res.status(200).json({ ok: true, ...saved, monitor });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui aturan penyimpanan.',
    });
  }
}
