import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Crosshair,
  Loader2,
  MapPin,
  Radio,
  Save,
  Shield,
  X,
  AlertTriangle,
} from 'lucide-react';
import {
  DEFAULT_PATROL_CHECKPOINTS,
  type PatrolCheckpoint,
  type SessionUser,
} from '../types';
import {
  describeGeolocationError,
  playScanSuccessFeedback,
  savePatrolCheckpointCalibration,
} from '../lib/livePatrolService';
import {
  describeWebNfcError,
  extractNfcReadingData,
  getNdefReaderConstructor,
  isWebNfcSupported,
  normalizeNfcUid,
} from '../lib/webNfc';

interface PatrolCalibrationModalProps {
  open: boolean;
  session: SessionUser;
  checkpoints: PatrolCheckpoint[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onToast: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function PatrolCalibrationModal({
  open,
  session,
  checkpoints,
  onClose,
  onSaved,
  onToast,
}: PatrolCalibrationModalProps) {
  const [rows, setRows] = useState<PatrolCheckpoint[]>([]);
  const [locatingId, setLocatingId] = useState<string | null>(null);
  const [scanningNfcId, setScanningNfcId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [gpsErrorInfo, setGpsErrorInfo] = useState<{
    title: string;
    message: string;
    guide: string;
  } | null>(null);
  const [nfcHint, setNfcHint] = useState<string | null>(null);
  const nfcAbortRef = useRef<AbortController | null>(null);
  const nfcSupported = isWebNfcSupported();

  useEffect(() => {
    if (!open) {
      nfcAbortRef.current?.abort();
      nfcAbortRef.current = null;
      setScanningNfcId(null);
      setGpsErrorInfo(null);
      setNfcHint(null);
      return;
    }

    // Pastikan selalu tampil 5 pos (Pos 1 s/d Pos 5)
    const sorted = [...checkpoints].sort((a, b) => a.order_index - b.order_index);
    const merged: PatrolCheckpoint[] = [1, 2, 3, 4, 5].map((orderIdx) => {
      const existing = sorted.find((c) => c.order_index === orderIdx) || sorted[orderIdx - 1];
      if (existing) {
        return { ...existing, order_index: orderIdx };
      }
      return { ...DEFAULT_PATROL_CHECKPOINTS[orderIdx - 1] };
    });
    setRows(merged);
  }, [open, checkpoints]);

  useEffect(() => {
    return () => {
      nfcAbortRef.current?.abort();
    };
  }, []);

  if (!open) return null;

  const stopNfcCapture = () => {
    nfcAbortRef.current?.abort();
    nfcAbortRef.current = null;
    setScanningNfcId(null);
  };

  const updateRowField = (
    orderIndex: number,
    patch: Partial<Pick<PatrolCheckpoint, 'name' | 'nfc_tag_id' | 'lat' | 'lng'>>
  ) => {
    setRows((prev) =>
      prev.map((item) => (item.order_index === orderIndex ? { ...item, ...patch } : item))
    );
  };

  const persistCheckpoint = async (item: PatrolCheckpoint, successMessage: string) => {
    setSavingId(item.id);
    try {
      const res = await savePatrolCheckpointCalibration(session, item);
      if (res.error || !res.data) {
        onToast('error', res.error || 'Gagal menyimpan kalibrasi titik pos.');
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.order_index === item.order_index ? res.data! : r))
      );
      onToast('success', successMessage);
      await onSaved();
    } finally {
      setSavingId(null);
    }
  };

  const handleUseCurrentGps = (item: PatrolCheckpoint) => {
    setGpsErrorInfo(null);
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      const info = describeGeolocationError(new Error('Browser ini tidak mendukung GPS Geolocation.'));
      setGpsErrorInfo(info);
      onToast('error', info.title);
      return;
    }

    setLocatingId(item.id);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Math.round(pos.coords.latitude * 1_000_000) / 1_000_000;
        const lng = Math.round(pos.coords.longitude * 1_000_000) / 1_000_000;
        const accuracy = Math.round(pos.coords.accuracy || 0);
        const updated: PatrolCheckpoint = { ...item, lat, lng };
        updateRowField(item.order_index, { lat, lng });
        setLocatingId(null);
        void persistCheckpoint(
          updated,
          `Lokasi GPS Pos ${item.order_index} (${item.name}) tersimpan! Akurasi ±${accuracy}m.`
        );
      },
      (err) => {
        setLocatingId(null);
        const info = describeGeolocationError(err);
        setGpsErrorInfo(info);
        onToast('error', `${info.title}: ${info.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      }
    );
  };

  const handleRecordNfcTag = async (item: PatrolCheckpoint) => {
    setNfcHint(null);
    if (scanningNfcId === item.id) {
      stopNfcCapture();
      return;
    }
    stopNfcCapture();

    try {
      if (!('NDEFReader' in window)) {
        const msg =
          'Browser/HP ini belum mendukung Web NFC (misal iOS atau laptop). Silakan ketik kode ID Stiker NFC secara manual lalu klik Simpan.';
        setNfcHint(msg);
        onToast('info', msg);
        return;
      }

      const NDEFReaderCtor = getNdefReaderConstructor();
      if (!NDEFReaderCtor) {
        const msg =
          'Sensor Web NFC tidak tersedia. Masukkan ID Stiker NFC secara manual lalu klik Simpan.';
        setNfcHint(msg);
        onToast('info', msg);
        return;
      }

      const controller = new AbortController();
      nfcAbortRef.current = controller;
      const ndef = new NDEFReaderCtor();

      ndef.addEventListener(
        'readingerror',
        () => {
          setNfcHint(
            'Tag terdeteksi tetapi gagal dibaca. Tempelkan ulang stiker NFC NTAG213/215/216 di belakang HP.'
          );
        },
        { signal: controller.signal }
      );

      ndef.addEventListener(
        'reading',
        (event) => {
          const { uid, rawSerialNumber } = extractNfcReadingData(event);
          const captured = normalizeNfcUid(rawSerialNumber || uid || '');
          stopNfcCapture();
          if (!captured) {
            onToast('error', 'Nomor seri stiker NFC tidak terbaca. Coba tempelkan ulang.');
            return;
          }
          playScanSuccessFeedback();
          const updated: PatrolCheckpoint = { ...item, nfc_tag_id: captured };
          updateRowField(item.order_index, { nfc_tag_id: captured });
          setNfcHint(`ID Stiker NFC Pos ${item.order_index} berhasil direkam: ${captured}`);
          void persistCheckpoint(
            updated,
            `ID Stiker NFC Pos ${item.order_index} (${captured}) langsung tersimpan!`
          );
        },
        { signal: controller.signal }
      );

      setScanningNfcId(item.id);
      setNfcHint(`Menunggu stiker NFC untuk Pos ${item.order_index} — tempelkan HP ke stiker sekarang...`);
      await ndef.scan({ signal: controller.signal });
    } catch (err) {
      stopNfcCapture();
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = describeWebNfcError(err);
      setNfcHint(msg);
      onToast('error', msg);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kalibrasi Lokasi 5 Pos dan ID NFC"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="bg-white w-full sm:max-w-2xl max-h-[90vh] rounded-t-3xl sm:rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 bg-[#0F172A] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold truncate">
                Kalibrasi Lokasi 5 Pos &amp; ID NFC
              </h2>
              <p className="text-[11px] text-slate-300 truncate">
                Berdiri di tiap pos perumahan, ketuk 1 tombol untuk menyimpan GPS &amp; stiker NFC
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopNfcCapture();
              onClose();
            }}
            className="w-9 h-9 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Tutup modal kalibrasi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 flex-1 bg-slate-50">
          {gpsErrorInfo && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-900 space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{gpsErrorInfo.title}</span>
              </p>
              <p>{gpsErrorInfo.message}</p>
              <p className="text-red-800 bg-white/80 rounded-lg px-2.5 py-1.5 border border-red-100 leading-relaxed">
                {gpsErrorInfo.guide}
              </p>
            </div>
          )}

          {nfcHint && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 flex items-start gap-2">
              <Radio className="w-4 h-4 text-[#059669] shrink-0 mt-0.5" />
              <span className="leading-relaxed">{nfcHint}</span>
            </div>
          )}

          {!nfcSupported && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[11px] text-amber-900">
              Web NFC hanya aktif di Chrome Android (HTTPS). Di perangkat ini Anda tetap bisa
              kalibrasi GPS otomatis atau mengetik ID Stiker NFC secara manual.
            </div>
          )}

          {rows.map((item) => {
            const isLocating = locatingId === item.id;
            const isScanning = scanningNfcId === item.id;
            const isSaving = savingId === item.id;

            return (
              <div
                key={item.order_index}
                className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-[#0F172A] text-white text-xs font-mono font-bold flex items-center justify-center shrink-0">
                      {item.order_index}
                    </span>
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateRowField(item.order_index, { name: e.target.value })}
                      className="min-w-0 flex-1 text-sm font-bold text-[#0F172A] bg-transparent border-b border-transparent focus:border-emerald-500 focus:outline-none py-0.5"
                      aria-label={`Nama Pos ${item.order_index}`}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() =>
                      void persistCheckpoint(
                        item,
                        `Perubahan Pos ${item.order_index} berhasil disimpan.`
                      )
                    }
                    className="min-h-[34px] px-3 rounded-lg bg-[#059669] hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    {isSaving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Simpan</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      ID Stiker NFC
                    </label>
                    <input
                      type="text"
                      value={item.nfc_tag_id}
                      onChange={(e) =>
                        updateRowField(item.order_index, { nfc_tag_id: e.target.value })
                      }
                      placeholder={`NFC-POS-0${item.order_index}`}
                      className="w-full min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-2.5 font-mono text-xs text-[#0F172A] focus:bg-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Latitude (GPS)
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      value={item.lat}
                      onChange={(e) =>
                        updateRowField(item.order_index, { lat: Number(e.target.value) })
                      }
                      className="w-full min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-2.5 font-mono tabular-nums text-xs text-[#0F172A] focus:bg-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Longitude (GPS)
                    </label>
                    <input
                      type="number"
                      step="0.000001"
                      value={item.lng}
                      onChange={(e) =>
                        updateRowField(item.order_index, { lng: Number(e.target.value) })
                      }
                      className="w-full min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-2.5 font-mono tabular-nums text-xs text-[#0F172A] focus:bg-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Tombol Aksi Cepat 1-Klik */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isLocating || isSaving}
                    onClick={() => handleUseCurrentGps(item)}
                    className="min-h-[40px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-60 text-emerald-900 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                  >
                    {isLocating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : (
                      <Crosshair className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>
                      {isLocating ? 'Mengambil GPS...' : 'Gunakan Lokasi GPS Saya Saat Ini'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => void handleRecordNfcTag(item)}
                    className={`min-h-[40px] px-3 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                      isScanning
                        ? 'bg-sky-600 border-sky-600 text-white animate-pulse'
                        : 'bg-slate-900 hover:bg-slate-800 border-slate-900 text-white'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isScanning ? 'Tempelkan Stiker NFC... (Batal)' : 'Rekam ID Stiker NFC'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#059669] shrink-0" />
            <span>Tersimpan langsung ke tabel patrol_checkpoints Supabase.</span>
          </p>
          <button
            type="button"
            onClick={() => {
              stopNfcCapture();
              onClose();
            }}
            className="min-h-[38px] px-4 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 text-xs font-bold text-[#0F172A] cursor-pointer"
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}
