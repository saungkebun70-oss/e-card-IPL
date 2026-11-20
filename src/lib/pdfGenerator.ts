import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  type AppBrandConfig,
  type TransaksiIPL,
  type TransaksiKas,
} from '../types';
import {
  formatDaftarBulan,
  formatRupiah,
  formatTanggal,
  formatTanggalSingkat,
  getNamaBulan,
  terbilangRupiah,
} from './format';
import type { MonthlyCashReport, QuarterlyLpjReport } from './financeUtils';

const PAGE_MARGIN = 15; // 15mm presisi A4
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2; // 180mm

async function loadImageAsDataUrl(src?: string | null): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith('data:image/')) return src;
  try {
    const res = await fetch(src, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function getImageFormat(dataUrl: string): 'PNG' | 'JPEG' {
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  return 'JPEG';
}

function drawVectorFallbackStamp(doc: jsPDF, centerX: number, centerY: number) {
  doc.saveGraphicsState();
  // Lingkaran luar & dalam stempel biru-emerald resmi (proporsional 23mm)
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(0.65);
  doc.circle(centerX, centerY, 11.2, 'S');
  doc.setLineWidth(0.32);
  doc.circle(centerX, centerY, 9.7, 'S');
  doc.setLineWidth(0.22);
  doc.line(centerX - 9.2, centerY - 2.7, centerX + 9.2, centerY - 2.7);
  doc.line(centerX - 9.2, centerY + 2.7, centerX + 9.2, centerY + 2.7);

  doc.setTextColor(5, 150, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.8);
  doc.text('PENGURUS LINGKUNGAN', centerX, centerY - 4.4, { align: 'center' });
  doc.setFontSize(5.8);
  doc.text('SAUNG KEBUN', centerX, centerY + 0.9, { align: 'center' });
  doc.setFontSize(4.5);
  doc.text('KARAWANG · SAH', centerX, centerY + 5.4, { align: 'center' });
  doc.restoreGraphicsState();
}

function getCompactKopAlamat(kopResmi?: string): string {
  const raw = (kopResmi || '').trim();
  if (!raw) {
    return 'Desa Bengle, Kec. Majalaya, Kab. Karawang — Sekretariat: Blok B3/7';
  }
  const stripped = raw
    .replace(/^pengurus\s+lingkungan\s+perumahan\s+saung\s+kebun\s*[—–\-:|·]*\s*/i, '')
    .trim();
  return stripped || raw;
}

async function drawOfficialKop(
  doc: jsPDF,
  brand: AppBrandConfig,
  title: string,
  subtitle: string
): Promise<number> {
  let y = PAGE_MARGIN;
  const logoDataUrl = await loadImageAsDataUrl(brand.logo_url);

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, getImageFormat(logoDataUrl), PAGE_MARGIN, y, 14, 14);
    } catch {
      // Abaikan jika gambar tidak didukung
    }
  }

  const textX = logoDataUrl ? PAGE_MARGIN + 18 : PAGE_MARGIN;
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text('PENGURUS LINGKUNGAN PERUMAHAN SAUNG KEBUN', textX, y + 4.8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const kopLines = doc.splitTextToSize(
    getCompactKopAlamat(brand.kop_resmi),
    logoDataUrl ? CONTENT_WIDTH - 20 : CONTENT_WIDTH
  );
  doc.text(kopLines, textX, y + 9.2);

  y += Math.max(16, kopLines.length * 3.8 + 9.5);

  // Garis ganda Kop Resmi
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.75);
  doc.line(PAGE_MARGIN, y, PAGE_WIDTH - PAGE_MARGIN, y);
  doc.setLineWidth(0.25);
  doc.line(PAGE_MARGIN, y + 1.2, PAGE_WIDTH - PAGE_MARGIN, y + 1.2);
  y += 6.2;

  // Judul Dokumen
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(title.length > 52 ? 10.2 : 11);
  doc.text(title.toUpperCase(), PAGE_WIDTH / 2, y, { align: 'center' });
  y += 4.6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.4);
  doc.setTextColor(71, 85, 105);
  doc.text(subtitle, PAGE_WIDTH / 2, y, { align: 'center' });
  y += 5.5;

  return y;
}

async function drawSignatureBlock(
  doc: jsPDF,
  startY: number,
  brand: AppBrandConfig,
  options: {
    tanggalLabel: string;
    includeMengetahui?: boolean;
  }
) {
  const neededHeight = options.includeMengetahui ? 66 : 42;
  let y = startY;
  if (y + neededHeight > 282) {
    doc.addPage();
    y = PAGE_MARGIN + 4;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(51, 65, 85);
  doc.text(`Karawang, ${options.tanggalLabel}`, PAGE_WIDTH - PAGE_MARGIN, y, { align: 'right' });
  y += 5.2;

  const leftColX = PAGE_MARGIN + 40;
  const rightColX = PAGE_WIDTH - PAGE_MARGIN - 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.setTextColor(15, 23, 42);
  doc.text('Ketua Lingkungan', leftColX, y, { align: 'center' });
  doc.text('Bendahara Lingkungan', rightColX, y, { align: 'center' });

  // Stempel Digital Pengurus rapi di ruang tanda tangan (di atas garis TTD, tidak menutupi nama)
  const stempelDataUrl = await loadImageAsDataUrl(brand.stempel_url);
  const stampCenterX = rightColX - 15;
  const stampCenterY = y + 12.5;
  if (stempelDataUrl) {
    try {
      doc.addImage(
        stempelDataUrl,
        getImageFormat(stempelDataUrl),
        stampCenterX - 11.5,
        stampCenterY - 11.5,
        23,
        23
      );
    } catch {
      drawVectorFallbackStamp(doc, stampCenterX, stampCenterY);
    }
  } else {
    drawVectorFallbackStamp(doc, stampCenterX, stampCenterY);
  }

  y += 24;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.line(leftColX - 24, y, leftColX + 24, y);
  doc.line(rightColX - 24, y, rightColX + 24, y);

  y += 4.2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(15, 23, 42);
  doc.text('Erlangga', leftColX, y, { align: 'center' });
  doc.text('Andriansyah', rightColX, y, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(100, 116, 139);
  doc.text('Blok B3/7 · Perumahan Saung Kebun', leftColX, y + 3.6, { align: 'center' });
  doc.text('Blok B7/16 · Perumahan Saung Kebun', rightColX, y + 3.6, { align: 'center' });

  if (options.includeMengetahui) {
    y += 11.5;
    const centerX = PAGE_WIDTH / 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('Mengetahui,', centerX, y, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Ketua RT / RW / Kepala Desa Bengle', centerX, y + 4, { align: 'center' });

    y += 19;
    doc.setDrawColor(148, 163, 184);
    doc.line(centerX - 30, y, centerX + 30, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text('( ....................................................... )', centerX, y + 4.2, {
      align: 'center',
    });
  }
}

function addPageNumbers(doc: jsPDF) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `e-Card IPL Digital — Perumahan Saung Kebun  |  Halaman ${i} dari ${totalPages}`,
      PAGE_WIDTH / 2,
      290,
      { align: 'center' }
    );
  }
}

/**
 * Unduh Kwitansi Resmi Pembayaran IPL Warga (A4 Portrait Presisi + Stempel Digital).
 */
export async function downloadKwitansiIplPdf(trx: TransaksiIPL, brand: AppBrandConfig) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = await drawOfficialKop(
    doc,
    brand,
    'KWITANSI PEMBAYARAN IURAN PEMELIHARAAN LINGKUNGAN (IPL)',
    `Nomor Kwitansi: ${trx.no_kwitansi}`
  );

  // Badge status LUNAS
  doc.setFillColor(236, 253, 245);
  doc.setDrawColor(16, 185, 129);
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, 11, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(4, 120, 87);
  doc.text(
    trx.status_verifikasi === 'Terverifikasi'
      ? 'STATUS: TERVERIFIKASI LUNAS — SAH SEBAGAI BUKTI PEMBAYARAN RESMI'
      : `STATUS: ${trx.status_verifikasi.toUpperCase()}`,
    PAGE_WIDTH / 2,
    y + 6.8,
    { align: 'center' }
  );
  y += 16;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3.5,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    columnStyles: {
      0: { cellWidth: 54, fontStyle: 'bold', fillColor: [248, 250, 252] },
      1: { cellWidth: CONTENT_WIDTH - 54 },
    },
    body: [
      ['Telah Diterima Dari', `${trx.nama_warga} (Blok / Unit ${trx.blok_rumah})`],
      ['Nomor Kwitansi', trx.no_kwitansi],
      ['Tanggal Pembayaran', formatTanggal(trx.tanggal_setor)],
      ['Periode Tagihan IPL', `${formatDaftarBulan(trx.bulan_dibayar)} ${trx.tahun}`],
      [
        'Metode Pembayaran',
        trx.petugas_penerima ? `${trx.metode_bayar} — ${trx.petugas_penerima}` : trx.metode_bayar,
      ],
      ['Uang Sejumlah', formatRupiah(trx.nominal)],
      ['Terbilang', `# ${terbilangRupiah(trx.nominal)} #`],
      ['Keterangan', trx.keterangan || 'Pembayaran Iuran Pemeliharaan Lingkungan (IPL) rutin'],
    ],
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 70;
  await drawSignatureBlock(doc, finalY + 12, brand, {
    tanggalLabel: formatTanggal(trx.verified_at || trx.tanggal_setor),
  });

  addPageNumbers(doc);
  const safeName = trx.no_kwitansi.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Kwitansi_IPL_${safeName}.pdf`);
}

/**
 * Unduh Kwitansi Resmi Bukti Kas Keluar / Kas Masuk (A4 Portrait Presisi + Stempel Digital).
 */
export async function downloadKwitansiKasPdf(trxKas: TransaksiKas, brand: AppBrandConfig) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const isPengeluaran = trxKas.jenis === 'pengeluaran';

  let y = await drawOfficialKop(
    doc,
    brand,
    isPengeluaran
      ? 'KWITANSI BUKTI PENGELUARAN KAS LINGKUNGAN'
      : 'KWITANSI BUKTI PEMASUKAN KAS LAIN-LAIN',
    `Nomor Bukti: ${trxKas.no_bukti}`
  );

  doc.setFillColor(isPengeluaran ? 254 : 236, isPengeluaran ? 242 : 253, isPengeluaran ? 242 : 245);
  doc.setDrawColor(isPengeluaran ? 220 : 16, isPengeluaran ? 38 : 185, isPengeluaran ? 38 : 129);
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, 11, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(isPengeluaran ? 185 : 4, isPengeluaran ? 28 : 120, isPengeluaran ? 28 : 87);
  doc.text(
    isPengeluaran
      ? `KAS KELUAR — POS ANGGARAN: ${trxKas.kategori.toUpperCase()}`
      : `KAS MASUK — SUMBER: ${trxKas.kategori.toUpperCase()}`,
    PAGE_WIDTH / 2,
    y + 6.8,
    { align: 'center' }
  );
  y += 16;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 3.5,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.25,
    },
    columnStyles: {
      0: { cellWidth: 54, fontStyle: 'bold', fillColor: [248, 250, 252] },
      1: { cellWidth: CONTENT_WIDTH - 54 },
    },
    body: [
      ['Nomor Bukti', trxKas.no_bukti],
      ['Tanggal Transaksi', formatTanggal(trxKas.tanggal)],
      [isPengeluaran ? 'Dibayarkan Kepada' : 'Diterima Dari', trxKas.penerima_atau_sumber],
      ['Kategori / Pos', trxKas.kategori],
      ...(trxKas.termin ? [['Termin / Periode', trxKas.termin]] : []),
      ['Nominal Transaksi', formatRupiah(trxKas.nominal)],
      ['Terbilang', `# ${terbilangRupiah(trxKas.nominal)} #`],
      ['Uraian / Keterangan', trxKas.keterangan || '-'],
      ['Dicatat Oleh', trxKas.created_by_name],
    ],
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 75;
  await drawSignatureBlock(doc, finalY + 12, brand, {
    tanggalLabel: formatTanggal(trxKas.tanggal),
  });

  addPageNumbers(doc);
  const safeName = trxKas.no_bukti.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Kwitansi_Kas_${safeName}.pdf`);
}

/**
 * Unduh Rekapitulasi Keuangan Bulanan (Buku Kas Umum) format A4 Portrait Presisi Anti-Potong.
 */
export async function downloadRekapBulananPdf(
  report: MonthlyCashReport,
  brand: AppBrandConfig
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = await drawOfficialKop(
    doc,
    brand,
    `REKAPITULASI KEUANGAN BULANAN — ${report.namaBulan.toUpperCase()} ${report.tahun}`,
    'Buku Kas Umum (Pemasukan IPL, Pemasukan Lain & Pengeluaran Anggaran)'
  );

  // Ringkasan Arus Kas
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    head: [['RINGKASAN POSISI KAS BULANAN', 'NOMINAL']],
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    styles: { fontSize: 8.5, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.25 },
    columnStyles: {
      0: { cellWidth: CONTENT_WIDTH - 52 },
      1: { cellWidth: 52, halign: 'right', fontStyle: 'bold' },
    },
    body: [
      ['Saldo Awal Bulan', formatRupiah(report.saldoAwal)],
      [`(+) Pemasukan IPL Warga Terverifikasi (${report.jumlahTransaksiIpl} transaksi)`, formatRupiah(report.totalIplBulanIni)],
      [`(+) Pemasukan Lain-lain (${report.jumlahPemasukanLain} transaksi)`, formatRupiah(report.totalPemasukanLainBulanIni)],
      [`(-) Total Pengeluaran Anggaran (${report.jumlahPengeluaran} transaksi)`, formatRupiah(report.totalKeluarBulanIni)],
      [
        { content: 'SALDO AKHIR BULAN', styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        { content: formatRupiah(report.saldoAkhir), styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right' } },
      ],
    ],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 40) + 7;

  // Rincian Pengeluaran per Kategori (jika ada)
  if (report.pengeluaranPerKategori.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('A. Rekapitulasi Pengeluaran per Pos Anggaran', PAGE_MARGIN, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      head: [['Pos Anggaran / Kategori', 'Trx', 'Porsi', 'Total Nominal']],
      headStyles: { fillColor: [5, 150, 105], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: [226, 232, 240], lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: 96 },
        1: { cellWidth: 16, halign: 'center' },
        2: { cellWidth: 22, halign: 'right' },
        3: { cellWidth: 46, halign: 'right', fontStyle: 'bold' },
      },
      body: report.pengeluaranPerKategori.map((k) => [
        k.kategori,
        String(k.jumlahTransaksi),
        `${k.persentase}%`,
        formatRupiah(k.totalNominal),
      ]),
    });

    y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 30) + 7;
  }

  // Tabel Buku Kas Umum Kronologis
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('B. Mutasi Kas Kronologis (Buku Kas Umum)', PAGE_MARGIN, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    head: [['Tgl', 'No. Bukti', 'Uraian Transaksi', 'Masuk', 'Keluar', 'Saldo']],
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
    styles: {
      fontSize: 7.5,
      cellPadding: 2.2,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 27 },
      2: { cellWidth: 55 },
      3: { cellWidth: 25, halign: 'right', textColor: [4, 120, 87] },
      4: { cellWidth: 25, halign: 'right', textColor: [185, 28, 28] },
      5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
    },
    body:
      report.mutasiKronologis.length > 0
        ? report.mutasiKronologis.map((row) => [
            formatTanggalSingkat(row.tanggal),
            row.noBukti,
            row.uraian,
            row.masuk > 0 ? formatRupiah(row.masuk) : '-',
            row.keluar > 0 ? formatRupiah(row.keluar) : '-',
            formatRupiah(row.saldoBerjalan),
          ])
        : [['-', '-', 'Belum ada mutasi kas pada bulan ini.', '-', '-', formatRupiah(report.saldoAkhir)]],
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 40;
  await drawSignatureBlock(doc, finalY + 10, brand, {
    tanggalLabel: formatTanggal(new Date().toISOString()),
  });

  addPageNumbers(doc);
  doc.save(`Rekap_Keuangan_${getNamaBulan(report.bulan)}_${report.tahun}.pdf`);
}

/**
 * Unduh LPJ Keuangan Per 3 Bulan (Triwulanan) format A4 Portrait Presisi Anti-Potong
 * lengkap dengan Lembar Pengesahan & Stempel Digital Pengurus.
 */
export async function downloadLpjTriwulanPdf(
  lpj: QuarterlyLpjReport,
  brand: AppBrandConfig
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  let y = await drawOfficialKop(
    doc,
    brand,
    `LAPORAN PERTANGGUNGJAWABAN (LPJ) KEUANGAN ${lpj.labelTriwulan.toUpperCase()}`,
    `Periode: ${lpj.rentangBulan} ${lpj.tahun}  ·  Perumahan Saung Kebun`
  );

  // 1. Ikhtisar Arus Kas 3 Bulan
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Ikhtisar Arus Kas Triwulan', PAGE_MARGIN, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    rowPageBreak: 'avoid',
    head: [['Uraian Arus Kas', 'Nominal']],
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    styles: { fontSize: 8.5, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.25 },
    columnStyles: {
      0: { cellWidth: CONTENT_WIDTH - 52 },
      1: { cellWidth: 52, halign: 'right', fontStyle: 'bold' },
    },
    body: [
      ['Saldo Awal Periode Triwulan', formatRupiah(lpj.saldoAwal)],
      ['(+) Total Pemasukan IPL Warga Terverifikasi', formatRupiah(lpj.totalIpl)],
      ['(+) Total Pemasukan Lain-lain (Non-Iuran)', formatRupiah(lpj.totalPemasukanLain)],
      ['(-) Total Pengeluaran Operasional & Anggaran', formatRupiah(lpj.totalPengeluaran)],
      [
        { content: 'SALDO AKHIR PERIODE TRIWULAN', styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        { content: formatRupiah(lpj.saldoAkhir), styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right' } },
      ],
    ],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 40) + 7;

  // 2. Tingkat Kepatuhan Pembayaran Warga
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Tingkat Kepatuhan Pembayaran IPL Warga', PAGE_MARGIN, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    head: [['Bulan', 'Unit Aktif', 'Unit Lunas', 'Kepatuhan (%)', 'Estimasi IPL Terkumpul']],
    headStyles: { fillColor: [5, 150, 105], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.6, lineColor: [226, 232, 240], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 44 },
      1: { cellWidth: 26, halign: 'center' },
      2: { cellWidth: 26, halign: 'center' },
      3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 52, halign: 'right' },
    },
    body: [
      ...lpj.kepatuhanPerBulan.map((row) => [
        `${row.namaBulan} ${lpj.tahun}`,
        String(row.unitAktif),
        String(row.unitLunas),
        `${row.persentase}%`,
        formatRupiah(row.nominalTerkumpul),
      ]),
      [
        { content: 'Rata-rata Kepatuhan Triwulan', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } },
        { content: String(lpj.totalUnitAktif), styles: { halign: 'center', fontStyle: 'bold', fillColor: [248, 250, 252] } },
        { content: '-', styles: { halign: 'center', fillColor: [248, 250, 252] } },
        { content: `${lpj.rataRataKepatuhan}%`, styles: { halign: 'right', fontStyle: 'bold', fillColor: [248, 250, 252], textColor: [4, 120, 87] } },
        { content: formatRupiah(lpj.totalIpl), styles: { halign: 'right', fontStyle: 'bold', fillColor: [248, 250, 252] } },
      ],
    ],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 35) + 7;

  // 3. Rekapitulasi Pengeluaran per Pos Anggaran
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Rekapitulasi Pengeluaran per Pos Anggaran', PAGE_MARGIN, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    head: [['Pos Anggaran / Kategori', 'Jml Trx', 'Porsi (%)', 'Total Pengeluaran']],
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.6, lineColor: [226, 232, 240], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 94 },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 44, halign: 'right', fontStyle: 'bold' },
    },
    body:
      lpj.pengeluaranPerKategori.length > 0
        ? [
            ...lpj.pengeluaranPerKategori.map((k) => [
              k.kategori,
              String(k.jumlahTransaksi),
              `${k.persentase}%`,
              formatRupiah(k.totalNominal),
            ]),
            [
              { content: 'TOTAL PENGELUARAN TRIWULAN', styles: { fontStyle: 'bold', fillColor: [254, 242, 242], textColor: [185, 28, 28] } },
              { content: String(lpj.pengeluaranPerKategori.reduce((s, i) => s + i.jumlahTransaksi, 0)), styles: { halign: 'center', fontStyle: 'bold', fillColor: [254, 242, 242] } },
              { content: '100%', styles: { halign: 'right', fontStyle: 'bold', fillColor: [254, 242, 242] } },
              { content: formatRupiah(lpj.totalPengeluaran), styles: { halign: 'right', fontStyle: 'bold', fillColor: [254, 242, 242], textColor: [185, 28, 28] } },
            ],
          ]
        : [['Belum ada pencatatan pengeluaran anggaran pada triwulan ini.', '0', '0%', formatRupiah(0)]],
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 40;

  // 4. Lembar Pengesahan Resmi + Stempel Digital (Anti-Potong Halaman)
  await drawSignatureBlock(doc, finalY + 12, brand, {
    tanggalLabel: formatTanggal(new Date().toISOString()),
    includeMengetahui: true,
  });

  addPageNumbers(doc);
  doc.save(`LPJ_${lpj.labelTriwulan.replace(/\s+/g, '_')}_${lpj.tahun}_Saung_Kebun.pdf`);
}
