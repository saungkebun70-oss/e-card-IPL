import React, { useEffect, useState } from 'react';
import {
  Save,
  Send,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  MessageSquare,
} from 'lucide-react';
import {
  isBendaharaFullAccess,
  TAHUN_AKTIF,
  TEMPLATE_VARIABLES,
  type BotProvider,
  type BotWaConfig,
  type BotWaLog,
  type SessionUser,
  type StatusEcardBulanan,
  type Warga,
} from '../../types';
import {
  formatRupiah,
  formatTanggalWaktu,
  getCurrentBillingMonth,
  getNamaBulan,
} from '../../lib/format';
import {
  saveBotWaConfigAdmin,
  triggerManualWaReminderAdmin,
} from '../../lib/dataService';

interface AdminBotWaSlideProps {
  session: SessionUser;
  botConfig: BotWaConfig;
  botLogs: BotWaLog[];
  wargaList: Warga[];
  statusList: StatusEcardBulanan[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminBotWaSlide({
  session,
  botConfig,
  botLogs,
  wargaList,
  statusList,
  onRefresh,
  onToast,
}: AdminBotWaSlideProps) {
  const canManageFull = isBendaharaFullAccess(session);
  const [config, setConfig] = useState<BotWaConfig>(botConfig);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [visibleLogsCount, setVisibleLogsCount] = useState(15);

  useEffect(() => {
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

  const currentMonthLabel = `${getNamaBulan(getCurrentBillingMonth())} ${TAHUN_AKTIF}`;
  const samplePreview = config.template_pesan
    .replaceAll('{nama_warga}', 'Bapak/Ibu Tina')
    .replaceAll('{blok_rumah}', 'B05/07')
    .replaceAll('{bulan_tagihan}', currentMonthLabel)
    .replaceAll('{nominal_tagihan}', formatRupiah(100000))
    .replaceAll(
      '{link_aplikasi}',
      typeof window !== 'undefined' ? window.location.origin : 'https://saungkebun.vercel.app'
    );

  return (
    <div className="space-y-6">
      {!canManageFull && (
        <div className="rounded-xl bg-slate-100 border border-slate-200 px-4 py-3 text-xs text-slate-700">
          <span className="font-semibold text-[#0F172A]">Mode Baca ({session.jabatan || 'Pengurus'}):</span>{' '}
          Pengubahan pengaturan Bot WhatsApp dan pengiriman pengingat massal khusus akun{' '}
          <span className="font-semibold">Bendahara</span>.
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Kiri: Konfigurasi Gateway & Jadwal */}
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
          {/* Sakelar Aktif / Nonaktif */}
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-200">
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
                config.aktif ? 'bg-[#059669]' : 'bg-slate-300'
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
                  className={`min-h-[44px] rounded-xl border text-sm font-semibold transition-colors cursor-pointer ${
                    config.provider === provider
                      ? 'bg-[#0F172A] border-[#0F172A] text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
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
              className="w-full min-h-[44px] rounded-xl border border-slate-300 px-3.5 text-sm font-mono focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
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
                className="w-full min-h-[44px] rounded-xl border border-slate-300 pl-3.5 pr-11 text-sm font-mono focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
              />
              <button
                type="button"
                onClick={() => setShowToken((prev) => !prev)}
                aria-label={showToken ? 'Sembunyikan token' : 'Tampilkan token'}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-slate-500 hover:text-slate-800 cursor-pointer"
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
                  className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={config[item.key]}
                    onChange={(e) => setConfig({ ...config, [item.key]: e.target.checked })}
                    className="w-4 h-4 mt-0.5 rounded accent-[#059669]"
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
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Editor Template Pesan WhatsApp</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Klik variabel dinamis di bawah untuk menyisipkannya ke dalam isi pesan.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs font-mono text-slate-700 hover:text-emerald-800 transition-colors cursor-pointer"
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
            className="w-full rounded-xl border border-slate-300 p-3.5 text-sm text-[#0F172A] leading-relaxed focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
          />

          {/* Pratinjau Pesan */}
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
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
              className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}</span>
            </button>

            <button
              type="button"
              disabled={sending || !canManageFull}
              onClick={() => void handleSendNow()}
              className="flex-1 min-h-[46px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Send className="w-4 h-4" />
              <span>{sending ? 'Mengirim Pengingat...' : 'Kirim Pengingat Sekarang'}</span>
            </button>
          </div>
        </section>
      </form>

      {/* Tabel Log Riwayat Pengiriman Bot WA */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
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
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4 whitespace-nowrap">Waktu</th>
                <th className="py-3 px-4 whitespace-nowrap">Blok / Penerima</th>
                <th className="py-3 px-4 whitespace-nowrap">No. WA</th>
                <th className="py-3 px-4">Jenis Pengingat</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                <th className="py-3 px-4">Respon Gateway</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
              {botLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    Belum ada log pengiriman Bot WhatsApp.
                  </td>
                </tr>
              ) : (
                botLogs.slice(0, visibleLogsCount).map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {formatTanggalWaktu(log.created_at)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-mono font-bold text-[#0F172A]">{log.blok_rumah}</span>
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
                          log.status_kirim === 'Terkirim' ? 'text-emerald-700' : 'text-red-700'
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
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500 tabular-nums">
              Menampilkan {Math.min(visibleLogsCount, botLogs.length)} dari {botLogs.length} log
            </span>
            <button
              type="button"
              onClick={() => setVisibleLogsCount((c) => c + 20)}
              className="min-h-[36px] px-3.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-[#0F172A] cursor-pointer"
            >
              Tampilkan Lebih Banyak
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
