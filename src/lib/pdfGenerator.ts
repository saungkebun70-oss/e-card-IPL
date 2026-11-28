import { Capacitor } from '@capacitor/core';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import watermarkMossAsset from '../assets/saung-kebun-watermark-moss.png';
import {
  type AppBrandConfig,
  type TransaksiIPL,
  type TransaksiKas,
} from '../types';
import {
  formatBlokRumah,
  formatDaftarBulan,
  formatRupiah,
  formatTanggal,
  formatTanggalSingkat,
  getNamaBulan,
  terbilangRupiah,
} from './format';
import type {
  ChairmanMonthlySummaryReport,
  MonthlyCashReport,
  QuarterlyLpjReport,
} from './financeUtils';

const PAGE_MARGIN = 15; // 15mm presisi A4
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2; // 180mm

export type PdfExportMode = 'download' | 'print';

export interface PdfExportOptions {
  mode?: PdfExportMode;
  captureElement?: HTMLElement | null;
  pembinaNama?: string;
  pembinaSubjudul?: string;
}

export interface PdfExportResult {
  method: 'native_share' | 'web_download';
  fileName: string;
  cancelled?: boolean;
  savedDirectory?: 'cache' | 'documents';
}

export function isNativeCapacitorPlatform(): boolean {
  try {
    return Boolean(
      Capacitor &&
        typeof Capacitor.isNativePlatform === 'function' &&
        Capacitor.isNativePlatform()
    );
  } catch {
    return false;
  }
}

function sanitizePdfFileName(rawName: string): string {
  const cleaned = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function isShareCancelledError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : String(err ?? '');
  return /cancel|dismiss|abort/i.test(msg);
}

/**
 * Menyimpan/membagikan dokumen PDF A4 secara lintas platform:
 * - APK Android/iOS (Capacitor): tulis base64 ke Filesystem (Cache -> fallback Documents),
 *   lalu buka native Share sheet Android agar bisa disimpan, dibuka di PDF Viewer, dicetak (Print), atau dikirim via WA.
 * - Browser Web (Vercel/Chrome/Safari): langsung trigger unduh file `.pdf` seperti biasa.
 */
async function exportPdfDocument(
  doc: jsPDF,
  rawFileName: string,
  meta: {
    title: string;
    text?: string;
    dialogTitle?: string;
    mode?: PdfExportMode;
  }
): Promise<PdfExportResult> {
  const fileName = sanitizePdfFileName(rawFileName);

  if (isNativeCapacitorPlatform()) {
    const dataUri = doc.output('datauristring');
    const commaIdx = dataUri.indexOf(',');
    const base64Data = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;

    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);

    let fileUri = '';
    let savedDirectory: 'cache' | 'documents' = 'cache';

    try {
      const writeRes = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      fileUri =
        writeRes.uri ||
        (await Filesystem.getUri({ path: fileName, directory: Directory.Cache })).uri;
    } catch {
      savedDirectory = 'documents';
      const writeRes = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true,
      });
      fileUri =
        writeRes.uri ||
        (await Filesystem.getUri({ path: fileName, directory: Directory.Documents })).uri;
    }

    try {
      await Share.share({
        title: meta.title,
        text: meta.text || meta.title,
        url: fileUri,
        dialogTitle:
          meta.dialogTitle ||
          (meta.mode === 'print'
            ? 'Cetak atau Bagikan PDF A4'
            : 'Simpan atau Bagikan PDF A4'),
      });
      return {
        method: 'native_share',
        fileName,
        savedDirectory,
      };
    } catch (err) {
      if (isShareCancelledError(err)) {
        return {
          method: 'native_share',
          fileName,
          savedDirectory,
          cancelled: true,
        };
      }
      throw err;
    }
  }

  doc.save(fileName);
  return {
    method: 'web_download',
    fileName,
  };
}

/**
 * Mengonversi fungsi warna modern Tailwind v4 (`oklch(...)` / `oklab(...)`) pada stylesheet kloningan
 * menjadi format RGB/Hex standar agar `html2canvas` tidak pernah melempar error parsing warna.
 */
function normalizeCssColorsForHtml2Canvas(clonedDoc: Document): void {
  try {
    const colorCanvas = clonedDoc.createElement('canvas');
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const ctx = colorCanvas.getContext('2d');
    if (!ctx) return;

    const toSafeColor = (rawColor: string): string => {
      try {
        ctx.fillStyle = '#0f172a';
        ctx.fillStyle = rawColor;
        return ctx.fillStyle;
      } catch {
        return '#0f172a';
      }
    };

    const styleTags = Array.from(clonedDoc.querySelectorAll('style'));
    for (const styleEl of styleTags) {
      const cssText = styleEl.textContent || '';
      if (!/(oklch|oklab|color-mix)\(/i.test(cssText)) continue;
      styleEl.textContent = cssText
        .replace(/oklch\([^)]*\)/gi, (match) => toSafeColor(match))
        .replace(/oklab\([^)]*\)/gi, (match) => toSafeColor(match))
        .replace(/color-mix\([^;{}]*\)/gi, '#e2e8f0');
    }
  } catch {
    // Jika gagal normalisasi, fallback vector jsPDF akan tetap mengambil alih
  }
}

/**
 * Mengonversi elemen DOM dokumen A4 (mis. halaman LPJ `#printable-report`) menjadi PDF A4
 * menggunakan `html2canvas` + `jsPDF` dengan pemotongan halaman rapi anti-terpotong.
 */
async function buildA4PdfFromElement(element: HTMLElement): Promise<jsPDF> {
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: false,
    backgroundColor: '#ffffff',
    logging: false,
    windowWidth: Math.max(element.scrollWidth, 820),
    onclone: (clonedDoc) => {
      normalizeCssColorsForHtml2Canvas(clonedDoc);
      const target = clonedDoc.getElementById(element.id);
      if (target) {
        target.style.backgroundColor = '#ffffff';
        target.style.color = '#0f172a';
        target.style.boxShadow = 'none';
      }
    },
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidthMm = 210;
  const pageHeightMm = 297;
  const marginMm = 10;
  const usableWidthMm = pageWidthMm - marginMm * 2;
  const usableHeightMm = pageHeightMm - marginMm * 2 - 6; // ruang footer nomor halaman

  const imgWidthPx = canvas.width;
  const imgHeightPx = canvas.height;
  const pxPerMm = imgWidthPx / usableWidthMm;
  const sliceHeightPx = Math.floor(usableHeightMm * pxPerMm);

  let offsetY = 0;
  let pageIndex = 0;

  while (offsetY < imgHeightPx) {
    const currentSliceHeight = Math.min(sliceHeightPx, imgHeightPx - offsetY);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = imgWidthPx;
    pageCanvas.height = currentSliceHeight;
    const pageCtx = pageCanvas.getContext('2d');
    if (pageCtx) {
      pageCtx.fillStyle = '#ffffff';
      pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pageCtx.drawImage(
        canvas,
        0,
        offsetY,
        imgWidthPx,
        currentSliceHeight,
        0,
        0,
        imgWidthPx,
        currentSliceHeight
      );
      if (pageIndex > 0) doc.addPage();
      const sliceHeightMm = currentSliceHeight / pxPerMm;
      const imgData = pageCanvas.toDataURL('image/jpeg', 0.94);
      doc.addImage(imgData, 'JPEG', marginMm, marginMm, usableWidthMm, sliceHeightMm, undefined, 'FAST');
    }
    offsetY += currentSliceHeight;
    pageIndex += 1;
  }

  addPageNumbers(doc);
  return doc;
}

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

function rotateImageDataUrl(dataUrl: string, angleDeg: number): Promise<string> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(dataUrl);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 280;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.clearRect(0, 0, size, size);
        ctx.translate(size / 2, size / 2);
        ctx.rotate((angleDeg * Math.PI) / 180);
        const drawSize = size * 0.84;
        ctx.drawImage(img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

function applyStampOpacity(doc: jsPDF, opacity: number) {
  try {
    const docWithGState = doc as unknown as {
      GState?: new (params: { opacity: number; 'stroke-opacity': number }) => unknown;
      setGState?: (gState: unknown) => void;
    };
    if (docWithGState.GState && docWithGState.setGState) {
      docWithGState.setGState(
        new docWithGState.GState({ opacity, 'stroke-opacity': opacity })
      );
    }
  } catch {
    // Fallback aman bila GState tidak didukung
  }
}

function drawVectorFallbackStamp(doc: jsPDF, centerX: number, centerY: number) {
  doc.saveGraphicsState();
  applyStampOpacity(doc, 0.35);

  // Sudut miring -8 derajat (berlawanan arah jarum jam, selaras dengan CSS rotate(-8deg))
  const rad = (-8 * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rot = (lx: number, ly: number): [number, number] => [
    centerX + lx * cos - ly * sin,
    centerY + lx * sin + ly * cos,
  ];

  // Lingkaran luar & dalam stempel resmi (proporsional 24mm)
  doc.setDrawColor(5, 150, 105);
  doc.setLineWidth(0.65);
  doc.circle(centerX, centerY, 11.4, 'S');
  doc.setLineWidth(0.32);
  doc.circle(centerX, centerY, 9.8, 'S');
  doc.setLineWidth(0.22);

  const [l1x1, l1y1] = rot(-9.3, -2.7);
  const [l1x2, l1y2] = rot(9.3, -2.7);
  doc.line(l1x1, l1y1, l1x2, l1y2);

  const [l2x1, l2y1] = rot(-9.3, 2.7);
  const [l2x2, l2y2] = rot(9.3, 2.7);
  doc.line(l2x1, l2y1, l2x2, l2y2);

  doc.setTextColor(5, 150, 105);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.7);
  const [t1x, t1y] = rot(0, -4.4);
  doc.text('PENGURUS LINGKUNGAN', t1x, t1y, { align: 'center', angle: 8 });
  doc.setFontSize(5.8);
  const [t2x, t2y] = rot(0, 0.9);
  doc.text('SAUNG KEBUN', t2x, t2y, { align: 'center', angle: 8 });
  doc.setFontSize(4.5);
  const [t3x, t3y] = rot(0, 5.4);
  doc.text('KARAWANG · SAH', t3x, t3y, { align: 'center', angle: 8 });
  doc.restoreGraphicsState();
}

function drawRoleApprovalStamp(
  doc: jsPDF,
  role: 'ketua' | 'bendahara',
  centerX: number,
  centerY: number
) {
  const isKetua = role === 'ketua';
  const r = isKetua ? 29 : 4;
  const g = isKetua ? 78 : 120;
  const b = isKetua ? 216 : 87;
  const topLabel = 'PENGURUS LINGKUNGAN';
  const mainLabel = isKetua ? 'KETUA' : 'BENDAHARA';
  const bottomLabel = isKetua ? 'SAUNG KEBUN · DISAHKAN' : 'SAUNG KEBUN · TERVERIFIKASI';

  const w = 44;
  const h = 15.5;
  const x = centerX - w / 2;
  const y = centerY - h / 2;

  doc.saveGraphicsState();
  applyStampOpacity(doc, 0.88);
  doc.setDrawColor(r, g, b);
  doc.setTextColor(r, g, b);

  // Bingkai luar & dalam bergaya stempel kantor
  doc.setLineWidth(0.62);
  doc.roundedRect(x, y, w, h, 2, 2, 'S');
  doc.setLineWidth(0.24);
  doc.roundedRect(x + 1.1, y + 1.1, w - 2.2, h - 2.2, 1.3, 1.3, 'S');

  // Garis pemisah horizontal atas & bawah
  doc.setLineWidth(0.2);
  doc.line(x + 2.6, y + 4.7, x + w - 2.6, y + 4.7);
  doc.line(x + 2.6, y + h - 4.5, x + w - 2.6, y + h - 4.5);

  // Teks organisasi atas
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.7);
  doc.text(topLabel, centerX, y + 3.6, { align: 'center' });

  // Jabatan utama stempel
  doc.setFontSize(isKetua ? 9.4 : 8.5);
  doc.text(mainLabel, centerX, y + 9.4, { align: 'center' });

  // Keterangan bawah
  doc.setFontSize(4.4);
  doc.text(bottomLabel, centerX, y + h - 1.9, { align: 'center' });
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
    statusVerifikasi?: string;
    pembinaNama?: string;
    pembinaSubjudul?: string;
  }
) {
  const neededHeight = options.includeMengetahui ? 78 : 42;
  let y = startY;
  if (y + neededHeight > 282) {
    doc.addPage();
    y = PAGE_MARGIN + 4;
  }

  const statusVerif = options.statusVerifikasi || 'Terverifikasi';
  const isFinalVerified = statusVerif === 'Terverifikasi';
  const isAccBendahara = statusVerif === 'ACC Bendahara';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(51, 65, 85);
  doc.text(`Karawang, ${options.tanggalLabel}`, PAGE_WIDTH - PAGE_MARGIN, y, { align: 'right' });
  y += 5.2;

  const signatureTopY = y;
  const leftColX = PAGE_MARGIN + 40;
  const rightColX = PAGE_WIDTH - PAGE_MARGIN - 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.setTextColor(15, 23, 42);
  doc.text('Ketua Lingkungan', leftColX, y, { align: 'center' });
  doc.text('Bendahara Lingkungan', rightColX, y, { align: 'center' });

  // Cap Ketua (Kolom Kiri)
  if (isFinalVerified) {
    drawRoleApprovalStamp(doc, 'ketua', leftColX, y + 12);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.2);
    doc.setTextColor(148, 163, 184);
    doc.text('Menunggu Pengesahan Ketua', leftColX, y + 12.5, { align: 'center' });
  }

  // Cap Bendahara (Kolom Kanan — Simetris dengan Kolom Ketua)
  if (isFinalVerified || isAccBendahara) {
    drawRoleApprovalStamp(doc, 'bendahara', rightColX, y + 12);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.2);
    doc.setTextColor(148, 163, 184);
    doc.text('Menunggu ACC Bendahara', rightColX, y + 12.5, { align: 'center' });
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

  // Stempel Bulat Resmi — Tepat di TENGAH (Di antara kolom Ketua & Bendahara), miring -8deg, opacity 0.35
  const stempelDataUrl = await loadImageAsDataUrl(brand.stempel_url);
  const stampCenterX = PAGE_WIDTH / 2;
  const stampCenterY = signatureTopY + 15.5;
  if (stempelDataUrl) {
    try {
      const rotatedStamp = await rotateImageDataUrl(stempelDataUrl, -8);
      doc.saveGraphicsState();
      applyStampOpacity(doc, 0.35);
      doc.addImage(
        rotatedStamp,
        getImageFormat(rotatedStamp),
        stampCenterX - 12.5,
        stampCenterY - 12.5,
        25,
        25
      );
      doc.restoreGraphicsState();
    } catch {
      drawVectorFallbackStamp(doc, stampCenterX, stampCenterY);
    }
  } else {
    drawVectorFallbackStamp(doc, stampCenterX, stampCenterY);
  }

  if (options.includeMengetahui) {
    const pembinaNama = (options.pembinaNama || 'Bp. Iwan').trim() || 'Bp. Iwan';
    const pembinaSubjudul =
      (options.pembinaSubjudul || 'Blok B8/5 · Perumahan Saung Kebun').trim() ||
      'Blok B8/5 · Perumahan Saung Kebun';

    y += 12.5;
    const centerX = PAGE_WIDTH / 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Mengetahui,', centerX, y, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.4);
    doc.setTextColor(15, 23, 42);
    doc.text('Pembina Lingkungan', centerX, y + 4.2, { align: 'center' });

    y += 22;
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.3);
    doc.line(centerX - 24, y, centerX + 24, y);

    y += 4.2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.8);
    doc.setTextColor(15, 23, 42);
    doc.text(pembinaNama, centerX, y, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text(pembinaSubjudul, centerX, y + 3.6, { align: 'center' });
  }
}

async function applyReportLogoWatermark(doc: jsPDF) {
  const watermarkDataUrl = await loadImageAsDataUrl(watermarkMossAsset);
  if (!watermarkDataUrl) return;
  const totalPages = doc.getNumberOfPages();
  const imgW = 86;
  const imgH = 123.9;
  const x = (PAGE_WIDTH - imgW) / 2;
  const y = (297 - imgH) / 2;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.saveGraphicsState();
    applyStampOpacity(doc, 0.065);
    try {
      doc.addImage(watermarkDataUrl, 'PNG', x, y, imgW, imgH);
    } catch {
      // Abaikan jika gagal menyisipkan gambar watermark
    }
    doc.restoreGraphicsState();
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
export async function downloadKwitansiIplPdf(
  trx: TransaksiIPL,
  brand: AppBrandConfig,
  options?: PdfExportOptions
): Promise<PdfExportResult> {
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
      ['Telah Diterima Dari', `${trx.nama_warga} (Blok / Unit ${formatBlokRumah(trx.blok_rumah) || trx.blok_rumah})`],
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
    statusVerifikasi: trx.status_verifikasi,
  });

  addPageNumbers(doc);
  const safeName = trx.no_kwitansi.replace(/[^a-zA-Z0-9_-]/g, '_');
  const displayBlok = formatBlokRumah(trx.blok_rumah) || trx.blok_rumah;
  const mode = options?.mode || 'download';
  return exportPdfDocument(doc, `Kwitansi_IPL_${safeName}.pdf`, {
    title: `Kwitansi IPL ${displayBlok} (${trx.no_kwitansi})`,
    text: `Kwitansi Resmi IPL ${trx.nama_warga} Blok ${displayBlok} — ${formatRupiah(trx.nominal)}`,
    dialogTitle:
      mode === 'print'
        ? 'Cetak atau Bagikan Kwitansi IPL PDF'
        : 'Simpan atau Bagikan Kwitansi IPL PDF',
    mode,
  });
}

/**
 * Unduh Kwitansi Resmi Bukti Kas Keluar / Kas Masuk (A4 Portrait Presisi + Stempel Digital).
 */
export async function downloadKwitansiKasPdf(
  trxKas: TransaksiKas,
  brand: AppBrandConfig,
  options?: PdfExportOptions
): Promise<PdfExportResult> {
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
    statusVerifikasi: trxKas.status_verifikasi || 'Terverifikasi',
  });

  addPageNumbers(doc);
  const safeName = trxKas.no_bukti.replace(/[^a-zA-Z0-9_-]/g, '_');
  const mode = options?.mode || 'download';
  return exportPdfDocument(doc, `Kwitansi_Kas_${safeName}.pdf`, {
    title: `Kwitansi Kas ${trxKas.no_bukti}`,
    text: `${isPengeluaran ? 'Bukti Kas Keluar' : 'Bukti Kas Masuk'} ${trxKas.kategori} — ${formatRupiah(trxKas.nominal)}`,
    dialogTitle:
      mode === 'print'
        ? 'Cetak atau Bagikan Kwitansi Kas PDF'
        : 'Simpan atau Bagikan Kwitansi Kas PDF',
    mode,
  });
}

/**
 * Unduh Rekapitulasi Keuangan Bulanan (Buku Kas Umum) format A4 Portrait Presisi Anti-Potong.
 */
export async function downloadRekapBulananPdf(
  report: MonthlyCashReport,
  brand: AppBrandConfig,
  options?: PdfExportOptions
): Promise<PdfExportResult> {
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
    styles: { fontSize: 8.4, cellPadding: 2.7, lineColor: [226, 232, 240], lineWidth: 0.25 },
    columnStyles: {
      0: { cellWidth: CONTENT_WIDTH - 52 },
      1: { cellWidth: 52, halign: 'right', fontStyle: 'bold' },
    },
    body: [
      ['Saldo Awal Bulan', formatRupiah(report.saldoAwal)],
      [`(+) Pemasukan IPL Warga Terverifikasi (${report.jumlahTransaksiIpl} transaksi)`, formatRupiah(report.totalIplBulanIni)],
      [`(+) Pemasukan Lain-lain (${report.jumlahPemasukanLain} transaksi)`, formatRupiah(report.totalPemasukanLainBulanIni)],
      [
        { content: '    • Porsi Kas IPL Reguler', styles: { fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        { content: formatRupiah(report.totalIplReguler), styles: { fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right', fontStyle: 'bold' } },
      ],
      [
        { content: `    • Porsi Dana Darurat (${report.jumlahTransaksiDarurat} trx < Rp100rb/bln)`, styles: { fillColor: [243, 232, 255], textColor: [126, 34, 206] } },
        { content: formatRupiah(report.totalDanaDarurat), styles: { fillColor: [243, 232, 255], textColor: [126, 34, 206], halign: 'right', fontStyle: 'bold' } },
      ],
      [`(-) Total Pengeluaran Anggaran (${report.jumlahPengeluaran} transaksi)`, formatRupiah(report.totalKeluarBulanIni)],
      [
        { content: 'SALDO AKHIR BULAN', styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        { content: formatRupiah(report.saldoAkhir), styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right' } },
      ],
      [
        { content: '    • Posisi Kas di Bendahara', styles: { fillColor: [248, 250, 252], textColor: [51, 65, 85] } },
        { content: formatRupiah(report.saldoAkhirBendahara), styles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], halign: 'right', fontStyle: 'bold' } },
      ],
      [
        { content: '    • Dana Titipan Sementara di Pengurus', styles: { fillColor: [255, 251, 235], textColor: [180, 83, 9] } },
        { content: formatRupiah(report.saldoAkhirPengurusTitipan), styles: { fillColor: [255, 251, 235], textColor: [180, 83, 9], halign: 'right', fontStyle: 'bold' } },
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
        ? report.mutasiKronologis.map((row) => {
            const isDarurat = row.fundType === 'DANA_DARURAT' && row.masuk > 0;
            const holderTag = row.holderRole === 'PENGURUS_TITIPAN' ? ' [Titipan Pengurus]' : '';
            return [
              {
                content: formatTanggalSingkat(row.tanggal),
                styles: isDarurat ? { fillColor: [250, 245, 255] } : {},
              },
              {
                content: row.noBukti,
                styles: isDarurat ? { fillColor: [250, 245, 255] } : {},
              },
              {
                content: `${row.uraian}${holderTag}`,
                styles: isDarurat ? { fillColor: [250, 245, 255], textColor: [107, 33, 168] } : {},
              },
              {
                content: row.masuk > 0 ? formatRupiah(row.masuk) : '-',
                styles: isDarurat
                  ? { fillColor: [250, 245, 255], textColor: [126, 34, 206], fontStyle: 'bold', halign: 'right' }
                  : { halign: 'right' },
              },
              {
                content: row.keluar > 0 ? formatRupiah(row.keluar) : '-',
                styles: isDarurat ? { fillColor: [250, 245, 255], halign: 'right' } : { halign: 'right' },
              },
              {
                content: formatRupiah(row.saldoBerjalan),
                styles: isDarurat ? { fillColor: [250, 245, 255], halign: 'right', fontStyle: 'bold' } : { halign: 'right', fontStyle: 'bold' },
              },
            ];
          })
        : [['-', '-', 'Belum ada mutasi kas pada bulan ini.', '-', '-', formatRupiah(report.saldoAkhir)]],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 40) + 7;

  // Daftar Unit Menunggak (Hanya unit berpenghuni & wajib iuran yang melewati tgl 7 bulan berikutnya)
  if (report.daftarUnitMenunggak.length > 0) {
    if (y > 240) {
      doc.addPage();
      y = PAGE_MARGIN + 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `C. Daftar Unit Menunggak (${report.daftarUnitMenunggak.length} Unit Melewati Jatuh Tempo Tgl 7)`,
      PAGE_MARGIN,
      y
    );
    y += 3;

    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      head: [['Blok / Unit', 'Nama Warga', 'Bulan Menunggak', 'Estimasi Tagihan', 'Keterangan']],
      headStyles: { fillColor: [190, 18, 60], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
      styles: { fontSize: 7.4, cellPadding: 2.1, lineColor: [226, 232, 240], lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: 22, fontStyle: 'bold' },
        1: { cellWidth: 44 },
        2: { cellWidth: 34 },
        3: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: [190, 18, 60] },
        4: { cellWidth: 50 },
      },
      body: report.daftarUnitMenunggak.map((u) => [
        u.blokRumah,
        u.namaWarga,
        u.labelBulan,
        formatRupiah(u.estimasiTunggakan),
        u.statusKeterangan || 'Melewati jatuh tempo tgl 7',
      ]),
    });

    y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 30) + 7;
  }

  await drawSignatureBlock(doc, y + 3, brand, {
    tanggalLabel: formatTanggal(new Date().toISOString()),
  });

  await applyReportLogoWatermark(doc);
  addPageNumbers(doc);
  const mode = options?.mode || 'download';
  return exportPdfDocument(
    doc,
    `Rekap_Keuangan_${getNamaBulan(report.bulan)}_${report.tahun}.pdf`,
    {
      title: `Rekapitulasi Keuangan ${report.namaBulan} ${report.tahun} — Saung Kebun`,
      text: `Buku Kas Umum Perumahan Saung Kebun periode ${report.namaBulan} ${report.tahun}`,
      dialogTitle:
        mode === 'print'
          ? 'Cetak atau Bagikan Rekap PDF A4'
          : 'Simpan atau Bagikan Rekap PDF A4',
      mode,
    }
  );
}

/**
 * Unduh LPJ Keuangan Per 3 Bulan (Triwulanan) format A4 Portrait Presisi Anti-Potong
 * lengkap dengan Lembar Pengesahan & Stempel Digital Pengurus.
 */
export async function downloadLpjTriwulanPdf(
  lpj: QuarterlyLpjReport,
  brand: AppBrandConfig,
  options?: PdfExportOptions
): Promise<PdfExportResult> {
  const mode = options?.mode || 'download';
  const fileName = `LPJ_${lpj.labelTriwulan.replace(/\s+/g, '_')}_${lpj.tahun}_Saung_Kebun.pdf`;
  const exportMeta = {
    title: `LPJ Keuangan ${lpj.labelTriwulan} ${lpj.tahun} — Perumahan Saung Kebun`,
    text: `Laporan Pertanggungjawaban (LPJ) ${lpj.labelTriwulan} ${lpj.tahun} (${lpj.rentangBulan}) Perumahan Saung Kebun`,
    dialogTitle:
      mode === 'print'
        ? 'Cetak atau Bagikan LPJ PDF A4'
        : 'Simpan atau Bagikan LPJ PDF',
    mode,
  };

  // Prioritas 1: Render dokumen LPJ A4 menggunakan html2canvas + jsPDF jika elemen tersedia
  if (options?.captureElement && typeof document !== 'undefined') {
    try {
      const capturedDoc = await buildA4PdfFromElement(options.captureElement);
      return await exportPdfDocument(capturedDoc, fileName, exportMeta);
    } catch {
      // Fallback aman ke generator vektor jsPDF + autoTable di bawah agar selalu berhasil 100%
    }
  }

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
    styles: { fontSize: 8.4, cellPadding: 2.7, lineColor: [226, 232, 240], lineWidth: 0.25 },
    columnStyles: {
      0: { cellWidth: CONTENT_WIDTH - 52 },
      1: { cellWidth: 52, halign: 'right', fontStyle: 'bold' },
    },
    body: [
      ['Saldo Awal Periode Triwulan', formatRupiah(lpj.saldoAwal)],
      ['(+) Total Pemasukan IPL Warga Terverifikasi', formatRupiah(lpj.totalIpl)],
      ['(+) Total Pemasukan Lain-lain (Non-Iuran)', formatRupiah(lpj.totalPemasukanLain)],
      [
        { content: '    • Porsi Kas IPL Reguler', styles: { fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        { content: formatRupiah(lpj.totalIplReguler), styles: { fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right', fontStyle: 'bold' } },
      ],
      [
        { content: `    • Porsi Dana Darurat (${lpj.jumlahTransaksiDarurat} trx < Rp100rb/bln)`, styles: { fillColor: [243, 232, 255], textColor: [126, 34, 206] } },
        { content: formatRupiah(lpj.totalDanaDarurat), styles: { fillColor: [243, 232, 255], textColor: [126, 34, 206], halign: 'right', fontStyle: 'bold' } },
      ],
      ['(-) Total Pengeluaran Operasional & Anggaran', formatRupiah(lpj.totalPengeluaran)],
      [
        { content: 'SALDO AKHIR PERIODE TRIWULAN', styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        { content: formatRupiah(lpj.saldoAkhir), styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right' } },
      ],
      [
        { content: '    • Posisi Kas di Bendahara', styles: { fillColor: [248, 250, 252], textColor: [51, 65, 85] } },
        { content: formatRupiah(lpj.saldoAkhirBendahara), styles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], halign: 'right', fontStyle: 'bold' } },
      ],
      [
        { content: '    • Dana Titipan Sementara di Pengurus', styles: { fillColor: [255, 251, 235], textColor: [180, 83, 9] } },
        { content: formatRupiah(lpj.saldoAkhirPengurusTitipan), styles: { fillColor: [255, 251, 235], textColor: [180, 83, 9], halign: 'right', fontStyle: 'bold' } },
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
      0: { cellWidth: 52 },
      1: { cellWidth: 24, halign: 'center' },
      2: { cellWidth: 28, halign: 'center' },
      3: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 46, halign: 'right' },
    },
    body: [
      ...lpj.kepatuhanPerBulan.map((row) => {
        const statusTag = row.isPraRilis
          ? ' (Pra-Rilis)'
          : row.isBulanBerjalan
            ? ' (Potensi Tagihan Berjalan)'
            : row.isBelumPeriode
              ? ' (Belum Periode)'
              : '';
        const lunasText =
          row.unitDarurat && row.unitDarurat > 0
            ? `${row.unitLunas} (+${row.unitDarurat} Darurat)`
            : String(row.unitLunas);
        return [
          `${row.namaBulan} ${lpj.tahun}${statusTag}`,
          String(row.unitAktif),
          lunasText,
          row.isPraRilis || row.isBelumPeriode ? '-' : `${row.persentase}%`,
          formatRupiah(row.nominalTerkumpul),
        ];
      }),
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

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 40) + 7;

  // 4. Daftar Unit Menunggak Triwulan (hanya unit berpenghuni & wajib iuran)
  if (y > 240) {
    doc.addPage();
    y = PAGE_MARGIN + 4;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `4. Daftar Unit Menunggak Triwulan (${lpj.daftarUnitMenunggak.length} Unit)`,
    PAGE_MARGIN,
    y
  );
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    head: [['Blok / Unit', 'Nama Warga', 'Bulan Menunggak', 'Estimasi Tagihan', 'Keterangan']],
    headStyles: { fillColor: [190, 18, 60], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
    styles: { fontSize: 7.4, cellPadding: 2.2, lineColor: [226, 232, 240], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 22, fontStyle: 'bold' },
      1: { cellWidth: 44 },
      2: { cellWidth: 34 },
      3: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: [190, 18, 60] },
      4: { cellWidth: 50 },
    },
    body:
      lpj.daftarUnitMenunggak.length > 0
        ? lpj.daftarUnitMenunggak.map((u) => [
            u.blokRumah,
            u.namaWarga,
            u.labelBulan,
            formatRupiah(u.estimasiTunggakan),
            u.statusKeterangan || 'Melewati jatuh tempo tgl 7',
          ])
        : [['-', '-', 'Tidak ada unit berpenghuni yang menunggak melewati jatuh tempo.', '-', '-']],
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 30;

  // 5. Lembar Pengesahan Resmi + Stempel Digital (Anti-Potong Halaman)
  await drawSignatureBlock(doc, finalY + 12, brand, {
    tanggalLabel: formatTanggal(new Date().toISOString()),
    includeMengetahui: true,
    pembinaNama: options?.pembinaNama,
    pembinaSubjudul: options?.pembinaSubjudul,
  });

  await applyReportLogoWatermark(doc);
  addPageNumbers(doc);
  return exportPdfDocument(doc, fileName, exportMeta);
}

/**
 * Unduh Laporan Ringkasan Eksekutif Bulanan Otomatis (Khusus Ketua Lingkungan):
 * Mengompilasi total transaksi bulanan, kepatuhan IPL, breakdown metode pembayaran,
 * rekap pos anggaran, log rincian pengeluaran (expense logs), dan mutasi kronologis ke PDF A4.
 */
export async function downloadChairmanMonthlySummaryPdf(
  report: ChairmanMonthlySummaryReport,
  brand: AppBrandConfig,
  options?: PdfExportOptions
): Promise<PdfExportResult> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const mc = report.monthlyCash;

  let y = await drawOfficialKop(
    doc,
    brand,
    `LAPORAN RINGKASAN TRANSAKSI & PENGELUARAN — ${report.namaBulan.toUpperCase()} ${report.tahun}`,
    `Dokumen Eksekutif Ketua Lingkungan  ·  No: ${report.documentNumber}  ·  Dicetak: ${formatTanggal(report.generatedAt)}`
  );

  // Kotak Sorotan Eksekutif Otomatis
  const highlightLines: string[] = [];
  for (const item of report.executiveHighlights) {
    const wrapped = doc.splitTextToSize(`• ${item}`, CONTENT_WIDTH - 8) as string[];
    highlightLines.push(...wrapped);
  }
  const boxHeight = Math.max(14, highlightLines.length * 3.8 + 7.5);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(PAGE_MARGIN, y, CONTENT_WIDTH, boxHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.6);
  doc.setTextColor(15, 23, 42);
  doc.text('RINGKASAN OTOMATIS PERIODE', PAGE_MARGIN + 4, y + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.3);
  doc.setTextColor(51, 65, 85);
  doc.text(highlightLines, PAGE_MARGIN + 4, y + 8.4);
  y += boxHeight + 5.5;

  // 1. Total Transaksi & Posisi Kas Bulanan
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Kompilasi Total Transaksi & Posisi Kas Bulanan', PAGE_MARGIN, y);
  y += 3;

  const surplusPositive = report.surplusDefisit >= 0;
  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    rowPageBreak: 'avoid',
    head: [['Komponen Keuangan & Transaksi Bulanan', 'Volume / Keterangan', 'Nominal']],
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.2, fontStyle: 'bold' },
    styles: { fontSize: 8.2, cellPadding: 2.7, lineColor: [226, 232, 240], lineWidth: 0.25 },
    columnStyles: {
      0: { cellWidth: 84 },
      1: { cellWidth: 50, textColor: [71, 85, 105] },
      2: { cellWidth: 46, halign: 'right', fontStyle: 'bold' },
    },
    body: [
      ['Saldo Kas Awal Bulan', `Per awal ${report.namaBulan} ${report.tahun}`, formatRupiah(mc.saldoAwal)],
      [
        '(+) Pemasukan IPL Warga Terverifikasi',
        `${mc.jumlahTransaksiIpl} transaksi sah`,
        formatRupiah(mc.totalIplBulanIni),
      ],
      [
        '(+) Pemasukan Kas Lain-lain',
        `${mc.jumlahPemasukanLain} transaksi sah`,
        formatRupiah(mc.totalPemasukanLainBulanIni),
      ],
      [
        { content: '    • Porsi Kas IPL Reguler', styles: { fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        { content: 'IPL >= Rp100rb/bln & kas reguler', styles: { fillColor: [236, 253, 245], textColor: [4, 120, 87], fontSize: 7.4 } },
        { content: formatRupiah(mc.totalIplReguler), styles: { fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right', fontStyle: 'bold' } },
      ],
      [
        { content: '    • Porsi Dana Darurat', styles: { fillColor: [243, 232, 255], textColor: [126, 34, 206] } },
        { content: `${mc.jumlahTransaksiDarurat} trx setoran < Rp100rb/bln`, styles: { fillColor: [243, 232, 255], textColor: [126, 34, 206], fontSize: 7.4 } },
        { content: formatRupiah(mc.totalDanaDarurat), styles: { fillColor: [243, 232, 255], textColor: [126, 34, 206], halign: 'right', fontStyle: 'bold' } },
      ],
      [
        { content: 'Total Pemasukan Bulan Ini', styles: { fontStyle: 'bold', fillColor: [248, 250, 252] } },
        {
          content: `${mc.jumlahTransaksiIpl + mc.jumlahPemasukanLain} transaksi masuk`,
          styles: { fontStyle: 'bold', fillColor: [248, 250, 252] },
        },
        {
          content: formatRupiah(mc.totalMasukBulanIni),
          styles: { fontStyle: 'bold', fillColor: [248, 250, 252], textColor: [4, 120, 87], halign: 'right' },
        },
      ],
      [
        '(-) Total Pengeluaran Terverifikasi',
        `${mc.jumlahPengeluaran} log pengeluaran sah`,
        formatRupiah(mc.totalKeluarBulanIni),
      ],
      [
        {
          content: surplusPositive ? 'Surplus Arus Kas Bulan Ini' : 'Defisit Arus Kas Bulan Ini',
          styles: { fontStyle: 'bold' },
        },
        {
          content: `Kepatuhan IPL: ${report.compliance.unitLunas}/${report.compliance.unitAktif} unit (${report.compliance.persentaseKepatuhan}%)`,
          styles: { fontSize: 7.5 },
        },
        {
          content: `${surplusPositive ? '+' : '-'}${formatRupiah(Math.abs(report.surplusDefisit))}`,
          styles: {
            fontStyle: 'bold',
            halign: 'right',
            textColor: surplusPositive ? [4, 120, 87] : [185, 28, 28],
          },
        },
      ],
      [
        { content: 'SALDO AKHIR KAS BULANAN', styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87] } },
        {
          content: `${report.totalTransaksiTerverifikasi} total trx terverifikasi`,
          styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87] },
        },
        {
          content: formatRupiah(mc.saldoAkhir),
          styles: { fontStyle: 'bold', fillColor: [236, 253, 245], textColor: [4, 120, 87], halign: 'right' },
        },
      ],
      [
        { content: '    • Kas di Bendahara vs Titipan Pengurus', styles: { fillColor: [248, 250, 252], textColor: [51, 65, 85], fontSize: 7.6 } },
        { content: `Titipan Pengurus: ${formatRupiah(mc.saldoAkhirPengurusTitipan)}`, styles: { fillColor: [255, 251, 235], textColor: [180, 83, 9], fontSize: 7.4 } },
        { content: `Bendahara: ${formatRupiah(mc.saldoAkhirBendahara)}`, styles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], halign: 'right', fontStyle: 'bold', fontSize: 7.6 } },
      ],
    ],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 45) + 6.5;

  // 2. Ringkasan Metode Pembayaran IPL & Antrean Pengesahan
  if (report.metodePembayaranBreakdown.length > 0 || report.pipeline.totalMenungguKetuaCount > 0) {
    if (y > 245) {
      doc.addPage();
      y = PAGE_MARGIN + 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('2. Ringkasan Metode Pembayaran IPL & Status Verifikasi', PAGE_MARGIN, y);
    y += 3;

    const methodRows =
      report.metodePembayaranBreakdown.length > 0
        ? report.metodePembayaranBreakdown.map((m) => [
            m.metode,
            String(m.jumlahTransaksi),
            `${m.persentase}%`,
            formatRupiah(m.totalNominal),
          ])
        : [['Belum ada pembayaran IPL terverifikasi pada bulan ini', '0', '0%', formatRupiah(0)]];

    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      head: [['Metode Pembayaran IPL', 'Jml Trx', 'Porsi (%)', 'Total Nominal']],
      headStyles: { fillColor: [5, 150, 105], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 2.4, lineColor: [226, 232, 240], lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: 94 },
        1: { cellWidth: 18, halign: 'center' },
        2: { cellWidth: 24, halign: 'right' },
        3: { cellWidth: 44, halign: 'right', fontStyle: 'bold' },
      },
      body: methodRows,
    });

    y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 25) + 6.5;
  }

  // 3. Rekapitulasi Pengeluaran per Pos Anggaran
  if (y > 242) {
    doc.addPage();
    y = PAGE_MARGIN + 4;
  }
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
    head: [['Pos Anggaran / Kategori', 'Jml Log', 'Porsi (%)', 'Total Pengeluaran']],
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 2.4, lineColor: [226, 232, 240], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 94 },
      1: { cellWidth: 18, halign: 'center' },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 44, halign: 'right', fontStyle: 'bold' },
    },
    body:
      mc.pengeluaranPerKategori.length > 0
        ? [
            ...mc.pengeluaranPerKategori.map((k) => [
              k.kategori,
              String(k.jumlahTransaksi),
              `${k.persentase}%`,
              formatRupiah(k.totalNominal),
            ]),
            [
              { content: 'TOTAL PENGELUARAN TERVERIFIKASI', styles: { fontStyle: 'bold', fillColor: [254, 242, 242], textColor: [185, 28, 28] } },
              { content: String(mc.jumlahPengeluaran), styles: { halign: 'center', fontStyle: 'bold', fillColor: [254, 242, 242] } },
              { content: '100%', styles: { halign: 'right', fontStyle: 'bold', fillColor: [254, 242, 242] } },
              { content: formatRupiah(mc.totalKeluarBulanIni), styles: { halign: 'right', fontStyle: 'bold', fillColor: [254, 242, 242], textColor: [185, 28, 28] } },
            ],
          ]
        : [['Belum ada pengeluaran terverifikasi pada periode ini.', '0', '0%', formatRupiah(0)]],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 30) + 6.5;

  // 4. Log Rincian Pengeluaran Bulanan (Expense Logs)
  if (y > 235) {
    doc.addPage();
    y = PAGE_MARGIN + 4;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('4. Log Rincian Pengeluaran Bulanan (Expense Log)', PAGE_MARGIN, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    head: [['Tgl', 'No. Bukti', 'Pos Anggaran', 'Penerima & Keterangan', 'Status', 'Nominal']],
    headStyles: { fillColor: [185, 28, 28], textColor: 255, fontSize: 7.4, fontStyle: 'bold' },
    styles: {
      fontSize: 7.3,
      cellPadding: 2.1,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: 19 },
      1: { cellWidth: 25 },
      2: { cellWidth: 29 },
      3: { cellWidth: 55 },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: [185, 28, 28] },
    },
    body:
      report.expenseLogs.length > 0
        ? [
            ...report.expenseLogs.map((exp) => [
              formatTanggalSingkat(exp.tanggal),
              exp.noBukti,
              exp.kategori,
              `${exp.penerima}${exp.termin ? ` [${exp.termin}]` : ''}${exp.keterangan && exp.keterangan !== '-' ? ` — ${exp.keterangan}` : ''}`,
              exp.statusVerifikasi === 'Terverifikasi' ? 'Sah' : exp.statusVerifikasi,
              formatRupiah(exp.nominal),
            ]),
            [
              {
                content: `TOTAL LOG PENGELUARAN (${report.expenseLogs.length} item · Terverifikasi: ${formatRupiah(report.totalExpenseVerified)})`,
                colSpan: 5,
                styles: { fontStyle: 'bold', fillColor: [254, 242, 242], textColor: [153, 27, 27] },
              },
              {
                content: formatRupiah(report.totalExpenseAll),
                styles: { fontStyle: 'bold', fillColor: [254, 242, 242], textColor: [153, 27, 27], halign: 'right' },
              },
            ],
          ]
        : [
            [
              {
                content: 'Tidak ada catatan pengeluaran kas pada periode ini.',
                colSpan: 5,
                styles: { textColor: [100, 116, 139] },
              },
              { content: formatRupiah(0), styles: { halign: 'right', fontStyle: 'bold' } },
            ],
          ],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 35) + 6.5;

  // 5. Mutasi Kas Kronologis Terverifikasi (Buku Kas Umum)
  if (y > 235) {
    doc.addPage();
    y = PAGE_MARGIN + 4;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('5. Mutasi Kas Kronologis Terverifikasi (Buku Kas Umum)', PAGE_MARGIN, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
    theme: 'grid',
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    head: [['Tgl', 'No. Bukti', 'Uraian Transaksi', 'Masuk', 'Keluar', 'Saldo']],
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.4, fontStyle: 'bold' },
    styles: {
      fontSize: 7.3,
      cellPadding: 2.1,
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
      mc.mutasiKronologis.length > 0
        ? mc.mutasiKronologis.map((row) => {
            const isDarurat = row.fundType === 'DANA_DARURAT' && row.masuk > 0;
            const holderTag = row.holderRole === 'PENGURUS_TITIPAN' ? ' [Titipan]' : '';
            return [
              {
                content: formatTanggalSingkat(row.tanggal),
                styles: isDarurat ? { fillColor: [250, 245, 255] } : {},
              },
              {
                content: row.noBukti,
                styles: isDarurat ? { fillColor: [250, 245, 255] } : {},
              },
              {
                content: `${row.uraian}${holderTag}`,
                styles: isDarurat ? { fillColor: [250, 245, 255], textColor: [107, 33, 168] } : {},
              },
              {
                content: row.masuk > 0 ? formatRupiah(row.masuk) : '-',
                styles: isDarurat
                  ? { fillColor: [250, 245, 255], textColor: [126, 34, 206], fontStyle: 'bold', halign: 'right' }
                  : { halign: 'right' },
              },
              {
                content: row.keluar > 0 ? formatRupiah(row.keluar) : '-',
                styles: isDarurat ? { fillColor: [250, 245, 255], halign: 'right' } : { halign: 'right' },
              },
              {
                content: formatRupiah(row.saldoBerjalan),
                styles: isDarurat ? { fillColor: [250, 245, 255], halign: 'right', fontStyle: 'bold' } : { halign: 'right', fontStyle: 'bold' },
              },
            ];
          })
        : [['-', '-', 'Belum ada mutasi kas terverifikasi pada bulan ini.', '-', '-', formatRupiah(mc.saldoAkhir)]],
  });

  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 40) + 6.5;

  if (mc.daftarUnitMenunggak.length > 0) {
    if (y > 240) {
      doc.addPage();
      y = PAGE_MARGIN + 4;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `6. Daftar Unit Menunggak (${mc.daftarUnitMenunggak.length} Unit Melewati Jatuh Tempo Tgl 7)`,
      PAGE_MARGIN,
      y
    );
    y += 3;

    autoTable(doc, {
      startY: y,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      head: [['Blok / Unit', 'Nama Warga', 'Bulan Menunggak', 'Estimasi Tagihan', 'Keterangan']],
      headStyles: { fillColor: [190, 18, 60], textColor: 255, fontSize: 7.4, fontStyle: 'bold' },
      styles: { fontSize: 7.3, cellPadding: 2.1, lineColor: [226, 232, 240], lineWidth: 0.2 },
      columnStyles: {
        0: { cellWidth: 22, fontStyle: 'bold' },
        1: { cellWidth: 44 },
        2: { cellWidth: 34 },
        3: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: [190, 18, 60] },
        4: { cellWidth: 50 },
      },
      body: mc.daftarUnitMenunggak.map((u) => [
        u.blokRumah,
        u.namaWarga,
        u.labelBulan,
        formatRupiah(u.estimasiTunggakan),
        u.statusKeterangan || 'Melewati jatuh tempo tgl 7',
      ]),
    });

    y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || y + 30) + 6.5;
  }

  await drawSignatureBlock(doc, y + 3.5, brand, {
    tanggalLabel: formatTanggal(report.generatedAt),
  });

  await applyReportLogoWatermark(doc);
  addPageNumbers(doc);
  const mode = options?.mode || 'download';
  return exportPdfDocument(
    doc,
    `Laporan_Ringkasan_Ketua_${report.namaBulan}_${report.tahun}_Saung_Kebun.pdf`,
    {
      title: `Laporan Ringkasan Ketua ${report.namaBulan} ${report.tahun} — Saung Kebun`,
      text: `Laporan Eksekutif Bulanan Ketua Lingkungan periode ${report.namaBulan} ${report.tahun}`,
      dialogTitle:
        mode === 'print'
          ? 'Cetak atau Bagikan Laporan Ketua PDF'
          : 'Simpan atau Bagikan Laporan Ketua PDF',
      mode,
    }
  );
}
