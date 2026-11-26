// Vercel Serverless Webhook untuk Bot Jawab Otomatis WhatsApp (Fonnte / Wablas)
// URL Webhook di Dashboard Fonnte: https://e-card-ipl.vercel.app/api/bot-wa/webhook
// Menerapkan Strict Sender-to-Unit Isolation demi menjaga privasi penuh data warga.

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

interface WargaRow {
  id?: string;
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  secondary_whatsapp?: string | null;
  status_hunian: string;
  nominal_iuran: number;
  pin_akses?: string;
  role?: string | null;
  bot_role?: string | null;
  jabatan?: string | null;
  admin_permission?: string | null;
  aktif: boolean;
}

interface StatusRow {
  blok_rumah: string;
  tahun: number;
  bulan: number;
  status: string;
}

interface TransaksiKwitansiRow {
  no_kwitansi?: string;
  blok_rumah: string;
  tahun: number;
  bulan_dibayar?: number[];
  status_verifikasi?: string;
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

interface AppSettingsRow {
  wa_pengurus?: string | null;
  pengurus_wa_map?: Record<string, string> | null;
}

type EffectiveBotRole = 'warga' | 'admin' | 'bendahara';
type SupabaseAuthMode = 'service_role' | 'anon_fallback' | 'missing';

const APP_PORTAL_URL = 'https://e-card-ipl.vercel.app';
const TAHUN_AKTIF = 2026;
const NOMINAL_DEFAULT = 100000;
const SUPABASE_TIMEOUT_MS = 10000;
const GATEWAY_TIMEOUT_MS = 12000;

const ACTIVE_PENGURUS_CALLERS = [
  'andriansyah',
  'erlangga',
  'bpiwan',
  'doni',
  'wahyu',
  'deny',
];

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

const PLACEHOLDER_WA_NUMBERS = new Set([
  '6281200000000',
  '6281200000001',
  '6281200000002',
  '6281200000003',
  '6281200000004',
  '6281200000005',
  '6281200000006',
  '6281234567890',
]);

const SUSUNAN_PENGURUS = [
  { jabatan: 'Pembina', nama: 'Bp. Iwan', username: 'bpiwan', blok: 'B08/05', role: 'admin' as const },
  { jabatan: 'Ketua', nama: 'Erlangga', username: 'erlangga', blok: 'B03/07', role: 'admin' as const },
  { jabatan: 'Bendahara', nama: 'Andriansyah', username: 'andriansyah', blok: 'B07/16', role: 'bendahara' as const },
  { jabatan: 'Humas', nama: 'Doni', username: 'doni', blok: 'B05/21', role: 'admin' as const },
  { jabatan: 'Humas', nama: 'Wahyu', username: 'wahyu', blok: 'B05/24', role: 'admin' as const },
  { jabatan: 'Seksi Olahraga', nama: 'Deny', username: 'deny', blok: 'B08/06', role: 'admin' as const },
];

let cachedPengurusCaller = 'andriansyah';

function sanitizeSecret(raw: string | null | undefined): string {
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

function formatRupiah(nominal: number): string {
  return `Rp ${Number(nominal || 0).toLocaleString('id-ID')}`;
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

function isRealRegisteredPhone(phone: string | null | undefined): boolean {
  const normalized = normalizePhoneNumber(phone);
  if (normalized.length < 10 || normalized.length > 15) return false;
  if (!normalized.startsWith('62')) return false;
  if (PLACEHOLDER_WA_NUMBERS.has(normalized)) return false;
  return true;
}

function normalizeBlockCode(block: string | null | undefined): string {
  if (!block) return '';
  const cleaned = String(block)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '/');

  if (!cleaned) return '';
  const match = cleaned.match(/^([A-Z]+)0*(\d+)\/0*(\d+)([A-Z]*)$/);
  if (match) {
    const [, prefix, blockNum, houseNum, suffix] = match;
    const paddedBlock = blockNum.length < 2 ? blockNum.padStart(2, '0') : blockNum;
    const paddedHouse = houseNum.length < 2 ? houseNum.padStart(2, '0') : houseNum;
    return `${prefix}${paddedBlock}/${paddedHouse}${suffix}`;
  }
  return cleaned;
}

function canonicalBlockKey(block: string | null | undefined): string {
  if (!block) return '';
  const cleaned = String(block)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '/');
  const match = cleaned.match(/^([A-Z]+)0*(\d+)\/0*(\d+)([A-Z]*)$/);
  if (match) {
    return `${match[1]}${Number(match[2])}/${Number(match[3])}${match[4]}`;
  }
  return cleaned;
}

function isSameBlockCode(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = normalizeBlockCode(a);
  const normB = normalizeBlockCode(b);
  if (!normA || !normB) return false;
  return normA === normB || canonicalBlockKey(a) === canonicalBlockKey(b);
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

function isAllowedGatewayEndpoint(endpoint: string): boolean {
  try {
    const parsed = new URL(endpoint);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'api.fonnte.com' ||
        parsed.hostname === 'wablas.com' ||
        parsed.hostname.endsWith('.wablas.com'))
    );
  } catch {
    return false;
  }
}

function getSupabaseEnv(): { url: string; key: string; authMode: SupabaseAuthMode } {
  const url = sanitizeSecret(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).replace(/\/+$/, '');
  const serviceRoleKey = sanitizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = sanitizeSecret(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY);

  if (serviceRoleKey) {
    return { url, key: serviceRoleKey, authMode: 'service_role' };
  }
  if (anonKey) {
    return { url, key: anonKey, authMode: 'anon_fallback' };
  }
  return { url, key: '', authMode: 'missing' };
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

function buildQueryBodyFromText(raw: string, contentType: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const wantsForm = contentType.includes('application/x-www-form-urlencoded');
  if (!wantsForm) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Coba form-urlencoded di bawah jika bukan JSON valid
    }
  }

  if (wantsForm || trimmed.includes('=')) {
    try {
      const params = new URLSearchParams(trimmed);
      const obj: Record<string, unknown> = {};
      for (const [k, v] of params.entries()) {
        obj[k] = v;
      }
      if (Object.keys(obj).length > 0) {
        return obj;
      }
    } catch {
      // Abaikan
    }
  }

  return {};
}

async function readRawRequestStream(req: VercelReq): Promise<string> {
  if (typeof req.on !== 'function') return '';
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      resolve(text);
    };
    const timer = setTimeout(() => finish(Buffer.concat(chunks).toString('utf8')), 3000);
    req.on!('data', (chunk: unknown) => {
      if (typeof chunk === 'string') chunks.push(Buffer.from(chunk, 'utf8'));
      else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
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
}

async function parseIncomingBody(req: VercelReq): Promise<Record<string, unknown>> {
  const contentType = getHeader(req.headers, 'content-type').toLowerCase();

  if (Buffer.isBuffer(req.body)) {
    return buildQueryBodyFromText(req.body.toString('utf8'), contentType);
  }
  if (typeof req.body === 'string') {
    return buildQueryBodyFromText(req.body, contentType);
  }
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    const obj = req.body as Record<string, unknown>;
    if (Object.keys(obj).length > 0) {
      return obj;
    }
  }

  if (req.body === undefined || req.body === null) {
    const rawText = await readRawRequestStream(req);
    if (rawText) {
      return buildQueryBodyFromText(rawText, contentType);
    }
  }

  return {};
}

async function executeSupabaseGet<T>(
  url: string,
  key: string,
  pathWithQuery: string,
  callerUsername: string
): Promise<{ ok: boolean; status: number; data: T[]; errorText?: string }> {
  try {
    const res = await fetchWithTimeout(
      `${url}/rest/v1/${pathWithQuery}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'x-user-role': 'admin',
          'x-admin-permission': 'full',
          'x-blok-rumah': callerUsername,
        },
      },
      SUPABASE_TIMEOUT_MS
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        data: [],
        errorText: errText.slice(0, 160),
      };
    }

    const data = (await res.json()) as unknown;
    return {
      ok: true,
      status: res.status,
      data: Array.isArray(data) ? (data as T[]) : [],
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: [],
      errorText: err instanceof Error ? err.message : 'Network error',
    };
  }
}

async function supabaseRestGetWithStatus<T>(
  pathWithQuery: string,
  options?: { retryNonEmptyOnAnon?: boolean }
): Promise<{ ok: boolean; status: number; data: T[] }> {
  const { url, key, authMode } = getSupabaseEnv();
  if (!url || !key) {
    console.error('[BOT-WA-WEBHOOK] Konfigurasi Supabase tidak lengkap (authMode=missing).');
    return { ok: false, status: 0, data: [] };
  }

  const primaryCaller = authMode === 'service_role' ? 'andriansyah' : cachedPengurusCaller;
  const firstAttempt = await executeSupabaseGet<T>(url, key, pathWithQuery, primaryCaller);

  if (firstAttempt.ok && (firstAttempt.data.length > 0 || authMode === 'service_role' || !options?.retryNonEmptyOnAnon)) {
    return { ok: true, status: firstAttempt.status, data: firstAttempt.data };
  }

  // Pada mode anon_fallback (ketika SUPABASE_SERVICE_ROLE_KEY tidak diset di Vercel),
  // Migration v16 RLS memvalidasi x-blok-rumah terhadap akun pengurus aktif di users_warga.
  if (authMode === 'anon_fallback') {
    const candidates = ACTIVE_PENGURUS_CALLERS.filter((c) => c !== primaryCaller);
    for (const candidate of candidates) {
      const attempt = await executeSupabaseGet<T>(url, key, pathWithQuery, candidate);
      if (attempt.ok && attempt.data.length > 0) {
        cachedPengurusCaller = candidate;
        return { ok: true, status: attempt.status, data: attempt.data };
      }
    }
  }

  if (!firstAttempt.ok) {
    console.error(
      `[BOT-WA-WEBHOOK] Supabase GET gagal (${pathWithQuery.split('?')[0]}) status=${firstAttempt.status} mode=${authMode} detail=${firstAttempt.errorText || '-'}`
    );
  }

  return { ok: firstAttempt.ok, status: firstAttempt.status, data: firstAttempt.data };
}

async function supabaseRestGet<T>(
  pathWithQuery: string,
  options?: { retryNonEmptyOnAnon?: boolean }
): Promise<T[]> {
  const res = await supabaseRestGetWithStatus<T>(pathWithQuery, options);
  return res.data;
}

async function supabaseRestInsert(table: string, row: Record<string, unknown>): Promise<boolean> {
  const { url, key, authMode } = getSupabaseEnv();
  if (!url || !key) return false;

  const callers =
    authMode === 'service_role'
      ? ['andriansyah']
      : [cachedPengurusCaller, ...ACTIVE_PENGURUS_CALLERS.filter((c) => c !== cachedPengurusCaller)];

  for (let i = 0; i < (authMode === 'service_role' ? 1 : callers.length); i++) {
    const caller = callers[i];
    try {
      const res = await fetchWithTimeout(
        `${url}/rest/v1/${table}`,
        {
          method: 'POST',
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
            'x-user-role': 'admin',
            'x-admin-permission': 'full',
            'x-blok-rumah': caller,
          },
          body: JSON.stringify(row),
        },
        SUPABASE_TIMEOUT_MS
      );
      if (res.ok) {
        cachedPengurusCaller = caller;
        return true;
      }
      if (res.status !== 401 && res.status !== 403) {
        const errText = await res.text().catch(() => '');
        console.error(
          `[BOT-WA-WEBHOOK] Supabase INSERT ${table} gagal status=${res.status} detail=${errText.slice(0, 140)}`
        );
        return false;
      }
    } catch (err) {
      console.error(
        `[BOT-WA-WEBHOOK] Supabase INSERT ${table} exception:`,
        err instanceof Error ? err.message : err
      );
      return false;
    }
  }
  return false;
}

async function fetchAllUsersWarga(): Promise<WargaRow[]> {
  const fullSelect =
    'id,blok_rumah,nama_warga,no_wa,secondary_whatsapp,status_hunian,nominal_iuran,pin_akses,role,bot_role,jabatan,admin_permission,aktif';
  const resFull = await supabaseRestGetWithStatus<WargaRow>(`users_warga?select=${fullSelect}`, {
    retryNonEmptyOnAnon: true,
  });
  if (resFull.ok && resFull.data.length > 0) return resFull.data;

  // Fallback jika kolom secondary_whatsapp / bot_role belum ditambahkan di database
  const basicSelect =
    'id,blok_rumah,nama_warga,no_wa,status_hunian,nominal_iuran,pin_akses,role,jabatan,admin_permission,aktif';
  return supabaseRestGet<WargaRow>(`users_warga?select=${basicSelect}`, {
    retryNonEmptyOnAnon: true,
  });
}

interface AuthenticatedSender {
  found: boolean;
  role: EffectiveBotRole;
  unit: WargaRow | null;
  displayBlock: string;
  displayName: string;
}

async function authenticateSender(cleanSender: string): Promise<AuthenticatedSender> {
  if (!isRealRegisteredPhone(cleanSender)) {
    return {
      found: false,
      role: 'warga',
      unit: null,
      displayBlock: 'UNREGISTERED',
      displayName: 'Tidak Terdaftar',
    };
  }

  const [allRows, appSettings] = await Promise.all([
    fetchAllUsersWarga(),
    supabaseRestGet<AppSettingsRow>('app_settings?select=wa_pengurus,pengurus_wa_map&limit=1', {
      retryNonEmptyOnAnon: true,
    }),
  ]);

  const residentRows = allRows.filter((r) => !r.role || r.role === 'warga');
  const adminRows = allRows.filter((r) => r.role === 'admin' || r.role === 'bendahara');

  // 1. Cek kecocokan di daftar unit warga (no_wa atau secondary_whatsapp)
  const matchedResident = residentRows.find((w) => {
    if (w.aktif === false) return false;
    const p1 = normalizePhoneNumber(w.no_wa);
    const p2 = normalizePhoneNumber(w.secondary_whatsapp);
    return (
      (isRealRegisteredPhone(p1) && p1 === cleanSender) ||
      (isRealRegisteredPhone(p2) && p2 === cleanSender)
    );
  });

  // 2. Cek apakah nomor termasuk pengurus di adminRows atau pengurus_wa_map
  const matchedAdminRow = adminRows.find((a) => {
    if (a.aktif === false) return false;
    const p1 = normalizePhoneNumber(a.no_wa);
    const p2 = normalizePhoneNumber(a.secondary_whatsapp);
    return (
      (isRealRegisteredPhone(p1) && p1 === cleanSender) ||
      (isRealRegisteredPhone(p2) && p2 === cleanSender)
    );
  });

  const waMap = appSettings[0]?.pengurus_wa_map || {};
  let matchedPengurusMeta: (typeof SUSUNAN_PENGURUS)[number] | undefined;
  for (const p of SUSUNAN_PENGURUS) {
    const mappedWa = normalizePhoneNumber(waMap[p.username]);
    if (isRealRegisteredPhone(mappedWa) && mappedWa === cleanSender) {
      matchedPengurusMeta = p;
      break;
    }
  }

  const bendaharaMainWa = normalizePhoneNumber(appSettings[0]?.wa_pengurus);
  const isBendaharaMainWa = isRealRegisteredPhone(bendaharaMainWa) && bendaharaMainWa === cleanSender;

  if (matchedResident) {
    let effectiveRole: EffectiveBotRole = 'warga';
    if (
      matchedResident.bot_role === 'bendahara' ||
      matchedAdminRow?.role === 'bendahara' ||
      matchedAdminRow?.jabatan === 'Bendahara' ||
      matchedAdminRow?.admin_permission === 'full' ||
      matchedPengurusMeta?.role === 'bendahara' ||
      isBendaharaMainWa
    ) {
      effectiveRole = 'bendahara';
    } else if (
      matchedResident.bot_role === 'admin' ||
      matchedAdminRow ||
      matchedPengurusMeta
    ) {
      effectiveRole = 'admin';
    }

    return {
      found: true,
      role: effectiveRole,
      unit: matchedResident,
      displayBlock: normalizeBlockCode(matchedResident.blok_rumah),
      displayName: matchedResident.nama_warga,
    };
  }

  if (matchedAdminRow || matchedPengurusMeta || isBendaharaMainWa) {
    const effectiveRole: EffectiveBotRole =
      matchedAdminRow?.role === 'bendahara' ||
      matchedAdminRow?.jabatan === 'Bendahara' ||
      matchedAdminRow?.admin_permission === 'full' ||
      matchedPengurusMeta?.role === 'bendahara' ||
      isBendaharaMainWa
        ? 'bendahara'
        : 'admin';

    const linkedMeta =
      matchedPengurusMeta ||
      SUSUNAN_PENGURUS.find(
        (p) => p.username.toLowerCase() === String(matchedAdminRow?.blok_rumah || '').toLowerCase()
      );
    const linkedResident = linkedMeta
      ? residentRows.find((w) => isSameBlockCode(w.blok_rumah, linkedMeta.blok)) || null
      : null;

    return {
      found: true,
      role: effectiveRole,
      unit: linkedResident,
      displayBlock: linkedResident
        ? normalizeBlockCode(linkedResident.blok_rumah)
        : linkedMeta
          ? normalizeBlockCode(linkedMeta.blok)
          : 'PENGURUS',
      displayName:
        matchedAdminRow?.nama_warga ||
        linkedMeta?.nama ||
        (effectiveRole === 'bendahara' ? 'Bendahara Lingkungan' : 'Pengurus Lingkungan'),
    };
  }

  return {
    found: false,
    role: 'warga',
    unit: null,
    displayBlock: 'UNREGISTERED',
    displayName: 'Tidak Terdaftar',
  };
}

function buildUnregisteredRejectionReply(): string {
  return [
    `*Akses Ditolak – Nomor Belum Terdaftar*`,
    ``,
    `Mohon maaf, nomor WhatsApp Anda belum terhubung dengan unit rumah mana pun di sistem *e-Card IPL Digital Perumahan Saung Kebun*.`,
    ``,
    `Silakan hubungi Pengurus Lingkungan (Ketua/Bendahara) untuk mendaftarkan nomor WhatsApp Anda agar dapat mengecek status iuran unit Anda secara mandiri.`,
  ].join('\n');
}

function buildPrivacyRejectionReply(ownBlockCode: string): string {
  return [
    `*Akses Ditolak (Privasi Terlindungi)*`,
    ``,
    `Demi menjaga kerahasiaan data warga Perumahan Saung Kebun, nomor WhatsApp Anda hanya terdaftar untuk unit *${ownBlockCode}* dan tidak diizinkan mengakses data unit lain.`,
    ``,
    `Ketik *CEK* untuk melihat status iuran unit Anda sendiri.`,
  ].join('\n');
}

function buildPersonalizedMenuReply(auth: AuthenticatedSender): string {
  const isPrivileged = auth.role === 'admin' || auth.role === 'bendahara';
  const lines = [
    `*Layanan Bot e-Card IPL – Perumahan Saung Kebun*`,
    `Unit Terdaftar: *${auth.displayBlock}* (${auth.displayName})`,
    ``,
    `Silakan ketik perintah berikut:`,
    `• *CEK* — Melihat status & rincian tagihan IPL unit Anda`,
    `• *SALDO* — Melihat rekap lunas & tunggakan 12 bulan unit Anda`,
    `• *REKENING* — Melihat informasi pembayaran QRIS & Transfer`,
    `• *MENU* — Menampilkan panduan ini`,
  ];

  if (isPrivileged) {
    lines.push(`• *CEK#[KODE_BLOK]* — (Akses Pengurus) Cek status unit warga untuk penagihan`);
  }

  lines.push(``);
  lines.push(`Portal Warga: ${APP_PORTAL_URL}`);
  return lines.join('\n');
}

async function buildUnitStatusCekReply(targetUnit: WargaRow): Promise<string> {
  const currentMonth = getCurrentMonth();
  const bulanNama = `${BULAN_NAMA[currentMonth - 1]} ${TAHUN_AKTIF}`;
  const formattedBlock = normalizeBlockCode(targetUnit.blok_rumah);
  const nominalBulanan = targetUnit.nominal_iuran || NOMINAL_DEFAULT;

  const allYearStatus = await supabaseRestGet<StatusRow>(
    `status_ecard_bulanan?select=blok_rumah,tahun,bulan,status&tahun=eq.${TAHUN_AKTIF}`
  );
  const unitYearRows = allYearStatus.filter((s) => isSameBlockCode(s.blok_rumah, targetUnit.blok_rumah));
  const matchedStatus = unitYearRows.find((s) => s.bulan === currentMonth);
  const statusBulan = matchedStatus?.status || getDefaultUnpaidStatus(currentMonth);

  const unpaidUpToNow: string[] = [];
  for (let m = 1; m <= currentMonth; m++) {
    const found = unitYearRows.find((s) => s.bulan === m);
    const st = found?.status || getDefaultUnpaidStatus(m);
    if (st !== 'Lunas' && st !== 'Menunggu Verifikasi') {
      unpaidUpToNow.push(BULAN_SINGKAT[m - 1]);
    }
  }

  let latestReceiptNo = '';
  if (statusBulan === 'Lunas') {
    const verifiedTrx = await supabaseRestGet<TransaksiKwitansiRow>(
      `transaksi_ipl?select=no_kwitansi,blok_rumah,tahun,bulan_dibayar,status_verifikasi&tahun=eq.${TAHUN_AKTIF}&status_verifikasi=eq.Terverifikasi&order=tanggal_setor.desc&limit=50`
    );
    const matchedTrx = verifiedTrx.find(
      (t) =>
        isSameBlockCode(t.blok_rumah, targetUnit.blok_rumah) &&
        (!Array.isArray(t.bulan_dibayar) || t.bulan_dibayar.includes(currentMonth))
    );
    latestReceiptNo = matchedTrx?.no_kwitansi || '';
  }

  const lines = [
    `*Status e-Card IPL — Unit ${formattedBlock}*`,
    `Nama: ${targetUnit.nama_warga}`,
    `Periode: *${bulanNama}*`,
    `Status: *${statusBulan.toUpperCase()}*`,
    `Nominal Iuran: ${formatRupiah(nominalBulanan)} / bulan`,
    `Jatuh Tempo: Tanggal 7`,
  ];

  if (latestReceiptNo) {
    lines.push(`No. Kwitansi: *${latestReceiptNo}*`);
  }

  if (unpaidUpToNow.length > 0 && statusBulan !== 'Lunas') {
    lines.push(
      `Tunggakan s.d. ${BULAN_SINGKAT[currentMonth - 1]}: *${unpaidUpToNow.length} bulan* (${unpaidUpToNow.join(', ')}) · Total *${formatRupiah(unpaidUpToNow.length * nominalBulanan)}*`
    );
  }

  lines.push(``);
  lines.push(
    statusBulan === 'Lunas'
      ? `Terima kasih, iuran bulan ${bulanNama} sudah *LUNAS*. Kwitansi tersedia di ${APP_PORTAL_URL}`
      : `Silakan setor via QRIS / Transfer Bank / Titip Pengurus di ${APP_PORTAL_URL} atau ketik *REKENING* untuk melihat rekening resmi.`
  );

  return lines.join('\n');
}

async function buildUnitSaldoReply(targetUnit: WargaRow, tahun: number): Promise<string> {
  const formattedBlock = normalizeBlockCode(targetUnit.blok_rumah);
  const allYearStatus = await supabaseRestGet<StatusRow>(
    `status_ecard_bulanan?select=blok_rumah,tahun,bulan,status&tahun=eq.${tahun}`
  );
  const unitRows = allYearStatus.filter((s) => isSameBlockCode(s.blok_rumah, targetUnit.blok_rumah));

  const currentMonth = getCurrentMonth();
  let lunas = 0;
  let pending = 0;
  const unpaid: string[] = [];

  for (let m = 1; m <= 12; m++) {
    const found = unitRows.find((s) => s.bulan === m);
    const st = found?.status || getDefaultUnpaidStatus(m);
    if (st === 'Lunas') lunas += 1;
    else if (st === 'Menunggu Verifikasi') pending += 1;
    else if (m <= currentMonth) unpaid.push(BULAN_SINGKAT[m - 1]);
  }

  const totalTunggakan = unpaid.length * (targetUnit.nominal_iuran || NOMINAL_DEFAULT);

  return [
    `*Rekap Saldo IPL ${tahun} — Unit ${formattedBlock}*`,
    `Nama: ${targetUnit.nama_warga}`,
    `• Lunas: *${lunas} bulan*`,
    `• Menunggu Verifikasi: *${pending} bulan*`,
    `• Belum Bayar (s.d. ${BULAN_NAMA[currentMonth - 1]}): *${unpaid.length} bulan*${
      unpaid.length > 0 ? ` (${unpaid.join(', ')})` : ''
    }`,
    `• Estimasi Kewajiban: *${formatRupiah(totalTunggakan)}*`,
    ``,
    `Detail lengkap 12 bulan & kwitansi: ${APP_PORTAL_URL}`,
  ].join('\n');
}

function parseRekeningList(raw: unknown): RekeningItem[] {
  let list: unknown = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      bank: String(item.bank || '').trim(),
      nomor: String(item.nomor || '').trim(),
      atasNama: String(item.atasNama || item.atas_nama || '').trim(),
      tipe: String(item.tipe || 'Transfer Bank').trim(),
    }))
    .filter((item) => item.bank.length > 0 && item.nomor.length > 0);
}

async function buildRekeningReply(): Promise<string> {
  let configs = await supabaseRestGet<PaymentConfigRow>(
    'payment_config?select=*&id=eq.default-payment-config&limit=1',
    { retryNonEmptyOnAnon: true }
  );
  if (configs.length === 0) {
    configs = await supabaseRestGet<PaymentConfigRow>(
      'payment_config?select=*&order=updated_at.desc&limit=1',
      { retryNonEmptyOnAnon: true }
    );
  }

  const cfg = configs[0];
  const rekList = parseRekeningList(cfg?.rekening_list);
  const banks = rekList.filter((r) => r.tipe.toLowerCase() !== 'e-wallet');
  const ewallets = rekList.filter((r) => r.tipe.toLowerCase() === 'e-wallet');

  const lines = [
    `*Info Pembayaran Resmi IPL Perumahan Saung Kebun*`,
    `Iuran Wajib: ${formatRupiah(NOMINAL_DEFAULT)} / bulan (Jatuh tempo tgl 7)`,
    ``,
  ];

  if (cfg?.qris_aktif && cfg?.qris_image_url) {
    lines.push(`*Via QRIS Resmi:* ${cfg.qris_label || 'QRIS Kas Lingkungan Saung Kebun'}`);
    lines.push(`Buka ${APP_PORTAL_URL} → Menu Setor → Pilih *Via QR / QRIS* untuk scan kode QRIS.`);
    lines.push(``);
  }

  if (banks.length > 0) {
    lines.push(`*Transfer Bank:*`);
    banks.forEach((b) => {
      lines.push(`• *${b.bank}*: ${b.nomor}${b.atasNama ? ` (a.n. ${b.atasNama})` : ''}`);
    });
    lines.push(``);
  }

  if (ewallets.length > 0) {
    lines.push(`*E-Wallet:*`);
    ewallets.forEach((e) => {
      lines.push(`• *${e.bank}*: ${e.nomor}${e.atasNama ? ` (a.n. ${e.atasNama})` : ''}`);
    });
    lines.push(``);
  }

  if (banks.length === 0 && ewallets.length === 0) {
    lines.push(`*Transfer Bank:*`);
    lines.push(`• *Blu (BCA Digital)*: 006424363822 (a.n. Andriansyah)`);
    lines.push(``);
  }

  lines.push(`*Titip Pengurus:* Dapat diserahkan tunai ke Bendahara atau Pengurus Lingkungan resmi.`);
  lines.push(`Setelah pembayaran, unggah bukti setor di ${APP_PORTAL_URL} agar status e-Card otomatis diverifikasi.`);
  return lines.join('\n');
}

function parseCommandAndBlock(rawText: string): {
  command: string;
  targetBlockRaw: string;
  parts: string[];
} {
  const hashParts = rawText.split('#').map((s) => s.trim());
  let head = (hashParts[0] || '').toUpperCase();
  let targetBlockRaw = (hashParts[1] || '').trim();

  if (hashParts.length === 1) {
    const cekTagihanMatch = rawText.match(/^CEK\s+TAGIHAN(?:\s+(.+))?$/i);
    if (cekTagihanMatch) {
      return {
        command: 'CEK',
        targetBlockRaw: (cekTagihanMatch[1] || '').trim(),
        parts: ['CEK', (cekTagihanMatch[1] || '').trim()],
      };
    }

    const spaceMatch = rawText.match(/^(CEK|SALDO|TAGIHAN|IPL|STATUS)\s+(.+)$/i);
    if (spaceMatch) {
      head = spaceMatch[1].toUpperCase();
      targetBlockRaw = spaceMatch[2].trim();
      return {
        command: ['TAGIHAN', 'IPL', 'STATUS'].includes(head) ? 'CEK' : head,
        targetBlockRaw,
        parts: [head, targetBlockRaw],
      };
    }
  }

  if (['TAGIHAN', 'IPL', 'STATUS', 'CEK TAGIHAN'].includes(head)) {
    head = 'CEK';
  }

  return {
    command: head,
    targetBlockRaw,
    parts: hashParts,
  };
}

async function processAuthorizedMessage(
  rawText: string,
  auth: AuthenticatedSender
): Promise<{ command: string; blok: string; reply: string }> {
  const isPrivileged = auth.role === 'admin' || auth.role === 'bendahara';
  const ownBlockCode = auth.displayBlock;
  const { command, targetBlockRaw, parts } = parseCommandAndBlock(rawText);

  // 1. REKENING / BAYAR / QRIS
  if (['REKENING', 'BAYAR', 'NOREK', 'QRIS', 'QR'].includes(command)) {
    return {
      command: 'REKENING',
      blok: ownBlockCode,
      reply: await buildRekeningReply(),
    };
  }

  // 2. PENGURUS
  if (command === 'PENGURUS' || rawText.includes('SUSUNAN PENGURUS')) {
    const lines = SUSUNAN_PENGURUS.map((p) => `• *${p.jabatan}*: ${p.nama}`);
    return {
      command: 'PENGURUS',
      blok: ownBlockCode,
      reply: [
        `*Susunan Pengurus Lingkungan Perumahan Saung Kebun*`,
        `Sekretariat: Blok B03/07 · Desa Bengle, Kec. Majalaya, Karawang`,
        ``,
        ...lines,
        ``,
        `Portal resmi: ${APP_PORTAL_URL}`,
      ].join('\n'),
    };
  }

  // 3. MENU / BANTUAN / INFO / SALAM
  if (
    ['MENU', 'BANTUAN', 'INFO', 'HELP', 'BOT', 'HALO', 'HELLO', 'HAI', 'ASSALAMUALAIKUM', 'P', 'START'].includes(
      rawText
    ) ||
    command === 'MENU' ||
    command === 'HELP' ||
    command === 'INFO'
  ) {
    return {
      command: 'MENU',
      blok: ownBlockCode,
      reply: buildPersonalizedMenuReply(auth),
    };
  }

  // 4. BANTUAN#<TOPIK>...
  if (command === 'BANTUAN') {
    const topik = (parts[1] || 'UMUM').toUpperCase();
    const requestedBlockRaw = (parts[2] || '').trim();
    if (!isPrivileged && requestedBlockRaw && auth.unit && !isSameBlockCode(requestedBlockRaw, auth.unit.blok_rumah)) {
      return {
        command: 'PRIVACY_DENIED',
        blok: ownBlockCode,
        reply: buildPrivacyRejectionReply(ownBlockCode),
      };
    }

    return {
      command: 'BANTUAN',
      blok: ownBlockCode,
      reply: [
        `*Permintaan Bantuan Tercatat*`,
        `Topik: *${topik}* · Unit: *${ownBlockCode}* (${auth.displayName})`,
        ``,
        `Pesan Anda telah diteruskan ke *Bendahara & Pengurus Lingkungan Saung Kebun*. Mohon tunggu konfirmasi balasan pengurus.`,
      ].join('\n'),
    };
  }

  // 5. CEK / CEK TAGIHAN / TAGIHAN / IPL / STATUS / CEK#<BLOK>
  if (command === 'CEK') {
    const requestedBlock = normalizeBlockCode(targetBlockRaw);

    // Warga biasa mencoba mengecek blok lain -> BLOKIR KERAS sebelum menyentuh DB
    if (!isPrivileged && requestedBlock) {
      if (!auth.unit || !isSameBlockCode(requestedBlock, auth.unit.blok_rumah)) {
        return {
          command: 'PRIVACY_DENIED',
          blok: ownBlockCode,
          reply: buildPrivacyRejectionReply(ownBlockCode),
        };
      }
    }

    // CEK tanpa parameter atau CEK blok sendiri
    if (!requestedBlock || (auth.unit && isSameBlockCode(requestedBlock, auth.unit.blok_rumah))) {
      if (auth.unit) {
        return {
          command: 'CEK',
          blok: ownBlockCode,
          reply: await buildUnitStatusCekReply(auth.unit),
        };
      }
      return {
        command: 'CEK',
        blok: ownBlockCode,
        reply: [
          `Akun Pengurus Anda belum terikat ke satu unit rumah spesifik.`,
          `Ketik *CEK#[KODE_BLOK]* untuk memeriksa status iuran warga.`,
        ].join('\n'),
      };
    }

    // Pengurus mengecek blok warga tertentu
    const allUnits = await fetchAllUsersWarga();
    const targetUnit = allUnits.find(
      (w) => (!w.role || w.role === 'warga') && isSameBlockCode(w.blok_rumah, requestedBlock)
    );

    if (!targetUnit) {
      return {
        command: 'CEK',
        blok: requestedBlock,
        reply: `Unit *${requestedBlock}* belum terdaftar di database Perumahan Saung Kebun. Mohon periksa kembali penulisan kode blok yang diminta.`,
      };
    }

    return {
      command: 'CEK',
      blok: normalizeBlockCode(targetUnit.blok_rumah),
      reply: await buildUnitStatusCekReply(targetUnit),
    };
  }

  // 6. SALDO atau SALDO#<BLOK>#<TAHUN>
  if (command === 'SALDO') {
    const requestedBlock = normalizeBlockCode(targetBlockRaw);
    const tahun = Number(parts[2]) || TAHUN_AKTIF;

    if (!isPrivileged && requestedBlock) {
      if (!auth.unit || !isSameBlockCode(requestedBlock, auth.unit.blok_rumah)) {
        return {
          command: 'PRIVACY_DENIED',
          blok: ownBlockCode,
          reply: buildPrivacyRejectionReply(ownBlockCode),
        };
      }
    }

    if (!requestedBlock || (auth.unit && isSameBlockCode(requestedBlock, auth.unit.blok_rumah))) {
      if (auth.unit) {
        return {
          command: 'SALDO',
          blok: ownBlockCode,
          reply: await buildUnitSaldoReply(auth.unit, tahun),
        };
      }
      return {
        command: 'SALDO',
        blok: ownBlockCode,
        reply: `Ketik *SALDO#[KODE_BLOK]#${TAHUN_AKTIF}* untuk melihat rekap iuran warga.`,
      };
    }

    const allUnits = await fetchAllUsersWarga();
    const targetUnit = allUnits.find(
      (w) => (!w.role || w.role === 'warga') && isSameBlockCode(w.blok_rumah, requestedBlock)
    );

    if (!targetUnit) {
      return {
        command: 'SALDO',
        blok: requestedBlock,
        reply: `Unit *${requestedBlock}* belum terdaftar di database Perumahan Saung Kebun.`,
      };
    }

    return {
      command: 'SALDO',
      blok: normalizeBlockCode(targetUnit.blok_rumah),
      reply: await buildUnitSaldoReply(targetUnit, tahun),
    };
  }

  // 7. SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]#[PENGURUS]
  if (command === 'SETOR') {
    const requestedBlock = normalizeBlockCode(parts[1] || '');
    const periode = (parts[2] || '').toUpperCase();
    const nominal = Number((parts[3] || '').replace(/\D/g, '')) || 0;
    const metodeRaw = (parts[4] || '').toUpperCase();
    const pengurus = parts[5] || '';

    // Warga tidak boleh melaporkan setor atas nama unit orang lain
    if (!isPrivileged && requestedBlock && auth.unit && !isSameBlockCode(requestedBlock, auth.unit.blok_rumah)) {
      return {
        command: 'PRIVACY_DENIED',
        blok: ownBlockCode,
        reply: buildPrivacyRejectionReply(ownBlockCode),
      };
    }

    if (!periode || nominal <= 0 || !metodeRaw) {
      return {
        command: 'SETOR',
        blok: ownBlockCode,
        reply: [
          `Format konfirmasi setor belum lengkap.`,
          `Gunakan: *SETOR#${ownBlockCode}#NOV${TAHUN_AKTIF}#100000#QRIS*`,
          `Atau unggah bukti transfer langsung di ${APP_PORTAL_URL}`,
        ].join('\n'),
      };
    }

    let targetUnit = auth.unit;
    if (isPrivileged && requestedBlock && (!targetUnit || !isSameBlockCode(requestedBlock, targetUnit.blok_rumah))) {
      const allUnits = await fetchAllUsersWarga();
      targetUnit =
        allUnits.find(
          (w) => (!w.role || w.role === 'warga') && isSameBlockCode(w.blok_rumah, requestedBlock)
        ) || null;
    }

    if (!targetUnit) {
      return {
        command: 'SETOR',
        blok: requestedBlock || ownBlockCode,
        reply: `Unit *${requestedBlock || ownBlockCode}* belum terdaftar di database Perumahan Saung Kebun.`,
      };
    }

    const monthCodeMap: Record<string, number> = {
      JAN: 1, FEB: 2, MAR: 3, APR: 4, MEI: 5, MAY: 5, JUN: 6,
      JUL: 7, AGU: 8, AUG: 8, SEP: 9, OKT: 10, OCT: 10, NOV: 11, DES: 12, DEC: 12,
    };
    const parsedMonths = new Set<number>();
    for (const [code, num] of Object.entries(monthCodeMap)) {
      if (periode.includes(code)) parsedMonths.add(num);
    }
    if (parsedMonths.size === 0) {
      const numMatch = periode.match(/\b(1[0-2]|0?[1-9])\b/);
      if (numMatch) parsedMonths.add(Number(numMatch[1]));
    }
    const bulanDibayar =
      parsedMonths.size > 0 ? Array.from(parsedMonths).sort((a, b) => a - b) : [getCurrentMonth()];

    const metodeNormalized = metodeRaw.includes('QR')
      ? 'QRIS'
      : metodeRaw.includes('TUNAI') || metodeRaw.includes('CASH') || metodeRaw.includes('TITIP')
        ? 'Setor Tunai'
        : metodeRaw.includes('DANA') || metodeRaw.includes('OVO') || metodeRaw.includes('GOPAY') || metodeRaw.includes('EWALLET')
          ? 'E-Wallet'
          : 'Transfer Bank';

    const nowIso = new Date().toISOString();
    const ymd = nowIso.slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(100 + Math.random() * 900);
    const blokClean = targetUnit.blok_rumah.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    const noKwitansi = `SKB/${ymd}/${blokClean}/WA${rand}`;

    await supabaseRestInsert('transaksi_ipl', {
      no_kwitansi: noKwitansi,
      blok_rumah: targetUnit.blok_rumah,
      nama_warga: targetUnit.nama_warga,
      tahun: TAHUN_AKTIF,
      bulan_dibayar: bulanDibayar,
      nominal,
      metode_bayar: metodeNormalized,
      petugas_penerima: metodeNormalized === 'Setor Tunai' ? pengurus || null : null,
      bukti_url: null,
      status_verifikasi: 'Pending',
      keterangan: `Dilaporkan via Bot WA (${periode}${pengurus ? ` · ${pengurus}` : ''})`,
      tanggal_setor: nowIso,
    });

    const formattedTarget = normalizeBlockCode(targetUnit.blok_rumah);
    return {
      command: 'SETOR',
      blok: formattedTarget,
      reply: [
        `*Laporan Setor IPL Tercatat di Antrean Verifikasi Admin*`,
        `Unit: *${formattedTarget}* (${targetUnit.nama_warga})`,
        `Periode: *${bulanDibayar.map((m) => BULAN_NAMA[m - 1]).join(', ')} ${TAHUN_AKTIF}*`,
        `Nominal: *${formatRupiah(nominal)}*`,
        `Metode: *${metodeNormalized}*${pengurus ? ` via ${pengurus}` : ''}`,
        `No. Ref: *${noKwitansi}*`,
        ``,
        `Setoran Anda sudah masuk ke antrean verifikasi Bendahara. Anda juga dapat mengunggah bukti foto di ${APP_PORTAL_URL}.`,
      ].join('\n'),
    };
  }

  // 8. VERIFIKASI#[BLOK]#[PIN]
  if (command === 'VERIFIKASI') {
    const requestedBlock = normalizeBlockCode(parts[1] || '');
    const cleanPin = (parts[2] || '').replace(/\D/g, '');

    if (!isPrivileged && requestedBlock && auth.unit && !isSameBlockCode(requestedBlock, auth.unit.blok_rumah)) {
      return {
        command: 'PRIVACY_DENIED',
        blok: ownBlockCode,
        reply: buildPrivacyRejectionReply(ownBlockCode),
      };
    }

    if (!auth.unit) {
      return {
        command: 'VERIFIKASI',
        blok: ownBlockCode,
        reply: `Nomor Anda terdaftar sebagai *${auth.displayName}* (${auth.role.toUpperCase()}).`,
      };
    }

    if (cleanPin && auth.unit.pin_akses && auth.unit.pin_akses !== cleanPin) {
      return {
        command: 'VERIFIKASI',
        blok: ownBlockCode,
        reply: `PIN untuk unit *${ownBlockCode}* tidak cocok. Hubungi Bendahara bila lupa PIN.`,
      };
    }

    return {
      command: 'VERIFIKASI',
      blok: ownBlockCode,
      reply: [
        `*Nomor WhatsApp Terverifikasi*`,
        `Unit Terdaftar: *${ownBlockCode}* (${auth.unit.nama_warga})`,
        `Status Hunian: ${auth.unit.status_hunian}`,
        `Iuran Wajib: ${formatRupiah(auth.unit.nominal_iuran || NOMINAL_DEFAULT)} / bulan`,
        ``,
        `Ketik *CEK* untuk cek tagihan bulan ini, atau buka:`,
        `${APP_PORTAL_URL}`,
      ].join('\n'),
    };
  }

  // Fallback untuk pesan tidak dikenal -> kirim panduan khusus unit pengirim
  return {
    command: 'MENU',
    blok: ownBlockCode,
    reply: buildPersonalizedMenuReply(auth),
  };
}

export default async function handler(req: VercelReq, res: VercelRes) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    const { authMode, url } = getSupabaseEnv();
    res.status(200).json({
      ok: true,
      service: 'saung-kebun-wa-auto-reply-strict-isolation',
      webhook_url: `${APP_PORTAL_URL}/api/bot-wa/webhook`,
      security: 'Strict Sender-to-Unit Isolation Active',
      supabase_configured: Boolean(url) && authMode !== 'missing',
      supabase_auth_mode: authMode,
      commands: ['CEK', 'CEK#<BLOK> (Pengurus)', 'SALDO', 'REKENING', 'BAYAR', 'MENU'],
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method tidak diizinkan.' });
    return;
  }

  let stage = 'parse_body';

  try {
    const body = await parseIncomingBody(req);

    // Langkah A: Ekstraksi & Sanitasi Payload Fonnte / Wablas (JSON maupun x-www-form-urlencoded)
    const rawSender = String(
      body.sender || body.phone || body.from || body.pengirim || body.no_wa || body.hp || ''
    ).trim();
    const isGroup =
      body.isGroup === true ||
      String(body.isGroup || '').toLowerCase() === 'true' ||
      rawSender.toLowerCase().includes('@g.us') ||
      Boolean(body.member) ||
      Boolean(body.participant);
    const incomingText = String(
      body.message || body.pesan || body.text || body.msg || body.body || ''
    ).trim();
    const senderName = String(
      body.name || body.pushName || body.pushname || body.nama || 'Warga'
    ).trim();
    const dryRun =
      body.dryRun === true || String(body.dryRun || '').toLowerCase() === 'true';

    if (!incomingText || !rawSender) {
      res.status(200).json({
        ok: true,
        ignored: true,
        reason: 'Pesan atau pengirim kosong.',
        stage,
      });
      return;
    }

    if (isGroup) {
      res.status(200).json({
        ok: true,
        ignored: true,
        reason: 'Pesan grup diabaikan demi privasi warga.',
      });
      return;
    }

    const cleanSender = normalizePhoneNumber(rawSender);
    if (!cleanSender || cleanSender.length < 9) {
      res.status(200).json({
        ok: true,
        ignored: true,
        reason: 'Nomor pengirim tidak valid.',
      });
      return;
    }

    const rawText = incomingText.trim().toUpperCase();

    // Langkah B: Autentikasi Pengirim di Database
    stage = 'authenticate_sender';
    const auth = await authenticateSender(cleanSender);

    stage = 'build_reply';
    let replyResult: { command: string; blok: string; reply: string };
    if (!auth.found) {
      replyResult = {
        command: 'UNREGISTERED',
        blok: 'UNREGISTERED',
        reply: buildUnregisteredRejectionReply(),
      };
    } else {
      replyResult = await processAuthorizedMessage(rawText, auth);
    }

    const { authMode } = getSupabaseEnv();

    if (dryRun) {
      res.status(200).json({
        ok: true,
        dryRun: true,
        sender: cleanSender,
        authenticated: auth.found,
        senderRole: auth.found ? auth.role : 'unregistered',
        supabaseAuthMode: authMode,
        command: replyResult.command,
        blok: replyResult.blok,
        reply: replyResult.reply,
      });
      return;
    }

    // Langkah C: Ambil konfigurasi gateway dari bot_wa_config atau env
    stage = 'load_gateway_config';
    const configs = await supabaseRestGet<BotConfigRow>(
      'bot_wa_config?select=aktif,provider,api_endpoint,api_token&limit=1',
      { retryNonEmptyOnAnon: true }
    );
    const dbCfg = configs[0];

    if (dbCfg && dbCfg.aktif === false) {
      console.info(
        `[BOT-WA-WEBHOOK] Bot nonaktif, balasan tidak dikirim. sender=${cleanSender} cmd=${replyResult.command}`
      );
      res.status(200).json({
        ok: true,
        sent: false,
        command: replyResult.command,
        reason: 'Bot WA dalam status nonaktif pada pengaturan Admin.',
      });
      return;
    }

    const token =
      sanitizeSecret(dbCfg?.api_token) ||
      sanitizeSecret(process.env.FONNTE_TOKEN) ||
      sanitizeSecret(process.env.BOT_WA_TOKEN);
    const provider = dbCfg?.provider === 'Wablas' ? 'Wablas' : 'Fonnte';
    const defaultEndpoint =
      provider === 'Wablas'
        ? 'https://pati.wablas.com/api/send-message'
        : 'https://api.fonnte.com/send';
    const candidateEndpoint = sanitizeSecret(dbCfg?.api_endpoint);
    const endpoint = isAllowedGatewayEndpoint(candidateEndpoint)
      ? candidateEndpoint
      : defaultEndpoint;

    if (!token) {
      const reason = 'API Token Fonnte belum tersimpan di bot_wa_config atau env FONNTE_TOKEN.';
      console.error(`[BOT-WA-WEBHOOK] ${reason} sender=${cleanSender} mode=${authMode}`);
      await supabaseRestInsert('bot_wa_logs', {
        blok_rumah: replyResult.blok || 'BOT-WA',
        nama_warga: auth.found ? auth.displayName : senderName,
        no_wa: cleanSender,
        jenis_pesan: `Auto-Reply (${replyResult.command})`,
        status_kirim: 'Gagal',
        respon_gateway: `CONFIG_MISSING — ${reason}`,
        pesan: `Masuk: ${incomingText.slice(0, 120)}\n---\nBalasan: ${replyResult.reply.slice(0, 500)}`,
      });
      res.status(200).json({
        ok: false,
        sent: false,
        command: replyResult.command,
        blok: replyResult.blok,
        supabaseAuthMode: authMode,
        reason,
      });
      return;
    }

    // Langkah D: Kirim Balasan ke Gateway WA (dengan timeout & diagnosa jelas)
    stage = 'send_gateway';
    let statusKirim: 'Terkirim' | 'Gagal' = 'Gagal';
    let responGateway = '';

    try {
      const payload =
        provider === 'Wablas'
          ? { phone: cleanSender, message: replyResult.reply }
          : { target: cleanSender, message: replyResult.reply, countryCode: '62' };

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

      const gatewayText = await gatewayRes.text();
      let parsed: { status?: boolean; reason?: string; detail?: string; message?: string } | null = null;
      try {
        parsed = JSON.parse(gatewayText) as {
          status?: boolean;
          reason?: string;
          detail?: string;
          message?: string;
        };
      } catch {
        parsed = null;
      }

      const ok = gatewayRes.ok && parsed?.status !== false;
      statusKirim = ok ? 'Terkirim' : 'Gagal';
      const detail =
        parsed?.reason || parsed?.detail || parsed?.message || gatewayText || 'OK';
      responGateway = `${gatewayRes.status} — ${String(detail).slice(0, 140)}`;
    } catch (err) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? `Timeout ${GATEWAY_TIMEOUT_MS}ms menghubungi gateway ${provider}`
          : err instanceof Error
            ? err.message
            : 'Network error';
      responGateway = msg.slice(0, 140);
    }

    console.info(
      `[BOT-WA-WEBHOOK] provider=${provider} mode=${authMode} sender=${cleanSender} blok=${replyResult.blok} cmd=${replyResult.command} status=${statusKirim} detail=${responGateway}`
    );

    stage = 'write_log';
    await supabaseRestInsert('bot_wa_logs', {
      blok_rumah: replyResult.blok || 'BOT-WA',
      nama_warga: auth.found ? auth.displayName : senderName,
      no_wa: cleanSender,
      jenis_pesan: `Auto-Reply (${replyResult.command})`,
      status_kirim: statusKirim,
      respon_gateway: responGateway,
      pesan: `Masuk: ${incomingText.slice(0, 120)}\n---\nBalasan: ${replyResult.reply.slice(0, 500)}`,
    });

    res.status(200).json({
      ok: statusKirim === 'Terkirim',
      sent: statusKirim === 'Terkirim',
      provider,
      supabaseAuthMode: authMode,
      command: replyResult.command,
      blok: replyResult.blok,
      respon_gateway: responGateway,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Internal webhook error';
    console.error(`[BOT-WA-WEBHOOK] Unhandled exception stage=${stage}:`, errorMsg);
    res.status(200).json({
      ok: false,
      sent: false,
      stage,
      error: errorMsg,
    });
  }
}
