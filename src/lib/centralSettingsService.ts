import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CENTRAL_SETTING_MODULES,
  SUSUNAN_PENGURUS,
  isBendaharaOnly,
  type CentralSettingModuleKey,
  type ChatModerationPolicy,
  type LoginAccountValidationStatus,
  type PengurusAccountInfo,
  type PengurusSettingPermissionRecord,
  type PengurusWargaSyncStatus,
  type SessionUser,
  type SettingPermissionStatus,
  type Warga,
} from '../types';
import { getSupabaseClient, getSupabaseProbeClient, isSupabaseConfigured } from './supabase';
import { recordAuditLog } from './auditLogger';

const LOCAL_PERMISSIONS_KEY = 'saungkebun_pengurus_setting_permissions_v1';
const LOCAL_PENGURUS_STATUS_KEY = 'saungkebun_pengurus_active_status_v1';
const LOCAL_CHAT_MODERATION_KEY = 'saungkebun_chat_moderation_policy_v1';

const ALL_MODULE_KEYS: CentralSettingModuleKey[] = CENTRAL_SETTING_MODULES.map((m) => m.key);

export const DEFAULT_CHAT_MODERATION_POLICY: ChatModerationPolicy = {
  allow_warga_attachments: true,
  pengurus_only_announcements: true,
  retention_days: 90,
  updated_at: '2026-11-01T07:00:00.000Z',
  updated_by: 'andriansyah',
};

function safeGetStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  } catch {
    // Abaikan jika kuota storage penuh
  }
}

export function normalizeBlokCompact(raw: string): string {
  const clean = raw.trim().toUpperCase().replace(/\s+/g, '');
  const match = clean.match(/^([A-Z]+)(\d+)[\/\-]?(\d+)$/);
  if (!match) return clean;
  const [, prefix, blockNum, houseNum] = match;
  return `${prefix}${Number(blockNum)}/${Number(houseNum)}`;
}

export function normalizePengurusUsernameKey(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/\s+/g, '').replace(/^@/, '');
  if (clean === 'admin' || clean === 'bendahara') return 'andriansyah';
  if (clean === 'paiwan' || clean === 'pakiwan' || clean === 'iwan') return 'bpiwan';
  if (clean === 'deni') return 'deny';
  return clean;
}

function findPengurusByIdentifier(raw: string) {
  const compactKey = normalizePengurusUsernameKey(raw);
  const compactBlok = normalizeBlokCompact(raw);
  return (
    SUSUNAN_PENGURUS.find((p) => {
      const u = p.username.toLowerCase();
      const b = normalizeBlokCompact(p.blokRumah);
      return u === compactKey || b === compactBlok;
    }) || null
  );
}

function readLocalPermissionsMap(): Record<
  string,
  Partial<Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>>
> {
  try {
    const raw = safeGetStorage(LOCAL_PERMISSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<
      string,
      Partial<Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>>
    >;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalPermissionsMap(
  map: Record<string, Partial<Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>>>
): void {
  safeSetStorage(LOCAL_PERMISSIONS_KEY, JSON.stringify(map));
}

function readLocalPengurusStatusMap(): Record<string, boolean> {
  try {
    const raw = safeGetStorage(LOCAL_PENGURUS_STATUS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalPengurusStatusMap(map: Record<string, boolean>): void {
  safeSetStorage(LOCAL_PENGURUS_STATUS_KEY, JSON.stringify(map));
}

function isRpcSignatureMismatchError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string; details?: string };
  const code = String(err.code || '').toUpperCase();
  const msg = `${err.message || ''} ${err.details || ''}`.toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('in the schema cache')
  );
}

async function callRpcWithSignatureFallback<T = unknown>(
  supabase: SupabaseClient,
  fnName: string,
  payloadVariants: Array<Record<string, unknown>>
): Promise<{ data: T | null; error: { message: string; code?: string } | null; matched: boolean }> {
  let lastError: { message: string; code?: string } | null = null;

  for (const params of payloadVariants) {
    const { data, error } = await supabase.rpc(fnName, params);
    if (!error) {
      return { data: data as T, error: null, matched: true };
    }
    lastError = {
      message: error.message || 'Gagal memanggil fungsi RPC server.',
      code: error.code,
    };
    if (!isRpcSignatureMismatchError(error)) {
      return { data: null, error: lastError, matched: true };
    }
  }

  return { data: null, error: lastError, matched: false };
}

function coerceBoolean(val: unknown, fallback = false): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') {
    const v = val.trim().toLowerCase();
    if (['true', 't', '1', 'yes', 'active', 'aktif'].includes(v)) return true;
    if (['false', 'f', '0', 'no', 'inactive', 'nonaktif', 'revoked'].includes(v)) return false;
  }
  return fallback;
}

function coerceString(val: unknown): string | null {
  if (typeof val === 'string' && val.trim()) return val.trim();
  return null;
}

function parseValidationRow(
  raw: unknown,
  identifier: string,
  portal: 'warga' | 'admin' | 'petugas'
): LoginAccountValidationStatus | null {
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null | undefined;
  if (!row || typeof row !== 'object') return null;

  const isActivePengurus = coerceBoolean(
    row.is_active_pengurus ?? row.pengurus_active ?? row.active_pengurus,
    false
  );
  const wargaStatusRaw =
    coerceString(row.warga_account_status ?? row.warga_status) ||
    (coerceBoolean(row.is_active_warga, false) ? 'active' : 'inactive');
  const isActiveWarga = coerceBoolean(
    row.is_active_warga ?? (wargaStatusRaw.toLowerCase() === 'active'),
    wargaStatusRaw.toLowerCase() === 'active'
  );
  const pengurusStatusRaw =
    coerceString(row.pengurus_account_status ?? row.pengurus_status) ||
    (isActivePengurus ? 'active' : 'inactive');

  const pengurusUsername =
    coerceString(row.pengurus_username ?? row.admin_username ?? row.username) || null;
  const pengurusNama =
    coerceString(row.pengurus_nama ?? row.nama_pengurus ?? row.nama_warga ?? row.nama) || null;
  const pengurusJabatan = coerceString(row.pengurus_jabatan ?? row.jabatan) || null;
  const linkedBlok =
    coerceString(row.linked_blok_rumah ?? row.warga_blok_rumah ?? row.blok_rumah) || null;

  const rawAllowed = coerceString(row.allowed_portal ?? row.target_portal)?.toLowerCase();
  const allowedPortal: LoginAccountValidationStatus['allowed_portal'] =
    rawAllowed === 'admin' || rawAllowed === 'pengurus'
      ? 'admin'
      : rawAllowed === 'warga'
        ? 'warga'
        : rawAllowed === 'petugas'
          ? 'petugas'
          : rawAllowed === 'none'
            ? 'none'
            : null;

  let reasonCode: LoginAccountValidationStatus['reason_code'] = 'OK';
  let canLogin = row.can_login !== undefined ? coerceBoolean(row.can_login, true) : true;
  let message = coerceString(row.message ?? row.reason ?? row.keterangan);

  if (portal === 'warga' && isActivePengurus) {
    reasonCode = 'ACTIVE_PENGURUS_BLOCKED_ON_WARGA';
    canLogin = false;
    if (!message) {
      const who = [pengurusNama, pengurusJabatan].filter(Boolean).join(' · ');
      message = `Akun ${linkedBlok || identifier} terdaftar sebagai Pengurus aktif${
        who ? ` (${who})` : ''
      }. Sesuai kebijakan eksklusivitas akun, silakan masuk melalui Portal Pengurus.`;
    }
  } else if (portal === 'admin' && !isActivePengurus) {
    const wargaRestored = isActiveWarga || wargaStatusRaw.toLowerCase() === 'active';
    const isKnownPengurus =
      Boolean(pengurusUsername) ||
      Boolean(findPengurusByIdentifier(identifier)) ||
      pengurusStatusRaw.toLowerCase() === 'inactive' ||
      pengurusStatusRaw.toLowerCase() === 'revoked' ||
      pengurusStatusRaw.toLowerCase() === 'deactivated';

    if (wargaRestored && isKnownPengurus) {
      reasonCode = 'PENGURUS_REVOKED_WARGA_RESTORED';
      canLogin = false;
      if (!message) {
        message = `Hak akses Pengurus untuk akun ini telah dinonaktifkan. Akun Warga / Blok ${
          linkedBlok || findPengurusByIdentifier(identifier)?.blokRumah || ''
        } Anda telah otomatis aktif kembali dan dapat digunakan melalui Portal Warga.`;
      }
    } else if (row.can_login === false) {
      reasonCode = 'ACCOUNT_INACTIVE';
      canLogin = false;
    }
  }

  return {
    identifier,
    portal,
    is_active_pengurus: isActivePengurus,
    is_active_warga: isActiveWarga,
    warga_account_status: wargaStatusRaw.toLowerCase(),
    pengurus_account_status: pengurusStatusRaw.toLowerCase(),
    pengurus_username: pengurusUsername,
    pengurus_nama: pengurusNama,
    pengurus_jabatan: pengurusJabatan,
    linked_blok_rumah: linkedBlok,
    allowed_portal: allowedPortal,
    can_login: canLogin,
    reason_code: reasonCode,
    message,
    source: 'rpc',
  };
}

/**
 * Memvalidasi status eksklusivitas akun Pengurus vs. Warga melalui RPC `validate_login_account_status`
 * dengan header identitas sesi (`x-user-role`, `x-blok-rumah`, dan `x-petugas-id` bila relevan).
 */
export async function validateLoginAccountStatus(params: {
  identifier: string;
  portal: 'warga' | 'admin' | 'petugas';
  petugasId?: string;
}): Promise<LoginAccountValidationStatus> {
  const rawIdentifier = params.identifier.trim();
  const normalizedBlok =
    params.portal === 'warga'
      ? normalizeBlokCompact(rawIdentifier)
      : normalizePengurusUsernameKey(rawIdentifier);

  const probeClient = getSupabaseProbeClient({
    role: params.portal,
    blokRumah: normalizedBlok || rawIdentifier,
    petugasId: params.petugasId,
  });

  if (probeClient && isSupabaseConfigured() && rawIdentifier) {
    try {
      const portalVariant = params.portal === 'admin' ? 'pengurus' : params.portal;
      const rpcRes = await callRpcWithSignatureFallback(probeClient, 'validate_login_account_status', [
        { p_identifier: normalizedBlok || rawIdentifier, p_login_portal: params.portal },
        { p_identifier: normalizedBlok || rawIdentifier, p_portal: params.portal },
        { p_identifier: normalizedBlok || rawIdentifier, p_portal: portalVariant },
        { p_blok: normalizedBlok || rawIdentifier, p_portal: params.portal },
        { p_blok_rumah: normalizedBlok || rawIdentifier, p_portal: params.portal },
        { p_blok: normalizedBlok || rawIdentifier, p_role: params.portal },
        { p_username: normalizedBlok || rawIdentifier, p_portal: params.portal },
        { p_identifier: normalizedBlok || rawIdentifier },
        { p_blok: normalizedBlok || rawIdentifier },
        { p_blok_rumah: normalizedBlok || rawIdentifier },
      ]);

      if (rpcRes.matched && !rpcRes.error && rpcRes.data !== null && rpcRes.data !== undefined) {
        const parsed = parseValidationRow(rpcRes.data, normalizedBlok || rawIdentifier, params.portal);
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // Lanjut ke evaluasi fallback lokal yang aman jika koneksi/RPC sementara gagal
    }
  }

  // Fallback konsisten menggunakan daftar pengurus & status lokal (saat offline / demo)
  const localStatuses = readLocalPengurusStatusMap();
  const matchedPengurus = findPengurusByIdentifier(rawIdentifier);

  if (matchedPengurus) {
    const isBendahara = matchedPengurus.permission === 'full' || matchedPengurus.jabatan === 'Bendahara';
    const isActivePengurus = isBendahara
      ? true
      : localStatuses[matchedPengurus.username.toLowerCase()] !== false;
    const isActiveWarga = !isActivePengurus;
    const wargaStatus = isActiveWarga ? 'active' : 'suspended_by_pengurus';

    if (params.portal === 'warga' && isActivePengurus) {
      return {
        identifier: normalizedBlok || rawIdentifier,
        portal: params.portal,
        is_active_pengurus: true,
        is_active_warga: false,
        warga_account_status: wargaStatus,
        pengurus_account_status: 'active',
        pengurus_username: matchedPengurus.username,
        pengurus_nama: matchedPengurus.nama,
        pengurus_jabatan: matchedPengurus.jabatan,
        linked_blok_rumah: matchedPengurus.blokRumah,
        allowed_portal: 'admin',
        can_login: false,
        reason_code: 'ACTIVE_PENGURUS_BLOCKED_ON_WARGA',
        message: `Akun Blok ${matchedPengurus.blokRumah} terdaftar sebagai Pengurus aktif (${matchedPengurus.nama} · ${matchedPengurus.jabatan}). Silakan masuk melalui jalur Portal Pengurus.`,
        source: 'local_fallback',
      };
    }

    if (params.portal === 'admin' && !isActivePengurus) {
      return {
        identifier: normalizedBlok || rawIdentifier,
        portal: params.portal,
        is_active_pengurus: false,
        is_active_warga: true,
        warga_account_status: 'active',
        pengurus_account_status: 'inactive',
        pengurus_username: matchedPengurus.username,
        pengurus_nama: matchedPengurus.nama,
        pengurus_jabatan: matchedPengurus.jabatan,
        linked_blok_rumah: matchedPengurus.blokRumah,
        allowed_portal: 'warga',
        can_login: false,
        reason_code: 'PENGURUS_REVOKED_WARGA_RESTORED',
        message: `Hak akses Pengurus untuk ${matchedPengurus.nama} (@${matchedPengurus.username}) telah dinonaktifkan. Akun Warga Blok ${matchedPengurus.blokRumah} Anda otomatis aktif kembali untuk masuk lewat Portal Warga.`,
        source: 'local_fallback',
      };
    }

    return {
      identifier: normalizedBlok || rawIdentifier,
      portal: params.portal,
      is_active_pengurus: isActivePengurus,
      is_active_warga: isActiveWarga,
      warga_account_status: wargaStatus,
      pengurus_account_status: isActivePengurus ? 'active' : 'inactive',
      pengurus_username: matchedPengurus.username,
      pengurus_nama: matchedPengurus.nama,
      pengurus_jabatan: matchedPengurus.jabatan,
      linked_blok_rumah: matchedPengurus.blokRumah,
      allowed_portal: isActivePengurus ? 'admin' : 'warga',
      can_login: true,
      reason_code: 'OK',
      message: null,
      source: 'local_fallback',
    };
  }

  return {
    identifier: normalizedBlok || rawIdentifier,
    portal: params.portal,
    is_active_pengurus: false,
    is_active_warga: params.portal === 'warga',
    warga_account_status: params.portal === 'warga' ? 'active' : 'none',
    pengurus_account_status: 'none',
    pengurus_username: null,
    pengurus_nama: null,
    pengurus_jabatan: null,
    linked_blok_rumah: params.portal === 'warga' ? normalizedBlok : null,
    allowed_portal: params.portal,
    can_login: true,
    reason_code: 'OK',
    message: null,
    source: 'local_fallback',
  };
}

function buildDefaultPermissionRecord(
  username: string,
  moduleKey: CentralSettingModuleKey,
  status: SettingPermissionStatus,
  grantedBy?: string | null,
  updatedAt?: string | null
): PengurusSettingPermissionRecord {
  return {
    pengurus_username: username.toLowerCase(),
    module_key: moduleKey,
    status,
    granted_by: grantedBy || null,
    updated_at: updatedAt || null,
  };
}

function buildFullGrantedMap(username: string): Record<CentralSettingModuleKey, SettingPermissionStatus> {
  const map = {} as Record<CentralSettingModuleKey, SettingPermissionStatus>;
  for (const key of ALL_MODULE_KEYS) {
    map[key] = 'granted';
  }
  void username;
  return map;
}

function normalizePermissionRow(
  row: Record<string, unknown>
): PengurusSettingPermissionRecord | null {
  const rawUser =
    coerceString(
      row.pengurus_username ??
        row.target_pengurus_username ??
        row.username ??
        row.blok_rumah ??
        row.pengurus_id
    ) || '';
  const rawModule =
    coerceString(row.module_key ?? row.setting_key ?? row.permission_key ?? row.module) || '';
  if (!rawUser || !ALL_MODULE_KEYS.includes(rawModule as CentralSettingModuleKey)) {
    return null;
  }

  const rawStatus = coerceString(row.status ?? row.permission_status)?.toLowerCase();
  const isGranted =
    rawStatus === 'granted' ||
    rawStatus === 'active' ||
    rawStatus === 'allowed' ||
    coerceBoolean(row.is_granted ?? row.granted ?? row.enabled, false);

  return {
    id: coerceString(row.id) || undefined,
    pengurus_username: normalizePengurusUsernameKey(rawUser),
    module_key: rawModule as CentralSettingModuleKey,
    status: isGranted ? 'granted' : 'revoked',
    granted_by: coerceString(row.granted_by ?? row.updated_by) || null,
    updated_at: coerceString(row.updated_at ?? row.created_at) || null,
    notes: coerceString(row.notes ?? row.catatan) || null,
  };
}

async function queryPermissionRowsFromSupabase(
  supabase: SupabaseClient,
  filterUsername?: string
): Promise<PengurusSettingPermissionRecord[] | null> {
  const tableCandidates = ['pengurus_setting_permissions', 'central_setting_permissions'];
  for (const tableName of tableCandidates) {
    const query = supabase.from(tableName).select('*');
    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      const normalized = data
        .map((r) => normalizePermissionRow(r as Record<string, unknown>))
        .filter((r): r is PengurusSettingPermissionRecord => Boolean(r));
      if (filterUsername) {
        const target = normalizePengurusUsernameKey(filterUsername);
        return normalized.filter((r) => r.pengurus_username === target);
      }
      return normalized;
    }
  }
  return null;
}

/**
 * Mengambil peta izin pengaturan terpusat untuk semua Pengurus (khusus tampilan Bendahara).
 */
export async function fetchAllPengurusSettingPermissions(
  session: SessionUser
): Promise<Record<string, Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>>> {
  const result: Record<string, Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>> = {};
  const localMap = readLocalPermissionsMap();

  for (const p of SUSUNAN_PENGURUS) {
    const uname = p.username.toLowerCase();
    const isBendahara = p.permission === 'full' || p.jabatan === 'Bendahara';
    const userRecord = {} as Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>;
    for (const moduleKey of ALL_MODULE_KEYS) {
      const localEntry = localMap[uname]?.[moduleKey];
      userRecord[moduleKey] = isBendahara
        ? buildDefaultPermissionRecord(uname, moduleKey, 'granted', 'system')
        : localEntry || buildDefaultPermissionRecord(uname, moduleKey, 'revoked');
    }
    result[uname] = userRecord;
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const remoteRows = await queryPermissionRowsFromSupabase(supabase);
      if (remoteRows) {
        const nextLocal: Record<
          string,
          Partial<Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>>
        > = { ...localMap };

        for (const p of SUSUNAN_PENGURUS) {
          const uname = p.username.toLowerCase();
          if (p.permission === 'full' || p.jabatan === 'Bendahara') continue;
          nextLocal[uname] = nextLocal[uname] || {};
          for (const moduleKey of ALL_MODULE_KEYS) {
            result[uname][moduleKey] = buildDefaultPermissionRecord(uname, moduleKey, 'revoked');
          }
        }

        for (const row of remoteRows) {
          const uname = row.pengurus_username;
          const isBendahara = SUSUNAN_PENGURUS.some(
            (p) =>
              p.username.toLowerCase() === uname &&
              (p.permission === 'full' || p.jabatan === 'Bendahara')
          );
          if (isBendahara) continue;
          if (!result[uname]) {
            result[uname] = {} as Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>;
            for (const moduleKey of ALL_MODULE_KEYS) {
              result[uname][moduleKey] = buildDefaultPermissionRecord(uname, moduleKey, 'revoked');
            }
          }
          result[uname][row.module_key] = row;
          nextLocal[uname] = { ...(nextLocal[uname] || {}), [row.module_key]: row };
        }

        writeLocalPermissionsMap(nextLocal);
      }
    } catch {
      // Gunakan fallback cache lokal
    }
  }

  return result;
}

/**
 * Mengambil status izin 6 modul pengaturan terpusat untuk Pengurus yang sedang login.
 * Bendahara selalu memiliki status `'granted'` untuk seluruh 6 modul.
 */
export async function fetchMySettingPermissions(
  session: SessionUser
): Promise<Record<CentralSettingModuleKey, SettingPermissionStatus>> {
  const uname = normalizePengurusUsernameKey(session.blok_rumah);
  if (isBendaharaOnly(session)) {
    return buildFullGrantedMap(uname);
  }

  const resolved = {} as Record<CentralSettingModuleKey, SettingPermissionStatus>;
  const localMap = readLocalPermissionsMap();
  for (const key of ALL_MODULE_KEYS) {
    resolved[key] = localMap[uname]?.[key]?.status === 'granted' ? 'granted' : 'revoked';
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const rows = await queryPermissionRowsFromSupabase(supabase, uname);
      if (rows) {
        const nextUserLocal: Partial<
          Record<CentralSettingModuleKey, PengurusSettingPermissionRecord>
        > = {};
        for (const key of ALL_MODULE_KEYS) {
          resolved[key] = 'revoked';
        }
        for (const row of rows) {
          resolved[row.module_key] = row.status;
          nextUserLocal[row.module_key] = row;
        }
        writeLocalPermissionsMap({ ...localMap, [uname]: nextUserLocal });
      }
    } catch {
      // Gunakan cache lokal jika offline
    }
  }

  return resolved;
}

/**
 * Pengecekan sinkron cepat apakah sesi saat ini berhak mengakses/mengubah modul pengaturan tertentu.
 */
export function hasSettingModulePermission(
  session: SessionUser | null | undefined,
  moduleKey: CentralSettingModuleKey,
  liveMap?: Partial<Record<CentralSettingModuleKey, SettingPermissionStatus>> | null
): boolean {
  if (!session || session.role !== 'admin') return false;
  if (isBendaharaOnly(session)) return true;
  if (liveMap && moduleKey in liveMap) {
    return liveMap[moduleKey] === 'granted';
  }
  const uname = normalizePengurusUsernameKey(session.blok_rumah);
  const localMap = readLocalPermissionsMap();
  return localMap[uname]?.[moduleKey]?.status === 'granted';
}

/**
 * Memberikan (`granted`) atau mencabut (`revoked`) delegasi hak akses modul pengaturan
 * dari Bendahara ke Pengurus lain melalui RPC `set_pengurus_setting_permission`.
 */
export async function setPengurusSettingPermission(
  session: SessionUser,
  params: {
    pengurusUsername: string;
    moduleKey: CentralSettingModuleKey;
    status: SettingPermissionStatus;
    note?: string;
  }
): Promise<{ data?: PengurusSettingPermissionRecord; error?: string }> {
  if (!isBendaharaOnly(session)) {
    return { error: 'Hanya Bendahara yang berwenang mengatur delegasi hak pengaturan pengurus.' };
  }

  const targetUsername = normalizePengurusUsernameKey(params.pengurusUsername);
  const targetPengurus = SUSUNAN_PENGURUS.find((p) => p.username.toLowerCase() === targetUsername);
  if (targetPengurus && (targetPengurus.permission === 'full' || targetPengurus.jabatan === 'Bendahara')) {
    return { error: 'Hak akses penuh Bendahara bersifat permanen dan tidak dapat dicabut.' };
  }

  const nowIso = new Date().toISOString();
  const moduleMeta = CENTRAL_SETTING_MODULES.find((m) => m.key === params.moduleKey);
  const supabase = getSupabaseClient(session);

  if (supabase && isSupabaseConfigured()) {
    try {
      const rpcRes = await callRpcWithSignatureFallback(supabase, 'set_pengurus_setting_permission', [
        {
          p_pengurus_username: targetUsername,
          p_module_key: params.moduleKey,
          p_status: params.status,
          p_notes: params.note || null,
        },
        {
          p_pengurus_username: targetUsername,
          p_module_key: params.moduleKey,
          p_status: params.status,
        },
        {
          p_username: targetUsername,
          p_module_key: params.moduleKey,
          p_status: params.status,
        },
        {
          p_target_username: targetUsername,
          p_setting_key: params.moduleKey,
          p_status: params.status,
        },
        {
          p_pengurus_blok: targetUsername,
          p_setting_module: params.moduleKey,
          p_status: params.status,
        },
        {
          p_blok_rumah: targetUsername,
          p_module_key: params.moduleKey,
          p_permission_status: params.status,
        },
      ]);

      if (rpcRes.error && rpcRes.matched) {
        return { error: rpcRes.error.message || 'Gagal memperbarui delegasi hak pengaturan di server.' };
      }

      if (!rpcRes.matched) {
        // Fallback aman ke upsert tabel jika signature berbeda
        const { error: upsertErr } = await supabase.from('pengurus_setting_permissions').upsert(
          {
            pengurus_username: targetUsername,
            module_key: params.moduleKey,
            status: params.status,
            granted_by: session.blok_rumah,
            updated_at: nowIso,
            notes: params.note || null,
          },
          { onConflict: 'pengurus_username,module_key' }
        );
        if (upsertErr) {
          return {
            error:
              upsertErr.message ||
              'Gagal menyimpan delegasi hak pengaturan ke Supabase. Pastikan migrasi 16A–16D aktif.',
          };
        }
      }
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? err.message
            : 'Terjadi kendala koneksi saat memperbarui delegasi hak pengaturan.',
      };
    }
  }

  const record: PengurusSettingPermissionRecord = {
    pengurus_username: targetUsername,
    module_key: params.moduleKey,
    status: params.status,
    granted_by: session.blok_rumah,
    updated_at: nowIso,
    notes: params.note || null,
  };

  const localMap = readLocalPermissionsMap();
  localMap[targetUsername] = {
    ...(localMap[targetUsername] || {}),
    [params.moduleKey]: record,
  };
  writeLocalPermissionsMap(localMap);

  await recordAuditLog({
    session,
    action: params.status === 'granted' ? 'GRANT_SETTING_PERMISSION' : 'REVOKE_SETTING_PERMISSION',
    entity: 'pengurus_setting_permissions',
    entity_id: `${targetUsername}:${params.moduleKey}`,
    summary: `Bendahara ${params.status === 'granted' ? 'memberikan' : 'mencabut'} akses modul "${
      moduleMeta?.label || params.moduleKey
    }" untuk ${targetPengurus?.nama || targetUsername} (${targetPengurus?.jabatan || 'Pengurus'}).`,
    metadata: {
      target_username: targetUsername,
      module_key: params.moduleKey,
      status: params.status,
    },
  });

  return { data: record };
}

/**
 * Mengambil daftar sinkronisasi status Pengurus <-> Akun Warga / Blok terkait.
 */
export async function fetchPengurusWargaSyncList(
  session: SessionUser,
  pengurusAccounts: PengurusAccountInfo[],
  wargaList: Warga[]
): Promise<PengurusWargaSyncStatus[]> {
  const localStatuses = readLocalPengurusStatusMap();
  const wargaByBlok = new Map<string, Warga>();
  for (const w of wargaList) {
    wargaByBlok.set(normalizeBlokCompact(w.blok_rumah), w);
  }

  const remoteAdminActive = new Map<string, boolean>();
  const remoteWargaActive = new Map<string, boolean>();

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('users_warga')
        .select('blok_rumah, role, aktif');
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ blok_rumah?: string; role?: string; aktif?: boolean }>) {
          if (!row.blok_rumah) continue;
          if (row.role === 'admin' || row.role === 'bendahara') {
            remoteAdminActive.set(normalizePengurusUsernameKey(row.blok_rumah), row.aktif !== false);
          } else {
            remoteWargaActive.set(normalizeBlokCompact(row.blok_rumah), row.aktif !== false);
          }
        }
      }
    } catch {
      // Gunakan fallback dari snapshot + local cache
    }
  }

  return SUSUNAN_PENGURUS.map((p) => {
    const uname = p.username.toLowerCase();
    const compactBlok = normalizeBlokCompact(p.blokRumah);
    const accMatch = pengurusAccounts.find((a) => a.username.toLowerCase() === uname);
    const wargaMatch = wargaByBlok.get(compactBlok);
    const isBendahara = p.permission === 'full' || p.jabatan === 'Bendahara';

    const isActivePengurus = isBendahara
      ? true
      : remoteAdminActive.has(uname)
        ? Boolean(remoteAdminActive.get(uname))
        : typeof accMatch?.aktif === 'boolean'
          ? accMatch.aktif
          : localStatuses[uname] !== false;

    const isActiveWarga = remoteWargaActive.has(compactBlok)
      ? Boolean(remoteWargaActive.get(compactBlok))
      : wargaMatch
        ? wargaMatch.aktif
        : !isActivePengurus;

    return {
      pengurus_username: uname,
      pengurus_nama: p.nama,
      jabatan: p.jabatan,
      linked_blok_rumah: p.blokRumah,
      is_active_pengurus: isActivePengurus,
      is_active_warga: isActiveWarga,
      warga_account_status: isActiveWarga
        ? 'active'
        : isActivePengurus
          ? 'suspended_by_pengurus'
          : 'inactive',
      updated_at: null,
    };
  });
}

/**
 * Menjalankan sinkronisasi status Pengurus <-> Pemulihan Otomatis Akun Warga melalui RPC `sync_pengurus_to_warga_status`.
 * - Jika `isActivePengurus === false`: hak Pengurus dicabut dan akun Warga / Blok otomatis diaktifkan kembali.
 * - Jika `isActivePengurus === true`: hak Pengurus diaktifkan kembali dan eksklusivitas Pengurus ditegakkan.
 */
export async function syncPengurusToWargaStatus(
  session: SessionUser,
  params: {
    pengurusUsername: string;
    linkedBlokRumah: string;
    isActivePengurus: boolean;
    reason?: string;
  }
): Promise<{ data?: PengurusWargaSyncStatus; error?: string }> {
  if (!isBendaharaOnly(session)) {
    return {
      error: 'Hanya Bendahara yang berwenang menyinkronkan status Pengurus dan pemulihan akun Warga.',
    };
  }

  const targetUsername = normalizePengurusUsernameKey(params.pengurusUsername);
  const targetMeta = SUSUNAN_PENGURUS.find((p) => p.username.toLowerCase() === targetUsername);
  if (targetMeta && (targetMeta.permission === 'full' || targetMeta.jabatan === 'Bendahara')) {
    return { error: 'Akun Bendahara utama tidak dapat dinonaktifkan dari panel ini.' };
  }

  const linkedBlok = normalizeBlokCompact(params.linkedBlokRumah || targetMeta?.blokRumah || '');
  const nowIso = new Date().toISOString();
  const supabase = getSupabaseClient(session);

  if (supabase && isSupabaseConfigured()) {
    try {
      const rpcRes = await callRpcWithSignatureFallback(supabase, 'sync_pengurus_to_warga_status', [
        {
          p_pengurus_username: targetUsername,
          p_is_active_pengurus: params.isActivePengurus,
          p_linked_blok_rumah: linkedBlok,
          p_reason: params.reason || null,
        },
        {
          p_pengurus_username: targetUsername,
          p_is_active: params.isActivePengurus,
        },
        {
          p_username: targetUsername,
          p_aktif: params.isActivePengurus,
        },
        {
          p_pengurus_blok: targetUsername,
          p_active: params.isActivePengurus,
        },
        {
          p_blok_rumah: linkedBlok,
          p_pengurus_username: targetUsername,
          p_is_active_pengurus: params.isActivePengurus,
        },
      ]);

      if (rpcRes.error && rpcRes.matched) {
        return {
          error:
            rpcRes.error.message ||
            'Gagal menjalankan sinkronisasi status Pengurus ↔ Warga di server.',
        };
      }

      if (!rpcRes.matched) {
        // Fallback sinkronisasi langsung pada users_warga jika nama parameter RPC berbeda
        await supabase
          .from('users_warga')
          .update({ aktif: params.isActivePengurus })
          .eq('blok_rumah', targetUsername)
          .eq('role', 'admin');
        if (linkedBlok) {
          await supabase
            .from('users_warga')
            .update({ aktif: !params.isActivePengurus })
            .eq('blok_rumah', linkedBlok)
            .eq('role', 'warga');
        }
      }
    } catch (err) {
      return {
        error:
          err instanceof Error
            ? err.message
            : 'Terjadi kendala jaringan saat menyinkronkan status Pengurus ↔ Warga.',
      };
    }
  }

  const localStatuses = readLocalPengurusStatusMap();
  localStatuses[targetUsername] = params.isActivePengurus;
  writeLocalPengurusStatusMap(localStatuses);

  const nextState: PengurusWargaSyncStatus = {
    pengurus_username: targetUsername,
    pengurus_nama: targetMeta?.nama || targetUsername,
    jabatan: targetMeta?.jabatan || 'Humas',
    linked_blok_rumah: linkedBlok || targetMeta?.blokRumah || '-',
    is_active_pengurus: params.isActivePengurus,
    is_active_warga: !params.isActivePengurus,
    warga_account_status: params.isActivePengurus ? 'suspended_by_pengurus' : 'active',
    updated_at: nowIso,
  };

  await recordAuditLog({
    session,
    action: 'SYNC_PENGURUS_TO_WARGA_STATUS',
    entity: 'users_warga',
    entity_id: `${targetUsername}:${nextState.linked_blok_rumah}`,
    summary: params.isActivePengurus
      ? `Mengaktifkan kembali akun Pengurus ${nextState.pengurus_nama} (@${targetUsername}) dan menonaktifkan jalur Warga Blok ${nextState.linked_blok_rumah}.`
      : `Menonaktifkan hak Pengurus ${nextState.pengurus_nama} (@${targetUsername}) dan memulihkan akun Warga Blok ${nextState.linked_blok_rumah} otomatis aktif.`,
    metadata: {
      pengurus_username: targetUsername,
      linked_blok_rumah: nextState.linked_blok_rumah,
      is_active_pengurus: params.isActivePengurus,
      warga_account_status: nextState.warga_account_status,
      reason: params.reason || null,
    },
  });

  return { data: nextState };
}

export function getChatModerationPolicy(): ChatModerationPolicy {
  try {
    const raw = safeGetStorage(LOCAL_CHAT_MODERATION_KEY);
    if (!raw) return DEFAULT_CHAT_MODERATION_POLICY;
    const parsed = JSON.parse(raw) as Partial<ChatModerationPolicy>;
    return {
      ...DEFAULT_CHAT_MODERATION_POLICY,
      ...parsed,
    };
  } catch {
    return DEFAULT_CHAT_MODERATION_POLICY;
  }
}

export async function saveChatModerationPolicy(
  session: SessionUser,
  nextPolicy: Pick<
    ChatModerationPolicy,
    'allow_warga_attachments' | 'pengurus_only_announcements' | 'retention_days'
  >,
  livePermissions?: Partial<Record<CentralSettingModuleKey, SettingPermissionStatus>> | null
): Promise<{ data?: ChatModerationPolicy; error?: string }> {
  if (!hasSettingModulePermission(session, 'settings.chat_moderation', livePermissions)) {
    return {
      error: 'Akses ditolak: pengaturan moderasi chat hanya untuk Bendahara atau Pengurus terdelegasi.',
    };
  }

  const saved: ChatModerationPolicy = {
    allow_warga_attachments: Boolean(nextPolicy.allow_warga_attachments),
    pengurus_only_announcements: Boolean(nextPolicy.pengurus_only_announcements),
    retention_days: Math.max(7, Math.min(365, Number(nextPolicy.retention_days) || 90)),
    updated_at: new Date().toISOString(),
    updated_by: session.blok_rumah,
  };

  safeSetStorage(LOCAL_CHAT_MODERATION_KEY, JSON.stringify(saved));

  await recordAuditLog({
    session,
    action: 'UPDATE_CHAT_MODERATION_POLICY',
    entity: 'settings.chat_moderation',
    entity_id: 'default',
    summary: `Memperbarui kebijakan moderasi chat (lampiran warga: ${
      saved.allow_warga_attachments ? 'Diizinkan' : 'Dibatasi'
    }, retensi ${saved.retention_days} hari).`,
    metadata: { ...saved },
  });

  return { data: saved };
}
