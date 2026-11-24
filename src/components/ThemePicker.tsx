import { Check, Moon, Palette, Sun } from 'lucide-react';
import { APP_THEMES, useAppTheme, type AppThemeId } from '../lib/themeContext';

interface ThemePickerProps {
  compact?: boolean;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
}

export function ThemePicker({ compact = false, onToast }: ThemePickerProps) {
  const { theme, setTheme } = useAppTheme();

  const handleSelect = (nextId: AppThemeId, themeName: string) => {
    if (nextId === theme) return;
    setTheme(nextId);
    onToast?.('success', `Tema tampilan diubah ke "${themeName}".`);
  };

  return (
    <div className="space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border"
            style={{
              backgroundColor: 'var(--theme-primary-soft)',
              borderColor: 'var(--theme-primary-soft-border)',
              color: 'var(--theme-primary)',
            }}
          >
            <Palette className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm sm:text-base font-bold text-[var(--theme-text)] leading-tight">
              Tema Tampilan
            </h3>
            <p className="text-xs text-[var(--theme-text-muted)] mt-0.5 leading-relaxed">
              Pilih paduan warna yang paling nyaman di mata. Perubahan langsung aktif tanpa memuat
              ulang halaman.
            </p>
          </div>
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="Pilihan Tema Tampilan Aplikasi"
        className={`grid gap-2.5 ${
          compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
        }`}
      >
        {APP_THEMES.map((item) => {
          const isActive = theme === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => handleSelect(item.id, item.name)}
              className={`group relative w-full text-left rounded-3xl border p-3.5 backdrop-blur-sm transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] ${
                isActive
                  ? 'shadow-sm'
                  : 'hover:border-[var(--theme-primary)]/50'
              }`}
              style={{
                backgroundColor: isActive
                  ? 'var(--theme-primary-soft)'
                  : 'var(--theme-surface)',
                borderColor: isActive
                  ? 'var(--theme-primary)'
                  : 'var(--theme-border)',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                {/* Preview 3 Lingkaran Warna (Utama, Latar, Aksen) */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex items-center -space-x-2 shrink-0 p-1 rounded-full border"
                    style={{
                      backgroundColor: item.previewColors.background,
                      borderColor: item.isDark ? '#334155' : '#e2e8f0',
                    }}
                    aria-hidden="true"
                  >
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white/90 shadow-xs"
                      style={{ backgroundColor: item.previewColors.primary }}
                      title="Warna Utama"
                    />
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white/90 shadow-xs"
                      style={{ backgroundColor: item.previewColors.background }}
                      title="Warna Latar"
                    />
                    <span
                      className="w-6 h-6 rounded-full ring-2 ring-white/90 shadow-xs"
                      style={{ backgroundColor: item.previewColors.accent }}
                      title="Warna Aksen"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-[var(--theme-text)] truncate">
                        {item.name}
                      </span>
                      {item.isDark ? (
                        <Moon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <Sun className="w-3.5 h-3.5 text-[var(--theme-text-muted)] shrink-0 opacity-75" />
                      )}
                    </div>
                    <p className="text-[11px] font-medium text-[var(--theme-text-secondary)] truncate mt-0.5">
                      {item.tagline}
                    </p>
                  </div>
                </div>

                {/* Indikator Centang Tema Aktif */}
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all border ${
                    isActive ? 'scale-100' : 'opacity-40 group-hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: isActive ? item.previewColors.primary : 'transparent',
                    borderColor: isActive ? item.previewColors.primary : 'var(--theme-border)',
                    color: '#ffffff',
                  }}
                >
                  {isActive && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>
              </div>

              {!compact && (
                <p className="text-[11px] text-[var(--theme-text-muted)] mt-2 leading-relaxed line-clamp-2">
                  {item.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
