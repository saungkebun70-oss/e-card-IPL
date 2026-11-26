import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CENTRAL_SETTING_DEFINITIONS,
  CENTRAL_SETTING_KEYS,
  isBendaharaFullAccess,
  type CentralSettingDefinition,
  type CentralSettingKey,
  type PengurusSettingsPermissionRow,
  type PermissionGrantStatus,
  type SessionUser,
  type Warga,
} from '../types';
import {
  canAccessCentralSetting,
  canonicalizeResidentBlok,
  fetchPengurusSettingsPermissions,
  getEffectiveLocalPengurusActive,
  isValidCentralSettingKey,
  normalizePengurusUsername,
  readLocalCentralPermissions,
  setPengurusSettingPermission,
  syncPengurusToWargaStatus,
  validateLoginByAccountStatus,
  verifyLoginStatusWithSupabase,
  type AccountLoginGuardRecord,
  type CentralPermissionServiceResult,
  type CentralSettingPermissionMap,
  type LoginGuardStatusCode,
  type LoginGuardValidationResult,
  type LoginPortalMode,
  type SyncPengurusToWargaInput,
  type SyncPengurusToWargaResult,
} from './centralSettingsPermissions';

export {
  CENTRAL_SETTING_DEFINITIONS,
  CENTRAL_SETTING_KEYS,
  canAccessCentralSetting,
  canonicalizeResidentBlok,
  fetchPengurusSettingsPermissions,
  getEffectiveLocalPengurusActive,
  isValidCentralSettingKey,
  normalizePengurusUsername,
  readLocalCentralPermissions,
  setPengurusSettingPermission,
  syncPengurusToWargaStatus,
  validateLoginByAccountStatus,
  verifyLoginStatusWithSupabase,
  type AccountLoginGuardRecord,
  type CentralPermissionServiceResult,
  type CentralSettingDefinition,
  type CentralSettingKey,
  type CentralSettingPermissionMap,
  type LoginGuardStatusCode,
  type LoginGuardValidationResult,
  type LoginPortalMode,
  type PengurusSettingsPermissionRow,
  type PermissionGrantStatus,
  type SyncPengurusToWargaInput,
  type SyncPengurusToWargaResult,
};

/**
 * Menentukan apakah sesi saat ini adalah pemilik penuh Pengaturan Sistem Terpusat
 * (khusus Bendahara aktif — Andriansyah).
 */
export function isCentralSettingsOwner(session?: SessionUser | null): boolean {
  if (!session || session.role !== 'admin' || session.is_active_pengurus === false) {
    return false;
  }
  const username = normalizePengurusUsername(session.blok_rumah);
  const isBendaharaIdentity =
    session.jabatan === 'Bendahara' || username === 'andriansyah';
  return isBendaharaFullAccess(session) && isBendaharaIdentity;
}

/**
 * Header identitas sesi konsisten untuk panggilan RPC/REST yang membutuhkan verifikasi caller di DB.
 */
export function buildSessionIdentityHeaders(session?: SessionUser | null): Record<string, string> {
  return {
    'x-user-role': session?.role || 'anon',
    'x-blok-rumah': session?.blok_rumah || '',
    'x-petugas-id': session?.petugas_id || '',
    'x-admin-permission': session?.admin_permission || '',
    'x-admin-jabatan': session?.jabatan || '',
  };
}

/**
 * Mengonversi daftar baris `pengurus_settings_permissions` menjadi peta izin untuk satu username pengurus.
 */
export function buildCentralPermissionMap(
  rows: readonly PengurusSettingsPermissionRow[] | null | undefined,
  pengurusUsername?: string | null
): CentralSettingPermissionMap {
  const normTarget = normalizePengurusUsername(pengurusUsername);
  if (!normTarget || !Array.isArray(rows)) {
    return {};
  }
  const map: CentralSettingPermissionMap = {};
  for (const row of rows) {
    const rawKey: string = row.setting_key;
    if (
      normalizePengurusUsername(row.pengurus_username) === normTarget &&
      isValidCentralSettingKey(rawKey)
    ) {
      map[rawKey] = row.status;
    }
  }
  return map;
}

export interface UseCentralSettingsAccessResult {
  isBendaharaOwner: boolean;
  isActivePengurus: boolean;
  loading: boolean;
  mutatingKey: string | null;
  error: string | null;
  allRows: PengurusSettingsPermissionRow[];
  permissionMap: CentralSettingPermissionMap;
  grantedKeys: CentralSettingKey[];
  lockedKeys: CentralSettingKey[];
  canAccess: (settingKey: CentralSettingKey) => boolean;
  getPermissionStatus: (pengurusUsername: string, settingKey: CentralSettingKey) => PermissionGrantStatus;
  refresh: () => Promise<void>;
  togglePermission: (params: {
    pengurusUsername: string;
    settingKey: CentralSettingKey;
    status: PermissionGrantStatus;
    notes?: string;
  }) => Promise<CentralPermissionServiceResult<PengurusSettingsPermissionRow>>;
  syncAccountStatus: (params: {
    targetIdentifier: string;
    isActivePengurus: boolean;
    reason?: string;
    accounts?: Warga[];
  }) => Promise<CentralPermissionServiceResult<SyncPengurusToWargaResult>>;
}

/**
 * Hook React untuk membaca, mengevaluasi, dan (khusus Bendahara) mengelola
 * matriks izin Pengaturan Sistem Terpusat + eksklusivitas status Pengurus/Warga.
 */
export function useCentralSettingsAccess(
  session: SessionUser | null | undefined,
  options?: {
    enabled?: boolean;
    onPermissionsLoaded?: (map: CentralSettingPermissionMap) => void;
  }
): UseCentralSettingsAccessResult {
  const enabled = options?.enabled !== false;
  const onPermissionsLoadedRef = useRef(options?.onPermissionsLoaded);
  onPermissionsLoadedRef.current = options?.onPermissionsLoaded;

  const isBendaharaOwner = isCentralSettingsOwner(session);
  const isActivePengurus = Boolean(
    session && session.role === 'admin' && session.is_active_pengurus !== false
  );
  const callerUsername = normalizePengurusUsername(session?.blok_rumah);

  const [allRows, setAllRows] = useState<PengurusSettingsPermissionRow[]>(() =>
    readLocalCentralPermissions()
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [mutatingKey, setMutatingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session || session.role !== 'admin' || !enabled) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Bendahara mengambil seluruh baris matriks; pengurus lain hanya baris miliknya sendiri
      const res = await fetchPengurusSettingsPermissions(
        session,
        isBendaharaOwner ? undefined : session.blok_rumah
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      const rows = Array.isArray(res.data) ? res.data : [];
      setAllRows(rows);
      const nextMap = buildCentralPermissionMap(rows, session.blok_rumah);
      onPermissionsLoadedRef.current?.(nextMap);
    } finally {
      setLoading(false);
    }
  }, [session, enabled, isBendaharaOwner]);

  useEffect(() => {
    if (!enabled || !session || session.role !== 'admin') return;
    void refresh();
  }, [enabled, session?.role, session?.blok_rumah, refresh]);

  const permissionMap = useMemo<CentralSettingPermissionMap>(() => {
    if (!session || session.role !== 'admin') return {};
    const fromRows = buildCentralPermissionMap(allRows, callerUsername);
    return {
      ...(session.central_settings_permissions || {}),
      ...fromRows,
    };
  }, [session, allRows, callerUsername]);

  const canAccess = useCallback(
    (settingKey: CentralSettingKey): boolean => {
      if (!session) return false;
      return canAccessCentralSetting(session, settingKey, permissionMap);
    },
    [session, permissionMap]
  );

  const getPermissionStatus = useCallback(
    (pengurusUsername: string, settingKey: CentralSettingKey): PermissionGrantStatus => {
      const normUser = normalizePengurusUsername(pengurusUsername);
      if (normUser === 'andriansyah') {
        return 'granted';
      }
      const found = allRows.find(
        (r) =>
          normalizePengurusUsername(r.pengurus_username) === normUser &&
          r.setting_key === settingKey
      );
      return found?.status === 'granted' ? 'granted' : 'revoked';
    },
    [allRows]
  );

  const grantedKeys = useMemo(
    () => CENTRAL_SETTING_KEYS.filter((key) => canAccess(key)),
    [canAccess]
  );

  const lockedKeys = useMemo(
    () => CENTRAL_SETTING_KEYS.filter((key) => !canAccess(key)),
    [canAccess]
  );

  const togglePermission = useCallback<UseCentralSettingsAccessResult['togglePermission']>(
    async (params) => {
      if (!session || session.role !== 'admin') {
        return { error: 'Sesi Pengurus tidak valid.' };
      }
      const normUser = normalizePengurusUsername(params.pengurusUsername);
      const lockId = `perm:${normUser}:${params.settingKey}`;
      setMutatingKey(lockId);
      setError(null);
      try {
        const res = await setPengurusSettingPermission({
          session,
          pengurusUsername: normUser,
          settingKey: params.settingKey,
          status: params.status,
          notes: params.notes,
        });
        if (res.error || !res.data) {
          setError(res.error || 'Gagal memperbarui hak akses pengaturan.');
          return res;
        }
        const savedRow = res.data;
        setAllRows((prev) => {
          const idx = prev.findIndex(
            (r) =>
              normalizePengurusUsername(r.pengurus_username) === normUser &&
              r.setting_key === params.settingKey
          );
          if (idx >= 0) {
            const copy = [...prev];
            copy[idx] = savedRow;
            return copy;
          }
          return [...prev, savedRow];
        });
        return res;
      } finally {
        setMutatingKey(null);
      }
    },
    [session]
  );

  const syncAccountStatus = useCallback<UseCentralSettingsAccessResult['syncAccountStatus']>(
    async (params) => {
      if (!session || session.role !== 'admin') {
        return { error: 'Sesi Pengurus tidak valid.' };
      }
      const lockId = `sync:${normalizePengurusUsername(params.targetIdentifier)}`;
      setMutatingKey(lockId);
      setError(null);
      try {
        const res = await syncPengurusToWargaStatus({
          session,
          targetIdentifier: params.targetIdentifier,
          isActivePengurus: params.isActivePengurus,
          reason: params.reason,
          accounts: params.accounts,
        });
        if (res.error) {
          setError(res.error);
          return res;
        }
        await refresh();
        return res;
      } finally {
        setMutatingKey(null);
      }
    },
    [session, refresh]
  );

  return {
    isBendaharaOwner,
    isActivePengurus,
    loading,
    mutatingKey,
    error,
    allRows,
    permissionMap,
    grantedKeys,
    lockedKeys,
    canAccess,
    getPermissionStatus,
    refresh,
    togglePermission,
    syncAccountStatus,
  };
}
