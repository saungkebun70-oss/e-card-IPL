import { useEffect, useState } from 'react';
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
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function FloatingChatWidget({
  session,
  unreadCount,
  open: controlledOpen,
  onOpenChange,
  initialRoomId,
  hidden = false,
  onToast,
}: FloatingChatWidgetProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(isOpen) : next;
    if (onOpenChange) {
      onOpenChange(resolved);
    }
    if (controlledOpen === undefined) {
      setInternalOpen(resolved);
    }
  };

  // Tutup panel chat melayang jika disembunyikan
  useEffect(() => {
    if (hidden && isOpen) {
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

  // Tangkap Escape & tombol Back Android saat chat melayang terbuka
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onBackOverlay = (e: Event) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-slate-950/35 backdrop-blur-[2px] sm:bg-slate-950/15 sm:backdrop-blur-[1px] pointer-events-auto"
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
              className="pointer-events-auto fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+4.5rem)] bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.1rem)] sm:inset-x-auto sm:top-auto sm:right-6 sm:bottom-24 sm:w-[440px] md:w-[480px] sm:h-[min(80dvh,640px)] max-w-[calc(100vw-1.5rem)] rounded-3xl bg-white/95 backdrop-blur-2xl border border-white/95 shadow-[0_24px_60px_-14px_rgba(15,23,42,0.34),0_8px_24px_-6px_rgba(49,46,129,0.2)] flex flex-col overflow-hidden"
            >
              {/* Header Bar Floating Chat */}
              <div
                className="px-4 py-2.5 text-white flex items-center justify-between gap-2 shrink-0"
                style={{ backgroundImage: 'var(--theme-hero-gradient)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageCircle className="w-4 h-4 shrink-0 text-sky-200" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold leading-tight truncate">
                      Chat Cepat Saung Kebun
                    </p>
                    <p className="text-[10px] text-purple-100/85 truncate">
                      DM Personal · Group Pengurus · Warga · Keamanan
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Tutup jendela chat"
                    className="h-8 w-8 rounded-xl bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
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
                  onToast={onToast}
                />
              </div>
            </motion.section>
          </div>
        )}
      </AnimatePresence>

      {/* Tombol Ikon Chat Melayang (FAB) */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={isOpen ? 'Tutup Chat Cepat' : 'Buka Chat Cepat'}
        aria-expanded={isOpen}
        title="Chat Cepat (DM & Group)"
        className="fixed right-3.5 sm:right-6 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+5.15rem)] lg:bottom-6 z-40 h-12 w-12 sm:h-13 sm:w-13 rounded-full bg-gradient-to-tr from-[#312E81] via-[#3730A3] to-[#0284C7] text-white shadow-[0_12px_28px_-6px_rgba(49,46,129,0.45)] ring-2 ring-white/90 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center cursor-pointer no-print"
      >
        {isOpen ? (
          <X className="w-5 h-5" />
        ) : (
          <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6" />
        )}
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums ring-2 ring-white shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    </>
  );
}
