import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  Radio,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  DEFAULT_SECURITY_OFFICER_NAMES,
  SHIFT_PETUGAS_OPTIONS,
  STANDARD_SECURITY_SHIFTS,
  type LogPatroli,
  type PatrolMapConfig,
  type PetugasKontakDarurat,
  type SecurityAttendanceRecord,
  type SecurityAttendanceStatus,
  type SessionUser,
  type TitikPatroli,
} from '../../types';
import { formatTanggalWaktu } from '../../lib/format';
import {
  adminDeleteSecurityAttendance,
  adminUpdateSecurityAttendance,
  evaluateAttendance,
  fetchSecurityAttendance,
  formatDurationMinutes,
  formatHoursDecimal,
  formatWibDateStr,
  formatWibTime,
  getScheduledEndIsoForRecord,
  getWibParts,
  isSafeAttendanceImageUrl,
  isoToWibDatetimeLocal,
  subscribeSecurityAttendance,
  wibDatetimeLocalToIso,
} from '../../lib/securityAttendanceService';

interface AdminAttendanceMonitorPanelProps {
  session: SessionUser;
  petugasList: PetugasKontakDarurat[];
  patroliFeed: LogPatroli[];
  titikPatroliList: TitikPatroli[];
  patrolMapConfig?: PatrolMapConfig | null;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminAttendanceMonitorPanel({
  session,
  petugasList,
  patroliFeed,
  titikPatroliList,
  patrolMapConfig,
  onToast,
}: AdminAttendanceMonitorPanelProps) {
  const [records, setRecords] = useState<SecurityAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Filter Rekap Bulanan
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getWibParts().monthStr);
  const [selectedOfficer, setSelectedOfficer] = useState<string>('semua');

  // Lightbox Foto Absen
  const [lightboxRecord, setLightboxRecord] = useState<SecurityAttendanceRecord | null>(null);

  // Modal Edit / Koreksi Absensi (Admin Full Control)
  const [editingRecord, setEditingRecord] = useState<SecurityAttendanceRecord | null>(null);
  const [editShiftDate, setEditShiftDate] = useState('');
  const [editShiftName, setEditShiftName] = useState('');
  const [editClockInLocal, setEditClockInLocal] = useState('');
  const [editClockOutLocal, setEditClockOutLocal] = useState('');
  const [editStatus, setEditStatus] = useState<SecurityAttendanceStatus>('completed');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadAttendance = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const list = await fetchSecurityAttendance(session, { limit: 400 });
        setRecords(list);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session]
  );

  useEffect(() => {
    void loadAttendance(false);
    const unsub = subscribeSecurityAttendance(session, () => {
      void loadAttendance(true);
    });
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
      if (document.visibilityState === 'visible') {
        void loadAttendance(true);
      }
    }, 20000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [session, loadAttendance]);

  // Daftar nama petugas untuk dropdown filter (menggabungkan Pak Nurdenih, Pak Warta, Pak Sishantoyo, master petugas, dan data absensi)
  const officerFilterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const name of DEFAULT_SECURITY_OFFICER_NAMES) {
      map.set(name.toLowerCase(), name);
    }
    for (const p of petugasList) {
      const clean = p.nama.trim();
      if (clean) map.set(clean.toLowerCase(), clean);
    }
    for (const r of records) {
      const clean = r.officer_name.trim();
      if (clean && !map.has(clean.toLowerCase())) {
        map.set(clean.toLowerCase(), clean);
      }
    }
    return Array.from(map.values());
  }, [petugasList, records]);

  // Daftar pilihan shift untuk modal edit
  const shiftOptions = useMemo(() => {
    const set = new Set<string>([...STANDARD_SECURITY_SHIFTS, ...SHIFT_PETUGAS_OPTIONS]);
    if (editingRecord?.shift_name) {
      set.add(editingRecord.shift_name);
    }
    return Array.from(set);
  }, [editingRecord]);

  // Petugas sedang bertugas (ON DUTY) saat ini
  const liveOnDutyRecords = useMemo(() => {
    return records
      .filter((r) => r.status === 'on_duty')
      .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  }, [records]);

  // Progres Patroli NFC Siklus Aktif + Log Terakhir per Petugas
  const patrolCycleInfo = useMemo(() => {
    const activePoints = titikPatroliList.filter((t) => t.aktif !== false);
    const cycleResetMs = patrolMapConfig?.cycle_reset_at
      ? new Date(patrolMapConfig.cycle_reset_at).getTime()
      : (() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        })();

    const scannedCount = activePoints.filter((titik) => {
      const lower = titik.nama_lokasi.trim().toLowerCase();
      return patroliFeed.some((log) => {
        const ms = new Date(log.waktu_scan).getTime();
        if (Number.isNaN(ms) || ms < cycleResetMs) return false;
        return (
          (log.titik_id && log.titik_id === titik.id) ||
          log.nama_lokasi.trim().toLowerCase() === lower
        );
      });
    }).length;

    const findLastScanForOfficer = (officerName: string): LogPatroli | null => {
      const needle = officerName.trim().toLowerCase().replace(/^pak\s+/i, '');
      return (
        patroliFeed.find((log) => {
          const hay = log.nama_petugas.trim().toLowerCase();
          return (
            hay === officerName.trim().toLowerCase() ||
            (needle.length >= 3 && hay.includes(needle))
          );
        }) || null
      );
    };

    return {
      scannedCount,
      totalPoints: activePoints.length,
      findLastScanForOfficer,
    };
  }, [titikPatroliList, patroliFeed, patrolMapConfig]);

  // Data terfilter untuk Tabel Rekap Absensi
  const filteredRecapRecords = useMemo(() => {
    return records
      .filter((r) => {
        if (selectedMonth && !r.shift_date.startsWith(selectedMonth)) {
          return false;
        }
        if (
          selectedOfficer !== 'semua' &&
          r.officer_name.trim().toLowerCase() !== selectedOfficer.trim().toLowerCase()
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  }, [records, selectedMonth, selectedOfficer]);

  // Ringkasan KPI untuk filter bulan/petugas aktif (Acuan Honor & Lembur Bulanan)
  const recapSummary = useMemo(() => {
    let totalMinutes = 0;
    let onTimeCount = 0;
    let lateCount = 0;
    let missingClockOutCount = 0;
    let lemburMingguCount = 0;

    for (const r of filteredRecapRecords) {
      const ev = evaluateAttendance(r, nowMs);
      if (r.clock_out_at) {
        totalMinutes += ev.durationMinutes;
      }
      if (ev.isLate) lateCount += 1;
      else onTimeCount += 1;
      if (ev.isMissingClockOut) missingClockOutCount += 1;
      if (ev.isLemburMinggu) lemburMingguCount += 1;
    }

    return {
      totalSessions: filteredRecapRecords.length,
      totalMinutes,
      onTimeCount,
      lateCount,
      missingClockOutCount,
      lemburMingguCount,
    };
  }, [filteredRecapRecords, nowMs]);

  const openEditModal = (record: SecurityAttendanceRecord) => {
    setEditingRecord(record);
    setEditShiftDate(record.shift_date.slice(0, 10));
    setEditShiftName(record.shift_name);
    setEditClockInLocal(isoToWibDatetimeLocal(record.clock_in_at));
    setEditClockOutLocal(isoToWibDatetimeLocal(record.clock_out_at));
    setEditStatus(record.status);
    setEditNotes(record.handover_notes || '');
    setConfirmDeleteId(null);
  };

  const handleAutoFillScheduledEnd = () => {
    if (!editingRecord) return;
    const endIso = getScheduledEndIsoForRecord({
      ...editingRecord,
      shift_date: editShiftDate || editingRecord.shift_date,
      shift_name: editShiftName || editingRecord.shift_name,
    });
    setEditClockOutLocal(isoToWibDatetimeLocal(endIso));
    setEditStatus('completed');
  };

  const handleSaveEdit = async () => {
    if (!editingRecord || savingEdit) return;
    const clockInIso = wibDatetimeLocalToIso(editClockInLocal);
    if (!clockInIso) {
      onToast('error', 'Jam masuk wajib diisi dengan format yang valid.');
      return;
    }

    const clockOutIso = editClockOutLocal.trim()
      ? wibDatetimeLocalToIso(editClockOutLocal)
      : null;

    if (editStatus === 'completed' && !clockOutIso) {
      onToast('error', 'Isi jam pulang terlebih dahulu untuk menyelesaikan status absensi.');
      return;
    }

    setSavingEdit(true);
    try {
      const res = await adminUpdateSecurityAttendance(session, editingRecord.id, {
        shift_date: editShiftDate || editingRecord.shift_date,
        shift_name: editShiftName || editingRecord.shift_name,
        clock_in_at: clockInIso,
        clock_out_at: clockOutIso,
        status: clockOutIso ? 'completed' : editStatus,
        handover_notes: editNotes.trim() || null,
      });

      if (!res.ok) {
        onToast('error', res.message || 'Gagal menyimpan koreksi absensi.');
        return;
      }

      setEditingRecord(null);
      await loadAttendance(true);
      onToast('success', res.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    if (deletingId) return;
    setDeletingId(recordId);
    try {
      const res = await adminDeleteSecurityAttendance(session, recordId);
      if (!res.ok) {
        onToast('error', res.message);
        return;
      }
      setEditingRecord(null);
      setConfirmDeleteId(null);
      await loadAttendance(true);
      onToast('success', res.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. STATUS LIVE HARI INI */}
      <section
        aria-label="Status Live Petugas Bertugas Hari Ini"
        className="glass-card rounded-3xl overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-4 border-b border-white/15 flex flex-wrap items-center justify-between gap-3 glass-hero text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-white/15 border border-white/25 text-emerald-200 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold leading-tight">
                Status Live Petugas Jaga Hari Ini
              </h2>
              <p className="text-[11px] text-indigo-100/90 mt-0.5 truncate">
                Pembaruan real-time absen masuk, foto pos jaga &amp; progres patroli NFC terakhir
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={refreshing}
            onClick={() => void loadAttendance(true)}
            className="min-h-[38px] px-3.5 rounded-full bg-white/15 hover:bg-white/25 border border-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Segarkan</span>
          </button>
        </div>

        <div className="p-4 sm:p-5">
          {loading ? (
            <div className="h-28 rounded-2xl bg-indigo-50/70 animate-pulse" />
          ) : liveOnDutyRecords.length === 0 ? (
            <div className="rounded-2xl bg-indigo-50/45 border border-indigo-100/80 px-4 py-6 text-center space-y-1">
              <ShieldCheck className="w-7 h-7 text-indigo-300 mx-auto" />
              <p className="text-sm font-semibold text-slate-700">
                Belum Ada Petugas Berstatus ON DUTY Saat Ini
              </p>
              <p className="text-xs text-slate-500">
                Status akan muncul otomatis secara real-time saat petugas menekan tombol Absen Masuk
                di Portal Petugas.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
              {liveOnDutyRecords.map((rec) => {
                const ev = evaluateAttendance(rec, nowMs);
                const lastScan = patrolCycleInfo.findLastScanForOfficer(rec.officer_name);

                return (
                  <article
                    key={rec.id}
                    className={`rounded-xl border p-4 space-y-3 ${
                      ev.isMissingClockOut
                        ? 'border-red-300 bg-red-50/40'
                        : 'border-emerald-200 bg-emerald-50/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-600 text-white text-[10px] font-extrabold">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                            ON DUTY
                          </span>

                          {ev.isLate ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold tabular-nums">
                              Terlambat (+{ev.lateMinutes} mnt)
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-[10px] font-bold">
                              Tepat Waktu
                            </span>
                          )}

                          {ev.isMissingClockOut && (
                            <span className="px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                              Belum Absen Pulang
                            </span>
                          )}
                        </div>

                        <h3 className="text-base font-bold text-[#0F172A] truncate">
                          {rec.officer_name}
                        </h3>
                        <p className="text-xs text-slate-600">
                          {rec.shift_name} · {formatWibDateStr(rec.shift_date)}
                        </p>
                      </div>

                      {/* Thumbnail Foto Absen jika ada */}
                      {rec.clock_in_photo_url && isSafeAttendanceImageUrl(rec.clock_in_photo_url) ? (
                        <button
                          type="button"
                          onClick={() => setLightboxRecord(rec)}
                          title="Perbesar foto absen masuk"
                          className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-300 shrink-0 cursor-pointer group"
                        >
                          <img
                            src={rec.clock_in_photo_url}
                            alt={`Foto absen ${rec.officer_name}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </button>
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                          <Camera className="w-4 h-4" />
                        </div>
                      )}
                    </div>

                    {/* Jam Masuk & Progres Patroli NFC Terakhir */}
                    <div className="grid grid-cols-2 gap-2.5 pt-2.5 border-t border-slate-200/80 text-xs">
                      <div>
                        <p className="text-[11px] text-slate-500">Jam Masuk · Durasi</p>
                        <p className="font-mono font-bold text-[#0F172A] tabular-nums mt-0.5">
                          {formatWibTime(rec.clock_in_at)} · {ev.durationLabel}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                          <Radio className="w-3 h-3 text-[#059669]" />
                          <span>Patroli NFC Terakhir</span>
                        </p>
                        {lastScan ? (
                          <p className="text-xs font-semibold text-[#0F172A] truncate mt-0.5">
                            {lastScan.nama_lokasi}{' '}
                            <span className="font-mono font-normal text-slate-500 tabular-nums">
                              ({formatWibTime(lastScan.waktu_scan)})
                            </span>
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                            Siklus {patrolCycleInfo.scannedCount}/{patrolCycleInfo.totalPoints} Pos
                          </p>
                        )}
                      </div>
                    </div>

                    {rec.handover_notes && (
                      <p className="text-xs text-slate-700 bg-white border border-slate-200/80 rounded-lg px-2.5 py-1.5 whitespace-pre-line">
                        {rec.handover_notes}
                      </p>
                    )}

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(rec)}
                        className="min-h-[36px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>
                          {ev.isMissingClockOut ? 'Koreksi Jam Pulang' : 'Edit / Koreksi'}
                        </span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 2. RINGKASAN KPI REKAP BULANAN (ACUAN HONOR & LEMBUR) */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="glass-card rounded-3xl p-4">
          <p className="text-[11px] font-medium text-slate-500">Total Kehadiran</p>
          <p className="text-xl font-mono font-bold text-[#0F172A] tabular-nums mt-1">
            {recapSummary.totalSessions}{' '}
            <span className="text-xs font-sans font-normal text-slate-500">shift</span>
          </p>
        </div>
        <div className="glass-card rounded-3xl p-4">
          <p className="text-[11px] font-medium text-slate-500">Total Jam Kerja</p>
          <p className="text-xl font-mono font-bold text-[#4C1D95] tabular-nums mt-1">
            {formatHoursDecimal(recapSummary.totalMinutes)}
          </p>
        </div>
        <div className="glass-card rounded-3xl p-4">
          <p className="text-[11px] font-medium text-slate-500">Tepat Waktu</p>
          <p className="text-xl font-mono font-bold text-emerald-700 tabular-nums mt-1">
            {recapSummary.onTimeCount}
          </p>
        </div>
        <div className="glass-card rounded-3xl p-4">
          <p className="text-[11px] font-medium text-slate-500">Terlambat (&gt;15m)</p>
          <p className="text-xl font-mono font-bold text-amber-600 tabular-nums mt-1">
            {recapSummary.lateCount}
          </p>
        </div>
        <div className="col-span-2 lg:col-span-1 glass-card rounded-3xl p-4">
          <p className="text-[11px] font-medium text-slate-500">Lembur Minggu / Belum Pulang</p>
          <p className="text-base font-mono font-bold text-[#0F172A] tabular-nums mt-1.5">
            {recapSummary.lemburMingguCount} lembur{' '}
            <span className="text-slate-300 font-normal">·</span>{' '}
            <span className={recapSummary.missingClockOutCount > 0 ? 'text-red-600' : 'text-slate-500'}>
              {recapSummary.missingClockOutCount} lupa
            </span>
          </p>
        </div>
      </section>

      {/* 3. TABEL REKAP ABSENSI (FILTER BULAN & NAMA PETUGAS) */}
      <section
        aria-label="Tabel Rekap Absensi Keamanan"
        className="glass-card rounded-3xl overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-4 border-b border-indigo-100/80 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-[#0F172A]">
              Rekap Absensi &amp; Lembur Keamanan
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Acuan verifikasi honor rutin &amp; uang lembur bulanan. Klik Edit jika petugas lupa
              absen pulang.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-indigo-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="month"
                aria-label="Filter bulan absensi"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="min-h-[40px] pl-8 pr-3 rounded-2xl border border-indigo-100 bg-white/95 text-xs sm:text-sm font-medium text-[#0F172A] tabular-nums"
              />
            </div>

            <select
              aria-label="Filter nama petugas keamanan"
              value={selectedOfficer}
              onChange={(e) => setSelectedOfficer(e.target.value)}
              className="min-h-[40px] px-3 rounded-2xl border border-indigo-100 bg-white/95 text-xs sm:text-sm font-medium text-[#0F172A]"
            >
              <option value="semua">Semua Petugas</option>
              {officerFilterOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            <div className="h-12 rounded-2xl bg-indigo-50/70 animate-pulse" />
            <div className="h-12 rounded-2xl bg-indigo-50/70 animate-pulse" />
          </div>
        ) : filteredRecapRecords.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-slate-500">
            Tidak ada data absensi untuk filter bulan dan petugas yang dipilih.
          </div>
        ) : (
          <>
            {/* Tabel Desktop */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-indigo-50/70 border-b border-indigo-100/80 text-[11px] font-bold text-slate-600">
                    <th className="py-3 px-4">Tanggal</th>
                    <th className="py-3 px-4">Petugas &amp; Shift</th>
                    <th className="py-3 px-4">Masuk</th>
                    <th className="py-3 px-4">Pulang</th>
                    <th className="py-3 px-4">Total Jam</th>
                    <th className="py-3 px-4">Keterangan</th>
                    <th className="py-3 px-4">Catatan Serah Terima</th>
                    <th className="py-3 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-indigo-100/50 text-xs">
                  {filteredRecapRecords.map((rec) => {
                    const ev = evaluateAttendance(rec, nowMs);
                    return (
                      <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatWibDateStr(rec.shift_date)}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-bold text-[#0F172A]">{rec.officer_name}</p>
                          <p className="text-[11px] text-slate-500">{rec.shift_name}</p>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-[#0F172A] whitespace-nowrap">
                          {formatWibTime(rec.clock_in_at)}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                          {rec.clock_out_at ? (
                            <span className="text-[#0F172A]">{formatWibTime(rec.clock_out_at)}</span>
                          ) : (
                            <span className="text-amber-700 font-semibold">Belum pulang</span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold tabular-nums text-[#0F172A] whitespace-nowrap">
                          {rec.clock_out_at ? ev.durationLabel : `${ev.durationLabel} (aktif)`}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`inline-flex items-center gap-1 font-bold whitespace-nowrap ${
                                ev.isLate ? 'text-amber-700' : 'text-emerald-700'
                              }`}
                            >
                              {ev.isLate ? (
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>
                                {ev.isLate
                                  ? `Terlambat (+${ev.lateMinutes}m)`
                                  : 'Tepat Waktu'}
                              </span>
                            </span>
                            {ev.isMissingClockOut && (
                              <span className="text-[11px] font-bold text-red-600 inline-flex items-center gap-1 whitespace-nowrap">
                                <Clock className="w-3 h-3 shrink-0" />
                                <span>Belum Absen Pulang</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 max-w-[240px]">
                          <p className="text-slate-600 line-clamp-2 whitespace-pre-line">
                            {rec.handover_notes || '—'}
                          </p>
                          {rec.clock_in_photo_url &&
                            isSafeAttendanceImageUrl(rec.clock_in_photo_url) && (
                              <button
                                type="button"
                                onClick={() => setLightboxRecord(rec)}
                                className="mt-1 text-[11px] font-semibold text-[#059669] hover:underline inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="w-3 h-3" />
                                <span>Lihat Foto</span>
                              </button>
                            )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEditModal(rec)}
                            className="min-h-[34px] px-3 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Koreksi</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Daftar Kartu Mobile */}
            <div className="md:hidden divide-y divide-indigo-100/50">
              {filteredRecapRecords.map((rec) => {
                const ev = evaluateAttendance(rec, nowMs);
                return (
                  <article key={rec.id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#0F172A] truncate">
                          {rec.officer_name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatWibDateStr(rec.shift_date)} · {rec.shift_name}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openEditModal(rec)}
                        className="min-h-[36px] px-3 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Koreksi</span>
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-700">
                      <span>
                        {formatWibTime(rec.clock_in_at)} →{' '}
                        {rec.clock_out_at ? formatWibTime(rec.clock_out_at) : 'Belum pulang'}
                      </span>
                      <span className="font-bold text-[#0F172A]">{ev.durationLabel}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span
                        className={`font-bold inline-flex items-center gap-1 ${
                          ev.isLate ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {ev.isLate ? `Terlambat (+${ev.lateMinutes}m)` : 'Tepat Waktu'}
                      </span>
                      {ev.isMissingClockOut && (
                        <span className="font-bold text-red-600">Belum Absen Pulang</span>
                      )}
                      {rec.clock_in_photo_url &&
                        isSafeAttendanceImageUrl(rec.clock_in_photo_url) && (
                          <button
                            type="button"
                            onClick={() => setLightboxRecord(rec)}
                            className="font-semibold text-[#4C1D95] underline cursor-pointer"
                          >
                            Lihat Foto
                          </button>
                        )}
                    </div>

                    {rec.handover_notes && (
                      <p className="text-xs text-slate-600 bg-indigo-50/45 border border-indigo-100/80 rounded-xl px-2.5 py-1.5 whitespace-pre-line">
                        {rec.handover_notes}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>

            {/* Footer Total Jam Kerja */}
            <div className="px-4 sm:px-5 py-3 bg-indigo-50/50 border-t border-indigo-100/80 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-600">
                Menampilkan <strong className="text-[#0F172A]">{recapSummary.totalSessions}</strong>{' '}
                catatan absensi ({selectedOfficer === 'semua' ? 'Semua Petugas' : selectedOfficer})
              </span>
              <span className="font-mono font-bold text-[#4C1D95] tabular-nums">
                Akumulasi Jam Kerja Selesai: {formatDurationMinutes(recapSummary.totalMinutes)} (
                {formatHoursDecimal(recapSummary.totalMinutes)})
              </span>
            </div>
          </>
        )}
      </section>

      {/* MODAL EDIT / KOREKSI DATA ABSENSI (ADMIN) */}
      {editingRecord && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Koreksi Data Absensi Petugas"
        >
          <div className="bg-white/95 backdrop-blur-xl w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-white/90 shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col animate-modal-pop">
            <div className="px-5 py-4 border-b border-indigo-100/70 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">
                  Edit / Koreksi Data Absensi
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Petugas: <strong className="text-[#0F172A]">{editingRecord.officer_name}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                aria-label="Tutup modal koreksi absensi"
                className="min-h-[40px] min-w-[40px] rounded-full hover:bg-indigo-50 flex items-center justify-center text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Tanggal Mulai Shift
                  </label>
                  <input
                    type="date"
                    value={editShiftDate}
                    onChange={(e) => setEditShiftDate(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono text-[#0F172A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Jadwal Shift
                  </label>
                  <select
                    value={editShiftName}
                    onChange={(e) => setEditShiftName(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A]"
                  >
                    {shiftOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Jam Masuk (WIB)
                  </label>
                  <input
                    type="datetime-local"
                    value={editClockInLocal}
                    onChange={(e) => setEditClockInLocal(e.target.value)}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono text-[#0F172A]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Jam Pulang (WIB)
                    </label>
                    <button
                      type="button"
                      onClick={handleAutoFillScheduledEnd}
                      className="text-[11px] font-semibold text-[#059669] hover:underline cursor-pointer"
                    >
                      Isi Akhir Shift
                    </button>
                  </div>
                  <input
                    type="datetime-local"
                    value={editClockOutLocal}
                    onChange={(e) => {
                      setEditClockOutLocal(e.target.value);
                      if (e.target.value) setEditStatus('completed');
                    }}
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono text-[#0F172A]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Status Sesi Jaga
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditStatus('on_duty');
                      setEditClockOutLocal('');
                    }}
                    className={`min-h-[40px] rounded-xl border text-xs font-bold cursor-pointer transition ${
                      editStatus === 'on_duty'
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Sedang Bertugas (On Duty)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditStatus('completed');
                      if (!editClockOutLocal) {
                        handleAutoFillScheduledEnd();
                      }
                    }}
                    className={`min-h-[40px] rounded-2xl border text-xs font-bold cursor-pointer transition ${
                      editStatus === 'completed'
                        ? 'bg-[#4C1D95] border-[#4C1D95] text-white'
                        : 'bg-white border-slate-300 text-slate-700 hover:bg-indigo-50/50'
                    }`}
                  >
                    Selesai Bertugas
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Catatan Serah Terima / Koreksi Admin
                </label>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Misal: Dikoreksi Admin karena petugas lupa menekan tombol Absen Pulang..."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#0F172A]"
                />
              </div>

              {/* Opsi Hapus Catatan Salah / Duplikat */}
              <div className="pt-2 border-t border-indigo-100/70 flex items-center justify-between gap-2">
                {confirmDeleteId === editingRecord.id ? (
                  <div className="w-full rounded-2xl bg-red-50 border border-red-200 p-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-red-900">
                      Hapus permanen baris absensi ini?
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="min-h-[34px] px-3 rounded-full bg-white border border-indigo-100 text-xs font-semibold text-slate-700 cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={deletingId === editingRecord.id}
                        onClick={() => void handleDeleteRecord(editingRecord.id)}
                        className="min-h-[34px] px-3 rounded-full bg-red-600 hover:bg-red-700 text-white text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                      >
                        {deletingId === editingRecord.id && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        <span>Ya, Hapus</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(editingRecord.id)}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus data absensi ini</span>
                  </button>
                )}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-indigo-100/70 bg-indigo-50/40 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => setEditingRecord(null)}
                className="min-h-[44px] rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-slate-700 text-sm font-semibold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={() => void handleSaveEdit()}
                className="min-h-[44px] rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-60 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                {savingEdit && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{savingEdit ? 'Menyimpan...' : 'Simpan Koreksi'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIGHTBOX FOTO ABSEN */}
      {lightboxRecord &&
        lightboxRecord.clock_in_photo_url &&
        isSafeAttendanceImageUrl(lightboxRecord.clock_in_photo_url) && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4 animate-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-label="Foto Absen Petugas"
            onClick={() => setLightboxRecord(null)}
          >
            <div
              className="max-w-lg w-full bg-white/95 backdrop-blur-xl rounded-3xl border border-white/90 overflow-hidden shadow-2xl animate-modal-pop"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-indigo-100/70 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#0F172A] truncate">
                    Foto Absen Masuk · {lightboxRecord.officer_name}
                  </p>
                  <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                    {lightboxRecord.shift_name} · {formatTanggalWaktu(lightboxRecord.clock_in_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setLightboxRecord(null)}
                  aria-label="Tutup foto absen"
                  className="min-h-[36px] min-w-[36px] rounded-full hover:bg-indigo-50 flex items-center justify-center text-slate-600 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <img
                src={lightboxRecord.clock_in_photo_url}
                alt={`Foto absen masuk ${lightboxRecord.officer_name}`}
                referrerPolicy="no-referrer"
                className="w-full max-h-[70dvh] object-contain bg-slate-900"
              />
            </div>
          </div>
        )}
    </div>
  );
}
