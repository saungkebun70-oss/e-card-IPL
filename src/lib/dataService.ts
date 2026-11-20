import {
  APP_PORTAL_URL,
  DEFAULT_APP_BRAND_CONFIG,
  isBendaharaFullAccess,
  NOMINAL_IPL_STANDAR,
  SUSUNAN_PENGURUS,
  TAHUN_AKTIF,
  WA_ACCESS_TEMPLATE_DEFAULT,
  type AdminJabatan,
  type AdminPermission,
  type AppBrandConfig,
  type BotWaConfig,
  type BotWaLog,
  type MetodeBayar,
  type NotificationCategory,
  type NotificationTargetScope,
  type PaymentConfig,
  type PengurusAccountInfo,
  type SessionUser,
  type StatusEcardBulanan,
  type StatusHunian,
  type StatusVerifikasi,
  type SystemNotification,
  type TransaksiIPL,
  type Warga,
} from '../types';
import { recordAuditLog } from './auditLogger';
import {
  canonicalizeBlokKey,
  formatDaftarBulan,
  formatRupiah,
  generateKwitansiNumber,
  generateRandomPin,
  getCurrentBillingMonth,
  getDefaultUnpaidStatusForMonth,
  getNamaBulan,
  normalizeBlok,
  normalizeWaNumber,
} from './format';
import {
  buildInitialStatusBulanan,
  LOCAL_ADMIN_ACCOUNTS,
  SEED_BOT_WA_CONFIG,
  SEED_BOT_WA_LOGS,
  SEED_PAYMENT_CONFIG,
  SEED_TRANSAKSI,
  SEED_WARGA,
} from './seedData';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

const STORAGE_KEYS = {
  SESSION_LEGACY: 'saungkebun_session_v1',
  SESSION_WARGA: 'saungkebun_session_warga_v1',
  SESSION_ADMIN: 'saungkebun_session_admin_v1',
  WARGA: 'saungkebun_warga_v2',
  TRANSAKSI: 'saungkebun_transaksi_v2',
  STATUS: 'saungkebun_status_v2',
  BOT_CONFIG: 'saungkebun_bot_config_v1',
  BOT_LOGS: 'saungkebun_bot_logs_v1',
  LOGIN_ATTEMPTS: 'saungkebun_login_attempts_v1',
  SYSTEM_NOTIFICATIONS: 'saungkebun_system_notifications_v1',
  PAYMENT_CONFIG: 'saungkebun_payment_config_v1',
  BRAND_CONFIG: 'saungkebun_brand_config_v1',
} as const;

const memoryStorageFallback = new Map<string, string>();

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryStorageFallback.get(key) ?? null;
  }
}

function safeStorageSet(key: string, value: string) {
  memoryStorageFallback.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Aman untuk iOS Safari Private Mode / WebView dengan kuota terbatas
  }
}

function safeStorageRemove(key: string) {
  memoryStorageFallback.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Abaikan
  }
}

const MAX_FAILED_PIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 menit

interface LoginAttemptRecord {
  failedCount: number;
  lockedUntil: number | null;
}

function getAttemptMap(): Record<string, LoginAttemptRecord> {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.LOGIN_ATTEMPTS);
    return raw ? (JSON.parse(raw) as Record<string, LoginAttemptRecord>) : {};
  } catch {
    return {};
  }
}

function checkLocalLockout(accountKey: string): string | null {
  const map = getAttemptMap();
  const rec = map[accountKey];
  if (rec?.lockedUntil && rec.lockedUntil > Date.now()) {
    const remainingSec = Math.ceil((rec.lockedUntil - Date.now()) / 1000);
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    const label = mins > 0 ? `${mins} menit ${secs} detik` : `${secs} detik`;
    return `Terlalu banyak percobaan PIN salah. Akun dikunci sementara selama ${label}.`;
  }
  return null;
}

function registerLocalFailedAttempt(accountKey: string): string | null {
  const map = getAttemptMap();
  const prev = map[accountKey]?.failedCount || 0;
  const next = prev + 1;
  if (next >= MAX_FAILED_PIN_ATTEMPTS) {
    map[accountKey] = { failedCount: 0, lockedUntil: Date.now() + LOCKOUT_DURATION_MS };
    safeStorageSet(STORAGE_KEYS.LOGIN_ATTEMPTS, JSON.stringify(map));
    return 'Terlalu banyak percobaan PIN salah (5 kali). Silakan tunggu 5 menit sebelum mencoba lagi.';
  }
  map[accountKey] = { failedCount: next, lockedUntil: null };
  safeStorageSet(STORAGE_KEYS.LOGIN_ATTEMPTS, JSON.stringify(map));
  return null;
}

function clearLocalAttempts(accountKey: string) {
  const map = getAttemptMap();
  if (map[accountKey]) {
    delete map[accountKey];
    safeStorageSet(STORAGE_KEYS.LOGIN_ATTEMPTS, JSON.stringify(map));
  }
}

export interface ServiceResult<T> {
  data?: T;
  error?: string;
}

function parseFriendlyError(err: unknown, fallbackMessage: string): string {
  if (!err) return fallbackMessage;
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed')) {
      return 'Koneksi internet terganggu atau server Supabase tidak dapat dijangkau. Silakan periksa jaringan Anda dan coba kembali.';
    }
    return err.message || fallbackMessage;
  }
  const maybeObj = err as { message?: string };
  if (maybeObj.message) {
    if (maybeObj.message.toLowerCase().includes('failed to fetch')) {
      return 'Koneksi internet terganggu atau server Supabase tidak dapat dijangkau. Silakan coba lagi.';
    }
    return maybeObj.message;
  }
  return fallbackMessage;
}

// =========================================================================
// Manajemen Penyimpanan Lokal (Fallback Bersih Jika Env Supabase Belum Diisi)
// =========================================================================

function ensureLocalStoreInitialized() {
  if (!safeStorageGet(STORAGE_KEYS.WARGA)) {
    safeStorageSet(STORAGE_KEYS.WARGA, JSON.stringify(SEED_WARGA));
  }
  if (!safeStorageGet(STORAGE_KEYS.TRANSAKSI)) {
    safeStorageSet(STORAGE_KEYS.TRANSAKSI, JSON.stringify(SEED_TRANSAKSI));
  }
  if (!safeStorageGet(STORAGE_KEYS.STATUS)) {
    const warga = JSON.parse(safeStorageGet(STORAGE_KEYS.WARGA) || '[]') as Warga[];
    const trx = JSON.parse(safeStorageGet(STORAGE_KEYS.TRANSAKSI) || '[]') as TransaksiIPL[];
    safeStorageSet(STORAGE_KEYS.STATUS, JSON.stringify(buildInitialStatusBulanan(warga, trx)));
  }
  if (!safeStorageGet(STORAGE_KEYS.BOT_CONFIG)) {
    safeStorageSet(STORAGE_KEYS.BOT_CONFIG, JSON.stringify(SEED_BOT_WA_CONFIG));
  }
  if (!safeStorageGet(STORAGE_KEYS.BOT_LOGS)) {
    safeStorageSet(STORAGE_KEYS.BOT_LOGS, JSON.stringify(SEED_BOT_WA_LOGS));
  }
}

function readLocal<T>(key: string, fallback: T): T {
  ensureLocalStoreInitialized();
  try {
    const raw = safeStorageGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  safeStorageSet(key, JSON.stringify(value));
}

function syncLocalStatusForHouse(blokRumah: string) {
  const allStatus = readLocal<StatusEcardBulanan[]>(STORAGE_KEYS.STATUS, []);
  const allTrx = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, []).filter(
    (t) => t.blok_rumah === blokRumah && t.tahun === TAHUN_AKTIF
  );
  const nowIso = new Date().toISOString();

  const otherHouses = allStatus.filter((s) => !(s.blok_rumah === blokRumah && s.tahun === TAHUN_AKTIF));
  const rebuilt: StatusEcardBulanan[] = [];

  for (let bulan = 1; bulan <= 12; bulan++) {
    const verified = allTrx.find(
      (t) => t.status_verifikasi === 'Terverifikasi' && t.bulan_dibayar.includes(bulan)
    );
    const pending = allTrx.find(
      (t) => t.status_verifikasi === 'Pending' && t.bulan_dibayar.includes(bulan)
    );
    let status = getDefaultUnpaidStatusForMonth(bulan);
    let transaksi_id: string | null = null;
    if (verified) {
      status = 'Lunas';
      transaksi_id = verified.id;
    } else if (pending) {
      status = 'Menunggu Verifikasi';
      transaksi_id = pending.id;
    }
    rebuilt.push({
      id: `st-${blokRumah}-${TAHUN_AKTIF}-${bulan}`,
      blok_rumah: blokRumah,
      tahun: TAHUN_AKTIF,
      bulan,
      status,
      transaksi_id,
      updated_at: nowIso,
    });
  }

  writeLocal(STORAGE_KEYS.STATUS, [...otherHouses, ...rebuilt]);
}

// =========================================================================
// Sesi Autentikasi Terisolasi per Portal (Warga vs Admin/Pengurus)
// =========================================================================

function getSessionKeyForRole(role: 'warga' | 'admin'): string {
  return role === 'admin' ? STORAGE_KEYS.SESSION_ADMIN : STORAGE_KEYS.SESSION_WARGA;
}

function hydrateAdminSession(session: SessionUser): SessionUser {
  if (session.role !== 'admin') return session;
  const key = session.blok_rumah.trim().toLowerCase();
  const pengurusMeta = SUSUNAN_PENGURUS.find((p) => p.username.toLowerCase() === key);
  const isDefaultBendahara = key === 'admin' || key === 'andriansyah';
  const resolvedJabatan =
    session.jabatan || pengurusMeta?.jabatan || (isDefaultBendahara ? 'Bendahara' : 'Bendahara');
  const resolvedPerm: AdminPermission =
    session.admin_permission ||
    pengurusMeta?.permission ||
    (isDefaultBendahara || resolvedJabatan === 'Bendahara' ? 'full' : 'add_only');
  return {
    ...session,
    jabatan: resolvedJabatan,
    admin_permission: resolvedPerm,
  };
}

export function loadStoredSession(expectedRole?: 'warga' | 'admin'): SessionUser | null {
  try {
    if (expectedRole) {
      const roleKey = getSessionKeyForRole(expectedRole);
      const raw = safeStorageGet(roleKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionUser;
        if (parsed?.role === expectedRole && parsed?.blok_rumah) {
          return hydrateAdminSession(parsed);
        }
      }
      // Migrasi mulus dari key sesi lama jika role-nya cocok dengan portal saat ini
      const legacyRaw = safeStorageGet(STORAGE_KEYS.SESSION_LEGACY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw) as SessionUser;
        if (legacy?.role === expectedRole && legacy?.blok_rumah) {
          const hydrated = hydrateAdminSession(legacy);
          safeStorageSet(roleKey, JSON.stringify(hydrated));
          safeStorageRemove(STORAGE_KEYS.SESSION_LEGACY);
          return hydrated;
        }
      }
      return null;
    }

    const fallbackRaw =
      safeStorageGet(STORAGE_KEYS.SESSION_WARGA) ||
      safeStorageGet(STORAGE_KEYS.SESSION_ADMIN) ||
      safeStorageGet(STORAGE_KEYS.SESSION_LEGACY);
    if (!fallbackRaw) return null;
    const parsed = JSON.parse(fallbackRaw) as SessionUser;
    if (!parsed?.role || !parsed?.blok_rumah) return null;
    return hydrateAdminSession(parsed);
  } catch {
    return null;
  }
}

export function saveStoredSession(session: SessionUser) {
  safeStorageSet(getSessionKeyForRole(session.role), JSON.stringify(session));
  safeStorageRemove(STORAGE_KEYS.SESSION_LEGACY);
}

export function clearStoredSession(session?: SessionUser | null, roleOverride?: 'warga' | 'admin') {
  const targetRole = roleOverride || session?.role;
  if (session) {
    void recordAuditLog({
      session,
      action: 'LOGOUT',
      entity: 'auth',
      entity_id: session.blok_rumah,
      summary: `${session.nama_warga} (${session.blok_rumah}) keluar dari portal ${session.role}.`,
    });
  }
  if (targetRole) {
    safeStorageRemove(getSessionKeyForRole(targetRole));
  } else {
    safeStorageRemove(STORAGE_KEYS.SESSION_WARGA);
    safeStorageRemove(STORAGE_KEYS.SESSION_ADMIN);
  }
  safeStorageRemove(STORAGE_KEYS.SESSION_LEGACY);
}

function buildWargaBlokCandidates(input: string): string[] {
  const rawNormalized = normalizeBlok(input).replace(/-/g, '/');
  if (!rawNormalized) return [];
  const candidates = [rawNormalized];
  const unpaddedMatch = rawNormalized.match(/^([A-Z]+)0*(\d+)\/0*(\d+)$/);
  if (unpaddedMatch) {
    const canonical = `${unpaddedMatch[1]}${unpaddedMatch[2]}/${unpaddedMatch[3]}`;
    if (!candidates.includes(canonical)) {
      candidates.unshift(canonical);
    }
  }
  return candidates;
}

function resolvePengurusAdminUsername(input: string): string {
  const trimmed = input.trim();
  const compact = trimmed.toLowerCase().replace(/[\s.]+/g, '');
  if (!compact) return '';

  // Cocokkan langsung dengan daftar resmi Pengurus (username, nama, atau blok rumah pengurus)
  const blokCandidate = buildWargaBlokCandidates(trimmed)[0] || '';
  const matchedPengurus = SUSUNAN_PENGURUS.find((p) => {
    const pengurusNameCompact = p.nama.toLowerCase().replace(/[\s.]+/g, '');
    const pengurusBlockCompact = normalizeBlok(p.blokRumah);
    return (
      p.username.toLowerCase() === compact ||
      pengurusNameCompact === compact ||
      (blokCandidate !== '' && pengurusBlockCompact === blokCandidate)
    );
  });

  if (matchedPengurus) {
    return matchedPengurus.username.toLowerCase();
  }

  return compact;
}

/**
 * Autentikasi khusus Portal Warga — terintegrasi ketat hanya dengan Akun Warga (role = 'warga').
 */
export async function loginWargaAccount(
  blokInput: string,
  pinInput: string
): Promise<ServiceResult<SessionUser>> {
  const cleanPin = pinInput.trim();
  const blokCandidates = buildWargaBlokCandidates(blokInput);
  const primaryBlok = blokCandidates[0] || '';

  if (!primaryBlok || !cleanPin) {
    return { error: 'Mohon lengkapi Blok/No. Rumah dan PIN 6 digit Anda.' };
  }

  if (cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
    return { error: 'PIN akses warga harus terdiri dari tepat 6 digit angka.' };
  }

  const supabase = getSupabaseClient(null);
  if (supabase && isSupabaseConfigured()) {
    try {
      let matchedRow: Record<string, unknown> | null = null;

      for (const candidateBlok of blokCandidates) {
        const { data, error } = await supabase.rpc('login_ecard', {
          p_blok: candidateBlok,
          p_pin: cleanPin,
        });

        if (error) {
          return { error: parseFriendlyError(error, 'Gagal memverifikasi akun warga ke server.') };
        }

        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
        if (row && typeof row.blok_rumah === 'string' && row.blok_rumah) {
          matchedRow = row;
          break;
        }
      }

      if (!matchedRow || typeof matchedRow.blok_rumah !== 'string') {
        await recordAuditLog({
          action: 'LOGIN_FAILED',
          entity: 'auth',
          entity_id: primaryBlok,
          summary: `Percobaan login Portal Warga gagal untuk blok "${primaryBlok}".`,
        });
        return {
          error: 'Blok/No. Rumah atau PIN 6 digit warga tidak sesuai. Silakan periksa kembali.',
        };
      }

      if (matchedRow.role === 'admin') {
        return {
          error: 'Akun ini bukan akun warga. Masukkan Blok/No. Rumah dan PIN akun warga Anda.',
        };
      }

      const session: SessionUser = {
        role: 'warga',
        blok_rumah: matchedRow.blok_rumah,
        nama_warga:
          (typeof matchedRow.nama_warga === 'string' && matchedRow.nama_warga) ||
          matchedRow.blok_rumah,
        status_hunian: matchedRow.status_hunian as StatusHunian | undefined,
        no_wa: typeof matchedRow.no_wa === 'string' ? matchedRow.no_wa : undefined,
        nominal_iuran:
          typeof matchedRow.nominal_iuran === 'number'
            ? matchedRow.nominal_iuran
            : NOMINAL_IPL_STANDAR,
        login_at: new Date().toISOString(),
      };
      saveStoredSession(session);
      await recordAuditLog({
        session,
        action: 'LOGIN_SUCCESS',
        entity: 'auth',
        entity_id: session.blok_rumah,
        summary: `Warga ${session.nama_warga} (${session.blok_rumah}) masuk ke Portal Warga.`,
      });
      return { data: session };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Terjadi kesalahan jaringan saat mencoba masuk.') };
    }
  }

  // Fallback Mode Lokal (Akun Warga) dengan Proteksi Brute-Force PIN
  ensureLocalStoreInitialized();
  const attemptKey = `warga:${primaryBlok.toLowerCase()}`;
  const lockMessage = checkLocalLockout(attemptKey);
  if (lockMessage) {
    return { error: lockMessage };
  }

  const wargaList = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);
  const matched = wargaList.find(
    (w) =>
      w.aktif &&
      blokCandidates.includes(normalizeBlok(w.blok_rumah)) &&
      w.pin_akses === cleanPin
  );

  if (!matched) {
    const lockErr = registerLocalFailedAttempt(attemptKey);
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entity: 'auth',
      entity_id: primaryBlok,
      summary: `Percobaan login Portal Warga gagal untuk blok "${primaryBlok}".`,
    });
    return {
      error:
        lockErr ||
        'Blok/No. Rumah atau PIN 6 digit tidak ditemukan. Hubungi Pengurus jika lupa PIN.',
    };
  }

  clearLocalAttempts(attemptKey);

  const session: SessionUser = {
    role: 'warga',
    blok_rumah: matched.blok_rumah,
    nama_warga: matched.nama_warga,
    status_hunian: matched.status_hunian,
    no_wa: matched.no_wa,
    nominal_iuran: matched.nominal_iuran,
    login_at: new Date().toISOString(),
  };

  saveStoredSession(session);
  await recordAuditLog({
    session,
    action: 'LOGIN_SUCCESS',
    entity: 'auth',
    entity_id: session.blok_rumah,
    summary: `Warga ${session.nama_warga} (${session.blok_rumah}) masuk ke Portal Warga.`,
  });

  return { data: session };
}

/**
 * Autentikasi khusus Portal Admin — terintegrasi ketat dengan Akun Pengurus / Admin (role = 'admin').
 */
export async function loginAdminAccount(
  usernameInput: string,
  pinInput: string
): Promise<ServiceResult<SessionUser>> {
  const cleanPin = pinInput.trim();
  const cleanUsername = resolvePengurusAdminUsername(usernameInput);

  if (!cleanUsername || !cleanPin) {
    return { error: 'Mohon lengkapi Username Pengurus dan PIN 6 digit Anda.' };
  }

  if (cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
    return { error: 'PIN akses pengurus harus terdiri dari tepat 6 digit angka.' };
  }

  const supabase = getSupabaseClient(null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('login_ecard', {
        p_blok: cleanUsername,
        p_pin: cleanPin,
      });

      if (error) {
        return { error: parseFriendlyError(error, 'Gagal memverifikasi akun pengurus ke server.') };
      }

      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row || typeof row.blok_rumah !== 'string' || !row.blok_rumah) {
        await recordAuditLog({
          action: 'LOGIN_FAILED',
          entity: 'auth',
          entity_id: cleanUsername,
          summary: `Percobaan login Portal Admin gagal untuk akun pengurus "${cleanUsername}".`,
        });
        return { error: 'Username Pengurus atau PIN 6 digit tidak valid. Silakan periksa kembali.' };
      }

      if (row.role !== 'admin') {
        return { error: 'Akun ini tidak memiliki hak akses Pengurus / Admin.' };
      }

      const pengurusMeta = SUSUNAN_PENGURUS.find(
        (p) => p.username.toLowerCase() === row.blok_rumah?.toString().toLowerCase()
      );
      const resolvedJabatan =
        (row.jabatan as AdminJabatan | undefined) || pengurusMeta?.jabatan || 'Bendahara';
      const resolvedPerm: AdminPermission =
        (row.admin_permission as AdminPermission | undefined) ||
        pengurusMeta?.permission ||
        (resolvedJabatan === 'Bendahara' ? 'full' : 'add_only');

      const session: SessionUser = {
        role: 'admin',
        blok_rumah: row.blok_rumah,
        nama_warga:
          (typeof row.nama_warga === 'string' && row.nama_warga) ||
          pengurusMeta?.nama ||
          'Pengurus Lingkungan',
        jabatan: resolvedJabatan,
        admin_permission: resolvedPerm,
        status_hunian: row.status_hunian as StatusHunian | undefined,
        no_wa: typeof row.no_wa === 'string' ? row.no_wa : undefined,
        nominal_iuran: 0,
        login_at: new Date().toISOString(),
      };
      saveStoredSession(session);
      await recordAuditLog({
        session,
        action: 'LOGIN_SUCCESS',
        entity: 'auth',
        entity_id: session.blok_rumah,
        summary: `Login Pengurus berhasil (${resolvedJabatan} — ${
          resolvedPerm === 'full' ? 'Akses Penuh' : 'Tambah Data'
        }) untuk ${session.nama_warga} [${session.blok_rumah}].`,
      });
      return { data: session };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Terjadi kesalahan jaringan saat mencoba masuk.') };
    }
  }

  // Fallback Mode Lokal (Akun Pengurus / Admin) dengan Proteksi Brute-Force PIN
  ensureLocalStoreInitialized();
  const attemptKey = `admin:${cleanUsername}`;
  const lockMessage = checkLocalLockout(attemptKey);
  if (lockMessage) {
    return { error: lockMessage };
  }

  const matchedAdmin = LOCAL_ADMIN_ACCOUNTS.find(
    (acc) => acc.username === cleanUsername && acc.pin === cleanPin
  );
  if (!matchedAdmin) {
    const lockErr = registerLocalFailedAttempt(attemptKey);
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entity: 'auth',
      entity_id: cleanUsername,
      summary: `Percobaan login Portal Admin gagal untuk username pengurus "${cleanUsername}".`,
    });
    return { error: lockErr || 'Username Pengurus / Admin atau PIN tidak sesuai.' };
  }

  clearLocalAttempts(attemptKey);
  const session: SessionUser = {
    role: 'admin',
    blok_rumah: matchedAdmin.username,
    nama_warga: matchedAdmin.nama,
    jabatan: matchedAdmin.jabatan,
    admin_permission: matchedAdmin.permission,
    login_at: new Date().toISOString(),
  };
  saveStoredSession(session);
  await recordAuditLog({
    session,
    action: 'LOGIN_SUCCESS',
    entity: 'auth',
    entity_id: matchedAdmin.username,
    summary: `${matchedAdmin.nama} (${matchedAdmin.jabatan} — ${
      matchedAdmin.permission === 'full' ? 'Akses Penuh' : 'Tambah Data'
    }) masuk ke Portal Admin.`,
  });
  return { data: session };
}

export async function loginPortal(
  mode: 'warga' | 'admin',
  usernameInput: string,
  pinInput: string
): Promise<ServiceResult<SessionUser>> {
  return mode === 'admin'
    ? loginAdminAccount(usernameInput, pinInput)
    : loginWargaAccount(usernameInput, pinInput);
}

// =========================================================================
// Portal Warga — Isolasi Data Ketat (1 Akun = 1 Rumah)
// =========================================================================

export async function fetchWargaOwnData(session: SessionUser): Promise<
  ServiceResult<{
    profil: Warga;
    statusBulanan: StatusEcardBulanan[];
    riwayat: TransaksiIPL[];
    notifications: SystemNotification[];
    paymentConfig: PaymentConfig;
  }>
> {
  if (session.role !== 'warga') {
    return { error: 'Sesi warga tidak valid.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const [profilRes, statusRes, trxRes, notifications, paymentConfig] = await Promise.all([
        supabase
          .from('users_warga')
          .select('*')
          .eq('blok_rumah', session.blok_rumah)
          .single(),
        supabase
          .from('status_ecard_bulanan')
          .select('*')
          .eq('blok_rumah', session.blok_rumah)
          .eq('tahun', TAHUN_AKTIF)
          .order('bulan', { ascending: true }),
        supabase
          .from('transaksi_ipl')
          .select('*')
          .eq('blok_rumah', session.blok_rumah)
          .order('tanggal_setor', { ascending: false }),
        fetchSystemNotifications(session),
        fetchPaymentConfig(session),
      ]);

      if (profilRes.error) throw profilRes.error;
      if (statusRes.error) throw statusRes.error;
      if (trxRes.error) throw trxRes.error;

      const existingMap = new Map<number, StatusEcardBulanan>();
      for (const row of (statusRes.data || []) as StatusEcardBulanan[]) {
        existingMap.set(row.bulan, row);
      }
      const complete12: StatusEcardBulanan[] = Array.from({ length: 12 }, (_, idx) => {
        const bulan = idx + 1;
        return (
          existingMap.get(bulan) || {
            id: `st-${session.blok_rumah}-${TAHUN_AKTIF}-${bulan}`,
            blok_rumah: session.blok_rumah,
            tahun: TAHUN_AKTIF,
            bulan,
            status: getDefaultUnpaidStatusForMonth(bulan),
            transaksi_id: null,
            updated_at: new Date().toISOString(),
          }
        );
      });

      const profil = profilRes.data as Warga;
      const relevantNotifications = notifications
        .filter((n) => n.target_scope === 'all_units' || profil.status_hunian !== 'Kosong')
        .map(({ recipient_blocks: _omit, ...safeNotif }) => safeNotif);

      return {
        data: {
          profil,
          statusBulanan: complete12,
          riwayat: (trxRes.data || []) as TransaksiIPL[],
          notifications: relevantNotifications,
          paymentConfig,
        },
      };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memuat data e-Card rumah Anda.') };
    }
  }

  // Fallback lokal — tetap isolasi ketat hanya blok milik session
  const wargaList = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);
  const profil = wargaList.find((w) => w.blok_rumah === session.blok_rumah);
  if (!profil) {
    return { error: 'Data profil rumah tidak ditemukan.' };
  }

  syncLocalStatusForHouse(session.blok_rumah);
  const statusBulanan = readLocal<StatusEcardBulanan[]>(STORAGE_KEYS.STATUS, [])
    .filter((s) => s.blok_rumah === session.blok_rumah && s.tahun === TAHUN_AKTIF)
    .sort((a, b) => a.bulan - b.bulan);

  const riwayat = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, [])
    .filter((t) => t.blok_rumah === session.blok_rumah)
    .sort((a, b) => new Date(b.tanggal_setor).getTime() - new Date(a.tanggal_setor).getTime());

  const [notifications, paymentConfig] = await Promise.all([
    fetchSystemNotifications(session),
    fetchPaymentConfig(session),
  ]);

  const safeNotifications = notifications
    .filter((n) => n.target_scope === 'all_units' || profil.status_hunian !== 'Kosong')
    .map(({ recipient_blocks: _omit, ...safeNotif }) => safeNotif);

  return { data: { profil, statusBulanan, riwayat, notifications: safeNotifications, paymentConfig } };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca file gambar bukti transaksi.'));
    reader.readAsDataURL(file);
  });
}

export type SetorSubmitStage =
  | 'idle'
  | 'uploading_proof'
  | 'saving_transaction'
  | 'syncing_ecard'
  | 'refreshing';

function normalizeStatusVerifikasi(raw: unknown): StatusVerifikasi {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'terverifikasi' || val === 'approved' || val === 'lunas' || val === 'verified') {
    return 'Terverifikasi';
  }
  if (val === 'ditolak' || val === 'rejected') {
    return 'Ditolak';
  }
  return 'Pending';
}

function normalizeTransaksiRow(row: Record<string, unknown>): TransaksiIPL {
  const rawBulan = row.bulan_dibayar;
  const bulanArr = Array.isArray(rawBulan)
    ? rawBulan.map((b) => Number(b)).filter((b) => Number.isFinite(b) && b >= 1 && b <= 12)
    : [];
  const parsedTahun = Number(row.tahun);
  return {
    id: String(row.id || ''),
    no_kwitansi: String(row.no_kwitansi || ''),
    blok_rumah: String(row.blok_rumah || '').trim(),
    nama_warga: String(row.nama_warga || '').trim() || String(row.blok_rumah || ''),
    tahun: Number.isFinite(parsedTahun) && parsedTahun > 2000 ? parsedTahun : TAHUN_AKTIF,
    bulan_dibayar: bulanArr,
    nominal: Number(row.nominal) || 0,
    metode_bayar: (row.metode_bayar as MetodeBayar) || 'Transfer Bank',
    petugas_penerima: typeof row.petugas_penerima === 'string' ? row.petugas_penerima : null,
    bukti_url: typeof row.bukti_url === 'string' ? row.bukti_url : null,
    status_verifikasi: normalizeStatusVerifikasi(row.status_verifikasi),
    catatan_admin: typeof row.catatan_admin === 'string' ? row.catatan_admin : null,
    keterangan: typeof row.keterangan === 'string' ? row.keterangan : null,
    tanggal_setor: String(row.tanggal_setor || new Date().toISOString()),
    verified_at: typeof row.verified_at === 'string' ? row.verified_at : null,
    verified_by: typeof row.verified_by === 'string' ? row.verified_by : null,
  };
}

function reconcileStatusWithTransactions(
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[]
): StatusEcardBulanan[] {
  const byKey = new Map<string, StatusEcardBulanan>();
  for (const s of statusList) {
    const key = `${canonicalizeBlokKey(s.blok_rumah)}::${s.tahun}::${s.bulan}`;
    byKey.set(key, s);
  }

  for (const trx of transaksiList) {
    if (trx.status_verifikasi !== 'Terverifikasi' && trx.status_verifikasi !== 'Pending') {
      continue;
    }
    const targetStatus =
      trx.status_verifikasi === 'Terverifikasi' ? 'Lunas' : 'Menunggu Verifikasi';
    for (const bulan of trx.bulan_dibayar) {
      const key = `${canonicalizeBlokKey(trx.blok_rumah)}::${trx.tahun}::${bulan}`;
      const existing = byKey.get(key);
      if (existing?.status === 'Lunas') {
        continue;
      }
      if (!existing || targetStatus === 'Lunas' || existing.status !== 'Menunggu Verifikasi') {
        byKey.set(key, {
          id: existing?.id || `st-sync-${trx.blok_rumah}-${trx.tahun}-${bulan}`,
          blok_rumah: existing?.blok_rumah || trx.blok_rumah,
          tahun: trx.tahun,
          bulan,
          status: targetStatus,
          transaksi_id: trx.id,
          updated_at: trx.verified_at || trx.tanggal_setor,
        });
      }
    }
  }

  return Array.from(byKey.values());
}

export async function submitSetoranWarga(
  session: SessionUser,
  payload: {
    blok_rumah?: string;
    nama_warga?: string;
    bulan_dibayar: number[];
    metode_bayar: MetodeBayar;
    petugas_penerima?: string;
    nominal: number;
    keterangan?: string;
    buktiFile: File;
    onStageChange?: (stage: SetorSubmitStage) => void;
  }
): Promise<ServiceResult<TransaksiIPL>> {
  if (session.role !== 'warga') {
    return { error: 'Hanya warga terdaftar yang dapat mengirim setoran dari halaman ini.' };
  }
  if (!payload.buktiFile) {
    return { error: 'Bukti foto transaksi wajib diunggah sebelum mengirim setoran.' };
  }
  if (payload.bulan_dibayar.length === 0) {
    return { error: 'Pilih minimal satu bulan pembayaran.' };
  }
  if (payload.nominal <= 0) {
    return { error: 'Nominal setoran harus lebih dari Rp 0.' };
  }

  const effectiveBlok = (payload.blok_rumah || session.blok_rumah).trim();
  const effectiveNama = (payload.nama_warga || session.nama_warga).trim() || effectiveBlok;
  const effectiveSession: SessionUser =
    effectiveBlok !== session.blok_rumah
      ? { ...session, blok_rumah: effectiveBlok, nama_warga: effectiveNama }
      : session;

  const sortedBulan = [...payload.bulan_dibayar].sort((a, b) => a - b);
  const nowIso = new Date().toISOString();
  const noKwitansi = generateKwitansiNumber(effectiveBlok, nowIso);

  const supabase = getSupabaseClient(effectiveSession);
  if (supabase && isSupabaseConfigured()) {
    try {
      payload.onStageChange?.('uploading_proof');
      const ext = payload.buktiFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const safeBlok = effectiveBlok.replace(/[^A-Z0-9]/gi, '_');
      const filePath = `${safeBlok}/${Date.now()}.${ext}`;

      let buktiUrl = '';
      const { error: uploadError } = await supabase.storage
        .from('bukti-ipl')
        .upload(filePath, payload.buktiFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from('bukti-ipl').getPublicUrl(filePath);
        buktiUrl = publicUrlData.publicUrl;
      } else {
        // Fallback aman: simpan foto bukti terkompresi sebagai Data URL jika bucket storage belum siap
        buktiUrl = await fileToDataUrl(payload.buktiFile);
      }

      payload.onStageChange?.('saving_transaction');
      const { data: inserted, error: insertError } = await supabase
        .from('transaksi_ipl')
        .insert({
          no_kwitansi: noKwitansi,
          blok_rumah: effectiveBlok,
          nama_warga: effectiveNama,
          tahun: TAHUN_AKTIF,
          bulan_dibayar: sortedBulan,
          nominal: payload.nominal,
          metode_bayar: payload.metode_bayar,
          petugas_penerima:
            payload.metode_bayar === 'Setor Tunai' ? payload.petugas_penerima || null : null,
          bukti_url: buktiUrl,
          status_verifikasi: 'Pending',
          keterangan: payload.keterangan?.trim() || null,
          tanggal_setor: nowIso,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      payload.onStageChange?.('syncing_ecard');
      // Sinkronkan status bulan menjadi Menunggu Verifikasi secara batch
      const statusRows = sortedBulan.map((bulan) => ({
        blok_rumah: effectiveBlok,
        tahun: TAHUN_AKTIF,
        bulan,
        status: 'Menunggu Verifikasi' as const,
        transaksi_id: inserted.id,
        updated_at: nowIso,
      }));
      await supabase
        .from('status_ecard_bulanan')
        .upsert(statusRows, { onConflict: 'blok_rumah,tahun,bulan' });

      await recordAuditLog({
        session: effectiveSession,
        action: 'SUBMIT_SETORAN',
        entity: 'transaksi_ipl',
        entity_id: inserted.id,
        summary: `Warga ${effectiveBlok} menyetor ${formatRupiah(payload.nominal)} (${formatDaftarBulan(sortedBulan, true)}) via ${payload.metode_bayar}.`,
        metadata: { bulan: sortedBulan, nominal: payload.nominal, metode: payload.metode_bayar },
      });

      return { data: normalizeTransaksiRow(inserted as Record<string, unknown>) };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal mengirim setoran ke server Supabase.') };
    }
  }

  // Fallback lokal
  try {
    payload.onStageChange?.('uploading_proof');
    const buktiUrl = await fileToDataUrl(payload.buktiFile);

    payload.onStageChange?.('saving_transaction');
    const newTrx: TransaksiIPL = {
      id: `trx-${Date.now()}`,
      no_kwitansi: noKwitansi,
      blok_rumah: effectiveBlok,
      nama_warga: effectiveNama,
      tahun: TAHUN_AKTIF,
      bulan_dibayar: sortedBulan,
      nominal: payload.nominal,
      metode_bayar: payload.metode_bayar,
      petugas_penerima:
        payload.metode_bayar === 'Setor Tunai' ? payload.petugas_penerima || null : null,
      bukti_url: buktiUrl,
      status_verifikasi: 'Pending',
      catatan_admin: null,
      keterangan: payload.keterangan?.trim() || null,
      tanggal_setor: nowIso,
      verified_at: null,
      verified_by: null,
    };

    const existing = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI);
    writeLocal(STORAGE_KEYS.TRANSAKSI, [newTrx, ...existing]);

    payload.onStageChange?.('syncing_ecard');
    syncLocalStatusForHouse(effectiveBlok);

    await recordAuditLog({
      session: effectiveSession,
      action: 'SUBMIT_SETORAN',
      entity: 'transaksi_ipl',
      entity_id: newTrx.id,
      summary: `Warga ${effectiveBlok} menyetor ${formatRupiah(payload.nominal)} (${formatDaftarBulan(sortedBulan, true)}) via ${payload.metode_bayar}.`,
      metadata: { bulan: sortedBulan, nominal: payload.nominal, metode: payload.metode_bayar },
    });

    return { data: newTrx };
  } catch (err) {
    return { error: parseFriendlyError(err, 'Gagal memproses bukti transaksi.') };
  }
}

// =========================================================================
// Portal Admin / Pengurus
// =========================================================================

export interface AdminSnapshot {
  wargaList: Warga[];
  pengurusAccounts: PengurusAccountInfo[];
  transaksiList: TransaksiIPL[];
  statusList: StatusEcardBulanan[];
  botConfig: BotWaConfig;
  botLogs: BotWaLog[];
  notifications: SystemNotification[];
  paymentConfig: PaymentConfig;
}

function buildPengurusAccountsList(
  session: SessionUser,
  dbAdminRows?: Array<{
    blok_rumah?: string;
    nama_warga?: string;
    no_wa?: string;
    pin_akses?: string;
    jabatan?: string | null;
    admin_permission?: string | null;
  }>
): PengurusAccountInfo[] {
  const canRevealPin = isBendaharaFullAccess(session);
  const dbMap = new Map<string, NonNullable<typeof dbAdminRows>[number]>();
  for (const row of dbAdminRows || []) {
    if (row.blok_rumah) {
      dbMap.set(row.blok_rumah.trim().toLowerCase(), row);
    }
  }

  return SUSUNAN_PENGURUS.map((p) => {
    const dbMatch = dbMap.get(p.username.toLowerCase());
    const localMatch = LOCAL_ADMIN_ACCOUNTS.find(
      (a) => a.username.toLowerCase() === p.username.toLowerCase()
    );
    return {
      ...p,
      no_wa: dbMatch?.no_wa || undefined,
      pin_akses: canRevealPin ? dbMatch?.pin_akses || localMatch?.pin : undefined,
    };
  });
}

function mergeBotWaLogs(remoteLogs: BotWaLog[], localLogs: BotWaLog[]): BotWaLog[] {
  const map = new Map<string, BotWaLog>();
  for (const l of [...remoteLogs, ...localLogs]) {
    const dedupeKey =
      l.id && !l.id.startsWith('walog-')
        ? l.id
        : `${l.created_at.slice(0, 19)}::${l.no_wa}::${l.jenis_pesan}`;
    if (!map.has(dedupeKey)) {
      map.set(dedupeKey, l);
    }
  }
  return Array.from(map.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 200);
}

export async function fetchAdminSnapshot(session: SessionUser): Promise<ServiceResult<AdminSnapshot>> {
  if (session.role !== 'admin') {
    return { error: 'Akses ditolak: hanya untuk Pengurus / Admin.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const [
        wargaRes,
        adminAccRes,
        trxRes,
        statusRes,
        botCfgRes,
        botLogRes,
        notifications,
        paymentConfig,
      ] = await Promise.all([
        supabase
          .from('users_warga')
          .select('*')
          .or('role.is.null,role.neq.admin')
          .order('blok_rumah', { ascending: true }),
        supabase
          .from('users_warga')
          .select('blok_rumah,nama_warga,no_wa,pin_akses,jabatan,admin_permission')
          .eq('role', 'admin'),
        supabase
          .from('transaksi_ipl')
          .select('*')
          .order('tanggal_setor', { ascending: false })
          .limit(1000),
        supabase.from('status_ecard_bulanan').select('*').eq('tahun', TAHUN_AKTIF),
        supabase.from('bot_wa_config').select('*').limit(1).maybeSingle(),
        supabase.from('bot_wa_logs').select('*').order('created_at', { ascending: false }).limit(200),
        fetchSystemNotifications(session),
        fetchPaymentConfig(session),
      ]);

      if (wargaRes.error) throw wargaRes.error;
      if (trxRes.error) throw trxRes.error;
      if (statusRes.error) throw statusRes.error;

      const transaksiList = ((trxRes.data || []) as Record<string, unknown>[]).map(
        normalizeTransaksiRow
      );
      const reconciledStatus = reconcileStatusWithTransactions(
        (statusRes.data || []) as StatusEcardBulanan[],
        transaksiList
      );
      const localFallbackLogs = (() => {
        try {
          const raw = safeStorageGet(STORAGE_KEYS.BOT_LOGS);
          return raw ? (JSON.parse(raw) as BotWaLog[]) : [];
        } catch {
          return [];
        }
      })();
      const remoteBotLogs = !botLogRes.error ? ((botLogRes.data || []) as BotWaLog[]) : [];

      return {
        data: {
          wargaList: (wargaRes.data || []) as Warga[],
          pengurusAccounts: buildPengurusAccountsList(
            session,
            !adminAccRes.error ? (adminAccRes.data as Array<Record<string, string>>) : undefined
          ),
          transaksiList,
          statusList: reconciledStatus,
          botConfig: (botCfgRes.data as BotWaConfig | null) || SEED_BOT_WA_CONFIG,
          botLogs: mergeBotWaLogs(remoteBotLogs, localFallbackLogs),
          notifications,
          paymentConfig,
        },
      };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memuat data Pengurus dari Supabase.') };
    }
  }

  ensureLocalStoreInitialized();
  const wargaList = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA).sort((a, b) =>
    a.blok_rumah.localeCompare(b.blok_rumah, undefined, { numeric: true })
  );
  for (const w of wargaList) {
    syncLocalStatusForHouse(w.blok_rumah);
  }

  const transaksiList = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI)
    .map((t) => normalizeTransaksiRow(t as unknown as Record<string, unknown>))
    .sort((a, b) => new Date(b.tanggal_setor).getTime() - new Date(a.tanggal_setor).getTime());
  const statusList = reconcileStatusWithTransactions(
    readLocal<StatusEcardBulanan[]>(STORAGE_KEYS.STATUS, []),
    transaksiList
  );
  const botConfig = readLocal<BotWaConfig>(STORAGE_KEYS.BOT_CONFIG, SEED_BOT_WA_CONFIG);
  const botLogs = readLocal<BotWaLog[]>(STORAGE_KEYS.BOT_LOGS, SEED_BOT_WA_LOGS).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const [notifications, paymentConfig] = await Promise.all([
    fetchSystemNotifications(session),
    fetchPaymentConfig(session),
  ]);

  return {
    data: {
      wargaList,
      pengurusAccounts: buildPengurusAccountsList(session),
      transaksiList,
      statusList,
      botConfig,
      botLogs,
      notifications,
      paymentConfig,
    },
  };
}

/**
 * Langganan realtime perubahan data warga/setoran di Supabase agar Portal Admin
 * langsung memperbarui daftar setoran masuk tanpa perlu muat ulang manual.
 */
export function subscribeAdminRealtime(
  session: SessionUser,
  onChange: () => void
): () => void {
  if (session.role !== 'admin') return () => {};
  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) return () => {};

  let debounceTimer: number | null = null;
  const triggerDebounced = () => {
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      onChange();
    }, 600);
  };

  try {
    const channel = supabase
      .channel(`admin-live-sync-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaksi_ipl' },
        triggerDebounced
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'status_ecard_bulanan' },
        triggerDebounced
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users_warga' },
        triggerDebounced
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bot_wa_logs' },
        triggerDebounced
      )
      .subscribe();

    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    };
  }
}

export async function verifyTransaksiAdmin(
  session: SessionUser,
  trx: TransaksiIPL,
  decision: 'Terverifikasi' | 'Ditolak',
  catatanAdmin?: string
): Promise<ServiceResult<TransaksiIPL>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: verifikasi/perubahan status transaksi khusus Bendahara.' };
  }
  if (decision === 'Ditolak' && !catatanAdmin?.trim()) {
    return { error: 'Alasan penolakan wajib diisi.' };
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseClient(session);

  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('transaksi_ipl')
        .update({
          status_verifikasi: decision,
          catatan_admin: catatanAdmin?.trim() || (decision === 'Terverifikasi' ? 'Terverifikasi oleh Pengurus.' : null),
          verified_at: nowIso,
          verified_by: session.blok_rumah,
        })
        .eq('id', trx.id)
        .select()
        .single();

      if (error) throw error;

      // Sinkronkan status_ecard_bulanan untuk semua bulan pada transaksi tersebut
      for (const bulan of trx.bulan_dibayar) {
        const nextStatus = decision === 'Terverifikasi' ? 'Lunas' : getDefaultUnpaidStatusForMonth(bulan);
        await supabase.from('status_ecard_bulanan').upsert(
          {
            blok_rumah: trx.blok_rumah,
            tahun: trx.tahun,
            bulan,
            status: nextStatus,
            transaksi_id: decision === 'Terverifikasi' ? trx.id : null,
            updated_at: nowIso,
          },
          { onConflict: 'blok_rumah,tahun,bulan' }
        );
      }

      await recordAuditLog({
        session,
        action: decision === 'Terverifikasi' ? 'APPROVE_TRANSAKSI' : 'REJECT_TRANSAKSI',
        entity: 'transaksi_ipl',
        entity_id: trx.id,
        summary: `Admin ${decision === 'Terverifikasi' ? 'menyetujui' : 'menolak'} setoran ${trx.blok_rumah} sebesar ${formatRupiah(trx.nominal)} (${formatDaftarBulan(trx.bulan_dibayar, true)}).`,
        metadata: { catatan: catatanAdmin || null, blok: trx.blok_rumah },
      });

      return { data: data as TransaksiIPL };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memperbarui status verifikasi.') };
    }
  }

  const allTrx = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI);
  let updatedItem: TransaksiIPL | undefined;
  const nextTrx = allTrx.map((item) => {
    if (item.id !== trx.id) return item;
    updatedItem = {
      ...item,
      status_verifikasi: decision,
      catatan_admin:
        catatanAdmin?.trim() || (decision === 'Terverifikasi' ? 'Terverifikasi oleh Pengurus.' : null),
      verified_at: nowIso,
      verified_by: session.blok_rumah,
    };
    return updatedItem;
  });

  if (!updatedItem) return { error: 'Transaksi tidak ditemukan.' };
  writeLocal(STORAGE_KEYS.TRANSAKSI, nextTrx);
  syncLocalStatusForHouse(trx.blok_rumah);

  await recordAuditLog({
    session,
    action: decision === 'Terverifikasi' ? 'APPROVE_TRANSAKSI' : 'REJECT_TRANSAKSI',
    entity: 'transaksi_ipl',
    entity_id: trx.id,
    summary: `Admin ${decision === 'Terverifikasi' ? 'menyetujui' : 'menolak'} setoran ${trx.blok_rumah} sebesar ${formatRupiah(trx.nominal)} (${formatDaftarBulan(trx.bulan_dibayar, true)}).`,
    metadata: { catatan: catatanAdmin || null, blok: trx.blok_rumah },
  });

  return { data: updatedItem };
}

export async function saveWargaAdmin(
  session: SessionUser,
  payload: {
    id?: string;
    blok_rumah: string;
    nama_warga: string;
    no_wa: string;
    status_hunian: StatusHunian;
    nominal_iuran: number;
    pin_akses: string;
    aktif?: boolean;
  }
): Promise<ServiceResult<Warga>> {
  if (session.role !== 'admin') return { error: 'Akses ditolak.' };
  if (payload.id && !isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: pengeditan data warga hanya dapat dilakukan oleh Bendahara.' };
  }

  const cleanBlok = normalizeBlok(payload.blok_rumah);
  const cleanWa = normalizeWaNumber(payload.no_wa);
  const cleanPin = payload.pin_akses.trim();

  if (!cleanBlok) return { error: 'Blok & No. Rumah wajib diisi (contoh: B03/07).' };
  if (!payload.nama_warga.trim()) return { error: 'Nama warga wajib diisi.' };
  if (!/^\d{6}$/.test(cleanPin)) return { error: 'PIN akses harus terdiri dari 6 digit angka.' };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      if (payload.id) {
        const { data, error } = await supabase
          .from('users_warga')
          .update({
            blok_rumah: cleanBlok,
            nama_warga: payload.nama_warga.trim(),
            no_wa: cleanWa,
            status_hunian: payload.status_hunian,
            nominal_iuran: payload.nominal_iuran,
            pin_akses: cleanPin,
            aktif: payload.aktif ?? true,
          })
          .eq('id', payload.id)
          .select()
          .single();
        if (error) throw error;

        await recordAuditLog({
          session,
          action: 'UPDATE_WARGA',
          entity: 'users_warga',
          entity_id: data.id,
          summary: `Memperbarui data warga ${cleanBlok} — ${payload.nama_warga.trim()}.`,
        });
        return { data: data as Warga };
      }

      const { data, error } = await supabase
        .from('users_warga')
        .insert({
          blok_rumah: cleanBlok,
          nama_warga: payload.nama_warga.trim(),
          no_wa: cleanWa,
          status_hunian: payload.status_hunian,
          nominal_iuran: payload.nominal_iuran,
          pin_akses: cleanPin,
          aktif: true,
        })
        .select()
        .single();
      if (error) throw error;

      await recordAuditLog({
        session,
        action: 'CREATE_WARGA',
        entity: 'users_warga',
        entity_id: data.id,
        summary: `Menambahkan warga baru ${cleanBlok} — ${payload.nama_warga.trim()}.`,
      });
      return { data: data as Warga };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menyimpan data warga ke Supabase.') };
    }
  }

  const list = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);
  if (payload.id) {
    const duplicate = list.find((w) => w.id !== payload.id && normalizeBlok(w.blok_rumah) === cleanBlok);
    if (duplicate) return { error: `Blok ${cleanBlok} sudah terdaftar pada unit lain.` };

    let updated: Warga | undefined;
    const next = list.map((w) => {
      if (w.id !== payload.id) return w;
      updated = {
        ...w,
        blok_rumah: cleanBlok,
        nama_warga: payload.nama_warga.trim(),
        no_wa: cleanWa,
        status_hunian: payload.status_hunian,
        nominal_iuran: payload.nominal_iuran,
        pin_akses: cleanPin,
        aktif: payload.aktif ?? w.aktif,
      };
      return updated;
    });
    if (!updated) return { error: 'Data warga tidak ditemukan.' };
    writeLocal(STORAGE_KEYS.WARGA, next);
    syncLocalStatusForHouse(cleanBlok);
    await recordAuditLog({
      session,
      action: 'UPDATE_WARGA',
      entity: 'users_warga',
      entity_id: updated.id,
      summary: `Memperbarui data warga ${cleanBlok} — ${updated.nama_warga}.`,
    });
    return { data: updated };
  }

  if (list.some((w) => normalizeBlok(w.blok_rumah) === cleanBlok)) {
    return { error: `Blok ${cleanBlok} sudah terdaftar.` };
  }

  const created: Warga = {
    id: `warga-${Date.now()}`,
    blok_rumah: cleanBlok,
    nama_warga: payload.nama_warga.trim(),
    no_wa: cleanWa,
    status_hunian: payload.status_hunian,
    nominal_iuran: payload.nominal_iuran,
    pin_akses: cleanPin,
    aktif: true,
    created_at: new Date().toISOString(),
  };

  writeLocal(STORAGE_KEYS.WARGA, [...list, created]);
  syncLocalStatusForHouse(cleanBlok);
  await recordAuditLog({
    session,
    action: 'CREATE_WARGA',
    entity: 'users_warga',
    entity_id: created.id,
    summary: `Menambahkan warga baru ${cleanBlok} — ${created.nama_warga}.`,
  });
  return { data: created };
}

export async function resetPinWargaAdmin(
  session: SessionUser,
  warga: Warga
): Promise<ServiceResult<Warga>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: reset PIN warga hanya dapat dilakukan oleh Bendahara.' };
  }
  const newPin = generateRandomPin();
  const res = await saveWargaAdmin(session, {
    ...warga,
    pin_akses: newPin,
  });
  if (res.data) {
    await recordAuditLog({
      session,
      action: 'RESET_PIN_WARGA',
      entity: 'users_warga',
      entity_id: warga.id,
      summary: `PIN akses 6 digit untuk ${warga.blok_rumah} (${warga.nama_warga}) diacak ulang oleh ${session.nama_warga}.`,
    });
  }
  return res;
}

export async function deleteWargaAdmin(
  session: SessionUser,
  warga: Warga
): Promise<ServiceResult<boolean>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: penghapusan data warga hanya dapat dilakukan oleh Bendahara.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { error } = await supabase.from('users_warga').delete().eq('id', warga.id);
      if (error) throw error;
      await recordAuditLog({
        session,
        action: 'DELETE_WARGA',
        entity: 'users_warga',
        entity_id: warga.id,
        summary: `Menghapus data warga ${warga.blok_rumah} (${warga.nama_warga}).`,
      });
      return { data: true };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menghapus data warga.') };
    }
  }

  const list = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA).filter((w) => w.id !== warga.id);
  writeLocal(STORAGE_KEYS.WARGA, list);
  const statuses = readLocal<StatusEcardBulanan[]>(STORAGE_KEYS.STATUS, []).filter(
    (s) => s.blok_rumah !== warga.blok_rumah
  );
  writeLocal(STORAGE_KEYS.STATUS, statuses);

  await recordAuditLog({
    session,
    action: 'DELETE_WARGA',
    entity: 'users_warga',
    entity_id: warga.id,
    summary: `Menghapus data warga ${warga.blok_rumah} (${warga.nama_warga}).`,
  });
  return { data: true };
}

export async function submitManualCashAdmin(
  session: SessionUser,
  payload: {
    warga: Warga;
    bulan_dibayar: number[];
    petugas_penerima: string;
    nominal: number;
    keterangan?: string;
  }
): Promise<ServiceResult<TransaksiIPL>> {
  if (session.role !== 'admin') return { error: 'Akses ditolak.' };
  if (payload.bulan_dibayar.length === 0) return { error: 'Pilih minimal satu bulan.' };
  if (payload.nominal <= 0) return { error: 'Nominal harus lebih dari Rp 0.' };

  const sortedBulan = [...payload.bulan_dibayar].sort((a, b) => a - b);
  const nowIso = new Date().toISOString();
  const noKwitansi = generateKwitansiNumber(payload.warga.blok_rumah, nowIso);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('transaksi_ipl')
        .insert({
          no_kwitansi: noKwitansi,
          blok_rumah: payload.warga.blok_rumah,
          nama_warga: payload.warga.nama_warga,
          tahun: TAHUN_AKTIF,
          bulan_dibayar: sortedBulan,
          nominal: payload.nominal,
          metode_bayar: 'Setor Tunai',
          petugas_penerima: payload.petugas_penerima,
          bukti_url: null,
          status_verifikasi: 'Terverifikasi',
          catatan_admin: `Input tunai manual oleh Admin (Petugas: ${payload.petugas_penerima}).`,
          keterangan: payload.keterangan?.trim() || 'Setoran tunai langsung ke pengurus',
          tanggal_setor: nowIso,
          verified_at: nowIso,
          verified_by: session.blok_rumah,
        })
        .select()
        .single();

      if (error) throw error;

      for (const bulan of sortedBulan) {
        await supabase.from('status_ecard_bulanan').upsert(
          {
            blok_rumah: payload.warga.blok_rumah,
            tahun: TAHUN_AKTIF,
            bulan,
            status: 'Lunas',
            transaksi_id: data.id,
            updated_at: nowIso,
          },
          { onConflict: 'blok_rumah,tahun,bulan' }
        );
      }

      await recordAuditLog({
        session,
        action: 'ADMIN_INPUT_TUNAI',
        entity: 'transaksi_ipl',
        entity_id: data.id,
        summary: `Input tunai manual ${payload.warga.blok_rumah} sebesar ${formatRupiah(payload.nominal)} (${formatDaftarBulan(sortedBulan, true)}) diterima ${payload.petugas_penerima}.`,
      });

      return { data: data as TransaksiIPL };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menyimpan setoran tunai manual.') };
    }
  }

  const newTrx: TransaksiIPL = {
    id: `trx-man-${Date.now()}`,
    no_kwitansi: noKwitansi,
    blok_rumah: payload.warga.blok_rumah,
    nama_warga: payload.warga.nama_warga,
    tahun: TAHUN_AKTIF,
    bulan_dibayar: sortedBulan,
    nominal: payload.nominal,
    metode_bayar: 'Setor Tunai',
    petugas_penerima: payload.petugas_penerima,
    bukti_url: null,
    status_verifikasi: 'Terverifikasi',
    catatan_admin: `Input tunai manual oleh Admin (Petugas: ${payload.petugas_penerima}).`,
    keterangan: payload.keterangan?.trim() || 'Setoran tunai langsung ke pengurus',
    tanggal_setor: nowIso,
    verified_at: nowIso,
    verified_by: session.blok_rumah,
  };

  const existing = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI);
  writeLocal(STORAGE_KEYS.TRANSAKSI, [newTrx, ...existing]);
  syncLocalStatusForHouse(payload.warga.blok_rumah);

  await recordAuditLog({
    session,
    action: 'ADMIN_INPUT_TUNAI',
    entity: 'transaksi_ipl',
    entity_id: newTrx.id,
    summary: `Input tunai manual ${payload.warga.blok_rumah} sebesar ${formatRupiah(payload.nominal)} (${formatDaftarBulan(sortedBulan, true)}) diterima ${payload.petugas_penerima}.`,
  });

  return { data: newTrx };
}

export async function saveBotWaConfigAdmin(
  session: SessionUser,
  config: BotWaConfig
): Promise<ServiceResult<BotWaConfig>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: perubahan konfigurasi Bot WhatsApp khusus Bendahara.' };
  }

  const updatedConfig: BotWaConfig = {
    ...config,
    updated_at: new Date().toISOString(),
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('bot_wa_config')
        .upsert(updatedConfig, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;

      await recordAuditLog({
        session,
        action: 'UPDATE_BOT_WA_CONFIG',
        entity: 'bot_wa_config',
        entity_id: updatedConfig.id,
        summary: `Konfigurasi Bot WA (${updatedConfig.provider}) diperbarui. Status: ${updatedConfig.aktif ? 'Aktif' : 'Nonaktif'}.`,
      });
      return { data: data as BotWaConfig };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menyimpan konfigurasi Bot WhatsApp.') };
    }
  }

  writeLocal(STORAGE_KEYS.BOT_CONFIG, updatedConfig);
  await recordAuditLog({
    session,
    action: 'UPDATE_BOT_WA_CONFIG',
    entity: 'bot_wa_config',
    entity_id: updatedConfig.id,
    summary: `Konfigurasi Bot WA (${updatedConfig.provider}) diperbarui. Status: ${updatedConfig.aktif ? 'Aktif' : 'Nonaktif'}.`,
  });
  return { data: updatedConfig };
}

interface ProxyWaTarget {
  blok_rumah: string;
  nama_warga: string;
  no_wa: string;
  pesan: string;
}

interface ProxyWaResultItem extends ProxyWaTarget {
  status_kirim: 'Terkirim' | 'Gagal';
  respon_gateway: string;
}

async function dispatchViaServerWaProxy(
  session: SessionUser,
  config: BotWaConfig,
  targets: ProxyWaTarget[]
): Promise<{
  available: boolean;
  error?: string;
  results?: ProxyWaResultItem[];
}> {
  try {
    const res = await fetch('/api/bot-wa/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-role': session.role,
        'x-admin-permission': session.admin_permission || '',
      },
      body: JSON.stringify({
        provider: config.provider,
        api_endpoint: config.api_endpoint,
        api_token: config.api_token,
        targets,
      }),
    });

    if (res.status === 404 || res.status === 405) {
      return { available: false };
    }

    const json = (await res.json().catch(() => null)) as {
      error?: string;
      results?: ProxyWaResultItem[];
    } | null;

    if (!res.ok) {
      return {
        available: true,
        error: json?.error || `Gagal menghubungi gateway WA (HTTP ${res.status}).`,
      };
    }

    return {
      available: true,
      results: json?.results || [],
    };
  } catch {
    return { available: false };
  }
}

async function persistBotWaLogs(session: SessionUser, logs: BotWaLog[]): Promise<void> {
  if (logs.length === 0) return;

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { error } = await supabase.from('bot_wa_logs').insert(
        logs.map((l) => ({
          blok_rumah: l.blok_rumah,
          nama_warga: l.nama_warga,
          no_wa: l.no_wa,
          jenis_pesan: l.jenis_pesan,
          status_kirim: l.status_kirim,
          respon_gateway: l.respon_gateway,
          pesan: l.pesan,
        }))
      );
      if (!error) {
        return;
      }
    } catch {
      // Fallback simpan lokal bila RLS / tabel belum diperbarui di Supabase
    }
  }

  const existingLogs = (() => {
    try {
      const raw = safeStorageGet(STORAGE_KEYS.BOT_LOGS);
      return raw ? (JSON.parse(raw) as BotWaLog[]) : [];
    } catch {
      return [];
    }
  })();
  writeLocal(STORAGE_KEYS.BOT_LOGS, [...logs, ...existingLogs].slice(0, 200));
}

export async function sendTestWaMessageAdmin(
  session: SessionUser,
  config: BotWaConfig,
  targetPhoneInput: string
): Promise<ServiceResult<{ status: 'Terkirim' | 'Gagal'; detail: string }>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: uji kirim Bot WhatsApp khusus Bendahara.' };
  }

  const cleanPhone = normalizeWaNumber(targetPhoneInput);
  if (cleanPhone.length < 10) {
    return { error: 'Masukkan nomor WhatsApp tujuan yang valid (contoh: 0812xxxxxxxx).' };
  }
  if (!config.api_token.trim()) {
    return { error: 'Masukkan API Token Fonnte / Wablas terlebih dahulu sebelum uji kirim.' };
  }

  const currentMonth = getCurrentBillingMonth();
  const bulanNama = `${getNamaBulan(currentMonth)} ${TAHUN_AKTIF}`;
  const appUrl = APP_PORTAL_URL;

  const renderedMsg = config.template_pesan
    .replaceAll('{nama_warga}', session.nama_warga)
    .replaceAll('{blok_rumah}', 'B7/16')
    .replaceAll('{pin_akses}', '123456')
    .replaceAll('{bulan_tagihan}', bulanNama)
    .replaceAll('{nominal_tagihan}', formatRupiah(NOMINAL_IPL_STANDAR))
    .replaceAll('{link_aplikasi}', appUrl);

  const proxyRes = await dispatchViaServerWaProxy(session, config, [
    {
      blok_rumah: 'TES-WA',
      nama_warga: `Uji Coba (${session.nama_warga})`,
      no_wa: cleanPhone,
      pesan: renderedMsg,
    },
  ]);

  if (!proxyRes.available) {
    return {
      error:
        'Server proxy /api/bot-wa/send tidak aktif pada hosting statis ini. Deploy Edge Function wa-reminder-ipl di Supabase untuk pengiriman langsung.',
    };
  }
  if (proxyRes.error) {
    return { error: proxyRes.error };
  }

  const item = proxyRes.results?.[0];
  if (!item) {
    return { error: 'Tidak ada respon dari gateway WhatsApp.' };
  }

  const nowIso = new Date().toISOString();
  await persistBotWaLogs(session, [
    {
      id: `walog-test-${Date.now()}`,
      created_at: nowIso,
      blok_rumah: item.blok_rumah,
      nama_warga: item.nama_warga,
      no_wa: item.no_wa,
      jenis_pesan: `Uji Koneksi Token (${config.provider})`,
      status_kirim: item.status_kirim,
      respon_gateway: item.respon_gateway,
      pesan: item.pesan,
    },
  ]);

  await recordAuditLog({
    session,
    action: 'TEST_BOT_WA',
    entity: 'bot_wa_logs',
    summary: `Uji kirim Bot WA (${config.provider}) ke ${cleanPhone}: ${item.status_kirim} (${item.respon_gateway}).`,
  });

  if (item.status_kirim === 'Gagal') {
    return { error: `Gagal kirim via ${config.provider}: ${item.respon_gateway}` };
  }

  return {
    data: {
      status: item.status_kirim,
      detail: `Pesan uji coba berhasil dikirim ke +${cleanPhone} (${item.respon_gateway}).`,
    },
  };
}

export async function triggerManualWaReminderAdmin(
  session: SessionUser,
  config: BotWaConfig,
  wargaList: Warga[],
  statusList: StatusEcardBulanan[]
): Promise<ServiceResult<{ sentCount: number; message: string }>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: pengiriman pengingat Bot WA manual khusus Bendahara.' };
  }

  if (!config.aktif) {
    return {
      error: 'Bot WA masih Nonaktif. Nyalakan sakelar Status Bot WhatsApp Otomatis terlebih dahulu.',
    };
  }

  const currentMonth = getCurrentBillingMonth();
  const bulanNama = `${getNamaBulan(currentMonth)} ${TAHUN_AKTIF}`;
  const appUrl = APP_PORTAL_URL;

  const unpaidWarga = wargaList.filter((w) => {
    if (!w.aktif || w.status_hunian === 'Kosong') return false;
    const st = statusList.find(
      (s) => s.blok_rumah === w.blok_rumah && s.tahun === TAHUN_AKTIF && s.bulan === currentMonth
    );
    return !st || (st.status !== 'Lunas' && st.status !== 'Menunggu Verifikasi');
  });

  if (unpaidWarga.length === 0) {
    return {
      data: {
        sentCount: 0,
        message: `Seluruh rumah aktif telah melunasi atau sedang diverifikasi untuk bulan ${bulanNama}.`,
      },
    };
  }

  const targets: ProxyWaTarget[] = unpaidWarga.map((w) => ({
    blok_rumah: w.blok_rumah,
    nama_warga: w.nama_warga,
    no_wa: normalizeWaNumber(w.no_wa),
    pesan: config.template_pesan
      .replaceAll('{nama_warga}', w.nama_warga)
      .replaceAll('{blok_rumah}', w.blok_rumah)
      .replaceAll('{pin_akses}', w.pin_akses)
      .replaceAll('{bulan_tagihan}', bulanNama)
      .replaceAll('{nominal_tagihan}', formatRupiah(w.nominal_iuran))
      .replaceAll('{link_aplikasi}', appUrl),
  }));

  // 1. Jika API Token diisi, kirim nyata lewat server proxy /api/bot-wa/send
  if (config.api_token.trim()) {
    const proxyRes = await dispatchViaServerWaProxy(session, config, targets);
    if (proxyRes.available) {
      if (proxyRes.error) {
        return { error: proxyRes.error };
      }

      const nowIso = new Date().toISOString();
      const newLogs: BotWaLog[] = (proxyRes.results || []).map((r, i) => ({
        id: `walog-${Date.now()}-${i}`,
        created_at: nowIso,
        blok_rumah: r.blok_rumah,
        nama_warga: r.nama_warga,
        no_wa: r.no_wa,
        jenis_pesan: `Pengingat Manual (${bulanNama})`,
        status_kirim: r.status_kirim,
        respon_gateway: r.respon_gateway,
        pesan: r.pesan,
      }));

      await persistBotWaLogs(session, newLogs);

      const sentCount = newLogs.filter((l) => l.status_kirim === 'Terkirim').length;
      const failedCount = newLogs.length - sentCount;

      await recordAuditLog({
        session,
        action: 'TRIGGER_BOT_WA_MANUAL',
        entity: 'bot_wa_logs',
        summary: `Pengingat WA manual bulan ${bulanNama} via ${config.provider}: ${sentCount} terkirim, ${failedCount} gagal.`,
        metadata: { targetBlok: unpaidWarga.map((w) => w.blok_rumah) },
      });

      if (sentCount === 0 && failedCount > 0) {
        return {
          error: `Pengiriman gagal (${failedCount} nomor). Cek respon gateway pada Log Pengiriman: ${newLogs[0]?.respon_gateway || ''}`,
        };
      }

      return {
        data: {
          sentCount,
          message:
            failedCount > 0
              ? `Selesai via ${config.provider}: ${sentCount} terkirim, ${failedCount} gagal (cek Log Pengiriman).`
              : `Pengingat tagihan ${bulanNama} berhasil dikirim via ${config.provider} ke ${sentCount} warga.`,
        },
      };
    }
  }

  // 2. Fallback ke Supabase Edge Function jika hosting statis tanpa Express proxy
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.functions.invoke('wa-reminder-ipl', {
        body: { manual: true },
      });
      if (error) throw error;

      const sentCount = Number((data as { sent?: number } | null)?.sent ?? 0);
      await recordAuditLog({
        session,
        action: 'TRIGGER_BOT_WA_MANUAL',
        entity: 'bot_wa_logs',
        summary: `Menjalankan pengiriman pengingat WA manual via Edge Function wa-reminder-ipl (${sentCount} pesan diproses).`,
      });
      return {
        data: {
          sentCount,
          message: `Pengingat manual berhasil dipicu melalui Edge Function wa-reminder-ipl (${sentCount} pesan terkirim).`,
        },
      };
    } catch (err) {
      return {
        error: parseFriendlyError(
          err,
          'Gagal memanggil Edge Function wa-reminder-ipl. Pastikan API Token sudah diisi atau fungsi sudah di-deploy di Supabase.'
        ),
      };
    }
  }

  // 3. Fallback simulasi lokal bila API Token masih kosong
  const nowIso = new Date().toISOString();
  const newLogs: BotWaLog[] = targets.map((t, i) => ({
    id: `walog-${Date.now()}-${i}`,
    created_at: nowIso,
    blok_rumah: t.blok_rumah,
    nama_warga: t.nama_warga,
    no_wa: t.no_wa,
    jenis_pesan: `Pengingat Manual (${bulanNama})`,
    status_kirim: 'Terkirim',
    respon_gateway: `Simulasi Lokal (API Token belum diisi) — Siap kirim via ${config.provider}`,
    pesan: t.pesan,
  }));

  await persistBotWaLogs(session, newLogs);

  await recordAuditLog({
    session,
    action: 'TRIGGER_BOT_WA_MANUAL',
    entity: 'bot_wa_logs',
    summary: `Simulasi pengingat WA manual bulan ${bulanNama} ke ${unpaidWarga.length} unit rumah belum lunas.`,
    metadata: { targetBlok: unpaidWarga.map((w) => w.blok_rumah) },
  });

  return {
    data: {
      sentCount: newLogs.length,
      message: `Simulasi pengiriman selesai untuk ${unpaidWarga.length} warga. Isi API Token Fonnte untuk pengiriman WhatsApp nyata.`,
    },
  };
}

export async function sendWargaAccessCredentialsWaAdmin(
  session: SessionUser,
  config: BotWaConfig,
  wargaList: Warga[],
  customTemplate?: string
): Promise<ServiceResult<{ sentCount: number; message: string }>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: pengiriman massal akun & PIN warga khusus Bendahara.' };
  }

  if (!config.api_token.trim()) {
    return { error: 'Masukkan dan simpan API Token Fonnte / Wablas terlebih dahulu.' };
  }

  const activeTargets = wargaList.filter(
    (w) => w.aktif && w.status_hunian !== 'Kosong' && normalizeWaNumber(w.no_wa).length >= 10
  );

  if (activeTargets.length === 0) {
    return {
      error: 'Tidak ada warga aktif dengan nomor WhatsApp valid untuk dikirimi informasi akun.',
    };
  }

  const currentMonth = getCurrentBillingMonth();
  const bulanNama = `${getNamaBulan(currentMonth)} ${TAHUN_AKTIF}`;
  const templateToUse =
    customTemplate && customTemplate.includes('{pin_akses}')
      ? customTemplate
      : WA_ACCESS_TEMPLATE_DEFAULT;

  const targets: ProxyWaTarget[] = activeTargets.map((w) => ({
    blok_rumah: w.blok_rumah,
    nama_warga: w.nama_warga,
    no_wa: normalizeWaNumber(w.no_wa),
    pesan: templateToUse
      .replaceAll('{nama_warga}', w.nama_warga)
      .replaceAll('{blok_rumah}', w.blok_rumah)
      .replaceAll('{pin_akses}', w.pin_akses)
      .replaceAll('{bulan_tagihan}', bulanNama)
      .replaceAll('{nominal_tagihan}', formatRupiah(w.nominal_iuran))
      .replaceAll('{link_aplikasi}', APP_PORTAL_URL),
  }));

  const proxyRes = await dispatchViaServerWaProxy(session, config, targets);
  if (!proxyRes.available) {
    return {
      error:
        'Endpoint /api/bot-wa/send belum aktif. Pastikan pembaruan terbaru sudah di-deploy ke Vercel.',
    };
  }
  if (proxyRes.error) {
    return { error: proxyRes.error };
  }

  const nowIso = new Date().toISOString();
  const newLogs: BotWaLog[] = (proxyRes.results || []).map((r, i) => ({
    id: `walog-pin-${Date.now()}-${i}`,
    created_at: nowIso,
    blok_rumah: r.blok_rumah,
    nama_warga: r.nama_warga,
    no_wa: r.no_wa,
    jenis_pesan: 'Info Akses Akun & PIN Warga',
    status_kirim: r.status_kirim,
    respon_gateway: r.respon_gateway,
    pesan: r.pesan,
  }));

  await persistBotWaLogs(session, newLogs);

  const sentCount = newLogs.filter((l) => l.status_kirim === 'Terkirim').length;
  const failedCount = newLogs.length - sentCount;

  await recordAuditLog({
    session,
    action: 'SEND_WARGA_CREDENTIALS_WA',
    entity: 'bot_wa_logs',
    summary: `Mengirim template akses akun & PIN (https://e-card-ipl.vercel.app) ke ${sentCount} warga aktif via ${config.provider} (${failedCount} gagal).`,
    metadata: { totalTargets: activeTargets.length, sentCount, failedCount },
  });

  if (sentCount === 0 && failedCount > 0) {
    return {
      error: `Pengiriman akses akun & PIN gagal (${failedCount} nomor). Respon: ${newLogs[0]?.respon_gateway || ''}`,
    };
  }

  return {
    data: {
      sentCount,
      message:
        failedCount > 0
          ? `Info akun & PIN dikirim ke ${sentCount} warga (${failedCount} gagal, cek Log Pengiriman).`
          : `Info akun & PIN (https://e-card-ipl.vercel.app) berhasil dikirim ke ${sentCount} warga aktif via ${config.provider}.`,
    },
  };
}

// =========================================================================
// Pengumuman / Notifikasi Massal Sistem untuk Seluruh Akun Warga
// =========================================================================

function readLocalNotifications(): SystemNotification[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SYSTEM_NOTIFICATIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SystemNotification[];
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      : [];
  } catch {
    return [];
  }
}

function writeLocalNotifications(list: SystemNotification[]) {
  try {
    localStorage.setItem(STORAGE_KEYS.SYSTEM_NOTIFICATIONS, JSON.stringify(list.slice(0, 100)));
  } catch {
    // Abaikan jika penyimpanan lokal penuh
  }
}

export async function fetchSystemNotifications(
  session: SessionUser
): Promise<SystemNotification[]> {
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('system_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && Array.isArray(data)) {
        return data as SystemNotification[];
      }
    } catch {
      // Fallback bersih ke localStorage jika tabel system_notifications belum dijalankan di Supabase
    }
  }
  return readLocalNotifications();
}

export async function sendBulkSystemNotificationAdmin(
  session: SessionUser,
  payload: {
    title: string;
    message: string;
    category: NotificationCategory;
    target_scope: NotificationTargetScope;
    wargaList: Warga[];
  }
): Promise<ServiceResult<SystemNotification>> {
  if (session.role !== 'admin') {
    return { error: 'Akses ditolak: hanya Pengurus yang dapat mengirim pengumuman sistem.' };
  }

  const cleanTitle = payload.title.trim();
  const cleanMessage = payload.message.trim();
  if (!cleanTitle) return { error: 'Judul pengumuman wajib diisi.' };
  if (!cleanMessage) return { error: 'Isi pesan pengumuman wajib diisi.' };

  const recipients = payload.wargaList.filter((w) => {
    if (!w.aktif) return false;
    return payload.target_scope === 'all_units' ? true : w.status_hunian !== 'Kosong';
  });

  if (recipients.length === 0) {
    return { error: 'Tidak ada akun warga aktif yang memenuhi target pengiriman.' };
  }

  const nowIso = new Date().toISOString();
  const recipientBlocks = recipients.map((w) => w.blok_rumah);
  const senderJabatan = session.jabatan || 'Pengurus';

  let saved: SystemNotification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    message: cleanMessage,
    category: payload.category,
    target_scope: payload.target_scope,
    recipient_count: recipients.length,
    recipient_blocks: recipientBlocks,
    sender_name: session.nama_warga,
    sender_jabatan: senderJabatan,
    created_at: nowIso,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('system_notifications')
        .insert({
          title: saved.title,
          message: saved.message,
          category: saved.category,
          target_scope: saved.target_scope,
          recipient_count: saved.recipient_count,
          recipient_blocks: recipientBlocks,
          sender_name: saved.sender_name,
          sender_jabatan: saved.sender_jabatan,
          created_at: nowIso,
        })
        .select()
        .single();

      if (!error && data) {
        saved = data as SystemNotification;
      } else {
        // Fallback aman bila tabel system_notifications belum ditambahkan di Supabase
        writeLocalNotifications([saved, ...readLocalNotifications()]);
      }
    } catch {
      writeLocalNotifications([saved, ...readLocalNotifications()]);
    }
  } else {
    writeLocalNotifications([saved, ...readLocalNotifications()]);
  }

  await recordAuditLog({
    session,
    action: 'SEND_BULK_NOTIFICATION',
    entity: 'system_notifications',
    entity_id: saved.id,
    summary: `Mengirim pengumuman sistem "${cleanTitle}" (${payload.category}) ke ${recipients.length} akun warga.`,
    metadata: {
      category: payload.category,
      target_scope: payload.target_scope,
      recipient_count: recipients.length,
    },
  });

  return { data: saved };
}

export async function deleteSystemNotificationAdmin(
  session: SessionUser,
  notif: SystemNotification
): Promise<ServiceResult<boolean>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: penghapusan pengumuman sistem khusus Bendahara.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      await supabase.from('system_notifications').delete().eq('id', notif.id);
    } catch {
      // Lanjut bersihkan fallback lokal
    }
  }

  const filtered = readLocalNotifications().filter((n) => n.id !== notif.id);
  writeLocalNotifications(filtered);

  await recordAuditLog({
    session,
    action: 'DELETE_BULK_NOTIFICATION',
    entity: 'system_notifications',
    entity_id: notif.id,
    summary: `Menghapus pengumuman sistem "${notif.title}".`,
  });

  return { data: true };
}

// =========================================================================
// Pengaturan Metode Pembayaran (QRIS & Nomor Rekening) — Khusus Bendahara
// =========================================================================

function readLocalPaymentConfig(): PaymentConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PAYMENT_CONFIG);
    if (!raw) return SEED_PAYMENT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<PaymentConfig>;
    return {
      ...SEED_PAYMENT_CONFIG,
      ...parsed,
      rekening_list: Array.isArray(parsed.rekening_list)
        ? parsed.rekening_list
        : SEED_PAYMENT_CONFIG.rekening_list,
    };
  } catch {
    return SEED_PAYMENT_CONFIG;
  }
}

function writeLocalPaymentConfig(config: PaymentConfig) {
  try {
    localStorage.setItem(STORAGE_KEYS.PAYMENT_CONFIG, JSON.stringify(config));
  } catch {
    // Abaikan jika kuota localStorage penuh
  }
}

export async function fetchPaymentConfig(session: SessionUser): Promise<PaymentConfig> {
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('payment_config')
        .select('*')
        .eq('id', 'default-payment-config')
        .maybeSingle();
      if (!error && data) {
        const row = data as Partial<PaymentConfig>;
        return {
          ...SEED_PAYMENT_CONFIG,
          ...row,
          rekening_list: Array.isArray(row.rekening_list)
            ? row.rekening_list
            : SEED_PAYMENT_CONFIG.rekening_list,
        };
      }
    } catch {
      // Fallback aman ke localStorage jika tabel payment_config belum dijalankan di Supabase
    }
  }
  return readLocalPaymentConfig();
}

export async function uploadQrisImageAdmin(
  session: SessionUser,
  file: File
): Promise<ServiceResult<string>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: unggah gambar QRIS hanya dapat dilakukan oleh Bendahara.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filePath = `qris/qris-saungkebun-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('bukti-ipl')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from('bukti-ipl').getPublicUrl(filePath);
        return { data: publicUrlData.publicUrl };
      }
    } catch {
      // Lanjut fallback data URL
    }
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    return { data: dataUrl };
  } catch (err) {
    return { error: parseFriendlyError(err, 'Gagal membaca file gambar QRIS.') };
  }
}

export async function savePaymentConfigAdmin(
  session: SessionUser,
  config: PaymentConfig
): Promise<ServiceResult<PaymentConfig>> {
  if (!isBendaharaFullAccess(session)) {
    return {
      error:
        'Akses ditolak: perubahan pengaturan QRIS dan nomor rekening transfer hanya dapat dilakukan oleh Bendahara.',
    };
  }

  const updated: PaymentConfig = {
    ...config,
    id: 'default-payment-config',
    updated_at: new Date().toISOString(),
    updated_by: session.blok_rumah,
  };

  writeLocalPaymentConfig(updated);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('payment_config')
        .upsert(updated, { onConflict: 'id' })
        .select()
        .single();
      if (!error && data) {
        await recordAuditLog({
          session,
          action: 'UPDATE_PAYMENT_CONFIG',
          entity: 'payment_config',
          entity_id: updated.id,
          summary: `Bendahara ${session.nama_warga} memperbarui pengaturan pembayaran (QRIS: ${updated.qris_aktif && updated.qris_image_url ? 'Aktif' : 'Nonaktif'}, ${updated.rekening_list.length} rekening).`,
        });
        return { data: data as PaymentConfig };
      }
    } catch {
      // Tetap berhasil tersimpan lokal bila tabel belum ditambahkan di Supabase
    }
  }

  await recordAuditLog({
    session,
    action: 'UPDATE_PAYMENT_CONFIG',
    entity: 'payment_config',
    entity_id: updated.id,
    summary: `Bendahara ${session.nama_warga} memperbarui pengaturan pembayaran (QRIS: ${updated.qris_aktif && updated.qris_image_url ? 'Aktif' : 'Nonaktif'}, ${updated.rekening_list.length} rekening).`,
  });

  return { data: updated };
}

// =========================================================================
// Pengaturan Identitas Aplikasi (Nama, Sub-Nama, Kop, Logo & No. WA Pengurus)
// =========================================================================

function sanitizePengurusWaMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) {
      const norm = normalizeWaNumber(v);
      if (norm.length >= 9) {
        result[k.trim().toLowerCase()] = norm;
      }
    }
  }
  return result;
}

function mergeAppBrandConfig(
  base: AppBrandConfig,
  incoming?: Partial<AppBrandConfig> | null
): AppBrandConfig {
  if (!incoming) return base;
  const rawWaPengurus =
    typeof incoming.wa_pengurus === 'string' && incoming.wa_pengurus.trim()
      ? normalizeWaNumber(incoming.wa_pengurus)
      : base.wa_pengurus;
  const rawWaBot =
    typeof incoming.wa_bot === 'string' && incoming.wa_bot.trim()
      ? normalizeWaNumber(incoming.wa_bot)
      : base.wa_bot;

  return {
    ...base,
    ...incoming,
    app_name:
      typeof incoming.app_name === 'string' && incoming.app_name.trim()
        ? incoming.app_name.trim()
        : base.app_name,
    app_subtitle:
      typeof incoming.app_subtitle === 'string' && incoming.app_subtitle.trim()
        ? incoming.app_subtitle.trim()
        : base.app_subtitle,
    kop_resmi:
      typeof incoming.kop_resmi === 'string' && incoming.kop_resmi.trim()
        ? incoming.kop_resmi.trim()
        : base.kop_resmi,
    logo_url:
      typeof incoming.logo_url === 'string' && incoming.logo_url.trim()
        ? incoming.logo_url.trim()
        : incoming.logo_url === null
          ? null
          : base.logo_url,
    wa_pengurus: rawWaPengurus || DEFAULT_APP_BRAND_CONFIG.wa_pengurus,
    wa_pengurus_label:
      typeof incoming.wa_pengurus_label === 'string' && incoming.wa_pengurus_label.trim()
        ? incoming.wa_pengurus_label.trim()
        : base.wa_pengurus_label,
    wa_bot: incoming.wa_bot === '' ? '' : rawWaBot,
    pengurus_wa_map:
      incoming.pengurus_wa_map !== undefined
        ? sanitizePengurusWaMap(incoming.pengurus_wa_map)
        : base.pengurus_wa_map,
  };
}

export function readLocalAppBrandConfig(): AppBrandConfig {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.BRAND_CONFIG);
    if (!raw) return DEFAULT_APP_BRAND_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AppBrandConfig>;
    return mergeAppBrandConfig(DEFAULT_APP_BRAND_CONFIG, parsed);
  } catch {
    return DEFAULT_APP_BRAND_CONFIG;
  }
}

function writeLocalAppBrandConfig(config: AppBrandConfig) {
  safeStorageSet(STORAGE_KEYS.BRAND_CONFIG, JSON.stringify(config));
}

export async function fetchAppBrandConfig(session?: SessionUser | null): Promise<AppBrandConfig> {
  const localConfig = readLocalAppBrandConfig();
  const supabase = getSupabaseClient(session || null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .eq('id', 'default-app-brand')
        .maybeSingle();

      if (!error && data) {
        const merged = mergeAppBrandConfig(localConfig, data as Partial<AppBrandConfig>);
        writeLocalAppBrandConfig(merged);
        return merged;
      }
    } catch {
      // Fallback mulus ke penyimpanan lokal bila tabel app_settings belum dijalankan di Supabase
    }
  }
  return localConfig;
}

export async function uploadAppLogoAdmin(
  session: SessionUser,
  file: File
): Promise<ServiceResult<string>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: unggah logo aplikasi hanya dapat dilakukan oleh Bendahara.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const rawExt = file.name?.split('.').pop()?.toLowerCase() || '';
      const safeExt = ['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(rawExt) ? rawExt : 'png';
      const filePath = `branding/logo-app-${Date.now()}.${safeExt}`;
      const { error: uploadError } = await supabase.storage
        .from('bukti-ipl')
        .upload(filePath, file, { cacheControl: '3600', upsert: true });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from('bukti-ipl').getPublicUrl(filePath);
        if (publicUrlData?.publicUrl) {
          return { data: publicUrlData.publicUrl };
        }
      }
    } catch {
      // Lanjut fallback data URL agar tetap berjalan tanpa error di semua perangkat
    }
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    return { data: dataUrl };
  } catch (err) {
    return { error: parseFriendlyError(err, 'Gagal membaca file logo aplikasi.') };
  }
}

export async function saveAppBrandConfigAdmin(
  session: SessionUser,
  config: Pick<
    AppBrandConfig,
    | 'app_name'
    | 'app_subtitle'
    | 'kop_resmi'
    | 'logo_url'
    | 'wa_pengurus'
    | 'wa_pengurus_label'
    | 'wa_bot'
    | 'pengurus_wa_map'
  >
): Promise<ServiceResult<AppBrandConfig>> {
  if (!isBendaharaFullAccess(session)) {
    return {
      error: 'Akses ditolak: perubahan pengaturan aplikasi & WA pengurus hanya dapat dilakukan oleh Bendahara.',
    };
  }

  const cleanName = config.app_name.trim();
  const cleanSubtitle = config.app_subtitle.trim();
  const cleanKop = config.kop_resmi.trim();
  const cleanWaPengurus = normalizeWaNumber(config.wa_pengurus || '');
  const cleanWaBot = config.wa_bot?.trim() ? normalizeWaNumber(config.wa_bot) : '';

  if (!cleanName) {
    return { error: 'Nama aplikasi tidak boleh kosong.' };
  }
  if (!cleanSubtitle) {
    return { error: 'Sub-nama / keterangan perumahan tidak boleh kosong.' };
  }
  if (!cleanWaPengurus || cleanWaPengurus.length < 10) {
    return { error: 'Nomor WhatsApp utama Pengurus tidak valid (minimal 10 digit, contoh: 0812xxxx).' };
  }
  if (cleanWaBot && cleanWaBot === cleanWaPengurus) {
    return {
      error:
        'Nomor WA Pengurus tidak boleh sama dengan Nomor WA Bot. Gunakan nomor pribadi/resmi pengurus agar chat warga tidak masuk ke bot otomatis.',
    };
  }

  const updated: AppBrandConfig = {
    id: 'default-app-brand',
    app_name: cleanName,
    app_subtitle: cleanSubtitle,
    kop_resmi: cleanKop || DEFAULT_APP_BRAND_CONFIG.kop_resmi,
    logo_url: config.logo_url?.trim() || null,
    wa_pengurus: cleanWaPengurus,
    wa_pengurus_label: config.wa_pengurus_label?.trim() || DEFAULT_APP_BRAND_CONFIG.wa_pengurus_label,
    wa_bot: cleanWaBot,
    pengurus_wa_map: sanitizePengurusWaMap(config.pengurus_wa_map),
    updated_at: new Date().toISOString(),
    updated_by: session.blok_rumah,
  };

  writeLocalAppBrandConfig(updated);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .upsert(updated, { onConflict: 'id' })
        .select()
        .single();
      if (!error && data) {
        const persisted = mergeAppBrandConfig(updated, data as Partial<AppBrandConfig>);
        writeLocalAppBrandConfig(persisted);
        await recordAuditLog({
          session,
          action: 'UPDATE_APP_BRAND',
          entity: 'app_settings',
          entity_id: updated.id,
          summary: `Bendahara ${session.nama_warga} memperbarui pengaturan aplikasi "${persisted.app_name}" & No. WA Pengurus (+${persisted.wa_pengurus}).`,
        });
        return { data: persisted };
      }
    } catch {
      // Tetap tersimpan lokal tanpa error bila tabel/kolom app_settings belum diperbarui di Supabase
    }
  }

  await recordAuditLog({
    session,
    action: 'UPDATE_APP_BRAND',
    entity: 'app_settings',
    entity_id: updated.id,
    summary: `Bendahara ${session.nama_warga} memperbarui pengaturan aplikasi "${updated.app_name}" & No. WA Pengurus (+${updated.wa_pengurus}).`,
  });

  return { data: updated };
}
