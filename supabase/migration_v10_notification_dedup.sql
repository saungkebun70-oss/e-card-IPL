-- =========================================================================
-- Migrasi v10: Centralized Deduplication & Idempotency Notifikasi (e-Card IPL)
-- Menambahkan kolom `dedup_key`, membersihkan baris ganda eksisting, dan
-- memasang unique index agar 1 event hanya menghasilkan 1 baris per penerima.
-- =========================================================================

-- 1. Tambah kolom dedup_key pada public.notifications (idempotent)
alter table public.notifications
  add column if not exists dedup_key text;

-- 2. Bersihkan baris notifikasi ganda yang memiliki (user_id, dedup_key) identik
with ranked_dedup as (
  select
    id,
    row_number() over (
      partition by lower(trim(user_id)), dedup_key
      order by is_read desc, created_at desc, id desc
    ) as rn
  from public.notifications
  where dedup_key is not null
)
delete from public.notifications n
using ranked_dedup r
where n.id = r.id
  and r.rn > 1;

-- 3. Bersihkan duplikat lama (tanpa dedup_key) yang dikirim berdekatan dalam 60 detik
with ranked_legacy as (
  select
    id,
    row_number() over (
      partition by
        lower(trim(user_id)),
        category,
        trim(title),
        trim(message),
        floor(extract(epoch from created_at) / 60)
      order by is_read desc, created_at desc, id desc
    ) as rn
  from public.notifications
  where dedup_key is null
)
delete from public.notifications n
using ranked_legacy r
where n.id = r.id
  and r.rn > 1;

-- 4. Index unik parsial untuk mencegah duplikasi idempotency pada sumber database
create unique index if not exists idx_notifications_user_dedup_key
  on public.notifications (lower(trim(user_id)), dedup_key)
  where dedup_key is not null;

-- 5. Index bantu untuk lookup cepat dedup_key
create index if not exists idx_notifications_dedup_key
  on public.notifications (dedup_key)
  where dedup_key is not null;
