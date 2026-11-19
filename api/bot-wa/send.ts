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

interface WaTarget {
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  pesan: string;
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

  const roleHeader = getHeader(req.headers, 'x-user-role');
  const permHeader = getHeader(req.headers, 'x-admin-permission');
  if (roleHeader !== 'admin' || permHeader !== 'full') {
    res.status(403).json({ error: 'Pengiriman Bot WhatsApp khusus akun Bendahara.' });
    return;
  }

  let parsedBody: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    try {
      parsedBody = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'Body JSON tidak valid.' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    parsedBody = req.body as Record<string, unknown>;
  }

  const provider = parsedBody.provider === 'Wablas' ? 'Wablas' : 'Fonnte';
  const endpoint = String(parsedBody.api_endpoint || '').trim();
  const token = String(parsedBody.api_token || '').trim();
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

    if (i < rawTargets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  res.status(200).json({
    ok: true,
    sent: results.filter((r) => r.status_kirim === 'Terkirim').length,
    failed: results.filter((r) => r.status_kirim === 'Gagal').length,
    results,
  });
}
