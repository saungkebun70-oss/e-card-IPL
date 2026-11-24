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
  ShieldCheck,
  Undo2,
  ArrowUpRight,
  ArrowDownLeft,
  Lock,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  BULK_NOTIFICATION_TEMPLATES,
  getStatusVerifikasiShortLabel,
  isBendaharaFullAccess,
  isBendaharaOnly,
  isKetuaRole,
  TAHUN_AKTIF,
  type NotificationCategory,
  type NotificationTargetScope,
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
  formatTanggalSingkat,
  formatTanggalWaktu,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import { LoadingSpinner } from '../LoadingSpinner';
import {
  deleteSystemNotificationAdmin,
  deleteTransaksiIplAdmin,
  sendBulkSystemNotificationAdmin,
  verifyTransaksiAdmin,
  verifyTransaksiKasKetuaAdmin,
  verifyTransaksiKetuaAdmin,
  type AdminSnapshot,
} from '../../lib/dataService';
import { calculateGlobalCashSummary } from '../../lib/financeUtils';
import { computeVerificationQueue } from '../../lib/verificationQueue';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';
import { ChairmanMonthlyReportPanel } from './ChairmanMonthlyReportPanel';

const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'Perawatan & Fasilitas',
  'Pengumuman Umum',
  'Keamanan',
  'Keuangan & IPL',
];

type TrxFilterTab = 'Pending' | 'ACC Bendahara' | 'Semua' | 'Terverifikasi' | 'Ditolak';

interface AdminDashboardSlideProps {
  session: SessionUser;
  wargaList: Warga[];
  transaksiList: TransaksiIPL[];
  transaksiKasList: TransaksiKas[];
  statusList: StatusEcardBulanan[];
  notifications: SystemNotification[];
  isRefreshing?: boolean;
  onRefresh: () => Promise<void>;
  onOptimisticMutate?: (updater: (prev: AdminSnapshot) => AdminSnapshot) => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminDashboardSlide({
  session,
  wargaList,
  transaksiList,
  transaksiKasList,
  statusList,
  notifications,
  isRefreshing = false,
  onRefresh,
  onOptimisticMutate,
  onToast,
}: AdminDashboardSlideProps) {
  const canManageFull = isBendaharaFullAccess(session);
  const canAccessBotWa = isBendaharaOnly(session);
  const isKetua = isKetuaRole(session);
  const canDeleteIpl = canManageFull || isKetua;
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [previewTrx, setPreviewTrx] = useState<TransaksiIPL | null>(null);
  const [previewProofUrl, setPreviewProofUrl] = useState<{ title: string; url: string } | null>(null);
  const [receiptTrx, setReceiptTrx] = useState<TransaksiIPL | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TransaksiIPL | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TransaksiIPL | null>(null);
  const [deletePin, setDeletePin] = useState('');
  const [showDeletePin, setShowDeletePin] = useState(false);
  const [deletePinError, setDeletePinError] = useState<string | null>(null);
  const [deletingIpl, setDeletingIpl] = useState(false);
  const [ketuaReturnTarget, setKetuaReturnTarget] = useState<
    | { kind: 'ipl'; trx: TransaksiIPL }
    | { kind: 'kas'; kas: TransaksiKas }
    | null
  >(null);
  const [ketuaReturnNote, setKetuaReturnNote] = useState('');

  const [trxFilter, setTrxFilter] = useState<TrxFilterTab>(
    isKetua ? 'ACC Bendahara' : 'Pending'
  );
  const [trxSearch, setTrxSearch] = useState('');
  const [visiblePendingCount, setVisiblePendingCount] = useState(15);

  // State Modal Kirim Notifikasi Massal Sistem (Eksklusif Bendahara)
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

  // Single Source of Truth — identik dengan perhitungan badge bottom navigation "Verifikasi"
  const verificationQueue = useMemo(
    () => computeVerificationQueue(session, wargaList, transaksiList, transaksiKasList),
    [session, wargaList, transaksiList, transaksiKasList]
  );

  const validTransaksiList = verificationQueue.validTransaksiList;
  const pendingList = verificationQueue.pendingIplList;
  const accBendaharaList = verificationQueue.accBendaharaIplList;
  const accBendaharaKasList = verificationQueue.accBendaharaKasList;
  const totalKetuaQueueCount = verificationQueue.totalKetuaQueueCount;
  const verifiedList = verificationQueue.verifiedIplList;
  const rejectedList = verificationQueue.rejectedIplList;

  const quickQueueList = isKetua ? accBendaharaList : pendingList;
  const quickQueueBadgeCount = isKetua ? totalKetuaQueueCount : pendingList.length;

  const scrollToVerificationSection = (targetTab: TrxFilterTab) => {
    setTrxFilter(targetTab);
    setVisiblePendingCount(15);
    if (typeof document !== 'undefined') {
      document
        .getElementById('verifikasi-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const filteredTransaksi = useMemo(() => {
    const base =
      trxFilter === 'Pending'
        ? pendingList
        : trxFilter === 'ACC Bendahara'
          ? accBendaharaList
          : trxFilter === 'Terverifikasi'
            ? verifiedList
            : trxFilter === 'Ditolak'
              ? rejectedList
              : validTransaksiList;
    const q = trxSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (t) =>
        t.blok_rumah.toLowerCase().includes(q) ||
        t.nama_warga.toLowerCase().includes(q) ||
        t.no_kwitansi.toLowerCase().includes(q) ||
        t.metode_bayar.toLowerCase().includes(q)
    );
  }, [
    trxFilter,
    trxSearch,
    pendingList,
    accBendaharaList,
    verifiedList,
    rejectedList,
    validTransaksiList,
  ]);

  const handleOpenDeleteIplModal = (trx: TransaksiIPL) => {
    setDeleteTarget(trx);
    setDeletePin('');
    setShowDeletePin(false);
    setDeletePinError(null);
  };

  const handleCloseDeleteIplModal = () => {
    if (deletingIpl) return;
    setDeleteTarget(null);
    setDeletePin('');
    setShowDeletePin(false);
    setDeletePinError(null);
  };

  const handleConfirmDeleteIpl = async (e: FormEvent) => {
    e.preventDefault();
    if (!deleteTarget || deletingIpl) return;

    const cleanPin = deletePin.trim();
    if (!/^\d{6}$/.test(cleanPin)) {
      setDeletePinError('Masukkan tepat 6 digit PIN keamanan akun Anda untuk melanjutkan.');
      return;
    }

    setDeletingIpl(true);
    setDeletePinError(null);
    try {
      const res = await deleteTransaksiIplAdmin(session, deleteTarget, cleanPin);
      if (res.error) {
        setDeletePinError(res.error);
        return;
      }
      onToast(
        'success',
        `Setoran IPL ${deleteTarget.blok_rumah} (${deleteTarget.no_kwitansi}) berhasil dihapus dan status e-Card telah diperbarui.`
      );
      const deletedId = deleteTarget.id;
      onOptimisticMutate?.((prev) => ({
        ...prev,
        transaksiList: prev.transaksiList.filter((t) => t.id !== deletedId),
      }));
      setDeleteTarget(null);
      setDeletePin('');
      setShowDeletePin(false);
      setDeletePinError(null);
      await onRefresh();
    } finally {
      setDeletingIpl(false);
    }
  };

  const handleBendaharaAcc = async (trx: TransaksiIPL) => {
    setProcessingId(trx.id);
    try {
      const res = await verifyTransaksiAdmin(session, trx, 'ACC Bendahara');
      if (res.error) {
        onToast('error', res.error);
      } else {
        const updatedTrx = res.data;
        const nowIso = new Date().toISOString();
        // Perbarui state & badge secara instan tanpa menunggu refresh penuh
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiList: prev.transaksiList.map((item) =>
            item.id === trx.id
              ? updatedTrx || {
                  ...item,
                  status_verifikasi: 'ACC Bendahara',
                  bendahara_approved_at: nowIso,
                  bendahara_approved_by: session.nama_warga || 'Andriansyah',
                  ketua_catatan: null,
                }
              : item
          ),
        }));
        onToast(
          'success',
          `ACC Tahap 1 Bendahara untuk ${trx.blok_rumah} (${formatRupiah(trx.nominal)}) berhasil — diteruskan ke Antrean Verifikasi Ketua.`
        );
        await onRefresh();
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleKetuaApproveIpl = async (trx: TransaksiIPL) => {
    setProcessingId(trx.id);
    try {
      const res = await verifyTransaksiKetuaAdmin(session, trx, 'Terverifikasi');
      if (res.error) {
        onToast('error', res.error);
      } else {
        const updatedTrx = res.data;
        const nowIso = new Date().toISOString();
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiList: prev.transaksiList.map((item) =>
            item.id === trx.id
              ? updatedTrx || {
                  ...item,
                  status_verifikasi: 'Terverifikasi',
                  verified_at: nowIso,
                  ketua_approved_at: nowIso,
                  ketua_approved_by: session.nama_warga || 'Erlangga',
                }
              : item
          ),
        }));
        onToast(
          'success',
          `Disahkan final oleh Ketua! Setoran ${trx.blok_rumah} (${formatRupiah(trx.nominal)}) resmi Lunas & masuk Saldo Kas.`
        );
        await onRefresh();
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleKetuaApproveKas = async (kas: TransaksiKas) => {
    setProcessingId(kas.id);
    try {
      const res = await verifyTransaksiKasKetuaAdmin(session, kas, 'Terverifikasi');
      if (res.error) {
        onToast('error', res.error);
      } else {
        const updatedKas = res.data;
        const nowIso = new Date().toISOString();
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiKasList: prev.transaksiKasList.map((item) =>
            item.id === kas.id
              ? updatedKas || {
                  ...item,
                  status_verifikasi: 'Terverifikasi',
                  ketua_approved_at: nowIso,
                  ketua_approved_by: session.nama_warga || 'Erlangga',
                }
              : item
          ),
        }));
        onToast(
          'success',
          `Transaksi kas ${kas.no_bukti} (${formatRupiah(kas.nominal)}) disahkan final & memperbarui Saldo Kas.`
        );
        await onRefresh();
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmKetuaReturn = async () => {
    if (!ketuaReturnTarget) return;
    if (!ketuaReturnNote.trim()) {
      onToast('error', 'Mohon isi catatan / alasan pengembalian ke Bendahara.');
      return;
    }
    const targetId =
      ketuaReturnTarget.kind === 'ipl' ? ketuaReturnTarget.trx.id : ketuaReturnTarget.kas.id;
    const cleanNote = ketuaReturnNote.trim();
    setProcessingId(targetId);
    try {
      if (ketuaReturnTarget.kind === 'ipl') {
        const res = await verifyTransaksiKetuaAdmin(
          session,
          ketuaReturnTarget.trx,
          'Kembalikan',
          cleanNote
        );
        if (res.error) {
          onToast('error', res.error);
        } else {
          const updatedTrx = res.data;
          onOptimisticMutate?.((prev) => ({
            ...prev,
            transaksiList: prev.transaksiList.map((item) =>
              item.id === targetId
                ? updatedTrx || {
                    ...item,
                    status_verifikasi: 'Pending',
                    bendahara_approved_at: null,
                    bendahara_approved_by: null,
                    ketua_catatan: cleanNote,
                  }
                : item
            ),
          }));
          onToast(
            'info',
            `Setoran ${ketuaReturnTarget.trx.blok_rumah} dikembalikan ke Bendahara dengan catatan Ketua.`
          );
          setKetuaReturnTarget(null);
          setKetuaReturnNote('');
          await onRefresh();
        }
      } else {
        const res = await verifyTransaksiKasKetuaAdmin(
          session,
          ketuaReturnTarget.kas,
          'Kembalikan',
          cleanNote
        );
        if (res.error) {
          onToast('error', res.error);
        } else {
          const updatedKas = res.data;
          onOptimisticMutate?.((prev) => ({
            ...prev,
            transaksiKasList: prev.transaksiKasList.map((item) =>
              item.id === targetId
                ? updatedKas || {
                    ...item,
                    status_verifikasi: 'Pending',
                    bendahara_approved_at: null,
                    bendahara_approved_by: null,
                    ketua_catatan: cleanNote,
                  }
                : item
            ),
          }));
          onToast(
            'info',
            `Transaksi kas ${ketuaReturnTarget.kas.no_bukti} dikembalikan ke Bendahara dengan catatan Ketua.`
          );
          setKetuaReturnTarget(null);
          setKetuaReturnNote('');
          await onRefresh();
        }
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
    const cleanReason = rejectReason.trim();
    const targetTrx = rejectTarget;
    setProcessingId(targetTrx.id);
    try {
      const res = await verifyTransaksiAdmin(session, targetTrx, 'Ditolak', cleanReason);
      if (res.error) {
        onToast('error', res.error);
      } else {
        const updatedTrx = res.data;
        const nowIso = new Date().toISOString();
        onOptimisticMutate?.((prev) => ({
          ...prev,
          transaksiList: prev.transaksiList.map((item) =>
            item.id === targetTrx.id
              ? updatedTrx || {
                  ...item,
                  status_verifikasi: 'Ditolak',
                  catatan_admin: cleanReason,
                  verified_at: nowIso,
                  verified_by: session.blok_rumah,
                }
              : item
          ),
        }));
        onToast('info', `Setoran ${targetTrx.blok_rumah} ditolak dengan catatan untuk warga.`);
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
    <div className="space-y-5 sm:space-y-6">
      {/* Hero Card Saldo Kas Lingkungan — Ungu-Indigo Gelap Bercahaya */}
      <section className="glass-hero bg-gradient-to-r from-[#4C1D95] via-[#6D28D9] to-[#312E81] shadow-xl shadow-indigo-900/15 rounded-3xl text-white px-5 py-6 sm:px-8 sm:py-8 relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-16 w-64 h-64 rounded-full bg-indigo-400/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-16 -left-16 w-56 h-56 rounded-full bg-emerald-400/15 blur-3xl"
        />
        <div className="relative z-10 flex items-center justify-between gap-3 mb-2">
          <p className="text-[11px] sm:text-xs font-semibold tracking-wider uppercase text-purple-100/85 inline-flex items-center gap-1.5">
            <Wallet className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
            <span>
              Saldo Kas Lingkungan · {currentMonthName} {TAHUN_AKTIF}
            </span>
          </p>

          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void onRefresh()}
            title="Muat Ulang Data"
            className="min-h-[34px] px-3 rounded-full bg-white/12 hover:bg-white/22 border border-white/20 disabled:opacity-60 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isRefreshing ? 'Memuat...' : 'Muat Ulang'}</span>
          </button>
        </div>

        <div className="relative z-10 text-center py-1 sm:py-2">
          <p className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight tabular-nums text-white">
            {formatRupiah(globalCash.saldoKas)}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 sm:gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/25 border border-emerald-300/35 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-emerald-100 tabular-nums">
              Pemasukan IPL: {formatRupiah(globalCash.totalIplMasuk)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-400/20 border border-sky-200/30 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-sky-100 tabular-nums">
              Kas Lain: {formatRupiah(globalCash.totalPemasukanLain)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 border border-white/25 px-3.5 py-1.5 text-xs sm:text-sm font-semibold text-purple-100 tabular-nums">
              Pengeluaran: {formatRupiah(globalCash.totalPengeluaran)}
            </span>
          </div>
        </div>
      </section>

      {/* Baris Status Interaktif Terpusat */}
      <section className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3">
        <button
          type="button"
          onClick={() => scrollToVerificationSection(isKetua ? 'ACC Bendahara' : 'Pending')}
          className="min-h-[40px] px-4 py-2 rounded-full bg-[#FEF3C7] hover:bg-[#FDE68A] border border-amber-200/90 text-[#B45309] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer shadow-xs tabular-nums"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Perlu Verifikasi ({quickQueueBadgeCount})</span>
        </button>

        <button
          type="button"
          onClick={() => scrollToVerificationSection('Terverifikasi')}
          className="min-h-[40px] px-4 py-2 rounded-full bg-[#D1FAE5] hover:bg-[#A7F3D0] border border-emerald-200/90 text-[#047857] text-xs sm:text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer shadow-xs tabular-nums"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            Lunas Bulan Ini ({rumahLunasBulanIni}/{activeWarga.length} KK)
          </span>
        </button>
      </section>

      {/* Dual-Column Bento Grid: Antrean Verifikasi Setoran & Pengumuman Sistem */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Bento Kiri: Antrean Verifikasi Setoran */}
        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-slate-600">
                Antrean Verifikasi Setoran
              </h2>
              <button
                type="button"
                onClick={() => scrollToVerificationSection(isKetua ? 'ACC Bendahara' : 'Pending')}
                className="text-xs font-semibold text-[#4C1D95] hover:underline cursor-pointer shrink-0"
              >
                Lihat Semua ({quickQueueList.length})
              </button>
            </div>

            {quickQueueList.length === 0 ? (
              <div className="rounded-2xl border border-indigo-100/80 bg-white/60 p-6 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                <p className="text-sm font-bold text-[#0F172A] mt-2">
                  Antrean Verifikasi Bersih
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Seluruh setoran warga yang masuk sudah diproses.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {quickQueueList.slice(0, 4).map((trx) => {
                  const isBusy = processingId === trx.id;
                  const canVerifyQuick =
                    (trx.status_verifikasi === 'Pending' && canAccessBotWa) ||
                    (trx.status_verifikasi === 'ACC Bendahara' && isKetua);

                  return (
                    <div
                      key={`quick-queue-${trx.id}`}
                      className="rounded-2xl border border-indigo-100/90 bg-white/75 px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          aria-hidden="true"
                          className="w-2 h-2 rounded-full bg-sky-500 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[#0F172A] truncate">
                            {trx.blok_rumah} · {trx.nama_warga}
                          </p>
                          <p className="text-xs text-slate-500 font-mono tabular-nums truncate">
                            {formatRupiah(trx.nominal)} · {formatDaftarBulan(trx.bulan_dibayar)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => setPreviewTrx(trx)}
                          className="min-h-[34px] px-3 rounded-full border border-slate-200 bg-white/95 hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer whitespace-nowrap"
                        >
                          Lihat Bukti
                        </button>
                        {canVerifyQuick && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void (
                                trx.status_verifikasi === 'ACC Bendahara'
                                  ? handleKetuaApproveIpl(trx)
                                  : handleBendaharaAcc(trx)
                              )
                            }
                            className="min-h-[34px] px-3.5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                          >
                            {isBusy ? 'Memproses...' : 'Verifikasi'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bento Kanan: Pengumuman Sistem ke Seluruh Warga */}
        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6 flex flex-col justify-between gap-4">
          <div className="space-y-3">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#0F172A]">
                Pengumuman Sistem ke Seluruh Warga
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Pesan massal yang tampil langsung pada beranda Portal Warga.
              </p>
            </div>

            {canAccessBotWa && (
              <button
                type="button"
                onClick={openBroadcastModal}
                className="w-full min-h-[46px] px-4 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-[#064E3B] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
              >
                <Megaphone className="w-4 h-4 shrink-0" />
                <span>Buat Pengumuman Baru</span>
              </button>
            )}

            {notifications.length === 0 ? (
              <div className="rounded-2xl border border-indigo-100/80 bg-white/60 p-5 text-center">
                <p className="text-xs font-semibold text-slate-600">
                  Belum ada pengumuman sistem terkirim.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-indigo-100/80">
                {notifications.slice(0, 3).map((notif) => (
                  <article
                    key={notif.id}
                    className="py-3 first:pt-1 last:pb-0 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-[11px] font-medium text-slate-500">
                        <span className="font-semibold text-[#4C1D95]">{notif.category}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">
                          {formatTanggalWaktu(notif.created_at)}
                        </span>
                        <span aria-hidden="true"> · </span>
                        <span className="tabular-nums">{notif.recipient_count} warga</span>
                      </p>
                      <h3 className="text-xs sm:text-sm font-bold text-[#0F172A] truncate">
                        {notif.title}
                      </h3>
                      <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>
                    </div>

                    {canManageFull && (
                      <button
                        type="button"
                        disabled={deletingNotifId === notif.id}
                        aria-busy={deletingNotifId === notif.id}
                        onClick={() => void handleDeleteNotification(notif)}
                        aria-label={`Hapus pengumuman ${notif.title}`}
                        className="min-h-[32px] px-2.5 rounded-full border border-slate-200 bg-white/90 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-[11px] font-semibold text-slate-500 inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        {deletingNotifId === notif.id ? (
                          <LoadingSpinner size="xs" tone="danger" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span className="hidden sm:inline">Hapus</span>
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 4 KPI Ringkasan Kas Bulan Berjalan */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Pemasukan Terverifikasi</p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-[#059669] tabular-nums mt-2 truncate">
            {formatRupiah(pemasukanBulanIni)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Periode {currentMonthName} {TAHUN_AKTIF}
          </p>
        </div>

        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Rumah Lunas</p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-[#0F172A] tabular-nums mt-2">
            {rumahLunasBulanIni}{' '}
            <span className="text-sm font-normal text-slate-400">/ {activeWarga.length}</span>
          </p>
          <p className="text-[11px] text-emerald-700 mt-1 font-medium">Terverifikasi Lunas</p>
        </div>

        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">Belum Bayar</p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-red-700 tabular-nums mt-2">
            {rumahBelumBayarBulanIni}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Unit aktif belum setor</p>
        </div>

        <div className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-4 sm:p-5">
          <p className="text-xs font-medium text-slate-500">
            {isKetua ? 'Antrean Verifikasi Ketua' : 'Antrean Verifikasi'}
          </p>
          <p className="text-lg sm:text-2xl font-mono font-bold text-amber-600 tabular-nums mt-2">
            {isKetua ? totalKetuaQueueCount : pendingList.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {isKetua
              ? `${accBendaharaList.length} IPL · ${accBendaharaKasList.length} Kas (ACC Bendahara)`
              : `${accBendaharaList.length} menunggu pengesahan Ketua`}
          </p>
        </div>
      </section>

      {/* GENERATOR LAPORAN BULANAN OTOMATIS KHUSUS KETUA */}
      {isKetua && (
        <ChairmanMonthlyReportPanel
          session={session}
          wargaList={wargaList}
          statusList={statusList}
          transaksiList={transaksiList}
          transaksiKasList={transaksiKasList}
          onToast={onToast}
          mode="compact"
        />
      )}

      {/* PANEL KHUSUS KETUA (TAHAP 2): Antrean Verifikasi Final Transaksi ACC Bendahara */}
      {isKetua && (
        <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
          <div className="px-5 py-4 bg-sky-50/75 border-b border-sky-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-[#3730A3] text-white flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#0F172A]">
                  Antrean Verifikasi Ketua (Pengesahan Final Tahap 2)
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Transaksi IPL &amp; Kas di bawah ini telah di-ACC Bendahara dan menunggu
                  pengesahan final Anda sebelum masuk Saldo Kas Real-Time &amp; status Lunas.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#3730A3] text-white text-xs font-mono font-bold tabular-nums shrink-0 self-start sm:self-center">
              {totalKetuaQueueCount} Menunggu Ketua
            </span>
          </div>

          {totalKetuaQueueCount === 0 ? (
            <div className="p-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-[#059669] mx-auto" />
              <p className="text-sm font-bold text-[#0F172A] mt-2">
                Tidak Ada Antrean Pengesahan Ketua
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Seluruh transaksi yang telah di-ACC Bendahara sudah disahkan.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-indigo-100/70">
              {accBendaharaList.map((trx) => {
                const isBusy = processingId === trx.id;
                return (
                  <article
                    key={`ketua-ipl-${trx.id}`}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <button
                        type="button"
                        onClick={() => setPreviewTrx(trx)}
                        className="w-16 h-16 rounded-2xl border border-indigo-100 bg-white/80 overflow-hidden shrink-0 hover:border-[#4C1D95] flex items-center justify-center cursor-pointer"
                      >
                        {trx.bukti_url ? (
                          <img
                            src={trx.bukti_url}
                            alt={`Bukti ${trx.blok_rumah}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="w-5 h-5 text-slate-400" />
                        )}
                      </button>
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-bold text-emerald-700">Setoran IPL Warga</span>
                          <span className="text-slate-300">·</span>
                          <span className="font-mono font-bold text-[#0F172A]">
                            Blok {trx.blok_rumah} ({trx.nama_warga})
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="font-semibold text-sky-700">
                            ACC Bendahara ({trx.bendahara_approved_by || 'Andriansyah'})
                          </span>
                        </div>
                        <p className="text-sm font-mono font-bold text-[#059669] tabular-nums">
                          {formatRupiah(trx.nominal)}{' '}
                          <span className="font-sans text-xs font-medium text-slate-600">
                            · {formatDaftarBulan(trx.bulan_dibayar)} {trx.tahun} ({trx.metode_bayar})
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono">
                          {trx.no_kwitansi} · {formatTanggalWaktu(trx.tanggal_setor)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {trx.bukti_url && (
                        <button
                          type="button"
                          onClick={() => setPreviewTrx(trx)}
                          className="min-h-[40px] px-3.5 rounded-full border border-slate-200 bg-white/90 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <ImageIcon className="w-4 h-4" />
                          <span>Periksa Bukti</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setKetuaReturnTarget({ kind: 'ipl', trx });
                          setKetuaReturnNote('');
                        }}
                        className="min-h-[40px] px-3.5 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        <Undo2 className="w-4 h-4" />
                        <span>Kembalikan ke Bendahara</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleKetuaApproveIpl(trx)}
                        className="min-h-[40px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>{isBusy ? 'Mengesahkan...' : 'Setujui & Sahkan (Final)'}</span>
                      </button>
                    </div>
                  </article>
                );
              })}

              {accBendaharaKasList.map((kas) => {
                const isBusy = processingId === kas.id;
                const isOut = kas.jenis === 'pengeluaran';
                return (
                  <article
                    key={`ketua-kas-${kas.id}`}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white/40"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            isOut ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {isOut ? (
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          ) : (
                            <ArrowDownLeft className="w-3.5 h-3.5" />
                          )}
                          {isOut ? 'Pengeluaran Kas' : 'Pemasukan Kas Lain'}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-semibold text-[#0F172A]">{kas.kategori}</span>
                        <span className="text-slate-300">·</span>
                        <span className="font-semibold text-sky-700">
                          ACC Bendahara ({kas.bendahara_approved_by || 'Andriansyah'})
                        </span>
                      </div>
                      <p className="text-sm font-bold text-[#0F172A]">
                        {kas.penerima_atau_sumber} ·{' '}
                        <span
                          className={`font-mono tabular-nums ${
                            isOut ? 'text-red-700' : 'text-[#059669]'
                          }`}
                        >
                          {isOut ? '−' : '+'} {formatRupiah(kas.nominal)}
                        </span>
                      </p>
                      {kas.keterangan && (
                        <p className="text-xs text-slate-600">{kas.keterangan}</p>
                      )}
                      <p className="text-[11px] text-slate-500 font-mono">
                        {kas.no_bukti} · {formatTanggalSingkat(kas.tanggal)} · {kas.created_by_name}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {kas.bukti_url && (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewProofUrl({
                              title: `Nota ${kas.no_bukti} (${kas.penerima_atau_sumber})`,
                              url: kas.bukti_url || '',
                            })
                          }
                          className="min-h-[40px] px-3.5 rounded-full border border-slate-200 bg-white/90 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <ImageIcon className="w-4 h-4" />
                          <span>Lihat Nota</span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                          setKetuaReturnTarget({ kind: 'kas', kas });
                          setKetuaReturnNote('');
                        }}
                        className="min-h-[40px] px-3.5 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        <Undo2 className="w-4 h-4" />
                        <span>Kembalikan</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleKetuaApproveKas(kas)}
                        className="min-h-[40px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>{isBusy ? 'Mengesahkan...' : 'Setujui & Sahkan (Final)'}</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Daftar Verifikasi & Riwayat Setoran Masuk Warga */}
      <section id="verifikasi-section" className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
        <div className="px-5 py-4 border-b border-indigo-100/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">
                Verifikasi Berjenjang &amp; Riwayat Setoran IPL Warga
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Alur 2 Tahap: Setoran Warga → ACC Tahap 1 Bendahara → Pengesahan Final Ketua (Lunas
                &amp; Masuk Saldo Kas).
              </p>
            </div>
            <span className="text-xs font-mono font-semibold text-amber-700 tabular-nums shrink-0">
              {pendingList.length} Menunggu Bendahara · {accBendaharaList.length} Menunggu Ketua
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-indigo-50/70 border border-indigo-100/80 rounded-2xl w-fit">
              {(
                [
                  { id: 'Pending', label: `Menunggu Bendahara (${pendingList.length})` },
                  { id: 'ACC Bendahara', label: `ACC Bendahara (${accBendaharaList.length})` },
                  { id: 'Terverifikasi', label: `Sah Lunas (${verifiedList.length})` },
                  { id: 'Ditolak', label: `Ditolak (${rejectedList.length})` },
                  { id: 'Semua', label: `Semua (${validTransaksiList.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setTrxFilter(tab.id);
                    setVisiblePendingCount(15);
                  }}
                  className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    trxFilter === tab.id
                      ? 'bg-white text-[#4C1D95] shadow-xs'
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
                className="w-full min-h-[38px] rounded-2xl border border-slate-200 bg-white/85 pl-9 pr-3 text-xs text-[#0F172A] placeholder:text-slate-400 focus:bg-white focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
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
            {trxFilter === 'Pending' && validTransaksiList.length > 0 && (
              <button
                type="button"
                onClick={() => setTrxFilter('Semua')}
                className="mt-4 min-h-[38px] px-4 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A] cursor-pointer"
              >
                Lihat Semua Setoran ({validTransaksiList.length})
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-indigo-100/70">
              {filteredTransaksi.slice(0, visiblePendingCount).map((trx) => {
                const isBusy = processingId === trx.id;
                const isPending = trx.status_verifikasi === 'Pending';
                const isAccBendahara = trx.status_verifikasi === 'ACC Bendahara';
                const isVerified = trx.status_verifikasi === 'Terverifikasi';
                return (
                  <article
                    key={trx.id}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-white/40 transition-colors"
                  >
                    <div className="flex items-start gap-4 min-w-0">
                      {/* Thumbnail Bukti Foto */}
                      <button
                        type="button"
                        onClick={() => setPreviewTrx(trx)}
                        className="w-20 h-20 rounded-2xl border border-indigo-100 bg-white/80 overflow-hidden shrink-0 hover:border-[#4C1D95] transition-colors cursor-pointer flex items-center justify-center"
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
                              {getStatusVerifikasiShortLabel('Pending')}
                            </span>
                          ) : isAccBendahara ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              ACC Bendahara — Menunggu Ketua
                            </span>
                          ) : isVerified ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {getStatusVerifikasiShortLabel('Terverifikasi')}
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
                        {trx.ketua_catatan && isPending && (
                          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-2.5 py-1 inline-block">
                            Catatan Ketua: {trx.ketua_catatan}
                          </p>
                        )}
                        {trx.catatan_admin && !isPending && (
                          <p className="text-xs text-slate-500">
                            Catatan pengurus: {trx.catatan_admin}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Aksi Preview, e-Kwitansi & Verifikasi 2 Tahap (Bendahara -> Ketua) */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {trx.bukti_url && (
                        <button
                          type="button"
                          onClick={() => setPreviewTrx(trx)}
                          className="min-h-[40px] px-3.5 rounded-full border border-slate-200 bg-white/95 hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <ImageIcon className="w-4 h-4" />
                          <span>Perbesar Bukti</span>
                        </button>
                      )}

                      {isVerified && (
                        <button
                          type="button"
                          onClick={() => setReceiptTrx(trx)}
                          className="min-h-[40px] px-3.5 rounded-full border border-emerald-200 bg-[#D1FAE5] hover:bg-[#A7F3D0] text-xs font-semibold text-[#064E3B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <ReceiptText className="w-4 h-4" />
                          <span>e-Kwitansi</span>
                        </button>
                      )}

                      {isPending &&
                        (canAccessBotWa ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setRejectTarget(trx);
                                setRejectReason('');
                              }}
                              className="min-h-[40px] px-3.5 rounded-full border border-red-200 bg-red-50 hover:bg-red-100 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                            >
                              <XCircle className="w-4 h-4" />
                              <span>Tolak</span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleBendaharaAcc(trx)}
                              aria-busy={isBusy}
                              className="min-h-[40px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap shadow-xs"
                            >
                              {isBusy ? (
                                <LoadingSpinner size="xs" tone="white" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4" />
                              )}
                              <span>{isBusy ? 'Memproses...' : 'ACC / Verifikasi'}</span>
                            </button>
                          </>
                        ) : (
                          <span className="text-xs font-medium text-slate-500 px-2">
                            Menunggu ACC Tahap 1 Bendahara
                          </span>
                        ))}

                      {isAccBendahara &&
                        (isKetua ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                setKetuaReturnTarget({ kind: 'ipl', trx });
                                setKetuaReturnNote('');
                              }}
                              className="min-h-[40px] px-3.5 rounded-full border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5 disabled:opacity-50 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap"
                            >
                              <Undo2 className="w-4 h-4" />
                              <span>Kembalikan</span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleKetuaApproveIpl(trx)}
                              aria-busy={isBusy}
                              className="min-h-[40px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap shadow-xs"
                            >
                              {isBusy ? (
                                <LoadingSpinner size="xs" tone="white" />
                              ) : (
                                <ShieldCheck className="w-4 h-4" />
                              )}
                              <span>{isBusy ? 'Mengesahkan...' : 'Setujui & Sahkan (Final)'}</span>
                            </button>
                          </>
                        ) : (
                          <span className="text-xs font-semibold text-sky-700 bg-sky-50 border border-sky-200 rounded-full px-3 py-1.5">
                            Menunggu Pengesahan Ketua
                          </span>
                        ))}

                      {canDeleteIpl && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpenDeleteIplModal(trx)}
                          className="min-h-[40px] px-3.5 rounded-full border border-red-200 bg-white/95 hover:bg-red-50 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                          title="Hapus riwayat setoran IPL (wajib PIN 6 digit)"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Hapus</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            {filteredTransaksi.length > visiblePendingCount && (
              <div className="px-5 py-3 border-t border-indigo-100/80 bg-white/50 flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500 tabular-nums">
                  Menampilkan {Math.min(visiblePendingCount, filteredTransaksi.length)} dari{' '}
                  {filteredTransaksi.length} setoran
                </span>
                <button
                  type="button"
                  onClick={() => setVisiblePendingCount((c) => c + 15)}
                  className="min-h-[36px] px-4 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A] cursor-pointer"
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
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => setPreviewTrx(null)}
        >
          <div
            className="bg-white/95 backdrop-blur-2xl rounded-3xl max-w-xl w-full overflow-hidden border border-white/90 shadow-2xl animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between gap-3">
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
                  className="max-h-[65vh] w-auto object-contain rounded-2xl border border-slate-200 bg-white"
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
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => setRejectTarget(null)}
        >
          <div
            className="bg-white/95 backdrop-blur-2xl rounded-3xl max-w-md w-full border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between">
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
                  className="w-full rounded-2xl border border-slate-300 p-3 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-indigo-50/40 border-t border-indigo-100/80 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="min-h-[42px] px-4 rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={processingId === rejectTarget.id || !rejectReason.trim()}
                aria-busy={processingId === rejectTarget.id}
                onClick={() => void handleConfirmReject()}
                className="min-h-[42px] px-4 rounded-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {processingId === rejectTarget.id && <LoadingSpinner size="xs" tone="white" />}
                <span>{processingId === rejectTarget.id ? 'Memproses...' : 'Konfirmasi Tolak'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Preview Foto Nota Kas (dari Antrean Ketua) */}
      {previewProofUrl && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => setPreviewProofUrl(null)}
        >
          <div
            className="bg-white/95 backdrop-blur-2xl rounded-3xl max-w-xl w-full overflow-hidden border border-white/90 shadow-2xl animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[#0F172A] truncate">{previewProofUrl.title}</h3>
              <button
                type="button"
                onClick={() => setPreviewProofUrl(null)}
                aria-label="Tutup"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-50 flex items-center justify-center">
              <img
                src={previewProofUrl.url}
                alt={previewProofUrl.title}
                referrerPolicy="no-referrer"
                className="max-h-[65vh] w-auto object-contain rounded-2xl border border-slate-200 bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal Kembalikan ke Bendahara (Ketua Tahap 2) */}
      {ketuaReturnTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => setKetuaReturnTarget(null)}
        >
          <div
            className="bg-white/95 backdrop-blur-2xl rounded-3xl max-w-md w-full border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Undo2 className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-[#0F172A]">
                  Kembalikan ke Bendahara
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setKetuaReturnTarget(null)}
                aria-label="Tutup modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Transaksi{' '}
                <span className="font-bold text-[#0F172A]">
                  {ketuaReturnTarget.kind === 'ipl'
                    ? `IPL ${ketuaReturnTarget.trx.nama_warga} (${ketuaReturnTarget.trx.blok_rumah})`
                    : `${ketuaReturnTarget.kas.no_bukti} (${ketuaReturnTarget.kas.penerima_atau_sumber})`}
                </span>{' '}
                akan dikembalikan ke status{' '}
                <span className="font-semibold text-amber-700">Menunggu Verifikasi Bendahara</span>{' '}
                untuk diperiksa ulang.
              </p>

              <div>
                <label
                  htmlFor="ketua-return-note"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Catatan Ketua untuk Bendahara (Wajib)
                </label>
                <textarea
                  id="ketua-return-note"
                  rows={3}
                  value={ketuaReturnNote}
                  onChange={(e) => setKetuaReturnNote(e.target.value)}
                  placeholder="Contoh: Mohon konfirmasi ulang nominal transfer / lampirkan foto nota yang lebih jelas."
                  className="w-full rounded-2xl border border-slate-300 p-3 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                />
              </div>
            </div>

            <div className="px-5 py-4 bg-indigo-50/40 border-t border-indigo-100/80 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setKetuaReturnTarget(null)}
                className="min-h-[42px] px-4 rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!ketuaReturnNote.trim() || Boolean(processingId)}
                aria-busy={Boolean(processingId)}
                onClick={() => void handleConfirmKetuaReturn()}
                className="min-h-[42px] px-4 rounded-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {Boolean(processingId) && <LoadingSpinner size="xs" tone="white" />}
                <span>{Boolean(processingId) ? 'Memproses...' : 'Kembalikan ke Bendahara'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Kirim Notifikasi / Pengumuman Massal Sistem (Eksklusif Bendahara) */}
      {broadcastOpen && canAccessBotWa && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="broadcast-modal-title"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={() => !sendingBroadcast && setBroadcastOpen(false)}
        >
          <form
            onSubmit={handleSendBulkNotification}
            className="bg-white/95 backdrop-blur-2xl rounded-3xl max-w-xl w-full max-h-[88vh] flex flex-col border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-[#EDE9FE] border border-[#DDD6FE] flex items-center justify-center shrink-0">
                  <Megaphone className="w-4 h-4 text-[#4C1D95]" />
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
                      className="min-h-[34px] px-3 rounded-full border border-indigo-200/80 bg-indigo-50/50 hover:bg-[#EDE9FE] hover:border-[#4C1D95]/40 text-xs font-medium text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
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
                        className={`min-h-[40px] px-3 rounded-2xl border text-xs font-semibold transition-colors cursor-pointer text-left ${
                          active
                            ? 'bg-[#4C1D95] border-[#4C1D95] text-white'
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
                    className={`rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
                      notifScope === 'all_active'
                        ? 'border-[#4C1D95] bg-[#EDE9FE]/70 ring-1 ring-[#4C1D95]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#0F172A]">Rumah Aktif Dihuni</span>
                      <span className="text-xs font-mono font-bold text-[#4C1D95] tabular-nums">
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
                    className={`rounded-2xl border p-3 text-left transition-colors cursor-pointer ${
                      notifScope === 'all_units'
                        ? 'border-[#4C1D95] bg-[#EDE9FE]/70 ring-1 ring-[#4C1D95]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[#0F172A]">Seluruh Unit Terdaftar</span>
                      <span className="text-xs font-mono font-bold text-[#4C1D95] tabular-nums">
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
                  className="w-full min-h-[44px] rounded-2xl border border-slate-300 bg-white disabled:bg-slate-100 px-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
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
                  className="w-full rounded-2xl border border-slate-300 bg-white disabled:bg-slate-100 p-3 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20"
                />
              </div>

              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-[#4C1D95] shrink-0" />
                  <span>Penerima pesan sistem</span>
                </span>
                <span className="font-mono font-bold text-[#0F172A] tabular-nums">
                  {targetRecipientCount} akun warga
                </span>
              </div>
            </div>

            <div className="px-5 py-4 bg-indigo-50/40 border-t border-indigo-100/80 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={sendingBroadcast}
                onClick={() => setBroadcastOpen(false)}
                className="min-h-[42px] px-4 rounded-full border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
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
                className="min-h-[42px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:bg-slate-300 disabled:text-slate-500 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shadow-xs"
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

      {/* Modal Konfirmasi Hapus Setoran IPL dengan Verifikasi PIN 6 Digit */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-ipl-pin-title"
          className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-4 animate-modal-backdrop"
          onClick={handleCloseDeleteIplModal}
        >
          <form
            onSubmit={(e) => void handleConfirmDeleteIpl(e)}
            className="bg-white/95 backdrop-blur-2xl rounded-3xl max-w-md w-full border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-red-100 bg-red-50/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-red-600 text-white flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 id="delete-ipl-pin-title" className="text-sm font-bold text-[#0F172A] truncate">
                    Hapus Setoran IPL Warga
                  </h3>
                  <p className="text-[11px] text-red-700 font-medium">
                    Verifikasi PIN 6 digit diperlukan untuk lanjut hapus
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingIpl}
                onClick={handleCloseDeleteIplModal}
                aria-label="Tutup modal hapus"
                className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-slate-500 hover:bg-red-100 hover:text-slate-800 cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Ringkasan Transaksi yang Akan Dihapus */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 space-y-1 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-bold text-[#0F172A]">
                    {deleteTarget.blok_rumah} · {deleteTarget.nama_warga}
                  </span>
                  <span className="font-mono font-bold text-red-700 tabular-nums">
                    {formatRupiah(deleteTarget.nominal)}
                  </span>
                </div>
                <p className="text-slate-600">
                  Periode: <span className="font-semibold text-[#0F172A]">{formatDaftarBulan(deleteTarget.bulan_dibayar)} ({deleteTarget.tahun})</span>
                </p>
                <p className="text-[11px] font-mono text-slate-500">
                  {deleteTarget.no_kwitansi} · Status: {deleteTarget.status_verifikasi}
                </p>
              </div>

              {deleteTarget.status_verifikasi === 'Terverifikasi' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 flex items-start gap-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="leading-snug">
                    Setoran ini sudah berstatus <strong>Sah Lunas</strong>. Menghapusnya akan otomatis
                    mengembalikan status e-Card bulan terkait dan menyesuaikan Saldo Kas Real-Time.
                  </p>
                </div>
              )}

              {/* Input PIN 6 Digit Pengurus */}
              <div>
                <label
                  htmlFor="delete-ipl-pin-input"
                  className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                >
                  Masukkan PIN 6 Digit ({session.nama_warga} — {session.jabatan || 'Pengurus'})
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="delete-ipl-pin-input"
                    type={showDeletePin ? 'text' : 'password'}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    disabled={deletingIpl}
                    value={deletePin}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                      setDeletePin(digits);
                      if (deletePinError) setDeletePinError(null);
                    }}
                    placeholder="••••••"
                    className="w-full min-h-[44px] rounded-2xl border border-slate-300 bg-white pl-10 pr-11 text-base font-mono tracking-[0.35em] text-[#0F172A] placeholder:tracking-widest placeholder:text-slate-400 focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-600/20 disabled:bg-slate-100"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowDeletePin((v) => !v)}
                    aria-label={showDeletePin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    {showDeletePin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {deletePinError && (
                  <p role="alert" className="text-xs font-semibold text-red-700 mt-2">
                    {deletePinError}
                  </p>
                )}
              </div>
            </div>

            <div className="px-5 py-3.5 bg-indigo-50/40 border-t border-indigo-100/80 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deletingIpl}
                onClick={handleCloseDeleteIplModal}
                className="min-h-[42px] px-4 rounded-full border border-slate-300 bg-white text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={deletingIpl || deletePin.length !== 6}
                className="min-h-[42px] px-4 rounded-full bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:text-slate-500 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {deletingIpl ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Memverifikasi &amp; Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 shrink-0" />
                    <span>Lanjut Hapus</span>
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
