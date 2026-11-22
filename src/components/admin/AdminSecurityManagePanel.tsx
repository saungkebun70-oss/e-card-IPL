import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Edit3,
  ImagePlus,
  Loader2,
  LocateFixed,
  MapPin,
  MessageCircle,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Shield,
  ShieldAlert,
  Smartphone,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  APP_PETUGAS_PORTAL_URL,
  isBendaharaFullAccess,
  isKetuaRole,
  SHIFT_PETUGAS_OPTIONS,
  type PatrolGpsCalibration,
  type PatrolMapConfig,
  type PetugasKeamanan,
  type SessionUser,
  type TitikPatroli,
} from '../../types';
import { generateRandomPin, normalizePhoneNumber } from '../../lib/format';
import {
  describeWebNfcError,
  extractNfcReadingData,
  getNdefReaderConstructor,
  isWebNfcSupported,
  normalizeNfcUid,
  triggerNfcVibrate,
} from '../../lib/webNfc';
import {
  deletePetugasAdmin,
  deleteTitikPatroliAdmin,
  savePatrolMapImageAdmin,
  savePetugasAdmin,
  saveTitikPatroliAdmin,
  saveTitikPinPositionAdmin,
  uploadPatrolMapImageAdmin,
} from '../../lib/dataService';
import {
  fetchGpsCalibrations,
  playScanSuccessFeedback,
  saveGpsCalibration,
  subscribeLivePatrolSessions,
} from '../../lib/livePatrolService';
import { describeGeolocationError } from '../../lib/patrolGpsUtils';
import { PatrolInteractiveMap } from '../PatrolInteractiveMap';
import { buildAvatarKey, useAvatarMap } from '../../lib/avatarService';
import { UserAvatar } from '../UserAvatar';

interface AdminSecurityManagePanelProps {
  session: SessionUser;
  petugasList: PetugasKeamanan[];
  titikPatroliList: TitikPatroli[];
  patrolMapConfig?: PatrolMapConfig | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function AdminSecurityManagePanel({
  session,
  petugasList,
  titikPatroliList,
  patrolMapConfig,
  onRefresh,
  onToast,
}: AdminSecurityManagePanelProps) {
  const canEdit = isBendaharaFullAccess(session);
  const canCalibrateGps = isBendaharaFullAccess(session) || isKetuaRole(session);
  const avatarMap = useAvatarMap();

  // State Peta Mapping Rute Patroli & Editor Pin
  const activeTitikList = useMemo(
    () => titikPatroliList.filter((t) => t.aktif !== false),
    [titikPatroliList]
  );
  const [localMapConfig, setLocalMapConfig] = useState<PatrolMapConfig>(
    () =>
      patrolMapConfig || {
        map_image_url: null,
        cycle_reset_at: null,
        pin_positions: {},
      }
  );
  const [selectedPinTitikId, setSelectedPinTitikId] = useState<string>(
    () => activeTitikList[0]?.id || ''
  );
  const [uploadingMap, setUploadingMap] = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const mapFileInputRef = useRef<HTMLInputElement | null>(null);

  // State Kalibrasi GPS Asli per Pos (patrol_gps_calibration)
  const [gpsCalibrations, setGpsCalibrations] = useState<Record<string, PatrolGpsCalibration>>({});
  const [lockingGpsPosId, setLockingGpsPosId] = useState<string | null>(null);

  const calibratedPosIds = useMemo(
    () => new Set(Object.keys(gpsCalibrations)),
    [gpsCalibrations]
  );

  const loadGpsCalibrations = useCallback(async () => {
    const data = await fetchGpsCalibrations(session);
    setGpsCalibrations(data);
  }, [session]);

  useEffect(() => {
    void loadGpsCalibrations();
    const unsub = subscribeLivePatrolSessions(session, () => {
      void loadGpsCalibrations();
    });
    return () => {
      unsub();
    };
  }, [session, loadGpsCalibrations]);

  const handleLockGpsForPos = useCallback(
    (titik: TitikPatroli) => {
      if (!canCalibrateGps) {
        onToast('error', 'Hanya Bendahara atau Ketua yang dapat mengunci kalibrasi GPS pos.');
        return;
      }
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        onToast('error', describeGeolocationError(null));
        return;
      }

      setLockingGpsPosId(titik.id);
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude, longitude, accuracy } = pos.coords;
            const res = await saveGpsCalibration(session, {
              pos_id: titik.id,
              lat: latitude,
              lng: longitude,
            });
            if (res.ok && res.data) {
              setGpsCalibrations((prev) => ({
                ...prev,
                [titik.id]: res.data!,
              }));
              playScanSuccessFeedback();
              const accText = Number.isFinite(accuracy) ? ` (±${Math.round(accuracy)}m)` : '';
              onToast(
                'success',
                `GPS Asli "${titik.nama_lokasi}" terkunci${accText}: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
              );
            } else {
              onToast('error', res.message || 'Gagal menyimpan kalibrasi GPS.');
            }
          } catch (err) {
            onToast(
              'error',
              err instanceof Error ? err.message : 'Gagal menyimpan kalibrasi GPS pos.'
            );
          } finally {
            setLockingGpsPosId(null);
          }
        },
        (err) => {
          setLockingGpsPosId(null);
          onToast('error', describeGeolocationError(err));
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    },
    [canCalibrateGps, onToast, session]
  );

  useEffect(() => {
    if (patrolMapConfig) {
      setLocalMapConfig(patrolMapConfig);
    }
  }, [patrolMapConfig]);

  useEffect(() => {
    if (
      activeTitikList.length > 0 &&
      (!selectedPinTitikId || !activeTitikList.some((t) => t.id === selectedPinTitikId))
    ) {
      setSelectedPinTitikId(activeTitikList[0].id);
    }
  }, [activeTitikList, selectedPinTitikId]);

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
  const [writingNfcTag, setWritingNfcTag] = useState(false);
  const [nfcFeedback, setNfcFeedback] = useState<{
    type: 'scanning' | 'success' | 'error';
    text: string;
  } | null>(null);
  const nfcAbortRef = useRef<AbortController | null>(null);
  const nfcSupported = isWebNfcSupported();

  const stopNfcOperation = useCallback(() => {
    if (nfcAbortRef.current) {
      nfcAbortRef.current.abort();
      nfcAbortRef.current = null;
    }
    setReadingNfcUid(false);
    setWritingNfcTag(false);
  }, []);

  useEffect(() => {
    return () => {
      nfcAbortRef.current?.abort();
    };
  }, []);

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
    stopNfcOperation();
    setNfcFeedback(null);
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

  const handleUploadMapFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !canEdit) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      onToast('error', 'Format peta harus berupa gambar JPG, PNG, atau WebP.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      onToast('error', 'Ukuran gambar peta maksimal 8 MB.');
      return;
    }

    setUploadingMap(true);
    try {
      const uploadRes = await uploadPatrolMapImageAdmin(session, file);
      if (uploadRes.error || !uploadRes.data) {
        onToast('error', uploadRes.error || 'Gagal mengunggah gambar peta perumahan.');
        return;
      }
      const saveRes = await savePatrolMapImageAdmin(session, uploadRes.data);
      if (saveRes.error || !saveRes.data) {
        onToast('error', saveRes.error || 'Gagal menyimpan URL peta perumahan.');
        return;
      }
      setLocalMapConfig(saveRes.data);
      onToast('success', 'Gambar Peta Mapping Rute Patroli berhasil diperbarui.');
      await onRefresh();
    } finally {
      setUploadingMap(false);
    }
  };

  const handleClearCustomMap = async () => {
    if (!canEdit || uploadingMap) return;
    setUploadingMap(true);
    try {
      const saveRes = await savePatrolMapImageAdmin(session, null);
      if (saveRes.error || !saveRes.data) {
        onToast('error', saveRes.error || 'Gagal mereset gambar peta.');
        return;
      }
      setLocalMapConfig(saveRes.data);
      onToast('info', 'Peta dikembalikan ke denah vektor standar Perumahan Saung Kebun.');
      await onRefresh();
    } finally {
      setUploadingMap(false);
    }
  };

  const handlePlacePin = async (titikId: string, xPercent: number, yPercent: number) => {
    if (!canEdit || savingPin) return;
    setSavingPin(true);
    try {
      const res = await saveTitikPinPositionAdmin(session, titikId, xPercent, yPercent);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal menyimpan koordinat pin patroli.');
        return;
      }
      setLocalMapConfig(res.data);
      const targetName =
        activeTitikList.find((t) => t.id === titikId)?.nama_lokasi || 'Checkpoint';
      onToast(
        'success',
        `Posisi pin "${targetName}" disimpan (${xPercent.toFixed(1)}%, ${yPercent.toFixed(1)}%).`
      );
      await onRefresh();
    } finally {
      setSavingPin(false);
    }
  };

  const handleScanUidFromNfc = async () => {
    // Jika sedang aktif scanning, ketuk lagi untuk membatalkan foreground NFC scan
    if (readingNfcUid) {
      stopNfcOperation();
      setNfcFeedback(null);
      return;
    }

    stopNfcOperation();

    const NDEFReaderCtor = getNdefReaderConstructor();
    if (!NDEFReaderCtor) {
      const msg =
        'Web NFC hanya didukung di browser Chrome Android (koneksi HTTPS). Silakan ketik Kode UID Tag secara manual.';
      setNfcFeedback({ type: 'error', text: msg });
      onToast('error', msg);
      return;
    }

    try {
      const controller = new AbortController();
      nfcAbortRef.current = controller;
      const ndef = new NDEFReaderCtor();

      // Daftarkan listener SEBELUM scan() agar event pertama langsung tertangkap
      ndef.addEventListener(
        'reading',
        (event) => {
          const { uid } = extractNfcReadingData(event);
          stopNfcOperation();
          if (uid) {
            triggerNfcVibrate([100, 50, 100]);
            setRfidUid(uid);
            setNfcFeedback({
              type: 'success',
              text: `UID Stiker NFC berhasil terbaca & diisi otomatis: ${uid}`,
            });
            onToast('success', `UID Stiker NFC terbaca: ${uid}`);
          } else {
            const emptyMsg =
              'Tag NFC terdeteksi tetapi serialNumber/UID kosong. Gunakan stiker NTAG213/215/216 atau ketik UID manual.';
            setNfcFeedback({ type: 'error', text: emptyMsg });
            onToast('error', emptyMsg);
          }
        },
        { signal: controller.signal }
      );

      ndef.addEventListener(
        'readingerror',
        () => {
          const errMsg =
            'Tag terdeteksi tetapi tidak berformat NDEF (misal kartu e-Money/Flazz/MIFARE Classic) atau stiker masih kosong. Gunakan stiker NTAG213/215/216, atau klik "Format NDEF" jika memakai stiker NTAG baru.';
          setNfcFeedback({ type: 'error', text: errMsg });
          onToast('error', 'Gagal membaca tag NFC. Pastikan stiker berformat NDEF (NTAG213/215/216).');
        },
        { signal: controller.signal }
      );

      setReadingNfcUid(true);
      setNfcFeedback({
        type: 'scanning',
        text: 'Mode Scan Aktif — Tempelkan stiker NFC ke belakang HP sekarang...',
      });

      // Jalankan foreground scan dengan AbortController agar Chrome mengambil alih NFC dari OS Android
      await ndef.scan({ signal: controller.signal });
    } catch (err) {
      stopNfcOperation();
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const readableErr = describeWebNfcError(err);
      setNfcFeedback({ type: 'error', text: readableErr });
      onToast('error', readableErr);
    }
  };

  const handleWriteNdefCheckpointTag = async () => {
    if (writingNfcTag) {
      stopNfcOperation();
      setNfcFeedback(null);
      return;
    }

    stopNfcOperation();

    const NDEFReaderCtor = getNdefReaderConstructor();
    if (!NDEFReaderCtor) {
      const msg = 'Penulisan tag NFC hanya tersedia di browser Chrome Android (HTTPS).';
      setNfcFeedback({ type: 'error', text: msg });
      onToast('error', msg);
      return;
    }

    const targetCode =
      normalizeNfcUid(rfidUid) ||
      `SKB${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    if (!rfidUid.trim()) {
      setRfidUid(targetCode);
    }

    try {
      const controller = new AbortController();
      nfcAbortRef.current = controller;
      const ndef = new NDEFReaderCtor();

      setWritingNfcTag(true);
      setNfcFeedback({
        type: 'scanning',
        text: `Siap memformat tag NDEF (${targetCode}) — tempelkan stiker NTAG213/215/216 ke belakang HP selama 2 detik...`,
      });

      const payload = `SKB-CP:${targetCode}|${(namaLokasi || 'TITIK PATROLI').trim().toUpperCase()}`;
      await ndef.write(
        { records: [{ recordType: 'text', data: payload }] },
        { signal: controller.signal, overwrite: true }
      );

      stopNfcOperation();
      triggerNfcVibrate([100, 50, 100]);
      setRfidUid(targetCode);
      setNfcFeedback({
        type: 'success',
        text: `Stiker NFC berhasil diformat NDEF dengan kode ${targetCode}. Kini tidak akan memicu pop-up DANA/GoPay/OVO.`,
      });
      onToast('success', `Tag NFC berhasil ditulis (${targetCode}).`);
    } catch (err) {
      stopNfcOperation();
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const readableErr = describeWebNfcError(err);
      setNfcFeedback({ type: 'error', text: readableErr });
      onToast('error', readableErr);
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
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar
                      name={p.nama}
                      src={
                        p.avatar_url ||
                        avatarMap[buildAvatarKey('petugas', p.id)] ||
                        avatarMap[buildAvatarKey('petugas', p.username)] ||
                        null
                      }
                      size="md"
                    />
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

              <div className="sm:col-span-2 space-y-2">
                <label className="block text-[11px] font-semibold text-slate-700">
                  Kode UID Tag RFID / NFC
                </label>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    required
                    value={rfidUid}
                    onChange={(e) => setRfidUid(normalizeNfcUid(e.target.value))}
                    placeholder="Contoh: 04A1B2C3"
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-sm font-mono font-bold tracking-wider uppercase text-[#0F172A]"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={writingNfcTag}
                      onClick={() => void handleScanUidFromNfc()}
                      className={`flex-1 sm:flex-initial min-h-[44px] px-3.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                        readingNfcUid
                          ? 'bg-amber-600 hover:bg-amber-700 text-white ring-2 ring-amber-300'
                          : 'bg-[#059669] hover:bg-emerald-700 text-white'
                      }`}
                    >
                      {readingNfcUid ? (
                        <>
                          <Radio className="w-4 h-4 animate-pulse shrink-0" />
                          <span>Batal Scan</span>
                        </>
                      ) : (
                        <>
                          <Smartphone className="w-4 h-4 shrink-0" />
                          <span>Tap / Scan Stiker NFC</span>
                        </>
                      )}
                    </button>

                    {nfcSupported && (
                      <button
                        type="button"
                        disabled={readingNfcUid}
                        onClick={() => void handleWriteNdefCheckpointTag()}
                        title="Format stiker NTAG kosong ke NDEF agar tidak memicu pop-up e-Wallet di Android"
                        className={`min-h-[44px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                          writingNfcTag
                            ? 'border-amber-500 bg-amber-50 text-amber-800'
                            : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <Radio className={`w-3.5 h-3.5 shrink-0 ${writingNfcTag ? 'animate-pulse text-amber-600' : 'text-slate-500'}`} />
                        <span>{writingNfcTag ? 'Batal Tulis' : 'Format NDEF'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Indikator Status Aktif Scan / Hasil / Error NFC */}
                {nfcFeedback && (
                  <div
                    role="status"
                    className={`rounded-xl px-3.5 py-2.5 text-xs flex items-start justify-between gap-2.5 border ${
                      nfcFeedback.type === 'scanning'
                        ? 'bg-[#0F172A] border-slate-800 text-emerald-300'
                        : nfcFeedback.type === 'success'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      {nfcFeedback.type === 'scanning' ? (
                        <span className="relative flex h-4 w-4 mt-0.5 shrink-0 items-center justify-center">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="animate-ping absolute inline-flex h-3 w-3 rounded-full bg-emerald-300 opacity-60 [animation-delay:250ms]" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
                        </span>
                      ) : nfcFeedback.type === 'error' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <Radio className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      )}
                      <span className="leading-relaxed font-medium">{nfcFeedback.text}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        stopNfcOperation();
                        setNfcFeedback(null);
                      }}
                      aria-label="Tutup status NFC"
                      className="p-0.5 rounded opacity-70 hover:opacity-100 cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Tekan <strong>Tap / Scan Stiker NFC</strong> terlebih dahulu sebelum menempelkan
                  stiker agar Chrome Android mengambil alih sensor NFC (mencegah pop-up
                  DANA/GoPay/OVO). Gunakan stiker NFC tipe <strong>NTAG213/215/216</strong>; kartu
                  e-Money/MIFARE Classic non-NDEF tidak didukung Web NFC browser.
                </p>
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

      {/* BAGIAN C: PETA MAPPING RUTE PATROLI & PENEMPATAN PIN INTERAKTIF */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 sm:px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#0F172A] flex items-center gap-2">
              <ImagePlus className="w-4 h-4 text-[#059669]" />
              <span>Peta Mapping Rute Patroli</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Unggah denah/foto peta Perumahan Saung Kebun (JPG/PNG/WebP), lalu pilih titik
              checkpoint dan klik pada peta untuk menyimpan posisi pin real-time.
            </p>
          </div>

          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <input
                ref={mapFileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void handleUploadMapFile(e)}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingMap}
                onClick={() => mapFileInputRef.current?.click()}
                className="min-h-[40px] px-3.5 rounded-xl bg-[#059669] hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                {uploadingMap ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="w-3.5 h-3.5" />
                )}
                <span>
                  {uploadingMap
                    ? 'Mengunggah...'
                    : localMapConfig.map_image_url
                      ? 'Ganti Gambar Peta'
                      : 'Unggah Gambar Peta Perumahan'}
                </span>
              </button>

              {localMapConfig.map_image_url && (
                <button
                  type="button"
                  disabled={uploadingMap}
                  onClick={() => void handleClearCustomMap()}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Denah Bawaan</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Pemilih Titik Checkpoint untuk Penempatan Pin & Kalibrasi GPS Asli */}
          {activeTitikList.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  1. Pilih Checkpoint (Atur Pin X%, Y%) &amp; Kunci GPS Asli di Lapangan:
                </p>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 tabular-nums">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#059669]" />
                  <span>
                    GPS Terkalibrasi:{' '}
                    {activeTitikList.filter((t) => Boolean(gpsCalibrations[t.id])).length} /{' '}
                    {activeTitikList.length} Pos
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {activeTitikList.map((titik, idx) => {
                  const savedPos = localMapConfig.pin_positions?.[titik.id];
                  const posX =
                    typeof savedPos?.x_percent === 'number'
                      ? savedPos.x_percent
                      : titik.x_percent;
                  const posY =
                    typeof savedPos?.y_percent === 'number'
                      ? savedPos.y_percent
                      : titik.y_percent;
                  const isSelected = selectedPinTitikId === titik.id;
                  const cal = gpsCalibrations[titik.id];
                  const isLockingThis = lockingGpsPosId === titik.id;

                  return (
                    <div
                      key={titik.id}
                      className={`rounded-xl border p-2 transition flex flex-wrap items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-emerald-50/70 border-[#059669] shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPinTitikId(titik.id)}
                        className="flex-1 min-w-[160px] text-left flex items-center gap-2 cursor-pointer"
                      >
                        <span
                          className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                            isSelected
                              ? 'bg-[#059669] text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {titik.nama_lokasi}
                            </span>
                            {typeof posX === 'number' && typeof posY === 'number' && (
                              <span className="text-[10px] font-mono tabular-nums text-slate-400">
                                ({Math.round(posX)}%,{Math.round(posY)}%)
                              </span>
                            )}
                          </div>
                          {cal ? (
                            <span
                              title={`Koordinat GPS tersimpan: ${cal.lat.toFixed(6)}, ${cal.lng.toFixed(6)}`}
                              className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700"
                            >
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>GPS Terkalibrasi</span>
                              <span className="font-mono text-slate-400 hidden sm:inline tabular-nums">
                                · {cal.lat.toFixed(5)}, {cal.lng.toFixed(5)}
                              </span>
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-[10px] text-slate-400">
                              Belum kunci GPS asli
                            </span>
                          )}
                        </div>
                      </button>

                      {canCalibrateGps && (
                        <button
                          type="button"
                          disabled={lockingGpsPosId !== null}
                          onClick={() => handleLockGpsForPos(titik)}
                          className={`min-h-[34px] px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 transition shrink-0 cursor-pointer disabled:opacity-60 ${
                            cal
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                              : 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                          }`}
                          title="Berdiri di lokasi Pos ini lalu klik untuk mengambil koordinat GPS asli HP Anda"
                        >
                          {isLockingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <LocateFixed className="w-3.5 h-3.5" />
                          )}
                          <span>{isLockingThis ? 'Mengunci...' : 'Kunci GPS Asli'}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200/80 rounded-xl px-3 py-2">
                <strong>Tips Kalibrasi GPS 3D:</strong> Berdirilah di lokasi Pos 1 s/d Pos 5 sambil
                membuka halaman ini, lalu klik <strong>Kunci GPS Asli</strong>. Kunci minimal{' '}
                <strong>2 pos</strong> (ideal <strong>≥ 3 pos</strong>) agar pergerakan Live
                Tracking Petugas meluncur presisi di atas gambar Peta 3D.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-500">
              Tambahkan minimal 1 Titik Checkpoint RFID / NFC di atas untuk mulai memetakan pin di
              denah perumahan.
            </div>
          )}

          {/* Kanvas Peta Editor Interaktif (Klik Langsung / Drag Pin Presisi) */}
          <PatrolInteractiveMap
            mode="editor"
            titikList={titikPatroliList}
            patroliLogs={[]}
            patrolMapConfig={localMapConfig}
            calibratedPosIds={calibratedPosIds}
            selectedEditorTitikId={canEdit ? selectedPinTitikId : null}
            onSelectEditorTitik={canEdit ? setSelectedPinTitikId : undefined}
            onPlacePin={canEdit ? handlePlacePin : undefined}
            savingPin={savingPin}
          />
        </div>
      </section>
    </div>
  );
}
