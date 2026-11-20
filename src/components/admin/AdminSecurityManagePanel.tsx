import React, { useState } from 'react';
import {
  Copy,
  Edit3,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  Radio,
  RefreshCw,
  Shield,
  ShieldAlert,
  Smartphone,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  APP_PETUGAS_PORTAL_URL,
  isBendaharaFullAccess,
  SHIFT_PETUGAS_OPTIONS,
  type PetugasKeamanan,
  type SessionUser,
  type TitikPatroli,
} from '../../types';
import { generateRandomPin, normalizePhoneNumber } from '../../lib/format';
import {
  deletePetugasAdmin,
  deleteTitikPatroliAdmin,
  savePetugasAdmin,
  saveTitikPatroliAdmin,
} from '../../lib/dataService';

interface AdminSecurityManagePanelProps {
  session: SessionUser;
  petugasList: PetugasKeamanan[];
  titikPatroliList: TitikPatroli[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminSecurityManagePanel({
  session,
  petugasList,
  titikPatroliList,
  onRefresh,
  onToast,
}: AdminSecurityManagePanelProps) {
  const canEdit = isBendaharaFullAccess(session);

  // Form Petugas Keamanan
  const [editPetugasId, setEditPetugasId] = useState<string | null>(null);
  const [nama, setNama] = useState('');
  const [username, setUsername] = useState('');
  const [noHp, setNoHp] = useState('');
  const [shift, setShift] = useState<string>(SHIFT_PETUGAS_OPTIONS[0]);
  const [pin, setPin] = useState(() => generateRandomPin());
  const [aktif, setAktif] = useState(true);
  const [savingPetugas, setSavingPetugas] = useState(false);

  // Form Titik Checkpoint NFC
  const [editTitikId, setEditTitikId] = useState<string | null>(null);
  const [namaLokasi, setNamaLokasi] = useState('');
  const [rfidUid, setRfidUid] = useState('');
  const [keteranganTitik, setKeteranganTitik] = useState('');
  const [savingTitik, setSavingTitik] = useState(false);
  const [readingNfcUid, setReadingNfcUid] = useState(false);

  const resetPetugasForm = () => {
    setEditPetugasId(null);
    setNama('');
    setUsername('');
    setNoHp('');
    setShift(SHIFT_PETUGAS_OPTIONS[0]);
    setPin(generateRandomPin());
    setAktif(true);
  };

  const resetTitikForm = () => {
    setEditTitikId(null);
    setNamaLokasi('');
    setRfidUid('');
    setKeteranganTitik('');
  };

  const handleCopyPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(APP_PETUGAS_PORTAL_URL);
      onToast('success', `Link Portal Petugas (${APP_PETUGAS_PORTAL_URL}) berhasil disalin.`);
    } catch {
      onToast('info', `Link Portal Petugas: ${APP_PETUGAS_PORTAL_URL}`);
    }
  };

  const handleSavePetugas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || savingPetugas) return;
    setSavingPetugas(true);
    try {
      const res = await savePetugasAdmin(session, {
        id: editPetugasId || undefined,
        nama,
        username,
        no_hp: noHp,
        shift,
        pin,
        aktif,
      });
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          editPetugasId
            ? `Akun petugas "${nama}" berhasil diperbarui.`
            : `Akun petugas "${nama}" berhasil ditambahkan.`
        );
        resetPetugasForm();
        await onRefresh();
      }
    } finally {
      setSavingPetugas(false);
    }
  };

  const handleDeletePetugas = async (p: PetugasKeamanan) => {
    if (!canEdit) return;
    const res = await deletePetugasAdmin(session, p);
    if (res.error) {
      onToast('error', res.error);
    } else {
      onToast('info', `Akun petugas "${p.nama}" telah dihapus.`);
      if (editPetugasId === p.id) resetPetugasForm();
      await onRefresh();
    }
  };

  const handleSaveTitik = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit || savingTitik) return;
    setSavingTitik(true);
    try {
      const res = await saveTitikPatroliAdmin(session, {
        id: editTitikId || undefined,
        nama_lokasi: namaLokasi,
        rfid_uid: rfidUid,
        keterangan: keteranganTitik,
        aktif: true,
      });
      if (res.error) {
        onToast('error', res.error);
      } else {
        onToast(
          'success',
          editTitikId
            ? `Titik patroli "${namaLokasi}" diperbarui.`
            : `Titik patroli "${namaLokasi}" (${rfidUid.toUpperCase()}) ditambahkan.`
        );
        resetTitikForm();
        await onRefresh();
      }
    } finally {
      setSavingTitik(false);
    }
  };

  const handleDeleteTitik = async (t: TitikPatroli) => {
    if (!canEdit) return;
    const res = await deleteTitikPatroliAdmin(session, t);
    if (res.error) {
      onToast('error', res.error);
    } else {
      onToast('info', `Titik checkpoint "${t.nama_lokasi}" dihapus.`);
      if (editTitikId === t.id) resetTitikForm();
      await onRefresh();
    }
  };

  const handleScanUidFromNfc = async () => {
    const NDEFReaderCtor = (
      window as unknown as {
        NDEFReader?: new () => {
          scan: () => Promise<void>;
          onreading: ((ev: { serialNumber?: string }) => void) | null;
        };
      }
    ).NDEFReader;

    if (!NDEFReaderCtor) {
      onToast(
        'info',
        'Web NFC hanya aktif di Chrome Android. Ketik kode UID RFID secara manual pada kolom UID.'
      );
      return;
    }

    try {
      setReadingNfcUid(true);
      onToast('info', 'Tempelkan stiker NFC/RFID ke belakang HP untuk membaca UID otomatis...');
      const ndef = new NDEFReaderCtor();
      await ndef.scan();
      ndef.onreading = (ev) => {
        const uid = (ev.serialNumber || '').trim().toUpperCase();
        setReadingNfcUid(false);
        if (uid) {
          setRfidUid(uid);
          onToast('success', `UID Tag NFC terbaca: ${uid}`);
        } else {
          onToast('error', 'Tag terbaca tetapi UID kosong. Silakan isi manual.');
        }
      };
    } catch {
      setReadingNfcUid(false);
      onToast('error', 'Gagal memulai sensor NFC. Pastikan NFC HP aktif.');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {!canEdit && (
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-900">
          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Mode lihat saja ({session.jabatan || 'Pengurus'}). Pembuatan akun Petugas Keamanan &amp;
            pendaftaran titik RFID/NFC khusus akun <strong>Bendahara</strong>.
          </span>
        </div>
      )}

      {/* Tautan Khusus Portal Petugas Keamanan */}
      <div className="bg-[#0F172A] text-white rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-emerald-400 inline-flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            <span>Tautan Portal Khusus Petugas Keamanan (Terisolasi)</span>
          </p>
          <p className="text-sm font-mono font-bold text-white mt-1 truncate">
            {APP_PETUGAS_PORTAL_URL}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Bagikan link ini ke petugas keamanan. Petugas tidak dapat mengakses data kas atau warga.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCopyPortalLink()}
          className="min-h-[42px] px-4 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
        >
          <Copy className="w-3.5 h-3.5" />
          <span>Salin Link /petugas</span>
        </button>
      </div>

      {/* BAGIAN A: KELOLA AKUN PETUGAS KEAMANAN */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-[#059669]" />
            <span>Kelola Akun Petugas Keamanan ({petugasList.length})</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Nomor HP/WA aktif petugas otomatis tampil pada widget Kontak Darurat Keamanan (24 Jam)
            di portal Warga &amp; Admin.
          </p>
        </div>

        {canEdit && (
          <form onSubmit={handleSavePetugas} className="p-4 sm:p-5 bg-slate-50/70 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-[#0F172A]">
                {editPetugasId ? 'Edit Akun Petugas Keamanan' : 'Tambah Petugas Keamanan Baru'}
              </p>
              {editPetugasId && (
                <button
                  type="button"
                  onClick={resetPetugasForm}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Batal Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Nama Petugas
                </label>
                <input
                  type="text"
                  required
                  value={nama}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder="Contoh: Pak Asep"
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Username Login
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                  placeholder="Contoh: asep"
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono text-[#0F172A]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  No. HP / WhatsApp Aktif
                </label>
                <input
                  type="tel"
                  required
                  value={noHp}
                  onChange={(e) => setNoHp(e.target.value)}
                  placeholder="0812xxxxxxxx"
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono text-[#0F172A]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Jadwal Shift
                </label>
                <select
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A]"
                >
                  {SHIFT_PETUGAS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  PIN Akses (6 Digit)
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="flex-1 min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono font-bold tracking-widest text-[#0F172A]"
                  />
                  <button
                    type="button"
                    onClick={() => setPin(generateRandomPin())}
                    title="Acak PIN 6 Digit"
                    className="min-h-[42px] min-w-[42px] rounded-xl border border-slate-300 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={savingPetugas}
                  className="w-full min-h-[42px] rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {savingPetugas ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  <span>{editPetugasId ? 'Simpan Perubahan' : 'Tambah Petugas'}</span>
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {petugasList.length === 0 ? (
            <p className="p-6 text-center text-xs text-slate-500">
              Belum ada akun petugas keamanan terdaftar.
            </p>
          ) : (
            petugasList.map((p) => {
              const cleanWa = normalizePhoneNumber(p.no_hp);
              const shareText = encodeURIComponent(
                `Halo ${p.nama}, berikut akses resmi Portal Petugas Keamanan Perumahan Saung Kebun:\n\n🔗 Link Portal: ${APP_PETUGAS_PORTAL_URL}\n👤 Username: ${p.username}\n🔐 PIN 6 Digit: ${p.pin || '(hubungi bendahara)'}\n🕒 Shift: ${p.shift}\n\nGunakan portal ini untuk scan NFC titik patroli & melihat riwayat honorarium pribadi.`
              );
              return (
                <div
                  key={p.id}
                  className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <p className="text-sm font-bold text-[#0F172A]">{p.nama}</p>
                      <span className="text-xs font-mono text-slate-500">@{p.username}</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          p.aktif ? 'text-emerald-700' : 'text-slate-400'
                        }`}
                      >
                        · {p.aktif ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2">
                      <span>{p.shift}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-600">+{cleanWa}</span>
                      {canEdit && p.pin && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-emerald-700 font-semibold">
                            PIN: {p.pin}
                          </span>
                        </>
                      )}
                    </p>
                  </div>

                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <a
                        href={`https://wa.me/${cleanWa}?text=${shareText}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[36px] px-2.5 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        <span>Kirim Akses WA</span>
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          setEditPetugasId(p.id);
                          setNama(p.nama);
                          setUsername(p.username);
                          setNoHp(p.no_hp);
                          setShift(p.shift);
                          setPin(p.pin || generateRandomPin());
                          setAktif(p.aktif);
                        }}
                        className="min-h-[36px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeletePetugas(p)}
                        className="min-h-[36px] min-w-[36px] rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 inline-flex items-center justify-center cursor-pointer"
                        aria-label={`Hapus petugas ${p.nama}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* BAGIAN B: KELOLA TITIK CHECKPOINT RFID / NFC */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#059669]" />
            <span>Titik Checkpoint Patroli RFID / NFC ({titikPatroliList.length})</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Daftarkan lokasi pos &amp; kode UID stiker RFID/NFC yang ditempel di area perumahan.
          </p>
        </div>

        {canEdit && (
          <form onSubmit={handleSaveTitik} className="p-4 sm:p-5 bg-slate-50/70 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-[#0F172A]">
                {editTitikId ? 'Edit Titik Checkpoint' : 'Tambah Titik Checkpoint Baru'}
              </p>
              {editTitikId && (
                <button
                  type="button"
                  onClick={resetTitikForm}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Batal Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Nama Titik Lokasi
                </label>
                <input
                  type="text"
                  required
                  value={namaLokasi}
                  onChange={(e) => setNamaLokasi(e.target.value)}
                  placeholder="Contoh: Pos Gerbang Utama"
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Kode UID Tag RFID / NFC
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    value={rfidUid}
                    onChange={(e) => setRfidUid(e.target.value.toUpperCase())}
                    placeholder="Contoh: 04:A1:B2:C3"
                    className="flex-1 min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono uppercase text-[#0F172A]"
                  />
                  <button
                    type="button"
                    disabled={readingNfcUid}
                    onClick={() => void handleScanUidFromNfc()}
                    title="Tap Stiker NFC untuk Isi UID Otomatis"
                    className="min-h-[42px] px-2.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Smartphone className={`w-3.5 h-3.5 ${readingNfcUid ? 'animate-pulse' : ''}`} />
                    <span>Tap</span>
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Keterangan (Opsional)
                </label>
                <input
                  type="text"
                  value={keteranganTitik}
                  onChange={(e) => setKeteranganTitik(e.target.value)}
                  placeholder="Area gerbang / sudut blok..."
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 bg-white px-3 text-sm text-[#0F172A]"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingTitik}
                className="min-h-[42px] px-4 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                {savingTitik ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <MapPin className="w-4 h-4" />
                )}
                <span>{editTitikId ? 'Simpan Titik Checkpoint' : 'Tambah Titik Checkpoint'}</span>
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {titikPatroliList.map((t) => (
            <div
              key={t.id}
              className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-[#0F172A] inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#059669] shrink-0" />
                  <span>{t.nama_lokasi}</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                  <span className="font-mono font-semibold text-slate-700">UID: {t.rfid_uid}</span>
                  {t.keterangan && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t.keterangan}</span>
                    </>
                  )}
                </p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setEditTitikId(t.id);
                      setNamaLokasi(t.nama_lokasi);
                      setRfidUid(t.rfid_uid);
                      setKeteranganTitik(t.keterangan || '');
                    }}
                    className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteTitik(t)}
                    className="min-h-[34px] min-w-[34px] rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 inline-flex items-center justify-center cursor-pointer"
                    aria-label={`Hapus titik ${t.nama_lokasi}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
