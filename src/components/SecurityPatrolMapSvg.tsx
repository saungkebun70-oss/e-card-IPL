import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Compass,
  MapPin,
  Radio,
  Settings,
  ShieldAlert,
} from 'lucide-react';
import { type LogPatroli, type TitikPatroli } from '../types';
import { formatTanggalWaktu } from '../lib/format';

export type CheckpointKondisiState = 'aman' | 'perlu_perhatian' | 'belum_dipatroli';

export interface CheckpointStatusItem {
  titik: TitikPatroli;
  latestLog: LogPatroli | null;
  state: CheckpointKondisiState;
  scannedToday: boolean;
}

interface SecurityPatrolMapSvgProps {
  role: 'warga' | 'admin';
  checkpoints: CheckpointStatusItem[];
  onOpenPetugasSettings?: () => void;
}

interface MapCoordinate {
  x: number;
  y: number;
  zoneLabel: string;
}

const FALLBACK_SLOTS: MapCoordinate[] = [
  { x: 380, y: 368, zoneLabel: 'Gerbang Utama' },
  { x: 144, y: 122, zoneLabel: 'Blok A Utara' },
  { x: 380, y: 222, zoneLabel: 'Blok B Tengah' },
  { x: 616, y: 122, zoneLabel: 'Fasum & Lapangan' },
  { x: 144, y: 274, zoneLabel: 'Blok A Selatan' },
  { x: 616, y: 274, zoneLabel: 'Blok B Timur' },
  { x: 380, y: 84, zoneLabel: 'Perbatasan Utara' },
  { x: 262, y: 162, zoneLabel: 'Lorong Blok A–B' },
  { x: 498, y: 162, zoneLabel: 'Lorong Blok B5–B8' },
  { x: 262, y: 296, zoneLabel: 'Sudut Blok B1–B3' },
  { x: 498, y: 296, zoneLabel: 'Sudut Blok B6–B8' },
];

function resolveCheckpointCoordinate(
  titik: TitikPatroli,
  usedKeys: Set<string>
): MapCoordinate {
  const hay = `${titik.nama_lokasi} ${titik.keterangan || ''}`.toLowerCase();

  const trySlot = (coord: MapCoordinate): MapCoordinate | null => {
    const key = `${coord.x},${coord.y}`;
    if (!usedKeys.has(key)) {
      usedKeys.add(key);
      return coord;
    }
    return null;
  };

  if (/(gerbang|pos|masuk|depan|gate|utama)/.test(hay)) {
    const hit = trySlot({ x: 380, y: 368, zoneLabel: 'Gerbang Utama' });
    if (hit) return hit;
  }
  if (/(blok\s*a|bloka|ujung\s*a|barat)/.test(hay)) {
    const hit = trySlot({ x: 144, y: 122, zoneLabel: 'Blok A' });
    if (hit) return hit;
  }
  if (/(fasum|lapangan|taman|mushola|masjid|olahraga)/.test(hay)) {
    const hit = trySlot({ x: 616, y: 122, zoneLabel: 'Fasum & Lapangan' });
    if (hit) return hit;
  }
  if (/(sekretariat|blok\s*b\s*tengah|blokb|b3|b4|b03|b04|tengah)/.test(hay)) {
    const hit = trySlot({ x: 380, y: 222, zoneLabel: 'Blok B Tengah' });
    if (hit) return hit;
  }
  if (/(b5|b6|b7|b8|b05|b06|b07|b08|timur)/.test(hay)) {
    const hit = trySlot({ x: 616, y: 274, zoneLabel: 'Blok B5–B8' });
    if (hit) return hit;
  }
  if (/(utara|belakang|pagar)/.test(hay)) {
    const hit = trySlot({ x: 380, y: 84, zoneLabel: 'Sisi Utara' });
    if (hit) return hit;
  }

  for (const slot of FALLBACK_SLOTS) {
    const hit = trySlot(slot);
    if (hit) return hit;
  }

  // Distribusi spiral bila lebih dari 11 titik
  const idx = usedKeys.size;
  const angle = (idx * 55 * Math.PI) / 180;
  const x = Math.round(380 + Math.cos(angle) * 180);
  const y = Math.round(215 + Math.sin(angle) * 115);
  usedKeys.add(`${x},${y}`);
  return { x, y, zoneLabel: 'Area Perumahan' };
}

function getMarkerPalette(state: CheckpointKondisiState) {
  if (state === 'perlu_perhatian') {
    return {
      fill: '#DC2626',
      halo: '#FCA5A5',
      stroke: '#991B1B',
      labelBg: '#FEF2F2',
      labelBorder: '#FECACA',
      labelText: '#991B1B',
      statusLabel: 'Perlu Perhatian',
    };
  }
  if (state === 'aman') {
    return {
      fill: '#059669',
      halo: '#6EE7B7',
      stroke: '#065F46',
      labelBg: '#ECFDF5',
      labelBorder: '#A7F3D0',
      labelText: '#065F46',
      statusLabel: 'Aman',
    };
  }
  return {
    fill: '#64748B',
    halo: '#CBD5E1',
    stroke: '#334155',
    labelBg: '#F8FAFC',
    labelBorder: '#CBD5E1',
    labelText: '#475569',
    statusLabel: 'Belum Dipatroli',
  };
}

export function SecurityPatrolMapSvg({
  role,
  checkpoints,
  onOpenPetugasSettings,
}: SecurityPatrolMapSvgProps) {
  const plottedPoints = useMemo(() => {
    const usedKeys = new Set<string>();
    return checkpoints.map((item, idx) => ({
      ...item,
      index: idx + 1,
      coord: resolveCheckpointCoordinate(item.titik, usedKeys),
    }));
  }, [checkpoints]);

  const defaultSelectedId = useMemo(() => {
    const attention = plottedPoints.find((p) => p.state === 'perlu_perhatian');
    if (attention) return attention.titik.id;
    const scanned = plottedPoints.find((p) => p.latestLog !== null);
    if (scanned) return scanned.titik.id;
    return plottedPoints[0]?.titik.id || null;
  }, [plottedPoints]);

  const [selectedId, setSelectedId] = useState<string | null>(defaultSelectedId);

  useEffect(() => {
    if (!selectedId || !plottedPoints.some((p) => p.titik.id === selectedId)) {
      setSelectedId(defaultSelectedId);
    }
  }, [selectedId, plottedPoints, defaultSelectedId]);

  const selectedPoint = useMemo(
    () => plottedPoints.find((p) => p.titik.id === selectedId) || plottedPoints[0] || null,
    [plottedPoints, selectedId]
  );

  const routePathD = useMemo(() => {
    if (plottedPoints.length < 2) return '';
    return plottedPoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.coord.x} ${p.coord.y}`)
      .join(' ');
  }, [plottedPoints]);

  const amanCount = checkpoints.filter((c) => c.state === 'aman').length;
  const attentionCount = checkpoints.filter((c) => c.state === 'perlu_perhatian').length;
  const pendingCount = checkpoints.filter((c) => c.state === 'belum_dipatroli').length;

  return (
    <section
      aria-label="Denah Interaktif Blok Perumahan dan Titik Patroli"
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
    >
      {/* Header Denah */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#0F172A] leading-tight">
              Denah Blok &amp; Peta Titik Patroli Saung Kebun
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Ketuk setiap titik checkpoint pada denah untuk melihat kondisi patroli terakhir.
            </p>
          </div>
        </div>

        {/* Legenda Warna Kondisi */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] font-semibold shrink-0">
          <span className="inline-flex items-center gap-1.5 text-emerald-700">
            <span className="w-2.5 h-2.5 rounded-full bg-[#059669]" aria-hidden="true" />
            <span>Aman ({amanCount})</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-red-700">
            <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" aria-hidden="true" />
            <span>Perlu Perhatian ({attentionCount})</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400" aria-hidden="true" />
            <span>Belum Dicek ({pendingCount})</span>
          </span>
        </div>
      </div>

      {/* Kanvas SVG Denah Perumahan */}
      <div className="p-3 sm:p-4 bg-[#F8FAFC]">
        <div className="relative rounded-xl border border-slate-200 bg-white overflow-hidden">
          <svg
            viewBox="0 0 760 430"
            role="img"
            aria-label="Peta denah blok Perumahan Saung Kebun beserta titik checkpoint patroli"
            className="w-full h-auto block select-none"
          >
            <defs>
              <pattern id="skb-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                <path
                  d="M 24 0 L 0 0 0 24"
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="0.6"
                  strokeOpacity="0.65"
                />
              </pattern>
              <filter id="pin-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0F172A" floodOpacity="0.18" />
              </filter>
            </defs>

            {/* Latar Grid Arsitektur & Batas Kawasan Perumahan */}
            <rect x="0" y="0" width="760" height="430" fill="#F8FAFC" />
            <rect x="0" y="0" width="760" height="430" fill="url(#skb-grid)" />

            {/* Pagar Keliling Kompleks Perumahan */}
            <rect
              x="28"
              y="26"
              width="704"
              height="346"
              rx="18"
              fill="#FFFFFF"
              stroke="#CBD5E1"
              strokeWidth="2"
            />

            {/* Jalur Hijau / Pagar Pohon Utara */}
            <rect x="44" y="38" width="672" height="24" rx="6" fill="#ECFDF5" stroke="#A7F3D0" strokeWidth="1" />
            <text
              x="380"
              y="54"
              textAnchor="middle"
              fill="#047857"
              fontSize="10"
              fontWeight="700"
              letterSpacing="1.2"
            >
              AREA BATAS UTARA &amp; JALUR HIJAU PERUMAHAN SAUNG KEBUN
            </text>

            {/* Jaringan Jalan Kompleks (Jalan Utama + Lorong Blok) */}
            {/* Jalan Boulevard Vertikal Tengah */}
            <rect x="352" y="72" width="56" height="304" fill="#E2E8F0" />
            {/* Jalan Horizontal Tengah */}
            <rect x="46" y="184" width="668" height="42" fill="#E2E8F0" />
            {/* Jalan Akses Sisi Bawah / Jl. Raya Desa Bengle */}
            <rect x="0" y="380" width="760" height="50" fill="#CBD5E1" />
            <line
              x1="12"
              y1="405"
              x2="748"
              y2="405"
              stroke="#FFFFFF"
              strokeWidth="2"
              strokeDasharray="10 8"
              strokeOpacity="0.85"
            />
            <text
              x="380"
              y="421"
              textAnchor="middle"
              fill="#334155"
              fontSize="10.5"
              fontWeight="700"
              letterSpacing="0.8"
            >
              JL. RAYA DESA BENGLE · KEC. MAJALAYA, KAB. KARAWANG
            </text>

            {/* Garis Marka Jalan Lingkungan */}
            <line
              x1="380"
              y1="82"
              x2="380"
              y2="372"
              stroke="#FFFFFF"
              strokeWidth="1.5"
              strokeDasharray="6 6"
            />
            <line
              x1="58"
              y1="205"
              x2="702"
              y2="205"
              stroke="#FFFFFF"
              strokeWidth="1.5"
              strokeDasharray="6 6"
            />

            {/* KAWASAN BLOK A (Kiri Atas & Kiri Bawah) */}
            <g>
              <rect
                x="56"
                y="76"
                width="276"
                height="96"
                rx="12"
                fill="#F1F5F9"
                stroke="#CBD5E1"
                strokeWidth="1.5"
              />
              {/* Kavling Blok A1–A4 */}
              <rect x="70" y="92" width="56" height="30" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect x="134" y="92" width="56" height="30" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect x="198" y="92" width="56" height="30" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect x="262" y="92" width="56" height="30" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <text x="194" y="152" textAnchor="middle" fill="#0F172A" fontSize="12" fontWeight="700">
                BLOK A (UJUNG / UTARA)
              </text>
              <text x="194" y="165" textAnchor="middle" fill="#64748B" fontSize="9.5">
                Deretan Hunian Blok A &amp; Pagar Barat
              </text>
            </g>

            {/* KAWASAN BLOK B1–B4 & SEKRETARIAT (Kiri Bawah) */}
            <g>
              <rect
                x="56"
                y="240"
                width="276"
                height="112"
                rx="12"
                fill="#F1F5F9"
                stroke="#CBD5E1"
                strokeWidth="1.5"
              />
              <rect x="70" y="254" width="76" height="34" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect x="154" y="254" width="76" height="34" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect
                x="238"
                y="254"
                width="80"
                height="34"
                rx="5"
                fill="#ECFDF5"
                stroke="#10B981"
                strokeWidth="1.3"
              />
              <text x="278" y="275" textAnchor="middle" fill="#047857" fontSize="9" fontWeight="700">
                Sekretariat B3/7
              </text>
              <text x="194" y="318" textAnchor="middle" fill="#0F172A" fontSize="12" fontWeight="700">
                BLOK B1 – B4
              </text>
              <text x="194" y="332" textAnchor="middle" fill="#64748B" fontSize="9.5">
                Area Blok B Tengah &amp; Sekretariat Pengurus
              </text>
            </g>

            {/* KAWASAN FASUM, TAMAN & LAPANGAN WARGA (Kanan Atas) */}
            <g>
              <rect
                x="428"
                y="76"
                width="276"
                height="96"
                rx="12"
                fill="#ECFDF5"
                stroke="#6EE7B7"
                strokeWidth="1.5"
              />
              <rect
                x="456"
                y="90"
                width="104"
                height="42"
                rx="8"
                fill="#D1FAE5"
                stroke="#34D399"
                strokeDasharray="4 3"
              />
              <text x="508" y="115" textAnchor="middle" fill="#065F46" fontSize="9.5" fontWeight="700">
                Lapangan Warga
              </text>
              <circle cx="654" cy="108" r="14" fill="#A7F3D0" stroke="#34D399" />
              <text x="566" y="152" textAnchor="middle" fill="#065F46" fontSize="12" fontWeight="700">
                FASUM &amp; TAMAN LINGKUNGAN
              </text>
              <text x="566" y="165" textAnchor="middle" fill="#047857" fontSize="9.5">
                Area Terbuka, Taman &amp; Fasilitas Bersama
              </text>
            </g>

            {/* KAWASAN BLOK B5–B8 (Kanan Bawah) */}
            <g>
              <rect
                x="428"
                y="240"
                width="276"
                height="112"
                rx="12"
                fill="#F1F5F9"
                stroke="#CBD5E1"
                strokeWidth="1.5"
              />
              <rect x="442" y="254" width="56" height="34" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect x="506" y="254" width="56" height="34" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect x="570" y="254" width="56" height="34" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <rect x="634" y="254" width="56" height="34" rx="5" fill="#FFFFFF" stroke="#CBD5E1" />
              <text x="566" y="318" textAnchor="middle" fill="#0F172A" fontSize="12" fontWeight="700">
                BLOK B5 – B8
              </text>
              <text x="566" y="332" textAnchor="middle" fill="#64748B" fontSize="9.5">
                Deretan Hunian Blok B5, B6, B7 &amp; B8
              </text>
            </g>

            {/* POS GERBANG UTAMA */}
            <g>
              <rect
                x="326"
                y="348"
                width="108"
                height="30"
                rx="8"
                fill="#0F172A"
                stroke="#334155"
                strokeWidth="1.5"
              />
              <text x="380" y="367" textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="700">
                GERBANG UTAMA
              </text>
            </g>

            {/* Arah Mata Angin (Kompas Mini) */}
            <g transform="translate(698, 50)">
              <circle cx="0" cy="0" r="14" fill="#FFFFFF" stroke="#CBD5E1" strokeWidth="1.2" />
              <path d="M 0 -8 L 4 4 L 0 1 L -4 4 Z" fill="#0F172A" />
              <text x="0" y="-16" textAnchor="middle" fill="#475569" fontSize="8" fontWeight="800">
                U
              </text>
            </g>

            {/* Jalur Rute Patroli Penghubung Antar Titik */}
            {routePathD && (
              <path
                d={routePathD}
                fill="none"
                stroke="#0F172A"
                strokeWidth="2"
                strokeDasharray="6 6"
                strokeOpacity="0.28"
              />
            )}

            {/* Marker Interaktif Setiap Titik Checkpoint */}
            {plottedPoints.map((pt) => {
              const palette = getMarkerPalette(pt.state);
              const isSelected = selectedPoint?.titik.id === pt.titik.id;
              const isAttention = pt.state === 'perlu_perhatian';
              const shortName =
                pt.titik.nama_lokasi.length > 20
                  ? `${pt.titik.nama_lokasi.slice(0, 19)}…`
                  : pt.titik.nama_lokasi;
              const pillWidth = Math.max(94, shortName.length * 6.5 + 18);
              const labelYOffset = pt.coord.y > 320 ? -36 : 24;

              return (
                <g
                  key={pt.titik.id}
                  transform={`translate(${pt.coord.x}, ${pt.coord.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${pt.titik.nama_lokasi} — Status ${palette.statusLabel}`}
                  onClick={() => setSelectedId(pt.titik.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(pt.titik.id);
                    }
                  }}
                  className="cursor-pointer focus:outline-none"
                >
                  {/* Efek Pulse Khusus Titik 'Perlu Perhatian' (Merah) */}
                  {isAttention && (
                    <circle cx="0" cy="0" r="16" fill="#EF4444" fillOpacity="0.35">
                      <animate
                        attributeName="r"
                        from="14"
                        to="30"
                        dur="1.6s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="fill-opacity"
                        from="0.45"
                        to="0"
                        dur="1.6s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  )}

                  {/* Ring Fokus saat Titik Dipilih */}
                  {isSelected && (
                    <circle
                      cx="0"
                      cy="0"
                      r="20"
                      fill="none"
                      stroke="#0F172A"
                      strokeWidth="2.5"
                      strokeDasharray="4 3"
                    />
                  )}

                  {/* Halo & Pin Utama Checkpoint */}
                  <circle cx="0" cy="0" r="15" fill={palette.halo} fillOpacity="0.55" />
                  <circle
                    cx="0"
                    cy="0"
                    r="11"
                    fill={palette.fill}
                    stroke="#FFFFFF"
                    strokeWidth="2.5"
                    filter="url(#pin-shadow)"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="10.5"
                    fontWeight="800"
                  >
                    {pt.index}
                  </text>

                  {/* Label Nama Titik */}
                  <g transform={`translate(${-pillWidth / 2}, ${labelYOffset})`}>
                    <rect
                      x="0"
                      y="0"
                      width={pillWidth}
                      height="21"
                      rx="6"
                      fill={isSelected ? '#0F172A' : palette.labelBg}
                      stroke={isSelected ? '#0F172A' : palette.labelBorder}
                      strokeWidth="1.2"
                    />
                    <text
                      x={pillWidth / 2}
                      y="14"
                      textAnchor="middle"
                      fill={isSelected ? '#FFFFFF' : palette.labelText}
                      fontSize="9.5"
                      fontWeight="700"
                    >
                      {shortName}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/* Overlay Kosong jika belum ada titik */}
          {plottedPoints.length === 0 && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex flex-col items-center justify-center p-6 text-center gap-2">
              <MapPin className="w-7 h-7 text-slate-400" />
              <p className="text-xs font-bold text-[#0F172A]">
                Belum Ada Titik Checkpoint pada Denah
              </p>
              <p className="text-[11px] text-slate-600 max-w-xs">
                Tambahkan titik patroli RFID/NFC agar posisi dan status kondisi setiap blok tampil
                otomatis pada denah.
              </p>
              {role === 'admin' && onOpenPetugasSettings && (
                <button
                  type="button"
                  onClick={onOpenPetugasSettings}
                  className="mt-1 min-h-[38px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>Tambah Titik Checkpoint</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tombol Pilih Cepat Titik + Kartu Detail Titik Terpilih */}
        {plottedPoints.length > 0 && selectedPoint && (
          <div className="mt-3 space-y-3">
            {/* Baris Pilih Cepat Titik (Ramah Jempol di Layar HP) */}
            <div className="flex flex-wrap gap-1.5">
              {plottedPoints.map((pt) => {
                const isSelected = pt.titik.id === selectedPoint.titik.id;
                const dotColor =
                  pt.state === 'perlu_perhatian'
                    ? 'bg-[#DC2626]'
                    : pt.state === 'aman'
                      ? 'bg-[#059669]'
                      : 'bg-slate-400';
                return (
                  <button
                    key={pt.titik.id}
                    type="button"
                    onClick={() => setSelectedId(pt.titik.id)}
                    className={`min-h-[34px] px-2.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#0F172A] border-[#0F172A] text-white'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} aria-hidden="true" />
                    <span className="font-mono text-[10px] opacity-75">#{pt.index}</span>
                    <span>{pt.titik.nama_lokasi}</span>
                  </button>
                );
              })}
            </div>

            {/* Panel Detail Titik Terpilih */}
            <div
              className={`rounded-xl border p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 ${
                selectedPoint.state === 'perlu_perhatian'
                  ? 'bg-red-50/70 border-red-200'
                  : selectedPoint.state === 'aman'
                    ? 'bg-emerald-50/50 border-emerald-200'
                    : 'bg-white border-slate-200'
              }`}
            >
              <div className="min-w-0 space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-xs font-mono font-bold text-slate-500">
                    Titik #{selectedPoint.index}
                  </span>
                  <h3 className="text-sm font-bold text-[#0F172A]">
                    {selectedPoint.titik.nama_lokasi}
                  </h3>
                  <span
                    className={`text-xs font-bold inline-flex items-center gap-1 ${
                      selectedPoint.state === 'perlu_perhatian'
                        ? 'text-red-700'
                        : selectedPoint.state === 'aman'
                          ? 'text-emerald-700'
                          : 'text-slate-600'
                    }`}
                  >
                    {selectedPoint.state === 'perlu_perhatian' ? (
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    ) : selectedPoint.state === 'aman' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>
                      {selectedPoint.state === 'perlu_perhatian'
                        ? 'Perlu Perhatian'
                        : selectedPoint.state === 'aman'
                          ? 'Aman'
                          : 'Belum Dipatroli'}
                    </span>
                  </span>
                </div>

                <p className="text-xs text-slate-600">
                  {selectedPoint.titik.keterangan || `Zona ${selectedPoint.coord.zoneLabel}`}
                  {role === 'admin' && selectedPoint.titik.rfid_uid && (
                    <>
                      {' · '}
                      <span className="font-mono font-semibold text-slate-700">
                        UID: {selectedPoint.titik.rfid_uid}
                      </span>
                    </>
                  )}
                </p>

                {selectedPoint.latestLog ? (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="inline-flex items-center gap-1">
                        <Radio className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                        Petugas:{' '}
                        <strong className="text-[#0F172A]">
                          {selectedPoint.latestLog.nama_petugas}
                        </strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-600">
                        {formatTanggalWaktu(selectedPoint.latestLog.waktu_scan)}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="text-[11px] text-slate-500">
                        {selectedPoint.latestLog.metode_scan}
                      </span>
                    </p>

                    {selectedPoint.latestLog.catatan && (
                      <div
                        className={`rounded-lg px-3 py-2 text-xs leading-relaxed flex items-start gap-2 ${
                          selectedPoint.state === 'perlu_perhatian'
                            ? 'bg-white border border-red-200 text-red-900 font-medium'
                            : 'bg-white border border-slate-200 text-slate-700'
                        }`}
                      >
                        {selectedPoint.state === 'perlu_perhatian' && (
                          <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        )}
                        <span>{selectedPoint.latestLog.catatan}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 pt-0.5">
                    Belum ada laporan scan patroli tercatat pada titik ini.
                  </p>
                )}
              </div>

              <div className="text-left sm:text-right shrink-0">
                <span className="text-[11px] font-semibold text-slate-500 block">
                  Status Hari Ini
                </span>
                <span
                  className={`text-xs font-bold ${
                    selectedPoint.scannedToday ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  {selectedPoint.scannedToday ? 'Sudah Dicek Hari Ini' : 'Belum Dicek Hari Ini'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
