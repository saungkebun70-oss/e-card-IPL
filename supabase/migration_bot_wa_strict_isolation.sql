-- ============================================================================
-- MIGRASI SUPABASE: Strict Sender-to-Unit Isolation Bot WhatsApp (Fonnte)
-- Aplikasi: e-Card Verifikasi & IPL Digital — Perumahan Saung Kebun
-- Jalankan 1 kali di Supabase -> SQL Editor -> Run.
-- ============================================================================

-- 1. Tambahkan kolom WhatsApp cadangan (pasangan) & hak akses bot pada tabel master warga
alter table public.users_warga
  add column if not exists secondary_whatsapp text not null default '';

alter table public.users_warga
  add column if not exists bot_role text not null default 'warga';

alter table public.users_warga
  drop constraint if exists users_warga_bot_role_check;

alter table public.users_warga
  add constraint users_warga_bot_role_check
  check (bot_role in ('warga', 'admin', 'bendahara'));

-- Pastikan kolom role utama tetap mendukung 'warga', 'admin', dan 'bendahara' bila dibutuhkan
alter table public.users_warga
  drop constraint if exists users_warga_role_check;

alter table public.users_warga
  add constraint users_warga_role_check
  check (role in ('warga', 'admin', 'bendahara'));

-- 2. Normalisasi nomor WA yang sudah ada menjadi format 628xxxxxxxxxx
update public.users_warga
set no_wa = case
  when regexp_replace(no_wa, '\D', '', 'g') like '0%'
    then '62' || substr(regexp_replace(no_wa, '\D', '', 'g'), 2)
  when regexp_replace(no_wa, '\D', '', 'g') like '8%'
    then '62' || regexp_replace(no_wa, '\D', '', 'g')
  else regexp_replace(no_wa, '\D', '', 'g')
end
where no_wa is not null and no_wa <> '';

update public.users_warga
set secondary_whatsapp = case
  when regexp_replace(secondary_whatsapp, '\D', '', 'g') like '0%'
    then '62' || substr(regexp_replace(secondary_whatsapp, '\D', '', 'g'), 2)
  when regexp_replace(secondary_whatsapp, '\D', '', 'g') like '8%'
    then '62' || regexp_replace(secondary_whatsapp, '\D', '', 'g')
  else regexp_replace(secondary_whatsapp, '\D', '', 'g')
end
where secondary_whatsapp is not null and secondary_whatsapp <> '';

-- Setel bot_role otomatis 'bendahara' / 'admin' untuk akun pengurus yang sudah ada
update public.users_warga
set bot_role = case
  when jabatan = 'Bendahara' or admin_permission = 'full' then 'bendahara'
  when role in ('admin', 'bendahara') then 'admin'
  else bot_role
end
where role in ('admin', 'bendahara');

-- 3. Indeks pencarian cepat untuk autentikasi pengirim Webhook Fonnte
create index if not exists idx_users_warga_no_wa
  on public.users_warga (no_wa)
  where no_wa <> '';

create index if not exists idx_users_warga_secondary_whatsapp
  on public.users_warga (secondary_whatsapp)
  where secondary_whatsapp <> '';

create index if not exists idx_users_warga_bot_role
  on public.users_warga (bot_role);

create index if not exists idx_users_warga_canonical_blok
  on public.users_warga (
    regexp_replace(upper(trim(blok_rumah)), '^([A-Z]+)0*([0-9]+)/0*([0-9]+)$', '\1\2/\3')
  );

-- 4. Pastikan policy log Bot WA & RLS mendukung role admin/bendahara
drop policy if exists "admin_bot_logs_insert" on public.bot_wa_logs;
create policy "admin_bot_logs_insert" on public.bot_wa_logs
  for insert with check (public.req_header('x-user-role') in ('admin', 'bendahara'));
