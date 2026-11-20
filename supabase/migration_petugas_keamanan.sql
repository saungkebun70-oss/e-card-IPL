-- =========================================================================
-- MIGRASI SUPABASE: PORTAL PETUGAS KEAMANAN (NFC PATROL) & PRIVASI KETAT
-- Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang
-- Aman dijalankan ulang (Idempotent) & menggunakan public.req_header(...)
-- =========================================================================

create extension if not exists pgcrypto;

create or replace function public.req_header(header_name text) returns text language sql stable as $$
select coalesce(nullif(current_setting('request.headers', true), '')::json->>lower(header_name), '');
$$;

-- 1. Tabel Akun Petugas Keamanan (PIN terproteksi ketat oleh RLS & RPC)
create table if not exists public.petugas_keamanan (
  id uuid primary key default gen_random_uuid(),
  nama text not null,
  username text not null unique,
  pin text not null check (pin ~ '^[0-9]{6}$'),
  no_hp text not null,
  shift text not null default 'Shift Pagi (07.00 – 19.00)',
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Tabel Titik Checkpoint RFID / NFC Patroli
create table if not exists public.titik_patroli (
  id uuid primary key default gen_random_uuid(),
  nama_lokasi text not null,
  rfid_uid text not null unique,
  keterangan text,
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Tabel Log Patroli Keamanan Real-Time
create table if not exists public.log_patroli (
  id uuid primary key default gen_random_uuid(),
  petugas_id uuid not null references public.petugas_keamanan(id) on delete cascade,
  nama_petugas text not null,
  titik_id uuid references public.titik_patroli(id) on delete set null,
  nama_lokasi text not null,
  waktu_scan timestamptz not null default now(),
  metode_scan text not null default 'NFC Tap' check (metode_scan in ('NFC Tap', 'Input Manual')),
  status_kondisi text not null default 'Aman' check (status_kondisi in ('Aman', 'Ada Catatan')),
  catatan text
);

create index if not exists idx_log_patroli_waktu on public.log_patroli(waktu_scan desc);
create index if not exists idx_log_patroli_petugas on public.log_patroli(petugas_id, waktu_scan desc);

-- 4. Hubungkan Tabel transaksi_kas dengan Petugas Keamanan (Honor Rutin & Lembur)
alter table public.transaksi_kas add column if not exists petugas_id uuid references public.petugas_keamanan(id) on delete set null;
alter table public.transaksi_kas add column if not exists jenis_honor text;
create index if not exists idx_transaksi_kas_petugas on public.transaksi_kas(petugas_id, tanggal desc);

-- 5. RPC Login Petugas Keamanan (SECURITY DEFINER agar kolom pin tidak pernah terbuka ke publik)
create or replace function public.login_petugas(p_username text, p_pin text)
returns table (
  id uuid,
  nama text,
  username text,
  no_hp text,
  shift text,
  aktif boolean
)
language sql
security definer
set search_path = public
as $$
select p.id, p.nama, p.username, p.no_hp, p.shift, p.aktif
from public.petugas_keamanan p
where p.aktif = true
  and (
    lower(trim(p.username)) = lower(trim(p_username))
    or lower(trim(p.nama)) = lower(trim(p_username))
  )
  and p.pin = trim(p_pin)
limit 1;
$$;

grant execute on function public.login_petugas(text, text) to anon, authenticated;

-- 6. RPC Kontak Darurat Keamanan 24 Jam (Hanya mengekspos nama, shift & no_hp aktif — TANPA PIN)
create or replace function public.get_petugas_kontak_darurat()
returns table (
  id uuid,
  nama text,
  no_hp text,
  shift text
)
language sql
security definer
set search_path = public
as $$
select p.id, p.nama, p.no_hp, p.shift
from public.petugas_keamanan p
where p.aktif = true
order by p.shift asc, p.nama asc;
$$;

grant execute on function public.get_petugas_kontak_darurat() to anon, authenticated;

-- 7. Kebijakan RLS Ketat (Isolasi Mutlak Petugas vs Admin vs Warga)
alter table public.petugas_keamanan enable row level security;
alter table public.titik_patroli enable row level security;
alter table public.log_patroli enable row level security;

drop policy if exists petugas_keamanan_select_policy on public.petugas_keamanan;
drop policy if exists petugas_keamanan_insert_policy on public.petugas_keamanan;
drop policy if exists petugas_keamanan_update_policy on public.petugas_keamanan;
drop policy if exists petugas_keamanan_delete_policy on public.petugas_keamanan;

create policy petugas_keamanan_select_policy on public.petugas_keamanan for select
using (
  public.req_header('x-user-role') = 'admin'
  or (public.req_header('x-user-role') = 'petugas' and id::text = public.req_header('x-petugas-id'))
);

create policy petugas_keamanan_insert_policy on public.petugas_keamanan for insert
with check (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
);

create policy petugas_keamanan_update_policy on public.petugas_keamanan for update
using (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
)
with check (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
);

create policy petugas_keamanan_delete_policy on public.petugas_keamanan for delete
using (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
);

drop policy if exists titik_patroli_select_policy on public.titik_patroli;
drop policy if exists titik_patroli_insert_policy on public.titik_patroli;
drop policy if exists titik_patroli_update_policy on public.titik_patroli;
drop policy if exists titik_patroli_delete_policy on public.titik_patroli;

create policy titik_patroli_select_policy on public.titik_patroli for select
using (
  public.req_header('x-user-role') in ('admin', 'petugas')
);

create policy titik_patroli_insert_policy on public.titik_patroli for insert
with check (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
);

create policy titik_patroli_update_policy on public.titik_patroli for update
using (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
)
with check (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
);

create policy titik_patroli_delete_policy on public.titik_patroli for delete
using (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
);

drop policy if exists log_patroli_select_policy on public.log_patroli;
drop policy if exists log_patroli_insert_policy on public.log_patroli;
drop policy if exists log_patroli_delete_policy on public.log_patroli;

-- Log patroli boleh dibaca Admin & Warga (untuk transparansi keamanan),
-- sementara Petugas hanya melihat log patrolinya sendiri (isolasi ketat)
create policy log_patroli_select_policy on public.log_patroli for select
using (
  public.req_header('x-user-role') in ('admin', 'warga')
  or (public.req_header('x-user-role') = 'petugas' and petugas_id::text = public.req_header('x-petugas-id'))
);

create policy log_patroli_insert_policy on public.log_patroli for insert
with check (
  (public.req_header('x-user-role') = 'petugas' and petugas_id::text = public.req_header('x-petugas-id'))
  or public.req_header('x-user-role') = 'admin'
);

create policy log_patroli_delete_policy on public.log_patroli for delete
using (
  public.req_header('x-user-role') = 'admin' and public.req_header('x-admin-permission') = 'full'
);

-- Isolasi Ketat transaksi_kas: Petugas HANYA boleh membaca baris honorarium/lembur miliknya sendiri!
drop policy if exists transaksi_kas_select_policy on public.transaksi_kas;
create policy transaksi_kas_select_policy on public.transaksi_kas for select
using (
  public.req_header('x-user-role') = 'admin'
  or (
    public.req_header('x-user-role') = 'petugas'
    and jenis = 'pengeluaran'
    and petugas_id::text = public.req_header('x-petugas-id')
  )
);

-- 8. Seed Awal 4 Titik Checkpoint RFID/NFC Lingkungan (Opsional, tidak menimpa data existing)
insert into public.titik_patroli (nama_lokasi, rfid_uid, keterangan, aktif)
values
  ('Pos Gerbang Utama', 'NFC-GERBANG-01', 'Pintu masuk utama & pos jaga depan', true),
  ('Blok A Ujung', 'NFC-BLOKA-02', 'Sudut jalan ujung Blok A & batas pagar timur', true),
  ('Blok B Tengah', 'NFC-BLOKB-03', 'Area persimpangan Blok B3-B7 & Sekretariat', true),
  ('Fasum & Lapangan', 'NFC-FASUM-04', 'Area fasilitas umum, taman, dan lapangan warga', true)
on conflict (rfid_uid) do nothing;

-- 9. Aktifkan Supabase Realtime pada log_patroli & petugas_keamanan
do $$
begin
  alter publication supabase_realtime add table public.log_patroli;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.petugas_keamanan;
exception when duplicate_object then null;
end $$;
