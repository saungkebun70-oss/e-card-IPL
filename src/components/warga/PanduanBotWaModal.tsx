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
  WA_PENGURUS,
  type Warga,
} from '../../types';
import {
  buildWhatsAppLink,
  copyToClipboard,
  formatRupiah,
  getCurrentBillingMonth,
  getNamaBulan,
  getSingkatBulan,
} from '../../lib/format';

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
  const [activeTab, setActiveTab] = useState<GuideTabId>('verifikasi');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const blok = profil?.blok_rumah || 'B5/21';
  const nama = profil?.nama_warga || 'Warga Saung Kebun';
  const nominal = profil?.nominal_iuran || NOMINAL_IPL_STANDAR;
  const currentMonth = getCurrentBillingMonth();
  const bulanSingkat = getSingkatBulan(currentMonth).toUpperCase();
  const bulanNama = getNamaBulan(currentMonth);
  const kodeBulan = `${bulanSingkat}${TAHUN_AKTIF}`;

  const sections: GuideTabSection[] = [
    {
      id: 'verifikasi',
      label: 'Verifikasi Akun',
      shortLabel: 'Verifikasi',
      icon: ShieldCheck,
      pengantar:
        'Hubungkan dan verifikasi nomor WhatsApp Anda dengan unit rumah di Perumahan Saung Kebun agar pengingat tagihan dan konfirmasi kwitansi terkirim ke nomor yang benar.',
      langkah: [
        'Pastikan Anda mengirim pesan dari nomor WhatsApp yang terdaftar pada unit rumah Anda.',
        'Kirim format pesan VERIFIKASI sesuai contoh di bawah (ganti 6 digit PIN sesuai PIN resmi unit Anda).',
        'Bot WhatsApp akan membalas status kecocokan data unit beserta tautan resmi Portal e-Card.',
      ],
      formats: [
        {
          id: 'fmt-verifikasi',
          judul: 'Verifikasi Nomor WA & Unit Rumah',
          ringkasan: 'Memastikan nomor WhatsApp aktif terhubung ke data blok rumah Anda.',
          pola: 'VERIFIKASI#[BLOK]#[PIN_6_DIGIT]',
          contohSiapKirim: `VERIFIKASI#${blok}#123456`,
          contohBalasan: `✅ Verifikasi berhasil!\nUnit: Blok ${blok} (${nama})\nStatus: Terdaftar di e-Card IPL Saung Kebun.\nPortal: ${APP_PORTAL_URL}`,
        },
        {
          id: 'fmt-bantuan-pin',
          judul: 'Minta Bantuan Reset PIN / Ubah Nomor WA',
          ringkasan: 'Gunakan bila Anda lupa PIN 6 digit atau baru mengganti nomor WhatsApp.',
          pola: 'BANTUAN#PIN#[BLOK]#[NAMA]',
          contohSiapKirim: `BANTUAN#PIN#${blok}#${nama}`,
          contohBalasan: `📩 Permintaan bantuan untuk Blok ${blok} telah diteruskan ke Bendahara (Andriansyah). Mohon tunggu konfirmasi balasan pengurus.`,
        },
      ],
      catatan:
        'Demi keamanan privasi, jangan pernah membagikan PIN 6 digit rumah Anda di grup WhatsApp. Kirim format verifikasi hanya melalui chat pribadi ke nomor resmi Bot WA / Pengurus.',
    },
    {
      id: 'saldo',
      label: 'Cek Saldo & Status',
      shortLabel: 'Cek Saldo',
      icon: Wallet,
      pengantar:
        'Pantau status pembayaran IPL bulan berjalan, sisa kewajiban/tunggakan, serta rekap lunas sepanjang tahun tanpa harus membuka browser terlebih dahulu.',
      langkah: [
        'Ketik format CEK untuk melihat status tagihan bulan berjalan dan jatuh tempo.',
        'Atau ketik format SALDO disertai tahun berjalan untuk mendapatkan rekap 12 bulan lengkap.',
        'Bot akan membalas rincian status e-Card (Lunas, Menunggu Verifikasi, atau Belum Bayar) secara otomatis.',
      ],
      formats: [
        {
          id: 'fmt-cek-status',
          judul: 'Cek Tagihan Bulan Berjalan',
          ringkasan: `Melihat status e-Card bulan ${bulanNama} ${TAHUN_AKTIF} dan nominal kewajiban.`,
          pola: 'CEK#[BLOK]',
          contohSiapKirim: `CEK#${blok}`,
          contohBalasan: `📋 Status e-Card Blok ${blok}\nPeriode: ${bulanNama} ${TAHUN_AKTIF}\nIuran Wajib: ${formatRupiah(nominal)}\nJatuh Tempo: Tanggal ${TANGGAL_JATUH_TEMPO}\nPortal: ${APP_PORTAL_URL}`,
        },
        {
          id: 'fmt-cek-saldo',
          judul: 'Cek Rekap Saldo & Tunggakan Tahunan',
          ringkasan: `Menampilkan ringkasan jumlah bulan lunas dan sisa tagihan tahun ${TAHUN_AKTIF}.`,
          pola: 'SALDO#[BLOK]#[TAHUN]',
          contohSiapKirim: `SALDO#${blok}#${TAHUN_AKTIF}`,
          contohBalasan: `📊 Rekap IPL ${TAHUN_AKTIF} — Blok ${blok}\nTerbayar: Lunas tercatat otomatis\nSisa Tagihan: Cek detail 12 bulan di ${APP_PORTAL_URL}`,
        },
      ],
      catatan: `Tagihan IPL diterbitkan setiap tanggal 1 dan jatuh tempo setiap tanggal ${TANGGAL_JATUH_TEMPO}. Data saldo pada balasan Bot WA tersinkronisasi langsung dengan status e-Card di portal.`,
    },
    {
      id: 'setor',
      label: 'Setor IPL via WA',
      shortLabel: 'Setor IPL',
      icon: CreditCard,
      pengantar:
        'Laporkan bukti pembayaran QRIS, Transfer Bank, E-Wallet, atau Titip Pengurus lewat format pesan otomatis agar Bendahara dapat memverifikasi dengan cepat.',
      langkah: [
        `Lakukan pembayaran IPL (${formatRupiah(nominal)}/bulan) via QRIS resmi, Transfer Rekening kas, E-Wallet, atau Titip Pengurus.`,
        'Lampirkan foto/screenshot bukti bayar lalu tulis caption sesuai format SETOR di bawah ini.',
        'Setelah Bendahara (Andriansyah) memverifikasi, status e-Card otomatis berubah LUNAS dan kwitansi digital tersedia di portal.',
      ],
      formats: [
        {
          id: 'fmt-setor-digital',
          judul: 'Konfirmasi Setor via QRIS / Transfer / E-Wallet',
          ringkasan: 'Kirim bersama foto bukti bayar agar transaksi cepat dicocokkan Bendahara.',
          pola: 'SETOR#[BLOK]#[BULAN]#[NOMINAL]#[METODE]',
          contohSiapKirim: `SETOR#${blok}#${kodeBulan}#${nominal}#QRIS`,
          contohBalasan: `🧾 Laporan setoran diterima!\nBlok: ${blok} · Periode: ${kodeBulan}\nNominal: ${formatRupiah(nominal)} (QRIS)\nStatus: Menunggu Verifikasi Bendahara.`,
        },
        {
          id: 'fmt-setor-tunai',
          judul: 'Konfirmasi Titip Setor Tunai ke Pengurus',
          ringkasan: 'Catat nama pengurus penerima (Bp. Iwan, Erlangga, Andriansyah, Doni, Wahyu, atau Deny).',
          pola: 'SETOR#[BLOK]#[BULAN]#[NOMINAL]#TUNAI#[NAMA_PENGURUS]',
          contohSiapKirim: `SETOR#${blok}#${kodeBulan}#${nominal}#TUNAI#ANDRIANSYAH`,
          contohBalasan: `🤝 Konfirmasi setor tunai Blok ${blok} (${formatRupiah(nominal)}) via Andriansyah tercatat. Kwitansi digital dapat diunduh setelah verifikasi.`,
        },
      ],
      catatan:
        'Untuk unggah bukti bayar lebih cepat dan langsung mendapatkan nomor antrean verifikasi otomatis, Anda juga dapat menyetor langsung melalui menu Setor Iuran di portal ini.',
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
            className="fixed inset-0 bg-slate-950/55 backdrop-blur-xs"
            aria-hidden="true"
          />

          {/* Modal Sheet / Dialog */}
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-2xl max-h-[90vh] bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Drag Indicator untuk Mobile */}
            <div className="sm:hidden pt-2.5 pb-1 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-slate-300" aria-hidden="true" />
            </div>

            {/* Header Modal */}
            <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-5 h-5 text-[#059669]" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="panduan-bot-wa-title"
                    className="text-base sm:text-lg font-bold text-[#0F172A] tracking-tight"
                  >
                    Panduan Bot WhatsApp IPL
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Perumahan Saung Kebun · Unit{' '}
                    <span className="font-mono font-semibold text-slate-700">{blok}</span> · Format
                    Pesan Otomatis
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Tutup Panduan Bot WA"
                className="min-h-[40px] min-w-[40px] rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab Navigasi Interaktif (3 Alur Utama) */}
            <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-slate-100 bg-slate-50/70 shrink-0">
              <div
                role="tablist"
                aria-label="Kategori Panduan Bot WhatsApp"
                className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 rounded-xl"
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
                      className={`min-h-[42px] px-2.5 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-white text-[#0F172A] shadow-sm'
                          : 'text-slate-600 hover:text-[#0F172A]'
                      }`}
                    >
                      <Icon
                        className={`w-3.5 h-3.5 shrink-0 ${
                          active ? 'text-[#059669]' : 'text-slate-500'
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
                <p className="text-sm text-slate-700 leading-relaxed">{activeSection.pengantar}</p>

                <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-4">
                  <h3 className="text-xs font-bold text-[#0F172A] mb-2.5">
                    Langkah-langkah {activeSection.label}
                  </h3>
                  <ol className="space-y-2.5 text-sm text-slate-700">
                    {activeSection.langkah.map((step, idx) => (
                      <li key={step} className="flex items-start gap-3 leading-relaxed">
                        <span className="w-5 h-5 rounded-md bg-[#0F172A] text-white font-mono text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 tabular-nums">
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
                  <h3 className="text-xs font-bold text-slate-500">
                    Format Pesan Otomatis untuk Blok {blok}
                  </h3>
                  <span className="text-xs text-slate-400 tabular-nums">
                    {activeSection.formats.length} format tersedia
                  </span>
                </div>

                {activeSection.formats.map((item) => {
                  const isCopied = copiedId === item.id;
                  const waHref = buildWhatsAppLink(WA_PENGURUS, item.contohSiapKirim);
                  return (
                    <article
                      key={item.id}
                      className="rounded-xl border border-slate-200 bg-white overflow-hidden"
                    >
                      <div className="p-4 space-y-3">
                        <div>
                          <h4 className="text-sm font-bold text-[#0F172A]">{item.judul}</h4>
                          <p className="text-xs text-slate-500 mt-0.5">{item.ringkasan}</p>
                        </div>

                        {/* Pola & Contoh Pesan */}
                        <div className="rounded-lg bg-slate-900 text-slate-100 p-3.5 space-y-2">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <span>Format Baku</span>
                            <span className="font-mono text-slate-300 truncate">{item.pola}</span>
                          </div>
                          <div className="pt-2 border-t border-slate-800">
                            <p className="text-[11px] text-emerald-400 mb-1">
                              Contoh Siap Kirim (Unit {blok}):
                            </p>
                            <code className="block text-sm font-mono font-semibold text-white break-all tabular-nums">
                              {item.contohSiapKirim}
                            </code>
                          </div>
                        </div>

                        {/* Simulasi Balasan Bot */}
                        <div className="rounded-lg bg-emerald-50/70 border border-emerald-200/80 p-3">
                          <p className="text-[11px] font-semibold text-emerald-800 mb-1">
                            Contoh Balasan Otomatis Bot WA
                          </p>
                          <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed font-mono">
                            {item.contohBalasan}
                          </p>
                        </div>

                        {/* Tombol Aksi Salin & Buka WhatsApp */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleCopyFormat(item)}
                            className="min-h-[42px] px-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#0F172A] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-4 h-4 text-[#059669]" />
                                <span>Format Tersalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 text-slate-500" />
                                <span>Salin Format Pesan</span>
                              </>
                            )}
                          </button>

                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[42px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                          >
                            <MessageCircle className="w-4 h-4" />
                            <span>Kirim via WhatsApp</span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Catatan Penting */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-[#0F172A]">Catatan: </span>
                {activeSection.catatan}
              </div>
            </div>

            {/* Footer Aksi */}
            <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50/80 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2.5 shrink-0">
              <p className="text-[11px] text-slate-500">
                Portal resmi:{' '}
                <span className="font-mono font-semibold text-slate-700">{APP_PORTAL_URL}</span>
              </p>

              <div className="flex items-center gap-2">
                {activeTab === 'setor' && onGoToSetor && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onGoToSetor();
                    }}
                    className="flex-1 sm:flex-none min-h-[42px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Setor di Portal Sekarang</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 sm:flex-none min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-[#0F172A] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
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
