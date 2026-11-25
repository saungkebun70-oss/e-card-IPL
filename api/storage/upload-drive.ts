// Vercel Serverless Function: POST /api/storage/upload-drive
// Self-contained (tanpa relative import lintas folder agar kompatibel dengan Node ESM di Vercel).
import crypto from 'crypto';

const HYBRID_ROOT_FOLDER_NAME = 'eCard-Saung-Kebun-Hybrid';
const DEFAULT_TARGET_DRIVE_EMAIL = 'saungkebun70@gmail.com';
const MAX_DRIVE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const HYBRID_SUBFOLDER_MAP: Record<string, string> = {
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

function sanitizeUploadFileName(rawName: string): string {
  const parts = String(rawName || '').split(/[\\/]/);
  const last = parts[parts.length - 1] || '';
  const base = last.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return (base || `media-${Date.now()}.jpg`).slice(0, 120);
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
    const subfolderName = HYBRID_SUBFOLDER_MAP[String(body.folderKey || '')];
    if (!subfolderName) {
      res.status(400).json({ ok: false, error: 'Kategori folder tujuan Google Drive tidak valid.' });
      return;
    }

    const cleanMime = String(body.mimeType || '').toLowerCase().trim();
    if (!ALLOWED_MIME_TYPES.has(cleanMime)) {
      res.status(400).json({ ok: false, error: 'Tipe file tidak diizinkan untuk unggahan Drive.' });
      return;
    }

    const cleanBase64 = String(body.fileBase64 || '')
      .replace(/^data:[^;]+;base64,/i, '')
      .trim();
    if (!cleanBase64) {
      res.status(400).json({ ok: false, error: 'Konten file kosong.' });
      return;
    }

    const binaryBuffer = Buffer.from(cleanBase64, 'base64');
    if (binaryBuffer.length === 0 || binaryBuffer.length > MAX_DRIVE_UPLOAD_BYTES) {
      res.status(400).json({ ok: false, error: 'Ukuran file melebihi batas maksimal 5 MB per berkas.' });
      return;
    }

    const about = await driveApiJson<{ user?: { emailAddress?: string } }>(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      bearerToken
    );
    if (about.status === 401 || !about.data) {
      res.status(401).json({
        ok: false,
        error: 'Token OAuth2 Google Drive tidak valid atau telah berakhir.',
      });
      return;
    }
    const driveEmail = about.data.user?.emailAddress || DEFAULT_TARGET_DRIVE_EMAIL;

    const rootId = await ensureFolderOnDrive(bearerToken, HYBRID_ROOT_FOLDER_NAME, null);
    const targetFolderId = await ensureFolderOnDrive(bearerToken, subfolderName, rootId);

    const safeFileName = sanitizeUploadFileName(String(body.fileName || ''));
    const boundary = `ecard_${crypto.randomBytes(12).toString('hex')}`;
    const metadataPart = JSON.stringify({
      name: safeFileName,
      parents: [targetFolderId],
      description:
        typeof body.description === 'string' && body.description
          ? body.description
          : 'Diarahkan otomatis oleh backend monitor penyimpanan e-Card Saung Kebun',
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
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      res.status(uploadRes.status === 401 ? 401 : 502).json({
        ok: false,
        error: `Gagal mengunggah berkas ke Google Drive (${uploadRes.status}): ${errText.slice(0, 140)}`,
      });
      return;
    }

    const uploaded = (await uploadRes.json()) as {
      id: string;
      name: string;
      size?: string;
      webViewLink?: string;
    };

    if (body.makePublicReader !== false && cleanMime !== 'application/json') {
      await driveApiJson(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}/permissions`,
        bearerToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        }
      );
    }

    res.status(200).json({
      ok: true,
      fileId: uploaded.id,
      directImageUrl: `https://lh3.googleusercontent.com/d/${encodeURIComponent(uploaded.id)}=w1600`,
      webViewLink:
        uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
      sizeBytes: Number(uploaded.size || binaryBuffer.length),
      driveEmail,
      folderName: `${HYBRID_ROOT_FOLDER_NAME}/${subfolderName}`,
    });
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
