import {
  isBendaharaOnly,
  isKetuaRole,
  type SessionUser,
  type StatusVerifikasi,
  type TransaksiIPL,
  type TransaksiKas,
  type Warga,
} from '../types';
import { canonicalizeBlokKey } from './format';

export type StrictVerificationStatus = StatusVerifikasi | 'unknown';

/**
 * Normalisasi status verifikasi secara ketat tanpa fallback liar ke 'Pending'.
 * Mendukung label bahasa Indonesia maupun alias bahasa Inggris/snake_case.
 */
export function normalizeVerificationStatusStrict(raw: unknown): StrictVerificationStatus {
  const val = String(raw || '')
    .trim()
    .toLowerCase();

  if (!val) return 'unknown';

  if (
    val === 'pending' ||
    val === 'menunggu_bendahara' ||
    val === 'menunggu bendahara' ||
    val === 'waiting_bendahara'
  ) {
    return 'Pending';
  }

  if (
    val === 'acc bendahara' ||
    val === 'acc_bendahara' ||
    val === 'bendahara_acc' ||
    val === 'menunggu_ketua' ||
    val === 'menunggu ketua' ||
    val === 'waiting_ketua'
  ) {
    return 'ACC Bendahara';
  }

  if (
    val === 'terverifikasi' ||
    val === 'verified' ||
    val === 'approved' ||
    val === 'lunas' ||
    val === 'sah'
  ) {
    return 'Terverifikasi';
  }

  if (val === 'ditolak' || val === 'rejected') {
    return 'Ditolak';
  }

  return 'unknown';
}

export function isPendingBendaharaStatus(raw: unknown): boolean {
  return normalizeVerificationStatusStrict(raw) === 'Pending';
}

export function isWaitingKetuaStatus(raw: unknown): boolean {
  return normalizeVerificationStatusStrict(raw) === 'ACC Bendahara';
}

export function isVerifiedFinalStatus(raw: unknown): boolean {
  return normalizeVerificationStatusStrict(raw) === 'Terverifikasi';
}

export function isRejectedStatus(raw: unknown): boolean {
  return normalizeVerificationStatusStrict(raw) === 'Ditolak';
}

/**
 * Memastikan transaksi IPL valid & bukan data yatim (unit/warga sudah dihapus)
 * atau data dummy yang rusak.
 */
function isValidLiveIplTransaction(
  trx: TransaksiIPL,
  validBlokKeys: Set<string> | null
): boolean {
  if (!trx || !String(trx.id || '').trim()) return false;
  const blokKey = canonicalizeBlokKey(trx.blok_rumah);
  if (!blokKey) return false;
  if (!(Number(trx.nominal) > 0)) return false;

  // Jika master warga tersedia, kecualikan transaksi yatim dari unit yang sudah dihapus
  if (validBlokKeys && validBlokKeys.size > 0 && !validBlokKeys.has(blokKey)) {
    return false;
  }

  return true;
}

/**
 * Memastikan transaksi kas valid & memiliki ID serta nominal positif.
 */
function isValidLiveKasTransaction(kas: TransaksiKas): boolean {
  if (!kas || !String(kas.id || '').trim()) return false;
  if (!(Number(kas.nominal) > 0)) return false;
  return true;
}

export interface VerificationQueueSnapshot {
  /** Seluruh transaksi IPL yang masih memiliki unit/warga valid */
  validTransaksiList: TransaksiIPL[];
  /** Setoran IPL yang menunggu verifikasi tahap 1 (Bendahara) */
  pendingIplList: TransaksiIPL[];
  /** Setoran IPL yang sudah ACC Bendahara & menunggu pengesahan final Ketua */
  accBendaharaIplList: TransaksiIPL[];
  /** Setoran IPL yang sudah Terverifikasi / Sah Lunas */
  verifiedIplList: TransaksiIPL[];
  /** Setoran IPL yang Ditolak */
  rejectedIplList: TransaksiIPL[];
  /** Transaksi Kas yang menunggu ACC Bendahara (ditangani di tab Kas) */
  pendingKasList: TransaksiKas[];
  /** Transaksi Kas yang sudah ACC Bendahara & menunggu pengesahan final Ketua */
  accBendaharaKasList: TransaksiKas[];
  /** Total antrean verifikasi tahap 2 untuk Ketua (IPL + Kas) */
  totalKetuaQueueCount: number;
  /**
   * Jumlah item yang BENAR-BENAR menunggu tindakan user yang sedang login
   * di halaman "Dashboard & Verifikasi". Menjadi Single Source of Truth
   * untuk badge Bottom Navigation Bar & Sidebar menu "Verifikasi".
   */
  actionableBadgeCount: number;
}

/**
 * Single Source of Truth untuk daftar antrean verifikasi dan perhitungan badge
 * menu "Verifikasi" agar 100% sinkron antara halaman Dashboard & Verifikasi
 * dengan Bottom Navigation Bar / Sidebar untuk setiap peran pengurus.
 */
export function computeVerificationQueue(
  session: SessionUser | null | undefined,
  wargaList: Warga[] = [],
  transaksiList: TransaksiIPL[] = [],
  transaksiKasList: TransaksiKas[] = []
): VerificationQueueSnapshot {
  const validBlokKeys =
    wargaList.length > 0
      ? new Set(wargaList.map((w) => canonicalizeBlokKey(w.blok_rumah)).filter(Boolean))
      : null;

  const validTransaksiList = transaksiList.filter((t) =>
    isValidLiveIplTransaction(t, validBlokKeys)
  );
  const validKasList = transaksiKasList.filter(isValidLiveKasTransaction);

  const pendingIplList = validTransaksiList.filter((t) =>
    isPendingBendaharaStatus(t.status_verifikasi)
  );
  const accBendaharaIplList = validTransaksiList.filter((t) =>
    isWaitingKetuaStatus(t.status_verifikasi)
  );
  const verifiedIplList = validTransaksiList.filter((t) =>
    isVerifiedFinalStatus(t.status_verifikasi)
  );
  const rejectedIplList = validTransaksiList.filter((t) => isRejectedStatus(t.status_verifikasi));

  const pendingKasList = validKasList.filter(
    (k) => Boolean(k.status_verifikasi) && isPendingBendaharaStatus(k.status_verifikasi)
  );
  const accBendaharaKasList = validKasList.filter(
    (k) => Boolean(k.status_verifikasi) && isWaitingKetuaStatus(k.status_verifikasi)
  );

  const totalKetuaQueueCount = accBendaharaIplList.length + accBendaharaKasList.length;

  let actionableBadgeCount = 0;
  if (isKetuaRole(session)) {
    // Ketua hanya bertindak pada item ACC Bendahara (IPL + Kas) yang tampil di panel Antrean Ketua
    actionableBadgeCount = totalKetuaQueueCount;
  } else if (isBendaharaOnly(session)) {
    // Bendahara hanya bertindak pada setoran IPL berstatus Pending / menunggu_bendahara
    // yang tampil di halaman Dashboard & Verifikasi (tidak menghitung ACC Bendahara / menunggu_ketua)
    actionableBadgeCount = pendingIplList.length;
  } else {
    // Pengurus non-verifikator (Humas, Pembina, Seksi Olahraga) tidak memiliki tombol verifikasi
    actionableBadgeCount = 0;
  }

  return {
    validTransaksiList,
    pendingIplList,
    accBendaharaIplList,
    verifiedIplList,
    rejectedIplList,
    pendingKasList,
    accBendaharaKasList,
    totalKetuaQueueCount,
    actionableBadgeCount,
  };
}
