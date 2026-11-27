import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { SessionUser } from '../types';
import type { ChatRoomId } from '../lib/chatService';
import { CommunityChatSlide } from './CommunityChatSlide';

interface FloatingChatWidgetProps {
  session: SessionUser;
  unreadCount: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  initialRoomId?: ChatRoomId | null;
  hidden?: boolean;
  isPickingAttachmentRef?: React.MutableRefObject<boolean>;
  onAttachmentPickingChange?: (picking: boolean) => void;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

interface FloatingPosition {
  x: number;
  y: number;
}

interface StoredFloatingPosition extends FloatingPosition {
  vw: number;
  vh: number;
}

const FLOATING_CHAT_POS_STORAGE_KEY = 'ecard_floating_chat_btn_pos_v1';
const DRAG_THRESHOLD_PX = 6;
const EDGE_MARGIN_PX = 14;

function readSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px);' +
    'padding-right:env(safe-area-inset-right,0px);';
  document.body.appendChild(probe);
  const style = window.getComputedStyle(probe);
  const top = parseFloat(style.paddingTop) || 0;
  const bottom = parseFloat(style.paddingBottom) || 0;
  const left = parseFloat(style.paddingLeft) || 0;
  const right = parseFloat(style.paddingRight) || 0;
  probe.remove();
  return { top, bottom, left, right };
}

function getButtonSizeForViewport(vw: number): number {
  return vw >= 640 ? 52 : 48;
}

function getSafeBounds(btnSize: number, vw: number, vh: number) {
  const insets = readSafeAreaInsets();
  const isMobileOrTabletDock = vw < 1024;
  // Sisakan ruang atas agar tidak menutupi top header bar
  const minY = Math.round(insets.top + (isMobileOrTabletDock ? 74 : 84));
  // Sisakan ruang bawah agar tidak pernah tertutup / menumpuk di balik Floating Bottom Orb Dock (+ Kas)
  const bottomReserve = isMobileOrTabletDock
    ? Math.max(16, insets.bottom) + 98
    : Math.max(16, insets.bottom) + 16;

  const minX = Math.round(EDGE_MARGIN_PX + insets.left);
  const maxX = Math.max(minX, Math.round(vw - btnSize - EDGE_MARGIN_PX - insets.right));
  const maxY = Math.max(minY, Math.round(vh - btnSize - bottomReserve));

  return { minX, maxX, minY, maxY, insets };
}

function clampPosition(
  pos: FloatingPosition,
  btnSize: number,
  vw: number,
  vh: number
): FloatingPosition {
  const { minX, maxX, minY, maxY } = getSafeBounds(btnSize, vw, vh);
  return {
    x: Math.min(maxX, Math.max(minX, Math.round(pos.x))),
    y: Math.min(maxY, Math.max(minY, Math.round(pos.y))),
  };
}

function getDefaultPosition(btnSize: number, vw: number, vh: number): FloatingPosition {
  const { insets } = getSafeBounds(btnSize, vw, vh);
  const rightMargin = (vw >= 640 ? 24 : 14) + insets.right;
  const bottomOffset =
    vw < 1024
      ? Math.max(16, insets.bottom) + 98
      : Math.max(16, insets.bottom) + 24;

  return clampPosition(
    {
      x: vw - btnSize - rightMargin,
      y: vh - btnSize - bottomOffset,
    },
    btnSize,
    vw,
    vh
  );
}

function shouldResetForViewportChange(
  prevW: number,
  prevH: number,
  nextW: number,
  nextH: number
): boolean {
  const wasLandscape = prevW > prevH;
  const isLandscape = nextW > nextH;
  const wasDock = prevW < 1024;
  const isDock = nextW < 1024;
  const widthDelta = Math.abs(nextW - prevW);
  return wasLandscape !== isLandscape || wasDock !== isDock || widthDelta > 120;
}

function loadInitialPosition(): FloatingPosition | null {
  if (typeof window === 'undefined') return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const btnSize = getButtonSizeForViewport(vw);

  try {
    const raw = window.localStorage.getItem(FLOATING_CHAT_POS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredFloatingPosition>;
      if (
        typeof parsed.x === 'number' &&
        Number.isFinite(parsed.x) &&
        typeof parsed.y === 'number' &&
        Number.isFinite(parsed.y) &&
        typeof parsed.vw === 'number' &&
        typeof parsed.vh === 'number' &&
        !shouldResetForViewportChange(parsed.vw, parsed.vh, vw, vh)
      ) {
        return clampPosition({ x: parsed.x, y: parsed.y }, btnSize, vw, vh);
      }
    }
  } catch {
    // Abaikan jika localStorage tidak tersedia
  }

  return getDefaultPosition(btnSize, vw, vh);
}

function savePosition(pos: FloatingPosition, vw: number, vh: number) {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredFloatingPosition = { x: pos.x, y: pos.y, vw, vh };
    window.localStorage.setItem(FLOATING_CHAT_POS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Abaikan kuota storage penuh
  }
}

export function FloatingChatWidget({
  session,
  unreadCount,
  open: controlledOpen,
  onOpenChange,
  initialRoomId,
  hidden = false,
  isPickingAttachmentRef,
  onAttachmentPickingChange,
  onToast,
}: FloatingChatWidgetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pos, setPos] = useState<FloatingPosition | null>(() => loadInitialPosition());
  const [isDragging, setIsDragging] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const suppressNextClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const lastViewportRef = useRef<{ vw: number; vh: number }>({
    vw: typeof window !== 'undefined' ? window.innerWidth : 0,
    vh: typeof window !== 'undefined' ? window.innerHeight : 0,
  });
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    latestPos: FloatingPosition;
  } | null>(null);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === 'function' ? next(isOpen) : next;
      if (onOpenChange) {
        onOpenChange(resolved);
      }
      if (controlledOpen === undefined) {
        setInternalOpen(resolved);
      }
    },
    [controlledOpen, isOpen, onOpenChange]
  );

  // Sinkronkan posisi saat mount & saat ukuran layar / orientasi berubah (rotasi HP atau pindah tablet)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const ensurePosition = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const btnSize = buttonRef.current?.offsetWidth || getButtonSizeForViewport(vw);
      setPos((prev) => {
        if (!prev) {
          const def = getDefaultPosition(btnSize, vw, vh);
          savePosition(def, vw, vh);
          return def;
        }
        return clampPosition(prev, btnSize, vw, vh);
      });
    };

    ensurePosition();

    const handleResize = () => {
      const nextW = window.innerWidth;
      const nextH = window.innerHeight;
      const prevVp = lastViewportRef.current;
      const btnSize = buttonRef.current?.offsetWidth || getButtonSizeForViewport(nextW);

      const needReset =
        prevVp.vw > 0 &&
        prevVp.vh > 0 &&
        shouldResetForViewportChange(prevVp.vw, prevVp.vh, nextW, nextH);

      lastViewportRef.current = { vw: nextW, vh: nextH };

      setPos((prev) => {
        const nextPos =
          needReset || !prev
            ? getDefaultPosition(btnSize, nextW, nextH)
            : clampPosition(prev, btnSize, nextW, nextH);
        savePosition(nextPos, nextW, nextH);
        return nextPos;
      });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }
    };
  }, []);

  // Tutup panel chat melayang jika disembunyikan (kecuali saat sedang mengambil foto/lampiran)
  useEffect(() => {
    if (hidden && isOpen && !isPickingAttachmentRef?.current) {
      setOpen(false);
    }
  }, [hidden, isOpen, setOpen, isPickingAttachmentRef]);

  // Tangkap Escape & tombol Back Android saat chat melayang terbuka
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isPickingAttachmentRef?.current) {
        setOpen(false);
      }
    };
    const onBackOverlay = (e: Event) => {
      if (isPickingAttachmentRef?.current) return;
      const detail = (e as CustomEvent<{ handled?: boolean }>).detail;
      if (detail && !detail.handled) {
        detail.handled = true;
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('ecard-handle-back-overlay', onBackOverlay);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('ecard-handle-back-overlay', onBackOverlay);
    };
  }, [isOpen, setOpen, isPickingAttachmentRef]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const btnSize = e.currentTarget.offsetWidth || getButtonSizeForViewport(vw);
    const currentPos = pos ?? getDefaultPosition(btnSize, vw, vh);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Abaikan jika browser tidak mendukung setPointerCapture
    }

    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: currentPos.x,
      originY: currentPos.y,
      moved: false,
      latestPos: currentPos,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const distance = Math.hypot(dx, dy);

    if (!drag.moved && distance <= DRAG_THRESHOLD_PX) {
      return;
    }

    if (!drag.moved) {
      drag.moved = true;
      setIsDragging(true);
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const btnSize = e.currentTarget.offsetWidth || getButtonSizeForViewport(vw);
    const clamped = clampPosition(
      {
        x: drag.originX + dx,
        y: drag.originY + dy,
      },
      btnSize,
      vw,
      vh
    );

    drag.latestPos = clamped;
    setPos(clamped);
  };

  const finishPointerInteraction = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Abaikan jika sudah dilepas
    }

    if (drag.moved) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      savePosition(drag.latestPos, vw, vh);
      suppressNextClickRef.current = true;
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }
      suppressTimerRef.current = window.setTimeout(() => {
        suppressNextClickRef.current = false;
        suppressTimerRef.current = null;
      }, 120);
    }

    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
        suppressTimerRef.current = null;
      }
      e.preventDefault();
      return;
    }
    setOpen((prev) => !prev);
  };

  if (hidden) return null;

  return (
    <>
      {/* Panel Chat Cepat Melayang (Popup / Sheet Responsif) */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[55] pointer-events-none no-print">
            {/* Backdrop ringan agar sentuhan di luar menutup panel */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => {
                if (!isPickingAttachmentRef?.current) {
                  setOpen(false);
                }
              }}
              className="fixed inset-0 bg-[#1B271B]/35 backdrop-blur-[2px] sm:bg-[#1B271B]/15 sm:backdrop-blur-[1px] pointer-events-auto"
            />

            <motion.section
              role="dialog"
              aria-modal="true"
              aria-label="Jendela Chat Cepat Saung Kebun"
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+4.5rem)] bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.1rem)] sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-24 sm:w-[440px] md:w-[480px] sm:h-[min(80dvh,640px)] max-w-[calc(100vw-1.5rem)] rounded-3xl bg-[#FFFDF8]/98 backdrop-blur-2xl border border-[#E6E2D6] shadow-[0_24px_60px_-14px_rgba(27,39,27,0.34)] flex flex-col overflow-hidden"
            >
              {/* Header Bar Floating Chat */}
              <div
                className="px-4 py-2.5 text-[#FFFDF8] flex items-center justify-between gap-2 shrink-0"
                style={{ backgroundImage: 'var(--theme-hero-gradient)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageCircle className="w-4 h-4 shrink-0 text-[#E5EEE3]" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold leading-tight truncate">
                      Chat Cepat Saung Kebun
                    </p>
                    <p className="text-[10px] text-[#E5EEE3]/85 truncate">
                      DM Personal · Group Pengurus · Warga · Keamanan
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Tutup jendela chat"
                    className="h-8 w-8 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Isi Chat (DM & Group) */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <CommunityChatSlide
                  session={session}
                  variant="floating"
                  initialRoomId={initialRoomId}
                  onAttachmentPickingChange={onAttachmentPickingChange}
                  onToast={onToast}
                />
              </div>
            </motion.section>
          </div>
        )}
      </AnimatePresence>

      {/* Tombol Ikon Chat Mengambang Fleksibel (Bisa Digeser ke Semua Arah) */}
      <button
        ref={buttonRef}
        type="button"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onClick={handleButtonClick}
        aria-label={isOpen ? 'Tutup Chat Cepat' : 'Buka atau geser tombol Chat Cepat'}
        aria-expanded={isOpen}
        title="Ketuk untuk buka chat · Geser untuk pindah posisi"
        style={
          pos
            ? {
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                touchAction: 'none',
              }
            : { touchAction: 'none' }
        }
        className={`fixed z-[42] h-12 w-12 sm:h-13 sm:w-13 rounded-full bg-[#2B3F29] hover:bg-[#243825] text-[#FFFDF8] flex items-center justify-center select-none touch-none no-print ${
          pos ? '' : 'right-3.5 sm:right-6 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.15rem)] lg:bottom-6'
        } ${
          isDragging
            ? 'scale-110 shadow-[0_18px_36px_-6px_rgba(36,56,37,0.55)] ring-4 ring-[#E5EEE3] cursor-grabbing transition-none'
            : 'shadow-[0_12px_28px_-6px_rgba(36,56,37,0.45)] ring-2 ring-[#FFFDF8] hover:scale-105 active:scale-95 transition-transform duration-150 cursor-grab'
        }`}
      >
        {isOpen ? (
          <X className="w-5 h-5 pointer-events-none" />
        ) : (
          <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6 pointer-events-none" />
        )}
        {!isOpen && unreadCount > 0 && (
          <span className="pointer-events-none absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-[#C87058] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-[#FFFDF8] shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </>
  );
}
