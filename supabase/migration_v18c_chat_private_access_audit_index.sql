-- ============================================================================
-- MIGRASI v18 — BAGIAN 18C: INDEKS LOOKUP FILE PRIVAT & AUDIT KEAMANAN
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
-- Jalankan setelah Bagian 17A–17D dan Bagian 18A–18B.
-- ============================================================================

alter table if exists public.community_chat_messages
  add column if not exists attachment_drive_file_id text;

create index if not exists idx_community_chat_drive_file_room
  on public.community_chat_messages (attachment_drive_file_id, room_id)
  where attachment_drive_file_id is not null;

create index if not exists idx_audit_logs_action_timestamp
  on public.audit_logs (action, timestamp desc);
