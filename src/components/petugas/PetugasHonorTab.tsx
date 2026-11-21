import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  Moon,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import type {
  SecurityShiftOverride,
  SessionUser,
  TransaksiKas,
} from '../../types';
import { formatRupiah, formatTanggal } from '../../lib/format';
import {
  formatWibDateStr,
  formatWibDateTime,
  getWibParts,
} from '../../lib/securityAttendanceService';
import {
  fetchShiftOverrides,
  isSundayOvertimeShift,
  subscribeShiftOverrides,
} from '../../lib/securityShiftOvertimeService';

interface PetugasHonorTabProps {
  session: SessionUser;
  officerName: string;
  riwayatHonor: TransaksiKas[];
  onOpenKwitansi: (trx: TransaksiKas) => void;
}

export function PetugasHonorTab({
  session,
  officerName,
  riwayatHonor,
  onOpenKwitansi,
}: PetugasHonorTabProps) {
  const [overrides, setOverrides] = useState<SecurityShiftOverride[]>([]);
  const [loadingOverrides, setLoadingOverrides] = useState(true);

  const loadOverrides = useCallback(async () => {
    try {
      const list = await fetchShiftOverrides(session, {
        officerName,
        limit: 120,
      });
      setOverrides(list);
    } finally {
      setLoadingOverrides(false);
    }
  }, [session, officerName]);

  useEffect(() => {
    void loadOverrides();
    const unsub = subscribeShiftOverrides(session, () => {
      void loadOverrides();
    });
    return () => {
      unsub();
    };
  }, [session, loadOverrides]);

  const currentMonthStr = getWibParts().monthStr;

  const lemburOverrides = useMemo(
    () => overrides.filter((o) => isSundayOvertimeShift(o.shift_name)),
    [overrides]
  );

  // Peta penghubung antara override lembur dan transaksi kas (untuk e-Kwitansi & anti hitung ganda)
  const linkedCashByOverrideId = useMemo(() => {
    const map = new Map<string, TransaksiKas>();
    lemburOverrides.forEach((ov) => {
      const matched = riwayatHonor.find(
        (trx) =>
          (ov.cash_transaction_id && trx.id === ov.cash_transaction_id) ||
          (trx.shift_override_id && trx.shift_override_id === ov.id)
      );
      if (matched) {
        map.set(ov.id, matched);
      }
    });
    return map;
  }, [lemburOverrides, riwayatHonor]);

  const linkedCashIds = useMemo(() => {
    const set = new Set<string>();
    linkedCashByOverrideId.forEach((trx) => set.add(trx.id));
    return set;
  }, [linkedCashByOverrideId]);

  // Ringkasan Total Lembur Bulan Ini (WIB)
  const currentMonthLemburSummary = useMemo(() => {
    const thisMonth = lemburOverrides.filter((o) => o.shift_date.startsWith(currentMonthStr));
    const paid = thisMonth.filter(
      (o) => o.payment_status === 'paid' || Boolean(o.cash_transaction_id)
    );
    const unpaid = thisMonth.filter(
      (o) => o.payment_status !== 'paid' && !o.cash_transaction_id
    );
    return {
      paidTotal: paid.reduce((sum, o) => sum + o.overtime_amount, 0),
      paidCount: paid.length,
      unpaidTotal: unpaid.reduce((sum, o) => sum + o.overtime_amount, 0),
      unpaidCount: unpaid.length,
      totalScheduledNominal: thisMonth.reduce((sum, o) => sum + o.overtime_amount, 0),
      totalCount: thisMonth.length,
    };
  }, [lemburOverrides, currentMonthStr]);

  // Total keseluruhan honor & lembur yang sudah dibayarkan (tanpa double-counting)
  const totalHonorDiterima = useMemo(() => {
    const cashSum = riwayatHonor.reduce((sum, trx) => sum + trx.nominal, 0);
    const paidWithoutCash = lemburOverrides
      .filter(
        (o) =>
          (o.payment_status === 'paid' || Boolean(o.cash_transaction_id)) &&
          !linkedCashByOverrideId.has(o.id)
      )
      .reduce((sum, o) => sum + o.overtime_amount, 0);
    return cashSum + paidWithoutCash;
  }, [riwayatHonor, lemburOverrides, linkedCashByOverrideId]);

  // Riwayat honor bulanan / pencairan kas lainnya yang belum tampil di daftar Lembur Minggu
  const otherHonorRows = useMemo(
    () => riwayatHonor.filter((trx) => !linkedCashIds.has(trx.id)),
    [riwayatHonor, linkedCashIds]
  );

  return (
    <div className="space-y-4">
      {/* RINGKASAN TOTAL LEMBUR BULAN INI & TOTAL HONOR DITERIMA (READ-ONLY) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[#0F172A] text-white border border-slate-800 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
              Total Lembur Bulan Ini
            </p>
            <Moon className="w-4 h-4 text-emerald-400 shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-white tabular-nums">
            {formatRupiah(currentMonthLemburSummary.paidTotal)}
          </p>
          <p className="text-[11px] text-slate-300 leading-snug tabular-nums">
            {currentMonthLemburSummary.paidCount} jadwal lunas
            {currentMonthLemburSummary.unpaidCount > 0
              ? ` · ${currentMonthLemburSummary.unpaidCount} terjadwal (${formatRupiah(
                  currentMonthLemburSummary.unpaidTotal
                )})`
              : ' · Sinkron otomatis dengan Buku Kas'}
          </p>
        </div>

        <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200/90 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-800">
              Total Honor &amp; Lembur Diterima
            </p>
            <Wallet className="w-4 h-4 text-[#059669] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-[#0F172A] tabular-nums">
            {formatRupiah(totalHonorDiterima)}
          </p>
          <p className="text-[11px] font-medium text-emerald-800">
            Privasi Pribadi Terisolasi · Hanya Tampil untuk {officerName}
          </p>
        </div>
      </section>

      {/* DAFTAR LEMBUR MINGGU (19:00 – 07:00 WIB) */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Moon className="w-4 h-4 text-indigo-600 shrink-0" />
            <h2 className="text-sm font-bold text-[#0F172A] truncate">
              Jadwal &amp; Pencairan Lembur Minggu
            </h2>
          </div>
          <span className="text-xs font-mono font-semibold text-slate-500 tabular-nums shrink-0">
            {lemburOverrides.length} catatan
          </span>
        </div>

        {loadingOverrides ? (
          <div className="p-4 space-y-2.5">
            <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
            <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
          </div>
        ) : lemburOverrides.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            Belum ada jadwal Lembur Minggu (19:00 – 07:00 WIB) atas nama Anda.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {lemburOverrides.map((ov) => {
              const isPaid = ov.payment_status === 'paid' || Boolean(ov.cash_transaction_id);
              const linkedTrx = linkedCashByOverrideId.get(ov.id) || null;
              return (
                <article
                  key={ov.id}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-xs sm:text-sm font-bold text-[#0F172A]">
                        Lembur Minggu · 19:00 – 07:00 WIB
                      </p>
                      <span
                        className={`text-[11px] font-extrabold px-2 py-0.5 rounded-md border ${
                          isPaid
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {isPaid ? 'DIBAYARKAN / LUNAS' : 'TERJADWAL / BELUM DIBAYAR'}
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 font-medium tabular-nums">
                      Tanggal Tugas: <strong className="text-[#0F172A]">{formatWibDateStr(ov.shift_date)}</strong>
                    </p>

                    {isPaid && ov.paid_at ? (
                      <p className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Dibayarkan pada {formatWibDateTime(ov.paid_at)}</span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-700 inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>Menunggu pencairan &amp; pencatatan kas oleh Bendahara / Admin</span>
                      </p>
                    )}

                    {ov.notes && (
                      <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/70 rounded-lg px-2.5 py-1">
                        {ov.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <p className="text-base font-mono font-extrabold text-[#0F172A] tabular-nums">
                      {formatRupiah(ov.overtime_amount)}
                    </p>
                    {linkedTrx && (
                      <button
                        type="button"
                        onClick={() => onOpenKwitansi(linkedTrx)}
                        className="min-h-[40px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span>e-Kwitansi</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* RIWAYAT HONOR BULANAN & PENCAIRAN KAS */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="w-4 h-4 text-[#059669] shrink-0" />
            <h2 className="text-sm font-bold text-[#0F172A] truncate">
              Riwayat Honor Bulanan &amp; Pencairan Kas
            </h2>
          </div>
          <span className="text-xs font-mono font-semibold text-slate-500 tabular-nums shrink-0">
            {otherHonorRows.length} bukti
          </span>
        </div>

        {otherHonorRows.length === 0 ? (
          <div className="p-7 text-center space-y-1.5">
            <ShieldAlert className="w-7 h-7 text-slate-400 mx-auto" />
            <p className="text-xs font-bold text-slate-700">
              Belum Ada Catatan Honor Rutin Lainnya
            </p>
            <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
              Setiap pencairan honor rutin (Termin Tgl 7 &amp; Tgl 18) maupun uang lembur yang
              dicatat Bendahara atas nama Anda akan langsung tampil beserta e-Kwitansinya di sini.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {otherHonorRows.map((trx) => {
              const isLembur =
                trx.jenis_honor === 'lembur' || trx.kategori.toLowerCase().includes('lembur');
              return (
                <div
                  key={trx.id}
                  className="p-3.5 sm:px-5 sm:py-4 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span
                        className={`font-bold ${isLembur ? 'text-indigo-700' : 'text-emerald-700'}`}
                      >
                        {isLembur ? 'Uang Lembur' : 'Honor Rutin'}
                      </span>
                      {trx.termin && (
                        <>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="text-slate-700 font-semibold">{trx.termin}</span>
                        </>
                      )}
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {formatTanggal(trx.tanggal)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2">
                      {trx.keterangan || trx.kategori}
                    </p>
                    <p className="text-[11px] font-mono text-slate-400">{trx.no_bukti}</p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <p className="text-base font-mono font-extrabold text-[#0F172A] tabular-nums">
                      {formatRupiah(trx.nominal)}
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenKwitansi(trx)}
                      className="min-h-[40px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <FileText className="w-3.5 h-3.5 shrink-0" />
                      <span>e-Kwitansi</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
