import type { ChatAttachmentType, ChatRoomId } from '../chatService';
import {
  isVideoMediaFile,
  type ChatMediaUploadProgress,
  type ChatMediaUploadResult,
  type ChatUploadPhase,
} from '../chatMediaUpload';

export type AttachmentPickerKind = 'camera' | 'photo' | 'document' | 'video';

export type UploadItemStatus = 'uploading' | 'completed' | 'failed';

export interface UploadQueueItem {
  localId: string;
  roomId: ChatRoomId;
  file: File;
  pickerKind: AttachmentPickerKind;
  attachmentType: Exclude<ChatAttachmentType, 'none'>;
  status: UploadItemStatus;
  percent: number;
  phase: ChatUploadPhase | 'failed';
  phaseLabel: string;
  bytesUploaded: number;
  totalBytes: number;
  error: string | null;
  abortController: AbortController;
  result: ChatMediaUploadResult | null;
}

export const MAX_NON_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB (sesuai limit bucket chat-transit)
export const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB (Direct Google Drive Resumable)

export const DOCUMENT_ACCEPT_ATTR =
  '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/zip';

export const VIDEO_ACCEPT_ATTR = 'video/*,.mp4,.mov,.mkv,.avi,.webm,.3gp,.m4v';

const IMAGE_EXTENSION_RE = /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp)$/i;

export function formatFileSize(bytes?: number | null): string {
  const n = typeof bytes === 'number' && Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, '')} GB`;
}

export function getFileExtensionLabel(fileName?: string | null, mime?: string | null): string {
  const cleanName = String(fileName || '').trim();
  const dotIdx = cleanName.lastIndexOf('.');
  if (dotIdx > 0 && dotIdx < cleanName.length - 1) {
    const ext = cleanName.slice(dotIdx + 1).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (ext && ext.length <= 6) return ext;
  }
  const cleanMime = String(mime || '').trim().toLowerCase();
  if (cleanMime === 'application/pdf') return 'PDF';
  if (cleanMime.includes('spreadsheet') || cleanMime.includes('excel')) return 'XLSX';
  if (cleanMime.includes('wordprocessing') || cleanMime === 'application/msword') return 'DOCX';
  if (cleanMime.includes('presentation') || cleanMime.includes('powerpoint')) return 'PPTX';
  if (cleanMime.startsWith('image/')) return cleanMime.slice(6).toUpperCase() || 'FOTO';
  if (cleanMime.startsWith('video/')) return cleanMime.slice(6).toUpperCase() || 'VIDEO';
  if (cleanMime === 'text/csv') return 'CSV';
  if (cleanMime.startsWith('text/')) return 'TXT';
  return 'BERKAS';
}

export function isSafeExternalUrl(raw?: string | null): boolean {
  const value = String(raw || '').trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isImageMediaFile(file: Pick<File, 'type' | 'name'>): boolean {
  const mime = String(file.type || '').trim().toLowerCase();
  const name = String(file.name || '').trim().toLowerCase();
  return mime.startsWith('image/') || IMAGE_EXTENSION_RE.test(name);
}

export function validatePickedAttachment(
  file: File,
  pickerKind: AttachmentPickerKind
): { valid: true; resolvedType: Exclude<ChatAttachmentType, 'none'> } | { valid: false; error: string } {
  if (!file || file.size <= 0) {
    return {
      valid: false,
      error: 'Berkas kosong (0 byte) tidak dapat diunggah.',
    };
  }

  const isVideo = isVideoMediaFile(file);
  if (pickerKind === 'video') {
    if (!isVideo) {
      return {
        valid: false,
        error: 'Pilih berkas video (.mp4, .mov, .mkv, .webm, dll.) untuk jalur unggah langsung Google Drive.',
      };
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      return {
        valid: false,
        error: `Ukuran video (${formatFileSize(file.size)}) melebihi batas maksimal 500 MB.`,
      };
    }
    return { valid: true, resolvedType: 'video' };
  }

  // Keamanan routing ketat: bila user memilih berkas video melalui Galeri/Kamera/Dokumen,
  // tetap arahkan ke jalur Direct Resumable Video agar TIDAK PERNAH masuk chat-transit.
  if (isVideo) {
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      return {
        valid: false,
        error: `Ukuran video (${formatFileSize(file.size)}) melebihi batas maksimal 500 MB.`,
      };
    }
    return { valid: true, resolvedType: 'video' };
  }

  if (file.size > MAX_NON_VIDEO_UPLOAD_BYTES) {
    return {
      valid: false,
      error: `Ukuran foto/dokumen (${formatFileSize(file.size)}) melebihi batas transit 20 MB.`,
    };
  }

  if ((pickerKind === 'camera' || pickerKind === 'photo') && !isImageMediaFile(file)) {
    return {
      valid: false,
      error: 'Pilih berkas gambar/foto (JPG, PNG, WEBP, atau HEIC).',
    };
  }

  return {
    valid: true,
    resolvedType: isImageMediaFile(file) ? 'photo' : 'document',
  };
}

export function describeUploadStage(
  phase: ChatMediaUploadProgress['phase'] | 'failed',
  status: UploadItemStatus
): string {
  if (status === 'failed' || phase === 'failed') return 'Gagal';
  if (status === 'completed' || phase === 'completed') return 'Selesai';
  switch (phase) {
    case 'preparing':
      return 'Menyiapkan';
    case 'uploading_transit':
      return 'Mengunggah';
    case 'transferring_to_drive':
      return 'Finalisasi Drive';
    case 'initializing_video_session':
      return 'Menyiapkan Drive';
    case 'uploading_video_direct':
      return 'Mengunggah Video';
    case 'finalizing_video':
      return 'Finalisasi Drive';
    default:
      return 'Mengunggah';
  }
}
