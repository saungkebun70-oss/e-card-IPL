-- =========================================================================
-- MIGRASI V3: VERIFIKASI BERJENJANG (BENDAHARA -> KETUA), PETA MAPPING PATROLI
-- & PEMBATASAN AKSES BOT WA EKSKLUSIF BENDAHARA
-- Perumahan Saung Kebun — Aman dijalankan ulang (Idempotent & Anti-Error 42P01)
-- =========================================================================

create extension if not exists pgcrypto;

create or replace function public.req_header(header_name text) returns text language sql stable as $$
select coalesce(nullif(current_setting('request.headers', true), '')::json->>lower(header_name), '');
$$;

-- =========================================================================
-- 1. PASTIKAN TABEL app_settings TERSEDIA + KOLOM PETA PATROLI & STEMPEL
-- =========================================================================
create table if not exists public.app_settings (
  id text primary key default 'default-app-brand',
  app_name text not null default 'e-Card Verifikasi',
  app_subtitle text not null default 'IPL Digital — Perumahan Saung Kebun',
  kop_resmi text not null default 'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)',
  logo_url text,
  stempel_url text,
  wa_pengurus text not null default '6281234567890',
  wa_pengurus_label text not null default 'Andriansyah (Bendahara)',
  wa_bot text not null default '',
  pengurus_wa_map jsonb not null default '{}'::jsonb,
  patrol_map_image_url text,
  patrol_cycle_reset_at timestamptz,
  patrol_pin_positions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.app_settings add column if not exists stempel_url text;
alter table public.app_settings add column if not exists wa_pengurus text not null default '6281234567890';
alter table public.app_settings add column if not exists wa_pengurus_label text not null default 'Andriansyah (Bendahara)';
alter table public.app_settings add column if not exists wa_bot text not null default '';
alter table public.app_settings add column if not exists pengurus_wa_map jsonb not null default '{}'::jsonb;
alter table public.app_settings add column if not exists patrol_map_image_url text;
alter table public.app_settings add column if not exists patrol_cycle_reset_at timestamptz;
alter table public.app_settings add column if not exists patrol_pin_positions jsonb not null default '{}'::jsonb;

insert into public.app_settings (
  id, app_name, app_subtitle, kop_resmi, logo_url, wa_pengurus, wa_pengurus_label, wa_bot, pengurus_wa_map, updated_by
)
values (
  'default-app-brand',
  'e-Card Verifikasi',
  'IPL Digital — Perumahan Saung Kebun',
  'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)',
  null,
  '6281234567890',
  'Andriansyah (Bendahara)',
  '',
  '{}'::jsonb,
  'andriansyah'
)
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read" on public.app_settings
  for select
  using (true);

drop policy if exists "bendahara_app_settings_write" on public.app_settings;
create policy "bendahara_app_settings_write" on public.app_settings
  for all
  using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

-- Izinkan Admin & Petugas memperbarui reset siklus patroli pada app_settings
drop policy if exists "app_settings_patrol_update_policy" on public.app_settings;
create policy "app_settings_patrol_update_policy"
  on public.app_settings
  for update
  using (
    public.req_header('x-user-role') in ('admin', 'petugas')
  )
  with check (
    public.req_header('x-user-role') in ('admin', 'petugas')
  );

-- =========================================================================
-- 2. VERIFIKASI BERJENJANG (BENDAHARA -> KETUA) PADA transaksi_ipl & e-Card
-- =========================================================================
alter table public.transaksi_ipl drop constraint if exists transaksi_ipl_status_verifikasi_check;
alter table public.transaksi_ipl
  add constraint transaksi_ipl_status_verifikasi_check
  check (status_verifikasi in ('Pending', 'ACC Bendahara', 'Terverifikasi', 'Ditolak'));

alter table public.transaksi_ipl add column if not exists bendahara_approved_at timestamptz;
alter table public.transaksi_ipl add column if not exists bendahara_approved_by text;
alter table public.transaksi_ipl add column if not exists ketua_approved_at timestamptz;
alter table public.transaksi_ipl add column if not exists ketua_approved_by text;
alter table public.transaksi_ipl add column if not exists ketua_catatan text;

drop policy if exists "transaksi_ipl_update_policy" on public.transaksi_ipl;
create policy "transaksi_ipl_update_policy"
  on public.transaksi_ipl
  for update
  using (
    public.req_header('x-user-role') = 'admin'
    and (
      public.req_header('x-admin-permission') = 'full'
      or lower(public.req_header('x-admin-jabatan')) = 'ketua'
    )
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    and (
      public.req_header('x-admin-permission') = 'full'
      or lower(public.req_header('x-admin-jabatan')) = 'ketua'
    )
  );

drop policy if exists "transaksi_ipl_delete_policy" on public.transaksi_ipl;
create policy "transaksi_ipl_delete_policy"
  on public.transaksi_ipl
  for delete
  using (
    public.req_header('x-user-role') = 'admin'
    and (
      public.req_header('x-admin-permission') = 'full'
      or lower(public.req_header('x-admin-jabatan')) = 'ketua'
    )
  );

drop policy if exists "status_ecard_update_policy" on public.status_ecard_bulanan;
create policy "status_ecard_update_policy"
  on public.status_ecard_bulanan
  for all
  using (
    public.req_header('x-user-role') in ('admin', 'warga')
  )
  with check (
    public.req_header('x-user-role') in ('admin', 'warga')
  );

-- =========================================================================
-- 3. VERIFIKASI BERJENJANG PADA transaksi_kas
-- =========================================================================
create table if not exists public.transaksi_kas (
  id uuid primary key default gen_random_uuid(),
  no_bukti text not null unique,
  jenis text not null check (jenis in ('pengeluaran', 'pemasukan_lain')),
  kategori text not null,
  termin text,
  tanggal date not null default current_date,
  nominal integer not null check (nominal > 0),
  penerima_atau_sumber text not null,
  keterangan text,
  bukti_url text,
  created_by text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transaksi_kas add column if not exists status_verifikasi text not null default 'Terverifikasi';
alter table public.transaksi_kas drop constraint if exists transaksi_kas_status_verifikasi_check;
alter table public.transaksi_kas
  add constraint transaksi_kas_status_verifikasi_check
  check (status_verifikasi in ('Pending', 'ACC Bendahara', 'Terverifikasi', 'Ditolak'));

alter table public.transaksi_kas add column if not exists bendahara_approved_at timestamptz;
alter table public.transaksi_kas add column if not exists bendahara_approved_by text;
alter table public.transaksi_kas add column if not exists ketua_approved_at timestamptz;
alter table public.transaksi_kas add column if not exists ketua_approved_by text;
alter table public.transaksi_kas add column if not exists ketua_catatan text;
alter table public.transaksi_kas add column if not exists catatan_verifikasi text;

alter table public.transaksi_kas enable row level security;

drop policy if exists "transaksi_kas_update_policy" on public.transaksi_kas;
create policy "transaksi_kas_update_policy"
  on public.transaksi_kas
  for update
  using (
    public.req_header('x-user-role') = 'admin'
    and (
      public.req_header('x-admin-permission') = 'full'
      or lower(public.req_header('x-admin-jabatan')) = 'ketua'
    )
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    and (
      public.req_header('x-admin-permission') = 'full'
      or lower(public.req_header('x-admin-jabatan')) = 'ketua'
    )
  );

-- =========================================================================
-- 4. KOORDINAT PIN PETA PATROLI PADA titik_patroli (READ-ONLY WARGA)
-- =========================================================================
create table if not exists public.titik_patroli (
  id uuid primary key default gen_random_uuid(),
  nama_lokasi text not null,
  rfid_uid text not null unique,
  keterangan text,
  x_percent numeric(5,2),
  y_percent numeric(5,2),
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.titik_patroli add column if not exists x_percent numeric(5,2);
alter table public.titik_patroli add column if not exists y_percent numeric(5,2);
alter table public.titik_patroli enable row level security;

drop policy if exists titik_patroli_select_policy on public.titik_patroli;
create policy titik_patroli_select_policy on public.titik_patroli for select
using (
  public.req_header('x-user-role') in ('admin', 'petugas', 'warga')
);

-- =========================================================================
-- 5. AKTIFKAN SUPABASE REALTIME UNTUK SINKRONISASI PETA & STATUS PIN LIVE
-- =========================================================================
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'log_patroli'
  ) and not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'log_patroli'
  ) then
    alter publication supabase_realtime add table public.log_patroli;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'titik_patroli'
  ) then
    alter publication supabase_realtime add table public.titik_patroli;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
exception when others then
  null;
end $$;
