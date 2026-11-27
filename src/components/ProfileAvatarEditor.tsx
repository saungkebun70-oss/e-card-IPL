import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Trash2, X, AlertCircle } from 'lucide-react';
import type { SessionUser } from '../types';
import {
  removeAccountAvatar,
  uploadAccountAvatar,
  validateAvatarFile,
} from '../lib/avatarService';
import { UserAvatar } from './UserAvatar';
import { LoadingSpinner } from './LoadingSpinner';

interface ProfileAvatarEditorProps {
  session: SessionUser;
  avatarUrl?: string | null;
  subtitle?: string;
  onAvatarUpdated: (nextUrl: string | null) => void;
  onToast?: (type: 'success' | 'error' | 'info', msg: string) => void;
  compact?: boolean;
}

export function ProfileAvatarEditor({
  session,
  avatarUrl,
  subtitle,
  onAvatarUpdated,
  onToast,
  compact = false,
}: ProfileAvatarEditorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const clearPendingSelection = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setSelectedFile(null);
    setErrorMsg(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const check = validateAvatarFile(file);
    if (!check.valid) {
      const err = check.error || 'File foto tidak valid.';
      setErrorMsg(err);
      onToast?.('error', err);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setErrorMsg(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSavePhoto = async () => {
    if (!selectedFile || saving) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await uploadAccountAvatar(session, selectedFile);
      if (res.error) {
        setErrorMsg(res.error);
        onToast?.('error', res.error);
      } else {
        const nextUrl = res.avatarUrl || null;
        onAvatarUpdated(nextUrl);
        clearPendingSelection();
        onToast?.('success', 'Foto profil berhasil diperbarui.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (removing || saving) return;
    setRemoving(true);
    setErrorMsg(null);
    try {
      const res = await removeAccountAvatar(session);
      if (res.error) {
        setErrorMsg(res.error);
        onToast?.('error', res.error);
      } else {
        onAvatarUpdated(null);
        clearPendingSelection();
        onToast?.('info', 'Foto profil dihapus dan kembali ke avatar inisial.');
      }
    } finally {
      setRemoving(false);
    }
  };

  const displayedSrc = previewUrl || avatarUrl || null;
  const hasSavedAvatar = Boolean(avatarUrl && avatarUrl.trim());
  const isBusy = saving || removing;

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Avatar Lingkaran dengan Preview Langsung */}
        <div className="relative self-start shrink-0">
          <UserAvatar
            name={session.nama_warga}
            src={displayedSrc}
            size={compact ? 'lg' : 'xl'}
            ringClassName={
              previewUrl
                ? 'ring-4 ring-[#2B3F29]/30 border-[#2B3F29]'
                : 'ring-2 ring-[#C6D2BF]'
            }
          />
          {previewUrl && (
            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#243825] text-[#FFFDF8] text-[10px] font-semibold shadow-sm whitespace-nowrap">
              Pratinjau
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={handleFileChange}
            disabled={isBusy}
            className="hidden"
          />
        </div>

        {/* Info Akun & Tombol Aksi */}
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="min-w-0">
            <h3 className="text-base sm:text-lg font-bold text-[#1B271B] truncate">
              {session.nama_warga}
            </h3>
            {subtitle && <p className="text-xs text-[#6E786D] truncate mt-0.5">{subtitle}</p>}
            <p className="text-[11px] text-[#6E786D] mt-1">
              Format JPG, JPEG, PNG, atau WebP · Maksimal 2 MB
            </p>
          </div>

          {selectedFile && previewUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                aria-busy={saving}
                onClick={() => void handleSavePhoto()}
                className="min-h-[40px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer shadow-xs whitespace-nowrap"
              >
                {saving ? (
                  <LoadingSpinner size="xs" tone="white" label="Menyimpan foto profil" />
                ) : (
                  <Check className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{saving ? 'Menyimpan...' : 'Simpan Foto'}</span>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={clearPendingSelection}
                className="min-h-[40px] px-3.5 rounded-full border border-[#E6E2D6] bg-[#FFFDF8] hover:bg-[#F7F4EC] text-[#1B271B] text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>Batal</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[40px] px-4 rounded-full bg-[#2B3F29] hover:bg-[#243825] disabled:opacity-60 text-[#FFFDF8] text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer shadow-xs whitespace-nowrap"
              >
                <Camera className="w-3.5 h-3.5 shrink-0" />
                <span>Ganti Foto</span>
              </button>

              {hasSavedAvatar && (
                <button
                  type="button"
                  disabled={isBusy}
                  aria-busy={removing}
                  onClick={() => void handleRemovePhoto()}
                  className="min-h-[40px] px-3.5 rounded-full border border-[#E2A898] bg-[#C87058]/12 hover:bg-[#C87058]/20 disabled:opacity-60 text-[#9A422B] text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 active:scale-[0.97] cursor-pointer whitespace-nowrap"
                >
                  {removing ? (
                    <LoadingSpinner size="xs" tone="danger" label="Menghapus foto profil" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{removing ? 'Menghapus...' : 'Hapus Foto'}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-2xl bg-[#C87058]/12 border border-[#E2A898] px-3 py-2 text-xs text-[#7A311E] flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#C87058]" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
}
