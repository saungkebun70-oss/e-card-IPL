-- ============================================================================
-- MIGRASI v17 — BAGIAN 17A: KOLOM LAMPIRAN MEDIA PADA community_chat_messages
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
-- Jalankan bagian ini PERTAMA sebelum Bagian 17B, 17C, dan 17D.
-- ============================================================================

alter table if exists public.community_chat_messages
  add column if not exists attachment_type text not null default 'none',
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size_bytes bigint,
  add column if not exists attachment_storage_provider text,
  add column if not exists attachment_drive_file_id text,
  add column if not exists attachment_drive_folder_path text,
  add column if not exists attachment_url text,
  add column if not exists attachment_thumbnail_url text,
  add column if not exists attachment_status text;

alter table if exists public.community_chat_messages
  drop constraint if exists community_chat_messages_attachment_type_check;

alter table if exists public.community_chat_messages
  add constraint community_chat_messages_attachment_type_check
  check (attachment_type in ('none', 'photo', 'document', 'video'));

alter table if exists public.community_chat_messages
  drop constraint if exists community_chat_messages_attachment_provider_check;

alter table if exists public.community_chat_messages
  add constraint community_chat_messages_attachment_provider_check
  check (
    attachment_storage_provider is null
    or attachment_storage_provider in ('google_drive', 'supabase_transit')
  );

alter table if exists public.community_chat_messages
  drop constraint if exists community_chat_messages_attachment_status_check;

alter table if exists public.community_chat_messages
  add constraint community_chat_messages_attachment_status_check
  check (
    attachment_status is null
    or attachment_status in ('pending_transfer', 'uploading_video', 'ready', 'failed')
  );

create index if not exists idx_community_chat_drive_file_id
  on public.community_chat_messages (attachment_drive_file_id)
  where attachment_drive_file_id is not null;

create index if not exists idx_community_chat_attachment_status
  on public.community_chat_messages (attachment_status)
  where attachment_status is not null;
