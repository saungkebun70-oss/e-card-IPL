import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  Moon,
  ShieldAlert,
  ThumbsUp,
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
import {
  dispatchActivityNotifications,
  getAllAdminUserIds,
} from '../../lib/notificationService';

interface PetugasHonorTabProps {
  session: SessionUser;
  officerName: string;
  riwayatHonor: TransaksiKas[];
  onOpenKwitansi: (trx: TransaksiKas) => void;
  onToast?: (type: 'success' | 'error' | 'info', message: string) => void;
}

const HONOR_CONFIRMED_STORAGE_KEY = 'ecard_petugas_honor_confirmed_v1';

function readConfirmedHonorMap(): Record<string, string> {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(HONOR_CONFIRMED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeConfirmedHonorMap(map: Record<string, string>): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(HONOR_CONFIRMED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Abaikan keterbatasan storage
  }
}

export function PetugasHonorTab({
  session,
  officerName,
  riwayatHonor,
  onOpenKwitansi,
  onToast,
}: PetugasHonorTabProps) {
  const [overrides, setOverrides] = useState<SecurityShiftOverride[]>([]);
  const [loadingOverrides, setLoadingOverrides] = useState(true);
  const [confirmedMap, setConfirmedMap] = useState<Record<string, string>>(() =>
    readConfirmedHonorMap()
  );
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);

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

  const handleConfirmHonorReceipt = useCallback(
    async (confirmKey: string, periodeLabel: string, nominal: number) => {
      if (confirmingKey || confirmedMap[confirmKey]) return;
      setConfirmingKey(confirmKey);
      try {
        const nowIso = new Date().toISOString();
        const nextMap = { ...confirmedMap, [confirmKey]: nowIso };
        setConfirmedMap(nextMap);
        writeConfirmedHonorMap(nextMap);

        const pushTitle = 'Update dari Petugas Keamanan';
        const pushBody = `${officerName} telah mengonfirmasi penerimaan honor (${periodeLabel} · ${formatRupiah(nominal)}).`;

        const honorConfirmDedup = `honor-confirm:${confirmKey}`;
        await dispatchActivityNotifications(
          session,
          getAllAdminUserIds().map((uid) => ({
            user_id: uid,
            category: 'finance' as const,
            title: pushTitle,
            message: pushBody,
            target_url: 'tab:keuangan',
            dedup_key: honorConfirmDedup,
          })),
          {
            target_roles: ['admin'],
            category: 'finance',
            title: pushTitle,
            body: pushBody,
            target_url: 'tab:keuangan',
            dedup_key: honorConfirmDedup,
          }
        );

        onToast?.(
          'success',
          `Konfirmasi penerimaan honor (${periodeLabel}) telah dikirim ke Pengurus.`
        );
      } finally {
        setConfirmingKey(null);
      }
    },
    [confirmingKey, confirmedMap, officerName, session, onToast]
  );

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
        <div className="rounded-3xl glass-hero bg-gradient-to-br from-[#243825] via-[#2B3F29] to-[#384E35] shadow-md text-[#FFFDF8] p-4 sm:p-5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#E5EEE3]">
              Total Lembur Bulan Ini
            </p>
            <Moon className="w-4 h-4 text-[#E5EEE3] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-[#FFFDF8] tabular-nums">
            {formatRupiah(currentMonthLemburSummary.paidTotal)}
          </p>
          <p className="text-[11px] text-[#E5EEE3]/85 leading-snug tabular-nums">
            {currentMonthLemburSummary.paidCount} jadwal lunas
            {currentMonthLemburSummary.unpaidCount > 0
              ? ` · ${currentMonthLemburSummary.unpaidCount} terjadwal (${formatRupiah(
                  currentMonthLemburSummary.unpaidTotal
                )})`
              : ' · Sinkron otomatis dengan Buku Kas'}
          </p>
        </div>

        <div className="rounded-3xl glass-card bg-[#FFFDF8] border border-[#E6E2D6] p-4 sm:p-5 space-y-2 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#2B3F29]">
              Total Honor &amp; Lembur Diterima
            </p>
            <Wallet className="w-4 h-4 text-[#2B3F29] shrink-0" />
          </div>
          <p className="text-xl sm:text-2xl font-mono font-extrabold text-[#1B271B] tabular-nums">
            {formatRupiah(totalHonorDiterima)}
          </p>
          <p className="text-[11px] font-medium text-[#6E786D]">
            Privasi Pribadi Terisolasi · Hanya Tampil untuk {officerName}
          </p>
        </div>
      </section>

      {/* DAFTAR LEMBUR MINGGU (19:00 – 07:00 WIB) */}
      <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Moon className="w-4 h-4 text-[#2B3F29] shrink-0" />
            <h2 className="text-sm font-bold text-[#1B271B] truncate">
              Jadwal &amp; Pencairan Lembur Minggu
            </h2>
          </div>
          <span className="text-xs font-mono font-semibold text-[#6E786D] tabular-nums shrink-0">
            {lemburOverrides.length} catatan
          </span>
        </div>

        {loadingOverrides ? (
          <div className="p-4 space-y-2.5">
            <div className="h-16 rounded-2xl bg-[#F7F4EC] animate-pulse" />
            <div className="h-16 rounded-2xl bg-[#F7F4EC] animate-pulse" />
          </div>
        ) : lemburOverrides.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[#6E786D]">
            Belum ada jadwal Lembur Minggu (19:00 – 07:00 WIB) atas nama Anda.
          </div>
        ) : (
          <div className="divide-y divide-[#E6E2D6]">
            {lemburOverrides.map((ov) => {
              const isPaid = ov.payment_status === 'paid' || Boolean(ov.cash_transaction_id);
              const linkedTrx = linkedCashByOverrideId.get(ov.id) || null;
              const confirmKey = `lembur:${ov.id}`;
              const isConfirmed = Boolean(confirmedMap[confirmKey]);
              return (
                <article
                  key={ov.id}
                  className="p-4 sm:px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-xs sm:text-sm font-bold text-[#1B271B]">
                        Lembur Minggu · 19:00 – 07:00 WIB
                      </p>
                      <span
                        className={`text-[11px] font-extrabold px-2 py-0.5 rounded-md border ${
                          isPaid
                            ? 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]'
                            : 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]'
                        }`}
                      >
                        {isPaid ? 'DIBAYARKAN / LUNAS' : 'TERJADWAL / BELUM DIBAYAR'}
                      </span>
                    </div>

                    <p className="text-xs text-[#4A554A] font-medium tabular-nums">
                      Tanggal Tugas: <strong className="text-[#1B271B]">{formatWibDateStr(ov.shift_date)}</strong>
                    </p>

                    {isPaid && ov.paid_at ? (
                      <p className="text-[11px] text-[#243825] inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>Dibayarkan pada {formatWibDateTime(ov.paid_at)}</span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-[#6E4D12] inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>Menunggu pencairan &amp; pencatatan kas oleh Bendahara / Admin</span>
                      </p>
                    )}

                    {ov.notes && (
                      <p className="text-[11px] text-[#4A554A] bg-[#F7F4EC] border border-[#E6E2D6] rounded-xl px-2.5 py-1">
                        {ov.notes}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                    <p className="text-base font-mono font-extrabold text-[#1B271B] tabular-nums mr-1">
                      {formatRupiah(ov.overtime_amount)}
                    </p>
                    {isPaid && (
                      <button
                        type="button"
                        disabled={isConfirmed || confirmingKey === confirmKey}
                        onClick={() =>
                          void handleConfirmHonorReceipt(
                            confirmKey,
                            `Lembur Minggu ${formatWibDateStr(ov.shift_date)}`,
                            ov.overtime_amount
                          )
                        }
                        className={`min-h-[40px] px-3.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                          isConfirmed
                            ? 'border-[#C6D2BF] bg-[#E5EEE3] text-[#243825] cursor-default'
                            : 'border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-[#1B271B] cursor-pointer'
                        }`}
                      >
                        {isConfirmed ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Dikonfirmasi</span>
                          </>
                        ) : (
                          <>
                            <ThumbsUp className="w-3.5 h-3.5 shrink-0 text-[#2B3F29]" />
                            <span>
                              {confirmingKey === confirmKey ? 'Mengirim...' : 'Konfirmasi Terima'}
                            </span>
                          </>
                        )}
                      </button>
                    )}
                    {linkedTrx && (
                      <button
                        type="button"
                        onClick={() => onOpenKwitansi(linkedTrx)}
                        className="min-h-[40px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D6E4D3] text-[#243825] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
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
      <section className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden shadow-xs">
        <div className="px-4 sm:px-5 py-3.5 border-b border-[#E6E2D6] bg-[#F7F4EC]/70 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="w-4 h-4 text-[#2B3F29] shrink-0" />
            <h2 className="text-sm font-bold text-[#1B271B] truncate">
              Riwayat Honor Bulanan &amp; Pencairan Kas
            </h2>
          </div>
          <span className="text-xs font-mono font-semibold text-[#6E786D] tabular-nums shrink-0">
            {otherHonorRows.length} bukti
          </span>
        </div>

        {otherHonorRows.length === 0 ? (
          <div className="p-7 text-center space-y-1.5">
            <ShieldAlert className="w-7 h-7 text-[#C6D2BF] mx-auto" />
            <p className="text-xs font-bold text-[#1B271B]">
              Belum Ada Catatan Honor Rutin Lainnya
            </p>
            <p className="text-[11px] text-[#6E786D] max-w-sm mx-auto leading-relaxed">
              Setiap pencairan honor rutin (Termin Tgl 7 &amp; Tgl 18) maupun uang lembur yang
              dicatat Bendahara atas nama Anda akan langsung tampil beserta e-Kwitansinya di sini.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E6E2D6]">
            {otherHonorRows.map((trx) => {
              const isLembur =
                trx.jenis_honor === 'honor_rutin'
                  ? false
                  : trx.jenis_honor === 'lembur' || trx.kategori.toLowerCase().includes('lembur');
              const confirmKey = `kas:${trx.id}`;
              const isConfirmed = Boolean(confirmedMap[confirmKey]);
              const periodeLabel =
                trx.termin || `${isLembur ? 'Uang Lembur' : 'Honor Rutin'} ${formatTanggal(trx.tanggal)}`;
              return (
                <div
                  key={trx.id}
                  className="p-3.5 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span
                        className={`font-bold ${isLembur ? 'text-[#6E4D12]' : 'text-[#243825]'}`}
                      >
                        {isLembur ? 'Uang Lembur' : 'Honor Rutin'}
                      </span>
                      {trx.termin && (
                        <>
                          <span aria-hidden="true" className="text-[#C6D2BF]">
                            ·
                          </span>
                          <span className="text-[#4A554A] font-semibold">{trx.termin}</span>
                        </>
                      )}
                      <span aria-hidden="true" className="text-[#C6D2BF]">
                        ·
                      </span>
                      <span className="font-mono text-[#6E786D] tabular-nums">
                        {formatTanggal(trx.tanggal)}
                      </span>
                    </div>
                    <p className="text-xs text-[#4A554A] line-clamp-2">
                      {trx.keterangan || trx.kategori}
                    </p>
                    <p className="text-[11px] font-mono text-[#6E786D]">{trx.no_bukti}</p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                    <p className="text-base font-mono font-extrabold text-[#1B271B] tabular-nums mr-1">
                      {formatRupiah(trx.nominal)}
                    </p>
                    <button
                      type="button"
                      disabled={isConfirmed || confirmingKey === confirmKey}
                      onClick={() =>
                        void handleConfirmHonorReceipt(confirmKey, periodeLabel, trx.nominal)
                      }
                      className={`min-h-[40px] px-3.5 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                        isConfirmed
                          ? 'border-[#C6D2BF] bg-[#E5EEE3] text-[#243825] cursor-default'
                          : 'border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-[#1B271B] cursor-pointer'
                      }`}
                    >
                      {isConfirmed ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Dikonfirmasi</span>
                        </>
                      ) : (
                        <>
                          <ThumbsUp className="w-3.5 h-3.5 shrink-0 text-[#2B3F29]" />
                          <span>
                            {confirmingKey === confirmKey ? 'Mengirim...' : 'Konfirmasi Terima'}
                          </span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenKwitansi(trx)}
                      className="min-h-[40px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D6E4D3] text-[#243825] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
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
