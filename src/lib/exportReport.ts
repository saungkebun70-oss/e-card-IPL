import * as XLSX from 'xlsx';
import {
  BULAN_LIST,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type Warga,
} from '../types';
import {
  compareBlokRumah,
  formatBlokRumah,
  formatDaftarBulan,
  formatTanggal,
  type BillingStartPeriod,
} from './format';
import {
  buildBillingCellKey,
  buildPaidAmountLookup,
  formatDaruratBadgeLabel,
  getStatusBadgeStyle,
  getUnitDelinquentMonths,
  isUnitBillable,
  resolveUnitMonthBillingStatus,
} from './billingStatus';

export interface CashAllocationSummary {
  totalTerverifikasi: number;
  alokasiIplReguler: number;
  alokasiDanaDarurat: number;
  jumlahTransaksiDarurat: number;
}

export function calculateCashAllocation(transaksiList: TransaksiIPL[]): CashAllocationSummary {
  const verified = transaksiList.filter((t) => t.status_verifikasi === 'Terverifikasi');
  let totalTerverifikasi = 0;
  let alokasiIplReguler = 0;
  let alokasiDanaDarurat = 0;
  let jumlahTransaksiDarurat = 0;

  for (const t of verified) {
    const nominal = Number(t.nominal) || 0;
    totalTerverifikasi += nominal;
    const bulanCount = Math.max(t.bulan_dibayar.length, 1);
    const perBulan = nominal / bulanCount;
    const isDarurat =
      t.fund_type === 'DANA_DARURAT' ||
      (t.fund_type !== 'IPL_REGULER' && perBulan > 0 && perBulan < NOMINAL_IPL_STANDAR);
    if (isDarurat) {
      alokasiDanaDarurat += nominal;
      jumlahTransaksiDarurat += 1;
    } else {
      alokasiIplReguler += nominal;
    }
  }

  return {
    totalTerverifikasi,
    alokasiIplReguler,
    alokasiDanaDarurat,
    jumlahTransaksiDarurat,
  };
}

function buildMatrixRows(
  wargaList: Warga[],
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[],
  billingStart?: BillingStartPeriod | null
) {
  const sortedWarga = [...wargaList].sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah));
  const { paidAmountByKey, pendingKeys } = buildPaidAmountLookup(transaksiList, statusList);

  return sortedWarga.map((w) => {
    const row: Record<string, string | number> = {
      'Blok / No. Rumah': formatBlokRumah(w.blok_rumah) || w.blok_rumah,
      'Nama Warga': w.nama_warga,
      'Status Hunian': w.is_exempt ? `${w.status_hunian} (Bebas Iuran)` : w.status_hunian,
      'No. WhatsApp': w.no_wa,
      'Iuran Wajib (Rp)': w.is_occupied === false || w.is_exempt ? 0 : w.nominal_iuran,
    };
    let totalLunas = 0;
    for (const b of BULAN_LIST) {
      const cellKey = buildBillingCellKey(w.blok_rumah, TAHUN_AKTIF, b.angka);
      const paidAmount = paidAmountByKey.get(cellKey) ?? 0;
      const cellStatus = resolveUnitMonthBillingStatus({
        warga: w,
        targetYear: TAHUN_AKTIF,
        targetMonth: b.angka,
        paidAmount,
        billingStart,
      });

      const isPending =
        paidAmount === 0 &&
        cellStatus !== 'KOSONG' &&
        cellStatus !== 'PRA_RILIS' &&
        pendingKeys.has(cellKey);

      if (isPending) {
        row[b.singkat] = 'Pending';
      } else if (cellStatus === 'DANA_DARURAT') {
        row[b.singkat] = formatDaruratBadgeLabel(paidAmount);
      } else {
        row[b.singkat] = getStatusBadgeStyle(cellStatus).label;
      }
      if (cellStatus === 'LUNAS') totalLunas += 1;
    }
    row['Total Bulan Lunas'] = totalLunas;
    return row;
  });
}

function buildCashLedgerRows(transaksiList: TransaksiIPL[]) {
  return transaksiList
    .filter((t) => t.status_verifikasi === 'Terverifikasi')
    .map((t) => {
      const bulanCount = Math.max(t.bulan_dibayar.length, 1);
      const perBulan = t.nominal / bulanCount;
      const isDarurat =
        t.fund_type === 'DANA_DARURAT' ||
        (t.fund_type !== 'IPL_REGULER' && perBulan > 0 && perBulan < NOMINAL_IPL_STANDAR);
      const kategoriAlokasi = isDarurat
        ? 'Dana Darurat (< Rp 100.000/bln)'
        : 'Kas IPL Reguler';
      const pemegangDana =
        t.holder_role === 'PENGURUS_TITIPAN' ? 'Titipan Pengurus' : 'Bendahara';
      return {
        'No. Kwitansi': t.no_kwitansi,
        'Tanggal Setor': formatTanggal(t.tanggal_setor),
        'Blok / No. Rumah': formatBlokRumah(t.blok_rumah) || t.blok_rumah,
        'Nama Warga': t.nama_warga,
        'Bulan Dibayar': formatDaftarBulan(t.bulan_dibayar),
        'Metode Pembayaran': t.metode_bayar,
        'Petugas Penerima': t.petugas_penerima || '-',
        'Pemegang Dana': pemegangDana,
        'Nominal (Rp)': t.nominal,
        'Kategori Alokasi': kategoriAlokasi,
        'Keterangan': t.keterangan || '-',
      };
    });
}

function buildDelinquentUnitRows(
  wargaList: Warga[],
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[],
  billingStart?: BillingStartPeriod | null
) {
  const sortedWarga = [...wargaList]
    .filter(isUnitBillable)
    .sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah));
  const { paidAmountByKey, pendingKeys } = buildPaidAmountLookup(transaksiList, statusList);

  const rows: Array<Record<string, string | number>> = [];
  for (const w of sortedWarga) {
    const tunggakMonths = getUnitDelinquentMonths({
      warga: w,
      year: TAHUN_AKTIF,
      paidAmountByKey,
      pendingKeys,
      billingStart,
    });
    if (tunggakMonths.length === 0) continue;

    rows.push({
      'Blok / No. Rumah': formatBlokRumah(w.blok_rumah) || w.blok_rumah,
      'Nama Warga': w.nama_warga,
      'Status Hunian': w.status_hunian,
      'No. WhatsApp': w.no_wa,
      'Bulan Menunggak': formatDaftarBulan(tunggakMonths, true),
      'Jumlah Bulan': tunggakMonths.length,
      'Estimasi Tunggakan (Rp)': tunggakMonths.length * NOMINAL_IPL_STANDAR,
    });
  }
  return rows;
}

export function exportLaporanExcel(
  wargaList: Warga[],
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[],
  billingStart?: BillingStartPeriod | null
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Rekap Matriks 12 Bulan
  const matrixRows = buildMatrixRows(wargaList, statusList, transaksiList, billingStart);
  const wsMatrix = XLSX.utils.json_to_sheet(matrixRows);
  XLSX.utils.book_append_sheet(wb, wsMatrix, `Rekap Matriks ${TAHUN_AKTIF}`);

  // Sheet 2: Laporan Kas & Alokasi Dana Darurat
  const summary = calculateCashAllocation(transaksiList);
  const summaryRows = [
    { Uraian: 'Instansi', Nilai: 'Pengurus Lingkungan Perumahan Saung Kebun' },
    { Uraian: 'Alamat', Nilai: 'Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)' },
    { Uraian: 'Periode Laporan', Nilai: `Tahun ${TAHUN_AKTIF}` },
    { Uraian: 'Total Kas Terverifikasi (Rp)', Nilai: summary.totalTerverifikasi },
    { Uraian: 'Alokasi Kas IPL Reguler (Rp)', Nilai: summary.alokasiIplReguler },
    { Uraian: 'Alokasi Dana Darurat (Setoran < Rp 100.000/bln) (Rp)', Nilai: summary.alokasiDanaDarurat },
    { Uraian: 'Jumlah Transaksi Alokasi Dana Darurat', Nilai: summary.jumlahTransaksiDarurat },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan Kas & Darurat');

  // Sheet 3: Detail Transaksi Terverifikasi
  const ledgerRows = buildCashLedgerRows(transaksiList);
  const wsLedger = XLSX.utils.json_to_sheet(
    ledgerRows.length > 0
      ? ledgerRows
      : [{ Info: 'Belum ada transaksi terverifikasi pada periode ini.' }]
  );
  XLSX.utils.book_append_sheet(wb, wsLedger, 'Detail Transaksi Kas');

  // Sheet 4: Daftar Unit Menunggak (Hanya unit berpenghuni & wajib iuran)
  const delinquentRows = buildDelinquentUnitRows(wargaList, statusList, transaksiList, billingStart);
  const wsDelinquent = XLSX.utils.json_to_sheet(
    delinquentRows.length > 0
      ? delinquentRows
      : [{ Info: 'Tidak ada unit berpenghuni yang menunggak melewati jatuh tempo tanggal 7.' }]
  );
  XLSX.utils.book_append_sheet(wb, wsDelinquent, 'Unit Menunggak');

  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Laporan_IPL_Saung_Kebun_${TAHUN_AKTIF}_${dateStamp}.xlsx`);
}

export function exportLaporanCsv(
  wargaList: Warga[],
  statusList: StatusEcardBulanan[],
  transaksiList: TransaksiIPL[],
  billingStart?: BillingStartPeriod | null
) {
  const matrixRows = buildMatrixRows(wargaList, statusList, transaksiList, billingStart);
  const summary = calculateCashAllocation(transaksiList);

  const headers = Object.keys(matrixRows[0] || { 'Blok / No. Rumah': '' });
  const escapeCsv = (val: unknown) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  };

  const lines: string[] = [
    '"LAPORAN REKAP MATRIKS IPL & KAS LINGKUNGAN PERUMAHAN SAUNG KEBUN"',
    `"Desa Bengle, Kec. Majalaya, Kab. Karawang — Periode ${TAHUN_AKTIF}"`,
    `"Total Kas Terverifikasi",${summary.totalTerverifikasi}`,
    `"Alokasi Kas IPL Reguler",${summary.alokasiIplReguler}`,
    `"Alokasi Dana Darurat (Setoran < Rp 100.000/bln)",${summary.alokasiDanaDarurat}`,
    '',
    headers.map(escapeCsv).join(','),
    ...matrixRows.map((row) => headers.map((h) => escapeCsv(row[h])).join(',')),
  ];

  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `Rekap_IPL_Saung_Kebun_${TAHUN_AKTIF}_${dateStamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
