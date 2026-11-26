import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  describeUploadStage,
  formatFileSize,
  getFileExtensionLabel,
  type UploadQueueItem,
} from '../../lib/chat/attachmentUtils';

export interface UploadProgressProps {
  items: UploadQueueItem[];
  onCancel: (localId: string) => void;
  onRetry: (localId: string) => void;
  onRemove?: (localId: string) => void;
  className?: string;
}

function getAttachmentIcon(type: UploadQueueItem['attachmentType']) {
  if (type === 'photo') return ImageIcon;
  if (type === 'video') return Film;
  return FileText;
}

export function UploadProgress({
  items,
  onCancel,
  onRetry,
  onRemove,
  className = '',
}: UploadProgressProps) {
  if (items.length === 0) return null;

  const hasAnyErrorDetails = items.some(
    (item) =>
      item.status === 'failed' &&
      Boolean(
        item.errorDetails &&
          ((item.errorDetails.missingFields?.length || 0) > 0 ||
            (item.errorDetails.invalidFields?.length || 0) > 0 ||
            Object.keys(item.errorDetails.fieldReasons || {}).length > 0)
      )
  );

  return (
    <div
      aria-live="polite"
      className={`${hasAnyErrorDetails ? 'max-h-60' : 'max-h-44'} overflow-y-auto space-y-2 pr-0.5 overscroll-contain min-w-0 ${className}`.trim()}
    >
      {items.map((item) => {
        const Icon = getAttachmentIcon(item.attachmentType);
        const clampedPercent = Math.max(0, Math.min(100, Math.round(item.percent)));
        const stageText = describeUploadStage(item.phase, item.status);
        const extLabel = getFileExtensionLabel(item.file.name, item.file.type);
        const isUploading = item.status === 'uploading';
        const isFailed = item.status === 'failed';
        const isCompleted = item.status === 'completed';

        const errorDetails = isFailed ? item.errorDetails : null;
        const missingFields = errorDetails?.missingFields || [];
        const invalidFields = errorDetails?.invalidFields || [];
        const fieldReasons = errorDetails?.fieldReasons || {};
        const knownFieldSet = new Set<string>([...missingFields, ...invalidFields]);
        const extraReasonEntries = Object.entries(fieldReasons).filter(
          ([field]) => !knownFieldSet.has(field)
        );
        const hasFieldDiagnostics =
          missingFields.length > 0 || invalidFields.length > 0 || extraReasonEntries.length > 0;

        return (
          <div
            key={item.localId}
            className={`rounded-2xl border px-2.5 py-2 transition-colors min-w-0 ${
              isFailed
                ? 'bg-rose-50/90 border-rose-200'
                : isCompleted
                  ? 'bg-emerald-50/85 border-emerald-200'
                  : 'bg-indigo-50/80 border-indigo-200/80'
            }`}
          >
            <div className="flex items-start gap-2 min-w-0">
              {item.attachmentType === 'photo' && item.localPreviewUrl ? (
                <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 mt-0.5 border border-indigo-200 bg-white shadow-2xs">
                  <img
                    src={item.localPreviewUrl}
                    alt={item.file.name}
                    className="w-full h-full object-cover"
                  />
                  {isUploading && (
                    <span className="absolute inset-0 bg-slate-950/35 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                    </span>
                  )}
                  {isFailed && (
                    <span className="absolute inset-0 bg-rose-950/45 flex items-center justify-center">
                      <AlertCircle className="w-3.5 h-3.5 text-white" />
                    </span>
                  )}
                </div>
              ) : (
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    isFailed
                      ? 'bg-rose-100 text-rose-700'
                      : isCompleted
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-white text-[#312E81] border border-indigo-100'
                  }`}
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isFailed ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <p className="text-xs font-bold text-[#0F172A] truncate min-w-0">
                    {item.file.name}
                  </p>
                  <span
                    className={`text-[11px] font-mono font-bold tabular-nums shrink-0 ${
                      isFailed
                        ? 'text-rose-700'
                        : isCompleted
                          ? 'text-emerald-700'
                          : 'text-[#312E81]'
                    }`}
                  >
                    {clampedPercent}%
                  </span>
                </div>

                <p className="text-[10.5px] text-slate-600 truncate mt-0.5">
                  <span>{extLabel}</span>
                  <span> · </span>
                  <span className="tabular-nums">{formatFileSize(item.totalBytes)}</span>
                  <span> · </span>
                  <span
                    className={
                      isFailed
                        ? 'text-rose-700 font-semibold'
                        : isCompleted
                          ? 'text-emerald-700 font-semibold'
                          : 'text-[#3730A3] font-semibold'
                    }
                  >
                    {stageText}
                  </span>
                </p>

                <div className="mt-1.5 flex items-center gap-2 min-w-0">
                  <progress
                    value={clampedPercent}
                    max={100}
                    aria-label={`Progres unggah ${item.file.name}: ${clampedPercent}%`}
                    className={`h-1.5 w-full flex-1 appearance-none rounded-full overflow-hidden bg-white/90 [&::-webkit-progress-bar]:bg-white/90 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-all ${
                      isFailed
                        ? '[&::-webkit-progress-value]:bg-rose-500 [&::-moz-progress-bar]:bg-rose-500'
                        : isCompleted
                          ? '[&::-webkit-progress-value]:bg-emerald-600 [&::-moz-progress-bar]:bg-emerald-600'
                          : '[&::-webkit-progress-value]:bg-[#312E81] [&::-moz-progress-bar]:bg-[#312E81]'
                    }`}
                  />
                  {isCompleted && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  )}
                </div>

                {isUploading && item.phaseLabel && (
                  <p className="text-[10px] text-slate-500 truncate mt-1">{item.phaseLabel}</p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isUploading && (
                  <button
                    type="button"
                    onClick={() => onCancel(item.localId)}
                    aria-label={`Batalkan unggah ${item.file.name}`}
                    title="Batalkan unggahan"
                    className="min-h-[36px] min-w-[36px] px-2 rounded-xl border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-[11px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden sm:inline">Batalkan</span>
                  </button>
                )}

                {isFailed && (
                  <>
                    <button
                      type="button"
                      onClick={() => onRetry(item.localId)}
                      aria-label={`Coba lagi unggah ${item.file.name}`}
                      title="Coba lagi"
                      className="min-h-[36px] min-w-[36px] px-2 rounded-xl border border-indigo-200 bg-white hover:bg-indigo-50 text-[#312E81] text-[11px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden sm:inline">Coba Lagi</span>
                    </button>
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(item.localId)}
                        aria-label={`Hapus ${item.file.name} dari antrean`}
                        title="Hapus"
                        className="min-h-[36px] min-w-[36px] p-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 inline-flex items-center justify-center cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                )}

                {isCompleted && onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(item.localId)}
                    aria-label={`Hapus lampiran ${item.file.name}`}
                    title="Hapus lampiran"
                    className="min-h-[36px] min-w-[36px] p-1.5 rounded-xl border border-emerald-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-slate-500 inline-flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {isFailed && (item.error || hasFieldDiagnostics) && (
              <div className="mt-2 pt-1.5 border-t border-rose-200/80 space-y-1.5 min-w-0">
                {item.error && (
                  <p className="text-[10.5px] text-rose-800 font-medium break-words leading-snug">
                    {item.error}
                  </p>
                )}

                {hasFieldDiagnostics && (
                  <div className="rounded-xl border border-rose-200/90 bg-white/90 px-2.5 py-2 space-y-1.5 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-rose-700">
                      Detail Field
                      {errorDetails?.stage ? ` · ${errorDetails.stage}` : ''}
                    </p>
                    <ul className="space-y-1 min-w-0">
                      {missingFields.map((field) => (
                        <li key={`missing-${field}`} className="text-[10.5px] leading-snug min-w-0">
                          <div className="flex flex-wrap items-baseline gap-1.5 min-w-0">
                            <span className="inline-block rounded-md px-1.5 py-0.5 text-[9.5px] font-bold bg-amber-100 text-amber-900 border border-amber-200/90 shrink-0">
                              Kosong
                            </span>
                            <code className="font-mono text-[10px] font-bold text-rose-950 break-all">
                              {field}
                            </code>
                          </div>
                          {fieldReasons[field] && (
                            <p className="text-[10px] text-slate-700 mt-0.5 break-words">
                              {fieldReasons[field]}
                            </p>
                          )}
                        </li>
                      ))}

                      {invalidFields.map((field) => (
                        <li key={`invalid-${field}`} className="text-[10.5px] leading-snug min-w-0">
                          <div className="flex flex-wrap items-baseline gap-1.5 min-w-0">
                            <span className="inline-block rounded-md px-1.5 py-0.5 text-[9.5px] font-bold bg-rose-100 text-rose-800 border border-rose-200 shrink-0">
                              Tidak valid
                            </span>
                            <code className="font-mono text-[10px] font-bold text-rose-950 break-all">
                              {field}
                            </code>
                          </div>
                          {fieldReasons[field] && (
                            <p className="text-[10px] text-slate-700 mt-0.5 break-words">
                              {fieldReasons[field]}
                            </p>
                          )}
                        </li>
                      ))}

                      {extraReasonEntries.map(([field, reason]) => (
                        <li key={`reason-${field}`} className="text-[10.5px] leading-snug min-w-0">
                          <div className="flex flex-wrap items-baseline gap-1.5 min-w-0">
                            <span className="inline-block rounded-md px-1.5 py-0.5 text-[9.5px] font-bold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                              Alasan
                            </span>
                            <code className="font-mono text-[10px] font-bold text-rose-950 break-all">
                              {field}
                            </code>
                          </div>
                          <p className="text-[10px] text-slate-700 mt-0.5 break-words">{reason}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
