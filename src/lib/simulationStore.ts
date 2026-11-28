import {
  DEFAULT_APP_BRAND_CONFIG,
  DEFAULT_PAYMENT_CONFIG,
  NOMINAL_IPL_STANDAR,
  SEED_TITIK_PATROLI,
  SUSUNAN_PENGURUS,
  TAHUN_AKTIF,
  type ActivityNotification,
  type AppBrandConfig,
  type AuditLogEntry,
  type BotWaConfig,
  type BotWaLog,
  type LogPatroli,
  type PatrolGpsCalibration,
  type PatrolLiveSession,
  type PatrolMapConfig,
  type PaymentConfig,
  type PengurusLingkunganRecord,
  type PetugasKeamanan,
  type SecurityAttendanceRecord,
  type SecurityShiftOverride,
  type SessionUser,
  type StatusEcardBulanan,
  type SystemNotification,
  type TitikPatroli,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../types';
import type { ChatMessage } from './chatService';
import { getDefaultUnpaidStatusForMonth } from './format';

export const SIM_DATA_KEY = 'saungkebun_sim_data';
export const SIM_ENABLED_KEY = 'saungkebun_sim_enabled';
export const SIM_SESSION_KEY = 'saungkebun_sim_session';
export const SIM_CHANGED_EVENT = 'saungkebun-sim-changed';

export type SimDateOption = '2026-11-28' | '2026-12-05' | '2026-12-10';

export type SimPresetRoleId =
  | 'warga_lunas'
  | 'warga_darurat'
  | 'keamanan'
  | 'admin_bendahara'
  | 'admin_ketua';

export interface SimShiftScheduleItem {
  nama: string;
  shift: string;
  jam: string;
  keterangan: string;
}

export const SIM_SHIFT_SCHEDULE: SimShiftScheduleItem[] = [
  {
    nama: 'Pa Nurdenih',
    shift: 'Shift 1 (Pagi)',
    jam: '07:00 – 15:00 WIB',
    keterangan: 'Patroli pagi, pos gerbang utama & kontrol akses tamu',
  },
  {
    nama: 'Pa Warta',
    shift: 'Shift 2 (Siang)',
    jam: '15:00 – 23:00 WIB',
    keterangan: 'Patroli sore–malam, pengecekan PJU & 5 titik checkpoint',
  },
  {
    nama: 'Pa Sishantoyo',
    shift: 'Shift 3 (Malam)',
    jam: '23:00 – 07:00 WIB',
    keterangan: 'Patroli dini hari, pengamanan gerbang & serah terima pagi',
  },
];

export interface SimDataState {
  version: number;
  simDateIso: SimDateOption;
  wargaList: Warga[];
  pengurusList: PengurusLingkunganRecord[];
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  statusList: StatusEcardBulanan[];
  petugasList: PetugasKeamanan[];
  titikPatroliList: TitikPatroli[];
  patroliLogs: LogPatroli[];
  liveSessions: PatrolLiveSession[];
  gpsCalibrations: PatrolGpsCalibration[];
  attendance: SecurityAttendanceRecord[];
  shiftOverrides: SecurityShiftOverride[];
  notifications: SystemNotification[];
  activityNotifications: ActivityNotification[];
  chatMessages: ChatMessage[];
  chatReadAt: Record<string, string>;
  chatDeletedForMe: Record<string, string[]>;
  auditLogs: AuditLogEntry[];
  paymentConfig: PaymentConfig;
  brandConfig: AppBrandConfig;
  patrolMapConfig: PatrolMapConfig;
  botConfig: BotWaConfig;
  botLogs: BotWaLog[];
  delegationMap: Record<string, Record<string, 'granted' | 'revoked'>>;
}

const DEMO_QRIS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect width="240" height="240" rx="16" fill="#FFFFFF"/>
  <rect x="16" y="16" width="56" height="56" rx="8" fill="#1B271B"/>
  <rect x="26" y="26" width="36" height="36" rx="4" fill="#FFFFFF"/>
  <rect x="34" y="34" width="20" height="20" rx="2" fill="#2B3F29"/>
  <rect x="168" y="16" width="56" height="56" rx="8" fill="#1B271B"/>
  <rect x="178" y="26" width="36" height="36" rx="4" fill="#FFFFFF"/>
  <rect x="186" y="34" width="20" height="20" rx="2" fill="#2B3F29"/>
  <rect x="16" y="168" width="56" height="56" rx="8" fill="#1B271B"/>
  <rect x="26" y="178" width="36" height="36" rx="4" fill="#FFFFFF"/>
  <rect x="34" y="186" width="20" height="20" rx="2" fill="#2B3F29"/>
  <rect x="88" y="22" width="16" height="16" fill="#2B3F29"/>
  <rect x="112" y="22" width="16" height="16" fill="#1B271B"/>
  <rect x="136" y="38" width="16" height="16" fill="#2B3F29"/>
  <rect x="88" y="54" width="32" height="16" fill="#1B271B"/>
  <rect x="24" y="92" width="16" height="16" fill="#1B271B"/>
  <rect x="52" y="92" width="24" height="16" fill="#2B3F29"/>
  <rect x="92" y="92" width="56" height="56" rx="8" fill="#E5EEE3" stroke="#2B3F29" stroke-width="3"/>
  <text x="120" y="117" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#243825">SIMULASI</text>
  <text x="120" y="132" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#2B3F29">QRIS</text>
  <rect x="168" y="92" width="16" height="24" fill="#1B271B"/>
  <rect x="196" y="92" width="24" height="16" fill="#2B3F29"/>
  <rect x="168" y="132" width="48" height="16" fill="#1B271B"/>
  <rect x="92" y="168" width="24" height="16" fill="#2B3F29"/>
  <rect x="132" y="168" width="16" height="32" fill="#1B271B"/>
  <rect x="168" y="176" width="24" height="16" fill="#2B3F29"/>
  <rect x="200" y="196" width="24" height="24" fill="#1B271B"/>
  <rect x="92" y="200" width="28" height="20" fill="#2B3F29"/>
  <rect x="136" y="208" width="48" height="14" fill="#1B271B"/>
</svg>`;

export const SIM_DEMO_QRIS_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(DEMO_QRIS_SVG)}`;

const memorySimStorage = new Map<string, string>();

function simGetItem(key: string): string | null {
  if (typeof window !== 'undefined') {
    try {
      const val = window.localStorage.getItem(key);
      if (val !== null) return val;
    } catch {
      // Abaikan jika localStorage diblokir
    }
  }
  return memorySimStorage.get(key) ?? null;
}

function simSetItem(key: string, value: string): void {
  memorySimStorage.set(key, value);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Abaikan
    }
  }
}

function simRemoveItem(key: string): void {
  memorySimStorage.delete(key);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Abaikan
    }
  }
}

export function emitSimulationChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SIM_CHANGED_EVENT));
  }
}

export function parseSimDateToLocalNoon(iso: SimDateOption | string | undefined | null): Date {
  const clean = String(iso || '2026-11-28').slice(0, 10);
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(2026, 10, 28, 12, 0, 0);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(year, month - 1, day, 12, 0, 0);
}

export function isSimulationEnabled(): boolean {
  const raw = simGetItem(SIM_ENABLED_KEY);
  if (raw === null) return true;
  return raw !== 'false';
}

export function setSimulationEnabled(enabled: boolean): void {
  simSetItem(SIM_ENABLED_KEY, enabled ? 'true' : 'false');
  emitSimulationChanged();
}

export function loadSimulationSession(): SessionUser | null {
  if (!isSimulationEnabled()) return null;
  try {
    const raw = simGetItem(SIM_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionUser;
    if (!parsed || !parsed.role || !parsed.blok_rumah) return null;
    return { ...parsed, is_simulation: true };
  } catch {
    return null;
  }
}

export function saveSimulationSession(session: SessionUser | null): void {
  if (!session) {
    simRemoveItem(SIM_SESSION_KEY);
    emitSimulationChanged();
    return;
  }
  const marked: SessionUser = { ...session, is_simulation: true };
  simSetItem(SIM_SESSION_KEY, JSON.stringify(marked));
  emitSimulationChanged();
}

export function clearSimulationSessionOnly(): void {
  saveSimulationSession(null);
}

export function isSimulationSessionActive(): boolean {
  return loadSimulationSession() !== null;
}

export function isSimulationMode(session?: SessionUser | null): boolean {
  if (session?.is_simulation) return true;
  if (session === undefined || session === null) {
    return isSimulationSessionActive();
  }
  return false;
}

export function buildSimHouseStatuses(
  wargaList: Warga[],
  transaksiList: TransaksiIPL[],
  simNow: Date
): StatusEcardBulanan[] {
  const nowIso = simNow.toISOString();
  const result: StatusEcardBulanan[] = [];

  for (const warga of wargaList) {
    const houseTrx = transaksiList.filter(
      (t) => t.blok_rumah === warga.blok_rumah && t.tahun === TAHUN_AKTIF
    );
    const isExemptOrEmpty = warga.status_hunian === 'Kosong' || warga.is_occupied === false || warga.is_exempt === true;

    for (let bulan = 1; bulan <= 12; bulan++) {
      const verifiedList = houseTrx.filter(
        (t) => t.status_verifikasi === 'Terverifikasi' && t.bulan_dibayar.includes(bulan)
      );
      const verifiedPaid = verifiedList.reduce((sum, t) => {
        const div = Math.max(t.bulan_dibayar.length, 1);
        return sum + Math.round((Number(t.nominal) || 0) / div);
      }, 0);
      const pending = houseTrx.find(
        (t) =>
          (t.status_verifikasi === 'Pending' || t.status_verifikasi === 'ACC Bendahara') &&
          t.bulan_dibayar.includes(bulan)
      );

      let status = getDefaultUnpaidStatusForMonth(bulan, TAHUN_AKTIF, simNow);
      let transaksi_id: string | null = null;

      if (isExemptOrEmpty) {
        status = 'Belum Tagihan';
      } else if (verifiedPaid >= NOMINAL_IPL_STANDAR && verifiedList.length > 0) {
        status = 'Lunas';
        transaksi_id = verifiedList[0].id;
      } else if (pending) {
        status = 'Menunggu Verifikasi';
        transaksi_id = pending.id;
      } else if (verifiedList.length > 0) {
        transaksi_id = verifiedList[0].id;
      }

      result.push({
        id: `sim-st-${warga.blok_rumah}-${TAHUN_AKTIF}-${bulan}`,
        blok_rumah: warga.blok_rumah,
        tahun: TAHUN_AKTIF,
        bulan,
        status,
        transaksi_id,
        updated_at: nowIso,
      });
    }
  }

  return result;
}

export function createDefaultSimData(): SimDataState {
  const baseDateIso: SimDateOption = '2026-11-28';
  const simNow = parseSimDateToLocalNoon(baseDateIso);

  const wargaList: Warga[] = [
    {
      id: 'sim-warga-01',
      blok_rumah: 'SIM/01',
      nama_warga: 'Simulasi Warga Lunas',
      status_hunian: 'Tetap',
      occupancy_status: 'aktif',
      is_occupied: true,
      is_exempt: false,
      no_wa: '6281200000001',
      pin_akses: '123456',
      nominal_iuran: NOMINAL_IPL_STANDAR,
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-warga-02',
      blok_rumah: 'SIM/02',
      nama_warga: 'Simulasi Dana Darurat',
      status_hunian: 'Tetap',
      occupancy_status: 'aktif',
      is_occupied: true,
      is_exempt: false,
      no_wa: '6281200000002',
      pin_akses: '123456',
      nominal_iuran: NOMINAL_IPL_STANDAR,
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-warga-03',
      blok_rumah: 'SIM/03',
      nama_warga: 'Simulasi Unit Menunggak',
      status_hunian: 'Tetap',
      occupancy_status: 'aktif',
      is_occupied: true,
      is_exempt: false,
      no_wa: '6281200000003',
      pin_akses: '123456',
      nominal_iuran: NOMINAL_IPL_STANDAR,
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-warga-04',
      blok_rumah: 'SIM/04',
      nama_warga: 'Unit Kosong Simulasi',
      status_hunian: 'Kosong',
      occupancy_status: 'kosong',
      is_occupied: false,
      is_exempt: false,
      no_wa: '',
      pin_akses: '123456',
      nominal_iuran: 0,
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-warga-05',
      blok_rumah: 'SIM/05',
      nama_warga: 'Contoh Warga Sudah Lunas',
      status_hunian: 'Tetap',
      occupancy_status: 'aktif',
      is_occupied: true,
      is_exempt: false,
      no_wa: '6281200000005',
      pin_akses: '123456',
      nominal_iuran: NOMINAL_IPL_STANDAR,
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-warga-06',
      blok_rumah: 'SIM/06',
      nama_warga: 'Simulasi Antrean Verifikasi',
      status_hunian: 'Tetap',
      occupancy_status: 'aktif',
      is_occupied: true,
      is_exempt: false,
      no_wa: '6281200000006',
      pin_akses: '123456',
      nominal_iuran: NOMINAL_IPL_STANDAR,
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
  ];

  const transaksiList: TransaksiIPL[] = [
    {
      id: 'sim-trx-init-1',
      no_kwitansi: 'SIM-KW-202611-0001',
      blok_rumah: 'SIM/05',
      nama_warga: 'Contoh Warga Sudah Lunas',
      bulan_dibayar: [11],
      tahun: TAHUN_AKTIF,
      nominal: 100000,
      fund_type: 'IPL_REGULER',
      holder_role: 'BENDAHARA',
      metode_bayar: 'Transfer Bank',
      petugas_penerima: null,
      bukti_url: SIM_DEMO_QRIS_DATA_URL,
      tanggal_setor: '2026-11-05T09:15:00.000Z',
      status_verifikasi: 'Terverifikasi',
      catatan_admin: null,
      keterangan: 'Contoh setoran IPL reguler terverifikasi.',
      verified_at: '2026-11-05T10:00:00.000Z',
      verified_by: 'Bp Andriansyah',
      bendahara_approved_at: '2026-11-05T09:40:00.000Z',
      bendahara_approved_by: 'Bp Andriansyah',
      ketua_approved_at: '2026-11-05T10:00:00.000Z',
      ketua_approved_by: 'Bp Erlangga (Ketua)',
      ketua_catatan: 'Disetujui dalam Mode Simulasi',
    },
    {
      id: 'sim-trx-init-2',
      no_kwitansi: 'SIM-KW-202611-0002',
      blok_rumah: 'SIM/06',
      nama_warga: 'Simulasi Antrean Verifikasi',
      bulan_dibayar: [11],
      tahun: TAHUN_AKTIF,
      nominal: 100000,
      fund_type: 'IPL_REGULER',
      holder_role: 'BENDAHARA',
      metode_bayar: 'QRIS',
      petugas_penerima: null,
      bukti_url: SIM_DEMO_QRIS_DATA_URL,
      tanggal_setor: '2026-11-26T14:20:00.000Z',
      status_verifikasi: 'Pending',
      catatan_admin: null,
      keterangan: 'Menunggu verifikasi 2 tahap: ACC Bendahara -> Stempel Ketua.',
      verified_at: null,
      verified_by: null,
      bendahara_approved_at: null,
      bendahara_approved_by: null,
      ketua_approved_at: null,
      ketua_approved_by: null,
      ketua_catatan: null,
    },
  ];

  const transaksiKasList: TransaksiKas[] = [
    {
      id: 'sim-kas-1',
      no_bukti: 'SIM-BK-202611-01',
      jenis: 'pengeluaran',
      kategori: 'Kebersihan & Taman',
      termin: 'Bulan Nov 2026',
      tanggal: '2026-11-15',
      nominal: 50000,
      penerima_atau_sumber: 'Petugas Kebersihan Demo',
      keterangan: 'Contoh pengeluaran rutin kebersihan area gerbang & taman.',
      bukti_url: null,
      fund_type: 'IPL_REGULER',
      holder_role: 'BENDAHARA',
      status_verifikasi: 'Terverifikasi',
      bendahara_approved_at: '2026-11-15T10:00:00.000Z',
      bendahara_approved_by: 'Bp Andriansyah',
      ketua_approved_at: '2026-11-15T11:00:00.000Z',
      ketua_approved_by: 'Bp Erlangga (Ketua)',
      ketua_catatan: 'Terverifikasi demo',
      created_by: 'andriansyah',
      created_by_name: 'Bp Andriansyah (Bendahara)',
      created_at: '2026-11-15T09:50:00.000Z',
      updated_at: '2026-11-15T11:00:00.000Z',
    },
  ];

  const pengurusList: PengurusLingkunganRecord[] = SUSUNAN_PENGURUS.map((p, idx) => ({
    id: `sim-pengurus-${idx + 1}`,
    nama: p.nama,
    jabatan: p.jabatan,
    username: p.username,
    blok_rumah: p.blokRumah,
    no_wa: `628129900010${idx + 1}`,
    pin_akses: '123456',
    permission: p.permission,
    aktif: true,
    is_default: true,
    created_at: '2026-11-01T07:00:00.000Z',
  }));

  const petugasList: PetugasKeamanan[] = [
    {
      id: 'sim-petugas-demo',
      nama: 'Simulasi Petugas Keamanan',
      username: 'sim_patroli',
      pin: '123456',
      no_hp: '6281200000900',
      shift: 'Shift 1 (07:00-15:00)',
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-petugas-nurdenih',
      nama: 'Pa Nurdenih',
      username: 'nurdenih',
      pin: '123456',
      no_hp: '6281200000901',
      shift: 'Shift 1 (07:00-15:00)',
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-petugas-warta',
      nama: 'Pa Warta',
      username: 'warta',
      pin: '123456',
      no_hp: '6281200000902',
      shift: 'Shift 2 (15:00-23:00)',
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
    {
      id: 'sim-petugas-sishantoyo',
      nama: 'Pa Sishantoyo',
      username: 'sishantoyo',
      pin: '123456',
      no_hp: '6281200000903',
      shift: 'Shift 3 (23:00-07:00)',
      aktif: true,
      created_at: '2026-11-01T07:00:00.000Z',
    },
  ];

  const titikPatroliList: TitikPatroli[] = SEED_TITIK_PATROLI.map((t) => ({ ...t }));

  const todayMorningIso = new Date(
    simNow.getFullYear(),
    simNow.getMonth(),
    simNow.getDate(),
    8,
    15,
    0
  ).toISOString();
  const todayMorning2Iso = new Date(
    simNow.getFullYear(),
    simNow.getMonth(),
    simNow.getDate(),
    8,
    25,
    0
  ).toISOString();

  const patroliLogs: LogPatroli[] = [
    {
      id: 'sim-log-patroli-1',
      petugas_id: 'sim-petugas-nurdenih',
      nama_petugas: 'Pa Nurdenih',
      titik_id: titikPatroliList[0].id,
      nama_lokasi: titikPatroliList[0].nama_lokasi,
      waktu_scan: todayMorningIso,
      metode_scan: 'NFC Tap',
      status_kondisi: 'Aman',
      catatan: 'Pos gerbang utama aman, portal terpantau tertib.',
    },
    {
      id: 'sim-log-patroli-2',
      petugas_id: 'sim-petugas-nurdenih',
      nama_petugas: 'Pa Nurdenih',
      titik_id: titikPatroliList[1].id,
      nama_lokasi: titikPatroliList[1].nama_lokasi,
      waktu_scan: todayMorning2Iso,
      metode_scan: 'NFC Tap',
      status_kondisi: 'Aman',
      catatan: 'Area Blok A aman dan kondisi pagar barat baik.',
    },
  ];

  const attendance: SecurityAttendanceRecord[] = [
    {
      id: 'sim-att-1',
      officer_name: 'Pa Nurdenih',
      shift_date: baseDateIso,
      shift_name: 'Shift 1 (07:00-15:00)',
      clock_in_at: new Date(simNow.getFullYear(), simNow.getMonth(), simNow.getDate(), 7, 2, 0).toISOString(),
      clock_out_at: null,
      status: 'on_duty',
      clock_in_photo_url: null,
      handover_notes: 'Operan shift malam selesai lancar, lampu jalan seluruh blok menyala.',
      created_at: todayMorningIso,
    },
  ];

  const notifications: SystemNotification[] = [
    {
      id: 'sim-notif-1',
      title: 'Simulasi Pengumuman Lingkungan',
      message:
        'Ini adalah contoh pengumuman resmi dalam Mode Simulasi. Semua aktivitas di mode ini tidak masuk ke database Supabase.',
      category: 'Keuangan & IPL',
      target_scope: 'all_active',
      recipient_count: 5,
      sender_name: 'Bp Andriansyah',
      sender_jabatan: 'Bendahara',
      created_at: todayMorningIso,
    },
  ];

  const chatMessages: ChatMessage[] = [
    {
      id: 'sim-chat-1',
      room_id: 'pengurus_keamanan',
      sender_role: 'petugas',
      sender_id: 'petugas:sim-petugas-nurdenih',
      sender_name: 'Pa Nurdenih',
      sender_subtitle: 'Keamanan · Shift 1 (07:00-15:00)',
      sender_avatar_url: null,
      message: 'Selamat pagi Pengurus, izin lapor situasi Pos Utama dan Blok A terpantau aman terkendali.',
      reply_to_id: null,
      reply_preview: null,
      created_at: todayMorningIso,
      is_local_only: true,
    },
    {
      id: 'sim-chat-2',
      room_id: 'pengurus_keamanan',
      sender_role: 'admin',
      sender_id: 'admin:erlangga',
      sender_name: 'Bp Erlangga',
      sender_subtitle: 'Ketua Lingkungan',
      sender_avatar_url: null,
      message: 'Terima kasih Pa Nurdenih. Lanjutkan patroli rutin ke Checkpoint 3 sampai 5 dan catat bila ada lampu padam.',
      reply_to_id: 'sim-chat-1',
      reply_preview: 'Selamat pagi Pengurus, izin lapor situasi Pos Utama...',
      created_at: todayMorning2Iso,
      is_local_only: true,
    },
  ];

  const paymentConfig: PaymentConfig = {
    ...DEFAULT_PAYMENT_CONFIG,
    qris_aktif: true,
    qris_image_url: SIM_DEMO_QRIS_DATA_URL,
    qris_label: 'QRIS Simulasi Kas Saung Kebun',
    qris_catatan: 'QRIS contoh khusus Mode Simulasi (data tidak dikirim ke Supabase).',
    updated_at: todayMorningIso,
    updated_by: 'andriansyah',
  };

  const brandConfig: AppBrandConfig = {
    ...DEFAULT_APP_BRAND_CONFIG,
    wa_pengurus_label: 'Bp Andriansyah (Bendahara)',
    updated_at: todayMorningIso,
  };

  const patrolMapConfig: PatrolMapConfig = {
    map_image_url: null,
    cycle_reset_at: new Date(simNow.getFullYear(), simNow.getMonth(), simNow.getDate(), 0, 0, 0).toISOString(),
    pin_positions: {},
    updated_at: todayMorningIso,
  };

  const statusList = buildSimHouseStatuses(wargaList, transaksiList, simNow);

  return {
    version: 1,
    simDateIso: baseDateIso,
    wargaList,
    pengurusList,
    transaksiList,
    transaksiKasList,
    statusList,
    petugasList,
    titikPatroliList,
    patroliLogs,
    liveSessions: [],
    gpsCalibrations: [],
    attendance,
    shiftOverrides: [],
    notifications,
    activityNotifications: [],
    chatMessages,
    chatReadAt: {},
    chatDeletedForMe: {},
    auditLogs: [
      {
        id: 'sim-audit-init',
        timestamp: todayMorningIso,
        actor_role: 'admin',
        actor_id: 'andriansyah',
        actor_name: 'Bp Andriansyah',
        action: 'SIMULATION_INITIALIZED',
        entity: 'system',
        summary: 'Sesi Mode Simulasi Interaktif (Local Demo Mode) dimulai di memori browser.',
      },
    ],
    paymentConfig,
    brandConfig,
    patrolMapConfig,
    botConfig: {
      id: 'sim-bot-config',
      aktif: true,
      provider: 'Fonnte',
      api_endpoint: 'https://api.fonnte.com/send',
      api_token: '',
      jadwal_tgl_1: true,
      jadwal_tgl_6: true,
      jadwal_tgl_7: true,
      jadwal_tgl_8_plus: true,
      template_pesan:
        'Yth. Bapak/Ibu {nama_warga} (Blok {blok_rumah}), pengingat IPL bulan {bulan_tagihan} sebesar {nominal_tagihan}. Portal: {link_aplikasi}',
      updated_at: todayMorningIso,
    },
    botLogs: [],
    delegationMap: {},
  };
}

export function readSimData(): SimDataState {
  try {
    const raw = simGetItem(SIM_DATA_KEY);
    if (!raw) {
      const initial = createDefaultSimData();
      simSetItem(SIM_DATA_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as Partial<SimDataState>;
    const fallback = createDefaultSimData();
    const merged: SimDataState = {
      ...fallback,
      ...parsed,
      wargaList: Array.isArray(parsed.wargaList) ? parsed.wargaList : fallback.wargaList,
      pengurusList: Array.isArray(parsed.pengurusList) ? parsed.pengurusList : fallback.pengurusList,
      transaksiList: Array.isArray(parsed.transaksiList) ? parsed.transaksiList : fallback.transaksiList,
      transaksiKasList: Array.isArray(parsed.transaksiKasList)
        ? parsed.transaksiKasList
        : fallback.transaksiKasList,
      statusList: Array.isArray(parsed.statusList) ? parsed.statusList : fallback.statusList,
      petugasList: Array.isArray(parsed.petugasList) ? parsed.petugasList : fallback.petugasList,
      titikPatroliList: Array.isArray(parsed.titikPatroliList)
        ? parsed.titikPatroliList
        : fallback.titikPatroliList,
      patroliLogs: Array.isArray(parsed.patroliLogs) ? parsed.patroliLogs : fallback.patroliLogs,
      liveSessions: Array.isArray(parsed.liveSessions) ? parsed.liveSessions : fallback.liveSessions,
      gpsCalibrations: Array.isArray(parsed.gpsCalibrations)
        ? parsed.gpsCalibrations
        : fallback.gpsCalibrations,
      attendance: Array.isArray(parsed.attendance) ? parsed.attendance : fallback.attendance,
      shiftOverrides: Array.isArray(parsed.shiftOverrides) ? parsed.shiftOverrides : fallback.shiftOverrides,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : fallback.notifications,
      activityNotifications: Array.isArray(parsed.activityNotifications)
        ? parsed.activityNotifications
        : fallback.activityNotifications,
      chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : fallback.chatMessages,
      chatReadAt: parsed.chatReadAt || fallback.chatReadAt,
      chatDeletedForMe: parsed.chatDeletedForMe || fallback.chatDeletedForMe,
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : fallback.auditLogs,
      paymentConfig: parsed.paymentConfig || fallback.paymentConfig,
      brandConfig: parsed.brandConfig || fallback.brandConfig,
      patrolMapConfig: parsed.patrolMapConfig || fallback.patrolMapConfig,
      botConfig: parsed.botConfig || fallback.botConfig,
      botLogs: Array.isArray(parsed.botLogs) ? parsed.botLogs : fallback.botLogs,
      delegationMap: parsed.delegationMap || fallback.delegationMap,
    };
    return merged;
  } catch {
    const initial = createDefaultSimData();
    simSetItem(SIM_DATA_KEY, JSON.stringify(initial));
    return initial;
  }
}

export function writeSimData(next: SimDataState): SimDataState {
  simSetItem(SIM_DATA_KEY, JSON.stringify(next));
  emitSimulationChanged();
  return next;
}

export function updateSimData(mutator: (current: SimDataState) => SimDataState): SimDataState {
  const current = readSimData();
  const updated = mutator(current);
  return writeSimData(updated);
}

export function setSimulationDate(dateIso: SimDateOption): SimDataState {
  const simNow = parseSimDateToLocalNoon(dateIso);
  return updateSimData((curr) => ({
    ...curr,
    simDateIso: dateIso,
    statusList: buildSimHouseStatuses(curr.wargaList, curr.transaksiList, simNow),
  }));
}

export function getSimulationDateIso(): SimDateOption {
  const data = readSimData();
  if (
    data.simDateIso === '2026-11-28' ||
    data.simDateIso === '2026-12-05' ||
    data.simDateIso === '2026-12-10'
  ) {
    return data.simDateIso;
  }
  return '2026-11-28';
}

export function getSimulationNow(): Date {
  return parseSimDateToLocalNoon(getSimulationDateIso());
}

export function resetSimulationDataOnly(): SimDataState {
  const fresh = createDefaultSimData();
  writeSimData(fresh);
  return fresh;
}

export function wipeSimulationDataAndDisable(): void {
  simRemoveItem(SIM_DATA_KEY);
  simRemoveItem(SIM_SESSION_KEY);
  simSetItem(SIM_ENABLED_KEY, 'false');
  emitSimulationChanged();
}

export function subscribeSimulationChanges(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => callback();
  const storageHandler = (e: StorageEvent) => {
    if (
      e.key === SIM_DATA_KEY ||
      e.key === SIM_ENABLED_KEY ||
      e.key === SIM_SESSION_KEY
    ) {
      callback();
    }
  };
  window.addEventListener(SIM_CHANGED_EVENT, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(SIM_CHANGED_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function buildSimulationSession(roleId: SimPresetRoleId): SessionUser {
  const nowIso = new Date().toISOString();
  switch (roleId) {
    case 'warga_lunas':
      return {
        role: 'warga',
        blok_rumah: 'SIM/01',
        nama_warga: 'Simulasi Warga Lunas',
        status_hunian: 'Tetap',
        no_wa: '6281200000001',
        nominal_iuran: NOMINAL_IPL_STANDAR,
        avatar_url: null,
        login_at: nowIso,
        is_simulation: true,
      };
    case 'warga_darurat':
      return {
        role: 'warga',
        blok_rumah: 'SIM/02',
        nama_warga: 'Simulasi Dana Darurat',
        status_hunian: 'Tetap',
        no_wa: '6281200000002',
        nominal_iuran: NOMINAL_IPL_STANDAR,
        avatar_url: null,
        login_at: nowIso,
        is_simulation: true,
      };
    case 'keamanan':
      return {
        role: 'petugas',
        blok_rumah: 'sim_patroli',
        nama_warga: 'Simulasi Petugas Keamanan',
        petugas_id: 'sim-petugas-demo',
        shift: 'Shift 1 (07:00-15:00)',
        no_wa: '6281200000900',
        avatar_url: null,
        login_at: nowIso,
        is_simulation: true,
      };
    case 'admin_bendahara':
      return {
        role: 'admin',
        blok_rumah: 'andriansyah',
        nama_warga: 'Bp Andriansyah',
        jabatan: 'Bendahara',
        admin_permission: 'full',
        is_active_pengurus: true,
        no_wa: '6281299000103',
        avatar_url: null,
        login_at: nowIso,
        is_simulation: true,
      };
    case 'admin_ketua':
      return {
        role: 'admin',
        blok_rumah: 'erlangga',
        nama_warga: 'Bp Erlangga',
        jabatan: 'Ketua',
        admin_permission: 'add_only',
        is_active_pengurus: true,
        no_wa: '6281299000102',
        avatar_url: null,
        login_at: nowIso,
        is_simulation: true,
      };
  }
}
