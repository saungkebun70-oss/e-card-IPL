import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Upload,
  RotateCcw,
  Save,
  Loader2,
  ShieldAlert,
  Sparkles,
  Image as ImageIcon,
  CheckCircle2,
  Phone,
  Bot,
  AlertTriangle,
  Users,
} from 'lucide-react';
import {
  DEFAULT_APP_BRAND_CONFIG,
  isBendaharaFullAccess,
  SUSUNAN_PENGURUS,
  type AppBrandConfig,
  type SessionUser,
} from '../../types';
import { useAppBrand } from '../../lib/brandContext';
import { compressLogoImage } from '../../lib/imageCompressor';
import { normalizeWaNumber } from '../../lib/format';
import { saveAppBrandConfigAdmin, uploadAppLogoAdmin } from '../../lib/dataService';
import { BrandLogo } from '../BrandLogo';

interface AdminBrandSettingsModalProps {
  open: boolean;
  session: SessionUser;
  onClose: () => void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
  initialTab?: 'brand' | 'wa';
}

type ModalTab = 'brand' | 'wa';

export function AdminBrandSettingsModal({
  open,
  session,
  onClose,
  onToast,
  initialTab = 'brand',
}: AdminBrandSettingsModalProps) {
  const { brand, setBrand } = useAppBrand();
  const canEdit = isBendaharaFullAccess(session);

  const [activeTab, setActiveTab] = useState<ModalTab>(initialTab);
  const [draft, setDraft] = useState<AppBrandConfig>(brand);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft({
        ...brand,
        pengurus_wa_map: { ...(brand.pengurus_wa_map || {}) },
      });
      setActiveTab(initialTab);
    }
  }, [open, brand, initialTab]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !uploadingLogo) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, uploadingLogo, onClose]);

  if (!open) return null;

  const normWaPengurus = normalizeWaNumber(draft.wa_pengurus || '');
  const normWaBot = draft.wa_bot?.trim() ? normalizeWaNumber(draft.wa_bot) : '';
  const isSameAsBot = Boolean(normWaPengurus && normWaBot && normWaPengurus === normWaBot);

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canEdit) return;

    if (file.type && !file.type.startsWith('image/')) {
      onToast('error', 'Logo aplikasi harus berupa file gambar (PNG, JPG, WebP, atau SVG).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      onToast('error', 'Ukuran file gambar terlalu besar (maksimal 10 MB).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setUploadingLogo(true);
    try {
      const optimized = await compressLogoImage(file, 512);
      const res = await uploadAppLogoAdmin(session, optimized.file);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengunggah logo aplikasi.');
      } else {
        setDraft((prev) => ({ ...prev, logo_url: res.data || null }));
        onToast(
          'success',
          'Logo baru berhasil diunggah. Klik "Simpan Pengaturan" untuk menerapkan ke seluruh portal.'
        );
      }
    } catch {
      onToast('error', 'Gagal memproses gambar logo. Coba pilih file PNG atau JPG lain.');
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResetLogoOnly = () => {
    if (!canEdit) return;
    setDraft((prev) => ({ ...prev, logo_url: null }));
    onToast('info', 'Logo dikembalikan ke logo bawaan. Klik "Simpan Pengaturan" untuk menerapkan.');
  };

  const handleResetAllDefault = () => {
    if (!canEdit) return;
    setDraft({
      ...DEFAULT_APP_BRAND_CONFIG,
      pengurus_wa_map: {},
      updated_at: new Date().toISOString(),
      updated_by: session.blok_rumah,
    });
    onToast('info', 'Kolom diisi ulang ke setelan awal. Klik "Simpan Pengaturan" untuk menyimpan.');
  };

  const handlePengurusWaChange = (username: string, value: string) => {
    setDraft((prev) => {
      const nextMap = { ...(prev.pengurus_wa_map || {}) };
      if (!value.trim()) {
        delete nextMap[username];
      } else {
        nextMap[username] = value;
      }
      return { ...prev, pengurus_wa_map: nextMap };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || saving || uploadingLogo) return;

    if (!draft.app_name.trim()) {
      setActiveTab('brand');
      onToast('error', 'Nama aplikasi wajib diisi.');
      return;
    }
    if (!draft.app_subtitle.trim()) {
      setActiveTab('brand');
      onToast('error', 'Sub-nama / keterangan perumahan wajib diisi.');
      return;
    }
    if (!normWaPengurus || normWaPengurus.length < 10) {
      setActiveTab('wa');
      onToast('error', 'Nomor WhatsApp utama Pengurus tidak valid (minimal 10 digit, contoh: 0812xxxx).');
      return;
    }
    if (isSameAsBot) {
      setActiveTab('wa');
      onToast(
        'error',
        'Nomor WA Pengurus tidak boleh sama dengan Nomor WA Bot agar pesan warga ke pengurus tidak masuk ke bot.'
      );
      return;
    }

    setSaving(true);
    try {
      const res = await saveAppBrandConfigAdmin(session, {
        app_name: draft.app_name,
        app_subtitle: draft.app_subtitle,
        kop_resmi: draft.kop_resmi,
        logo_url: draft.logo_url,
        wa_pengurus: draft.wa_pengurus,
        wa_pengurus_label: draft.wa_pengurus_label,
        wa_bot: draft.wa_bot,
        pengurus_wa_map: draft.pengurus_wa_map,
      });

      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal menyimpan pengaturan aplikasi & WA pengurus.');
      } else {
        setBrand(res.data);
        onToast(
          'success',
          `Pengaturan aplikasi "${res.data.app_name}" & No. WA Pengurus (+${res.data.wa_pengurus}) berhasil disimpan.`
        );
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="brand-settings-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
    >
      {/* Backdrop */}
      <div
        onClick={() => {
          if (!saving && !uploadingLogo) onClose();
        }}
        className="fixed inset-0 bg-slate-950/55 backdrop-blur-xs"
        aria-hidden="true"
      />

      {/* Dialog */}
      <form
        onSubmit={handleSave}
        className="relative z-10 w-full max-w-2xl max-h-[90dvh] bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Drag Handle Mobile */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300" aria-hidden="true" />
        </div>

        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-5 h-5 text-[#059669]" />
            </div>
            <div className="min-w-0">
              <h2
                id="brand-settings-title"
                className="text-base sm:text-lg font-bold text-[#0F172A] tracking-tight"
              >
                Pengaturan Nama, Logo &amp; WA Pengurus
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Atur identitas aplikasi dan pisahkan nomor WhatsApp Pengurus dari nomor Bot WA.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={saving || uploadingLogo}
            onClick={onClose}
            aria-label="Tutup Pengaturan Aplikasi"
            className="min-h-[40px] min-w-[40px] rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 sm:px-6 pt-3 pb-3 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div role="tablist" className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-xl">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'brand'}
              onClick={() => setActiveTab('brand')}
              className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'brand'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <Sparkles
                className={`w-3.5 h-3.5 ${activeTab === 'brand' ? 'text-[#059669]' : 'text-slate-500'}`}
              />
              <span>Nama &amp; Logo</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'wa'}
              onClick={() => setActiveTab('wa')}
              className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'wa'
                  ? 'bg-white text-[#0F172A] shadow-sm'
                  : 'text-slate-600 hover:text-[#0F172A]'
              }`}
            >
              <Phone
                className={`w-3.5 h-3.5 ${activeTab === 'wa' ? 'text-[#059669]' : 'text-slate-500'}`}
              />
              <span>No. WA Pengurus &amp; Bot</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          {!canEdit && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 text-xs text-amber-900">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Mode lihat saja. Pengubahan nama aplikasi, logo, dan nomor WhatsApp pengurus khusus
                untuk akun <strong>Bendahara</strong> (akses penuh).
              </span>
            </div>
          )}

          {activeTab === 'brand' ? (
            <>
              {/* Pratinjau Langsung Header Gelap & Kartu Terang */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600">Pratinjau Tampilan Langsung</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl bg-[#0F172A] p-4 border border-slate-800 flex items-center gap-3">
                    <BrandLogo
                      size="md"
                      srcOverride={draft.logo_url}
                      altOverride={`Pratinjau Logo ${draft.app_name}`}
                      className="border-white/15"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">
                        {draft.app_name.trim() || DEFAULT_APP_BRAND_CONFIG.app_name}
                      </p>
                      <p className="text-xs text-emerald-400 truncate mt-0.5">
                        {draft.app_subtitle.trim() || DEFAULT_APP_BRAND_CONFIG.app_subtitle}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-200 flex items-center gap-3">
                    <BrandLogo
                      size="md"
                      srcOverride={draft.logo_url}
                      altOverride={`Pratinjau Logo ${draft.app_name}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#0F172A] truncate">
                        {draft.app_name.trim() || DEFAULT_APP_BRAND_CONFIG.app_name}
                      </p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        {draft.app_subtitle.trim() || DEFAULT_APP_BRAND_CONFIG.app_subtitle}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Unggah Logo */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                <div className="flex items-center gap-3 min-w-0">
                  <BrandLogo
                    size="lg"
                    srcOverride={draft.logo_url}
                    altOverride={`Logo ${draft.app_name}`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F172A] flex items-center gap-1.5">
                      <ImageIcon className="w-4 h-4 text-[#059669] shrink-0" />
                      <span>Logo Aplikasi</span>
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      Format PNG (disarankan transparan), JPG, WebP, atau SVG. Otomatis dioptimalkan
                      agar tajam dan cepat dimuat di iOS, Android, dan browser desktop.
                    </p>
                    <p className="text-[11px] font-medium text-emerald-700 mt-1 inline-flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {draft.logo_url ? 'Menggunakan logo kustom' : 'Menggunakan logo bawaan'}
                      </span>
                    </p>
                  </div>
                </div>

                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleUploadLogo}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingLogo || saving}
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[42px] px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      {uploadingLogo ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Mengunggah Logo...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          <span>{draft.logo_url ? 'Ganti Logo' : 'Unggah Logo Baru'}</span>
                        </>
                      )}
                    </button>

                    {draft.logo_url && (
                      <button
                        type="button"
                        disabled={uploadingLogo || saving}
                        onClick={handleResetLogoOnly}
                        className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Gunakan Logo Bawaan</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Input Nama Aplikasi & Keterangan */}
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="brand-app-name"
                    className="block text-sm font-semibold text-[#0F172A] mb-1.5"
                  >
                    Nama Aplikasi
                  </label>
                  <input
                    id="brand-app-name"
                    type="text"
                    required
                    maxLength={60}
                    disabled={!canEdit || saving}
                    value={draft.app_name}
                    onChange={(e) => setDraft((prev) => ({ ...prev, app_name: e.target.value }))}
                    placeholder="Contoh: e-Card Verifikasi"
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="brand-app-subtitle"
                    className="block text-sm font-semibold text-[#0F172A] mb-1.5"
                  >
                    Sub-Nama / Nama Perumahan
                  </label>
                  <input
                    id="brand-app-subtitle"
                    type="text"
                    required
                    maxLength={90}
                    disabled={!canEdit || saving}
                    value={draft.app_subtitle}
                    onChange={(e) => setDraft((prev) => ({ ...prev, app_subtitle: e.target.value }))}
                    placeholder="Contoh: IPL Digital — Perumahan Saung Kebun"
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-4 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                </div>

                <div>
                  <label
                    htmlFor="brand-kop-resmi"
                    className="block text-sm font-semibold text-[#0F172A] mb-1.5"
                  >
                    Kop Resmi / Alamat Sekretariat
                  </label>
                  <textarea
                    id="brand-kop-resmi"
                    rows={2}
                    maxLength={220}
                    disabled={!canEdit || saving}
                    value={draft.kop_resmi}
                    onChange={(e) => setDraft((prev) => ({ ...prev, kop_resmi: e.target.value }))}
                    placeholder="Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-100 disabled:text-slate-500 resize-none"
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              {isSameAsBot && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-xs text-red-800"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>
                    <strong>Nomor WA Pengurus sama dengan Nomor WA Bot.</strong> Gunakan nomor WA
                    pribadi/resmi pengurus agar saat warga klik tombol{' '}
                    <em>Hubungi Pengurus via WhatsApp</em> tidak diarahkan ke nomor Bot otomatis.
                  </span>
                </div>
              )}

              {/* Bagian 1: Nomor WA Utama Pengurus (Bukan Bot) */}
              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-4">
                <div>
                  <p className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                    <Phone className="w-4 h-4 text-[#059669]" />
                    <span>Nomor WhatsApp Pengurus (Bukan Nomor Bot)</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Nomor ini dituju langsung ketika warga menekan tombol{' '}
                    <strong>Hubungi Pengurus via WhatsApp</strong> di halaman Profil &amp; Akun.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="wa-pengurus-utama"
                      className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                    >
                      Nomor WA Utama Pengurus
                    </label>
                    <input
                      id="wa-pengurus-utama"
                      type="tel"
                      inputMode="tel"
                      required
                      disabled={!canEdit || saving}
                      value={draft.wa_pengurus}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, wa_pengurus: e.target.value }))
                      }
                      placeholder="Contoh: 081234567890"
                      className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-mono text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                    {normWaPengurus && (
                      <p className="text-[11px] font-mono text-emerald-700 mt-1">
                        Tujuan WA: +{normWaPengurus}
                      </p>
                    )}
                  </div>

                  <div>
                    <label
                      htmlFor="wa-pengurus-label"
                      className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                    >
                      Nama / Jabatan Penerima
                    </label>
                    <input
                      id="wa-pengurus-label"
                      type="text"
                      maxLength={60}
                      disabled={!canEdit || saving}
                      value={draft.wa_pengurus_label}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, wa_pengurus_label: e.target.value }))
                      }
                      placeholder="Contoh: Andriansyah (Bendahara)"
                      className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </div>
                </div>
              </div>

              {/* Bagian 2: Nomor WA Masing-Masing Pengurus (Profil Lingkungan) */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <div>
                  <p className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#059669]" />
                    <span>Nomor WA per Pengurus (Halaman Profil Lingkungan)</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Opsional. Jika dikosongkan, tombol WhatsApp pengurus tersebut akan otomatis
                    diarahkan ke Nomor WA Utama Pengurus di atas (tetap bukan nomor bot).
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {SUSUNAN_PENGURUS.map((p) => (
                    <div key={p.username}>
                      <label
                        htmlFor={`wa-pengurus-${p.username}`}
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
                        {p.nama}{' '}
                        <span className="font-normal text-slate-500">
                          ({p.jabatan} · {p.blokRumah})
                        </span>
                      </label>
                      <input
                        id={`wa-pengurus-${p.username}`}
                        type="tel"
                        inputMode="tel"
                        disabled={!canEdit || saving}
                        value={draft.pengurus_wa_map?.[p.username] || ''}
                        onChange={(e) => handlePengurusWaChange(p.username, e.target.value)}
                        placeholder={`Default: +${normWaPengurus || '628...'}`}
                        className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-mono text-[#0F172A] placeholder:text-slate-400 focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-emerald-600/20 disabled:bg-slate-100 disabled:text-slate-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Bagian 3: Nomor WA Khusus Bot Otomatis (Terpisah) */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3">
                <div>
                  <p className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
                    <Bot className="w-4 h-4 text-slate-700" />
                    <span>Nomor WhatsApp Khusus Bot Otomatis (Terpisah)</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                    Nomor WA perangkat yang terhubung di Fonnte/Wablas. Hanya digunakan di modal{' '}
                    <strong>Panduan Bot WA Warga</strong> untuk perintah otomatis{' '}
                    <span className="font-mono">CEK#</span>,{' '}
                    <span className="font-mono">SALDO#</span>, dan{' '}
                    <span className="font-mono">VERIFIKASI#</span>.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="wa-bot-khusus"
                    className="block text-xs font-semibold text-[#0F172A] mb-1.5"
                  >
                    Nomor WA Bot Otomatis (Opsional)
                  </label>
                  <input
                    id="wa-bot-khusus"
                    type="tel"
                    inputMode="tel"
                    disabled={!canEdit || saving}
                    value={draft.wa_bot}
                    onChange={(e) => setDraft((prev) => ({ ...prev, wa_bot: e.target.value }))}
                    placeholder="Masukkan nomor HP yang dipakai Bot Fonnte (contoh: 0851xxxx)"
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-mono text-[#0F172A] placeholder:text-slate-400 focus:border-[#0F172A] focus:outline-none focus:ring-2 focus:ring-slate-900/15 disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  {normWaBot && (
                    <p className="text-[11px] font-mono text-slate-600 mt-1">
                      Tujuan Bot Otomatis: +{normWaBot}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-4 bg-slate-50 border-t border-slate-200 pb-safe flex flex-wrap items-center justify-between gap-2 shrink-0">
          {canEdit ? (
            <button
              type="button"
              disabled={saving || uploadingLogo}
              onClick={handleResetAllDefault}
              className="min-h-[42px] px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={saving || uploadingLogo}
              onClick={onClose}
              className="min-h-[42px] px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
            >
              Tutup
            </button>
            {canEdit && (
              <button
                type="submit"
                disabled={saving || uploadingLogo || isSameAsBot}
                className="min-h-[42px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Menyimpan...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    <span>Simpan Pengaturan</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
