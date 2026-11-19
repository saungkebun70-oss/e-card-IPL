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
  metode_bayar text not null check (metode_bayar in ('QRIS', 'Transfer Bank', 'E-Wallet', 'Setor Tunai')),
  petugas_penerima text,
  bukti_url text,
  status_verifikasi text not null default 'Pending' check (status_verifikasi in ('Pending', 'Terverifikasi', 'Ditolak')),
  catatan_admin text,
  keterangan text,
  tanggal_setor timestamptz not null default now(),
  verified_at timestamptz,
  verified_by text
);

-- Pastikan constraint metode_bayar mendukung QRIS pada database yang sudah ada
alter table public.transaksi_ipl drop constraint if exists transaksi_ipl_metode_bayar_check;
alter table public.transaksi_ipl
  add constraint transaksi_ipl_metode_bayar_check
  check (metode_bayar in ('QRIS', 'Transfer Bank', 'E-Wallet', 'Setor Tunai'));

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

-- 8. Tabel Pengumuman / Notifikasi Massal Sistem untuk Seluruh Warga
create table if not exists public.system_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  category text not null default 'Pengumuman Umum' check (category in ('Perawatan & Fasilitas', 'Pengumuman Umum', 'Keamanan', 'Keuangan & IPL')),
  target_scope text not null default 'all_active' check (target_scope in ('all_active', 'all_units')),
  recipient_count integer not null default 0,
  recipient_blocks text[] not null default '{}',
  sender_name text not null,
  sender_jabatan text not null default 'Pengurus',
  created_at timestamptz not null default now()
);

-- 9. Tabel Pengaturan Pembayaran (QRIS & Nomor Rekening) — Edit Khusus Bendahara
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

-- 10. Tabel Pengaturan Identitas Aplikasi (Nama Aplikasi, Sub-Nama, Kop & Logo) — Edit Khusus Bendahara
create table if not exists public.app_settings (
  id text primary key default 'default-app-brand',
  app_name text not null default 'e-Card Verifikasi',
  app_subtitle text not null default 'IPL Digital — Perumahan Saung Kebun',
  kop_resmi text not null default 'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)',
  logo_url text,
  updated_at timestamptz not null default now(),
  updated_by text
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
create index if not exists idx_system_notifications_created on public.system_notifications (created_at desc);

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
alter table public.login_attempts enable row level security;
alter table public.system_notifications enable row level security;
alter table public.payment_config enable row level security;
alter table public.app_settings enable row level security;

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

-- Kebijakan RLS system_notifications (Warga & Admin baca, Pengurus kirim, Bendahara hapus)
drop policy if exists "notif_select_portal" on public.system_notifications;
create policy "notif_select_portal" on public.system_notifications
  for select using (
    public.req_header('x-user-role') in ('admin', 'warga')
  );

drop policy if exists "admin_kirim_notifikasi" on public.system_notifications;
create policy "admin_kirim_notifikasi" on public.system_notifications
  for insert with check (public.req_header('x-user-role') = 'admin');

drop policy if exists "bendahara_hapus_notifikasi" on public.system_notifications;
create policy "bendahara_hapus_notifikasi" on public.system_notifications
  for delete using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

-- Kebijakan RLS payment_config (Warga & Admin baca, Upload QRIS & Kelola Rekening khusus Bendahara)
drop policy if exists "payment_config_select_portal" on public.payment_config;
create policy "payment_config_select_portal" on public.payment_config
  for select using (public.req_header('x-user-role') in ('admin', 'warga'));

drop policy if exists "bendahara_payment_config_write" on public.payment_config;
create policy "bendahara_payment_config_write" on public.payment_config
  for all using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

-- Kebijakan RLS app_settings (Publik/Login baca nama & logo, Edit khusus Bendahara)
drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read" on public.app_settings
  for select using (true);

drop policy if exists "bendahara_app_settings_write" on public.app_settings;
create policy "bendahara_app_settings_write" on public.app_settings
  for all using (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  )
  with check (
    public.req_header('x-user-role') = 'admin'
    and public.req_header('x-admin-permission') = 'full'
  );

-- Data Awal Susunan Pengurus (Bendahara = full, lainnya = add_only) & 109 Unit Warga Saung Kebun
insert into public.users_warga (blok_rumah, nama_warga, no_wa, status_hunian, nominal_iuran, pin_akses, role, jabatan, admin_permission)
values
  -- Susunan Pengurus (Admin)
  ('andriansyah', 'Andriansyah', '6281200000002', 'Tetap', 0, '200001', 'admin', 'Bendahara', 'full'),
  ('admin', 'Andriansyah (Bendahara)', '6281200000002', 'Tetap', 0, '123456', 'admin', 'Bendahara', 'full'),
  ('bpiwan', 'Bp. Iwan', '6281200000006', 'Tetap', 0, '500001', 'admin', 'Pembina', 'add_only'),
  ('paiwan', 'Bp. Iwan', '6281200000006', 'Tetap', 0, '500001', 'admin', 'Pembina', 'add_only'),
  ('erlangga', 'Erlangga', '6281234567890', 'Tetap', 0, '100001', 'admin', 'Ketua', 'add_only'),
  ('doni', 'Doni', '6281200000003', 'Tetap', 0, '300001', 'admin', 'Humas', 'add_only'),
  ('wahyu', 'Wahyu', '6281200000004', 'Tetap', 0, '300002', 'admin', 'Humas', 'add_only'),
  ('deny', 'Deny', '6281200000005', 'Tetap', 0, '400001', 'admin', 'Seksi Olahraga', 'add_only'),

  -- Blok B3 (23 unit)
  ('B3/1', 'ASEP SUKARMA', '6281200000000', 'Tetap', 100000, '100833', 'warga', null, null),
  ('B3/2', 'SUBHAN HUMAMI', '6281200000000', 'Tetap', 100000, '101566', 'warga', null, null),
  ('B3/3', 'UNIT KOSONG B3/3', '6281200000000', 'Kosong', 0, '102299', 'warga', null, null),
  ('B3/4', 'ADITYA PRAYOGA', '6281200000000', 'Tetap', 100000, '103032', 'warga', null, null),
  ('B3/5', 'UNIT KOSONG B3/5', '6281200000000', 'Kosong', 0, '103765', 'warga', null, null),
  ('B3/6', 'AFAN', '6281200000000', 'Tetap', 100000, '104498', 'warga', null, null),
  ('B3/7', 'DION YULIANA / ERLANGGA', '6281234567890', 'Tetap', 100000, '112233', 'warga', null, null),
  ('B3/8', 'RAKA', '6281200000000', 'Tetap', 100000, '105964', 'warga', null, null),
  ('B3/9', 'UNIT KOSONG B3/9', '6281200000000', 'Kosong', 0, '106697', 'warga', null, null),
  ('B3/10', 'WARGA B3/10', '6281200000000', 'Tetap', 100000, '107430', 'warga', null, null),
  ('B3/11', 'UNIT KOSONG B3/11', '6281200000000', 'Kosong', 0, '108163', 'warga', null, null),
  ('B3/12', 'PUGUH DWI', '6281200000000', 'Tetap', 100000, '108896', 'warga', null, null),
  ('B3/13', 'UNIT KOSONG B3/13', '6281200000000', 'Kosong', 0, '109629', 'warga', null, null),
  ('B3/14', 'ARDI MAULANA', '6281200000000', 'Tetap', 100000, '110362', 'warga', null, null),
  ('B3/15', 'WENDY ROCHIMAT S', '6281200000000', 'Tetap', 100000, '111095', 'warga', null, null),
  ('B3/16', 'TRI SEPTIONO', '6281200000000', 'Tetap', 100000, '111828', 'warga', null, null),
  ('B3/17', 'UNIT KOSONG B3/17', '6281200000000', 'Kosong', 0, '112561', 'warga', null, null),
  ('B3/18', 'CASMAT', '6281200000000', 'Tetap', 100000, '113294', 'warga', null, null),
  ('B3/19', 'SARMA', '6281200000000', 'Tetap', 100000, '114027', 'warga', null, null),
  ('B3/20', 'ARDIANSYAH ZEIN', '6281200000000', 'Tetap', 100000, '114760', 'warga', null, null),
  ('B3/21', 'CECEP SUGIANTO', '6281200000000', 'Tetap', 100000, '115493', 'warga', null, null),
  ('B3/22', 'DICKY YANDA ALVIANA', '6281200000000', 'Tetap', 100000, '116226', 'warga', null, null),
  ('B3/23', 'FAISAL', '6281200000000', 'Tetap', 100000, '116959', 'warga', null, null),

  -- Blok B5 (29 unit)
  ('B5/1', 'UNIT KOSONG B5/1', '6281200000000', 'Kosong', 0, '117692', 'warga', null, null),
  ('B5/2', 'AHMAD NIZAR', '6281200000000', 'Tetap', 100000, '118425', 'warga', null, null),
  ('B5/3', 'WARGA B5/3', '6281200000000', 'Tetap', 100000, '119158', 'warga', null, null),
  ('B5/4', 'WARGA B5/4', '6281200000000', 'Tetap', 100000, '119891', 'warga', null, null),
  ('B5/5', 'WARGA B5/5', '6281200000000', 'Tetap', 100000, '120624', 'warga', null, null),
  ('B5/6', 'WARGA B5/6', '6281200000000', 'Tetap', 100000, '121357', 'warga', null, null),
  ('B5/7', 'TINA', '6281200000000', 'Kosong', 0, '122090', 'warga', null, null),
  ('B5/8', 'UNIT KOSONG B5/8', '6281200000000', 'Kosong', 0, '122823', 'warga', null, null),
  ('B5/9', 'UNIT KOSONG B5/9', '6281200000000', 'Kosong', 0, '123556', 'warga', null, null),
  ('B5/10', 'UNIT KOSONG B5/10', '6281200000000', 'Kosong', 0, '124289', 'warga', null, null),
  ('B5/11', 'UNIT KOSONG B5/11', '6281200000000', 'Kosong', 0, '125022', 'warga', null, null),
  ('B5/12', 'UNIT KOSONG B5/12', '6281200000000', 'Kosong', 0, '125755', 'warga', null, null),
  ('B5/13', 'UNIT KOSONG B5/13', '6281200000000', 'Kosong', 0, '126488', 'warga', null, null),
  ('B5/14', 'UNIT KOSONG B5/14', '6281200000000', 'Kosong', 0, '127221', 'warga', null, null),
  ('B5/15', 'UNIT KOSONG B5/15', '6281200000000', 'Kosong', 0, '127954', 'warga', null, null),
  ('B5/16', 'UNIT KOSONG B5/16', '6281200000000', 'Kosong', 0, '128687', 'warga', null, null),
  ('B5/17', 'KURNIAWAN', '6281200000000', 'Tetap', 100000, '129420', 'warga', null, null),
  ('B5/18', 'DARMA', '6281200000000', 'Tetap', 100000, '130153', 'warga', null, null),
  ('B5/19', 'HERRIS RIZKI', '6281200000000', 'Tetap', 100000, '130886', 'warga', null, null),
  ('B5/20', 'DWI ARDIYANTO', '6281200000000', 'Tetap', 100000, '131619', 'warga', null, null),
  ('B5/21', 'DONI', '6281200000000', 'Tetap', 100000, '132352', 'warga', null, null),
  ('B5/22', 'TOMA', '6281200000000', 'Tetap', 100000, '133085', 'warga', null, null),
  ('B5/23', 'ADITYA', '6281200000000', 'Tetap', 100000, '133818', 'warga', null, null),
  ('B5/24', 'DEDI WAHYUDI', '6281200000000', 'Tetap', 100000, '134551', 'warga', null, null),
  ('B5/25', 'SIGIT', '6281200000000', 'Tetap', 100000, '135284', 'warga', null, null),
  ('B5/26', 'HARTONO', '6281200000000', 'Tetap', 100000, '136017', 'warga', null, null),
  ('B5/27', 'SYAHRI', '6281200000000', 'Tetap', 100000, '136750', 'warga', null, null),
  ('B5/28', 'UNIT KOSONG B5/28', '6281200000000', 'Kosong', 0, '137483', 'warga', null, null),
  ('B5/29', 'ALINUR', '6281200000000', 'Tetap', 100000, '138216', 'warga', null, null),

  -- Blok B6 (23 unit)
  ('B6/1', 'UNIT KOSONG B6/1', '6281200000000', 'Kosong', 0, '138949', 'warga', null, null),
  ('B6/2', 'DEFRY', '6281200000000', 'Tetap', 100000, '139682', 'warga', null, null),
  ('B6/3', 'BUDYANTO', '6281200000000', 'Tetap', 100000, '140415', 'warga', null, null),
  ('B6/4', 'RIDWAN', '6281200000000', 'Tetap', 100000, '141148', 'warga', null, null),
  ('B6/5', 'ABIDZAR', '6281200000000', 'Tetap', 100000, '141881', 'warga', null, null),
  ('B6/6', 'ANGKASA', '6281200000000', 'Tetap', 100000, '142614', 'warga', null, null),
  ('B6/7', 'NOVI', '6281200000000', 'Tetap', 100000, '143347', 'warga', null, null),
  ('B6/8', 'M JODI RAMADHAN', '6281200000000', 'Tetap', 100000, '144080', 'warga', null, null),
  ('B6/9', 'HASMI', '6281200000000', 'Tetap', 100000, '144813', 'warga', null, null),
  ('B6/10', 'AJE', '6281200000000', 'Tetap', 100000, '145546', 'warga', null, null),
  ('B6/11', 'JODI KURNIAWAN', '6281200000000', 'Tetap', 100000, '146279', 'warga', null, null),
  ('B6/12', 'RULLY', '6281200000000', 'Tetap', 100000, '147012', 'warga', null, null),
  ('B6/13', 'UNIT KOSONG B6/13', '6281200000000', 'Kosong', 0, '147745', 'warga', null, null),
  ('B6/14', 'ADE JAHIDI', '6281200000000', 'Tetap', 100000, '148478', 'warga', null, null),
  ('B6/15', 'UNIT KOSONG B6/15', '6281200000000', 'Kosong', 0, '149211', 'warga', null, null),
  ('B6/16', 'WIDODO', '6281200000000', 'Tetap', 100000, '149944', 'warga', null, null),
  ('B6/17', 'UNIT KOSONG B6/17', '6281200000000', 'Kosong', 0, '150677', 'warga', null, null),
  ('B6/18', 'SUTRISMAN', '6281200000000', 'Tetap', 100000, '151410', 'warga', null, null),
  ('B6/19', 'MUHAMMAD SIDIK', '6281200000000', 'Tetap', 100000, '152143', 'warga', null, null),
  ('B6/20', 'UNIT KOSONG B6/20', '6281200000000', 'Kosong', 0, '152876', 'warga', null, null),
  ('B6/21', 'CHOLIL', '6281200000000', 'Tetap', 100000, '153609', 'warga', null, null),
  ('B6/22', 'UNIT KOSONG B6/22', '6281200000000', 'Kosong', 0, '154342', 'warga', null, null),
  ('B6/23', 'MULYONO', '6281200000000', 'Tetap', 100000, '155075', 'warga', null, null),

  -- Blok B7 (23 unit)
  ('B7/1', 'UNIT KOSONG B7/1', '6281200000000', 'Kosong', 0, '155808', 'warga', null, null),
  ('B7/2', 'NAUFAL', '6281200000000', 'Kosong', 0, '156541', 'warga', null, null),
  ('B7/3', 'DEDE NURHIDAYAT', '6281200000000', 'Tetap', 100000, '157274', 'warga', null, null),
  ('B7/4', 'DEVI', '6281200000000', 'Tetap', 100000, '158007', 'warga', null, null),
  ('B7/5', 'UNIT KOSONG B7/5', '6281200000000', 'Kosong', 0, '158740', 'warga', null, null),
  ('B7/6', 'ANDRI', '6281200000000', 'Tetap', 100000, '159473', 'warga', null, null),
  ('B7/7', 'BAGAS A', '6281200000000', 'Tetap', 100000, '160206', 'warga', null, null),
  ('B7/8', 'UNIT KOSONG B7/8', '6281200000000', 'Kosong', 0, '160939', 'warga', null, null),
  ('B7/9', 'UNIT KOSONG B7/9', '6281200000000', 'Kosong', 0, '161672', 'warga', null, null),
  ('B7/10', 'AKBAR', '6281200000000', 'Tetap', 100000, '162405', 'warga', null, null),
  ('B7/11', 'YUKI', '6281200000000', 'Tetap', 100000, '163138', 'warga', null, null),
  ('B7/12', 'ARGA', '6281200000000', 'Tetap', 100000, '163871', 'warga', null, null),
  ('B7/13', 'UNIT KOSONG B7/13', '6281200000000', 'Kosong', 0, '164604', 'warga', null, null),
  ('B7/14', 'ABDU NAFI', '6281200000000', 'Tetap', 100000, '165337', 'warga', null, null),
  ('B7/15', 'UNIT KOSONG B7/15', '6281200000000', 'Kosong', 0, '166070', 'warga', null, null),
  ('B7/16', 'ANDRIANSYAH', '6281200000000', 'Tetap', 100000, '166803', 'warga', null, null),
  ('B7/17', 'MUTIARA', '6281200000000', 'Tetap', 100000, '167536', 'warga', null, null),
  ('B7/18', 'ADITYA', '6281200000000', 'Tetap', 100000, '168269', 'warga', null, null),
  ('B7/19', 'SAMSURI', '6281200000000', 'Tetap', 100000, '169002', 'warga', null, null),
  ('B7/20', 'RISKY ALVIN NOVIANTO', '6281200000000', 'Tetap', 100000, '169735', 'warga', null, null),
  ('B7/21', 'RIZKI NURMANSYAH', '6281200000000', 'Tetap', 100000, '170468', 'warga', null, null),
  ('B7/22', 'UNIT KOSONG B7/22', '6281200000000', 'Kosong', 0, '171201', 'warga', null, null),
  ('B7/23', 'SUGIH', '6281200000000', 'Tetap', 100000, '171934', 'warga', null, null),

  -- Blok B8 (11 unit)
  ('B8/1', 'CANDRA ARIS SANDI', '6281200000000', 'Tetap', 100000, '172667', 'warga', null, null),
  ('B8/2', 'SUBANDI', '6281200000000', 'Tetap', 100000, '173400', 'warga', null, null),
  ('B8/3', 'DICKY', '6281200000000', 'Tetap', 100000, '174133', 'warga', null, null),
  ('B8/4', 'UNIT KOSONG B8/4', '6281200000000', 'Kosong', 0, '174866', 'warga', null, null),
  ('B8/5', 'IWAN', '6281200000000', 'Tetap', 100000, '175599', 'warga', null, null),
  ('B8/6', 'DENY', '6281200000000', 'Tetap', 100000, '176332', 'warga', null, null),
  ('B8/7', 'ANI FATIMAH', '6281200000000', 'Tetap', 100000, '177065', 'warga', null, null),
  ('B8/8', 'BINTANG', '6281200000000', 'Tetap', 100000, '177798', 'warga', null, null),
  ('B8/9', 'UNIT KOSONG B8/9', '6281200000000', 'Kosong', 0, '178531', 'warga', null, null),
  ('B8/10', 'ROSTINI', '6281200000000', 'Tetap', 100000, '179264', 'warga', null, null),
  ('B8/11', 'PA HUSNI', '6281200000000', 'Tetap', 100000, '179997', 'warga', null, null)
on conflict (blok_rumah) do update set
  nama_warga = excluded.nama_warga,
  status_hunian = excluded.status_hunian,
  nominal_iuran = excluded.nominal_iuran,
  jabatan = excluded.jabatan,
  admin_permission = excluded.admin_permission;

-- Pengaturan Pembayaran Awal (QRIS & Nomor Rekening)
insert into public.payment_config (id, qris_aktif, qris_image_url, qris_label, qris_catatan, rekening_list, updated_by)
values (
  'default-payment-config',
  false,
  null,
  'QRIS Kas Lingkungan Perumahan Saung Kebun',
  'Scan kode QRIS di atas via m-Banking atau E-Wallet, lalu unggah bukti bayar di bawah.',
  '[{"id":"rek-bca-default","bank":"Bank BCA","nomor":"7401829304","atasNama":"Kas Lingkungan Perumahan Saung Kebun (Bendahara Andriansyah)","tipe":"Transfer Bank"},{"id":"rek-mandiri-default","bank":"Bank Mandiri","nomor":"1730009845120","atasNama":"Pengurus Lingkungan Perumahan Saung Kebun","tipe":"Transfer Bank"},{"id":"rek-ewallet-default","bank":"DANA / GoPay / OVO","nomor":"081234567890","atasNama":"Bendahara Saung Kebun (Andriansyah)","tipe":"E-Wallet"}]'::jsonb,
  'andriansyah'
)
on conflict (id) do nothing;

-- Pengaturan Identitas Aplikasi Awal (Nama & Logo)
insert into public.app_settings (id, app_name, app_subtitle, kop_resmi, logo_url, updated_by)
values (
  'default-app-brand',
  'e-Card Verifikasi',
  'IPL Digital — Perumahan Saung Kebun',
  'Pengurus Lingkungan Perumahan Saung Kebun — Desa Bengle, Kec. Majalaya, Kab. Karawang (Sekretariat: Blok B3/7)',
  null,
  'andriansyah'
)
on conflict (id) do nothing;

-- Storage Bucket untuk Bukti Pembayaran IPL
insert into storage.buckets (id, name, public)
values ('bukti-ipl', 'bukti-ipl', true)
on conflict (id) do nothing;

-- Kebijakan Storage agar Warga & Admin bisa mengunggah serta melihat foto bukti transfer
drop policy if exists "bukti_ipl_public_read" on storage.objects;
create policy "bukti_ipl_public_read" on storage.objects
  for select using (bucket_id = 'bukti-ipl');

drop policy if exists "bukti_ipl_upload_warga_admin" on storage.objects;
create policy "bukti_ipl_upload_warga_admin" on storage.objects
  for insert with check (bucket_id = 'bukti-ipl');

-- Pastikan fungsi RPC login_ecard dapat dipanggil oleh client (Publishable / Anon Key)
grant execute on function public.login_ecard(text, text) to anon, authenticated;
