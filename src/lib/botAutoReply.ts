import {
  APP_PORTAL_URL,
  BULAN_LIST,
  DEFAULT_PAYMENT_CONFIG,
  NOMINAL_IPL_STANDAR,
  SUSUNAN_PENGURUS,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  type PaymentConfig,
  type StatusEcardBulanan,
  type Warga,
} from '../types';
import {
  formatRupiah,
  getCurrentBillingMonth,
  getDefaultUnpaidStatusForMonth,
  getNamaBulan,
  normalizeBlok,
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
}

function findWargaByBlok(wargaList: Warga[], rawBlok: string): Warga | undefined {
  const clean = normalizeBlok(rawBlok);
  if (!clean) return undefined;
  return wargaList.find((w) => normalizeBlok(w.blok_rumah) === clean);
}

function buildMenuReply(): string {
  return [
    `*Bot Layanan Otomatis IPL — Perumahan Saung Kebun*`,
    ``,
    `Ketik salah satu format pesan berikut:`,
    `1. *CEK#[BLOK]* — Cek tagihan bulan ini (contoh: CEK#B5/21)`,
    `2. *SALDO#[BLOK]#${TAHUN_AKTIF}* — Cek rekap lunas & tunggakan setahun`,
    `3. *VERIFIKASI#[BLOK]#[PIN]* — Verifikasi nomor WA & unit rumah`,
    `4. *SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]* — Konfirmasi setor IPL`,
    `5. *REKENING* atau *QRIS* — Info nomor rekening kas & QRIS resmi`,
    `6. *PENGURUS* — Daftar susunan pengurus Saung Kebun`,
    `7. *BANTUAN#PIN#[BLOK]#[NAMA]* — Minta bantuan reset PIN / ubah WA`,
    ``,
    `Portal resmi e-Card Digital:`,
    `${APP_PORTAL_URL}`,
  ].join('\n');
}

function buildPengurusReply(): string {
  const lines = SUSUNAN_PENGURUS.map(
    (p) => `• *${p.jabatan}*: ${p.nama} (Blok ${p.blokRumah})`
  );
  return [
    `*Susunan Pengurus Lingkungan Perumahan Saung Kebun*`,
    `Sekretariat: Blok B3/7 · Desa Bengle, Kec. Majalaya, Karawang`,
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
    lines.push(`*1. Via QR / QRIS Resmi:*`);
    lines.push(`${cfg.qris_label}`);
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

  lines.push(`Setelah transfer, unggah bukti bayar di ${APP_PORTAL_URL} atau kirim format *SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]*.`);
  return lines.join('\n');
}

export function generateBotAutoReply(
  incomingMessage: string,
  context: AutoReplyContext
): AutoReplyResult {
  const raw = incomingMessage.trim();
  if (!raw) {
    return { command: 'MENU', reply: buildMenuReply() };
  }

  const upper = raw.toUpperCase();
  const parts = raw.split('#').map((s) => s.trim());
  const head = (parts[0] || '').toUpperCase();

  // 1. MENU / SALAM / HELP
  if (
    ['MENU', 'HELP', 'INFO', 'BOT', 'HALO', 'HELLO', 'HAI', 'ASSALAMUALAIKUM', 'P', 'START'].includes(
      upper
    ) ||
    head === 'MENU' ||
    head === 'HELP'
  ) {
    return { command: 'MENU', reply: buildMenuReply() };
  }

  // 2. INFO PENGURUS
  if (head === 'PENGURUS' || upper.includes('SUSUNAN PENGURUS')) {
    return { command: 'PENGURUS', reply: buildPengurusReply() };
  }

  // 3. INFO REKENING / QRIS
  if (
    head === 'REKENING' ||
    head === 'NOREK' ||
    head === 'QRIS' ||
    head === 'QR' ||
    head === 'BAYAR'
  ) {
    return { command: 'REKENING', reply: buildRekeningReply(context.paymentConfig) };
  }

  // 4. VERIFIKASI#[BLOK]#[PIN]
  if (head === 'VERIFIKASI') {
    const rawBlok = parts[1] || '';
    const rawPin = (parts[2] || '').replace(/\D/g, '');
    if (!rawBlok || rawPin.length < 4) {
      return {
        command: 'VERIFIKASI',
        reply: [
          `Format verifikasi kurang lengkap.`,
          `Gunakan format: *VERIFIKASI#[BLOK]#[PIN_6_DIGIT]*`,
          `Contoh: *VERIFIKASI#B5/21#123456*`,
        ].join('\n'),
      };
    }

    const warga = findWargaByBlok(context.wargaList, rawBlok);
    if (!warga) {
      return {
        command: 'VERIFIKASI',
        blok: normalizeBlok(rawBlok),
        reply: `Blok *${normalizeBlok(rawBlok)}* tidak ditemukan di data Perumahan Saung Kebun. Pastikan format blok benar (contoh: B3/7, B5/21, B7/16).`,
      };
    }

    if (warga.pin_akses !== rawPin) {
      return {
        command: 'VERIFIKASI',
        blok: warga.blok_rumah,
        reply: [
          `PIN untuk Blok *${warga.blok_rumah}* tidak cocok.`,
          `Jika lupa PIN, ketik: *BANTUAN#PIN#${warga.blok_rumah}#${warga.nama_warga}*`,
        ].join('\n'),
      };
    }

    return {
      command: 'VERIFIKASI',
      blok: warga.blok_rumah,
      reply: [
        `*Verifikasi Akun Berhasil*`,
        `Unit: *Blok ${warga.blok_rumah}* (${warga.nama_warga})`,
        `Status Hunian: ${warga.status_hunian}`,
        `Iuran Wajib: ${formatRupiah(warga.nominal_iuran)} / bulan`,
        ``,
        `Ketik *CEK#${warga.blok_rumah}* untuk cek tagihan bulan ini, atau buka portal:`,
        `${APP_PORTAL_URL}`,
      ].join('\n'),
    };
  }

  // 5. CEK#[BLOK]
  if (head === 'CEK') {
    const rawBlok = parts[1] || raw.replace(/^CEK\s+/i, '');
    if (!rawBlok || rawBlok.toUpperCase() === 'CEK') {
      return {
        command: 'CEK',
        reply: `Sebutkan blok rumah Anda.\nContoh: *CEK#B5/21*`,
      };
    }

    const warga = findWargaByBlok(context.wargaList, rawBlok);
    if (!warga) {
      return {
        command: 'CEK',
        blok: normalizeBlok(rawBlok),
        reply: `Unit *${normalizeBlok(rawBlok)}* belum terdaftar. Cek kembali nomor blok Anda (contoh: B3/7, B5/21, B7/16).`,
      };
    }

    const currentMonth = getCurrentBillingMonth();
    const bulanNama = `${getNamaBulan(currentMonth)} ${TAHUN_AKTIF}`;
    const st = context.statusList.find(
      (s) =>
        normalizeBlok(s.blok_rumah) === normalizeBlok(warga.blok_rumah) &&
        s.tahun === TAHUN_AKTIF &&
        s.bulan === currentMonth
    );
    const statusBulanIni = st?.status || getDefaultUnpaidStatusForMonth(currentMonth);

    return {
      command: 'CEK',
      blok: warga.blok_rumah,
      reply: [
        `*Status e-Card IPL — Blok ${warga.blok_rumah}*`,
        `Nama: ${warga.nama_warga}`,
        `Periode: *${bulanNama}*`,
        `Status: *${statusBulanIni.toUpperCase()}*`,
        `Iuran Wajib: ${formatRupiah(warga.nominal_iuran)} / bulan`,
        `Jatuh Tempo: Tanggal ${TANGGAL_JATUH_TEMPO}`,
        ``,
        statusBulanIni === 'Lunas'
          ? `Terima kasih, IPL bulan ${bulanNama} sudah *LUNAS*. Unduh kwitansi di ${APP_PORTAL_URL}`
          : `Silakan setor via QRIS/Transfer/Titip Pengurus di ${APP_PORTAL_URL} atau ketik *REKENING* untuk info pembayaran.`,
      ].join('\n'),
    };
  }

  // 6. SALDO#[BLOK]#[TAHUN]
  if (head === 'SALDO') {
    const rawBlok = parts[1] || raw.replace(/^SALDO\s+/i, '');
    const tahun = Number(parts[2]) || TAHUN_AKTIF;
    if (!rawBlok || rawBlok.toUpperCase() === 'SALDO') {
      return {
        command: 'SALDO',
        reply: `Gunakan format: *SALDO#[BLOK]#${TAHUN_AKTIF}*\nContoh: *SALDO#B5/21#${TAHUN_AKTIF}*`,
      };
    }

    const warga = findWargaByBlok(context.wargaList, rawBlok);
    if (!warga) {
      return {
        command: 'SALDO',
        blok: normalizeBlok(rawBlok),
        reply: `Unit *${normalizeBlok(rawBlok)}* tidak ditemukan di data warga Perumahan Saung Kebun.`,
      };
    }

    const currentMonth = getCurrentBillingMonth();
    let lunasCount = 0;
    let pendingCount = 0;
    const belumBayarBulan: string[] = [];

    for (const b of BULAN_LIST) {
      const st = context.statusList.find(
        (s) =>
          normalizeBlok(s.blok_rumah) === normalizeBlok(warga.blok_rumah) &&
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

    return {
      command: 'SALDO',
      blok: warga.blok_rumah,
      reply: [
        `*Rekap Saldo IPL ${tahun} — Blok ${warga.blok_rumah}*`,
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
      ].join('\n'),
    };
  }

  // 7. SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]#[PENGURUS]
  if (head === 'SETOR') {
    const rawBlok = parts[1] || '';
    const periode = (parts[2] || '').toUpperCase();
    const nominalRaw = Number((parts[3] || '').replace(/\D/g, '')) || 0;
    const metode = (parts[4] || '').toUpperCase();
    const pengurus = parts[5] || '';

    if (!rawBlok || !periode || nominalRaw <= 0 || !metode) {
      return {
        command: 'SETOR',
        reply: [
          `Format konfirmasi setor belum lengkap.`,
          `Gunakan format: *SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]*`,
          `Contoh QRIS: *SETOR#B5/21#NOV${TAHUN_AKTIF}#100000#QRIS*`,
          `Contoh Tunai: *SETOR#B5/21#NOV${TAHUN_AKTIF}#100000#TUNAI#ANDRIANSYAH*`,
        ].join('\n'),
      };
    }

    const warga = findWargaByBlok(context.wargaList, rawBlok);
    const blokLabel = warga?.blok_rumah || normalizeBlok(rawBlok);

    return {
      command: 'SETOR',
      blok: blokLabel,
      reply: [
        `*Laporan Setor IPL Diterima*`,
        `Unit: *Blok ${blokLabel}*${warga ? ` (${warga.nama_warga})` : ''}`,
        `Periode: *${periode}*`,
        `Nominal: *${formatRupiah(nominalRaw)}*`,
        `Metode: *${metode}*${pengurus ? ` via ${pengurus}` : ''}`,
        ``,
        `Untuk verifikasi otomatis & kwitansi digital, pastikan Anda juga mengunggah foto bukti bayar di:`,
        `${APP_PORTAL_URL}`,
        `Bendahara (Andriansyah) akan segera memverifikasi setoran Anda.`,
      ].join('\n'),
    };
  }

  // 8. BANTUAN#PIN#[BLOK]#[NAMA]
  if (head === 'BANTUAN') {
    const topik = (parts[1] || 'UMUM').toUpperCase();
    const rawBlok = normalizeBlok(parts[2] || '');
    const nama = parts[3] || context.senderName || 'Warga';

    return {
      command: 'BANTUAN',
      blok: rawBlok || undefined,
      reply: [
        `*Permintaan Bantuan Tercatat*`,
        `Topik: *${topik}*`,
        rawBlok ? `Unit: *Blok ${rawBlok}* (${nama})` : `Pengirim: ${nama}`,
        ``,
        `Pesan Anda telah diteruskan ke *Bendahara (Andriansyah — Blok B7/16)* dan Pengurus Lingkungan Saung Kebun. Mohon tunggu balasan konfirmasi.`,
      ].join('\n'),
    };
  }

  // Fallback ramah
  return {
    command: 'FALLBACK',
    reply: [
      `Maaf, format pesan *"${raw.slice(0, 60)}"* belum dikenali oleh Bot IPL Saung Kebun.`,
      ``,
      `Ketik *MENU* untuk melihat daftar perintah otomatis (Cek Tagihan, Cek Saldo, Rekening/QRIS, Pengurus, atau Konfirmasi Setor).`,
      `Portal e-Card: ${APP_PORTAL_URL}`,
    ].join('\n'),
  };
}
