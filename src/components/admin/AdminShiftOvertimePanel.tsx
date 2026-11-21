import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  Moon,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  DEFAULT_SECURITY_OFFICER_NAMES,
  STANDARD_SECURITY_SHIFTS,
  type PetugasKontakDarurat,
  type SecurityAttendanceRecord,
  type SecurityShiftOverride,
  type SessionUser,
} from '../../types';
import { formatRupiah } from '../../lib/format';
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
  fetchPetugasListAdmin,
  subscribePetugasKeamananRealtime,
} from '../../lib/dataService';
import {
  buildOvertimeCashDescription,
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

interface AdminShiftOvertimePanelProps {
  session: SessionUser;
  petugasList: PetugasKontakDarurat[];
  onCashChanged: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminShiftOvertimePanel({
  session,
  petugasList,
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

  // Modal Konfirmasi Hapus / Batalkan
  const [deleteTarget, setDeleteTarget] = useState<SecurityShiftOverride | null>(null);
  const [deletingOverride, setDeletingOverride] = useState<boolean>(false);

  useEffect(() => {
    if (!formOfficer && officerOptions.length > 0) {
      setFormOfficer(officerOptions[0].nama);
    }
  }, [officerOptions, formOfficer]);

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
        <div className="bg-[#0F172A] text-white rounded-2xl p-4 sm:p-5 border border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-300">Lembur Dibayar (LUNAS)</p>
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-emerald-400 tabular-nums mt-2">
            {formatRupiah(monthOvertimeSummary.paidTotal)}
          </p>
          <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
            {monthOvertimeSummary.paidCount} jadwal tercatat otomatis di Buku Kas
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500">Menunggu Pembayaran</p>
            <Clock className="w-4 h-4 text-amber-600 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-amber-700 tabular-nums mt-2">
            {formatRupiah(monthOvertimeSummary.unpaidTotal)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
            {monthOvertimeSummary.unpaidCount} jadwal Lembur Minggu belum dibayar
          </p>
        </div>

        {/* Pengaturan Cepat Tarif Default Lembur Minggu */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[#0F172A]">Default Tarif Lembur Minggu</p>
            <Banknote className="w-4 h-4 text-[#059669] shrink-0" />
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
              className="w-full min-h-[40px] rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm font-mono font-bold text-[#0F172A] tabular-nums focus:bg-white focus:border-[#059669] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSaveDefaultNominal}
              className="min-h-[40px] px-3 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Simpan</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Nilai otomatis terisi saat membuat jadwal Lembur Minggu (19:00–07:00 WIB).
          </p>
        </div>
      </section>

      {/* FORM TAMBAH JADWAL SHIFT & PEMBAYARAN LEMBUR MINGGU */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#0F172A] text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
              <Moon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-[#0F172A] leading-tight">
                Kelola Shift &amp; Lembur Keamanan
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Jadwalkan shift atau Lembur Minggu (19:00–07:00 WIB) dan integrasikan pencairan
                langsung ke Kas Pengeluaran &amp; Tab Honor Petugas.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadAll(true)}
            className="min-h-[38px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
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
                className="block text-xs font-bold text-slate-700 mb-1.5"
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
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-[#0F172A] focus:border-[#059669] focus:outline-none"
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
                  className="mt-2 w-full min-h-[40px] rounded-xl border border-emerald-400 bg-emerald-50/40 px-3 text-xs sm:text-sm text-[#0F172A] focus:bg-white focus:border-[#059669] focus:outline-none"
                />
              )}
            </div>

            <div>
              <label
                htmlFor="shift-ov-type"
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Jenis Jadwal Shift
              </label>
              <select
                id="shift-ov-type"
                value={formShiftName}
                onChange={(e) => handleShiftTypeChange(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-[#0F172A] focus:border-[#059669] focus:outline-none"
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
                className="block text-xs font-bold text-slate-700 mb-1.5"
              >
                Tanggal Mulai Shift (WIB)
              </label>
              <input
                id="shift-ov-date"
                type="date"
                required
                value={formShiftDate}
                onChange={(e) => setFormShiftDate(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono text-[#0F172A] tabular-nums focus:border-[#059669] focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="shift-ov-notes"
                className="block text-xs font-bold text-slate-700 mb-1.5"
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
                className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none"
              />
            </div>
          </div>

          {/* KONTROL KHUSUS LEMBUR MINGGU: NOMINAL & OPSI BAYAR LANGSUNG KE KAS */}
          {isFormLembur && (
            <div className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-4 space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-end">
                <div>
                  <label
                    htmlFor="shift-ov-nominal"
                    className="block text-xs font-bold text-emerald-950 mb-1.5"
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
                    className="w-full min-h-[44px] rounded-xl border border-emerald-300 bg-white px-3.5 text-sm font-mono font-bold text-[#0F172A] tabular-nums focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                  />
                  <p className="text-[11px] text-emerald-800 mt-1 font-mono tabular-nums">
                    Terbaca: <strong>{formatRupiah(parsedFormNominal)}</strong>
                  </p>
                </div>

                <label className="flex items-start gap-3 rounded-xl bg-white border border-emerald-200 px-3.5 py-3 cursor-pointer hover:border-emerald-400 transition">
                  <input
                    type="checkbox"
                    checked={formPayImmediately}
                    onChange={(e) => setFormPayImmediately(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[#059669] cursor-pointer shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-bold text-[#0F172A] leading-tight">
                      Langsung Bayarkan &amp; Catat ke Kas
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                      Otomatis membuat pengeluaran <strong>Terverifikasi</strong> di Buku Kas &amp;
                      memotong Saldo Kas saat ini juga.
                    </p>
                  </div>
                </label>
              </div>

              {formPayImmediately && (
                <div className="rounded-xl bg-[#0F172A] text-slate-100 px-3.5 py-3 text-xs space-y-1">
                  <p className="font-bold text-emerald-400">
                    Pratinjau Pencatatan Otomatis ke Buku Kas (transaksi_kas):
                  </p>
                  <p>
                    <span className="text-slate-400">Kategori:</span>{' '}
                    <strong>Honor &amp; Lembur Keamanan</strong>
                  </p>
                  <p className="break-words">
                    <span className="text-slate-400">Keterangan:</span>{' '}
                    <span className="font-mono text-white">
                      {buildOvertimeCashDescription(
                        effectiveFormOfficer || 'Petugas',
                        formShiftDate
                      )}
                    </span>
                  </p>
                  <p className="font-mono tabular-nums">
                    <span className="text-slate-400 font-sans">Nominal Pengeluaran:</span>{' '}
                    <strong className="text-emerald-300">{formatRupiah(parsedFormNominal)}</strong>
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-500">
              Jadwal otomatis tampil di Tab <strong>Info &amp; Shift</strong>, mendeteksi shift saat{' '}
              <strong>Absensi / Patroli</strong>, dan sinkron ke Tab <strong>Honor</strong> petugas.
            </p>
            <button
              type="submit"
              disabled={submittingForm}
              className="min-h-[44px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm whitespace-nowrap"
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
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#0F172A]">
              Daftar Jadwal Shift &amp; Status Pembayaran Lembur
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Verifikasi kehadiran absensi petugas sebelum membayarkan uang lembur ke Buku Kas.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              value={filterMonth}
              onChange={(e) => setFilterMonth(e.target.value)}
              aria-label="Filter bulan jadwal"
              className="min-h-[38px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-mono font-semibold text-[#0F172A]"
            />
            <select
              value={filterOfficer}
              onChange={(e) => setFilterOfficer(e.target.value)}
              aria-label="Filter petugas"
              className="min-h-[38px] rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-[#0F172A]"
            >
              <option value="semua">Semua Petugas</option>
              {officerOptions.map((opt) => (
                <option key={opt.nama} value={opt.nama}>
                  {opt.nama}
                </option>
              ))}
            </select>
            <div className="inline-flex p-1 bg-slate-100 rounded-xl">
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
                  className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                    filterPayment === tab.id
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-slate-600 hover:text-[#0F172A]'
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
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        ) : filteredOverrides.length === 0 ? (
          <div className="px-5 py-10 text-center space-y-2">
            <Calendar className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-bold text-slate-700">
              Belum Ada Jadwal Shift / Lembur pada Filter Ini
            </p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Tambahkan jadwal Lembur Minggu (19:00–07:00 WIB) atau penyesuaian shift di formulir
              atas untuk mulai sinkronisasi dengan Absensi, Honor Petugas, dan Buku Kas.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredOverrides.map((ov) => {
              const isLembur = isSundayOvertimeShift(ov.shift_name);
              const isPaid = ov.payment_status === 'paid' || Boolean(ov.cash_transaction_id);
              const matchedAtt = findMatchedAttendance(ov);

              return (
                <article
                  key={ov.id}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <p className="text-sm sm:text-base font-bold text-[#0F172A]">
                        {ov.officer_name}
                      </p>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-xs font-semibold text-slate-700 tabular-nums">
                        {formatWibDateStr(ov.shift_date)}
                      </span>
                      <span className="text-slate-300" aria-hidden="true">
                        ·
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          isLembur ? 'text-indigo-700' : 'text-slate-700'
                        }`}
                      >
                        {ov.shift_name}
                      </span>
                    </div>

                    {/* Indikator Sinkronisasi Absensi Petugas */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {matchedAtt ? (
                        matchedAtt.status === 'completed' ? (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                            <UserCheck className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Absensi Terverifikasi: Masuk {formatWibTime(matchedAtt.clock_in_at)} –
                              Pulang {formatWibTime(matchedAtt.clock_out_at)}
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
                            </span>
                            <span>
                              Sedang Bertugas (Masuk {formatWibTime(matchedAtt.clock_in_at)})
                            </span>
                          </span>
                        )
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-500">
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>Belum ada catatan Absen Masuk pada tanggal shift ini</span>
                        </span>
                      )}
                    </div>

                    {ov.notes && (
                      <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200/70 rounded-lg px-2.5 py-1.5 max-w-xl">
                        {ov.notes}
                      </p>
                    )}

                    {isLembur && isPaid && ov.paid_at && (
                      <p className="text-[11px] font-medium text-emerald-800">
                        Dibayarkan &amp; tercatat di Buku Kas pada {formatWibDateTime(ov.paid_at)}
                      </p>
                    )}
                  </div>

                  {/* Sisi Kanan: Nominal, Status Pembayaran & Tombol Aksi */}
                  <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-3 shrink-0">
                    {isLembur && (
                      <div className="text-left lg:text-right">
                        <p className="text-base font-mono font-extrabold text-[#0F172A] tabular-nums">
                          {formatRupiah(ov.overtime_amount)}
                        </p>
                        <p
                          className={`text-xs font-extrabold mt-0.5 ${
                            isPaid ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {isPaid ? 'SUDAH DIBAYAR / CAIR' : 'BELUM DIBAYAR'}
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-2 shrink-0">
                      {isLembur &&
                        (isPaid ? (
                          <button
                            type="button"
                            disabled
                            title="Sudah dibayarkan (anti pencatatan ganda)"
                            className="min-h-[40px] px-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold inline-flex items-center gap-1.5 opacity-80 cursor-not-allowed whitespace-nowrap"
                          >
                            <ShieldCheck className="w-4 h-4 shrink-0" />
                            <span>Sudah Cair</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => openPayModal(ov)}
                            className="min-h-[40px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
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
                          className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 bg-white hover:bg-slate-100 hover:text-[#0F172A] text-slate-500 flex items-center justify-center cursor-pointer transition"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setDeleteTarget(ov)}
                        aria-label={`Hapus jadwal ${ov.officer_name}`}
                        className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-slate-500 flex items-center justify-center cursor-pointer transition"
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

      {/* MODAL KONFIRMASI PEMBAYARAN LEMBUR KE BUKU KAS */}
      {payModalTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Pembayaran Lembur Minggu"
        >
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">Bayar Lembur &amp; Catat ke Kas</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {payModalTarget.officer_name} · {formatWibDateStr(payModalTarget.shift_date)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayModalTarget(null)}
                aria-label="Tutup modal pembayaran lembur"
                className="min-h-[40px] min-w-[40px] rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Status Verifikasi Absensi */}
              {payModalAttendance ? (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-start gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
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
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
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
                  className="block text-xs font-bold text-slate-700 mb-1.5"
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
                  className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-base font-mono font-bold text-[#0F172A] tabular-nums focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
                />
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs space-y-1">
                <p className="font-bold text-[#0F172A]">Detail Entri Otomatis Buku Kas:</p>
                <p className="text-slate-600">
                  Kategori: <strong className="text-[#0F172A]">Honor &amp; Lembur Keamanan</strong>
                </p>
                <p className="text-slate-600 break-words">
                  Keterangan:{' '}
                  <strong className="text-[#0F172A] font-mono">
                    {buildOvertimeCashDescription(
                      payModalTarget.officer_name,
                      payModalTarget.shift_date
                    )}
                  </strong>
                </p>
                <p className="text-slate-600">
                  Saldo Kas utama, Rekap Bulanan, dan LPJ langsung terpotong secara real-time.
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={payingOverride}
                onClick={() => setPayModalTarget(null)}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={payingOverride}
                onClick={() => void handleConfirmPayOvertime()}
                className="min-h-[44px] rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
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
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Hapus Jadwal Shift atau Lembur"
        >
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#0F172A]">Hapus / Batalkan Jadwal</h3>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                aria-label="Tutup konfirmasi hapus"
                className="min-h-[40px] min-w-[40px] rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-sm text-slate-700 leading-relaxed">
                Yakin ingin menghapus jadwal{' '}
                <strong className="text-[#0F172A]">{deleteTarget.shift_name}</strong> untuk{' '}
                <strong className="text-[#0F172A]">{deleteTarget.officer_name}</strong> tanggal{' '}
                <strong className="text-[#0F172A]">
                  {formatWibDateStr(deleteTarget.shift_date)}
                </strong>
                ?
              </p>

              {(deleteTarget.payment_status === 'paid' || deleteTarget.cash_transaction_id) && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-900 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
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

            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={deletingOverride}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-sm font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={deletingOverride}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
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
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit Jadwal Shift atau Lembur"
        >
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-[#0F172A]">Edit Jadwal Shift / Lembur</h3>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                aria-label="Tutup modal edit jadwal"
                className="min-h-[40px] min-w-[40px] rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Nama Petugas</label>
                <input
                  type="text"
                  value={editOfficerName}
                  onChange={(e) => setEditOfficerName(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm text-[#0F172A]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Jenis Shift</label>
                  <select
                    value={editShiftName}
                    onChange={(e) => setEditShiftName(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-xs sm:text-sm text-[#0F172A]"
                  >
                    <option value={STANDARD_SECURITY_SHIFTS[3]}>Lembur Minggu (19:00-07:00)</option>
                    <option value={STANDARD_SECURITY_SHIFTS[0]}>Shift 1 (07:00-15:00)</option>
                    <option value={STANDARD_SECURITY_SHIFTS[1]}>Shift 2 (15:00-23:00)</option>
                    <option value={STANDARD_SECURITY_SHIFTS[2]}>Shift 3 (23:00-07:00)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Tanggal</label>
                  <input
                    type="date"
                    value={editShiftDate}
                    onChange={(e) => setEditShiftDate(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm font-mono text-[#0F172A]"
                  />
                </div>
              </div>
              {isSundayOvertimeShift(editShiftName) && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Nominal Lembur (Rp)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50000000}
                    step={5000}
                    value={editNominalInput}
                    onChange={(e) => setEditNominalInput(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm font-mono font-bold text-[#0F172A]"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Catatan</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 px-3 text-sm text-[#0F172A]"
                />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditTarget(null)}
                className="min-h-[44px] rounded-xl border border-slate-300 bg-white text-slate-700 text-sm font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void handleConfirmEdit()}
                className="min-h-[44px] rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
