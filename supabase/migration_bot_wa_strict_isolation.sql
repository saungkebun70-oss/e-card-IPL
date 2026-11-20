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

-- 5. Pastikan tabel payment_config & RLS tersedia agar rekening aplikasi dan Bot WA selalu sinkron
create table if not exists public.payment_config (
  id text primary key default 'default-payment-config',
  qris_aktif boolean not null default false,
  qris_image_url text,
  qris_label text not null default 'QRIS Kas Lingkungan Perumahan Saung Kebun',
  qris_catatan text not null default 'Scan kode QRIS di atas via m-Banking atau E-Wallet, lalu unggah bukti bayar di bawah.',
  rekening_list jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.payment_config enable row level security;

drop policy if exists "payment_config_select_portal" on public.payment_config;
create policy "payment_config_select_portal" on public.payment_config
  for select using (true);

drop policy if exists "bendahara_payment_config_write" on public.payment_config;
create policy "bendahara_payment_config_write" on public.payment_config
  for all using (
    public.req_header('x-user-role') in ('admin', 'bendahara')
    and public.req_header('x-admin-permission') = 'full'
  )
  with check (
    public.req_header('x-user-role') in ('admin', 'bendahara')
    and public.req_header('x-admin-permission') = 'full'
  );

-- Sinkronkan rekening resmi Blu (BCA Digital) a.n. Andriansyah bila belum ada atau masih memakai data dummy lama
insert into public.payment_config (id, qris_aktif, qris_image_url, qris_label, qris_catatan, rekening_list, updated_by)
values (
  'default-payment-config',
  false,
  null,
  'QRIS Kas Lingkungan Perumahan Saung Kebun',
  'Scan kode QRIS di atas via m-Banking atau E-Wallet, lalu unggah bukti bayar di bawah.',
  '[{"id":"rek-blu-default","bank":"Blu (BCA Digital)","nomor":"006424363822","atasNama":"Andriansyah","tipe":"Transfer Bank"}]'::jsonb,
  'andriansyah'
)
on conflict (id) do update
set
  rekening_list = excluded.rekening_list,
  updated_at = now()
where
  public.payment_config.rekening_list is null
  or jsonb_array_length(public.payment_config.rekening_list) = 0
  or public.payment_config.rekening_list::text like '%7401829304%';
