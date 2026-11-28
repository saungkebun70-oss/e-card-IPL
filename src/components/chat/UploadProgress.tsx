import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Trash2,
  Video,
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
  if (type === 'video') return Video;
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

  return (
    <div
      aria-live="polite"
      className={`max-h-48 overflow-y-auto space-y-2 pr-0.5 overscroll-contain min-w-0 ${className}`.trim()}
    >
      {items.map((item) => {
        const AttachmentIcon = getAttachmentIcon(item.attachmentType);
        const clampedPercent = Math.max(0, Math.min(100, Math.round(item.percent)));
        const stageText = describeUploadStage(item.phase, item.status);
        const extLabel = getFileExtensionLabel(item.file.name, item.file.type);
        const isUploading = item.status === 'uploading';
        const isFailed = item.status === 'failed';
        const isCompleted = item.status === 'completed';

        return (
          <div
            key={item.localId}
            className={`rounded-2xl border px-2.5 py-2 transition-colors min-w-0 ${
              isFailed
                ? 'bg-[#C87058]/10 border-[#E2A898]'
                : isCompleted
                  ? 'bg-[#E5EEE3]/90 border-[#C6D2BF]'
                  : 'bg-[#FFFDF8] border-[#E6E2D6]'
            }`}
          >
            <div className="flex items-start gap-2 min-w-0">
              {item.attachmentType === 'photo' && item.localPreviewUrl ? (
                <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 mt-0.5 border border-[#C6D2BF] bg-[#FFFDF8] shadow-2xs">
                  <img
                    src={item.localPreviewUrl}
                    alt={item.file.name}
                    className="w-full h-full object-cover"
                  />
                  {isUploading && (
                    <span className="absolute inset-0 bg-[#1B271B]/35 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 text-[#FFFDF8] animate-spin" />
                    </span>
                  )}
                  {isFailed && (
                    <span className="absolute inset-0 bg-[#7A311E]/50 flex items-center justify-center">
                      <AlertCircle className="w-3.5 h-3.5 text-[#FFFDF8]" />
                    </span>
                  )}
                </div>
              ) : (
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    isFailed
                      ? 'bg-[#C87058]/15 text-[#7A311E]'
                      : 'bg-[#E5EEE3] text-[#243825] border border-[#C6D2BF]'
                  }`}
                >
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isFailed ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    <AttachmentIcon className="w-4 h-4" />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <p className="text-xs font-bold text-[#1B271B] truncate min-w-0">
                    {item.file.name}
                  </p>
                  <span
                    className={`text-[11px] font-mono font-bold tabular-nums shrink-0 ${
                      isFailed
                        ? 'text-[#9A422B]'
                        : isCompleted
                          ? 'text-[#243825]'
                          : 'text-[#2B3F29]'
                    }`}
                  >
                    {clampedPercent}%
                  </span>
                </div>

                <p className="text-[10.5px] text-[#4A554A] truncate mt-0.5">
                  <span>{extLabel}</span>
                  <span> · </span>
                  <span className="tabular-nums">{formatFileSize(item.totalBytes)}</span>
                  <span> · </span>
                  <span
                    className={
                      isFailed
                        ? 'text-[#9A422B] font-semibold'
                        : isCompleted
                          ? 'text-[#243825] font-semibold'
                          : 'text-[#384E35] font-semibold'
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
                    className={`h-1.5 w-full flex-1 appearance-none rounded-full overflow-hidden bg-[#F6F3EA] [&::-webkit-progress-bar]:bg-[#F6F3EA] [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:transition-all ${
                      isFailed
                        ? '[&::-webkit-progress-value]:bg-[#C87058] [&::-moz-progress-bar]:bg-[#C87058]'
                        : isCompleted
                          ? '[&::-webkit-progress-value]:bg-[#2B3F29] [&::-moz-progress-bar]:bg-[#2B3F29]'
                          : '[&::-webkit-progress-value]:bg-[#384E35] [&::-moz-progress-bar]:bg-[#384E35]'
                    }`}
                  />
                  {isCompleted && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#2B3F29] shrink-0" />
                  )}
                </div>

                {isUploading && item.phaseLabel && (
                  <p className="text-[10px] text-[#6E786D] truncate mt-1">{item.phaseLabel}</p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isUploading && (
                  <button
                    type="button"
                    onClick={() => onCancel(item.localId)}
                    aria-label={`Batalkan unggah ${item.file.name}`}
                    title="Batalkan unggahan"
                    className="min-h-[36px] min-w-[36px] px-2 rounded-xl border border-[#E2A898] bg-[#FFFDF8] hover:bg-[#C87058]/10 text-[#9A422B] text-[11px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer shrink-0"
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
                      className="min-h-[36px] min-w-[36px] px-2 rounded-xl border border-[#C6D2BF] bg-[#FFFDF8] hover:bg-[#E5EEE3] text-[#243825] text-[11px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer shrink-0"
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
                        className="min-h-[36px] min-w-[36px] p-1 rounded-xl border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#C87058]/10 text-[#9A422B] inline-flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
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
                    className="min-h-[36px] min-w-[36px] p-1.5 rounded-xl border border-[#C6D2BF] bg-[#FFFDF8] hover:bg-[#C87058]/10 hover:text-[#9A422B] hover:border-[#E2A898] text-[#4A554A] inline-flex items-center justify-center cursor-pointer shrink-0 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {isFailed && item.error && (
              <div className="mt-2 pt-1.5 border-t border-[#E2A898]/70 min-w-0">
                <p className="text-[10.5px] text-[#7A311E] font-medium break-words leading-snug">
                  {item.error}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
