import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { generateBotAutoReply } from './src/lib/botAutoReply';
import {
  buildInitialStatusBulanan,
  SEED_PAYMENT_CONFIG,
  SEED_TRANSAKSI,
  SEED_WARGA,
} from './src/lib/seedData';
import { normalizePhoneNumber } from './src/lib/phoneAndBlockUtils';

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
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

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

  app.post('/api/bot-wa/send', async (req, res) => {
    const roleHeader = req.headers['x-user-role'];
    const permHeader = req.headers['x-admin-permission'];
    if (roleHeader !== 'admin' || permHeader !== 'full') {
      res.status(403).json({ error: 'Pengiriman Bot WhatsApp khusus akun Bendahara.' });
      return;
    }

    const body = req.body as {
      provider?: 'Fonnte' | 'Wablas';
      api_endpoint?: string;
      api_token?: string;
      targets?: Array<{
        blok_rumah: string;
        nama_warga: string;
        no_wa: string;
        pesan: string;
      }>;
    };

    const provider = body.provider === 'Wablas' ? 'Wablas' : 'Fonnte';
    const endpoint = String(body.api_endpoint || '').trim();
    const token = String(body.api_token || '').trim();
    const targets = Array.isArray(body.targets) ? body.targets.slice(0, 150) : [];

    if (!token) {
      res.status(400).json({ error: 'API Token gateway WhatsApp belum diisi.' });
      return;
    }
    if (!endpoint) {
      res.status(400).json({ error: 'API Endpoint URL gateway WhatsApp wajib diisi.' });
      return;
    }
    if (targets.length === 0) {
      res.status(400).json({ error: 'Tidak ada nomor tujuan pengiriman.' });
      return;
    }

    try {
      const parsedUrl = new URL(endpoint);
      const allowedHost =
        parsedUrl.protocol === 'https:' &&
        (parsedUrl.hostname === 'api.fonnte.com' ||
          parsedUrl.hostname === 'wablas.com' ||
          parsedUrl.hostname.endsWith('.wablas.com'));
      if (!allowedHost) {
        res.status(400).json({
          error: 'Endpoint harus menggunakan HTTPS resmi Fonnte (api.fonnte.com) atau Wablas (*.wablas.com).',
        });
        return;
      }
    } catch {
      res.status(400).json({ error: 'Format API Endpoint URL tidak valid.' });
      return;
    }

    const results: Array<{
      blok_rumah: string;
      nama_warga: string;
      no_wa: string;
      pesan: string;
      status_kirim: 'Terkirim' | 'Gagal';
      respon_gateway: string;
    }> = [];

    for (let i = 0; i < targets.length; i++) {
      const item = targets[i];
      let status_kirim: 'Terkirim' | 'Gagal' = 'Gagal';
      let respon_gateway = '';

      try {
        const payload =
          provider === 'Wablas'
            ? { phone: item.no_wa, message: item.pesan }
            : { target: item.no_wa, message: item.pesan, delay: '2-5', countryCode: '62' };

        const gatewayRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const rawText = await gatewayRes.text();
        let parsedJson: { status?: boolean; reason?: string; detail?: string; message?: string } | null = null;
        try {
          parsedJson = JSON.parse(rawText) as {
            status?: boolean;
            reason?: string;
            detail?: string;
            message?: string;
          };
        } catch {
          parsedJson = null;
        }

        const gatewayOk = gatewayRes.ok && parsedJson?.status !== false;
        status_kirim = gatewayOk ? 'Terkirim' : 'Gagal';
        const detailText =
          parsedJson?.reason || parsedJson?.detail || parsedJson?.message || rawText.slice(0, 140);
        respon_gateway = `${gatewayRes.status} — ${String(detailText || 'OK').slice(0, 140)}`;
      } catch (err) {
        status_kirim = 'Gagal';
        respon_gateway = err instanceof Error ? err.message : 'Gagal terhubung ke gateway WA';
      }

      results.push({
        blok_rumah: item.blok_rumah,
        nama_warga: item.nama_warga,
        no_wa: item.no_wa,
        pesan: item.pesan,
        status_kirim,
        respon_gateway,
      });

      if (i < targets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }

    res.json({
      ok: true,
      sent: results.filter((r) => r.status_kirim === 'Terkirim').length,
      failed: results.filter((r) => r.status_kirim === 'Gagal').length,
      results,
    });
  });

  const handleWebhookGet = (_req: express.Request, res: express.Response) => {
    res.json({
      ok: true,
      service: 'saung-kebun-wa-auto-reply-strict-isolation',
      webhook_url: 'https://e-card-ipl.vercel.app/api/bot-wa/webhook',
      security: 'Strict Sender-to-Unit Isolation Active',
      commands: ['CEK', 'CEK#<BLOK> (Pengurus)', 'SALDO', 'REKENING', 'BAYAR', 'MENU'],
    });
  };

  const handleWebhookPost = async (req: express.Request, res: express.Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const incomingText = String(body.message || body.pesan || body.text || '').trim();
    const senderName = String(body.name || body.pushName || 'Warga').trim();
    const rawSender = String(body.sender || body.phone || body.from || '').trim();
    const isGroup =
      body.isGroup === true ||
      String(body.isGroup || '').toLowerCase() === 'true' ||
      rawSender.toLowerCase().includes('@g.us') ||
      Boolean(body.member);
    const dryRun = Boolean(body.dryRun);

    if (!incomingText || !rawSender) {
      res.json({ ok: true, ignored: true, reason: 'Pesan atau pengirim kosong.' });
      return;
    }

    if (isGroup) {
      res.json({ ok: true, ignored: true, reason: 'Pesan grup diabaikan demi privasi warga.' });
      return;
    }

    const cleanSender = normalizePhoneNumber(rawSender);
    if (!cleanSender || cleanSender.length < 9) {
      res.json({ ok: true, ignored: true, reason: 'Nomor pengirim tidak valid.' });
      return;
    }

    const statusList = buildInitialStatusBulanan(SEED_WARGA, SEED_TRANSAKSI);
    const result = generateBotAutoReply(incomingText, {
      wargaList: SEED_WARGA,
      statusList,
      paymentConfig: SEED_PAYMENT_CONFIG,
      senderName,
      senderPhone: cleanSender,
    });

    if (dryRun || !process.env.FONNTE_TOKEN) {
      res.json({
        ok: true,
        dryRun: true,
        sender: cleanSender,
        command: result.command,
        blok: result.blok || 'BOT-WA',
        reply: result.reply,
      });
      return;
    }

    try {
      const gatewayRes = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          Authorization: process.env.FONNTE_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          target: cleanSender,
          message: result.reply,
          countryCode: '62',
        }),
      });
      const text = await gatewayRes.text();
      res.json({
        ok: gatewayRes.ok,
        sent: gatewayRes.ok,
        command: result.command,
        respon_gateway: `${gatewayRes.status} — ${text.slice(0, 140)}`,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Gagal mengirim balasan otomatis.',
      });
    }
  };

  app.get('/api/bot-wa/webhook', handleWebhookGet);
  app.post('/api/bot-wa/webhook', handleWebhookPost);
  app.get('/api/webhook/fonnte', handleWebhookGet);
  app.post('/api/webhook/fonnte', handleWebhookPost);

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
