import { useEffect, useState } from 'react';
import {
  Bot,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  MessageCircle,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  APP_PORTAL_URL,
  NOMINAL_IPL_STANDAR,
  TAHUN_AKTIF,
  TANGGAL_JATUH_TEMPO,
  type Warga,
} from '../../types';
import {
  buildWhatsAppLink,
  copyToClipboard,
  formatBlokRumah,
  formatRupiah,
  getCurrentBillingMonth,
  getNamaBulan,
  getSingkatBulan,
} from '../../lib/format';
import { useAppBrand } from '../../lib/brandContext';

type GuideTabId = 'verifikasi' | 'saldo' | 'setor';

interface CommandFormatItem {
  id: string;
  judul: string;
  ringkasan: string;
  pola: string;
  contohSiapKirim: string;
  contohBalasan: string;
}

interface GuideTabSection {
  id: GuideTabId;
  label: string;
  shortLabel: string;
  icon: typeof ShieldCheck;
  pengantar: string;
  langkah: string[];
  formats: CommandFormatItem[];
  catatan: string;
}

interface PanduanBotWaModalProps {
  open: boolean;
  onClose: () => void;
  profil?: Pick<Warga, 'blok_rumah' | 'nama_warga' | 'nominal_iuran' | 'no_wa'>;
  onGoToSetor?: () => void;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function PanduanBotWaModal({
  open,
  onClose,
  profil,
  onGoToSetor,
  onToast,
}: PanduanBotWaModalProps) {
  const { brand } = useAppBrand();
  const [activeTab, setActiveTab] = useState<GuideTabId>('verifikasi');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const botWaNumber = brand.wa_bot?.trim() || '';

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const blok = profil?.blok_rumah ? formatBlokRumah(profil.blok_rumah) : 'UNIT ANDA';
  const nama = profil?.nama_warga || 'Warga Saung Kebun';
  const nominal = profil?.nominal_iuran || NOMINAL_IPL_STANDAR;
  const currentMonth = getCurrentBillingMonth();
  const bulanSingkat = getSingkatBulan(currentMonth).toUpperCase();
  const bulanNama = getNamaBulan(currentMonth);
  const kodeBulan = `${bulanSingkat}${TAHUN_AKTIF}`;

  const sections: GuideTabSection[] = [
    {
      id: 'verifikasi',
      label: 'Privasi & Akses',
      shortLabel: 'Privasi',
      icon: ShieldCheck,
      pengantar:
        'Bot WhatsApp Perumahan Saung Kebun menerapkan isolasi privasi ketat: setiap nomor WA hanya dapat melihat data iuran unit rumahnya sendiri.',
      langkah: [
        'Pastikan Anda mengirim pesan dari nomor WhatsApp yang telah didaftarkan Pengurus untuk unit Anda.',
        'Cukup ketik CEK atau MENU tanpa perlu memasukkan kode blok rumah tetangga.',
        'Permintaan untuk melihat data blok rumah lain akan ditolak otomatis demi menjaga kerahasiaan data warga.',
      ],
      formats: [
        {
          id: 'fmt-menu',
          judul: 'Tampilkan Menu Layanan Unit Anda',
          ringkasan: 'Memastikan nomor WhatsApp Anda terdaftar dan melihat daftar perintah singkat.',
          pola: 'MENU',
          contohSiapKirim: 'MENU',
          contohBalasan: `*Layanan Bot e-Card IPL – Perumahan Saung Kebun*\nUnit Terdaftar: *${blok}* (${nama})\n\n• *CEK* — Status tagihan IPL unit Anda\n• *SALDO* — Rekap 12 bulan unit Anda\n• *REKENING* — Info QRIS & Transfer Bank`,
        },
        {
          id: 'fmt-verifikasi',
          judul: 'Verifikasi Nomor WA & Unit Terdaftar',
          ringkasan: 'Memeriksa kecocokan nomor WhatsApp Anda dengan data unit di database.',
          pola: 'VERIFIKASI',
          contohSiapKirim: 'VERIFIKASI',
          contohBalasan: `*Nomor WhatsApp Terverifikasi*\nUnit Terdaftar: *${blok}* (${nama})\nIuran Wajib: ${formatRupiah(nominal)} / bulan\nPortal: ${APP_PORTAL_URL}`,
        },
      ],
      catatan:
        'Apabila nomor WhatsApp Anda baru berganti atau belum terhubung dengan unit Anda, silakan hubungi Pengurus Lingkungan (Ketua/Bendahara) melalui tombol Hubungi Pengurus.',
    },
    {
      id: 'saldo',
      label: 'Cek Tagihan & Saldo',
      shortLabel: 'Cek Saldo',
      icon: Wallet,
      pengantar:
        'Pantau status pembayaran IPL bulan berjalan serta rekap lunas & tunggakan 12 bulan khusus untuk unit rumah Anda langsung lewat WhatsApp.',
      langkah: [
        'Ketik CEK untuk melihat status tagihan bulan berjalan unit Anda secara instan.',
        'Ketik SALDO untuk mendapatkan ringkasan bulan Lunas, Menunggu Verifikasi, dan sisa kewajiban tahun berjalan.',
        'Semua data tersinkronisasi langsung dengan e-Card Digital Anda di portal.',
      ],
      formats: [
        {
          id: 'fmt-cek-status',
          judul: 'Cek Tagihan Bulan Berjalan',
          ringkasan: `Melihat status e-Card unit Anda untuk bulan ${bulanNama} ${TAHUN_AKTIF}.`,
          pola: 'CEK',
          contohSiapKirim: 'CEK',
          contohBalasan: `*Status e-Card IPL — Unit ${blok}*\nNama: ${nama}\nPeriode: *${bulanNama} ${TAHUN_AKTIF}*\nNominal Iuran: ${formatRupiah(nominal)} / bulan\nJatuh Tempo: Tanggal ${TANGGAL_JATUH_TEMPO}\nPortal: ${APP_PORTAL_URL}`,
        },
        {
          id: 'fmt-cek-saldo',
          judul: 'Cek Rekap Saldo & Tunggakan 12 Bulan',
          ringkasan: `Menampilkan ringkasan jumlah bulan lunas dan sisa tagihan unit Anda tahun ${TAHUN_AKTIF}.`,
          pola: 'SALDO',
          contohSiapKirim: 'SALDO',
          contohBalasan: `*Rekap Saldo IPL ${TAHUN_AKTIF} — Unit ${blok}*\nNama: ${nama}\n• Lunas & Menunggu Verifikasi tercatat otomatis\nDetail lengkap 12 bulan: ${APP_PORTAL_URL}`,
        },
      ],
      catatan: `Tagihan IPL diterbitkan setiap tanggal 1 dan jatuh tempo setiap tanggal ${TANGGAL_JATUH_TEMPO}. Nomor Anda terkunci eksklusif hanya untuk unit ${blok}.`,
    },
    {
      id: 'setor',
      label: 'Bayar & Setor IPL',
      shortLabel: 'Setor IPL',
      icon: CreditCard,
      pengantar:
        'Dapatkan info QRIS / rekening kas resmi atau laporkan konfirmasi pembayaran IPL unit Anda lewat WhatsApp.',
      langkah: [
        'Ketik REKENING atau BAYAR untuk melihat metode pembayaran resmi (QRIS, Transfer Bank, atau Titip Pengurus).',
        `Lakukan pembayaran IPL (${formatRupiah(nominal)}/bulan) lalu unggah bukti bayar di Portal Warga ${APP_PORTAL_URL}.`,
        'Setelah Bendahara memverifikasi, status e-Card otomatis berubah LUNAS dan kwitansi tersedia di portal.',
      ],
      formats: [
        {
          id: 'fmt-rekening',
          judul: 'Lihat Info Pembayaran Resmi (QRIS / Bank)',
          ringkasan: 'Menampilkan rekening resmi kas lingkungan & tautan upload bukti bayar.',
          pola: 'REKENING',
          contohSiapKirim: 'REKENING',
          contohBalasan: `*Info Pembayaran Resmi IPL Perumahan Saung Kebun*\nIuran Wajib: ${formatRupiah(nominal)} / bulan (Jatuh tempo tgl ${TANGGAL_JATUH_TEMPO})\nUnggah bukti setor di ${APP_PORTAL_URL}`,
        },
        {
          id: 'fmt-setor-digital',
          judul: 'Laporkan Konfirmasi Setor Unit Anda',
          ringkasan: 'Mencatat laporan setor ke antrean verifikasi Bendahara.',
          pola: 'SETOR#[BLOK_ANDA]#[BULAN]#[NOMINAL]#[METODE]',
          contohSiapKirim: `SETOR#${blok}#${kodeBulan}#${nominal}#QRIS`,
          contohBalasan: `*Laporan Setor IPL Tercatat di Antrean Verifikasi Admin*\nUnit: *${blok}* (${nama})\nNominal: *${formatRupiah(nominal)}* (QRIS)`,
        },
      ],
      catatan:
        'Untuk unggah foto bukti bayar secara langsung dan mendapatkan verifikasi lebih cepat, silakan gunakan menu Setor Iuran di portal.',
    },
  ];

  const activeSection = sections.find((s) => s.id === activeTab) || sections[0];

  const handleCopyFormat = async (item: CommandFormatItem) => {
    const ok = await copyToClipboard(item.contohSiapKirim);
    if (ok) {
      setCopiedId(item.id);
      onToast?.('success', `Format "${item.contohSiapKirim}" berhasil disalin.`);
      setTimeout(() => {
        setCopiedId((prev) => (prev === item.id ? null : prev));
      }, 2200);
    } else {
      onToast?.('error', 'Gagal menyalin format pesan.');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="panduan-bot-wa-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#1B271B]/55 backdrop-blur-md"
            aria-hidden="true"
          />

          {/* Modal Sheet / Dialog */}
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-2xl max-h-[90vh] bg-[#FFFDF8] backdrop-blur-xl rounded-t-3xl sm:rounded-3xl border border-[#E6E2D6] shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Drag Indicator untuk Mobile */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-[#C6D2BF]" aria-hidden="true" />
            </div>

            {/* Header Modal */}
            <div className="px-5 sm:px-6 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC] flex items-start justify-between gap-4 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-5 h-5 text-[#243825]" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="panduan-bot-wa-title"
                    className="text-base sm:text-lg font-bold font-serif-brand text-[#1B271B] tracking-tight"
                  >
                    Panduan Bot WhatsApp IPL
                  </h2>
                  <p className="text-xs text-[#6E786D] mt-0.5">
                    Perumahan Saung Kebun · Unit{' '}
                    <span className="font-mono font-semibold text-[#1B271B]">{blok}</span> · Format
                    Pesan Otomatis
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup Panduan Bot WA"
                className="min-h-[40px] min-w-[40px] rounded-full text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/70 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab Navigasi Interaktif (3 Alur Utama) */}
            <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-[#E6E2D6] bg-[#F6F3EA]/70 shrink-0">
              <div
                role="tablist"
                aria-label="Kategori Panduan Bot WhatsApp"
                className="grid grid-cols-3 gap-1 p-1 bg-[#F7F4EC] border border-[#E6E2D6] rounded-2xl"
              >
                {sections.map((sec) => {
                  const Icon = sec.icon;
                  const active = sec.id === activeTab;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(sec.id)}
                      className={`min-h-[42px] px-2.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-[#2B3F29] text-[#FFFDF8] shadow-xs'
                          : 'text-[#4A554A] hover:text-[#243825] hover:bg-[#E5EEE3]/50'
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? 'text-[#E5EEE3]' : 'text-[#6E786D]'
                        }`}
                      />
                      <span className="sm:hidden truncate">{sec.shortLabel}</span>
                      <span className="hidden sm:inline truncate">{sec.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Konten Scrollable */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
              {/* Pengantar & Langkah Urut */}
              <div className="space-y-3">
                <p className="text-sm text-[#4A554A] leading-relaxed">{activeSection.pengantar}</p>

                <div className="rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] p-4">
                  <h3 className="text-xs font-bold text-[#1B271B] mb-2.5">
                    Langkah-langkah {activeSection.label}
                  </h3>
                  <ol className="space-y-2.5 text-sm text-[#4A554A]">
                    {activeSection.langkah.map((step, idx) => (
                      <li key={step} className="flex items-start gap-3 leading-relaxed">
                        <span className="w-5 h-5 rounded-lg bg-[#2B3F29] text-[#FFFDF8] font-mono text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
                          {idx + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* Daftar Format Pesan Otomatis Siap Pakai */}
              <div className="space-y-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-bold text-[#4A554A]">
                    Format Pesan Otomatis untuk Blok {blok}
                  </h3>
                  <span className="text-xs text-[#6E786D] tabular-nums">
                    {activeSection.formats.length} format tersedia
                  </span>
                </div>

                {activeSection.formats.map((item) => {
                  const isCopied = copiedId === item.id;
                  const waHref = botWaNumber
                    ? buildWhatsAppLink(botWaNumber, item.contohSiapKirim)
                    : '';
                  return (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8] overflow-hidden"
                    >
                      <div className="p-4 space-y-3">
                        <div>
                          <h4 className="text-sm font-bold text-[#1B271B]">{item.judul}</h4>
                          <p className="text-xs text-[#6E786D] mt-0.5">{item.ringkasan}</p>
                        </div>

                        {/* Pola & Contoh Pesan */}
                        <div className="rounded-2xl bg-[#243825] text-[#F6F3EA] p-3.5 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-[#C6D2BF]">
                            <span>Format Baku</span>
                            <span className="font-mono text-[#E5EEE3] truncate">{item.pola}</span>
                          </div>
                          <div className="pt-2 border-t border-white/15">
                            <p className="text-[11px] text-[#E5EEE3] mb-1">
                              Contoh Siap Kirim (Unit {blok}):
                            </p>
                            <code className="block text-sm font-mono font-semibold text-[#FFFDF8] break-all tabular-nums">
                              {item.contohSiapKirim}
                            </code>
                          </div>
                        </div>

                        {/* Simulasi Balasan Bot */}
                        <div className="rounded-2xl bg-[#E5EEE3]/60 border border-[#C6D2BF] p-3">
                          <p className="text-[11px] font-semibold text-[#243825] mb-1">
                            Contoh Balasan Otomatis Bot WA
                          </p>
                          <p className="text-xs text-[#1B271B] whitespace-pre-line leading-relaxed font-mono">
                            {item.contohBalasan}
                          </p>
                        </div>

                        {/* Tombol Aksi Salin & Buka WhatsApp */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleCopyFormat(item)}
                            className="min-h-[42px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-[#1B271B] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-4 h-4 text-[#243825]" />
                                <span>Format Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 text-[#243825]" />
                                <span>Salin Format Pesan</span>
                              </>
                            )}
                          </button>

                          {waHref ? (
                            <a
                              href={waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-[42px] px-3.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shadow-xs"
                            >
                              <MessageCircle className="w-4 h-4 text-[#E5EEE3]" />
                              <span>Kirim ke Bot WA</span>
                              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                            </a>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                void handleCopyFormat(item);
                                onToast?.(
                                  'info',
                                  'Format disalin. Nomor Bot WA belum diisi Bendahara — kirim manual ke nomor Bot WA.'
                                );
                              }}
                              className="min-h-[42px] px-3.5 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] text-[#243825] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                            >
                              <Bot className="w-4 h-4 text-[#243825]" />
                              <span>Salin untuk Bot WA</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Catatan Penting */}
              <div className="rounded-2xl bg-[#F7F4EC] border border-[#E6E2D6] px-4 py-3 text-xs text-[#4A554A] leading-relaxed">
                <span className="font-semibold text-[#1B271B]">Catatan: </span>
                {activeSection.catatan}
              </div>
            </div>

            {/* Footer Aksi */}
            <div className="px-5 sm:px-6 py-3.5 border-t border-[#E6E2D6] bg-[#F7F4EC] flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 shrink-0 pb-[calc(0.875rem+env(safe-area-inset-bottom))]">
              <p className="text-[11px] text-[#6E786D]">
                Portal resmi:{' '}
                <span className="font-mono font-semibold text-[#1B271B]">{APP_PORTAL_URL}</span>
              </p>

              <div className="flex items-center gap-2">
                {activeTab === 'setor' && onGoToSetor && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onGoToSetor();
                    }}
                    className="flex-1 sm:flex-none min-h-[42px] px-5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shadow-xs"
                  >
                    <CreditCard className="w-3.5 h-3.5 text-[#E5EEE3]" />
                    <span>Setor di Portal Sekarang</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 sm:flex-none min-h-[42px] px-5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/50 text-[#1B271B] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
                >
                  Tutup Panduan
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
