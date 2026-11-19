import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Image as ImageIcon,
  X,
  History,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import {
  isBendaharaFullAccess,
  TAHUN_AKTIF,
  type AuditLogEntry,
  type SessionUser,
  type StatusEcardBulanan,
  type TransaksiIPL,
  type Warga,
} from '../../types';
import {
  formatDaftarBulan,
  formatRupiah,
  formatTanggalWaktu,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import { verifyTransaksiAdmin } from '../../lib/dataService';
import { fetchAuditLogs } from '../../lib/auditLogger';

interface AdminDashboardSlideProps {
  session: SessionUser;
  wargaList: Warga[];
  transaksiList: TransaksiIPL[];
  statusList: StatusEcardBulanan[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminDashboardSlide({
  session,
  wargaList,
  transaksiList,
  statusList,
  onRefresh,
  onToast,
}: AdminDashboardSlideProps) {
  const canManageFull = isBendaharaFullAccess(session);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [previewTrx, setPreviewTrx] = useState<TransaksiIPL | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TransaksiIPL | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [visiblePendingCount, setVisiblePendingCount] = useState(15);
  const [visibleAuditCount, setVisibleAuditCount] = useState(20);

  const currentMonth = getCurrentBillingMonth();
  const currentMonthName = getNamaBulan(currentMonth);

  // Hitung KPI bulan berjalan
  const activeWarga = wargaList.filter((w) => w.aktif && w.status_hunian !== 'Kosong');
  const rumahLunasBulanIni = activeWarga.filter((w) => {
    const st = statusList.find(
      (s) => s.blok_rumah === w.blok_rumah && s.tahun === TAHUN_AKTIF && s.bulan === currentMonth
    );
    return st?.status === 'Lunas';
  }).length;

  const rumahBelumBayarBulanIni = activeWarga.filter((w) => {
    const st = statusList.find(
      (s) => s.blok_rumah === w.blok_rumah && s.tahun === TAHUN_AKTIF && s.bulan === currentMonth
    );
    return !st || (st.status !== 'Lunas' && st.status !== 'Menunggu Verifikasi');
  }).length;

  const pemasukanBulanIni = transaksiList
    .filter(
      (t) =>
        t.status_verifikasi === 'Terverifikasi' &&
        t.tahun === TAHUN_AKTIF &&
        (t.bulan_dibayar.includes(currentMonth) ||
          new Date(t.tanggal_setor).getMonth() + 1 === currentMonth)
    )
    .reduce((sum, t) => sum + t.nominal, 0);

  const pendingList = transaksiList.filter((t) => t.status_verifikasi === 'Pending');

  const handleApprove = async (trx: TransaksiIPL) => {
    setProcessingId(trx.id);
    try {
      const res = await verifyTransaksiAdmin(session, trx, 'Terverifikasi');
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          `Setoran ${trx.blok_rumah} (${formatRupiah(trx.nominal)}) disetujui & e-Card diperbarui menjadi Lunas.`
        );
        await onRefresh();
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      onToast('error', 'Mohon isi alasan penolakan terlebih dahulu.');
      return;
    }
    setProcessingId(rejectTarget.id);
    try {
      const res = await verifyTransaksiAdmin(session, rejectTarget, 'Ditolak', rejectReason.trim());
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast('info', `Setoran ${rejectTarget.blok_rumah} ditolak dengan catatan untuk warga.`);
        setRejectTarget(null);
        setRejectReason('');
        await onRefresh();
      }
    } finally {
      setProcessingId(null);
    }
  };

  const openAuditDrawer = async () => {
    setAuditOpen(true);
    setVisibleAuditCount(20);
    setAuditLoading(true);
    try {
      const logs = await fetchAuditLogs(session);
      setAuditLogs(logs);
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Kontekstual + Aksi Log Aktivitas Server */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Ringkasan Kas Periode{' '}
            <span className="font-bold text-[#0F172A]">
              {currentMonthName} {TAHUN_AKTIF}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openAuditDrawer}
            className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <History className="w-4 h-4 text-slate-500" />
            <span>Log Aktivitas Server</span>
          </button>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Muat Ulang</span>
          </button>
        </div>
      </div>

      {/* 4 KPI Ringkasan Kas Bulan Berjalan */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Pemasukan Terverifikasi</p>
          <p className="text-xl sm:text-2xl font-mono font-bold text-[#059669] tabular-nums mt-2 truncate">
            {formatRupiah(pemasukanBulanIni)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Periode {currentMonthName} {TAHUN_AKTIF}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Rumah Lunas</p>
          <p className="text-xl sm:text-2xl font-mono font-bold text-[#0F172A] tabular-nums mt-2">
            {rumahLunasBulanIni}{' '}
            <span className="text-sm font-normal text-slate-400">/ {activeWarga.length}</span>
          </p>
          <p className="text-[11px] text-emerald-700 mt-1 font-medium">Terverifikasi Lunas</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Belum Bayar</p>
          <p className="text-xl sm:text-2xl font-mono font-bold text-red-700 tabular-nums mt-2">
            {rumahBelumBayarBulanIni}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Unit aktif belum setor</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Antrean Verifikasi</p>
          <p className="text-xl sm:text-2xl font-mono font-bold text-amber-600 tabular-nums mt-2">
            {pendingList.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Menunggu persetujuan</p>
        </div>
      </section>

      {/* Daftar Verifikasi Setoran Masuk (Status Pending) */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Antrean Verifikasi Setoran Masuk</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Periksa bukti foto transfer atau kwitansi tunai sebelum menyetujui pelunasan e-Card.
            </p>
          </div>
          <span className="text-xs font-mono font-semibold text-amber-700 tabular-nums shrink-0">
            {pendingList.length} Pending
          </span>
        </div>

        {pendingList.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h3 className="text-sm font-bold text-[#0F172A] mt-3">Semua Setoran Sudah Diverifikasi</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Tidak ada transaksi berstatus Pending saat ini. Setoran baru dari warga akan langsung
              muncul di daftar ini.
            </p>
          </div>
        ) : (
          <>
          <div className="divide-y divide-slate-100">
            {pendingList.slice(0, visiblePendingCount).map((trx) => {
              const isBusy = processingId === trx.id;
              return (
                <article
                  key={trx.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-4 min-w-0">
                    {/* Thumbnail Bukti Foto */}
                    <button
                      type="button"
                      onClick={() => setPreviewTrx(trx)}
                      className="w-20 h-20 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden shrink-0 hover:border-emerald-600 transition-colors cursor-pointer flex items-center justify-center"
                      title="Perbesar bukti transaksi"
                    >
                      {trx.bukti_url ? (
                        <img
                          src={trx.bukti_url}
                          alt={`Bukti ${trx.blok_rumah}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ImageIcon className="w-6 h-6 text-slate-400" />
                      )}
                    </button>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono text-sm font-bold text-[#0F172A]">
                          {trx.blok_rumah}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="text-sm font-semibold text-[#0F172A]">
                          {trx.nama_warga}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                          <Clock className="w-3.5 h-3.5" />
                          Pending
                        </span>
                      </div>

                      <p className="text-sm font-mono font-bold text-emerald-700 tabular-nums">
                        {formatRupiah(trx.nominal)}{' '}
                        <span className="font-sans text-xs font-medium text-slate-600">
                          untuk {formatDaftarBulan(trx.bulan_dibayar)} ({trx.tahun})
                        </span>
                      </p>

                      <p className="text-xs text-slate-500">
                        {trx.metode_bayar}
                        {trx.petugas_penerima ? ` (Petugas: ${trx.petugas_penerima})` : ''} ·{' '}
                        {formatTanggalWaktu(trx.tanggal_setor)}
                      </p>

                      {trx.keterangan && (
                        <p className="text-xs text-slate-600">Catatan warga: {trx.keterangan}</p>
                      )}
                    </div>
                  </div>

                  {/* Aksi Approve / Reject (Khusus Bendahara) */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {trx.bukti_url && (
                      <button
                        type="button"
                        onClick={() => setPreviewTrx(trx)}
                        className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <ImageIcon className="w-4 h-4" />
                        <span>Perbesar Bukti</span>
                      </button>
                    )}

                    {canManageFull ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setRejectTarget(trx);
                            setRejectReason('');
                          }}
                          className="min-h-[42px] px-3.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>Tolak</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleApprove(trx)}
                          className="min-h-[42px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{isBusy ? 'Memproses...' : 'Setujui (Approve)'}</span>
                        </button>
                      </>
                    ) : (
                      <span className="text-xs font-medium text-slate-500 px-2">
                        Verifikasi khusus Bendahara
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {pendingList.length > visiblePendingCount && (
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 tabular-nums">
                Menampilkan {Math.min(visiblePendingCount, pendingList.length)} dari{' '}
                {pendingList.length} antrean
              </span>
              <button
                type="button"
                onClick={() => setVisiblePendingCount((c) => c + 15)}
                className="min-h-[36px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F172A] cursor-pointer"
              >
                Tampilkan Lebih Banyak
              </button>
            </div>
          )}
          </>
        )}
      </section>

      {/* Modal Preview Foto Bukti */}
      {previewTrx && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewTrx(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-xl w-full overflow-hidden border border-slate-200 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#0F172A]">
                  Bukti Setoran — {previewTrx.blok_rumah} ({previewTrx.nama_warga})
                </h3>
                <p className="text-xs text-slate-500 font-mono">
                  {formatRupiah(previewTrx.nominal)} · {formatDaftarBulan(previewTrx.bulan_dibayar)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTrx(null)}
                aria-label="Tutup"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center">
              {previewTrx.bukti_url ? (
                <img
                  src={previewTrx.bukti_url}
                  alt={`Bukti ${previewTrx.blok_rumah}`}
                  referrerPolicy="no-referrer"
                  className="max-h-[65vh] w-auto object-contain rounded-lg border border-slate-200 bg-white"
                />
              ) : (
                <p className="text-sm text-slate-500 py-8">Foto bukti tidak tersedia.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Alasan Penolakan */}
      {rejectTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setRejectTarget(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h3 className="text-base font-bold text-[#0F172A]">Tolak Setoran Warga</h3>
              </div>
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Anda akan menolak setoran dari{' '}
                <span className="font-bold text-[#0F172A]">
                  {rejectTarget.nama_warga} ({rejectTarget.blok_rumah})
                </span>{' '}
                sebesar{' '}
                <span className="font-mono font-bold text-[#0F172A]">
                  {formatRupiah(rejectTarget.nominal)}
                </span>
                . Alasan penolakan akan terlihat di halaman Riwayat warga.
              </p>

              <div>
                <label
                  htmlFor="reject-reason-input"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Alasan Penolakan (Wajib)
                </label>
                <textarea
                  id="reject-reason-input"
                  rows={3}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Contoh: Foto bukti transfer buram / nominal belum masuk rekening kas."
                  className="w-full rounded-xl border border-slate-300 p-3 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={processingId === rejectTarget.id || !rejectReason.trim()}
                onClick={() => void handleConfirmReject()}
                className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer"
              >
                Konfirmasi Tolak
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Log Aktivitas Perubahan Data di Server */}
      {auditOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setAuditOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-3xl w-full max-h-[82vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">
                  Log Aktivitas Perubahan Data Server
                </h3>
                <p className="text-xs text-slate-500">
                  Jejak audit login, setoran warga, verifikasi, perubahan data, dan pengiriman bot.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAuditOpen(false)}
                aria-label="Tutup log"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {auditLoading ? (
                <div className="p-8 text-center text-sm text-slate-500">Memuat log server...</div>
              ) : auditLogs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  Belum ada catatan aktivitas yang terekam.
                </div>
              ) : (
                <>
                  {auditLogs.slice(0, visibleAuditCount).map((log) => (
                    <div key={log.id} className="px-5 py-3.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-[#0F172A]">{log.action}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="text-slate-600">
                            {log.actor_name} ({log.actor_id})
                          </span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-mono text-slate-500">{log.entity}</span>
                        </div>
                        <span className="text-xs font-mono text-slate-400 tabular-nums">
                          {formatTanggalWaktu(log.timestamp)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 mt-1">{log.summary}</p>
                    </div>
                  ))}
                  {auditLogs.length > visibleAuditCount && (
                    <div className="px-5 py-3 bg-slate-50 flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-500 tabular-nums">
                        Menampilkan {Math.min(visibleAuditCount, auditLogs.length)} dari{' '}
                        {auditLogs.length} log
                      </span>
                      <button
                        type="button"
                        onClick={() => setVisibleAuditCount((c) => c + 25)}
                        className="min-h-[36px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F172A] cursor-pointer"
                      >
                        Muat Lebih Banyak
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
