import {
  TRIWULAN_LIST,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../types';
import { formatDaftarBulan, getNamaBulan } from './format';

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
}

export interface KategoriRekapItem {
  kategori: string;
  jumlahTransaksi: number;
  totalNominal: number;
  persentase: number;
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
  jumlahTransaksiIpl: number;
  jumlahPemasukanLain: number;
  jumlahPengeluaran: number;
  pengeluaranPerKategori: KategoriRekapItem[];
  mutasiKronologis: CashLedgerRow[];
}

export interface KepatuhanBulananItem {
  bulan: number;
  namaBulan: string;
  unitAktif: number;
  unitLunas: number;
  persentase: number;
  nominalTerkumpul: number;
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
  pengeluaranPerKategori: KategoriRekapItem[];
  kepatuhanPerBulan: KepatuhanBulananItem[];
  rataRataKepatuhan: number;
  totalUnitAktif: number;
  mutasiKronologis: CashLedgerRow[];
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

/**
 * Saldo Kas Real-Time:
 * Total Pemasukan IPL Terverifikasi + Total Pemasukan Lain - Total Pengeluaran Anggaran
 */
export function calculateGlobalCashSummary(
  transaksiList: TransaksiIPL[],
  transaksiKasList: TransaksiKas[]
): GlobalCashSummary {
  const totalIplMasuk = transaksiList
    .filter((t) => t.status_verifikasi === 'Terverifikasi')
    .reduce((sum, t) => sum + (Number(t.nominal) || 0), 0);

  const totalPemasukanLain = transaksiKasList
    .filter((k) => k.jenis === 'pemasukan_lain')
    .reduce((sum, k) => sum + (Number(k.nominal) || 0), 0);

  const totalPengeluaran = transaksiKasList
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

/**
 * Rekapitulasi Kas Bulanan (Buku Kas Umum) dengan Saldo Awal & Saldo Akhir akurat.
 */
export function buildMonthlyCashReport(
  tahun: number,
  bulan: number,
  transaksiList: TransaksiIPL[],
  transaksiKasList: TransaksiKas[]
): MonthlyCashReport {
  const periodStartKey = tahun * 100 + bulan;
  const verifiedIpl = transaksiList.filter((t) => t.status_verifikasi === 'Terverifikasi');

  let saldoAwal = 0;
  let totalIplBulanIni = 0;
  let totalPemasukanLainBulanIni = 0;
  let totalKeluarBulanIni = 0;
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

    if (ymKey < periodStartKey) {
      saldoAwal += nominal;
    } else if (ymKey === periodStartKey) {
      totalIplBulanIni += nominal;
      jumlahTransaksiIpl += 1;
      rawRows.push({
        id: `ipl-${trx.id}`,
        tanggal: effDate,
        sortKey: new Date(trx.verified_at || trx.tanggal_setor).getTime() || parts.ts,
        noBukti: trx.no_kwitansi,
        uraian: `IPL Blok ${trx.blok_rumah} (${trx.nama_warga}) — ${formatDaftarBulan(trx.bulan_dibayar, true)}`,
        kategori: `IPL Warga (${trx.metode_bayar})`,
        masuk: nominal,
        keluar: 0,
        sumberJenis: 'ipl',
      });
    }
  }

  for (const kas of transaksiKasList) {
    const effDate = getDateOnly(kas.tanggal);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(kas.nominal) || 0;

    if (ymKey < periodStartKey) {
      saldoAwal += kas.jenis === 'pemasukan_lain' ? nominal : -nominal;
    } else if (ymKey === periodStartKey) {
      if (kas.jenis === 'pemasukan_lain') {
        totalPemasukanLainBulanIni += nominal;
        jumlahPemasukanLain += 1;
        rawRows.push({
          id: `kas-${kas.id}`,
          tanggal: effDate,
          sortKey: parts.ts + 1,
          noBukti: kas.no_bukti,
          uraian: `${kas.penerima_atau_sumber}${kas.keterangan ? ` — ${kas.keterangan}` : ''}`,
          kategori: kas.kategori,
          masuk: nominal,
          keluar: 0,
          sumberJenis: 'pemasukan_lain',
        });
      } else {
        totalKeluarBulanIni += nominal;
        jumlahPengeluaran += 1;
        pengeluaranBulanIni.push(kas);
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
    jumlahTransaksiIpl,
    jumlahPemasukanLain,
    jumlahPengeluaran,
    pengeluaranPerKategori: buildKategoriBreakdown(pengeluaranBulanIni),
    mutasiKronologis,
  };
}

/**
 * Laporan Pertanggungjawaban (LPJ) Keuangan Per Triwulan (3 Bulan).
 */
export function buildQuarterlyLpjReport(
  tahun: number,
  triwulanId: 1 | 2 | 3 | 4,
  wargaList: Warga[],
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[],
  transaksiKasList: TransaksiKas[]
): QuarterlyLpjReport {
  const tw = TRIWULAN_LIST.find((item) => item.id === triwulanId) || TRIWULAN_LIST[0];
  const startMonth = tw.bulan[0];
  const endMonth = tw.bulan[tw.bulan.length - 1];
  const startYmKey = tahun * 100 + startMonth;
  const endYmKey = tahun * 100 + endMonth;

  const verifiedIpl = transaksiList.filter((t) => t.status_verifikasi === 'Terverifikasi');

  let saldoAwal = 0;
  let totalIpl = 0;
  let totalPemasukanLain = 0;
  let totalPengeluaran = 0;

  const pengeluaranTriwulan: TransaksiKas[] = [];
  const rawRows: Omit<CashLedgerRow, 'saldoBerjalan'>[] = [];

  for (const trx of verifiedIpl) {
    const effDate = getEffectiveIplDate(trx);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(trx.nominal) || 0;

    if (ymKey < startYmKey) {
      saldoAwal += nominal;
    } else if (ymKey >= startYmKey && ymKey <= endYmKey) {
      totalIpl += nominal;
      rawRows.push({
        id: `ipl-${trx.id}`,
        tanggal: effDate,
        sortKey: new Date(trx.verified_at || trx.tanggal_setor).getTime() || parts.ts,
        noBukti: trx.no_kwitansi,
        uraian: `IPL Blok ${trx.blok_rumah} (${trx.nama_warga}) — ${formatDaftarBulan(trx.bulan_dibayar, true)}`,
        kategori: `IPL Warga (${trx.metode_bayar})`,
        masuk: nominal,
        keluar: 0,
        sumberJenis: 'ipl',
      });
    }
  }

  for (const kas of transaksiKasList) {
    const effDate = getDateOnly(kas.tanggal);
    const parts = parseDateParts(effDate);
    const ymKey = parts.tahun * 100 + parts.bulan;
    const nominal = Number(kas.nominal) || 0;

    if (ymKey < startYmKey) {
      saldoAwal += kas.jenis === 'pemasukan_lain' ? nominal : -nominal;
    } else if (ymKey >= startYmKey && ymKey <= endYmKey) {
      if (kas.jenis === 'pemasukan_lain') {
        totalPemasukanLain += nominal;
        rawRows.push({
          id: `kas-${kas.id}`,
          tanggal: effDate,
          sortKey: parts.ts + 1,
          noBukti: kas.no_bukti,
          uraian: `${kas.penerima_atau_sumber}${kas.keterangan ? ` — ${kas.keterangan}` : ''}`,
          kategori: kas.kategori,
          masuk: nominal,
          keluar: 0,
          sumberJenis: 'pemasukan_lain',
        });
      } else {
        totalPengeluaran += nominal;
        pengeluaranTriwulan.push(kas);
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

  // Hitung tingkat kepatuhan pembayaran warga per bulan pada triwulan ini
  const activeUnits = wargaList.filter((w) => w.aktif && w.status_hunian !== 'Kosong');
  const activeUnitSet = new Set(activeUnits.map((w) => w.blok_rumah));
  const totalUnitAktif = activeUnits.length;

  const kepatuhanPerBulan: KepatuhanBulananItem[] = tw.bulan.map((bulan) => {
    const lunasSet = new Set(
      statusList
        .filter(
          (s) =>
            s.tahun === tahun &&
            s.bulan === bulan &&
            s.status === 'Lunas' &&
            activeUnitSet.has(s.blok_rumah)
        )
        .map((s) => s.blok_rumah)
    );

    const nominalBulan = verifiedIpl
      .filter((t) => t.tahun === tahun && t.bulan_dibayar.includes(bulan))
      .reduce((sum, t) => {
        const div = Math.max(t.bulan_dibayar.length, 1);
        return sum + Math.round((Number(t.nominal) || 0) / div);
      }, 0);

    const unitLunas = lunasSet.size;
    const persentase =
      totalUnitAktif > 0 ? Math.round((unitLunas / totalUnitAktif) * 1000) / 10 : 0;

    return {
      bulan,
      namaBulan: getNamaBulan(bulan),
      unitAktif: totalUnitAktif,
      unitLunas,
      persentase,
      nominalTerkumpul: nominalBulan,
    };
  });

  const rataRataKepatuhan =
    kepatuhanPerBulan.length > 0
      ? Math.round(
          (kepatuhanPerBulan.reduce((s, item) => s + item.persentase, 0) /
            kepatuhanPerBulan.length) *
            10
        ) / 10
      : 0;

  const totalPemasukan = totalIpl + totalPemasukanLain;
  const saldoAkhir = saldoAwal + totalPemasukan - totalPengeluaran;

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
    pengeluaranPerKategori: buildKategoriBreakdown(pengeluaranTriwulan),
    kepatuhanPerBulan,
    rataRataKepatuhan,
    totalUnitAktif,
    mutasiKronologis,
  };
}
