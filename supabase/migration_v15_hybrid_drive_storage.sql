-- ============================================================================
-- MIGRATION V15: DUKUNGAN PENYIMPANAN MODE HYBRID (SUPABASE + GOOGLE DRIVE)
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- Target Drive Pusat: saungkebun70@gmail.com
-- ============================================================================

-- 1. Pastikan kolom opsional konfigurasi hybrid drive tersedia di app_settings
alter table if exists public.app_settings
  add column if not exists hybrid_drive_config jsonb not null default '{}'::jsonb;

-- 2. Pastikan Admin dapat menghapus salinan media lama di Supabase Storage
--    setelah media berhasil diarsipkan ke Google Drive saungkebun70@gmail.com
drop policy if exists "hybrid_storage_admin_delete" on storage.objects;
create policy "hybrid_storage_admin_delete" on storage.objects
  for delete using (
    bucket_id in ('bukti-ipl', 'bug-reports', 'avatars')
    and lower(trim(public.req_header('x-user-role'))) = 'admin'
  );
