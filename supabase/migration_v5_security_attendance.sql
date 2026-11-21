-- ============================================================================
-- MIGRATION V5: ABSENSI KERJA PETUGAS KEAMANAN (CLOCK-IN & CLOCK-OUT REALTIME)
-- Perumahan Saung Kebun — Terintegrasi Shift 1, Shift 2, Shift 3 & Lembur Minggu
-- Idempotent & aman dijalankan ulang di Supabase SQL Editor.
-- ============================================================================

create extension if not exists pgcrypto;

-- Pastikan helper pembaca HTTP header custom tersedia (pola autentikasi PIN aplikasi)
create or replace function public.req_header(header_name text) returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json->>lower(header_name),
    ''
  );
$$;

-- 1. Tabel Absensi Petugas Keamanan (security_attendance)
create table if not exists public.security_attendance (
  id uuid primary key default gen_random_uuid(),
  officer_name text not null,
  shift_date date not null,
  shift_name text not null,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  status text not null default 'on_duty' check (status in ('on_duty', 'completed')),
  clock_in_photo_url text,
  handover_notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_attendance_shift_date
  on public.security_attendance (shift_date desc, clock_in_at desc);

create index if not exists idx_security_attendance_officer_status
  on public.security_attendance (officer_name, status, clock_in_at desc);

create index if not exists idx_security_attendance_status_clock_in
  on public.security_attendance (status, clock_in_at desc);

-- 2. Helper kepemilikan baris absensi untuk role Petugas Keamanan
--    Memverifikasi x-petugas-id terhadap tabel petugas_keamanan yang aktif
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
        and lower(trim(p.nama)) = lower(trim(row_officer_name))
    );
$$;

grant execute on function public.is_own_security_attendance(text) to anon, authenticated;

-- 3. Row Level Security (RLS)
--    - Keamanan (petugas): SELECT, INSERT (absen masuk), UPDATE (absen pulang) untuk datanya sendiri
--    - Admin (admin): Akses penuh (SELECT, INSERT, UPDATE, DELETE)
--    - Warga (warga): Hanya baca (SELECT saja / read-only)
alter table public.security_attendance enable row level security;

drop policy if exists "security_attendance_select_policy" on public.security_attendance;
drop policy if exists "security_attendance_insert_policy" on public.security_attendance;
drop policy if exists "security_attendance_update_policy" on public.security_attendance;
drop policy if exists "security_attendance_delete_policy" on public.security_attendance;

-- SELECT: Admin & Warga (read-only), Petugas untuk datanya sendiri
create policy "security_attendance_select_policy"
  on public.security_attendance
  for select
  to anon, authenticated
  using (
    public.req_header('x-user-role') in ('admin', 'warga')
    or public.is_own_security_attendance(officer_name)
    or nullif(current_setting('request.headers', true), '') is null
  );

-- INSERT: Admin (full) atau Petugas untuk datanya sendiri (absen masuk)
create policy "security_attendance_insert_policy"
  on public.security_attendance
  for insert
  to anon, authenticated
  with check (
    public.req_header('x-user-role') = 'admin'
    or public.is_own_security_attendance(officer_name)
  );

-- UPDATE: Admin (full / koreksi absensi) atau Petugas untuk datanya sendiri (absen pulang)
create policy "security_attendance_update_policy"
  on public.security_attendance
  for update
  to anon, authenticated
  using (
    public.req_header('x-user-role') = 'admin'
    or public.is_own_security_attendance(officer_name)
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    or public.is_own_security_attendance(officer_name)
  );

-- DELETE: Hanya Admin yang memiliki akses penuh menghapus baris absensi
create policy "security_attendance_delete_policy"
  on public.security_attendance
  for delete
  to anon, authenticated
  using (
    public.req_header('x-user-role') = 'admin'
  );

-- 4. Aktifkan Supabase Realtime agar perubahan absen masuk/pulang langsung tampil di Admin & Warga
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'security_attendance'
  ) then
    alter publication supabase_realtime add table public.security_attendance;
  end if;
end
$$;
