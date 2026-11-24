-- ============================================================================
-- MIGRASI v11: Deduplikasi Token FCM Per Perangkat & Idempotency Push Server
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
--
-- Mengatasi masalah push notification tampil ganda/3x di HP Android:
--   1. Menambahkan `device_id` pada `public.user_push_tokens` dan membersihkan
--      token duplikat/usang agar 1 perangkat fisik hanya memiliki 1 token aktif.
--   2. Memasang unique index pada `(token)` (1 token fisik hanya milik 1 akun aktif)
--      serta `(lower(trim(user_id)), device_id)` (rotasi token menimpa token lama).
--   3. Membuat tabel `public.push_dispatch_logs` untuk idempotency persisten
--      lintas-isolate pada Edge Function `send-push-notification`.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Tambah kolom device_id pada public.user_push_tokens
alter table public.user_push_tokens
  add column if not exists device_id text;

-- 2. Hapus constraint lama (user_id, token) jika ada agar token fisik unik 1:1
alter table public.user_push_tokens
  drop constraint if exists user_push_tokens_user_id_token_key;

-- 3. Bersihkan duplikat berdasarkan string token yang sama (pertahankan yang paling baru diperbarui)
with ranked_tokens as (
  select
    id,
    row_number() over (
      partition by trim(token)
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.user_push_tokens
  where token is not null and trim(token) <> ''
)
delete from public.user_push_tokens t
using ranked_tokens r
where t.id = r.id
  and r.rn > 1;

-- Normalkan spasi token yang tersisa
update public.user_push_tokens
set token = trim(token)
where token is distinct from trim(token);

-- 4. Bersihkan duplikat berdasarkan (user_id, device_id) bila device_id terisi
with ranked_devices as (
  select
    id,
    row_number() over (
      partition by lower(trim(user_id)), device_id
      order by updated_at desc, created_at desc, id desc
    ) as rn
  from public.user_push_tokens
  where device_id is not null and trim(device_id) <> ''
)
delete from public.user_push_tokens t
using ranked_devices r
where t.id = r.id
  and r.rn > 1;

-- 5. Pasang unique index pada token fisik & pasangan (user_id, device_id)
create unique index if not exists idx_user_push_tokens_token_unique
  on public.user_push_tokens (token);

create unique index if not exists idx_user_push_tokens_user_device_unique
  on public.user_push_tokens (lower(trim(user_id)), device_id)
  where device_id is not null and trim(device_id) <> '';

create index if not exists idx_user_push_tokens_device_id
  on public.user_push_tokens (device_id)
  where device_id is not null;

-- 6. Tabel log idempotency persisten untuk Edge Function `send-push-notification`
create table if not exists public.push_dispatch_logs (
  dispatch_key text primary key,
  sig_hash text,
  notification_id text,
  dedup_key text,
  token_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_dispatch_logs_sig_created
  on public.push_dispatch_logs (sig_hash, created_at desc);

create index if not exists idx_push_dispatch_logs_created_at
  on public.push_dispatch_logs (created_at);

alter table public.push_dispatch_logs enable row level security;

-- Hanya service_role (Edge Function) yang mengakses tabel idempotency ini
revoke all on public.push_dispatch_logs from anon, authenticated;
grant select, insert, delete on public.push_dispatch_logs to service_role;
