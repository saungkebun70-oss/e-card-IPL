interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'theme' | 'white' | 'current' | 'danger';
  className?: string;
  label?: string;
}

const SIZE_CLASSES: Record<NonNullable<LoadingSpinnerProps['size']>, string> = {
  xs: 'w-3.5 h-3.5 border-[2px]',
  sm: 'w-4 h-4 border-[2px]',
  md: 'w-5 h-5 border-[2.5px]',
  lg: 'w-8 h-8 border-[3px]',
  xl: 'w-10 h-10 border-[3.5px]',
};

const TONE_CLASSES: Record<NonNullable<LoadingSpinnerProps['tone']>, string> = {
  theme: 'border-[var(--theme-primary)]/20 border-t-[var(--theme-primary)]',
  white: 'border-white/30 border-t-white',
  current: 'border-current/25 border-t-current',
  danger: 'border-red-500/25 border-t-red-600',
};

/**
 * Indikator putaran (spinner) modern & konsisten yang warnanya otomatis mengikuti tema aktif.
 */
export function LoadingSpinner({
  size = 'sm',
  tone = 'theme',
  className = '',
  label = 'Memuat...',
}: LoadingSpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-block rounded-full animate-spin shrink-0 ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]} ${className}`}
    />
  );
}

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
  subMessage?: string;
}

/**
 * Overlay loading ringan dengan blur tipis dan kartu spinner terpusat untuk proses berat / muat data global.
 */
export function LoadingOverlay({
  visible,
  message = 'Memproses data...',
  subMessage,
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[75] flex items-center justify-center p-4 bg-slate-950/20 backdrop-blur-[2px] animate-modal-backdrop no-print"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl px-6 py-5 flex flex-col items-center gap-3 max-w-[260px] w-full text-center animate-modal-pop">
        <LoadingSpinner size="lg" tone="theme" label={message} />
        <div className="space-y-0.5">
          <p className="text-sm font-bold text-[#0F172A] leading-snug">{message}</p>
          {subMessage && <p className="text-[11px] text-slate-500 leading-snug">{subMessage}</p>}
        </div>
      </div>
    </div>
  );
}

interface ContentLoadingStateProps {
  message?: string;
  subMessage?: string;
  compact?: boolean;
}

/**
 * Tampilan loading terpusat di area konten agar layar tidak terlihat kosong atau macet saat memuat data dari Supabase.
 */
export function ContentLoadingState({
  message = 'Memuat data terbaru...',
  subMessage = 'Menyinkronkan informasi dari server Saung Kebun',
  compact = false,
}: ContentLoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full flex flex-col items-center justify-center text-center animate-page-enter ${
        compact ? 'py-10 px-4' : 'min-h-[42dvh] py-14 px-5'
      }`}
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs px-7 py-6 flex flex-col items-center gap-3 max-w-xs w-full">
        <LoadingSpinner size="lg" tone="theme" label={message} />
        <div className="space-y-1">
          <p className="text-sm font-bold text-[#0F172A]">{message}</p>
          {subMessage && <p className="text-xs text-slate-500 leading-relaxed">{subMessage}</p>}
        </div>
      </div>
    </div>
  );
}
