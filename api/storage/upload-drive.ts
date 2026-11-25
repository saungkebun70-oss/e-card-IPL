import { uploadMediaViaConnectedDriveOAuth } from '../../src/server/storageHybridBackend';

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
  if (!['admin', 'warga', 'petugas', 'keamanan'].includes(roleHeader)) {
    res.status(401).json({ error: 'Akses unggah media memerlukan sesi portal aktif.' });
    return;
  }

  const authHeader = getHeader(req.headers, 'authorization').trim();
  const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  if (!bearerToken) {
    res.status(401).json({ error: 'Header Authorization Bearer OAuth2 Google wajib disertakan.' });
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
    const result = await uploadMediaViaConnectedDriveOAuth({
      bearerToken,
      folderKey: String(body.folderKey || ''),
      fileName: String(body.fileName || ''),
      mimeType: String(body.mimeType || ''),
      fileBase64: String(body.fileBase64 || ''),
      description: typeof body.description === 'string' ? body.description : undefined,
      makePublicReader: body.makePublicReader !== false,
    });
    res.status(200).json(result);
  } catch (err) {
    const statusCode =
      typeof (err as { statusCode?: number })?.statusCode === 'number'
        ? (err as { statusCode: number }).statusCode
        : 500;
    res.status(statusCode).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Gagal mengunggah ke Google Drive.',
    });
  }
}
