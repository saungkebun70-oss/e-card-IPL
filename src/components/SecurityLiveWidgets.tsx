import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MapPin,
  MessageCircle,
  PhoneCall,
  Radio,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { type LogPatroli, type PetugasKontakDarurat } from '../types';
import { formatTanggalWaktu, normalizePhoneNumber } from '../lib/format';
import { buildAvatarKey, useAvatarMap } from '../lib/avatarService';
import { UserAvatar } from './UserAvatar';

interface EmergencySecurityContactCardProps {
  petugasList: PetugasKontakDarurat[];
  senderContext?: {
    role: 'warga' | 'admin';
    nama: string;
    blokRumah?: string;
    jabatan?: string;
  };
}

/**
 * Widget "Kontak Darurat Keamanan (24 Jam)" untuk Portal Warga & Portal Admin.
 * Hanya menampilkan nama, shift, dan nomor aktif (TANPA PIN / data sensitif).
 */
export function EmergencySecurityContactCard({
  petugasList,
  senderContext,
}: EmergencySecurityContactCardProps) {
  const avatarMap = useAvatarMap();
  const safePetugasList = Array.isArray(petugasList) ? petugasList : [];
  const validContacts = safePetugasList.filter(
    (p) => Boolean(p) && normalizePhoneNumber(p?.no_hp || '').length >= 10
  );

  return (
    <section
      aria-label="Kontak Darurat Keamanan 24 Jam"
      className="glass-card rounded-3xl overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-indigo-100/70 flex items-center justify-between gap-2 bg-red-50/55">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-2xl bg-red-600 text-white flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#0F172A] leading-tight">
              Kontak Darurat Keamanan (24 Jam)
            </h2>
            <p className="text-[11px] text-slate-600 truncate">
              Hubungi langsung petugas keamanan jaga Perumahan Saung Kebun
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono font-semibold text-red-700 shrink-0 tabular-nums">
          {validContacts.length} siaga
        </span>
      </div>

      {validContacts.length === 0 ? (
        <div className="px-5 py-4 text-xs text-slate-500">
          Nomor petugas keamanan belum ditambahkan oleh Pengurus melalui menu Pengaturan (⚙️) →
          Petugas &amp; NFC.
        </div>
      ) : (
        <div className="divide-y divide-indigo-100/60">
          {validContacts.map((petugas, idx) => {
            const cleanWa = normalizePhoneNumber(petugas?.no_hp || '');
            const namaPetugas = petugas?.nama || 'Petugas Keamanan';
            const intro =
              senderContext?.role === 'warga'
                ? `Halo ${namaPetugas} (Petugas Keamanan Saung Kebun), saya ${senderContext?.nama || 'Warga'} dari Blok ${senderContext?.blokRumah || '-'}. Mohon bantuan/pengecekan keamanan:`
                : `Halo ${namaPetugas}, saya ${senderContext?.nama || 'Pengurus'} (${senderContext?.jabatan || 'Pengurus'} Saung Kebun). Koordinasi keamanan lingkungan:`;
            const waUrl = `https://wa.me/${cleanWa}?text=${encodeURIComponent(intro)}`;

            return (
              <div
                key={petugas?.id || `petugas-${idx}`}
                className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar
                    name={namaPetugas}
                    src={
                      petugas?.avatar_url ||
                      avatarMap[buildAvatarKey('petugas', petugas?.id)] ||
                      null
                    }
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F172A] truncate">{namaPetugas}</p>
                    <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span>{petugas?.shift || 'Shift Jaga'}</span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-mono tabular-nums text-slate-600">+{cleanWa}</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] px-4 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" />
                    <span>Chat WA Darurat</span>
                  </a>
                  <a
                    href={`tel:+${cleanWa}`}
                    className="min-h-[42px] px-4 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <PhoneCall className="w-4 h-4 shrink-0" />
                    <span>Telepon</span>
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface SecurityPatrolFeedCardProps {
  patroliFeed: LogPatroli[];
  maxItems?: number;
  initialLimit?: number;
}

function formatCompactLogTime(isoDate?: string | null): string {
  if (!isoDate) return '-';
  try {
    const parsed = new Date(isoDate);
    if (Number.isNaN(parsed.getTime())) {
      return formatTanggalWaktu(isoDate);
    }
    const tanggal = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric',
      month: 'short',
    })
      .format(parsed)
      .replace(/\./g, '');
    const jam = String(parsed.getHours()).padStart(2, '0');
    const menit = String(parsed.getMinutes()).padStart(2, '0');
    return `${tanggal}, ${jam}.${menit}`;
  } catch {
    return formatTanggalWaktu(isoDate);
  }
}

/**
 * Widget "Info Keamanan & Patroli Lingkungan" Real-Time untuk Portal Warga & Portal Admin.
 */
export function SecurityPatrolFeedCard({
  patroliFeed,
  initialLimit = 5,
}: SecurityPatrolFeedCardProps) {
  const avatarMap = useAvatarMap();
  const [expanded, setExpanded] = useState(false);
  const safeFeed = Array.isArray(patroliFeed) ? patroliFeed : [];
  const limit = initialLimit > 0 ? initialLimit : 5;
  const hasMore = safeFeed.length > limit;
  const displayed = expanded ? safeFeed : safeFeed.slice(0, limit);

  return (
    <section
      aria-label="Info Keamanan dan Patroli Lingkungan"
      className="glass-card rounded-3xl overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-indigo-100/70 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-2xl bg-[#3b0764] text-[#A7F3D0] flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#0F172A] leading-tight">
              Info Keamanan &amp; Patroli Lingkungan
            </h2>
            <p className="text-[11px] text-slate-500 truncate">
              Laporan scan titik checkpoint patroli petugas secara real-time
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono font-semibold text-[#4C1D95] shrink-0 tabular-nums">
          {safeFeed.length} log
        </span>
      </div>

      {displayed.length === 0 ? (
        <div className="px-5 py-6 text-center space-y-1.5">
          <Shield className="w-8 h-8 text-indigo-300 mx-auto" />
          <p className="text-xs font-semibold text-slate-700">Belum Ada Laporan Patroli Tercatat</p>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
            Setiap kali petugas melakukan tap NFC di titik pos/blok perumahan, laporan waktu dan
            kondisi keamanan akan muncul otomatis di sini.
          </p>
        </div>
      ) : (
        <>
          <div className="max-h-[360px] overflow-y-auto pr-1 divide-y divide-indigo-100/60">
            {displayed.map((log, idx) => {
              const isAman = (log?.status_kondisi || 'Aman') === 'Aman';
              const rawMethod = (log?.metode_scan || 'NFC').trim();
              const methodLabel = rawMethod === 'NFC Tap' ? 'NFC' : rawMethod;

              return (
                <article
                  key={log?.id || `log-${idx}`}
                  className="px-3.5 sm:px-4 py-2.5 hover:bg-indigo-50/40 transition-colors"
                >
                  {/* Baris 1: Nama Pos + Badge Status di kiri, Jam/Tanggal ringkas di kanan */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-[#4C1D95] shrink-0" />
                      <span className="text-xs sm:text-[13px] font-bold text-[#0F172A] truncate">
                        {log?.nama_lokasi || 'Titik Patroli'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none shrink-0 ${
                          isAman
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                            : 'bg-amber-50 text-amber-700 border border-amber-200/70'
                        }`}
                      >
                        {isAman ? (
                          <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                        )}
                        <span>{log?.status_kondisi || 'Aman'}</span>
                      </span>
                    </div>

                    <span className="text-[11px] font-mono text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                      {formatCompactLogTime(log?.waktu_scan)}
                    </span>
                  </div>

                  {/* Baris 2: Avatar mini + Nama Petugas + keterangan metode */}
                  <div className="flex items-center gap-1.5 mt-0.5 pl-5 min-w-0">
                    <UserAvatar
                      name={log?.nama_petugas || 'Petugas'}
                      src={avatarMap[buildAvatarKey('petugas', log?.petugas_id)] || null}
                      size="xs"
                      className="w-4 h-4 text-[8px]"
                    />
                    <p className="text-xs text-gray-500 truncate">
                      {log?.nama_petugas || 'Petugas'} · {methodLabel}
                    </p>
                  </div>

                  {log?.catatan && (
                    <p className="text-[11px] text-slate-600 bg-indigo-50/50 border border-indigo-100/80 rounded-xl px-2.5 py-1 mt-1.5 ml-5 leading-snug">
                      {log.catatan}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          {hasMore && (
            <div className="border-t border-indigo-100/70 bg-indigo-50/40 px-3.5 py-2 flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold text-[#4C1D95] hover:bg-indigo-100/70 transition-colors cursor-pointer"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                    <span>Tutup / Ringkas</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                    <span>Lihat Semua Log ({safeFeed.length})</span>
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
