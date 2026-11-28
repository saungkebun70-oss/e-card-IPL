import {
  NOMINAL_IPL_STANDAR,
  TRIWULAN_LIST,
  type FundType,
  type HolderRole,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../types';
import {
  compareBlokRumah,
  formatBillingStartLabel,
  formatBlokRumah,
  formatDaftarBulan,
  formatRupiah,
  getNamaBulan,
  isBeforeBillingStart,
  type BillingStartPeriod,
} from './format';
import {
  buildBillingCellKey,
  buildPaidAmountLookup,
  getUnitDelinquentMonths,
  isUnitBillable,
  resolveUnitMonthBillingStatus,
} from './billingStatus';

export interface GlobalCashSummary {
  totalIplMasuk: number;
  totalPemasukanLain: number;
  totalPemasukan: number;
  totalPengeluaran: number;
  saldoKas: number;
}

export interface CashLedgerRow {
  id: string;
  tanggal: string; // YYYY-MM-DD
  sortKey: number;
  noBukti: string;
  uraian: string;
  kategori: string;
  masuk: number;
  keluar: number;
  saldoBerjalan: number;
  sumberJenis: 'ipl' | 'pemasukan_lain' | 'pengeluaran';
  fundType: FundType;
  holderRole: HolderRole;
  metodeBayar?: string;
}

export interface KategoriRekapItem {
  kategori: string;
  jumlahTransaksi: number;
  totalNominal: number;
  persentase: number;
}

export interface UnitDelinquencyItem {
  blokRumah: string;
  namaWarga: string;
  bulanTunggak: number[];
  labelBulan: string;
  estimasiTunggakan: number;
  statusKeterangan?: string;
}

export interface MonthlyComplianceSummary {
  totalBillable: number;
  sudahSetor: number;
  belumSetor: number;
  menunggak: number;
  unitDarurat: number;
  isPraRilis: boolean;
}

export interface MonthlyCashReport {
  tahun: number;
  bulan: number;
  namaBulan: string;
  saldoAwal: number;
  totalIplBulanIni: number;
  totalPemasukanLainBulanIni: number;
  totalMasukBulanIni: number;
  totalKeluarBulanIni: number;
  saldoAkhir: number;
  totalIplReguler: number;
  totalDanaDarurat: number;
  jumlahTransaksiDarurat: number;
  saldoAwalBendahara: number;
  saldoAwalPengurusTitipan: number;
  saldoAkhirBendahara: number;
  saldoAkhirPengurusTitipan: number;
  jumlahTransaksiIpl: number;
  jumlahPemasukanLain: number;
  jumlahPengeluaran: number;
  pengeluaranPerKategori: KategoriRekapItem[];
  mutasiKronologis: CashLedgerRow[];
  summaryKepatuhan: MonthlyComplianceSummary;
  daftarUnitMenunggak: UnitDelinquencyItem[];
}

export interface KepatuhanBulananItem {
  bulan: number;
  namaBulan: string;
  unitAktif: number;
  unitLunas: number;
  unitDarurat?: number;
  persentase: number;
  nominalTerkumpul: number;
  isPraRilis?: boolean;
  isBulanBerjalan?: boolean;
  isBelumPeriode?: boolean;
}

export interface QuarterlyLpjReport {
  triwulanId: 1 | 2 | 3 | 4;
  labelTriwulan: string;
  rentangBulan: string;
  tahun: number;
  bulanList: readonly number[];
  saldoAwal: number;
  totalIpl: number;
  totalPemasukanLain: number;
  totalPemasukan: number;
  totalPengeluaran: number;
  saldoAkhir: number;
  totalIplReguler: number;
  totalDanaDarurat: number;
  jumlahTransaksiDarurat: number;
  saldoAwalBendahara: number;
  saldoAwalPengurusTitipan: number;
  saldoAkhirBendahara: number;
  saldoAkhirPengurusTitipan: number;
  pengeluaranPerKategori: KategoriRekapItem[];
  kepatuhanPerBulan: KepatuhanBulananItem[];
  rataRataKepatuhan: number;
  totalUnitAktif: number;
  mutasiKronologis: CashLedgerRow[];
  daftarUnitMenunggak: UnitDelinquencyItem[];
}

export interface PaymentMethodSummaryItem {
  metode: string;
  jumlahTransaksi: number;
  totalNominal: number;
  persentase: number;
}

export interface ChairmanExpenseLogItem {
  id: string;
  tanggal: string;
  noBukti: string;
  kategori: string;
  penerima: string;
  termin: string | null;
  keterangan: string;
  nominal: number;
  createdBy: string;
  statusVerifikasi: string;
  approvedByBendahara: string | null;
  approvedByKetua: string | null;
}

export interface ChairmanMonthlyCompliance {
  unitAktif: number;
  unitLunas: number;
  unitBelumBayar: number;
  persentaseKepatuhan: number;
  isPraRilis?: boolean;
}

export interface ChairmanMonthlyPipeline {
  iplPendingCount: number;
  iplAccBendaharaCount: number;
  kasPendingCount: number;
  kasAccBendaharaCount: number;
  totalMenungguKetuaCount: number;
  totalMenungguKetuaNominal: number;
}

export interface ChairmanMonthlySummaryReport {
  documentNumber: string;
  generatedAt: string;
  tahun: number;
  bulan: number;
  namaBulan: string;
  monthlyCash: MonthlyCashReport;
  surplusDefisit: number;
  totalTransaksiTerverifikasi: number;
  metodePembayaranBreakdown: PaymentMethodSummaryItem[];
  compliance: ChairmanMonthlyCompliance;
  pipeline: ChairmanMonthlyPipeline;
  expenseLogs: ChairmanExpenseLogItem[];
  totalExpenseAll: number;
  totalExpenseVerified: number;
  totalExpenseUnverified: number;
  executiveHighlights: string[];
}

function getDateOnly(isoOrDate: string): string {
  if (!isoOrDate) return '2026-01-01';
  const match = isoOrDate.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '2026-01-01';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getEffectiveIplDate(trx: TransaksiIPL): string {
  return getDateOnly(trx.verified_at || trx.tanggal_setor);
}

function parseDateParts(dateStr: string): { tahun: number; bulan: number; hari: number; ts: number } {
  const clean = getDateOnly(dateStr);
  const [y, m, d] = clean.split('-').map((n) => Number(n));
  const tahun = Number.isFinite(y) ? y : 2026;
  const bulan = Number.isFinite(m) ? m : 1;
  const hari = Number.isFinite(d) ? d : 1;
  return {
    tahun,
    bulan,
    hari,
    ts: new Date(tahun, bulan - 1, hari).getTime(),
  };
}

function resolveIplFundType(trx: TransaksiIPL): FundType {
  if (trx.fund_type === 'IPL_REGULER' || trx.fund_type === 'DANA_DARURAT') {
    return trx.fund_type;
  }
  const bulanCount = Math.max(trx.bulan_dibayar?.length || 1, 1);
  const perBulan = Math.round((Number(trx.nominal) || 0) / bulanCount);
  return perBulan > 0 && perBulan < NOMINAL_IPL_STANDAR ? 'DANA_DARURAT' : 'IPL_REGULER';
}

function resolveIplHolderRole(trx: TransaksiIPL): HolderRole {
  if (trx.holder_role === 'BENDAHARA' || trx.holder_role === 'PENGURUS_TITIPAN') {
    return trx.holder_role;
  }
  const petugas = String(trx.petugas_penerima || '').trim();
  if (trx.metode_bayar === 'Setor Tunai' && petugas && !/andriansyah|bendahara/i.test(petugas)) {
    return 'PENGURUS_TITIPAN';
  }
  return 'BENDAHARA';
}

function resolveKasFundType(kas: TransaksiKas): FundType {
  if (kas.fund_type === 'IPL_REGULER' || kas.fund_type === 'DANA_DARURAT') {
    return kas.fund_type;
  }
  return /darurat/i.test(String(kas.kategori || '')) ? 'DANA_DARURAT' : 'IPL_REGULER';
}

function resolveKasHolderRole(kas: TransaksiKas): HolderRole {
  if (kas.holder_role === 'BENDAHARA' || kas.holder_role === 'PENGURUS_TITIPAN') {
    return kas.holder_role;
  }
  return 'BENDAHARA';
}

export function isTransaksiKasFinalVerified(kas: TransaksiKas): boolean {
  return !kas.status_verifikasi || kas.status_verifikasi === 'Terverifikasi';
}

/**
 * Saldo Kas Real-Time:
 * Total Pemasukan IPL Terverifikasi Sah + Total Pemasukan Lain Sah - Total Pengeluaran Sah
 */
export function calculateGlobalCashSummary(
  transaksiList: TransaksiIPL[],
  transaksiKasList: TransaksiKas[]
): GlobalCashSummary {
  const totalIplMasuk = transaksiList
    .filter((t) => t.status_verifikasi === 'Terverifikasi')
    .reduce((sum, t) => sum + (Number(t.nominal) || 0), 0);

  const verifiedKas = transaksiKasList.filter(isTransaksiKasFinalVerified);

  const totalPemasukanLain = verifiedKas
    .filter((k) => k.jenis === 'pemasukan_lain')
    .reduce((sum, k) => sum + (Number(k.nominal) || 0), 0);

  const totalPengeluaran = verifiedKas
    .filter((k) => k.jenis === 'pengeluaran')
    .reduce((sum, k) => sum + (Number(k.nominal) || 0), 0);

  const totalPemasukan = totalIplMasuk + totalPemasukanLain;
  return {
    totalIplMasuk,
    totalPemasukanLain,
    totalPemasukan,
    totalPengeluaran,
    saldoKas: totalPemasukan - totalPengeluaran,
  };
}

function buildKategoriBreakdown(items: TransaksiKas[]): KategoriRekapItem[] {
  const map = new Map<string, { count: number; total: number }>();
  let grandTotal = 0;

  for (const item of items) {
    const nominal = Number(item.nominal) || 0;
    grandTotal += nominal;
    const prev = map.get(item.kategori) || { count: 0, total: 0 };
    map.set(item.kategori, {
      count: prev.count + 1,
      total: prev.total + nominal,
    });
  }

  return Array.from(map.entries())
    .map(([kategori, stats]) => ({
      kategori,
      jumlahTransaksi: stats.count,
      totalNominal: stats.total,
      persentase: grandTotal > 0 ? Math.round((stats.total / grandTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.totalNominal - a.totalNominal);
}

function buildUnitDelinquencyList(params: {
  wargaList: Warga[];
  year: number;
  months: readonly number[];
  paidAmountByKey: Map<string, number>;
  pendingKeys: Set<string>;
  billingStart?: BillingStartPeriod | null;
  now?: Date;
}): UnitDelinquencyItem[] {
  const sortedUnits = [...params.wargaList]
    .filter(isUnitBillable)
    .sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah));

  const result: UnitDelinquencyItem[] = [];
  for (const w of sortedUnits) {
    const tunggakMonths = getUnitDelinquentMonths({
      warga: w,
      year: params.year,
      months: params.months,
      paidAmountByKey: params.paidAmountByKey,
      pendingKeys: params.pendingKeys,
      billingStart: params.billingStart,
      now: params.now,
    });
    if (tunggakMonths.length === 0) continue;

    const hasPartialDarurat = tunggakMonths.some((m) => {
      const paid = params.paidAmountByKey.get(buildBillingCellKey(w.blok_rumah, params.year, m)) ?? 0;
      return paid > 0 && paid < NOMINAL_IPL_STANDAR;
    });

    result.push({
      blokRumah: formatBlokRumah(w.blok_rumah) || w.blok_rumah,
      namaWarga: w.nama_warga,
      bulanTunggak: tunggakMonths,
      labelBulan: formatDaftarBulan(tunggakMonths, true),
      estimasiTunggakan: tunggakMonths.length * NOMINAL_IPL_STANDAR,
      statusKeterangan: hasPartialDarurat
        ? 'Sebagian masuk Dana Darurat (< Rp100rb/bln)'
        : 'Melewati jatuh tempo tgl 7 bulan berikutnya',
    });
  }
  return result;
}

export interface MonthlyCashReportOptions {
  wargaList?: Warga[];
  statusList?: StatusEcardBulanan[];
  billingStart?: BillingStartPeriod | null;
  now?: Date;
}

/**
 * Rekapitulasi Kas Bulanan (Buku Kas Umum) dengan Saldo Awal & Saldo Akhir akurat,
 * pemisahan Kas IPL Reguler vs Dana Darurat, pemegang kas (Bendahara vs Titipan Pengurus),
 * serta ringkasan kepatuhan & daftar unit menunggak.
 */
export function buildMonthlyCashReport(
  tahun: number,
  bulan: number,
  transaksiList: TransaksiIPL[],
  transaksiKasList: TransaksiKas[],
  options?: MonthlyCashReportOptions
): MonthlyCashReport {
  const periodStartKey = tahun * 100 + bulan;
  const verifiedIpl = transaksiList.filter((t) => t.status_verifikasi === 'Terverifikasi');

  let saldoAwal = 0;
  let saldoAwalBendahara = 0;
  let saldoAwalPengurusTitipan = 0;

  let totalIplBulanIni = 0;
  let totalPemasukanLainBulanIni = 0;
  let totalKeluarBulanIni = 0;

  let totalIplReguler = 0;
  let totalDanaDarurat = 0;
  let jumlahTransaksiDarurat = 0;

  let netBendaharaBulanIni = 0;
  let netPengurusTitipanBulanIni = 0;

  let jumlahTransaksiIpl = 0;
  let jumlahPemasukanLain = 0;
  let jumlahPengeluaran = 0;

  const rawRows: Omit<CashLedgerRow, 'saldoBerjalan'>[] = [];
  const pengeluaranBulanIni: TransaksiKas[] = [];

  for (const trx of verifiedIpl) {
    const effDate = getEffectiveIplDate(trx);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(trx.nominal) || 0;
    const fundType = resolveIplFundType(trx);
    const holderRole = resolveIplHolderRole(trx);

    if (ymKey < periodStartKey) {
      saldoAwal += nominal;
      if (holderRole === 'PENGURUS_TITIPAN') {
        saldoAwalPengurusTitipan += nominal;
      } else {
        saldoAwalBendahara += nominal;
      }
    } else if (ymKey === periodStartKey) {
      totalIplBulanIni += nominal;
      jumlahTransaksiIpl += 1;
      if (fundType === 'DANA_DARURAT') {
        totalDanaDarurat += nominal;
        jumlahTransaksiDarurat += 1;
      } else {
        totalIplReguler += nominal;
      }
      if (holderRole === 'PENGURUS_TITIPAN') {
        netPengurusTitipanBulanIni += nominal;
      } else {
        netBendaharaBulanIni += nominal;
      }

      rawRows.push({
        id: `ipl-${trx.id}`,
        tanggal: effDate,
        sortKey: new Date(trx.verified_at || trx.tanggal_setor).getTime() || parts.ts,
        noBukti: trx.no_kwitansi,
        uraian: `${fundType === 'DANA_DARURAT' ? '[Dana Darurat] ' : ''}IPL Blok ${formatBlokRumah(trx.blok_rumah) || trx.blok_rumah} (${trx.nama_warga}) — ${formatDaftarBulan(trx.bulan_dibayar, true)}`,
        kategori:
          fundType === 'DANA_DARURAT'
            ? `Dana Darurat (${trx.metode_bayar})`
            : `IPL Reguler (${trx.metode_bayar})`,
        masuk: nominal,
        keluar: 0,
        sumberJenis: 'ipl',
        fundType,
        holderRole,
        metodeBayar: trx.metode_bayar,
      });
    }
  }

  for (const kas of transaksiKasList.filter(isTransaksiKasFinalVerified)) {
    const effDate = getDateOnly(kas.tanggal);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(kas.nominal) || 0;
    const fundType = resolveKasFundType(kas);
    const holderRole = resolveKasHolderRole(kas);

    if (ymKey < periodStartKey) {
      const delta = kas.jenis === 'pemasukan_lain' ? nominal : -nominal;
      saldoAwal += delta;
      if (holderRole === 'PENGURUS_TITIPAN') {
        saldoAwalPengurusTitipan += delta;
      } else {
        saldoAwalBendahara += delta;
      }
    } else if (ymKey === periodStartKey) {
      if (kas.jenis === 'pemasukan_lain') {
        totalPemasukanLainBulanIni += nominal;
        jumlahPemasukanLain += 1;
        if (fundType === 'DANA_DARURAT') {
          totalDanaDarurat += nominal;
          jumlahTransaksiDarurat += 1;
        } else {
          totalIplReguler += nominal;
        }
        if (holderRole === 'PENGURUS_TITIPAN') {
          netPengurusTitipanBulanIni += nominal;
        } else {
          netBendaharaBulanIni += nominal;
        }
        rawRows.push({
          id: `kas-${kas.id}`,
          tanggal: effDate,
          sortKey: parts.ts + 1,
          noBukti: kas.no_bukti,
          uraian: `${fundType === 'DANA_DARURAT' ? '[Dana Darurat] ' : ''}${kas.penerima_atau_sumber}${kas.keterangan ? ` — ${kas.keterangan}` : ''}`,
          kategori: kas.kategori,
          masuk: nominal,
          keluar: 0,
          sumberJenis: 'pemasukan_lain',
          fundType,
          holderRole,
        });
      } else {
        totalKeluarBulanIni += nominal;
        jumlahPengeluaran += 1;
        pengeluaranBulanIni.push(kas);
        if (holderRole === 'PENGURUS_TITIPAN') {
          netPengurusTitipanBulanIni -= nominal;
        } else {
          netBendaharaBulanIni -= nominal;
        }
        rawRows.push({
          id: `kas-${kas.id}`,
          tanggal: effDate,
          sortKey: parts.ts + 2,
          noBukti: kas.no_bukti,
          uraian: `${kas.penerima_atau_sumber}${kas.termin ? ` [${kas.termin}]` : ''}${kas.keterangan ? ` — ${kas.keterangan}` : ''}`,
          kategori: kas.kategori,
          masuk: 0,
          keluar: nominal,
          sumberJenis: 'pengeluaran',
          fundType,
          holderRole,
        });
      }
    }
  }

  rawRows.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.sortKey - b.sortKey);

  let running = saldoAwal;
  const mutasiKronologis: CashLedgerRow[] = rawRows.map((row) => {
    running = running + row.masuk - row.keluar;
    return {
      ...row,
      saldoBerjalan: running,
    };
  });

  const totalMasukBulanIni = totalIplBulanIni + totalPemasukanLainBulanIni;
  const saldoAkhir = saldoAwal + totalMasukBulanIni - totalKeluarBulanIni;
  const saldoAkhirBendahara = saldoAwalBendahara + netBendaharaBulanIni;
  const saldoAkhirPengurusTitipan = saldoAwalPengurusTitipan + netPengurusTitipanBulanIni;

  // Hitung kepatuhan & daftar unit menunggak jika wargaList disediakan
  const wargaList = options?.wargaList || [];
  const statusList = options?.statusList || [];
  const billingStart = options?.billingStart;
  const now = options?.now || new Date();
  const isPraRilis = isBeforeBillingStart(tahun, bulan, billingStart);

  let sudahSetor = 0;
  let belumSetor = 0;
  let unitDarurat = 0;
  let menunggak = 0;
  let totalBillable = 0;
  let daftarUnitMenunggak: UnitDelinquencyItem[] = [];

  if (wargaList.length > 0) {
    const { paidAmountByKey, pendingKeys } = buildPaidAmountLookup(transaksiList, statusList);
    const billableUnits = wargaList.filter(isUnitBillable);
    totalBillable = billableUnits.length;

    for (const w of billableUnits) {
      const cellKey = buildBillingCellKey(w.blok_rumah, tahun, bulan);
      const paidAmount = paidAmountByKey.get(cellKey) ?? 0;
      const cellStatus = resolveUnitMonthBillingStatus({
        warga: w,
        targetYear: tahun,
        targetMonth: bulan,
        paidAmount,
        billingStart,
        now,
      });

      if (cellStatus === 'LUNAS') {
        sudahSetor += 1;
      } else if (cellStatus !== 'KOSONG' && cellStatus !== 'PRA_RILIS') {
        belumSetor += 1;
        if (cellStatus === 'DANA_DARURAT') {
          unitDarurat += 1;
        }
      }
    }

    const monthsUpToSelected = Array.from({ length: Math.max(1, bulan) }, (_, idx) => idx + 1);
    daftarUnitMenunggak = buildUnitDelinquencyList({
      wargaList: billableUnits,
      year: tahun,
      months: monthsUpToSelected,
      paidAmountByKey,
      pendingKeys,
      billingStart,
      now,
    });
    menunggak = daftarUnitMenunggak.length;
  }

  return {
    tahun,
    bulan,
    namaBulan: getNamaBulan(bulan),
    saldoAwal,
    totalIplBulanIni,
    totalPemasukanLainBulanIni,
    totalMasukBulanIni,
    totalKeluarBulanIni,
    saldoAkhir,
    totalIplReguler,
    totalDanaDarurat,
    jumlahTransaksiDarurat,
    saldoAwalBendahara,
    saldoAwalPengurusTitipan,
    saldoAkhirBendahara,
    saldoAkhirPengurusTitipan,
    jumlahTransaksiIpl,
    jumlahPemasukanLain,
    jumlahPengeluaran,
    pengeluaranPerKategori: buildKategoriBreakdown(pengeluaranBulanIni),
    mutasiKronologis,
    summaryKepatuhan: {
      totalBillable,
      sudahSetor,
      belumSetor,
      menunggak,
      unitDarurat,
      isPraRilis,
    },
    daftarUnitMenunggak,
  };
}

/**
 * Laporan Pertanggungjawaban (LPJ) Keuangan Per Triwulan (3 Bulan).
 * Mengevaluasi 3 bulan di triwulan secara independen terhadap tanggal cetak,
 * memisahkan Kas IPL Reguler vs Dana Darurat, pemegang saldo, serta Daftar Unit Menunggak.
 */
export function buildQuarterlyLpjReport(
  tahun: number,
  triwulanId: 1 | 2 | 3 | 4,
  wargaList: Warga[],
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[],
  transaksiKasList: TransaksiKas[],
  billingStart?: BillingStartPeriod | null,
  now: Date = new Date()
): QuarterlyLpjReport {
  const tw = TRIWULAN_LIST.find((item) => item.id === triwulanId) || TRIWULAN_LIST[0];
  const startMonth = tw.bulan[0];
  const endMonth = tw.bulan[tw.bulan.length - 1];
  const startYmKey = tahun * 100 + startMonth;
  const endYmKey = tahun * 100 + endMonth;

  const verifiedIpl = transaksiList.filter((t) => t.status_verifikasi === 'Terverifikasi');

  let saldoAwal = 0;
  let saldoAwalBendahara = 0;
  let saldoAwalPengurusTitipan = 0;
  let totalIpl = 0;
  let totalPemasukanLain = 0;
  let totalPengeluaran = 0;
  let totalIplReguler = 0;
  let totalDanaDarurat = 0;
  let jumlahTransaksiDarurat = 0;
  let netBendahara = 0;
  let netPengurusTitipan = 0;

  const pengeluaranTriwulan: TransaksiKas[] = [];
  const rawRows: Omit<CashLedgerRow, 'saldoBerjalan'>[] = [];

  for (const trx of verifiedIpl) {
    const effDate = getEffectiveIplDate(trx);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(trx.nominal) || 0;
    const fundType = resolveIplFundType(trx);
    const holderRole = resolveIplHolderRole(trx);

    if (ymKey < startYmKey) {
      saldoAwal += nominal;
      if (holderRole === 'PENGURUS_TITIPAN') {
        saldoAwalPengurusTitipan += nominal;
      } else {
        saldoAwalBendahara += nominal;
      }
    } else if (ymKey >= startYmKey && ymKey <= endYmKey) {
      totalIpl += nominal;
      if (fundType === 'DANA_DARURAT') {
        totalDanaDarurat += nominal;
        jumlahTransaksiDarurat += 1;
      } else {
        totalIplReguler += nominal;
      }
      if (holderRole === 'PENGURUS_TITIPAN') {
        netPengurusTitipan += nominal;
      } else {
        netBendahara += nominal;
      }
      rawRows.push({
        id: `ipl-${trx.id}`,
        tanggal: effDate,
        sortKey: new Date(trx.verified_at || trx.tanggal_setor).getTime() || parts.ts,
        noBukti: trx.no_kwitansi,
        uraian: `${fundType === 'DANA_DARURAT' ? '[Dana Darurat] ' : ''}IPL Blok ${formatBlokRumah(trx.blok_rumah) || trx.blok_rumah} (${trx.nama_warga}) — ${formatDaftarBulan(trx.bulan_dibayar, true)}`,
        kategori:
          fundType === 'DANA_DARURAT'
            ? `Dana Darurat (${trx.metode_bayar})`
            : `IPL Reguler (${trx.metode_bayar})`,
        masuk: nominal,
        keluar: 0,
        sumberJenis: 'ipl',
        fundType,
        holderRole,
        metodeBayar: trx.metode_bayar,
      });
    }
  }

  for (const kas of transaksiKasList.filter(isTransaksiKasFinalVerified)) {
    const effDate = getDateOnly(kas.tanggal);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(kas.nominal) || 0;
    const fundType = resolveKasFundType(kas);
    const holderRole = resolveKasHolderRole(kas);

    if (ymKey < startYmKey) {
      const delta = kas.jenis === 'pemasukan_lain' ? nominal : -nominal;
      saldoAwal += delta;
      if (holderRole === 'PENGURUS_TITIPAN') {
        saldoAwalPengurusTitipan += delta;
      } else {
        saldoAwalBendahara += delta;
      }
    } else if (ymKey >= startYmKey && ymKey <= endYmKey) {
      if (kas.jenis === 'pemasukan_lain') {
        totalPemasukanLain += nominal;
        if (fundType === 'DANA_DARURAT') {
          totalDanaDarurat += nominal;
          jumlahTransaksiDarurat += 1;
        } else {
          totalIplReguler += nominal;
        }
        if (holderRole === 'PENGURUS_TITIPAN') {
          netPengurusTitipan += nominal;
        } else {
          netBendahara += nominal;
        }
        rawRows.push({
          id: `kas-${kas.id}`,
          tanggal: effDate,
          sortKey: parts.ts + 1,
          noBukti: kas.no_bukti,
          uraian: `${fundType === 'DANA_DARURAT' ? '[Dana Darurat] ' : ''}${kas.penerima_atau_sumber}${kas.keterangan ? ` — ${kas.keterangan}` : ''}`,
          kategori: kas.kategori,
          masuk: nominal,
          keluar: 0,
          sumberJenis: 'pemasukan_lain',
          fundType,
          holderRole,
        });
      } else {
        totalPengeluaran += nominal;
        pengeluaranTriwulan.push(kas);
        if (holderRole === 'PENGURUS_TITIPAN') {
          netPengurusTitipan -= nominal;
        } else {
          netBendahara -= nominal;
        }
        rawRows.push({
          id: `kas-${kas.id}`,
          tanggal: effDate,
          sortKey: parts.ts + 2,
          noBukti: kas.no_bukti,
          uraian: `${kas.penerima_atau_sumber}${kas.termin ? ` [${kas.termin}]` : ''}${kas.keterangan ? ` — ${kas.keterangan}` : ''}`,
          kategori: kas.kategori,
          masuk: 0,
          keluar: nominal,
          sumberJenis: 'pengeluaran',
          fundType,
          holderRole,
        });
      }
    }
  }

  rawRows.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.sortKey - b.sortKey);

  let running = saldoAwal;
  const mutasiKronologis: CashLedgerRow[] = rawRows.map((row) => {
    running = running + row.masuk - row.keluar;
    return {
      ...row,
      saldoBerjalan: running,
    };
  });

  // Hitung tingkat kepatuhan pembayaran warga per bulan pada triwulan ini secara independen
  // Mengecualikan unit kosong (is_occupied = false) & dibebaskan (is_exempt = true)
  const billableUnits = wargaList.filter(isUnitBillable);
  const totalUnitAktif = billableUnits.length;
  const { paidAmountByKey, pendingKeys } = buildPaidAmountLookup(transaksiList, statusList);

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const kepatuhanPerBulan: KepatuhanBulananItem[] = tw.bulan.map((bulan) => {
    const isPraRilis = isBeforeBillingStart(tahun, bulan, billingStart);
    const isBulanBerjalan = tahun === currentYear && bulan === currentMonth;
    const isBelumPeriode =
      tahun > currentYear || (tahun === currentYear && bulan > currentMonth);

    let unitLunas = 0;
    let unitDarurat = 0;

    for (const w of billableUnits) {
      const cellKey = buildBillingCellKey(w.blok_rumah, tahun, bulan);
      const paidAmount = paidAmountByKey.get(cellKey) ?? 0;
      const cellStatus = resolveUnitMonthBillingStatus({
        warga: w,
        targetYear: tahun,
        targetMonth: bulan,
        paidAmount,
        billingStart,
        now,
      });
      if (cellStatus === 'LUNAS') {
        unitLunas += 1;
      } else if (cellStatus === 'DANA_DARURAT') {
        unitDarurat += 1;
      }
    }

    const nominalBulan = verifiedIpl
      .filter((t) => t.tahun === tahun && t.bulan_dibayar.includes(bulan))
      .reduce((sum, t) => {
        const div = Math.max(t.bulan_dibayar.length, 1);
        return sum + Math.round((Number(t.nominal) || 0) / div);
      }, 0);

    const persentase =
      totalUnitAktif > 0 ? Math.round((unitLunas / totalUnitAktif) * 1000) / 10 : 0;

    return {
      bulan,
      namaBulan: getNamaBulan(bulan),
      unitAktif: totalUnitAktif,
      unitLunas,
      unitDarurat,
      persentase,
      nominalTerkumpul: nominalBulan,
      isPraRilis,
      isBulanBerjalan,
      isBelumPeriode,
    };
  });

  const finishedBillingMonths = kepatuhanPerBulan.filter(
    (m) => !m.isPraRilis && !m.isBelumPeriode && !m.isBulanBerjalan
  );
  const activeBillingMonths =
    finishedBillingMonths.length > 0
      ? finishedBillingMonths
      : kepatuhanPerBulan.filter((m) => !m.isPraRilis && !m.isBelumPeriode);

  const rataRataKepatuhan =
    activeBillingMonths.length > 0
      ? Math.round(
          (activeBillingMonths.reduce((s, item) => s + item.persentase, 0) /
            activeBillingMonths.length) *
            10
        ) / 10
      : 0;

  const daftarUnitMenunggak = buildUnitDelinquencyList({
    wargaList: billableUnits,
    year: tahun,
    months: tw.bulan,
    paidAmountByKey,
    pendingKeys,
    billingStart,
    now,
  });

  const totalPemasukan = totalIpl + totalPemasukanLain;
  const saldoAkhir = saldoAwal + totalPemasukan - totalPengeluaran;
  const saldoAkhirBendahara = saldoAwalBendahara + netBendahara;
  const saldoAkhirPengurusTitipan = saldoAwalPengurusTitipan + netPengurusTitipan;

  return {
    triwulanId,
    labelTriwulan: tw.label,
    rentangBulan: tw.rentang,
    tahun,
    bulanList: tw.bulan,
    saldoAwal,
    totalIpl,
    totalPemasukanLain,
    totalPemasukan,
    totalPengeluaran,
    saldoAkhir,
    totalIplReguler,
    totalDanaDarurat,
    jumlahTransaksiDarurat,
    saldoAwalBendahara,
    saldoAwalPengurusTitipan,
    saldoAkhirBendahara,
    saldoAkhirPengurusTitipan,
    pengeluaranPerKategori: buildKategoriBreakdown(pengeluaranTriwulan),
    kepatuhanPerBulan,
    rataRataKepatuhan,
    totalUnitAktif,
    mutasiKronologis,
    daftarUnitMenunggak,
  };
}

/**
 * Automated Chairman Monthly Summary Report Compiler:
 * Compiles monthly transaction totals, payment method distribution, compliance,
 * pending approval pipeline, chronological expense logs, and executive highlights
 * into a single structured report ready for PDF export.
 */
export function buildChairmanMonthlySummaryReport(
  tahun: number,
  bulan: number,
  wargaList: Warga[],
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[],
  transaksiKasList: TransaksiKas[],
  billingStart?: BillingStartPeriod | null,
  now?: Date
): ChairmanMonthlySummaryReport {
  const monthlyCash = buildMonthlyCashReport(tahun, bulan, transaksiList, transaksiKasList, {
    wargaList,
    statusList,
    billingStart,
    now,
  });
  const periodKey = tahun * 100 + bulan;
  const paddedMonth = String(bulan).padStart(2, '0');
  const documentNumber = `LAP-KETUA/${tahun}/${paddedMonth}/SK`;

  // 1. Breakdown Metode Pembayaran IPL Terverifikasi pada bulan terpilih
  const methodMap = new Map<string, { count: number; total: number }>();
  let totalIplVerifiedForMethod = 0;

  let iplPendingCount = 0;
  let iplAccBendaharaCount = 0;
  let totalMenungguKetuaNominal = 0;

  for (const trx of transaksiList) {
    const effDate = getEffectiveIplDate(trx);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(trx.nominal) || 0;

    if (trx.status_verifikasi === 'Terverifikasi' && ymKey === periodKey) {
      totalIplVerifiedForMethod += nominal;
      const key = trx.metode_bayar || 'Lainnya';
      const prev = methodMap.get(key) || { count: 0, total: 0 };
      methodMap.set(key, { count: prev.count + 1, total: prev.total + nominal });
    } else if (ymKey === periodKey) {
      if (trx.status_verifikasi === 'Pending') {
        iplPendingCount += 1;
      } else if (trx.status_verifikasi === 'ACC Bendahara') {
        iplAccBendaharaCount += 1;
        totalMenungguKetuaNominal += nominal;
      }
    }
  }

  const metodePembayaranBreakdown: PaymentMethodSummaryItem[] = Array.from(methodMap.entries())
    .map(([metode, stats]) => ({
      metode,
      jumlahTransaksi: stats.count,
      totalNominal: stats.total,
      persentase:
        totalIplVerifiedForMethod > 0
          ? Math.round((stats.total / totalIplVerifiedForMethod) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.totalNominal - a.totalNominal);

  // 2. Kumpulkan seluruh Log Pengeluaran (Expense Logs) & status antrean Kas pada bulan terpilih
  let kasPendingCount = 0;
  let kasAccBendaharaCount = 0;
  const expenseLogs: ChairmanExpenseLogItem[] = [];

  for (const kas of transaksiKasList) {
    const effDate = getDateOnly(kas.tanggal);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    if (ymKey !== periodKey) continue;

    const nominal = Number(kas.nominal) || 0;
    const statusVerif = kas.status_verifikasi || 'Terverifikasi';

    if (statusVerif === 'Pending') {
      kasPendingCount += 1;
    } else if (statusVerif === 'ACC Bendahara') {
      kasAccBendaharaCount += 1;
      totalMenungguKetuaNominal += nominal;
    }

    if (kas.jenis === 'pengeluaran' && statusVerif !== 'Ditolak') {
      expenseLogs.push({
        id: kas.id,
        tanggal: effDate,
        noBukti: kas.no_bukti,
        kategori: kas.kategori,
        penerima: kas.penerima_atau_sumber,
        termin: kas.termin || null,
        keterangan: kas.keterangan || '-',
        nominal,
        createdBy: kas.created_by_name,
        statusVerifikasi: statusVerif,
        approvedByBendahara: kas.bendahara_approved_by || null,
        approvedByKetua: kas.ketua_approved_by || null,
      });
    }
  }

  expenseLogs.sort(
    (a, b) => a.tanggal.localeCompare(b.tanggal) || a.noBukti.localeCompare(b.noBukti)
  );

  const totalExpenseVerified = expenseLogs
    .filter((e) => e.statusVerifikasi === 'Terverifikasi')
    .reduce((sum, e) => sum + e.nominal, 0);
  const totalExpenseAll = expenseLogs.reduce((sum, e) => sum + e.nominal, 0);
  const totalExpenseUnverified = Math.max(0, totalExpenseAll - totalExpenseVerified);

  // 3. Kepatuhan Pembayaran IPL Unit Billable pada bulan terpilih (memakai aturan >= 100rb = Lunas)
  const isPraRilis = monthlyCash.summaryKepatuhan.isPraRilis;
  const unitAktif = monthlyCash.summaryKepatuhan.totalBillable;
  const unitLunas = monthlyCash.summaryKepatuhan.sudahSetor;
  const unitBelumBayar = isPraRilis ? 0 : monthlyCash.summaryKepatuhan.belumSetor;
  const persentaseKepatuhan =
    unitAktif > 0 ? Math.round((unitLunas / unitAktif) * 1000) / 10 : 0;

  const surplusDefisit = monthlyCash.totalMasukBulanIni - monthlyCash.totalKeluarBulanIni;
  const totalTransaksiTerverifikasi =
    monthlyCash.jumlahTransaksiIpl +
    monthlyCash.jumlahPemasukanLain +
    monthlyCash.jumlahPengeluaran;
  const totalMenungguKetuaCount = iplAccBendaharaCount + kasAccBendaharaCount;

  // 4. Ringkasan Eksekutif Otomatis
  const executiveHighlights: string[] = [];
  if (surplusDefisit >= 0) {
    executiveHighlights.push(
      `Arus kas periode ${monthlyCash.namaBulan} ${tahun} mencatat SURPLUS sebesar ${formatRupiah(surplusDefisit)} dengan saldo akhir kas ${formatRupiah(monthlyCash.saldoAkhir)} (Kas Reguler: ${formatRupiah(monthlyCash.totalIplReguler)}, Dana Darurat: ${formatRupiah(monthlyCash.totalDanaDarurat)}).`
    );
  } else {
    executiveHighlights.push(
      `Arus kas periode ${monthlyCash.namaBulan} ${tahun} mencatat DEFISIT sebesar ${formatRupiah(Math.abs(surplusDefisit))}; posisi saldo akhir kas tetap terjaga di ${formatRupiah(monthlyCash.saldoAkhir)}.`
    );
  }

  executiveHighlights.push(
    isPraRilis
      ? `Periode ${monthlyCash.namaBulan} ${tahun} berstatus Pra-Rilis (penagihan aktif dimulai ${formatBillingStartLabel(billingStart)}); unit belum setor tidak dihitung sebagai tunggakan.`
      : `Total ${totalTransaksiTerverifikasi} transaksi terverifikasi (${monthlyCash.jumlahTransaksiIpl} IPL, ${monthlyCash.jumlahPemasukanLain} kas lain, ${monthlyCash.jumlahPengeluaran} pengeluaran) dengan kepatuhan IPL ${persentaseKepatuhan}% (${unitLunas}/${unitAktif} unit wajib iuran lunas; ${monthlyCash.summaryKepatuhan.menunggak} unit menunggak).`
  );

  if (monthlyCash.pengeluaranPerKategori.length > 0) {
    const topExp = monthlyCash.pengeluaranPerKategori[0];
    executiveHighlights.push(
      `Pos pengeluaran terbesar bulan ini adalah "${topExp.kategori}" sebesar ${formatRupiah(topExp.totalNominal)} (${topExp.persentase}% dari total pengeluaran terverifikasi).`
    );
  } else {
    executiveHighlights.push(
      `Belum terdapat pengeluaran anggaran terverifikasi pada periode ${monthlyCash.namaBulan} ${tahun}.`
    );
  }

  if (totalMenungguKetuaCount > 0) {
    executiveHighlights.push(
      `Terdapat ${totalMenungguKetuaCount} transaksi (senilai ${formatRupiah(totalMenungguKetuaNominal)}) yang telah di-ACC Bendahara dan menunggu pengesahan final Ketua.`
    );
  }

  return {
    documentNumber,
    generatedAt: new Date().toISOString(),
    tahun,
    bulan,
    namaBulan: monthlyCash.namaBulan,
    monthlyCash,
    surplusDefisit,
    totalTransaksiTerverifikasi,
    metodePembayaranBreakdown,
    compliance: {
      unitAktif,
      unitLunas,
      unitBelumBayar,
      persentaseKepatuhan,
      isPraRilis,
    },
    pipeline: {
      iplPendingCount,
      iplAccBendaharaCount,
      kasPendingCount,
      kasAccBendaharaCount,
      totalMenungguKetuaCount,
      totalMenungguKetuaNominal,
    },
    expenseLogs,
    totalExpenseAll,
    totalExpenseVerified,
    totalExpenseUnverified,
    executiveHighlights,
  };
}
