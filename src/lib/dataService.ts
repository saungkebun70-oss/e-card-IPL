import {
  isBendaharaFullAccess,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  type AdminJabatan,
  type AdminPermission,
  type BotWaConfig,
  type BotWaLog,
  type MetodeBayar,
  type NotificationCategory,
  type NotificationTargetScope,
  type PaymentConfig,
  type SessionUser,
  type StatusEcardBulanan,
  type StatusHunian,
  type SystemNotification,
  type TransaksiIPL,
  type Warga,
} from '../types';
import { recordAuditLog } from './auditLogger';
import {
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
  SESSION: 'saungkebun_session_v1',
  WARGA: 'saungkebun_warga_v2',
  TRANSAKSI: 'saungkebun_transaksi_v2',
  STATUS: 'saungkebun_status_v2',
  BOT_CONFIG: 'saungkebun_bot_config_v1',
  BOT_LOGS: 'saungkebun_bot_logs_v1',
  LOGIN_ATTEMPTS: 'saungkebun_login_attempts_v1',
  SYSTEM_NOTIFICATIONS: 'saungkebun_system_notifications_v1',
  PAYMENT_CONFIG: 'saungkebun_payment_config_v1',
} as const;

const MAX_FAILED_PIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 menit

interface LoginAttemptRecord {
  failedCount: number;
  lockedUntil: number | null;
}

function getAttemptMap(): Record<string, LoginAttemptRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOGIN_ATTEMPTS);
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
    localStorage.setItem(STORAGE_KEYS.LOGIN_ATTEMPTS, JSON.stringify(map));
    return 'Terlalu banyak percobaan PIN salah (5 kali). Silakan tunggu 5 menit sebelum mencoba lagi.';
  }
  map[accountKey] = { failedCount: next, lockedUntil: null };
  localStorage.setItem(STORAGE_KEYS.LOGIN_ATTEMPTS, JSON.stringify(map));
  return null;
}

function clearLocalAttempts(accountKey: string) {
  const map = getAttemptMap();
  if (map[accountKey]) {
    delete map[accountKey];
    localStorage.setItem(STORAGE_KEYS.LOGIN_ATTEMPTS, JSON.stringify(map));
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
  if (!localStorage.getItem(STORAGE_KEYS.WARGA)) {
    localStorage.setItem(STORAGE_KEYS.WARGA, JSON.stringify(SEED_WARGA));
  }
  if (!localStorage.getItem(STORAGE_KEYS.TRANSAKSI)) {
    localStorage.setItem(STORAGE_KEYS.TRANSAKSI, JSON.stringify(SEED_TRANSAKSI));
  }
  if (!localStorage.getItem(STORAGE_KEYS.STATUS)) {
    const warga = JSON.parse(localStorage.getItem(STORAGE_KEYS.WARGA) || '[]') as Warga[];
    const trx = JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSAKSI) || '[]') as TransaksiIPL[];
    localStorage.setItem(STORAGE_KEYS.STATUS, JSON.stringify(buildInitialStatusBulanan(warga, trx)));
  }
  if (!localStorage.getItem(STORAGE_KEYS.BOT_CONFIG)) {
    localStorage.setItem(STORAGE_KEYS.BOT_CONFIG, JSON.stringify(SEED_BOT_WA_CONFIG));
  }
  if (!localStorage.getItem(STORAGE_KEYS.BOT_LOGS)) {
    localStorage.setItem(STORAGE_KEYS.BOT_LOGS, JSON.stringify(SEED_BOT_WA_LOGS));
  }
}

function readLocal<T>(key: string, fallback: T): T {
  ensureLocalStoreInitialized();
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
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
// Sesi Autentikasi
// =========================================================================

export function loadStoredSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed?.role || !parsed?.blok_rumah) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredSession(session: SessionUser) {
  localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(session));
}

export function clearStoredSession(session?: SessionUser | null) {
  if (session) {
    void recordAuditLog({
      session,
      action: 'LOGOUT',
      entity: 'auth',
      entity_id: session.blok_rumah,
      summary: `${session.nama_warga} (${session.blok_rumah}) keluar dari portal ${session.role}.`,
    });
  }
  localStorage.removeItem(STORAGE_KEYS.SESSION);
}

export async function loginPortal(
  mode: 'warga' | 'admin',
  usernameInput: string,
  pinInput: string
): Promise<ServiceResult<SessionUser>> {
  const cleanPin = pinInput.trim();
  const cleanBlok =
    mode === 'admin'
      ? usernameInput.trim().toLowerCase().replace(/\s+/g, '')
      : normalizeBlok(usernameInput);

  if (!cleanBlok || !cleanPin) {
    return { error: 'Mohon lengkapi Username dan PIN 6 digit Anda.' };
  }

  if (cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
    return { error: 'PIN akses harus terdiri dari tepat 6 digit angka.' };
  }

  const supabase = getSupabaseClient(null);
  if (supabase && isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase.rpc('login_ecard', {
        p_blok: cleanBlok,
        p_pin: cleanPin,
      });

      if (error) {
        return { error: parseFriendlyError(error, 'Gagal memverifikasi akun ke server.') };
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.blok_rumah) {
        await recordAuditLog({
          action: 'LOGIN_FAILED',
          entity: 'auth',
          entity_id: cleanBlok,
          summary: `Percobaan login gagal pada portal ${mode} untuk akun ${cleanBlok}.`,
        });
        return { error: 'Kombinasi Blok/Username atau PIN tidak valid. Silakan periksa kembali.' };
      }

      const resolvedRole = (row.role === 'admin' ? 'admin' : 'warga') as 'admin' | 'warga';
      if (mode === 'admin' && resolvedRole !== 'admin') {
        return { error: 'Akun ini tidak memiliki hak akses Pengurus / Admin.' };
      }
      if (mode === 'warga' && resolvedRole !== 'warga') {
        return { error: 'Silakan gunakan tab Portal Admin / Pengurus untuk akun ini.' };
      }

      const resolvedJabatan = (row.jabatan as AdminJabatan | undefined) || (resolvedRole === 'admin' ? 'Bendahara' : undefined);
      const resolvedPerm: AdminPermission | undefined =
        resolvedRole === 'admin'
          ? (row.admin_permission as AdminPermission | undefined) ||
            (resolvedJabatan === 'Bendahara' ? 'full' : 'add_only')
          : undefined;

      const session: SessionUser = {
        role: resolvedRole,
        blok_rumah: row.blok_rumah,
        nama_warga: row.nama_warga || (resolvedRole === 'admin' ? 'Pengurus Lingkungan' : row.blok_rumah),
        jabatan: resolvedJabatan,
        admin_permission: resolvedPerm,
        status_hunian: row.status_hunian,
        no_wa: row.no_wa,
        nominal_iuran: row.nominal_iuran ?? NOMINAL_IPL_STANDAR,
        login_at: new Date().toISOString(),
      };
      saveStoredSession(session);
      await recordAuditLog({
        session,
        action: 'LOGIN_SUCCESS',
        entity: 'auth',
        entity_id: session.blok_rumah,
        summary: `Login berhasil (${resolvedRole}${resolvedJabatan ? ` - ${resolvedJabatan}` : ''}) untuk ${session.nama_warga} [${session.blok_rumah}].`,
      });
      return { data: session };
    } catch (err) {
      return { error: parseFriendlyError(err, 'Terjadi kesalahan jaringan saat mencoba masuk.') };
    }
  }

  // Fallback Mode Demo Lokal dengan Proteksi Brute-Force PIN
  ensureLocalStoreInitialized();
  const attemptKey = `${mode}:${cleanBlok.toLowerCase()}`;
  const lockMessage = checkLocalLockout(attemptKey);
  if (lockMessage) {
    return { error: lockMessage };
  }

  if (mode === 'admin') {
    const matchedAdmin = LOCAL_ADMIN_ACCOUNTS.find(
      (acc) => acc.username === cleanBlok && acc.pin === cleanPin
    );
    if (matchedAdmin) {
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
        summary: `${matchedAdmin.nama} (${matchedAdmin.jabatan} — ${matchedAdmin.permission === 'full' ? 'Akses Penuh' : 'Tambah Data'}) masuk ke Portal Admin.`,
      });
      return { data: session };
    }
    const lockErr = registerLocalFailedAttempt(attemptKey);
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entity: 'auth',
      entity_id: cleanBlok,
      summary: `Percobaan login Admin gagal untuk username "${cleanBlok}".`,
    });
    return { error: lockErr || 'Username Admin atau PIN tidak sesuai.' };
  }

  const wargaList = readLocal<Warga[]>(STORAGE_KEYS.WARGA, SEED_WARGA);
  const matched = wargaList.find(
    (w) => w.aktif && normalizeBlok(w.blok_rumah) === cleanBlok && w.pin_akses === cleanPin
  );

  if (!matched) {
    const lockErr = registerLocalFailedAttempt(attemptKey);
    await recordAuditLog({
      action: 'LOGIN_FAILED',
      entity: 'auth',
      entity_id: cleanBlok,
      summary: `Percobaan login Warga gagal untuk blok "${cleanBlok}".`,
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

export async function submitSetoranWarga(
  session: SessionUser,
  payload: {
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

  const sortedBulan = [...payload.bulan_dibayar].sort((a, b) => a - b);
  const nowIso = new Date().toISOString();
  const noKwitansi = generateKwitansiNumber(session.blok_rumah, nowIso);

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      payload.onStageChange?.('uploading_proof');
      const ext = payload.buktiFile.name.split('.').pop()?.toLowerCase() || 'jpg';
      const safeBlok = session.blok_rumah.replace(/[^A-Z0-9]/gi, '_');
      const filePath = `${safeBlok}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('bukti-ipl')
        .upload(filePath, payload.buktiFile, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('bukti-ipl').getPublicUrl(filePath);
      const buktiUrl = publicUrlData.publicUrl;

      payload.onStageChange?.('saving_transaction');
      const { data: inserted, error: insertError } = await supabase
        .from('transaksi_ipl')
        .insert({
          no_kwitansi: noKwitansi,
          blok_rumah: session.blok_rumah,
          nama_warga: session.nama_warga,
          tahun: TAHUN_AKTIF,
          bulan_dibayar: sortedBulan,
          nominal: payload.nominal,
          metode_bayar: payload.metode_bayar,
          petugas_penerima: payload.metode_bayar === 'Setor Tunai' ? payload.petugas_penerima || null : null,
          bukti_url: buktiUrl,
          status_verifikasi: 'Pending',
          keterangan: payload.keterangan?.trim() || null,
          tanggal_setor: nowIso,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      payload.onStageChange?.('syncing_ecard');
      // Sinkronkan status bulan menjadi Menunggu Verifikasi
      for (const bulan of sortedBulan) {
        await supabase.from('status_ecard_bulanan').upsert(
          {
            blok_rumah: session.blok_rumah,
            tahun: TAHUN_AKTIF,
            bulan,
            status: 'Menunggu Verifikasi',
            transaksi_id: inserted.id,
            updated_at: nowIso,
          },
          { onConflict: 'blok_rumah,tahun,bulan' }
        );
      }

      await recordAuditLog({
        session,
        action: 'SUBMIT_SETORAN',
        entity: 'transaksi_ipl',
        entity_id: inserted.id,
        summary: `Warga ${session.blok_rumah} menyetor ${formatRupiah(payload.nominal)} (${formatDaftarBulan(sortedBulan, true)}) via ${payload.metode_bayar}.`,
        metadata: { bulan: sortedBulan, nominal: payload.nominal, metode: payload.metode_bayar },
      });

      return { data: inserted as TransaksiIPL };
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
      blok_rumah: session.blok_rumah,
      nama_warga: session.nama_warga,
      tahun: TAHUN_AKTIF,
      bulan_dibayar: sortedBulan,
      nominal: payload.nominal,
      metode_bayar: payload.metode_bayar,
      petugas_penerima: payload.metode_bayar === 'Setor Tunai' ? payload.petugas_penerima || null : null,
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
    syncLocalStatusForHouse(session.blok_rumah);

    await recordAuditLog({
      session,
      action: 'SUBMIT_SETORAN',
      entity: 'transaksi_ipl',
      entity_id: newTrx.id,
      summary: `Warga ${session.blok_rumah} menyetor ${formatRupiah(payload.nominal)} (${formatDaftarBulan(sortedBulan, true)}) via ${payload.metode_bayar}.`,
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
  transaksiList: TransaksiIPL[];
  statusList: StatusEcardBulanan[];
  botConfig: BotWaConfig;
  botLogs: BotWaLog[];
  notifications: SystemNotification[];
  paymentConfig: PaymentConfig;
}

export async function fetchAdminSnapshot(session: SessionUser): Promise<ServiceResult<AdminSnapshot>> {
  if (session.role !== 'admin') {
    return { error: 'Akses ditolak: hanya untuk Pengurus / Admin.' };
  }

  const supabase = getSupabaseClient(session);
  if (supabase && isSupabaseConfigured()) {
    try {
      const [wargaRes, trxRes, statusRes, botCfgRes, botLogRes, notifications, paymentConfig] =
        await Promise.all([
          supabase
            .from('users_warga')
            .select('*')
            .neq('role', 'admin')
            .order('blok_rumah', { ascending: true }),
          supabase
            .from('transaksi_ipl')
            .select('*')
            .eq('tahun', TAHUN_AKTIF)
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

      return {
        data: {
          wargaList: (wargaRes.data || []) as Warga[],
          transaksiList: (trxRes.data || []) as TransaksiIPL[],
          statusList: (statusRes.data || []) as StatusEcardBulanan[],
          botConfig: (botCfgRes.data as BotWaConfig | null) || SEED_BOT_WA_CONFIG,
          botLogs: (botLogRes.data || []) as BotWaLog[],
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

  const transaksiList = readLocal<TransaksiIPL[]>(STORAGE_KEYS.TRANSAKSI, SEED_TRANSAKSI).sort(
    (a, b) => new Date(b.tanggal_setor).getTime() - new Date(a.tanggal_setor).getTime()
  );
  const statusList = readLocal<StatusEcardBulanan[]>(STORAGE_KEYS.STATUS, []);
  const botConfig = readLocal<BotWaConfig>(STORAGE_KEYS.BOT_CONFIG, SEED_BOT_WA_CONFIG);
  const botLogs = readLocal<BotWaLog[]>(STORAGE_KEYS.BOT_LOGS, SEED_BOT_WA_LOGS).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const [notifications, paymentConfig] = await Promise.all([
    fetchSystemNotifications(session),
    fetchPaymentConfig(session),
  ]);

  return {
    data: { wargaList, transaksiList, statusList, botConfig, botLogs, notifications, paymentConfig },
  };
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
      await supabase.from('bot_wa_logs').insert(
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
      return;
    } catch {
      // Fallback simpan lokal bila tabel belum tersedia
    }
  }

  const existingLogs = readLocal<BotWaLog[]>(STORAGE_KEYS.BOT_LOGS, SEED_BOT_WA_LOGS);
  writeLocal(STORAGE_KEYS.BOT_LOGS, [...logs, ...existingLogs]);
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
  const appUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://saungkebun.vercel.app';

  const renderedMsg = config.template_pesan
    .replaceAll('{nama_warga}', session.nama_warga)
    .replaceAll('{blok_rumah}', 'B7/16')
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
  const appUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://saungkebun.vercel.app';

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
