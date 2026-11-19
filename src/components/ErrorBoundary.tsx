import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Terjadi kesalahan tampilan aplikasi:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] bg-[#F8FAFC] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 text-center shadow-sm">
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
              className="mt-5 min-h-[46px] px-5 rounded-xl bg-[#059669] hover:bg-emerald-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Muat Ulang Aplikasi</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
