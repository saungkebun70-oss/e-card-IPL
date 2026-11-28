import {
  STANDARD_SECURITY_SHIFTS,
  type SecurityAttendanceRecord,
  type SecurityAttendanceStatus,
  type SessionUser,
} from '../types';
import { compressProofImage } from './imageCompressor';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { routeNewMediaUploadAuto } from './googleDriveHybridService';
import { dispatchActivityNotifications, getAllAdminUserIds } from './notificationService';
import {
  isSimulationMode,
  readSimData,
  SIM_CHANGED_EVENT,
  updateSimData,
} from './simulationStore';

const LOCAL_STORAGE_KEY = 'skb_security_attendance_v1';
const ATTENDANCE_CHANGE_EVENT = 'skb-security-attendance-changed';
const MAX_NOTE_LENGTH = 500;
const MAX_RAW_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB sebelum kompresi

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface AttendanceResult<T = unknown> {
  ok: boolean;
  message: string;
  data?: T;
  usedFallback?: boolean;
}

export interface WibDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekdayIndex: number; // 0 = Minggu ... 6 = Sabtu
  dateStr: string; // YYYY-MM-DD
  monthStr: string; // YYYY-MM
  timeStr: string; // HH:mm:ss
  hhmm: string; // HH:mm
  dateLabel: string; // e.g. Sab, 21 Nov 2026
}

export interface ParsedShiftWindow {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  isOvernight: boolean;
  isLemburMinggu: boolean;
  hasExplicitWindow: boolean;
}

export interface DetectedActiveShift {
  shiftName: string;
  shiftDate: string; // YYYY-MM-DD (tanggal mulai shift WIB)
  isOvernight: boolean;
  isLemburMinggu: boolean;
  source: 'assigned' | 'auto_time';
}

export interface AttendanceEvaluation {
  isLate: boolean;
  lateMinutes: number;
  punctualityLabel: 'Tepat Waktu' | 'Terlambat';
  isMissingClockOut: boolean;
  durationMinutes: number;
  durationLabel: string;
  isOvernight: boolean;
  isLemburMinggu: boolean;
  scheduledStartMs: number | null;
  scheduledEndMs: number | null;
}

const WEEKDAY_SHORT_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const HARI_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN_SINGKAT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

export function getWibParts(date: Date = new Date()): WibDateParts {
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(safeDate);

  const pick = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const year = Number(pick('year')) || safeDate.getFullYear();
  const month = Number(pick('month')) || safeDate.getMonth() + 1;
  const day = Number(pick('day')) || safeDate.getDate();
  const rawHour = Number(pick('hour'));
  const hour = Number.isFinite(rawHour) ? rawHour % 24 : safeDate.getHours();
  const minute = Number(pick('minute')) || 0;
  const second = Number(pick('second')) || 0;
  const weekdayIndex = WEEKDAY_SHORT_MAP[pick('weekday')] ?? safeDate.getDay();

  const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
  const monthStr = `${year}-${pad2(month)}`;
  const timeStr = `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  const hhmm = `${pad2(hour)}:${pad2(minute)}`;
  const hariShort = HARI_ID[weekdayIndex]?.slice(0, 3) || 'Har';
  const bulanShort = BULAN_SINGKAT_ID[month - 1] || pad2(month);
  const dateLabel = `${hariShort}, ${pad2(day)} ${bulanShort} ${year}`;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekdayIndex,
    dateStr,
    monthStr,
    timeStr,
    hhmm,
    dateLabel,
  };
}

export function shiftWibDateStr(dateStr: string, deltaDays: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return getWibParts().dateStr;
  const baseUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const target = new Date(baseUtc + deltaDays * 86_400_000);
  return `${target.getUTCFullYear()}-${pad2(target.getUTCMonth() + 1)}-${pad2(target.getUTCDate())}`;
}

export function formatWibTime(isoString?: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = getWibParts(d);
  return `${parts.hhmm} WIB`;
}

export function formatWibDateStr(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (!match) return dateStr;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dt = new Date(`${y}-${pad2(m)}-${pad2(d)}T12:00:00+07:00`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  return getWibParts(dt).dateLabel;
}

export function formatWibDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = getWibParts(d);
  return `${pad2(parts.day)} ${BULAN_SINGKAT_ID[parts.month - 1]} ${parts.year}, ${parts.hhmm} WIB`;
}

export function formatDurationMinutes(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return '0 mnt';
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours <= 0) return `${mins} mnt`;
  if (mins === 0) return `${hours} jam`;
  return `${hours} jam ${mins} mnt`;
}

export function formatHoursDecimal(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '0 jam';
  const hours = totalMinutes / 60;
  return `${hours.toFixed(1).replace('.0', '')} jam`;
}

export function parseShiftWindow(shiftName?: string | null): ParsedShiftWindow {
  const raw = (shiftName || '').trim();
  const lower = raw.toLowerCase();
  const isLemburMinggu = lower.includes('lembur');

  const regex = /(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/;
  const match = regex.exec(raw);
  if (match) {
    const startHour = Math.min(23, Math.max(0, Number(match[1])));
    const startMinute = Math.min(59, Math.max(0, Number(match[2])));
    const endHour = Math.min(23, Math.max(0, Number(match[3])));
    const endMinute = Math.min(59, Math.max(0, Number(match[4])));
    const startTotal = startHour * 60 + startMinute;
    const endTotal = endHour * 60 + endMinute;
    return {
      startHour,
      startMinute,
      endHour,
      endMinute,
      isOvernight: endTotal <= startTotal,
      isLemburMinggu,
      hasExplicitWindow: true,
    };
  }

  if (lower.includes('shift 1') || lower.includes('pagi')) {
    return {
      startHour: 7,
      startMinute: 0,
      endHour: 15,
      endMinute: 0,
      isOvernight: false,
      isLemburMinggu: false,
      hasExplicitWindow: true,
    };
  }
  if (lower.includes('shift 2') || lower.includes('siang') || lower.includes('sore')) {
    return {
      startHour: 15,
      startMinute: 0,
      endHour: 23,
      endMinute: 0,
      isOvernight: false,
      isLemburMinggu: false,
      hasExplicitWindow: true,
    };
  }
  if (lower.includes('shift 3')) {
    return {
      startHour: 23,
      startMinute: 0,
      endHour: 7,
      endMinute: 0,
      isOvernight: true,
      isLemburMinggu: false,
      hasExplicitWindow: true,
    };
  }
  if (isLemburMinggu || lower.includes('malam')) {
    return {
      startHour: 19,
      startMinute: 0,
      endHour: 7,
      endMinute: 0,
      isOvernight: true,
      isLemburMinggu,
      hasExplicitWindow: true,
    };
  }

  return {
    startHour: 7,
    startMinute: 0,
    endHour: 15,
    endMinute: 0,
    isOvernight: false,
    isLemburMinggu: false,
    hasExplicitWindow: false,
  };
}

/**
 * Deteksi shift aktif otomatis berdasarkan jadwal petugas dari Admin + waktu WIB berjalan.
 * Mendukung Shift 1, Shift 2, Shift 3, serta Lembur Minggu (19:00-07:00 WIB) lintas hari.
 */
export function detectActiveShift(
  assignedShift?: string | null,
  now: Date = new Date()
): DetectedActiveShift {
  const wib = getWibParts(now);
  const cleanAssigned = (assignedShift || '').trim();
  const parsedAssigned = parseShiftWindow(cleanAssigned);

  // Jika Admin sudah menetapkan shift spesifik (termasuk Lembur Minggu / Shift 1-3 / Pagi-Malam)
  if (cleanAssigned && parsedAssigned.hasExplicitWindow) {
    let shiftDate = wib.dateStr;
    // Untuk shift lintas hari (mis. Shift 3 23:00-07:00 atau Lembur Minggu 19:00-07:00),
    // bila saat ini dini hari/pagi (< 12:00 WIB), tanggal mulai shift adalah malam kemarin.
    if (parsedAssigned.isOvernight && wib.hour < 12) {
      shiftDate = shiftWibDateStr(wib.dateStr, -1);
    }
    return {
      shiftName: cleanAssigned,
      shiftDate,
      isOvernight: parsedAssigned.isOvernight,
      isLemburMinggu: parsedAssigned.isLemburMinggu,
      source: 'assigned',
    };
  }

  // Auto-detect berdasarkan jam WIB aktif bila shift petugas bersifat fleksibel/cadangan
  const minutesOfDay = wib.hour * 60 + wib.minute;

  // Lembur Minggu: Minggu >= 18:00 WIB atau Senin < 07:30 WIB
  if (wib.weekdayIndex === 0 && minutesOfDay >= 18 * 60) {
    return {
      shiftName: STANDARD_SECURITY_SHIFTS[3], // Lembur Minggu (19:00-07:00)
      shiftDate: wib.dateStr,
      isOvernight: true,
      isLemburMinggu: true,
      source: 'auto_time',
    };
  }
  if (wib.weekdayIndex === 1 && minutesOfDay < 7 * 60 + 30) {
    return {
      shiftName: STANDARD_SECURITY_SHIFTS[3],
      shiftDate: shiftWibDateStr(wib.dateStr, -1),
      isOvernight: true,
      isLemburMinggu: true,
      source: 'auto_time',
    };
  }

  if (minutesOfDay >= 6 * 60 && minutesOfDay < 14 * 60 + 30) {
    return {
      shiftName: STANDARD_SECURITY_SHIFTS[0], // Shift 1 (07:00-15:00)
      shiftDate: wib.dateStr,
      isOvernight: false,
      isLemburMinggu: false,
      source: 'auto_time',
    };
  }
  if (minutesOfDay >= 14 * 60 + 30 && minutesOfDay < 22 * 60 + 30) {
    return {
      shiftName: STANDARD_SECURITY_SHIFTS[1], // Shift 2 (15:00-23:00)
      shiftDate: wib.dateStr,
      isOvernight: false,
      isLemburMinggu: false,
      source: 'auto_time',
    };
  }
  // Shift 3 (23:00-07:00)
  return {
    shiftName: STANDARD_SECURITY_SHIFTS[2],
    shiftDate: wib.hour < 12 ? shiftWibDateStr(wib.dateStr, -1) : wib.dateStr,
    isOvernight: true,
    isLemburMinggu: false,
    source: 'auto_time',
  };
}

/**
 * Menghitung tanggal mulai shift WIB untuk pilihan shift tertentu.
 */
export function computeShiftDateForSelection(shiftName: string, now: Date = new Date()): string {
  const wib = getWibParts(now);
  const parsed = parseShiftWindow(shiftName);
  if (parsed.isOvernight && wib.hour < 12) {
    return shiftWibDateStr(wib.dateStr, -1);
  }
  return wib.dateStr;
}

/**
 * Evaluasi indikator keterlambatan (> 15 menit dari jadwal shift),
 * status Belum Absen Pulang, dan total durasi kerja.
 */
export function evaluateAttendance(
  record: SecurityAttendanceRecord,
  nowMs: number = Date.now()
): AttendanceEvaluation {
  const parsed = parseShiftWindow(record.shift_name);
  const clockInMs = new Date(record.clock_in_at).getTime();
  const clockOutMs = record.clock_out_at ? new Date(record.clock_out_at).getTime() : null;

  let scheduledStartMs: number | null = null;
  let scheduledEndMs: number | null = null;

  if (parsed.hasExplicitWindow && /^\d{4}-\d{2}-\d{2}/.test(record.shift_date)) {
    const cleanDate = record.shift_date.slice(0, 10);
    const startIso = `${cleanDate}T${pad2(parsed.startHour)}:${pad2(parsed.startMinute)}:00+07:00`;
    const endDateStr = parsed.isOvernight ? shiftWibDateStr(cleanDate, 1) : cleanDate;
    const endIso = `${endDateStr}T${pad2(parsed.endHour)}:${pad2(parsed.endMinute)}:00+07:00`;
    const parsedStart = new Date(startIso).getTime();
    const parsedEnd = new Date(endIso).getTime();
    if (!Number.isNaN(parsedStart)) scheduledStartMs = parsedStart;
    if (!Number.isNaN(parsedEnd)) scheduledEndMs = parsedEnd;
  }

  let lateMinutes = 0;
  if (scheduledStartMs !== null && !Number.isNaN(clockInMs)) {
    lateMinutes = Math.round((clockInMs - scheduledStartMs) / 60_000);
  }
  const isLate = lateMinutes > 15;

  const endRefMs = clockOutMs !== null && !Number.isNaN(clockOutMs) ? clockOutMs : nowMs;
  const durationMinutes =
    !Number.isNaN(clockInMs) && endRefMs >= clockInMs
      ? Math.max(0, Math.round((endRefMs - clockInMs) / 60_000))
      : 0;

  // Tandai "Belum Absen Pulang" bila status masih on_duty melewati 30 menit setelah jadwal selesai
  // atau sudah lebih dari 14 jam sejak absen masuk.
  const overdueBySchedule =
    record.status === 'on_duty' &&
    scheduledEndMs !== null &&
    nowMs > scheduledEndMs + 30 * 60_000;
  const overdueByDuration =
    record.status === 'on_duty' &&
    !Number.isNaN(clockInMs) &&
    nowMs - clockInMs > 14 * 3_600_000;
  const isMissingClockOut = overdueBySchedule || overdueByDuration;

  return {
    isLate,
    lateMinutes: Math.max(0, lateMinutes),
    punctualityLabel: isLate ? 'Terlambat' : 'Tepat Waktu',
    isMissingClockOut,
    durationMinutes,
    durationLabel: formatDurationMinutes(durationMinutes),
    isOvernight: parsed.isOvernight,
    isLemburMinggu: parsed.isLemburMinggu,
    scheduledStartMs,
    scheduledEndMs,
  };
}

/**
 * Menghasilkan ISO timestamp jadwal selesai shift untuk fitur bantuan 1-klik Admin saat koreksi.
 */
export function getScheduledEndIsoForRecord(record: SecurityAttendanceRecord): string {
  const parsed = parseShiftWindow(record.shift_name);
  const cleanDate = record.shift_date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return new Date().toISOString();
  }
  const endDateStr = parsed.isOvernight ? shiftWibDateStr(cleanDate, 1) : cleanDate;
  const iso = `${endDateStr}T${pad2(parsed.endHour)}:${pad2(parsed.endMinute)}:00+07:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

/**
 * Konversi ISO timestamp ke nilai <input type="datetime-local" /> dalam zona WIB (+07:00).
 */
export function isoToWibDatetimeLocal(isoString?: string | null): string {
  if (!isoString) return '';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '';
  const p = getWibParts(dt);
  return `${p.dateStr}T${p.hhmm}`;
}

/**
 * Konversi nilai <input type="datetime-local" /> (dianggap WIB +07:00) menjadi ISO string UTC.
 */
export function wibDatetimeLocalToIso(localVal: string): string | null {
  const trimmed = localVal.trim();
  if (!trimmed) return null;
  const normalized = trimmed.length === 16 ? `${trimmed}:00+07:00` : `${trimmed}+07:00`;
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

/**
 * Validasi URL foto absen agar hanya mengizinkan https/http atau data URL gambar raster aman.
 */
export function isSafeAttendanceImageUrl(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return true;
  }
  if (/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function normalizeOfficerNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isSameOfficerName(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalizeOfficerNameKey(a) === normalizeOfficerNameKey(b);
}

/**
 * Mencari sesi aktif (on_duty) milik petugas — mendukung shift lintas hari melewati 00:00 WIB.
 */
export function findActiveOnDutySession(
  records: SecurityAttendanceRecord[],
  officerName: string
): SecurityAttendanceRecord | null {
  const matches = records
    .filter((r) => r.status === 'on_duty' && isSameOfficerName(r.officer_name, officerName))
    .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  return matches[0] || null;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readLocalRecords(session?: SessionUser | null): SecurityAttendanceRecord[] {
  if (isSimulationMode(session)) {
    return [...readSimData().attendance]
      .map((item) => normalizeRow(item as unknown as Record<string, unknown>))
      .filter((item): item is SecurityAttendanceRecord => item !== null)
      .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeRow(item as Record<string, unknown>))
      .filter((item): item is SecurityAttendanceRecord => item !== null)
      .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  } catch {
    return [];
  }
}

function writeLocalRecords(
  records: SecurityAttendanceRecord[],
  session?: SessionUser | null
): void {
  const sorted = [...records]
    .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime())
    .slice(0, 250);
  if (isSimulationMode(session)) {
    updateSimData((curr) => ({ ...curr, attendance: sorted }));
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sorted));
  } catch {
    // Abaikan jika penyimpanan lokal terbatas
  }
}

function emitAttendanceChangeEvent(): void {
  try {
    window.dispatchEvent(new CustomEvent(ATTENDANCE_CHANGE_EVENT));
  } catch {
    // Abaikan
  }
}

function sanitizeNote(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim().slice(0, MAX_NOTE_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRow(row: Record<string, unknown>): SecurityAttendanceRecord | null {
  const id = String(row.id ?? '').trim();
  const officerName = String(row.officer_name ?? '').trim();
  const shiftDate = String(row.shift_date ?? '').trim();
  const shiftName = String(row.shift_name ?? '').trim();
  const clockInAt = String(row.clock_in_at ?? '').trim();
  if (!id || !officerName || !clockInAt) return null;

  const status: SecurityAttendanceStatus =
    row.status === 'completed' || (row.clock_out_at && row.status !== 'on_duty')
      ? 'completed'
      : 'on_duty';

  const rawPhoto = typeof row.clock_in_photo_url === 'string' ? row.clock_in_photo_url.trim() : null;
  const safePhoto = rawPhoto && isSafeAttendanceImageUrl(rawPhoto) ? rawPhoto : null;

  return {
    id,
    officer_name: officerName,
    shift_date: shiftDate || getWibParts(new Date(clockInAt)).dateStr,
    shift_name: shiftName || 'Shift Keamanan',
    clock_in_at: clockInAt,
    clock_out_at: row.clock_out_at ? String(row.clock_out_at) : null,
    status,
    clock_in_photo_url: safePhoto,
    handover_notes: typeof row.handover_notes === 'string' && row.handover_notes.trim() ? row.handover_notes.trim() : null,
    created_at: String(row.created_at ?? clockInAt),
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Gagal membaca berkas foto absensi.'));
    reader.readAsDataURL(file);
  });
}

async function uploadAttendancePhoto(
  session: SessionUser,
  officerName: string,
  file: File
): Promise<string | null> {
  const mime = file.type.toLowerCase();
  if (mime === 'image/svg+xml' || (!ALLOWED_IMAGE_MIME.has(mime) && !mime.startsWith('image/'))) {
    throw new Error('Format foto harus berupa gambar raster (JPG, PNG, atau WebP).');
  }
  if (file.size > MAX_RAW_PHOTO_BYTES) {
    throw new Error('Ukuran foto terlalu besar (maksimal 10 MB).');
  }

  const compressed = await compressProofImage(file, 960, 0.72);
  const uploadFile = compressed.file;

  if (!isSimulationMode(session)) {
    const routedDrive = await routeNewMediaUploadAuto({
      session,
      folderKey: 'absensi_keamanan',
      file: uploadFile,
      labelPrefix: `absen-${officerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
      description: `Foto absen masuk ${officerName}`,
    });
    if (routedDrive?.url && isSafeAttendanceImageUrl(routedDrive.url)) {
      return routedDrive.url;
    }
  }

  if (!isSimulationMode(session) && isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const safeOfficer =
          officerName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40) || 'petugas';
        const filePath = `absensi-keamanan/${safeOfficer}/${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('bukti-ipl')
          .upload(filePath, uploadFile, {
            cacheControl: '3600',
            upsert: false,
          });
        if (!uploadError) {
          const { data: pubData } = supabase.storage.from('bukti-ipl').getPublicUrl(filePath);
          if (pubData?.publicUrl && isSafeAttendanceImageUrl(pubData.publicUrl)) {
            return pubData.publicUrl;
          }
        }
      }
    } catch {
      // Lanjut fallback Data URL terkompresi
    }
  }

  // Fallback aman bila bucket storage belum tersedia
  const smaller = await compressProofImage(uploadFile, 640, 0.65);
  const dataUrl = await fileToDataUrl(smaller.file);
  return isSafeAttendanceImageUrl(dataUrl) ? dataUrl : null;
}

const ATTENDANCE_COLUMNS =
  'id, officer_name, shift_date, shift_name, clock_in_at, clock_out_at, status, clock_in_photo_url, handover_notes, created_at';

/**
 * Mengambil data absensi petugas keamanan dari Supabase (fallback ke localStorage bila offline/tabel belum dibuat).
 */
export async function fetchSecurityAttendance(
  session?: SessionUser | null,
  options?: { officerName?: string; limit?: number }
): Promise<SecurityAttendanceRecord[]> {
  const limit = options?.limit ?? 200;
  const officerFilter = options?.officerName?.trim() || '';

  const filterLocal = (rows: SecurityAttendanceRecord[]) => {
    const filtered = officerFilter
      ? rows.filter((r) => isSameOfficerName(r.officer_name, officerFilter))
      : rows;
    return filtered.slice(0, limit);
  };

  const localRows = readLocalRecords(session);

  if (isSimulationMode(session) || !isSupabaseConfigured()) {
    return filterLocal(localRows);
  }

  try {
    const supabase = getSupabaseClient(session || null);
    if (!supabase) return filterLocal(localRows);

    let query = supabase
      .from('security_attendance')
      .select(ATTENDANCE_COLUMNS)
      .order('clock_in_at', { ascending: false })
      .limit(limit);

    if (officerFilter) {
      query = query.ilike('officer_name', officerFilter);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) {
      return filterLocal(localRows);
    }

    const normalized = data
      .map((row) => normalizeRow(row as Record<string, unknown>))
      .filter((row): row is SecurityAttendanceRecord => row !== null);

    // Sinkronkan cache lokal bila mengambil daftar lengkap atau data petugas
    if (!officerFilter) {
      writeLocalRecords(normalized);
    } else {
      const otherOfficers = localRows.filter((r) => !isSameOfficerName(r.officer_name, officerFilter));
      writeLocalRecords([...normalized, ...otherOfficers]);
    }

    return normalized;
  } catch {
    return filterLocal(localRows);
  }
}

/**
 * Absen Masuk (Clock-In) oleh Petugas Keamanan.
 */
export async function clockInSecurityOfficer(
  session: SessionUser,
  payload: {
    officer_name: string;
    shift_date: string;
    shift_name: string;
    photoFile?: File | null;
    initialNotes?: string | null;
  }
): Promise<AttendanceResult<SecurityAttendanceRecord>> {
  const officerName = payload.officer_name.trim() || session.nama_warga.trim();
  const shiftName = payload.shift_name.trim();
  const shiftDate = payload.shift_date.trim() || getWibParts().dateStr;

  if (!officerName || !shiftName) {
    return { ok: false, message: 'Nama petugas dan jadwal shift wajib diisi.' };
  }

  let photoUrl: string | null = null;
  if (payload.photoFile) {
    try {
      photoUrl = await uploadAttendancePhoto(session, officerName, payload.photoFile);
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Gagal memproses foto absensi.',
      };
    }
  }

  const nowIso = new Date().toISOString();
  const cleanNotes = sanitizeNote(payload.initialNotes);
  const formattedInitialNote = cleanNotes ? `[Masuk] ${cleanNotes}` : null;

  if (!isSimulationMode(session) && isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const { data, error } = await supabase
          .from('security_attendance')
          .insert({
            officer_name: officerName,
            shift_date: shiftDate,
            shift_name: shiftName,
            clock_in_at: nowIso,
            clock_out_at: null,
            status: 'on_duty',
            clock_in_photo_url: photoUrl,
            handover_notes: formattedInitialNote,
          })
          .select(ATTENDANCE_COLUMNS)
          .single();

        if (!error && data) {
          const created = normalizeRow(data as Record<string, unknown>);
          if (created) {
            const localRows = readLocalRecords().filter((r) => r.id !== created.id);
            writeLocalRecords([created, ...localRows]);
            emitAttendanceChangeEvent();
            const pushTitle = 'Update dari Petugas Keamanan';
            const pushBody = `${officerName} telah mengirim laporan keamanan (Absen Masuk ${shiftName} · ${formatWibTime(created.clock_in_at)}).`;
            const attInDedup = `att-in:${created.id}`;
            void dispatchActivityNotifications(
              session,
              getAllAdminUserIds().map((uid) => ({
                user_id: uid,
                category: 'patrol' as const,
                title: pushTitle,
                message: pushBody,
                target_url: 'tab:keamanan',
                dedup_key: attInDedup,
              })),
              {
                target_roles: ['admin'],
                category: 'patrol',
                title: pushTitle,
                body: pushBody,
                target_url: 'tab:keamanan',
                dedup_key: attInDedup,
              }
            );
            return {
              ok: true,
              message: `Absen Masuk berhasil tercatat (${formatWibTime(created.clock_in_at)}). Selamat bertugas!`,
              data: created,
            };
          }
        }
      }
    } catch {
      // Fallback ke penyimpanan lokal bila tabel SQL migrasi belum dijalankan
    }
  }

  const fallbackRecord: SecurityAttendanceRecord = {
    id: createId(),
    officer_name: officerName,
    shift_date: shiftDate,
    shift_name: shiftName,
    clock_in_at: nowIso,
    clock_out_at: null,
    status: 'on_duty',
    clock_in_photo_url: photoUrl,
    handover_notes: formattedInitialNote,
    created_at: nowIso,
  };

  writeLocalRecords([fallbackRecord, ...readLocalRecords(session)], session);
  emitAttendanceChangeEvent();
  const fallbackClockInTitle = 'Update dari Petugas Keamanan';
  const fallbackClockInBody = `${officerName} telah mengirim laporan keamanan (Absen Masuk ${shiftName} · ${formatWibTime(nowIso)}).`;
  const fallbackAttInDedup = `att-in:${fallbackRecord.id}`;
  void dispatchActivityNotifications(
    session,
    getAllAdminUserIds().map((uid) => ({
      user_id: uid,
      category: 'patrol' as const,
      title: fallbackClockInTitle,
      message: fallbackClockInBody,
      target_url: 'tab:keamanan',
      dedup_key: fallbackAttInDedup,
    })),
    {
      target_roles: ['admin'],
      category: 'patrol',
      title: fallbackClockInTitle,
      body: fallbackClockInBody,
      target_url: 'tab:keamanan',
      dedup_key: fallbackAttInDedup,
    }
  );

  return {
    ok: true,
    message: isSimulationMode(session)
      ? `Absen Masuk simulasi tercatat (${formatWibTime(nowIso)}).`
      : `Absen Masuk tercatat (${formatWibTime(nowIso)}). Jalankan SQL migrasi v5 agar tersinkron realtime ke Supabase.`,
    data: fallbackRecord,
    usedFallback: !isSimulationMode(session),
  };
}

/**
 * Absen Pulang (Clock-Out) oleh Petugas Keamanan — terhubung ke sesi on_duty termasuk shift lintas hari.
 */
export async function clockOutSecurityOfficer(
  session: SessionUser,
  record: SecurityAttendanceRecord,
  handoverNotes?: string | null
): Promise<AttendanceResult<SecurityAttendanceRecord>> {
  const nowIso = new Date().toISOString();
  const cleanHandover = sanitizeNote(handoverNotes);

  // Gabungkan catatan kondisi awal (jika ada) dengan catatan serah terima pulang secara rapi
  let finalNotes: string | null = record.handover_notes || null;
  if (cleanHandover) {
    if (record.handover_notes && record.handover_notes.startsWith('[Masuk]')) {
      finalNotes = `${record.handover_notes}\n[Serah Terima] ${cleanHandover}`;
    } else {
      finalNotes = cleanHandover;
    }
  }
  finalNotes = sanitizeNote(finalNotes);

  const updatedLocal: SecurityAttendanceRecord = {
    ...record,
    clock_out_at: nowIso,
    status: 'completed',
    handover_notes: finalNotes,
  };

  if (!isSimulationMode(session) && isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const { data, error } = await supabase
          .from('security_attendance')
          .update({
            clock_out_at: nowIso,
            status: 'completed',
            handover_notes: finalNotes,
          })
          .eq('id', record.id)
          .select(ATTENDANCE_COLUMNS)
          .maybeSingle();

        if (!error && data) {
          const saved = normalizeRow(data as Record<string, unknown>) || updatedLocal;
          const nextLocal = readLocalRecords().map((r) => (r.id === saved.id ? saved : r));
          writeLocalRecords(
            nextLocal.some((r) => r.id === saved.id) ? nextLocal : [saved, ...nextLocal]
          );
          emitAttendanceChangeEvent();
          const evalRes = evaluateAttendance(saved);
          const pushTitle = 'Update dari Petugas Keamanan';
          const pushBody = `${saved.officer_name} telah mengirim laporan keamanan (Absen Pulang ${saved.shift_name} · Durasi ${evalRes.durationLabel}).`;
          const attOutDedup = `att-out:${saved.id}`;
          void dispatchActivityNotifications(
            session,
            getAllAdminUserIds().map((uid) => ({
              user_id: uid,
              category: 'patrol' as const,
              title: pushTitle,
              message: pushBody,
              target_url: 'tab:keamanan',
              dedup_key: attOutDedup,
            })),
            {
              target_roles: ['admin'],
              category: 'patrol',
              title: pushTitle,
              body: pushBody,
              target_url: 'tab:keamanan',
              dedup_key: attOutDedup,
            }
          );
          return {
            ok: true,
            message: `Absen Pulang tercatat (${formatWibTime(nowIso)}). Total durasi jaga: ${evalRes.durationLabel}.`,
            data: saved,
          };
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  const existingLocal = readLocalRecords(session);
  const nextLocal = existingLocal.some((r) => r.id === record.id)
    ? existingLocal.map((r) => (r.id === record.id ? updatedLocal : r))
    : [updatedLocal, ...existingLocal];
  writeLocalRecords(nextLocal, session);
  emitAttendanceChangeEvent();

  const evalRes = evaluateAttendance(updatedLocal);
  const fallbackOutTitle = 'Update dari Petugas Keamanan';
  const fallbackOutBody = `${updatedLocal.officer_name} telah mengirim laporan keamanan (Absen Pulang ${updatedLocal.shift_name} · Durasi ${evalRes.durationLabel}).`;
  const fallbackOutDedup = `att-out:${updatedLocal.id}`;
  void dispatchActivityNotifications(
    session,
    getAllAdminUserIds().map((uid) => ({
      user_id: uid,
      category: 'patrol' as const,
      title: fallbackOutTitle,
      message: fallbackOutBody,
      target_url: 'tab:keamanan',
      dedup_key: fallbackOutDedup,
    })),
    {
      target_roles: ['admin'],
      category: 'patrol',
      title: fallbackOutTitle,
      body: fallbackOutBody,
      target_url: 'tab:keamanan',
      dedup_key: fallbackOutDedup,
    }
  );
  return {
    ok: true,
    message: `Absen Pulang tercatat (${formatWibTime(nowIso)}). Total durasi jaga: ${evalRes.durationLabel}.`,
    data: updatedLocal,
    usedFallback: !isSimulationMode(session),
  };
}

/**
 * Edit / Koreksi data absensi oleh Admin (misal bila petugas lupa menekan tombol Absen Pulang).
 */
export async function adminUpdateSecurityAttendance(
  session: SessionUser,
  recordId: string,
  updates: {
    officer_name?: string;
    shift_date: string;
    shift_name: string;
    clock_in_at: string;
    clock_out_at: string | null;
    status: SecurityAttendanceStatus;
    handover_notes: string | null;
  }
): Promise<AttendanceResult<SecurityAttendanceRecord>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat mengoreksi data absensi.' };
  }

  const clockInMs = new Date(updates.clock_in_at).getTime();
  if (Number.isNaN(clockInMs)) {
    return { ok: false, message: 'Format waktu masuk tidak valid.' };
  }

  let normalizedStatus: SecurityAttendanceStatus = updates.status;
  let normalizedClockOut: string | null = updates.clock_out_at;

  if (normalizedClockOut) {
    const outMs = new Date(normalizedClockOut).getTime();
    if (Number.isNaN(outMs)) {
      return { ok: false, message: 'Format waktu pulang tidak valid.' };
    }
    if (outMs < clockInMs) {
      return { ok: false, message: 'Jam pulang tidak boleh lebih awal dari jam masuk.' };
    }
    normalizedStatus = 'completed';
  } else if (normalizedStatus === 'completed') {
    return {
      ok: false,
      message: 'Isi jam pulang terlebih dahulu untuk mengubah status menjadi Selesai Bertugas.',
    };
  }

  const cleanNotes = sanitizeNote(updates.handover_notes);
  const updateBody: Record<string, unknown> = {
    shift_date: updates.shift_date.slice(0, 10),
    shift_name: updates.shift_name.trim(),
    clock_in_at: updates.clock_in_at,
    clock_out_at: normalizedClockOut,
    status: normalizedStatus,
    handover_notes: cleanNotes,
  };
  if (updates.officer_name?.trim()) {
    updateBody.officer_name = updates.officer_name.trim();
  }

  if (!isSimulationMode(session) && isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const { data, error } = await supabase
          .from('security_attendance')
          .update(updateBody)
          .eq('id', recordId)
          .select(ATTENDANCE_COLUMNS)
          .maybeSingle();

        if (!error && data) {
          const saved = normalizeRow(data as Record<string, unknown>);
          if (saved) {
            const nextLocal = readLocalRecords().map((r) => (r.id === saved.id ? saved : r));
            writeLocalRecords(
              nextLocal.some((r) => r.id === saved.id) ? nextLocal : [saved, ...nextLocal]
            );
            emitAttendanceChangeEvent();
            return {
              ok: true,
              message: 'Data absensi berhasil dikoreksi dan langsung tersinkronisasi.',
              data: saved,
            };
          }
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  let updatedRecord: SecurityAttendanceRecord | undefined;
  const nextLocal = readLocalRecords(session).map((r) => {
    if (r.id !== recordId) return r;
    updatedRecord = {
      ...r,
      officer_name: updates.officer_name?.trim() || r.officer_name,
      shift_date: updates.shift_date.slice(0, 10),
      shift_name: updates.shift_name.trim(),
      clock_in_at: updates.clock_in_at,
      clock_out_at: normalizedClockOut,
      status: normalizedStatus,
      handover_notes: cleanNotes,
    };
    return updatedRecord;
  });

  if (!updatedRecord) {
    return { ok: false, message: 'Data absensi tidak ditemukan.' };
  }

  writeLocalRecords(nextLocal, session);
  emitAttendanceChangeEvent();

  return {
    ok: true,
    message: isSimulationMode(session)
      ? 'Koreksi absensi simulasi tersimpan.'
      : 'Koreksi absensi tersimpan secara lokal.',
    data: updatedRecord,
    usedFallback: !isSimulationMode(session),
  };
}

/**
 * Hapus data absensi oleh Admin (akses penuh).
 */
export async function adminDeleteSecurityAttendance(
  session: SessionUser,
  recordId: string
): Promise<AttendanceResult<null>> {
  if (session.role !== 'admin') {
    return { ok: false, message: 'Hanya Admin yang dapat menghapus data absensi.' };
  }

  if (!isSimulationMode(session) && isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient(session);
      if (supabase) {
        const { error } = await supabase.from('security_attendance').delete().eq('id', recordId);
        if (!error) {
          writeLocalRecords(readLocalRecords().filter((r) => r.id !== recordId));
          emitAttendanceChangeEvent();
          return { ok: true, message: 'Data absensi berhasil dihapus.' };
        }
      }
    } catch {
      // Lanjut fallback lokal
    }
  }

  writeLocalRecords(
    readLocalRecords(session).filter((r) => r.id !== recordId),
    session
  );
  emitAttendanceChangeEvent();
  return {
    ok: true,
    message: 'Data absensi dihapus.',
    usedFallback: !isSimulationMode(session),
  };
}

/**
 * Langganan Supabase Realtime untuk tabel security_attendance + fallback event lokal.
 */
export function subscribeSecurityAttendance(
  session: SessionUser | null,
  onChange: () => void
): () => void {
  const onLocalEvent = () => onChange();
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCAL_STORAGE_KEY) {
      onChange();
    }
  };

  window.addEventListener(ATTENDANCE_CHANGE_EVENT, onLocalEvent);
  window.addEventListener(SIM_CHANGED_EVENT, onLocalEvent);
  window.addEventListener('storage', onStorage);

  if (isSimulationMode(session) || !isSupabaseConfigured()) {
    return () => {
      window.removeEventListener(ATTENDANCE_CHANGE_EVENT, onLocalEvent);
      window.removeEventListener(SIM_CHANGED_EVENT, onLocalEvent);
      window.removeEventListener('storage', onStorage);
    };
  }

  const supabase = getSupabaseClient(session || null);
  if (!supabase) {
    return () => {
      window.removeEventListener(ATTENDANCE_CHANGE_EVENT, onLocalEvent);
      window.removeEventListener(SIM_CHANGED_EVENT, onLocalEvent);
      window.removeEventListener('storage', onStorage);
    };
  }

  const channelName = `security-attendance-rt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'security_attendance' },
      () => {
        onChange();
      }
    )
    .subscribe();

  return () => {
    window.removeEventListener(ATTENDANCE_CHANGE_EVENT, onLocalEvent);
    window.removeEventListener(SIM_CHANGED_EVENT, onLocalEvent);
    window.removeEventListener('storage', onStorage);
    try {
      void supabase.removeChannel(channel);
    } catch {
      // Abaikan bila channel sudah ditutup
    }
  };
}
