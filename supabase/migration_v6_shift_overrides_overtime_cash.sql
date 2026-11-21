-- ============================================================================
-- MIGRATION V6: INTEGRASI JADWAL SHIFT, LEMBUR MINGGU & KAS PENGELUARAN
-- Perumahan Saung Kebun — security_shift_overrides <-> transaksi_kas + RLS Ketat
-- Idempotent & aman dijalankan ulang di Supabase SQL Editor.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. HELPER VERIFIKASI ROLE & KEPEMILIKAN PETUGAS (DIPAKAI DI RLS)
-- ----------------------------------------------------------------------------
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

create or replace function public.is_admin_request()
returns boolean
language sql
stable
as $$
  select public.req_header('x-user-role') = 'admin';
$$;

create or replace function public.is_own_security_attendance(row_officer_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.req_header('x-user-role') = 'petugas'
    and exists (
      select 1
      from public.petugas_keamanan p
      where p.id::text = public.req_header('x-petugas-id')
        and p.aktif = true
        and lower(trim(p.nama)) = lower(trim(coalesce(row_officer_name, '')))
    );
$$;

grant execute on function public.req_header(text) to anon, authenticated;
grant execute on function public.is_admin_request() to anon, authenticated;
grant execute on function public.is_own_security_attendance(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. TABEL security_shift_overrides + KOLOM PEMBAYARAN LEMBUR
-- ----------------------------------------------------------------------------
create table if not exists public.security_shift_overrides (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  officer_name text not null,
  shift_name text not null default 'Lembur Minggu (19:00-07:00)',
  notes text,
  overtime_amount numeric not null default 0 check (overtime_amount >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  paid_at timestamptz,
  cash_transaction_id uuid references public.transaksi_kas(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tambah kolom secara idempotent apabila tabel security_shift_overrides sudah ada
alter table public.security_shift_overrides
  add column if not exists overtime_amount numeric not null default 0;

alter table public.security_shift_overrides
  add column if not exists payment_status text not null default 'unpaid';

alter table public.security_shift_overrides
  add column if not exists paid_at timestamptz;

alter table public.security_shift_overrides
  add column if not exists cash_transaction_id uuid references public.transaksi_kas(id) on delete set null;

alter table public.security_shift_overrides
  add column if not exists notes text;

alter table public.security_shift_overrides
  add column if not exists created_by text;

alter table public.security_shift_overrides
  add column if not exists updated_at timestamptz not null default now();

-- Pastikan CHECK constraint overtime_amount & payment_status terpasang
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'security_shift_overrides_overtime_amount_check'
  ) then
    alter table public.security_shift_overrides
      add constraint security_shift_overrides_overtime_amount_check
      check (overtime_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'security_shift_overrides_payment_status_check'
  ) then
    alter table public.security_shift_overrides
      add constraint security_shift_overrides_payment_status_check
      check (payment_status in ('unpaid', 'paid'));
  end if;
exception when duplicate_object then null;
end $$;

-- Indeks performa query jadwal & filter pembayaran
create index if not exists idx_security_shift_overrides_date
  on public.security_shift_overrides (shift_date desc, created_at desc);

create index if not exists idx_security_shift_overrides_officer
  on public.security_shift_overrides (officer_name, shift_date desc);

create index if not exists idx_security_shift_overrides_payment_status
  on public.security_shift_overrides (payment_status, shift_date desc);

-- ----------------------------------------------------------------------------
-- 2. REFERENSI BALIK DI transaksi_kas + PROTEKSI ANTI DOUBLE-ENTRY
-- ----------------------------------------------------------------------------
alter table if exists public.transaksi_kas
  add column if not exists shift_override_id uuid references public.security_shift_overrides(id) on delete set null;

create unique index if not exists idx_transaksi_kas_shift_override_unique
  on public.transaksi_kas (shift_override_id)
  where shift_override_id is not null;

-- ----------------------------------------------------------------------------
-- 3. KEBIJAKAN RLS KETAT: security_shift_overrides
--    - Admin: Akses penuh (SELECT, INSERT, UPDATE, DELETE)
--    - Petugas Keamanan: HANYA SELECT data lembur/shift miliknya sendiri
--    - Warga / lainnya: Tidak memiliki akses
-- ----------------------------------------------------------------------------
alter table public.security_shift_overrides enable row level security;

drop policy if exists "security_shift_overrides_select_policy" on public.security_shift_overrides;
drop policy if exists "security_shift_overrides_insert_policy" on public.security_shift_overrides;
drop policy if exists "security_shift_overrides_update_policy" on public.security_shift_overrides;
drop policy if exists "security_shift_overrides_delete_policy" on public.security_shift_overrides;

create policy "security_shift_overrides_select_policy"
  on public.security_shift_overrides
  for select
  to anon, authenticated
  using (
    public.is_admin_request()
    or public.is_own_security_attendance(officer_name)
  );

create policy "security_shift_overrides_insert_policy"
  on public.security_shift_overrides
  for insert
  to anon, authenticated
  with check (
    public.is_admin_request()
  );

create policy "security_shift_overrides_update_policy"
  on public.security_shift_overrides
  for update
  to anon, authenticated
  using (
    public.is_admin_request()
  )
  with check (
    public.is_admin_request()
  );

create policy "security_shift_overrides_delete_policy"
  on public.security_shift_overrides
  for delete
  to anon, authenticated
  using (
    public.is_admin_request()
  );

-- ----------------------------------------------------------------------------
-- 4. KEBIJAKAN RLS KETAT: transaksi_kas (KAS PENGELUARAN & HONOR PETUGAS)
--    - Admin: Akses penuh (SELECT, INSERT, UPDATE, DELETE)
--    - Petugas Keamanan: HANYA SELECT data honor/lembur milik dirinya sendiri
-- ----------------------------------------------------------------------------
alter table public.transaksi_kas enable row level security;

drop policy if exists "transaksi_kas_select_policy" on public.transaksi_kas;
drop policy if exists "transaksi_kas_insert_policy" on public.transaksi_kas;
drop policy if exists "transaksi_kas_update_policy" on public.transaksi_kas;
drop policy if exists "transaksi_kas_delete_policy" on public.transaksi_kas;

create policy "transaksi_kas_select_policy"
  on public.transaksi_kas
  for select
  to anon, authenticated
  using (
    public.is_admin_request()
    or (
      public.req_header('x-user-role') = 'petugas'
      and jenis = 'pengeluaran'
      and (
        petugas_id::text = public.req_header('x-petugas-id')
        or public.is_own_security_attendance(penerima_atau_sumber)
      )
    )
  );

create policy "transaksi_kas_insert_policy"
  on public.transaksi_kas
  for insert
  to anon, authenticated
  with check (
    public.is_admin_request()
  );

create policy "transaksi_kas_update_policy"
  on public.transaksi_kas
  for update
  to anon, authenticated
  using (
    public.is_admin_request()
  )
  with check (
    public.is_admin_request()
  );

create policy "transaksi_kas_delete_policy"
  on public.transaksi_kas
  for delete
  to anon, authenticated
  using (
    public.is_admin_request()
  );

-- ----------------------------------------------------------------------------
-- 5. AKTIFKAN SUPABASE REALTIME UNTUK SINKRONISASI LANGSUNG
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'security_shift_overrides'
  ) then
    alter publication supabase_realtime add table public.security_shift_overrides;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'transaksi_kas'
  ) then
    alter publication supabase_realtime add table public.transaksi_kas;
  end if;
end
$$;
