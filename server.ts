import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import sendBotWaHandler from './api/bot-wa/send';
import webhookBotWaHandler from './api/bot-wa/webhook';
import {
  inspectSupabaseStorageStatus,
  saveHybridThresholdSettings,
  uploadMediaViaConnectedDriveOAuth,
} from './src/server/storageHybridBackend';
import {
  completeChatVideoResumableUpload,
  handlePrivateChatDriveAccess,
  initChatVideoResumableUpload,
  transferChatTransitToDrive,
} from './src/server/chatDriveService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const LOG_DIR = path.resolve(__dirname, 'data');
const LOG_FILE = path.join(LOG_DIR, 'audit-logs.jsonl');

interface ServerAuditLog {
  id: string;
  timestamp: string;
  actor_role: 'admin' | 'warga' | 'system';
  actor_id: string;
  actor_name: string;
  action: string;
  entity: string;
  entity_id?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

const MAX_MEMORY_LOGS = 500;
let memoryAuditLogs: ServerAuditLog[] = [];
let writeChain: Promise<void> = Promise.resolve();

function ensureLogStorage() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf-8');
  }
}

function hydrateMemoryLogs() {
  try {
    ensureLogStorage();
    const raw = fs.readFileSync(LOG_FILE, 'utf-8').trim();
    if (!raw) return;
    const lines = raw.split('\n');
    const parsed: ServerAuditLog[] = [];
    for (let i = lines.length - 1; i >= 0 && parsed.length < MAX_MEMORY_LOGS; i--) {
      try {
        parsed.push(JSON.parse(lines[i]) as ServerAuditLog);
      } catch {
        // Lewati baris rusak jika ada
      }
    }
    memoryAuditLogs = parsed;
  } catch (err) {
    console.error('[AUDIT_ERROR] Gagal membaca log awal:', err);
  }
}

function appendAuditLog(entry: ServerAuditLog) {
  // Update ring buffer di memori secara instan agar pembacaan tidak memblokir event loop
  memoryAuditLogs = [entry, ...memoryAuditLogs].slice(0, MAX_MEMORY_LOGS);

  // Antrekan penulisan non-blocking ke disk agar aman pada akses konkuren tinggi
  const line = JSON.stringify(entry) + '\n';
  writeChain = writeChain
    .then(async () => {
      await fs.promises.mkdir(LOG_DIR, { recursive: true });
      await fs.promises.appendFile(LOG_FILE, line, 'utf-8');
    })
    .catch((err) => {
      console.error('[AUDIT_ERROR] Gagal menulis log aktivitas:', err);
    });

  console.log(
    `[AUDIT] ${entry.timestamp} | role=${entry.actor_role} | actor=${entry.actor_id} | action=${entry.action} | entity=${entry.entity} | ${entry.summary}`
  );
}

function readAuditLogs(limit = 150): ServerAuditLog[] {
  return memoryAuditLogs.slice(0, limit);
}

hydrateMemoryLogs();

async function startServer() {
  const app = express();

  app.post(
    '/api/storage/upload-drive',
    express.json({ limit: '8mb' }),
    async (req, res) => {
      const roleHeader = String(req.headers['x-user-role'] || '').trim().toLowerCase();
      if (!['admin', 'warga', 'petugas', 'keamanan'].includes(roleHeader)) {
        res.status(401).json({ error: 'Akses unggah media memerlukan sesi portal aktif.' });
        return;
      }

      const authHeader = String(req.headers.authorization || '').trim();
      const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
        ? authHeader.slice(7).trim()
        : '';
      if (!bearerToken) {
        res.status(401).json({ error: 'Header Authorization Bearer OAuth2 Google wajib disertakan.' });
        return;
      }

      const body = (req.body || {}) as {
        folderKey?: string;
        fileName?: string;
        mimeType?: string;
        fileBase64?: string;
        description?: string;
        makePublicReader?: boolean;
      };

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
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ecard-saung-kebun', time: new Date().toISOString() });
  });

  app.get('/api/storage/status', async (req, res) => {
    const roleHeader = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    if (!['admin', 'warga', 'petugas', 'keamanan'].includes(roleHeader)) {
      res.status(401).json({ error: 'Akses monitor penyimpanan hanya untuk pengguna portal aktif.' });
      return;
    }

    try {
      const status = await inspectSupabaseStorageStatus(roleHeader);
      if (roleHeader !== 'admin') {
        res.json({
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
      res.json(status);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal memantau status penyimpanan Supabase.',
      });
    }
  });

  app.post('/api/storage/config', async (req, res) => {
    const roleHeader = String(req.headers['x-user-role'] || '').trim().toLowerCase();
    const permHeader = String(req.headers['x-admin-permission'] || '').trim().toLowerCase();
    const jabatanHeader = String(req.headers['x-admin-jabatan'] || '').trim().toLowerCase();
    if (roleHeader !== 'admin' || (permHeader !== 'full' && jabatanHeader !== 'ketua')) {
      res.status(403).json({
        error: 'Pengaturan ambang batas penyimpanan khusus akun Bendahara atau Ketua.',
      });
      return;
    }

    const body = (req.body || {}) as {
      thresholdPercent?: number;
      storageLimitMb?: number;
      autoRouteOnNearLimit?: boolean;
      forceRouteToDrive?: boolean;
    };

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
            typeof body.autoRouteOnNearLimit === 'boolean'
              ? body.autoRouteOnNearLimit
              : undefined,
          forceRouteToDrive:
            typeof body.forceRouteToDrive === 'boolean' ? body.forceRouteToDrive : undefined,
        },
        { role: roleHeader, permission: permHeader || 'full' }
      );
      const updatedStatus = await inspectSupabaseStorageStatus('admin');
      res.json({ ok: true, ...saved, monitor: updatedStatus });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal memperbarui aturan ambang batas.',
      });
    }
  });

  app.post('/api/storage/transfer-transit-to-drive', async (req, res) => {
    const body = (req.body || {}) as {
      transitPath?: string;
      roomId?: string;
      messageId?: string;
      fileName?: string;
      mimeType?: string;
      sender?: Record<string, unknown>;
    };
    try {
      const result = await transferChatTransitToDrive({
        callerHeaders: {
          role: String(req.headers['x-user-role'] || ''),
          blokRumah: String(req.headers['x-blok-rumah'] || ''),
          petugasId: String(req.headers['x-petugas-id'] || ''),
          authorization: String(req.headers.authorization || ''),
          adminJabatan: String(req.headers['x-admin-jabatan'] || ''),
          adminPermission: String(req.headers['x-admin-permission'] || ''),
          senderHint: body.sender && typeof body.sender === 'object' ? body.sender : null,
        },
        transitPath: String(body.transitPath || ''),
        roomId: String(body.roomId || ''),
        messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
        fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
        mimeType: typeof body.mimeType === 'string' ? body.mimeType : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      const typedErr = err as {
        statusCode?: number;
        missingFields?: string[];
        invalidFields?: string[];
        fieldReasons?: Record<string, string>;
      };
      const statusCode = typeof typedErr?.statusCode === 'number' ? typedErr.statusCode : 500;
      const missingFields = Array.isArray(typedErr?.missingFields) ? typedErr.missingFields : undefined;
      const invalidFields = Array.isArray(typedErr?.invalidFields) ? typedErr.invalidFields : undefined;
      const fieldReasons =
        typedErr?.fieldReasons && typeof typedErr.fieldReasons === 'object'
          ? typedErr.fieldReasons
          : undefined;
      res.status(statusCode).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal memindahkan lampiran ke Google Drive.',
        ...(missingFields?.length ? { missingFields } : {}),
        ...(invalidFields?.length ? { invalidFields } : {}),
        ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
      });
    }
  });

  app.post('/api/storage/init-video-resumable-upload', async (req, res) => {
    const body = (req.body || {}) as {
      roomId?: string;
      messageId?: string;
      fileName?: string;
      mimeType?: string;
      sizeBytes?: number;
      transitPath?: string;
      sender?: Record<string, unknown>;
    };
    try {
      const result = await initChatVideoResumableUpload({
        callerHeaders: {
          role: String(req.headers['x-user-role'] || ''),
          blokRumah: String(req.headers['x-blok-rumah'] || ''),
          petugasId: String(req.headers['x-petugas-id'] || ''),
          authorization: String(req.headers.authorization || ''),
          adminJabatan: String(req.headers['x-admin-jabatan'] || ''),
          adminPermission: String(req.headers['x-admin-permission'] || ''),
          senderHint: body.sender && typeof body.sender === 'object' ? body.sender : null,
        },
        roomId: String(body.roomId || ''),
        messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
        fileName: String(body.fileName || ''),
        mimeType: String(body.mimeType || 'video/mp4'),
        sizeBytes: Number(body.sizeBytes || 0),
        transitPath: typeof body.transitPath === 'string' ? body.transitPath : undefined,
        originHeader: typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      const typedErr = err as {
        statusCode?: number;
        missingFields?: string[];
        invalidFields?: string[];
        fieldReasons?: Record<string, string>;
      };
      const statusCode = typeof typedErr?.statusCode === 'number' ? typedErr.statusCode : 500;
      const missingFields = Array.isArray(typedErr?.missingFields) ? typedErr.missingFields : undefined;
      const invalidFields = Array.isArray(typedErr?.invalidFields) ? typedErr.invalidFields : undefined;
      const fieldReasons =
        typedErr?.fieldReasons && typeof typedErr.fieldReasons === 'object'
          ? typedErr.fieldReasons
          : undefined;
      res.status(statusCode).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal membuat sesi unggah video Google Drive.',
        ...(missingFields?.length ? { missingFields } : {}),
        ...(invalidFields?.length ? { invalidFields } : {}),
        ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
      });
    }
  });

  app.post('/api/storage/complete-video-resumable-upload', async (req, res) => {
    const body = (req.body || {}) as {
      roomId?: string;
      messageId?: string;
      driveFileId?: string;
      folderPath?: string;
      sender?: Record<string, unknown>;
    };
    try {
      const result = await completeChatVideoResumableUpload({
        callerHeaders: {
          role: String(req.headers['x-user-role'] || ''),
          blokRumah: String(req.headers['x-blok-rumah'] || ''),
          petugasId: String(req.headers['x-petugas-id'] || ''),
          authorization: String(req.headers.authorization || ''),
          adminJabatan: String(req.headers['x-admin-jabatan'] || ''),
          adminPermission: String(req.headers['x-admin-permission'] || ''),
          senderHint: body.sender && typeof body.sender === 'object' ? body.sender : null,
        },
        roomId: String(body.roomId || ''),
        messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
        driveFileId: String(body.driveFileId || ''),
        folderPath: typeof body.folderPath === 'string' ? body.folderPath : undefined,
      });
      res.status(200).json(result);
    } catch (err) {
      const typedErr = err as {
        statusCode?: number;
        missingFields?: string[];
        invalidFields?: string[];
        fieldReasons?: Record<string, string>;
      };
      const statusCode = typeof typedErr?.statusCode === 'number' ? typedErr.statusCode : 500;
      const missingFields = Array.isArray(typedErr?.missingFields) ? typedErr.missingFields : undefined;
      const invalidFields = Array.isArray(typedErr?.invalidFields) ? typedErr.invalidFields : undefined;
      const fieldReasons =
        typedErr?.fieldReasons && typeof typedErr.fieldReasons === 'object'
          ? typedErr.fieldReasons
          : undefined;
      res.status(statusCode).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal menyelesaikan metadata video Google Drive.',
        ...(missingFields?.length ? { missingFields } : {}),
        ...(invalidFields?.length ? { invalidFields } : {}),
        ...(fieldReasons && Object.keys(fieldReasons).length ? { fieldReasons } : {}),
      });
    }
  });

  app.all('/api/storage/chat-drive-private-access', async (req, res) => {
    await handlePrivateChatDriveAccess(
      {
        method: req.method,
        headers: req.headers,
        query: req.query as Record<string, unknown>,
        body: req.body,
        pathBase: '/api/storage/chat-drive-private-access',
      },
      res as unknown as Parameters<typeof handlePrivateChatDriveAccess>[1]
    );
  });

  app.post('/api/audit-logs', (req, res) => {
    const body = req.body as Partial<ServerAuditLog>;
    if (!body || !body.action || !body.entity || !body.summary) {
      res.status(400).json({ error: 'Data log tidak lengkap.' });
      return;
    }

    const forwarded = req.headers['x-forwarded-for'];
    const clientIp =
      typeof forwarded === 'string'
        ? forwarded.split(',')[0].trim()
        : req.socket.remoteAddress || 'unknown';

    const entry: ServerAuditLog = {
      id: body.id || `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      timestamp: body.timestamp || new Date().toISOString(),
      actor_role: body.actor_role || 'system',
      actor_id: body.actor_id || 'anonymous',
      actor_name: body.actor_name || 'Pengguna',
      action: body.action,
      entity: body.entity,
      entity_id: body.entity_id,
      summary: body.summary,
      metadata: body.metadata,
      ip: clientIp,
    };

    appendAuditLog(entry);
    res.status(201).json({ ok: true, entry });
  });

  app.get('/api/audit-logs', (req, res) => {
    const roleHeader = req.headers['x-user-role'];
    if (roleHeader !== 'admin') {
      res.status(403).json({ error: 'Akses log aktivitas server hanya untuk Pengurus / Admin.' });
      return;
    }
    const limitParam = Number(req.query.limit) || 150;
    const logs = readAuditLogs(Math.min(Math.max(limitParam, 1), 500));
    res.json({ logs });
  });

  app.all('/api/bot-wa/send', async (req, res) => {
    await sendBotWaHandler(
      req as unknown as Parameters<typeof sendBotWaHandler>[0],
      res as unknown as Parameters<typeof sendBotWaHandler>[1]
    );
  });

  const delegateWebhook = async (req: express.Request, res: express.Response) => {
    await webhookBotWaHandler(
      req as unknown as Parameters<typeof webhookBotWaHandler>[0],
      res as unknown as Parameters<typeof webhookBotWaHandler>[1]
    );
  };

  app.all('/api/bot-wa/webhook', delegateWebhook);
  app.all('/api/webhook/fonnte', delegateWebhook);

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(__dirname, 'dist');

  let viteInstance: Awaited<ReturnType<typeof createViteServer>> | null = null;

  if (!isProd) {
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: process.env.DISABLE_HMR === 'true' ? null : undefined,
      },
      appType: 'spa',
    })
      .then((vite) => {
        viteInstance = vite;
        return vite;
      })
      .catch((err) => {
        console.error('[VITE_INIT_ERROR]', err);
        throw err;
      });

    app.use((req, res, next) => {
      vitePromise
        .then((vite) => {
          vite.middlewares(req, res, next);
        })
        .catch(next);
    });
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] e-Card Verifikasi & IPL Digital berjalan di http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    httpServer.close(() => {
      if (viteInstance) {
        void viteInstance.close().finally(() => process.exit(0));
      } else {
        process.exit(0);
      }
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('[SERVER_FATAL]', err);
  process.exit(1);
});
