import {
  APP_PORTAL_URL,
  BULAN_LIST,
  DEFAULT_PAYMENT_CONFIG,
  NOMINAL_IPL_STANDAR,
  SUSUNAN_PENGURUS,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  type BotAccessRole,
  type PaymentConfig,
  type StatusEcardBulanan,
  type Warga,
} from '../types';
import {
  formatRupiah,
  getCurrentBillingMonth,
  getDefaultUnpaidStatusForMonth,
  getNamaBulan,
  isRealRegisteredPhone,
  isSameBlockCode,
  normalizeBlockCode,
  normalizePhoneNumber,
} from './format';

export type AutoReplyCommandType =
  | 'MENU'
  | 'VERIFIKASI'
  | 'CEK'
  | 'SALDO'
  | 'SETOR'
  | 'REKENING'
  | 'PENGURUS'
  | 'BANTUAN'
  | 'PRIVACY_DENIED'
  | 'UNREGISTERED'
  | 'FALLBACK';

export interface AutoReplyResult {
  command: AutoReplyCommandType;
  blok?: string;
  reply: string;
}

export interface AutoReplyContext {
  wargaList: Warga[];
  statusList: StatusEcardBulanan[];
  paymentConfig?: PaymentConfig;
  senderName?: string;
  senderPhone?: string;
  simulatedRole?: BotAccessRole | 'unregistered';
}

function findWargaByBlok(wargaList: Warga[], rawBlok: string): Warga | undefined {
  const clean = normalizeBlockCode(rawBlok);
  if (!clean) return undefined;
  return wargaList.find((w) => isSameBlockCode(w.blok_rumah, clean));
}

function findSenderUnit(wargaList: Warga[], senderPhone?: string): Warga | undefined {
  const cleanPhone = normalizePhoneNumber(senderPhone);
  if (!isRealRegisteredPhone(cleanPhone)) return undefined;
  return wargaList.find((w) => {
    if (!w.aktif) return false;
    const p1 = normalizePhoneNumber(w.no_wa);
    const p2 = normalizePhoneNumber(w.secondary_whatsapp);
    return (
      (isRealRegisteredPhone(p1) && p1 === cleanPhone) ||
      (isRealRegisteredPhone(p2) && p2 === cleanPhone)
    );
  });
}

function buildUnregisteredReply(): string {
  return [
    `*Akses Ditolak – Nomor Belum Terdaftar*`,
    ``,
    `Mohon maaf, nomor WhatsApp Anda belum terhubung dengan unit rumah mana pun di sistem *e-Card IPL Digital Perumahan Saung Kebun*.`,
    ``,
    `Silakan hubungi Pengurus Lingkungan (Ketua/Bendahara) untuk mendaftarkan nomor WhatsApp Anda agar dapat mengecek status iuran unit Anda secara mandiri.`,
  ].join('\n');
}

function buildPrivacyRejectedReply(ownBlockCode: string): string {
  return [
    `*Akses Ditolak (Privasi Terlindungi)*`,
    ``,
    `Demi menjaga kerahasiaan data warga Perumahan Saung Kebun, nomor WhatsApp Anda hanya terdaftar untuk unit *${ownBlockCode}* dan tidak diizinkan mengakses data unit lain.`,
    ``,
    `Ketik *CEK* untuk melihat status iuran unit Anda sendiri.`,
  ].join('\n');
}

function buildPersonalizedMenuReply(
  blockCode: string,
  residentName: string,
  isPrivileged: boolean
): string {
  const lines = [
    `*Layanan Bot e-Card IPL – Perumahan Saung Kebun*`,
    `Unit Terdaftar: *${blockCode}* (${residentName})`,
    ``,
    `Silakan ketik perintah berikut:`,
    `• *CEK* — Melihat status & rincian tagihan IPL unit Anda`,
    `• *SALDO* — Melihat rekap lunas & tunggakan 12 bulan unit Anda`,
    `• *REKENING* — Melihat informasi pembayaran QRIS & Transfer`,
    `• *MENU* — Menampilkan panduan ini`,
  ];
  if (isPrivileged) {
    lines.push(`• *CEK#[KODE_BLOK]* — (Akses Pengurus) Cek status unit warga tertentu`);
  }
  lines.push(``);
  lines.push(`Portal Warga: ${APP_PORTAL_URL}`);
  return lines.join('\n');
}

function buildPengurusReply(): string {
  const lines = SUSUNAN_PENGURUS.map((p) => `• *${p.jabatan}*: ${p.nama}`);
  return [
    `*Susunan Pengurus Lingkungan Perumahan Saung Kebun*`,
    `Sekretariat: Blok B03/07 · Desa Bengle, Kec. Majalaya, Karawang`,
    ``,
    ...lines,
    ``,
    `Titip setor tunai IPL dapat diserahkan melalui pengurus di atas.`,
    `Portal: ${APP_PORTAL_URL}`,
  ].join('\n');
}

function buildRekeningReply(paymentConfig?: PaymentConfig): string {
  const cfg = paymentConfig || DEFAULT_PAYMENT_CONFIG;
  const banks = cfg.rekening_list.filter((r) => r.tipe === 'Transfer Bank');
  const ewallets = cfg.rekening_list.filter((r) => r.tipe === 'E-Wallet');

  const lines: string[] = [
    `*Info Pembayaran Resmi IPL Perumahan Saung Kebun*`,
    `Iuran Wajib: ${formatRupiah(NOMINAL_IPL_STANDAR)} / bulan (Jatuh tempo tgl ${TANGGAL_JATUH_TEMPO})`,
    ``,
  ];

  if (cfg.qris_aktif && cfg.qris_image_url) {
    lines.push(`*Via QRIS Resmi:* ${cfg.qris_label}`);
    lines.push(`Buka ${APP_PORTAL_URL} → Menu Setor → Pilih *Via QR / QRIS* untuk scan kode QRIS.`);
    lines.push(``);
  }

  if (banks.length > 0) {
    lines.push(`*Transfer Bank:*`);
    banks.forEach((b) => {
      lines.push(`• *${b.bank}*: ${b.nomor} (a.n. ${b.atasNama})`);
    });
    lines.push(``);
  }

  if (ewallets.length > 0) {
    lines.push(`*E-Wallet:*`);
    ewallets.forEach((e) => {
      lines.push(`• *${e.bank}*: ${e.nomor} (a.n. ${e.atasNama})`);
    });
    lines.push(``);
  }

  lines.push(`*Titip Pengurus:* Dapat diserahkan tunai melalui Pengurus Lingkungan resmi.`);
  lines.push(`Setelah pembayaran, unggah bukti setor di ${APP_PORTAL_URL} agar status e-Card otomatis diverifikasi.`);
  return lines.join('\n');
}

function buildCekUnitReply(warga: Warga, statusList: StatusEcardBulanan[]): string {
  const currentMonth = getCurrentBillingMonth();
  const bulanNama = `${getNamaBulan(currentMonth)} ${TAHUN_AKTIF}`;
  const formattedBlock = normalizeBlockCode(warga.blok_rumah);
  const st = statusList.find(
    (s) =>
      isSameBlockCode(s.blok_rumah, warga.blok_rumah) &&
      s.tahun === TAHUN_AKTIF &&
      s.bulan === currentMonth
  );
  const statusBulanIni = st?.status || getDefaultUnpaidStatusForMonth(currentMonth);

  return [
    `*Status e-Card IPL — Unit ${formattedBlock}*`,
    `Nama: ${warga.nama_warga}`,
    `Periode: *${bulanNama}*`,
    `Status: *${statusBulanIni.toUpperCase()}*`,
    `Iuran Wajib: ${formatRupiah(warga.nominal_iuran || NOMINAL_IPL_STANDAR)} / bulan`,
    `Jatuh Tempo: Tanggal ${TANGGAL_JATUH_TEMPO}`,
    ``,
    statusBulanIni === 'Lunas'
      ? `Terima kasih, IPL bulan ${bulanNama} sudah *LUNAS*. Unduh kwitansi di ${APP_PORTAL_URL}`
      : `Silakan setor via QRIS / Transfer / Titip Pengurus di ${APP_PORTAL_URL} atau ketik *REKENING* untuk info pembayaran.`,
  ].join('\n');
}

function buildSaldoUnitReply(
  warga: Warga,
  statusList: StatusEcardBulanan[],
  tahun: number
): string {
  const formattedBlock = normalizeBlockCode(warga.blok_rumah);
  const currentMonth = getCurrentBillingMonth();
  let lunasCount = 0;
  let pendingCount = 0;
  const belumBayarBulan: string[] = [];

  for (const b of BULAN_LIST) {
    const st = statusList.find(
      (s) =>
        isSameBlockCode(s.blok_rumah, warga.blok_rumah) &&
        s.tahun === tahun &&
        s.bulan === b.angka
    );
    const resolved = st?.status || getDefaultUnpaidStatusForMonth(b.angka);
    if (resolved === 'Lunas') {
      lunasCount += 1;
    } else if (resolved === 'Menunggu Verifikasi') {
      pendingCount += 1;
    } else if (b.angka <= currentMonth) {
      belumBayarBulan.push(b.singkat);
    }
  }

  const totalTunggakan = belumBayarBulan.length * (warga.nominal_iuran || NOMINAL_IPL_STANDAR);

  return [
    `*Rekap Saldo IPL ${tahun} — Unit ${formattedBlock}*`,
    `Nama: ${warga.nama_warga}`,
    `• Lunas: *${lunasCount} bulan*`,
    `• Menunggu Verifikasi: *${pendingCount} bulan*`,
    `• Belum Bayar (s.d. ${getNamaBulan(currentMonth)}): *${belumBayarBulan.length} bulan*${
      belumBayarBulan.length > 0 ? ` (${belumBayarBulan.join(', ')})` : ''
    }`,
    `• Estimasi Kewajiban: *${formatRupiah(totalTunggakan)}*`,
    ``,
    `Cek detail matriks 12 bulan & unduh kwitansi di:`,
    `${APP_PORTAL_URL}`,
  ].join('\n');
}

export function generateBotAutoReply(
  incomingMessage: string,
  context: AutoReplyContext
): AutoReplyResult {
  const raw = incomingMessage.trim();

  if (context.simulatedRole === 'unregistered') {
    return {
      command: 'UNREGISTERED',
      blok: 'UNREGISTERED',
      reply: buildUnregisteredReply(),
    };
  }

  let senderUnit: Warga | undefined;
  if (context.senderPhone) {
    senderUnit = findSenderUnit(context.wargaList, context.senderPhone);
    if (!senderUnit && !context.simulatedRole) {
      return {
        command: 'UNREGISTERED',
        blok: 'UNREGISTERED',
        reply: buildUnregisteredReply(),
      };
    }
  }

  // Fallback untuk mode simulator bila nomor pengirim tidak dimasukkan manual
  if (!senderUnit) {
    senderUnit =
      context.wargaList.find((w) => w.aktif && w.status_hunian !== 'Kosong') ||
      context.wargaList[0];
  }

  const effectiveRole: BotAccessRole =
    context.simulatedRole || senderUnit?.bot_role || 'warga';
  const isPrivileged = effectiveRole === 'admin' || effectiveRole === 'bendahara';
  const ownBlockCode = senderUnit ? normalizeBlockCode(senderUnit.blok_rumah) : 'PENGURUS';
  const ownName = senderUnit?.nama_warga || context.senderName || 'Warga Saung Kebun';

  if (!raw) {
    return {
      command: 'MENU',
      blok: ownBlockCode,
      reply: buildPersonalizedMenuReply(ownBlockCode, ownName, isPrivileged),
    };
  }

  const upper = raw.toUpperCase();
  const hashParts = raw.split('#').map((s) => s.trim());
  let head = (hashParts[0] || '').toUpperCase();
  let targetBlockRaw = (hashParts[1] || '').trim();

  if (hashParts.length === 1) {
    const spaceMatch = raw.match(/^(CEK|SALDO)\s+(.+)$/i);
    if (spaceMatch) {
      head = spaceMatch[1].toUpperCase();
      targetBlockRaw = spaceMatch[2].trim();
    }
  }

  // 1. MENU / BANTUAN / INFO / SALAM
  if (
    ['MENU', 'BANTUAN', 'INFO', 'HELP', 'BOT', 'HALO', 'HELLO', 'HAI', 'ASSALAMUALAIKUM', 'P', 'START'].includes(
      upper
    ) ||
    head === 'MENU' ||
    head === 'HELP' ||
    head === 'INFO'
  ) {
    return {
      command: 'MENU',
      blok: ownBlockCode,
      reply: buildPersonalizedMenuReply(ownBlockCode, ownName, isPrivileged),
    };
  }

  // 2. INFO PENGURUS
  if (head === 'PENGURUS' || upper.includes('SUSUNAN PENGURUS')) {
    return { command: 'PENGURUS', blok: ownBlockCode, reply: buildPengurusReply() };
  }

  // 3. INFO REKENING / BAYAR / QRIS
  if (['REKENING', 'BAYAR', 'NOREK', 'QRIS', 'QR'].includes(head)) {
    return {
      command: 'REKENING',
      blok: ownBlockCode,
      reply: buildRekeningReply(context.paymentConfig),
    };
  }

  // 4. CEK atau CEK#<BLOK> / CEK <BLOK>
  if (head === 'CEK') {
    const requestedBlock = normalizeBlockCode(targetBlockRaw);

    if (!isPrivileged && requestedBlock) {
      if (!senderUnit || !isSameBlockCode(requestedBlock, senderUnit.blok_rumah)) {
        return {
          command: 'PRIVACY_DENIED',
          blok: ownBlockCode,
          reply: buildPrivacyRejectedReply(ownBlockCode),
        };
      }
    }

    if (!requestedBlock || (senderUnit && isSameBlockCode(requestedBlock, senderUnit.blok_rumah))) {
      if (!senderUnit) {
        return {
          command: 'CEK',
          blok: ownBlockCode,
          reply: `Ketik *CEK#[KODE_BLOK]* untuk memeriksa status unit warga.`,
        };
      }
      return {
        command: 'CEK',
        blok: ownBlockCode,
        reply: buildCekUnitReply(senderUnit, context.statusList),
      };
    }

    const targetUnit = findWargaByBlok(context.wargaList, requestedBlock);
    if (!targetUnit) {
      return {
        command: 'CEK',
        blok: requestedBlock,
        reply: `Unit *${requestedBlock}* belum terdaftar di database Perumahan Saung Kebun. Mohon periksa kembali penulisan kode blok yang diminta.`,
      };
    }

    return {
      command: 'CEK',
      blok: normalizeBlockCode(targetUnit.blok_rumah),
      reply: buildCekUnitReply(targetUnit, context.statusList),
    };
  }

  // 5. SALDO atau SALDO#<BLOK>#<TAHUN>
  if (head === 'SALDO') {
    const requestedBlock = normalizeBlockCode(targetBlockRaw);
    const tahun = Number(hashParts[2]) || TAHUN_AKTIF;

    if (!isPrivileged && requestedBlock) {
      if (!senderUnit || !isSameBlockCode(requestedBlock, senderUnit.blok_rumah)) {
        return {
          command: 'PRIVACY_DENIED',
          blok: ownBlockCode,
          reply: buildPrivacyRejectedReply(ownBlockCode),
        };
      }
    }

    if (!requestedBlock || (senderUnit && isSameBlockCode(requestedBlock, senderUnit.blok_rumah))) {
      if (!senderUnit) {
        return {
          command: 'SALDO',
          blok: ownBlockCode,
          reply: `Ketik *SALDO#[KODE_BLOK]#${TAHUN_AKTIF}* untuk melihat rekap iuran warga.`,
        };
      }
      return {
        command: 'SALDO',
        blok: ownBlockCode,
        reply: buildSaldoUnitReply(senderUnit, context.statusList, tahun),
      };
    }

    const targetUnit = findWargaByBlok(context.wargaList, requestedBlock);
    if (!targetUnit) {
      return {
        command: 'SALDO',
        blok: requestedBlock,
        reply: `Unit *${requestedBlock}* belum terdaftar di database Perumahan Saung Kebun.`,
      };
    }

    return {
      command: 'SALDO',
      blok: normalizeBlockCode(targetUnit.blok_rumah),
      reply: buildSaldoUnitReply(targetUnit, context.statusList, tahun),
    };
  }

  // 6. SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]#[PENGURUS]
  if (head === 'SETOR') {
    const requestedBlock = normalizeBlockCode(hashParts[1] || '');
    const periode = (hashParts[2] || '').toUpperCase();
    const nominalRaw = Number((hashParts[3] || '').replace(/\D/g, '')) || 0;
    const metode = (hashParts[4] || '').toUpperCase();
    const pengurus = hashParts[5] || '';

    if (!isPrivileged && requestedBlock && senderUnit && !isSameBlockCode(requestedBlock, senderUnit.blok_rumah)) {
      return {
        command: 'PRIVACY_DENIED',
        blok: ownBlockCode,
        reply: buildPrivacyRejectedReply(ownBlockCode),
      };
    }

    if (!periode || nominalRaw <= 0 || !metode) {
      return {
        command: 'SETOR',
        blok: ownBlockCode,
        reply: [
          `Format konfirmasi setor belum lengkap.`,
          `Gunakan format: *SETOR#${ownBlockCode}#NOV${TAHUN_AKTIF}#100000#QRIS*`,
          `Atau unggah bukti transfer langsung di ${APP_PORTAL_URL}`,
        ].join('\n'),
      };
    }

    const targetUnit =
      (isPrivileged && requestedBlock ? findWargaByBlok(context.wargaList, requestedBlock) : senderUnit) ||
      senderUnit;
    const blokLabel = targetUnit ? normalizeBlockCode(targetUnit.blok_rumah) : requestedBlock || ownBlockCode;

    return {
      command: 'SETOR',
      blok: blokLabel,
      reply: [
        `*Laporan Setor IPL Diterima*`,
        `Unit: *${blokLabel}*${targetUnit ? ` (${targetUnit.nama_warga})` : ''}`,
        `Periode: *${periode}*`,
        `Nominal: *${formatRupiah(nominalRaw)}*`,
        `Metode: *${metode}*${pengurus ? ` via ${pengurus}` : ''}`,
        ``,
        `Untuk verifikasi otomatis & kwitansi digital, pastikan Anda juga mengunggah foto bukti bayar di:`,
        `${APP_PORTAL_URL}`,
      ].join('\n'),
    };
  }

  // 7. BANTUAN#PIN#[BLOK]#[NAMA]
  if (head === 'BANTUAN') {
    const topik = (hashParts[1] || 'UMUM').toUpperCase();
    const requestedBlock = normalizeBlockCode(hashParts[2] || '');

    if (!isPrivileged && requestedBlock && senderUnit && !isSameBlockCode(requestedBlock, senderUnit.blok_rumah)) {
      return {
        command: 'PRIVACY_DENIED',
        blok: ownBlockCode,
        reply: buildPrivacyRejectedReply(ownBlockCode),
      };
    }

    return {
      command: 'BANTUAN',
      blok: ownBlockCode,
      reply: [
        `*Permintaan Bantuan Tercatat*`,
        `Topik: *${topik}* · Unit: *${ownBlockCode}* (${ownName})`,
        ``,
        `Pesan Anda telah diteruskan ke *Bendahara & Pengurus Lingkungan Saung Kebun*. Mohon tunggu balasan konfirmasi.`,
      ].join('\n'),
    };
  }

  // Fallback ramah — tampilkan panduan unit sendiri
  return {
    command: 'MENU',
    blok: ownBlockCode,
    reply: buildPersonalizedMenuReply(ownBlockCode, ownName, isPrivileged),
  };
}
