import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Clock, ShieldCheck } from 'lucide-react';
import type { SecurityAttendanceRecord, SessionUser } from '../../types';
import {
  evaluateAttendance,
  fetchSecurityAttendance,
  formatWibDateStr,
  formatWibTime,
  getWibParts,
  subscribeSecurityAttendance,
} from '../../lib/securityAttendanceService';

interface WargaActiveGuardCardProps {
  session?: SessionUser;
}

/**
 * Monitoring Absensi Petugas Jaga Real-Time untuk Akun Warga (Read-Only).
 * Otomatis terbarui melalui Supabase Realtime tanpa refresh manual.
 */
export function WargaActiveGuardCard({ session }: WargaActiveGuardCardProps) {
  const [records, setRecords] = useState<SecurityAttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const loadAttendance = useCallback(async () => {
    try {
      const list = await fetchSecurityAttendance(session || null, { limit: 40 });
      setRecords(list);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void loadAttendance();
    const unsub = subscribeSecurityAttendance(session || null, () => {
      void loadAttendance();
    });
    // Sinkronisasi ringan cadangan setiap 20 detik saat tab aktif + pembaruan durasi
    const syncId = window.setInterval(() => {
      setNowMs(Date.now());
      if (document.visibilityState === 'visible') {
        void loadAttendance();
      }
    }, 20000);
    return () => {
      unsub();
      window.clearInterval(syncId);
    };
  }, [session, loadAttendance]);

  const todayWib = useMemo(() => getWibParts(new Date(nowMs)).dateStr, [nowMs]);

  // Daftar petugas yang sedang ON DUTY saat ini (maks 36 jam terakhir agar bersih dari data lama)
  const activeOfficers = useMemo(() => {
    const cutoffMs = nowMs - 36 * 3_600_000;
    return records
      .filter((r) => {
        if (r.status !== 'on_duty') return false;
        const inMs = new Date(r.clock_in_at).getTime();
        return !Number.isNaN(inMs) && inMs >= cutoffMs;
      })
      .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  }, [records, nowMs]);

  // Ringkasan Log Aktivitas Jaga Hari Ini (masuk hari ini, pulang hari ini, atau sedang on_duty)
  const todayLogs = useMemo(() => {
    return records
      .filter((r) => {
        if (r.status === 'on_duty') {
          const inMs = new Date(r.clock_in_at).getTime();
          return !Number.isNaN(inMs) && nowMs - inMs <= 36 * 3_600_000;
        }
        const clockInWib = getWibParts(new Date(r.clock_in_at)).dateStr;
        const clockOutWib = r.clock_out_at ? getWibParts(new Date(r.clock_out_at)).dateStr : '';
        return r.shift_date === todayWib || clockInWib === todayWib || clockOutWib === todayWib;
      })
      .sort((a, b) => new Date(b.clock_in_at).getTime() - new Date(a.clock_in_at).getTime());
  }, [records, todayWib, nowMs]);

  return (
    <section
      aria-label="Petugas Jaga Aktif Saat Ini"
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden"
    >
      {/* Header Kartu */}
      <div className="bg-[#0F172A] text-white px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-white leading-tight">
              Petugas Jaga Aktif Saat Ini
            </h2>
            <p className="text-[11px] text-slate-300 mt-0.5 truncate">
              Status kehadiran petugas keamanan Perumahan Saung Kebun secara real-time
            </p>
          </div>
        </div>
        <span className="text-[11px] font-mono text-slate-300 tabular-nums shrink-0">
          {formatWibDateStr(todayWib)}
        </span>
      </div>

      {/* Status Petugas Aktif */}
      <div className="p-4 sm:p-5 space-y-4">
        {loading ? (
          <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
        ) : activeOfficers.length > 0 ? (
          <div className="space-y-2.5">
            {activeOfficers.map((officer) => {
              const ev = evaluateAttendance(officer, nowMs);
              return (
                <div
                  key={officer.id}
                  className="rounded-xl bg-emerald-50/70 border border-emerald-200 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-600 text-white text-[11px] font-extrabold tracking-wide">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-80" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                        </span>
                        SEDANG BERTUGAS
                      </span>
                      <span className="text-xs font-semibold text-emerald-900">
                        {officer.shift_name}
                      </span>
                    </div>

                    <p className="text-base font-bold text-[#0F172A] truncate">
                      {officer.officer_name}
                    </p>

                    <p className="text-xs text-slate-600 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>Masuk pukul {formatWibTime(officer.clock_in_at)}</span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span>Berjalan {ev.durationLabel}</span>
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-[11px] text-emerald-800 font-semibold">
                      Siaga di Pos Security
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Shift mulai {formatWibDateStr(officer.shift_date)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-200/80 text-slate-500 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-700">
                Menunggu konfirmasi absensi petugas shift berikutnya
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Status akan langsung berubah otomatis begitu petugas melakukan Absen Masuk di pos.
              </p>
            </div>
          </div>
        )}

        {/* Ringkasan Log Aktivitas Jaga Hari Ini */}
        <div className="pt-3 border-t border-slate-200/80 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-[#0F172A] inline-flex items-center gap-1.5">
              <ClipboardList className="w-3.5 h-3.5 text-[#059669]" />
              <span>Log Aktivitas Jaga Hari Ini</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {todayLogs.length} catatan
            </span>
          </div>

          {todayLogs.length === 0 ? (
            <p className="text-xs text-slate-500 py-2">
              Belum ada aktivitas masuk atau serah terima shift yang tercatat hari ini.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
              {todayLogs.map((log) => {
                const isOnDuty = log.status === 'on_duty';
                const ev = evaluateAttendance(log, nowMs);
                return (
                  <article key={log.id} className="px-3.5 py-3 bg-white space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs sm:text-sm font-bold text-[#0F172A]">
                          {log.officer_name}
                        </span>
                        <span className="text-xs text-slate-400 mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-xs font-medium text-slate-600">{log.shift_name}</span>
                      </div>

                      <span
                        className={`text-[11px] font-bold inline-flex items-center gap-1 shrink-0 ${
                          isOnDuty ? 'text-emerald-700' : 'text-slate-600'
                        }`}
                      >
                        {isOnDuty ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>Sedang Bertugas</span>
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Selesai ({ev.durationLabel})</span>
                          </>
                        )}
                      </span>
                    </div>

                    <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                      Masuk {formatWibTime(log.clock_in_at)}
                      {log.clock_out_at
                        ? ` · Pulang ${formatWibTime(log.clock_out_at)}`
                        : ' · Masih bertugas di pos'}
                    </p>

                    {log.handover_notes && (
                      <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200/70 rounded-lg px-2.5 py-1.5 whitespace-pre-line">
                        {log.handover_notes}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
