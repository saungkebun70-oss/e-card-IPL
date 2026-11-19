// Vercel Serverless Webhook untuk Bot Jawab Otomatis WhatsApp (Fonnte / Wablas)
// URL Webhook di Dashboard Fonnte: https://e-card-ipl.vercel.app/api/bot-wa/webhook

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

interface WargaRow {
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  status_hunian: string;
  nominal_iuran: number;
  pin_akses?: string;
  aktif: boolean;
}

interface StatusRow {
  blok_rumah: string;
  tahun: number;
  bulan: number;
  status: string;
}

interface RekeningItem {
  bank: string;
  nomor: string;
  atasNama: string;
  tipe: string;
}

interface PaymentConfigRow {
  qris_aktif: boolean;
  qris_image_url: string | null;
  qris_label: string;
  rekening_list: RekeningItem[];
}

interface BotConfigRow {
  aktif: boolean;
  provider: string;
  api_endpoint: string;
  api_token: string;
}

const APP_PORTAL_URL = 'https://e-card-ipl.vercel.app';
const TAHUN_AKTIF = 2026;
const NOMINAL_DEFAULT = 100000;
const BULAN_NAMA = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];
const BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const SUSUNAN_PENGURUS = [
  { jabatan: 'Pembina', nama: 'Bp. Iwan', blok: 'B8/5' },
  { jabatan: 'Ketua', nama: 'Erlangga', blok: 'B3/7' },
  { jabatan: 'Bendahara', nama: 'Andriansyah', blok: 'B7/16' },
  { jabatan: 'Humas', nama: 'Doni', blok: 'B5/21' },
  { jabatan: 'Humas', nama: 'Wahyu', blok: 'B5/24' },
  { jabatan: 'Seksi Olahraga', nama: 'Deny', blok: 'B8/6' },
];

function formatRupiah(nominal: number): string {
  return `Rp ${Number(nominal || 0).toLocaleString('id-ID')}`;
}

function normalizeBlok(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function getCurrentMonth(): number {
  const now = new Date();
  if (now.getFullYear() === TAHUN_AKTIF) return now.getMonth() + 1;
  return now.getFullYear() > TAHUN_AKTIF ? 12 : 1;
}

function getDefaultUnpaidStatus(bulan: number): string {
  const now = new Date();
  const current = getCurrentMonth();
  if (bulan > current) return 'Belum Tagihan';
  if (bulan < current) return 'Jatuh Tempo';
  return now.getDate() > 7 ? 'Jatuh Tempo' : 'Belum Bayar';
}

function getSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  return { url, key };
}

async function supabaseRestGet<T>(pathWithQuery: string): Promise<T[]> {
  const { url, key } = getSupabaseEnv();
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/rest/v1/${pathWithQuery}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'x-user-role': 'admin',
        'x-admin-permission': 'full',
        'x-blok-rumah': 'bot-webhook',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

async function supabaseRestInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const { url, key } = getSupabaseEnv();
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
        'x-user-role': 'admin',
        'x-admin-permission': 'full',
        'x-blok-rumah': 'bot-webhook',
      },
      body: JSON.stringify(row),
    });
  } catch {
    // Abaikan kegagalan logging non-kritis
  }
}

function buildMenuReply(): string {
  return [
    `*Bot Layanan Otomatis IPL — Perumahan Saung Kebun*`,
    ``,
    `Ketik salah satu format pesan berikut:`,
    `1. *CEK#[BLOK]* — Cek tagihan bulan ini (contoh: CEK#B5/21)`,
    `2. *SALDO#[BLOK]#${TAHUN_AKTIF}* — Cek rekap lunas & tunggakan setahun`,
    `3. *VERIFIKASI#[BLOK]#[PIN]* — Verifikasi nomor WA & unit rumah`,
    `4. *SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]* — Konfirmasi setor IPL`,
    `5. *REKENING* atau *QRIS* — Info nomor rekening kas & QRIS resmi`,
    `6. *PENGURUS* — Daftar susunan pengurus Saung Kebun`,
    `7. *BANTUAN#PIN#[BLOK]#[NAMA]* — Minta bantuan reset PIN / ubah WA`,
    ``,
    `Portal resmi e-Card Digital:`,
    `${APP_PORTAL_URL}`,
  ].join('\n');
}

async function buildAutoReply(
  incomingMessage: string,
  senderName: string
): Promise<{ command: string; blok: string; reply: string }> {
  const raw = incomingMessage.trim();
  if (!raw) {
    return { command: 'MENU', blok: 'BOT-WA', reply: buildMenuReply() };
  }

  const upper = raw.toUpperCase();
  const parts = raw.split('#').map((s) => s.trim());
  const head = (parts[0] || '').toUpperCase();

  if (
    ['MENU', 'HELP', 'INFO', 'BOT', 'HALO', 'HELLO', 'HAI', 'ASSALAMUALAIKUM', 'P', 'START'].includes(
      upper
    ) ||
    head === 'MENU' ||
    head === 'HELP'
  ) {
    return { command: 'MENU', blok: 'BOT-WA', reply: buildMenuReply() };
  }

  if (head === 'PENGURUS' || upper.includes('SUSUNAN PENGURUS')) {
    const lines = SUSUNAN_PENGURUS.map((p) => `• *${p.jabatan}*: ${p.nama} (Blok ${p.blok})`);
    return {
      command: 'PENGURUS',
      blok: 'BOT-WA',
      reply: [
        `*Susunan Pengurus Lingkungan Perumahan Saung Kebun*`,
        `Sekretariat: Blok B3/7 · Desa Bengle, Kec. Majalaya, Karawang`,
        ``,
        ...lines,
        ``,
        `Portal resmi: ${APP_PORTAL_URL}`,
      ].join('\n'),
    };
  }

  if (['REKENING', 'NOREK', 'QRIS', 'QR', 'BAYAR'].includes(head)) {
    const configs = await supabaseRestGet<PaymentConfigRow>('payment_config?select=*&limit=1');
    const cfg = configs[0];
    const rekList = Array.isArray(cfg?.rekening_list) ? cfg.rekening_list : [];
    const lines = [
      `*Info Pembayaran Resmi IPL Perumahan Saung Kebun*`,
      `Iuran Wajib: ${formatRupiah(NOMINAL_DEFAULT)} / bulan (Jatuh tempo tgl 7)`,
      ``,
    ];
    if (cfg?.qris_aktif && cfg?.qris_image_url) {
      lines.push(`*Via QR / QRIS:* ${cfg.qris_label}`);
      lines.push(`Scan langsung di ${APP_PORTAL_URL} → Menu Setor → Via QR / QRIS`);
      lines.push(``);
    }
    if (rekList.length > 0) {
      rekList.forEach((r) => {
        lines.push(`• *${r.bank}* (${r.tipe}): ${r.nomor} a.n. ${r.atasNama}`);
      });
    } else {
      lines.push(`• *Bank BCA*: 7401829304 (Kas Lingkungan Saung Kebun)`);
      lines.push(`• *Bank Mandiri*: 1730009845120 (Pengurus Saung Kebun)`);
    }
    lines.push(``);
    lines.push(`Unggah bukti bayar di ${APP_PORTAL_URL} agar status e-Card otomatis terverifikasi.`);
    return { command: 'REKENING', blok: 'BOT-WA', reply: lines.join('\n') };
  }

  if (head === 'VERIFIKASI') {
    const cleanBlok = normalizeBlok(parts[1] || '');
    const cleanPin = (parts[2] || '').replace(/\D/g, '');
    if (!cleanBlok || cleanPin.length < 4) {
      return {
        command: 'VERIFIKASI',
        blok: cleanBlok || 'BOT-WA',
        reply: `Format kurang lengkap.\nGunakan: *VERIFIKASI#[BLOK]#[PIN_6_DIGIT]*\nContoh: *VERIFIKASI#B5/21#123456*`,
      };
    }

    const rows = await supabaseRestGet<WargaRow>(
      `users_warga?select=blok_rumah,nama_warga,no_wa,status_hunian,nominal_iuran,pin_akses,aktif&role=eq.warga&blok_rumah=eq.${encodeURIComponent(cleanBlok)}&limit=1`
    );
    const w = rows[0];
    if (!w) {
      return {
        command: 'VERIFIKASI',
        blok: cleanBlok,
        reply: `Blok *${cleanBlok}* tidak ditemukan di data Perumahan Saung Kebun. Pastikan format blok benar (contoh: B3/7, B5/21, B7/16).`,
      };
    }
    if (w.pin_akses && w.pin_akses !== cleanPin) {
      return {
        command: 'VERIFIKASI',
        blok: w.blok_rumah,
        reply: `PIN untuk Blok *${w.blok_rumah}* tidak cocok.\nJika lupa PIN, ketik: *BANTUAN#PIN#${w.blok_rumah}#${w.nama_warga}*`,
      };
    }

    return {
      command: 'VERIFIKASI',
      blok: w.blok_rumah,
      reply: [
        `*Verifikasi Akun Berhasil*`,
        `Unit: *Blok ${w.blok_rumah}* (${w.nama_warga})`,
        `Status Hunian: ${w.status_hunian}`,
        `Iuran Wajib: ${formatRupiah(w.nominal_iuran)} / bulan`,
        ``,
        `Ketik *CEK#${w.blok_rumah}* untuk cek tagihan bulan ini, atau buka:`,
        `${APP_PORTAL_URL}`,
      ].join('\n'),
    };
  }

  if (head === 'CEK') {
    const rawBlok = parts[1] || raw.replace(/^CEK\s+/i, '');
    const cleanBlok = normalizeBlok(rawBlok);
    if (!cleanBlok || cleanBlok === 'CEK') {
      return { command: 'CEK', blok: 'BOT-WA', reply: `Gunakan format: *CEK#[BLOK]*\nContoh: *CEK#B5/21*` };
    }

    const currentMonth = getCurrentMonth();
    const bulanNama = `${BULAN_NAMA[currentMonth - 1]} ${TAHUN_AKTIF}`;
    const [wargaRows, statusRows] = await Promise.all([
      supabaseRestGet<WargaRow>(
        `users_warga?select=blok_rumah,nama_warga,no_wa,status_hunian,nominal_iuran,aktif&role=eq.warga&blok_rumah=eq.${encodeURIComponent(cleanBlok)}&limit=1`
      ),
      supabaseRestGet<StatusRow>(
        `status_ecard_bulanan?select=blok_rumah,tahun,bulan,status&blok_rumah=eq.${encodeURIComponent(cleanBlok)}&tahun=eq.${TAHUN_AKTIF}&bulan=eq.${currentMonth}&limit=1`
      ),
    ]);

    const w = wargaRows[0];
    if (!w) {
      return {
        command: 'CEK',
        blok: cleanBlok,
        reply: `Unit *${cleanBlok}* belum terdaftar di database. Pastikan format blok sesuai (contoh: B3/7, B5/21, B7/16).`,
      };
    }

    const statusBulan = statusRows[0]?.status || getDefaultUnpaidStatus(currentMonth);
    return {
      command: 'CEK',
      blok: w.blok_rumah,
      reply: [
        `*Status e-Card IPL — Blok ${w.blok_rumah}*`,
        `Nama: ${w.nama_warga}`,
        `Periode: *${bulanNama}*`,
        `Status: *${statusBulan.toUpperCase()}*`,
        `Iuran Wajib: ${formatRupiah(w.nominal_iuran)} / bulan`,
        `Jatuh Tempo: Tanggal 7`,
        ``,
        statusBulan === 'Lunas'
          ? `Terima kasih, IPL bulan ${bulanNama} sudah *LUNAS*. Kwitansi tersedia di ${APP_PORTAL_URL}`
          : `Silakan setor via QRIS/Transfer/Titip Pengurus di ${APP_PORTAL_URL} atau ketik *REKENING*.`,
      ].join('\n'),
    };
  }

  if (head === 'SALDO') {
    const rawBlok = parts[1] || raw.replace(/^SALDO\s+/i, '');
    const cleanBlok = normalizeBlok(rawBlok);
    const tahun = Number(parts[2]) || TAHUN_AKTIF;
    if (!cleanBlok || cleanBlok === 'SALDO') {
      return {
        command: 'SALDO',
        blok: 'BOT-WA',
        reply: `Gunakan format: *SALDO#[BLOK]#${TAHUN_AKTIF}*\nContoh: *SALDO#B5/21#${TAHUN_AKTIF}*`,
      };
    }

    const [wargaRows, statusRows] = await Promise.all([
      supabaseRestGet<WargaRow>(
        `users_warga?select=blok_rumah,nama_warga,no_wa,status_hunian,nominal_iuran,aktif&role=eq.warga&blok_rumah=eq.${encodeURIComponent(cleanBlok)}&limit=1`
      ),
      supabaseRestGet<StatusRow>(
        `status_ecard_bulanan?select=blok_rumah,tahun,bulan,status&blok_rumah=eq.${encodeURIComponent(cleanBlok)}&tahun=eq.${tahun}`
      ),
    ]);

    const w = wargaRows[0];
    if (!w) {
      return {
        command: 'SALDO',
        blok: cleanBlok,
        reply: `Unit *${cleanBlok}* tidak ditemukan di data Perumahan Saung Kebun.`,
      };
    }

    const currentMonth = getCurrentMonth();
    let lunas = 0;
    let pending = 0;
    const unpaid: string[] = [];

    for (let m = 1; m <= 12; m++) {
      const found = statusRows.find((s) => s.bulan === m);
      const st = found?.status || getDefaultUnpaidStatus(m);
      if (st === 'Lunas') lunas += 1;
      else if (st === 'Menunggu Verifikasi') pending += 1;
      else if (m <= currentMonth) unpaid.push(BULAN_SINGKAT[m - 1]);
    }

    const totalTunggakan = unpaid.length * (w.nominal_iuran || NOMINAL_DEFAULT);
    return {
      command: 'SALDO',
      blok: w.blok_rumah,
      reply: [
        `*Rekap Saldo IPL ${tahun} — Blok ${w.blok_rumah}*`,
        `Nama: ${w.nama_warga}`,
        `• Lunas: *${lunas} bulan*`,
        `• Menunggu Verifikasi: *${pending} bulan*`,
        `• Belum Bayar (s.d. ${BULAN_NAMA[currentMonth - 1]}): *${unpaid.length} bulan*${
          unpaid.length > 0 ? ` (${unpaid.join(', ')})` : ''
        }`,
        `• Estimasi Kewajiban: *${formatRupiah(totalTunggakan)}*`,
        ``,
        `Detail lengkap 12 bulan & kwitansi: ${APP_PORTAL_URL}`,
      ].join('\n'),
    };
  }

  if (head === 'SETOR') {
    const cleanBlok = normalizeBlok(parts[1] || '');
    const periode = (parts[2] || '').toUpperCase();
    const nominal = Number((parts[3] || '').replace(/\D/g, '')) || 0;
    const metode = (parts[4] || '').toUpperCase();
    const pengurus = parts[5] || '';

    if (!cleanBlok || !periode || nominal <= 0 || !metode) {
      return {
        command: 'SETOR',
        blok: cleanBlok || 'BOT-WA',
        reply: `Format setor belum lengkap.\nGunakan: *SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]*\nContoh: *SETOR#B5/21#NOV${TAHUN_AKTIF}#100000#QRIS*`,
      };
    }

    return {
      command: 'SETOR',
      blok: cleanBlok,
      reply: [
        `*Laporan Setor IPL Diterima*`,
        `Unit: *Blok ${cleanBlok}*`,
        `Periode: *${periode}*`,
        `Nominal: *${formatRupiah(nominal)}*`,
        `Metode: *${metode}*${pengurus ? ` via ${pengurus}` : ''}`,
        ``,
        `Pastikan bukti transfer juga diunggah di ${APP_PORTAL_URL} agar Bendahara (Andriansyah) segera memverifikasi dan menerbitkan kwitansi digital.`,
      ].join('\n'),
    };
  }

  if (head === 'BANTUAN') {
    const topik = (parts[1] || 'UMUM').toUpperCase();
    const cleanBlok = normalizeBlok(parts[2] || '') || 'BOT-WA';
    const nama = parts[3] || senderName || 'Warga';
    return {
      command: 'BANTUAN',
      blok: cleanBlok,
      reply: [
        `*Permintaan Bantuan Tercatat*`,
        `Topik: *${topik}* · Unit: *${cleanBlok}* (${nama})`,
        ``,
        `Pesan Anda telah diteruskan ke *Bendahara (Andriansyah — Blok B7/16)*. Mohon tunggu konfirmasi balasan pengurus.`,
      ].join('\n'),
    };
  }

  return {
    command: 'FALLBACK',
    blok: 'BOT-WA',
    reply: `Maaf, format *"${raw.slice(0, 60)}"* belum dikenali.\nKetik *MENU* untuk melihat daftar perintah otomatis Bot IPL Saung Kebun.\nPortal: ${APP_PORTAL_URL}`,
  };
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Health check jika dibuka via browser / tes konektivitas webhook
  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      service: 'saung-kebun-wa-auto-reply',
      webhook_url: `${APP_PORTAL_URL}/api/bot-wa/webhook`,
      commands: ['MENU', 'VERIFIKASI#BLOK#PIN', 'CEK#BLOK', 'SALDO#BLOK#2026', 'SETOR#BLOK#BULAN#NOMINAL#METODE', 'REKENING', 'PENGURUS', 'BANTUAN#PIN#BLOK#NAMA'],
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method tidak diizinkan.' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as Record<string, unknown>;
  }

  // Abaikan pesan dari grup (Fonnte mengirim sender berakhiran @g.us atau field member terisi)
  const rawSender = String(body.sender || body.phone || '').trim();
  const isGroup = rawSender.endsWith('@g.us') || Boolean(body.member);
  const incomingText = String(body.message || body.pesan || '').trim();
  const senderName = String(body.name || body.pushName || 'Warga').trim();
  const dryRun = Boolean(body.dryRun);

  if (!incomingText) {
    res.status(200).json({ ok: true, ignored: true, reason: 'Pesan kosong.' });
    return;
  }

  if (isGroup && !dryRun) {
    res.status(200).json({ ok: true, ignored: true, reason: 'Pesan grup diabaikan demi privasi warga.' });
    return;
  }

  const autoResult = await buildAutoReply(incomingText, senderName);

  if (dryRun) {
    res.status(200).json({
      ok: true,
      dryRun: true,
      command: autoResult.command,
      blok: autoResult.blok,
      reply: autoResult.reply,
    });
    return;
  }

  const senderPhone = normalizePhone(rawSender);
  if (!senderPhone) {
    res.status(200).json({
      ok: true,
      command: autoResult.command,
      reply: autoResult.reply,
      sent: false,
      reason: 'Nomor pengirim tidak ditemukan pada payload webhook.',
    });
    return;
  }

  // Ambil konfigurasi token Fonnte/Wablas dari Supabase bot_wa_config atau env FONNTE_TOKEN
  const configs = await supabaseRestGet<BotConfigRow>('bot_wa_config?select=aktif,provider,api_endpoint,api_token&limit=1');
  const dbCfg = configs[0];

  if (dbCfg && dbCfg.aktif === false) {
    res.status(200).json({
      ok: true,
      sent: false,
      reason: 'Bot WA dalam status nonaktif pada pengaturan Admin.',
    });
    return;
  }

  const token = (dbCfg?.api_token || process.env.FONNTE_TOKEN || '').trim();
  const provider = dbCfg?.provider === 'Wablas' ? 'Wablas' : 'Fonnte';
  const endpoint =
    (dbCfg?.api_endpoint || '').trim() ||
    (provider === 'Wablas'
      ? 'https://pati.wablas.com/api/send-message'
      : 'https://api.fonnte.com/send');

  if (!token) {
    res.status(200).json({
      ok: false,
      sent: false,
      command: autoResult.command,
      reply: autoResult.reply,
      reason: 'API Token Fonnte belum tersimpan di bot_wa_config atau env FONNTE_TOKEN.',
    });
    return;
  }

  let statusKirim: 'Terkirim' | 'Gagal' = 'Gagal';
  let responGateway = '';

  try {
    const payload =
      provider === 'Wablas'
        ? { phone: senderPhone, message: autoResult.reply }
        : { target: senderPhone, message: autoResult.reply, countryCode: '62' };

    const gatewayRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await gatewayRes.text();
    let parsed: { status?: boolean; reason?: string; detail?: string } | null = null;
    try {
      parsed = JSON.parse(rawText) as { status?: boolean; reason?: string; detail?: string };
    } catch {
      parsed = null;
    }

    const ok = gatewayRes.ok && parsed?.status !== false;
    statusKirim = ok ? 'Terkirim' : 'Gagal';
    responGateway = `${gatewayRes.status} — ${String(parsed?.reason || parsed?.detail || rawText).slice(0, 140)}`;
  } catch (err) {
    responGateway = err instanceof Error ? err.message : 'Network error';
  }

  await supabaseRestInsert('bot_wa_logs', {
    blok_rumah: autoResult.blok || 'BOT-WA',
    nama_warga: senderName,
    no_wa: senderPhone,
    jenis_pesan: `Auto-Reply (${autoResult.command})`,
    status_kirim: statusKirim,
    respon_gateway: responGateway,
    pesan: `Masuk: ${incomingText.slice(0, 120)}\n---\nBalasan: ${autoResult.reply.slice(0, 500)}`,
  });

  res.status(200).json({
    ok: statusKirim === 'Terkirim',
    sent: statusKirim === 'Terkirim',
    command: autoResult.command,
    respon_gateway: responGateway,
  });
}
