import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

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
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ecard-saung-kebun', time: new Date().toISOString() });
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
    }).then((vite) => {
      viteInstance = vite;
      return vite;
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
