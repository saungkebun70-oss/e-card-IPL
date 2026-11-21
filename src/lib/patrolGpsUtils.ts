import type {
  CalibratedCheckpointPoint,
  LogPatroli,
  PatrolGpsCalibration,
  PatrolMapConfig,
  TitikPatroli,
} from '../types';

/**
 * Koordinat persentase default (X%, Y%) untuk 5 Pos Patroli pada Peta 3D Perumahan Saung Kebun.
 * Selaras 1:1 dengan PatrolInteractiveMap agar semua overlay (Pos + Petugas Live) selalu presisi.
 */
export const DEFAULT_MAP_PIN_COORDS: Array<{ x_percent: number; y_percent: number }> = [
  { x_percent: 12.5, y_percent: 76.0 }, // Pos 1: Gerbang Utama
  { x_percent: 64.0, y_percent: 76.0 }, // Pos 2: Blok A / B
  { x_percent: 62.5, y_percent: 45.5 }, // Pos 3: Tengah / Blok B
  { x_percent: 62.0, y_percent: 29.0 }, // Pos 4: Fasum / Taman
  { x_percent: 84.0, y_percent: 29.0 }, // Pos 5: Pagar Belakang
];

export function clampMapPercent(value: number, min = 3, max = 97): number {
  if (!Number.isFinite(value)) return min;
  return Number(Math.max(min, Math.min(max, value)).toFixed(2));
}

/**
 * Mengambil koordinat (x%, y%) sebuah TitikPatroli dari konfigurasi tersimpan, kolom titik, atau default.
 */
export function getTitikMapPercent(
  titik: TitikPatroli,
  index: number,
  patrolMapConfig?: PatrolMapConfig | null
): { x: number; y: number } {
  const fromConfig = patrolMapConfig?.pin_positions?.[titik.id];
  if (
    fromConfig &&
    typeof fromConfig.x_percent === 'number' &&
    typeof fromConfig.y_percent === 'number'
  ) {
    return {
      x: clampMapPercent(fromConfig.x_percent, 1, 99),
      y: clampMapPercent(fromConfig.y_percent, 1, 99),
    };
  }

  if (typeof titik.x_percent === 'number' && typeof titik.y_percent === 'number') {
    return {
      x: clampMapPercent(titik.x_percent, 1, 99),
      y: clampMapPercent(titik.y_percent, 1, 99),
    };
  }

  const fb = DEFAULT_MAP_PIN_COORDS[index % DEFAULT_MAP_PIN_COORDS.length];
  return { x: fb.x_percent, y: fb.y_percent };
}

/**
 * Menggabungkan daftar titik patroli aktif + koordinat peta 3D + kalibrasi GPS asli.
 */
export function buildCalibratedCheckpoints(
  titikList: TitikPatroli[],
  calibrations: Record<string, PatrolGpsCalibration> | PatrolGpsCalibration[],
  patrolMapConfig?: PatrolMapConfig | null
): CalibratedCheckpointPoint[] {
  const calMap: Record<string, PatrolGpsCalibration> = Array.isArray(calibrations)
    ? calibrations.reduce<Record<string, PatrolGpsCalibration>>((acc, item) => {
        acc[item.pos_id] = item;
        return acc;
      }, {})
    : calibrations || {};

  const activeTitik = titikList.filter((t) => t.aktif);
  const result: CalibratedCheckpointPoint[] = [];

  activeTitik.forEach((titik, idx) => {
    const cal = calMap[titik.id];
    if (
      cal &&
      typeof cal.lat === 'number' &&
      typeof cal.lng === 'number' &&
      Number.isFinite(cal.lat) &&
      Number.isFinite(cal.lng)
    ) {
      const pos = getTitikMapPercent(titik, idx, patrolMapConfig);
      result.push({
        pos_id: titik.id,
        name: titik.nama_lokasi,
        x: pos.x,
        y: pos.y,
        lat: cal.lat,
        lng: cal.lng,
      });
    }
  });

  return result;
}

/**
 * Menemukan posisi (x%, y%) dari Pos yang terakhir kali di-scan NFC/RFID.
 * Digunakan sebagai posisi fallback otomatis apabila titik kalibrasi GPS < 2.
 */
export function getLatestScannedPosPercent(
  titikList: TitikPatroli[],
  logPatroli: LogPatroli[],
  patrolMapConfig?: PatrolMapConfig | null,
  cycleResetAt?: string | null
): { x: number; y: number; posId?: string; lokasi?: string; waktuScan?: string } | null {
  const activeTitik = titikList.filter((t) => t.aktif);
  if (activeTitik.length === 0) return null;

  const resetMs = cycleResetAt ? new Date(cycleResetAt).getTime() : 0;
  const sortedLogs = [...logPatroli]
    .filter((log) => {
      if (!resetMs || Number.isNaN(resetMs)) return true;
      const t = new Date(log.waktu_scan).getTime();
      return !Number.isNaN(t) && t >= resetMs;
    })
    .sort((a, b) => new Date(b.waktu_scan).getTime() - new Date(a.waktu_scan).getTime());

  for (const log of sortedLogs) {
    const idx = activeTitik.findIndex(
      (t) =>
        (log.titik_id && t.id === log.titik_id) ||
        t.nama_lokasi.trim().toLowerCase() === log.nama_lokasi.trim().toLowerCase()
    );
    if (idx >= 0) {
      const titik = activeTitik[idx];
      const pos = getTitikMapPercent(titik, idx, patrolMapConfig);
      return {
        x: pos.x,
        y: pos.y,
        posId: titik.id,
        lokasi: titik.nama_lokasi,
        waktuScan: log.waktu_scan,
      };
    }
  }

  return null;
}

/**
 * Menyelesaikan sistem linear 3x3 (A * sol = b) dengan eliminasi Gauss + partial pivoting.
 * Mengembalikan null bila matriks singular (titik-titik kolinear / segaris).
 */
function solveLinear3x3(A: number[][], b: number[]): [number, number, number] | null {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];

  for (let col = 0; col < 3; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < 3; row++) {
      const val = Math.abs(M[row][col]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = row;
      }
    }

    if (maxVal < 1e-10) {
      return null;
    }

    if (pivotRow !== col) {
      const temp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = temp;
    }

    const pivot = M[col][col];
    for (let j = col; j < 4; j++) {
      M[col][j] /= pivot;
    }

    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j < 4; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return [M[0][3], M[1][3], M[2][3]];
}

export interface GpsToMapResult {
  x: number;
  y: number;
  mode: 'affine' | 'linear' | 'fallback';
}

/**
 * Fungsi utilitas murni untuk mengonversi koordinat GPS (lat, lng) ke koordinat persen (x%, y%)
 * pada gambar Peta 3D Perumahan Saung Kebun tanpa library peta eksternal.
 *
 * - >= 3 titik terkalibrasi (non-kolinear): transformasi afine 2D (least-squares 3x3) agar
 *   rotasi, perspektif isometrik, dan skala peta 3D tetap presisi.
 * - 2 titik terkalibrasi (atau titik kolinear): interpolasi linear dari min/max lat & lng
 *   ke x% & y% (dengan proyeksi vektor aman bila kedua pos hampir sejajar horizontal/vertikal).
 * - < 2 titik terkalibrasi: fallback ke posisi Pos terakhir yang di-scan NFC (atau Pos 1).
 * - Hasil akhir selalu di-clamp pada rentang [3, 97] agar marker tidak keluar dari bingkai peta.
 */
export function convertGpsToMapPercent(
  lat: number,
  lng: number,
  checkpointsWithGps: CalibratedCheckpointPoint[],
  fallbackPercent?: { x: number; y: number } | null
): GpsToMapResult {
  const validPoints = (checkpointsWithGps || []).filter(
    (cp) =>
      Number.isFinite(cp.lat) &&
      Number.isFinite(cp.lng) &&
      Number.isFinite(cp.x) &&
      Number.isFinite(cp.y)
  );

  // Validasi input GPS live
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || validPoints.length < 2) {
    if (fallbackPercent && Number.isFinite(fallbackPercent.x) && Number.isFinite(fallbackPercent.y)) {
      return {
        x: clampMapPercent(fallbackPercent.x, 3, 97),
        y: clampMapPercent(fallbackPercent.y, 3, 97),
        mode: 'fallback',
      };
    }
    if (validPoints.length === 1) {
      return {
        x: clampMapPercent(validPoints[0].x, 3, 97),
        y: clampMapPercent(validPoints[0].y, 3, 97),
        mode: 'fallback',
      };
    }
    return {
      x: DEFAULT_MAP_PIN_COORDS[0].x_percent,
      y: DEFAULT_MAP_PIN_COORDS[0].y_percent,
      mode: 'fallback',
    };
  }

  // 1) Transformasi Afine 2D Least-Squares bila >= 3 titik GPS terkalibrasi
  if (validPoints.length >= 3) {
    const n = validPoints.length;
    const meanLng = validPoints.reduce((s, p) => s + p.lng, 0) / n;
    const meanLat = validPoints.reduce((s, p) => s + p.lat, 0) / n;

    let maxDLng = 0;
    let maxDLat = 0;
    for (const p of validPoints) {
      maxDLng = Math.max(maxDLng, Math.abs(p.lng - meanLng));
      maxDLat = Math.max(maxDLat, Math.abs(p.lat - meanLat));
    }

    if (maxDLng > 1e-7 && maxDLat > 1e-7) {
      // Normal equations: (A^T A) c = A^T b dengan koordinat terpusat & ternormalisasi
      const ata: number[][] = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ];
      const atx: number[] = [0, 0, 0];
      const aty: number[] = [0, 0, 0];

      for (const p of validPoints) {
        const u = (p.lng - meanLng) / maxDLng;
        const v = (p.lat - meanLat) / maxDLat;
        const row = [1, u, v];

        for (let i = 0; i < 3; i++) {
          atx[i] += row[i] * p.x;
          aty[i] += row[i] * p.y;
          for (let j = 0; j < 3; j++) {
            ata[i][j] += row[i] * row[j];
          }
        }
      }

      const cx = solveLinear3x3(ata, atx);
      const cy = solveLinear3x3(ata, aty);

      if (cx && cy) {
        const u = (lng - meanLng) / maxDLng;
        const v = (lat - meanLat) / maxDLat;
        const mappedX = cx[0] + cx[1] * u + cx[2] * v;
        const mappedY = cy[0] + cy[1] * u + cy[2] * v;

        if (Number.isFinite(mappedX) && Number.isFinite(mappedY)) {
          return {
            x: clampMapPercent(mappedX, 3, 97),
            y: clampMapPercent(mappedY, 3, 97),
            mode: 'affine',
          };
        }
      }
    }
  }

  // 2) Interpolasi Linear 2 Titik (pilih 2 titik terjauh di ruang GPS bila > 2 titik kolinear)
  let p1 = validPoints[0];
  let p2 = validPoints[1];
  let bestDistSq = -1;
  for (let i = 0; i < validPoints.length; i++) {
    for (let j = i + 1; j < validPoints.length; j++) {
      const dlng = validPoints[j].lng - validPoints[i].lng;
      const dlat = validPoints[j].lat - validPoints[i].lat;
      const dSq = dlng * dlng + dlat * dlat;
      if (dSq > bestDistSq) {
        bestDistSq = dSq;
        p1 = validPoints[i];
        p2 = validPoints[j];
      }
    }
  }

  if (bestDistSq < 1e-14) {
    // Kedua titik kalibrasi punya koordinat GPS identik -> pakai fallback
    return {
      x: clampMapPercent(fallbackPercent?.x ?? p1.x, 3, 97),
      y: clampMapPercent(fallbackPercent?.y ?? p1.y, 3, 97),
      mode: 'fallback',
    };
  }

  const dLng = p2.lng - p1.lng;
  const dLat = p2.lat - p1.lat;
  const span = Math.hypot(dLng, dLat);

  // Bila kedua sumbu lat & lng punya rentang memadai, interpolasi linear per sumbu
  if (Math.abs(dLng) >= span * 0.18 && Math.abs(dLat) >= span * 0.18) {
    const tx = (lng - p1.lng) / dLng;
    const ty = (lat - p1.lat) / dLat;
    const mappedX = p1.x + tx * (p2.x - p1.x);
    const mappedY = p1.y + ty * (p2.y - p1.y);
    return {
      x: clampMapPercent(mappedX, 3, 97),
      y: clampMapPercent(mappedY, 3, 97),
      mode: 'linear',
    };
  }

  // Bila kedua titik hampir sejajar horizontal/vertikal, gunakan proyeksi vektor agar stabil
  const t = ((lng - p1.lng) * dLng + (lat - p1.lat) * dLat) / bestDistSq;
  const mappedX = p1.x + t * (p2.x - p1.x);
  const mappedY = p1.y + t * (p2.y - p1.y);

  return {
    x: clampMapPercent(mappedX, 3, 97),
    y: clampMapPercent(mappedY, 3, 97),
    mode: 'linear',
  };
}

/**
 * Format selisih waktu ke Bahasa Indonesia ringkas untuk badge Live Tracking.
 */
export function formatElapsedIndonesian(
  isoTimestamp: string | null | undefined,
  nowMs = Date.now()
): string {
  if (!isoTimestamp) return 'baru saja';
  const ts = new Date(isoTimestamp).getTime();
  if (Number.isNaN(ts)) return 'baru saja';

  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 3) return 'baru saja';
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

/**
 * Panduan ramah Bahasa Indonesia saat akses GPS perangkat ditolak atau tidak tersedia.
 */
export function describeGeolocationError(err: unknown): string {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return 'Browser atau perangkat ini belum mendukung sensor GPS. Buka aplikasi melalui Google Chrome di HP Android/iPhone dengan koneksi HTTPS.';
  }

  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? Number((err as { code?: number }).code)
      : 0;

  if (code === 1) {
    return 'Izin akses lokasi GPS ditolak. Buka Pengaturan Browser / Ikon Gembok di bilah alamat → Izinkan Lokasi (Allow Location), lalu aktifkan GPS di HP Anda.';
  }
  if (code === 2) {
    return 'Sinyal GPS tidak terdeteksi. Pastikan fitur Lokasi (GPS) HP dalam keadaan aktif dan coba bergerak ke area yang lebih terbuka.';
  }
  if (code === 3) {
    return 'Waktu tunggu sinyal GPS habis. Coba ulangi beberapa detik lagi di area terbuka agar akurasi GPS lebih cepat terkunci.';
  }
  if (err instanceof Error && err.message) {
    return `Gagal membaca posisi GPS: ${err.message}`;
  }
  return 'Gagal membaca sinyal GPS perangkat. Pastikan izin lokasi browser dan GPS HP sudah aktif.';
}
