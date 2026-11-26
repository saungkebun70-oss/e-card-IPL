import React, { useEffect, useRef, useState } from 'react';
import {
  Save,
  Send,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Phone,
  Loader2,
  KeyRound,
  BookOpen,
  Copy,
  Check,
  Bot,
  Webhook,
  ShieldCheck,
  MessageCircle,
  Link2,
} from 'lucide-react';
import {
  APP_ADMIN_PORTAL_URL,
  APP_PORTAL_URL,
  isBendaharaOnly,
  SUSUNAN_PENGURUS,
  TAHUN_AKTIF,
  TEMPLATE_VARIABLES,
  WA_BOT_PRESET_TEMPLATES,
  type BotProvider,
  type BotWaConfig,
  type BotWaLog,
  type PaymentConfig,
  type PengurusAccountInfo,
  type SessionUser,
  type StatusEcardBulanan,
  type Warga,
} from '../../types';
import {
  buildGeneralPengurusLinkMessage,
  buildPengurusAccessWaMessage,
  buildWhatsAppLink,
  copyToClipboard,
  formatBlokRumah,
  formatRupiah,
  formatTanggalWaktu,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import {
  saveBotWaConfigAdmin,
  sendTestWaMessageAdmin,
  sendWargaAccessCredentialsWaAdmin,
  triggerManualWaReminderAdmin,
} from '../../lib/dataService';
import { generateBotAutoReply } from '../../lib/botAutoReply';
import { useAppBrand } from '../../lib/brandContext';
import { PanduanBotWaModal } from '../warga/PanduanBotWaModal';

interface AdminBotWaSlideProps {
  session: SessionUser;
  botConfig: BotWaConfig;
  botLogs: BotWaLog[];
  wargaList: Warga[];
  pengurusAccounts?: PengurusAccountInfo[];
  statusList: StatusEcardBulanan[];
  paymentConfig?: PaymentConfig;
  canManageOverride?: boolean;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminBotWaSlide({
  session,
  botConfig,
  botLogs,
  wargaList,
  pengurusAccounts,
  statusList,
  paymentConfig,
  canManageOverride,
  onRefresh,
  onToast,
}: AdminBotWaSlideProps) {
  const { brand } = useAppBrand();
  const canManageFull =
    canManageOverride !== undefined ? canManageOverride : isBendaharaOnly(session);
  const [config, setConfig] = useState<BotWaConfig>(botConfig);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingCredentials, setSendingCredentials] = useState(false);
  const [confirmSendCredentials, setConfirmSendCredentials] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testingWa, setTestingWa] = useState(false);
  const [panduanModalOpen, setPanduanModalOpen] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedPengurusKey, setCopiedPengurusKey] = useState<string | null>(null);
  const [simRole, setSimRole] = useState<'warga' | 'admin' | 'unregistered'>('warga');
  const [simInput, setSimInput] = useState('MENU');
  const [simHistory, setSimHistory] = useState<
    Array<{ id: string; incoming: string; reply: string; command: string; roleLabel: string }>
  >(() => {
    const initial = generateBotAutoReply('MENU', {
      wargaList,
      statusList,
      paymentConfig,
      senderName: 'Warga Saung Kebun',
      simulatedRole: 'warga',
    });
    return [
      {
        id: 'sim-init',
        incoming: 'MENU',
        reply: initial.reply,
        command: initial.command,
        roleLabel: 'Warga Terdaftar',
      },
    ];
  });
  const [visibleLogsCount, setVisibleLogsCount] = useState(15);

  const webhookUrl = `${APP_PORTAL_URL}/api/bot-wa/webhook`;
  const webhookAliasUrl = `${APP_PORTAL_URL}/api/webhook/fonnte`;

  const handleCopyWebhook = async () => {
    const ok = await copyToClipboard(webhookUrl);
    if (ok) {
      setCopiedWebhook(true);
      onToast('success', 'URL Webhook Bot Jawab Otomatis berhasil disalin.');
      setTimeout(() => setCopiedWebhook(false), 2200);
    } else {
      onToast('error', 'Gagal menyalin URL Webhook.');
    }
  };

  const handleRunSimulator = (rawMessage: string, overrideRole?: 'warga' | 'admin' | 'unregistered') => {
    const clean = rawMessage.trim();
    if (!clean) return;
    const roleToUse = overrideRole || simRole;
    const res = generateBotAutoReply(clean, {
      wargaList,
      statusList,
      paymentConfig,
      senderName: session.nama_warga,
      simulatedRole: roleToUse,
    });
    const roleLabel =
      roleToUse === 'unregistered'
        ? 'Nomor Belum Terdaftar'
        : roleToUse === 'admin'
          ? 'Pengurus / Admin'
          : 'Warga Terdaftar';
    setSimHistory((prev) => [
      {
        id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        incoming: clean,
        reply: res.reply,
        command: res.command,
        roleLabel,
      },
      ...prev.slice(0, 5),
    ]);
    setSimInput('');
  };

  const lastSyncedBotConfigRef = useRef<string>(JSON.stringify(botConfig));

  useEffect(() => {
    const serialized = JSON.stringify(botConfig);
    if (serialized === lastSyncedBotConfigRef.current) return;
    lastSyncedBotConfigRef.current = serialized;
    setConfig(botConfig);
  }, [botConfig]);

  const handleProviderChange = (provider: BotProvider) => {
    const defaultEndpoint =
      provider === 'Fonnte'
        ? 'https://api.fonnte.com/send'
        : 'https://pati.wablas.com/api/send-message';
    setConfig((prev) => ({
      ...prev,
      provider,
      api_endpoint:
        !prev.api_endpoint ||
        prev.api_endpoint.includes('fonnte.com') ||
        prev.api_endpoint.includes('wablas.com')
          ? defaultEndpoint
          : prev.api_endpoint,
    }));
  };

  const insertVariable = (variable: string) => {
    setConfig((prev) => ({
      ...prev,
      template_pesan: `${prev.template_pesan}${prev.template_pesan.endsWith(' ') ? '' : ' '}${variable}`,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await saveBotWaConfigAdmin(session, config);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast('success', 'Konfigurasi Bot WhatsApp Otomatis berhasil disimpan.');
        await onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    setSending(true);
    try {
      const res = await triggerManualWaReminderAdmin(session, config, wargaList, statusList);
      if (res.error) {
        onToast('error', res.error);
      } else if (res.data) {
        onToast('success', res.data.message);
        await onRefresh();
      }
    } finally {
      setSending(false);
    }
  };

  const handleTestSingleWa = async () => {
    setTestingWa(true);
    try {
      const res = await sendTestWaMessageAdmin(session, config, testPhone);
      if (res.error) {
        onToast('error', res.error);
      } else if (res.data) {
        onToast('success', res.data.detail);
        await onRefresh();
      }
    } finally {
      setTestingWa(false);
    }
  };

  const handleSendAccessCredentialsAll = async () => {
    setSendingCredentials(true);
    try {
      const res = await sendWargaAccessCredentialsWaAdmin(
        session,
        config,
        wargaList,
        config.template_pesan
      );
      if (res.error) {
        onToast('error', res.error);
      } else if (res.data) {
        onToast('success', res.data.message);
        setConfirmSendCredentials(false);
        await onRefresh();
      }
    } finally {
      setSendingCredentials(false);
    }
  };

  const activeWargaWithPhoneCount = wargaList.filter(
    (w) => w.aktif && w.status_hunian !== 'Kosong' && w.no_wa.replace(/\D/g, '').length >= 10
  ).length;

  const currentMonthLabel = `${getNamaBulan(getCurrentBillingMonth())} ${TAHUN_AKTIF}`;
  const samplePreview = config.template_pesan
    .replaceAll('{nama_warga}', 'Bapak/Ibu Doni')
    .replaceAll('{blok_rumah}', 'B05/21')
    .replaceAll('{pin_akses}', '482910')
    .replaceAll('{bulan_tagihan}', currentMonthLabel)
    .replaceAll('{nominal_tagihan}', formatRupiah(100000))
    .replaceAll('{link_aplikasi}', APP_PORTAL_URL)
    .replaceAll('{link_admin}', APP_ADMIN_PORTAL_URL)
    .replaceAll('{nama_pengurus}', 'Erlangga')
    .replaceAll('{jabatan}', 'Ketua')
    .replaceAll('{nama_aplikasi}', brand.app_name)
    .replaceAll('{username_pengurus}', 'erlangga')
    .replaceAll('{pin_pengurus}', canManageFull ? '100001' : '(PIN 6 digit pengurus)')
    .replaceAll(
      '{hak_akses}',
      'Akses Pengurus (Monitoring Setoran, Tambah Warga & Input Setoran Tunai)'
    );

  if (!canManageFull) {
    return (
      <div className="rounded-3xl bg-[#FEF3C7]/90 border border-amber-200 p-6 text-center space-y-2">
        <p className="text-sm font-bold text-amber-950">
          Akses Terbatas — Khusus Bendahara
        </p>
        <p className="text-xs text-amber-800 max-w-md mx-auto leading-relaxed">
          Pengaturan gateway, jadwal pengingat, template pesan, dan blast Bot WhatsApp hanya dapat
          diakses dan dikelola oleh akun <strong>Bendahara</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-3xl glass-card bg-white/80 backdrop-blur-xl border border-white/90 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[#0F172A]">
            Panduan Format Pesan Otomatis Warga
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Lihat pratinjau modal panduan verifikasi, cek saldo, dan setor IPL via WhatsApp yang
            tampil di Portal Warga.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPanduanModalOpen(true)}
          className="min-h-[40px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <BookOpen className="w-3.5 h-3.5 text-[#4C1D95]" />
          <span>Lihat Panduan Bot WA</span>
        </button>
      </div>

      {!canManageFull && (
        <div className="rounded-2xl bg-indigo-50/70 border border-indigo-100 px-4 py-3 text-xs text-slate-700">
          <span className="font-semibold text-[#0F172A]">Mode Baca ({session.jabatan || 'Pengurus'}):</span>{' '}
          Pengubahan pengaturan Bot WhatsApp dan pengiriman pengingat massal khusus akun{' '}
          <span className="font-semibold">Bendahara</span>.
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Kiri: Konfigurasi Gateway & Jadwal */}
        <section className="lg:col-span-6 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6 space-y-5">
          {/* Sakelar Aktif / Nonaktif */}
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-indigo-100/70">
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">Status Bot WhatsApp Otomatis</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Aktifkan pengiriman tagihan dan pengingat jatuh tempo otomatis ke WA warga.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={config.aktif}
              onClick={() => setConfig((prev) => ({ ...prev, aktif: !prev.aktif }))}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                config.aktif ? 'bg-[#4C1D95]' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                  config.aktif ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Pilihan Provider */}
          <div>
            <label className="block text-xs font-semibold text-[#0F172A] mb-2">
              Provider Gateway WhatsApp
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {(['Fonnte', 'Wablas'] as const).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  onClick={() => handleProviderChange(provider)}
                  className={`min-h-[44px] rounded-2xl border text-sm font-semibold transition-colors cursor-pointer ${
                    config.provider === provider
                      ? 'bg-[#4C1D95] border-[#4C1D95] text-white shadow-xs'
                      : 'bg-white/90 border-indigo-100 text-slate-700 hover:bg-indigo-50/70'
                  }`}
                >
                  {provider}
                </button>
              ))}
            </div>
          </div>

          {/* API Endpoint */}
          <div>
            <label
              htmlFor="wa-endpoint"
              className="block text-xs font-semibold text-[#0F172A] mb-1.5"
            >
              API Endpoint URL
            </label>
            <input
              id="wa-endpoint"
              type="url"
              required
              value={config.api_endpoint}
              onChange={(e) => setConfig({ ...config, api_endpoint: e.target.value })}
              placeholder="https://api.fonnte.com/send"
              className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm font-mono text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* API Token */}
          <div>
            <label
              htmlFor="wa-token"
              className="block text-xs font-semibold text-[#0F172A] mb-1.5"
            >
              API Token ({config.provider})
            </label>
            <div className="relative">
              <input
                id="wa-token"
                type={showToken ? 'text' : 'password'}
                value={config.api_token}
                onChange={(e) => setConfig({ ...config, api_token: e.target.value })}
                placeholder="Masukkan API Token dari dashboard gateway"
                className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 pl-3.5 pr-11 text-sm font-mono text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                type="button"
                onClick={() => setShowToken((prev) => !prev)}
                aria-label={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-500 hover:text-[#4C1D95] cursor-pointer"
              >
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Checkbox Jadwal Otomatis Bulanan */}
          <div>
            <p className="text-xs font-semibold text-[#0F172A] mb-2.5">Jadwal Otomatis Bulanan</p>
            <div className="space-y-2.5">
              {(
                [
                  {
                    key: 'jadwal_tgl_1',
                    label: 'Tagihan Awal Bulan (Tanggal 1)',
                    desc: 'Mengirim notifikasi penerbitan tagihan IPL bulan baru.',
                  },
                  {
                    key: 'jadwal_tgl_6',
                    label: 'Pengingat H-1 (Tanggal 6)',
                    desc: 'Mengingatkan warga yang belum melunasi satu hari sebelum jatuh tempo.',
                  },
                  {
                    key: 'jadwal_tgl_7',
                    label: 'Jatuh Tempo Hari H (Tanggal 7)',
                    desc: 'Pengingat batas akhir pembayaran IPL bulan berjalan.',
                  },
                  {
                    key: 'jadwal_tgl_8_plus',
                    label: 'Pengingat Keterlambatan (Tanggal 8+)',
                    desc: 'Pengingat berkala bagi unit yang masih menunggak setelah tanggal 7.',
                  },
                ] as const
              ).map((item) => (
                <label
                  key={item.key}
                  className="flex items-start gap-3 p-3 rounded-2xl border border-indigo-100/80 bg-white/60 hover:bg-indigo-50/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={config[item.key]}
                    onChange={(e) => setConfig({ ...config, [item.key]: e.target.checked })}
                    className="w-4 h-4 mt-0.5 rounded accent-[#4C1D95]"
                  />
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">{item.label}</p>
                    <p className="text-xs text-slate-500">{item.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Kanan: Editor Template Pesan, Preview & Aksi Kirim */}
        <section className="lg:col-span-6 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Editor Template Pesan WhatsApp</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pilih preset template cepat (Tagihan IPL atau Akses Akun &amp; PIN) atau sisipkan variabel
              dinamis ke dalam isi pesan.
            </p>
          </div>

          {/* Preset Template Cepat */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {WA_BOT_PRESET_TEMPLATES.map((preset) => {
              const isSelected = config.template_pesan.trim() === preset.template.trim();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      template_pesan: preset.template,
                    }))
                  }
                  className={`text-left p-3 rounded-2xl border transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[#4C1D95] bg-[#EDE9FE]/80'
                      : 'border-indigo-100/80 bg-white/75 hover:bg-indigo-50/60'
                  }`}
                >
                  <p className="text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                    {preset.id === 'akses_pin' ? (
                      <KeyRound className="w-3.5 h-3.5 text-[#4C1D95] shrink-0" />
                    ) : preset.id === 'akses_pengurus' ? (
                      <ShieldCheck className="w-3.5 h-3.5 text-[#4C1D95] shrink-0" />
                    ) : (
                      <MessageSquare className="w-3.5 h-3.5 text-[#4C1D95] shrink-0" />
                    )}
                    <span>{preset.label}</span>
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    {preset.deskripsi}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="min-h-[34px] px-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 hover:bg-[#EDE9FE] hover:border-indigo-300 text-xs font-mono text-slate-700 hover:text-[#4C1D95] transition-colors cursor-pointer"
              >
                {v}
              </button>
            ))}
          </div>

          <textarea
            rows={7}
            required
            value={config.template_pesan}
            onChange={(e) => setConfig({ ...config, template_pesan: e.target.value })}
            className="w-full rounded-2xl border border-indigo-200/80 bg-white/90 p-3.5 text-sm text-[#0F172A] leading-relaxed focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />

          {/* Pratinjau Pesan */}
          <div className="rounded-2xl bg-indigo-50/40 border border-indigo-100/80 p-4">
            <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-[#4C1D95]" />
              Pratinjau Pesan Diterima Warga
            </p>
            <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed">
              {samplePreview}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
            <button
              type="submit"
              disabled={saving || !canManageFull}
              aria-busy={saving}
              className="flex-1 min-h-[46px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap shadow-sm"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}</span>
            </button>

            <button
              type="button"
              disabled={sending || !canManageFull}
              aria-busy={sending}
              onClick={() => void handleSendNow()}
              className="flex-1 min-h-[46px] px-5 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] disabled:opacity-50 disabled:cursor-not-allowed text-[#064E3B] text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap shadow-xs"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{sending ? 'Mengirim Pengingat...' : 'Kirim Pengingat Sekarang'}</span>
            </button>
          </div>

          {/* Uji Kirim 1 Nomor (Cek Token Fonnte/Wablas Langsung) */}
          <div className="pt-4 border-t border-indigo-100/70 space-y-2.5">
            <div>
              <h3 className="text-xs font-bold text-[#0F172A]">
                Uji Koneksi Token ({config.provider}) ke 1 Nomor WA
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Coba kirim 1 pesan tes ke nomor WA Anda sendiri terlebih dahulu untuk memastikan
                token aktif sebelum mengirim ke seluruh warga.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="tel"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  disabled={!canManageFull || testingWa}
                  placeholder="Nomor WA uji coba (contoh: 0812xxxxxxxx)"
                  className="w-full min-h-[44px] rounded-2xl border border-indigo-200/80 bg-white/90 pl-10 pr-3.5 text-sm font-mono text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60"
                />
              </div>
              <button
                type="button"
                disabled={!canManageFull || testingWa || !testPhone.trim()}
                onClick={() => void handleTestSingleWa()}
                className="min-h-[44px] px-4 rounded-full border border-emerald-200 bg-[#D1FAE5] hover:bg-[#A7F3D0] disabled:opacity-50 disabled:cursor-not-allowed text-[#047857] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {testingWa ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Mengirim Tes...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Kirim Tes WA</span>
                  </>
                )}
              </button>
            </div>
          </div>
          {/* Kirim Akses Akun & PIN Massal ke Seluruh Warga Aktif */}
          <div className="pt-4 border-t border-indigo-100/70 space-y-2.5">
            <div>
              <h3 className="text-xs font-bold text-[#0F172A]">
                Bagikan Info Akun &amp; PIN Warga ({APP_PORTAL_URL})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Mengirim pesan pribadi berisi link{' '}
                <span className="font-mono text-slate-700">{APP_PORTAL_URL}</span>, Username Blok
                Rumah, dan PIN 6 digit masing-masing ke{' '}
                <span className="font-mono font-semibold text-slate-700 tabular-nums">
                  {activeWargaWithPhoneCount} warga aktif
                </span>{' '}
                via {config.provider}.
              </p>
            </div>

            {!confirmSendCredentials ? (
              <button
                type="button"
                disabled={!canManageFull || sendingCredentials || activeWargaWithPhoneCount === 0}
                onClick={() => setConfirmSendCredentials(true)}
                className="w-full min-h-[44px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 disabled:opacity-50 disabled:cursor-not-allowed text-[#0F172A] text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <KeyRound className="w-4 h-4 text-[#4C1D95]" />
                <span>Kirim Akses Akun &amp; PIN ke Semua Warga Aktif</span>
              </button>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-[#FEF3C7]/85 p-3.5 space-y-2.5">
                <p className="text-xs text-amber-900 leading-relaxed">
                  Konfirmasi pengiriman: setiap warga aktif ({activeWargaWithPhoneCount} unit) akan
                  menerima <strong>Username Blok &amp; PIN 6 digit</strong> masing-masing melalui{' '}
                  {config.provider}. Pastikan nomor WA di Master Warga sudah benar.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={sendingCredentials}
                    onClick={() => void handleSendAccessCredentialsAll()}
                    className="min-h-[40px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {sendingCredentials ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Mengirim ke {activeWargaWithPhoneCount} Warga...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        <span>Ya, Kirim Sekarang</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={sendingCredentials}
                    onClick={() => setConfirmSendCredentials(false)}
                    className="min-h-[40px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 cursor-pointer transition-colors"
                  >
                    Batal
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </form>

      {/* Template & Bagikan Link Portal Pengurus (/admin) */}
      <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
        <div className="px-5 py-4 border-b border-indigo-100/70 bg-indigo-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#4C1D95] text-white flex items-center justify-center shrink-0 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#0F172A]">
                Template WA Link Portal Pengurus ({APP_ADMIN_PORTAL_URL})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Kirim atau salin template akses khusus Portal Pengurus (terpisah dari link Portal
                Warga) lengkap dengan username, jabatan, hak akses, dan PIN pengurus.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard(APP_ADMIN_PORTAL_URL);
                if (ok) {
                  setCopiedPengurusKey('link-only');
                  onToast('success', `Link Portal Pengurus (${APP_ADMIN_PORTAL_URL}) disalin.`);
                  setTimeout(() => setCopiedPengurusKey(null), 2000);
                } else {
                  onToast('error', 'Gagal menyalin link pengurus.');
                }
              }}
              className="min-h-[38px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#0F172A] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
            >
              {copiedPengurusKey === 'link-only' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#047857]" />
                  <span className="text-[#047857]">Link Tersalin</span>
                </>
              ) : (
                <>
                  <Link2 className="w-3.5 h-3.5 text-[#4C1D95]" />
                  <span>Salin Link /admin</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard(buildGeneralPengurusLinkMessage(brand.app_name));
                if (ok) {
                  setCopiedPengurusKey('template-umum');
                  onToast('success', 'Template WA Link Pengurus Umum berhasil disalin.');
                  setTimeout(() => setCopiedPengurusKey(null), 2000);
                } else {
                  onToast('error', 'Gagal menyalin template.');
                }
              }}
              className="min-h-[38px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors shadow-xs"
            >
              {copiedPengurusKey === 'template-umum' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Tersalin</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Salin Template Umum</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SUSUNAN_PENGURUS.map((p) => {
            const account = pengurusAccounts?.find(
              (a) => a.username.toLowerCase() === p.username.toLowerCase()
            );
            const mergedInfo: PengurusAccountInfo = {
              ...p,
              pin_akses: account?.pin_akses,
              no_wa: brand.pengurus_wa_map?.[p.username] || account?.no_wa,
            };
            const targetPhone =
              brand.pengurus_wa_map?.[p.username] || account?.no_wa || brand.wa_pengurus;
            const waText = buildPengurusAccessWaMessage(mergedInfo, {
              appName: brand.app_name,
              includePin: canManageFull,
            });

            return (
              <div
                key={p.username}
                className="rounded-2xl border border-indigo-100/80 bg-indigo-50/40 p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#4C1D95]">{p.jabatan}</span>
                    <span className="text-[11px] font-mono text-slate-500">Blok {formatBlokRumah(p.blokRumah) || p.blokRumah}</span>
                  </div>
                  <p className="text-sm font-bold text-[#0F172A]">{p.nama}</p>
                  <p className="text-xs text-slate-600">
                    Username:{' '}
                    <span className="font-mono font-semibold text-[#0F172A]">{p.username}</span>
                    {canManageFull && mergedInfo.pin_akses && (
                      <>
                        {' · '}PIN:{' '}
                        <span className="font-mono font-semibold text-[#047857]">
                          {mergedInfo.pin_akses}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {p.permission === 'full' ? 'Akses Penuh (Bendahara)' : 'Akses Tambah Data'}
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={buildWhatsAppLink(targetPhone, waText)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-h-[38px] px-3 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-[#064E3B] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Kirim WA</span>
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(waText);
                      if (ok) {
                        setCopiedPengurusKey(p.username);
                        onToast(
                          'success',
                          `Template WA Link Pengurus untuk ${p.nama} (${p.jabatan}) berhasil disalin.`
                        );
                        setTimeout(() => setCopiedPengurusKey(null), 2000);
                      } else {
                        onToast('error', 'Gagal menyalin template pengurus.');
                      }
                    }}
                    className="min-h-[38px] px-3.5 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#0F172A] inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
                  >
                    {copiedPengurusKey === p.username ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#047857]" />
                        <span className="text-[#047857]">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Salin</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bot Jawab Otomatis (Webhook Fonnte) + Simulator Live */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Pengaturan Webhook Fonnte */}
        <div className="lg:col-span-5 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#EDE9FE] border border-[#DDD6FE] flex items-center justify-center shrink-0">
              <Webhook className="w-5 h-5 text-[#4C1D95]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#0F172A]">
                Bot Jawab Otomatis (Strict Sender Isolation)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                Bot hanya merespons nomor WA yang terdaftar di Master Warga dan mengunci data agar
                warga hanya dapat melihat status blok rumahnya sendiri. Pesan grup &amp; nomor asing
                otomatis ditolak.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#0F172A]">
              Webhook URL (Tempel di Dashboard Fonnte)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                aria-label="URL Webhook Bot Jawab Otomatis"
                className="flex-1 min-w-0 min-h-[42px] rounded-2xl border border-indigo-200/80 bg-indigo-50/40 px-3 text-xs font-mono text-slate-800"
              />
              <button
                type="button"
                onClick={() => void handleCopyWebhook()}
                className="min-h-[42px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedWebhook ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Salin URL</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 font-mono truncate">
              Alias didukung: {webhookAliasUrl}
            </p>
          </div>

          <div className="rounded-2xl bg-indigo-50/40 border border-indigo-100/80 p-4 space-y-2">
            <p className="text-xs font-bold text-[#0F172A]">
              Cara Aktifkan di Dashboard Fonnte (3 Langkah):
            </p>
            <ol className="space-y-1.5 text-xs text-slate-600 leading-relaxed list-decimal list-inside">
              <li>
                Buka <span className="font-mono text-slate-800">md.fonnte.com</span> → menu{' '}
                <strong>Device</strong> → klik <strong>Edit</strong> pada device WhatsApp Bot.
              </li>
              <li>
                Tempel URL Webhook di atas pada kolom <strong>Webhook URL</strong>, lalu simpan.
              </li>
              <li>
                Pastikan sakelar <strong>Status Bot WhatsApp Otomatis</strong> aktif, API Token
                tersimpan, dan nomor WA warga sudah diisi di menu Master Warga.
              </li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-slate-500">Perintah Otomatis (Aman Privasi)</p>
            <div className="text-xs text-slate-700 font-mono space-y-1 leading-relaxed">
              <p>CEK · SALDO · REKENING · BAYAR · MENU · PENGURUS</p>
              <p>CEK#[KODE_BLOK] (khusus Pengurus / Bendahara)</p>
            </div>
          </div>
        </div>

        {/* Simulator Live Bot Jawab Otomatis */}
        <div className="lg:col-span-7 glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
          <div className="px-5 py-4 border-b border-indigo-100/70 bg-indigo-50/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Bot className="w-4 h-4 text-[#4C1D95] shrink-0" />
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[#0F172A] truncate">
                  Simulator Uji Isolasi Keamanan Bot WA
                </h3>
                <p className="text-xs text-slate-500 truncate">
                  Uji balasan otomatis berdasarkan peran pengirim (Warga, Pengurus, atau Nomor Asing).
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Pilih Peran Pengirim Simulator */}
            <div className="flex flex-wrap items-center gap-1.5 p-1 bg-indigo-50/80 border border-indigo-100/80 rounded-2xl w-fit">
              {(
                [
                  { id: 'warga', label: 'Simulasi: Warga Biasa' },
                  { id: 'admin', label: 'Simulasi: Pengurus' },
                  { id: 'unregistered', label: 'Simulasi: Nomor Asing' },
                ] as const
              ).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSimRole(r.id)}
                  className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    simRole === r.id
                      ? 'bg-[#4C1D95] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#4C1D95]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Tombol Perintah Cepat */}
            <div className="flex flex-wrap gap-1.5">
              {[
                'CEK',
                'CEK#B07/16',
                'SALDO',
                'REKENING',
                'MENU',
                'PENGURUS',
              ].map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => handleRunSimulator(cmd)}
                  className="min-h-[34px] px-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 hover:bg-[#EDE9FE] hover:border-indigo-300 text-xs font-mono text-slate-700 hover:text-[#4C1D95] transition-colors cursor-pointer"
                >
                  {cmd}
                </button>
              ))}
            </div>

            {/* Input Uji Pesan */}
            <div className="flex gap-2">
              <input
                type="text"
                value={simInput}
                onChange={(e) => setSimInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleRunSimulator(simInput);
                  }
                }}
                placeholder="Ketik simulasi pesan (contoh: CEK atau CEK#B07/16)..."
                className="flex-1 min-w-0 min-h-[42px] rounded-2xl border border-indigo-200/80 bg-white/90 px-3.5 text-sm font-mono text-[#0F172A] focus:border-[#4C1D95] focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <button
                type="button"
                onClick={() => handleRunSimulator(simInput)}
                className="min-h-[42px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Uji Balasan</span>
              </button>
            </div>

            {/* Hasil Percakapan Simulator */}
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {simHistory.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-indigo-100/80 bg-indigo-50/35 p-3.5 space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>
                      {item.roleLabel} · Status{' '}
                      <span className="font-mono font-semibold text-slate-700">{item.command}</span>
                    </span>
                  </div>
                  <div className="rounded-xl bg-white border border-indigo-100/80 px-3 py-2 text-xs font-mono font-semibold text-[#0F172A]">
                    {item.incoming}
                  </div>
                  <div className="rounded-xl bg-[#D1FAE5]/60 border border-emerald-200/80 px-3.5 py-2.5">
                    <p className="text-[11px] font-semibold text-[#047857] mb-1">
                      Balasan Otomatis Bot WA
                    </p>
                    <p className="text-xs text-slate-800 whitespace-pre-line leading-relaxed">
                      {item.reply}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Tabel Log Riwayat Pengiriman Bot WA */}
      <section className="glass-card bg-white/80 backdrop-blur-xl border border-white/90 rounded-3xl overflow-hidden">
        <div className="px-5 py-4 border-b border-indigo-100/70 bg-indigo-50/40 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Log Riwayat Pengiriman Bot WA</h2>
            <p className="text-xs text-slate-500">
              Catatan pengiriman pengingat tagihan IPL melalui gateway {config.provider}.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {botLogs.length} catatan
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-indigo-100/80 bg-indigo-50/70 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">Waktu</th>
                <th className="py-3 px-4 whitespace-nowrap">Blok / Penerima</th>
                <th className="py-3 px-4 whitespace-nowrap">No. WA</th>
                <th className="py-3 px-4">Jenis Pengingat</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                <th className="py-3 px-4">Respon Gateway</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-indigo-100/60 text-xs sm:text-sm">
              {botLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Belum ada log pengiriman Bot WhatsApp.
                  </td>
                </tr>
              ) : (
                botLogs.slice(0, visibleLogsCount).map((log) => (
                  <tr key={log.id} className="hover:bg-indigo-50/40 transition-colors">
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {formatTanggalWaktu(log.created_at)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-[#0F172A]">{formatBlokRumah(log.blok_rumah) || log.blok_rumah}</span>
                      <span className="text-slate-400 mx-1.5">·</span>
                      <span className="text-slate-700">{log.nama_warga}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {log.no_wa}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{log.jenis_pesan}</td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          log.status_kirim === 'Terkirim' ? 'text-[#047857]' : 'text-red-700'
                        }`}
                      >
                        {log.status_kirim === 'Terkirim' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5" />
                        )}
                        {log.status_kirim}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">{log.respon_gateway}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {botLogs.length > visibleLogsCount && (
          <div className="px-5 py-3 border-t border-indigo-100/70 bg-indigo-50/40 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500 tabular-nums">
              Menampilkan {Math.min(visibleLogsCount, botLogs.length)} dari {botLogs.length} log
            </span>
            <button
              type="button"
              onClick={() => setVisibleLogsCount((c) => c + 20)}
              className="min-h-[36px] px-4 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-[#0F172A] cursor-pointer transition-colors"
            >
              Tampilkan Lebih Banyak
            </button>
          </div>
        )}
      </section>

      <PanduanBotWaModal
        open={panduanModalOpen}
        onClose={() => setPanduanModalOpen(false)}
        profil={{
          blok_rumah: 'B05/21',
          nama_warga: 'DONI',
          nominal_iuran: 100000,
          no_wa: '6281234567890',
        }}
        onToast={onToast}
      />
    </div>
  );
}
