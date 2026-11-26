interface VercelReq {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
}

interface VercelRes {
  status: (code: number) => VercelRes;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

interface WaTarget {
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  pesan: string;
}

const GATEWAY_TIMEOUT_MS = 12000;

function sanitizeSecret(raw: unknown): string {
  return String(raw || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string {
  const val = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
}

function normalizePhoneNumber(phone: string | null | undefined): string {
  if (!phone) return '';
  let cleaned = String(phone)
    .trim()
    .replace(/@(s\.whatsapp\.net|c\.us|g\.us|lid)$/i, '')
    .replace(/[\s\-+.]/g, '')
    .replace(/\D/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('0')) cleaned = `62${cleaned.slice(1)}`;
  else if (cleaned.startsWith('8')) cleaned = `62${cleaned}`;
  return cleaned;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonBody(req: VercelReq): Promise<Record<string, unknown> | null> {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const obj = req.body as Record<string, unknown>;
    if (Object.keys(obj).length > 0) return obj;
  }
  if (req.body === undefined && typeof req.on === 'function') {
    const text = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      let done = false;
      const finish = (s: string) => {
        if (done) return;
        done = true;
        resolve(s);
      };
      const timer = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), 3000);
      req.on!('data', (c: unknown) => {
        if (typeof c === 'string') chunks.push(Buffer.from(c, 'utf8'));
        else if (Buffer.isBuffer(c)) chunks.push(c);
      });
      req.on!('end', () => {
        clearTimeout(timer);
        finish(Buffer.concat(chunks).toString('utf8'));
      });
      req.on!('error', () => {
        clearTimeout(timer);
        finish('');
      });
    });
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return {};
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

  try {
    const roleHeader = getHeader(req.headers, 'x-user-role').trim().toLowerCase();
    const permHeader = getHeader(req.headers, 'x-admin-permission').trim().toLowerCase();
    if (roleHeader !== 'admin' || permHeader !== 'full') {
      res.status(403).json({ error: 'Pengiriman Bot WhatsApp khusus akun Bendahara.' });
      return;
    }

    const parsedBody = await parseJsonBody(req);
    if (!parsedBody) {
      res.status(400).json({ error: 'Body JSON tidak valid.' });
      return;
    }

    const provider = parsedBody.provider === 'Wablas' ? 'Wablas' : 'Fonnte';
    const endpoint = sanitizeSecret(parsedBody.api_endpoint);
    const token =
      sanitizeSecret(parsedBody.api_token) ||
      sanitizeSecret(process.env.FONNTE_TOKEN) ||
      sanitizeSecret(process.env.BOT_WA_TOKEN);
    const rawTargets = Array.isArray(parsedBody.targets)
      ? (parsedBody.targets as WaTarget[]).slice(0, 150)
      : [];

    if (!token) {
      res.status(400).json({ error: 'API Token gateway WhatsApp belum diisi.' });
      return;
    }
    if (!endpoint) {
      res.status(400).json({ error: 'API Endpoint URL gateway WhatsApp wajib diisi.' });
      return;
    }
    if (rawTargets.length === 0) {
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
          error:
            'Endpoint harus menggunakan HTTPS resmi Fonnte (api.fonnte.com) atau Wablas (*.wablas.com).',
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

    for (let i = 0; i < rawTargets.length; i++) {
      const item = rawTargets[i];
      const cleanPhone = normalizePhoneNumber(item.no_wa) || String(item.no_wa || '').trim();
      let status_kirim: 'Terkirim' | 'Gagal' = 'Gagal';
      let respon_gateway = '';

      if (!cleanPhone || cleanPhone.length < 10) {
        respon_gateway = 'Nomor WhatsApp tujuan tidak valid';
      } else {
        try {
          const payload =
            provider === 'Wablas'
              ? { phone: cleanPhone, message: item.pesan }
              : { target: cleanPhone, message: item.pesan, delay: '2-5', countryCode: '62' };

          const gatewayRes = await fetchWithTimeout(
            endpoint,
            {
              method: 'POST',
              headers: {
                Authorization: token,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            },
            GATEWAY_TIMEOUT_MS
          );

          const rawText = await gatewayRes.text();
          let parsedJson: {
            status?: boolean;
            reason?: string;
            detail?: string;
            message?: string;
          } | null = null;
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
          respon_gateway =
            err instanceof Error && err.name === 'AbortError'
              ? `Timeout ${GATEWAY_TIMEOUT_MS}ms menghubungi gateway ${provider}`
              : err instanceof Error
                ? err.message
                : 'Gagal terhubung ke gateway WA';
        }
      }

      results.push({
        blok_rumah: item.blok_rumah,
        nama_warga: item.nama_warga,
        no_wa: cleanPhone || item.no_wa,
        pesan: item.pesan,
        status_kirim,
        respon_gateway,
      });

      if (i < rawTargets.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    const sent = results.filter((r) => r.status_kirim === 'Terkirim').length;
    const failed = results.filter((r) => r.status_kirim === 'Gagal').length;
    console.info(
      `[BOT-WA-SEND] provider=${provider} total=${results.length} sent=${sent} failed=${failed}`
    );

    res.status(200).json({
      ok: true,
      sent,
      failed,
      results,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Internal send error';
    console.error('[BOT-WA-SEND] Unhandled exception:', errorMsg);
    res.status(500).json({
      ok: false,
      error: errorMsg,
    });
  }
}
