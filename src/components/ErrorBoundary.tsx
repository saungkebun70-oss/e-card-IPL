import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { recordCapturedError } from '../lib/bugReportService';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error('Terjadi kesalahan tampilan aplikasi:', error);
    recordCapturedError('react_error_boundary', error.message || 'React render error', error.stack);
  }

  render() {
    if (this.state.hasError) {
      const errorMessage =
        this.state.error?.message?.trim() || 'Kesalahan render tidak terduga pada halaman.';

      return (
        <div className="min-h-[100dvh] glass-canvas flex items-center justify-center p-3.5 sm:p-6 pt-[calc(max(env(safe-area-inset-top,0px),24px)+1.5rem)] pb-safe">
          <div className="w-full max-w-md glass-card rounded-3xl p-4 sm:p-6 text-center shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <h1 className="text-lg font-bold text-[#0F172A] mt-4">
              Terjadi Kendala Tampilan
            </h1>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
              Aplikasi mengalami gangguan sementara pada browser perangkat Anda. Tekan tombol di
              bawah untuk memuat ulang halaman dengan aman.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 min-h-[46px] px-6 rounded-full bg-[#3730A3] hover:bg-[#312E81] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Muat Ulang Aplikasi</span>
            </button>
            <p
              title={errorMessage}
              className="mt-4 pt-3 border-t border-indigo-100/70 text-[11px] font-mono text-slate-400 break-words leading-relaxed"
            >
              Detail teknis: {errorMessage}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
