import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
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
import { UserAvatar } from './UserAvatar';

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
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    void loadNotifications(false);
    const unsub = subscribeActivityNotificationsRealtime(session, () => {
      void loadNotifications(true);
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadNotifications(true);
      }
    }, 30000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [session, loadNotifications]);

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
      void loadNotifications(true);
    }
  };

  const handleMarkAllRead = async () => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    // Optimistic update
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
        className={`relative w-10 h-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${buttonTheme}`}
      >
        <Bell className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold font-mono leading-none flex items-center justify-center shadow-xs ring-2 ring-white tabular-nums">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Backdrop khusus HP agar tampil sebagai drawer overlay tanpa menggeser header */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="sm:hidden fixed inset-0 z-[55] bg-slate-950/45 backdrop-blur-[1px]"
          />

          <section
            role="dialog"
            aria-label="Notifikasi Aktivitas"
            className="fixed sm:absolute left-3 right-3 top-[calc(4rem+env(safe-area-inset-top,0px)+0.5rem)] sm:left-auto sm:right-0 sm:top-full sm:mt-2 z-[60] sm:w-[400px] max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75dvh]"
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

            {/* Filter Kategori Cepat */}
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto bg-white shrink-0">
              {FILTER_TABS.map((tab) => {
                const isActive = filter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[#059669] text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-[#0F172A]'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Daftar Aktivitas */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loading ? (
                <div className="py-10 flex flex-col items-center justify-center gap-2 text-slate-500">
                  <Loader2 className="w-5 h-5 animate-spin text-[#059669]" />
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
