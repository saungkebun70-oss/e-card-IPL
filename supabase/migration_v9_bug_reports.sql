-- ============================================================================
-- MIGRASI v9: PELAPORAN BUG CEPAT (Error Snapshot & Screenshot Supabase Storage)
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
--
-- Mencakup:
--   1. Tabel public.bug_reports untuk menyimpan laporan bug dari Warga & Admin
--      beserta JSON error_snapshot dan URL screenshot.
--   2. Kebijakan RLS untuk role anon & authenticated sesuai sistem login PIN
--      menggunakan header x-user-role dan x-blok-rumah.
--   3. Bucket Supabase Storage `bug-reports` (public read, upload oleh pengguna portal).
-- ============================================================================

create extension if not exists pgcrypto;

-- 0. Pastikan helper public.req_header(text) tersedia
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

grant execute on function public.req_header(text) to anon, authenticated;

-- 1. Tabel public.bug_reports
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_role text not null check (reporter_role in ('warga', 'admin', 'petugas', 'keamanan')),
  reporter_id text not null,
  reporter_name text not null,
  blok_rumah text not null default '-',
  category text not null default 'lainnya' check (
    category in ('error_crash', 'ui_tampilan', 'pembayaran_ipl', 'notifikasi', 'lainnya')
  ),
  title text not null,
  description text not null,
  screenshot_url text,
  storage_bucket text,
  storage_path text,
  error_snapshot jsonb,
  app_version text not null default '1.0.0',
  platform text not null default 'web',
  status text not null default 'baru' check (status in ('baru', 'diproses', 'selesai', 'pending', 'resolved')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bug_reports_created_at
  on public.bug_reports (created_at desc);

create index if not exists idx_bug_reports_reporter_id
  on public.bug_reports (reporter_id);

create index if not exists idx_bug_reports_status
  on public.bug_reports (status);

grant select, insert, update on public.bug_reports to anon, authenticated;

alter table public.bug_reports enable row level security;

-- Admin bisa membaca semua laporan; Warga/Petugas hanya membaca laporannya sendiri
drop policy if exists "bug_reports_select_portal" on public.bug_reports;
create policy "bug_reports_select_portal" on public.bug_reports
  for select using (
    lower(trim(public.req_header('x-user-role'))) = 'admin'
    or (
      lower(trim(public.req_header('x-user-role'))) = 'warga'
      and (
        lower(trim(reporter_id)) = 'warga:' || lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
        or lower(regexp_replace(trim(blok_rumah), '\s+', '', 'g')) = lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
      )
    )
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and lower(trim(reporter_id)) in (
        'petugas:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g')),
        'keamanan:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g'))
      )
    )
  );

-- Semua pengguna portal yang login (Warga, Admin, Petugas) boleh mengirim laporan bug baru
drop policy if exists "bug_reports_insert_portal" on public.bug_reports;
create policy "bug_reports_insert_portal" on public.bug_reports
  for insert with check (
    lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  );

-- Hanya Admin/Pengurus yang dapat memperbarui status penanganan dan catatan admin
drop policy if exists "bug_reports_update_admin" on public.bug_reports;
create policy "bug_reports_update_admin" on public.bug_reports
  for update using (
    lower(trim(public.req_header('x-user-role'))) = 'admin'
  )
  with check (
    lower(trim(public.req_header('x-user-role'))) = 'admin'
  );

-- 2. Bucket Supabase Storage untuk screenshot laporan bug
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bug-reports',
  'bug-reports',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 10485760;

drop policy if exists "bug_reports_storage_public_read" on storage.objects;
create policy "bug_reports_storage_public_read" on storage.objects
  for select using (bucket_id = 'bug-reports');

drop policy if exists "bug_reports_storage_portal_insert" on storage.objects;
create policy "bug_reports_storage_portal_insert" on storage.objects
  for insert with check (
    bucket_id = 'bug-reports'
    and lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
  );
