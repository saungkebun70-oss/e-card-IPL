import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  BellRing,
  CheckCheck,
  CreditCard,
  Inbox,
  Megaphone,
  Settings,
  ShieldAlert,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import type {
  ActivityNotification,
  ActivityNotificationCategory,
  SessionUser,
} from '../types';
import {
  buildNotificationContentSignature,
  deduplicateNotifications,
  deleteAllNotifications,
  deleteNotification,
  fetchActivityNotifications,
  fetchUnreadNotificationCount,
  formatRelativeTimeId,
  getCanonicalUserId,
  getSessionSeenNotificationIds,
  getSessionSeenNotificationSignatures,
  isNotificationMatchingSession,
  markActivityNotificationRead,
  markAllActivityNotificationsRead,
  subscribeActivityNotificationsRealtime,
  triggerDeviceAlert,
} from '../lib/notificationService';
import {
  checkOsNotificationPermission,
  ensureAndroidNotificationChannel,
  initNativeNotificationsOnLaunch,
  initNotificationAudioUnlock,
  registerOsNotificationTapListener,
  requestOsNotificationPermission,
  shouldSuppressOsPopupWhenFcmActive,
  subscribeBellShakeEvent,
  syncAppIconBadge,
  syncNativePushTokenForSession,
  useNotificationPreferences,
  type OsNotificationPermissionState,
} from '../lib/notificationAlertService';
import { UserAvatar } from './UserAvatar';
import { LoadingSpinner } from './LoadingSpinner';

type FilterTab = 'all' | 'finance_ipl' | 'patrol' | 'info_system';

export interface NotificationBellProps {
  session: SessionUser;
  variant?: 'light' | 'dark';
  className?: string;
  externalUnreadCount?: number;
  onUnreadCountChange?: (count: number) => void;
  onNavigateTarget?: (targetUrl: string) => void;
}

const FILTER_TABS: Array<{ id: FilterTab; label: string; shortLabel: string }> = [
  { id: 'all', label: 'Semua', shortLabel: 'Semua' },
  { id: 'finance_ipl', label: 'Keuangan/IPL', shortLabel: 'IPL & Kas' },
  { id: 'patrol', label: 'Keamanan/Patroli', shortLabel: 'Patroli' },
  { id: 'info_system', label: 'Info/Sistem', shortLabel: 'Info' },
];

const SWIPE_LOCK_THRESHOLD = 8;
const SWIPE_DELETE_THRESHOLD = 85;

function getCategoryVisual(category: ActivityNotificationCategory) {
  switch (category) {
    case 'ipl':
      return {
        icon: CreditCard,
        bg: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
        label: 'IPL',
      };
    case 'finance':
      return {
        icon: Wallet,
        bg: 'bg-[#E5EEE3] text-[#2B3F29] border-[#C6D2BF]',
        label: 'Kas',
      };
    case 'patrol':
      return {
        icon: ShieldAlert,
        bg: 'bg-[#F2D8A7]/50 text-[#4A3410] border-[#E2C285]',
        label: 'Patroli',
      };
    case 'announcement':
      return {
        icon: Megaphone,
        bg: 'bg-[#E5EEE3]/75 text-[#384E35] border-[#C6D2BF]',
        label: 'Pengumuman',
      };
    default:
      return {
        icon: Settings,
        bg: 'bg-[#E5EEE3] text-[#243825] border-[#C6D2BF]',
        label: 'Sistem',
      };
  }
}

interface SwipeableNotificationItemProps {
  notif: ActivityNotification;
  deleting: boolean;
  onSelect: (notif: ActivityNotification) => void;
  onDelete: (notif: ActivityNotification) => void;
}

function SwipeableNotificationItem({
  notif,
  deleting,
  onSelect,
  onDelete,
}: SwipeableNotificationItemProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [dismissDirection, setDismissDirection] = useState<'left' | 'right' | null>(null);

  const gestureRef = useRef({
    active: false,
    isTouch: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    lockedAxis: null as 'x' | 'y' | null,
    didSwipe: false,
    lastTouchEndAt: 0,
  });

  const visual = getCategoryVisual(notif.category);
  const Icon = visual.icon;

  const triggerDismiss = useCallback(
    (direction: 'left' | 'right') => {
      if (dismissDirection || deleting) return;
      setIsSwiping(false);
      setDismissDirection(direction);
      window.setTimeout(() => {
        onDelete(notif);
      }, 200);
    },
    [deleting, dismissDirection, notif, onDelete]
  );

  const finishSwipe = useCallback(
    (cancelled: boolean) => {
      const g = gestureRef.current;
      if (!g.active) return;

      const dx = g.lockedAxis === 'x' ? g.currentX - g.startX : 0;
      g.active = false;
      setIsSwiping(false);

      if (!cancelled && g.lockedAxis === 'x' && Math.abs(dx) >= SWIPE_DELETE_THRESHOLD) {
        triggerDismiss(dx < 0 ? 'left' : 'right');
      } else {
        setOffsetX(0);
      }

      if (g.didSwipe) {
        window.setTimeout(() => {
          gestureRef.current.didSwipe = false;
        }, 120);
      }
    },
    [triggerDismiss]
  );

  const handleTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (dismissDirection || deleting) return;
    if ((e.target as HTMLElement | null)?.closest('[data-no-swipe="true"]')) return;
    const touch = e.touches[0];
    if (!touch) return;

    gestureRef.current = {
      active: true,
      isTouch: true,
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      lockedAxis: null,
      didSwipe: false,
      lastTouchEndAt: gestureRef.current.lastTouchEndAt,
    };
  };

  const handleTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.active || !g.isTouch || dismissDirection || deleting) return;
    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - g.startX;
    const dy = touch.clientY - g.startY;

    if (g.lockedAxis === null) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_LOCK_THRESHOLD) {
        g.lockedAxis = 'x';
        g.didSwipe = true;
        setIsSwiping(true);
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_LOCK_THRESHOLD) {
        g.lockedAxis = 'y';
        g.active = false;
        return;
      } else {
        return;
      }
    }

    if (g.lockedAxis === 'x') {
      g.currentX = touch.clientX;
      setOffsetX(dx);
    }
  };

  const handleTouchEnd = () => {
    gestureRef.current.lastTouchEndAt = Date.now();
    finishSwipe(false);
  };

  const handleTouchCancel = () => {
    gestureRef.current.lastTouchEndAt = Date.now();
    finishSwipe(true);
  };

  const mouseCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      mouseCleanupRef.current?.();
      mouseCleanupRef.current = null;
    };
  }, []);

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || dismissDirection || deleting) return;
    if (Date.now() - gestureRef.current.lastTouchEndAt < 650) return;
    if ((e.target as HTMLElement | null)?.closest('[data-no-swipe="true"]')) return;

    mouseCleanupRef.current?.();

    gestureRef.current = {
      active: true,
      isTouch: false,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      lockedAxis: null,
      didSwipe: false,
      lastTouchEndAt: gestureRef.current.lastTouchEndAt,
    };

    const handleWindowMouseMove = (moveEvent: MouseEvent) => {
      const g = gestureRef.current;
      if (!g.active || g.isTouch) return;

      const dx = moveEvent.clientX - g.startX;
      const dy = moveEvent.clientY - g.startY;

      if (g.lockedAxis === null) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_LOCK_THRESHOLD) {
          g.lockedAxis = 'x';
          g.didSwipe = true;
          setIsSwiping(true);
        } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_LOCK_THRESHOLD) {
          g.lockedAxis = 'y';
          g.active = false;
          cleanupListeners();
          return;
        } else {
          return;
        }
      }

      if (g.lockedAxis === 'x') {
        g.currentX = moveEvent.clientX;
        setOffsetX(dx);
      }
    };

    const handleWindowMouseUp = () => {
      cleanupListeners();
      finishSwipe(false);
    };

    const cleanupListeners = () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
      if (mouseCleanupRef.current === cleanupListeners) {
        mouseCleanupRef.current = null;
      }
    };

    mouseCleanupRef.current = cleanupListeners;
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  const handleCardClick = () => {
    if (gestureRef.current.didSwipe || isSwiping || dismissDirection || deleting) return;
    onSelect(notif);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  const cardTransform = dismissDirection
    ? `translateX(${dismissDirection === 'left' ? '-110%' : '110%'})`
    : `translateX(${offsetX}px)`;

  return (
    <div
      className="relative overflow-hidden select-none"
      style={{ touchAction: 'pan-y' }}
    >
      {/* Lapisan Latar Belakang Merah Hapus — Tepat di Belakang Kartu */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[#C87058] text-white flex items-center justify-between px-4 pointer-events-none"
      >
        <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wide">
          <Trash2 className="w-4 h-4 shrink-0" />
          <span>Hapus</span>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wide">
          <span>Hapus</span>
          <Trash2 className="w-4 h-4 shrink-0" />
        </div>
      </div>

      {/* Kartu Notifikasi Interaktif (div role="button", bukan <button>, agar swipe mobile tidak terblokir) */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onMouseDown={handleMouseDown}
        style={{
          touchAction: 'pan-y',
          transform: cardTransform,
          opacity: dismissDirection ? 0 : 1,
          transition: isSwiping ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out',
          willChange: isSwiping || dismissDirection ? 'transform, opacity' : 'auto',
        }}
        className="relative z-10 w-full text-left px-4 py-3 flex items-start gap-3 cursor-pointer bg-[#FFFDF8] hover:bg-[#E5EEE3]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2B3F29]"
      >
        {/* Tint lembut untuk notifikasi belum dibaca di atas dasar solid */}
        {!notif.is_read && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[#E5EEE3]/50"
          />
        )}

        <div className="relative z-10 shrink-0 mt-0.5">
          <div
            className={`w-9 h-9 rounded-2xl border flex items-center justify-center ${visual.bg}`}
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

        <div className="relative z-10 min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`text-xs leading-snug ${
                notif.is_read ? 'font-semibold text-[#1B271B]/85' : 'font-bold text-[#1B271B]'
              }`}
            >
              {notif.title}
            </p>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-mono text-[#6E786D] whitespace-nowrap tabular-nums">
                {formatRelativeTimeId(notif.created_at)}
              </span>
              {!notif.is_read && (
                <span
                  aria-label="Belum dibaca"
                  className="w-2 h-2 rounded-full bg-[#2B3F29] shrink-0"
                />
              )}
            </div>
          </div>

          <div className="flex items-end justify-between gap-2 mt-0.5">
            <p className="text-[11px] text-[#4A554A] leading-relaxed line-clamp-2 flex-1 min-w-0">
              {notif.message}
            </p>

            {/* Tombol Ikon Trash Kecil di Pojok Kanan Bawah — Selalu Terlihat */}
            <button
              type="button"
              data-no-swipe="true"
              disabled={deleting || Boolean(dismissDirection)}
              aria-label={`Hapus notifikasi ${notif.title}`}
              title="Hapus notifikasi"
              onTouchStart={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                triggerDismiss('left');
              }}
              className="shrink-0 w-7 h-7 -mr-1 -mb-1 rounded-lg flex items-center justify-center text-[#6E786D] hover:text-[#C87058] hover:bg-[#C87058]/10 active:scale-[0.93] transition-all duration-150 cursor-pointer disabled:opacity-50"
            >
              {deleting ? (
                <LoadingSpinner size="xs" tone="danger" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotificationBell({
  session,
  variant = 'light',
  className = '',
  externalUnreadCount,
  onUnreadCountChange,
  onNavigateTarget,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [items, setItems] = useState<ActivityNotification[]>([]);
  const [dbUnreadCount, setDbUnreadCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});
  const [bellShaking, setBellShaking] = useState(false);
  const [osPermission, setOsPermission] = useState<OsNotificationPermissionState>('granted');
  const [requestingPerm, setRequestingPerm] = useState(false);
  const [showFloatingPrompt, setShowFloatingPrompt] = useState(false);

  const { prefs, setPref } = useNotificationPreferences();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const shakeTimerRef = useRef<number | null>(null);
  const [desktopAnchor, setDesktopAnchor] = useState<{ top: number; right: number } | null>(null);

  // Menyimpan seluruh ID & signature notifikasi yang sudah pernah dilihat dalam useRef Set (bukan state)
  // serta flag isInitialLoadDone agar notifikasi lama tidak pernah dibunyikan saat mount.
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadDoneRef = useRef<boolean>(false);
  const activeSessionKeyRef = useRef<string>('');
  const loadSeqRef = useRef<number>(0);
  const sessionRef = useRef<SessionUser>(session);
  sessionRef.current = session;
  const sessionKey = getCanonicalUserId(session);

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

  const hasNotificationBeenSeen = useCallback(
    (notif: ActivityNotification): boolean => {
      const currentSession = sessionRef.current;
      const sessionSeen = getSessionSeenNotificationIds(currentSession);
      if (seenNotificationIdsRef.current.has(notif.id) || sessionSeen.has(notif.id)) {
        return true;
      }
      const sessionSigs = getSessionSeenNotificationSignatures(currentSession);
      const now = Date.now();
      if (notif.dedup_key) {
        const dkKey = `dk:${notif.dedup_key.trim().toLowerCase()}`;
        const dkTs = sessionSigs.get(dkKey);
        if (dkTs && now - dkTs < 90_000) return true;
      }
      const sigKey = `sig:${buildNotificationContentSignature(notif)}`;
      const sigTs = sessionSigs.get(sigKey);
      if (sigTs && now - sigTs < 90_000) return true;
      return false;
    },
    []
  );

  const markNotificationAsSeen = useCallback((notif: ActivityNotification) => {
    if (!notif?.id) return;
    const currentSession = sessionRef.current;
    seenNotificationIdsRef.current.add(notif.id);
    getSessionSeenNotificationIds(currentSession).add(notif.id);

    const sessionSigs = getSessionSeenNotificationSignatures(currentSession);
    const now = Date.now();
    if (sessionSigs.size > 250) {
      for (const [k, ts] of sessionSigs.entries()) {
        if (now - ts > 120_000) sessionSigs.delete(k);
      }
    }
    if (notif.dedup_key) {
      sessionSigs.set(`dk:${notif.dedup_key.trim().toLowerCase()}`, now);
    }
    sessionSigs.set(`sig:${buildNotificationContentSignature(notif)}`, now);
  }, []);

  const loadNotifications = useCallback(
    async (silent = false) => {
      const seq = ++loadSeqRef.current;
      const currentSession = sessionRef.current;
      if (!silent) setLoading(true);
      try {
        const [rawList, unreadTotal] = await Promise.all([
          fetchActivityNotifications(currentSession),
          fetchUnreadNotificationCount(currentSession),
        ]);
        if (seq !== loadSeqRef.current) return;

        const list = deduplicateNotifications(rawList);

        // Pada pemuatan pertama: catat seluruh ID & signature notifikasi lama tanpa membunyikan alert
        if (!isInitialLoadDoneRef.current) {
          for (const notif of list) {
            markNotificationAsSeen(notif);
          }
          isInitialLoadDoneRef.current = true;
          setItems(list);
          setDbUnreadCount(unreadTotal);
          return;
        }

        // Pada pemuatan berikutnya (polling / realtime refresh):
        // deteksi notifikasi baru yang belum pernah dilihat, belum dibaca, & cocok dengan sesi aktif
        const newlyArrivedUnread: ActivityNotification[] = [];
        for (const notif of list) {
          const alreadySeen = hasNotificationBeenSeen(notif);
          markNotificationAsSeen(notif);
          if (
            !alreadySeen &&
            notif.is_read === false &&
            isNotificationMatchingSession(notif, currentSession, { excludeSelfActor: true })
          ) {
            newlyArrivedUnread.push(notif);
          }
        }

        setItems(list);
        setDbUnreadCount(unreadTotal);

        if (newlyArrivedUnread.length > 0) {
          triggerBellShake();
          const suppressOsPopup = shouldSuppressOsPopupWhenFcmActive();
          for (const notif of newlyArrivedUnread.slice(0, 3)) {
            void triggerDeviceAlert(notif.title, notif.message, {
              id: notif.id,
              dedupKey: notif.dedup_key || undefined,
              targetUrl: notif.target_url,
              skipOsPopup: suppressOsPopup,
            });
          }
        }
      } finally {
        if (!silent && seq === loadSeqRef.current) setLoading(false);
      }
    },
    [hasNotificationBeenSeen, markNotificationAsSeen, triggerBellShake]
  );

  // Inisialisasi Web Audio unlock, Android Notification Channel, cek izin, & listener ketukan OS notification
  useEffect(() => {
    initNotificationAudioUnlock();
    void ensureAndroidNotificationChannel();

    let mounted = true;
    const initPerm = async () => {
      const perm = await initNativeNotificationsOnLaunch(sessionRef.current);
      if (!mounted) return;
      setOsPermission(perm);
      if (perm === 'prompt' && !prefs.permissionPromptDismissed) {
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

  // Sinkronisasi Realtime Supabase (via hub singleton) + Polling cadangan
  useEffect(() => {
    const currentSession = sessionRef.current;
    if (activeSessionKeyRef.current !== sessionKey) {
      activeSessionKeyRef.current = sessionKey;
      const persistedSeen = getSessionSeenNotificationIds(currentSession);
      seenNotificationIdsRef.current = new Set(persistedSeen);
      isInitialLoadDoneRef.current = persistedSeen.size > 0;
    }

    void loadNotifications(false);

    const unsub = subscribeActivityNotificationsRealtime(
      currentSession,
      () => {
        void loadNotifications(true);
      },
      (insertedNotif) => {
        const activeSess = sessionRef.current;
        const alreadySeen = hasNotificationBeenSeen(insertedNotif);
        markNotificationAsSeen(insertedNotif);

        setItems((prev) => deduplicateNotifications([insertedNotif, ...prev]).slice(0, 80));

        if (
          !alreadySeen &&
          insertedNotif.is_read === false &&
          isNotificationMatchingSession(insertedNotif, activeSess, { excludeSelfActor: true })
        ) {
          triggerBellShake();
          void triggerDeviceAlert(insertedNotif.title, insertedNotif.message, {
            id: insertedNotif.id,
            dedupKey: insertedNotif.dedup_key || undefined,
            targetUrl: insertedNotif.target_url,
            skipOsPopup: shouldSuppressOsPopupWhenFcmActive(),
          });
        }
      }
    );

    const pollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void loadNotifications(true);
      }
    }, 5000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void loadNotifications(true);
      }
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      unsub();
      window.clearInterval(pollTimer);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [sessionKey, loadNotifications, hasNotificationBeenSeen, markNotificationAsSeen, triggerBellShake]);

  // Hitung posisi anchor dropdown pada layar sm+ agar tetap menempel rapi ke tombol lonceng saat dirender via Portal
  useEffect(() => {
    if (!open && !showFloatingPrompt) return;
    const syncAnchor = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDesktopAnchor({
        top: Math.round(rect.bottom + 10),
        right: Math.max(12, Math.round(window.innerWidth - rect.right)),
      });
    };
    syncAnchor();
    window.addEventListener('resize', syncAnchor);
    window.addEventListener('scroll', syncAnchor, true);
    return () => {
      window.removeEventListener('resize', syncAnchor);
      window.removeEventListener('scroll', syncAnchor, true);
    };
  }, [open, showFloatingPrompt]);

  // Tutup panel saat klik luar (desktop), tekan Escape, atau tekan tombol Back HP/Browser
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = containerRef.current?.contains(target);
      const inPanel = panelRef.current?.contains(target);
      if (!inTrigger && !inPanel) {
        setOpen(false);
      }
    };
    const onBackOverlay = (e: Event) => {
      const detail = (e as CustomEvent<{ handled?: boolean }>).detail;
      if (detail && !detail.handled) {
        detail.handled = true;
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('ecard-handle-back-overlay', onBackOverlay);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('ecard-handle-back-overlay', onBackOverlay);
    };
  }, [open]);

  const unreadCount = useMemo(
    () => deduplicateNotifications(items).filter((n) => !n.is_read).length,
    [items]
  );
  const displayUnreadCount = useMemo(() => {
    if (loading) {
      if (typeof dbUnreadCount === 'number') return dbUnreadCount;
      if (typeof externalUnreadCount === 'number') return externalUnreadCount;
      return 0;
    }
    const authoritativeDbCount =
      typeof dbUnreadCount === 'number'
        ? dbUnreadCount
        : typeof externalUnreadCount === 'number'
          ? externalUnreadCount
          : unreadCount;
    if (items.length >= 80) {
      return Math.max(unreadCount, authoritativeDbCount);
    }
    return unreadCount;
  }, [dbUnreadCount, externalUnreadCount, items.length, loading, unreadCount]);

  useEffect(() => {
    if (!loading) {
      onUnreadCountChange?.(displayUnreadCount);
    }
  }, [displayUnreadCount, loading, onUnreadCountChange]);

  useEffect(() => {
    void syncAppIconBadge(displayUnreadCount);
  }, [displayUnreadCount]);

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
      if (next === 'granted') {
        void syncNativePushTokenForSession(session);
      }
    } finally {
      setRequestingPerm(false);
    }
  };

  const handleDismissPrompt = () => {
    setShowFloatingPrompt(false);
    setPref({ permissionPromptDismissed: true });
  };

  const handleMarkAllRead = async () => {
    if (markingAll || displayUnreadCount === 0) return;
    setMarkingAll(true);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setDbUnreadCount(0);
    onUnreadCountChange?.(0);
    try {
      await markAllActivityNotificationsRead(session, items);
    } finally {
      setMarkingAll(false);
    }
  };

  const handleDeleteOne = useCallback(
    async (notif: ActivityNotification) => {
      setDeletingIds((prev) => ({ ...prev, [notif.id]: true }));
      setItems((prev) => prev.filter((item) => item.id !== notif.id));
      if (!notif.is_read) {
        setDbUnreadCount((prev) => (typeof prev === 'number' ? Math.max(0, prev - 1) : prev));
      }
      try {
        await deleteNotification(session, notif);
      } finally {
        setDeletingIds((prev) => {
          const next = { ...prev };
          delete next[notif.id];
          return next;
        });
      }
    },
    [session]
  );

  const handleDeleteAll = async () => {
    if (deletingAll || items.length === 0) return;
    setDeletingAll(true);
    const snapshot = [...items];
    setItems([]);
    setDbUnreadCount(0);
    onUnreadCountChange?.(0);
    try {
      await deleteAllNotifications(session, snapshot);
    } finally {
      setDeletingAll(false);
    }
  };

  const handleItemClick = useCallback(
    (notif: ActivityNotification) => {
      if (!notif.is_read) {
        setItems((prev) =>
          prev.map((item) => (item.id === notif.id ? { ...item, is_read: true } : item))
        );
        setDbUnreadCount((prev) => (typeof prev === 'number' ? Math.max(0, prev - 1) : prev));
        void markActivityNotificationRead(session, notif);
      }
      setOpen(false);
      if (notif.target_url && onNavigateTarget) {
        onNavigateTarget(notif.target_url);
      }
    },
    [onNavigateTarget, session]
  );

  const buttonTheme =
    variant === 'dark'
      ? 'bg-white/15 backdrop-blur-md hover:bg-white/25 text-[#FFFDF8] border-white/25 rounded-full'
      : 'bg-[#FFFDF8] hover:bg-[#E5EEE3] hover:border-[#C6D2BF] text-[#243825] border-[#E6E2D6] rounded-full shadow-xs';

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center visible opacity-100 shrink-0 ${className}`.trim()}
    >
      <button
        type="button"
        onClick={handleToggleOpen}
        aria-label={`Notifikasi aktivitas${displayUnreadCount > 0 ? ` (${displayUnreadCount} belum dibaca)` : ''}`}
        aria-expanded={open}
        data-testid="header-notification-bell"
        className={`relative w-10 h-10 border inline-flex items-center justify-center visible opacity-100 transition-all duration-200 active:scale-[0.95] cursor-pointer shrink-0 ${buttonTheme}`}
      >
        {bellShaking ? (
          <BellRing
            className={`w-[18px] h-[18px] animate-bell-shake ${
              variant === 'dark' ? 'text-[#F2D8A7]' : 'text-[#2B3F29]'
            }`}
          />
        ) : (
          <Bell className="w-[18px] h-[18px]" />
        )}
        {displayUnreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            aria-live="polite"
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#C87058] text-white text-[10px] font-bold font-mono leading-none flex items-center justify-center shadow-xs ring-2 ring-white tabular-nums"
          >
            {bellShaking && (
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full bg-[#C87058] animate-ping opacity-75"
              />
            )}
            <span className="relative z-10">
              {displayUnreadCount > 99 ? '99+' : displayUnreadCount}
            </span>
          </span>
        )}
      </button>

      {/* Banner Izin Notifikasi Sopan Saat Pertama Kali Login */}
      {showFloatingPrompt &&
        !open &&
        osPermission === 'prompt' &&
        !prefs.permissionPromptDismissed &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="region"
            aria-label="Aktifkan notifikasi HP"
            style={
              desktopAnchor && window.innerWidth >= 640
                ? { top: desktopAnchor.top, right: desktopAnchor.right }
                : undefined
            }
            className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top,0px)+4.75rem)] sm:left-auto sm:w-[348px] max-w-[calc(100vw-1.5rem)] z-[72] rounded-3xl border border-[#C6D2BF] bg-[#FFFDF8] shadow-2xl p-4 text-left animate-dropdown-pop"
          >
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center shrink-0 mt-0.5">
                <BellRing className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-[#1B271B]">Aktifkan Notifikasi HP?</p>
                <p className="text-[11px] text-[#4A554A] leading-relaxed mt-0.5">
                  Dapatkan pop-up status bar, bunyi lonceng, dan getaran saat ada info IPL, kas, atau
                  patroli baru.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    type="button"
                    disabled={requestingPerm}
                    onClick={() => void handleAllowOsNotifications()}
                    className="min-h-[34px] px-3.5 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-[11px] font-bold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer shadow-xs whitespace-nowrap"
                  >
                    {requestingPerm && <LoadingSpinner size="xs" tone="white" />}
                    <span>{requestingPerm ? 'Meminta izin...' : 'Aktifkan'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDismissPrompt}
                    className="min-h-[34px] px-3 rounded-full bg-[#F1ECE0] hover:bg-[#E6E2D6] text-[#1B271B] text-[11px] font-semibold transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap"
                  >
                    Nanti Saja
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDismissPrompt}
                aria-label="Tutup tawaran izin notifikasi"
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-[#F1ECE0] cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Panel Notifikasi (Dirender via Portal ke document.body agar backdrop full-screen & bebas tumpang tindih header) */}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            {/* Backdrop Full-Viewport Khusus Mobile & Tablet */}
            <div
              aria-hidden="true"
              onClick={() => setOpen(false)}
              className="sm:hidden fixed inset-0 z-[70] bg-[#1B271B]/50 backdrop-blur-sm animate-modal-backdrop"
            />

            <section
              ref={panelRef}
              role="dialog"
              aria-label="Notifikasi Aktivitas"
              style={
                desktopAnchor && window.innerWidth >= 640
                  ? { top: desktopAnchor.top, right: desktopAnchor.right }
                  : undefined
              }
              className="fixed left-3 right-3 top-[calc(env(safe-area-inset-top,0px)+4.75rem)] max-w-[420px] mx-auto sm:mx-0 sm:left-auto sm:w-[400px] z-[75] bg-[#FFFDF8] border border-[#E6E2D6] rounded-3xl shadow-[0_24px_60px_-14px_rgba(27,39,27,0.34)] overflow-hidden flex flex-col max-h-[min(76dvh,560px)] animate-dropdown-pop"
            >
              {/* Header Panel Notifikasi */}
              <div className="px-4 pt-3.5 pb-3 border-b border-[#E6E2D6] bg-gradient-to-b from-[#E5EEE3]/50 to-transparent shrink-0 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-xl bg-[#2B3F29] text-[#FFFDF8] flex items-center justify-center shrink-0 shadow-xs">
                      <Bell className="w-3.5 h-3.5" />
                    </span>
                    <h2 className="text-sm font-extrabold tracking-tight text-[#1B271B] leading-none">
                      Notifikasi
                    </h2>
                    {displayUnreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-[#C87058]/15 text-[#A44831] text-[10px] font-mono font-bold tabular-nums shrink-0">
                        {displayUnreadCount} baru
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Tutup panel notifikasi"
                    className="w-8 h-8 rounded-full bg-[#F1ECE0] hover:bg-[#E6E2D6] text-[#4A554A] hover:text-[#1B271B] flex items-center justify-center transition-colors cursor-pointer shrink-0 active:scale-95"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Baris 2: Aksi Cepat */}
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={markingAll || displayUnreadCount === 0}
                    aria-busy={markingAll}
                    onClick={() => void handleMarkAllRead()}
                    title="Tandai semua sudah dibaca"
                    className="px-2.5 py-1.5 rounded-xl bg-[#E5EEE3] hover:bg-[#D3E3D0] border border-[#C6D2BF] text-[11px] font-semibold text-[#243825] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition-all duration-150 active:scale-[0.97] cursor-pointer whitespace-nowrap"
                  >
                    {markingAll ? (
                      <LoadingSpinner size="xs" tone="theme" />
                    ) : (
                      <CheckCheck className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>Tandai dibaca</span>
                  </button>

                  <button
                    type="button"
                    disabled={deletingAll || items.length === 0}
                    aria-busy={deletingAll}
                    onClick={() => void handleDeleteAll()}
                    title="Hapus semua notifikasi"
                    className="px-2.5 py-1.5 rounded-xl bg-[#C87058]/10 hover:bg-[#C87058]/20 border border-[#C87058]/25 text-[11px] font-semibold text-[#A44831] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition-all duration-150 active:scale-[0.97] cursor-pointer whitespace-nowrap"
                  >
                    {deletingAll ? (
                      <LoadingSpinner size="xs" tone="danger" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>{deletingAll ? 'Menghapus...' : 'Hapus semua'}</span>
                  </button>
                </div>
              </div>

              {/* Strip Aktivasi Pop-up Notifikasi HP */}
              {osPermission === 'prompt' && (
                <div className="px-4 py-2.5 border-b border-[#E6E2D6] bg-[#E5EEE3]/50 flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <BellRing className="w-4 h-4 text-[#243825] shrink-0" />
                    <p className="text-[11px] font-medium text-[#1B271B] leading-snug">
                      Izinkan pop-up HP agar notifikasi muncul di status bar.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={requestingPerm}
                    onClick={() => void handleAllowOsNotifications()}
                    className="px-3 py-1 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-white text-[11px] font-bold shrink-0 cursor-pointer whitespace-nowrap"
                  >
                    {requestingPerm ? '...' : 'Izinkan'}
                  </button>
                </div>
              )}

              {/* Filter Kategori Cepat */}
              <div className="px-3.5 py-2.5 border-b border-[#E6E2D6] bg-[#F6F3EA] shrink-0">
                <div className="grid grid-cols-4 gap-1.5">
                  {FILTER_TABS.map((tab) => {
                    const isActive = filter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setFilter(tab.id)}
                        title={tab.label}
                        className={`px-2 py-1.5 rounded-full text-[11px] font-semibold text-center whitespace-nowrap truncate transition-all duration-150 active:scale-[0.97] cursor-pointer ${
                          isActive
                            ? 'bg-[#2B3F29] text-white shadow-xs'
                            : 'bg-[#FFFDF8] text-[#4A554A] border border-[#E6E2D6] hover:border-[#C6D2BF] hover:text-[#243825]'
                        }`}
                      >
                        {tab.shortLabel}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Daftar Aktivitas */}
              <div
                key={filter}
                className="flex-1 overflow-y-auto overflow-x-hidden divide-y divide-[#E6E2D6] animate-page-enter"
              >
                {loading ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-[#6E786D]">
                    <LoadingSpinner size="md" tone="theme" label="Memuat aktivitas terbaru" />
                    <span className="text-xs">Memuat aktivitas terbaru...</span>
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="py-12 px-6 text-center space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-[#E5EEE3] border border-[#C6D2BF] text-[#243825] flex items-center justify-center mx-auto shadow-2xs">
                      <Inbox className="w-5 h-5" />
                    </div>
                    <p className="text-sm font-bold text-[#1B271B]">
                      Belum ada aktivitas terbaru
                    </p>
                    <p className="text-xs text-[#6E786D] leading-relaxed max-w-[260px] mx-auto">
                      Notifikasi pembayaran IPL, kas, patroli, dan pengumuman akan muncul otomatis di
                      sini.
                    </p>
                  </div>
                ) : (
                  filteredItems.map((notif) => (
                    <SwipeableNotificationItem
                      key={notif.id}
                      notif={notif}
                      deleting={Boolean(deletingIds[notif.id])}
                      onSelect={handleItemClick}
                      onDelete={(target) => void handleDeleteOne(target)}
                    />
                  ))
                )}
              </div>

              {/* Petunjuk Swipe-to-Delete */}
              <div className="px-4 py-2.5 border-t border-[#E6E2D6] bg-[#F6F3EA] text-center shrink-0">
                <p className="text-[11px] font-medium text-[#6E786D]">
                  ← Geser pesan ke kiri atau kanan untuk menghapus →
                </p>
              </div>
            </section>
          </>,
          document.body
        )}
    </div>
  );
}
