-- ============================================================================
-- MIGRASI v13: HAPUS LOG (AUDIT, KEAMANAN, BUG) & CHAT REAL-TIME ANTAR PORTAL
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
--
-- Mencakup:
--   1. Hak akses & RLS DELETE khusus Admin pada:
--      - public.audit_logs (Log Aktivitas & Audit Sistem)
--      - public.bug_reports + storage.objects bucket `bug-reports` (Laporan Bug)
--      - public.log_patroli (Log Patroli Keamanan)
--   2. Tabel public.community_chat_messages untuk komunikasi real-time antar
--      Pengurus (Admin), Warga, dan Petugas Keamanan dengan kontrol akses per ruang:
--      - `forum_umum`        : Pengurus, Warga & Keamanan
--      - `pengurus_warga`    : Pengurus & Warga
--      - `pengurus_keamanan` : Pengurus & Keamanan (terisolasi dari Warga)
--      - `warga_keamanan`    : Warga, Keamanan & Pengurus
--   3. Publikasi Supabase Realtime untuk public.community_chat_messages.
-- ============================================================================

create extension if not exists pgcrypto;

-- 0. Pastikan helper public.req_header(text) tersedia
create or replace function public.req_header(header_name text)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json->>lower(header_name),
    ''
  );
$$;

grant execute on function public.req_header(text) to anon, authenticated;

-- ============================================================================
-- 1. HAPUS LOG AUDIT SISTEM (public.audit_logs)
-- ============================================================================
do $$
begin
  if to_regclass('public.audit_logs') is not null then
    execute 'grant delete on public.audit_logs to anon, authenticated';
    execute 'drop policy if exists "audit_delete_admin" on public.audit_logs';
    execute $pol$
      create policy "audit_delete_admin" on public.audit_logs
        for delete using (
          lower(trim(public.req_header('x-user-role'))) = 'admin'
        )
    $pol$;
  end if;
end $$;

-- ============================================================================
-- 2. HAPUS LAPORAN BUG & SCREENSHOT (public.bug_reports & storage.objects)
-- ============================================================================
do $$
begin
  if to_regclass('public.bug_reports') is not null then
    execute 'grant delete on public.bug_reports to anon, authenticated';
    execute 'drop policy if exists "bug_reports_delete_admin" on public.bug_reports';
    execute $pol$
      create policy "bug_reports_delete_admin" on public.bug_reports
        for delete using (
          lower(trim(public.req_header('x-user-role'))) = 'admin'
        )
    $pol$;
  end if;
end $$;

drop policy if exists "bug_reports_storage_admin_delete" on storage.objects;
create policy "bug_reports_storage_admin_delete" on storage.objects
  for delete using (
    bucket_id in ('bug-reports', 'bukti-ipl')
    and lower(trim(public.req_header('x-user-role'))) = 'admin'
  );

-- ============================================================================
-- 3. HAPUS LOG PATROLI KEAMANAN (public.log_patroli)
-- ============================================================================
do $$
begin
  if to_regclass('public.log_patroli') is not null then
    execute 'grant delete on public.log_patroli to anon, authenticated';
    execute 'drop policy if exists "log_patroli_delete_admin" on public.log_patroli';
    execute $pol$
      create policy "log_patroli_delete_admin" on public.log_patroli
        for delete using (
          lower(trim(public.req_header('x-user-role'))) = 'admin'
        )
    $pol$;
  end if;
end $$;

-- ============================================================================
-- 4. FITUR CHAT REAL-TIME ANTAR PENGURUS, WARGA & KEAMANAN
-- ============================================================================
create table if not exists public.community_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null check (
    room_id in ('forum_umum', 'pengurus_warga', 'pengurus_keamanan', 'warga_keamanan')
  ),
  sender_role text not null check (sender_role in ('admin', 'warga', 'petugas', 'keamanan')),
  sender_id text not null,
  sender_name text not null,
  sender_subtitle text not null default '',
  sender_avatar_url text,
  message text not null check (char_length(trim(message)) between 1 and 1000),
  reply_to_id uuid references public.community_chat_messages(id) on delete set null,
  reply_preview text,
  created_at timestamptz not null default now()
);

create index if not exists idx_community_chat_room_created
  on public.community_chat_messages (room_id, created_at desc);

create index if not exists idx_community_chat_sender
  on public.community_chat_messages (sender_id);

grant select, insert, delete on public.community_chat_messages to anon, authenticated;

alter table public.community_chat_messages enable row level security;

-- Helper akses ruang chat berdasarkan role header
drop policy if exists "community_chat_select_portal" on public.community_chat_messages;
create policy "community_chat_select_portal" on public.community_chat_messages
  for select using (
    lower(trim(public.req_header('x-user-role'))) = 'admin'
    or (
      lower(trim(public.req_header('x-user-role'))) = 'warga'
      and room_id in ('forum_umum', 'pengurus_warga', 'warga_keamanan')
    )
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and room_id in ('forum_umum', 'pengurus_keamanan', 'warga_keamanan')
    )
  );

drop policy if exists "community_chat_insert_portal" on public.community_chat_messages;
create policy "community_chat_insert_portal" on public.community_chat_messages
  for insert with check (
    (
      lower(trim(public.req_header('x-user-role'))) = 'admin'
      and sender_role = 'admin'
    )
    or (
      lower(trim(public.req_header('x-user-role'))) = 'warga'
      and sender_role = 'warga'
      and room_id in ('forum_umum', 'pengurus_warga', 'warga_keamanan')
    )
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and sender_role in ('petugas', 'keamanan')
      and room_id in ('forum_umum', 'pengurus_keamanan', 'warga_keamanan')
    )
  );

-- Admin dapat memoderasi/menghapus pesan mana saja; pengirim dapat menghapus pesannya sendiri
drop policy if exists "community_chat_delete_portal" on public.community_chat_messages;
create policy "community_chat_delete_portal" on public.community_chat_messages
  for delete using (
    lower(trim(public.req_header('x-user-role'))) = 'admin'
    or (
      lower(trim(public.req_header('x-user-role'))) = 'warga'
      and lower(trim(sender_id)) = 'warga:' || lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
    )
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and lower(trim(sender_id)) in (
        'petugas:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g')),
        'keamanan:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g'))
      )
    )
  );

-- Aktifkan Supabase Realtime untuk tabel community_chat_messages (idempotent)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'community_chat_messages'
    ) then
      alter publication supabase_realtime add table public.community_chat_messages;
    end if;
  end if;
end $$;
