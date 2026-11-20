import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  MessageCircle,
  PhoneCall,
  Radio,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import { type LogPatroli, type PetugasKontakDarurat } from '../types';
import { formatTanggalWaktu, normalizePhoneNumber } from '../lib/format';

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
  const validContacts = petugasList.filter((p) => normalizePhoneNumber(p.no_hp).length >= 10);

  return (
    <section
      aria-label="Kontak Darurat Keamanan 24 Jam"
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2 bg-red-50/50">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-red-600 text-white flex items-center justify-center shrink-0">
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
        <div className="divide-y divide-slate-100">
          {validContacts.map((petugas) => {
            const cleanWa = normalizePhoneNumber(petugas.no_hp);
            const intro =
              senderContext?.role === 'warga'
                ? `Halo ${petugas.nama} (Petugas Keamanan Saung Kebun), saya ${senderContext.nama} dari Blok ${senderContext.blokRumah || '-'}. Mohon bantuan/pengecekan keamanan:`
                : `Halo ${petugas.nama}, saya ${senderContext?.nama || 'Pengurus'} (${senderContext?.jabatan || 'Pengurus'} Saung Kebun). Koordinasi keamanan lingkungan:`;
            const waUrl = `https://wa.me/${cleanWa}?text=${encodeURIComponent(intro)}`;

            return (
              <div
                key={petugas.id}
                className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#0F172A] truncate">{petugas.nama}</p>
                  <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                    <span>{petugas.shift}</span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="font-mono tabular-nums text-slate-600">+{cleanWa}</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0">
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[42px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" />
                    <span>Chat WA Darurat</span>
                  </a>
                  <a
                    href={`tel:+${cleanWa}`}
                    className="min-h-[42px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
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
}

/**
 * Widget "Info Keamanan & Patroli Lingkungan" Real-Time untuk Portal Warga & Portal Admin.
 */
export function SecurityPatrolFeedCard({
  patroliFeed,
  maxItems = 8,
}: SecurityPatrolFeedCardProps) {
  const displayed = patroliFeed.slice(0, maxItems);

  return (
    <section
      aria-label="Info Keamanan dan Patroli Lingkungan"
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
    >
      <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0">
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
        <span className="text-[11px] font-mono font-semibold text-emerald-700 shrink-0 tabular-nums">
          {patroliFeed.length} log
        </span>
      </div>

      {displayed.length === 0 ? (
        <div className="px-5 py-6 text-center space-y-1.5">
          <Shield className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-xs font-semibold text-slate-700">Belum Ada Laporan Patroli Tercatat</p>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
            Setiap kali petugas melakukan tap NFC di titik pos/blok perumahan, laporan waktu dan
            kondisi keamanan akan muncul otomatis di sini.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {displayed.map((log) => {
            const isAman = log.status_kondisi === 'Aman';
            return (
              <article
                key={log.id}
                className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-bold text-[#0F172A] inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                      {log.nama_lokasi}
                    </span>
                    <span
                      className={`text-xs font-semibold inline-flex items-center gap-1 ${
                        isAman ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {isAman ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      {log.status_kondisi}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>
                      Petugas: <strong className="text-[#0F172A]">{log.nama_petugas}</strong>
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span className="text-slate-500">{log.metode_scan}</span>
                  </p>

                  {log.catatan && (
                    <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg px-2.5 py-1.5 mt-1">
                      {log.catatan}
                    </p>
                  )}
                </div>

                <div className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0 inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>{formatTanggalWaktu(log.waktu_scan)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
