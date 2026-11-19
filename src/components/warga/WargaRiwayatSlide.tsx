import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Image as ImageIcon,
  FileText,
  Printer,
  X,
  Building2,
} from 'lucide-react';
import { KOP_RESMI, type TransaksiIPL, type Warga } from '../../types';
import { formatDaftarBulan, formatRupiah, formatTanggal, formatTanggalWaktu } from '../../lib/format';

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
      <section className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center">
        <FileText className="w-10 h-10 text-slate-300 mx-auto" />
        <h2 className="text-base font-bold text-[#0F172A] mt-3">Belum Ada Riwayat Setoran</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          Riwayat pembayaran IPL untuk Blok {profil.blok_rumah} dan e-Kwitansi digital Anda akan
          tampil di halaman ini setelah setoran dikirim.
        </p>
        <button
          type="button"
          onClick={onGoToSetor}
          className="mt-5 min-h-[44px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold transition-colors cursor-pointer"
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
          <h2 className="text-base sm:text-lg font-bold text-[#0F172A]">
            Riwayat Transaksi Blok {profil.blok_rumah}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Menampilkan {riwayat.length} transaksi terbaru milik rumah Anda.
          </p>
        </div>
      </div>

      {/* Daftar Riwayat */}
      <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
        {riwayat.map((trx) => {
          const isVerified = trx.status_verifikasi === 'Terverifikasi';
          const isPending = trx.status_verifikasi === 'Pending';

          return (
            <article key={trx.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-bold text-[#0F172A]">
                      Bulan {formatDaftarBulan(trx.bulan_dibayar)} ({trx.tahun})
                    </span>
                    <span aria-hidden="true" className="text-slate-300">·</span>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold ${
                        isVerified
                          ? 'text-emerald-700'
                          : isPending
                            ? 'text-amber-700'
                            : 'text-red-700'
                      }`}
                    >
                      {isVerified ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : isPending ? (
                        <Clock className="w-3.5 h-3.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      {trx.status_verifikasi}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
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
                    <div className="mt-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                      <span className="font-semibold">Alasan Penolakan Admin:</span>{' '}
                      {trx.catatan_admin}
                    </div>
                  )}

                  {trx.status_verifikasi === 'Terverifikasi' && trx.catatan_admin && (
                    <p className="text-xs text-slate-500 pt-0.5">Catatan: {trx.catatan_admin}</p>
                  )}
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                  <p className="text-base sm:text-lg font-mono font-bold text-[#0F172A] tabular-nums">
                    {formatRupiah(trx.nominal)}
                  </p>

                  <div className="flex items-center gap-2">
                    {trx.bukti_url && (
                      <button
                        type="button"
                        onClick={() => setSelectedProof(trx)}
                        className="min-h-[38px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>Bukti Foto</span>
                      </button>
                    )}

                    {isVerified && (
                      <button
                        type="button"
                        onClick={() => setSelectedReceipt(trx)}
                        className="min-h-[38px] px-3 rounded-lg bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
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
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedProof(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-xl w-full overflow-hidden border border-slate-200 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">Bukti Transaksi Setoran</h3>
                <p className="text-xs text-slate-500 font-mono">{selectedProof.no_kwitansi}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProof(null)}
                aria-label="Tutup pratinjau"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center">
              {selectedProof.bukti_url ? (
                <img
                  src={selectedProof.bukti_url}
                  alt={`Bukti pembayaran ${selectedProof.no_kwitansi}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[65vh] w-auto object-contain rounded-lg border border-slate-200 bg-white"
                />
              ) : (
                <p className="text-sm text-slate-500 py-10">Bukti foto tidak tersedia.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal e-Kwitansi Lunas Digital */}
      {selectedReceipt && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => setSelectedReceipt(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-slate-200 shadow-2xl my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="printable-kwitansi" className="p-6 sm:p-7 space-y-5 bg-white">
              {/* Kop Resmi Kwitansi */}
              <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-200">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#059669] flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#0F172A]">e-KWITANSI LUNAS DIGITAL</p>
                    <p className="text-xs text-slate-600 leading-relaxed mt-0.5">{KOP_RESMI}</p>
                  </div>
                </div>
              </div>

              {/* Nomor & Stempel */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-slate-500">Nomor Kwitansi</p>
                  <p className="text-sm font-mono font-bold text-[#0F172A]">
                    {selectedReceipt.no_kwitansi}
                  </p>
                </div>
                <div className="px-3 py-1.5 rounded-lg border-2 border-emerald-600 text-emerald-700 text-xs font-bold tracking-wider">
                  LUNAS TERVERIFIKASI
                </div>
              </div>

              {/* Rincian */}
              <dl className="divide-y divide-slate-100 text-sm border-y border-slate-200">
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Telah Diterima Dari</dt>
                  <dd className="font-semibold text-[#0F172A] text-right">
                    {selectedReceipt.nama_warga} (Blok {selectedReceipt.blok_rumah})
                  </dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Untuk Pembayaran</dt>
                  <dd className="font-semibold text-[#0F172A] text-right">
                    IPL {formatDaftarBulan(selectedReceipt.bulan_dibayar)} {selectedReceipt.tahun}
                  </dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Metode Bayar</dt>
                  <dd className="font-medium text-[#0F172A] text-right">
                    {selectedReceipt.metode_bayar}
                    {selectedReceipt.petugas_penerima
                      ? ` · ${selectedReceipt.petugas_penerima}`
                      : ''}
                  </dd>
                </div>
                <div className="py-2.5 flex justify-between gap-4">
                  <dt className="text-slate-500">Tanggal Verifikasi</dt>
                  <dd className="font-medium text-[#0F172A] text-right">
                    {formatTanggal(selectedReceipt.verified_at || selectedReceipt.tanggal_setor)}
                  </dd>
                </div>
                <div className="py-3 flex justify-between items-center gap-4 bg-emerald-50/70 -mx-2 px-2">
                  <dt className="font-bold text-[#0F172A]">Jumlah Diterima</dt>
                  <dd className="text-lg font-mono font-bold text-emerald-700 tabular-nums">
                    {formatRupiah(selectedReceipt.nominal)}
                  </dd>
                </div>
              </dl>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                Kwitansi digital ini diterbitkan secara sah oleh sistem e-Card Verifikasi &amp; IPL
                Digital Pengurus Lingkungan Perumahan Saung Kebun dan berlaku tanpa tanda tangan
                basah.
              </p>
            </div>

            <div className="no-print px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[42px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak / Simpan PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
