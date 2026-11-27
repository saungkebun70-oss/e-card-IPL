import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
  UserCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  DEFAULT_SECURITY_OFFICER_NAMES,
  STANDARD_SECURITY_SHIFTS,
  TERMIN_PENGELUARAN_LIST,
  type PetugasKontakDarurat,
  type SecurityAttendanceRecord,
  type SecurityShiftOverride,
  type SessionUser,
  type TransaksiKas,
} from '../../types';
import { formatRupiah, formatTanggalSingkat, terbilangRupiah } from '../../lib/format';
import {
  fetchSecurityAttendance,
  formatWibDateStr,
  formatWibDateTime,
  formatWibTime,
  getWibParts,
  isSameOfficerName,
  subscribeSecurityAttendance,
} from '../../lib/securityAttendanceService';
import {
  createTransaksiKasAdmin,
  deleteTransaksiKasAdmin,
  fetchPetugasListAdmin,
  subscribePetugasKeamananRealtime,
} from '../../lib/dataService';
import {
  buildOvertimeCashDescription,
  cancelOvertimePaymentWithCashSyncAdmin,
  createShiftOverrideAdmin,
  deleteShiftOverrideWithCashSyncAdmin,
  fetchShiftOverrides,
  getDefaultOvertimeAmount,
  getNearestSundayWibDateStr,
  isSundayOvertimeShift,
  payOvertimeForShiftOverrideAdmin,
  setDefaultOvertimeAmount,
  subscribeShiftOverrides,
  updateShiftOverrideAdmin,
} from '../../lib/securityShiftOvertimeService';
import { KwitansiDigitalModal } from '../KwitansiDigitalModal';

interface AdminShiftOvertimePanelProps {
  session: SessionUser;
  petugasList: PetugasKontakDarurat[];
  transaksiKasList?: TransaksiKas[];
  onCashChanged: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminShiftOvertimePanel({
  session,
  petugasList,
  transaksiKasList = [],
  onCashChanged,
  onToast,
}: AdminShiftOvertimePanelProps) {
  const [overrides, setOverrides] = useState<SecurityShiftOverride[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<SecurityAttendanceRecord[]>([]);
  const [livePetugas, setLivePetugas] = useState<PetugasKontakDarurat[]>(petugasList);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setLivePetugas(petugasList);
  }, [petugasList]);

  // Pengaturan Nominal Default Lembur Minggu
  const [defaultNominal, setDefaultNominal] = useState<number>(() => getDefaultOvertimeAmount());
  const [defaultNominalInput, setDefaultNominalInput] = useState<string>(() =>
    String(getDefaultOvertimeAmount())
  );

  // Sumber data tunggal daftar petugas (Petugas Keamanan live + semua nama di Kelola Shift & Lembur)
  const officerOptions = useMemo(() => {
    const map = new Map<string, { nama: string; id: string | null }>();
    livePetugas.forEach((p) => {
      const key = p.nama.trim().toLowerCase();
      if (key) {
        map.set(key, { nama: p.nama.trim(), id: p.id });
      }
    });
    overrides.forEach((ov) => {
      const key = ov.officer_name.trim().toLowerCase();
      if (key && !map.has(key)) {
        map.set(key, { nama: ov.officer_name.trim(), id: null });
      }
    });
    if (map.size === 0) {
      DEFAULT_SECURITY_OFFICER_NAMES.forEach((name) => {
        map.set(name.trim().toLowerCase(), { nama: name, id: null });
      });
    }
    return Array.from(map.values()).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  }, [livePetugas, overrides]);

  const [formOfficer, setFormOfficer] = useState<string>(
    () => officerOptions[0]?.nama || DEFAULT_SECURITY_OFFICER_NAMES[0]
  );
  const [customOfficerMode, setCustomOfficerMode] = useState<boolean>(false);
  const [customOfficerName, setCustomOfficerName] = useState<string>('');
  const [formShiftName, setFormShiftName] = useState<string>(STANDARD_SECURITY_SHIFTS[3]); // Lembur Minggu (19:00-07:00)
  const [formShiftDate, setFormShiftDate] = useState<string>(() => getNearestSundayWibDateStr());
  const [formNominalInput, setFormNominalInput] = useState<string>(() =>
    String(getDefaultOvertimeAmount())
  );
  const [formNotes, setFormNotes] = useState<string>('');
  const [formPayImmediately, setFormPayImmediately] = useState<boolean>(false);
  const [submittingForm, setSubmittingForm] = useState<boolean>(false);

  // Filter Daftar Jadwal
  const [filterMonth, setFilterMonth] = useState<string>(() => getWibParts().monthStr);
  const [filterOfficer, setFilterOfficer] = useState<string>('semua');
  const [filterPayment, setFilterPayment] = useState<'semua' | 'unpaid' | 'paid'>('semua');

  // Modal Bayar Lembur Sekarang
  const [payModalTarget, setPayModalTarget] = useState<SecurityShiftOverride | null>(null);
  const [payModalAmountInput, setPayModalAmountInput] = useState<string>('');
  const [payingOverride, setPayingOverride] = useState<boolean>(false);

  // Modal Edit Jadwal Shift / Nama Petugas / Nominal
  const [editTarget, setEditTarget] = useState<SecurityShiftOverride | null>(null);
  const [editOfficerName, setEditOfficerName] = useState<string>('');
  const [editShiftName, setEditShiftName] = useState<string>('');
  const [editShiftDate, setEditShiftDate] = useState<string>('');
  const [editNominalInput, setEditNominalInput] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // Modal Konfirmasi Hapus Jadwal & Pembatalan Pembayaran Lembur
  const [deleteTarget, setDeleteTarget] = useState<SecurityShiftOverride | null>(null);
  const [deletingOverride, setDeletingOverride] = useState<boolean>(false);
  const [cancelPayTarget, setCancelPayTarget] = useState<SecurityShiftOverride | null>(null);
  const [cancelingPay, setCancelingPay] = useState<boolean>(false);

  // Pencairan Honor Rutin Keamanan (Terpusat — Satu Pintu Anti Double-Input)
  const [honorOfficer, setHonorOfficer] = useState<string>(
    () => officerOptions[0]?.nama || DEFAULT_SECURITY_OFFICER_NAMES[0]
  );
  const [honorTermin, setHonorTermin] = useState<string>(TERMIN_PENGELUARAN_LIST[0]);
  const [honorDate, setHonorDate] = useState<string>(() => getWibParts().dateStr);
  const [honorNominalStr, setHonorNominalStr] = useState<string>('');
  const [honorNotes, setHonorNotes] = useState<string>('');
  const [submittingHonor, setSubmittingHonor] = useState<boolean>(false);
  const [deleteHonorTarget, setDeleteHonorTarget] = useState<TransaksiKas | null>(null);
  const [deletingHonor, setDeletingHonor] = useState<boolean>(false);
  const [previewKwitansi, setPreviewKwitansi] = useState<TransaksiKas | null>(null);

  useEffect(() => {
    if (!formOfficer && officerOptions.length > 0) {
      setFormOfficer(officerOptions[0].nama);
    }
    if (!honorOfficer && officerOptions.length > 0) {
      setHonorOfficer(officerOptions[0].nama);
    }
  }, [officerOptions, formOfficer, honorOfficer]);

  const loadAll = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [ovRows, attRows, freshPetugas] = await Promise.all([
          fetchShiftOverrides(session, { limit: 250 }),
          fetchSecurityAttendance(session, { limit: 300 }),
          fetchPetugasListAdmin(session),
        ]);
        setOverrides(ovRows);
        setAttendanceRecords(attRows);
        if (freshPetugas.length > 0) {
          setLivePetugas(
            freshPetugas
              .filter((p) => p.aktif !== false)
              .map((p) => ({ id: p.id, nama: p.nama, no_hp: p.no_hp, shift: p.shift }))
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session]
  );

  useEffect(() => {
    void loadAll(false);
    const unsubOv = subscribeShiftOverrides(session, () => {
      void loadAll(true);
    });
    const unsubAtt = subscribeSecurityAttendance(session, () => {
      void loadAll(true);
    });
    const unsubPetugas = subscribePetugasKeamananRealtime(session, () => {
      void loadAll(true);
    });
    return () => {
      unsubOv();
      unsubAtt();
      unsubPetugas();
    };
  }, [session, loadAll]);

  const effectiveFormOfficer = customOfficerMode ? customOfficerName.trim() : formOfficer.trim();
  const isFormLembur = isSundayOvertimeShift(formShiftName);
  const parsedFormNominal = Math.max(0, Math.round(Number(formNominalInput) || 0));

  const handleShiftTypeChange = (nextShift: string) => {
    setFormShiftName(nextShift);
    if (isSundayOvertimeShift(nextShift)) {
      setFormShiftDate(getNearestSundayWibDateStr());
      if (parsedFormNominal <= 0) {
        setFormNominalInput(String(defaultNominal));
      }
    } else {
      setFormShiftDate(getWibParts().dateStr);
      setFormPayImmediately(false);
    }
  };

  const handleSaveDefaultNominal = () => {
    const raw = Math.round(Number(defaultNominalInput) || 0);
    if (raw < 0 || raw > 50_000_000) {
      onToast('error', 'Masukkan nominal default lembur yang valid.');
      return;
    }
    const saved = setDefaultOvertimeAmount(raw);
    setDefaultNominal(saved);
    setDefaultNominalInput(String(saved));
    if (isFormLembur) {
      setFormNominalInput(String(saved));
    }
    onToast('success', `Nominal default Lembur Minggu diperbarui menjadi ${formatRupiah(saved)}.`);
  };

  const resolveOfficerPetugasId = useCallback(
    (officerName: string): string | null => {
      const matched = livePetugas.find((p) => isSameOfficerName(p.nama, officerName));
      return matched?.id || null;
    },
    [livePetugas]
  );

  const findMatchedAttendance = useCallback(
    (ov: SecurityShiftOverride): SecurityAttendanceRecord | null => {
      const sameDateOfficer = attendanceRecords.filter(
        (att) =>
          att.shift_date === ov.shift_date && isSameOfficerName(att.officer_name, ov.officer_name)
      );
      if (sameDateOfficer.length === 0) return null;
      const ovIsLembur = isSundayOvertimeShift(ov.shift_name);
      return (
        sameDateOfficer.find((att) => isSundayOvertimeShift(att.shift_name) === ovIsLembur) ||
        sameDateOfficer[0]
      );
    },
    [attendanceRecords]
  );

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingForm) return;
    if (!effectiveFormOfficer || !formShiftDate.trim()) {
      onToast('error', 'Pilih atau ketik nama petugas serta tanggal shift terlebih dahulu.');
      return;
    }
    if (isFormLembur && formPayImmediately && parsedFormNominal <= 0) {
      onToast('error', 'Nominal Lembur (Rp) harus lebih dari 0 untuk langsung dibayarkan ke Kas.');
      return;
    }

    setSubmittingForm(true);
    try {
      const res = await createShiftOverrideAdmin(session, {
        shift_date: formShiftDate,
        officer_name: effectiveFormOfficer,
        petugas_id: resolveOfficerPetugasId(effectiveFormOfficer),
        shift_name: formShiftName,
        overtime_amount: isFormLembur ? parsedFormNominal : 0,
        notes: formNotes,
        payImmediately: isFormLembur ? formPayImmediately : false,
      });

      if (!res.ok) {
        onToast('error', res.message);
        return;
      }

      onToast('success', res.message);
      if (customOfficerMode) {
        setFormOfficer(effectiveFormOfficer);
        setCustomOfficerMode(false);
        setCustomOfficerName('');
      }
      setFormNotes('');
      setFormPayImmediately(false);
      await loadAll(true);
      if (isFormLembur && formPayImmediately) {
        await onCashChanged();
      }
    } finally {
      setSubmittingForm(false);
    }
  };

  const openEditModal = (ov: SecurityShiftOverride) => {
    setEditTarget(ov);
    setEditOfficerName(ov.officer_name);
    setEditShiftName(ov.shift_name);
    setEditShiftDate(ov.shift_date);
    setEditNominalInput(String(ov.overtime_amount || 0));
    setEditNotes(ov.notes || '');
  };

  const handleConfirmEdit = async () => {
    if (!editTarget || savingEdit) return;
    setSavingEdit(true);
    try {
      const res = await updateShiftOverrideAdmin(session, editTarget.id, {
        officer_name: editOfficerName,
        shift_date: editShiftDate,
        shift_name: editShiftName,
        overtime_amount: isSundayOvertimeShift(editShiftName)
          ? Math.max(0, Math.round(Number(editNominalInput) || 0))
          : 0,
        notes: editNotes,
      });
      if (!res.ok) {
        onToast('error', res.message);
        return;
      }
      setEditTarget(null);
      onToast('success', res.message);
      await loadAll(true);
    } finally {
      setSavingEdit(false);
    }
  };

  const openPayModal = (ov: SecurityShiftOverride) => {
    if (ov.payment_status === 'paid' || ov.cash_transaction_id) {
      onToast('info', 'Lembur ini sudah berstatus LUNAS dan tercatat di Buku Kas.');
      return;
    }
    setPayModalTarget(ov);
    setPayModalAmountInput(String(ov.overtime_amount > 0 ? ov.overtime_amount : defaultNominal));
  };

  const handleConfirmPayOvertime = async () => {
    if (!payModalTarget || payingOverride) return;
    const amount = Math.round(Number(payModalAmountInput) || 0);
    if (amount <= 0 || amount > 50_000_000) {
      onToast('error', 'Nominal lembur harus lebih dari Rp 0.');
      return;
    }

    setPayingOverride(true);
    try {
      const res = await payOvertimeForShiftOverrideAdmin(session, payModalTarget, {
        overtimeAmount: amount,
        petugasId: resolveOfficerPetugasId(payModalTarget.officer_name),
      });

      if (!res.ok) {
        onToast('error', res.message);
        return;
      }

      setPayModalTarget(null);
      setPayModalAmountInput('');
      onToast('success', `Pembayaran lembur LUNAS — ${res.message}`);
      await loadAll(true);
      await onCashChanged();
    } finally {
      setPayingOverride(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deletingOverride) return;
    const wasPaid =
      deleteTarget.payment_status === 'paid' || Boolean(deleteTarget.cash_transaction_id);

    setDeletingOverride(true);
    try {
      const res = await deleteShiftOverrideWithCashSyncAdmin(session, deleteTarget);
      if (!res.ok) {
        onToast('error', res.message);
        return;
      }
      setDeleteTarget(null);
      onToast('success', res.message);
      await loadAll(true);
      if (wasPaid) {
        await onCashChanged();
      }
    } finally {
      setDeletingOverride(false);
    }
  };

  const handleConfirmCancelOvertimePayment = async () => {
    if (!cancelPayTarget || cancelingPay) return;
    setCancelingPay(true);
    try {
      const res = await cancelOvertimePaymentWithCashSyncAdmin(session, cancelPayTarget);
      if (!res.ok) {
        onToast('error', res.message);
        return;
      }
      setCancelPayTarget(null);
      onToast('info', res.message);
      await loadAll(true);
      await onCashChanged();
    } finally {
      setCancelingPay(false);
    }
  };

  // Riwayat Pencairan Honor Rutin Keamanan yang tercatat di Buku Kas
  const honorRutinKasList = useMemo(() => {
    return transaksiKasList
      .filter((trx) => {
        if (trx.jenis !== 'pengeluaran') return false;
        if (trx.status_verifikasi === 'Ditolak') return false;
        if (trx.shift_override_id) return false;
        const katLower = trx.kategori.toLowerCase();
        const isSecurityCat =
          katLower.includes('honor') || katLower.includes('keamanan') || katLower.includes('satpam');
        if (trx.jenis_honor === 'honor_rutin') return true;
        if (trx.jenis_honor === 'lembur') return false;
        return isSecurityCat && !katLower.includes('lembur');
      })
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal) || b.created_at.localeCompare(a.created_at));
  }, [transaksiKasList]);

  const filteredHonorRutinList = useMemo(() => {
    return honorRutinKasList.filter((trx) => {
      if (filterMonth && !trx.tanggal.startsWith(filterMonth)) return false;
      if (
        filterOfficer !== 'semua' &&
        !isSameOfficerName(
          trx.penerima_atau_sumber.replace(/\s*\(Petugas Keamanan\)$/i, ''),
          filterOfficer
        )
      ) {
        return false;
      }
      return true;
    });
  }, [honorRutinKasList, filterMonth, filterOfficer]);

  const parsedHonorNominal = useMemo(() => {
    const clean = honorNominalStr.replace(/\D/g, '');
    return clean ? Number(clean) : 0;
  }, [honorNominalStr]);

  const duplicateHonorRutinWarning = useMemo(() => {
    if (!honorOfficer || !honorDate || honorTermin === 'Insidental') return null;
    const monthPrefix = honorDate.slice(0, 7);
    return (
      honorRutinKasList.find(
        (trx) =>
          trx.tanggal.startsWith(monthPrefix) &&
          (trx.termin || '') === honorTermin &&
          isSameOfficerName(
            trx.penerima_atau_sumber.replace(/\s*\(Petugas Keamanan\)$/i, ''),
            honorOfficer
          )
      ) || null
    );
  }, [honorRutinKasList, honorOfficer, honorDate, honorTermin]);

  const handleSubmitHonorRutin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingHonor) return;
    const officerName = honorOfficer.trim();
    if (!officerName || !honorDate) {
      onToast('error', 'Pilih petugas keamanan dan tanggal pencairan honor terlebih dahulu.');
      return;
    }
    if (parsedHonorNominal <= 0 || parsedHonorNominal > 50_000_000) {
      onToast('error', 'Masukkan nominal Honor Rutin yang valid (> Rp 0).');
      return;
    }
    if (duplicateHonorRutinWarning) {
      onToast(
        'error',
        `Honor Rutin ${honorTermin} untuk ${officerName} pada bulan ini sudah tercatat (${duplicateHonorRutinWarning.no_bukti}). Batalkan terlebih dahulu atau pilih termin lain.`
      );
      return;
    }

    setSubmittingHonor(true);
    try {
      const petugasId = resolveOfficerPetugasId(officerName);
      const defaultKet = `Honor Rutin Keamanan (${honorTermin}) - ${officerName}`;
      const finalKet = honorNotes.trim()
        ? `${defaultKet} · ${honorNotes.trim()}`
        : defaultKet;

      const res = await createTransaksiKasAdmin(session, {
        jenis: 'pengeluaran',
        kategori: 'Honor & Lembur Keamanan',
        termin: honorTermin,
        tanggal: honorDate,
        nominal: parsedHonorNominal,
        penerima_atau_sumber: officerName,
        keterangan: finalKet,
        petugas_id: petugasId,
        jenis_honor: 'honor_rutin',
        autoVerify: true,
      });

      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mencatat pencairan Honor Rutin ke Kas.');
        return;
      }

      onToast(
        'success',
        `Honor Rutin ${formatRupiah(res.data.nominal)} untuk ${officerName} (${res.data.no_bukti}) dicairkan — Saldo Kas terpotong, masuk LPJ & e-Kwitansi tampil di Tab Honor Petugas.`
      );
      setHonorNominalStr('');
      setHonorNotes('');
      await onCashChanged();
    } finally {
      setSubmittingHonor(false);
    }
  };

  const handleConfirmDeleteHonorRutin = async () => {
    if (!deleteHonorTarget || deletingHonor) return;
    setDeletingHonor(true);
    try {
      const res = await deleteTransaksiKasAdmin(session, deleteHonorTarget);
      if (res.error) {
        onToast('error', res.error);
        return;
      }
      setDeleteHonorTarget(null);
      onToast(
        'info',
        `Pencairan Honor Rutin ${deleteHonorTarget.no_bukti} dibatalkan — transaksi di Buku Kas & Tab Honor Petugas otomatis terhapus.`
      );
      await onCashChanged();
    } finally {
      setDeletingHonor(false);
    }
  };

  const findLinkedCashForOverride = useCallback(
    (ov: SecurityShiftOverride): TransaksiKas | null => {
      return (
        transaksiKasList.find(
          (trx) =>
            (ov.cash_transaction_id && trx.id === ov.cash_transaction_id) ||
            (trx.shift_override_id && trx.shift_override_id === ov.id)
        ) || null
      );
    },
    [transaksiKasList]
  );

  const filteredOverrides = useMemo(() => {
    return overrides.filter((ov) => {
      if (filterMonth && !ov.shift_date.startsWith(filterMonth)) return false;
      if (filterOfficer !== 'semua' && !isSameOfficerName(ov.officer_name, filterOfficer)) {
        return false;
      }
      if (filterPayment === 'paid' && ov.payment_status !== 'paid') return false;
      if (filterPayment === 'unpaid' && ov.payment_status !== 'unpaid') return false;
      return true;
    });
  }, [overrides, filterMonth, filterOfficer, filterPayment]);

  const monthOvertimeSummary = useMemo(() => {
    const monthLembur = overrides.filter(
      (ov) =>
        isSundayOvertimeShift(ov.shift_name) &&
        (!filterMonth || ov.shift_date.startsWith(filterMonth))
    );
    const paidItems = monthLembur.filter(
      (ov) => ov.payment_status === 'paid' || Boolean(ov.cash_transaction_id)
    );
    const unpaidItems = monthLembur.filter(
      (ov) => ov.payment_status !== 'paid' && !ov.cash_transaction_id
    );
    return {
      totalCount: monthLembur.length,
      paidCount: paidItems.length,
      paidTotal: paidItems.reduce((sum, o) => sum + o.overtime_amount, 0),
      unpaidCount: unpaidItems.length,
      unpaidTotal: unpaidItems.reduce((sum, o) => sum + o.overtime_amount, 0),
    };
  }, [overrides, filterMonth]);

  const payModalAttendance = payModalTarget ? findMatchedAttendance(payModalTarget) : null;

  return (
    <div className="space-y-5">
      {/* RINGKASAN KPI LEMBUR & KAS KEAMANAN */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="glass-hero text-white rounded-3xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[#F6F3EA]/90">Lembur Dibayar (LUNAS)</p>
            <CheckCircle2 className="w-4 h-4 text-[#E5EEE3] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-[#E5EEE3] tabular-nums mt-2">
            {formatRupiah(monthOvertimeSummary.paidTotal)}
          </p>
          <p className="text-[11px] text-[#F6F3EA]/80 mt-1 tabular-nums">
            {monthOvertimeSummary.paidCount} jadwal tercatat otomatis di Buku Kas
          </p>
        </div>

        <div className="glass-card rounded-3xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-[#6E786D]">Menunggu Pembayaran</p>
            <Clock className="w-4 h-4 text-[#8A5F16] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-[#8A5F16] tabular-nums mt-2">
            {formatRupiah(monthOvertimeSummary.unpaidTotal)}
          </p>
          <p className="text-[11px] text-[#6E786D] mt-1 tabular-nums">
            {monthOvertimeSummary.unpaidCount} jadwal Lembur Minggu belum dibayar
          </p>
        </div>

        {/* Pengaturan Cepat Tarif Default Lembur Minggu */}
        <div className="glass-card rounded-3xl p-4 sm:p-5 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[#1B271B]">Default Tarif Lembur Minggu</p>
            <Banknote className="w-4 h-4 text-[#243825] shrink-0" />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={50000000}
              step={5000}
              value={defaultNominalInput}
              onChange={(e) => setDefaultNominalInput(e.target.value)}
              aria-label="Tarif default lembur minggu dalam rupiah"
              className="w-full min-h-[40px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-mono font-bold text-[#1B271B] tabular-nums focus:bg-white focus:border-[#2B3F29] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSaveDefaultNominal}
              className="min-h-[40px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Simpan</span>
            </button>
          </div>
          <p className="text-[11px] text-[#6E786D]">
            Nilai otomatis terisi saat membuat jadwal Lembur Minggu (19:00–07:00 WIB).
          </p>
        </div>
      </section>

      {/* FORM TAMBAH JADWAL SHIFT & PEMBAYARAN LEMBUR MINGGU */}
      <section className="glass-card rounded-3xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#2B3F29] text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
              <Moon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#1B271B] leading-tight">
                Kelola Shift &amp; Lembur Keamanan
              </h2>
              <p className="text-xs text-[#6E786D] mt-0.5">
                Jadwalkan shift atau Lembur Minggu (19:00–07:00 WIB) dan integrasikan pencairan
                langsung ke Kas Pengeluaran &amp; Tab Honor Petugas.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadAll(true)}
            className="min-h-[38px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-xs font-semibold text-[#4A554A] inline-flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Sinkronkan</span>
          </button>
        </div>

        <form onSubmit={(e) => void handleCreateSubmit(e)} className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <div>
              <label
                htmlFor="shift-ov-officer"
                className="block text-xs font-bold text-[#4A554A] mb-1.5"
              >
                Petugas Keamanan
              </label>
              <select
                id="shift-ov-officer"
                value={customOfficerMode ? '__custom__' : formOfficer}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setCustomOfficerMode(true);
                  } else {
                    setCustomOfficerMode(false);
                    setFormOfficer(e.target.value);
                  }
                }}
                className="w-full min-h-[44px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-medium text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
              >
                {officerOptions.map((opt) => (
                  <option key={opt.nama} value={opt.nama}>
                    {opt.nama}
                  </option>
                ))}
                <option value="__custom__">+ Tambah Nama Petugas Baru...</option>
              </select>
              {customOfficerMode && (
                <input
                  type="text"
                  value={customOfficerName}
                  onChange={(e) => setCustomOfficerName(e.target.value)}
                  placeholder="Ketik nama petugas baru..."
                  className="mt-2 w-full min-h-[40px] rounded-xl border border-[#C6D2BF] bg-[#E5EEE3]/40 px-3 text-xs sm:text-sm text-[#1B271B] focus:bg-[#FFFDF8] focus:border-[#2B3F29] focus:outline-none"
                />
              )}
            </div>

            <div>
              <label
                htmlFor="shift-ov-type"
                className="block text-xs font-bold text-[#4A554A] mb-1.5"
              >
                Jenis Jadwal Shift
              </label>
              <select
                id="shift-ov-type"
                value={formShiftName}
                onChange={(e) => handleShiftTypeChange(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-medium text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
              >
                <option value={STANDARD_SECURITY_SHIFTS[3]}>
                  Lembur Minggu (19:00-07:00)
                </option>
                <option value={STANDARD_SECURITY_SHIFTS[0]}>Shift 1 (07:00-15:00)</option>
                <option value={STANDARD_SECURITY_SHIFTS[1]}>Shift 2 (15:00-23:00)</option>
                <option value={STANDARD_SECURITY_SHIFTS[2]}>Shift 3 (23:00-07:00)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="shift-ov-date"
                className="block text-xs font-bold text-[#4A554A] mb-1.5"
              >
                Tanggal Mulai Shift (WIB)
              </label>
              <input
                id="shift-ov-date"
                type="date"
                required
                value={formShiftDate}
                onChange={(e) => setFormShiftDate(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-mono text-[#1B271B] tabular-nums focus:border-[#2B3F29] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="shift-ov-notes"
                className="block text-xs font-bold text-[#4A554A] mb-1.5"
              >
                Catatan Jadwal (Opsional)
              </label>
              <input
                id="shift-ov-notes"
                type="text"
                maxLength={300}
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Misal: Pengganti jaga malam Minggu..."
                className="w-full min-h-[44px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm text-[#1B271B] placeholder:text-[#6E786D] focus:border-[#2B3F29] focus:outline-none"
              />
            </div>
          </div>

          {/* KONTROL KHUSUS LEMBUR MINGGU: NOMINAL & OPSI BAYAR LANGSUNG KE KAS */}
          {isFormLembur && (
            <div className="rounded-2xl bg-[#F7F4EC]/85 border border-[#E6E2D6] p-4 space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-end">
                <div>
                  <label
                    htmlFor="shift-ov-nominal"
                    className="block text-xs font-bold text-[#243825] mb-1.5"
                  >
                    Nominal Lembur (Rp)
                  </label>
                  <input
                    id="shift-ov-nominal"
                    type="number"
                    min={0}
                    max={50000000}
                    step={5000}
                    value={formNominalInput}
                    onChange={(e) => setFormNominalInput(e.target.value)}
                    placeholder="Contoh: 100000"
                    className="w-full min-h-[44px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3.5 text-sm font-mono font-bold text-[#1B271B] tabular-nums focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                  />
                  <p className="text-[11px] text-[#243825] mt-1 font-mono tabular-nums">
                    Terbaca: <strong>{formatRupiah(parsedFormNominal)}</strong>
                  </p>
                </div>

                <label className="flex items-start gap-3 rounded-2xl bg-[#FFFDF8] border border-[#E6E2D6] px-3.5 py-3 cursor-pointer hover:border-[#C6D2BF] transition">
                  <input
                    type="checkbox"
                    checked={formPayImmediately}
                    onChange={(e) => setFormPayImmediately(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#C6D2BF] accent-[#2B3F29] cursor-pointer shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-[#1B271B] leading-tight">
                      Langsung Bayarkan &amp; Catat ke Kas
                    </p>
                    <p className="text-[11px] text-[#6E786D] mt-0.5 leading-snug">
                      Otomatis membuat pengeluaran <strong>Terverifikasi</strong> di Buku Kas &amp;
                      memotong Saldo Kas saat ini juga.
                    </p>
                  </div>
                </label>
              </div>

              {formPayImmediately && (
                <div className="rounded-2xl glass-hero text-[#F6F3EA] px-4 py-3 text-xs space-y-1">
                  <p className="font-bold text-[#E5EEE3]">
                    Pratinjau Pencatatan Otomatis ke Buku Kas (transaksi_kas):
                  </p>
                  <p>
                    <span className="text-[#F6F3EA]/75">Kategori:</span>{' '}
                    <strong>Honor &amp; Lembur Keamanan</strong>
                  </p>
                  <p className="break-words">
                    <span className="text-[#F6F3EA]/75">Keterangan:</span>{' '}
                    <span className="font-mono text-white">
                      {buildOvertimeCashDescription(
                        effectiveFormOfficer || 'Petugas',
                        formShiftDate
                      )}
                    </span>
                  </p>
                  <p className="font-mono tabular-nums">
                    <span className="text-[#F6F3EA]/75 font-sans">Nominal Pengeluaran:</span>{' '}
                    <strong className="text-[#E5EEE3]">{formatRupiah(parsedFormNominal)}</strong>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-[#6E786D]">
              Jadwal otomatis tampil di Tab <strong>Info &amp; Shift</strong>, mendeteksi shift saat{' '}
              <strong>Absensi / Patroli</strong>, dan sinkron ke Tab <strong>Honor</strong> petugas.
            </p>
            <button
              type="submit"
              disabled={submittingForm}
              className="min-h-[44px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm whitespace-nowrap transition-colors"
            >
              {submittingForm ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>
                {submittingForm
                  ? 'Menyimpan...'
                  : isFormLembur && formPayImmediately
                    ? 'Simpan & Bayar Lembur ke Kas'
                    : 'Simpan Jadwal Shift / Lembur'}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* DAFTAR JADWAL SHIFT & LEMBUR + SINKRONISASI ABSENSI + PEMBAYARAN ANTI-GANDA */}
      <section className="glass-card rounded-3xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#1B271B]">
              Daftar Jadwal Shift &amp; Status Pembayaran Lembur
            </h3>
            <p className="text-xs text-[#6E786D] mt-0.5">
              Verifikasi kehadiran absensi petugas sebelum membayarkan uang lembur ke Buku Kas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              aria-label="Filter bulan jadwal"
              className="min-h-[38px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] px-3.5 text-xs font-mono font-semibold text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
            />
            <select
              value={filterOfficer}
              onChange={(e) => setFilterOfficer(e.target.value)}
              aria-label="Filter petugas"
              className="min-h-[38px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] px-3.5 text-xs font-semibold text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
            >
              <option value="semua">Semua Petugas</option>
              {officerOptions.map((opt) => (
                <option key={opt.nama} value={opt.nama}>
                  {opt.nama}
                </option>
              ))}
            </select>
            <div className="inline-flex p-1 bg-[#F7F4EC] border border-[#E6E2D6] rounded-2xl">
              {(
                [
                  { id: 'semua', label: 'Semua' },
                  { id: 'unpaid', label: 'Belum Dibayar' },
                  { id: 'paid', label: 'LUNAS' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterPayment(tab.id)}
                  className={`min-h-[30px] px-3 rounded-xl text-[11px] font-bold transition cursor-pointer ${
                    filterPayment === tab.id
                      ? 'bg-[#2B3F29] text-white shadow-xs'
                      : 'text-[#6E786D] hover:text-[#243825]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            <div className="h-20 rounded-xl bg-[#E5EEE3]/50 animate-pulse" />
            <div className="h-20 rounded-xl bg-[#E5EEE3]/50 animate-pulse" />
          </div>
        ) : filteredOverrides.length === 0 ? (
          <div className="px-5 py-10 text-center space-y-2">
            <Calendar className="w-8 h-8 text-[#C6D2BF] mx-auto" />
            <p className="text-sm font-bold text-[#1B271B]">
              Belum Ada Jadwal Shift / Lembur pada Filter Ini
            </p>
            <p className="text-xs text-[#6E786D] max-w-sm mx-auto">
              Tambahkan jadwal Lembur Minggu (19:00–07:00 WIB) atau penyesuaian shift di formulir
              atas untuk mulai sinkronisasi dengan Absensi, Honor Petugas, dan Buku Kas.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E6E2D6]/70">
            {filteredOverrides.map((ov) => {
              const isLembur = isSundayOvertimeShift(ov.shift_name);
              const isPaid = ov.payment_status === 'paid' || Boolean(ov.cash_transaction_id);
              const matchedAtt = findMatchedAttendance(ov);

              return (
                <article
                  key={ov.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#F7F4EC]/70 transition-colors"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <p className="text-sm sm:text-base font-bold text-[#1B271B]">
                        {ov.officer_name}
                      </p>
                      <span className="text-[#C6D2BF]" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs font-semibold text-[#4A554A] tabular-nums">
                        {formatWibDateStr(ov.shift_date)}
                      </span>
                      <span className="text-[#C6D2BF]" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          isLembur ? 'text-[#243825]' : 'text-[#4A554A]'
                        }`}
                      >
                        {ov.shift_name}
                      </span>
                    </div>

                    {/* Indikator Sinkronisasi Absensi Petugas */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {matchedAtt ? (
                        matchedAtt.status === 'completed' ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#243825]">
                            <UserCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Absensi Terverifikasi: Masuk {formatWibTime(matchedAtt.clock_in_at)} –
                              Pulang {formatWibTime(matchedAtt.clock_out_at)}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[#243825]">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C6D2BF] opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2B3F29]" />
                            </span>
                            <span>
                              Sedang Bertugas (Masuk {formatWibTime(matchedAtt.clock_in_at)})
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-[#6E786D]">
                          <Clock className="w-3.5 h-3.5 text-[#6E786D] shrink-0" />
                          <span>Belum ada catatan Absen Masuk pada tanggal shift ini</span>
                        </span>
                      )}
                    </div>

                    {ov.notes && (
                      <p className="text-xs text-[#4A554A] bg-[#F7F4EC]/80 border border-[#E6E2D6] rounded-xl px-3 py-1.5 max-w-xl">
                        {ov.notes}
                      </p>
                    )}

                    {isLembur && isPaid && ov.paid_at && (
                      <p className="text-[11px] font-medium text-[#243825]">
                        Dibayarkan &amp; tercatat di Buku Kas pada {formatWibDateTime(ov.paid_at)}
                      </p>
                    )}
                  </div>

                  {/* Sisi Kanan: Nominal, Status Pembayaran & Tombol Aksi */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-3 shrink-0">
                    {isLembur && (
                      <div className="text-left lg:text-right">
                        <p className="text-base font-mono font-extrabold text-[#1B271B] tabular-nums">
                          {formatRupiah(ov.overtime_amount)}
                        </p>
                        <p
                          className={`text-xs font-extrabold mt-0.5 ${
                            isPaid ? 'text-[#243825]' : 'text-[#8A5F16]'
                          }`}
                        >
                          {isPaid ? 'SUDAH DIBAYAR / CAIR' : 'BELUM DIBAYAR'}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {isLembur &&
                        (isPaid ? (
                          <>
                            <span
                              title="Sudah dibayarkan & tercatat di Buku Kas (anti pencatatan ganda)"
                              className="min-h-[40px] px-3.5 rounded-full bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
                            >
                              <ShieldCheck className="w-4 h-4 shrink-0" />
                              <span>Sudah Cair</span>
                            </span>
                            {(() => {
                              const linkedTrx = findLinkedCashForOverride(ov);
                              return linkedTrx ? (
                                <button
                                  type="button"
                                  onClick={() => setPreviewKwitansi(linkedTrx)}
                                  className="min-h-[40px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#1B271B] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                                >
                                  <FileText className="w-3.5 h-3.5 shrink-0" />
                                  <span>Kwitansi</span>
                                </button>
                              ) : null;
                            })()}
                            <button
                              type="button"
                              onClick={() => setCancelPayTarget(ov)}
                              title="Batalkan pencairan & hapus transaksi terkait di Buku Kas"
                              className="min-h-[40px] px-3.5 rounded-full border border-[#E2C285] bg-[#F2D8A7]/50 hover:bg-[#F2D8A7]/80 text-[#4A3410] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                            >
                              <Undo2 className="w-3.5 h-3.5 shrink-0" />
                              <span>Batalkan Cair</span>
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPayModal(ov)}
                            className="min-h-[40px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs transition-colors"
                          >
                            <Banknote className="w-4 h-4 shrink-0" />
                            <span>Bayar Lembur Sekarang</span>
                          </button>
                        ))}

                      {!isPaid && (
                        <button
                          type="button"
                          onClick={() => openEditModal(ov)}
                          aria-label={`Edit jadwal ${ov.officer_name}`}
                          className="min-h-[40px] min-w-[40px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 hover:text-[#243825] text-[#6E786D] flex items-center justify-center cursor-pointer transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setDeleteTarget(ov)}
                        aria-label={`Hapus jadwal ${ov.officer_name}`}
                        className="min-h-[40px] min-w-[40px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#C87058]/10 hover:border-[#E2A898] hover:text-[#9A422B] text-[#6E786D] flex items-center justify-center cursor-pointer transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* PENCAIRAN HONOR RUTIN PETUGAS KEAMANAN (TERPUSAT — OTOMATIS KE BUKU KAS, LPJ & TAB HONOR PETUGAS) */}
      <section className="glass-card rounded-3xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0 mt-0.5">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-[#1B271B] leading-tight">
                Pencairan Honor Rutin Petugas Keamanan
              </h3>
              <p className="text-xs text-[#6E786D] mt-0.5">
                Cairkan honor rutin (Termin Tgl 7 / Tgl 18 / Bulanan) langsung dari sini — otomatis
                tercatat di Buku Kas, memotong Saldo Kas, masuk LPJ, &amp; tampil di Tab Honor Petugas.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-[#243825] bg-[#E5EEE3] border border-[#C6D2BF] rounded-full px-3 py-1 tabular-nums">
            {filteredHonorRutinList.length} pencairan
          </span>
        </div>

        <form onSubmit={(e) => void handleSubmitHonorRutin(e)} className="p-4 sm:p-5 border-b border-[#E6E2D6] space-y-3.5 bg-[#F6F3EA]/65">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label htmlFor="honor-rutin-officer" className="block text-xs font-bold text-[#4A554A] mb-1.5">
                Petugas Penerima
              </label>
              <select
                id="honor-rutin-officer"
                value={honorOfficer}
                onChange={(e) => setHonorOfficer(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-medium text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
              >
                {officerOptions.map((opt) => (
                  <option key={opt.nama} value={opt.nama}>
                    {opt.nama}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="honor-rutin-termin" className="block text-xs font-bold text-[#4A554A] mb-1.5">
                Termin / Periode
              </label>
              <select
                id="honor-rutin-termin"
                value={honorTermin}
                onChange={(e) => setHonorTermin(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-medium text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
              >
                {TERMIN_PENGELUARAN_LIST.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="honor-rutin-date" className="block text-xs font-bold text-[#4A554A] mb-1.5">
                Tanggal Pencairan
              </label>
              <input
                id="honor-rutin-date"
                type="date"
                required
                value={honorDate}
                onChange={(e) => setHonorDate(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-mono text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="honor-rutin-nominal" className="block text-xs font-bold text-[#4A554A] mb-1.5">
                Nominal Honor (Rp)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#6E786D]">
                  Rp
                </span>
                <input
                  id="honor-rutin-nominal"
                  type="text"
                  inputMode="numeric"
                  required
                  value={
                    parsedHonorNominal > 0
                      ? new Intl.NumberFormat('id-ID').format(parsedHonorNominal)
                      : ''
                  }
                  onChange={(e) => setHonorNominalStr(e.target.value.replace(/\D/g, ''))}
                  placeholder="Contoh: 750.000"
                  className="w-full min-h-[42px] rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] pl-9 pr-3 text-sm font-mono font-bold text-[#1B271B] tabular-nums focus:border-[#2B3F29] focus:outline-none"
                />
              </div>
              {parsedHonorNominal > 0 && (
                <p className="text-[11px] italic text-[#243825] mt-1">
                  {terbilangRupiah(parsedHonorNominal)}
                </p>
              )}
            </div>
          </div>

          {duplicateHonorRutinWarning && (
            <div className="rounded-xl bg-[#F2D8A7]/45 border border-[#E2C285] px-3.5 py-2.5 text-xs text-[#4A3410] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-[#8A5F16] shrink-0 mt-0.5" />
              <span>
                <strong>Anti-Input Ganda:</strong> Honor Rutin <strong>{honorTermin}</strong> untuk{' '}
                <strong>{honorOfficer}</strong> bulan ini sudah dicairkan ({duplicateHonorRutinWarning.no_bukti} ·{' '}
                {formatRupiah(duplicateHonorRutinWarning.nominal)}).
              </span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="text"
              maxLength={240}
              value={honorNotes}
              onChange={(e) => setHonorNotes(e.target.value)}
              placeholder="Catatan tambahan pencairan honor (opsional)..."
              className="flex-1 min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3.5 text-sm text-[#1B271B] placeholder:text-[#6E786D] focus:border-[#2B3F29] focus:outline-none"
            />
            <button
              type="submit"
              disabled={submittingHonor || Boolean(duplicateHonorRutinWarning)}
              className="min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap transition-colors shadow-sm"
            >
              {submittingHonor ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Banknote className="w-4 h-4 text-[#E5EEE3]" />
              )}
              <span>{submittingHonor ? 'Memproses...' : 'Bayar Honor Rutin & Catat ke Kas'}</span>
            </button>
          </div>
        </form>

        {/* Daftar Riwayat Pencairan Honor Rutin */}
        {filteredHonorRutinList.length === 0 ? (
          <div className="px-5 py-7 text-center text-xs text-[#6E786D]">
            Belum ada pencairan Honor Rutin pada bulan / filter petugas ini.
          </div>
        ) : (
          <div className="divide-y divide-[#E6E2D6]/70">
            {filteredHonorRutinList.map((trx) => (
              <article
                key={trx.id}
                className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F7F4EC]/70 transition-colors"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-bold text-[#1B271B]">{trx.penerima_atau_sumber}</span>
                    {trx.termin && (
                      <>
                        <span className="text-[#C6D2BF]">·</span>
                        <span className="font-semibold text-[#243825]">{trx.termin}</span>
                      </>
                    )}
                    <span className="text-[#C6D2BF]">·</span>
                    <span className="font-mono text-[#6E786D] tabular-nums">
                      {formatTanggalSingkat(trx.tanggal)}
                    </span>
                  </div>
                  {trx.keterangan && (
                    <p className="text-xs text-[#4A554A] line-clamp-2">{trx.keterangan}</p>
                  )}
                  <p className="text-[11px] font-mono text-[#6E786D]">
                    {trx.no_bukti} · Tercatat di Buku Kas &amp; Tab Honor Petugas
                  </p>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                  <p className="text-base font-mono font-extrabold text-[#1B271B] tabular-nums">
                    {formatRupiah(trx.nominal)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPreviewKwitansi(trx)}
                    className="min-h-[38px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] text-[#243825] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span>Kwitansi</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteHonorTarget(trx)}
                    aria-label={`Batalkan honor ${trx.no_bukti}`}
                    title="Batalkan / hapus pencairan honor (otomatis terhapus dari Buku Kas & Tab Honor Petugas)"
                    className="min-h-[38px] min-w-[38px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#C87058]/10 hover:border-[#E2A898] hover:text-[#9A422B] text-[#6E786D] flex items-center justify-center cursor-pointer transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* MODAL KONFIRMASI PEMBAYARAN LEMBUR KE BUKU KAS */}
      {payModalTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Pembayaran Lembur Minggu"
        >
          <div className="bg-[#FFFDF8]/95 backdrop-blur-xl w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop pb-[env(safe-area-inset-bottom)]">
            <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#1B271B]">Bayar Lembur &amp; Catat ke Kas</h3>
                <p className="text-xs text-[#6E786D] mt-0.5">
                  {payModalTarget.officer_name} · {formatWibDateStr(payModalTarget.shift_date)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayModalTarget(null)}
                aria-label="Tutup modal pembayaran lembur"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[#E5EEE3]/60 flex items-center justify-center text-[#6E786D] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Status Verifikasi Absensi */}
              {payModalAttendance ? (
                <div className="rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] p-3 text-xs text-[#243825] flex items-start gap-2">
                  <UserCheck className="w-4 h-4 text-[#243825] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Absensi Petugas Terverifikasi</p>
                    <p className="mt-0.5">
                      Masuk {formatWibTime(payModalAttendance.clock_in_at)}
                      {payModalAttendance.clock_out_at
                        ? ` · Pulang ${formatWibTime(payModalAttendance.clock_out_at)}`
                        : ' · Sedang Bertugas'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl bg-[#F2D8A7]/45 border border-[#E2C285] p-3 text-xs text-[#4A3410] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#8A5F16] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Belum Ada Catatan Absensi Masuk</p>
                    <p className="mt-0.5">
                      Petugas belum tercatat Absen Masuk pada tanggal shift ini. Anda tetap dapat
                      membayarkan sekarang (pembayaran dimuka / tunai).
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="pay-modal-amount"
                  className="block text-xs font-bold text-[#4A554A] mb-1.5"
                >
                  Nominal Lembur Dibayarkan (Rp)
                </label>
                <input
                  id="pay-modal-amount"
                  type="number"
                  min={1000}
                  max={50000000}
                  step={5000}
                  value={payModalAmountInput}
                  onChange={(e) => setPayModalAmountInput(e.target.value)}
                  className="w-full min-h-[46px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3.5 text-base font-mono font-bold text-[#1B271B] tabular-nums focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                />
              </div>

              <div className="rounded-2xl bg-[#F7F4EC]/85 border border-[#E6E2D6] p-3.5 text-xs space-y-1">
                <p className="font-bold text-[#1B271B]">Detail Entri Otomatis Buku Kas:</p>
                <p className="text-[#4A554A]">
                  Kategori: <strong className="text-[#1B271B]">Honor &amp; Lembur Keamanan</strong>
                </p>
                <p className="text-[#4A554A] break-words">
                  Keterangan:{' '}
                  <strong className="text-[#1B271B] font-mono">
                    {buildOvertimeCashDescription(
                      payModalTarget.officer_name,
                      payModalTarget.shift_date
                    )}
                  </strong>
                </p>
                <p className="text-[#4A554A]">
                  Saldo Kas utama, Rekap Bulanan, dan LPJ langsung terpotong secara real-time.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#E6E2D6] bg-[#F7F4EC]/80 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={payingOverride}
                onClick={() => setPayModalTarget(null)}
                className="min-h-[44px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#4A554A] text-sm font-semibold cursor-pointer transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={payingOverride}
                onClick={() => void handleConfirmPayOvertime()}
                className="min-h-[44px] rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {payingOverride ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Banknote className="w-4 h-4" />
                )}
                <span>{payingOverride ? 'Memproses...' : 'Bayar & Catat Kas'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI HAPUS / BATALKAN JADWAL (SINKRON BUKU KAS) */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Hapus Jadwal Shift atau Lembur"
        >
          <div className="bg-[#FFFDF8]/95 backdrop-blur-xl w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop pb-[env(safe-area-inset-bottom)]">
            <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#1B271B]">Hapus / Batalkan Jadwal</h3>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                aria-label="Tutup konfirmasi hapus"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[#E5EEE3]/60 flex items-center justify-center text-[#6E786D] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-sm text-[#4A554A] leading-relaxed">
                Yakin ingin menghapus jadwal{' '}
                <strong className="text-[#1B271B]">{deleteTarget.shift_name}</strong> untuk{' '}
                <strong className="text-[#1B271B]">{deleteTarget.officer_name}</strong> tanggal{' '}
                <strong className="text-[#1B271B]">
                  {formatWibDateStr(deleteTarget.shift_date)}
                </strong>
                ?
              </p>

              {(deleteTarget.payment_status === 'paid' || deleteTarget.cash_transaction_id) && (
                <div className="rounded-2xl bg-[#C87058]/10 border border-[#E2A898] p-3.5 text-xs text-[#7A311E] flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[#9A422B] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">Sinkronisasi Penghapusan Buku Kas Aktif</p>
                    <p className="leading-relaxed">
                      Jadwal lembur ini sudah berstatus <strong>LUNAS</strong> (
                      {formatRupiah(deleteTarget.overtime_amount)}). Menghapus jadwal ini akan{' '}
                      <strong>otomatis menghapus transaksi pengeluaran terkait di Buku Kas</strong>{' '}
                      agar Saldo Kas utama kembali akurat.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#E6E2D6] bg-[#F7F4EC]/80 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={deletingOverride}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[44px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#4A554A] text-sm font-semibold cursor-pointer transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingOverride}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] rounded-full bg-[#C87058] hover:bg-[#B25C45] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {deletingOverride ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>{deletingOverride ? 'Menghapus...' : 'Ya, Hapus'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* MODAL EDIT JADWAL SHIFT / PETUGAS (SINKRON REAL-TIME KE BUKU KAS) */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Jadwal Shift atau Lembur"
        >
          <div className="bg-[#FFFDF8]/95 backdrop-blur-xl w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop pb-[env(safe-area-inset-bottom)]">
            <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#1B271B]">Edit Jadwal Shift / Lembur</h3>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                aria-label="Tutup modal edit jadwal"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[#E5EEE3]/60 flex items-center justify-center text-[#6E786D] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-[#4A554A] mb-1">Nama Petugas</label>
                <input
                  type="text"
                  value={editOfficerName}
                  onChange={(e) => setEditOfficerName(e.target.value)}
                  className="w-full min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#4A554A] mb-1">Jenis Shift</label>
                  <select
                    value={editShiftName}
                    onChange={(e) => setEditShiftName(e.target.value)}
                    className="w-full min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-xs sm:text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                  >
                    <option value={STANDARD_SECURITY_SHIFTS[3]}>Lembur Minggu (19:00-07:00)</option>
                    <option value={STANDARD_SECURITY_SHIFTS[0]}>Shift 1 (07:00-15:00)</option>
                    <option value={STANDARD_SECURITY_SHIFTS[1]}>Shift 2 (15:00-23:00)</option>
                    <option value={STANDARD_SECURITY_SHIFTS[2]}>Shift 3 (23:00-07:00)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#4A554A] mb-1">Tanggal</label>
                  <input
                    type="date"
                    value={editShiftDate}
                    onChange={(e) => setEditShiftDate(e.target.value)}
                    className="w-full min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-mono text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                  />
                </div>
              </div>
              {isSundayOvertimeShift(editShiftName) && (
                <div>
                  <label className="block text-xs font-bold text-[#4A554A] mb-1">
                    Nominal Lembur (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50000000}
                    step={5000}
                    value={editNominalInput}
                    onChange={(e) => setEditNominalInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm font-mono font-bold text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-[#4A554A] mb-1">Catatan</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full min-h-[42px] rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] px-3 text-sm text-[#1B271B] focus:border-[#2B3F29] focus:outline-none"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#E6E2D6] bg-[#F7F4EC]/80 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditTarget(null)}
                className="min-h-[44px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#4A554A] text-sm font-semibold cursor-pointer transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void handleConfirmEdit()}
                className="min-h-[44px] rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI BATALKAN PEMBAYARAN LEMBUR (JADWAL TETAP ADA, TRANSAKSI KAS DIHAPUS) */}
      {cancelPayTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Batalkan Pembayaran Lembur"
        >
          <div className="bg-[#FFFDF8]/95 backdrop-blur-xl w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop pb-[env(safe-area-inset-bottom)]">
            <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#1B271B]">Batalkan Pencairan Lembur</h3>
              <button
                type="button"
                onClick={() => setCancelPayTarget(null)}
                aria-label="Tutup modal batal pencairan"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[#E5EEE3]/60 flex items-center justify-center text-[#6E786D] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm text-[#4A554A]">
              <p className="leading-relaxed">
                Batalkan status <strong>Sudah Cair</strong> untuk lembur{' '}
                <strong className="text-[#1B271B]">{cancelPayTarget.officer_name}</strong> tanggal{' '}
                <strong className="text-[#1B271B]">{formatWibDateStr(cancelPayTarget.shift_date)}</strong>{' '}
                ({formatRupiah(cancelPayTarget.overtime_amount)})?
              </p>
              <div className="rounded-2xl bg-[#F2D8A7]/45 border border-[#E2C285] p-3.5 text-xs text-[#4A3410] flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#8A5F16] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Jadwal lembur tetap tersimpan dengan status <strong>Belum Dibayar</strong>, namun
                  transaksi pengeluaran terkait di <strong>Buku Kas</strong> dan{' '}
                  <strong>Tab Honor Petugas</strong> akan dihapus otomatis agar Saldo Kas &amp; LPJ
                  tetap sinkron.
                </p>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#E6E2D6] bg-[#F7F4EC]/80 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={cancelingPay}
                onClick={() => setCancelPayTarget(null)}
                className="min-h-[44px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#4A554A] text-sm font-semibold cursor-pointer transition-colors"
              >
                Kembali
              </button>
              <button
                type="button"
                disabled={cancelingPay}
                onClick={() => void handleConfirmCancelOvertimePayment()}
                className="min-h-[44px] rounded-full bg-[#C87058] hover:bg-[#B25C45] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {cancelingPay ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
                <span>{cancelingPay ? 'Membatalkan...' : 'Ya, Batalkan Cair'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI HAPUS PENCAIRAN HONOR RUTIN (SINKRON BUKU KAS & PORTAL PETUGAS) */}
      {deleteHonorTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Hapus Pencairan Honor Rutin"
        >
          <div className="bg-[#FFFDF8]/95 backdrop-blur-xl w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl overflow-hidden animate-modal-pop pb-[env(safe-area-inset-bottom)]">
            <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/80 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#1B271B]">Batalkan Pencairan Honor Rutin</h3>
              <button
                type="button"
                onClick={() => setDeleteHonorTarget(null)}
                aria-label="Tutup modal hapus honor rutin"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[#E5EEE3]/60 flex items-center justify-center text-[#6E786D] cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm text-[#4A554A]">
              <p className="leading-relaxed">
                Yakin ingin membatalkan &amp; menghapus pencairan Honor Rutin{' '}
                <strong className="text-[#1B271B]">{deleteHonorTarget.penerima_atau_sumber}</strong>{' '}
                ({deleteHonorTarget.no_bukti} · {formatRupiah(deleteHonorTarget.nominal)})?
              </p>
              <div className="rounded-2xl bg-[#C87058]/10 border border-[#E2A898] p-3.5 text-xs text-[#7A311E] flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#9A422B] shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Transaksi di <strong>Buku Kas</strong> dan e-Kwitansi di{' '}
                  <strong>Tab Honor Petugas</strong> otomatis terhapus, serta Saldo Kas &amp; LPJ
                  diperbarui secara real-time.
                </p>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-[#E6E2D6] bg-[#F7F4EC]/80 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={deletingHonor}
                onClick={() => setDeleteHonorTarget(null)}
                className="min-h-[44px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#4A554A] text-sm font-semibold cursor-pointer transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingHonor}
                onClick={() => void handleConfirmDeleteHonorRutin()}
                className="min-h-[44px] rounded-full bg-[#C87058] hover:bg-[#B25C45] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {deletingHonor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>{deletingHonor ? 'Menghapus...' : 'Ya, Batalkan & Hapus'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL PRATINJAU e-KWITANSI HONOR & LEMBUR */}
      {previewKwitansi && (
        <KwitansiDigitalModal
          mode="kas"
          trxKas={previewKwitansi}
          onClose={() => setPreviewKwitansi(null)}
        />
      )}
    </div>
  );
}
