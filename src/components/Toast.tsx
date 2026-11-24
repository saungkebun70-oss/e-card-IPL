import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      aria-live="polite"
      className="fixed top-4 right-4 left-4 sm:left-auto sm:w-96 z-50 flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => {
          const isSuccess = toast.type === 'success';
          const isError = toast.type === 'error';
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${
                isSuccess
                  ? 'bg-[#064E3B]/95 text-emerald-50 border-emerald-400/35'
                  : isError
                    ? 'bg-red-950/95 text-red-50 border-red-400/35'
                    : 'bg-[#3b0764]/95 text-indigo-50 border-indigo-400/30'
              }`}
            >
              {isSuccess ? (
                <CheckCircle2 className="w-5 h-5 text-[#A7F3D0] shrink-0 mt-0.5" />
              ) : isError ? (
                <AlertCircle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
              ) : (
                <Info className="w-5 h-5 text-[#A7F3D0] shrink-0 mt-0.5" />
              )}
              <p className="text-sm leading-snug flex-1">{toast.message}</p>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Tutup notifikasi"
                className="p-1 -m-1 rounded-full opacity-75 hover:opacity-100 hover:bg-white/10 transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
