import {
  DEFAULT_BILLING_START_MONTH,
  DEFAULT_BILLING_START_YEAR,
  NOMINAL_IPL_STANDAR,
  resolveOccupancyStatus,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type Warga,
} from '../types';
import {
  canonicalizeBlokKey,
  resolveBillingStartPeriod,
  type BillingStartPeriod,
} from './format';

export type CellStatus =
  | 'KOSONG'
  | 'PRA_RILIS'
  | 'LUNAS'         // >= Rp100.000 -> Hijau (Kas IPL Reguler)
  | 'DANA_DARURAT'  // > 0 dan < Rp100.000 -> Ungu (Dana Darurat)
  | 'BELUM_PERIODE'
  | 'BERJALAN'      // Bulan berjalan -> Abu-abu/Biru
  | 'MASA_TAGIH'    // Tgl 1-7 bulan depan -> Kuning
  | 'TUNGGAK';      // Tgl >= 8 bulan depan -> Merah

export interface BillingInput {
  targetYear: number;
  targetMonth: number;
  isOccupied: boolean;
  isExempt?: boolean;
  paidAmount: number;       // Total nominal yang dibayarkan untuk bulan ini
  standardTariff?: number;  // Default: 100000
  systemStartYear?: number;
  systemStartMonth?: number;
  now?: Date;
}

export function getMonthlyBillingStatus({
  targetYear,
  targetMonth,
  isOccupied,
  isExempt = false,
  paidAmount,
  standardTariff = 100000,
  systemStartYear = 2026,
  systemStartMonth = 11,
  now = new Date(),
}: BillingInput): CellStatus {
  // 1. Unit kosong atau override tidak ditagihkan
  if (!isOccupied || isExempt) {
    return 'KOSONG';
  }

  // 2. Periode sebelum sistem berjalan
  if (
    targetYear < systemStartYear ||
    (targetYear === systemStartYear && targetMonth < systemStartMonth)
  ) {
    return 'PRA_RILIS';
  }

  // 3. Pembayaran normal lunas (>= Rp100.000) -> Hijau
  if (paidAmount >= standardTariff) {
    return 'LUNAS';
  }

  // 4. Pembayaran di bawah Rp100.000 -> Otomatis masuk Dana Darurat (Ungu)
  if (paidAmount > 0 && paidAmount < standardTariff) {
    return 'DANA_DARURAT';
  }

  // 5. Jika belum ada pembayaran sama sekali (paidAmount === 0), cek siklus tanggal
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();

  if (
    targetYear > currentYear ||
    (targetYear === currentYear && targetMonth > currentMonth)
  ) {
    return 'BELUM_PERIODE';
  }

  if (targetYear === currentYear && targetMonth === currentMonth) {
    return 'BERJALAN';
  }

  const billingYear = targetMonth === 12 ? targetYear + 1 : targetYear;
  const billingMonth = targetMonth === 12 ? 1 : targetMonth + 1;

  if (currentYear === billingYear && currentMonth === billingMonth) {
    return currentDay <= 7 ? 'MASA_TAGIH' : 'TUNGGAK';
  }

  return 'TUNGGAK';
}

// Helper styling badge matriks
export function getStatusBadgeStyle(status: CellStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'LUNAS':
      return {
        label: 'Lunas',
        className: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
      };
    case 'DANA_DARURAT':
      return {
        label: 'Darurat',
        className: 'bg-purple-100 text-purple-800 border border-purple-300 font-semibold',
      };
    case 'BERJALAN':
      return {
        label: 'Berjalan',
        className: 'bg-slate-100 text-slate-600 border border-slate-200',
      };
    case 'MASA_TAGIH':
      return {
        label: 'Masa Tagih',
        className: 'bg-amber-100 text-amber-800 border border-amber-300',
      };
    case 'TUNGGAK':
      return {
        label: 'Tunggak',
        className: 'bg-rose-100 text-rose-800 border border-rose-300',
      };
    case 'PRA_RILIS':
      return {
        label: 'Pra-Rilis',
        className: 'bg-stone-100 text-stone-500 border border-stone-200',
      };
    default:
      return {
        label: '-',
        className: 'text-slate-400',
      };
  }
}

export interface PaidAmountLookupResult {
  paidAmountByKey: Map<string, number>;
  pendingKeys: Set<string>;
}

export function buildBillingCellKey(blokRumah: string, tahun: number, bulan: number): string {
  return `${canonicalizeBlokKey(blokRumah)}::${tahun}::${bulan}`;
}

/**
 * Menghitung total nominal terverifikasi per (blok, tahun, bulan) dari transaksi_ipl,
 * serta mencatat sel yang masih memiliki transaksi Pending / ACC Bendahara.
 * Jika suatu sel di status_ecard_bulanan berstatus 'Lunas' namun belum ada di batch transaksi_ipl,
 * fallback menggunakan nominal standar IPL agar data historis tidak hilang.
 */
export function buildPaidAmountLookup(
  transaksiList: TransaksiIPL[],
  statusList: StatusEcardBulanan[] = [],
  standardTariff = NOMINAL_IPL_STANDAR
): PaidAmountLookupResult {
  const paidAmountByKey = new Map<string, number>();
  const verifiedTrxKeys = new Set<string>();
  const pendingKeys = new Set<string>();

  for (const trx of transaksiList) {
    const blokKey = canonicalizeBlokKey(trx.blok_rumah);
    if (!blokKey || !Array.isArray(trx.bulan_dibayar) || trx.bulan_dibayar.length === 0) {
      continue;
    }

    if (trx.status_verifikasi === 'Terverifikasi') {
      const monthCount = Math.max(trx.bulan_dibayar.length, 1);
      const perMonth = Math.round((Number(trx.nominal) || 0) / monthCount);
      for (const bulan of trx.bulan_dibayar) {
        const cellKey = `${blokKey}::${trx.tahun}::${bulan}`;
        verifiedTrxKeys.add(cellKey);
        paidAmountByKey.set(cellKey, (paidAmountByKey.get(cellKey) ?? 0) + perMonth);
      }
    } else if (
      trx.status_verifikasi === 'Pending' ||
      trx.status_verifikasi === 'ACC Bendahara'
    ) {
      for (const bulan of trx.bulan_dibayar) {
        const cellKey = `${blokKey}::${trx.tahun}::${bulan}`;
        pendingKeys.add(cellKey);
      }
    }
  }

  for (const st of statusList) {
    const blokKey = canonicalizeBlokKey(st.blok_rumah);
    if (!blokKey) continue;
    const cellKey = `${blokKey}::${st.tahun}::${st.bulan}`;
    if (st.status === 'Lunas' && !verifiedTrxKeys.has(cellKey)) {
      if (!paidAmountByKey.has(cellKey)) {
        paidAmountByKey.set(cellKey, standardTariff);
      }
    } else if (st.status === 'Menunggu Verifikasi') {
      pendingKeys.add(cellKey);
    }
  }

  return { paidAmountByKey, pendingKeys };
}

export function formatDaruratBadgeLabel(paidAmount: number): string {
  const clean = Math.max(0, Math.round(paidAmount || 0));
  if (clean <= 0) return 'Darurat';
  if (clean >= 1000 && clean % 1000 === 0) {
    return `Rp${clean / 1000}rb • Darurat`;
  }
  return `Rp${new Intl.NumberFormat('id-ID').format(clean)} • Darurat`;
}

export function isUnitBillable(
  warga?: Pick<
    Warga,
    'occupancy_status' | 'status_hunian' | 'nama_warga' | 'is_occupied' | 'is_exempt' | 'warga_account_status'
  > | null
): boolean {
  if (!warga) return false;
  if (warga.is_occupied === false) return false;
  if (resolveOccupancyStatus(warga) === 'kosong') return false;
  if (warga.is_exempt === true) return false;
  if (warga.warga_account_status === 'inactive') return false;
  return true;
}

export function getUnfulfilledCycleStatus(params: {
  targetYear: number;
  targetMonth: number;
  isOccupied: boolean;
  isExempt?: boolean;
  billingStart?: BillingStartPeriod | null;
  now?: Date;
}): CellStatus {
  const { startMonth, startYear } = resolveBillingStartPeriod(params.billingStart);
  return getMonthlyBillingStatus({
    targetYear: params.targetYear,
    targetMonth: params.targetMonth,
    isOccupied: params.isOccupied,
    isExempt: params.isExempt,
    paidAmount: 0,
    systemStartYear: startYear || DEFAULT_BILLING_START_YEAR,
    systemStartMonth: startMonth || DEFAULT_BILLING_START_MONTH,
    now: params.now,
  });
}

export function resolveUnitMonthBillingStatus(params: {
  warga: Pick<
    Warga,
    | 'blok_rumah'
    | 'occupancy_status'
    | 'status_hunian'
    | 'nama_warga'
    | 'aktif'
    | 'warga_account_status'
    | 'is_occupied'
    | 'is_exempt'
  >;
  targetYear: number;
  targetMonth: number;
  paidAmount: number;
  billingStart?: BillingStartPeriod | null;
  standardTariff?: number;
  now?: Date;
}): CellStatus {
  const {
    warga,
    targetYear,
    targetMonth,
    paidAmount,
    billingStart,
    standardTariff = NOMINAL_IPL_STANDAR,
    now,
  } = params;

  const isOccupied = warga.is_occupied !== false && resolveOccupancyStatus(warga) !== 'kosong';
  const isExempt = Boolean(warga.is_exempt) || warga.warga_account_status === 'inactive';
  const { startMonth, startYear } = resolveBillingStartPeriod(billingStart);

  return getMonthlyBillingStatus({
    targetYear,
    targetMonth,
    isOccupied,
    isExempt,
    paidAmount,
    standardTariff,
    systemStartYear: startYear || DEFAULT_BILLING_START_YEAR,
    systemStartMonth: startMonth || DEFAULT_BILLING_START_MONTH,
    now,
  });
}

export function getUnitDelinquentMonths(params: {
  warga: Pick<
    Warga,
    | 'blok_rumah'
    | 'occupancy_status'
    | 'status_hunian'
    | 'nama_warga'
    | 'aktif'
    | 'warga_account_status'
    | 'is_occupied'
    | 'is_exempt'
  >;
  year: number;
  months?: readonly number[];
  paidAmountByKey: Map<string, number>;
  pendingKeys?: Set<string>;
  billingStart?: BillingStartPeriod | null;
  standardTariff?: number;
  now?: Date;
}): number[] {
  const {
    warga,
    year,
    months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    paidAmountByKey,
    pendingKeys,
    billingStart,
    standardTariff = NOMINAL_IPL_STANDAR,
    now = new Date(),
  } = params;

  if (!isUnitBillable(warga)) return [];

  const delinquent: number[] = [];
  for (const m of months) {
    const cellKey = buildBillingCellKey(warga.blok_rumah, year, m);
    const paidAmount = paidAmountByKey.get(cellKey) ?? 0;
    const cellStatus = resolveUnitMonthBillingStatus({
      warga,
      targetYear: year,
      targetMonth: m,
      paidAmount,
      billingStart,
      standardTariff,
      now,
    });

    if (cellStatus === 'LUNAS' || cellStatus === 'PRA_RILIS' || cellStatus === 'KOSONG') {
      continue;
    }

    const cycleStatus =
      cellStatus === 'DANA_DARURAT'
        ? getUnfulfilledCycleStatus({
            targetYear: year,
            targetMonth: m,
            isOccupied: true,
            isExempt: false,
            billingStart,
            now,
          })
        : cellStatus;

    const isPending = pendingKeys?.has(cellKey) ?? false;
    if (cycleStatus === 'TUNGGAK' && !isPending) {
      delinquent.push(m);
    }
  }

  return delinquent;
}
