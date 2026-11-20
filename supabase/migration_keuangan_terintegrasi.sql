-- =========================================================================
-- Migrasi Sistem Keuangan Terintegrasi & Stempel Digital Pengurus
-- Aplikasi: e-Card Verifikasi & IPL Digital — Perumahan Saung Kebun
-- Aman dijalankan berulang (Idempotent) di Supabase SQL Editor
-- =========================================================================

-- 1. Tambah kolom stempel_url pada app_settings (PNG transparan stempel resmi pengurus)
alter table if exists public.app_settings
  add column if not exists stempel_url text;

-- 2. Tambah kolom nominal_ipl_bulanan pada payment_config (default Rp 100.000)
alter table if exists public.payment_config
  add column if not exists nominal_ipl_bulanan integer not null default 100000;

-- 3. Tabel transaksi_kas (Pengeluaran Anggaran & Pemasukan Lain Non-Iuran)
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

create index if not exists idx_transaksi_kas_tanggal on public.transaksi_kas (tanggal desc, created_at desc);
create index if not exists idx_transaksi_kas_jenis on public.transaksi_kas (jenis);

alter table public.transaksi_kas enable row level security;

drop policy if exists "transaksi_kas_select_policy" on public.transaksi_kas;
create policy "transaksi_kas_select_policy"
  on public.transaksi_kas
  for select
  using (true);

drop policy if exists "transaksi_kas_insert_policy" on public.transaksi_kas;
create policy "transaksi_kas_insert_policy"
  on public.transaksi_kas
  for insert
  with check (public.is_ecard_admin());

drop policy if exists "transaksi_kas_update_policy" on public.transaksi_kas;
create policy "transaksi_kas_update_policy"
  on public.transaksi_kas
  for update
  using (public.is_ecard_admin())
  with check (public.is_ecard_admin());

drop policy if exists "transaksi_kas_delete_policy" on public.transaksi_kas;
create policy "transaksi_kas_delete_policy"
  on public.transaksi_kas
  for delete
  using (public.is_ecard_admin());
