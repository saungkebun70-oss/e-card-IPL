-- ============================================================================
-- MIGRASI v12: Single Push Pipeline (Anti-Double Push Notification di Android)
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
--
-- Mengatasi masalah munculnya 2 push notification identik di panel HP Android
-- untuk 1 event (misalnya 1 pembayaran IPL baru):
--   1. Menghapus trigger Database Webhook ganda pada `public.notifications`
--      (seperti `push_on_new_notification` atau trigger HTTP ke `super-action`,
--      `super-handler`, `dynamic-responder`, atau `send-push-notification`)
--      agar push hanya dikirim dari 1 sumber terpusat (`send-push-notification`).
--   2. Memastikan deduplikasi token perangkat pada `public.user_push_tokens`.
--   3. Menambahkan constraint unik atomik `sig_bucket_key` pada
--      `public.push_dispatch_logs` untuk mencegah race condition antar-isolate
--      Edge Function saat mengirim FCM ke token yang sama dalam jendela 30 detik.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Hapus trigger Database Webhook / HTTP push ganda pada public.notifications
drop trigger if exists push_on_new_notification on public.notifications;
drop trigger if exists trg_push_on_new_notification on public.notifications;
drop trigger if exists on_new_notification_push on public.notifications;
drop trigger if exists notify_push_on_new_notification on public.notifications;
drop trigger if exists send_push_on_notification_insert on public.notifications;

do $$
declare
  v_trig record;
begin
  for v_trig in
    select
      t.tgname,
      pg_get_triggerdef(t.oid) as tgdef
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'notifications'
      and not t.tgisinternal
      and (
        pg_get_triggerdef(t.oid) ilike '%http_request%'
        or pg_get_triggerdef(t.oid) ilike '%http_post%'
        or pg_get_triggerdef(t.oid) ilike '%send-push-notification%'
        or pg_get_triggerdef(t.oid) ilike '%super-action%'
        or pg_get_triggerdef(t.oid) ilike '%super-handler%'
        or pg_get_triggerdef(t.oid) ilike '%dynamic-responder%'
        or t.tgname ilike '%push%'
      )
  loop
    execute format('drop trigger if exists %I on public.notifications', v_trig.tgname);
    raise notice 'Menghapus trigger webhook push ganda pada public.notifications: %', v_trig.tgname;
  end loop;
end $$;

-- 2. Pastikan public.user_push_tokens bersih & memiliki unique index pada token fisik
alter table public.user_push_tokens
  add column if not exists device_id text;

alter table public.user_push_tokens
  drop constraint if exists user_push_tokens_user_id_token_key;

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

update public.user_push_tokens
set token = trim(token)
where token is distinct from trim(token);

create unique index if not exists idx_user_push_tokens_token_unique
  on public.user_push_tokens (token);

create unique index if not exists idx_user_push_tokens_user_device_unique
  on public.user_push_tokens (lower(trim(user_id)), device_id)
  where device_id is not null and trim(device_id) <> '';

-- 3. Pastikan public.push_dispatch_logs tersedia + kolom atomik sig_bucket_key
create table if not exists public.push_dispatch_logs (
  dispatch_key text primary key,
  sig_hash text,
  sig_bucket_key text,
  notification_id text,
  dedup_key text,
  token_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.push_dispatch_logs
  add column if not exists sig_bucket_key text;

-- Bersihkan duplikat sig_bucket_key jika pernah ada sebelum memasang unique index
with ranked_sig as (
  select
    dispatch_key,
    row_number() over (
      partition by sig_bucket_key
      order by created_at asc, dispatch_key asc
    ) as rn
  from public.push_dispatch_logs
  where sig_bucket_key is not null
)
delete from public.push_dispatch_logs p
using ranked_sig r
where p.dispatch_key = r.dispatch_key
  and r.rn > 1;

create unique index if not exists idx_push_dispatch_logs_sig_bucket_unique
  on public.push_dispatch_logs (sig_bucket_key)
  where sig_bucket_key is not null;

create index if not exists idx_push_dispatch_logs_sig_created
  on public.push_dispatch_logs (sig_hash, created_at desc);

create index if not exists idx_push_dispatch_logs_created_at
  on public.push_dispatch_logs (created_at);

-- Bersihkan log idempotency lama (> 7 hari) agar tabel tetap ringan
delete from public.push_dispatch_logs
where created_at < now() - interval '7 days';

alter table public.push_dispatch_logs enable row level security;

revoke all on public.push_dispatch_logs from anon, authenticated;
grant select, insert, delete on public.push_dispatch_logs to service_role;
