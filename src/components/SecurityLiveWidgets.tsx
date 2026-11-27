import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  PhoneCall,
  Radio,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { Icon3D } from './Icon3D';
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
      className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] flex items-center justify-between gap-2 bg-[#C87058]/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-2xl bg-[#C87058] text-[#FFFDF8] flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#1B271B] leading-tight">
              Kontak Darurat Keamanan (24 Jam)
            </h2>
            <p className="text-[11px] text-[#4A554A] truncate">
              Hubungi langsung petugas keamanan jaga Perumahan Saung Kebun
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono font-semibold text-[#7A311E] shrink-0 tabular-nums">
          {validContacts.length} siaga
        </span>
      </div>

      {validContacts.length === 0 ? (
        <div className="px-5 py-4 text-xs text-[#6E786D]">
          Nomor petugas keamanan belum ditambahkan oleh Pengurus melalui menu Pengaturan (⚙️) →
          Petugas &amp; NFC.
        </div>
      ) : (
        <div className="divide-y divide-[#E6E2D6]">
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
                    <p className="text-sm font-bold text-[#1B271B] truncate">{namaPetugas}</p>
                    <p className="text-xs text-[#6E786D] mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span>{petugas?.shift || 'Shift Jaga'}</span>
                      <span aria-hidden="true" className="text-[#C6D2BF]">·</span>
                      <span className="font-mono tabular-nums text-[#4A554A]">+{cleanWa}</span>
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <Icon3D name="kirim_wa" className="w-4 h-4 rounded-sm shrink-0" />
                    <span>Chat WA Darurat</span>
                  </a>
                  <a
                    href={`tel:+${cleanWa}`}
                    className="min-h-[42px] px-4 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
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
  canDelete?: boolean;
  deletingLogId?: string | null;
  deletingAllLogs?: boolean;
  onDeleteLog?: (log: LogPatroli) => void;
  onDeleteAllLogs?: () => void;
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
  canDelete = false,
  deletingLogId = null,
  deletingAllLogs = false,
  onDeleteLog,
  onDeleteAllLogs,
}: SecurityPatrolFeedCardProps) {
  const avatarMap = useAvatarMap();
  const [expanded, setExpanded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const safeFeed = Array.isArray(patroliFeed) ? patroliFeed : [];
  const limit = initialLimit > 0 ? initialLimit : 5;
  const hasMore = safeFeed.length > limit;
  const displayed = expanded ? safeFeed : safeFeed.slice(0, limit);

  return (
    <section
      aria-label="Info Keamanan dan Patroli Lingkungan"
      className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-2xl bg-[#243825] text-[#E5EEE3] flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#1B271B] leading-tight">
              Info Keamanan &amp; Patroli Lingkungan
            </h2>
            <p className="text-[11px] text-[#6E786D] truncate">
              Laporan scan titik checkpoint patroli petugas secara real-time
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono font-semibold text-[#243825] tabular-nums">
            {safeFeed.length} log
          </span>
          {canDelete && onDeleteAllLogs && safeFeed.length > 0 && !confirmClearAll && (
            <button
              type="button"
              disabled={deletingAllLogs}
              onClick={() => {
                setConfirmDeleteId(null);
                setConfirmClearAll(true);
              }}
              className="px-2.5 py-1 rounded-full border border-[#E2A898] bg-[#C87058]/10 hover:bg-[#C87058]/20 text-[#7A311E] text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Icon3D name="hapus" className="w-4 h-4 rounded-sm" />
              <span>Hapus Semua</span>
            </button>
          )}
        </div>
      </div>

      {canDelete && onDeleteAllLogs && confirmClearAll && (
        <div className="px-4 sm:px-5 py-3 bg-[#C87058]/10 border-b border-[#E2A898] flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="font-semibold text-[#7A311E]">
            Hapus seluruh {safeFeed.length} log patroli keamanan ini secara permanen?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={deletingAllLogs}
              onClick={() => setConfirmClearAll(false)}
              className="px-3 py-1 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-[#4A554A] font-semibold hover:bg-[#F7F4EC] cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deletingAllLogs}
              onClick={() => {
                setConfirmClearAll(false);
                onDeleteAllLogs();
              }}
              className="px-3 py-1 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-[#FFFDF8] font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
            >
              {deletingAllLogs ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Icon3D name="hapus" className="w-4 h-4 rounded-sm" />
              )}
              <span>Ya, Hapus Semua</span>
            </button>
          </div>
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="px-5 py-6 text-center space-y-1.5">
          <Shield className="w-8 h-8 text-[#C6D2BF] mx-auto" />
          <p className="text-xs font-semibold text-[#1B271B]">Belum Ada Laporan Patroli Tercatat</p>
          <p className="text-[11px] text-[#6E786D] max-w-sm mx-auto">
            Setiap kali petugas melakukan tap NFC di titik pos/blok perumahan, laporan waktu dan
            kondisi keamanan akan muncul otomatis di sini.
          </p>
        </div>
      ) : (
        <>
          <div className="max-h-[360px] overflow-y-auto pr-1 divide-y divide-[#E6E2D6]">
            {displayed.map((log, idx) => {
              const isAman = (log?.status_kondisi || 'Aman') === 'Aman';
              const rawMethod = (log?.metode_scan || 'NFC').trim();
              const methodLabel = rawMethod === 'NFC Tap' ? 'NFC' : rawMethod;
              const isDeletingThis = deletingLogId === log?.id;
              const isConfirmingThis = confirmDeleteId === log?.id;

              return (
                <article
                  key={log?.id || `log-${idx}`}
                  className="px-3.5 sm:px-4 py-2.5 hover:bg-[#E5EEE3]/35 transition-colors"
                >
                  {/* Baris 1: Nama Pos + Badge Status di kiri, Jam/Tanggal ringkas + tombol hapus di kanan */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-[#2B3F29] shrink-0" />
                      <span className="text-xs sm:text-[13px] font-bold text-[#1B271B] truncate">
                        {log?.nama_lokasi || 'Titik Patroli'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold leading-none shrink-0 border ${
                          isAman
                            ? 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                            : 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]'
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

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[11px] font-mono text-[#6E786D] tabular-nums whitespace-nowrap">
                        {formatCompactLogTime(log?.waktu_scan)}
                      </span>
                      {canDelete && onDeleteLog && log?.id && (
                        isConfirmingThis ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isDeletingThis}
                              onClick={() => {
                                setConfirmDeleteId(null);
                                onDeleteLog(log);
                              }}
                              className="px-2 py-0.5 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-[#FFFDF8] text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                            >
                              {isDeletingThis && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                              <span>Hapus</span>
                            </button>
                            <button
                              type="button"
                              disabled={isDeletingThis}
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] text-[#4A554A] text-[10px] font-semibold hover:bg-[#F7F4EC] cursor-pointer"
                            >
                              Batal
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isDeletingThis || deletingAllLogs}
                            onClick={() => {
                              setConfirmClearAll(false);
                              setConfirmDeleteId(log.id);
                            }}
                            aria-label="Hapus log patroli"
                            title="Hapus log patroli ini"
                            className="p-1 rounded-lg text-[#6E786D] hover:text-[#9A422B] hover:bg-[#C87058]/10 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {isDeletingThis ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C87058]" />
                            ) : (
                              <Icon3D name="hapus" className="w-4 h-4 rounded-sm" />
                            )}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Baris 2: Avatar mini + Nama Petugas + keterangan metode */}
                  <div className="flex items-center gap-1.5 mt-0.5 pl-5 min-w-0">
                    <UserAvatar
                      name={log?.nama_petugas || 'Petugas'}
                      src={avatarMap[buildAvatarKey('petugas', log?.petugas_id)] || null}
                      size="xs"
                      className="w-4 h-4 text-[8px]"
                    />
                    <p className="text-xs text-[#6E786D] truncate">
                      {log?.nama_petugas || 'Petugas'} · {methodLabel}
                    </p>
                  </div>

                  {log?.catatan && (
                    <p className="text-[11px] text-[#4A554A] bg-[#F7F4EC] border border-[#E6E2D6] rounded-xl px-2.5 py-1 mt-1.5 ml-5 leading-snug">
                      {log.catatan}
                    </p>
                  )}
                </article>
              );
            })}
          </div>

          {hasMore && (
            <div className="border-t border-[#E6E2D6] bg-[#F7F4EC]/70 px-3.5 py-2 flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold text-[#243825] hover:bg-[#E5EEE3] transition-colors cursor-pointer"
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
