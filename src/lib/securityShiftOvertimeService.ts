import {
  STANDARD_SECURITY_SHIFTS,
  type SecurityShiftOverride,
  type SessionUser,
} from '../types';
import {
  createVerifiedOvertimeCashExpenseAdmin,
  deleteLinkedOvertimeCashExpenseAdmin,
} from './dataService';
import {
  getWibParts,
  isSameOfficerName,
  parseShiftWindow,
  shiftWibDateStr,
} from './securityAttendanceService';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import {
  SIM_CHANGED_EVENT,
  isSimulationSessionActive,
  readSimData,
  updateSimData,
} from './simulationStore';

const LOCAL_OVERRIDES_KEY = 'skb_security_shift_overrides_v1';
const DEFAULT_OVERTIME_AMOUNT_KEY = 'skb_default_overtime_amount_v1';
const SHIFT_OVERRIDES_EVENT = 'skb-security-shift-overrides-changed';
const DEFAULT_OVERTIME_FALLBACK = 100000;

export interface ShiftOverrideResult<T = unknown> {
  ok: boolean;
  message: string;
  data?: T;
  usedFallback?: boolean;
}

export function getDefaultOvertimeAmount(): number {
  try {
    const raw = window.localStorage.getItem(DEFAULT_OVERTIME_AMOUNT_KEY);
    if (!raw) return DEFAULT_OVERTIME_FALLBACK;
    const num = Number(raw);
    if (Number.isFinite(num) && num >= 0 && num <= 50_000_000) {
      return Math.round(num);
    }
    return DEFAULT_OVERTIME_FALLBACK;
  } catch {
    return DEFAULT_OVERTIME_FALLBACK;
  }
}

export function setDefaultOvertimeAmount(amount: number): number {
  const clean = Math.max(0, Math.min(50_000_000, Math.round(Number(amount) || 0)));
  try {
    window.localStorage.setItem(DEFAULT_OVERTIME_AMOUNT_KEY, String(clean));
  } catch {
    // Abaikan bila localStorage terbatas
  }
  return clean;
}

export function isSundayOvertimeShift(shiftName?: string | null): boolean {
  return (shiftName || '').trim().toLowerCase().includes('lembur');
}

/**
 * Format YYYY-MM-DD menjadi DD/MM/YYYY sesuai spesifikasi keterangan Buku Kas:
 * `Lembur Minggu (19:00-07:00 WIB) - [Nama Petugas] - Tgl [DD/MM/YYYY]`
 */
export function formatDateDmySlash(shiftDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(shiftDate.trim());
  if (!match) return shiftDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function buildOvertimeCashDescription(officerName: string, shiftDate: string): string {
  return `Lembur Minggu (19:00-07:00 WIB) - ${officerName.trim()} - Tgl ${formatDateDmySlash(shiftDate)}`;
}

export function buildMultiOvertimeCashDescription(
  officerName: string,
  overrides: Pick<SecurityShiftOverride, 'shift_date'>[]
): string {
  if (overrides.length === 0) {
    return `Lembur Minggu (19:00-07:00 WIB) - ${officerName.trim()}`;
  }
  const sortedDates = [...overrides]
    .map((o) => o.shift_date)
    .sort((a, b) => a.localeCompare(b))
    .map((d) => formatDateDmySlash(d));
  const uniqueDates = Array.from(new Set(sortedDates));
  return `Lembur Minggu (19:00-07:00 WIB) - ${officerName.trim()} - Tgl ${uniqueDates.join(', ')}`;
}

/**
 * Mengembalikan tanggal hari Minggu terdekat (hari ini jika Minggu, atau Minggu mendatang dalam WIB).
 */
export function getNearestSundayWibDateStr(now: Date = new Date()): string {
  const wib = getWibParts(now);
  if (wib.weekdayIndex === 0) return wib.dateStr;
  const daysUntilSunday = 7 - wib.weekdayIndex;
  return shiftWibDateStr(wib.dateStr, daysUntilSunday);
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `shift-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emitOverridesChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(SHIFT_OVERRIDES_EVENT));
  } catch {
    // Abaikan
  }
}

function normalizeOverrideRow(row: Record<string, unknown>): SecurityShiftOverride | null {
  const id = String(row.id ?? '').trim();
  const officerName = String(row.officer_name ?? '').trim();
  const shiftDate = String(row.shift_date ?? '').trim().slice(0, 10);
  if (!id || !officerName || !shiftDate) return null;

  const amount = Math.max(0, Math.round(Number(row.overtime_amount) || 0));
  const paymentStatus: 'unpaid' | 'paid' = row.payment_status === 'paid' ? 'paid' : 'unpaid';
  const nowIso = new Date().toISOString();

  return {
    id,
    shift_date: shiftDate,
    officer_name: officerName,
    shift_name: String(row.shift_name ?? STANDARD_SECURITY_SHIFTS[3]).trim(),
    notes: typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : null,
    overtime_amount: amount,
    payment_status: paymentStatus,
    paid_at: typeof row.paid_at === 'string' && row.paid_at.trim() ? row.paid_at : null,
    cash_transaction_id:
      typeof row.cash_transaction_id === 'string' && row.cash_transaction_id.trim()
        ? row.cash_transaction_id.trim()
        : null,
    created_by: typeof row.created_by === 'string' ? row.created_by : null,
    created_at: String(row.created_at ?? nowIso),
    updated_at: String(row.updated_at ?? row.created_at ?? nowIso),
  };
}

function readLocalOverrides(): SecurityShiftOverride[] {
  if (isSimulationSessionActive()) {
    return [...readSimData().shiftOverrides].sort(
      (a, b) =>
        b.shift_date.localeCompare(a.shift_date) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_OVERRIDES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeOverrideRow(item as Record<string, unknown>))
      .filter((item): item is SecurityShiftOverride => item !== null)
      .sort(
        (a, b) =>
          b.shift_date.localeCompare(a.shift_date) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  } catch {
    return [];
  }
}

function writeLocalOverrides(list: SecurityShiftOverride[]): void {
  const sorted = [...list]
    .sort(
      (a, b) =>
        b.shift_date.localeCompare(a.shift_date) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, 250);
  if (isSimulationSessionActive()) {
    updateSimData((curr) => ({
      ...curr,
      shiftOverrides: sorted,
    }));
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_OVERRIDES_KEY, JSON.stringify(sorted));
  } catch {
    // Abaikan
  }
}

const OVERRIDE_COLUMNS =
  'id, shift_date, officer_name, shift_name, notes, overtime_amount, payment_status, paid_at, cash_transaction_id, created_by, created_at, updated_at';

/**
 * Membaca daftar jadwal shift & lembur (security_shift_overrides).
 * Untuk petugas keamanan, secara ketat hanya mengembalikan baris milik petugas tersebut.
 */
export async function fetchShiftOverrides(
  session?: SessionUser | null,
  options?: { officerName?: string; limit?: number }
): Promise<SecurityShiftOverride[]> {
  const limit = options?.limit ?? 200;
  const officerFilter =
    options?.officerName?.trim() ||
    (session?.role === 'petugas' ? session.nama_warga.trim() : '');

  const filterLocal = (rows: SecurityShiftOverride[]) => {
    const filtered = officerFilter
      ? rows.filter((r) => isSameOfficerName(r.officer_name, officerFilter))
      : rows;
    return filtered.slice(0, limit);
  };

  const localRows = readLocalOverrides();
  if (!isSupabaseConfigured()) {
    return filterLocal(localRows);
  }

  try {
    const supabase = getSupabaseClient(session || null);
    if (!supabase) return filterLocal(localRows);

    let query = supabase
      .from('security_shift_overrides')
      .select(OVERRIDE_COLUMNS)
      .order('shift_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (officerFilter) {
      query = query.ilike('officer_name', officerFilter);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      return filterLocal(localRows);
    }

    const normalized = data
      .map((row) => normalizeOverrideRow(row as Record<string, unknown>))
      .filter((row): row is SecurityShiftOverride => row !== null);

    if (!officerFilter) {
      writeLocalOverrides(normalized);
    } else {
      const others = localRows.filter((r) => !isSameOfficerName(r.officer_name, officerFilter));
      writeLocalOverrides([...normalized, ...others]);
    }

    return normalized;
  } catch {
    return filterLocal(localRows);
  }
}

/**
 * Mencari jadwal shift/lembur aktif saat ini untuk seorang petugas (mendukung lintas hari 19:00-07:00 WIB).
 */
export function findActiveOverrideForOfficer(
  overrides: SecurityShiftOverride[],
  officerName: string,
  now: Date = new Date()
): SecurityShiftOverride | null {
  const wib = getWibParts(now);
  const todayStr = wib.dateStr;
  const yesterdayStr = shiftWibDateStr(todayStr, -1);

  const officerOverrides = overrides.filter((o) => isSameOfficerName(o.officer_name, officerName));
  if (officerOverrides.length === 0) return null;

  // 1. Jika dini hari/pagi (< 08:30 WIB), cek apakah ada shift lintas hari (Lembur Minggu / Shift 3) mulai kemarin
  if (wib.hour < 8 || (wib.hour === 8 && wib.minute <= 30)) {
    const overnightFromYesterday = officerOverrides.find((o) => {
      if (o.shift_date !== yesterdayStr) return false;
      const win = parseShiftWindow(o.shift_name);
      return win.isOvernight;
    });
    if (overnightFromYesterday) return overnightFromYesterday;
  }

  // 2. Cek jadwal hari ini (prioritaskan Lembur Minggu jika ada)
  const todays = officerOverrides.filter((o) => o.shift_date === todayStr);
  if (todays.length > 0) {
    return todays.find((o) => isSundayOvertimeShift(o.shift_name)) || todays[0];
  }

  return null;
}

/**
 * Menambahkan jadwal Shift / Lembur Minggu baru oleh Admin.
 * Bila `payImmediately = true` untuk Lembur Minggu, langsung membayarkan & mencatat ke Buku Kas.
 */
export async function createShiftOverrideAdmin(
  session: SessionUser,
  payload: {
    shift_date: string;
    officer_name: string;
    petugas_id?: string | null;
    shift_name: string;
    overtime_amount?: number;
    notes?: string | null;
    payImmediately?: boolean;
  }
): Promise<ShiftOverrideResult<SecurityShiftOverride>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat menjadwalkan shift & lembur.' };
  }

  const officerName = payload.officer_name.trim();
  const shiftDate = payload.shift_date.trim().slice(0, 10);
  const shiftName = payload.shift_name.trim();
  const isOvertime = isSundayOvertimeShift(shiftName);
  const overtimeAmount = isOvertime
    ? Math.max(0, Math.round(Number(payload.overtime_amount) || 0))
    : 0;
  const cleanNotes = payload.notes?.trim().slice(0, 400) || null;

  if (!officerName || !shiftDate || !shiftName) {
    return { ok: false, message: 'Petugas, tanggal, dan jenis shift wajib diisi.' };
  }

  if (isOvertime && payload.payImmediately && overtimeAmount <= 0) {
    return {
      ok: false,
      message: 'Isi Nominal Lembur (Rp) lebih dari 0 untuk langsung membayarkan ke Kas.',
    };
  }

  // Cek anti-duplikat pada tanggal + petugas + shift yang sama
  const existing = readLocalOverrides().find(
    (o) =>
      o.shift_date === shiftDate &&
      isSameOfficerName(o.officer_name, officerName) &&
      o.shift_name.trim().toLowerCase() === shiftName.toLowerCase()
  );
  if (existing) {
    return {
      ok: false,
      message: `Jadwal ${shiftName} untuk ${officerName} pada ${formatDateDmySlash(shiftDate)} sudah ada.`,
    };
  }

  const nowIso = new Date().toISOString();
  let createdRecord: SecurityShiftOverride | null = null;
  let usedFallback = false;

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const uuidPetugasId =
          payload.petugas_id && !payload.petugas_id.startsWith('petugas-')
            ? payload.petugas_id
            : null;
        const baseInsert = {
          shift_date: shiftDate,
          officer_name: officerName,
          shift_name: shiftName,
          notes: cleanNotes,
          overtime_amount: overtimeAmount,
          payment_status: 'unpaid',
          paid_at: null,
          cash_transaction_id: null,
          created_by: session.nama_warga || 'Admin',
          updated_at: nowIso,
        };

        let { data, error } = await supabase
          .from('security_shift_overrides')
          .insert({
            ...baseInsert,
            petugas_id: uuidPetugasId,
          })
          .select(OVERRIDE_COLUMNS)
          .single();

        if (error && String((error as { message?: string }).message || '').toLowerCase().includes('petugas_id')) {
          const retry = await supabase
            .from('security_shift_overrides')
            .insert(baseInsert)
            .select(OVERRIDE_COLUMNS)
            .single();
          data = retry.data;
          error = retry.error;
        }

        if (!error && data) {
          createdRecord = normalizeOverrideRow(data as Record<string, unknown>);
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  if (!createdRecord) {
    usedFallback = true;
    createdRecord = {
      id: createId(),
      shift_date: shiftDate,
      officer_name: officerName,
      shift_name: shiftName,
      notes: cleanNotes,
      overtime_amount: overtimeAmount,
      payment_status: 'unpaid',
      paid_at: null,
      cash_transaction_id: null,
      created_by: session.nama_warga || 'Admin',
      created_at: nowIso,
      updated_at: nowIso,
    };
  }

  const nextList = [createdRecord, ...readLocalOverrides().filter((r) => r.id !== createdRecord!.id)];
  writeLocalOverrides(nextList);
  emitOverridesChanged();

  // Jika Admin mencentang "Langsung Bayarkan & Catat ke Kas" pada Lembur Minggu
  if (isOvertime && payload.payImmediately && overtimeAmount > 0) {
    const payRes = await payOvertimeForShiftOverrideAdmin(session, createdRecord, {
      overtimeAmount,
      petugasId: payload.petugas_id || null,
    });
    if (!payRes.ok || !payRes.data) {
      return {
        ok: true,
        message: `Jadwal lembur tersimpan, namun pembayaran kas gagal: ${payRes.message}`,
        data: createdRecord,
        usedFallback,
      };
    }
    return {
      ok: true,
      message: `Jadwal Lembur Minggu disimpan & langsung dibayarkan ke Kas (${payRes.message}).`,
      data: payRes.data,
      usedFallback: usedFallback || payRes.usedFallback,
    };
  }

  return {
    ok: true,
    message: usedFallback
      ? `Jadwal ${shiftName} untuk ${officerName} tersimpan (jalankan SQL migrasi v6 untuk sinkron Supabase).`
      : `Jadwal ${shiftName} untuk ${officerName} berhasil disimpan.`,
    data: createdRecord,
    usedFallback,
  };
}

/**
 * Membayarkan Lembur Minggu & otomatis mencatat Pengeluaran ke Buku Kas (transaksi_kas).
 * Menerapkan validasi anti-ganda (menolak jika payment_status === 'paid' atau sudah punya cash_transaction_id).
 */
export async function payOvertimeForShiftOverrideAdmin(
  session: SessionUser,
  override: SecurityShiftOverride,
  options?: {
    overtimeAmount?: number;
    petugasId?: string | null;
  }
): Promise<ShiftOverrideResult<SecurityShiftOverride>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat memproses pembayaran lembur.' };
  }

  // Validasi Anti-Ganda ketat
  if (override.payment_status === 'paid' || override.cash_transaction_id) {
    return {
      ok: false,
      message: 'Lembur ini sudah berstatus LUNAS dan telah tercatat di Buku Kas.',
    };
  }

  // Cek ulang ke server bila online agar tidak terjadi race condition dari 2 perangkat Admin
  if (isSupabaseConfigured() && !override.id.startsWith('shift-')) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const { data: fresh } = await supabase
          .from('security_shift_overrides')
          .select('payment_status, cash_transaction_id')
          .eq('id', override.id)
          .maybeSingle();
        if (fresh && (fresh.payment_status === 'paid' || fresh.cash_transaction_id)) {
          return {
            ok: false,
            message: 'Lembur ini baru saja dibayarkan (LUNAS) — dibatalkan untuk mencegah double entry.',
          };
        }
      }
    } catch {
      // Lanjut dengan data lokal
    }
  }

  const finalAmount = Math.round(
    options?.overtimeAmount !== undefined ? options.overtimeAmount : override.overtime_amount
  );
  if (!Number.isFinite(finalAmount) || finalAmount <= 0 || finalAmount > 50_000_000) {
    return { ok: false, message: 'Nominal lembur harus lebih dari Rp 0.' };
  }

  const paidAtIso = new Date().toISOString();
  const paymentDateWib = getWibParts(new Date(paidAtIso)).dateStr;
  const description = buildOvertimeCashDescription(override.officer_name, override.shift_date);

  // 1. Catat transaksi pengeluaran otomatis ke tabel transaksi_kas
  const cashRes = await createVerifiedOvertimeCashExpenseAdmin(session, {
    shift_override_id: override.id,
    officer_name: override.officer_name,
    petugas_id: options?.petugasId || null,
    tanggal: paymentDateWib,
    nominal: finalAmount,
    keterangan: description,
  });

  if (cashRes.error || !cashRes.data) {
    return {
      ok: false,
      message: cashRes.error || 'Gagal mencatat pengeluaran lembur ke Buku Kas.',
    };
  }

  const cashTrx = cashRes.data;
  const updatedLocal: SecurityShiftOverride = {
    ...override,
    overtime_amount: finalAmount,
    payment_status: 'paid',
    paid_at: paidAtIso,
    cash_transaction_id: cashTrx.id,
    updated_at: paidAtIso,
  };

  let usedFallback = false;
  if (isSupabaseConfigured() && !override.id.startsWith('shift-')) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const uuidCashId = !cashTrx.id.startsWith('kas-') ? cashTrx.id : null;
        const { data, error } = await supabase
          .from('security_shift_overrides')
          .update({
            overtime_amount: finalAmount,
            payment_status: 'paid',
            paid_at: paidAtIso,
            cash_transaction_id: uuidCashId,
            updated_at: paidAtIso,
          })
          .eq('id', override.id)
          .select(OVERRIDE_COLUMNS)
          .maybeSingle();

        if (!error && data) {
          const synced = normalizeOverrideRow(data as Record<string, unknown>) || updatedLocal;
          // Pertahankan cash_transaction_id lokal jika fallback kas lokal
          const merged: SecurityShiftOverride = {
            ...synced,
            cash_transaction_id: synced.cash_transaction_id || cashTrx.id,
          };
          const next = readLocalOverrides().map((r) => (r.id === merged.id ? merged : r));
          writeLocalOverrides(next.some((r) => r.id === merged.id) ? next : [merged, ...next]);
          emitOverridesChanged();
          return {
            ok: true,
            message: `Tercatat ke Kas (${cashTrx.no_bukti}) & Saldo Kas otomatis diperbarui.`,
            data: merged,
          };
        }
        usedFallback = true;
      }
    } catch {
      usedFallback = true;
    }
  } else {
    usedFallback = true;
  }

  const existingList = readLocalOverrides();
  const nextList = existingList.some((r) => r.id === override.id)
    ? existingList.map((r) => (r.id === override.id ? updatedLocal : r))
    : [updatedLocal, ...existingList];
  writeLocalOverrides(nextList);
  emitOverridesChanged();

  return {
    ok: true,
    message: `Tercatat ke Kas (${cashTrx.no_bukti}) & status menjadi LUNAS.`,
    data: updatedLocal,
    usedFallback,
  };
}

/**
 * Menghapus / membatalkan jadwal shift/lembur.
 * Jika jadwal sudah berstatus LUNAS, otomatis menghapus transaksi pengeluaran kas terkait
 * agar Saldo Kas utama, Rekap Bulanan, dan LPJ kembali akurat.
 */
export async function deleteShiftOverrideWithCashSyncAdmin(
  session: SessionUser,
  override: SecurityShiftOverride
): Promise<ShiftOverrideResult<boolean>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat menghapus jadwal shift/lembur.' };
  }

  const wasPaid = override.payment_status === 'paid' || Boolean(override.cash_transaction_id);

  // 1. Jika sudah dibayar, hapus transaksi kas terkait terlebih dahulu
  if (wasPaid) {
    await deleteLinkedOvertimeCashExpenseAdmin(
      session,
      override.cash_transaction_id,
      override.id
    );
  }

  // 2. Hapus baris security_shift_overrides
  if (isSupabaseConfigured() && !override.id.startsWith('shift-')) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        await supabase.from('security_shift_overrides').delete().eq('id', override.id);
      }
    } catch {
      // Tetap hapus dari cache lokal
    }
  }

  writeLocalOverrides(readLocalOverrides().filter((r) => r.id !== override.id));
  emitOverridesChanged();

  return {
    ok: true,
    message: wasPaid
      ? 'Jadwal lembur dihapus & transaksi pengeluaran kas terkait dibatalkan otomatis. Saldo Kas kembali akurat.'
      : 'Jadwal shift/lembur berhasil dihapus.',
    data: true,
  };
}

/**
 * Membatalkan pencairan / pembayaran Lembur Minggu tanpa menghapus jadwal shift-nya.
 * Otomatis menghapus transaksi pengeluaran terkait di Buku Kas & Tab Honor Petugas
 * serta mengembalikan status jadwal menjadi 'unpaid' (Belum Dibayar).
 */
export async function cancelOvertimePaymentWithCashSyncAdmin(
  session: SessionUser,
  override: SecurityShiftOverride
): Promise<ShiftOverrideResult<SecurityShiftOverride>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat membatalkan pembayaran lembur.' };
  }

  const wasPaid = override.payment_status === 'paid' || Boolean(override.cash_transaction_id);
  if (!wasPaid) {
    return { ok: false, message: 'Jadwal lembur ini memang belum berstatus dibayar.' };
  }

  // 1. Hapus transaksi pengeluaran terkait di Buku Kas (otomatis menyegarkan Saldo Kas, LPJ & Tab Honor Petugas)
  await deleteLinkedOvertimeCashExpenseAdmin(
    session,
    override.cash_transaction_id,
    override.id
  );

  const nowIso = new Date().toISOString();
  const revertedLocal: SecurityShiftOverride = {
    ...override,
    payment_status: 'unpaid',
    paid_at: null,
    cash_transaction_id: null,
    updated_at: nowIso,
  };

  if (isSupabaseConfigured() && !override.id.startsWith('shift-')) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        await supabase
          .from('security_shift_overrides')
          .update({
            payment_status: 'unpaid',
            paid_at: null,
            cash_transaction_id: null,
            updated_at: nowIso,
          })
          .eq('id', override.id);
      }
    } catch {
      // Tetap sinkronkan cache lokal
    }
  }

  const nextLocal = readLocalOverrides().map((r) => (r.id === override.id ? revertedLocal : r));
  writeLocalOverrides(nextLocal);
  emitOverridesChanged();

  return {
    ok: true,
    message:
      'Pembayaran lembur dibatalkan — transaksi di Buku Kas & Tab Honor Petugas otomatis terhapus, status kembali Belum Dibayar.',
    data: revertedLocal,
  };
}

/**
 * Sinkronisasi Buku Kas -> Kelola Shift & Lembur:
 * Menandai 1 atau beberapa jadwal lembur milik petugas sebagai Sudah Dibayar / LUNAS
 * setelah transaksi pengeluaran "Honor & Lembur Keamanan" disimpan di Buku Kas.
 */
export async function markShiftOverridesPaidByCashTransactionAdmin(
  session: SessionUser,
  overrideIds: string[],
  cashTransactionId: string,
  paidAtIso: string = new Date().toISOString()
): Promise<ShiftOverrideResult<number>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat memperbarui status pembayaran lembur.' };
  }
  const uniqueIds = Array.from(new Set(overrideIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return { ok: true, message: 'Tidak ada jadwal lembur tertaut.', data: 0 };
  }

  const uuidCashId = !cashTransactionId.startsWith('kas-') ? cashTransactionId : null;
  const serverIds = uniqueIds.filter((id) => !id.startsWith('shift-'));

  if (isSupabaseConfigured() && serverIds.length > 0) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        await supabase
          .from('security_shift_overrides')
          .update({
            payment_status: 'paid',
            paid_at: paidAtIso,
            cash_transaction_id: uuidCashId,
            updated_at: paidAtIso,
          })
          .in('id', serverIds);
      }
    } catch {
      // Tetap sinkronkan cache lokal
    }
  }

  const idSet = new Set(uniqueIds);
  const current = readLocalOverrides();
  const updated = current.map((ov) =>
    idSet.has(ov.id)
      ? {
          ...ov,
          payment_status: 'paid' as const,
          paid_at: paidAtIso,
          cash_transaction_id: cashTransactionId,
          updated_at: paidAtIso,
        }
      : ov
  );
  writeLocalOverrides(updated);
  emitOverridesChanged();

  return {
    ok: true,
    message: `${uniqueIds.length} jadwal lembur otomatis diperbarui menjadi Sudah Dibayar / LUNAS.`,
    data: uniqueIds.length,
  };
}

/**
 * Sinkronisasi Penghapusan Buku Kas -> Kelola Shift & Lembur:
 * Saat transaksi pengeluaran honor/lembur dihapus dari Buku Kas, kembalikan status
 * jadwal terkait di security_shift_overrides menjadi "Belum Dibayar" (unpaid).
 */
export async function revertShiftOverridesByCashTransactionAdmin(
  session: SessionUser,
  cashTransactionId: string,
  shiftOverrideId?: string | null
): Promise<ShiftOverrideResult<number>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat mengubah status pembayaran lembur.' };
  }

  const cleanCashId = cashTransactionId.trim();
  const cleanOverrideId = shiftOverrideId?.trim() || null;
  const nowIso = new Date().toISOString();
  let revertedCount = 0;

  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        if (cleanCashId && !cleanCashId.startsWith('kas-')) {
          const { data } = await supabase
            .from('security_shift_overrides')
            .update({
              payment_status: 'unpaid',
              paid_at: null,
              cash_transaction_id: null,
              updated_at: nowIso,
            })
            .eq('cash_transaction_id', cleanCashId)
            .select('id');
          if (Array.isArray(data)) {
            revertedCount += data.length;
          }
        }
        if (cleanOverrideId && !cleanOverrideId.startsWith('shift-')) {
          const { data } = await supabase
            .from('security_shift_overrides')
            .update({
              payment_status: 'unpaid',
              paid_at: null,
              cash_transaction_id: null,
              updated_at: nowIso,
            })
            .eq('id', cleanOverrideId)
            .select('id');
          if (Array.isArray(data) && revertedCount === 0) {
            revertedCount += data.length;
          }
        }
      }
    } catch {
      // Tetap kembalikan status pada cache lokal
    }
  }

  let localReverted = 0;
  const nextLocal = readLocalOverrides().map((ov) => {
    const matchesCash = Boolean(cleanCashId && ov.cash_transaction_id === cleanCashId);
    const matchesOverride = Boolean(cleanOverrideId && ov.id === cleanOverrideId);
    if (!matchesCash && !matchesOverride) return ov;
    localReverted += 1;
    return {
      ...ov,
      payment_status: 'unpaid' as const,
      paid_at: null,
      cash_transaction_id: null,
      updated_at: nowIso,
    };
  });

  if (localReverted > 0 || revertedCount > 0) {
    writeLocalOverrides(nextLocal);
    emitOverridesChanged();
  }

  return {
    ok: true,
    message:
      Math.max(revertedCount, localReverted) > 0
        ? 'Status lembur terkait dikembalikan menjadi Belum Dibayar.'
        : 'Tidak ada jadwal lembur terkait.',
    data: Math.max(revertedCount, localReverted),
  };
}

/**
 * Memperbarui data jadwal shift / nama petugas / nominal lembur secara real-time oleh Admin.
 */
export async function updateShiftOverrideAdmin(
  session: SessionUser,
  overrideId: string,
  patch: {
    officer_name: string;
    shift_date: string;
    shift_name: string;
    overtime_amount?: number;
    notes?: string | null;
  }
): Promise<ShiftOverrideResult<SecurityShiftOverride>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat mengubah jadwal shift & lembur.' };
  }

  const officerName = patch.officer_name.trim();
  const shiftDate = patch.shift_date.trim().slice(0, 10);
  const shiftName = patch.shift_name.trim();
  const isLembur = isSundayOvertimeShift(shiftName);
  const cleanAmount = isLembur
    ? Math.max(0, Math.min(50_000_000, Math.round(Number(patch.overtime_amount) || 0)))
    : 0;
  const cleanNotes = patch.notes?.trim().slice(0, 400) || null;
  const nowIso = new Date().toISOString();

  if (!officerName || !shiftDate || !shiftName) {
    return { ok: false, message: 'Nama petugas, tanggal, dan jenis shift wajib diisi.' };
  }

  if (isSupabaseConfigured() && !overrideId.startsWith('shift-')) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const { data, error } = await supabase
          .from('security_shift_overrides')
          .update({
            officer_name: officerName,
            shift_date: shiftDate,
            shift_name: shiftName,
            overtime_amount: cleanAmount,
            notes: cleanNotes,
            updated_at: nowIso,
          })
          .eq('id', overrideId)
          .select(OVERRIDE_COLUMNS)
          .maybeSingle();

        if (!error && data) {
          const synced = normalizeOverrideRow(data as Record<string, unknown>);
          if (synced) {
            const current = readLocalOverrides();
            writeLocalOverrides(
              current.some((r) => r.id === synced.id)
                ? current.map((r) => (r.id === synced.id ? synced : r))
                : [synced, ...current]
            );
            emitOverridesChanged();
            return {
              ok: true,
              message: `Jadwal ${synced.officer_name} diperbarui & tersinkron ke Buku Kas.`,
              data: synced,
            };
          }
        }
      }
    } catch {
      // Fallback lokal
    }
  }

  let updatedLocal: SecurityShiftOverride | undefined;
  const nextLocal = readLocalOverrides().map((ov) => {
    if (ov.id !== overrideId) return ov;
    updatedLocal = {
      ...ov,
      officer_name: officerName,
      shift_date: shiftDate,
      shift_name: shiftName,
      overtime_amount: cleanAmount,
      notes: cleanNotes,
      updated_at: nowIso,
    };
    return updatedLocal;
  });

  if (!updatedLocal) {
    return { ok: false, message: 'Jadwal tidak ditemukan.' };
  }

  writeLocalOverrides(nextLocal);
  emitOverridesChanged();
  return {
    ok: true,
    message: `Jadwal ${updatedLocal.officer_name} diperbarui.`,
    data: updatedLocal,
    usedFallback: true,
  };
}

/**
 * Berlangganan Supabase Realtime pada tabel security_shift_overrides + event lokal.
 */
export function subscribeShiftOverrides(
  session: SessionUser | null,
  onChange: () => void
): () => void {
  const onLocalEvent = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_OVERRIDES_KEY) {
      onChange();
    }
  };

  window.addEventListener(SHIFT_OVERRIDES_EVENT, onLocalEvent);
  window.addEventListener('storage', onStorage);
  window.addEventListener(SIM_CHANGED_EVENT, onLocalEvent);

  if (!isSupabaseConfigured() || isSimulationSessionActive()) {
    return () => {
      window.removeEventListener(SHIFT_OVERRIDES_EVENT, onLocalEvent);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SIM_CHANGED_EVENT, onLocalEvent);
    };
  }

  const supabase = getSupabaseClient(session || null);
  if (!supabase) {
    return () => {
      window.removeEventListener(SHIFT_OVERRIDES_EVENT, onLocalEvent);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SIM_CHANGED_EVENT, onLocalEvent);
    };
  }

  const channelName = `shift-overrides-rt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'security_shift_overrides' },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    window.removeEventListener(SHIFT_OVERRIDES_EVENT, onLocalEvent);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SIM_CHANGED_EVENT, onLocalEvent);
    try {
      void supabase.removeChannel(channel);
    } catch {
      // Abaikan
    }
  };
}
