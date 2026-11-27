import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Image as ImageIcon,
  FileText,
  ShieldCheck,
  X,
} from 'lucide-react';
import { getStatusVerifikasiLabel, type TransaksiIPL, type Warga } from '../../types';
import { formatBlokRumah, formatDaftarBulan, formatRupiah, formatTanggalWaktu } from '../../lib/format';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';

interface WargaRiwayatSlideProps {
  profil: Warga;
  riwayat: TransaksiIPL[];
  onGoToSetor: () => void;
}

export function WargaRiwayatSlide({ profil, riwayat, onGoToSetor }: WargaRiwayatSlideProps) {
  const [selectedProof, setSelectedProof] = useState<TransaksiIPL | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<TransaksiIPL | null>(null);

  if (riwayat.length === 0) {
    return (
      <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl p-5 sm:p-12 text-center">
        <FileText className="w-10 h-10 text-[#C6D2BF] mx-auto" />
        <h2 className="text-base font-serif-brand font-bold text-[#1B271B] mt-3">
          Belum Ada Riwayat Setoran
        </h2>
        <p className="text-sm text-[#6E786D] mt-1 max-w-md mx-auto">
          Riwayat pembayaran IPL untuk Blok {formatBlokRumah(profil.blok_rumah)} dan e-Kwitansi digital Anda akan
          tampil di halaman ini setelah setoran dikirim.
        </p>
        <button
          type="button"
          onClick={onGoToSetor}
          className="mt-5 min-h-[44px] px-6 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-sm font-semibold transition-colors cursor-pointer shadow-sm"
        >
          Buat Setoran Pertama
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-serif-brand font-bold text-[#1B271B]">
            Riwayat Transaksi Blok {formatBlokRumah(profil.blok_rumah)}
          </h2>
          <p className="text-xs sm:text-sm text-[#6E786D]">
            Menampilkan {riwayat.length} transaksi terbaru milik rumah Anda.
          </p>
        </div>
      </div>

      {/* Daftar Riwayat */}
      <div className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl divide-y divide-[#E6E2D6] overflow-hidden">
        {riwayat.map((trx) => {
          const isVerified = trx.status_verifikasi === 'Terverifikasi';
          const isAccBendahara = trx.status_verifikasi === 'ACC Bendahara';
          const isPending = trx.status_verifikasi === 'Pending';

          return (
            <article key={trx.id} className="p-4 sm:p-5 hover:bg-[#F7F4EC]/70 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-bold text-[#1B271B]">
                      Bulan {formatDaftarBulan(trx.bulan_dibayar)} ({trx.tahun})
                    </span>
                    <span aria-hidden="true" className="text-[#C6D2BF]">·</span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        isVerified
                          ? 'text-[#243825]'
                          : isAccBendahara
                            ? 'text-[#384E35]'
                            : isPending
                              ? 'text-[#6E4D12]'
                              : 'text-[#A44831]'
                      }`}
                    >
                      {isVerified ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : isAccBendahara ? (
                        <ShieldCheck className="w-3.5 h-3.5" />
                      ) : isPending ? (
                        <Clock className="w-3.5 h-3.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      {getStatusVerifikasiLabel(trx.status_verifikasi)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#6E786D]">
                    <span className="font-mono">{trx.no_kwitansi}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatTanggalWaktu(trx.tanggal_setor)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {trx.metode_bayar}
                      {trx.petugas_penerima ? ` (Petugas: ${trx.petugas_penerima})` : ''}
                    </span>
                  </div>

                  {trx.status_verifikasi === 'Ditolak' && trx.catatan_admin && (
                    <div className="mt-2 rounded-2xl bg-[#C87058]/10 border border-[#E2A898] px-3 py-2 text-xs text-[#7A311E]">
                      <span className="font-semibold">Alasan Penolakan Admin:</span>{' '}
                      {trx.catatan_admin}
                    </div>
                  )}

                  {trx.status_verifikasi === 'Terverifikasi' && trx.catatan_admin && (
                    <p className="text-xs text-[#6E786D] pt-0.5">Catatan: {trx.catatan_admin}</p>
                  )}
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                  <p className="text-base sm:text-lg font-mono font-bold text-[#1B271B] tabular-nums">
                    {formatRupiah(trx.nominal)}
                  </p>

                  <div className="flex items-center gap-2">
                    {trx.bukti_url && (
                      <button
                        type="button"
                        onClick={() => setSelectedProof(trx)}
                        className="min-h-[38px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-[#2B3F29]" />
                        <span>Bukti Foto</span>
                      </button>
                    )}

                    {isVerified && (
                      <button
                        type="button"
                        onClick={() => setSelectedReceipt(trx)}
                        className="min-h-[38px] px-3.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>e-Kwitansi</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Modal Lihat Bukti Foto */}
      {selectedProof && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => setSelectedProof(null)}
        >
          <div
            className="bg-[#FFFDF8] rounded-t-3xl sm:rounded-3xl max-w-xl w-full overflow-hidden border border-[#E6E2D6] shadow-2xl animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC] flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#1B271B]">Bukti Transaksi Setoran</h3>
                <p className="text-xs text-[#6E786D] font-mono">{selectedProof.no_kwitansi}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProof(null)}
                aria-label="Tutup pratinjau"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-[#F7F4EC]/50 flex items-center justify-center">
              {selectedProof.bukti_url ? (
                <img
                  src={selectedProof.bukti_url}
                  alt={`Bukti pembayaran ${selectedProof.no_kwitansi}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[65vh] w-auto object-contain rounded-2xl border border-[#E6E2D6] bg-white"
                />
              ) : (
                <p className="text-sm text-[#6E786D] py-10">Bukti foto tidak tersedia.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal e-Kwitansi Lunas Digital + Stempel Pengurus + PDF A4 */}
      {selectedReceipt && (
        <KwitansiDigitalModal
          mode="ipl"
          trx={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
        />
      )}
    </div>
  );
}

