import { type FormEvent, useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Image as ImageIcon,
  X,
  RefreshCw,
  AlertTriangle,
  Megaphone,
  Send,
  Loader2,
  Trash2,
  Users,
  Search,
  Wallet,
  ReceiptText,
} from 'lucide-react';
import {
  BULK_NOTIFICATION_TEMPLATES,
  isBendaharaFullAccess,
  TAHUN_AKTIF,
  type LogPatroli,
  type NotificationCategory,
  type NotificationTargetScope,
  type PetugasKeamanan,
  type SessionUser,
  type StatusEcardBulanan,
  type SystemNotification,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../../types';
import {
  canonicalizeBlokKey,
  formatDaftarBulan,
  formatRupiah,
  formatTanggalWaktu,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import {
  deleteSystemNotificationAdmin,
  sendBulkSystemNotificationAdmin,
  verifyTransaksiAdmin,
} from '../../lib/dataService';
import { calculateGlobalCashSummary } from '../../lib/financeUtils';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';
import {
  EmergencySecurityContactCard,
  SecurityPatrolFeedCard,
} from '../SecurityLiveWidgets';

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'Perawatan & Fasilitas',
  'Pengumuman Umum',
  'Keamanan',
  'Keuangan & IPL',
];

type TrxFilterTab = 'Pending' | 'Semua' | 'Terverifikasi' | 'Ditolak';

interface AdminDashboardSlideProps {
  session: SessionUser;
  wargaList: Warga[];
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  statusList: StatusEcardBulanan[];
  notifications: SystemNotification[];
  petugasList?: PetugasKeamanan[];
  patroliFeed?: LogPatroli[];
  isRefreshing?: boolean;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminDashboardSlide({
  session,
  wargaList,
  transaksiList,
  transaksiKasList,
  statusList,
  notifications,
  petugasList = [],
  patroliFeed = [],
  isRefreshing = false,
  onRefresh,
  onToast,
}: AdminDashboardSlideProps) {
  const canManageFull = isBendaharaFullAccess(session);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [previewTrx, setPreviewTrx] = useState<TransaksiIPL | null>(null);
  const [receiptTrx, setReceiptTrx] = useState<TransaksiIPL | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TransaksiIPL | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [trxFilter, setTrxFilter] = useState<TrxFilterTab>('Pending');
  const [trxSearch, setTrxSearch] = useState('');
  const [visiblePendingCount, setVisiblePendingCount] = useState(15);

  // State Modal Kirim Notifikasi Massal Sistem
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [notifCategory, setNotifCategory] = useState<NotificationCategory>('Perawatan & Fasilitas');
  const [notifScope, setNotifScope] = useState<NotificationTargetScope>('all_active');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [sendingBroadcast, setSendingBroadcast] = useState(false);
  const [deletingNotifId, setDeletingNotifId] = useState<string | null>(null);

  const currentMonth = getCurrentBillingMonth();
  const currentMonthName = getNamaBulan(currentMonth);

  // Saldo Kas Real-Time (IPL Terverifikasi + Pemasukan Lain - Pengeluaran Anggaran)
  const globalCash = useMemo(
    () => calculateGlobalCashSummary(transaksiList, transaksiKasList),
    [transaksiList, transaksiKasList]
  );

  // Hitung KPI bulan berjalan dengan pencocokan blok kanonis (B05/02 == B5/2)
  const activeWarga = wargaList.filter((w) => w.aktif && w.status_hunian !== 'Kosong');
  const rumahLunasBulanIni = activeWarga.filter((w) => {
    const wKey = canonicalizeBlokKey(w.blok_rumah);
    const st = statusList.find(
      (s) =>
        canonicalizeBlokKey(s.blok_rumah) === wKey &&
        s.tahun === TAHUN_AKTIF &&
        s.bulan === currentMonth
    );
    return st?.status === 'Lunas';
  }).length;

  const rumahBelumBayarBulanIni = activeWarga.filter((w) => {
    const wKey = canonicalizeBlokKey(w.blok_rumah);
    const st = statusList.find(
      (s) =>
        canonicalizeBlokKey(s.blok_rumah) === wKey &&
        s.tahun === TAHUN_AKTIF &&
        s.bulan === currentMonth
    );
    return !st || (st.status !== 'Lunas' && st.status !== 'Menunggu Verifikasi');
  }).length;

  const pemasukanBulanIni = transaksiList
    .filter(
      (t) =>
        t.status_verifikasi === 'Terverifikasi' &&
        t.tahun === TAHUN_AKTIF &&
        ((Array.isArray(t.bulan_dibayar) && t.bulan_dibayar.includes(currentMonth)) ||
          new Date(t.tanggal_setor).getMonth() + 1 === currentMonth)
    )
    .reduce((sum, t) => sum + t.nominal, 0);

  const pendingList = useMemo(
    () => transaksiList.filter((t) => t.status_verifikasi === 'Pending'),
    [transaksiList]
  );
  const verifiedList = useMemo(
    () => transaksiList.filter((t) => t.status_verifikasi === 'Terverifikasi'),
    [transaksiList]
  );
  const rejectedList = useMemo(
    () => transaksiList.filter((t) => t.status_verifikasi === 'Ditolak'),
    [transaksiList]
  );

  const filteredTransaksi = useMemo(() => {
    const base =
      trxFilter === 'Pending'
        ? pendingList
        : trxFilter === 'Terverifikasi'
          ? verifiedList
          : trxFilter === 'Ditolak'
            ? rejectedList
            : transaksiList;
    const q = trxSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (t) =>
        t.blok_rumah.toLowerCase().includes(q) ||
        t.nama_warga.toLowerCase().includes(q) ||
        t.no_kwitansi.toLowerCase().includes(q) ||
        t.metode_bayar.toLowerCase().includes(q)
    );
  }, [trxFilter, trxSearch, pendingList, verifiedList, rejectedList, transaksiList]);

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

  const allRegisteredActiveCount = wargaList.filter((w) => w.aktif).length;
  const targetRecipientCount =
    notifScope === 'all_units' ? allRegisteredActiveCount : activeWarga.length;

  const openBroadcastModal = () => {
    setBroadcastOpen(true);
  };

  const handleApplyTemplate = (tpl: (typeof BULK_NOTIFICATION_TEMPLATES)[number]) => {
    setNotifCategory(tpl.category);
    setNotifTitle(tpl.title);
    setNotifMessage(tpl.message);
  };

  const handleSendBulkNotification = async (e: FormEvent) => {
    e.preventDefault();
    if (sendingBroadcast) return;
    if (!notifTitle.trim() || !notifMessage.trim()) {
      onToast('error', 'Judul dan isi pesan pengumuman wajib diisi.');
      return;
    }

    setSendingBroadcast(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 450));
      const res = await sendBulkSystemNotificationAdmin(session, {
        title: notifTitle,
        message: notifMessage,
        category: notifCategory,
        target_scope: notifScope,
        wargaList,
      });

      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengirim pengumuman sistem.');
      } else {
        onToast(
          'success',
          `Pesan sistem "${res.data.title}" berhasil dikirim ke ${res.data.recipient_count} akun warga.`
        );
        setNotifTitle('');
        setNotifMessage('');
        setBroadcastOpen(false);
        await onRefresh();
      }
    } finally {
      setSendingBroadcast(false);
    }
  };

  const handleDeleteNotification = async (notif: SystemNotification) => {
    if (!canManageFull || deletingNotifId) return;
    setDeletingNotifId(notif.id);
    try {
      const res = await deleteSystemNotificationAdmin(session, notif);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast('info', `Pengumuman "${notif.title}" telah dihapus dari beranda warga.`);
        await onRefresh();
      }
    } finally {
      setDeletingNotifId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header Periode + 2 Tombol Aksi Cepat Bersih (Grid 2 Kolom Sejajar) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-600">
            Ringkasan Kas Periode{' '}
            <span className="font-bold text-[#0F172A]">
              {currentMonthName} {TAHUN_AKTIF}
            </span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:w-auto sm:min-w-[330px]">
          <button
            type="button"
            onClick={openBroadcastModal}
            className="min-h-[44px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-xs sm:text-sm font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Megaphone className="w-4 h-4 shrink-0" />
            <span>Kirim Pengumuman</span>
          </button>

          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void onRefresh()}
            className="min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs sm:text-sm font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isRefreshing ? 'Memuat...' : 'Muat Ulang Data'}</span>
          </button>
        </div>
      </div>

      {/* Kartu Saldo Kas Real-Time Terintegrasi */}
      <section className="rounded-2xl bg-[#0F172A] text-white p-5 sm:p-6 border border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-emerald-300 inline-flex items-center gap-1.5">
              <Wallet className="w-4 h-4 shrink-0" />
              <span>Saldo Kas Lingkungan Real-Time</span>
            </p>
            <p className="text-2xl sm:text-3xl font-mono font-bold tracking-tight tabular-nums mt-1.5">
              {formatRupiah(globalCash.saldoKas)}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Otomatis tersinkronisasi: Pemasukan IPL Terverifikasi + Pemasukan Lain − Pengeluaran Anggaran
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5 sm:gap-3 md:min-w-[380px]">
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
              <p className="text-[11px] text-slate-400">IPL Masuk</p>
              <p className="text-xs sm:text-sm font-mono font-bold text-emerald-300 tabular-nums mt-0.5 truncate">
                {formatRupiah(globalCash.totalIplMasuk)}
              </p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
              <p className="text-[11px] text-slate-400">Kas Lain</p>
              <p className="text-xs sm:text-sm font-mono font-bold text-sky-300 tabular-nums mt-0.5 truncate">
                {formatRupiah(globalCash.totalPemasukanLain)}
              </p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
              <p className="text-[11px] text-slate-400">Pengeluaran</p>
              <p className="text-xs sm:text-sm font-mono font-bold text-rose-300 tabular-nums mt-0.5 truncate">
                {formatRupiah(globalCash.totalPengeluaran)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4 KPI Ringkasan Kas Bulan Berjalan */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Pemasukan Terverifikasi</p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-[#059669] tabular-nums mt-2 truncate">
            {formatRupiah(pemasukanBulanIni)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Periode {currentMonthName} {TAHUN_AKTIF}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Rumah Lunas</p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-[#0F172A] tabular-nums mt-2">
            {rumahLunasBulanIni}{' '}
            <span className="text-sm font-normal text-slate-400">/ {activeWarga.length}</span>
          </p>
          <p className="text-[11px] text-emerald-700 mt-1 font-medium">Terverifikasi Lunas</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Belum Bayar</p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-red-700 tabular-nums mt-2">
            {rumahBelumBayarBulanIni}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Unit aktif belum setor</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Antrean Verifikasi</p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-amber-600 tabular-nums mt-2">
            {pendingList.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Menunggu persetujuan</p>
        </div>
      </section>

      {/* Daftar Verifikasi & Riwayat Setoran Masuk Warga */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">
                Antrean Verifikasi &amp; Setoran Masuk Warga
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Semua kiriman setoran warga tampil otomatis di sini. Periksa bukti foto sebelum
                menyetujui pelunasan e-Card.
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-amber-700 tabular-nums shrink-0">
              {pendingList.length} Pending · {transaksiList.length} Total Setoran
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
              {(
                [
                  { id: 'Pending', label: `Pending (${pendingList.length})` },
                  { id: 'Semua', label: `Semua (${transaksiList.length})` },
                  { id: 'Terverifikasi', label: `Lunas (${verifiedList.length})` },
                  { id: 'Ditolak', label: `Ditolak (${rejectedList.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setTrxFilter(tab.id);
                    setVisiblePendingCount(15);
                  }}
                  className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    trxFilter === tab.id
                      ? 'bg-white text-[#0F172A] shadow-sm'
                      : 'text-slate-600 hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={trxSearch}
                onChange={(e) => setTrxSearch(e.target.value)}
                placeholder="Cari blok, nama, kwitansi..."
                className="w-full min-h-[38px] rounded-xl border border-slate-200 bg-slate-50/70 pl-9 pr-3 text-xs text-[#0F172A] placeholder:text-slate-400 focus:bg-white focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
              />
            </div>
          </div>
        </div>

        {filteredTransaksi.length === 0 ? (
          <div className="p-8 sm:p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h3 className="text-sm font-bold text-[#0F172A] mt-3">
              {trxFilter === 'Pending' && !trxSearch.trim()
                ? 'Semua Setoran Sudah Diverifikasi'
                : 'Tidak Ada Data Setoran yang Cocok'}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {trxFilter === 'Pending' && !trxSearch.trim()
                ? 'Tidak ada transaksi berstatus Pending saat ini. Anda dapat klik tab "Semua" di atas untuk melihat seluruh riwayat kiriman warga.'
                : 'Coba ubah filter status atau kata kunci pencarian, atau tekan Muat Ulang Data untuk sinkronisasi terbaru.'}
            </p>
            {trxFilter === 'Pending' && transaksiList.length > 0 && (
              <button
                type="button"
                onClick={() => setTrxFilter('Semua')}
                className="mt-4 min-h-[38px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A] cursor-pointer"
              >
                Lihat Semua Setoran ({transaksiList.length})
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-100">
              {filteredTransaksi.slice(0, visiblePendingCount).map((trx) => {
                const isBusy = processingId === trx.id;
                const isPending = trx.status_verifikasi === 'Pending';
                const isVerified = trx.status_verifikasi === 'Terverifikasi';
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
                          {isPending ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
                              <Clock className="w-3.5 h-3.5" />
                              Pending
                            </span>
                          ) : isVerified ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Terverifikasi
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                              <XCircle className="w-3.5 h-3.5" />
                              Ditolak
                            </span>
                          )}
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
                          {formatTanggalWaktu(trx.tanggal_setor)} ·{' '}
                          <span className="font-mono text-[11px]">{trx.no_kwitansi}</span>
                        </p>

                        {trx.keterangan && (
                          <p className="text-xs text-slate-600">Catatan warga: {trx.keterangan}</p>
                        )}
                        {trx.catatan_admin && !isPending && (
                          <p className="text-xs text-slate-500">
                            Catatan pengurus: {trx.catatan_admin}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Aksi Preview, e-Kwitansi & Approve / Reject */}
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

                      {isVerified && (
                        <button
                          type="button"
                          onClick={() => setReceiptTrx(trx)}
                          className="min-h-[42px] px-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <ReceiptText className="w-4 h-4" />
                          <span>e-Kwitansi</span>
                        </button>
                      )}

                      {isPending &&
                        (canManageFull ? (
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
                        ))}
                    </div>
                  </article>
                );
              })}
            </div>
            {filteredTransaksi.length > visiblePendingCount && (
              <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500 tabular-nums">
                  Menampilkan {Math.min(visiblePendingCount, filteredTransaksi.length)} dari{' '}
                  {filteredTransaksi.length} setoran
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

      {/* Monitoring Patroli Keamanan Real-Time & Kontak Darurat Petugas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <EmergencySecurityContactCard
          petugasList={petugasList
            .filter((p) => p.aktif)
            .map(({ id, nama, no_hp, shift }) => ({ id, nama, no_hp, shift }))}
          senderContext={{
            role: 'admin',
            nama: session.nama_warga,
            jabatan: session.jabatan || 'Pengurus',
          }}
        />
        <SecurityPatrolFeedCard patroliFeed={patroliFeed} maxItems={8} />
      </div>

      {/* Riwayat Pengumuman / Pesan Sistem Massal ke Warga */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">
              Pengumuman Sistem ke Seluruh Warga
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pesan massal yang tampil langsung pada beranda Portal Warga untuk informasi jadwal
              perawatan, keamanan, atau rapat lingkungan.
            </p>
          </div>
          <button
            type="button"
            onClick={openBroadcastModal}
            className="min-h-[38px] px-3.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Megaphone className="w-3.5 h-3.5 shrink-0" />
            <span>Buat Pengumuman Baru</span>
          </button>
        </div>

        {notifications.length === 0 ? (
          <div className="p-8 text-center">
            <Megaphone className="w-9 h-9 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-[#0F172A] mt-3">
              Belum Ada Pengumuman Sistem Terkirim
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Gunakan fitur pengumuman massal untuk menyiarkan jadwal perawatan lingkungan, kerja
              bakti, atau informasi penting ke seluruh akun warga sekaligus.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {notifications.slice(0, 6).map((notif) => (
              <article
                key={notif.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                    <span className="font-semibold text-emerald-700">{notif.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatTanggalWaktu(notif.created_at)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                      Terkirim ke {notif.recipient_count} akun warga
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-[#0F172A]">{notif.title}</h3>
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                    {notif.message}
                  </p>
                  <p className="text-[11px] text-slate-400 pt-0.5">
                    Dikirim oleh {notif.sender_name} ({notif.sender_jabatan}) · Target:{' '}
                    {notif.target_scope === 'all_units'
                      ? 'Seluruh unit terdaftar'
                      : 'Semua rumah aktif dihuni'}
                  </p>
                </div>

                {canManageFull && (
                  <button
                    type="button"
                    disabled={deletingNotifId === notif.id}
                    onClick={() => void handleDeleteNotification(notif)}
                    aria-label={`Hapus pengumuman ${notif.title}`}
                    className="min-h-[36px] px-3 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-medium text-slate-500 inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 self-start disabled:opacity-50 whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{deletingNotifId === notif.id ? 'Menghapus...' : 'Hapus'}</span>
                  </button>
                )}
              </article>
            ))}
          </div>
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

      {/* Modal Kirim Notifikasi / Pengumuman Massal Sistem */}
      {broadcastOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="broadcast-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !sendingBroadcast && setBroadcastOpen(false)}
        >
          <form
            onSubmit={handleSendBulkNotification}
            className="bg-white rounded-2xl max-w-xl w-full max-h-[88vh] flex flex-col border border-slate-200 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                  <Megaphone className="w-4 h-4 text-[#059669]" />
                </div>
                <div className="min-w-0">
                  <h3 id="broadcast-modal-title" className="text-base font-bold text-[#0F172A]">
                    Kirim Pengumuman Massal Sistem
                  </h3>
                  <p className="text-xs text-slate-500">
                    Pesan sistem akan langsung muncul pada beranda seluruh akun warga target.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={sendingBroadcast}
                onClick={() => setBroadcastOpen(false)}
                aria-label="Tutup modal pengumuman"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Template Cepat */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-2">
                  Gunakan Template Cepat (Opsional)
                </p>
                <div className="flex flex-wrap gap-2">
                  {BULK_NOTIFICATION_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.label}
                      type="button"
                      disabled={sendingBroadcast}
                      onClick={() => handleApplyTemplate(tpl)}
                      className="min-h-[34px] px-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs font-medium text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {tpl.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Kategori Pengumuman */}
              <div>
                <p className="text-xs font-semibold text-[#0F172A] mb-2">Kategori Pesan</p>
                <div className="grid grid-cols-2 gap-2">
                  {NOTIFICATION_CATEGORIES.map((cat) => {
                    const active = notifCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        disabled={sendingBroadcast}
                        onClick={() => setNotifCategory(cat)}
                        className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer text-left ${
                          active
                            ? 'bg-[#0F172A] border-[#0F172A] text-white'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target Penerima */}
              <div>
                <p className="text-xs font-semibold text-[#0F172A] mb-2">Target Akun Warga</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={sendingBroadcast}
                    onClick={() => setNotifScope('all_active')}
                    className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                      notifScope === 'all_active'
                        ? 'border-[#059669] bg-emerald-50/70 ring-1 ring-[#059669]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#0F172A]">Rumah Aktif Dihuni</span>
                      <span className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                        {activeWarga.length} akun
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Warga berstatus Tetap &amp; Kontrak aktif.
                    </p>
                  </button>

                  <button
                    type="button"
                    disabled={sendingBroadcast}
                    onClick={() => setNotifScope('all_units')}
                    className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                      notifScope === 'all_units'
                        ? 'border-[#059669] bg-emerald-50/70 ring-1 ring-[#059669]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#0F172A]">Seluruh Unit Terdaftar</span>
                      <span className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                        {allRegisteredActiveCount} akun
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Termasuk pemilik rumah berstatus Kosong.
                    </p>
                  </button>
                </div>
              </div>

              {/* Judul */}
              <div>
                <label
                  htmlFor="notif-title-input"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Judul Pengumuman
                </label>
                <input
                  id="notif-title-input"
                  type="text"
                  required
                  maxLength={120}
                  disabled={sendingBroadcast}
                  value={notifTitle}
                  onChange={(e) => setNotifTitle(e.target.value)}
                  placeholder="Contoh: Jadwal Perawatan Saluran Air & Kerja Bakti Minggu Ini"
                  className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white disabled:bg-slate-100 px-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              {/* Isi Pesan */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="notif-message-input"
                    className="block text-xs font-semibold text-[#0F172A]"
                  >
                    Isi Pesan Sistem
                  </label>
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {notifMessage.length}/600
                  </span>
                </div>
                <textarea
                  id="notif-message-input"
                  rows={4}
                  required
                  maxLength={600}
                  disabled={sendingBroadcast}
                  value={notifMessage}
                  onChange={(e) => setNotifMessage(e.target.value)}
                  placeholder="Tuliskan detail tanggal, waktu, lokasi, atau imbauan yang perlu diketahui seluruh warga..."
                  className="w-full rounded-xl border border-slate-300 bg-white disabled:bg-slate-100 p-3 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>Penerima pesan sistem</span>
                </span>
                <span className="font-mono font-bold text-[#0F172A] tabular-nums">
                  {targetRecipientCount} akun warga
                </span>
              </div>
            </div>

            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={sendingBroadcast}
                onClick={() => setBroadcastOpen(false)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={
                  sendingBroadcast ||
                  !notifTitle.trim() ||
                  !notifMessage.trim() ||
                  targetRecipientCount === 0
                }
                aria-busy={sendingBroadcast}
                className="min-h-[42px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {sendingBroadcast ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Mengirim ke {targetRecipientCount} akun...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 shrink-0" />
                    <span>Kirim ke {targetRecipientCount} Akun Warga</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Kwitansi Digital + Stempel Resmi untuk Transaksi Terverifikasi */}
      {receiptTrx && (
        <KwitansiDigitalModal
          mode="ipl"
          trx={receiptTrx}
          onClose={() => setReceiptTrx(null)}
        />
      )}
    </div>
  );
}
