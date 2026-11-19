-- ============================================================================
-- SKEMA DATABASE SUPABASE: e-Card Verifikasi & IPL Digital — Perumahan Saung Kebun
-- Jalankan skrip ini di SQL Editor Supabase untuk mengaktifkan tabel, RLS,
-- fungsi RPC login_ecard, storage bucket bukti-ipl, dan sistem audit log.
-- ============================================================================

create extension if not exists "pgcrypto";

-- 1. Tabel Master Warga & Akun Pengurus
create table if not exists public.users_warga (
  id uuid primary key default gen_random_uuid(),
  blok_rumah text not null unique,
  nama_warga text not null,
  no_wa text not null,
  status_hunian text not null default 'Tetap' check (status_hunian in ('Tetap', 'Kontrak', 'Kosong')),
  nominal_iuran integer not null default 100000,
  pin_akses text not null check (char_length(pin_akses) = 6),
  role text not null default 'warga' check (role in ('warga', 'admin')),
  jabatan text check (jabatan in ('Ketua', 'Bendahara', 'Humas', 'Seksi Olahraga', 'Pembina')),
  admin_permission text check (admin_permission in ('full', 'add_only')),
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2. Tabel Transaksi IPL
create table if not exists public.transaksi_ipl (
  id uuid primary key default gen_random_uuid(),
  no_kwitansi text not null unique,
  blok_rumah text not null references public.users_warga(blok_rumah) on update cascade on delete cascade,
  nama_warga text not null,
  tahun integer not null default 2026,
  bulan_dibayar integer[] not null,
  nominal integer not null check (nominal > 0),
  metode_bayar text not null check (metode_bayar in ('Transfer Bank', 'E-Wallet', 'Setor Tunai')),
  petugas_penerima text,
  bukti_url text,
  status_verifikasi text not null default 'Pending' check (status_verifikasi in ('Pending', 'Terverifikasi', 'Ditolak')),
  catatan_admin text,
  keterangan text,
  tanggal_setor timestamptz not null default now(),
  verified_at timestamptz,
  verified_by text
);

-- 3. Tabel Matriks Status e-Card Bulanan
create table if not exists public.status_ecard_bulanan (
  id uuid primary key default gen_random_uuid(),
  blok_rumah text not null references public.users_warga(blok_rumah) on update cascade on delete cascade,
  tahun integer not null default 2026,
  bulan integer not null check (bulan between 1 and 12),
  status text not null default 'Belum Tagihan' check (status in ('Lunas', 'Menunggu Verifikasi', 'Jatuh Tempo', 'Belum Bayar', 'Belum Tagihan')),
  transaksi_id uuid references public.transaksi_ipl(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (blok_rumah, tahun, bulan)
);

-- 4. Tabel Konfigurasi Bot WhatsApp
create table if not exists public.bot_wa_config (
  id text primary key default 'default-bot-config',
  aktif boolean not null default false,
  provider text not null default 'Fonnte' check (provider in ('Fonnte', 'Wablas')),
  api_endpoint text not null default 'https://api.fonnte.com/send',
  api_token text not null default '',
  jadwal_tgl_1 boolean not null default true,
  jadwal_tgl_6 boolean not null default true,
  jadwal_tgl_7 boolean not null default true,
  jadwal_tgl_8_plus boolean not null default true,
  template_pesan text not null default '',
  updated_at timestamptz not null default now()
);

-- 5. Tabel Log Pengiriman Bot WhatsApp
create table if not exists public.bot_wa_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  blok_rumah text not null,
  nama_warga text not null,
  no_wa text not null,
  jenis_pesan text not null,
  status_kirim text not null check (status_kirim in ('Terkirim', 'Gagal')),
  respon_gateway text not null default '',
  pesan text not null
);

-- 6. Tabel Audit Log Aktivitas Server
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz not null default now(),
  actor_role text not null,
  actor_id text not null,
  actor_name text not null,
  action text not null,
  entity text not null,
  entity_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb
);

-- 7. Tabel Proteksi Percobaan Login (Rate Limiting Anti Brute-Force PIN)
create table if not exists public.login_attempts (
  blok_key text primary key,
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Indeks Performa untuk Akses Konkuren Tinggi (Ratusan KK & Ribuan Transaksi)
create index if not exists idx_users_warga_aktif_blok on public.users_warga (aktif, blok_rumah);
create index if not exists idx_transaksi_blok_tanggal on public.transaksi_ipl (blok_rumah, tanggal_setor desc);
create index if not exists idx_transaksi_status_tanggal on public.transaksi_ipl (status_verifikasi, tanggal_setor desc);
create index if not exists idx_transaksi_tahun on public.transaksi_ipl (tahun);
create index if not exists idx_status_ecard_tahun_bulan on public.status_ecard_bulanan (tahun, bulan, status);
create index if not exists idx_status_ecard_blok_tahun on public.status_ecard_bulanan (blok_rumah, tahun);
create index if not exists idx_bot_wa_logs_created on public.bot_wa_logs (created_at desc);
create index if not exists idx_audit_logs_timestamp on public.audit_logs (timestamp desc);

-- Helper header untuk Row Level Security (RLS)
create or replace function public.req_header(header_name text)
returns text
language sql
stable
as $$
  select coalesce(
    current_setting('request.headers', true)::json ->> header_name,
    ''
  );
$$;

-- Fungsi RPC Login Terisolasi dengan Proteksi Brute-Force: login_ecard(p_blok, p_pin)
-- Maksimal 5 kali percobaan gagal -> terkunci sementara 5 menit.
create or replace function public.login_ecard(p_blok text, p_pin text)
returns table (
  blok_rumah text,
  nama_warga text,
  no_wa text,
  status_hunian text,
  nominal_iuran integer,
  role text,
  jabatan text,
  admin_permission text
)
language plpgsql
security definer
as $$
declare
  v_key text := lower(regexp_replace(trim(p_blok), '\s+', '', 'g'));
  v_attempt record;
  v_found boolean := false;
  v_next_count integer;
begin
  select * into v_attempt from public.login_attempts where blok_key = v_key;

  if v_attempt.locked_until is not null and v_attempt.locked_until > now() then
    raise exception 'Terlalu banyak percobaan PIN salah. Coba kembali dalam beberapa menit.';
  end if;

  select exists(
    select 1
    from public.users_warga u
    where lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = v_key
      and u.pin_akses = trim(p_pin)
      and u.aktif = true
  ) into v_found;

  if not v_found then
    v_next_count := coalesce(v_attempt.failed_count, 0) + 1;
    insert into public.login_attempts (blok_key, failed_count, locked_until, updated_at)
    values (
      v_key,
      case when v_next_count >= 5 then 0 else v_next_count end,
      case when v_next_count >= 5 then now() + interval '5 minutes' else null end,
      now()
    )
    on conflict (blok_key) do update set
      failed_count = excluded.failed_count,
      locked_until = excluded.locked_until,
      updated_at = now();
    return;
  end if;

  -- Login sukses: reset counter gagal
  delete from public.login_attempts where blok_key = v_key;

  return query
  select
    u.blok_rumah,
    u.nama_warga,
    u.no_wa,
    u.status_hunian,
    u.nominal_iuran,
    u.role,
    u.jabatan,
    u.admin_permission
  from public.users_warga u
  where lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = v_key
    and u.pin_akses = trim(p_pin)
    and u.aktif = true
  limit 1;
end;
$$;

-- Aktifkan Row Level Security (Strict Privacy Isolation: 1 Akun = 1 Rumah)
alter table public.users_warga enable row level security;
alter table public.transaksi_ipl enable row level security;
alter table public.status_ecard_bulanan enable row level security;
alter table public.bot_wa_config enable row level security;
alter table public.bot_wa_logs enable row level security;
alter table public.audit_logs enable row level security;

-- Kebijakan RLS users_warga (Semua Pengurus bisa tambah, Edit & Hapus khusus Bendahara)
drop policy if exists "warga_hanya_lihat_rumah_sendiri" on public.users_warga;
create policy "warga_hanya_lihat_rumah_sendiri" on public.users_warga
  for select using (
    public.req_header('x-user-role') = 'admin'
    or blok_rumah = public.req_header('x-blok-rumah')
  );

drop policy if exists "admin_kelola_warga" on public.users_warga;
drop policy if exists "admin_tambah_warga" on public.users_warga;
create policy "admin_tambah_warga" on public.users_warga
  for insert with check (public.req_header('x-user-role') = 'admin');

drop policy if exists "bendahara_edit_warga" on public.users_warga;
create policy "bendahara_edit_warga" on public.users_warga
  for update using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

drop policy if exists "bendahara_hapus_warga" on public.users_warga;
create policy "bendahara_hapus_warga" on public.users_warga
  for delete using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

-- Kebijakan RLS transaksi_ipl
drop policy if exists "transaksi_isolasi_rumah" on public.transaksi_ipl;
create policy "transaksi_isolasi_rumah" on public.transaksi_ipl
  for select using (
    public.req_header('x-user-role') = 'admin'
    or blok_rumah = public.req_header('x-blok-rumah')
  );

drop policy if exists "warga_kirim_setoran_sendiri" on public.transaksi_ipl;
create policy "warga_kirim_setoran_sendiri" on public.transaksi_ipl
  for insert with check (
    public.req_header('x-user-role') = 'admin'
    or blok_rumah = public.req_header('x-blok-rumah')
  );

drop policy if exists "admin_verifikasi_transaksi" on public.transaksi_ipl;
create policy "admin_verifikasi_transaksi" on public.transaksi_ipl
  for update using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

-- Kebijakan RLS status_ecard_bulanan
drop policy if exists "status_isolasi_rumah" on public.status_ecard_bulanan;
create policy "status_isolasi_rumah" on public.status_ecard_bulanan
  for select using (
    public.req_header('x-user-role') = 'admin'
    or blok_rumah = public.req_header('x-blok-rumah')
  );

drop policy if exists "status_update_terbatas" on public.status_ecard_bulanan;
create policy "status_update_terbatas" on public.status_ecard_bulanan
  for all using (
    public.req_header('x-user-role') = 'admin'
    or blok_rumah = public.req_header('x-blok-rumah')
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    or blok_rumah = public.req_header('x-blok-rumah')
  );

-- Kebijakan RLS bot_wa_config, bot_wa_logs, audit_logs
drop policy if exists "admin_bot_config" on public.bot_wa_config;
drop policy if exists "admin_bot_config_select" on public.bot_wa_config;
create policy "admin_bot_config_select" on public.bot_wa_config
  for select using (public.req_header('x-user-role') = 'admin');

drop policy if exists "bendahara_bot_config_write" on public.bot_wa_config;
create policy "bendahara_bot_config_write" on public.bot_wa_config
  for all using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

drop policy if exists "admin_bot_logs" on public.bot_wa_logs;
create policy "admin_bot_logs" on public.bot_wa_logs
  for select using (public.req_header('x-user-role') = 'admin');

drop policy if exists "audit_insert_all" on public.audit_logs;
create policy "audit_insert_all" on public.audit_logs
  for insert with check (true);

drop policy if exists "audit_select_admin" on public.audit_logs;
create policy "audit_select_admin" on public.audit_logs
  for select using (public.req_header('x-user-role') = 'admin');

-- Data Awal Pengurus (RBAC: Bendahara = full, lainnya = add_only) & Warga
insert into public.users_warga (blok_rumah, nama_warga, no_wa, status_hunian, nominal_iuran, pin_akses, role, jabatan, admin_permission)
values
  ('andriansyah', 'Andriansyah', '6281200000002', 'Tetap', 0, '200001', 'admin', 'Bendahara', 'full'),
  ('admin', 'Andriansyah (Admin Bendahara)', '6281200000002', 'Tetap', 0, '123456', 'admin', 'Bendahara', 'full'),
  ('erlangga', 'Erlangga', '6281234567890', 'Tetap', 0, '100001', 'admin', 'Ketua', 'add_only'),
  ('doni', 'Doni', '6281200000003', 'Tetap', 0, '300001', 'admin', 'Humas', 'add_only'),
  ('wahyu', 'Wahyu', '6281200000004', 'Tetap', 0, '300002', 'admin', 'Humas', 'add_only'),
  ('deny', 'Deny', '6281200000005', 'Tetap', 0, '400001', 'admin', 'Seksi Olahraga', 'add_only'),
  ('paiwan', 'Pa Iwan', '6281200000006', 'Tetap', 0, '500001', 'admin', 'Pembina', 'add_only'),
  ('B03/07', 'Erlangga', '6281234567890', 'Tetap', 100000, '112233', 'warga', null, null),
  ('B05/07', 'Tina', '6281298765432', 'Tetap', 100000, '223344', 'warga', null, null),
  ('B06/02', 'Bintang', '6281311223344', 'Kontrak', 100000, '334455', 'warga', null, null)
on conflict (blok_rumah) do update set
  jabatan = excluded.jabatan,
  admin_permission = excluded.admin_permission;

-- Storage Bucket untuk Bukti Pembayaran IPL
insert into storage.buckets (id, name, public)
values ('bukti-ipl', 'bukti-ipl', true)
on conflict (id) do nothing;
