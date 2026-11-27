import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Eye,
  History,
  Loader2,
  LogIn,
  LogOut,
  Moon,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  SHIFT_PETUGAS_OPTIONS,
  STANDARD_SECURITY_SHIFTS,
  type SecurityAttendanceRecord,
  type SecurityShiftOverride,
  type SessionUser,
} from '../../types';
import { formatRupiah } from '../../lib/format';
import {
  clockInSecurityOfficer,
  clockOutSecurityOfficer,
  computeShiftDateForSelection,
  detectActiveShift,
  evaluateAttendance,
  fetchSecurityAttendance,
  findActiveOnDutySession,
  formatWibDateStr,
  formatWibTime,
  getWibParts,
  isSafeAttendanceImageUrl,
  parseShiftWindow,
  shiftWibDateStr,
  subscribeSecurityAttendance,
} from '../../lib/securityAttendanceService';
import {
  fetchShiftOverrides,
  findActiveOverrideForOfficer,
  isSundayOvertimeShift,
  subscribeShiftOverrides,
} from '../../lib/securityShiftOvertimeService';

interface PetugasAttendanceCardProps {
  session: SessionUser;
  officerName: string;
  assignedShift: string;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function PetugasAttendanceCard({
  session,
  officerName,
  assignedShift,
  onToast,
}: PetugasAttendanceCardProps) {
  const [records, setRecords] = useState<SecurityAttendanceRecord[]>([]);
  const [shiftOverrides, setShiftOverrides] = useState<SecurityShiftOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Modal Clock-In
  const [clockInModalOpen, setClockInModalOpen] = useState(false);
  const [selectedShiftName, setSelectedShiftName] = useState<string>('');
  const [initialNotes, setInitialNotes] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [submittingClockIn, setSubmittingClockIn] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Modal Clock-Out
  const [clockOutModalOpen, setClockOutModalOpen] = useState(false);
  const [handoverNotes, setHandoverNotes] = useState('');
  const [submittingClockOut, setSubmittingClockOut] = useState(false);

  // Preview Foto Riwayat
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Live clock WIB berjalan setiap 1 detik
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Bersihkan ObjectURL preview foto saat unmount / berganti foto
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
    };
  }, [photoPreviewUrl]);

  const loadAttendance = useCallback(async () => {
    try {
      const [list, ovList] = await Promise.all([
        fetchSecurityAttendance(session, {
          officerName,
          limit: 40,
        }),
        fetchShiftOverrides(session, {
          officerName,
          limit: 60,
        }),
      ]);
      setRecords(list);
      setShiftOverrides(ovList);
    } finally {
      setLoading(false);
    }
  }, [session, officerName]);

  useEffect(() => {
    void loadAttendance();
    const unsubAtt = subscribeSecurityAttendance(session, () => {
      void loadAttendance();
    });
    const unsubOv = subscribeShiftOverrides(session, () => {
      void loadAttendance();
    });
    return () => {
      unsubAtt();
      unsubOv();
    };
  }, [session, loadAttendance]);

  const wibNow = useMemo(() => getWibParts(new Date(nowMs)), [nowMs]);

  const activeOverride = useMemo(
    () => findActiveOverrideForOfficer(shiftOverrides, officerName, new Date(nowMs)),
    [shiftOverrides, officerName, nowMs]
  );

  // Jadwal Lembur Minggu yang dijadwalkan Admin (terbaru / terdekat >= hari ini - 1 hari)
  const upcomingOrActiveLembur = useMemo(() => {
    const yesterdayStr = shiftWibDateStr(wibNow.dateStr, -1);
    const list = shiftOverrides
      .filter((o) => isSundayOvertimeShift(o.shift_name) && o.shift_date >= yesterdayStr)
      .sort((a, b) => a.shift_date.localeCompare(b.shift_date));
    return list[0] || null;
  }, [shiftOverrides, wibNow.dateStr]);

  const isSundayOrEarlyMonday =
    wibNow.weekdayIndex === 0 || (wibNow.weekdayIndex === 1 && wibNow.hour < 8);

  const detectedShift = useMemo(() => {
    if (activeOverride) {
      const parsed = parseShiftWindow(activeOverride.shift_name);
      return {
        shiftName: activeOverride.shift_name,
        shiftDate: activeOverride.shift_date,
        isOvernight: parsed.isOvernight,
        isLemburMinggu: isSundayOvertimeShift(activeOverride.shift_name),
        source: 'assigned' as const,
      };
    }
    return detectActiveShift(assignedShift, new Date(nowMs));
  }, [activeOverride, assignedShift, nowMs]);

  // Daftar opsi shift (Shift 1-3, Lembur Minggu + shift aktif dari Admin bila custom)
  const shiftChoices = useMemo(() => {
    const base = new Set<string>([
      ...STANDARD_SECURITY_SHIFTS,
      ...SHIFT_PETUGAS_OPTIONS,
    ]);
    if (assignedShift.trim()) {
      base.add(assignedShift.trim());
    }
    if (activeOverride?.shift_name?.trim()) {
      base.add(activeOverride.shift_name.trim());
    }
    return Array.from(base);
  }, [assignedShift, activeOverride]);

  // Sesi ON DUTY aktif (lintas hari Shift 3 & Lembur Minggu tetap terhubung melewati 00:00 WIB)
  const activeSession = useMemo(
    () => findActiveOnDutySession(records, officerName),
    [records, officerName]
  );

  // Cek apakah shift aktif hari ini baru saja diselesaikan
  const completedCurrentShift = useMemo(() => {
    if (activeSession) return null;
    return (
      records.find(
        (r) =>
          r.status === 'completed' &&
          r.shift_date === detectedShift.shiftDate &&
          r.shift_name.trim().toLowerCase() === detectedShift.shiftName.trim().toLowerCase()
      ) || null
    );
  }, [records, activeSession, detectedShift]);

  // Riwayat absensi pribadi 7 hari terakhir (berdasarkan shift_date WIB)
  const last7DaysHistory = useMemo(() => {
    const cutoffDateStr = shiftWibDateStr(wibNow.dateStr, -6);
    return records
      .filter((r) => r.shift_date >= cutoffDateStr)
      .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  }, [records, wibNow.dateStr]);

  const activeEval = useMemo(
    () => (activeSession ? evaluateAttendance(activeSession, nowMs) : null),
    [activeSession, nowMs]
  );

  const isCrossMidnightActive = Boolean(
    activeSession && activeSession.shift_date !== wibNow.dateStr
  );

  const openClockInModal = () => {
    setSelectedShiftName(detectedShift.shiftName);
    setInitialNotes('');
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setClockInModalOpen(true);
  };

  const handlePhotoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      onToast('error', 'Pilih berkas foto raster yang valid (JPG, PNG, atau WebP).');
      return;
    }
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
  };

  const clearSelectedPhoto = () => {
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
  };

  const handleConfirmClockIn = async () => {
    if (submittingClockIn) return;
    const chosenShift = selectedShiftName.trim() || detectedShift.shiftName;
    const shiftDate =
      activeOverride &&
      activeOverride.shift_name.trim().toLowerCase() === chosenShift.toLowerCase()
        ? activeOverride.shift_date
        : computeShiftDateForSelection(chosenShift, new Date());

    setSubmittingClockIn(true);
    try {
      const res = await clockInSecurityOfficer(session, {
        officer_name: officerName,
        shift_date: shiftDate,
        shift_name: chosenShift,
        photoFile,
        initialNotes,
      });

      if (!res.ok) {
        onToast('error', res.message || 'Gagal mencatat Absen Masuk.');
        return;
      }

      setClockInModalOpen(false);
      clearSelectedPhoto();
      setInitialNotes('');
      await loadAttendance();
      onToast('success', res.message);
    } finally {
      setSubmittingClockIn(false);
    }
  };

  const openClockOutModal = () => {
    if (!activeSession) return;
    setHandoverNotes('');
    setClockOutModalOpen(true);
  };

  const handleConfirmClockOut = async () => {
    if (!activeSession || submittingClockOut) return;
    setSubmittingClockOut(true);
    try {
      const res = await clockOutSecurityOfficer(session, activeSession, handoverNotes);
      if (!res.ok) {
        onToast('error', res.message || 'Gagal mencatat Absen Pulang.');
        return;
      }
      setClockOutModalOpen(false);
      setHandoverNotes('');
      await loadAttendance();
      onToast('success', res.message);
    } finally {
      setSubmittingClockOut(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* KARTU UTAMA: ABSENSI JAGA */}
      <section
        aria-label="Absensi Jaga Petugas Keamanan"
        className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs"
      >
        {/* Header Kartu + Live Clock WIB */}
        <div className="glass-hero bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] text-[#FFFDF8] px-4 sm:px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#E5EEE3] shrink-0" />
              <h2 className="text-sm sm:text-base font-bold text-[#FFFDF8] leading-tight">
                Absensi Jaga
              </h2>
            </div>
            <p className="text-xs text-[#E5EEE3]/85 mt-1 truncate">
              {officerName} <span aria-hidden="true">·</span>{' '}
              <span className="text-[#E5EEE3] font-semibold">
                {activeSession ? activeSession.shift_name : detectedShift.shiftName}
              </span>
            </p>
          </div>

          {/* Jam WIB Real-Time */}
          <div className="sm:text-right shrink-0 rounded-2xl bg-[#FFFDF8]/10 border border-[#FFFDF8]/15 px-3.5 py-2">
            <p className="text-lg sm:text-xl font-mono font-bold text-[#FFFDF8] tabular-nums leading-none">
              {wibNow.timeStr}{' '}
              <span className="text-[11px] font-sans font-semibold text-[#E5EEE3]">WIB</span>
            </p>
            <p className="text-[11px] text-[#E5EEE3]/80 mt-1 tabular-nums">{wibNow.dateLabel}</p>
          </div>
        </div>

        {/* Konten Status & Tombol Aksi */}
        <div className="p-4 sm:p-5 space-y-4">
          {loading ? (
            <div className="h-24 rounded-2xl bg-[#F7F4EC] animate-pulse" />
          ) : activeSession ? (
            /* STATUS: SEDANG BERTUGAS (ON DUTY) */
            <div className="space-y-3.5">
              <div className="rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] p-3.5 sm:p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-extrabold text-[#243825]">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#384E35] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#2B3F29]" />
                    </span>
                    <span>SEDANG BERTUGAS (ON DUTY)</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#243825] tabular-nums">
                    Durasi: {activeEval?.durationLabel || '0 mnt'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1 border-t border-[#C6D2BF] text-xs">
                  <div>
                    <p className="text-[11px] text-[#4A554A]">Jam Absen Masuk</p>
                    <p className="font-mono font-bold text-[#1B271B] tabular-nums mt-0.5">
                      {formatWibTime(activeSession.clock_in_at)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#4A554A]">Tanggal Mulai Shift</p>
                    <p className="font-semibold text-[#1B271B] tabular-nums mt-0.5">
                      {formatWibDateStr(activeSession.shift_date)}
                    </p>
                  </div>
                </div>

                {isCrossMidnightActive && (
                  <div className="rounded-xl bg-[#243825] text-[#FFFDF8] px-3 py-2 text-[11px] flex items-center gap-2">
                    <Moon className="w-3.5 h-3.5 text-[#E5EEE3] shrink-0" />
                    <span>
                      Sesi lintas hari ({activeSession.shift_name} mulai{' '}
                      {formatWibDateStr(activeSession.shift_date)}) tetap terhubung untuk Absen
                      Pulang.
                    </span>
                  </div>
                )}

                {activeSession.clock_in_photo_url &&
                  isSafeAttendanceImageUrl(activeSession.clock_in_photo_url) && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-[#243825]">
                        Foto absen masuk terlampir
                      </span>
                      <button
                        type="button"
                        onClick={() => setLightboxUrl(activeSession.clock_in_photo_url)}
                        className="text-xs font-semibold text-[#243825] hover:text-[#1B271B] underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Lihat Foto</span>
                      </button>
                    </div>
                  )}
              </div>

              <button
                type="button"
                onClick={openClockOutModal}
                className="w-full min-h-[48px] px-4 rounded-full bg-[#C87058] hover:bg-[#B25C45] active:scale-[0.99] text-[#FFFDF8] text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer shadow-sm"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span>Absen Pulang (Clock-Out)</span>
              </button>
            </div>
          ) : (
            /* STATUS: BELUM ABSEN MASUK ATAU BARU SELESAI SHIFT */
            <div className="space-y-3.5">
              {completedCurrentShift ? (
                <div className="rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-[#243825]">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>SELESAI BERTUGAS</span>
                    </span>
                    <span className="text-xs font-mono font-semibold text-[#4A554A] tabular-nums">
                      {evaluateAttendance(completedCurrentShift).durationLabel}
                    </span>
                  </div>
                  <p className="text-xs text-[#4A554A] tabular-nums">
                    {completedCurrentShift.shift_name} · Masuk{' '}
                    <strong className="text-[#1B271B]">
                      {formatWibTime(completedCurrentShift.clock_in_at)}
                    </strong>{' '}
                    · Pulang{' '}
                    <strong className="text-[#1B271B]">
                      {formatWibTime(completedCurrentShift.clock_out_at)}
                    </strong>
                  </p>
                  {completedCurrentShift.handover_notes && (
                    <p className="text-xs text-[#4A554A] bg-[#FFFDF8] border border-[#E6E2D6] rounded-xl px-2.5 py-1.5 whitespace-pre-line">
                      {completedCurrentShift.handover_notes}
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] px-3.5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#1B271B]">
                      Jadwal Terdeteksi: {detectedShift.shiftName}
                    </p>
                    <p className="text-[11px] text-[#6E786D] mt-0.5 leading-relaxed">
                      {detectedShift.isLemburMinggu
                        ? 'Terdeteksi jadwal Lembur Minggu (19:00 – 07:00 WIB). Silakan tekan Absen Masuk saat tiba di pos.'
                        : 'Tekan tombol di bawah saat mulai berjaga agar status kehadiran tampil real-time untuk Warga & Pengurus.'}
                    </p>
                  </div>
                  <Clock className="w-4 h-4 text-[#2B3F29] shrink-0 mt-0.5" />
                </div>
              )}

              <button
                type="button"
                onClick={openClockInModal}
                className="w-full min-h-[48px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] active:scale-[0.99] text-[#FFFDF8] text-sm font-bold inline-flex items-center justify-center gap-2 transition cursor-pointer shadow-sm"
              >
                <LogIn className="w-4 h-4 shrink-0" />
                <span>
                  {completedCurrentShift
                    ? 'Absen Masuk Shift Berikutnya / Lembur'
                    : 'Absen Masuk (Clock-In)'}
                </span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* JADWAL SHIFT JAGA REGULER & KARTU OTOMATIS LEMBUR MINGGU (19:00 – 07:00 WIB) */}
      <section
        aria-label="Jadwal Shift Jaga dan Lembur Minggu"
        className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs"
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-[#2B3F29] shrink-0" />
            <h3 className="text-sm font-bold text-[#1B271B] truncate">
              Jadwal Shift Jaga &amp; Lembur Minggu
            </h3>
          </div>
          <span className="text-[11px] font-semibold text-[#6E786D] shrink-0">WIB</span>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          {/* Kartu Sorotan Otomatis LEMBUR MINGGU (muncul tiap Hari Minggu atau saat dijadwalkan Admin) */}
          {(isSundayOrEarlyMonday || upcomingOrActiveLembur) && (
            <div className="rounded-2xl glass-hero bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] text-[#FFFDF8] p-3.5 sm:p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-xs sm:text-sm font-extrabold text-[#E5EEE3]">
                  <Moon className="w-4 h-4 shrink-0" />
                  <span>LEMBUR MINGGU (19:00 – 07:00 WIB)</span>
                </div>
                {upcomingOrActiveLembur && (
                  <span
                    className={`text-[11px] font-extrabold px-2 py-0.5 rounded-md border ${
                      upcomingOrActiveLembur.payment_status === 'paid' ||
                      upcomingOrActiveLembur.cash_transaction_id
                        ? 'bg-[#E5EEE3]/20 text-[#E5EEE3] border-[#E5EEE3]/40'
                        : 'bg-[#F2D8A7]/25 text-[#F2D8A7] border-[#F2D8A7]/40'
                    }`}
                  >
                    {upcomingOrActiveLembur.payment_status === 'paid' ||
                    upcomingOrActiveLembur.cash_transaction_id
                      ? 'LUNAS'
                      : 'TERJADWAL'}
                  </span>
                )}
              </div>

              {upcomingOrActiveLembur ? (
                <div className="text-xs text-[#E5EEE3]/90 space-y-1">
                  <p className="tabular-nums">
                    Jadwal Anda:{' '}
                    <strong className="text-[#FFFDF8]">
                      {formatWibDateStr(upcomingOrActiveLembur.shift_date)}
                    </strong>{' '}
                    · Uang Lembur:{' '}
                    <strong className="font-mono text-[#E5EEE3]">
                      {formatRupiah(upcomingOrActiveLembur.overtime_amount)}
                    </strong>
                  </p>
                  <p className="text-[11px] text-[#E5EEE3]/75">
                    Shift Lembur Minggu otomatis terpilih saat Anda menekan Absen Masuk &amp; Scan
                    Patroli pada jam 19:00 – 07:00 WIB.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#E5EEE3]/85 leading-relaxed">
                  Hari Minggu malam (19:00 – 07:00 WIB) berlaku jadwal Lembur Minggu. Petugas yang
                  bertugas dapat langsung memilih shift ini saat Absen Masuk.
                </p>
              )}
            </div>
          )}

          {/* Daftar Shift Reguler */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                { label: 'Shift 1', jam: '07:00 – 15:00 WIB', key: 'shift 1' },
                { label: 'Shift 2', jam: '15:00 – 23:00 WIB', key: 'shift 2' },
                { label: 'Shift 3', jam: '23:00 – 07:00 WIB', key: 'shift 3' },
              ] as const
            ).map((item) => {
              const isCurrent = detectedShift.shiftName.toLowerCase().includes(item.key);
              return (
                <div
                  key={item.label}
                  className={`rounded-2xl border px-3 py-2.5 ${
                    isCurrent
                      ? 'bg-[#E5EEE3] border-[#C6D2BF]'
                      : 'bg-[#F7F4EC] border-[#E6E2D6]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-xs font-bold text-[#1B271B]">{item.label}</p>
                    {isCurrent && (
                      <span className="text-[10px] font-extrabold text-[#243825]">Aktif</span>
                    )}
                  </div>
                  <p className="text-[11px] font-mono text-[#4A554A] tabular-nums mt-0.5">
                    {item.jam}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* RIWAYAT ABSENSI PRIBADI (7 HARI TERAKHIR) */}
      <section
        aria-label="Riwayat Absensi Pribadi 7 Hari Terakhir"
        className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs"
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <History className="w-4 h-4 text-[#2B3F29] shrink-0" />
            <h3 className="text-sm font-bold text-[#1B271B] truncate">
              Riwayat Absensi Pribadi (7 Hari Terakhir)
            </h3>
          </div>
          <span className="text-xs font-mono font-semibold text-[#6E786D] tabular-nums shrink-0">
            {last7DaysHistory.length} sesi
          </span>
        </div>

        {loading ? (
          <div className="p-4 space-y-2.5">
            <div className="h-14 rounded-2xl bg-[#F7F4EC] animate-pulse" />
            <div className="h-14 rounded-2xl bg-[#F7F4EC] animate-pulse" />
          </div>
        ) : last7DaysHistory.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[#6E786D]">
            Belum ada catatan absensi pribadi dalam 7 hari terakhir.
          </div>
        ) : (
          <div className="divide-y divide-[#E6E2D6]">
            {last7DaysHistory.map((item) => {
              const ev = evaluateAttendance(item, nowMs);
              const isOnDuty = item.status === 'on_duty';
              return (
                <article key={item.id} className="px-4 sm:px-5 py-3.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-bold text-[#1B271B] truncate">
                        {formatWibDateStr(item.shift_date)}{' '}
                        <span className="font-normal text-[#C6D2BF]">·</span>{' '}
                        <span className="font-semibold text-[#4A554A]">{item.shift_name}</span>
                      </p>
                    </div>
                    <span
                      className={`text-xs font-bold shrink-0 ${
                        isOnDuty ? 'text-[#243825]' : 'text-[#6E786D]'
                      }`}
                    >
                      {isOnDuty ? 'Sedang Bertugas' : 'Selesai Bertugas'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4A554A] font-mono tabular-nums">
                    <span>
                      Masuk {formatWibTime(item.clock_in_at)} · Pulang{' '}
                      {item.clock_out_at ? formatWibTime(item.clock_out_at) : 'Belum pulang'}
                    </span>
                    <span className="font-semibold text-[#1B271B]">{ev.durationLabel}</span>
                  </div>

                  {item.handover_notes && (
                    <p className="text-xs text-[#4A554A] bg-[#F7F4EC] border border-[#E6E2D6] rounded-xl px-2.5 py-1.5 whitespace-pre-line">
                      {item.handover_notes}
                    </p>
                  )}

                  {item.clock_in_photo_url && isSafeAttendanceImageUrl(item.clock_in_photo_url) && (
                    <button
                      type="button"
                      onClick={() => setLightboxUrl(item.clock_in_photo_url)}
                      className="text-[11px] font-semibold text-[#2B3F29] hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Lihat Foto Absen Masuk</span>
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* MODAL KONFIRMASI ABSEN MASUK (CLOCK-IN) */}
      {clockInModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Absen Masuk"
        >
          <div className="bg-[#FFFDF8] w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col animate-modal-pop">
            <div className="sm:hidden mx-auto mt-2.5 w-10 h-1 rounded-full bg-[#C6D2BF]" aria-hidden="true" />
            <div className="px-5 py-4 bg-[#F7F4EC] border-b border-[#E6E2D6] flex items-center justify-between gap-3">
              <div>
                <h3 className="font-serif-brand text-base font-bold text-[#1B271B]">Konfirmasi Absen Masuk</h3>
                <p className="text-xs text-[#6E786D] mt-0.5 tabular-nums">
                  {officerName} · {wibNow.hhmm} WIB ({wibNow.dateLabel})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setClockInModalOpen(false)}
                aria-label="Tutup modal absen masuk"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[#E5EEE3] flex items-center justify-center text-[#6E786D] hover:text-[#243825] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label
                  htmlFor="petugas-clockin-shift"
                  className="block text-xs font-bold text-[#4A554A] mb-1.5"
                >
                  Jadwal Shift Aktif
                </label>
                <select
                  id="petugas-clockin-shift"
                  value={selectedShiftName}
                  onChange={(e) => setSelectedShiftName(e.target.value)}
                  className="w-full min-h-[44px] rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3 text-sm font-medium text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                >
                  {shiftChoices.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#6E786D] mt-1">
                  Otomatis menyesuaikan jadwal dari Admin (termasuk Lembur Minggu 19:00–07:00 WIB).
                </p>
              </div>

              {/* Foto Selfie / Pos Jaga (Opsional) */}
              <div>
                <p className="block text-xs font-bold text-[#4A554A] mb-1.5">
                  Foto Selfie / Pos Jaga (Opsional)
                </p>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
                {photoPreviewUrl ? (
                  <div className="relative rounded-2xl overflow-hidden border border-[#E6E2D6] bg-[#F7F4EC]">
                    <img
                      src={photoPreviewUrl}
                      alt="Pratinjau foto absen masuk"
                      className="w-full h-44 object-cover"
                    />
                    <button
                      type="button"
                      onClick={clearSelectedPhoto}
                      className="absolute top-2 right-2 min-h-[36px] px-3 rounded-full bg-[#1B271B]/80 hover:bg-[#C87058] text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="w-full min-h-[48px] rounded-2xl border border-dashed border-[#C6D2BF] bg-[#F7F4EC] hover:bg-[#E5EEE3] text-[#1B271B] text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer transition"
                  >
                    <Camera className="w-4 h-4 text-[#2B3F29]" />
                    <span>Ambil Foto Kamera / Pilih Galeri</span>
                  </button>
                )}
              </div>

              {/* Catatan Singkat Kondisi Awal Pos (Opsional) */}
              <div>
                <label
                  htmlFor="petugas-clockin-note"
                  className="block text-xs font-bold text-[#4A554A] mb-1.5"
                >
                  Catatan Kondisi Awal Pos (Opsional)
                </label>
                <textarea
                  id="petugas-clockin-note"
                  rows={2}
                  maxLength={400}
                  value={initialNotes}
                  onChange={(e) => setInitialNotes(e.target.value)}
                  placeholder="Contoh: Pos jaga rapi, gerbang aman, HT dan senter siap digunakan..."
                  className="w-full rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3 py-2.5 text-sm text-[#1B271B] placeholder:text-[#6E786D]/70 focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                />
              </div>
            </div>

            <div className="px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[#E6E2D6] bg-[#F7F4EC] grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submittingClockIn}
                onClick={() => setClockInModalOpen(false)}
                className="min-h-[44px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#4A554A] text-sm font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submittingClockIn}
                aria-busy={submittingClockIn}
                onClick={() => void handleConfirmClockIn()}
                className="min-h-[44px] rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-sm font-bold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {submittingClockIn ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                <span>{submittingClockIn ? 'Menyimpan...' : 'Absen Masuk'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI ABSEN PULANG (CLOCK-OUT) */}
      {clockOutModalOpen && activeSession && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi Absen Pulang"
        >
          <div className="bg-[#FFFDF8] w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col animate-modal-pop">
            <div className="sm:hidden mx-auto mt-2.5 w-10 h-1 rounded-full bg-[#C6D2BF]" aria-hidden="true" />
            <div className="px-5 py-4 bg-[#F7F4EC] border-b border-[#E6E2D6] flex items-center justify-between gap-3">
              <div>
                <h3 className="font-serif-brand text-base font-bold text-[#1B271B]">Konfirmasi Absen Pulang</h3>
                <p className="text-xs text-[#6E786D] mt-0.5">{activeSession.shift_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setClockOutModalOpen(false)}
                aria-label="Tutup modal absen pulang"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-[#E5EEE3] flex items-center justify-center text-[#6E786D] hover:text-[#243825] cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] p-3.5 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[11px] text-[#6E786D]">Jam Masuk</p>
                  <p className="text-xs sm:text-sm font-mono font-bold text-[#1B271B] tabular-nums mt-0.5">
                    {formatWibTime(activeSession.clock_in_at)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#6E786D]">Jam Pulang</p>
                  <p className="text-xs sm:text-sm font-mono font-bold text-[#9A422B] tabular-nums mt-0.5">
                    {wibNow.hhmm} WIB
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#6E786D]">Total Durasi</p>
                  <p className="text-xs sm:text-sm font-mono font-bold text-[#243825] tabular-nums mt-0.5">
                    {activeEval?.durationLabel || '0 mnt'}
                  </p>
                </div>
              </div>

              <div>
                <label
                  htmlFor="petugas-clockout-notes"
                  className="block text-xs font-bold text-[#4A554A] mb-1.5"
                >
                  Catatan Serah Terima Shift (Opsional)
                </label>
                <textarea
                  id="petugas-clockout-notes"
                  rows={3}
                  maxLength={450}
                  value={handoverNotes}
                  onChange={(e) => setHandoverNotes(e.target.value)}
                  placeholder="Contoh: Situasi aman terkendali, serah terima ke Pak Warta..."
                  className="w-full rounded-2xl border border-[#C6D2BF] bg-[#FFFDF8] px-3 py-2.5 text-sm text-[#1B271B] placeholder:text-[#6E786D]/70 focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
                />
              </div>
            </div>

            <div className="px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[#E6E2D6] bg-[#F7F4EC] grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={submittingClockOut}
                onClick={() => setClockOutModalOpen(false)}
                className="min-h-[44px] rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#4A554A] text-sm font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={submittingClockOut}
                aria-busy={submittingClockOut}
                onClick={() => void handleConfirmClockOut()}
                className="min-h-[44px] rounded-full bg-[#C87058] hover:bg-[#B25C45] disabled:opacity-60 text-[#FFFDF8] text-sm font-bold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer"
              >
                {submittingClockOut ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogOut className="w-4 h-4" />
                )}
                <span>{submittingClockOut ? 'Menyimpan...' : 'Selesai Bertugas'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIGHTBOX FOTO ABSEN */}
      {lightboxUrl && isSafeAttendanceImageUrl(lightboxUrl) && (
        <div
          className="fixed inset-0 z-50 bg-[#1B271B]/75 backdrop-blur-md flex items-center justify-center p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Foto Absen Masuk"
          onClick={() => setLightboxUrl(null)}
        >
          <div
            className="relative max-w-lg w-full bg-[#FFFDF8] rounded-3xl border border-[#E6E2D6] overflow-hidden shadow-2xl animate-modal-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-[#F7F4EC] border-b border-[#E6E2D6] flex items-center justify-between">
              <p className="text-xs font-bold text-[#1B271B]">Foto Absen Masuk Pos Jaga</p>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                aria-label="Tutup pratinjau foto"
                className="min-h-[36px] min-w-[36px] rounded-full hover:bg-[#E5EEE3] flex items-center justify-center text-[#4A554A] hover:text-[#243825] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={lightboxUrl}
              alt="Foto absen masuk petugas keamanan"
              referrerPolicy="no-referrer"
              className="w-full max-h-[70dvh] object-contain bg-[#1B271B]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
