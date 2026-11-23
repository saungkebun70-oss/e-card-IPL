import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Smartphone,
  Vibrate,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { SessionUser } from '../types';
import {
  checkOsNotificationPermission,
  requestOsNotificationPermission,
  triggerTestNotificationAlert,
  useNotificationPreferences,
  type OsNotificationPermissionState,
} from '../lib/notificationAlertService';

interface NotificationSettingsCardProps {
  session: SessionUser;
  compact?: boolean;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function NotificationSettingsCard({
  session,
  compact = false,
  onToast,
}: NotificationSettingsCardProps) {
  const { prefs, setPref } = useNotificationPreferences();
  const [permission, setPermission] = useState<OsNotificationPermissionState>('prompt');
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [testing, setTesting] = useState(false);

  const refreshPermission = useCallback(async () => {
    const next = await checkOsNotificationPermission();
    setPermission(next);
  }, []);

  useEffect(() => {
    void refreshPermission();
    const onFocus = () => void refreshPermission();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshPermission]);

  const handleRequestPermission = async () => {
    if (requestingPerm) return;
    setRequestingPerm(true);
    try {
      const next = await requestOsNotificationPermission();
      setPermission(next);
      setPref({ permissionPromptDismissed: true });
      if (next === 'granted') {
        onToast?.(
          'success',
          'Izin pop-up notifikasi HP aktif! Anda akan menerima pemberitahuan real-time di status bar.'
        );
      } else if (next === 'denied') {
        onToast?.(
          'info',
          'Izin notifikasi ditolak. Anda dapat mengaktifkannya kembali melalui Pengaturan Aplikasi / Browser di HP.'
        );
      } else {
        onToast?.('info', 'Browser/perangkat ini belum mendukung pop-up notifikasi sistem.');
      }
    } finally {
      setRequestingPerm(false);
    }
  };

  const handleTestNotification = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const res = await triggerTestNotificationAlert(session);
      setPermission(res.permission);

      const activeParts: string[] = [];
      if (prefs.soundEnabled && res.soundPlayed) activeParts.push('bunyi lonceng');
      if (prefs.vibrationEnabled) activeParts.push('getaran');
      if (res.osPopupShown) activeParts.push('pop-up sistem HP');

      if (!prefs.soundEnabled && !prefs.vibrationEnabled && !res.osPopupShown) {
        onToast?.(
          'info',
          'Suara & getaran sedang nonaktif. Aktifkan sakelar di atas untuk menguji bunyi dan getaran.'
        );
      } else if (activeParts.length > 0) {
        onToast?.(
          'success',
          `Tes notifikasi terkirim (${activeParts.join(', ')}). Perhatikan ikon lonceng & status bar HP Anda.`
        );
      } else {
        onToast?.(
          'info',
          'Ikon lonceng telah diuji. Pastikan volume media/notifikasi HP Anda tidak dalam mode senyap.'
        );
      }
    } finally {
      window.setTimeout(() => setTesting(false), 650);
    }
  };

  const permBadge =
    permission === 'granted'
      ? {
          label: 'Aktif',
          className: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        }
      : permission === 'denied'
        ? {
            label: 'Diblokir',
            className: 'bg-red-50 text-red-700 border-red-200',
          }
        : permission === 'unsupported'
          ? {
              label: 'Browser Terbatas',
              className: 'bg-slate-100 text-slate-600 border-slate-200',
            }
          : {
              label: 'Belum Diizinkan',
              className: 'bg-amber-50 text-amber-700 border-amber-200',
            };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[var(--theme-primary-soft)] border border-[var(--theme-primary-soft-border)] text-[var(--theme-primary)] flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className={`${compact ? 'text-sm' : 'text-base'} font-bold text-[#0F172A]`}>
              Notifikasi, Suara &amp; Getaran
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Atur bunyi lonceng, getaran, dan pop-up status bar HP untuk notifikasi real-time.
            </p>
          </div>
        </div>
      </div>

      {/* Daftar Sakelar Pengaturan */}
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
        {/* 1. Suara Notifikasi */}
        <div className="px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[var(--theme-primary)] shrink-0">
              {prefs.soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#0F172A]">Suara Notifikasi</p>
              <p className="text-[11px] text-slate-500 leading-snug">
                Bunyi lonceng jernih saat ada pembayaran, patroli, atau info baru.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.soundEnabled}
            aria-label="Aktifkan suara notifikasi"
            onClick={() => {
              const nextVal = !prefs.soundEnabled;
              setPref({ soundEnabled: nextVal });
              onToast?.(
                'info',
                nextVal ? 'Suara notifikasi diaktifkan.' : 'Suara notifikasi dimatikan.'
              );
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
              prefs.soundEnabled ? 'bg-[var(--theme-primary)]' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                prefs.soundEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 2. Getaran Notifikasi */}
        <div className="px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[var(--theme-primary)] shrink-0">
              <Vibrate className={`w-4 h-4 ${prefs.vibrationEnabled ? '' : 'text-slate-400'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#0F172A]">Getaran (Vibration)</p>
              <p className="text-[11px] text-slate-500 leading-snug">
                Pola getar HP saat notifikasi masuk di aplikasi Android maupun Web.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.vibrationEnabled}
            aria-label="Aktifkan getaran notifikasi"
            onClick={() => {
              const nextVal = !prefs.vibrationEnabled;
              setPref({ vibrationEnabled: nextVal });
              onToast?.(
                'info',
                nextVal ? 'Getaran notifikasi diaktifkan.' : 'Getaran notifikasi dimatikan.'
              );
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
              prefs.vibrationEnabled ? 'bg-[var(--theme-primary)]' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition-transform ${
                prefs.vibrationEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 3. Status Izin Pop-up Sistem HP */}
        <div className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[var(--theme-primary)] shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs sm:text-sm font-semibold text-[#0F172A]">
                  Pop-up Status Bar HP
                </p>
                <span
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${permBadge.className}`}
                >
                  {permission === 'granted' ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : permission === 'denied' ? (
                    <ShieldAlert className="w-3 h-3" />
                  ) : null}
                  {permBadge.label}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                {permission === 'granted'
                  ? 'Notifikasi pop-up Android & Browser siap tampil dengan suara & getar bawaan.'
                  : permission === 'denied'
                    ? 'Izin diblokir. Buka Pengaturan HP/Browser lalu izinkan Notifikasi untuk aplikasi ini.'
                    : permission === 'unsupported'
                      ? 'Browser ini tidak mendukung pop-up sistem, namun bunyi & lonceng aplikasi tetap aktif.'
                      : 'Izinkan pop-up agar pemberitahuan muncul di atas layar HP seperti aplikasi Android.'}
              </p>
            </div>
          </div>

          {permission === 'prompt' && (
            <button
              type="button"
              disabled={requestingPerm}
              onClick={() => void handleRequestPermission()}
              className="min-h-[36px] px-3 rounded-xl bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
            >
              {requestingPerm ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Bell className="w-3.5 h-3.5" />
              )}
              <span>Izinkan Pop-up</span>
            </button>
          )}
        </div>
      </div>

      {/* Tombol Uji Coba Bunyi, Getaran & Pop-up */}
      <button
        type="button"
        disabled={testing}
        onClick={() => void handleTestNotification()}
        className="w-full min-h-[44px] px-4 rounded-xl bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-hover)] disabled:opacity-70 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
      >
        {testing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <BellRing className="w-4 h-4" />
        )}
        <span>{testing ? 'Mengirim Tes Notifikasi...' : 'Tes Bunyi & Getaran Notifikasi'}</span>
      </button>
    </div>
  );
}
