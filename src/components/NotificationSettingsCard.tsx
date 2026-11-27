import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCircle2,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Smartphone,
  Vibrate,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { SessionUser } from '../types';
import {
  ANDROID_NOTIFICATION_CHANNEL_ID,
  checkOsNotificationPermission,
  getNativePushRuntimeInfo,
  pollUnreadNotificationsNow,
  requestOsNotificationPermission,
  sendAdminTestPushNotification,
  subscribePushRuntimeInfoChange,
  syncNativePushTokenForSession,
  triggerTestNotificationAlert,
  useNotificationPreferences,
  type OsNotificationPermissionState,
} from '../lib/notificationAlertService';
import { LoadingSpinner } from './LoadingSpinner';

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
  const [pushInfo, setPushInfo] = useState(() => getNativePushRuntimeInfo());
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncingFallback, setSyncingFallback] = useState(false);
  const [sendingServerPush, setSendingServerPush] = useState<'self' | 'broadcast' | null>(null);
  const [lastServerResult, setLastServerResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const refreshPermission = useCallback(async () => {
    const next = await checkOsNotificationPermission();
    setPermission(next);
    setPushInfo(getNativePushRuntimeInfo());
  }, []);

  useEffect(() => {
    void refreshPermission();
    const onFocus = () => void refreshPermission();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshPermission();
      }
    };
    const unsubscribeRuntime = subscribePushRuntimeInfoChange(() => {
      setPushInfo(getNativePushRuntimeInfo());
    });
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribeRuntime();
    };
  }, [refreshPermission]);

  const handleManualBackgroundSync = async () => {
    if (syncingFallback) return;
    setSyncingFallback(true);
    try {
      const res = await pollUnreadNotificationsNow(session, { force: true });
      setPushInfo(getNativePushRuntimeInfo());
      if (!res.checked) {
        onToast?.('info', 'Tidak dapat memeriksa server sekarang. Pastikan koneksi internet aktif.');
      } else if (res.newCount > 0) {
        onToast?.('success', `${res.newCount} notifikasi baru ditemukan dan telah disinkronkan.`);
      } else if (res.unreadCount > 0) {
        onToast?.('info', `Tersinkron: ada ${res.unreadCount} notifikasi belum dibaca di lonceng.`);
      } else {
        onToast?.('success', 'Notifikasi sudah terbaru. Tidak ada notifikasi baru yang belum dibaca.');
      }
    } finally {
      setSyncingFallback(false);
    }
  };

  const handleRequestPermission = async () => {
    if (requestingPerm) return;
    setRequestingPerm(true);
    try {
      const next = await requestOsNotificationPermission();
      setPermission(next);
      setPref({ permissionPromptDismissed: true });
      if (next === 'granted') {
        void syncNativePushTokenForSession(session).finally(() => {
          setPushInfo(getNativePushRuntimeInfo());
        });
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
      setPushInfo(getNativePushRuntimeInfo());

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

  const handleAdminServerPushTest = async (mode: 'self' | 'broadcast') => {
    if (sendingServerPush || session.role !== 'admin') return;
    setSendingServerPush(mode);
    setLastServerResult(null);
    try {
      const res = await sendAdminTestPushNotification(session, mode);
      setPushInfo(getNativePushRuntimeInfo());
      setLastServerResult({ ok: res.ok && !res.skipped, message: res.message });
      onToast?.(res.ok && !res.skipped ? 'success' : 'info', res.message);
    } finally {
      setSendingServerPush(null);
    }
  };

  const permBadge =
    permission === 'granted'
      ? {
          label: 'Aktif',
          className: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
        }
      : permission === 'denied'
        ? {
            label: 'Diblokir',
            className: 'bg-[#C87058]/15 text-[#7A311E] border-[#E2A898]',
          }
        : permission === 'unsupported'
          ? {
              label: 'Browser Terbatas',
              className: 'bg-[#F7F4EC] text-[#4A554A] border-[#E6E2D6]',
            }
          : {
              label: 'Belum Diizinkan',
              className: 'bg-[#F2D8A7]/45 text-[#4A3410] border-[#E2C285]',
            };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className={`${compact ? 'text-sm' : 'text-base'} font-bold text-[#1B271B]`}>
              Notifikasi, Suara &amp; Getaran
            </h3>
            <p className="text-xs text-[#6E786D] mt-0.5 leading-relaxed">
              Atur bunyi lonceng, getaran, dan push notification real-time (Android, iOS, &amp; Web).
            </p>
          </div>
        </div>
      </div>

      {/* Daftar Sakelar Pengaturan */}
      <div className="divide-y divide-[#E6E2D6] rounded-2xl border border-[#E6E2D6] bg-[#F7F4EC] overflow-hidden">
        {/* 1. Suara Notifikasi */}
        <div className="px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#FFFDF8] border border-[#E6E2D6] flex items-center justify-center text-[#243825] shrink-0">
              {prefs.soundEnabled ? (
                <Volume2 className="w-4 h-4" />
              ) : (
                <VolumeX className="w-4 h-4 text-[#6E786D]" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#1B271B]">Suara Notifikasi</p>
              <p className="text-[11px] text-[#6E786D] leading-snug">
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
              prefs.soundEnabled ? 'bg-[#2B3F29]' : 'bg-[#C6D2BF]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-[#FFFDF8] shadow-xs transition-transform ${
                prefs.soundEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 2. Getaran Notifikasi */}
        <div className="px-3.5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#FFFDF8] border border-[#E6E2D6] flex items-center justify-center text-[#243825] shrink-0">
              <Vibrate className={`w-4 h-4 ${prefs.vibrationEnabled ? '' : 'text-[#6E786D]'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#1B271B]">Getaran (Vibration)</p>
              <p className="text-[11px] text-[#6E786D] leading-snug">
                Pola getar HP saat notifikasi masuk di aplikasi Android, iOS, maupun Web.
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
              prefs.vibrationEnabled ? 'bg-[#2B3F29]' : 'bg-[#C6D2BF]'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-[#FFFDF8] shadow-xs transition-transform ${
                prefs.vibrationEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 3. Status Izin Pop-up Sistem HP */}
        <div className="px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#FFFDF8] border border-[#E6E2D6] flex items-center justify-center text-[#243825] shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-xs sm:text-sm font-semibold text-[#1B271B]">
                  Pop-up Status Bar &amp; Push FCM
                </p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${permBadge.className}`}
                >
                  {permission === 'granted' ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : permission === 'denied' ? (
                    <ShieldAlert className="w-3 h-3" />
                  ) : null}
                  {permBadge.label}
                </span>
                {pushInfo.isBackgroundSyncFallback && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[#E2C285] bg-[#F2D8A7]/45 px-2 py-0.5 text-[10px] font-bold text-[#4A3410]">
                    <RefreshCw className="w-3 h-3" />
                    Background Sync Fallback
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#6E786D] leading-snug mt-0.5">
                {pushInfo.isBackgroundSyncFallback
                  ? 'Perangkat non-GMS / Huawei aktif menggunakan mode Background Sync Fallback: mengecek notifikasi otomatis saat layar menyala, aplikasi dibuka, atau koneksi pulih.'
                  : permission === 'granted'
                    ? pushInfo.isNative
                      ? `Channel ${ANDROID_NOTIFICATION_CHANNEL_ID} aktif (${pushInfo.hasFcmToken ? 'Token FCM tersinkron' : 'Notifikasi Lokal aktif'}).`
                      : pushInfo.hasFcmToken
                        ? 'Web Push FCM aktif (Chrome/Safari siap menerima notifikasi background).'
                        : 'Notifikasi pop-up Browser siap tampil dengan suara & getar bawaan.'
                    : permission === 'denied'
                      ? 'Izin diblokir. Buka Pengaturan HP/Browser lalu izinkan Notifikasi untuk aplikasi ini.'
                      : permission === 'unsupported'
                        ? 'Browser ini tidak mendukung pop-up sistem, namun bunyi & lonceng aplikasi tetap aktif.'
                        : 'Izinkan pop-up agar pemberitahuan muncul di atas layar HP dan saat aplikasi ditutup.'}
              </p>
            </div>
          </div>

          {permission === 'prompt' && (
            <button
              type="button"
              disabled={requestingPerm}
              onClick={() => void handleRequestPermission()}
              className="min-h-[38px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-50 text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer shrink-0 whitespace-nowrap shadow-xs"
            >
              {requestingPerm ? (
                <LoadingSpinner size="xs" tone="white" />
              ) : (
                <Bell className="w-3.5 h-3.5" />
              )}
              <span>Izinkan Pop-up</span>
            </button>
          )}
        </div>

        {/* 4. Indikator Khusus Mode Background Sync Fallback (Huawei / Non-GMS) */}
        {pushInfo.isBackgroundSyncFallback && (
          <div className="px-3.5 py-3 bg-[#F2D8A7]/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-[#FFFDF8] border border-[#E2C285] flex items-center justify-center text-[#6E4D12] shrink-0">
                <RefreshCw className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#4A3410]">
                  Mode Background Sync Fallback Aktif
                </p>
                <p className="text-[11px] text-[#6E4D12] leading-snug mt-0.5">
                  Token FCM Google Play Services tidak tersedia di perangkat ini. Aplikasi otomatis
                  menggunakan{' '}
                  {pushInfo.periodicSyncRegistered
                    ? 'Periodic Background Sync & pengecekan otomatis saat layar menyala.'
                    : 'sinkronisasi otomatis saat layar menyala, kembali fokus, atau koneksi internet pulih.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={syncingFallback}
              onClick={() => void handleManualBackgroundSync()}
              className="min-h-[36px] px-3.5 rounded-full border border-[#E2C285] bg-[#FFFDF8] hover:bg-[#F2D8A7]/40 disabled:opacity-60 text-[#4A3410] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0 whitespace-nowrap"
            >
              {syncingFallback ? (
                <LoadingSpinner size="xs" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>{syncingFallback ? 'Memeriksa...' : 'Cek Sekarang'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Tombol Uji Coba Bunyi, Getaran & Pop-up Lokal */}
      <button
        type="button"
        disabled={testing}
        onClick={() => void handleTestNotification()}
        className="w-full min-h-[44px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-70 text-[#FFFDF8] font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] cursor-pointer shadow-sm"
      >
        {testing ? (
          <LoadingSpinner size="xs" tone="white" />
        ) : (
          <BellRing className="w-4 h-4" />
        )}
        <span>{testing ? 'Mengirim Tes Notifikasi...' : 'Tes Bunyi, Getar & Pop-up Notifikasi'}</span>
      </button>

      {/* Panel Khusus Admin: Tes Kirim Notifikasi Server FCM (Perangkat Sendiri / Broadcast) */}
      {session.role === 'admin' && (
        <div className="glass-card rounded-2xl border border-[#E6E2D6] p-4 space-y-3">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-[#243825] text-[#E5EEE3] flex items-center justify-center shrink-0">
              <Radio className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-bold text-[#1B271B]">
                Tes Kirim Notifikasi (Server FCM)
              </p>
              <p className="text-[11px] text-[#6E786D] leading-snug mt-0.5">
                Uji pengiriman Push Notification asli melalui Edge Function{' '}
                <span className="font-mono text-[#243825]">send-push-notification</span> tanpa
                membuat transaksi palsu.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              disabled={sendingServerPush !== null}
              onClick={() => void handleAdminServerPushTest('self')}
              className="min-h-[42px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap shadow-xs"
            >
              {sendingServerPush === 'self' ? (
                <LoadingSpinner size="xs" tone="white" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>
                {sendingServerPush === 'self' ? 'Mengirim...' : 'Tes ke Perangkat Sendiri'}
              </span>
            </button>

            <button
              type="button"
              disabled={sendingServerPush !== null}
              onClick={() => void handleAdminServerPushTest('broadcast')}
              className="min-h-[42px] px-4 rounded-full border border-[#C6D2BF] bg-[#E5EEE3] hover:bg-[#D5E4D2] disabled:opacity-60 text-[#243825] text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
            >
              {sendingServerPush === 'broadcast' ? (
                <LoadingSpinner size="xs" />
              ) : (
                <Radio className="w-3.5 h-3.5" />
              )}
              <span>
                {sendingServerPush === 'broadcast'
                  ? 'Mengirim Broadcast...'
                  : 'Broadcast Tes (Semua Perangkat)'}
              </span>
            </button>
          </div>

          {lastServerResult && (
            <p
              className={`text-[11px] leading-relaxed rounded-2xl border px-3 py-2 ${
                lastServerResult.ok
                  ? 'bg-[#E5EEE3] border-[#C6D2BF] text-[#243825]'
                  : 'bg-[#F2D8A7]/45 border-[#E2C285] text-[#4A3410]'
              }`}
            >
              {lastServerResult.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
