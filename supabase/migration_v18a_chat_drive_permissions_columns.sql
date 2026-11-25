-- ============================================================================
-- MIGRASI v18 — BAGIAN 18A: KOLOM IZIN GOOGLE DRIVE PER RUANG CHAT
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
-- Jalankan bagian ini PERTAMA sebelum Bagian 18B dan 18C.
-- ============================================================================

alter table if exists public.community_chat_messages
  add column if not exists drive_permission_scope text,
  add column if not exists drive_web_view_link text,
  add column if not exists drive_thumbnail_link text;

-- Normalisasi baris lama pada ruang privat agar konsisten sebelum constraint dipasang
update public.community_chat_messages
set drive_permission_scope = 'restricted_private'
where (room_id = 'grup_pengurus' or room_id like 'dm:%')
  and drive_permission_scope = 'anyone_link';

alter table if exists public.community_chat_messages
  drop constraint if exists community_chat_messages_drive_permission_scope_check;

alter table if exists public.community_chat_messages
  add constraint community_chat_messages_drive_permission_scope_check
  check (
    drive_permission_scope is null
    or drive_permission_scope in ('anyone_link', 'restricted_private')
  );

-- Guardrail ketat: Grup Pengurus & DM Personal dilarang memiliki scope anyone_link
alter table if exists public.community_chat_messages
  drop constraint if exists community_chat_messages_private_room_scope_check;

alter table if exists public.community_chat_messages
  add constraint community_chat_messages_private_room_scope_check
  check (
    not (
      (room_id = 'grup_pengurus' or room_id like 'dm:%')
      and drive_permission_scope = 'anyone_link'
    )
  );

create index if not exists idx_community_chat_drive_perm_scope
  on public.community_chat_messages (room_id, drive_permission_scope)
  where drive_permission_scope is not null;
