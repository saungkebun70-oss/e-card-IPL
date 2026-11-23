-- ============================================================================
-- MIGRASI v8: TABEL PUSH TOKEN FCM/APNs (Android & iOS) + PEMBARUAN RLS NOTIFIKASI
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- Mengaktifkan:
--   1. Tabel public.user_push_tokens (token unik per perangkat Android & iOS)
--   2. Kebijakan RLS untuk sinkronisasi token dari portal Warga, Pengurus, & Petugas
--   3. Pembaruan public.current_notification_user_ids() agar cocok dengan role:*,
--      alias Bendahara/Ketua, serta variasi format blok B3/7 <-> B03/07
--
-- Catatan Edge Function `send-push-notification`:
--   Pastikan Secret berikut diset di Supabase Dashboard -> Edge Functions -> Secrets:
--     - FCM_PROJECT_ID
--     - FCM_CLIENT_EMAIL
--     - FCM_PRIVATE_KEY
--   (atau satu secret JSON/Base64: FIREBASE_SERVICE_ACCOUNT)
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

-- 1. Tabel Penyimpanan Token FCM/APNs Perangkat (Android & iOS)
create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role text not null check (role in ('warga', 'admin', 'petugas')),
  blok_rumah text,
  token text not null unique,
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_push_tokens
  add column if not exists blok_rumah text;

alter table public.user_push_tokens
  add column if not exists platform text not null default 'android';

alter table public.user_push_tokens
  add column if not exists created_at timestamptz not null default now();

alter table public.user_push_tokens
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_user_push_tokens_user_id
  on public.user_push_tokens (user_id);

create index if not exists idx_user_push_tokens_role
  on public.user_push_tokens (role);

create index if not exists idx_user_push_tokens_updated_at
  on public.user_push_tokens (updated_at desc);

grant select, insert, update, delete on public.user_push_tokens to anon, authenticated;

alter table public.user_push_tokens enable row level security;

drop policy if exists "user_push_tokens_select_portal" on public.user_push_tokens;
create policy "user_push_tokens_select_portal" on public.user_push_tokens
  for select using (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas')
  );

drop policy if exists "user_push_tokens_insert_portal" on public.user_push_tokens;
create policy "user_push_tokens_insert_portal" on public.user_push_tokens
  for insert with check (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas')
  );

drop policy if exists "user_push_tokens_update_portal" on public.user_push_tokens;
create policy "user_push_tokens_update_portal" on public.user_push_tokens
  for update using (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas')
  )
  with check (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas')
  );

drop policy if exists "user_push_tokens_delete_portal" on public.user_push_tokens;
create policy "user_push_tokens_delete_portal" on public.user_push_tokens
  for delete using (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas')
  );

-- 2. Pembaruan Helper RLS Notifikasi agar mendukung role:*, alias Bendahara/Ketua, & B3/7 <-> B03/07
create or replace function public.current_notification_user_ids()
returns text[]
language plpgsql
stable
as $$
declare
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_blok text := lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'));
  v_petugas_id text := trim(public.req_header('x-petugas-id'));
  v_jabatan text := lower(trim(public.req_header('x-admin-jabatan')));
  v_perm text := lower(trim(public.req_header('x-admin-permission')));
  v_ids text[] := array['broadcast:all'];
  v_match text[];
  v_prefix text;
  v_bnum integer;
  v_hnum integer;
begin
  if v_role = 'warga' and v_blok <> '' then
    v_ids := array_append(v_ids, 'broadcast:warga');
    v_ids := array_append(v_ids, 'role:warga');
    v_ids := array_append(v_ids, 'warga:' || v_blok);
    v_match := regexp_match(v_blok, '^([a-z]+)0*(\d+)/0*(\d+)$');
    if v_match is not null then
      v_prefix := v_match[1];
      v_bnum := v_match[2]::integer;
      v_hnum := v_match[3]::integer;
      v_ids := array_append(v_ids, 'warga:' || v_prefix || v_bnum::text || '/' || v_hnum::text);
      v_ids := array_append(
        v_ids,
        'warga:' || v_prefix || lpad(v_bnum::text, 2, '0') || '/' || lpad(v_hnum::text, 2, '0')
      );
    end if;
  elsif v_role = 'admin' then
    v_ids := array_append(v_ids, 'broadcast:admin');
    v_ids := array_append(v_ids, 'role:admin');
    if v_blok <> '' then
      v_ids := array_append(v_ids, 'admin:' || v_blok);
    end if;
    if v_blok = 'admin' or v_jabatan = 'bendahara' or v_perm = 'full' then
      v_ids := array_append(v_ids, 'admin:andriansyah');
      v_ids := array_append(v_ids, 'admin:admin');
      v_ids := array_append(v_ids, 'role:bendahara');
    end if;
    if v_jabatan = 'ketua' or v_blok = 'erlangga' then
      v_ids := array_append(v_ids, 'admin:erlangga');
      v_ids := array_append(v_ids, 'role:ketua');
    end if;
  elsif v_role = 'petugas' then
    v_ids := array_append(v_ids, 'broadcast:petugas');
    v_ids := array_append(v_ids, 'role:petugas');
    if v_petugas_id <> '' then
      v_ids := array_append(v_ids, 'petugas:' || lower(v_petugas_id));
    end if;
    if v_blok <> '' then
      v_ids := array_append(v_ids, 'petugas:' || v_blok);
    end if;
  end if;

  return v_ids;
end;
$$;

grant execute on function public.current_notification_user_ids() to anon, authenticated;
