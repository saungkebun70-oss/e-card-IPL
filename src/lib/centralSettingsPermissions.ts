import {
  CENTRAL_SETTING_DEFINITIONS,
  CENTRAL_SETTING_KEYS,
  SUSUNAN_PENGURUS,
  type AdminJabatan,
  type AdminPermission,
  type CentralSettingKey,
  type PengurusItem,
  type PengurusSettingsPermissionRow,
  type PermissionGrantStatus,
  type SessionUser,
  type Warga,
  type WargaAccountStatus,
} from '../types';
import { recordAuditLog } from './auditLogger';
import { normalizeBlok } from './format';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';

export {
  CENTRAL_SETTING_DEFINITIONS,
  CENTRAL_SETTING_KEYS,
  type CentralSettingKey,
  type PengurusSettingsPermissionRow,
  type PermissionGrantStatus,
  type WargaAccountStatus,
};

const LOCAL_PERMISSIONS_STORAGE_KEY = 'saungkebun_pengurus_central_permissions_v1';
const LOCAL_PENGURUS_STATUS_STORAGE_KEY = 'saungkebun_pengurus_status_overrides_v1';

export type LoginPortalMode = 'warga' | 'admin';

export interface AccountLoginGuardRecord {
  id?: string;
  blok_rumah: string;
  nama_warga?: string | null;
  role?: 'warga' | 'admin' | 'bendahara' | 'petugas' | string | null;
  jabatan?: AdminJabatan | string | null;
  admin_permission?: AdminPermission | string | null;
  aktif?: boolean | null;
  is_active_pengurus?: boolean | null;
  is_active_warga?: boolean | null;
  warga_account_status?: WargaAccountStatus | string | null;
  linked_warga_blok?: string | null;
  linked_pengurus_username?: string | null;
}

export type LoginGuardStatusCode =
  | 'OK'
  | 'EMPTY_IDENTIFIER'
  | 'INVALID_LOGIN_MODE'
  | 'PENGURUS_MUST_USE_ADMIN_PORTAL'
  | 'PENGURUS_REVOKED_USE_WARGA'
  | 'WARGA_ACCOUNT_INACTIVE'
  | 'NOT_ACTIVE_PENGURUS'
  | 'PENGURUS_INACTIVE';

export interface LoginGuardValidationResult {
  allowed: boolean;
  code: LoginGuardStatusCode;
  message: string;
  redirectMode: LoginPortalMode | null;
  resolvedBlok?: string | null;
  pengurusUsername?: string | null;
  isActivePengurus?: boolean;
  isActiveWarga?: boolean;
  wargaAccountStatus?: WargaAccountStatus;
}

export type CentralSettingPermissionMap = Partial<Record<CentralSettingKey, PermissionGrantStatus>>;

export interface SyncPengurusToWargaInput {
  session: SessionUser;
  targetIdentifier: string;
  isActivePengurus: boolean;
  reason?: string;
  accounts?: Warga[];
}

export interface SyncPengurusToWargaResult {
  ok: boolean;
  action: 'SYNC_PENGURUS_TO_WARGA' | 'ACTIVATE_PENGURUS_EXCLUSIVE';
  targetBlokRumah: string;
  pengurusUsername: string;
  linkedWargaBlok: string | null;
  isActivePengurus: boolean;
  isActiveWarga: boolean;
  wargaAccountStatus: WargaAccountStatus;
  revokedPermissionsCount: number;
  restoredWargaCount: number;
  updatedAccounts?: Warga[];
}

export interface CentralPermissionServiceResult<T> {
  data?: T;
  error?: string;
}

export function normalizePengurusUsername(rawInput?: string | null): string {
  const compact = String(rawInput || '')
    .trim()
    .toLowerCase()
    .replace(/[\s.]+/g, '');
  if (compact === 'admin') return 'andriansyah';
  if (compact === 'paiwan') return 'bpiwan';
  return compact;
}

export function canonicalizeResidentBlok(rawBlok?: string | null): string {
  const normalized = normalizeBlok(String(rawBlok || '')).replace(/-/g, '/');
  if (!normalized) return '';
  const match = normalized.match(/^([A-Z]+)0*(\d+)\/0*(\d+)$/);
  if (match) {
    return `${match[1]}${match[2]}/${match[3]}`;
  }
  return normalized;
}

export function isValidCentralSettingKey(key: string): key is CentralSettingKey {
  return (CENTRAL_SETTING_KEYS as readonly string[]).includes(key);
}

function getLocalPengurusStatusOverrides(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(LOCAL_PENGURUS_STATUS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') {
        result[normalizePengurusUsername(k)] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function saveLocalPengurusStatusOverride(username: string, isActivePengurus: boolean): void {
  try {
    const current = getLocalPengurusStatusOverrides();
    current[normalizePengurusUsername(username)] = isActivePengurus;
    window.localStorage.setItem(LOCAL_PENGURUS_STATUS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Abaikan kuota storage penuh
  }
}

export function getEffectiveLocalPengurusActive(username: string): boolean | undefined {
  const norm = normalizePengurusUsername(username);
  if (!norm) return undefined;
  const overrides = getLocalPengurusStatusOverrides();
  return overrides[norm];
}

export function readLocalCentralPermissions(): PengurusSettingsPermissionRow[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_PERMISSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PengurusSettingsPermissionRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalCentralPermissions(rows: PengurusSettingsPermissionRow[]): void {
  try {
    window.localStorage.setItem(LOCAL_PERMISSIONS_STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Abaikan kuota storage penuh
  }
}

function isBendaharaActor(
  actor: Pick<
    SessionUser | AccountLoginGuardRecord,
    'blok_rumah' | 'role' | 'jabatan' | 'admin_permission' | 'is_active_pengurus'
  >
): boolean {
  if (actor.is_active_pengurus === false) {
    return false;
  }
  const role = String(actor.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'bendahara') {
    return false;
  }
  const username = normalizePengurusUsername(actor.blok_rumah);
  const isBendaharaIdentity =
    actor.jabatan === 'Bendahara' || role === 'bendahara' || username === 'andriansyah';
  if (!isBendaharaIdentity) {
    return false;
  }
  return actor.admin_permission === 'full' || actor.admin_permission === undefined;
}

/**
 * Mengevaluasi apakah seorang Pengurus berhak mengakses modul Pengaturan Sistem Terpusat tertentu.
 * - Secara default HANYA Bendahara (Andriansyah) aktif yang memiliki akses penuh ke seluruh modul.
 * - Pengurus lain (Ketua, Humas, Pembina, Seksi Olahraga) hanya diizinkan bila status Pengurus aktif
 *   dan Bendahara memberikan status `granted` pada kunci modul di `pengurus_settings_permissions`.
 */
export function canAccessCentralSetting(
  actor: SessionUser | AccountLoginGuardRecord | null | undefined,
  settingKey: CentralSettingKey,
  permissions?: CentralSettingPermissionMap | PengurusSettingsPermissionRow[] | null
): boolean {
  if (!actor || !isValidCentralSettingKey(settingKey)) {
    return false;
  }

  if ('aktif' in actor && actor.aktif === false) {
    return false;
  }

  if (actor.is_active_pengurus === false) {
    return false;
  }

  const role = String(actor.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'bendahara') {
    return false;
  }

  if (isBendaharaActor(actor)) {
    return true;
  }

  const canonicalUsername = normalizePengurusUsername(actor.blok_rumah);
  if (!canonicalUsername) {
    return false;
  }

  if (Array.isArray(permissions)) {
    const matched = permissions.find(
      (row) =>
        normalizePengurusUsername(row.pengurus_username) === canonicalUsername &&
        row.setting_key === settingKey
    );
    return matched?.status === 'granted';
  }

  if (permissions && typeof permissions === 'object') {
    return permissions[settingKey] === 'granted';
  }

  if ('central_settings_permissions' in actor && actor.central_settings_permissions) {
    return actor.central_settings_permissions[settingKey] === 'granted';
  }

  return false;
}

/**
 * Validasi aturan eksklusivitas akun Pengurus vs Warga pada saat login:
 * - Pengguna berstatus Pengurus aktif (`is_active_pengurus = true`) otomatis DITOLAK masuk lewat jalur
 *   Warga maupun memakai unit/blok rumahnya, dan diarahkan ke jalur Pengurus.
 * - Pengurus yang telah dicabut statusnya (`is_active_pengurus = false`) otomatis dialihkan ke jalur
 *   Warga/Blok karena akun Warga miliknya telah dipulihkan (`is_active_warga = true`, `warga_account_status = 'active'`).
 */
export function validateLoginByAccountStatus(params: {
  loginMode: LoginPortalMode;
  identifier: string;
  account?: AccountLoginGuardRecord | null;
  linkedPengurus?: AccountLoginGuardRecord | null;
  knownPengurusList?: readonly PengurusItem[];
}): LoginGuardValidationResult {
  const { loginMode, identifier, account, linkedPengurus } = params;
  const rawIdentifier = String(identifier || '').trim();

  if (loginMode !== 'warga' && loginMode !== 'admin') {
    return {
      allowed: false,
      code: 'INVALID_LOGIN_MODE',
      message: 'Jalur login tidak dikenali. Pilih jalur Warga atau jalur Pengurus.',
      redirectMode: null,
    };
  }

  if (!rawIdentifier) {
    return {
      allowed: false,
      code: 'EMPTY_IDENTIFIER',
      message:
        loginMode === 'admin'
          ? 'Mohon lengkapi Username Pengurus dan PIN 6 digit Anda.'
          : 'Mohon lengkapi Blok/No. Rumah dan PIN 6 digit Anda.',
      redirectMode: null,
    };
  }

  const normUsername = normalizePengurusUsername(rawIdentifier);
  const canonBlok = canonicalizeResidentBlok(rawIdentifier);
  const statusOverrides = getLocalPengurusStatusOverrides();
  const pengurusCatalog = params.knownPengurusList || SUSUNAN_PENGURUS;

  const matchedCatalogPengurus = pengurusCatalog.find((p) => {
    const pUser = normalizePengurusUsername(p.username);
    const pBlok = canonicalizeResidentBlok(p.blokRumah);
    return pUser === normUsername || (canonBlok !== '' && pBlok === canonBlok);
  });

  const catalogOverrideActive = matchedCatalogPengurus
    ? statusOverrides[normalizePengurusUsername(matchedCatalogPengurus.username)]
    : undefined;

  const linkedPengurusActive =
    linkedPengurus !== undefined && linkedPengurus !== null
      ? linkedPengurus.is_active_pengurus === true && linkedPengurus.aktif !== false
      : catalogOverrideActive !== undefined
        ? catalogOverrideActive
        : undefined;

  if (loginMode === 'warga') {
    const accountIsActivePengurus =
      account?.is_active_pengurus === true ||
      ((account?.role === 'admin' || account?.role === 'bendahara') &&
        account?.is_active_pengurus !== false &&
        account?.aktif !== false);

    const accountSuspendedAsPengurus =
      account?.warga_account_status === 'suspended_pengurus' ||
      (account?.is_active_warga === false && Boolean(account?.linked_pengurus_username));

    const inferredActivePengurusFromCatalog =
      account === undefined &&
      Boolean(matchedCatalogPengurus) &&
      catalogOverrideActive !== false;

    if (
      accountIsActivePengurus ||
      accountSuspendedAsPengurus ||
      linkedPengurusActive === true ||
      inferredActivePengurusFromCatalog
    ) {
      const displayName =
        linkedPengurus?.nama_warga ||
        account?.nama_warga ||
        matchedCatalogPengurus?.nama ||
        'Pengurus';
      const displayJabatan =
        linkedPengurus?.jabatan ||
        account?.jabatan ||
        matchedCatalogPengurus?.jabatan ||
        'Pengurus';

      return {
        allowed: false,
        code: 'PENGURUS_MUST_USE_ADMIN_PORTAL',
        redirectMode: 'admin',
        resolvedBlok: account?.blok_rumah || canonBlok || rawIdentifier,
        pengurusUsername:
          linkedPengurus?.blok_rumah ||
          account?.linked_pengurus_username ||
          matchedCatalogPengurus?.username ||
          null,
        isActivePengurus: true,
        isActiveWarga: false,
        wargaAccountStatus: 'suspended_pengurus',
        message: `Akun ini terdaftar sebagai Pengurus aktif (${displayName} — ${displayJabatan}) dan tidak dapat login lewat jalur Warga atau Blok. Silakan masuk melalui jalur Pengurus.`,
      };
    }

    if (
      account &&
      (account.aktif === false ||
        account.is_active_warga === false ||
        account.warga_account_status === 'inactive')
    ) {
      return {
        allowed: false,
        code: 'WARGA_ACCOUNT_INACTIVE',
        redirectMode: null,
        resolvedBlok: account.blok_rumah,
        isActivePengurus: false,
        isActiveWarga: false,
        wargaAccountStatus: 'inactive',
        message:
          'Akun Warga/Blok ini sedang dinonaktifkan. Silakan hubungi Pengurus atau Bendahara lingkungan.',
      };
    }

    return {
      allowed: true,
      code: 'OK',
      redirectMode: null,
      resolvedBlok: account?.blok_rumah || canonBlok || rawIdentifier,
      isActivePengurus: false,
      isActiveWarga: true,
      wargaAccountStatus: 'active',
      message: 'Akun Warga valid untuk masuk melalui jalur Warga.',
    };
  }

  // loginMode === 'admin'
  if (
    account?.is_active_pengurus === false ||
    (matchedCatalogPengurus && catalogOverrideActive === false)
  ) {
    return {
      allowed: false,
      code: 'PENGURUS_REVOKED_USE_WARGA',
      redirectMode: 'warga',
      resolvedBlok:
        account?.linked_warga_blok ||
        matchedCatalogPengurus?.blokRumah ||
        account?.blok_rumah ||
        null,
      pengurusUsername:
        normalizePengurusUsername(account?.blok_rumah || matchedCatalogPengurus?.username) || null,
      isActivePengurus: false,
      isActiveWarga: true,
      wargaAccountStatus: 'active',
      message:
        'Status Pengurus akun ini telah dicabut/dinonaktifkan. Hak akses Pengurus tidak lagi berlaku dan akun Warga/Blok Anda telah diaktifkan kembali — silakan masuk lewat jalur Warga.',
    };
  }

  if (account && account.role === 'warga' && account.is_active_pengurus !== true) {
    return {
      allowed: false,
      code: 'NOT_ACTIVE_PENGURUS',
      redirectMode: 'warga',
      resolvedBlok: account.blok_rumah,
      isActivePengurus: false,
      isActiveWarga: account.is_active_warga !== false,
      wargaAccountStatus:
        account.warga_account_status === 'inactive' ? 'inactive' : 'active',
      message:
        'Akun ini terdaftar sebagai akun Warga biasa dan bukan Pengurus aktif. Silakan masuk lewat jalur Warga.',
    };
  }

  if (account && account.aktif === false) {
    return {
      allowed: false,
      code: 'PENGURUS_INACTIVE',
      redirectMode: null,
      resolvedBlok: account.blok_rumah,
      isActivePengurus: false,
      isActiveWarga: false,
      wargaAccountStatus: 'inactive',
      message: 'Akun Pengurus ini sedang tidak aktif. Hubungi Bendahara lingkungan.',
    };
  }

  return {
    allowed: true,
    code: 'OK',
    redirectMode: null,
    resolvedBlok: account?.blok_rumah || normUsername,
    pengurusUsername:
      normalizePengurusUsername(account?.blok_rumah || matchedCatalogPengurus?.username || normUsername) ||
      null,
    isActivePengurus: true,
    isActiveWarga: false,
    wargaAccountStatus: 'suspended_pengurus',
    message: 'Akun Pengurus aktif valid.',
  };
}

/**
 * Memvalidasi status login langsung terhadap fungsi RPC `validate_login_account_status` di Supabase,
 * dengan fallback deterministik ke `validateLoginByAccountStatus`.
 */
export async function verifyLoginStatusWithSupabase(
  loginMode: LoginPortalMode,
  identifier: string,
  localAccount?: AccountLoginGuardRecord | null,
  localLinkedPengurus?: AccountLoginGuardRecord | null
): Promise<LoginGuardValidationResult> {
  const preCheck = validateLoginByAccountStatus({
    loginMode,
    identifier,
    account: localAccount,
    linkedPengurus: localLinkedPengurus,
  });

  const supabase = getSupabaseClient(null);
  if (!supabase || !isSupabaseConfigured()) {
    return preCheck;
  }

  try {
    const { data, error } = await supabase.rpc('validate_login_account_status', {
      p_identifier: identifier.trim(),
      p_login_mode: loginMode,
    });

    if (error || !data || typeof data !== 'object') {
      return preCheck;
    }

    const row = data as Record<string, unknown>;
    const code = (typeof row.code === 'string' ? row.code : 'OK') as LoginGuardStatusCode;
    const allowed = Boolean(row.allowed);
    const redirectMode: LoginPortalMode | null =
      code === 'PENGURUS_MUST_USE_ADMIN_PORTAL'
        ? 'admin'
        : code === 'PENGURUS_REVOKED_USE_WARGA' || code === 'NOT_ACTIVE_PENGURUS'
          ? 'warga'
          : null;

    return {
      allowed,
      code,
      message:
        typeof row.message === 'string' && row.message
          ? row.message
          : preCheck.message,
      redirectMode,
      resolvedBlok: typeof row.blok_rumah === 'string' ? row.blok_rumah : preCheck.resolvedBlok,
      pengurusUsername:
        typeof row.pengurus_username === 'string'
          ? row.pengurus_username
          : preCheck.pengurusUsername,
      isActivePengurus:
        typeof row.is_active_pengurus === 'boolean'
          ? row.is_active_pengurus
          : preCheck.isActivePengurus,
      isActiveWarga:
        typeof row.is_active_warga === 'boolean' ? row.is_active_warga : preCheck.isActiveWarga,
      wargaAccountStatus:
        row.warga_account_status === 'active' ||
        row.warga_account_status === 'suspended_pengurus' ||
        row.warga_account_status === 'inactive'
          ? row.warga_account_status
          : preCheck.wargaAccountStatus,
    };
  } catch {
    return preCheck;
  }
}

/**
 * Menyinkronkan status Pengurus <-> Warga/Blok:
 * - Jika `isActivePengurus = false`: otomatis mengaktifkan kembali akun Warga/Blok miliknya
 *   (`is_active_warga = true`, `warga_account_status = 'active'`) dan langsung mencabut
 *   seluruh hak akses Pengurus (`pengurus_settings_permissions` = `'revoked'`, `admin_permission` dicabut).
 * - Jika `isActivePengurus = true`: mengaktifkan status Pengurus eksklusif dan menangguhkan jalur Warga/Blok.
 */
export async function syncPengurusToWargaStatus(
  params: SyncPengurusToWargaInput
): Promise<CentralPermissionServiceResult<SyncPengurusToWargaResult>> {
  const { session, targetIdentifier, isActivePengurus, reason, accounts } = params;
  const cleanTarget = String(targetIdentifier || '').trim();

  if (!cleanTarget) {
    return { error: 'Target akun Pengurus atau Blok Rumah wajib diisi.' };
  }

  const hasPermission =
    isBendaharaActor(session) ||
    canAccessCentralSetting(
      session,
      'settings.residents_blocks',
      session.central_settings_permissions || readLocalCentralPermissions()
    );

  if (!hasPermission) {
    return {
      error:
        'Akses ditolak: hanya Bendahara atau Pengurus berizin settings.residents_blocks yang dapat mengubah status Pengurus.',
    };
  }

  const targetNormUser = normalizePengurusUsername(cleanTarget);
  const targetCanonBlok = canonicalizeResidentBlok(cleanTarget);
  const catalogMatch = SUSUNAN_PENGURUS.find(
    (p) =>
      normalizePengurusUsername(p.username) === targetNormUser ||
      (targetCanonBlok !== '' && canonicalizeResidentBlok(p.blokRumah) === targetCanonBlok)
  );

  const isTargetBendahara =
    catalogMatch?.jabatan === 'Bendahara' || targetNormUser === 'andriansyah';
  if (isTargetBendahara && !isActivePengurus) {
    return {
      error:
        'Tidak dapat menonaktifkan satu-satunya Bendahara aktif. Minimal harus ada 1 Bendahara aktif.',
    };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('sync_pengurus_to_warga_status', {
        p_target_identifier: cleanTarget,
        p_is_active_pengurus: isActivePengurus,
        p_reason: reason?.trim() || null,
      });

      if (error) {
        return {
          error: error.message || 'Gagal menyinkronkan status Pengurus ke akun Warga.',
        };
      }

      const row = (data || {}) as Record<string, unknown>;
      const resolvedUsername =
        typeof row.pengurus_username === 'string'
          ? row.pengurus_username
          : catalogMatch?.username || targetNormUser;
      saveLocalPengurusStatusOverride(resolvedUsername, isActivePengurus);

      return {
        data: {
          ok: Boolean(row.ok ?? true),
          action:
            row.action === 'ACTIVATE_PENGURUS_EXCLUSIVE'
              ? 'ACTIVATE_PENGURUS_EXCLUSIVE'
              : 'SYNC_PENGURUS_TO_WARGA',
          targetBlokRumah:
            typeof row.target_blok_rumah === 'string' ? row.target_blok_rumah : cleanTarget,
          pengurusUsername: resolvedUsername,
          linkedWargaBlok:
            typeof row.linked_warga_blok === 'string' ? row.linked_warga_blok : null,
          isActivePengurus: Boolean(row.is_active_pengurus ?? isActivePengurus),
          isActiveWarga: Boolean(row.is_active_warga ?? !isActivePengurus),
          wargaAccountStatus:
            row.warga_account_status === 'suspended_pengurus' ||
            row.warga_account_status === 'inactive'
              ? row.warga_account_status
              : isActivePengurus
                ? 'suspended_pengurus'
                : 'active',
          revokedPermissionsCount:
            typeof row.revoked_permissions_count === 'number'
              ? row.revoked_permissions_count
              : 0,
          restoredWargaCount:
            typeof row.restored_warga_count === 'number' ? row.restored_warga_count : 0,
        },
      };
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? err.message
            : 'Terjadi kesalahan saat menyinkronkan status Pengurus ke Warga.',
      };
    }
  }

  // Fallback Mode Lokal / Pengujian Deterministik
  const resolvedUsername = catalogMatch
    ? normalizePengurusUsername(catalogMatch.username)
    : targetNormUser;
  const resolvedLinkedBlok = catalogMatch
    ? canonicalizeResidentBlok(catalogMatch.blokRumah)
    : targetCanonBlok || null;
  const nowIso = new Date().toISOString();
  const actorUsername = normalizePengurusUsername(session.blok_rumah) || 'andriansyah';

  saveLocalPengurusStatusOverride(resolvedUsername, isActivePengurus);

  let revokedPermissionsCount = 0;
  if (!isActivePengurus) {
    const existingPerms = readLocalCentralPermissions();
    const updatedPerms = existingPerms.map((perm) => {
      if (
        normalizePengurusUsername(perm.pengurus_username) === resolvedUsername &&
        perm.status === 'granted'
      ) {
        revokedPermissionsCount += 1;
        return {
          ...perm,
          status: 'revoked' as const,
          revoked_by: actorUsername,
          revoked_at: nowIso,
          notes: reason?.trim() || 'Dicabut otomatis karena status Pengurus dinonaktifkan.',
          updated_at: nowIso,
        };
      }
      return perm;
    });
    writeLocalCentralPermissions(updatedPerms);
  }

  let restoredWargaCount = 0;
  const updatedAccounts = accounts?.map((w) => {
    const canonWarga = canonicalizeResidentBlok(w.blok_rumah);
    const linkedPengurus = normalizePengurusUsername(w.linked_pengurus_username);
    const matchesTarget =
      normalizePengurusUsername(w.blok_rumah) === resolvedUsername ||
      (resolvedLinkedBlok !== null && canonWarga === resolvedLinkedBlok) ||
      (linkedPengurus !== '' && linkedPengurus === resolvedUsername);

    if (!matchesTarget) return w;

    if (!isActivePengurus) {
      restoredWargaCount += 1;
      return {
        ...w,
        aktif: true,
        is_active_pengurus: false,
        is_active_warga: true,
        warga_account_status: 'active' as const,
        pengurus_status_updated_at: nowIso,
        pengurus_status_updated_by: actorUsername,
      };
    }

    return {
      ...w,
      is_active_pengurus: normalizePengurusUsername(w.blok_rumah) === resolvedUsername,
      is_active_warga: false,
      warga_account_status: 'suspended_pengurus' as const,
      pengurus_status_updated_at: nowIso,
      pengurus_status_updated_by: actorUsername,
    };
  });

  const action = isActivePengurus ? 'ACTIVATE_PENGURUS_EXCLUSIVE' : 'SYNC_PENGURUS_TO_WARGA';

  await recordAuditLog({
    session,
    action,
    entity: 'users_warga',
    entity_id: resolvedUsername,
    summary: isActivePengurus
      ? `Akun Pengurus ${resolvedUsername} diaktifkan secara eksklusif; akun Warga ${resolvedLinkedBlok || '-'} ditangguhkan.`
      : `Status Pengurus ${resolvedUsername} dicabut; akun Warga/Blok (${resolvedLinkedBlok || '-'}) otomatis diaktifkan kembali & ${revokedPermissionsCount} izin terpusat dicabut.`,
    metadata: {
      pengurus_username: resolvedUsername,
      linked_warga_blok: resolvedLinkedBlok,
      is_active_pengurus: isActivePengurus,
      is_active_warga: !isActivePengurus,
      warga_account_status: isActivePengurus ? 'suspended_pengurus' : 'active',
      revoked_permissions_count: revokedPermissionsCount,
      restored_warga_count: restoredWargaCount,
      reason: reason || null,
    },
  });

  return {
    data: {
      ok: true,
      action,
      targetBlokRumah: catalogMatch?.username || cleanTarget,
      pengurusUsername: resolvedUsername,
      linkedWargaBlok: resolvedLinkedBlok,
      isActivePengurus,
      isActiveWarga: !isActivePengurus,
      wargaAccountStatus: isActivePengurus ? 'suspended_pengurus' : 'active',
      revokedPermissionsCount,
      restoredWargaCount,
      updatedAccounts,
    },
  };
}

export async function fetchPengurusSettingsPermissions(
  session: SessionUser,
  targetUsername?: string
): Promise<CentralPermissionServiceResult<PengurusSettingsPermissionRow[]>> {
  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('get_pengurus_central_permissions', {
        p_pengurus_username: targetUsername ? normalizePengurusUsername(targetUsername) : null,
      });
      if (error) {
        return { error: error.message || 'Gagal memuat matriks izin pengaturan terpusat.' };
      }
      const rows = (Array.isArray(data) ? data : []) as PengurusSettingsPermissionRow[];
      return { data: rows };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Gagal menghubungi server izin terpusat.',
      };
    }
  }

  const localRows = readLocalCentralPermissions();
  const filtered = targetUsername
    ? localRows.filter(
        (r) =>
          normalizePengurusUsername(r.pengurus_username) ===
          normalizePengurusUsername(targetUsername)
      )
    : localRows;
  return { data: filtered };
}

export async function setPengurusSettingPermission(params: {
  session: SessionUser;
  pengurusUsername: string;
  settingKey: CentralSettingKey;
  status: PermissionGrantStatus;
  notes?: string;
}): Promise<CentralPermissionServiceResult<PengurusSettingsPermissionRow>> {
  const { session, pengurusUsername, settingKey, status, notes } = params;
  if (!isBendaharaActor(session)) {
    return {
      error:
        'Akses ditolak: hanya Bendahara aktif (Andriansyah) yang dapat mengatur delegasi izin pengaturan sistem terpusat.',
    };
  }

  const normUser = normalizePengurusUsername(pengurusUsername);
  if (!normUser || normUser === 'andriansyah') {
    return {
      error: 'Hak pengaturan sistem terpusat Bendahara selalu penuh secara default.',
    };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('set_pengurus_setting_permission', {
        p_pengurus_username: normUser,
        p_setting_key: settingKey,
        p_status: status,
        p_notes: notes?.trim() || null,
      });
      if (error) {
        return { error: error.message || 'Gagal menyimpan izin pengaturan terpusat.' };
      }
      return { data: data as PengurusSettingsPermissionRow };
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Gagal menyimpan delegasi izin ke server.',
      };
    }
  }

  const nowIso = new Date().toISOString();
  const actor = normalizePengurusUsername(session.blok_rumah) || 'andriansyah';
  const rows = readLocalCentralPermissions();
  const idx = rows.findIndex(
    (r) =>
      normalizePengurusUsername(r.pengurus_username) === normUser && r.setting_key === settingKey
  );
  const nextRow: PengurusSettingsPermissionRow = {
    id: idx >= 0 ? rows[idx].id : `psp-${normUser}-${settingKey}`,
    pengurus_username: normUser,
    setting_key: settingKey,
    status,
    granted_by: status === 'granted' ? actor : idx >= 0 ? rows[idx].granted_by : null,
    granted_at: status === 'granted' ? nowIso : idx >= 0 ? rows[idx].granted_at : null,
    revoked_by: status === 'revoked' ? actor : idx >= 0 ? rows[idx].revoked_by : null,
    revoked_at: status === 'revoked' ? nowIso : idx >= 0 ? rows[idx].revoked_at : null,
    notes: notes?.trim() || null,
    updated_at: nowIso,
  };

  if (idx >= 0) {
    rows[idx] = nextRow;
  } else {
    rows.push(nextRow);
  }
  writeLocalCentralPermissions(rows);

  await recordAuditLog({
    session,
    action:
      status === 'granted'
        ? 'GRANT_PENGURUS_SETTING_PERMISSION'
        : 'REVOKE_PENGURUS_SETTING_PERMISSION',
    entity: 'pengurus_settings_permissions',
    entity_id: `${normUser}:${settingKey}`,
    summary: `Bendahara mengubah izin ${settingKey} untuk ${normUser} menjadi ${status.toUpperCase()}.`,
    metadata: {
      pengurus_username: normUser,
      setting_key: settingKey,
      status,
      notes: notes || null,
    },
  });

  return { data: nextRow };
}
