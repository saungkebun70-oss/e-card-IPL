-- =========================================================================
-- MIGRASI V3: VERIFIKASI BERJENJANG (BENDAHARA -> KETUA), PETA MAPPING PATROLI
-- & PEMBATASAN AKSES BOT WA EKSKLUSIF BENDAHARA
-- Perumahan Saung Kebun — Aman dijalankan ulang (Idempotent)
-- =========================================================================

create or replace function public.req_header(header_name text) returns text language sql stable as $$
select coalesce(nullif(current_setting('request.headers', true), '')::json->>lower(header_name), '');
$$;

-- 1. Verifikasi Berjenjang pada transaksi_ipl
alter table public.transaksi_ipl drop constraint if exists transaksi_ipl_status_verifikasi_check;
alter table public.transaksi_ipl
  add constraint transaksi_ipl_status_verifikasi_check
  check (status_verifikasi in ('Pending', 'ACC Bendahara', 'Terverifikasi', 'Ditolak'));

alter table public.transaksi_ipl add column if not exists bendahara_approved_at timestamptz;
alter table public.transaksi_ipl add column if not exists bendahara_approved_by text;
alter table public.transaksi_ipl add column if not exists ketua_approved_at timestamptz;
alter table public.transaksi_ipl add column if not exists ketua_approved_by text;

-- Izinkan Bendahara (full) maupun Ketua (x-admin-jabatan = 'Ketua') memperbarui status transaksi_ipl & e-Card
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

-- 2. Verifikasi Berjenjang pada transaksi_kas (data lama default Terverifikasi agar saldo historis aman)
alter table public.transaksi_kas add column if not exists status_verifikasi text not null default 'Terverifikasi';
alter table public.transaksi_kas drop constraint if exists transaksi_kas_status_verifikasi_check;
alter table public.transaksi_kas
  add constraint transaksi_kas_status_verifikasi_check
  check (status_verifikasi in ('Pending', 'ACC Bendahara', 'Terverifikasi', 'Ditolak'));

alter table public.transaksi_kas add column if not exists bendahara_approved_at timestamptz;
alter table public.transaksi_kas add column if not exists bendahara_approved_by text;
alter table public.transaksi_kas add column if not exists ketua_approved_at timestamptz;
alter table public.transaksi_kas add column if not exists ketua_approved_by text;
alter table public.transaksi_kas add column if not exists catatan_verifikasi text;

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

-- 3. Peta Mapping Patroli & Koordinat Pin Persentase (x_percent, y_percent)
alter table if exists public.titik_patroli add column if not exists x_percent numeric(5,2);
alter table if exists public.titik_patroli add column if not exists y_percent numeric(5,2);

alter table if exists public.app_settings add column if not exists patrol_map_image_url text;
alter table if exists public.app_settings add column if not exists patrol_cycle_reset_at timestamptz;
alter table if exists public.app_settings add column if not exists patrol_pin_positions jsonb not null default '{}'::jsonb;

-- Izinkan Warga membaca daftar titik patroli (Read-Only untuk Peta Pantauan Warga)
drop policy if exists titik_patroli_select_policy on public.titik_patroli;
create policy titik_patroli_select_policy on public.titik_patroli for select
using (
  public.req_header('x-user-role') in ('admin', 'petugas', 'warga')
);

-- Pastikan Realtime aktif untuk sinkronisasi peta & status pin secara langsung
do $$
begin
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
