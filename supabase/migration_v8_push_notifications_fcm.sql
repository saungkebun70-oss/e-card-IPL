-- ============================================================================
-- MIGRASI v8: PUSH NOTIFICATION MULTI-PLATFORM (Android, iOS, & Web FCM)
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
--
-- Mencakup:
--   1. Standarisasi tabel public.user_push_tokens:
--        - user_id  : format seragam (warga:<blok>, admin:<id_atau_blok>, keamanan:<id_atau_nama>)
--        - role     : 'warga' | 'admin' | 'keamanan' (kompatibel dengan 'petugas')
--        - blok     : blok rumah (tersinkron dengan blok_rumah)
--        - platform : 'android' | 'ios' | 'web'
--        - token    : FCM / APNs / Web Push token
--        - updated_at
--   2. Unique constraint komposit (user_id, token) agar 1 akun yang login
--      di HP dan Web sekaligus tetap menerima push di kedua perangkat tanpa saling menimpa.
--   3. Kebijakan RLS & pembaruan public.current_notification_user_ids()
--      agar mendukung prefix keamanan:* & petugas:*, alias Bendahara/Ketua,
--      serta variasi blok B3/7 <-> B03/07.
--
-- Catatan Edge Function `send-push-notification`:
--   Pastikan Secret berikut diset di Supabase Dashboard -> Edge Functions -> Secrets:
--     - FIREBASE_SERVICE_ACCOUNT (JSON Service Account Firebase atau Base64)
--   (atau 3 secret terpisah: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY)
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

-- 1. Tabel Penyimpanan Token FCM/APNs/Web Push Multi-Platform
create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  role text not null,
  blok text,
  blok_rumah text,
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_push_tokens_role_check check (role in ('warga', 'admin', 'keamanan', 'petugas')),
  constraint user_push_tokens_user_id_token_key unique (user_id, token)
);

-- Pastikan seluruh kolom tersedia apabila tabel sudah dibuat pada versi sebelumnya
alter table public.user_push_tokens
  add column if not exists blok text;

alter table public.user_push_tokens
  add column if not exists blok_rumah text;

alter table public.user_push_tokens
  add column if not exists platform text not null default 'android';

alter table public.user_push_tokens
  add column if not exists created_at timestamptz not null default now();

alter table public.user_push_tokens
  add column if not exists updated_at timestamptz not null default now();

-- Sinkronisasi nilai kolom blok <-> blok_rumah pada data lama
update public.user_push_tokens
set
  blok = coalesce(nullif(trim(blok), ''), nullif(trim(blok_rumah), '')),
  blok_rumah = coalesce(nullif(trim(blok_rumah), ''), nullif(trim(blok), ''))
where blok is distinct from blok_rumah;

-- Perbarui CHECK constraint kolom role agar menerima 'keamanan' maupun 'petugas'
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.user_push_tokens'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.user_push_tokens drop constraint if exists %I', v_con.conname);
  end loop;

  alter table public.user_push_tokens
    add constraint user_push_tokens_role_check
    check (role in ('warga', 'admin', 'keamanan', 'petugas'));
exception when duplicate_object then
  null;
end $$;

-- Perbarui CHECK constraint kolom platform
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.user_push_tokens'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%platform%'
  loop
    execute format('alter table public.user_push_tokens drop constraint if exists %I', v_con.conname);
  end loop;

  alter table public.user_push_tokens
    add constraint user_push_tokens_platform_check
    check (platform in ('android', 'ios', 'web'));
exception when duplicate_object then
  null;
end $$;

-- Ganti unique constraint lama pada kolom (token) tunggal menjadi komposit (user_id, token)
alter table public.user_push_tokens
  drop constraint if exists user_push_tokens_token_key;

drop index if exists public.idx_user_push_tokens_token_unique;

-- Bersihkan duplikat (user_id, token) bila ada sebelum memasang unique constraint komposit
delete from public.user_push_tokens a
using public.user_push_tokens b
where a.ctid < b.ctid
  and a.user_id = b.user_id
  and a.token = b.token;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_push_tokens'::regclass
      and conname = 'user_push_tokens_user_id_token_key'
  ) then
    alter table public.user_push_tokens
      add constraint user_push_tokens_user_id_token_key unique (user_id, token);
  end if;
exception when duplicate_object then
  null;
end $$;

create index if not exists idx_user_push_tokens_user_id
  on public.user_push_tokens (user_id);

create index if not exists idx_user_push_tokens_role
  on public.user_push_tokens (role);

create index if not exists idx_user_push_tokens_token
  on public.user_push_tokens (token);

create index if not exists idx_user_push_tokens_platform
  on public.user_push_tokens (platform);

create index if not exists idx_user_push_tokens_updated_at
  on public.user_push_tokens (updated_at desc);

grant select, insert, update, delete on public.user_push_tokens to anon, authenticated;

alter table public.user_push_tokens enable row level security;

drop policy if exists "user_push_tokens_select_portal" on public.user_push_tokens;
create policy "user_push_tokens_select_portal" on public.user_push_tokens
  for select using (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  );

drop policy if exists "user_push_tokens_insert_portal" on public.user_push_tokens;
create policy "user_push_tokens_insert_portal" on public.user_push_tokens
  for insert with check (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  );

drop policy if exists "user_push_tokens_update_portal" on public.user_push_tokens;
create policy "user_push_tokens_update_portal" on public.user_push_tokens
  for update using (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  )
  with check (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  );

drop policy if exists "user_push_tokens_delete_portal" on public.user_push_tokens;
create policy "user_push_tokens_delete_portal" on public.user_push_tokens
  for delete using (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  );

-- 2. Pembaruan Helper RLS Notifikasi (mendukung role:*, keamanan:* & petugas:*, Bendahara/Ketua, & B3/7 <-> B03/07)
create or replace function public.current_notification_user_ids()
returns text[]
language plpgsql
stable
as $$
declare
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_blok text := lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'));
  v_petugas_id text := trim(public.req_header('x-petugas-id'));
  v_petugas_name text := lower(regexp_replace(trim(public.req_header('x-petugas-name')), '\s+', '', 'g'));
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
  elsif v_role in ('petugas', 'keamanan') then
    v_ids := array_append(v_ids, 'broadcast:petugas');
    v_ids := array_append(v_ids, 'broadcast:keamanan');
    v_ids := array_append(v_ids, 'role:petugas');
    v_ids := array_append(v_ids, 'role:keamanan');
    if v_petugas_id <> '' then
      v_ids := array_append(v_ids, 'petugas:' || lower(v_petugas_id));
      v_ids := array_append(v_ids, 'keamanan:' || lower(v_petugas_id));
    end if;
    if v_blok <> '' then
      v_ids := array_append(v_ids, 'petugas:' || v_blok);
      v_ids := array_append(v_ids, 'keamanan:' || v_blok);
    end if;
    if v_petugas_name <> '' then
      v_ids := array_append(v_ids, 'petugas:' || v_petugas_name);
      v_ids := array_append(v_ids, 'keamanan:' || v_petugas_name);
    end if;
  end if;

  return v_ids;
end;
$$;

grant execute on function public.current_notification_user_ids() to anon, authenticated;

-- 3. Sinkronisasi Tabel & Kebijakan RLS `public.notifications` (Lonceng In-App + Header Login PIN)
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

grant select, insert, update, delete on public.notifications to anon, authenticated;

alter table public.notifications enable row level security;
alter table public.notifications replica identity full;

-- SELECT: izinkan anon & authenticated membaca notifikasi milik akun sendiri / role / broadcast
-- sesuai `current_notification_user_ids()` maupun header PIN (`x-user-role`, `x-blok-rumah`, `x-petugas-id`)
drop policy if exists "notifications_select_own_isolated" on public.notifications;
create policy "notifications_select_own_isolated" on public.notifications
  for select to anon, authenticated
  using (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
    or (
      lower(trim(public.req_header('x-user-role'))) = 'warga'
      and nullif(lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g')), '') is not null
      and lower(trim(user_id)) = 'warga:' || lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
    )
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and nullif(lower(trim(public.req_header('x-petugas-id'))), '') is not null
      and lower(trim(user_id)) in (
        'petugas:' || lower(trim(public.req_header('x-petugas-id'))),
        'keamanan:' || lower(trim(public.req_header('x-petugas-id')))
      )
    )
  );

-- INSERT: izinkan anon & authenticated dari semua portal login PIN (admin, warga, petugas, keamanan)
drop policy if exists "notifications_insert_authenticated_portals" on public.notifications;
create policy "notifications_insert_authenticated_portals" on public.notifications
  for insert to anon, authenticated
  with check (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  );

-- UPDATE (`is_read`): izinkan anon & authenticated menandai notifikasi miliknya sebagai sudah dibaca
drop policy if exists "notifications_update_own_read" on public.notifications;
create policy "notifications_update_own_read" on public.notifications
  for update to anon, authenticated
  using (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
    and lower(trim(user_id)) not like 'broadcast:%'
  )
  with check (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
    and lower(trim(user_id)) not like 'broadcast:%'
  );

-- DELETE: izinkan anon & authenticated menghapus notifikasi personal miliknya
drop policy if exists "notifications_delete_own_isolated" on public.notifications;
create policy "notifications_delete_own_isolated" on public.notifications
  for delete to anon, authenticated
  using (
    lower(trim(user_id)) = any(public.current_notification_user_ids())
    and lower(trim(user_id)) not like 'broadcast:%'
  );

-- Pastikan publikasi Supabase Realtime aktif untuk tabel public.notifications
do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
