import {
  APP_PORTAL_URL,
  DEFAULT_APP_BRAND_CONFIG,
  isBendaharaFullAccess,
  isBendaharaOnly,
  isKetuaRole,
  isOccupantNameEmpty,
  NOMINAL_IPL_STANDAR,
  resolveOccupancyStatus,
  SEED_PETUGAS_KEAMANAN,
  SEED_TITIK_PATROLI,
  SUSUNAN_PENGURUS,
  TAHUN_AKTIF,
  WA_ACCESS_TEMPLATE_DEFAULT,
  type AdminJabatan,
  type AdminPermission,
  type AppBrandConfig,
  type BotAccessRole,
  type BotWaConfig,
  type BotWaLog,
  type FundType,
  type HolderRole,
  type JenisHonorPetugas,
  type LoginAccountValidationStatus,
  type LoginAuthErrorCode,
  type LogPatroli,
  type MetodeBayar,
  type MetodeScanPatroli,
  type NotificationCategory,
  type NotificationTargetScope,
  type OccupancyStatus,
  type PatrolMapConfig,
  type PatrolPinCoordinate,
  type PaymentConfig,
  type PengurusAccountInfo,
  type PengurusLingkunganRecord,
  type PetugasKeamanan,
  type PetugasKontakDarurat,
  type SessionUser,
  type StatusEcardBulanan,
  type StatusHunian,
  type StatusKondisiPatroli,
  type StatusVerifikasi,
  type SystemNotification,
  type TitikPatroli,
  type TransaksiIPL,
  type TransaksiKas,
  type UserRole,
  type Warga,
} from '../types';
import { recordAuditLog } from './auditLogger';
import {
  hasSettingModulePermission,
  validateLoginAccountStatus,
} from './centralSettingsService';
import {
  buildWargaBotActivationMessage,
  canonicalizeBlokKey,
  compareBlokRumah,
  formatBillingStartLabel,
  formatBlokRumah,
  formatDaftarBulan,
  formatRupiah,
  generateBuktiKasNumber,
  formatTanggal,
  generateKwitansiNumber,
  generateRandomPin,
  getCurrentBillingMonth,
  getDefaultUnpaidStatusForMonth,
  getNamaBulan,
  isBeforeBillingStart,
  isRealRegisteredPhone,
  isSameBlockCode,
  normalizeBlok,
  normalizeBlockCode,
  normalizePhoneNumber,
  normalizeWaNumber,
  resolveBillingStartPeriod,
  type BillingStartPeriod,
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
import { getSupabaseClient, getSupabaseProbeClient, isSupabaseConfigured } from './supabase';
import {
  routeNewMediaUploadAuto,
  tryDirectDriveUploadIfConnected,
} from './googleDriveHybridService';
import {
  buildKeamananUserId,
  buildPetugasUserId,
  buildWargaUserId,
  dispatchActivityNotifications,
  getAllAdminUserIds,
  getBendaharaAndKetuaUserIds,
  getBendaharaUserIds,
  getCanonicalUserId,
  getKetuaUserIds,
} from './notificationService';
import { buildAvatarKey, cacheAccountAvatars, getCachedAvatarUrl } from './avatarService';

const STORAGE_KEYS = {
  SESSION_LEGACY: 'saungkebun_session_v1',
  SESSION_WARGA: 'saungkebun_session_warga_v1',
  SESSION_ADMIN: 'saungkebun_session_admin_v1',
  SESSION_PETUGAS: 'saungkebun_session_petugas_v1',
  LAST_ACTIVE_ROLE: 'saungkebun_last_active_role_v1',
  WARGA: 'saungkebun_warga_v2',
  TRANSAKSI: 'saungkebun_transaksi_v2',
  STATUS: 'saungkebun_status_v2',
  BOT_CONFIG: 'saungkebun_bot_config_v1',
  BOT_LOGS: 'saungkebun_bot_logs_v1',
  LOGIN_ATTEMPTS: 'saungkebun_login_attempts_v1',
  SYSTEM_NOTIFICATIONS: 'saungkebun_system_notifications_v1',
  PAYMENT_CONFIG: 'saungkebun_payment_config_v1',
  BRAND_CONFIG: 'saungkebun_brand_config_v1',
  TRANSAKSI_KAS: 'saungkebun_transaksi_kas_v1',
  ADMIN_PIN_OVERRIDES: 'saungkebun_admin_pin_overrides_v1',
  PENGURUS_LINGKUNGAN: 'saungkebun_pengurus_lingkungan_v1',
  PETUGAS_KEAMANAN: 'saungkebun_petugas_keamanan_v1',
  TITIK_PATROLI: 'saungkebun_titik_patroli_v1',
  LOG_PATROLI: 'saungkebun_log_patroli_v1',
  PATROL_MAP_CONFIG: 'saungkebun_patrol_map_config_v1',
  APPROVAL_OVERLAY: 'saungkebun_two_step_approval_overlay_v1',
} as const;

const memoryStorageFallback = new Map<string, string>();

function safeStorageGet(key: string): string | null {
  if (typeof window !== 'undefined') {
    try {
      const localVal = window.localStorage.getItem(key);
      if (localVal !== null) return localVal;
    } catch {
      // Abaikan jika localStorage diblokir di WebView/Safari Private Mode
    }
    try {
      const sessionVal = window.sessionStorage.getItem(key);
      if (sessionVal !== null) return sessionVal;
    } catch {
      // Abaikan jika sessionStorage diblokir
    }
  }
  return memoryStorageFallback.get(key) ?? null;
}

function safeStorageSet(key: string, value: string) {
  memoryStorageFallback.set(key, value);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Aman untuk iOS Safari Private Mode / WebView dengan kuota terbatas
    }
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // Abaikan jika sessionStorage diblokir
    }
  }
}

function safeStorageRemove(key: string) {
  memoryStorageFallback.delete(key);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Abaikan
    }
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Abaikan
    }
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
  code?: LoginAuthErrorCode;
  validation?: LoginAccountValidationStatus;
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

export function deriveIplFundType(
  nominal: number,
  bulanCount: number,
  rawFundType?: unknown
): FundType {
  if (rawFundType === 'IPL_REGULER' || rawFundType === 'DANA_DARURAT') {
    return rawFundType;
  }
  const perMonth = Math.round((Number(nominal) || 0) / Math.max(bulanCount, 1));
  return perMonth > 0 && perMonth < NOMINAL_IPL_STANDAR ? 'DANA_DARURAT' : 'IPL_REGULER';
}

export function deriveIplHolderRole(
  metodeBayar?: string | null,
  petugasPenerima?: string | null,
  rawHolderRole?: unknown
): HolderRole {
  if (rawHolderRole === 'BENDAHARA' || rawHolderRole === 'PENGURUS_TITIPAN') {
    return rawHolderRole;
  }
  const petugas = String(petugasPenerima || '').trim();
  if (metodeBayar === 'Setor Tunai' && petugas && !/andriansyah|bendahara/i.test(petugas)) {
    return 'PENGURUS_TITIPAN';
  }
  return 'BENDAHARA';
}

export function deriveKasFundType(kategori?: string | null, rawFundType?: unknown): FundType {
  if (rawFundType === 'IPL_REGULER' || rawFundType === 'DANA_DARURAT') {
    return rawFundType;
  }
  return /darurat/i.test(String(kategori || '')) ? 'DANA_DARURAT' : 'IPL_REGULER';
}

export function deriveKasHolderRole(rawHolderRole?: unknown): HolderRole {
  if (rawHolderRole === 'BENDAHARA' || rawHolderRole === 'PENGURUS_TITIPAN') {
    return rawHolderRole;
  }
  return 'BENDAHARA';
}

function normalizeWargaRecord(raw: Warga): Warga {
  const rawRecord = raw as unknown as Record<string, unknown>;
  const explicitOccupied =
    typeof rawRecord.is_occupied === 'boolean' ? rawRecord.is_occupied : undefined;
  const explicitExempt = rawRecord.is_exempt === true;
  const explicitPengurus =
    rawRecord.is_pengurus === true || Boolean(raw.is_active_pengurus);

  const rawStatus = String(raw.status_hunian || '').trim();
  let normalizedStatus: StatusHunian;
  if (explicitOccupied === false) {
    normalizedStatus = 'Kosong';
  } else if (rawStatus === 'Tetap' || rawStatus === 'Kontrak' || rawStatus === 'Kosong') {
    normalizedStatus = rawStatus;
  } else {
    normalizedStatus = isOccupantNameEmpty(raw.nama_warga) ? 'Kosong' : 'Tetap';
  }
  const occupancy = resolveOccupancyStatus({
    occupancy_status: raw.occupancy_status,
    status_hunian: normalizedStatus,
    nama_warga: raw.nama_warga,
    is_occupied: explicitOccupied,
  });
  return {
    ...raw,
    status_hunian: normalizedStatus,
    occupancy_status: occupancy,
    is_occupied: explicitOccupied ?? occupancy !== 'kosong',
    is_exempt: explicitExempt,
    is_pengurus: explicitPengurus,
  };
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
    const verifiedList = allTrx.filter(
      (t) => t.status_verifikasi === 'Terverifikasi' && t.bulan_dibayar.includes(bulan)
    );
    const verifiedPaid = verifiedList.reduce((sum, t) => {
      const div = Math.max(t.bulan_dibayar.length, 1);
      return sum + Math.round((Number(t.nominal) || 0) / div);
    }, 0);
    const pending = allTrx.find(
      (t) =>
        (t.status_verifikasi === 'Pending' || t.status_verifikasi === 'ACC Bendahara') &&
        t.bulan_dibayar.includes(bulan)
    );
    let status = getDefaultUnpaidStatusForMonth(bulan);
    let transaksi_id: string | null = null;
    if (verifiedPaid >= NOMINAL_IPL_STANDAR && verifiedList.length > 0) {
      status = 'Lunas';
      transaksi_id = verifiedList[0].id;
    } else if (pending) {
      status = 'Menunggu Verifikasi';
      transaksi_id = pending.id;
    } else if (verifiedList.length > 0) {
      transaksi_id = verifiedList[0].id;
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

function getSessionKeyForRole(role: UserRole): string {
  if (role === 'admin') return STORAGE_KEYS.SESSION_ADMIN;
  if (role === 'petugas') return STORAGE_KEYS.SESSION_PETUGAS;
  return STORAGE_KEYS.SESSION_WARGA;
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

export function loadStoredSession(expectedRole?: UserRole): SessionUser | null {
  try {
    if (expectedRole) {
      const roleKey = getSessionKeyForRole(expectedRole);
      const raw = safeStorageGet(roleKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionUser;
        if (parsed?.role === expectedRole && parsed?.blok_rumah) {
          if (expectedRole === 'petugas' && !parsed.petugas_id) return null;
          return hydrateAdminSession(parsed);
        }
      }
      if (expectedRole !== 'petugas') {
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

export function loadLastActiveSession(): SessionUser | null {
  try {
    const rawRole = safeStorageGet(STORAGE_KEYS.LAST_ACTIVE_ROLE);
    if (rawRole === 'warga' || rawRole === 'admin' || rawRole === 'petugas') {
      const preferred = loadStoredSession(rawRole);
      if (preferred) return preferred;
    }
    return (
      loadStoredSession('warga') ||
      loadStoredSession('admin') ||
      loadStoredSession('petugas') ||
      null
    );
  } catch {
    return null;
  }
}

export function saveStoredSession(session: SessionUser) {
  safeStorageSet(getSessionKeyForRole(session.role), JSON.stringify(session));
  safeStorageSet(STORAGE_KEYS.LAST_ACTIVE_ROLE, session.role);
  if (session.role !== 'petugas') {
    safeStorageRemove(STORAGE_KEYS.SESSION_LEGACY);
  }
}

export function clearStoredSession(session?: SessionUser | null, roleOverride?: UserRole) {
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
    const lastActive = safeStorageGet(STORAGE_KEYS.LAST_ACTIVE_ROLE);
    if (lastActive === targetRole) {
      safeStorageRemove(STORAGE_KEYS.LAST_ACTIVE_ROLE);
    }
  } else {
    safeStorageRemove(STORAGE_KEYS.SESSION_WARGA);
    safeStorageRemove(STORAGE_KEYS.SESSION_ADMIN);
    safeStorageRemove(STORAGE_KEYS.SESSION_PETUGAS);
    safeStorageRemove(STORAGE_KEYS.LAST_ACTIVE_ROLE);
  }
  if (targetRole !== 'petugas') {
    safeStorageRemove(STORAGE_KEYS.SESSION_LEGACY);
  }
}

function buildWargaBlokCandidates(input: string): string[] {
  const rawNormalized = normalizeBlok(input).replace(/-/g, '/');
  if (!rawNormalized) return [];
  const candidates = [rawNormalized];
  const padded = formatBlokRumah(rawNormalized);
  if (padded && !candidates.includes(padded)) {
    candidates.push(padded);
  }
  const unpaddedMatch = rawNormalized.match(/^([A-Z]+)0*(\d+)\/0*(\d+)$/);
  if (unpaddedMatch) {
    const canonical = `${unpaddedMatch[1]}${Number(unpaddedMatch[2])}/${Number(unpaddedMatch[3])}`;
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

  // Validasi eksklusivitas akun Pengurus vs. Warga sebelum memanggil login_ecard
  const accountValidation = await validateLoginAccountStatus({
    identifier: primaryBlok,
    portal: 'warga',
  });
  if (accountValidation.is_active_pengurus) {
    const pengurusIdentity = [
      accountValidation.pengurus_nama,
      accountValidation.pengurus_jabatan,
    ]
      .filter(Boolean)
      .join(' · ');
    const blockMessage =
      accountValidation.message ||
      `Akun ${accountValidation.linked_blok_rumah || primaryBlok} terdaftar sebagai Pengurus aktif${
        pengurusIdentity ? ` (${pengurusIdentity})` : ''
      }. Silakan masuk melalui jalur Portal Pengurus (/admin).`;
    await recordAuditLog({
      action: 'LOGIN_BLOCKED_ACTIVE_PENGURUS',
      entity: 'auth',
      entity_id: primaryBlok,
      summary: `Login jalur Warga diblokir untuk ${primaryBlok} karena berstatus Pengurus aktif.`,
      metadata: {
        portal: 'warga',
        is_active_pengurus: true,
        pengurus_username: accountValidation.pengurus_username || null,
      },
    });
    return {
      error: blockMessage,
      code: 'ACTIVE_PENGURUS_MUST_USE_ADMIN_PORTAL',
      validation: accountValidation,
    };
  }

  const supabase = getSupabaseProbeClient({
    role: 'warga',
    blokRumah: primaryBlok,
  });
  if (supabase && isSupabaseConfigured()) {
    try {
      let matchedRow: Record<string, unknown> | null = null;

      for (const candidateBlok of blokCandidates) {
        const probeSupabase =
          getSupabaseProbeClient({ role: 'warga', blokRumah: candidateBlok }) || supabase;
        const { data, error } = await probeSupabase.rpc('login_ecard', {
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

      const resolvedAvatar =
        (typeof matchedRow.avatar_url === 'string' && matchedRow.avatar_url.trim()) ||
        getCachedAvatarUrl('warga', matchedRow.blok_rumah) ||
        null;
      if (resolvedAvatar) {
        cacheAccountAvatars([{ key: buildAvatarKey('warga', matchedRow.blok_rumah), url: resolvedAvatar }]);
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
        avatar_url: resolvedAvatar,
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
    avatar_url: matched.avatar_url || getCachedAvatarUrl('warga', matched.blok_rumah) || null,
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

  // Validasi eksklusivitas akun Pengurus vs. Pemulihan Otomatis Akun Warga
  const accountValidation = await validateLoginAccountStatus({
    identifier: cleanUsername,
    portal: 'admin',
  });
  if (
    !accountValidation.is_active_pengurus &&
    (accountValidation.reason_code === 'PENGURUS_REVOKED_WARGA_RESTORED' ||
      (accountValidation.is_active_warga && accountValidation.warga_account_status === 'active'))
  ) {
    const linkedBlokLabel = accountValidation.linked_blok_rumah
      ? ` Blok ${accountValidation.linked_blok_rumah}`
      : '';
    const revokedMessage =
      accountValidation.message ||
      `Hak akses Pengurus untuk akun "${cleanUsername}" telah dinonaktifkan. Akun Warga${linkedBlokLabel} Anda sudah otomatis aktif kembali dan kini dapat digunakan melalui Portal Warga.`;
    await recordAuditLog({
      action: 'LOGIN_BLOCKED_PENGURUS_REVOKED',
      entity: 'auth',
      entity_id: cleanUsername,
      summary: `Login jalur Pengurus ditolak untuk "${cleanUsername}" karena status Pengurus nonaktif (akun Warga otomatis aktif kembali).`,
      metadata: {
        portal: 'admin',
        is_active_pengurus: false,
        is_active_warga: accountValidation.is_active_warga,
        warga_account_status: accountValidation.warga_account_status,
        linked_blok_rumah: accountValidation.linked_blok_rumah || null,
      },
    });
    return {
      error: revokedMessage,
      code: 'PENGURUS_REVOKED_WARGA_RESTORED',
      validation: accountValidation,
    };
  }

  const supabase = getSupabaseProbeClient({
    role: 'admin',
    blokRumah: cleanUsername,
  });
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

      const resolvedAdminAvatar =
        (typeof row.avatar_url === 'string' && row.avatar_url.trim()) ||
        getCachedAvatarUrl('admin', row.blok_rumah) ||
        null;
      if (resolvedAdminAvatar) {
        cacheAccountAvatars([{ key: buildAvatarKey('admin', row.blok_rumah), url: resolvedAdminAvatar }]);
      }
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
        avatar_url: resolvedAdminAvatar,
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

  const pinOverrides = (() => {
    try {
      const raw = safeStorageGet(STORAGE_KEYS.ADMIN_PIN_OVERRIDES);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();

  const storedPengurus = readLocal<PengurusLingkunganRecord[]>(
    STORAGE_KEYS.PENGURUS_LINGKUNGAN,
    []
  );
  const matchedStoredPengurus = storedPengurus.find((acc) => {
    if (!acc.aktif) return false;
    const uname = acc.username.trim().toLowerCase();
    const effectivePin = pinOverrides[uname] || acc.pin_akses;
    return uname === cleanUsername && effectivePin === cleanPin;
  });

  const matchedAdmin =
    matchedStoredPengurus
      ? {
          username: matchedStoredPengurus.username.trim().toLowerCase(),
          nama: matchedStoredPengurus.nama,
          jabatan: (matchedStoredPengurus.jabatan || 'Humas') as AdminJabatan,
          permission: matchedStoredPengurus.permission,
        }
      : LOCAL_ADMIN_ACCOUNTS.find((acc) => {
          const effectivePin = pinOverrides[acc.username] || acc.pin;
          return acc.username === cleanUsername && effectivePin === cleanPin;
        });
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
    avatar_url: getCachedAvatarUrl('admin', matchedAdmin.username) || null,
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

/**
 * Memulihkan sesi Portal Warga setelah verifikasi biometrik perangkat (Sidik Jari / Face ID) berhasil.
 * Memverifikasi ulang status aktif unit warga langsung ke Supabase tanpa pernah menyimpan PIN di perangkat.
 */
export async function loginWargaWithBiometric(enrolled: {
  blok_rumah: string;
  nama: string;
}): Promise<ServiceResult<SessionUser>> {
  const blokCandidates = buildWargaBlokCandidates(enrolled.blok_rumah);
  const primaryBlok = blokCandidates[0] || enrolled.blok_rumah.trim();
  if (!primaryBlok) {
    return { error: 'Profil biometrik warga tidak valid. Silakan masuk menggunakan PIN 6 digit.' };
  }

  // Validasi eksklusivitas akun sebelum memulihkan sesi biometrik Warga
  const accountValidation = await validateLoginAccountStatus({
    identifier: primaryBlok,
    portal: 'warga',
  });
  if (accountValidation.is_active_pengurus) {
    return {
      error:
        accountValidation.message ||
        `Akun ${accountValidation.linked_blok_rumah || primaryBlok} saat ini berstatus Pengurus aktif. Silakan masuk melalui Portal Pengurus.`,
      code: 'ACTIVE_PENGURUS_MUST_USE_ADMIN_PORTAL',
      validation: accountValidation,
    };
  }

  const candidateSession: SessionUser = {
    role: 'warga',
    blok_rumah: primaryBlok,
    nama_warga: enrolled.nama.trim() || primaryBlok,
    login_at: new Date().toISOString(),
  };

  const supabase = getSupabaseClient(candidateSession);
  if (supabase && isSupabaseConfigured()) {
    try {
      let matchedRow: Record<string, unknown> | null = null;

      for (const candidateBlok of blokCandidates) {
        const { data, error } = await supabase
          .from('users_warga')
          .select('*')
          .eq('blok_rumah', candidateBlok)
          .maybeSingle();

        if (error) {
          return {
            error: parseFriendlyError(
              error,
              'Gagal memverifikasi status aktif akun warga di server. Silakan masuk dengan PIN.'
            ),
          };
        }

        if (data && typeof data.blok_rumah === 'string') {
          matchedRow = data as Record<string, unknown>;
          break;
        }
      }

      if (!matchedRow || matchedRow.aktif !== true || matchedRow.role === 'admin') {
        return {
          error:
            'Akun warga ini sudah dinonaktifkan atau tidak ditemukan. Hubungi Pengurus Lingkungan.',
        };
      }

      const blokRes = String(matchedRow.blok_rumah);
      const resolvedAvatar =
        (typeof matchedRow.avatar_url === 'string' && matchedRow.avatar_url.trim()) ||
        getCachedAvatarUrl('warga', blokRes) ||
        null;
      if (resolvedAvatar) {
        cacheAccountAvatars([{ key: buildAvatarKey('warga', blokRes), url: resolvedAvatar }]);
      }

      const verifiedSession: SessionUser = {
        role: 'warga',
        blok_rumah: blokRes,
        nama_warga:
          (typeof matchedRow.nama_warga === 'string' && matchedRow.nama_warga) ||
          enrolled.nama ||
          blokRes,
        status_hunian: matchedRow.status_hunian as StatusHunian | undefined,
        no_wa: typeof matchedRow.no_wa === 'string' ? matchedRow.no_wa : undefined,
        nominal_iuran:
          typeof matchedRow.nominal_iuran === 'number'
            ? matchedRow.nominal_iuran
            : NOMINAL_IPL_STANDAR,
        avatar_url: resolvedAvatar,
        login_at: new Date().toISOString(),
      };

      saveStoredSession(verifiedSession);
      await recordAuditLog({
        session: verifiedSession,
        action: 'LOGIN_WARGA_BIOMETRIC_SUCCESS',
        entity: 'auth',
        entity_id: verifiedSession.blok_rumah,
        summary: `Warga ${verifiedSession.nama_warga} (${verifiedSession.blok_rumah}) masuk ke Portal Warga via Biometrik.`,
      });
      return { data: verifiedSession };
    } catch {
      return {
        error:
          'Koneksi ke server terganggu saat memverifikasi akun. Coba lagi atau gunakan PIN 6 digit.',
      };
    }
  }

  // Fallback Mode Lokal
  ensureLocalStoreInitialized();
  const wargaList = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);
  const matched = wargaList.find(
    (w) => w.aktif && blokCandidates.includes(normalizeBlok(w.blok_rumah))
  );
  if (!matched) {
    return {
      error: 'Akun warga tidak aktif atau tidak ditemukan. Silakan masuk menggunakan PIN 6 digit.',
    };
  }

  const localSession: SessionUser = {
    role: 'warga',
    blok_rumah: matched.blok_rumah,
    nama_warga: matched.nama_warga,
    status_hunian: matched.status_hunian,
    no_wa: matched.no_wa,
    nominal_iuran: matched.nominal_iuran,
    avatar_url: matched.avatar_url || getCachedAvatarUrl('warga', matched.blok_rumah) || null,
    login_at: new Date().toISOString(),
  };

  saveStoredSession(localSession);
  await recordAuditLog({
    session: localSession,
    action: 'LOGIN_WARGA_BIOMETRIC_SUCCESS',
    entity: 'auth',
    entity_id: localSession.blok_rumah,
    summary: `Warga ${localSession.nama_warga} (${localSession.blok_rumah}) masuk ke Portal Warga via Biometrik.`,
  });
  return { data: localSession };
}

/**
 * Memulihkan sesi Portal Admin / Pengurus setelah verifikasi biometrik perangkat (Sidik Jari / Face ID) berhasil.
 * Memverifikasi ulang status aktif pengurus langsung ke Supabase tanpa pernah menyimpan PIN di perangkat.
 */
export async function loginAdminWithBiometric(enrolled: {
  username: string;
  nama: string;
  jabatan?: string;
}): Promise<ServiceResult<SessionUser>> {
  const cleanUsername = resolvePengurusAdminUsername(enrolled.username);
  if (!cleanUsername) {
    return { error: 'Profil biometrik pengurus tidak valid. Silakan masuk menggunakan PIN 6 digit.' };
  }

  // Validasi status aktif Pengurus & pemulihan akun Warga sebelum memulihkan sesi biometrik Admin
  const accountValidation = await validateLoginAccountStatus({
    identifier: cleanUsername,
    portal: 'admin',
  });
  if (
    !accountValidation.is_active_pengurus &&
    (accountValidation.reason_code === 'PENGURUS_REVOKED_WARGA_RESTORED' ||
      (accountValidation.is_active_warga && accountValidation.warga_account_status === 'active'))
  ) {
    return {
      error:
        accountValidation.message ||
        `Hak akses Pengurus untuk akun "${cleanUsername}" telah dicabut. Akun Warga${
          accountValidation.linked_blok_rumah ? ` Blok ${accountValidation.linked_blok_rumah}` : ''
        } Anda otomatis aktif kembali untuk masuk lewat Portal Warga.`,
      code: 'PENGURUS_REVOKED_WARGA_RESTORED',
      validation: accountValidation,
    };
  }

  const candidateSession: SessionUser = {
    role: 'admin',
    blok_rumah: cleanUsername,
    nama_warga: enrolled.nama.trim() || cleanUsername,
    login_at: new Date().toISOString(),
  };

  const supabase = getSupabaseClient(candidateSession);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('users_warga')
        .select('*')
        .eq('blok_rumah', cleanUsername)
        .maybeSingle();

      if (error) {
        return {
          error: parseFriendlyError(
            error,
            'Gagal memverifikasi status aktif akun pengurus di server. Silakan masuk dengan PIN.'
          ),
        };
      }

      const row = data as Record<string, unknown> | null;
      const isAdminRole = row && (row.role === 'admin' || row.role === 'bendahara');
      if (!row || row.aktif !== true || !isAdminRole) {
        return {
          error:
            'Akun pengurus ini sudah dinonaktifkan atau tidak ditemukan. Silakan masuk dengan PIN 6 digit.',
        };
      }

      const blokRes = String(row.blok_rumah);
      const pengurusMeta = SUSUNAN_PENGURUS.find(
        (p) => p.username.toLowerCase() === blokRes.toLowerCase()
      );
      const resolvedJabatan =
        (row.jabatan as AdminJabatan | undefined) || pengurusMeta?.jabatan || 'Bendahara';
      const resolvedPerm: AdminPermission =
        (row.admin_permission as AdminPermission | undefined) ||
        pengurusMeta?.permission ||
        (resolvedJabatan === 'Bendahara' ? 'full' : 'add_only');

      const resolvedAdminAvatar =
        (typeof row.avatar_url === 'string' && row.avatar_url.trim()) ||
        getCachedAvatarUrl('admin', blokRes) ||
        null;
      if (resolvedAdminAvatar) {
        cacheAccountAvatars([{ key: buildAvatarKey('admin', blokRes), url: resolvedAdminAvatar }]);
      }

      const verifiedSession: SessionUser = {
        role: 'admin',
        blok_rumah: blokRes,
        nama_warga:
          (typeof row.nama_warga === 'string' && row.nama_warga) ||
          pengurusMeta?.nama ||
          enrolled.nama ||
          'Pengurus Lingkungan',
        jabatan: resolvedJabatan,
        admin_permission: resolvedPerm,
        status_hunian: row.status_hunian as StatusHunian | undefined,
        no_wa: typeof row.no_wa === 'string' ? row.no_wa : undefined,
        nominal_iuran: 0,
        avatar_url: resolvedAdminAvatar,
        login_at: new Date().toISOString(),
      };

      saveStoredSession(verifiedSession);
      await recordAuditLog({
        session: verifiedSession,
        action: 'LOGIN_ADMIN_BIOMETRIC_SUCCESS',
        entity: 'auth',
        entity_id: verifiedSession.blok_rumah,
        summary: `Login Pengurus via Biometrik berhasil (${resolvedJabatan} — ${
          resolvedPerm === 'full' ? 'Akses Penuh' : 'Tambah Data'
        }) untuk ${verifiedSession.nama_warga} [${verifiedSession.blok_rumah}].`,
      });
      return { data: verifiedSession };
    } catch {
      return {
        error:
          'Koneksi ke server terganggu saat memverifikasi akun pengurus. Coba lagi atau gunakan PIN 6 digit.',
      };
    }
  }

  // Fallback Mode Lokal
  ensureLocalStoreInitialized();
  const matchedAdmin = LOCAL_ADMIN_ACCOUNTS.find((acc) => acc.username === cleanUsername);
  if (!matchedAdmin) {
    return {
      error: 'Akun pengurus tidak aktif atau tidak ditemukan. Silakan masuk menggunakan PIN 6 digit.',
    };
  }

  const localSession: SessionUser = {
    role: 'admin',
    blok_rumah: matchedAdmin.username,
    nama_warga: matchedAdmin.nama,
    jabatan: matchedAdmin.jabatan,
    admin_permission: matchedAdmin.permission,
    avatar_url: getCachedAvatarUrl('admin', matchedAdmin.username) || null,
    login_at: new Date().toISOString(),
  };

  saveStoredSession(localSession);
  await recordAuditLog({
    session: localSession,
    action: 'LOGIN_ADMIN_BIOMETRIC_SUCCESS',
    entity: 'auth',
    entity_id: matchedAdmin.username,
    summary: `${matchedAdmin.nama} (${matchedAdmin.jabatan}) masuk ke Portal Admin via Biometrik.`,
  });
  return { data: localSession };
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
    petugasKontak: PetugasKontakDarurat[];
    patroliFeed: LogPatroli[];
    titikPatroli: TitikPatroli[];
    patrolMapConfig: PatrolMapConfig;
  }>
> {
  if (session.role !== 'warga') {
    return { error: 'Sesi warga tidak valid.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const [
        profilRes,
        statusRes,
        trxRes,
        notifications,
        paymentConfig,
        petugasKontak,
        patroliFeed,
        titikPatroli,
        patrolMapConfig,
      ] = await Promise.all([
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
        fetchPetugasKontakDarurat(session),
        fetchRecentLogPatroli(session, 30),
        fetchTitikPatroliPublic(session),
        fetchPatrolMapConfig(session),
      ]);

      if (profilRes.error) throw profilRes.error;
      if (statusRes.error) throw statusRes.error;
      if (trxRes.error) throw trxRes.error;

      const normalizedRiwayat = ((trxRes.data || []) as Record<string, unknown>[]).map(
        normalizeTransaksiRow
      );
      const reconciled = reconcileStatusWithTransactions(
        (statusRes.data || []) as StatusEcardBulanan[],
        normalizedRiwayat
      );
      const existingMap = new Map<number, StatusEcardBulanan>();
      for (const row of reconciled) {
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

      const rawProfil = profilRes.data as Warga;
      const profil: Warga = normalizeWargaRecord({
        ...rawProfil,
        avatar_url:
          rawProfil.avatar_url || getCachedAvatarUrl('warga', rawProfil.blok_rumah) || null,
      });
      if (profil.avatar_url) {
        cacheAccountAvatars([{ key: buildAvatarKey('warga', profil.blok_rumah), url: profil.avatar_url }]);
      }
      const relevantNotifications = notifications
        .filter((n) => n.target_scope === 'all_units' || profil.status_hunian !== 'Kosong')
        .map(({ recipient_blocks: _omit, ...safeNotif }) => safeNotif);

      return {
        data: {
          profil,
          statusBulanan: complete12,
          riwayat: normalizedRiwayat,
          notifications: relevantNotifications,
          paymentConfig,
          petugasKontak,
          patroliFeed,
          titikPatroli,
          patrolMapConfig,
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
    .map((t) => normalizeTransaksiRow(t as unknown as Record<string, unknown>))
    .sort((a, b) => new Date(b.tanggal_setor).getTime() - new Date(a.tanggal_setor).getTime());

  const [notifications, paymentConfig, petugasKontak, patroliFeed, titikPatroli, patrolMapConfig] =
    await Promise.all([
      fetchSystemNotifications(session),
      fetchPaymentConfig(session),
      fetchPetugasKontakDarurat(session),
      fetchRecentLogPatroli(session, 30),
      fetchTitikPatroliPublic(session),
      fetchPatrolMapConfig(session),
    ]);

  const safeNotifications = notifications
    .filter((n) => n.target_scope === 'all_units' || profil.status_hunian !== 'Kosong')
    .map(({ recipient_blocks: _omit, ...safeNotif }) => safeNotif);

  return {
    data: {
      profil: {
        ...profil,
        avatar_url: profil.avatar_url || getCachedAvatarUrl('warga', profil.blok_rumah) || null,
      },
      statusBulanan,
      riwayat,
      notifications: safeNotifications,
      paymentConfig,
      petugasKontak,
      patroliFeed,
      titikPatroli,
      patrolMapConfig,
    },
  };
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

interface ApprovalOverlayEntry {
  status_verifikasi: StatusVerifikasi;
  bendahara_approved_at?: string | null;
  bendahara_approved_by?: string | null;
  ketua_approved_at?: string | null;
  ketua_approved_by?: string | null;
  ketua_catatan?: string | null;
  catatan_admin?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
}

function readApprovalOverlay(): Record<string, ApprovalOverlayEntry> {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.APPROVAL_OVERLAY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ApprovalOverlayEntry>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeApprovalOverlayEntry(key: string, entry: ApprovalOverlayEntry | null) {
  const map = readApprovalOverlay();
  if (!entry) {
    delete map[key];
  } else {
    map[key] = entry;
  }
  safeStorageSet(STORAGE_KEYS.APPROVAL_OVERLAY, JSON.stringify(map));
}

const ACC_MARKER_REGEX = /^\[ACC_BENDAHARA\|([^|\]]+)\|([^\]]+)\]\s*/;

function stripInternalMarkers(text: string | null): string | null {
  if (!text) return null;
  const cleaned = text.replace(ACC_MARKER_REGEX, '').trim();
  return cleaned || null;
}

function normalizeStatusVerifikasi(raw: unknown): StatusVerifikasi {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'terverifikasi' || val === 'approved' || val === 'lunas' || val === 'verified' || val === 'sah') {
    return 'Terverifikasi';
  }
  if (
    val === 'acc bendahara' ||
    val === 'acc_bendahara' ||
    val === 'bendahara_acc' ||
    val === 'menunggu_ketua' ||
    val === 'menunggu ketua' ||
    val === 'waiting_ketua'
  ) {
    return 'ACC Bendahara';
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
  const id = String(row.id || '');
  const rawCatatan = typeof row.catatan_admin === 'string' ? row.catatan_admin : null;
  const markerMatch = rawCatatan ? rawCatatan.match(ACC_MARKER_REGEX) : null;

  let status = normalizeStatusVerifikasi(row.status_verifikasi);
  let bendaharaApprovedAt =
    typeof row.bendahara_approved_at === 'string' ? row.bendahara_approved_at : null;
  let bendaharaApprovedBy =
    typeof row.bendahara_approved_by === 'string' ? row.bendahara_approved_by : null;
  let ketuaApprovedAt = typeof row.ketua_approved_at === 'string' ? row.ketua_approved_at : null;
  let ketuaApprovedBy = typeof row.ketua_approved_by === 'string' ? row.ketua_approved_by : null;
  let ketuaCatatan = typeof row.ketua_catatan === 'string' ? row.ketua_catatan : null;
  let catatanAdmin = stripInternalMarkers(rawCatatan);
  let verifiedAt = typeof row.verified_at === 'string' ? row.verified_at : null;
  let verifiedBy = typeof row.verified_by === 'string' ? row.verified_by : null;

  if (status === 'Pending' && markerMatch) {
    status = 'ACC Bendahara';
    bendaharaApprovedBy = bendaharaApprovedBy || markerMatch[1];
    bendaharaApprovedAt = bendaharaApprovedAt || markerMatch[2];
  }

  // Merge sidecar overlay HANYA jika DB masih berada di skema lama (belum menyimpan status terbaru).
  // Jangan pernah biarkan overlay lama menimpa status DB yang sudah Terverifikasi, Ditolak, atau ACC Bendahara.
  const overlay = id ? readApprovalOverlay()[`ipl::${id}`] : undefined;
  if (overlay) {
    const dbAlreadyFinal = status === 'Terverifikasi' || status === 'Ditolak';
    const overlayStaleVsAcc =
      status === 'ACC Bendahara' &&
      (overlay.status_verifikasi === 'Pending' || overlay.status_verifikasi === 'ACC Bendahara');
    const overlayMatchesDb = status === overlay.status_verifikasi;

    if (dbAlreadyFinal || overlayStaleVsAcc || overlayMatchesDb) {
      writeApprovalOverlayEntry(`ipl::${id}`, null);
    } else {
      status = overlay.status_verifikasi;
      if (overlay.bendahara_approved_at !== undefined) {
        bendaharaApprovedAt = overlay.bendahara_approved_at;
      }
      if (overlay.bendahara_approved_by !== undefined) {
        bendaharaApprovedBy = overlay.bendahara_approved_by;
      }
      if (overlay.ketua_approved_at !== undefined) {
        ketuaApprovedAt = overlay.ketua_approved_at;
      }
      if (overlay.ketua_approved_by !== undefined) {
        ketuaApprovedBy = overlay.ketua_approved_by;
      }
      if (overlay.ketua_catatan !== undefined) {
        ketuaCatatan = overlay.ketua_catatan;
      }
      if (overlay.catatan_admin !== undefined) {
        catatanAdmin = stripInternalMarkers(overlay.catatan_admin);
      }
      if (overlay.verified_at !== undefined) {
        verifiedAt = overlay.verified_at;
      }
      if (overlay.verified_by !== undefined) {
        verifiedBy = overlay.verified_by;
      }
    }
  }

  const parsedNominal = Number(row.nominal) || 0;
  const parsedMetode = (row.metode_bayar as MetodeBayar) || 'Transfer Bank';
  const parsedPetugas = typeof row.petugas_penerima === 'string' ? row.petugas_penerima : null;

  return {
    id,
    no_kwitansi: String(row.no_kwitansi || ''),
    blok_rumah: String(row.blok_rumah || '').trim(),
    nama_warga: String(row.nama_warga || '').trim() || String(row.blok_rumah || ''),
    tahun: Number.isFinite(parsedTahun) && parsedTahun > 2000 ? parsedTahun : TAHUN_AKTIF,
    bulan_dibayar: bulanArr,
    nominal: parsedNominal,
    metode_bayar: parsedMetode,
    petugas_penerima: parsedPetugas,
    bukti_url: typeof row.bukti_url === 'string' ? row.bukti_url : null,
    status_verifikasi: status,
    catatan_admin: catatanAdmin,
    keterangan: typeof row.keterangan === 'string' ? row.keterangan : null,
    tanggal_setor: String(row.tanggal_setor || new Date().toISOString()),
    verified_at: verifiedAt,
    verified_by: verifiedBy,
    bendahara_approved_at: bendaharaApprovedAt,
    bendahara_approved_by: bendaharaApprovedBy,
    ketua_approved_at: ketuaApprovedAt,
    ketua_approved_by: ketuaApprovedBy,
    ketua_catatan: ketuaCatatan,
    fund_type: deriveIplFundType(parsedNominal, bulanArr.length, row.fund_type),
    holder_role: deriveIplHolderRole(parsedMetode, parsedPetugas, row.holder_role),
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

  const verifiedAmountByKey = new Map<string, number>();
  for (const trx of transaksiList) {
    if (trx.status_verifikasi !== 'Terverifikasi') continue;
    const div = Math.max(trx.bulan_dibayar.length, 1);
    const perMonth = Math.round((Number(trx.nominal) || 0) / div);
    for (const bulan of trx.bulan_dibayar) {
      const key = `${canonicalizeBlokKey(trx.blok_rumah)}::${trx.tahun}::${bulan}`;
      verifiedAmountByKey.set(key, (verifiedAmountByKey.get(key) ?? 0) + perMonth);
    }
  }

  for (const trx of transaksiList) {
    if (
      trx.status_verifikasi !== 'Terverifikasi' &&
      trx.status_verifikasi !== 'Pending' &&
      trx.status_verifikasi !== 'ACC Bendahara'
    ) {
      continue;
    }
    const isPending =
      trx.status_verifikasi === 'Pending' || trx.status_verifikasi === 'ACC Bendahara';
    for (const bulan of trx.bulan_dibayar) {
      const key = `${canonicalizeBlokKey(trx.blok_rumah)}::${trx.tahun}::${bulan}`;
      const existing = byKey.get(key);
      const totalVerified = verifiedAmountByKey.get(key) ?? 0;

      if (trx.status_verifikasi === 'Terverifikasi') {
        if (totalVerified < NOMINAL_IPL_STANDAR) {
          // Pembayaran < Rp 100.000/bulan otomatis masuk Dana Darurat — jangan tandai Lunas
          if (existing?.status === 'Lunas' && existing.transaksi_id === trx.id) {
            byKey.set(key, {
              ...existing,
              status: getDefaultUnpaidStatusForMonth(bulan),
            });
          }
          continue;
        }
        if (existing?.status === 'Lunas') continue;
        byKey.set(key, {
          id: existing?.id || `st-sync-${trx.blok_rumah}-${trx.tahun}-${bulan}`,
          blok_rumah: existing?.blok_rumah || trx.blok_rumah,
          tahun: trx.tahun,
          bulan,
          status: 'Lunas',
          transaksi_id: trx.id,
          updated_at: trx.verified_at || trx.bendahara_approved_at || trx.tanggal_setor,
        });
      } else if (isPending) {
        if (existing?.status === 'Lunas') continue;
        if (!existing || existing.status !== 'Menunggu Verifikasi') {
          byKey.set(key, {
            id: existing?.id || `st-sync-${trx.blok_rumah}-${trx.tahun}-${bulan}`,
            blok_rumah: existing?.blok_rumah || trx.blok_rumah,
            tahun: trx.tahun,
            bulan,
            status: 'Menunggu Verifikasi',
            transaksi_id: trx.id,
            updated_at: trx.bendahara_approved_at || trx.tanggal_setor,
          });
        }
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
      const routedDrive = await routeNewMediaUploadAuto({
        session: effectiveSession,
        folderKey: 'bukti_ipl',
        file: payload.buktiFile,
        labelPrefix: `ipl-${safeBlok}`,
        description: `Bukti setor IPL ${effectiveBlok} (${noKwitansi})`,
      });

      if (routedDrive?.url) {
        buktiUrl = routedDrive.url;
      } else {
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
      }

      payload.onStageChange?.('saving_transaction');
      const resolvedPetugas =
        payload.metode_bayar === 'Setor Tunai' ? payload.petugas_penerima || null : null;
      const derivedFundType = deriveIplFundType(payload.nominal, sortedBulan.length);
      const derivedHolderRole = deriveIplHolderRole(payload.metode_bayar, resolvedPetugas);

      const baseInsertPayload = {
        no_kwitansi: noKwitansi,
        blok_rumah: effectiveBlok,
        nama_warga: effectiveNama,
        tahun: TAHUN_AKTIF,
        bulan_dibayar: sortedBulan,
        nominal: payload.nominal,
        metode_bayar: payload.metode_bayar,
        petugas_penerima: resolvedPetugas,
        bukti_url: buktiUrl,
        status_verifikasi: 'Pending',
        keterangan: payload.keterangan?.trim() || null,
        tanggal_setor: nowIso,
      };

      let { data: inserted, error: insertError } = await supabase
        .from('transaksi_ipl')
        .insert({
          ...baseInsertPayload,
          fund_type: derivedFundType,
          holder_role: derivedHolderRole,
        })
        .select()
        .single();

      if (insertError) {
        const msg = String((insertError as { message?: string }).message || '').toLowerCase();
        if (msg.includes('fund_type') || msg.includes('holder_role') || msg.includes('column') || msg.includes('42703')) {
          const retry = await supabase
            .from('transaksi_ipl')
            .insert(baseInsertPayload)
            .select()
            .single();
          inserted = retry.data;
          insertError = retry.error;
        }
      }

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

      const bulanLabel = formatDaftarBulan(sortedBulan, true);
      const pushTitle = 'Pembayaran IPL Baru';
      const pushBody = `Warga Blok ${effectiveBlok} mengirim pembayaran IPL sebesar ${formatRupiah(payload.nominal)} untuk bulan ${bulanLabel}. Menunggu verifikasi.`;
      const iplSubmitDedup = `ipl:${inserted.id}:submitted`;
      void dispatchActivityNotifications(
        effectiveSession,
        getAllAdminUserIds().map((uid) => ({
          user_id: uid,
          category: 'ipl' as const,
          title: pushTitle,
          message: pushBody,
          target_url: 'tab:dashboard',
          dedup_key: iplSubmitDedup,
        })),
        {
          target_roles: ['admin'],
          category: 'ipl',
          title: pushTitle,
          body: pushBody,
          target_url: 'tab:dashboard',
          dedup_key: iplSubmitDedup,
        }
      );

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
    const resolvedPetugasLocal =
      payload.metode_bayar === 'Setor Tunai' ? payload.petugas_penerima || null : null;
    const newTrx: TransaksiIPL = {
      id: `trx-${Date.now()}`,
      no_kwitansi: noKwitansi,
      blok_rumah: effectiveBlok,
      nama_warga: effectiveNama,
      tahun: TAHUN_AKTIF,
      bulan_dibayar: sortedBulan,
      nominal: payload.nominal,
      metode_bayar: payload.metode_bayar,
      petugas_penerima: resolvedPetugasLocal,
      bukti_url: buktiUrl,
      status_verifikasi: 'Pending',
      catatan_admin: null,
      keterangan: payload.keterangan?.trim() || null,
      tanggal_setor: nowIso,
      verified_at: null,
      verified_by: null,
      fund_type: deriveIplFundType(payload.nominal, sortedBulan.length),
      holder_role: deriveIplHolderRole(payload.metode_bayar, resolvedPetugasLocal),
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

    const bulanLabelLocal = formatDaftarBulan(sortedBulan, true);
    const pushTitleLocal = 'Pembayaran IPL Baru';
    const pushBodyLocal = `Warga Blok ${effectiveBlok} mengirim pembayaran IPL sebesar ${formatRupiah(payload.nominal)} untuk bulan ${bulanLabelLocal}. Menunggu verifikasi.`;
    const iplSubmitLocalDedup = `ipl:${newTrx.id}:submitted`;
    void dispatchActivityNotifications(
      effectiveSession,
      getAllAdminUserIds().map((uid) => ({
        user_id: uid,
        category: 'ipl' as const,
        title: pushTitleLocal,
        message: pushBodyLocal,
        target_url: 'tab:dashboard',
        dedup_key: iplSubmitLocalDedup,
      })),
      {
        target_roles: ['admin'],
        category: 'ipl',
        title: pushTitleLocal,
        body: pushBodyLocal,
        target_url: 'tab:dashboard',
        dedup_key: iplSubmitLocalDedup,
      }
    );

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
  pengurusList: PengurusLingkunganRecord[];
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  statusList: StatusEcardBulanan[];
  botConfig: BotWaConfig;
  botLogs: BotWaLog[];
  notifications: SystemNotification[];
  paymentConfig: PaymentConfig;
  petugasList: PetugasKeamanan[];
  titikPatroliList: TitikPatroli[];
  patroliFeed: LogPatroli[];
  patrolMapConfig: PatrolMapConfig;
}

type DbAdminRow = {
  id?: string;
  blok_rumah?: string;
  nama_warga?: string;
  no_wa?: string;
  pin_akses?: string;
  jabatan?: string | null;
  admin_permission?: string | null;
  avatar_url?: string | null;
  aktif?: boolean | null;
};

function buildDefaultPengurusSeedRecords(
  canRevealPin: boolean,
  dbAdminRows?: DbAdminRow[]
): PengurusLingkunganRecord[] {
  const dbMap = new Map<string, DbAdminRow>();
  for (const row of dbAdminRows || []) {
    if (row.blok_rumah) {
      dbMap.set(row.blok_rumah.trim().toLowerCase(), row);
    }
  }
  const pinOverrides = (() => {
    try {
      const raw = safeStorageGet(STORAGE_KEYS.ADMIN_PIN_OVERRIDES);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();

  return SUSUNAN_PENGURUS.map((p) => {
    const key = p.username.toLowerCase();
    const dbMatch = dbMap.get(key);
    const localMatch = LOCAL_ADMIN_ACCOUNTS.find((a) => a.username.toLowerCase() === key);
    const rawPin = pinOverrides[key] || dbMatch?.pin_akses || localMatch?.pin || '123456';
    return {
      id: dbMatch?.id || `pengurus-seed-${key}`,
      nama: (typeof dbMatch?.nama_warga === 'string' && dbMatch.nama_warga.trim()) || p.nama,
      jabatan: (dbMatch?.jabatan as AdminJabatan | undefined) || p.jabatan,
      username: p.username,
      blok_rumah: p.blokRumah,
      no_wa: dbMatch?.no_wa || '',
      pin_akses: canRevealPin ? rawPin : '••••••',
      permission: (dbMatch?.admin_permission as AdminPermission | undefined) || p.permission,
      avatar_url:
        (typeof dbMatch?.avatar_url === 'string' && dbMatch.avatar_url.trim()) ||
        getCachedAvatarUrl('admin', p.username) ||
        null,
      aktif: typeof dbMatch?.aktif === 'boolean' ? dbMatch.aktif : true,
      is_default: true,
    };
  });
}

function mergePengurusRecords(
  seedRecords: PengurusLingkunganRecord[],
  extraRecords: PengurusLingkunganRecord[],
  canRevealPin: boolean
): PengurusLingkunganRecord[] {
  const byUsername = new Map<string, PengurusLingkunganRecord>();
  for (const s of seedRecords) {
    byUsername.set(s.username.trim().toLowerCase(), s);
  }
  for (const item of extraRecords) {
    const key = item.username.trim().toLowerCase();
    if (!key) continue;
    const prev = byUsername.get(key);
    byUsername.set(key, {
      ...(prev || {}),
      ...item,
      id: item.id || prev?.id || `pengurus-${key}`,
      blok_rumah: item.blok_rumah ?? prev?.blok_rumah ?? null,
      no_wa: item.no_wa || prev?.no_wa || '',
      pin_akses: canRevealPin
        ? item.pin_akses && item.pin_akses !== '••••••'
          ? item.pin_akses
          : prev?.pin_akses || '123456'
        : '••••••',
      avatar_url: item.avatar_url || prev?.avatar_url || getCachedAvatarUrl('admin', key) || null,
      is_default: prev?.is_default ?? item.is_default ?? false,
    });
  }
  return Array.from(byUsername.values());
}

export async function fetchPengurusLingkunganAdmin(
  session: SessionUser,
  dbAdminRows?: DbAdminRow[]
): Promise<PengurusLingkunganRecord[]> {
  const canRevealPin =
    isBendaharaFullAccess(session) ||
    hasSettingModulePermission(
      session,
      'settings.system_integrations',
      session.central_settings_permissions
    );

  const seedRecords = buildDefaultPengurusSeedRecords(canRevealPin, dbAdminRows);
  const localStored = readLocal<PengurusLingkunganRecord[]>(STORAGE_KEYS.PENGURUS_LINGKUNGAN, []);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('pengurus_lingkungan')
        .select('*')
        .order('created_at', { ascending: true });

      if (!error && Array.isArray(data) && data.length > 0) {
        const remoteRows: PengurusLingkunganRecord[] = (data as Record<string, unknown>[]).map((r) => {
          const uname = String(r.username || '').trim().toLowerCase();
          return {
            id: String(r.id || `pengurus-${uname}`),
            nama: String(r.nama || ''),
            jabatan: String(r.jabatan || 'Humas'),
            username: uname,
            blok_rumah: typeof r.blok_rumah === 'string' && r.blok_rumah.trim() ? r.blok_rumah.trim() : null,
            no_wa: String(r.no_wa || ''),
            pin_akses: canRevealPin ? String(r.pin_akses || '123456') : '••••••',
            permission: r.permission === 'full' ? 'full' : 'add_only',
            avatar_url:
              (typeof r.avatar_url === 'string' && r.avatar_url.trim()) ||
              getCachedAvatarUrl('admin', uname) ||
              null,
            aktif: typeof r.aktif === 'boolean' ? r.aktif : true,
            is_default: Boolean(r.is_default),
            created_at: typeof r.created_at === 'string' ? r.created_at : undefined,
            updated_at: typeof r.updated_at === 'string' ? r.updated_at : undefined,
          };
        });
        const merged = mergePengurusRecords(seedRecords, [...localStored, ...remoteRows], canRevealPin);
        return merged;
      }
    } catch {
      // Fallback bersih ke users_warga admin + SUSUNAN_PENGURUS + penyimpanan lokal
    }
  }

  return mergePengurusRecords(seedRecords, localStored, canRevealPin);
}

export async function savePengurusLingkunganAdmin(
  session: SessionUser,
  payload: {
    id?: string;
    nama: string;
    jabatan: string;
    username: string;
    blok_rumah?: string | null;
    no_wa: string;
    pin_akses: string;
    permission: AdminPermission;
    aktif?: boolean;
  }
): Promise<ServiceResult<PengurusLingkunganRecord>> {
  if (!isBendaharaFullAccess(session)) {
    return {
      error: 'Akses ditolak: pengelolaan akun Pengurus Lingkungan khusus Bendahara.',
    };
  }

  const cleanNama = payload.nama.trim();
  const cleanJabatan = payload.jabatan.trim();
  const cleanUsername = payload.username.trim().toLowerCase().replace(/\s+/g, '');
  const cleanBlok = payload.blok_rumah?.trim()
    ? normalizeBlok(payload.blok_rumah.trim())
    : null;
  const cleanWa = payload.no_wa.trim() ? normalizePhoneNumber(payload.no_wa.trim()) : '';
  const cleanPin = payload.pin_akses.trim();

  if (!cleanNama) return { error: 'Nama pengurus wajib diisi.' };
  if (!cleanJabatan) return { error: 'Jabatan pengurus wajib dipilih/diisi.' };
  if (!cleanUsername || cleanUsername.length < 3) {
    return { error: 'Username pengurus minimal 3 karakter tanpa spasi.' };
  }
  if (!/^\d{6}$/.test(cleanPin)) {
    return { error: 'PIN akses pengurus harus terdiri dari 6 digit angka.' };
  }
  if (cleanWa && (cleanWa.length < 10 || cleanWa.length > 15 || !cleanWa.startsWith('62'))) {
    return { error: 'Format No. WhatsApp tidak valid (contoh: 0812xxxxxxxx).' };
  }

  const nowIso = new Date().toISOString();
  const existingLocal = await fetchPengurusLingkunganAdmin(session);
  const duplicate = existingLocal.find(
    (p) =>
      p.id !== payload.id &&
      p.username.trim().toLowerCase() === cleanUsername
  );
  if (duplicate) {
    return {
      error: `Username pengurus "${cleanUsername}" sudah digunakan oleh ${duplicate.nama}.`,
    };
  }

  const recordToSave: PengurusLingkunganRecord = {
    id: payload.id || `pengurus-${cleanUsername}-${Date.now()}`,
    nama: cleanNama,
    jabatan: cleanJabatan,
    username: cleanUsername,
    blok_rumah: cleanBlok,
    no_wa: cleanWa,
    pin_akses: cleanPin,
    permission: payload.permission === 'full' ? 'full' : 'add_only',
    aktif: payload.aktif ?? true,
    avatar_url: getCachedAvatarUrl('admin', cleanUsername) || null,
    updated_at: nowIso,
    created_at: nowIso,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const dbPayload = {
        nama: cleanNama,
        jabatan: cleanJabatan,
        username: cleanUsername,
        blok_rumah: cleanBlok,
        no_wa: cleanWa,
        pin_akses: cleanPin,
        permission: recordToSave.permission,
        aktif: recordToSave.aktif,
        updated_at: nowIso,
      };

      const isUuid = Boolean(
        payload.id &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id)
      );

      if (isUuid && payload.id) {
        const { data, error } = await supabase
          .from('pengurus_lingkungan')
          .update(dbPayload)
          .eq('id', payload.id)
          .select()
          .maybeSingle();
        if (!error && data) {
          recordToSave.id = String((data as Record<string, unknown>).id || recordToSave.id);
        }
      } else {
        const { data, error } = await supabase
          .from('pengurus_lingkungan')
          .upsert({ ...dbPayload, created_at: nowIso }, { onConflict: 'username' })
          .select()
          .maybeSingle();
        if (!error && data) {
          recordToSave.id = String((data as Record<string, unknown>).id || recordToSave.id);
        }
      }

      // Sinkronkan juga ke users_warga role='admin' agar login & kontak WA selalu cocok
      await supabase
        .from('users_warga')
        .update({
          nama_warga: cleanNama,
          no_wa: cleanWa || '6281200000000',
          pin_akses: cleanPin,
          jabatan: cleanJabatan,
          admin_permission: recordToSave.permission,
          aktif: recordToSave.aktif,
        })
        .eq('blok_rumah', cleanUsername)
        .eq('role', 'admin');
    } catch {
      // Tetap lanjut simpan lokal bila tabel pengurus_lingkungan belum dibuat di Supabase
    }
  }

  // Simpan ke local storage & PIN override agar langsung aktif pada UI & fallback login
  const rawStored = readLocal<PengurusLingkunganRecord[]>(STORAGE_KEYS.PENGURUS_LINGKUNGAN, []);
  const nextStored = rawStored.some(
    (p) => p.id === payload.id || p.username.toLowerCase() === cleanUsername
  )
    ? rawStored.map((p) =>
        p.id === payload.id || p.username.toLowerCase() === cleanUsername
          ? { ...p, ...recordToSave, id: recordToSave.id }
          : p
      )
    : [...rawStored, recordToSave];
  writeLocal(STORAGE_KEYS.PENGURUS_LINGKUNGAN, nextStored);

  const pinOverrides = (() => {
    try {
      const raw = safeStorageGet(STORAGE_KEYS.ADMIN_PIN_OVERRIDES);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();
  pinOverrides[cleanUsername] = cleanPin;
  safeStorageSet(STORAGE_KEYS.ADMIN_PIN_OVERRIDES, JSON.stringify(pinOverrides));

  await recordAuditLog({
    session,
    action: payload.id ? 'UPDATE_PENGURUS' : 'CREATE_PENGURUS',
    entity: 'pengurus_lingkungan',
    entity_id: recordToSave.id,
    summary: `${payload.id ? 'Memperbarui' : 'Menambahkan'} akun Pengurus Lingkungan: ${cleanNama} (${cleanJabatan}, username: ${cleanUsername}${cleanBlok ? `, unit ${cleanBlok}` : ''}).`,
  });

  return { data: recordToSave };
}

export async function resetPinPengurusAdmin(
  session: SessionUser,
  pengurus: PengurusLingkunganRecord
): Promise<ServiceResult<PengurusLingkunganRecord>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: reset PIN pengurus khusus Bendahara.' };
  }
  const newPin = generateRandomPin();
  return savePengurusLingkunganAdmin(session, {
    id: pengurus.id,
    nama: pengurus.nama,
    jabatan: pengurus.jabatan,
    username: pengurus.username,
    blok_rumah: pengurus.blok_rumah,
    no_wa: pengurus.no_wa,
    pin_akses: newPin,
    permission: pengurus.permission,
    aktif: pengurus.aktif,
  });
}

export async function deletePengurusLingkunganAdmin(
  session: SessionUser,
  pengurus: PengurusLingkunganRecord
): Promise<ServiceResult<boolean>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: penghapusan pengurus khusus Bendahara.' };
  }
  const uname = pengurus.username.trim().toLowerCase();
  if (uname === 'andriansyah' || uname === 'admin' || uname === session.blok_rumah.trim().toLowerCase()) {
    return { error: 'Akun Bendahara utama atau akun yang sedang login tidak dapat dihapus.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      await supabase.from('pengurus_lingkungan').delete().eq('username', uname);
      await supabase
        .from('users_warga')
        .update({ aktif: false })
        .eq('blok_rumah', uname)
        .eq('role', 'admin');
    } catch {
      // Lanjut hapus lokal
    }
  }

  const rawStored = readLocal<PengurusLingkunganRecord[]>(STORAGE_KEYS.PENGURUS_LINGKUNGAN, []);
  const isDefaultSeed = SUSUNAN_PENGURUS.some((s) => s.username.toLowerCase() === uname);
  if (isDefaultSeed) {
    const deactivated: PengurusLingkunganRecord = { ...pengurus, aktif: false };
    const nextStored = rawStored.some((p) => p.username.toLowerCase() === uname)
      ? rawStored.map((p) => (p.username.toLowerCase() === uname ? deactivated : p))
      : [...rawStored, deactivated];
    writeLocal(STORAGE_KEYS.PENGURUS_LINGKUNGAN, nextStored);
  } else {
    writeLocal(
      STORAGE_KEYS.PENGURUS_LINGKUNGAN,
      rawStored.filter((p) => p.username.toLowerCase() !== uname)
    );
  }

  await recordAuditLog({
    session,
    action: 'DELETE_PENGURUS',
    entity: 'pengurus_lingkungan',
    entity_id: pengurus.id,
    summary: `Menonaktifkan/menghapus pengurus ${pengurus.nama} (${pengurus.jabatan}).`,
  });

  return { data: true };
}

function buildPengurusAccountsList(
  session: SessionUser,
  dbAdminRows?: DbAdminRow[],
  pengurusList?: PengurusLingkunganRecord[]
): PengurusAccountInfo[] {
  const canRevealPin =
    isBendaharaFullAccess(session) ||
    hasSettingModulePermission(
      session,
      'settings.system_integrations',
      session.central_settings_permissions
    );
  const dbMap = new Map<string, DbAdminRow>();
  for (const row of dbAdminRows || []) {
    if (row.blok_rumah) {
      dbMap.set(row.blok_rumah.trim().toLowerCase(), row);
    }
  }

  if (pengurusList && pengurusList.length > 0) {
    return pengurusList.map((p) => ({
      id: p.id,
      jabatan: (p.jabatan as AdminJabatan) || 'Humas',
      nama: p.nama,
      username: p.username,
      blokRumah: p.blok_rumah || p.username.toUpperCase(),
      blok_rumah: p.blok_rumah || undefined,
      permission: p.permission,
      no_wa: p.no_wa || undefined,
      pin_akses: canRevealPin ? p.pin_akses : undefined,
      avatar_url: p.avatar_url || getCachedAvatarUrl('admin', p.username) || null,
      aktif: p.aktif,
      is_active_pengurus: p.aktif,
    }));
  }

  return SUSUNAN_PENGURUS.map((p) => {
    const dbMatch = dbMap.get(p.username.toLowerCase());
    const localMatch = LOCAL_ADMIN_ACCOUNTS.find(
      (a) => a.username.toLowerCase() === p.username.toLowerCase()
    );
    const resolvedAvatar =
      (typeof dbMatch?.avatar_url === 'string' && dbMatch.avatar_url.trim()) ||
      getCachedAvatarUrl('admin', p.username) ||
      null;
    return {
      ...p,
      blok_rumah: p.blokRumah,
      no_wa: dbMatch?.no_wa || undefined,
      pin_akses: canRevealPin ? dbMatch?.pin_akses || localMatch?.pin : undefined,
      avatar_url: resolvedAvatar,
      aktif: typeof dbMatch?.aktif === 'boolean' ? dbMatch.aktif : true,
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
        transaksiKasList,
        petugasList,
        titikPatroliList,
        patroliFeed,
        patrolMapConfig,
      ] = await Promise.all([
        supabase
          .from('users_warga')
          .select('*')
          .or('role.is.null,role.neq.admin')
          .order('blok_rumah', { ascending: true }),
        supabase
          .from('users_warga')
          .select('*')
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
        fetchTransaksiKasList(session),
        fetchPetugasListAdmin(session),
        fetchTitikPatroliAdmin(session),
        fetchRecentLogPatroli(session, 40),
        fetchPatrolMapConfig(session),
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

      const wargaList = ((wargaRes.data || []) as Warga[])
        .map((w) =>
          normalizeWargaRecord({
            ...w,
            avatar_url: w.avatar_url || getCachedAvatarUrl('warga', w.blok_rumah) || null,
          })
        )
        .sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah));

      const dbAdminRows = !adminAccRes.error ? (adminAccRes.data as DbAdminRow[]) : undefined;
      const pengurusList = await fetchPengurusLingkunganAdmin(session, dbAdminRows);
      const pengurusAccounts = buildPengurusAccountsList(session, dbAdminRows, pengurusList);

      // Sinkronkan cache avatar seluruh akun untuk tampilan cepat di Header, Daftar & Log
      cacheAccountAvatars([
        ...wargaList
          .filter((w) => Boolean(w.avatar_url))
          .map((w) => ({ key: buildAvatarKey('warga', w.blok_rumah), url: w.avatar_url })),
        ...pengurusAccounts
          .filter((p) => Boolean(p.avatar_url))
          .map((p) => ({ key: buildAvatarKey('admin', p.username), url: p.avatar_url })),
        ...petugasList
          .filter((pt) => Boolean(pt.avatar_url))
          .flatMap((pt) => [
            { key: buildAvatarKey('petugas', pt.id), url: pt.avatar_url },
            { key: buildAvatarKey('petugas', pt.username), url: pt.avatar_url },
          ]),
      ]);

      return {
        data: {
          wargaList,
          pengurusAccounts,
          pengurusList,
          transaksiList,
          transaksiKasList,
          statusList: reconciledStatus,
          botConfig: (botCfgRes.data as BotWaConfig | null) || SEED_BOT_WA_CONFIG,
          botLogs: mergeBotWaLogs(remoteBotLogs, localFallbackLogs),
          notifications,
          paymentConfig,
          petugasList,
          titikPatroliList,
          patroliFeed,
          patrolMapConfig,
        },
      };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memuat data Pengurus dari Supabase.') };
    }
  }

  ensureLocalStoreInitialized();
  const wargaList = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA)
    .map(normalizeWargaRecord)
    .sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah));
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
  const [
    notifications,
    paymentConfig,
    transaksiKasList,
    petugasList,
    titikPatroliList,
    patroliFeed,
    patrolMapConfig,
    pengurusList,
  ] = await Promise.all([
    fetchSystemNotifications(session),
    fetchPaymentConfig(session),
    fetchTransaksiKasList(session),
    fetchPetugasListAdmin(session),
    fetchTitikPatroliAdmin(session),
    fetchRecentLogPatroli(session, 40),
    fetchPatrolMapConfig(session),
    fetchPengurusLingkunganAdmin(session),
  ]);

  return {
    data: {
      wargaList,
      pengurusAccounts: buildPengurusAccountsList(session, undefined, pengurusList),
      pengurusList,
      transaksiList,
      transaksiKasList,
      statusList,
      botConfig,
      botLogs,
      notifications,
      paymentConfig,
      petugasList,
      titikPatroliList,
      patroliFeed,
      patrolMapConfig,
    },
  };
}

interface RealtimeSyncOptions {
  /** Tunda eksekusi untuk menggabungkan burst event beruntun (ms) */
  debounceMs?: number;
  /** Jeda minimal antar eksekusi sinkronisasi agar memori & query tetap rendah (ms) */
  minIntervalMs?: number;
  /** Batas maksimum penundaan agar UI tetap responsif saat event terus berdatangan (ms) */
  maxWaitMs?: number;
}

/**
 * Penjadwal sinkronisasi Realtime ringan (Debounce + Throttle + Single-Flight + Visibility-Aware):
 * - Menggabungkan burst event beruntun menjadi 1 refresh (debounce).
 * - Membatasi frekuensi fetch minimal setiap `minIntervalMs` (throttle) dengan jaminan `maxWaitMs`.
 * - Mencegah fetch bertumpuk saat request sebelumnya masih berjalan (in-flight coalescing).
 * - Menunda fetch saat tab browser sedang di background, lalu langsung menyinkronkan saat aktif kembali.
 */
function createRealtimeSyncScheduler(
  onSync: () => void | Promise<void>,
  options: RealtimeSyncOptions = {}
) {
  const debounceMs = options.debounceMs ?? 800;
  const minIntervalMs = options.minIntervalMs ?? 2000;
  const maxWaitMs = options.maxWaitMs ?? 3500;

  let debounceTimer: number | null = null;
  let maxWaitTimer: number | null = null;
  let cooldownTimer: number | null = null;
  let lastRunAt = 0;
  let inFlight = false;
  let pendingAfterFlight = false;
  let deferredWhileHidden = false;
  let disposed = false;

  const clearTimers = () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      window.clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
    if (cooldownTimer !== null) {
      window.clearTimeout(cooldownTimer);
      cooldownTimer = null;
    }
  };

  const execute = () => {
    if (disposed) return;
    clearTimers();

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      deferredWhileHidden = true;
      return;
    }

    if (inFlight) {
      pendingAfterFlight = true;
      return;
    }

    const now = Date.now();
    const elapsed = now - lastRunAt;
    if (lastRunAt > 0 && elapsed < minIntervalMs) {
      const remaining = minIntervalMs - elapsed;
      cooldownTimer = window.setTimeout(() => {
        cooldownTimer = null;
        execute();
      }, remaining);
      return;
    }

    lastRunAt = now;
    inFlight = true;
    pendingAfterFlight = false;
    deferredWhileHidden = false;

    Promise.resolve()
      .then(() => onSync())
      .catch(() => {
        // Kegagalan jaringan ditangani di pemanggil
      })
      .finally(() => {
        inFlight = false;
        if (!disposed && pendingAfterFlight) {
          pendingAfterFlight = false;
          schedule();
        }
      });
  };

  const schedule = () => {
    if (disposed) return;

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      deferredWhileHidden = true;
      return;
    }

    if (inFlight) {
      pendingAfterFlight = true;
      return;
    }

    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      execute();
    }, debounceMs);

    if (maxWaitTimer === null) {
      maxWaitTimer = window.setTimeout(() => {
        maxWaitTimer = null;
        execute();
      }, maxWaitMs);
    }
  };

  const handleVisibilityChange = () => {
    if (disposed) return;
    if (document.visibilityState === 'visible' && deferredWhileHidden) {
      deferredWhileHidden = false;
      schedule();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  const dispose = () => {
    disposed = true;
    clearTimers();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };

  return { schedule, dispose };
}

/**
 * Langganan realtime perubahan data warga/setoran/patroli di Supabase agar Portal Admin
 * langsung memperbarui daftar setoran & log patroli dengan debounce + throttling hemat memori.
 */
export function subscribeAdminRealtime(
  session: SessionUser,
  onChange: () => void | Promise<void>,
  options?: RealtimeSyncOptions
): () => void {
  if (session.role !== 'admin') return () => {};
  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) return () => {};

  const scheduler = createRealtimeSyncScheduler(onChange, {
    debounceMs: options?.debounceMs ?? 900,
    minIntervalMs: options?.minIntervalMs ?? 2500,
    maxWaitMs: options?.maxWaitMs ?? 4000,
  });

  try {
    const channel = supabase
      .channel(`admin-live-sync-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaksi_ipl' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'status_ecard_bulanan' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users_warga' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bot_wa_logs' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaksi_kas' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'log_patroli' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'petugas_keamanan' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'titik_patroli' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'security_shift_overrides' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_settings' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pengurus_lingkungan' },
        scheduler.schedule
      )
      .subscribe();

    return () => {
      scheduler.dispose();
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {
      scheduler.dispose();
    };
  }
}

/**
 * Langganan realtime khusus patroli & peta mapping untuk Petugas Keamanan & Warga.
 * Menggunakan debounce + throttle + in-flight coalescing agar memori rendah & UI tetap responsif.
 */
export function subscribePatroliRealtime(
  session: SessionUser,
  onChange: () => void | Promise<void>,
  options?: RealtimeSyncOptions
): () => void {
  const supabase = getSupabaseClient(session);
  if (!supabase || !isSupabaseConfigured()) return () => {};

  const scheduler = createRealtimeSyncScheduler(onChange, {
    debounceMs: options?.debounceMs ?? 800,
    minIntervalMs: options?.minIntervalMs ?? 2000,
    maxWaitMs: options?.maxWaitMs ?? 3500,
  });

  try {
    const channel = supabase
      .channel(`patroli-live-sync-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'log_patroli' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'titik_patroli' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'security_shift_overrides' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transaksi_kas' },
        scheduler.schedule
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'app_settings' },
        scheduler.schedule
      )
      .subscribe();

    return () => {
      scheduler.dispose();
      void supabase.removeChannel(channel);
    };
  } catch {
    return () => {
      scheduler.dispose();
    };
  }
}

/**
 * Tahap 1 Verifikasi Berjenjang (Bendahara — Andriansyah):
 * - ACC / Verifikasi -> 'ACC Bendahara' (Menunggu Verifikasi Ketua, BELUM final/lunas).
 * - Tolak -> 'Ditolak' (dengan alasan wajib).
 */
export async function verifyTransaksiAdmin(
  session: SessionUser,
  trx: TransaksiIPL,
  decision: 'ACC Bendahara' | 'Terverifikasi' | 'Ditolak',
  catatanAdmin?: string
): Promise<ServiceResult<TransaksiIPL>> {
  if (!isBendaharaOnly(session)) {
    return { error: 'Akses ditolak: verifikasi Tahap 1 transaksi IPL khusus Bendahara.' };
  }
  const effectiveStatus: StatusVerifikasi =
    decision === 'Ditolak' ? 'Ditolak' : 'ACC Bendahara';
  if (effectiveStatus === 'Ditolak' && !catatanAdmin?.trim()) {
    return { error: 'Alasan penolakan wajib diisi.' };
  }

  const nowIso = new Date().toISOString();
  const approverName = session.nama_warga || 'Andriansyah';
  const cleanNote =
    catatanAdmin?.trim() ||
    (effectiveStatus === 'ACC Bendahara'
      ? `ACC Tahap 1 oleh Bendahara (${approverName}) — Menunggu Verifikasi Ketua.`
      : null);

  const supabase = getSupabaseClient(session);

  if (supabase && isSupabaseConfigured()) {
    try {
      const fullPatch =
        effectiveStatus === 'ACC Bendahara'
          ? {
              status_verifikasi: 'ACC Bendahara',
              catatan_admin: cleanNote,
              bendahara_approved_at: nowIso,
              bendahara_approved_by: approverName,
              ketua_catatan: null,
            }
          : {
              status_verifikasi: 'Ditolak',
              catatan_admin: cleanNote,
              verified_at: nowIso,
              verified_by: session.blok_rumah,
              bendahara_approved_at: null,
              bendahara_approved_by: null,
            };

      let usedLegacyFallback = false;
      let { data, error } = await supabase
        .from('transaksi_ipl')
        .update(fullPatch)
        .eq('id', trx.id)
        .select()
        .single();

      // Fallback kompatibilitas bila migrasi SQL v3 belum dijalankan (check constraint / kolom baru)
      if (error) {
        const msg = String((error as { message?: string }).message || '').toLowerCase();
        const isSchemaMismatch =
          msg.includes('check constraint') ||
          msg.includes('bendahara_approved') ||
          msg.includes('ketua_catatan') ||
          msg.includes('column') ||
          msg.includes('42703') ||
          msg.includes('23514');

        if (isSchemaMismatch) {
          usedLegacyFallback = true;
          const fallbackPatch =
            effectiveStatus === 'ACC Bendahara'
              ? {
                  status_verifikasi: 'Pending',
                  catatan_admin: `[ACC_BENDAHARA|${approverName}|${nowIso}] ${cleanNote || ''}`.trim(),
                }
              : {
                  status_verifikasi: 'Ditolak',
                  catatan_admin: cleanNote,
                  verified_at: nowIso,
                  verified_by: session.blok_rumah,
                };
          const retry = await supabase
            .from('transaksi_ipl')
            .update(fallbackPatch)
            .eq('id', trx.id)
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (error) throw error;

      if (usedLegacyFallback) {
        writeApprovalOverlayEntry(`ipl::${trx.id}`, {
          status_verifikasi: effectiveStatus,
          bendahara_approved_at: effectiveStatus === 'ACC Bendahara' ? nowIso : null,
          bendahara_approved_by: effectiveStatus === 'ACC Bendahara' ? approverName : null,
          ketua_approved_at: null,
          ketua_approved_by: null,
          ketua_catatan: null,
          catatan_admin: cleanNote,
          verified_at: effectiveStatus === 'Ditolak' ? nowIso : null,
          verified_by: effectiveStatus === 'Ditolak' ? session.blok_rumah : null,
        });
      } else {
        // DB berhasil menyimpan status terbaru — hapus overlay lama agar tidak pernah stale
        writeApprovalOverlayEntry(`ipl::${trx.id}`, null);
      }

      // Sinkronkan status_ecard_bulanan (Tahap 1 ACC Bendahara tetap 'Menunggu Verifikasi', belum Lunas)
      for (const bulan of trx.bulan_dibayar) {
        const nextStatus =
          effectiveStatus === 'ACC Bendahara'
            ? 'Menunggu Verifikasi'
            : getDefaultUnpaidStatusForMonth(bulan);
        await supabase.from('status_ecard_bulanan').upsert(
          {
            blok_rumah: trx.blok_rumah,
            tahun: trx.tahun,
            bulan,
            status: nextStatus,
            transaksi_id: effectiveStatus === 'ACC Bendahara' ? trx.id : null,
            updated_at: nowIso,
          },
          { onConflict: 'blok_rumah,tahun,bulan' }
        );
      }

      await recordAuditLog({
        session,
        action: effectiveStatus === 'ACC Bendahara' ? 'ACC_BENDAHARA_IPL' : 'REJECT_TRANSAKSI',
        entity: 'transaksi_ipl',
        entity_id: trx.id,
        summary: `Bendahara ${approverName} ${
          effectiveStatus === 'ACC Bendahara'
            ? 'memberikan ACC Tahap 1 (diteruskan ke Ketua)'
            : 'menolak'
        } setoran ${trx.blok_rumah} sebesar ${formatRupiah(trx.nominal)} (${formatDaftarBulan(trx.bulan_dibayar, true)}).`,
        metadata: { catatan: cleanNote, blok: trx.blok_rumah },
      });

      const bulanVerifLabel = formatDaftarBulan(trx.bulan_dibayar, true);
      const wargaTargetId = buildWargaUserId(trx.blok_rumah);
      const wargaTitle =
        effectiveStatus === 'ACC Bendahara'
          ? 'Pembayaran IPL Terverifikasi'
          : 'Pembayaran IPL Ditolak';
      const wargaBody =
        effectiveStatus === 'ACC Bendahara'
          ? `Pembayaran IPL Blok ${trx.blok_rumah} bulan ${bulanVerifLabel} sebesar ${formatRupiah(trx.nominal)} telah diverifikasi pengurus (ACC Bendahara).`
          : `Pengajuan IPL Blok ${trx.blok_rumah} ditolak: ${cleanNote || 'Periksa kembali bukti transaksi'}. Silakan periksa kembali.`;
      const ketuaTitle =
        effectiveStatus === 'ACC Bendahara'
          ? `Menunggu Pengesahan Ketua — Blok ${trx.blok_rumah}`
          : `Setoran Blok ${trx.blok_rumah} Ditolak Bendahara`;
      const ketuaBody =
        effectiveStatus === 'ACC Bendahara'
          ? `Bendahara ${approverName} menyetujui setoran ${formatRupiah(trx.nominal)} (${bulanVerifLabel}). Menunggu verifikasi final Anda.`
          : `Bendahara ${approverName} menolak setoran ${formatRupiah(trx.nominal)}: ${cleanNote || '-'}`;

      const benWargaDedup = `ipl:${trx.id}:bendahara:${effectiveStatus}:warga`;
      const benKetuaDedup = `ipl:${trx.id}:bendahara:${effectiveStatus}:ketua`;
      void dispatchActivityNotifications(
        session,
        [
          {
            user_id: wargaTargetId,
            category: 'ipl',
            title: wargaTitle,
            message: wargaBody,
            target_url: 'tab:riwayat',
            dedup_key: benWargaDedup,
          },
          ...getKetuaUserIds().map((uid) => ({
            user_id: uid,
            category: 'ipl' as const,
            title: ketuaTitle,
            message: ketuaBody,
            target_url: 'tab:dashboard',
            dedup_key: benKetuaDedup,
          })),
        ],
        [
          {
            target_user_ids: [wargaTargetId],
            category: 'ipl',
            title: wargaTitle,
            body: wargaBody,
            target_url: 'tab:riwayat',
            dedup_key: benWargaDedup,
          },
          {
            target_user_ids: getKetuaUserIds(),
            category: 'ipl',
            title: ketuaTitle,
            body: ketuaBody,
            target_url: 'tab:dashboard',
            dedup_key: benKetuaDedup,
          },
        ]
      );

      return { data: normalizeTransaksiRow((data || trx) as Record<string, unknown>) };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memperbarui status verifikasi Bendahara.') };
    }
  }

  const allTrx = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI);
  let updatedItem: TransaksiIPL | undefined;
  const nextTrx = allTrx.map((item) => {
    if (item.id !== trx.id) return item;
    updatedItem = {
      ...item,
      status_verifikasi: effectiveStatus,
      catatan_admin: cleanNote,
      bendahara_approved_at: effectiveStatus === 'ACC Bendahara' ? nowIso : null,
      bendahara_approved_by: effectiveStatus === 'ACC Bendahara' ? approverName : null,
      ketua_approved_at: null,
      ketua_approved_by: null,
      ketua_catatan: null,
      verified_at: effectiveStatus === 'Ditolak' ? nowIso : null,
      verified_by: effectiveStatus === 'Ditolak' ? session.blok_rumah : null,
    };
    return updatedItem;
  });

  if (!updatedItem) return { error: 'Transaksi tidak ditemukan.' };
  writeLocal(STORAGE_KEYS.TRANSAKSI, nextTrx);
  writeApprovalOverlayEntry(`ipl::${trx.id}`, {
    status_verifikasi: effectiveStatus,
    bendahara_approved_at: updatedItem.bendahara_approved_at,
    bendahara_approved_by: updatedItem.bendahara_approved_by,
    ketua_approved_at: null,
    ketua_approved_by: null,
    ketua_catatan: null,
    catatan_admin: cleanNote,
  });
  syncLocalStatusForHouse(trx.blok_rumah);

  await recordAuditLog({
    session,
    action: effectiveStatus === 'ACC Bendahara' ? 'ACC_BENDAHARA_IPL' : 'REJECT_TRANSAKSI',
    entity: 'transaksi_ipl',
    entity_id: trx.id,
    summary: `Bendahara ${approverName} ${
      effectiveStatus === 'ACC Bendahara'
        ? 'memberikan ACC Tahap 1 (diteruskan ke Ketua)'
        : 'menolak'
    } setoran ${trx.blok_rumah} sebesar ${formatRupiah(trx.nominal)} (${formatDaftarBulan(trx.bulan_dibayar, true)}).`,
    metadata: { catatan: cleanNote, blok: trx.blok_rumah },
  });

  const bulanVerifLocal = formatDaftarBulan(trx.bulan_dibayar, true);
  const wargaTargetIdLocal = buildWargaUserId(trx.blok_rumah);
  const wargaTitleLocal =
    effectiveStatus === 'ACC Bendahara'
      ? 'Pembayaran IPL Terverifikasi'
      : 'Pembayaran IPL Ditolak';
  const wargaBodyLocal =
    effectiveStatus === 'ACC Bendahara'
      ? `Pembayaran IPL Blok ${trx.blok_rumah} bulan ${bulanVerifLocal} sebesar ${formatRupiah(trx.nominal)} telah diverifikasi pengurus (ACC Bendahara).`
      : `Pengajuan IPL Blok ${trx.blok_rumah} ditolak: ${cleanNote || 'Periksa kembali bukti transaksi'}. Silakan periksa kembali.`;
  const ketuaTitleLocal =
    effectiveStatus === 'ACC Bendahara'
      ? `Menunggu Pengesahan Ketua — Blok ${trx.blok_rumah}`
      : `Setoran Blok ${trx.blok_rumah} Ditolak Bendahara`;
  const ketuaBodyLocal =
    effectiveStatus === 'ACC Bendahara'
      ? `Bendahara ${approverName} menyetujui setoran ${formatRupiah(trx.nominal)} (${bulanVerifLocal}).`
      : `Bendahara ${approverName} menolak setoran ${formatRupiah(trx.nominal)}: ${cleanNote || '-'}`;

  const benWargaLocalDedup = `ipl:${trx.id}:bendahara:${effectiveStatus}:warga`;
  const benKetuaLocalDedup = `ipl:${trx.id}:bendahara:${effectiveStatus}:ketua`;
  void dispatchActivityNotifications(
    session,
    [
      {
        user_id: wargaTargetIdLocal,
        category: 'ipl',
        title: wargaTitleLocal,
        message: wargaBodyLocal,
        target_url: 'tab:riwayat',
        dedup_key: benWargaLocalDedup,
      },
      ...getKetuaUserIds().map((uid) => ({
        user_id: uid,
        category: 'ipl' as const,
        title: ketuaTitleLocal,
        message: ketuaBodyLocal,
        target_url: 'tab:dashboard',
        dedup_key: benKetuaLocalDedup,
      })),
    ],
    [
      {
        target_user_ids: [wargaTargetIdLocal],
        category: 'ipl',
        title: wargaTitleLocal,
        body: wargaBodyLocal,
        target_url: 'tab:riwayat',
        dedup_key: benWargaLocalDedup,
      },
      {
        target_user_ids: getKetuaUserIds(),
        category: 'ipl',
        title: ketuaTitleLocal,
        body: ketuaBodyLocal,
        target_url: 'tab:dashboard',
        dedup_key: benKetuaLocalDedup,
      },
    ]
  );

  return { data: updatedItem };
}

/**
 * Tahap 2 Verifikasi Berjenjang (Ketua — Erlangga):
 * - 'Terverifikasi' -> Sah Final (Bendahara & Ketua), mengubah e-Card menjadi Lunas & menambah Saldo Kas.
 * - 'Kembalikan' -> Mengembalikan ke antrean Bendahara ('Pending') beserta catatan Ketua.
 */
export async function verifyTransaksiKetuaAdmin(
  session: SessionUser,
  trx: TransaksiIPL,
  decision: 'Terverifikasi' | 'Kembalikan',
  catatanKetua?: string
): Promise<ServiceResult<TransaksiIPL>> {
  if (!isKetuaRole(session)) {
    return {
      error: 'Akses ditolak: pengesahan final (Tahap 2) hanya dapat dilakukan oleh Ketua Lingkungan.',
    };
  }
  if (decision === 'Kembalikan' && !catatanKetua?.trim()) {
    return { error: 'Mohon isi catatan / alasan pengembalian transaksi ke Bendahara.' };
  }

  const nowIso = new Date().toISOString();
  const ketuaName = session.nama_warga || 'Erlangga';
  const nextStatus: StatusVerifikasi = decision === 'Terverifikasi' ? 'Terverifikasi' : 'Pending';
  const cleanKetuaNote =
    catatanKetua?.trim() ||
    (decision === 'Terverifikasi'
      ? `Disahkan final oleh Ketua (${ketuaName}) setelah ACC Bendahara.`
      : 'Dikembalikan ke Bendahara untuk pengecekan ulang.');

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const fullPatch =
        decision === 'Terverifikasi'
          ? {
              status_verifikasi: 'Terverifikasi',
              catatan_admin: cleanKetuaNote,
              verified_at: nowIso,
              verified_by: `${trx.bendahara_approved_by || 'Bendahara'} & ${ketuaName}`,
              ketua_approved_at: nowIso,
              ketua_approved_by: ketuaName,
              ketua_catatan: cleanKetuaNote,
            }
          : {
              status_verifikasi: 'Pending',
              catatan_admin: `Dikembalikan Ketua (${ketuaName}): ${cleanKetuaNote}`,
              bendahara_approved_at: null,
              bendahara_approved_by: null,
              ketua_approved_at: null,
              ketua_approved_by: null,
              ketua_catatan: cleanKetuaNote,
            };

      let { data, error } = await supabase
        .from('transaksi_ipl')
        .update(fullPatch)
        .eq('id', trx.id)
        .select()
        .single();

      if (error) {
        const legacyPatch =
          decision === 'Terverifikasi'
            ? {
                status_verifikasi: 'Terverifikasi',
                catatan_admin: cleanKetuaNote,
                verified_at: nowIso,
                verified_by: ketuaName,
              }
            : {
                status_verifikasi: 'Pending',
                catatan_admin: `Dikembalikan Ketua (${ketuaName}): ${cleanKetuaNote}`,
              };
        const retry = await supabase
          .from('transaksi_ipl')
          .update(legacyPatch)
          .eq('id', trx.id)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      // Hanya simpan overlay bila DB gagal diperbarui (mis. RLS migrasi v3 belum dijalankan).
      // Jika DB berhasil menyimpan status terbaru, bersihkan overlay lama agar tidak nyangkut.
      if (error) {
        writeApprovalOverlayEntry(`ipl::${trx.id}`, {
          status_verifikasi: nextStatus,
          bendahara_approved_at:
            decision === 'Terverifikasi' ? trx.bendahara_approved_at || nowIso : null,
          bendahara_approved_by:
            decision === 'Terverifikasi' ? trx.bendahara_approved_by || 'Andriansyah' : null,
          ketua_approved_at: decision === 'Terverifikasi' ? nowIso : null,
          ketua_approved_by: decision === 'Terverifikasi' ? ketuaName : null,
          ketua_catatan: cleanKetuaNote,
          catatan_admin:
            decision === 'Terverifikasi'
              ? cleanKetuaNote
              : `Dikembalikan Ketua (${ketuaName}): ${cleanKetuaNote}`,
          verified_at: decision === 'Terverifikasi' ? nowIso : null,
          verified_by: decision === 'Terverifikasi' ? ketuaName : null,
        });
      } else {
        writeApprovalOverlayEntry(`ipl::${trx.id}`, null);
      }

      if (!error) {
        const perMonthAmount = Math.round(
          (Number(trx.nominal) || 0) / Math.max(trx.bulan_dibayar.length, 1)
        );
        const isFullMonthly = perMonthAmount >= NOMINAL_IPL_STANDAR;
        for (const bulan of trx.bulan_dibayar) {
          await supabase.from('status_ecard_bulanan').upsert(
            {
              blok_rumah: trx.blok_rumah,
              tahun: trx.tahun,
              bulan,
              status:
                decision === 'Terverifikasi'
                  ? isFullMonthly
                    ? 'Lunas'
                    : getDefaultUnpaidStatusForMonth(bulan)
                  : 'Menunggu Verifikasi',
              transaksi_id: trx.id,
              updated_at: nowIso,
            },
            { onConflict: 'blok_rumah,tahun,bulan' }
          );
        }
      }

      await recordAuditLog({
        session,
        action:
          decision === 'Terverifikasi' ? 'KETUA_FINAL_APPROVE_IPL' : 'KETUA_RETURN_IPL',
        entity: 'transaksi_ipl',
        entity_id: trx.id,
        summary: `Ketua ${ketuaName} ${
          decision === 'Terverifikasi'
            ? 'mensahkan final (Lunas)'
            : 'mengembalikan ke Bendahara'
        } setoran ${trx.blok_rumah} sebesar ${formatRupiah(trx.nominal)}.`,
        metadata: { catatan: cleanKetuaNote, blok: trx.blok_rumah },
      });

      const bulanFinalLabel = formatDaftarBulan(trx.bulan_dibayar, true);
      const wargaTargetFinal = buildWargaUserId(trx.blok_rumah);
      const wargaFinalTitle =
        decision === 'Terverifikasi'
          ? 'Pembayaran IPL Terverifikasi'
          : 'Pembayaran IPL Ditolak';
      const wargaFinalBody =
        decision === 'Terverifikasi'
          ? `Pembayaran IPL Blok ${trx.blok_rumah} bulan ${bulanFinalLabel} sebesar ${formatRupiah(trx.nominal)} telah diverifikasi pengurus.`
          : `Pengajuan IPL Blok ${trx.blok_rumah} ditolak: ${cleanKetuaNote}. Silakan periksa kembali.`;
      const bendaharaTitle =
        decision === 'Terverifikasi'
          ? `Ketua Mengesahkan IPL Blok ${trx.blok_rumah}`
          : `Ketua Mengembalikan IPL Blok ${trx.blok_rumah}`;
      const bendaharaBody =
        decision === 'Terverifikasi'
          ? `Setoran ${formatRupiah(trx.nominal)} (${bulanFinalLabel}) resmi Lunas dan masuk saldo kas.`
          : `Catatan Ketua: ${cleanKetuaNote}`;

      const ketuaWargaDedup = `ipl:${trx.id}:ketua:${decision}:warga`;
      const ketuaBenDedup = `ipl:${trx.id}:ketua:${decision}:bendahara`;
      void dispatchActivityNotifications(
        session,
        [
          {
            user_id: wargaTargetFinal,
            category: 'ipl',
            title: wargaFinalTitle,
            message: wargaFinalBody,
            target_url: 'tab:riwayat',
            dedup_key: ketuaWargaDedup,
          },
          ...getBendaharaUserIds().map((uid) => ({
            user_id: uid,
            category: 'ipl' as const,
            title: bendaharaTitle,
            message: bendaharaBody,
            target_url: 'tab:dashboard',
            dedup_key: ketuaBenDedup,
          })),
        ],
        [
          {
            target_user_ids: [wargaTargetFinal],
            category: 'ipl',
            title: wargaFinalTitle,
            body: wargaFinalBody,
            target_url: 'tab:riwayat',
            dedup_key: ketuaWargaDedup,
          },
          {
            target_user_ids: getBendaharaUserIds(),
            category: 'ipl',
            title: bendaharaTitle,
            body: bendaharaBody,
            target_url: 'tab:dashboard',
            dedup_key: ketuaBenDedup,
          },
        ]
      );

      return {
        data: normalizeTransaksiRow(((data as Record<string, unknown>) || trx) as Record<string, unknown>),
      };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memproses verifikasi final Ketua.') };
    }
  }

  const allTrx = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI);
  let updatedItem: TransaksiIPL | undefined;
  const nextTrx = allTrx.map((item) => {
    if (item.id !== trx.id) return item;
    updatedItem = {
      ...item,
      status_verifikasi: nextStatus,
      catatan_admin:
        decision === 'Terverifikasi'
          ? cleanKetuaNote
          : `Dikembalikan Ketua (${ketuaName}): ${cleanKetuaNote}`,
      bendahara_approved_at:
        decision === 'Terverifikasi' ? item.bendahara_approved_at || nowIso : null,
      bendahara_approved_by:
        decision === 'Terverifikasi' ? item.bendahara_approved_by || 'Andriansyah' : null,
      ketua_approved_at: decision === 'Terverifikasi' ? nowIso : null,
      ketua_approved_by: decision === 'Terverifikasi' ? ketuaName : null,
      ketua_catatan: cleanKetuaNote,
      verified_at: decision === 'Terverifikasi' ? nowIso : null,
      verified_by: decision === 'Terverifikasi' ? ketuaName : null,
    };
    return updatedItem;
  });

  if (!updatedItem) return { error: 'Transaksi tidak ditemukan.' };
  writeLocal(STORAGE_KEYS.TRANSAKSI, nextTrx);
  writeApprovalOverlayEntry(`ipl::${trx.id}`, {
    status_verifikasi: nextStatus,
    bendahara_approved_at: updatedItem.bendahara_approved_at,
    bendahara_approved_by: updatedItem.bendahara_approved_by,
    ketua_approved_at: updatedItem.ketua_approved_at,
    ketua_approved_by: updatedItem.ketua_approved_by,
    ketua_catatan: cleanKetuaNote,
    catatan_admin: updatedItem.catatan_admin,
    verified_at: updatedItem.verified_at,
    verified_by: updatedItem.verified_by,
  });
  syncLocalStatusForHouse(trx.blok_rumah);

  await recordAuditLog({
    session,
    action: decision === 'Terverifikasi' ? 'KETUA_FINAL_APPROVE_IPL' : 'KETUA_RETURN_IPL',
    entity: 'transaksi_ipl',
    entity_id: trx.id,
    summary: `Ketua ${ketuaName} ${
      decision === 'Terverifikasi'
        ? 'mensahkan final (Lunas)'
        : 'mengembalikan ke Bendahara'
    } setoran ${trx.blok_rumah} sebesar ${formatRupiah(trx.nominal)}.`,
    metadata: { catatan: cleanKetuaNote, blok: trx.blok_rumah },
  });

  const bulanFinalLocal = formatDaftarBulan(trx.bulan_dibayar, true);
  const wargaTargetFinalLocal = buildWargaUserId(trx.blok_rumah);
  const wargaFinalTitleLocal =
    decision === 'Terverifikasi'
      ? 'Pembayaran IPL Terverifikasi'
      : 'Pembayaran IPL Ditolak';
  const wargaFinalBodyLocal =
    decision === 'Terverifikasi'
      ? `Pembayaran IPL Blok ${trx.blok_rumah} bulan ${bulanFinalLocal} sebesar ${formatRupiah(trx.nominal)} telah diverifikasi pengurus.`
      : `Pengajuan IPL Blok ${trx.blok_rumah} ditolak: ${cleanKetuaNote}. Silakan periksa kembali.`;
  const bendaharaTitleLocal =
    decision === 'Terverifikasi'
      ? `Ketua Mengesahkan IPL Blok ${trx.blok_rumah}`
      : `Ketua Mengembalikan IPL Blok ${trx.blok_rumah}`;
  const bendaharaBodyLocal =
    decision === 'Terverifikasi'
      ? `Setoran ${formatRupiah(trx.nominal)} (${bulanFinalLocal}) resmi Lunas.`
      : `Catatan Ketua: ${cleanKetuaNote}`;

  const ketuaWargaLocalDedup = `ipl:${trx.id}:ketua:${decision}:warga`;
  const ketuaBenLocalDedup = `ipl:${trx.id}:ketua:${decision}:bendahara`;
  void dispatchActivityNotifications(
    session,
    [
      {
        user_id: wargaTargetFinalLocal,
        category: 'ipl',
        title: wargaFinalTitleLocal,
        message: wargaFinalBodyLocal,
        target_url: 'tab:riwayat',
        dedup_key: ketuaWargaLocalDedup,
      },
      ...getBendaharaUserIds().map((uid) => ({
        user_id: uid,
        category: 'ipl' as const,
        title: bendaharaTitleLocal,
        message: bendaharaBodyLocal,
        target_url: 'tab:dashboard',
        dedup_key: ketuaBenLocalDedup,
      })),
    ],
    [
      {
        target_user_ids: [wargaTargetFinalLocal],
        category: 'ipl',
        title: wargaFinalTitleLocal,
        body: wargaFinalBodyLocal,
        target_url: 'tab:riwayat',
        dedup_key: ketuaWargaLocalDedup,
      },
      {
        target_user_ids: getBendaharaUserIds(),
        category: 'ipl',
        title: bendaharaTitleLocal,
        body: bendaharaBodyLocal,
        target_url: 'tab:dashboard',
        dedup_key: ketuaBenLocalDedup,
      },
    ]
  );

  return { data: updatedItem };
}

/**
 * Verifikasi PIN 6 digit milik akun pengurus yang sedang aktif sebelum menjalankan aksi sensitif.
 */
async function verifyActiveAdminPin(
  session: SessionUser,
  pinInput: string
): Promise<ServiceResult<boolean>> {
  const cleanPin = pinInput.trim();
  if (!/^\d{6}$/.test(cleanPin)) {
    return { error: 'PIN keamanan harus terdiri dari tepat 6 digit angka.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data: verifyData, error: verifyErr } = await supabase.rpc('login_ecard', {
        p_blok: session.blok_rumah,
        p_pin: cleanPin,
      });
      if (verifyErr) {
        return { error: parseFriendlyError(verifyErr, 'Gagal memverifikasi PIN ke server.') };
      }
      const row = (Array.isArray(verifyData) ? verifyData[0] : verifyData) as
        | Record<string, unknown>
        | undefined;
      if (!row || typeof row.blok_rumah !== 'string' || row.role !== 'admin') {
        await recordAuditLog({
          session,
          action: 'DELETE_TRANSAKSI_IPL_PIN_FAILED',
          entity: 'transaksi_ipl',
          summary: `Percobaan hapus setoran IPL gagal: PIN 6 digit tidak sesuai (${session.nama_warga} — ${session.jabatan || 'Admin'}).`,
        });
        return { error: 'PIN 6 digit yang Anda masukkan tidak sesuai.' };
      }
      return { data: true };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memverifikasi PIN pengurus.') };
    }
  }

  // Fallback mode lokal
  const pinOverrides = (() => {
    try {
      const raw = safeStorageGet(STORAGE_KEYS.ADMIN_PIN_OVERRIDES);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();

  const localAcc = LOCAL_ADMIN_ACCOUNTS.find(
    (a) => a.username.toLowerCase() === session.blok_rumah.toLowerCase()
  );
  const effectivePin = pinOverrides[session.blok_rumah.toLowerCase()] || localAcc?.pin || '';
  if (!effectivePin || effectivePin !== cleanPin) {
    await recordAuditLog({
      session,
      action: 'DELETE_TRANSAKSI_IPL_PIN_FAILED',
      entity: 'transaksi_ipl',
      summary: `Percobaan hapus setoran IPL gagal: PIN 6 digit tidak sesuai (${session.nama_warga} — ${session.jabatan || 'Admin'}).`,
    });
    return { error: 'PIN 6 digit yang Anda masukkan tidak sesuai.' };
  }

  return { data: true };
}

/**
 * Menghapus data setoran IPL warga (wajib verifikasi PIN 6 digit pengurus aktif)
 * sekaligus menyinkronkan ulang status_ecard_bulanan agar saldo & e-Card tetap akurat.
 */
export async function deleteTransaksiIplAdmin(
  session: SessionUser,
  trx: TransaksiIPL,
  pinInput: string
): Promise<ServiceResult<boolean>> {
  if (session.role !== 'admin' || (!isBendaharaFullAccess(session) && !isKetuaRole(session))) {
    return {
      error: 'Akses ditolak: hanya Bendahara atau Ketua yang dapat menghapus setoran IPL.',
    };
  }

  const pinCheck = await verifyActiveAdminPin(session, pinInput);
  if (pinCheck.error) {
    return { error: pinCheck.error };
  }

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseClient(session);

  if (supabase && isSupabaseConfigured() && !trx.id.startsWith('trx-')) {
    try {
      const { data: deletedRows, error: delErr } = await supabase
        .from('transaksi_ipl')
        .delete()
        .eq('id', trx.id)
        .select('id');
      if (delErr) {
        return {
          error: parseFriendlyError(
            delErr,
            'Gagal menghapus setoran IPL di Supabase. Pastikan policy DELETE aktif.'
          ),
        };
      }
      if (!deletedRows || deletedRows.length === 0) {
        return {
          error:
            'Penghapusan ditolak oleh kebijakan RLS Supabase pada tabel transaksi_ipl. Jalankan ulang migration_v3_two_step_and_patrol_map.sql di Supabase SQL Editor agar policy DELETE aktif.',
        };
      }

      // Ambil sisa transaksi untuk rumah & tahun yang sama agar status e-Card dihitung ulang secara akurat
      const { data: remainingRows } = await supabase
        .from('transaksi_ipl')
        .select('*')
        .eq('blok_rumah', trx.blok_rumah)
        .eq('tahun', trx.tahun);

      const remainingTrx = (remainingRows || []).map((r) =>
        normalizeTransaksiRow(r as Record<string, unknown>)
      );

      for (const bulan of trx.bulan_dibayar) {
        const coveringVerified = remainingTrx.find(
          (item) =>
            item.id !== trx.id &&
            item.status_verifikasi === 'Terverifikasi' &&
            item.bulan_dibayar.includes(bulan)
        );
        const coveringPending = !coveringVerified
          ? remainingTrx.find(
              (item) =>
                item.id !== trx.id &&
                (item.status_verifikasi === 'Pending' ||
                  item.status_verifikasi === 'ACC Bendahara') &&
                item.bulan_dibayar.includes(bulan)
            )
          : undefined;

        const nextStatus = coveringVerified
          ? 'Lunas'
          : coveringPending
            ? 'Menunggu Verifikasi'
            : getDefaultUnpaidStatusForMonth(bulan);
        const nextTrxId = coveringVerified?.id || coveringPending?.id || null;

        await supabase.from('status_ecard_bulanan').upsert(
          {
            blok_rumah: trx.blok_rumah,
            tahun: trx.tahun,
            bulan,
            status: nextStatus,
            transaksi_id: nextTrxId,
            updated_at: nowIso,
          },
          { onConflict: 'blok_rumah,tahun,bulan' }
        );
      }
    } catch (err) {
      return { error: parseFriendlyError(err, 'Terjadi kesalahan saat menghapus setoran IPL.') };
    }
  }

  // Bersihkan cache lokal & overlay approval
  writeApprovalOverlayEntry(`ipl::${trx.id}`, null);
  const allLocal = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI);
  const nextLocal = allLocal.filter((item) => item.id !== trx.id);
  writeLocal(STORAGE_KEYS.TRANSAKSI, nextLocal);
  syncLocalStatusForHouse(trx.blok_rumah);

  await recordAuditLog({
    session,
    action: 'DELETE_TRANSAKSI_IPL',
    entity: 'transaksi_ipl',
    entity_id: trx.id,
    summary: `${session.jabatan || 'Pengurus'} ${session.nama_warga} menghapus setoran IPL ${trx.blok_rumah} (${trx.nama_warga}) sebesar ${formatRupiah(trx.nominal)} untuk ${formatDaftarBulan(trx.bulan_dibayar, true)} ${trx.tahun} [${trx.no_kwitansi}].`,
    metadata: {
      blok_rumah: trx.blok_rumah,
      no_kwitansi: trx.no_kwitansi,
      nominal: trx.nominal,
      status_sebelumnya: trx.status_verifikasi,
      bulan_dibayar: trx.bulan_dibayar,
      tahun: trx.tahun,
    },
  });

  return { data: true };
}

function isMissingBotColumnError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'message' in err
        ? String((err as { message?: unknown }).message || '')
        : String(err || '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('secondary_whatsapp') ||
    lower.includes('bot_role') ||
    lower.includes('pgrst204') ||
    lower.includes('42703')
  );
}

export async function saveWargaAdmin(
  session: SessionUser,
  payload: {
    id?: string;
    blok_rumah: string;
    nama_warga: string;
    no_wa: string;
    secondary_whatsapp?: string | null;
    status_hunian: StatusHunian;
    nominal_iuran: number;
    pin_akses: string;
    bot_role?: BotAccessRole | null;
    aktif?: boolean;
    is_exempt?: boolean;
    is_pengurus?: boolean;
  }
): Promise<ServiceResult<Warga>> {
  if (session.role !== 'admin') return { error: 'Akses ditolak.' };
  if (payload.id && !isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: pengeditan data warga hanya dapat dilakukan oleh Bendahara.' };
  }

  const rawBlok = normalizeBlok(payload.blok_rumah);
  const cleanBlok = payload.id ? rawBlok : normalizeBlockCode(rawBlok) || rawBlok;
  const cleanWa = normalizePhoneNumber(payload.no_wa);
  const cleanSecondaryWa = normalizePhoneNumber(payload.secondary_whatsapp);
  const cleanBotRole: BotAccessRole =
    payload.bot_role === 'admin' || payload.bot_role === 'bendahara' ? payload.bot_role : 'warga';
  const cleanPin = payload.pin_akses.trim();
  const isOccupied = payload.status_hunian !== 'Kosong';
  const isExempt = Boolean(payload.is_exempt);
  const isPengurus = Boolean(payload.is_pengurus);

  if (!cleanBlok) return { error: 'Blok & No. Rumah wajib diisi (contoh: B03/07).' };
  if (!payload.nama_warga.trim()) return { error: 'Nama warga wajib diisi.' };
  if (!/^\d{6}$/.test(cleanPin)) return { error: 'PIN akses harus terdiri dari 6 digit angka.' };

  if (cleanWa && cleanWa !== '6281200000000' && (cleanWa.length < 10 || cleanWa.length > 15 || !cleanWa.startsWith('62'))) {
    return { error: 'Format No. WhatsApp Utama tidak valid (contoh: 0812xxxxxxxx).' };
  }
  if (cleanSecondaryWa && (cleanSecondaryWa.length < 10 || cleanSecondaryWa.length > 15 || !cleanSecondaryWa.startsWith('62'))) {
    return { error: 'Format No. WhatsApp Cadangan tidak valid (contoh: 0857xxxxxxxx).' };
  }
  if (isRealRegisteredPhone(cleanWa) && isRealRegisteredPhone(cleanSecondaryWa) && cleanWa === cleanSecondaryWa) {
    return { error: 'No. WhatsApp Cadangan tidak boleh sama dengan No. WhatsApp Utama.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      // Validasi duplikasi blok & nomor WhatsApp lintas unit di database
      let existingRows: Array<{
        id: string;
        blok_rumah: string;
        nama_warga: string;
        no_wa: string;
        secondary_whatsapp?: string | null;
      }> = [];

      const { data: rowsFull, error: fetchFullErr } = await supabase
        .from('users_warga')
        .select('id, blok_rumah, nama_warga, no_wa, secondary_whatsapp')
        .or('role.is.null,role.neq.admin');

      if (fetchFullErr && isMissingBotColumnError(fetchFullErr)) {
        const { data: rowsBasic, error: fetchBasicErr } = await supabase
          .from('users_warga')
          .select('id, blok_rumah, nama_warga, no_wa')
          .or('role.is.null,role.neq.admin');
        if (fetchBasicErr) throw fetchBasicErr;
        existingRows = (rowsBasic || []) as typeof existingRows;
      } else if (fetchFullErr) {
        throw fetchFullErr;
      } else {
        existingRows = (rowsFull || []) as typeof existingRows;
      }

      const duplicateBlok = existingRows.find(
        (row) => row.id !== payload.id && isSameBlockCode(row.blok_rumah, cleanBlok)
      );
      if (duplicateBlok) {
        return {
          error: `Blok ${cleanBlok} sudah terdaftar sebagai unit ${duplicateBlok.blok_rumah} (${duplicateBlok.nama_warga}).`,
        };
      }

      for (const row of existingRows) {
        if (row.id === payload.id) continue;
        const rowPrimary = normalizePhoneNumber(row.no_wa);
        const rowSecondary = normalizePhoneNumber(row.secondary_whatsapp);

        if (isRealRegisteredPhone(cleanWa)) {
          if (
            (isRealRegisteredPhone(rowPrimary) && rowPrimary === cleanWa) ||
            (isRealRegisteredPhone(rowSecondary) && rowSecondary === cleanWa)
          ) {
            return {
              error: `Nomor WA +${cleanWa} sudah terdaftar pada unit ${row.blok_rumah} (${row.nama_warga}). Satu nomor WA hanya boleh terhubung ke 1 unit rumah.`,
            };
          }
        }

        if (isRealRegisteredPhone(cleanSecondaryWa)) {
          if (
            (isRealRegisteredPhone(rowPrimary) && rowPrimary === cleanSecondaryWa) ||
            (isRealRegisteredPhone(rowSecondary) && rowSecondary === cleanSecondaryWa)
          ) {
            return {
              error: `Nomor WA Cadangan +${cleanSecondaryWa} sudah terdaftar pada unit ${row.blok_rumah} (${row.nama_warga}).`,
            };
          }
        }
      }

      if (payload.id) {
        const updateFullPayload = {
          blok_rumah: cleanBlok,
          nama_warga: payload.nama_warga.trim(),
          no_wa: cleanWa,
          secondary_whatsapp: cleanSecondaryWa,
          status_hunian: payload.status_hunian,
          nominal_iuran: payload.nominal_iuran,
          pin_akses: cleanPin,
          bot_role: cleanBotRole,
          aktif: payload.aktif ?? true,
          is_occupied: isOccupied,
          is_exempt: isExempt,
          is_pengurus: isPengurus,
        };

        let { data, error } = await supabase
          .from('users_warga')
          .update(updateFullPayload)
          .eq('id', payload.id)
          .select()
          .single();

        if (error) {
          const msg = String((error as { message?: string }).message || '').toLowerCase();
          if (
            msg.includes('is_occupied') ||
            msg.includes('is_exempt') ||
            msg.includes('is_pengurus') ||
            isMissingBotColumnError(error)
          ) {
            const { data: midData, error: midErr } = await supabase
              .from('users_warga')
              .update({
                blok_rumah: cleanBlok,
                nama_warga: payload.nama_warga.trim(),
                no_wa: cleanWa,
                secondary_whatsapp: cleanSecondaryWa,
                status_hunian: payload.status_hunian,
                nominal_iuran: payload.nominal_iuran,
                pin_akses: cleanPin,
                bot_role: cleanBotRole,
                aktif: payload.aktif ?? true,
              })
              .eq('id', payload.id)
              .select()
              .single();

            if (midErr && isMissingBotColumnError(midErr)) {
              if (cleanSecondaryWa || cleanBotRole !== 'warga') {
                return {
                  error:
                    'Kolom secondary_whatsapp / bot_role belum ditambahkan di Supabase. Jalankan SQL migrasi Bot WA di Supabase SQL Editor terlebih dahulu.',
                };
              }
              const retry = await supabase
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
              data = retry.data;
              error = retry.error;
            } else {
              data = midData;
              error = midErr;
            }
          }
        }

        if (error) throw error;

        await recordAuditLog({
          session,
          action: 'UPDATE_WARGA',
          entity: 'users_warga',
          entity_id: data.id,
          summary: `Memperbarui data warga ${cleanBlok} — ${payload.nama_warga.trim()} (WA: ${cleanWa || '-'}, Bot Role: ${cleanBotRole}).`,
        });
        return {
          data: normalizeWargaRecord({
            ...(data as Warga),
            is_occupied: isOccupied,
            is_exempt: isExempt,
            is_pengurus: isPengurus,
          }),
        };
      }

      const insertFullPayload = {
        blok_rumah: cleanBlok,
        nama_warga: payload.nama_warga.trim(),
        no_wa: cleanWa,
        secondary_whatsapp: cleanSecondaryWa,
        status_hunian: payload.status_hunian,
        nominal_iuran: payload.nominal_iuran,
        pin_akses: cleanPin,
        bot_role: cleanBotRole,
        aktif: true,
        is_occupied: isOccupied,
        is_exempt: isExempt,
        is_pengurus: isPengurus,
      };

      let { data, error } = await supabase
        .from('users_warga')
        .insert(insertFullPayload)
        .select()
        .single();

      if (error) {
        const msg = String((error as { message?: string }).message || '').toLowerCase();
        if (
          msg.includes('is_occupied') ||
          msg.includes('is_exempt') ||
          msg.includes('is_pengurus') ||
          isMissingBotColumnError(error)
        ) {
          const { data: midData, error: midErr } = await supabase
            .from('users_warga')
            .insert({
              blok_rumah: cleanBlok,
              nama_warga: payload.nama_warga.trim(),
              no_wa: cleanWa,
              secondary_whatsapp: cleanSecondaryWa,
              status_hunian: payload.status_hunian,
              nominal_iuran: payload.nominal_iuran,
              pin_akses: cleanPin,
              bot_role: cleanBotRole,
              aktif: true,
            })
            .select()
            .single();

          if (midErr && isMissingBotColumnError(midErr)) {
            if (cleanSecondaryWa || cleanBotRole !== 'warga') {
              return {
                error:
                  'Kolom secondary_whatsapp / bot_role belum ditambahkan di Supabase. Jalankan SQL migrasi Bot WA di Supabase SQL Editor terlebih dahulu.',
              };
            }
            const retry = await supabase
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
            data = retry.data;
            error = retry.error;
          } else {
            data = midData;
            error = midErr;
          }
        }
      }

      if (error) throw error;

      await recordAuditLog({
        session,
        action: 'CREATE_WARGA',
        entity: 'users_warga',
        entity_id: data.id,
        summary: `Menambahkan warga baru ${cleanBlok} — ${payload.nama_warga.trim()} (WA: ${cleanWa || '-'}).`,
      });
      return {
        data: normalizeWargaRecord({
          ...(data as Warga),
          is_occupied: isOccupied,
          is_exempt: isExempt,
          is_pengurus: isPengurus,
        }),
      };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menyimpan data warga ke Supabase.') };
    }
  }

  const list = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);

  // Validasi duplikasi blok & nomor WhatsApp pada mode lokal
  const duplicateBlok = list.find((w) => w.id !== payload.id && isSameBlockCode(w.blok_rumah, cleanBlok));
  if (duplicateBlok) {
    return { error: `Blok ${cleanBlok} sudah terdaftar pada unit ${duplicateBlok.blok_rumah}.` };
  }

  for (const w of list) {
    if (w.id === payload.id) continue;
    const rowPrimary = normalizePhoneNumber(w.no_wa);
    const rowSecondary = normalizePhoneNumber(w.secondary_whatsapp);
    if (
      isRealRegisteredPhone(cleanWa) &&
      ((isRealRegisteredPhone(rowPrimary) && rowPrimary === cleanWa) ||
        (isRealRegisteredPhone(rowSecondary) && rowSecondary === cleanWa))
    ) {
      return {
        error: `Nomor WA +${cleanWa} sudah terdaftar pada unit ${w.blok_rumah} (${w.nama_warga}).`,
      };
    }
    if (
      isRealRegisteredPhone(cleanSecondaryWa) &&
      ((isRealRegisteredPhone(rowPrimary) && rowPrimary === cleanSecondaryWa) ||
        (isRealRegisteredPhone(rowSecondary) && rowSecondary === cleanSecondaryWa))
    ) {
      return {
        error: `Nomor WA Cadangan +${cleanSecondaryWa} sudah terdaftar pada unit ${w.blok_rumah} (${w.nama_warga}).`,
      };
    }
  }

  if (payload.id) {
    let updated: Warga | undefined;
    const next = list.map((w) => {
      if (w.id !== payload.id) return w;
      updated = normalizeWargaRecord({
        ...w,
        blok_rumah: cleanBlok,
        nama_warga: payload.nama_warga.trim(),
        no_wa: cleanWa,
        secondary_whatsapp: cleanSecondaryWa,
        status_hunian: payload.status_hunian,
        occupancy_status: payload.status_hunian === 'Kosong' ? 'kosong' : 'aktif',
        nominal_iuran: payload.nominal_iuran,
        pin_akses: cleanPin,
        bot_role: cleanBotRole,
        aktif: payload.aktif ?? w.aktif,
        is_occupied: isOccupied,
        is_exempt: isExempt,
        is_pengurus: payload.is_pengurus ?? w.is_pengurus,
      });
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

  const created = normalizeWargaRecord({
    id: `warga-${Date.now()}`,
    blok_rumah: cleanBlok,
    nama_warga: payload.nama_warga.trim(),
    no_wa: cleanWa,
    secondary_whatsapp: cleanSecondaryWa,
    status_hunian: payload.status_hunian,
    occupancy_status: payload.status_hunian === 'Kosong' ? 'kosong' : 'aktif',
    nominal_iuran: payload.nominal_iuran,
    pin_akses: cleanPin,
    bot_role: cleanBotRole,
    aktif: true,
    is_occupied: isOccupied,
    is_exempt: isExempt,
    is_pengurus: isPengurus,
    created_at: new Date().toISOString(),
  });

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

/**
 * Mengubah status hunian unit rumah secara cepat (Dihuni / Aktif <-> Rumah Kosong)
 * tanpa menyentuh atau menghapus riwayat transaksi IPL yang pernah tercatat.
 */
export async function toggleWargaOccupancyAdmin(
  session: SessionUser,
  warga: Warga,
  nextOccupancy: OccupancyStatus
): Promise<ServiceResult<Warga>> {
  if (!isBendaharaFullAccess(session)) {
    return {
      error: 'Akses ditolak: perubahan status hunian unit hanya dapat dilakukan oleh Bendahara.',
    };
  }

  const nextStatusHunian: StatusHunian =
    nextOccupancy === 'kosong'
      ? 'Kosong'
      : warga.status_hunian === 'Kontrak'
        ? 'Kontrak'
        : 'Tetap';

  const nextNominal =
    nextOccupancy === 'aktif' && (!warga.nominal_iuran || warga.nominal_iuran <= 0)
      ? NOMINAL_IPL_STANDAR
      : warga.nominal_iuran;

  const isOccupiedBool = nextOccupancy !== 'kosong';
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      let { data, error } = await supabase
        .from('users_warga')
        .update({
          status_hunian: nextStatusHunian,
          nominal_iuran: nextNominal,
          is_occupied: isOccupiedBool,
        })
        .eq('id', warga.id)
        .select()
        .single();

      if (error && String((error as { message?: string }).message || '').toLowerCase().includes('is_occupied')) {
        const retry = await supabase
          .from('users_warga')
          .update({
            status_hunian: nextStatusHunian,
            nominal_iuran: nextNominal,
          })
          .eq('id', warga.id)
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw error;

      const normalized = normalizeWargaRecord({
        ...(data as Warga),
        occupancy_status: nextOccupancy,
        is_occupied: isOccupiedBool,
      });

      await recordAuditLog({
        session,
        action: 'UPDATE_STATUS_HUNIAN',
        entity: 'users_warga',
        entity_id: normalized.id,
        summary: `Mengubah status hunian Blok ${warga.blok_rumah} (${warga.nama_warga}) menjadi ${
          nextOccupancy === 'kosong' ? 'Rumah Kosong' : `Dihuni / Aktif (${nextStatusHunian})`
        }.`,
      });

      return { data: normalized };
    } catch (err) {
      return {
        error: parseFriendlyError(err, 'Gagal memperbarui status hunian unit ke Supabase.'),
      };
    }
  }

  const list = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);
  let updated: Warga | undefined;
  const nextList = list.map((item) => {
    if (item.id !== warga.id) return item;
    updated = normalizeWargaRecord({
      ...item,
      status_hunian: nextStatusHunian,
      occupancy_status: nextOccupancy,
      is_occupied: isOccupiedBool,
      nominal_iuran: nextNominal,
    });
    return updated;
  });

  if (!updated) {
    return { error: 'Data unit rumah tidak ditemukan.' };
  }

  writeLocal(STORAGE_KEYS.WARGA, nextList);
  await recordAuditLog({
    session,
    action: 'UPDATE_STATUS_HUNIAN',
    entity: 'users_warga',
    entity_id: updated.id,
    summary: `Mengubah status hunian Blok ${warga.blok_rumah} (${warga.nama_warga}) menjadi ${
      nextOccupancy === 'kosong' ? 'Rumah Kosong' : `Dihuni / Aktif (${nextStatusHunian})`
    }.`,
  });

  return { data: updated };
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
    void dispatchActivityNotifications(session, [
      {
        user_id: buildWargaUserId(warga.blok_rumah),
        category: 'system',
        title: 'PIN Akses Unit Diperbarui',
        message: `PIN 6 digit akun Blok ${warga.blok_rumah} telah direset oleh Pengurus (${session.nama_warga}).`,
        target_url: 'tab:profil',
      },
      ...getKetuaUserIds().map((uid) => ({
        user_id: uid,
        category: 'system' as const,
        title: `Reset PIN Warga Blok ${warga.blok_rumah}`,
        message: `${session.nama_warga} mereset PIN akses unit ${warga.blok_rumah} (${warga.nama_warga}).`,
        target_url: 'tab:warga',
      })),
    ]);
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

export interface BulkImportWargaResult {
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  totalRoster: number;
}

export async function importMasterWargaToDatabase(
  session: SessionUser,
  options?: { syncExisting?: boolean }
): Promise<ServiceResult<BulkImportWargaResult>> {
  if (session.role !== 'admin') return { error: 'Akses ditolak.' };

  const syncExisting = Boolean(options?.syncExisting) && isBendaharaFullAccess(session);
  const supabase = getSupabaseClient(session);

  if (supabase && isSupabaseConfigured()) {
    try {
      const { data: existingRows, error: fetchErr } = await supabase
        .from('users_warga')
        .select('id, blok_rumah, nama_warga, no_wa, status_hunian, nominal_iuran, pin_akses')
        .or('role.is.null,role.neq.admin');

      if (fetchErr) throw fetchErr;

      const existingMap = new Map<
        string,
        {
          id: string;
          blok_rumah: string;
          nama_warga: string;
          no_wa: string;
          status_hunian: StatusHunian;
          nominal_iuran: number;
          pin_akses: string;
        }
      >();

      for (const row of existingRows || []) {
        const key = canonicalizeBlokKey(String(row.blok_rumah || ''));
        if (key && !existingMap.has(key)) {
          existingMap.set(key, {
            id: String(row.id),
            blok_rumah: String(row.blok_rumah),
            nama_warga: String(row.nama_warga || ''),
            no_wa: String(row.no_wa || ''),
            status_hunian: (row.status_hunian as StatusHunian) || 'Tetap',
            nominal_iuran: Number(row.nominal_iuran ?? 0),
            pin_akses: String(row.pin_akses || ''),
          });
        }
      }

      const toInsert: Array<{
        blok_rumah: string;
        nama_warga: string;
        no_wa: string;
        status_hunian: StatusHunian;
        nominal_iuran: number;
        pin_akses: string;
        role: 'warga';
        aktif: boolean;
      }> = [];

      const toUpdate: Array<{
        id: string;
        nama_warga: string;
        status_hunian: StatusHunian;
        nominal_iuran: number;
      }> = [];

      let skippedCount = 0;

      for (const seed of SEED_WARGA) {
        const key = canonicalizeBlokKey(seed.blok_rumah);
        const existing = existingMap.get(key);
        if (!existing) {
          toInsert.push({
            blok_rumah: seed.blok_rumah,
            nama_warga: seed.nama_warga,
            no_wa: seed.no_wa,
            status_hunian: seed.status_hunian,
            nominal_iuran: seed.nominal_iuran,
            pin_akses: seed.pin_akses,
            role: 'warga',
            aktif: true,
          });
        } else if (
          syncExisting &&
          (existing.nama_warga.trim().toUpperCase() !== seed.nama_warga.trim().toUpperCase() ||
            existing.status_hunian !== seed.status_hunian ||
            existing.nominal_iuran !== seed.nominal_iuran)
        ) {
          toUpdate.push({
            id: existing.id,
            nama_warga: seed.nama_warga,
            status_hunian: seed.status_hunian,
            nominal_iuran: seed.nominal_iuran,
          });
        } else {
          skippedCount += 1;
        }
      }

      const CHUNK_SIZE = 40;
      for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
        const chunk = toInsert.slice(i, i + CHUNK_SIZE);
        const { error: insertErr } = await supabase.from('users_warga').insert(chunk);
        if (insertErr) throw insertErr;
      }

      for (const upd of toUpdate) {
        const { error: updErr } = await supabase
          .from('users_warga')
          .update({
            nama_warga: upd.nama_warga,
            status_hunian: upd.status_hunian,
            nominal_iuran: upd.nominal_iuran,
          })
          .eq('id', upd.id);
        if (updErr) throw updErr;
      }

      await recordAuditLog({
        session,
        action: 'BULK_IMPORT_WARGA',
        entity: 'users_warga',
        summary: `Import data master 109 warga Saung Kebun: ${toInsert.length} baru ditambahkan, ${toUpdate.length} diperbarui, ${skippedCount} sudah ada.`,
      });

      return {
        data: {
          insertedCount: toInsert.length,
          updatedCount: toUpdate.length,
          skippedCount,
          totalRoster: SEED_WARGA.length,
        },
      };
    } catch (err) {
      return {
        error: parseFriendlyError(err, 'Gagal mengimpor data 109 warga ke database Supabase.'),
      };
    }
  }

  // Fallback Mode Lokal
  ensureLocalStoreInitialized();
  const current = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);
  const existingMap = new Map<string, Warga>();
  for (const w of current) {
    const key = canonicalizeBlokKey(w.blok_rumah);
    if (key && !existingMap.has(key)) existingMap.set(key, w);
  }

  const next = [...current];
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const seed of SEED_WARGA) {
    const key = canonicalizeBlokKey(seed.blok_rumah);
    const existing = existingMap.get(key);
    if (!existing) {
      next.push({ ...seed, created_at: new Date().toISOString() });
      syncLocalStatusForHouse(seed.blok_rumah);
      insertedCount += 1;
    } else if (
      syncExisting &&
      (existing.nama_warga.trim().toUpperCase() !== seed.nama_warga.trim().toUpperCase() ||
        existing.status_hunian !== seed.status_hunian ||
        existing.nominal_iuran !== seed.nominal_iuran)
    ) {
      const idx = next.findIndex((item) => item.id === existing.id);
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          nama_warga: seed.nama_warga,
          status_hunian: seed.status_hunian,
          nominal_iuran: seed.nominal_iuran,
        };
        updatedCount += 1;
      }
    } else {
      skippedCount += 1;
    }
  }

  writeLocal(STORAGE_KEYS.WARGA, next);
  await recordAuditLog({
    session,
    action: 'BULK_IMPORT_WARGA',
    entity: 'users_warga',
    summary: `Import data master 109 warga Saung Kebun: ${insertedCount} baru ditambahkan, ${updatedCount} diperbarui, ${skippedCount} sudah ada.`,
  });

  return {
    data: {
      insertedCount,
      updatedCount,
      skippedCount,
      totalRoster: SEED_WARGA.length,
    },
  };
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
  const derivedFundType = deriveIplFundType(payload.nominal, sortedBulan.length);
  const derivedHolderRole = deriveIplHolderRole('Setor Tunai', payload.petugas_penerima);
  const isFullMonthly =
    Math.round(payload.nominal / Math.max(sortedBulan.length, 1)) >= NOMINAL_IPL_STANDAR;

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const baseManualPayload = {
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

      let { data, error } = await supabase
        .from('transaksi_ipl')
        .insert({
          ...baseManualPayload,
          fund_type: derivedFundType,
          holder_role: derivedHolderRole,
        })
        .select()
        .single();

      if (error) {
        const msg = String((error as { message?: string }).message || '').toLowerCase();
        if (msg.includes('fund_type') || msg.includes('holder_role') || msg.includes('column') || msg.includes('42703')) {
          const retry = await supabase
            .from('transaksi_ipl')
            .insert(baseManualPayload)
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (error) throw error;

      for (const bulan of sortedBulan) {
        await supabase.from('status_ecard_bulanan').upsert(
          {
            blok_rumah: payload.warga.blok_rumah,
            tahun: TAHUN_AKTIF,
            bulan,
            status: isFullMonthly ? 'Lunas' : getDefaultUnpaidStatusForMonth(bulan),
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

      return { data: normalizeTransaksiRow(data as Record<string, unknown>) };
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
    fund_type: derivedFundType,
    holder_role: derivedHolderRole,
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
  if (!isBendaharaOnly(session)) {
    return { error: 'Akses ditolak: fitur dan pengaturan Bot WhatsApp khusus Bendahara.' };
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
      void dispatchActivityNotifications(
        session,
        getBendaharaAndKetuaUserIds().map((uid) => ({
          user_id: uid,
          category: 'system' as const,
          title: 'Konfigurasi Bot WA Diperbarui',
          message: `${session.nama_warga} memperbarui pengaturan Bot WA (${updatedConfig.provider}, status ${updatedConfig.aktif ? 'Aktif' : 'Nonaktif'}).`,
          target_url: 'settings:bot_wa',
        }))
      );
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
  void dispatchActivityNotifications(
    session,
    getBendaharaAndKetuaUserIds().map((uid) => ({
      user_id: uid,
      category: 'system' as const,
      title: 'Konfigurasi Bot WA Diperbarui',
      message: `${session.nama_warga} memperbarui pengaturan Bot WA (${updatedConfig.provider}).`,
      target_url: 'settings:bot_wa',
    }))
  );
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
        'x-blok-rumah': session.blok_rumah || '',
        'x-user-jabatan': session.jabatan || '',
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
  if (!isBendaharaOnly(session)) {
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
  statusList: StatusEcardBulanan[],
  billingStart?: BillingStartPeriod | null
): Promise<ServiceResult<{ sentCount: number; message: string }>> {
  if (!isBendaharaOnly(session)) {
    return { error: 'Akses ditolak: pengiriman pengingat Bot WA manual khusus Bendahara.' };
  }

  if (!config.aktif) {
    return {
      error: 'Bot WA masih Nonaktif. Nyalakan sakelar Status Bot WhatsApp Otomatis terlebih dahulu.',
    };
  }

  const currentMonth = getCurrentBillingMonth();
  const bulanNama = `${getNamaBulan(currentMonth)} ${TAHUN_AKTIF}`;
  const resolvedStart = billingStart ?? readLocalAppBrandConfig();
  if (isBeforeBillingStart(TAHUN_AKTIF, currentMonth, resolvedStart)) {
    return {
      data: {
        sentCount: 0,
        message: `Periode ${bulanNama} berstatus Pra-Rilis (penagihan aktif mulai ${formatBillingStartLabel(resolvedStart)}), sehingga pengingat tunggakan tidak dikirim.`,
      },
    };
  }
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
      .replaceAll('{blok_rumah}', formatBlokRumah(w.blok_rumah) || w.blok_rumah)
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
  if (!isBendaharaOnly(session)) {
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
      .replaceAll('{blok_rumah}', formatBlokRumah(w.blok_rumah) || w.blok_rumah)
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

export async function sendSingleCredentialWaAdmin(
  session: SessionUser,
  config: BotWaConfig,
  payload: {
    category: 'warga' | 'pengurus' | 'keamanan';
    kodeBlokAtauId: string;
    namaPenerima: string;
    noWa: string;
    pesan: string;
    logLabel: string;
  }
): Promise<
  ServiceResult<{
    status_kirim: 'Terkirim' | 'Gagal';
    respon_gateway: string;
    no_wa: string;
  }>
> {
  if (session.role !== 'admin' || session.is_active_pengurus === false) {
    return { error: 'Akses ditolak: pengiriman informasi akun & PIN khusus Pengurus aktif.' };
  }

  const normalizedPhone = normalizePhoneNumber(payload.noWa);
  if (!isRealRegisteredPhone(normalizedPhone)) {
    return { error: 'Nomor WhatsApp penerima kosong atau belum valid.' };
  }

  if (!config.api_token.trim()) {
    return { error: 'API Token Fonnte / Wablas belum diisi. Simpan API Token terlebih dahulu.' };
  }

  const proxyRes = await dispatchViaServerWaProxy(session, config, [
    {
      blok_rumah: payload.kodeBlokAtauId,
      nama_warga: payload.namaPenerima,
      no_wa: normalizedPhone,
      pesan: payload.pesan,
    },
  ]);

  if (!proxyRes.available) {
    return {
      error:
        'Endpoint /api/bot-wa/send belum aktif pada lingkungan ini. Jalankan server atau deploy ke Vercel.',
    };
  }

  if (proxyRes.error) {
    return { error: proxyRes.error };
  }

  const item = proxyRes.results?.[0];
  if (!item) {
    return { error: 'Tidak ada respon dari gateway WhatsApp.' };
  }

  await persistBotWaLogs(session, [
    {
      id: `walog-cred-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      created_at: new Date().toISOString(),
      blok_rumah: item.blok_rumah,
      nama_warga: item.nama_warga,
      no_wa: item.no_wa,
      jenis_pesan: payload.logLabel,
      status_kirim: item.status_kirim,
      respon_gateway: item.respon_gateway,
      pesan: `Informasi akun & PIN (${payload.category}) dikirim ke ${payload.namaPenerima} (${payload.kodeBlokAtauId}).`,
    },
  ]);

  return {
    data: {
      status_kirim: item.status_kirim,
      respon_gateway: item.respon_gateway,
      no_wa: item.no_wa,
    },
  };
}

export async function recordWaPinBatchAuditAdmin(
  session: SessionUser,
  params: {
    category: 'warga' | 'pengurus' | 'keamanan';
    provider: string;
    total: number;
    sent: number;
    failed: number;
    cancelled?: boolean;
  }
): Promise<void> {
  const categoryLabel =
    params.category === 'warga'
      ? 'Warga'
      : params.category === 'pengurus'
        ? 'Admin / Pengurus'
        : 'Anggota Keamanan';

  await recordAuditLog({
    session,
    action: 'SEND_PIN_DISTRIBUTION_WA',
    entity: 'bot_wa_logs',
    summary: `${session.nama_warga} mengirim info akun & PIN kategori ${categoryLabel} via ${params.provider}: ${params.sent}/${params.total} terkirim${params.failed > 0 ? `, ${params.failed} gagal` : ''}${params.cancelled ? ' (dihentikan)' : ''}.`,
    metadata: {
      category: params.category,
      provider: params.provider,
      total: params.total,
      sent: params.sent,
      failed: params.failed,
      cancelled: Boolean(params.cancelled),
    },
  });
}

export async function sendWargaBotActivationWaAdmin(
  session: SessionUser,
  config: BotWaConfig,
  warga: Warga
): Promise<ServiceResult<{ sentViaGateway: boolean; message: string }>> {
  if (!isBendaharaOnly(session)) {
    return { error: 'Akses ditolak: pengiriman via gateway Bot WA khusus Bendahara.' };
  }

  const targetsNumbers = Array.from(
    new Set(
      [warga.no_wa, warga.secondary_whatsapp]
        .map((n) => normalizePhoneNumber(n))
        .filter((n) => isRealRegisteredPhone(n))
    )
  );

  if (targetsNumbers.length === 0) {
    return { error: `Unit ${warga.blok_rumah} belum memiliki nomor WhatsApp valid yang terdaftar.` };
  }

  if (!config.api_token.trim()) {
    return { error: 'Token Fonnte/Wablas belum diisi.' };
  }

  const activationText = buildWargaBotActivationMessage(warga);
  const targets: ProxyWaTarget[] = targetsNumbers.map((noWa) => ({
    blok_rumah: warga.blok_rumah,
    nama_warga: warga.nama_warga,
    no_wa: noWa,
    pesan: activationText,
  }));

  const proxyRes = await dispatchViaServerWaProxy(session, config, targets);
  if (!proxyRes.available) {
    return { error: 'Proxy /api/bot-wa/send belum tersedia.' };
  }
  if (proxyRes.error) {
    return { error: proxyRes.error };
  }

  const nowIso = new Date().toISOString();
  const newLogs: BotWaLog[] = (proxyRes.results || []).map((r, i) => ({
    id: `walog-act-${Date.now()}-${i}`,
    created_at: nowIso,
    blok_rumah: r.blok_rumah,
    nama_warga: r.nama_warga,
    no_wa: r.no_wa,
    jenis_pesan: 'Info Aktivasi Bot WA (CEK)',
    status_kirim: r.status_kirim,
    respon_gateway: r.respon_gateway,
    pesan: r.pesan,
  }));

  await persistBotWaLogs(session, newLogs);

  const sentCount = newLogs.filter((l) => l.status_kirim === 'Terkirim').length;
  if (sentCount === 0) {
    return {
      error: `Gagal mengirim aktivasi Bot via ${config.provider}: ${newLogs[0]?.respon_gateway || 'Device terputus'}`,
    };
  }

  await recordAuditLog({
    session,
    action: 'SEND_BOT_ACTIVATION_WA',
    entity: 'bot_wa_logs',
    entity_id: warga.id,
    summary: `Mengirim notifikasi aktivasi Bot WA (perintah CEK) ke ${warga.blok_rumah} (${targetsNumbers.join(', ')}).`,
  });

  return {
    data: {
      sentViaGateway: true,
      message: `Info aktivasi Bot WA berhasil dikirim via ${config.provider} ke ${targetsNumbers.map((n) => `+${n}`).join(' & ')}.`,
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
  if (!isBendaharaOnly(session)) {
    return { error: 'Akses ditolak: fitur kirim pengumuman / blast khusus Bendahara.' };
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

  // Kirim notifikasi lonceng real-time & Broadcast FCM ke SELURUH perangkat (Warga, Pengurus, Keamanan)
  const broadcastSummary =
    cleanMessage.length > 180 ? `${cleanMessage.slice(0, 177).trim()}...` : cleanMessage;
  const bulkBroadcastDedup = `announcement:${saved.id}`;
  void dispatchActivityNotifications(
    session,
    [
      {
        user_id: 'broadcast:warga',
        category: 'announcement',
        title: cleanTitle,
        message: cleanMessage,
        target_url: 'tab:beranda',
        dedup_key: bulkBroadcastDedup,
      },
      {
        user_id: 'broadcast:petugas',
        category: 'announcement',
        title: cleanTitle,
        message: cleanMessage,
        target_url: 'tab:info',
        dedup_key: bulkBroadcastDedup,
      },
      ...getAllAdminUserIds().map((uid) => ({
        user_id: uid,
        category: 'announcement' as const,
        title: cleanTitle,
        message: `${cleanMessage} (Dikirim oleh ${session.nama_warga} ke ${recipients.length} unit warga)`,
        target_url: 'tab:dashboard',
        dedup_key: bulkBroadcastDedup,
      })),
    ],
    {
      broadcast: true,
      category: 'announcement',
      title: cleanTitle,
      body: broadcastSummary,
      target_url: 'tab:beranda',
      dedup_key: bulkBroadcastDedup,
    }
  );

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
        const resolved: PaymentConfig = {
          ...SEED_PAYMENT_CONFIG,
          ...row,
          rekening_list: Array.isArray(row.rekening_list)
            ? row.rekening_list
            : SEED_PAYMENT_CONFIG.rekening_list,
        };
        writeLocalPaymentConfig(resolved);
        return resolved;
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
  if (!isBendaharaFullAccess(session) && !hasSettingModulePermission(session, 'settings.ipl_billing')) {
    return { error: 'Akses ditolak: unggah gambar QRIS hanya untuk Bendahara atau Pengurus terdelegasi.' };
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
  if (!isBendaharaFullAccess(session) && !hasSettingModulePermission(session, 'settings.ipl_billing')) {
    return {
      error:
        'Akses ditolak: perubahan pengaturan QRIS dan nomor rekening transfer hanya untuk Bendahara atau Pengurus terdelegasi.',
    };
  }

  const updated: PaymentConfig = {
    id: 'default-payment-config',
    qris_aktif: Boolean(config.qris_aktif),
    qris_image_url: config.qris_image_url || null,
    qris_label: String(config.qris_label || SEED_PAYMENT_CONFIG.qris_label).trim(),
    qris_catatan: String(config.qris_catatan || SEED_PAYMENT_CONFIG.qris_catatan).trim(),
    nominal_ipl_bulanan:
      Number(config.nominal_ipl_bulanan) > 0
        ? Math.round(Number(config.nominal_ipl_bulanan))
        : NOMINAL_IPL_STANDAR,
    rekening_list: Array.isArray(config.rekening_list)
      ? config.rekening_list.map((r) => ({
          id: r.id || `rek-${Date.now()}`,
          bank: String(r.bank || '').trim(),
          nomor: String(r.nomor || '').trim(),
          atasNama: String(r.atasNama || '').trim(),
          tipe: r.tipe === 'E-Wallet' ? 'E-Wallet' : 'Transfer Bank',
        }))
      : [],
    updated_at: new Date().toISOString(),
    updated_by: session.blok_rumah,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      let { data, error } = await supabase
        .from('payment_config')
        .upsert(updated, { onConflict: 'id' })
        .select()
        .single();

      // Jika kolom nominal_ipl_bulanan belum ditambahkan di Supabase, coba ulang tanpa kolom tersebut
      if (error && String((error as { message?: string }).message || '').includes('nominal_ipl_bulanan')) {
        const { nominal_ipl_bulanan: _omit, ...legacyPayload } = updated;
        const retry = await supabase
          .from('payment_config')
          .upsert(legacyPayload, { onConflict: 'id' })
          .select()
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) {
        const msg = String((error as { message?: string }).message || '');
        const code = String((error as { code?: string }).code || '');
        if (code === '42P01' || msg.includes('payment_config')) {
          return {
            error:
              'Tabel payment_config belum ada di Supabase. Jalankan SQL sinkronisasi payment_config di Supabase SQL Editor agar rekening tersimpan untuk semua warga & Bot WA.',
          };
        }
        return {
          error: parseFriendlyError(
            error,
            'Gagal menyimpan nomor rekening ke database Supabase (Bot WA belum tersinkron).'
          ),
        };
      }
      const saved: PaymentConfig = {
        ...updated,
        ...((data || {}) as Partial<PaymentConfig>),
        nominal_ipl_bulanan: updated.nominal_ipl_bulanan,
      };
      writeLocalPaymentConfig(saved);
      await recordAuditLog({
        session,
        action: 'UPDATE_PAYMENT_CONFIG',
        entity: 'payment_config',
        entity_id: updated.id,
        summary: `Bendahara ${session.nama_warga} memperbarui pengaturan pembayaran (QRIS: ${updated.qris_aktif && updated.qris_image_url ? 'Aktif' : 'Nonaktif'}, ${updated.rekening_list.length} rekening, IPL ${formatRupiah(updated.nominal_ipl_bulanan || NOMINAL_IPL_STANDAR)}).`,
      });
      void dispatchActivityNotifications(
        session,
        getBendaharaAndKetuaUserIds().map((uid) => ({
          user_id: uid,
          category: 'system' as const,
          title: 'Pengaturan QRIS & Rekening Diperbarui',
          message: `${session.nama_warga} memperbarui metode pembayaran (${updated.rekening_list.length} rekening, IPL ${formatRupiah(updated.nominal_ipl_bulanan || NOMINAL_IPL_STANDAR)}).`,
          target_url: 'settings:pembayaran',
        }))
      );
      return { data: saved };
    } catch (err) {
      return {
        error: parseFriendlyError(
          err,
          'Gagal menyinkronkan nomor rekening ke database Supabase.'
        ),
      };
    }
  }

  writeLocalPaymentConfig(updated);
  await recordAuditLog({
    session,
    action: 'UPDATE_PAYMENT_CONFIG',
    entity: 'payment_config',
    entity_id: updated.id,
    summary: `Bendahara ${session.nama_warga} memperbarui pengaturan pembayaran (QRIS: ${updated.qris_aktif && updated.qris_image_url ? 'Aktif' : 'Nonaktif'}, ${updated.rekening_list.length} rekening, IPL ${formatRupiah(updated.nominal_ipl_bulanan || NOMINAL_IPL_STANDAR)}).`,
  });
  void dispatchActivityNotifications(
    session,
    getBendaharaAndKetuaUserIds().map((uid) => ({
      user_id: uid,
      category: 'system' as const,
      title: 'Pengaturan QRIS & Rekening Diperbarui',
      message: `${session.nama_warga} memperbarui metode pembayaran (${updated.rekening_list.length} rekening).`,
      target_url: 'settings:pembayaran',
    }))
  );

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
    stempel_url:
      typeof incoming.stempel_url === 'string' && incoming.stempel_url.trim()
        ? incoming.stempel_url.trim()
        : incoming.stempel_url === null
          ? null
          : (base.stempel_url ?? null),
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
    billing_start_month: resolveBillingStartPeriod({
      billing_start_month: incoming.billing_start_month ?? base.billing_start_month,
      billing_start_year: incoming.billing_start_year ?? base.billing_start_year,
    }).startMonth,
    billing_start_year: resolveBillingStartPeriod({
      billing_start_month: incoming.billing_start_month ?? base.billing_start_month,
      billing_start_year: incoming.billing_start_year ?? base.billing_start_year,
    }).startYear,
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
  if (
    !isBendaharaFullAccess(session) &&
    !hasSettingModulePermission(session, 'settings.residents_blocks')
  ) {
    return { error: 'Akses ditolak: unggah logo aplikasi hanya untuk Bendahara atau Pengurus terdelegasi.' };
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

export async function uploadStempelImageAdmin(
  session: SessionUser,
  file: File
): Promise<ServiceResult<string>> {
  if (
    !isBendaharaFullAccess(session) &&
    !hasSettingModulePermission(session, 'settings.residents_blocks')
  ) {
    return { error: 'Akses ditolak: unggah stempel resmi hanya untuk Bendahara atau Pengurus terdelegasi.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const rawExt = file.name?.split('.').pop()?.toLowerCase() || '';
      const safeExt = ['png', 'webp', 'svg'].includes(rawExt) ? rawExt : 'png';
      const filePath = `branding/stempel-pengurus-${Date.now()}.${safeExt}`;
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
      // Fallback ke data URL PNG transparan
    }
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    return { data: dataUrl };
  } catch (err) {
    return { error: parseFriendlyError(err, 'Gagal membaca file gambar stempel resmi.') };
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
    | 'stempel_url'
    | 'wa_pengurus'
    | 'wa_pengurus_label'
    | 'wa_bot'
    | 'pengurus_wa_map'
    | 'billing_start_month'
    | 'billing_start_year'
  >
): Promise<ServiceResult<AppBrandConfig>> {
  if (
    !isBendaharaFullAccess(session) &&
    !hasSettingModulePermission(session, 'settings.residents_blocks')
  ) {
    return {
      error:
        'Akses ditolak: perubahan pengaturan aplikasi & WA pengurus hanya untuk Bendahara atau Pengurus terdelegasi.',
    };
  }

  const cleanName = config.app_name.trim();
  const cleanSubtitle = config.app_subtitle.trim();
  const cleanKop = config.kop_resmi.trim();
  const cleanWaPengurus = normalizeWaNumber(config.wa_pengurus || '');
  const cleanWaBot = config.wa_bot?.trim() ? normalizeWaNumber(config.wa_bot) : '';
  const { startMonth, startYear } = resolveBillingStartPeriod({
    billing_start_month: config.billing_start_month,
    billing_start_year: config.billing_start_year,
  });

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
    stempel_url: config.stempel_url?.trim() || null,
    wa_pengurus: cleanWaPengurus,
    wa_pengurus_label: config.wa_pengurus_label?.trim() || DEFAULT_APP_BRAND_CONFIG.wa_pengurus_label,
    wa_bot: cleanWaBot,
    pengurus_wa_map: sanitizePengurusWaMap(config.pengurus_wa_map),
    billing_start_month: startMonth,
    billing_start_year: startYear,
    updated_at: new Date().toISOString(),
    updated_by: session.blok_rumah,
  };

  writeLocalAppBrandConfig(updated);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      let { data, error } = await supabase
        .from('app_settings')
        .upsert(updated, { onConflict: 'id' })
        .select()
        .single();

      // Fallback bila sebagian kolom opsional (stempel_url / billing_start_month / billing_start_year) belum dijalankan di Supabase
      if (error) {
        const errMsg = String((error as { message?: string }).message || '');
        if (
          errMsg.includes('stempel_url') ||
          errMsg.includes('billing_start_month') ||
          errMsg.includes('billing_start_year')
        ) {
          const fallbackPayload: Record<string, unknown> = { ...updated };
          if (errMsg.includes('stempel_url')) delete fallbackPayload.stempel_url;
          if (errMsg.includes('billing_start_month')) delete fallbackPayload.billing_start_month;
          if (errMsg.includes('billing_start_year')) delete fallbackPayload.billing_start_year;
          const retry = await supabase
            .from('app_settings')
            .upsert(fallbackPayload, { onConflict: 'id' })
            .select()
            .single();
          if (
            retry.error &&
            String((retry.error as { message?: string }).message || '').includes('billing_start')
          ) {
            delete fallbackPayload.billing_start_month;
            delete fallbackPayload.billing_start_year;
            const retryLegacy = await supabase
              .from('app_settings')
              .upsert(fallbackPayload, { onConflict: 'id' })
              .select()
              .single();
            data = retryLegacy.data;
            error = retryLegacy.error;
          } else {
            data = retry.data;
            error = retry.error;
          }
        }
      }

      if (!error && data) {
        const persisted = mergeAppBrandConfig(updated, {
          ...(data as Partial<AppBrandConfig>),
          stempel_url: updated.stempel_url,
          billing_start_month: updated.billing_start_month,
          billing_start_year: updated.billing_start_year,
        });
        writeLocalAppBrandConfig(persisted);
        await recordAuditLog({
          session,
          action: 'UPDATE_APP_BRAND',
          entity: 'app_settings',
          entity_id: updated.id,
          summary: `${session.nama_warga} memperbarui identitas "${persisted.app_name}", mulai penagihan ${formatBillingStartLabel(persisted)} & WA Pengurus (+${persisted.wa_pengurus}).`,
        });
        void dispatchActivityNotifications(
          session,
          getBendaharaAndKetuaUserIds().map((uid) => ({
            user_id: uid,
            category: 'system' as const,
            title: 'Pengaturan Aplikasi & Periode Penagihan Diperbarui',
            message: `${session.nama_warga} memperbarui pengaturan "${persisted.app_name}" (mulai penagihan ${formatBillingStartLabel(persisted)}).`,
            target_url: 'settings:identitas',
          }))
        );
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
    summary: `Bendahara ${session.nama_warga} memperbarui pengaturan identitas "${updated.app_name}" & No. WA Pengurus (+${updated.wa_pengurus}).`,
  });
  void dispatchActivityNotifications(
    session,
    getBendaharaAndKetuaUserIds().map((uid) => ({
      user_id: uid,
      category: 'system' as const,
      title: 'Identitas & Logo Aplikasi Diperbarui',
      message: `${session.nama_warga} memperbarui pengaturan identitas "${updated.app_name}".`,
      target_url: 'settings:identitas',
    }))
  );

  return { data: updated };
}

// =========================================================================
// Sistem Keuangan Terintegrasi: Pengeluaran Anggaran & Pemasukan Lain
// =========================================================================

function readLocalTransaksiKas(): TransaksiKas[] {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.TRANSAKSI_KAS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TransaksiKas[];
    return Array.isArray(parsed)
      ? parsed.sort(
          (a, b) =>
            b.tanggal.localeCompare(a.tanggal) ||
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
      : [];
  } catch {
    return [];
  }
}

function writeLocalTransaksiKas(list: TransaksiKas[]) {
  safeStorageSet(STORAGE_KEYS.TRANSAKSI_KAS, JSON.stringify(list));
}

function normalizeTransaksiKasRow(row: Record<string, unknown>): TransaksiKas {
  const rawJenisHonor = row.jenis_honor;
  const jenisHonor: JenisHonorPetugas | null =
    rawJenisHonor === 'honor_rutin' || rawJenisHonor === 'lembur' ? rawJenisHonor : null;
  const id = String(row.id || `kas-${Date.now()}`);
  const hasExplicitStatus = typeof row.status_verifikasi === 'string' && row.status_verifikasi.trim().length > 0;
  let statusVerifikasi: StatusVerifikasi = hasExplicitStatus
    ? normalizeStatusVerifikasi(row.status_verifikasi)
    : 'Terverifikasi';
  let bendaharaApprovedAt =
    typeof row.bendahara_approved_at === 'string' ? row.bendahara_approved_at : null;
  let bendaharaApprovedBy =
    typeof row.bendahara_approved_by === 'string' ? row.bendahara_approved_by : null;
  let ketuaApprovedAt = typeof row.ketua_approved_at === 'string' ? row.ketua_approved_at : null;
  let ketuaApprovedBy = typeof row.ketua_approved_by === 'string' ? row.ketua_approved_by : null;
  let ketuaCatatan = typeof row.ketua_catatan === 'string' ? row.ketua_catatan : null;

  const overlay = readApprovalOverlay()[`kas::${id}`];
  if (overlay) {
    const dbAlreadyFinal =
      hasExplicitStatus &&
      (statusVerifikasi === 'Terverifikasi' || statusVerifikasi === 'Ditolak');
    const overlayStaleVsAcc =
      hasExplicitStatus &&
      statusVerifikasi === 'ACC Bendahara' &&
      (overlay.status_verifikasi === 'Pending' || overlay.status_verifikasi === 'ACC Bendahara');
    const overlayMatchesDb = hasExplicitStatus && statusVerifikasi === overlay.status_verifikasi;

    if (dbAlreadyFinal || overlayStaleVsAcc || overlayMatchesDb) {
      writeApprovalOverlayEntry(`kas::${id}`, null);
    } else {
      statusVerifikasi = overlay.status_verifikasi;
      if (overlay.bendahara_approved_at !== undefined) bendaharaApprovedAt = overlay.bendahara_approved_at;
      if (overlay.bendahara_approved_by !== undefined) bendaharaApprovedBy = overlay.bendahara_approved_by;
      if (overlay.ketua_approved_at !== undefined) ketuaApprovedAt = overlay.ketua_approved_at;
      if (overlay.ketua_approved_by !== undefined) ketuaApprovedBy = overlay.ketua_approved_by;
      if (overlay.ketua_catatan !== undefined) ketuaCatatan = overlay.ketua_catatan;
    }
  }

  const parsedKategori = String(row.kategori || 'Lain-lain');
  return {
    id,
    no_bukti: String(row.no_bukti || ''),
    jenis: row.jenis === 'pemasukan_lain' ? 'pemasukan_lain' : 'pengeluaran',
    kategori: parsedKategori,
    termin: typeof row.termin === 'string' && row.termin.trim() ? row.termin.trim() : null,
    tanggal: String(row.tanggal || new Date().toISOString().slice(0, 10)).slice(0, 10),
    nominal: Math.max(0, Number(row.nominal) || 0),
    penerima_atau_sumber: String(row.penerima_atau_sumber || '-'),
    keterangan: typeof row.keterangan === 'string' ? row.keterangan : null,
    bukti_url: typeof row.bukti_url === 'string' ? row.bukti_url : null,
    petugas_id: typeof row.petugas_id === 'string' && row.petugas_id.trim() ? row.petugas_id.trim() : null,
    jenis_honor: jenisHonor,
    shift_override_id:
      typeof row.shift_override_id === 'string' && row.shift_override_id.trim()
        ? row.shift_override_id.trim()
        : null,
    status_verifikasi: statusVerifikasi,
    bendahara_approved_at: bendaharaApprovedAt,
    bendahara_approved_by: bendaharaApprovedBy,
    ketua_approved_at: ketuaApprovedAt,
    ketua_approved_by: ketuaApprovedBy,
    ketua_catatan: ketuaCatatan,
    created_by: String(row.created_by || 'admin'),
    created_by_name: String(row.created_by_name || 'Pengurus'),
    created_at: String(row.created_at || new Date().toISOString()),
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
    fund_type: deriveKasFundType(parsedKategori, row.fund_type),
    holder_role: deriveKasHolderRole(row.holder_role),
  };
}

export async function fetchTransaksiKasList(session: SessionUser): Promise<TransaksiKas[]> {
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('transaksi_kas')
        .select('*')
        .order('tanggal', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1000);
      if (!error && Array.isArray(data)) {
        const list = (data as Record<string, unknown>[]).map(normalizeTransaksiKasRow);
        writeLocalTransaksiKas(list);
        return list;
      }
    } catch {
      // Fallback bersih jika tabel transaksi_kas belum dibuat di Supabase
    }
  }
  return readLocalTransaksiKas();
}

export async function uploadBuktiKasAdmin(
  session: SessionUser,
  file: File
): Promise<ServiceResult<string>> {
  if (session.role !== 'admin') {
    return { error: 'Akses ditolak: hanya Pengurus yang dapat mengunggah bukti kas.' };
  }

  const directDriveUrl = await tryDirectDriveUploadIfConnected({
    session,
    folderKey: 'pengeluaran_kas',
    file,
    labelPrefix: 'bukti-kas',
  });
  if (directDriveUrl) {
    return { data: directDriveUrl };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const filePath = `kas/bukti-kas-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('bukti-ipl')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (!uploadError) {
        const { data: publicUrlData } = supabase.storage.from('bukti-ipl').getPublicUrl(filePath);
        if (publicUrlData?.publicUrl) {
          return { data: publicUrlData.publicUrl };
        }
      }
    } catch {
      // Fallback data URL
    }
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    return { data: dataUrl };
  } catch (err) {
    return { error: parseFriendlyError(err, 'Gagal membaca file bukti nota/kwitansi.') };
  }
}

export async function createTransaksiKasAdmin(
  session: SessionUser,
  payload: {
    jenis: 'pengeluaran' | 'pemasukan_lain';
    kategori: string;
    termin?: string | null;
    tanggal: string;
    nominal: number;
    penerima_atau_sumber: string;
    keterangan?: string;
    buktiFile?: File | null;
    bukti_url?: string | null;
    petugas_id?: string | null;
    jenis_honor?: JenisHonorPetugas | null;
    shift_override_id?: string | null;
    autoVerify?: boolean;
    fund_type?: FundType;
    holder_role?: HolderRole;
  }
): Promise<ServiceResult<TransaksiKas>> {
  if (session.role !== 'admin') {
    return { error: 'Akses ditolak: pencatatan kas khusus Pengurus / Admin.' };
  }
  if (!payload.kategori.trim()) {
    return { error: 'Kategori transaksi wajib dipilih.' };
  }
  if (!payload.penerima_atau_sumber.trim()) {
    return {
      error:
        payload.jenis === 'pengeluaran'
          ? 'Nama penerima dana wajib diisi.'
          : 'Nama sumber / penyetor dana wajib diisi.',
    };
  }
  if (!Number.isFinite(payload.nominal) || payload.nominal <= 0) {
    return { error: 'Nominal transaksi harus lebih dari Rp 0.' };
  }

  let resolvedBuktiUrl = payload.bukti_url || null;
  if (payload.buktiFile) {
    const up = await uploadBuktiKasAdmin(session, payload.buktiFile);
    if (up.data) resolvedBuktiUrl = up.data;
  }

  const nowIso = new Date().toISOString();
  const cleanDate = (payload.tanggal || nowIso.slice(0, 10)).slice(0, 10);
  const noBukti = generateBuktiKasNumber(payload.jenis, cleanDate);
  const cleanPetugasId =
    payload.jenis === 'pengeluaran' && payload.petugas_id?.trim() ? payload.petugas_id.trim() : null;
  const cleanJenisHonor: JenisHonorPetugas | null =
    payload.jenis === 'pengeluaran' &&
    (payload.jenis_honor === 'honor_rutin' || payload.jenis_honor === 'lembur')
      ? payload.jenis_honor
      : null;
  const cleanShiftOverrideId =
    payload.jenis === 'pengeluaran' && payload.shift_override_id?.trim()
      ? payload.shift_override_id.trim()
      : null;
  const shouldAutoVerify = Boolean(payload.autoVerify);
  const approverLabel = `${session.nama_warga} (${session.jabatan || 'Pengurus'})`;
  const initialStatus: StatusVerifikasi = shouldAutoVerify ? 'Terverifikasi' : 'Pending';
  const resolvedFundType = deriveKasFundType(payload.kategori, payload.fund_type);
  const resolvedHolderRole = deriveKasHolderRole(payload.holder_role);

  const newEntry: TransaksiKas = {
    id: `kas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    no_bukti: noBukti,
    jenis: payload.jenis,
    kategori: payload.kategori.trim(),
    termin: payload.jenis === 'pengeluaran' ? payload.termin?.trim() || null : null,
    tanggal: cleanDate,
    nominal: Math.round(payload.nominal),
    penerima_atau_sumber: payload.penerima_atau_sumber.trim(),
    keterangan: payload.keterangan?.trim() || null,
    bukti_url: resolvedBuktiUrl,
    petugas_id: cleanPetugasId,
    jenis_honor: cleanJenisHonor,
    shift_override_id: cleanShiftOverrideId,
    status_verifikasi: initialStatus,
    bendahara_approved_at: shouldAutoVerify ? nowIso : null,
    bendahara_approved_by: shouldAutoVerify ? approverLabel : null,
    ketua_approved_at: shouldAutoVerify ? nowIso : null,
    ketua_approved_by: shouldAutoVerify ? approverLabel : null,
    ketua_catatan: null,
    created_by: session.blok_rumah,
    created_by_name: approverLabel,
    created_at: nowIso,
    updated_at: nowIso,
    fund_type: resolvedFundType,
    holder_role: resolvedHolderRole,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const uuidPetugasId =
        cleanPetugasId && !cleanPetugasId.startsWith('petugas-') ? cleanPetugasId : null;
      const uuidShiftOverrideId =
        cleanShiftOverrideId && !cleanShiftOverrideId.startsWith('shift-')
          ? cleanShiftOverrideId
          : null;

      const baseInsert = {
        no_bukti: newEntry.no_bukti,
        jenis: newEntry.jenis,
        kategori: newEntry.kategori,
        termin: newEntry.termin,
        tanggal: newEntry.tanggal,
        nominal: newEntry.nominal,
        penerima_atau_sumber: newEntry.penerima_atau_sumber,
        keterangan: newEntry.keterangan,
        bukti_url: newEntry.bukti_url,
        created_by: newEntry.created_by,
        created_by_name: newEntry.created_by_name,
        created_at: newEntry.created_at,
        updated_at: newEntry.updated_at,
      };
      const midInsert = {
        ...baseInsert,
        petugas_id: uuidPetugasId,
        jenis_honor: cleanJenisHonor,
        status_verifikasi: initialStatus,
        bendahara_approved_at: newEntry.bendahara_approved_at,
        bendahara_approved_by: newEntry.bendahara_approved_by,
        ketua_approved_at: newEntry.ketua_approved_at,
        ketua_approved_by: newEntry.ketua_approved_by,
      };
      const fullInsert = {
        ...midInsert,
        shift_override_id: uuidShiftOverrideId,
        fund_type: resolvedFundType,
        holder_role: resolvedHolderRole,
      };

      let usedBaseKasFallback = false;
      let { data, error } = await supabase
        .from('transaksi_kas')
        .insert(fullInsert)
        .select()
        .single();

      const firstErrMsg = String((error as { message?: string })?.message || '').toLowerCase();
      if (
        error &&
        (firstErrMsg.includes('shift_override_id') ||
          firstErrMsg.includes('petugas_id') ||
          firstErrMsg.includes('jenis_honor') ||
          firstErrMsg.includes('status_verifikasi') ||
          firstErrMsg.includes('fund_type') ||
          firstErrMsg.includes('holder_role') ||
          firstErrMsg.includes('column'))
      ) {
        const retryMid = await supabase
          .from('transaksi_kas')
          .insert(midInsert)
          .select()
          .single();
        if (!retryMid.error && retryMid.data) {
          data = retryMid.data;
          error = null;
        } else {
          usedBaseKasFallback = true;
          const retry = await supabase
            .from('transaksi_kas')
            .insert(baseInsert)
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (!error && data) {
        const rawId = String((data as Record<string, unknown>).id || newEntry.id);
        if (usedBaseKasFallback) {
          writeApprovalOverlayEntry(`kas::${rawId}`, {
            status_verifikasi: initialStatus,
            bendahara_approved_at: newEntry.bendahara_approved_at,
            bendahara_approved_by: newEntry.bendahara_approved_by,
            ketua_approved_at: newEntry.ketua_approved_at,
            ketua_approved_by: newEntry.ketua_approved_by,
            ketua_catatan: null,
          });
        } else {
          writeApprovalOverlayEntry(`kas::${rawId}`, null);
        }
        const persistedRaw = normalizeTransaksiKasRow(data as Record<string, unknown>);
        const persisted: TransaksiKas = {
          ...persistedRaw,
          shift_override_id: persistedRaw.shift_override_id || cleanShiftOverrideId,
          jenis_honor: persistedRaw.jenis_honor || cleanJenisHonor,
          status_verifikasi: shouldAutoVerify ? 'Terverifikasi' : persistedRaw.status_verifikasi,
        };
        const current = readLocalTransaksiKas().filter((k) => k.id !== persisted.id);
        writeLocalTransaksiKas([persisted, ...current]);
        await recordAuditLog({
          session,
          action: payload.jenis === 'pengeluaran' ? 'CREATE_PENGELUARAN' : 'CREATE_PEMASUKAN_LAIN',
          entity: 'transaksi_kas',
          entity_id: persisted.id,
          summary: `${session.nama_warga} mencatat ${payload.jenis === 'pengeluaran' ? 'pengeluaran' : 'pemasukan lain'} ${formatRupiah(persisted.nominal)} (${persisted.kategori} — ${persisted.penerima_atau_sumber}) [${shouldAutoVerify ? 'Terverifikasi & Sinkron Shift/Lembur' : 'Menunggu Verifikasi Bendahara'}].`,
        });
        const honorPeriode = persisted.termin || persisted.kategori || formatTanggal(persisted.tanggal);
        const honorTitle = 'Honor Keamanan Diterima';
        const honorBody = `Halo ${persisted.penerima_atau_sumber}, honor keamanan periode ${honorPeriode} sebesar ${formatRupiah(persisted.nominal)} telah dibayarkan oleh pengurus.`;
        const adminKasTitle =
          payload.jenis === 'pengeluaran'
            ? `Pengeluaran Kas: ${persisted.kategori}`
            : `Pemasukan Non-IPL: ${persisted.kategori}`;
        const adminKasBody = `${session.nama_warga} mencatat ${formatRupiah(persisted.nominal)} (${persisted.penerima_atau_sumber}).`;
        const kasCreateAdminDedup = `kas:${persisted.id}:created:admin`;
        const kasCreatePetugasDedup = `kas:${persisted.id}:created:petugas`;
        const kasNotifs = [
          ...getBendaharaAndKetuaUserIds().map((uid) => ({
            user_id: uid,
            category: 'finance' as const,
            title: adminKasTitle,
            message: adminKasBody,
            target_url: 'tab:keuangan',
            dedup_key: kasCreateAdminDedup,
          })),
          ...(persisted.petugas_id
            ? [
                {
                  user_id: buildPetugasUserId(persisted.petugas_id),
                  category: 'finance' as const,
                  title: honorTitle,
                  message: honorBody,
                  target_url: 'tab:honor',
                  dedup_key: kasCreatePetugasDedup,
                },
              ]
            : []),
        ];
        void dispatchActivityNotifications(session, kasNotifs, [
          {
            target_roles: ['admin'],
            category: 'finance',
            title: adminKasTitle,
            body: adminKasBody,
            target_url: 'tab:keuangan',
            dedup_key: kasCreateAdminDedup,
          },
          ...(persisted.petugas_id
            ? [
                {
                  target_user_ids: [
                    buildKeamananUserId(persisted.petugas_id),
                    buildPetugasUserId(persisted.petugas_id),
                  ],
                  category: 'finance' as const,
                  title: honorTitle,
                  body: honorBody,
                  target_url: 'tab:honor',
                  dedup_key: kasCreatePetugasDedup,
                },
              ]
            : []),
        ]);
        return { data: persisted };
      }

      const errCode = String((error as { code?: string })?.code || '');
      const errMsg = String((error as { message?: string })?.message || '');
      if (errCode !== '42P01' && !errMsg.includes('transaksi_kas')) {
        return {
          error: parseFriendlyError(error, 'Gagal menyimpan transaksi kas ke Supabase.'),
        };
      }
    } catch {
      // Lanjut fallback lokal jika tabel belum dijalankan
    }
  }

  writeLocalTransaksiKas([newEntry, ...readLocalTransaksiKas()]);
  writeApprovalOverlayEntry(`kas::${newEntry.id}`, {
    status_verifikasi: initialStatus,
    bendahara_approved_at: newEntry.bendahara_approved_at,
    bendahara_approved_by: newEntry.bendahara_approved_by,
    ketua_approved_at: newEntry.ketua_approved_at,
    ketua_approved_by: newEntry.ketua_approved_by,
  });
  await recordAuditLog({
    session,
    action: payload.jenis === 'pengeluaran' ? 'CREATE_PENGELUARAN' : 'CREATE_PEMASUKAN_LAIN',
    entity: 'transaksi_kas',
    entity_id: newEntry.id,
    summary: `${session.nama_warga} mencatat ${payload.jenis === 'pengeluaran' ? 'pengeluaran' : 'pemasukan lain'} ${formatRupiah(newEntry.nominal)} (${newEntry.kategori} — ${newEntry.penerima_atau_sumber}) [${shouldAutoVerify ? 'Terverifikasi & Sinkron Shift/Lembur' : 'Menunggu Verifikasi Bendahara'}].`,
  });
  const honorPeriodeLocal = newEntry.termin || newEntry.kategori || formatTanggal(newEntry.tanggal);
  const honorTitleLocal = 'Honor Keamanan Diterima';
  const honorBodyLocal = `Halo ${newEntry.penerima_atau_sumber}, honor keamanan periode ${honorPeriodeLocal} sebesar ${formatRupiah(newEntry.nominal)} telah dibayarkan oleh pengurus.`;
  const adminKasTitleLocal =
    payload.jenis === 'pengeluaran'
      ? `Pengeluaran Kas: ${newEntry.kategori}`
      : `Pemasukan Non-IPL: ${newEntry.kategori}`;
  const adminKasBodyLocal = `${session.nama_warga} mencatat ${formatRupiah(newEntry.nominal)} (${newEntry.penerima_atau_sumber}).`;
  const kasCreateAdminLocalDedup = `kas:${newEntry.id}:created:admin`;
  const kasCreatePetugasLocalDedup = `kas:${newEntry.id}:created:petugas`;
  void dispatchActivityNotifications(
    session,
    [
      ...getBendaharaAndKetuaUserIds().map((uid) => ({
        user_id: uid,
        category: 'finance' as const,
        title: adminKasTitleLocal,
        message: adminKasBodyLocal,
        target_url: 'tab:keuangan',
        dedup_key: kasCreateAdminLocalDedup,
      })),
      ...(newEntry.petugas_id
        ? [
            {
              user_id: buildPetugasUserId(newEntry.petugas_id),
              category: 'finance' as const,
              title: honorTitleLocal,
              message: honorBodyLocal,
              target_url: 'tab:honor',
              dedup_key: kasCreatePetugasLocalDedup,
            },
          ]
        : []),
    ],
    [
      {
        target_roles: ['admin'],
        category: 'finance',
        title: adminKasTitleLocal,
        body: adminKasBodyLocal,
        target_url: 'tab:keuangan',
        dedup_key: kasCreateAdminLocalDedup,
      },
      ...(newEntry.petugas_id
        ? [
            {
              target_user_ids: [
                buildKeamananUserId(newEntry.petugas_id),
                buildPetugasUserId(newEntry.petugas_id),
              ],
              category: 'finance' as const,
              title: honorTitleLocal,
              body: honorBodyLocal,
              target_url: 'tab:honor',
              dedup_key: kasCreatePetugasLocalDedup,
            },
          ]
        : []),
    ]
  );
  return { data: newEntry };
}

/**
 * Verifikasi Tahap 1 Transaksi Kas (Bendahara — Andriansyah)
 */
export async function verifyTransaksiKasBendaharaAdmin(
  session: SessionUser,
  kas: TransaksiKas,
  decision: 'ACC Bendahara' | 'Ditolak',
  catatan?: string
): Promise<ServiceResult<TransaksiKas>> {
  if (!isBendaharaOnly(session)) {
    return { error: 'Akses ditolak: verifikasi Tahap 1 transaksi kas khusus Bendahara.' };
  }
  if (decision === 'Ditolak' && !catatan?.trim()) {
    return { error: 'Alasan penolakan transaksi kas wajib diisi.' };
  }

  const nowIso = new Date().toISOString();
  const approverName = session.nama_warga || 'Andriansyah';
  const nextStatus: StatusVerifikasi = decision;

  const overlayEntry: ApprovalOverlayEntry = {
    status_verifikasi: nextStatus,
    bendahara_approved_at: decision === 'ACC Bendahara' ? nowIso : null,
    bendahara_approved_by: decision === 'ACC Bendahara' ? approverName : null,
    ketua_approved_at: null,
    ketua_approved_by: null,
    ketua_catatan: decision === 'Ditolak' ? catatan?.trim() || null : null,
  };
  const supabase = getSupabaseClient(session);
  let persistedInDb = false;
  if (supabase && isSupabaseConfigured() && !kas.id.startsWith('kas-')) {
    try {
      const { error } = await supabase
        .from('transaksi_kas')
        .update({
          status_verifikasi: nextStatus,
          bendahara_approved_at: overlayEntry.bendahara_approved_at,
          bendahara_approved_by: overlayEntry.bendahara_approved_by,
          ketua_catatan: overlayEntry.ketua_catatan,
          updated_at: nowIso,
        })
        .eq('id', kas.id);
      if (!error) persistedInDb = true;
    } catch {
      // Tetap sinkron via overlay jika kolom migrasi v3 belum dijalankan
    }
  }
  writeApprovalOverlayEntry(`kas::${kas.id}`, persistedInDb ? null : overlayEntry);

  const updated: TransaksiKas = {
    ...kas,
    status_verifikasi: nextStatus,
    bendahara_approved_at: overlayEntry.bendahara_approved_at,
    bendahara_approved_by: overlayEntry.bendahara_approved_by,
    ketua_approved_at: null,
    ketua_approved_by: null,
    ketua_catatan: overlayEntry.ketua_catatan,
    updated_at: nowIso,
  };
  writeLocalTransaksiKas(
    readLocalTransaksiKas().map((item) => (item.id === kas.id ? updated : item))
  );

  await recordAuditLog({
    session,
    action: decision === 'ACC Bendahara' ? 'ACC_BENDAHARA_KAS' : 'REJECT_KAS',
    entity: 'transaksi_kas',
    entity_id: kas.id,
    summary: `Bendahara ${approverName} ${
      decision === 'ACC Bendahara' ? 'memberikan ACC Tahap 1 (diteruskan ke Ketua)' : 'menolak'
    } kas ${kas.no_bukti} (${formatRupiah(kas.nominal)}).`,
  });

  const kasBenDedup = `kas:${kas.id}:bendahara:${decision}`;
  void dispatchActivityNotifications(
    session,
    getKetuaUserIds().map((uid) => ({
      user_id: uid,
      category: 'finance' as const,
      title:
        decision === 'ACC Bendahara'
          ? `Kas Menunggu Pengesahan Ketua (${kas.no_bukti})`
          : `Transaksi Kas Ditolak (${kas.no_bukti})`,
      message: `Bendahara ${approverName} ${decision === 'ACC Bendahara' ? 'memberikan ACC Tahap 1' : 'menolak'} transaksi ${kas.kategori} sebesar ${formatRupiah(kas.nominal)}.`,
      target_url: 'tab:keuangan',
      dedup_key: kasBenDedup,
    }))
  );

  return { data: updated };
}

/**
 * Verifikasi Tahap 2 Transaksi Kas (Ketua — Erlangga)
 */
export async function verifyTransaksiKasKetuaAdmin(
  session: SessionUser,
  kas: TransaksiKas,
  decision: 'Terverifikasi' | 'Kembalikan',
  catatanKetua?: string
): Promise<ServiceResult<TransaksiKas>> {
  if (!isKetuaRole(session)) {
    return {
      error: 'Akses ditolak: pengesahan final (Tahap 2) transaksi kas khusus Ketua Lingkungan.',
    };
  }
  if (decision === 'Kembalikan' && !catatanKetua?.trim()) {
    return { error: 'Alasan pengembalian transaksi kas ke Bendahara wajib diisi.' };
  }

  const nowIso = new Date().toISOString();
  const ketuaName = session.nama_warga || 'Erlangga';
  const nextStatus: StatusVerifikasi = decision === 'Terverifikasi' ? 'Terverifikasi' : 'Pending';
  const cleanNote =
    catatanKetua?.trim() ||
    (decision === 'Terverifikasi'
      ? `Disahkan final oleh Ketua (${ketuaName}).`
      : 'Dikembalikan ke Bendahara.');

  const overlayEntry: ApprovalOverlayEntry = {
    status_verifikasi: nextStatus,
    bendahara_approved_at:
      decision === 'Terverifikasi' ? kas.bendahara_approved_at || nowIso : null,
    bendahara_approved_by:
      decision === 'Terverifikasi' ? kas.bendahara_approved_by || 'Andriansyah' : null,
    ketua_approved_at: decision === 'Terverifikasi' ? nowIso : null,
    ketua_approved_by: decision === 'Terverifikasi' ? ketuaName : null,
    ketua_catatan: cleanNote,
  };
  const supabase = getSupabaseClient(session);
  let persistedInDb = false;
  if (supabase && isSupabaseConfigured() && !kas.id.startsWith('kas-')) {
    try {
      const { error } = await supabase
        .from('transaksi_kas')
        .update({
          status_verifikasi: nextStatus,
          bendahara_approved_at: overlayEntry.bendahara_approved_at,
          bendahara_approved_by: overlayEntry.bendahara_approved_by,
          ketua_approved_at: overlayEntry.ketua_approved_at,
          ketua_approved_by: overlayEntry.ketua_approved_by,
          ketua_catatan: cleanNote,
          updated_at: nowIso,
        })
        .eq('id', kas.id);
      if (!error) persistedInDb = true;
    } catch {
      // Tetap sinkron via overlay jika kolom migrasi v3 belum dijalankan
    }
  }
  writeApprovalOverlayEntry(`kas::${kas.id}`, persistedInDb ? null : overlayEntry);

  const updated: TransaksiKas = {
    ...kas,
    status_verifikasi: nextStatus,
    bendahara_approved_at: overlayEntry.bendahara_approved_at,
    bendahara_approved_by: overlayEntry.bendahara_approved_by,
    ketua_approved_at: overlayEntry.ketua_approved_at,
    ketua_approved_by: overlayEntry.ketua_approved_by,
    ketua_catatan: cleanNote,
    updated_at: nowIso,
  };
  writeLocalTransaksiKas(
    readLocalTransaksiKas().map((item) => (item.id === kas.id ? updated : item))
  );

  await recordAuditLog({
    session,
    action: decision === 'Terverifikasi' ? 'KETUA_FINAL_APPROVE_KAS' : 'KETUA_RETURN_KAS',
    entity: 'transaksi_kas',
    entity_id: kas.id,
    summary: `Ketua ${ketuaName} ${
      decision === 'Terverifikasi' ? 'mensahkan final' : 'mengembalikan ke Bendahara'
    } kas ${kas.no_bukti} (${formatRupiah(kas.nominal)}).`,
  });

  const kasPeriode = kas.termin || kas.kategori || formatTanggal(kas.tanggal);
  const kasHonorTitle = 'Honor Keamanan Diterima';
  const kasHonorBody = `Halo ${kas.penerima_atau_sumber}, honor keamanan periode ${kasPeriode} sebesar ${formatRupiah(kas.nominal)} telah dibayarkan oleh pengurus.`;
  const kasBendaharaTitle =
    decision === 'Terverifikasi'
      ? `Ketua Mengesahkan Kas ${kas.no_bukti}`
      : `Ketua Mengembalikan Kas ${kas.no_bukti}`;
  const kasBendaharaBody = `${ketuaName} ${decision === 'Terverifikasi' ? 'mensahkan final' : 'mengembalikan'} ${kas.kategori} sebesar ${formatRupiah(kas.nominal)}.`;

  const kasKetuaBenDedup = `kas:${kas.id}:ketua:${decision}:bendahara`;
  const kasKetuaPetugasDedup = `kas:${kas.id}:ketua:${decision}:petugas`;
  void dispatchActivityNotifications(
    session,
    [
      ...getBendaharaUserIds().map((uid) => ({
        user_id: uid,
        category: 'finance' as const,
        title: kasBendaharaTitle,
        message: kasBendaharaBody,
        target_url: 'tab:keuangan',
        dedup_key: kasKetuaBenDedup,
      })),
      ...(decision === 'Terverifikasi' && kas.petugas_id
        ? [
            {
              user_id: buildPetugasUserId(kas.petugas_id),
              category: 'finance' as const,
              title: kasHonorTitle,
              message: kasHonorBody,
              target_url: 'tab:honor',
              dedup_key: kasKetuaPetugasDedup,
            },
          ]
        : []),
    ],
    [
      {
        target_user_ids: getBendaharaUserIds(),
        category: 'finance',
        title: kasBendaharaTitle,
        body: kasBendaharaBody,
        target_url: 'tab:keuangan',
        dedup_key: kasKetuaBenDedup,
      },
      ...(decision === 'Terverifikasi' && kas.petugas_id
        ? [
            {
              target_user_ids: [
                buildKeamananUserId(kas.petugas_id),
                buildPetugasUserId(kas.petugas_id),
              ],
              category: 'finance' as const,
              title: kasHonorTitle,
              body: kasHonorBody,
              target_url: 'tab:honor',
              dedup_key: kasKetuaPetugasDedup,
            },
          ]
        : []),
    ]
  );

  return { data: updated };
}

export async function updateTransaksiKasAdmin(
  session: SessionUser,
  id: string,
  payload: {
    kategori: string;
    termin?: string | null;
    tanggal: string;
    nominal: number;
    penerima_atau_sumber: string;
    keterangan?: string;
    buktiFile?: File | null;
    bukti_url?: string | null;
    petugas_id?: string | null;
    jenis_honor?: JenisHonorPetugas | null;
    fund_type?: FundType;
    holder_role?: HolderRole;
  }
): Promise<ServiceResult<TransaksiKas>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: perubahan transaksi kas khusus Bendahara.' };
  }
  if (!Number.isFinite(payload.nominal) || payload.nominal <= 0) {
    return { error: 'Nominal transaksi harus lebih dari Rp 0.' };
  }

  let resolvedBuktiUrl = payload.bukti_url ?? null;
  if (payload.buktiFile) {
    const up = await uploadBuktiKasAdmin(session, payload.buktiFile);
    if (up.data) resolvedBuktiUrl = up.data;
  }

  const nowIso = new Date().toISOString();
  const cleanPetugasId = payload.petugas_id?.trim() || null;
  const cleanJenisHonor: JenisHonorPetugas | null =
    cleanPetugasId && (payload.jenis_honor === 'honor_rutin' || payload.jenis_honor === 'lembur')
      ? payload.jenis_honor
      : null;
  const resolvedFundType = deriveKasFundType(payload.kategori, payload.fund_type);
  const resolvedHolderRole = deriveKasHolderRole(payload.holder_role);

  const basePatch = {
    kategori: payload.kategori.trim(),
    termin: payload.termin?.trim() || null,
    tanggal: payload.tanggal.slice(0, 10),
    nominal: Math.round(payload.nominal),
    penerima_atau_sumber: payload.penerima_atau_sumber.trim(),
    keterangan: payload.keterangan?.trim() || null,
    bukti_url: resolvedBuktiUrl,
    updated_at: nowIso,
  };

  const midPatch = {
    ...basePatch,
    petugas_id: cleanPetugasId && !cleanPetugasId.startsWith('petugas-') ? cleanPetugasId : null,
    jenis_honor: cleanJenisHonor,
  };

  const fullPatch = {
    ...midPatch,
    fund_type: resolvedFundType,
    holder_role: resolvedHolderRole,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !id.startsWith('kas-')) {
    try {
      let { data, error } = await supabase
        .from('transaksi_kas')
        .update(fullPatch)
        .eq('id', id)
        .select()
        .single();

      const firstErrMsg = String((error as { message?: string })?.message || '').toLowerCase();
      if (
        error &&
        (firstErrMsg.includes('petugas_id') ||
          firstErrMsg.includes('jenis_honor') ||
          firstErrMsg.includes('fund_type') ||
          firstErrMsg.includes('holder_role') ||
          firstErrMsg.includes('column'))
      ) {
        const retryMid = await supabase
          .from('transaksi_kas')
          .update(midPatch)
          .eq('id', id)
          .select()
          .single();
        if (!retryMid.error && retryMid.data) {
          data = retryMid.data;
          error = null;
        } else {
          const retry = await supabase
            .from('transaksi_kas')
            .update(basePatch)
            .eq('id', id)
            .select()
            .single();
          data = retry.data;
          error = retry.error;
        }
      }

      if (!error && data) {
        const updated = normalizeTransaksiKasRow(data as Record<string, unknown>);
        const next = readLocalTransaksiKas().map((item) => (item.id === id ? updated : item));
        writeLocalTransaksiKas(next);
        await recordAuditLog({
          session,
          action: 'UPDATE_TRANSAKSI_KAS',
          entity: 'transaksi_kas',
          entity_id: id,
          summary: `Bendahara ${session.nama_warga} memperbarui transaksi kas ${updated.no_bukti} menjadi ${formatRupiah(updated.nominal)}.`,
        });
        return { data: updated };
      }
      if (error) {
        return { error: parseFriendlyError(error, 'Gagal memperbarui transaksi kas di Supabase.') };
      }
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal memperbarui transaksi kas.') };
    }
  }

  const list = readLocalTransaksiKas();
  const existing = list.find((item) => item.id === id);
  if (!existing) {
    return { error: 'Data transaksi kas tidak ditemukan.' };
  }
  const updated: TransaksiKas = {
    ...existing,
    ...basePatch,
    petugas_id: cleanPetugasId,
    jenis_honor: cleanJenisHonor,
    fund_type: resolvedFundType,
    holder_role: resolvedHolderRole,
  };
  writeLocalTransaksiKas(list.map((item) => (item.id === id ? updated : item)));
  await recordAuditLog({
    session,
    action: 'UPDATE_TRANSAKSI_KAS',
    entity: 'transaksi_kas',
    entity_id: id,
    summary: `Bendahara ${session.nama_warga} memperbarui transaksi kas ${updated.no_bukti} menjadi ${formatRupiah(updated.nominal)}.`,
  });
  return { data: updated };
}

export async function deleteTransaksiKasAdmin(
  session: SessionUser,
  trxKas: TransaksiKas
): Promise<ServiceResult<boolean>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: penghapusan transaksi kas khusus Bendahara.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !trxKas.id.startsWith('kas-')) {
    try {
      const { error } = await supabase.from('transaksi_kas').delete().eq('id', trxKas.id);
      if (error && String((error as { code?: string }).code || '') !== '42P01') {
        return { error: parseFriendlyError(error, 'Gagal menghapus transaksi kas di Supabase.') };
      }
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menghapus transaksi kas.') };
    }
  }

  writeApprovalOverlayEntry(`kas::${trxKas.id}`, null);
  writeLocalTransaksiKas(readLocalTransaksiKas().filter((item) => item.id !== trxKas.id));
  await recordAuditLog({
    session,
    action: 'DELETE_TRANSAKSI_KAS',
    entity: 'transaksi_kas',
    entity_id: trxKas.id,
    summary: `Bendahara ${session.nama_warga} menghapus transaksi kas ${trxKas.no_bukti} (${formatRupiah(trxKas.nominal)}).`,
  });
  return { data: true };
}

/**
 * Pencatatan otomatis Pengeluaran Kas untuk Pembayaran Lembur Minggu Petugas Keamanan.
 * Langsung berstatus Terverifikasi agar Saldo Kas utama, Rekap Bulanan, dan LPJ
 * langsung terpotong secara real-time, lengkap dengan referensi shift_override_id.
 */
export async function createVerifiedOvertimeCashExpenseAdmin(
  session: SessionUser,
  payload: {
    shift_override_id: string;
    officer_name: string;
    petugas_id?: string | null;
    tanggal: string; // YYYY-MM-DD (tanggal pembayaran)
    nominal: number;
    keterangan: string;
  }
): Promise<ServiceResult<TransaksiKas>> {
  if (session.role !== 'admin') {
    return { error: 'Akses ditolak: pembayaran lembur ke Buku Kas hanya untuk Admin.' };
  }
  const cleanNominal = Math.round(Number(payload.nominal) || 0);
  if (!Number.isFinite(cleanNominal) || cleanNominal <= 0 || cleanNominal > 50_000_000) {
    return { error: 'Nominal lembur harus berupa angka positif yang valid.' };
  }

  const nowIso = new Date().toISOString();
  const cleanDate = (payload.tanggal || nowIso.slice(0, 10)).slice(0, 10);
  const noBukti = generateBuktiKasNumber('pengeluaran', cleanDate);
  const cleanOfficer = payload.officer_name.trim();
  const cleanPetugasId = payload.petugas_id?.trim() || null;
  const cleanShiftOverrideId = payload.shift_override_id.trim();

  // Validasi anti-double-entry pada cache lokal terlebih dahulu
  const existingLocal = readLocalTransaksiKas().find(
    (k) => k.shift_override_id && k.shift_override_id === cleanShiftOverrideId
  );
  if (existingLocal) {
    return { error: 'Lembur ini sudah pernah dicatat ke Buku Kas (anti-ganda).' };
  }

  const localEntry: TransaksiKas = {
    id: `kas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    no_bukti: noBukti,
    jenis: 'pengeluaran',
    kategori: 'Honor & Lembur Keamanan',
    termin: 'Insidental',
    tanggal: cleanDate,
    nominal: cleanNominal,
    penerima_atau_sumber: cleanOfficer,
    keterangan: payload.keterangan.trim(),
    bukti_url: null,
    petugas_id: cleanPetugasId,
    jenis_honor: 'lembur',
    shift_override_id: cleanShiftOverrideId,
    status_verifikasi: 'Terverifikasi',
    bendahara_approved_at: nowIso,
    bendahara_approved_by: session.nama_warga,
    ketua_approved_at: nowIso,
    ketua_approved_by: `${session.nama_warga} (${session.jabatan || 'Admin'})`,
    ketua_catatan: 'Pembayaran otomatis Lembur Minggu dari Kelola Shift & Lembur.',
    created_by: session.blok_rumah,
    created_by_name: `${session.nama_warga} (${session.jabatan || 'Pengurus'})`,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const uuidPetugasId =
        cleanPetugasId && !cleanPetugasId.startsWith('petugas-') ? cleanPetugasId : null;
      const uuidShiftOverrideId =
        cleanShiftOverrideId && !cleanShiftOverrideId.startsWith('shift-')
          ? cleanShiftOverrideId
          : null;

      const baseInsert = {
        no_bukti: localEntry.no_bukti,
        jenis: localEntry.jenis,
        kategori: localEntry.kategori,
        termin: localEntry.termin,
        tanggal: localEntry.tanggal,
        nominal: localEntry.nominal,
        penerima_atau_sumber: localEntry.penerima_atau_sumber,
        keterangan: localEntry.keterangan,
        bukti_url: null,
        created_by: localEntry.created_by,
        created_by_name: localEntry.created_by_name,
        created_at: localEntry.created_at,
        updated_at: localEntry.updated_at,
      };

      const fullInsert = {
        ...baseInsert,
        petugas_id: uuidPetugasId,
        jenis_honor: 'lembur',
        shift_override_id: uuidShiftOverrideId,
        status_verifikasi: 'Terverifikasi',
        bendahara_approved_at: nowIso,
        bendahara_approved_by: session.nama_warga,
        ketua_approved_at: nowIso,
        ketua_approved_by: `${session.nama_warga} (${session.jabatan || 'Admin'})`,
        ketua_catatan: localEntry.ketua_catatan,
      };

      let { data, error } = await supabase
        .from('transaksi_kas')
        .insert(fullInsert)
        .select()
        .single();

      // Tangkap error unique constraint anti-ganda secara eksplisit
      if (error && String((error as { code?: string }).code || '') === '23505') {
        return { error: 'Transaksi kas untuk jadwal lembur ini sudah tercatat (anti-ganda).' };
      }

      const firstErrMsg = String((error as { message?: string })?.message || '').toLowerCase();
      if (
        error &&
        (firstErrMsg.includes('shift_override_id') ||
          firstErrMsg.includes('petugas_id') ||
          firstErrMsg.includes('jenis_honor') ||
          firstErrMsg.includes('status_verifikasi') ||
          firstErrMsg.includes('column'))
      ) {
        const retryWithoutOptional = await supabase
          .from('transaksi_kas')
          .insert({
            ...baseInsert,
            petugas_id: uuidPetugasId,
            jenis_honor: 'lembur',
          })
          .select()
          .single();

        if (!retryWithoutOptional.error && retryWithoutOptional.data) {
          data = retryWithoutOptional.data;
          error = null;
        } else {
          const retryBase = await supabase
            .from('transaksi_kas')
            .insert(baseInsert)
            .select()
            .single();
          data = retryBase.data;
          error = retryBase.error;
        }
      }

      if (!error && data) {
        const rawId = String((data as Record<string, unknown>).id || localEntry.id);
        writeApprovalOverlayEntry(`kas::${rawId}`, {
          status_verifikasi: 'Terverifikasi',
          bendahara_approved_at: nowIso,
          bendahara_approved_by: session.nama_warga,
          ketua_approved_at: nowIso,
          ketua_approved_by: `${session.nama_warga} (${session.jabatan || 'Admin'})`,
          ketua_catatan: localEntry.ketua_catatan || null,
        });
        const persisted: TransaksiKas = {
          ...normalizeTransaksiKasRow(data as Record<string, unknown>),
          petugas_id: cleanPetugasId || normalizeTransaksiKasRow(data as Record<string, unknown>).petugas_id,
          jenis_honor: 'lembur',
          shift_override_id: cleanShiftOverrideId,
          status_verifikasi: 'Terverifikasi',
        };
        const current = readLocalTransaksiKas().filter((k) => k.id !== persisted.id);
        writeLocalTransaksiKas([persisted, ...current]);
        await recordAuditLog({
          session,
          action: 'PAY_OVERTIME_TO_KAS',
          entity: 'transaksi_kas',
          entity_id: persisted.id,
          summary: `${session.nama_warga} membayarkan Lembur Minggu ${cleanOfficer} sebesar ${formatRupiah(persisted.nominal)} (${persisted.no_bukti}).`,
        });
        const lemburPeriode = persisted.termin || `Lembur ${formatTanggal(persisted.tanggal)}`;
        const lemburHonorTitle = 'Honor Keamanan Diterima';
        const lemburHonorBody = `Halo ${cleanOfficer}, honor keamanan periode ${lemburPeriode} sebesar ${formatRupiah(persisted.nominal)} telah dibayarkan oleh pengurus.`;
        const lemburAdminTitle = `Lembur Dibayarkan — ${cleanOfficer}`;
        const lemburAdminBody = `${session.nama_warga} membayarkan lembur sebesar ${formatRupiah(persisted.nominal)} (${persisted.no_bukti}).`;
        const lemburOfficerTargetIds = cleanPetugasId
          ? [buildKeamananUserId(cleanPetugasId), buildPetugasUserId(cleanPetugasId)]
          : [buildKeamananUserId(cleanOfficer), buildPetugasUserId(cleanOfficer)];

        const lemburAdminDedup = `kas-overtime:${persisted.id}:admin`;
        const lemburPetugasDedup = `kas-overtime:${persisted.id}:petugas`;
        void dispatchActivityNotifications(
          session,
          [
            ...getBendaharaAndKetuaUserIds().map((uid) => ({
              user_id: uid,
              category: 'finance' as const,
              title: lemburAdminTitle,
              message: lemburAdminBody,
              target_url: 'tab:keuangan',
              dedup_key: lemburAdminDedup,
            })),
            {
              user_id: buildPetugasUserId(cleanPetugasId || cleanOfficer),
              category: 'finance' as const,
              title: lemburHonorTitle,
              message: lemburHonorBody,
              target_url: 'tab:honor',
              dedup_key: lemburPetugasDedup,
            },
          ],
          [
            {
              target_roles: ['admin'],
              category: 'finance',
              title: lemburAdminTitle,
              body: lemburAdminBody,
              target_url: 'tab:keuangan',
              dedup_key: lemburAdminDedup,
            },
            {
              target_user_ids: lemburOfficerTargetIds,
              category: 'finance',
              title: lemburHonorTitle,
              body: lemburHonorBody,
              target_url: 'tab:honor',
              dedup_key: lemburPetugasDedup,
            },
          ]
        );
        return { data: persisted };
      }
    } catch {
      // Lanjut fallback lokal bila offline/tabel belum migrasi
    }
  }

  writeApprovalOverlayEntry(`kas::${localEntry.id}`, {
    status_verifikasi: 'Terverifikasi',
    bendahara_approved_at: nowIso,
    bendahara_approved_by: session.nama_warga,
    ketua_approved_at: nowIso,
    ketua_approved_by: `${session.nama_warga} (${session.jabatan || 'Admin'})`,
    ketua_catatan: localEntry.ketua_catatan || null,
  });
  writeLocalTransaksiKas([localEntry, ...readLocalTransaksiKas()]);
  await recordAuditLog({
    session,
    action: 'PAY_OVERTIME_TO_KAS',
    entity: 'transaksi_kas',
    entity_id: localEntry.id,
    summary: `${session.nama_warga} membayarkan Lembur Minggu ${cleanOfficer} sebesar ${formatRupiah(localEntry.nominal)} (${localEntry.no_bukti}).`,
  });
  const lemburPeriodeLocal = localEntry.termin || `Lembur ${formatTanggal(localEntry.tanggal)}`;
  const lemburHonorTitleLocal = 'Honor Keamanan Diterima';
  const lemburHonorBodyLocal = `Halo ${cleanOfficer}, honor keamanan periode ${lemburPeriodeLocal} sebesar ${formatRupiah(localEntry.nominal)} telah dibayarkan oleh pengurus.`;
  const lemburAdminTitleLocal = `Lembur Dibayarkan — ${cleanOfficer}`;
  const lemburAdminBodyLocal = `${session.nama_warga} membayarkan lembur sebesar ${formatRupiah(localEntry.nominal)} (${localEntry.no_bukti}).`;
  const lemburOfficerTargetIdsLocal = cleanPetugasId
    ? [buildKeamananUserId(cleanPetugasId), buildPetugasUserId(cleanPetugasId)]
    : [buildKeamananUserId(cleanOfficer), buildPetugasUserId(cleanOfficer)];

  const lemburAdminLocalDedup = `kas-overtime:${localEntry.id}:admin`;
  const lemburPetugasLocalDedup = `kas-overtime:${localEntry.id}:petugas`;
  void dispatchActivityNotifications(
    session,
    [
      ...getBendaharaAndKetuaUserIds().map((uid) => ({
        user_id: uid,
        category: 'finance' as const,
        title: lemburAdminTitleLocal,
        message: lemburAdminBodyLocal,
        target_url: 'tab:keuangan',
        dedup_key: lemburAdminLocalDedup,
      })),
      {
        user_id: buildPetugasUserId(cleanPetugasId || cleanOfficer),
        category: 'finance' as const,
        title: lemburHonorTitleLocal,
        message: lemburHonorBodyLocal,
        target_url: 'tab:honor',
        dedup_key: lemburPetugasLocalDedup,
      },
    ],
    [
      {
        target_roles: ['admin'],
        category: 'finance',
        title: lemburAdminTitleLocal,
        body: lemburAdminBodyLocal,
        target_url: 'tab:keuangan',
        dedup_key: lemburAdminLocalDedup,
      },
      {
        target_user_ids: lemburOfficerTargetIdsLocal,
        category: 'finance',
        title: lemburHonorTitleLocal,
        body: lemburHonorBodyLocal,
        target_url: 'tab:honor',
        dedup_key: lemburPetugasLocalDedup,
      },
    ]
  );
  return { data: localEntry };
}

/**
 * Hapus otomatis transaksi kas pengeluaran yang terhubung ke jadwal lembur yang dibatalkan/dihapus
 * agar Saldo Kas utama, Rekap Bulanan, dan LPJ kembali akurat.
 */
export async function deleteLinkedOvertimeCashExpenseAdmin(
  session: SessionUser,
  cashTransactionId: string | null,
  shiftOverrideId?: string | null
): Promise<ServiceResult<boolean>> {
  if (session.role !== 'admin') {
    return { error: 'Akses ditolak: penghapusan transaksi kas lembur khusus Admin.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      if (cashTransactionId && !cashTransactionId.startsWith('kas-')) {
        await supabase.from('transaksi_kas').delete().eq('id', cashTransactionId);
      } else if (shiftOverrideId && !shiftOverrideId.startsWith('shift-')) {
        await supabase.from('transaksi_kas').delete().eq('shift_override_id', shiftOverrideId);
      }
    } catch {
      // Tetap bersihkan cache lokal
    }
  }

  const nextLocal = readLocalTransaksiKas().filter((item) => {
    if (cashTransactionId && item.id === cashTransactionId) return false;
    if (shiftOverrideId && item.shift_override_id === shiftOverrideId) return false;
    return true;
  });
  writeLocalTransaksiKas(nextLocal);

  await recordAuditLog({
    session,
    action: 'DELETE_LINKED_OVERTIME_KAS',
    entity: 'transaksi_kas',
    entity_id: cashTransactionId || shiftOverrideId || undefined,
    summary: `${session.nama_warga} membatalkan & menghapus otomatis transaksi kas lembur terkait agar saldo kas kembali akurat.`,
  });
  return { data: true };
}

// =========================================================================
// Keamanan Akun Pengurus: Ganti PIN 6 Digit Sendiri
// =========================================================================

export async function changeOwnAdminPinAdmin(
  session: SessionUser,
  currentPin: string,
  newPin: string
): Promise<ServiceResult<boolean>> {
  if (session.role !== 'admin') {
    return { error: 'Hanya akun Pengurus yang dapat mengganti PIN dari menu ini.' };
  }
  const cleanOld = currentPin.trim();
  const cleanNew = newPin.trim();

  if (!/^\d{6}$/.test(cleanOld)) {
    return { error: 'PIN lama harus terdiri dari 6 digit angka.' };
  }
  if (!/^\d{6}$/.test(cleanNew)) {
    return { error: 'PIN baru harus terdiri dari tepat 6 digit angka.' };
  }
  if (cleanOld === cleanNew) {
    return { error: 'PIN baru tidak boleh sama dengan PIN lama.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data: verifyData, error: verifyErr } = await supabase.rpc('login_ecard', {
        p_blok: session.blok_rumah,
        p_pin: cleanOld,
      });
      if (verifyErr) {
        return { error: parseFriendlyError(verifyErr, 'Gagal memverifikasi PIN lama ke server.') };
      }
      const row = (Array.isArray(verifyData) ? verifyData[0] : verifyData) as
        | Record<string, unknown>
        | undefined;
      if (!row || typeof row.blok_rumah !== 'string') {
        return { error: 'PIN lama yang Anda masukkan tidak sesuai.' };
      }

      const { error: updErr } = await supabase
        .from('users_warga')
        .update({ pin_akses: cleanNew })
        .eq('blok_rumah', session.blok_rumah)
        .eq('role', 'admin');

      if (updErr) {
        return { error: parseFriendlyError(updErr, 'Gagal menyimpan PIN baru ke Supabase.') };
      }

      await recordAuditLog({
        session,
        action: 'CHANGE_ADMIN_PIN',
        entity: 'users_warga',
        entity_id: session.blok_rumah,
        summary: `Pengurus ${session.nama_warga} (${session.jabatan || 'Admin'}) memperbarui PIN 6 digit akunnya.`,
      });
      void dispatchActivityNotifications(session, [
        {
          user_id: getCanonicalUserId(session),
          category: 'system',
          title: 'PIN Akun Pengurus Diperbarui',
          message: `PIN 6 digit akun ${session.nama_warga} (${session.jabatan || 'Pengurus'}) berhasil diperbarui.`,
          target_url: 'settings:keamanan',
        },
      ]);
      return { data: true };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Terjadi kesalahan saat mengubah PIN pengurus.') };
    }
  }

  // Fallback mode lokal
  const pinOverrides = (() => {
    try {
      const raw = safeStorageGet(STORAGE_KEYS.ADMIN_PIN_OVERRIDES);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();

  const localAcc = LOCAL_ADMIN_ACCOUNTS.find(
    (a) => a.username.toLowerCase() === session.blok_rumah.toLowerCase()
  );
  const effectiveOldPin = pinOverrides[session.blok_rumah.toLowerCase()] || localAcc?.pin || '';
  if (!effectiveOldPin || effectiveOldPin !== cleanOld) {
    return { error: 'PIN lama yang Anda masukkan tidak sesuai.' };
  }

  pinOverrides[session.blok_rumah.toLowerCase()] = cleanNew;
  safeStorageSet(STORAGE_KEYS.ADMIN_PIN_OVERRIDES, JSON.stringify(pinOverrides));
  await recordAuditLog({
    session,
    action: 'CHANGE_ADMIN_PIN',
    entity: 'users_warga',
    entity_id: session.blok_rumah,
    summary: `Pengurus ${session.nama_warga} (${session.jabatan || 'Admin'}) memperbarui PIN 6 digit akunnya.`,
  });
  void dispatchActivityNotifications(session, [
    {
      user_id: getCanonicalUserId(session),
      category: 'system',
      title: 'PIN Akun Pengurus Diperbarui',
      message: `PIN 6 digit akun ${session.nama_warga} berhasil diperbarui.`,
      target_url: 'settings:keamanan',
    },
  ]);
  return { data: true };
}

// =========================================================================
// Portal Petugas Keamanan (NFC Patroli), Titik Checkpoint & Isolasi Ketat
// =========================================================================

function readLocalPetugasList(): PetugasKeamanan[] {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.PETUGAS_KEAMANAN);
    if (!raw) {
      safeStorageSet(STORAGE_KEYS.PETUGAS_KEAMANAN, JSON.stringify(SEED_PETUGAS_KEAMANAN));
      return SEED_PETUGAS_KEAMANAN;
    }
    const parsed = JSON.parse(raw) as PetugasKeamanan[];
    return Array.isArray(parsed) ? parsed : SEED_PETUGAS_KEAMANAN;
  } catch {
    return SEED_PETUGAS_KEAMANAN;
  }
}

function writeLocalPetugasList(list: PetugasKeamanan[]) {
  safeStorageSet(STORAGE_KEYS.PETUGAS_KEAMANAN, JSON.stringify(list));
}

function readLocalTitikPatroli(): TitikPatroli[] {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.TITIK_PATROLI);
    if (!raw) {
      safeStorageSet(STORAGE_KEYS.TITIK_PATROLI, JSON.stringify(SEED_TITIK_PATROLI));
      return SEED_TITIK_PATROLI;
    }
    const parsed = JSON.parse(raw) as TitikPatroli[];
    return Array.isArray(parsed) ? parsed : SEED_TITIK_PATROLI;
  } catch {
    return SEED_TITIK_PATROLI;
  }
}

function writeLocalTitikPatroli(list: TitikPatroli[]) {
  safeStorageSet(STORAGE_KEYS.TITIK_PATROLI, JSON.stringify(list));
}

function readLocalLogPatroli(): LogPatroli[] {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.LOG_PATROLI);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LogPatroli[];
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => new Date(b.waktu_scan).getTime() - new Date(a.waktu_scan).getTime())
      : [];
  } catch {
    return [];
  }
}

function writeLocalLogPatroli(list: LogPatroli[]) {
  safeStorageSet(STORAGE_KEYS.LOG_PATROLI, JSON.stringify(list.slice(0, 300)));
}

function normalizePetugasRow(row: Record<string, unknown>, includePin = false): PetugasKeamanan {
  const id = String(row.id || '');
  const username = String(row.username || '');
  const rawAvatar =
    (typeof row.avatar_url === 'string' && row.avatar_url.trim()) ||
    getCachedAvatarUrl('petugas', id) ||
    getCachedAvatarUrl('petugas', username) ||
    null;
  return {
    id,
    nama: String(row.nama || ''),
    username,
    pin: includePin && typeof row.pin === 'string' ? row.pin : undefined,
    no_hp: normalizePhoneNumber(String(row.no_hp || '')),
    shift: String(row.shift || 'Shift Pagi (07.00 – 19.00)'),
    aktif: row.aktif !== false,
    avatar_url: rawAvatar,
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

function readLocalPatrolMapConfig(): PatrolMapConfig {
  try {
    const raw = safeStorageGet(STORAGE_KEYS.PATROL_MAP_CONFIG);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PatrolMapConfig>;
      return {
        map_image_url: typeof parsed.map_image_url === 'string' ? parsed.map_image_url : null,
        cycle_reset_at: typeof parsed.cycle_reset_at === 'string' ? parsed.cycle_reset_at : null,
        pin_positions:
          parsed.pin_positions && typeof parsed.pin_positions === 'object'
            ? parsed.pin_positions
            : {},
        updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined,
      };
    }
  } catch {
    // Abaikan
  }
  return {
    map_image_url: null,
    cycle_reset_at: null,
    pin_positions: {},
  };
}

function writeLocalPatrolMapConfig(cfg: PatrolMapConfig) {
  safeStorageSet(STORAGE_KEYS.PATROL_MAP_CONFIG, JSON.stringify(cfg));
}

function parseFinitePercent(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  return Math.max(2, Math.min(98, Math.round(num * 100) / 100));
}

function normalizeTitikRow(row: Record<string, unknown>): TitikPatroli {
  const id = String(row.id || '');
  const localPins = readLocalPatrolMapConfig().pin_positions || {};
  const pinOverride = id ? localPins[id] : undefined;
  const xPercent = parseFinitePercent(row.x_percent) ?? pinOverride?.x_percent ?? null;
  const yPercent = parseFinitePercent(row.y_percent) ?? pinOverride?.y_percent ?? null;
  return {
    id,
    nama_lokasi: String(row.nama_lokasi || ''),
    rfid_uid: String(row.rfid_uid || '').trim().toUpperCase(),
    keterangan: typeof row.keterangan === 'string' ? row.keterangan : null,
    aktif: row.aktif !== false,
    x_percent: xPercent,
    y_percent: yPercent,
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

function normalizeLogPatroliRow(row: Record<string, unknown>): LogPatroli {
  return {
    id: String(row.id || `patroli-${Date.now()}`),
    petugas_id: String(row.petugas_id || ''),
    nama_petugas: String(row.nama_petugas || 'Petugas'),
    titik_id: typeof row.titik_id === 'string' ? row.titik_id : null,
    nama_lokasi: String(row.nama_lokasi || '-'),
    waktu_scan: String(row.waktu_scan || new Date().toISOString()),
    metode_scan: row.metode_scan === 'Input Manual' ? 'Input Manual' : 'NFC Tap',
    status_kondisi: row.status_kondisi === 'Ada Catatan' ? 'Ada Catatan' : 'Aman',
    catatan: typeof row.catatan === 'string' ? row.catatan : null,
  };
}

/**
 * Autentikasi Khusus Portal Petugas Keamanan (/petugas) — Terisolasi Penuh.
 * Memverifikasi PIN melalui RPC SECURITY DEFINER `login_petugas` agar kolom PIN tidak pernah terekspos.
 */
export async function loginPetugasKeamanan(
  usernameInput: string,
  pinInput: string
): Promise<ServiceResult<SessionUser>> {
  const cleanUser = usernameInput.trim();
  const cleanPin = pinInput.trim();

  if (!cleanUser || !cleanPin) {
    return { error: 'Mohon isi Username / Nama Petugas dan PIN 6 digit Anda.' };
  }
  if (!/^\d{6}$/.test(cleanPin)) {
    return { error: 'PIN petugas keamanan harus terdiri dari tepat 6 digit angka.' };
  }

  const attemptKey = `petugas:${cleanUser.toLowerCase()}`;
  const lockMsg = checkLocalLockout(attemptKey);
  if (lockMsg) {
    return { error: lockMsg };
  }

  const supabase = getSupabaseProbeClient({
    role: 'petugas',
    blokRumah: cleanUser,
    petugasId: cleanUser,
  });
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('login_petugas', {
        p_username: cleanUser,
        p_pin: cleanPin,
      });

      if (!error) {
        const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
        if (!row || typeof row.id !== 'string') {
          const lockErr = registerLocalFailedAttempt(attemptKey);
          return {
            error:
              lockErr ||
              'Username petugas atau PIN 6 digit tidak sesuai, atau akun petugas sedang nonaktif.',
          };
        }

        clearLocalAttempts(attemptKey);
        const petugasAvatar =
          (typeof row.avatar_url === 'string' && row.avatar_url.trim()) ||
          getCachedAvatarUrl('petugas', row.id) ||
          getCachedAvatarUrl('petugas', String(row.username || cleanUser)) ||
          null;
        const session: SessionUser = {
          role: 'petugas',
          petugas_id: row.id,
          blok_rumah: String(row.username || cleanUser),
          nama_warga: String(row.nama || cleanUser),
          no_wa: normalizePhoneNumber(String(row.no_hp || '')),
          shift: String(row.shift || ''),
          avatar_url: petugasAvatar,
          login_at: new Date().toISOString(),
        };
        saveStoredSession(session);
        await recordAuditLog({
          session,
          action: 'LOGIN_PETUGAS_SUCCESS',
          entity: 'petugas_keamanan',
          entity_id: row.id,
          summary: `Petugas Keamanan ${session.nama_warga} (${session.shift || 'Shift'}) masuk ke Portal Keamanan.`,
        });
        return { data: session };
      }

      const errMsg = String((error as { message?: string }).message || '');
      const errCode = String((error as { code?: string }).code || '');
      if (errCode !== '42883' && !errMsg.includes('login_petugas')) {
        return { error: parseFriendlyError(error, 'Gagal memverifikasi akun petugas ke server.') };
      }
    } catch {
      // Fallback bersih ke lokal bila RPC login_petugas belum dijalankan di Supabase
    }
  }

  const list = readLocalPetugasList();
  const matched = list.find(
    (p) =>
      p.aktif &&
      (p.username.toLowerCase() === cleanUser.toLowerCase() ||
        p.nama.toLowerCase() === cleanUser.toLowerCase()) &&
      p.pin === cleanPin
  );

  if (!matched) {
    const lockErr = registerLocalFailedAttempt(attemptKey);
    return {
      error:
        lockErr ||
        'Username petugas atau PIN 6 digit tidak ditemukan. Hubungi Pengurus untuk aktivasi akun.',
    };
  }

  clearLocalAttempts(attemptKey);
  const session: SessionUser = {
    role: 'petugas',
    petugas_id: matched.id,
    blok_rumah: matched.username,
    nama_warga: matched.nama,
    no_wa: matched.no_hp,
    shift: matched.shift,
    avatar_url: matched.avatar_url || getCachedAvatarUrl('petugas', matched.id) || null,
    login_at: new Date().toISOString(),
  };
  saveStoredSession(session);
  return { data: session };
}

/**
 * Memulihkan sesi Petugas Keamanan setelah verifikasi biometrik perangkat (Face ID / Sidik Jari) berhasil.
 * Memverifikasi ulang status aktif petugas langsung ke Supabase (tanpa pernah menyimpan PIN di perangkat).
 */
export async function loginPetugasWithBiometric(enrolled: {
  petugas_id: string;
  username: string;
  nama: string;
  shift?: string;
}): Promise<ServiceResult<SessionUser>> {
  const cleanId = enrolled.petugas_id.trim();
  const cleanUser = enrolled.username.trim();
  if (!cleanId || !cleanUser) {
    return { error: 'Profil biometrik tidak valid. Silakan masuk menggunakan PIN 6 digit.' };
  }

  const candidateSession: SessionUser = {
    role: 'petugas',
    petugas_id: cleanId,
    blok_rumah: cleanUser,
    nama_warga: enrolled.nama.trim() || cleanUser,
    shift: enrolled.shift || '',
    login_at: new Date().toISOString(),
  };

  const supabase = getSupabaseClient(candidateSession);
  if (supabase && isSupabaseConfigured() && !cleanId.startsWith('petugas-')) {
    try {
      const { data, error } = await supabase
        .from('petugas_keamanan')
        .select('*')
        .eq('id', cleanId)
        .maybeSingle();

      if (error) {
        return {
          error: parseFriendlyError(
            error,
            'Gagal memverifikasi status aktif akun petugas di server. Silakan masuk dengan PIN.'
          ),
        };
      }

      if (!data || data.aktif !== true) {
        return {
          error:
            'Akun petugas ini sudah dinonaktifkan atau tidak ditemukan. Hubungi Pengurus Lingkungan.',
        };
      }

      const bioAvatar =
        (typeof (data as Record<string, unknown>).avatar_url === 'string' &&
          String((data as Record<string, unknown>).avatar_url).trim()) ||
        getCachedAvatarUrl('petugas', String(data.id)) ||
        null;
      const verifiedSession: SessionUser = {
        role: 'petugas',
        petugas_id: String(data.id),
        blok_rumah: String(data.username || cleanUser),
        nama_warga: String(data.nama || enrolled.nama || cleanUser),
        no_wa: normalizePhoneNumber(String(data.no_hp || '')),
        shift: String(data.shift || enrolled.shift || ''),
        avatar_url: bioAvatar,
        login_at: new Date().toISOString(),
      };

      saveStoredSession(verifiedSession);
      await recordAuditLog({
        session: verifiedSession,
        action: 'LOGIN_PETUGAS_BIOMETRIC_SUCCESS',
        entity: 'petugas_keamanan',
        entity_id: verifiedSession.petugas_id,
        summary: `Petugas Keamanan ${verifiedSession.nama_warga} (${verifiedSession.shift || 'Shift'}) masuk ke Portal Keamanan via Biometrik.`,
      });
      return { data: verifiedSession };
    } catch {
      return {
        error: 'Koneksi ke server terganggu saat memverifikasi akun. Coba lagi atau gunakan PIN 6 digit.',
      };
    }
  }

  const list = readLocalPetugasList();
  const matched = list.find((p) => p.id === cleanId && p.aktif);
  if (!matched) {
    return {
      error: 'Akun petugas tidak aktif atau tidak ditemukan. Silakan masuk menggunakan PIN 6 digit.',
    };
  }

  const localSession: SessionUser = {
    role: 'petugas',
    petugas_id: matched.id,
    blok_rumah: matched.username,
    nama_warga: matched.nama,
    no_wa: matched.no_hp,
    shift: matched.shift,
    login_at: new Date().toISOString(),
  };
  saveStoredSession(localSession);
  return { data: localSession };
}

export interface PetugasOwnData {
  profil: {
    id: string;
    nama: string;
    username: string;
    no_hp: string;
    shift: string;
    avatar_url?: string | null;
  };
  instruksiKeamanan: SystemNotification[];
  titikPatroli: TitikPatroli[];
  patroliPribadi: LogPatroli[];
  patroliCycleLogs: LogPatroli[];
  patrolMapConfig: PatrolMapConfig;
  riwayatHonor: TransaksiKas[];
}

/**
 * Mengambil data khusus milik Petugas Keamanan yang sedang login (ISOLASI PRIVASI KETAT).
 * TIDAK PERNAH mengambil data saldo kas lingkungan, data warga, tunggakan IPL, atau honor petugas lain.
 */
export async function fetchPetugasOwnData(
  session: SessionUser
): Promise<ServiceResult<PetugasOwnData>> {
  if (session.role !== 'petugas' || !session.petugas_id) {
    return { error: 'Sesi Petugas Keamanan tidak valid.' };
  }

  const ownId = session.petugas_id;
  const fallbackProfil = {
    id: ownId,
    nama: session.nama_warga,
    username: session.blok_rumah,
    no_hp: session.no_wa || '',
    shift: session.shift || 'Shift Keamanan',
    avatar_url:
      session.avatar_url ||
      getCachedAvatarUrl('petugas', ownId) ||
      getCachedAvatarUrl('petugas', session.blok_rumah) ||
      null,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !ownId.startsWith('petugas-')) {
    try {
      const [profilRes, titikRes, patroliRes, cycleLogsRes, honorRes, allNotifs, patrolMapConfig] =
        await Promise.all([
          supabase
            .from('petugas_keamanan')
            .select('*')
            .eq('id', ownId)
            .maybeSingle(),
          supabase
            .from('titik_patroli')
            .select('*')
            .eq('aktif', true)
            .order('nama_lokasi', { ascending: true }),
          supabase
            .from('log_patroli')
            .select('*')
            .eq('petugas_id', ownId)
            .order('waktu_scan', { ascending: false })
            .limit(50),
          supabase
            .from('log_patroli')
            .select('*')
            .order('waktu_scan', { ascending: false })
            .limit(40),
          supabase
            .from('transaksi_kas')
            .select('*')
            .eq('jenis', 'pengeluaran')
            .order('tanggal', { ascending: false })
            .limit(80),
          fetchSystemNotifications(session),
          fetchPatrolMapConfig(session),
        ]);

      const rawProfilData = (!profilRes.error && profilRes.data
        ? (profilRes.data as Record<string, unknown>)
        : null);
      const resolvedPetugasAvatar =
        (typeof rawProfilData?.avatar_url === 'string' && rawProfilData.avatar_url.trim()) ||
        fallbackProfil.avatar_url ||
        null;
      if (resolvedPetugasAvatar) {
        cacheAccountAvatars([
          { key: buildAvatarKey('petugas', ownId), url: resolvedPetugasAvatar },
          {
            key: buildAvatarKey('petugas', String(rawProfilData?.username || fallbackProfil.username)),
            url: resolvedPetugasAvatar,
          },
        ]);
      }

      const profil = rawProfilData
        ? {
            id: String(rawProfilData.id),
            nama: String(rawProfilData.nama || fallbackProfil.nama),
            username: String(rawProfilData.username || fallbackProfil.username),
            no_hp: normalizePhoneNumber(String(rawProfilData.no_hp || fallbackProfil.no_hp)),
            shift: String(rawProfilData.shift || fallbackProfil.shift),
            avatar_url: resolvedPetugasAvatar,
          }
        : fallbackProfil;

      const titikPatroli =
        !titikRes.error && Array.isArray(titikRes.data)
          ? (titikRes.data as Record<string, unknown>[]).map(normalizeTitikRow)
          : readLocalTitikPatroli().filter((t) => t.aktif);

      const patroliPribadi =
        !patroliRes.error && Array.isArray(patroliRes.data)
          ? (patroliRes.data as Record<string, unknown>[])
              .map(normalizeLogPatroliRow)
              .filter((p) => p.petugas_id === ownId)
          : readLocalLogPatroli().filter((p) => p.petugas_id === ownId);

      const patroliCycleLogs =
        !cycleLogsRes.error && Array.isArray(cycleLogsRes.data)
          ? (cycleLogsRes.data as Record<string, unknown>[]).map(normalizeLogPatroliRow)
          : readLocalLogPatroli().slice(0, 40);

      const ownNameLower = profil.nama.trim().toLowerCase();
      const matchesOwnOfficerName = (rawName: string) => {
        const clean = rawName.trim().toLowerCase();
        return clean === ownNameLower || clean.startsWith(`${ownNameLower} (`);
      };
      const riwayatHonor =
        !honorRes.error && Array.isArray(honorRes.data)
          ? (honorRes.data as Record<string, unknown>[])
              .map(normalizeTransaksiKasRow)
              .filter(
                (h) =>
                  h.jenis === 'pengeluaran' &&
                  (h.petugas_id === ownId || matchesOwnOfficerName(h.penerima_atau_sumber))
              )
          : readLocalTransaksiKas().filter(
              (h) =>
                h.jenis === 'pengeluaran' &&
                (h.petugas_id === ownId || matchesOwnOfficerName(h.penerima_atau_sumber))
            );

      const instruksiKeamanan = allNotifs
        .filter((n) => n.category === 'Keamanan')
        .map(({ recipient_blocks: _omit, ...safe }) => safe)
        .slice(0, 6);

      return {
        data: {
          profil,
          instruksiKeamanan,
          titikPatroli,
          patroliPribadi,
          patroliCycleLogs,
          patrolMapConfig,
          riwayatHonor,
        },
      };
    } catch {
      // Lanjut fallback lokal terisolasi
    }
  }

  const [allNotifs, patrolMapConfig] = await Promise.all([
    fetchSystemNotifications(session),
    fetchPatrolMapConfig(session),
  ]);
  const instruksiKeamanan = allNotifs
    .filter((n) => n.category === 'Keamanan')
    .map(({ recipient_blocks: _omit, ...safe }) => safe)
    .slice(0, 6);

  const allLogs = readLocalLogPatroli();
  return {
    data: {
      profil: fallbackProfil,
      instruksiKeamanan,
      titikPatroli: readLocalTitikPatroli().filter((t) => t.aktif),
      patroliPribadi: allLogs.filter((p) => p.petugas_id === ownId),
      patroliCycleLogs: allLogs.slice(0, 40),
      patrolMapConfig,
      riwayatHonor: readLocalTransaksiKas().filter(
        (h) => h.jenis === 'pengeluaran' && h.petugas_id === ownId
      ),
    },
  };
}

export async function submitLogPatroliPetugas(
  session: SessionUser,
  payload: {
    titik_id?: string | null;
    nama_lokasi: string;
    metode_scan: MetodeScanPatroli;
    status_kondisi: StatusKondisiPatroli;
    catatan?: string;
  }
): Promise<ServiceResult<LogPatroli>> {
  if (session.role !== 'petugas' || !session.petugas_id) {
    return { error: 'Hanya Petugas Keamanan aktif yang dapat mencatat patroli.' };
  }
  if (!payload.nama_lokasi.trim()) {
    return { error: 'Titik lokasi patroli wajib dipilih atau di-scan via NFC.' };
  }

  const nowIso = new Date().toISOString();
  const localEntry: LogPatroli = {
    id: `patroli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    petugas_id: session.petugas_id,
    nama_petugas: session.nama_warga,
    titik_id: payload.titik_id || null,
    nama_lokasi: payload.nama_lokasi.trim(),
    waktu_scan: nowIso,
    metode_scan: payload.metode_scan,
    status_kondisi: payload.status_kondisi,
    catatan: payload.catatan?.trim() || null,
  };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !session.petugas_id.startsWith('petugas-')) {
    try {
      const { data, error } = await supabase
        .from('log_patroli')
        .insert({
          petugas_id: session.petugas_id,
          nama_petugas: session.nama_warga,
          titik_id:
            payload.titik_id && !payload.titik_id.startsWith('titik-') ? payload.titik_id : null,
          nama_lokasi: localEntry.nama_lokasi,
          waktu_scan: nowIso,
          metode_scan: localEntry.metode_scan,
          status_kondisi: localEntry.status_kondisi,
          catatan: localEntry.catatan,
        })
        .select()
        .single();

      if (!error && data) {
        const saved = normalizeLogPatroliRow(data as Record<string, unknown>);
        const existing = readLocalLogPatroli().filter((l) => l.id !== saved.id);
        writeLocalLogPatroli([saved, ...existing]);
        const isAlert = saved.status_kondisi !== 'Aman';
        const patrolAdminTitle = 'Update dari Petugas Keamanan';
        const patrolAdminBody = `${saved.nama_petugas} telah mengirim laporan keamanan di ${saved.nama_lokasi} (Kondisi: ${saved.status_kondisi}${saved.catatan ? ` — ${saved.catatan}` : ''}).`;
        const patrolAdminDedup = `patrol:${saved.id}:admin`;
        const patrolWargaDedup = `patrol:${saved.id}:warga`;
        void dispatchActivityNotifications(
          session,
          [
            ...getAllAdminUserIds().map((uid) => ({
              user_id: uid,
              category: 'patrol' as const,
              title: patrolAdminTitle,
              message: patrolAdminBody,
              target_url: 'tab:keamanan',
              dedup_key: patrolAdminDedup,
            })),
            ...(isAlert
              ? [
                  {
                    user_id: 'broadcast:warga',
                    category: 'patrol' as const,
                    title: `Info Keamanan di ${saved.nama_lokasi}`,
                    message: `${saved.nama_petugas} mencatat: ${saved.catatan || 'Kondisi perlu perhatian keamanan.'}`,
                    target_url: 'tab:keamanan',
                    dedup_key: patrolWargaDedup,
                  },
                ]
              : []),
          ],
          [
            {
              target_roles: ['admin'],
              category: 'patrol',
              title: patrolAdminTitle,
              body: patrolAdminBody,
              target_url: 'tab:keamanan',
              dedup_key: patrolAdminDedup,
            },
            ...(isAlert
              ? [
                  {
                    target_roles: ['warga' as const],
                    category: 'patrol' as const,
                    title: `Info Keamanan di ${saved.nama_lokasi}`,
                    body: `${saved.nama_petugas} mencatat: ${saved.catatan || 'Kondisi perlu perhatian keamanan.'}`,
                    target_url: 'tab:keamanan',
                    dedup_key: patrolWargaDedup,
                  },
                ]
              : []),
          ]
        );
        return { data: saved };
      }

      const errCode = String((error as { code?: string })?.code || '');
      const errMsg = String((error as { message?: string })?.message || '');
      if (errCode !== '42P01' && !errMsg.includes('log_patroli')) {
        return { error: parseFriendlyError(error, 'Gagal mengirim catatan patroli ke server.') };
      }
    } catch {
      // Fallback lokal
    }
  }

  writeLocalLogPatroli([localEntry, ...readLocalLogPatroli()]);
  const isAlertLocal = localEntry.status_kondisi !== 'Aman';
  const patrolAdminTitleLocal = 'Update dari Petugas Keamanan';
  const patrolAdminBodyLocal = `${localEntry.nama_petugas} telah mengirim laporan keamanan di ${localEntry.nama_lokasi} (Kondisi: ${localEntry.status_kondisi}${localEntry.catatan ? ` — ${localEntry.catatan}` : ''}).`;
  const patrolAdminLocalDedup = `patrol:${localEntry.id}:admin`;
  const patrolWargaLocalDedup = `patrol:${localEntry.id}:warga`;
  void dispatchActivityNotifications(
    session,
    [
      ...getAllAdminUserIds().map((uid) => ({
        user_id: uid,
        category: 'patrol' as const,
        title: patrolAdminTitleLocal,
        message: patrolAdminBodyLocal,
        target_url: 'tab:keamanan',
        dedup_key: patrolAdminLocalDedup,
      })),
      ...(isAlertLocal
        ? [
            {
              user_id: 'broadcast:warga',
              category: 'patrol' as const,
              title: `Info Keamanan di ${localEntry.nama_lokasi}`,
              message: `${localEntry.nama_petugas} mencatat: ${localEntry.catatan || 'Kondisi perlu perhatian keamanan.'}`,
              target_url: 'tab:keamanan',
              dedup_key: patrolWargaLocalDedup,
            },
          ]
        : []),
    ],
    [
      {
        target_roles: ['admin'],
        category: 'patrol',
        title: patrolAdminTitleLocal,
        body: patrolAdminBodyLocal,
        target_url: 'tab:keamanan',
        dedup_key: patrolAdminLocalDedup,
      },
      ...(isAlertLocal
        ? [
            {
              target_roles: ['warga' as const],
              category: 'patrol' as const,
              title: `Info Keamanan di ${localEntry.nama_lokasi}`,
              body: `${localEntry.nama_petugas} mencatat: ${localEntry.catatan || 'Kondisi perlu perhatian keamanan.'}`,
              target_url: 'tab:keamanan',
              dedup_key: patrolWargaLocalDedup,
            },
          ]
        : []),
    ]
  );
  return { data: localEntry };
}

export async function submitLogPatroliAdmin(
  session: SessionUser,
  payload: {
    petugas_id?: string | null;
    nama_petugas?: string;
    titik_id?: string | null;
    nama_lokasi: string;
    metode_scan: MetodeScanPatroli;
    status_kondisi: StatusKondisiPatroli;
    catatan?: string;
  }
): Promise<ServiceResult<LogPatroli>> {
  if (session.role !== 'admin') {
    return { error: 'Hanya Pengurus/Admin yang dapat mencatat patroli dari panel ini.' };
  }
  if (!payload.nama_lokasi.trim()) {
    return { error: 'Titik lokasi patroli wajib dipilih atau di-scan via NFC.' };
  }

  const nowIso = new Date().toISOString();
  const petugasId = payload.petugas_id || `admin-${session.blok_rumah}`;
  const namaPetugas =
    payload.nama_petugas?.trim() || `${session.nama_warga} (${session.jabatan || 'Pengurus'})`;

  const localEntry: LogPatroli = {
    id: `patroli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    petugas_id: petugasId,
    nama_petugas: namaPetugas,
    titik_id: payload.titik_id || null,
    nama_lokasi: payload.nama_lokasi.trim(),
    waktu_scan: nowIso,
    metode_scan: payload.metode_scan,
    status_kondisi: payload.status_kondisi,
    catatan: payload.catatan?.trim() || null,
  };

  const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    petugasId
  );

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && isValidUuid) {
    try {
      const { data, error } = await supabase
        .from('log_patroli')
        .insert({
          petugas_id: petugasId,
          nama_petugas: namaPetugas,
          titik_id:
            payload.titik_id && !payload.titik_id.startsWith('titik-') ? payload.titik_id : null,
          nama_lokasi: localEntry.nama_lokasi,
          waktu_scan: nowIso,
          metode_scan: localEntry.metode_scan,
          status_kondisi: localEntry.status_kondisi,
          catatan: localEntry.catatan,
        })
        .select()
        .single();

      if (!error && data) {
        const saved = normalizeLogPatroliRow(data as Record<string, unknown>);
        const existing = readLocalLogPatroli().filter((l) => l.id !== saved.id);
        writeLocalLogPatroli([saved, ...existing]);
        const isAlert = saved.status_kondisi !== 'Aman';
        const patrolAdmDedup = `patrol:${saved.id}:admin`;
        const patrolAdmWargaDedup = `patrol:${saved.id}:warga`;
        void dispatchActivityNotifications(session, [
          ...getAllAdminUserIds().map((uid) => ({
            user_id: uid,
            category: 'patrol' as const,
            title: isAlert
              ? `Catatan Keamanan — ${saved.nama_lokasi}`
              : `Log Patroli: ${saved.nama_lokasi}`,
            message: `${saved.nama_petugas} (${saved.metode_scan}) — ${saved.status_kondisi}${saved.catatan ? `: ${saved.catatan}` : '.'}`,
            target_url: 'tab:keamanan',
            dedup_key: patrolAdmDedup,
          })),
          ...(isAlert
            ? [
                {
                  user_id: 'broadcast:warga',
                  category: 'patrol' as const,
                  title: `Info Keamanan di ${saved.nama_lokasi}`,
                  message: `${saved.nama_petugas} mencatat: ${saved.catatan || 'Kondisi perlu perhatian keamanan.'}`,
                  target_url: 'tab:keamanan',
                  dedup_key: patrolAdmWargaDedup,
                },
              ]
            : []),
        ]);
        return { data: saved };
      }

      const errCode = String((error as { code?: string })?.code || '');
      const errMsg = String((error as { message?: string })?.message || '');
      if (errCode !== '42P01' && !errMsg.includes('log_patroli')) {
        return { error: parseFriendlyError(error, 'Gagal mengirim catatan patroli ke server.') };
      }
    } catch {
      // Fallback lokal
    }
  }

  writeLocalLogPatroli([localEntry, ...readLocalLogPatroli()]);
  const isAlertAdmin = localEntry.status_kondisi !== 'Aman';
  const patrolAdmLocalDedup = `patrol:${localEntry.id}:admin`;
  const patrolAdmWargaLocalDedup = `patrol:${localEntry.id}:warga`;
  void dispatchActivityNotifications(session, [
    ...getAllAdminUserIds().map((uid) => ({
      user_id: uid,
      category: 'patrol' as const,
      title: isAlertAdmin
        ? `Catatan Keamanan — ${localEntry.nama_lokasi}`
        : `Log Patroli: ${localEntry.nama_lokasi}`,
      message: `${localEntry.nama_petugas} (${localEntry.metode_scan}) — ${localEntry.status_kondisi}${localEntry.catatan ? `: ${localEntry.catatan}` : '.'}`,
      target_url: 'tab:keamanan',
      dedup_key: patrolAdmLocalDedup,
    })),
    ...(isAlertAdmin
      ? [
          {
            user_id: 'broadcast:warga',
            category: 'patrol' as const,
            title: `Info Keamanan di ${localEntry.nama_lokasi}`,
            message: `${localEntry.nama_petugas} mencatat: ${localEntry.catatan || 'Kondisi perlu perhatian keamanan.'}`,
            target_url: 'tab:keamanan',
            dedup_key: patrolAdmWargaLocalDedup,
          },
        ]
      : []),
  ]);
  return { data: localEntry };
}

/**
 * Menghapus satu catatan log patroli keamanan (khusus Pengurus/Admin).
 */
export async function deleteLogPatroliAdmin(
  session: SessionUser,
  logId: string,
  summaryLabel?: string
): Promise<{ ok: boolean; error?: string }> {
  if (session.role !== 'admin') {
    return { ok: false, error: 'Hanya Pengurus/Admin yang dapat menghapus log patroli keamanan.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !logId.startsWith('LP-')) {
    try {
      const { error } = await supabase.from('log_patroli').delete().eq('id', logId);
      if (error) {
        const errCode = String((error as { code?: string })?.code || '');
        if (errCode !== '42P01') {
          return {
            ok: false,
            error: parseFriendlyError(error, 'Gagal menghapus log patroli dari server.'),
          };
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: parseFriendlyError(err, 'Gagal menghubungi server saat menghapus log patroli.'),
      };
    }
  }

  const remaining = readLocalLogPatroli().filter((item) => item.id !== logId);
  writeLocalLogPatroli(remaining);

  void recordAuditLog({
    session,
    action: 'DELETE_LOG_PATROLI',
    entity: 'log_patroli',
    entity_id: logId,
    summary: `Menghapus log patroli keamanan${summaryLabel ? ` (${summaryLabel})` : ''}.`,
  });

  return { ok: true };
}

/**
 * Menghapus seluruh riwayat log patroli keamanan (khusus Pengurus/Admin).
 */
export async function deleteAllLogPatroliAdmin(
  session: SessionUser
): Promise<{ ok: boolean; error?: string }> {
  if (session.role !== 'admin') {
    return { ok: false, error: 'Hanya Pengurus/Admin yang dapat menghapus log patroli keamanan.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { error } = await supabase
        .from('log_patroli')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      if (error) {
        const errCode = String((error as { code?: string })?.code || '');
        if (errCode !== '42P01') {
          return {
            ok: false,
            error: parseFriendlyError(error, 'Gagal mengosongkan log patroli di server.'),
          };
        }
      }
    } catch (err) {
      return {
        ok: false,
        error: parseFriendlyError(err, 'Gagal menghubungi server saat mengosongkan log patroli.'),
      };
    }
  }

  writeLocalLogPatroli([]);

  void recordAuditLog({
    session,
    action: 'CLEAR_ALL_LOG_PATROLI',
    entity: 'log_patroli',
    summary: 'Mengosongkan seluruh catatan log patroli keamanan.',
  });

  return { ok: true };
}

/**
 * Mengambil daftar kontak darurat petugas keamanan aktif (HANYA nama, shift, no_hp — TANPA PIN).
 * Aman dipanggil oleh Portal Warga & Admin melalui RPC `get_petugas_kontak_darurat`.
 */
export async function fetchPetugasKontakDarurat(
  session?: SessionUser | null
): Promise<PetugasKontakDarurat[]> {
  const supabase = getSupabaseClient(session || null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('get_petugas_kontak_darurat');
      if (!error && Array.isArray(data)) {
        return (data as Record<string, unknown>[]).map((row) => {
          const id = String(row.id || '');
          const avatarUrl =
            (typeof row.avatar_url === 'string' && row.avatar_url.trim()) ||
            getCachedAvatarUrl('petugas', id) ||
            null;
          return {
            id,
            nama: String(row.nama || ''),
            no_hp: normalizePhoneNumber(String(row.no_hp || '')),
            shift: String(row.shift || 'Siaga'),
            avatar_url: avatarUrl,
          };
        });
      }
    } catch {
      // Fallback ke lokal jika RPC belum dijalankan
    }
  }

  return readLocalPetugasList()
    .filter((p) => p.aktif)
    .map(({ id, nama, no_hp, shift, avatar_url }) => ({
      id,
      nama,
      no_hp,
      shift,
      avatar_url: avatar_url || getCachedAvatarUrl('petugas', id) || null,
    }));
}

export async function fetchRecentLogPatroli(
  session: SessionUser,
  limit = 15
): Promise<LogPatroli[]> {
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('log_patroli')
        .select('*')
        .order('waktu_scan', { ascending: false })
        .limit(limit);

      if (!error && Array.isArray(data)) {
        const list = (data as Record<string, unknown>[]).map(normalizeLogPatroliRow);
        writeLocalLogPatroli(list);
        return list;
      }
    } catch {
      // Fallback lokal
    }
  }
  return readLocalLogPatroli().slice(0, limit);
}

// =========================================================================
// Manajemen Admin: Akun Petugas Keamanan & Titik Checkpoint RFID/NFC
// =========================================================================

export async function fetchPetugasListAdmin(session: SessionUser): Promise<PetugasKeamanan[]> {
  if (session.role !== 'admin') return [];
  const revealPin =
    isBendaharaFullAccess(session) ||
    hasSettingModulePermission(
      session,
      'settings.system_integrations',
      session.central_settings_permissions
    );
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const cols = revealPin
        ? 'id, nama, username, pin, no_hp, shift, aktif, created_at'
        : 'id, nama, username, no_hp, shift, aktif, created_at';
      const { data, error } = await supabase
        .from('petugas_keamanan')
        .select(cols)
        .order('aktif', { ascending: false })
        .order('nama', { ascending: true });
      if (!error && Array.isArray(data)) {
        return (data as unknown as Record<string, unknown>[]).map((r) =>
          normalizePetugasRow(r, revealPin)
        );
      }
    } catch {
      // Fallback lokal
    }
  }
  return readLocalPetugasList().map((p) => ({
    ...p,
    pin: revealPin ? p.pin : undefined,
  }));
}

const PETUGAS_CHANGE_EVENT = 'skb-petugas-keamanan-changed';

export function emitPetugasKeamananChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(PETUGAS_CHANGE_EVENT));
  } catch {
    // Abaikan bila di luar browser
  }
}

export function subscribePetugasKeamananRealtime(
  session: SessionUser | null,
  onChange: () => void
): () => void {
  const onLocal = () => onChange();
  window.addEventListener(PETUGAS_CHANGE_EVENT, onLocal);

  if (!isSupabaseConfigured()) {
    return () => {
      window.removeEventListener(PETUGAS_CHANGE_EVENT, onLocal);
    };
  }

  const supabase = getSupabaseClient(session || null);
  if (!supabase) {
    return () => {
      window.removeEventListener(PETUGAS_CHANGE_EVENT, onLocal);
    };
  }

  const channelName = `petugas-keamanan-rt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'petugas_keamanan' },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    window.removeEventListener(PETUGAS_CHANGE_EVENT, onLocal);
    try {
      void supabase.removeChannel(channel);
    } catch {
      // Abaikan
    }
  };
}

export async function savePetugasAdmin(
  session: SessionUser,
  payload: {
    id?: string;
    nama: string;
    username: string;
    pin: string;
    no_hp: string;
    shift: string;
    aktif?: boolean;
  }
): Promise<ServiceResult<PetugasKeamanan>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: pengelolaan akun Petugas Keamanan khusus Bendahara.' };
  }

  const cleanNama = payload.nama.trim();
  const cleanUsername = payload.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
  const cleanPin = payload.pin.trim();
  const cleanHp = normalizePhoneNumber(payload.no_hp);
  const cleanShift = payload.shift.trim() || 'Shift Pagi (07.00 – 19.00)';

  if (!cleanNama) return { error: 'Nama petugas wajib diisi.' };
  if (!cleanUsername || cleanUsername.length < 3) {
    return { error: 'Username petugas minimal 3 karakter (huruf/angka tanpa spasi).' };
  }
  if (!/^\d{6}$/.test(cleanPin)) {
    return { error: 'PIN petugas wajib terdiri dari tepat 6 digit angka.' };
  }
  if (!cleanHp || cleanHp.length < 10) {
    return { error: 'Nomor HP / WhatsApp aktif petugas wajib diisi dengan format valid.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      if (payload.id && !payload.id.startsWith('petugas-')) {
        const { data, error } = await supabase
          .from('petugas_keamanan')
          .update({
            nama: cleanNama,
            username: cleanUsername,
            pin: cleanPin,
            no_hp: cleanHp,
            shift: cleanShift,
            aktif: payload.aktif ?? true,
          })
          .eq('id', payload.id)
          .select()
          .single();

        if (!error && data) {
          const saved = normalizePetugasRow(data as Record<string, unknown>, true);
          await recordAuditLog({
            session,
            action: 'UPDATE_PETUGAS',
            entity: 'petugas_keamanan',
            entity_id: saved.id,
            summary: `Memperbarui akun Petugas Keamanan ${saved.nama} (@${saved.username} · ${saved.shift}).`,
          });
          emitPetugasKeamananChanged();
          return { data: saved };
        }
        const errCode = String((error as { code?: string })?.code || '');
        if (errCode !== '42P01') {
          return { error: parseFriendlyError(error, 'Gagal memperbarui akun petugas di Supabase.') };
        }
      } else {
        const { data, error } = await supabase
          .from('petugas_keamanan')
          .insert({
            nama: cleanNama,
            username: cleanUsername,
            pin: cleanPin,
            no_hp: cleanHp,
            shift: cleanShift,
            aktif: payload.aktif ?? true,
          })
          .select()
          .single();

        if (!error && data) {
          const saved = normalizePetugasRow(data as Record<string, unknown>, true);
          await recordAuditLog({
            session,
            action: 'CREATE_PETUGAS',
            entity: 'petugas_keamanan',
            entity_id: saved.id,
            summary: `Menambahkan akun Petugas Keamanan baru ${saved.nama} (@${saved.username}).`,
          });
          emitPetugasKeamananChanged();
          return { data: saved };
        }
        const errCode = String((error as { code?: string })?.code || '');
        if (errCode !== '42P01') {
          return { error: parseFriendlyError(error, 'Gagal menambahkan akun petugas di Supabase.') };
        }
      }
    } catch {
      // Fallback lokal
    }
  }

  const list = readLocalPetugasList();
  const duplicate = list.find(
    (p) => p.id !== payload.id && p.username.toLowerCase() === cleanUsername
  );
  if (duplicate) {
    return { error: `Username "${cleanUsername}" sudah digunakan oleh petugas ${duplicate.nama}.` };
  }

  if (payload.id) {
    let updated: PetugasKeamanan | undefined;
    const next = list.map((p) => {
      if (p.id !== payload.id) return p;
      updated = {
        ...p,
        nama: cleanNama,
        username: cleanUsername,
        pin: cleanPin,
        no_hp: cleanHp,
        shift: cleanShift,
        aktif: payload.aktif ?? p.aktif,
      };
      return updated;
    });
    if (!updated) return { error: 'Akun petugas tidak ditemukan.' };
    writeLocalPetugasList(next);
    emitPetugasKeamananChanged();
    return { data: updated };
  }

  const created: PetugasKeamanan = {
    id: `petugas-${Date.now()}`,
    nama: cleanNama,
    username: cleanUsername,
    pin: cleanPin,
    no_hp: cleanHp,
    shift: cleanShift,
    aktif: true,
    created_at: new Date().toISOString(),
  };
  writeLocalPetugasList([created, ...list]);
  emitPetugasKeamananChanged();
  return { data: created };
}

export async function deletePetugasAdmin(
  session: SessionUser,
  petugas: PetugasKeamanan
): Promise<ServiceResult<boolean>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: penghapusan akun petugas khusus Bendahara.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !petugas.id.startsWith('petugas-')) {
    try {
      const { error } = await supabase.from('petugas_keamanan').delete().eq('id', petugas.id);
      if (error && String((error as { code?: string }).code || '') !== '42P01') {
        return { error: parseFriendlyError(error, 'Gagal menghapus akun petugas dari Supabase.') };
      }
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menghapus akun petugas.') };
    }
  }

  writeLocalPetugasList(readLocalPetugasList().filter((p) => p.id !== petugas.id));
  await recordAuditLog({
    session,
    action: 'DELETE_PETUGAS',
    entity: 'petugas_keamanan',
    entity_id: petugas.id,
    summary: `Menghapus akun Petugas Keamanan ${petugas.nama} (@${petugas.username}).`,
  });
  emitPetugasKeamananChanged();
  return { data: true };
}

export async function fetchTitikPatroliPublic(session: SessionUser): Promise<TitikPatroli[]> {
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      let { data, error } = await supabase
        .from('titik_patroli')
        .select('id, nama_lokasi, keterangan, aktif, x_percent, y_percent, created_at')
        .eq('aktif', true)
        .order('nama_lokasi', { ascending: true });
      if (error) {
        const retry = await supabase
          .from('titik_patroli')
          .select('id, nama_lokasi, keterangan, aktif, created_at')
          .eq('aktif', true)
          .order('nama_lokasi', { ascending: true });
        data = retry.data as typeof data;
        error = retry.error;
      }
      if (!error && Array.isArray(data)) {
        return (data as Record<string, unknown>[]).map((row) => ({
          ...normalizeTitikRow(row),
          rfid_uid: '',
        }));
      }
    } catch {
      // Fallback lokal
    }
  }
  return readLocalTitikPatroli()
    .filter((t) => t.aktif)
    .map((t) => ({ ...t, rfid_uid: '' }));
}

export async function fetchTitikPatroliAdmin(session: SessionUser): Promise<TitikPatroli[]> {
  if (session.role !== 'admin') return [];
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('titik_patroli')
        .select('*')
        .order('nama_lokasi', { ascending: true });
      if (!error && Array.isArray(data)) {
        return (data as Record<string, unknown>[]).map(normalizeTitikRow);
      }
    } catch {
      // Fallback lokal
    }
  }
  return readLocalTitikPatroli();
}

export async function saveTitikPatroliAdmin(
  session: SessionUser,
  payload: {
    id?: string;
    nama_lokasi: string;
    rfid_uid: string;
    keterangan?: string;
    aktif?: boolean;
  }
): Promise<ServiceResult<TitikPatroli>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: pengelolaan titik checkpoint NFC khusus Bendahara.' };
  }

  const cleanLokasi = payload.nama_lokasi.trim();
  const cleanUid = payload.rfid_uid.trim().toUpperCase();
  if (!cleanLokasi) return { error: 'Nama lokasi titik patroli wajib diisi.' };
  if (!cleanUid) return { error: 'Kode RFID / NFC Tag UID wajib diisi.' };

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      if (payload.id && !payload.id.startsWith('titik-')) {
        const { data, error } = await supabase
          .from('titik_patroli')
          .update({
            nama_lokasi: cleanLokasi,
            rfid_uid: cleanUid,
            keterangan: payload.keterangan?.trim() || null,
            aktif: payload.aktif ?? true,
          })
          .eq('id', payload.id)
          .select()
          .single();
        if (!error && data) {
          return { data: normalizeTitikRow(data as Record<string, unknown>) };
        }
        if (String((error as { code?: string })?.code || '') !== '42P01') {
          return { error: parseFriendlyError(error, 'Gagal memperbarui titik patroli di Supabase.') };
        }
      } else {
        const { data, error } = await supabase
          .from('titik_patroli')
          .insert({
            nama_lokasi: cleanLokasi,
            rfid_uid: cleanUid,
            keterangan: payload.keterangan?.trim() || null,
            aktif: payload.aktif ?? true,
          })
          .select()
          .single();
        if (!error && data) {
          return { data: normalizeTitikRow(data as Record<string, unknown>) };
        }
        if (String((error as { code?: string })?.code || '') !== '42P01') {
          return { error: parseFriendlyError(error, 'Gagal menambahkan titik patroli di Supabase.') };
        }
      }
    } catch {
      // Fallback lokal
    }
  }

  const list = readLocalTitikPatroli();
  const dup = list.find((t) => t.id !== payload.id && t.rfid_uid.toUpperCase() === cleanUid);
  if (dup) {
    return { error: `UID "${cleanUid}" sudah terdaftar untuk titik "${dup.nama_lokasi}".` };
  }

  if (payload.id) {
    let updated: TitikPatroli | undefined;
    const next = list.map((t) => {
      if (t.id !== payload.id) return t;
      updated = {
        ...t,
        nama_lokasi: cleanLokasi,
        rfid_uid: cleanUid,
        keterangan: payload.keterangan?.trim() || null,
        aktif: payload.aktif ?? t.aktif,
      };
      return updated;
    });
    if (!updated) return { error: 'Titik patroli tidak ditemukan.' };
    writeLocalTitikPatroli(next);
    return { data: updated };
  }

  const created: TitikPatroli = {
    id: `titik-${Date.now()}`,
    nama_lokasi: cleanLokasi,
    rfid_uid: cleanUid,
    keterangan: payload.keterangan?.trim() || null,
    aktif: true,
    created_at: new Date().toISOString(),
  };
  writeLocalTitikPatroli([...list, created]);
  return { data: created };
}

export async function deleteTitikPatroliAdmin(
  session: SessionUser,
  titik: TitikPatroli
): Promise<ServiceResult<boolean>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: penghapusan titik checkpoint khusus Bendahara.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured() && !titik.id.startsWith('titik-')) {
    try {
      const { error } = await supabase.from('titik_patroli').delete().eq('id', titik.id);
      if (error && String((error as { code?: string }).code || '') !== '42P01') {
        return { error: parseFriendlyError(error, 'Gagal menghapus titik patroli.') };
      }
    } catch (err) {
      return { error: parseFriendlyError(err, 'Gagal menghapus titik patroli.') };
    }
  }

  writeLocalTitikPatroli(readLocalTitikPatroli().filter((t) => t.id !== titik.id));
  return { data: true };
}

// =========================================================================
// Peta Mapping Rute Patroli Interaktif & Koordinat Pin Checkpoint
// =========================================================================

export async function fetchPatrolMapConfig(
  session?: SessionUser | null
): Promise<PatrolMapConfig> {
  const localCfg = readLocalPatrolMapConfig();
  const supabase = getSupabaseClient(session || null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('patrol_map_image_url, patrol_cycle_reset_at, patrol_pin_positions, updated_at')
        .eq('id', 'default-app-brand')
        .maybeSingle();

      if (!error && data) {
        const row = data as Record<string, unknown>;
        const remotePins =
          row.patrol_pin_positions && typeof row.patrol_pin_positions === 'object'
            ? (row.patrol_pin_positions as Record<string, PatrolPinCoordinate>)
            : {};
        const merged: PatrolMapConfig = {
          map_image_url:
            typeof row.patrol_map_image_url === 'string' && row.patrol_map_image_url.trim()
              ? row.patrol_map_image_url.trim()
              : localCfg.map_image_url,
          cycle_reset_at:
            typeof row.patrol_cycle_reset_at === 'string' && row.patrol_cycle_reset_at.trim()
              ? row.patrol_cycle_reset_at.trim()
              : localCfg.cycle_reset_at,
          pin_positions: {
            ...localCfg.pin_positions,
            ...remotePins,
          },
          updated_at:
            typeof row.updated_at === 'string' ? row.updated_at : localCfg.updated_at,
        };
        writeLocalPatrolMapConfig(merged);
        return merged;
      }
    } catch {
      // Fallback lokal bila kolom patrol_map_* belum ditambahkan di app_settings
    }
  }
  return localCfg;
}

export async function uploadPatrolMapImageAdmin(
  session: SessionUser,
  file: File
): Promise<ServiceResult<string>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: unggah gambar peta patroli khusus Bendahara.' };
  }
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const rawExt = file.name?.split('.').pop()?.toLowerCase() || '';
      const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(rawExt) ? rawExt : 'png';
      const filePath = `patrol-map/denah-perumahan-${Date.now()}.${safeExt}`;
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
      // Lanjut fallback data URL
    }
  }

  try {
    const dataUrl = await fileToDataUrl(file);
    return { data: dataUrl };
  } catch (err) {
    return { error: parseFriendlyError(err, 'Gagal membaca file gambar peta perumahan.') };
  }
}

export async function savePatrolMapImageAdmin(
  session: SessionUser,
  imageUrl: string | null
): Promise<ServiceResult<PatrolMapConfig>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: pengaturan gambar peta patroli khusus Bendahara.' };
  }

  const nowIso = new Date().toISOString();
  const current = readLocalPatrolMapConfig();
  const updated: PatrolMapConfig = {
    ...current,
    map_image_url: imageUrl?.trim() || null,
    updated_at: nowIso,
  };
  writeLocalPatrolMapConfig(updated);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      await supabase
        .from('app_settings')
        .update({
          patrol_map_image_url: updated.map_image_url,
          updated_at: nowIso,
        })
        .eq('id', 'default-app-brand');
    } catch {
      // Tetap tersimpan lokal
    }
  }

  await recordAuditLog({
    session,
    action: 'UPDATE_PATROL_MAP_IMAGE',
    entity: 'app_settings',
    entity_id: 'default-app-brand',
    summary: updated.map_image_url
      ? 'Memperbarui gambar Peta Mapping Rute Patroli Perumahan.'
      : 'Menghapus gambar peta kustom (kembali ke denah vektor standar).',
  });

  return { data: updated };
}

export async function saveTitikPinPositionAdmin(
  session: SessionUser,
  titikId: string,
  xPercent: number,
  yPercent: number
): Promise<ServiceResult<PatrolMapConfig>> {
  if (!isBendaharaFullAccess(session)) {
    return { error: 'Akses ditolak: penempatan koordinat pin patroli khusus Bendahara.' };
  }

  const clampedX = Math.max(2, Math.min(98, Math.round(xPercent * 100) / 100));
  const clampedY = Math.max(2, Math.min(98, Math.round(yPercent * 100) / 100));
  const nowIso = new Date().toISOString();

  const current = readLocalPatrolMapConfig();
  const nextPins: Record<string, PatrolPinCoordinate> = {
    ...current.pin_positions,
    [titikId]: { x_percent: clampedX, y_percent: clampedY },
  };
  const updatedConfig: PatrolMapConfig = {
    ...current,
    pin_positions: nextPins,
    updated_at: nowIso,
  };
  writeLocalPatrolMapConfig(updatedConfig);

  // Perbarui juga cache lokal titik_patroli
  const localTitik = readLocalTitikPatroli();
  writeLocalTitikPatroli(
    localTitik.map((t) =>
      t.id === titikId ? { ...t, x_percent: clampedX, y_percent: clampedY } : t
    )
  );

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      if (!titikId.startsWith('titik-')) {
        await supabase
          .from('titik_patroli')
          .update({ x_percent: clampedX, y_percent: clampedY })
          .eq('id', titikId);
      }
      await supabase
        .from('app_settings')
        .update({
          patrol_pin_positions: nextPins,
          updated_at: nowIso,
        })
        .eq('id', 'default-app-brand');
    } catch {
      // Tetap tersimpan lokal
    }
  }

  return { data: updatedConfig };
}

export async function resetPatrolCycle(
  session: SessionUser
): Promise<ServiceResult<PatrolMapConfig>> {
  if (session.role !== 'admin' && session.role !== 'petugas') {
    return { error: 'Akses ditolak: reset siklus patroli hanya untuk Pengurus atau Petugas Keamanan.' };
  }

  const nowIso = new Date().toISOString();
  const current = readLocalPatrolMapConfig();
  const updated: PatrolMapConfig = {
    ...current,
    cycle_reset_at: nowIso,
    updated_at: nowIso,
  };
  writeLocalPatrolMapConfig(updated);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      await supabase
        .from('app_settings')
        .update({
          patrol_cycle_reset_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', 'default-app-brand');
    } catch {
      // Tetap tersimpan lokal bila migrasi SQL belum dijalankan
    }
  }

  await recordAuditLog({
    session,
    action: 'RESET_PATROL_CYCLE',
    entity: 'app_settings',
    entity_id: 'default-app-brand',
    summary: `${session.nama_warga} mereset siklus patroli aktif (pergantian shift). Riwayat log patroli tetap tersimpan aman.`,
  });

  return { data: updated };
}


