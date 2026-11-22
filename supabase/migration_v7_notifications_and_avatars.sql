-- ============================================================================
-- MIGRASI v7: NOTIFIKASI REAL-TIME SEMUA AKTIVITAS & FOTO PROFIL SEMUA AKUN
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- Mengaktifkan:
--   0. Extension pgcrypto & helper public.req_header(text)
--   1. Kolom avatar_url pada users_warga (Warga & Pengurus) dan petugas_keamanan
--   2. Storage bucket publik 'avatars' untuk foto profil (maks 2 MB, JPG/PNG/WebP)
--   3. RPC aman update_account_avatar untuk semua role (Warga, Pengurus, Keamanan)
--   4. Tabel public.notifications + RLS ketat + publikasi Supabase Realtime
-- ============================================================================

create extension if not exists pgcrypto;

-- 0. Pastikan helper pembaca custom header sesi tersedia
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

-- 1. Kolom avatar_url pada tabel akun (nullable)
alter table public.users_warga
  add column if not exists avatar_url text;

do $$
begin
  if to_regclass('public.petugas_keamanan') is not null then
    execute 'alter table public.petugas_keamanan add column if not exists avatar_url text';
  end if;
end $$;

-- 2. Storage Bucket Publik 'avatars' untuk Foto Profil Semua Akun
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_portal_upload" on storage.objects;
create policy "avatars_portal_upload" on storage.objects
  for insert with check (bucket_id = 'avatars');

drop policy if exists "avatars_portal_update" on storage.objects;
create policy "avatars_portal_update" on storage.objects
  for update using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');

drop policy if exists "avatars_portal_delete" on storage.objects;
create policy "avatars_portal_delete" on storage.objects
  for delete using (bucket_id = 'avatars');

-- 3. Fungsi RPC Aman untuk Memperbarui / Menghapus Foto Profil Akun Sendiri (Semua Role)
create or replace function public.update_account_avatar(
  p_role text,
  p_identifier text,
  p_avatar_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req_role text := lower(trim(public.req_header('x-user-role')));
  v_req_blok text := lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'));
  v_req_petugas_id text := trim(public.req_header('x-petugas-id'));
  v_clean_id text := lower(regexp_replace(trim(coalesce(p_identifier, '')), '\s+', '', 'g'));
  v_updated integer := 0;
begin
  if p_role in ('warga', 'admin') then
    if v_req_role <> p_role then
      raise exception 'Akses ditolak: role sesi tidak sesuai.';
    end if;
    if v_req_role = 'warga' and v_req_blok <> v_clean_id then
      raise exception 'Akses ditolak: warga hanya dapat mengubah foto profil unit sendiri.';
    end if;
    if v_req_role = 'admin' and v_req_blok <> v_clean_id and public.req_header('x-admin-permission') <> 'full' then
      raise exception 'Akses ditolak: pengurus hanya dapat mengubah foto profil akun sendiri.';
    end if;

    update public.users_warga
    set avatar_url = p_avatar_url
    where lower(regexp_replace(trim(blok_rumah), '\s+', '', 'g')) = v_clean_id;

    get diagnostics v_updated = row_count;
    return v_updated > 0;
  elsif p_role = 'petugas' then
    if v_req_role <> 'petugas' and v_req_role <> 'admin' then
      raise exception 'Akses ditolak: hanya petugas terkait atau pengurus yang dapat mengubah foto profil.';
    end if;
    if v_req_role = 'petugas' and v_req_petugas_id <> '' and v_req_petugas_id <> trim(p_identifier) then
      raise exception 'Akses ditolak: petugas hanya dapat mengubah foto profil sendiri.';
    end if;

    if to_regclass('public.petugas_keamanan') is not null then
      execute '
        update public.petugas_keamanan
        set avatar_url = $1
        where id::text = $2 or lower(trim(username)) = lower(trim($2))
      ' using p_avatar_url, trim(p_identifier);
      get diagnostics v_updated = row_count;
      return v_updated > 0;
    end if;
  end if;

  return false;
end;
$$;

grant execute on function public.update_account_avatar(text, text, text) to anon, authenticated;

-- 4. Tabel Notifikasi Semua Aktivitas Real-Time (public.notifications)
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  actor_id text,
  actor_name text,
  actor_avatar_url text,
  category text not null check (category in ('ipl', 'finance', 'patrol', 'announcement', 'system')),
  title text not null,
  message text not null,
  is_read boolean not null default false,
  target_url text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, is_read)
  where is_read = false;

create index if not exists idx_notifications_category
  on public.notifications (category, created_at desc);

-- Helper kanonisasi user_id penerima dari custom header sesi
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
  v_ids text[] := array['broadcast:all'];
begin
  if v_role = 'warga' and v_blok <> '' then
    v_ids := array_append(v_ids, 'broadcast:warga');
    v_ids := array_append(v_ids, 'warga:' || v_blok);
  elsif v_role = 'admin' then
    v_ids := array_append(v_ids, 'broadcast:admin');
    if v_blok <> '' then
      v_ids := array_append(v_ids, 'admin:' || v_blok);
    end if;
    if v_blok = 'admin' or v_jabatan = 'bendahara' then
      v_ids := array_append(v_ids, 'admin:andriansyah');
      v_ids := array_append(v_ids, 'role:bendahara');
    end if;
    if v_jabatan = 'ketua' or v_blok = 'erlangga' then
      v_ids := array_append(v_ids, 'admin:erlangga');
      v_ids := array_append(v_ids, 'role:ketua');
    end if;
  elsif v_role = 'petugas' then
    v_ids := array_append(v_ids, 'broadcast:petugas');
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
grant select, insert, update, delete on public.notifications to anon, authenticated;

alter table public.notifications enable row level security;
alter table public.notifications replica identity full;

drop policy if exists "notifications_select_own_isolated" on public.notifications;
create policy "notifications_select_own_isolated" on public.notifications
  for select using (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
  );

drop policy if exists "notifications_insert_authenticated_portals" on public.notifications;
create policy "notifications_insert_authenticated_portals" on public.notifications
  for insert with check (
    public.req_header('x-user-role') in ('admin', 'warga', 'petugas')
  );

drop policy if exists "notifications_update_own_read" on public.notifications;
create policy "notifications_update_own_read" on public.notifications
  for update using (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
    and lower(trim(user_id)) not like 'broadcast:%'
  )
  with check (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
    and lower(trim(user_id)) not like 'broadcast:%'
  );

drop policy if exists "notifications_delete_own_isolated" on public.notifications;
create policy "notifications_delete_own_isolated" on public.notifications
  for delete using (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
    and lower(trim(user_id)) not like 'broadcast:%'
  );

-- Aktifkan publikasi Supabase Realtime untuk tabel notifications
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
