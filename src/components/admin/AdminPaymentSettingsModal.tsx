import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  QrCode,
  CreditCard,
  Users,
  Upload,
  Trash2,
  Plus,
  Save,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  Copy,
  Check,
  MessageCircle,
} from 'lucide-react';
import {
  APP_ADMIN_PORTAL_URL,
  isBendaharaFullAccess,
  SUSUNAN_PENGURUS,
  type PaymentConfig,
  type PengurusAccountInfo,
  type RekeningPembayaran,
  type SessionUser,
} from '../../types';
import { compressProofImage } from '../../lib/imageCompressor';
import { savePaymentConfigAdmin, uploadQrisImageAdmin } from '../../lib/dataService';
import { useAppBrand } from '../../lib/brandContext';
import {
  buildPengurusAccessWaMessage,
  buildWhatsAppLink,
  copyToClipboard,
} from '../../lib/format';

interface AdminPaymentSettingsModalProps {
  open: boolean;
  session: SessionUser;
  paymentConfig: PaymentConfig;
  pengurusAccounts?: PengurusAccountInfo[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

type SettingsTab = 'qris' | 'rekening' | 'pengurus';

export function AdminPaymentSettingsModal({
  open,
  session,
  paymentConfig,
  pengurusAccounts,
  onClose,
  onSaved,
  onToast,
}: AdminPaymentSettingsModalProps) {
  const { brand } = useAppBrand();
  const canEdit = isBendaharaFullAccess(session);
  const [activeTab, setActiveTab] = useState<SettingsTab>('qris');
  const [draft, setDraft] = useState<PaymentConfig>(paymentConfig);
  const [uploadingQris, setUploadingQris] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedUser, setCopiedUser] = useState<string | null>(null);

  // Form tambah rekening baru (Khusus Bendahara)
  const [newBank, setNewBank] = useState('');
  const [newNomor, setNewNomor] = useState('');
  const [newAtasNama, setNewAtasNama] = useState('');
  const [newTipe, setNewTipe] = useState<'Transfer Bank' | 'E-Wallet'>('Transfer Bank');

  const qrisInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(paymentConfig);
      setNewBank('');
      setNewNomor('');
      setNewAtasNama('');
      setNewTipe('Transfer Bank');
    }
  }, [open, paymentConfig]);

  if (!open) return null;

  const handleUploadQris = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !canEdit) return;
    if (!file.type.startsWith('image/')) {
      onToast('error', 'File QRIS harus berupa gambar (JPG, PNG, atau WebP).');
      return;
    }
    setUploadingQris(true);
    try {
      const compressed = await compressProofImage(file, 1080, 0.85);
      const res = await uploadQrisImageAdmin(session, compressed.file);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal mengunggah gambar QRIS.');
      } else {
        setDraft((prev) => ({
          ...prev,
          qris_image_url: res.data || null,
          qris_aktif: true,
        }));
        onToast('success', 'Gambar QRIS siap. Klik "Simpan Pengaturan" untuk menerapkan ke warga.');
      }
    } finally {
      setUploadingQris(false);
      if (qrisInputRef.current) qrisInputRef.current.value = '';
    }
  };

  const handleRemoveQris = () => {
    if (!canEdit) return;
    setDraft((prev) => ({
      ...prev,
      qris_image_url: null,
      qris_aktif: false,
    }));
  };

  const handleAddRekening = () => {
    if (!canEdit) return;
    if (!newBank.trim() || !newNomor.trim() || !newAtasNama.trim()) {
      onToast('error', 'Lengkapi nama Bank/E-Wallet, nomor rekening, dan atas nama.');
      return;
    }
    const item: RekeningPembayaran = {
      id: `rek-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      bank: newBank.trim(),
      nomor: newNomor.trim(),
      atasNama: newAtasNama.trim(),
      tipe: newTipe,
    };
    setDraft((prev) => ({
      ...prev,
      rekening_list: [...prev.rekening_list, item],
    }));
    setNewBank('');
    setNewNomor('');
    setNewAtasNama('');
    onToast('info', 'Rekening ditambahkan ke daftar. Klik "Simpan Pengaturan" untuk menyimpan.');
  };

  const handleDeleteRekening = (id: string) => {
    if (!canEdit) return;
    setDraft((prev) => ({
      ...prev,
      rekening_list: prev.rekening_list.filter((r) => r.id !== id),
    }));
  };

  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const res = await savePaymentConfigAdmin(session, draft);
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          'Pengaturan pembayaran (QRIS & Nomor Rekening) berhasil diperbarui untuk seluruh warga.'
        );
        await onSaved();
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
      aria-labelledby="payment-settings-title"
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-md flex items-center justify-center p-4 animate-modal-backdrop"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-white/95 backdrop-blur-xl rounded-3xl max-w-2xl w-full max-h-[88vh] flex flex-col border border-white/90 shadow-2xl overflow-hidden animate-modal-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Modal */}
        <div className="px-5 py-4 border-b border-indigo-100/70 flex items-center justify-between gap-3">
          <div>
            <h3 id="payment-settings-title" className="text-base font-bold text-[#0F172A]">
              Pengaturan Pembayaran &amp; Susunan Pengurus
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelola QRIS, nomor rekening transfer, dan daftar pengurus penerima setoran tunai.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            aria-label="Tutup pengaturan pembayaran"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 hover:bg-indigo-50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Banner RBAC jika bukan Bendahara */}
        {!canEdit && (
          <div className="px-5 py-3 bg-[#FEF3C7] border-b border-amber-200 flex items-start gap-2.5 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
            <span>
              Mode Lihat Saja ({session.jabatan || 'Pengurus'}). Upload gambar QRIS dan perubahan
              nomor rekening transfer hanya dapat dilakukan oleh <strong>Bendahara (Andriansyah)</strong>.
            </span>
          </div>
        )}

        {/* Tab Segmented Selector */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-3 gap-1 p-1 bg-indigo-50/80 border border-indigo-100/80 rounded-2xl">
            {(
              [
                { id: 'qris', label: 'QR / QRIS', shortLabel: 'QRIS', icon: QrCode },
                { id: 'rekening', label: 'Rekening TF', shortLabel: 'Rekening', icon: CreditCard },
                { id: 'pengurus', label: 'Susunan Pengurus', shortLabel: 'Pengurus', icon: Users },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`min-h-[38px] px-1.5 sm:px-2.5 rounded-xl text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1 sm:gap-1.5 transition-colors cursor-pointer min-w-0 ${
                    active
                      ? 'bg-[#4C1D95] text-white shadow-sm'
                      : 'text-slate-600 hover:text-[#4C1D95]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="sm:hidden truncate">{tab.shortLabel}</span>
                  <span className="hidden sm:inline truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Isi Tab */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {activeTab === 'qris' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-100/80 bg-indigo-50/45 px-4 py-3">
                <div>
                  <p className="text-sm font-bold text-[#0F172A]">Aktifkan Pembayaran QR / QRIS</p>
                  <p className="text-xs text-slate-500">
                    Tampilkan gambar kode QRIS pada halaman Setor Iuran warga.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.qris_aktif}
                  disabled={!canEdit}
                  onClick={() => setDraft((prev) => ({ ...prev, qris_aktif: !prev.qris_aktif }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    draft.qris_aktif ? 'bg-[#4C1D95]' : 'bg-slate-300'
                  } ${canEdit ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      draft.qris_aktif ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <input
                ref={qrisInputRef}
                type="file"
                accept="image/*"
                disabled={!canEdit || uploadingQris}
                onChange={handleUploadQris}
                className="sr-only"
                id="admin-qris-upload"
              />

              {draft.qris_image_url ? (
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                  <div className="p-4 flex items-center justify-center bg-white">
                    <img
                      src={draft.qris_image_url}
                      alt="QRIS Kas Lingkungan Perumahan Saung Kebun"
                      referrerPolicy="no-referrer"
                      className="max-h-64 w-auto object-contain rounded-lg border border-slate-200"
                    />
                  </div>
                  {canEdit && (
                    <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                      <label
                        htmlFor="admin-qris-upload"
                        className="min-h-[36px] px-3 rounded-lg border border-emerald-300 bg-white hover:bg-emerald-50 text-xs font-semibold text-emerald-700 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {uploadingQris ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>{uploadingQris ? 'Mengunggah...' : 'Ganti Gambar QRIS'}</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleRemoveQris}
                        className="min-h-[36px] px-3 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-xs font-semibold text-red-700 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus QRIS</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <label
                  htmlFor={canEdit ? 'admin-qris-upload' : undefined}
                  className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-7 text-center min-h-[168px] ${
                    canEdit
                      ? 'hover:border-emerald-600 hover:bg-emerald-50/40 cursor-pointer'
                      : 'opacity-75 cursor-not-allowed'
                  }`}
                >
                  {uploadingQris ? (
                    <Loader2 className="w-7 h-7 text-[#059669] animate-spin mb-2" />
                  ) : (
                    <QrCode className="w-8 h-8 text-slate-400 mb-2" />
                  )}
                  <p className="text-sm font-semibold text-[#0F172A]">
                    {uploadingQris
                      ? 'Mengunggah gambar QRIS...'
                      : canEdit
                        ? 'Upload Gambar QRIS Resmi Kas Lingkungan'
                        : 'Gambar QRIS belum diunggah oleh Bendahara'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Format JPG/PNG. Otomatis tampil di Portal Warga setelah disimpan.
                  </p>
                </label>
              )}

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Nama Merchant / Label QRIS
                  </label>
                  <input
                    type="text"
                    disabled={!canEdit}
                    value={draft.qris_label}
                    onChange={(e) => setDraft((prev) => ({ ...prev, qris_label: e.target.value }))}
                    placeholder="QRIS Kas Lingkungan Perumahan Saung Kebun"
                    className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white disabled:bg-slate-100 px-3.5 text-sm text-[#0F172A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Catatan Instruksi QRIS untuk Warga
                  </label>
                  <textarea
                    rows={2}
                    disabled={!canEdit}
                    value={draft.qris_catatan}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, qris_catatan: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white disabled:bg-slate-100 p-3 text-sm text-[#0F172A]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'rekening' && (
            <div className="space-y-4">
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden bg-white">
                {draft.rekening_list.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500">
                    Belum ada nomor rekening yang tersimpan.
                  </div>
                ) : (
                  draft.rekening_list.map((rek) => (
                    <div
                      key={rek.id}
                      className="p-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-emerald-700">{rek.tipe}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#0F172A]">{rek.bank}</span>
                        </div>
                        <p className="text-sm font-mono font-bold text-[#0F172A] tabular-nums mt-0.5">
                          {rek.nomor}
                        </p>
                        <p className="text-xs text-slate-600 truncate">a.n. {rek.atasNama}</p>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRekening(rek.id)}
                          aria-label={`Hapus rekening ${rek.bank}`}
                          className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 hover:border-red-300 hover:bg-red-50 text-slate-500 hover:text-red-700 inline-flex items-center gap-1 text-xs font-medium cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hapus</span>
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>

              {canEdit && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <p className="text-xs font-bold text-[#0F172A]">
                    Tambah Nomor Rekening / E-Wallet Baru
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Jenis Pembayaran
                      </label>
                      <select
                        value={newTipe}
                        onChange={(e) =>
                          setNewTipe(e.target.value as 'Transfer Bank' | 'E-Wallet')
                        }
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-[#0F172A]"
                      >
                        <option value="Transfer Bank">Transfer Bank</option>
                        <option value="E-Wallet">E-Wallet</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Nama Bank / E-Wallet
                      </label>
                      <input
                        type="text"
                        value={newBank}
                        onChange={(e) => setNewBank(e.target.value)}
                        placeholder="Contoh: Bank BRI / DANA"
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-[#0F172A]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Nomor Rekening / No. HP
                      </label>
                      <input
                        type="text"
                        value={newNomor}
                        onChange={(e) => setNewNomor(e.target.value)}
                        placeholder="Contoh: 1234567890"
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-mono text-[#0F172A]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        Atas Nama Pemilik Rekening
                      </label>
                      <input
                        type="text"
                        value={newAtasNama}
                        onChange={(e) => setNewAtasNama(e.target.value)}
                        placeholder="Contoh: Andriansyah (Bendahara)"
                        className="w-full min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs text-[#0F172A]"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddRekening}
                    className="min-h-[38px] px-4 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah ke Daftar Rekening</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'pengurus' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Susunan pengurus resmi Perumahan Saung Kebun yang memiliki akses Portal Admin (
                <span className="font-mono text-slate-800">{APP_ADMIN_PORTAL_URL}</span>). Gunakan
                tombol di kanan untuk menyalin atau mengirim template akses pengurus via WhatsApp:
              </p>
              <div className="divide-y divide-indigo-100/70 border border-indigo-100/80 rounded-2xl overflow-hidden bg-white">
                {SUSUNAN_PENGURUS.map((p) => {
                  const account = pengurusAccounts?.find(
                    (a) => a.username.toLowerCase() === p.username.toLowerCase()
                  );
                  const mergedInfo: PengurusAccountInfo = {
                    ...p,
                    pin_akses: account?.pin_akses,
                    no_wa: brand.pengurus_wa_map?.[p.username] || account?.no_wa,
                  };
                  const targetWa =
                    brand.pengurus_wa_map?.[p.username] || brand.wa_pengurus;
                  const waMessage = buildPengurusAccessWaMessage(mergedInfo, {
                    appName: brand.app_name,
                    includePin: canEdit,
                  });

                  return (
                    <div
                      key={p.username}
                      className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-bold text-[#0F172A]">{p.jabatan}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-semibold text-[#4C1D95]">{p.nama}</span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className="font-mono text-slate-500">Blok {p.blokRumah}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>
                            Username: <span className="font-mono font-semibold text-slate-700">{p.username}</span>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={p.permission === 'full' ? 'text-emerald-700 font-semibold' : ''}>
                            {p.permission === 'full' ? 'Akses Penuh' : 'Tambah Data'}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <a
                          href={buildWhatsAppLink(targetWa, waMessage)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[34px] px-3 rounded-full bg-[#A7F3D0] hover:bg-[#6EE7B7] text-[#064E3B] text-xs font-semibold inline-flex items-center gap-1 transition-colors whitespace-nowrap"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          <span>Kirim WA</span>
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            const ok = await copyToClipboard(waMessage);
                            if (ok) {
                              setCopiedUser(p.username);
                              onToast(
                                'success',
                                `Template WA Link Pengurus untuk ${p.nama} (${p.jabatan}) berhasil disalin.`
                              );
                              setTimeout(() => setCopiedUser(null), 2000);
                            } else {
                              onToast('error', 'Gagal menyalin template.');
                            }
                          }}
                          className="min-h-[34px] px-3 rounded-full border border-indigo-100 bg-white/95 hover:bg-indigo-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        >
                          {copiedUser === p.username ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">Tersalin</span>
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
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="px-5 py-4 bg-indigo-50/40 border-t border-indigo-100/70 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-full border border-indigo-100 bg-white/95 text-sm font-semibold text-slate-700 hover:bg-indigo-50 cursor-pointer"
          >
            {canEdit ? 'Batal' : 'Tutup'}
          </button>
          {canEdit && activeTab !== 'pengurus' && (
            <button
              type="button"
              disabled={saving || uploadingQris}
              onClick={() => void handleSave()}
              className="min-h-[42px] px-5 rounded-full bg-[#3730A3] hover:bg-[#312E81] disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              <span>{saving ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
