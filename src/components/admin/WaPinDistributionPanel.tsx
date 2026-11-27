import React, { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  RotateCcw,
  Send,
  Shield,
  ShieldCheck,
  Square,
  Users,
  XCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Icon3D } from '../Icon3D';
import {
  APP_ADMIN_PORTAL_URL,
  APP_PETUGAS_PORTAL_URL,
  APP_PORTAL_URL,
  resolveOccupancyStatus,
  SUSUNAN_PENGURUS,
  WA_PIN_KEAMANAN_TEMPLATE_DEFAULT,
  WA_PIN_PENGURUS_TEMPLATE_DEFAULT,
  WA_PIN_WARGA_TEMPLATE_DEFAULT,
  type BotWaConfig,
  type PengurusAccountInfo,
  type PetugasKeamanan,
  type SessionUser,
  type Warga,
} from '../../types';
import {
  compareBlokRumah,
  formatBlokRumah,
  isRealRegisteredPhone,
  normalizePhoneNumber,
} from '../../lib/format';
import {
  recordWaPinBatchAuditAdmin,
  sendSingleCredentialWaAdmin,
} from '../../lib/dataService';
import { useAppBrand } from '../../lib/brandContext';

export type PinCategory = 'warga' | 'pengurus' | 'keamanan';

type RowDeliveryState =
  | { status: 'idle'; detail?: string }
  | { status: 'sending'; detail?: string }
  | { status: 'sent'; detail?: string }
  | { status: 'failed'; detail?: string };

interface PinRecipientRow {
  id: string;
  category: PinCategory;
  nama: string;
  blok: string;
  jabatan: string;
  username: string;
  pin: string;
  noWaRaw: string;
  noWaNormalized: string;
  hasValidWa: boolean;
  link: string;
}

interface WaPinDistributionPanelProps {
  session: SessionUser;
  botConfig: BotWaConfig;
  wargaList: Warga[];
  pengurusAccounts?: PengurusAccountInfo[];
  petugasList?: PetugasKeamanan[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const ANTI_SPAM_DELAY_MS = 2500;

const PIN_PLACEHOLDER_CHIPS = [
  '{nama}',
  '{blok}',
  '{jabatan}',
  '{pin}',
  '{link}',
  '{username}',
] as const;

const DEFAULT_TEMPLATES: Record<PinCategory, string> = {
  warga: WA_PIN_WARGA_TEMPLATE_DEFAULT,
  pengurus: WA_PIN_PENGURUS_TEMPLATE_DEFAULT,
  keamanan: WA_PIN_KEAMANAN_TEMPLATE_DEFAULT,
};

function renderCredentialMessage(template: string, row: PinRecipientRow): string {
  return template
    .replaceAll('{nama}', row.nama)
    .replaceAll('{nama_warga}', row.nama)
    .replaceAll('{nama_pengurus}', row.nama)
    .replaceAll('{blok}', row.blok)
    .replaceAll('{blok_rumah}', row.blok)
    .replaceAll('{jabatan}', row.jabatan)
    .replaceAll('{username}', row.username)
    .replaceAll('{username_pengurus}', row.username)
    .replaceAll('{pin}', row.pin || '(PIN belum tersedia)')
    .replaceAll('{pin_akses}', row.pin || '(PIN belum tersedia)')
    .replaceAll('{pin_pengurus}', row.pin || '(PIN belum tersedia)')
    .replaceAll('{link}', row.link)
    .replaceAll('{link_aplikasi}', APP_PORTAL_URL)
    .replaceAll('{link_admin}', APP_ADMIN_PORTAL_URL);
}

function sleepWithAbort(ms: number, shouldAbort: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const stepMs = 200;
    let elapsed = 0;
    const timer = window.setInterval(() => {
      elapsed += stepMs;
      if (shouldAbort()) {
        window.clearInterval(timer);
        resolve(false);
        return;
      }
      if (elapsed >= ms) {
        window.clearInterval(timer);
        resolve(true);
      }
    }, stepMs);
  });
}

export function WaPinDistributionPanel({
  session,
  botConfig,
  wargaList,
  pengurusAccounts = [],
  petugasList = [],
  onRefresh,
  onToast,
}: WaPinDistributionPanelProps) {
  const { brand } = useAppBrand();
  const isActivePengurus =
    session.role === 'admin' && session.is_active_pengurus !== false;

  const [category, setCategory] = useState<PinCategory>('warga');
  const [search, setSearch] = useState('');
  const [showPins, setShowPins] = useState(true);
  const [templates, setTemplates] = useState<Record<PinCategory, string>>(DEFAULT_TEMPLATES);
  const [selectedIdsByCat, setSelectedIdsByCat] = useState<Record<PinCategory, string[]>>({
    warga: [],
    pengurus: [],
    keamanan: [],
  });
  const [deliveryMap, setDeliveryMap] = useState<Record<string, RowDeliveryState>>({});
  const [singleSendingId, setSingleSendingId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    running: boolean;
    current: number;
    total: number;
    sent: number;
    failed: number;
    category: PinCategory | null;
  }>({
    running: false,
    current: 0,
    total: 0,
    sent: 0,
    failed: 0,
    category: null,
  });
  const cancelBulkRef = useRef(false);

  // 1. Daftar Warga Berpenghuni Berurutan (Lewati UNIT KOSONG)
  const wargaRows = useMemo<PinRecipientRow[]>(() => {
    return [...wargaList]
      .filter((w) => w.aktif && resolveOccupancyStatus(w) !== 'kosong')
      .sort((a, b) => compareBlokRumah(a.blok_rumah, b.blok_rumah))
      .map((w) => {
        const displayBlok = formatBlokRumah(w.blok_rumah) || w.blok_rumah;
        const normalized = normalizePhoneNumber(w.no_wa);
        return {
          id: `warga:${w.id}`,
          category: 'warga',
          nama: w.nama_warga,
          blok: displayBlok,
          jabatan: w.status_hunian === 'Kontrak' ? 'Warga Kontrak' : 'Kepala Keluarga',
          username: displayBlok,
          pin: w.pin_akses || '',
          noWaRaw: w.no_wa || '',
          noWaNormalized: normalized,
          hasValidWa: isRealRegisteredPhone(normalized),
          link: APP_PORTAL_URL,
        };
      });
  }, [wargaList]);

  // 2. Daftar Admin / Pengurus Aktif
  const pengurusRows = useMemo<PinRecipientRow[]>(() => {
    return SUSUNAN_PENGURUS.filter((p) => {
      const acc = pengurusAccounts.find(
        (a) => a.username.toLowerCase() === p.username.toLowerCase()
      );
      return acc?.aktif !== false && acc?.is_active_pengurus !== false;
    }).map((p) => {
      const acc = pengurusAccounts.find(
        (a) => a.username.toLowerCase() === p.username.toLowerCase()
      );
      const rawWa = brand.pengurus_wa_map?.[p.username] || acc?.no_wa || '';
      const normalized = normalizePhoneNumber(rawWa);
      const displayBlok = formatBlokRumah(p.blokRumah) || p.blokRumah;
      return {
        id: `pengurus:${p.username}`,
        category: 'pengurus',
        nama: p.nama,
        blok: displayBlok,
        jabatan: p.jabatan,
        username: p.username,
        pin: acc?.pin_akses || '',
        noWaRaw: rawWa,
        noWaNormalized: normalized,
        hasValidWa: isRealRegisteredPhone(normalized),
        link: APP_ADMIN_PORTAL_URL,
      };
    });
  }, [pengurusAccounts, brand.pengurus_wa_map]);

  // 3. Daftar Anggota Keamanan Aktif
  const keamananRows = useMemo<PinRecipientRow[]>(() => {
    return [...petugasList]
      .filter((pt) => pt.aktif !== false)
      .sort((a, b) => a.nama.localeCompare(b.nama, 'id'))
      .map((pt) => {
        const normalized = normalizePhoneNumber(pt.no_hp);
        return {
          id: `keamanan:${pt.id}`,
          category: 'keamanan',
          nama: pt.nama,
          blok: pt.shift || 'Pos Utama',
          jabatan: `Anggota Keamanan · ${pt.shift || 'Siaga'}`,
          username: pt.username || pt.nama,
          pin: pt.pin || '',
          noWaRaw: pt.no_hp || '',
          noWaNormalized: normalized,
          hasValidWa: isRealRegisteredPhone(normalized),
          link: APP_PETUGAS_PORTAL_URL,
        };
      });
  }, [petugasList]);

  const activeCategoryRows =
    category === 'warga'
      ? wargaRows
      : category === 'pengurus'
        ? pengurusRows
        : keamananRows;

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeCategoryRows;
    return activeCategoryRows.filter(
      (r) =>
        r.nama.toLowerCase().includes(q) ||
        r.blok.toLowerCase().includes(q) ||
        r.jabatan.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        r.noWaNormalized.includes(q)
    );
  }, [activeCategoryRows, search]);

  const validFilteredRows = useMemo(
    () => filteredRows.filter((r) => r.hasValidWa && Boolean(r.pin)),
    [filteredRows]
  );

  const selectedIds = selectedIdsByCat[category] || [];
  const selectedValidRows = useMemo(
    () => activeCategoryRows.filter((r) => selectedIds.includes(r.id) && r.hasValidWa && Boolean(r.pin)),
    [activeCategoryRows, selectedIds]
  );

  const sampleRecipient =
    selectedValidRows[0] || validFilteredRows[0] || activeCategoryRows[0] || null;
  const activeTemplate = templates[category];
  const livePreviewText = sampleRecipient
    ? renderCredentialMessage(activeTemplate, sampleRecipient)
    : activeTemplate;

  const isBusy = bulkProgress.running || Boolean(singleSendingId);

  const toggleSelectRow = (id: string) => {
    if (isBusy) return;
    setSelectedIdsByCat((prev) => {
      const current = prev[category] || [];
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      return { ...prev, [category]: next };
    });
  };

  const handleToggleSelectAllValid = () => {
    if (isBusy) return;
    const validIds = validFilteredRows.map((r) => r.id);
    const allSelected =
      validIds.length > 0 && validIds.every((id) => selectedIds.includes(id));
    setSelectedIdsByCat((prev) => ({
      ...prev,
      [category]: allSelected
        ? (prev[category] || []).filter((id) => !validIds.includes(id))
        : Array.from(new Set([...(prev[category] || []), ...validIds])),
    }));
  };

  const handleInsertChip = (chip: string) => {
    setTemplates((prev) => ({
      ...prev,
      [category]: `${prev[category]}${prev[category].endsWith(' ') || prev[category].endsWith('\n') ? '' : ' '}${chip}`,
    }));
  };

  const handleSingleSend = async (row: PinRecipientRow) => {
    if (!isActivePengurus || isBusy) return;
    if (!row.hasValidWa) {
      onToast('error', `Nomor WhatsApp ${row.nama} kosong atau belum valid.`);
      return;
    }
    if (!row.pin) {
      onToast('error', `PIN untuk ${row.nama} belum tersedia di sesi ini.`);
      return;
    }
    if (!botConfig.api_token.trim()) {
      onToast('error', 'Masukkan dan simpan API Token Fonnte / Wablas terlebih dahulu.');
      return;
    }

    setSingleSendingId(row.id);
    setDeliveryMap((prev) => ({ ...prev, [row.id]: { status: 'sending' } }));

    try {
      const message = renderCredentialMessage(activeTemplate, row);
      const logLabel =
        row.category === 'warga'
          ? 'Info Akun & PIN Warga'
          : row.category === 'pengurus'
            ? 'Info Akun & PIN Pengurus'
            : 'Info Akun & PIN Keamanan';

      const res = await sendSingleCredentialWaAdmin(session, botConfig, {
        category: row.category,
        kodeBlokAtauId: row.category === 'warga' ? row.blok : row.username,
        namaPenerima: row.nama,
        noWa: row.noWaNormalized,
        pesan: message,
        logLabel,
      });

      if (res.error || !res.data || res.data.status_kirim === 'Gagal') {
        const errMsg = res.error || res.data?.respon_gateway || 'Gagal mengirim pesan';
        setDeliveryMap((prev) => ({
          ...prev,
          [row.id]: { status: 'failed', detail: errMsg },
        }));
        onToast('error', `Gagal mengirim ke ${row.nama}: ${errMsg}`);
      } else {
        setDeliveryMap((prev) => ({
          ...prev,
          [row.id]: { status: 'sent', detail: res.data?.respon_gateway },
        }));
        onToast('success', `Info akun & PIN terkirim ke ${row.nama} (+${res.data.no_wa}).`);
        await onRefresh();
      }
    } finally {
      setSingleSendingId(null);
    }
  };

  const handleBulkSend = async () => {
    if (!isActivePengurus || isBusy) return;
    if (selectedValidRows.length === 0) {
      onToast('error', 'Centang minimal 1 penerima dengan nomor WA dan PIN yang valid.');
      return;
    }
    if (!botConfig.api_token.trim()) {
      onToast('error', 'Masukkan dan simpan API Token Fonnte / Wablas terlebih dahulu.');
      return;
    }

    const targets = [...selectedValidRows];
    const currentCat = category;
    cancelBulkRef.current = false;

    setBulkProgress({
      running: true,
      current: 0,
      total: targets.length,
      sent: 0,
      failed: 0,
      category: currentCat,
    });

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < targets.length; i += 1) {
      if (cancelBulkRef.current) break;

      const row = targets[i];
      setDeliveryMap((prev) => ({ ...prev, [row.id]: { status: 'sending' } }));
      setBulkProgress({
        running: true,
        current: i + 1,
        total: targets.length,
        sent: sentCount,
        failed: failedCount,
        category: currentCat,
      });

      const message = renderCredentialMessage(templates[currentCat], row);
      const logLabel =
        row.category === 'warga'
          ? 'Info Akun & PIN Warga (Massal)'
          : row.category === 'pengurus'
            ? 'Info Akun & PIN Pengurus (Massal)'
            : 'Info Akun & PIN Keamanan (Massal)';

      const res = await sendSingleCredentialWaAdmin(session, botConfig, {
        category: row.category,
        kodeBlokAtauId: row.category === 'warga' ? row.blok : row.username,
        namaPenerima: row.nama,
        noWa: row.noWaNormalized,
        pesan: message,
        logLabel,
      });

      if (!res.error && res.data?.status_kirim === 'Terkirim') {
        sentCount += 1;
        setDeliveryMap((prev) => ({
          ...prev,
          [row.id]: { status: 'sent', detail: res.data?.respon_gateway },
        }));
      } else {
        failedCount += 1;
        setDeliveryMap((prev) => ({
          ...prev,
          [row.id]: {
            status: 'failed',
            detail: res.error || res.data?.respon_gateway || 'Gagal kirim',
          },
        }));
      }

      setBulkProgress({
        running: true,
        current: i + 1,
        total: targets.length,
        sent: sentCount,
        failed: failedCount,
        category: currentCat,
      });

      if (i < targets.length - 1 && !cancelBulkRef.current) {
        const continued = await sleepWithAbort(
          ANTI_SPAM_DELAY_MS,
          () => cancelBulkRef.current
        );
        if (!continued) break;
      }
    }

    const wasCancelled = cancelBulkRef.current;
    await recordWaPinBatchAuditAdmin(session, {
      category: currentCat,
      provider: botConfig.provider,
      total: targets.length,
      sent: sentCount,
      failed: failedCount,
      cancelled: wasCancelled,
    });

    setBulkProgress({
      running: false,
      current: 0,
      total: 0,
      sent: sentCount,
      failed: failedCount,
      category: null,
    });

    await onRefresh();

    if (wasCancelled) {
      onToast(
        'info',
        `Pengiriman massal dihentikan: ${sentCount} terkirim, ${failedCount} gagal.`
      );
    } else if (sentCount > 0 && failedCount === 0) {
      onToast(
        'success',
        `Selesai mengirim info akun & PIN via ${botConfig.provider} ke ${sentCount} penerima.`
      );
    } else if (sentCount > 0) {
      onToast(
        'info',
        `Selesai: ${sentCount} terkirim, ${failedCount} gagal. Cek status per baris.`
      );
    } else {
      onToast('error', `Semua pengiriman (${failedCount}) gagal. Periksa API Token Fonnte.`);
    }
  };

  if (!isActivePengurus) {
    return null;
  }

  const totalValidInCategory = activeCategoryRows.filter((r) => r.hasValidWa && r.pin).length;
  const missingWaCount = activeCategoryRows.filter((r) => !r.hasValidWa).length;

  return (
    <section
      aria-label="Kirim Informasi Akun dan PIN via WhatsApp Fonnte"
      className="glass-card bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#E6E2D6] bg-[#F7F4EC]/75 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Icon3D name="ganti_pin" className="w-10 h-10 shrink-0 shadow-xs" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[#1B271B]">
              Kirim Informasi Akun &amp; PIN via WhatsApp ({botConfig.provider})
            </h2>
            <p className="text-xs text-[#4A554A] mt-0.5 leading-relaxed">
              Pilih kategori penerima (Warga, Pengurus, atau Keamanan), sesuaikan template pesan,
              lalu kirim satuan atau massal dengan jeda aman anti-spam 2,5 detik per pesan.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowPins((v) => !v)}
          className="min-h-[38px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-xs font-semibold text-[#1B271B] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 self-start sm:self-center transition-colors"
        >
          {showPins ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{showPins ? 'Sembunyikan PIN' : 'Tampilkan PIN'}</span>
        </button>
      </div>

      <div className="p-5 space-y-5">
        {/* 3 Opsi Kategori Terpisah */}
        <div
          role="tablist"
          aria-label="Kategori Penerima Info Akun dan PIN"
          className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-1.5 bg-[#F6F3EA] border border-[#E6E2D6] rounded-2xl"
        >
          {(
            [
              {
                id: 'warga' as const,
                label: '1. Warga (Per Blok)',
                sub: `${wargaRows.length} unit berpenghuni`,
                icon: Users,
              },
              {
                id: 'pengurus' as const,
                label: '2. Admin / Pengurus',
                sub: `${pengurusRows.length} pengurus aktif`,
                icon: ShieldCheck,
              },
              {
                id: 'keamanan' as const,
                label: '3. Anggota Keamanan',
                sub: `${keamananRows.length} petugas aktif`,
                icon: Shield,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = category === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={bulkProgress.running}
                onClick={() => {
                  setCategory(tab.id);
                  setSearch('');
                }}
                className={`min-h-[48px] px-3 py-2 rounded-xl text-left flex items-center gap-2.5 transition-all cursor-pointer disabled:opacity-60 ${
                  active
                    ? 'bg-[#2B3F29] text-white shadow-sm'
                    : 'bg-[#FFFDF8] text-[#4A554A] hover:bg-[#E5EEE3]/60 hover:text-[#243825]'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    active ? 'text-[#E5EEE3]' : 'text-[#2B3F29]'
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-xs font-bold leading-tight truncate">{tab.label}</p>
                  <p
                    className={`text-[11px] leading-tight mt-0.5 tabular-nums ${
                      active ? 'text-[#E5EEE3]/90' : 'text-[#6E786D]'
                    }`}
                  >
                    {tab.sub}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Editor Template & Live Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-7 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-bold text-[#1B271B]">
                Template Pesan Kategori{' '}
                {category === 'warga'
                  ? 'Warga'
                  : category === 'pengurus'
                    ? 'Admin / Pengurus'
                    : 'Anggota Keamanan'}
              </label>
              <button
                type="button"
                onClick={() =>
                  setTemplates((prev) => ({
                    ...prev,
                    [category]: DEFAULT_TEMPLATES[category],
                  }))
                }
                className="min-h-[30px] px-2.5 rounded-lg border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 text-[11px] font-semibold text-[#4A554A] inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Template</span>
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PIN_PLACEHOLDER_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleInsertChip(chip)}
                  className="min-h-[30px] px-2.5 rounded-lg border border-[#C6D2BF] bg-[#E5EEE3]/60 hover:bg-[#E5EEE3] text-[11px] font-mono text-[#243825] cursor-pointer transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>

            <textarea
              rows={8}
              value={activeTemplate}
              onChange={(e) =>
                setTemplates((prev) => ({
                  ...prev,
                  [category]: e.target.value,
                }))
              }
              className="w-full rounded-2xl border border-[#D9D4C5] bg-[#FFFDF8] p-3 text-xs sm:text-sm text-[#1B271B] leading-relaxed focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
            />
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-[#E6E2D6] bg-[#F6F3EA]/70 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-[#1B271B] flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-[#2B3F29]" />
                <span>Pratinjau Pesan Langsung</span>
              </p>
              {sampleRecipient && (
                <span className="text-[11px] font-mono text-[#6E786D] truncate max-w-[160px]">
                  {sampleRecipient.nama}
                </span>
              )}
            </div>
            <div className="rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] p-3 text-xs text-[#1B271B] whitespace-pre-line leading-relaxed max-h-[220px] overflow-y-auto">
              {livePreviewText}
            </div>
          </div>
        </div>

        {/* Toolbar Pencarian, Ringkasan & Kirim Massal */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-[#E6E2D6]">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            <div className="relative flex-1 min-w-[210px] max-w-sm">
              <Icon3D name="cari" className="w-4 h-4 rounded-sm absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  category === 'warga'
                    ? 'Cari blok (mis. B03/01) atau nama warga...'
                    : category === 'pengurus'
                      ? 'Cari nama atau jabatan pengurus...'
                      : 'Cari nama petugas keamanan...'
                }
                className="w-full min-h-[40px] rounded-full border border-[#D9D4C5] bg-[#FFFDF8] pl-9 pr-3.5 text-xs text-[#1B271B] focus:border-[#2B3F29] focus:outline-none focus:ring-2 focus:ring-[#2B3F29]/15"
              />
            </div>

            <button
              type="button"
              disabled={isBusy || validFilteredRows.length === 0}
              onClick={handleToggleSelectAllValid}
              className="min-h-[40px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#E5EEE3]/60 disabled:opacity-50 text-xs font-semibold text-[#1B271B] cursor-pointer whitespace-nowrap transition-colors"
            >
              {validFilteredRows.length > 0 &&
              validFilteredRows.every((r) => selectedIds.includes(r.id))
                ? 'Batalkan Semua'
                : `Pilih Semua Valid (${validFilteredRows.length})`}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-[11px] text-[#6E786D] tabular-nums">
              {totalValidInCategory} siap kirim
              {missingWaCount > 0 ? ` · ${missingWaCount} WA kosong` : ''}
            </span>

            {bulkProgress.running ? (
              <button
                type="button"
                onClick={() => {
                  cancelBulkRef.current = true;
                }}
                className="min-h-[42px] px-4 rounded-full bg-[#C87058] hover:bg-[#B25C45] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Hentikan Pengiriman</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={selectedValidRows.length === 0 || isBusy}
                onClick={() => void handleBulkSend()}
                className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap shadow-xs transition-colors"
              >
                <Send className="w-3.5 h-3.5 text-[#E5EEE3]" />
                <span>
                  Kirim Massal Kategori Terpilih ({selectedValidRows.length})
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Indikator Progres Pengiriman Massal */}
        {bulkProgress.running && (
          <div className="rounded-2xl border border-[#C6D2BF] bg-[#E5EEE3]/65 p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[#1B271B] tabular-nums">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-[#2B3F29]" />
                <span>
                  Mengirim {bulkProgress.current} / {bulkProgress.total} pesan (jeda anti-spam 2,5 detik)...
                </span>
              </span>
              <span>
                Terkirim: {bulkProgress.sent} · Gagal: {bulkProgress.failed}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[#FFFDF8] overflow-hidden border border-[#C6D2BF]">
              <div
                className="h-full bg-[#2B3F29] transition-all duration-300"
                style={{
                  width: `${
                    bulkProgress.total > 0
                      ? Math.round((bulkProgress.current / bulkProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {/* Tabel Daftar Penerima Per Kategori */}
        <div className="overflow-x-auto rounded-2xl border border-[#E6E2D6] bg-[#FFFDF8]">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#F6F3EA] border-b border-[#E6E2D6] text-[11px] font-semibold text-[#243825]">
                <th className="py-2.5 px-3 w-10 text-center">Pilih</th>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  {category === 'warga'
                    ? 'Blok'
                    : category === 'pengurus'
                      ? 'Jabatan'
                      : 'Shift / Area'}
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">
                  {category === 'warga'
                    ? 'Kepala Keluarga'
                    : category === 'pengurus'
                      ? 'Nama & Username'
                      : 'Nama Petugas'}
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">No. WhatsApp</th>
                <th className="py-2.5 px-3 whitespace-nowrap">PIN 6 Digit</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Status Kirim</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6E2D6] text-xs">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[#6E786D]">
                    Tidak ada penerima aktif pada kategori ini yang cocok dengan pencarian.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const checked = selectedIds.includes(row.id);
                  const deliv = deliveryMap[row.id] || { status: 'idle' };
                  const rowDisabled = !row.hasValidWa || !row.pin;

                  return (
                    <tr key={row.id} className="hover:bg-[#F6F3EA]/60 transition-colors">
                      <td className="py-2.5 px-3 text-center">
                        <input
                          type="checkbox"
                          disabled={rowDisabled || isBusy}
                          checked={checked}
                          onChange={() => toggleSelectRow(row.id)}
                          aria-label={`Pilih ${row.nama}`}
                          className="w-4 h-4 rounded accent-[#2B3F29] cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#1B271B] whitespace-nowrap tabular-nums">
                        {row.category === 'warga' ? row.blok : row.jabatan}
                      </td>
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-[#1B271B]">{row.nama}</p>
                        {row.category !== 'warga' && (
                          <p className="text-[11px] font-mono text-[#6E786D]">
                            User: {row.username}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                        {row.hasValidWa ? (
                          <span className="text-[#4A554A]">+{row.noWaNormalized}</span>
                        ) : (
                          <span className="text-[#8A5F16] font-sans font-medium">
                            No. WA Kosong
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold tabular-nums whitespace-nowrap">
                        {row.pin ? (
                          showPins ? (
                            <span className="text-[#243825]">{row.pin}</span>
                          ) : (
                            <span className="text-[#6E786D]">••••••</span>
                          )
                        ) : (
                          <span className="text-[#6E786D] font-sans font-normal">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {!row.hasValidWa ? (
                          <span className="text-[11px] font-semibold text-[#8A5F16]">
                            No. WA Kosong
                          </span>
                        ) : deliv.status === 'sending' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2B3F29]">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Mengirim...</span>
                          </span>
                        ) : deliv.status === 'sent' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#243825]">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Terkirim</span>
                          </span>
                        ) : deliv.status === 'failed' ? (
                          <span
                            title={deliv.detail}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#7A311E]"
                          >
                            <XCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>Gagal</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#6E786D]">Siap Kirim</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={rowDisabled || isBusy}
                          onClick={() => void handleSingleSend(row)}
                          className="min-h-[34px] px-3 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] disabled:opacity-45 disabled:cursor-not-allowed text-[#243825] text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {singleSendingId === row.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Send className="w-3 h-3" />
                          )}
                          <span>Kirim Satuan</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
