import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  CheckCheck,
  CreditCard,
  Loader2,
  Megaphone,
  Settings,
  ShieldAlert,
  Wallet,
  X,
  Inbox,
} from 'lucide-react';
import type {
  ActivityNotification,
  ActivityNotificationCategory,
  SessionUser,
} from '../types';
import {
  fetchActivityNotifications,
  formatRelativeTimeId,
  markActivityNotificationRead,
  markAllActivityNotificationsRead,
  subscribeActivityNotificationsRealtime,
} from '../lib/notificationService';
import {
  checkOsNotificationPermission,
  ensureAndroidNotificationChannel,
  initNotificationAudioUnlock,
  registerOsNotificationTapListener,
  requestOsNotificationPermission,
  subscribeBellShakeEvent,
  triggerIncomingNotificationAlert,
  useNotificationPreferences,
  type OsNotificationPermissionState,
} from '../lib/notificationAlertService';
import { UserAvatar } from './UserAvatar';
import { LoadingSpinner } from './LoadingSpinner';

type FilterTab = 'all' | 'finance_ipl' | 'patrol' | 'info_system';

interface NotificationBellProps {
  session: SessionUser;
  variant?: 'light' | 'dark';
  onNavigateTarget?: (targetUrl: string) => void;
}

const FILTER_TABS: Array<{ id: FilterTab; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'finance_ipl', label: 'Keuangan/IPL' },
  { id: 'patrol', label: 'Keamanan/Patroli' },
  { id: 'info_system', label: 'Info/Sistem' },
];

function getCategoryVisual(category: ActivityNotificationCategory) {
  switch (category) {
    case 'ipl':
      return {
        icon: CreditCard,
        bg: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        label: 'IPL',
      };
    case 'finance':
      return {
        icon: Wallet,
        bg: 'bg-teal-100 text-teal-700 border-teal-200',
        label: 'Kas',
      };
    case 'patrol':
      return {
        icon: ShieldAlert,
        bg: 'bg-amber-100 text-amber-700 border-amber-200',
        label: 'Patroli',
      };
    case 'announcement':
      return {
        icon: Megaphone,
        bg: 'bg-sky-100 text-sky-700 border-sky-200',
        label: 'Pengumuman',
      };
    default:
      return {
        icon: Settings,
        bg: 'bg-slate-100 text-slate-700 border-slate-200',
        label: 'Sistem',
      };
  }
}

export function NotificationBell({
  session,
  variant = 'light',
  onNavigateTarget,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [items, setItems] = useState<ActivityNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [bellShaking, setBellShaking] = useState(false);
  const [osPermission, setOsPermission] = useState<OsNotificationPermissionState>('granted');
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [showFloatingPrompt, setShowFloatingPrompt] = useState(false);

  const { prefs, setPref } = useNotificationPreferences();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const shakeTimerRef = useRef<number | null>(null);

  const triggerBellShake = useCallback(() => {
    setBellShaking(false);
    window.requestAnimationFrame(() => {
      setBellShaking(true);
      if (shakeTimerRef.current) {
        window.clearTimeout(shakeTimerRef.current);
      }
      shakeTimerRef.current = window.setTimeout(() => {
        setBellShaking(false);
      }, 1250);
    });
  }, []);

  const loadNotifications = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const list = await fetchActivityNotifications(session);
        setItems(list);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [session]
  );

  // Inisialisasi Web Audio unlock, Android Notification Channel, cek izin, & listener ketukan OS notification
  useEffect(() => {
    initNotificationAudioUnlock();
    void ensureAndroidNotificationChannel();

    let mounted = true;
    const initPerm = async () => {
      const perm = await checkOsNotificationPermission();
      if (!mounted) return;
      setOsPermission(perm);
      if (perm === 'prompt' && !prefs.permissionPromptDismissed) {
        // Tunda sebentar agar tampilan utama selesai render dengan halus
        window.setTimeout(() => {
          if (mounted) setShowFloatingPrompt(true);
        }, 1600);
      }
    };
    void initPerm();

    const unsubShake = subscribeBellShakeEvent(() => {
      triggerBellShake();
    });
    const unsubTap = registerOsNotificationTapListener((targetUrl) => {
      if (targetUrl && onNavigateTarget) {
        onNavigateTarget(targetUrl);
      }
    });

    return () => {
      mounted = false;
      unsubShake();
      unsubTap();
      if (shakeTimerRef.current) {
        window.clearTimeout(shakeTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onNavigateTarget, triggerBellShake]);

  // Sinkronisasi Realtime Supabase + polling berkala
  useEffect(() => {
    void loadNotifications(false);
    const unsub = subscribeActivityNotificationsRealtime(
      session,
      () => {
        void loadNotifications(true);
      },
      (insertedNotif) => {
        setItems((prev) => {
          if (prev.some((n) => n.id === insertedNotif.id)) return prev;
          return [insertedNotif, ...prev].slice(0, 80);
        });
        triggerBellShake();
        void triggerIncomingNotificationAlert(insertedNotif);
      }
    );
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadNotifications(true);
      }
    }, 30000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [session, loadNotifications, triggerBellShake]);

  // Tutup panel saat klik luar (desktop) atau tekan Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items]);

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'finance_ipl') {
      return items.filter((n) => n.category === 'ipl' || n.category === 'finance');
    }
    if (filter === 'patrol') {
      return items.filter((n) => n.category === 'patrol');
    }
    return items.filter((n) => n.category === 'announcement' || n.category === 'system');
  }, [items, filter]);

  const handleToggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setShowFloatingPrompt(false);
      void loadNotifications(true);
      void checkOsNotificationPermission().then(setOsPermission);
    }
  };

  const handleAllowOsNotifications = async () => {
    if (requestingPerm) return;
    setRequestingPerm(true);
    try {
      const next = await requestOsNotificationPermission();
      setOsPermission(next);
      setShowFloatingPrompt(false);
      setPref({ permissionPromptDismissed: true });
    } finally {
      setRequestingPerm(false);
    }
  };

  const handleDismissPrompt = () => {
    setShowFloatingPrompt(false);
    setPref({ permissionPromptDismissed: true });
  };

  const handleMarkAllRead = async () => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await markAllActivityNotificationsRead(session, items);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleItemClick = async (notif: ActivityNotification) => {
    if (!notif.is_read) {
      setItems((prev) =>
        prev.map((item) => (item.id === notif.id ? { ...item, is_read: true } : item))
      );
      void markActivityNotificationRead(session, notif);
    }
    setOpen(false);
    if (notif.target_url && onNavigateTarget) {
      onNavigateTarget(notif.target_url);
    }
  };

  const buttonTheme =
    variant === 'dark'
      ? 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
      : 'bg-slate-50 hover:bg-emerald-50 hover:border-emerald-200 text-[#0F172A] border-slate-200';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-label={`Notifikasi aktivitas${unreadCount > 0 ? ` (${unreadCount} belum dibaca)` : ''}`}
        aria-expanded={open}
        className={`relative w-10 h-10 rounded-xl border flex items-center justify-center transition-all duration-200 active:scale-[0.95] cursor-pointer shrink-0 ${buttonTheme}`}
      >
        {bellShaking ? (
          <BellRing className="w-[18px] h-[18px] text-[var(--theme-primary)] animate-bell-shake" />
        ) : (
          <Bell className="w-[18px] h-[18px]" />
        )}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold font-mono leading-none flex items-center justify-center shadow-xs ring-2 ring-white tabular-nums">
            {bellShaking && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-75"
              />
            )}
            <span className="relative z-10">{unreadCount > 99 ? '99+' : unreadCount}</span>
          </span>
        )}
      </button>

      {/* Banner Izin Notifikasi Sopan Saat Pertama Kali Login (Non-Intrusif & Dapat Ditutup) */}
      {showFloatingPrompt && !open && osPermission === 'prompt' && !prefs.permissionPromptDismissed && (
        <div
          role="region"
          aria-label="Aktifkan notifikasi HP"
          className="fixed sm:absolute left-3 right-3 top-[calc(4rem+env(safe-area-inset-top,0px)+0.5rem)] sm:left-auto sm:right-0 sm:top-full sm:mt-2 z-[58] sm:w-[340px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-[var(--theme-primary-soft-border)] bg-white shadow-xl p-3.5 text-left animate-dropdown-pop"
        >
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[var(--theme-primary-soft)] text-[var(--theme-primary)] flex items-center justify-center shrink-0 mt-0.5">
              <BellRing className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#0F172A]">Aktifkan Notifikasi HP?</p>
              <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5">
                Dapatkan pop-up status bar, bunyi lonceng, dan getaran saat ada info IPL, kas, atau
                patroli baru.
              </p>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  disabled={requestingPerm}
                  onClick={() => void handleAllowOsNotifications()}
                  className="min-h-[32px] px-3 rounded-lg bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-hover)] text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer"
                >
                  {requestingPerm && <LoadingSpinner size="xs" tone="white" />}
                  <span>{requestingPerm ? 'Meminta izin...' : 'Aktifkan'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDismissPrompt}
                  className="min-h-[32px] px-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-semibold transition-all duration-200 active:scale-[0.97] cursor-pointer"
                >
                  Nanti Saja
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDismissPrompt}
              aria-label="Tutup tawaran izin notifikasi"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {open && (
        <>
          {/* Backdrop khusus HP agar tampil sebagai drawer overlay tanpa menggeser header */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="sm:hidden fixed inset-0 z-[55] bg-slate-950/45 backdrop-blur-[1px] animate-modal-backdrop"
          />

          <section
            role="dialog"
            aria-label="Notifikasi Aktivitas"
            className="fixed sm:absolute left-3 right-3 top-[calc(4rem+env(safe-area-inset-top,0px)+0.5rem)] sm:left-auto sm:right-0 sm:top-full sm:mt-2 z-[60] sm:w-[400px] max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75dvh] animate-dropdown-pop"
          >
            {/* Header Panel Notifikasi */}
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/80 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold text-[#0F172A] truncate">Notifikasi</span>
                {unreadCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-red-100 text-red-700 text-[10px] font-mono font-bold tabular-nums shrink-0">
                    {unreadCount} baru
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  disabled={markingAll || unreadCount === 0}
                  onClick={() => void handleMarkAllRead()}
                  className="px-2 py-1 rounded-lg text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40 inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {markingAll ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5" />
                  )}
                  <span>Tandai semua sudah dibaca</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Tutup panel notifikasi"
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Strip Aktivasi Pop-up Notifikasi HP bila izin belum diberikan */}
            {osPermission === 'prompt' && (
              <div className="px-3.5 py-2.5 border-b border-emerald-200 bg-emerald-50/70 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <BellRing className="w-4 h-4 text-[var(--theme-primary)] shrink-0" />
                  <p className="text-[11px] font-medium text-[#0F172A] leading-snug">
                    Izinkan pop-up HP agar notifikasi muncul di status bar.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={requestingPerm}
                  onClick={() => void handleAllowOsNotifications()}
                  className="px-2.5 py-1 rounded-lg bg-[var(--theme-primary)] hover:bg-[var(--theme-primary-hover)] text-white text-[11px] font-bold shrink-0 cursor-pointer whitespace-nowrap"
                >
                  {requestingPerm ? '...' : 'Izinkan'}
                </button>
              </div>
            )}

            {/* Filter Kategori Cepat */}
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto bg-white shrink-0">
              {FILTER_TABS.map((tab) => {
                const isActive = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all duration-200 active:scale-[0.97] cursor-pointer ${
                      isActive
                        ? 'bg-[#059669] text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-[#0F172A]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Daftar Aktivitas */}
            <div key={filter} className="flex-1 overflow-y-auto divide-y divide-slate-100 animate-page-enter">
              {loading ? (
                <div className="py-10 flex flex-col items-center justify-center gap-2.5 text-slate-500">
                  <LoadingSpinner size="md" tone="theme" label="Memuat aktivitas terbaru" />
                  <span className="text-xs">Memuat aktivitas terbaru...</span>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="py-10 px-5 text-center space-y-1.5">
                  <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                    <Inbox className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-semibold text-slate-700">
                    Belum ada aktivitas terbaru
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Notifikasi pembayaran IPL, kas, patroli, dan pengumuman akan muncul otomatis di
                    sini.
                  </p>
                </div>
              ) : (
                filteredItems.map((notif) => {
                  const visual = getCategoryVisual(notif.category);
                  const Icon = visual.icon;
                  return (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => void handleItemClick(notif)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                        notif.is_read
                          ? 'bg-white hover:bg-slate-50'
                          : 'bg-emerald-50/45 hover:bg-emerald-50/80'
                      }`}
                    >
                      <div className="relative shrink-0 mt-0.5">
                        <div
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center ${visual.bg}`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        {notif.actor_name && (
                          <div className="absolute -bottom-1 -right-1">
                            <UserAvatar
                              name={notif.actor_name}
                              src={notif.actor_avatar_url}
                              size="xs"
                              className="w-4 h-4 text-[8px] ring-2 ring-white"
                            />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p
                            className={`text-xs leading-snug ${
                              notif.is_read
                                ? 'font-semibold text-slate-800'
                                : 'font-bold text-[#0F172A]'
                            }`}
                          >
                            {notif.title}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                              {formatRelativeTimeId(notif.created_at)}
                            </span>
                            {!notif.is_read && (
                              <span
                                aria-label="Belum dibaca"
                                className="w-2 h-2 rounded-full bg-[#059669] shrink-0"
                              />
                            )}
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-600 leading-relaxed mt-0.5 line-clamp-2">
                          {notif.message}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
