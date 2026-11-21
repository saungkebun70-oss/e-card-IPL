-- =============================================================================
-- Migrasi V4: Live Tracking Patroli Keamanan Real-Time + Scan NFC 5 Checkpoint
-- Perumahan Saung Kebun (Idempoten — Aman Dijalankan Berulang Kali)
-- =============================================================================

create table if not exists public.patrol_checkpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nfc_tag_id text not null default '',
  lat double precision not null,
  lng double precision not null,
  order_index integer not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.patrol_sessions (
  id uuid primary key default gen_random_uuid(),
  officer_id text not null,
  officer_name text not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  current_lat double precision,
  current_lng double precision,
  route_path jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_ping_at timestamptz not null default now()
);

create table if not exists public.patrol_scans (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.patrol_sessions(id) on delete cascade,
  checkpoint_id uuid not null references public.patrol_checkpoints(id) on delete cascade,
  officer_name text not null,
  nfc_serial text,
  lat double precision,
  lng double precision,
  scanned_at timestamptz not null default now()
);

create index if not exists idx_patrol_sessions_status on public.patrol_sessions(status, started_at desc);
create index if not exists idx_patrol_scans_session on public.patrol_scans(session_id, scanned_at desc);

-- Aktifkan RLS & Kebijakan Akses untuk anon + authenticated
alter table public.patrol_checkpoints enable row level security;
alter table public.patrol_sessions enable row level security;
alter table public.patrol_scans enable row level security;

drop policy if exists "patrol_checkpoints_all_policy" on public.patrol_checkpoints;
create policy "patrol_checkpoints_all_policy"
  on public.patrol_checkpoints
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "patrol_sessions_all_policy" on public.patrol_sessions;
create policy "patrol_sessions_all_policy"
  on public.patrol_sessions
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "patrol_scans_all_policy" on public.patrol_scans;
create policy "patrol_scans_all_policy"
  on public.patrol_scans
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Seed 5 Checkpoint Default Perumahan Saung Kebun (jika belum ada)
insert into public.patrol_checkpoints (name, nfc_tag_id, lat, lng, order_index)
values
  ('Pos 1 — Gerbang Utama & Pos Jaga', 'NFC-POS-01', -6.32745, 107.33965, 1),
  ('Pos 2 — Sudut Blok A', 'NFC-POS-02', -6.32712, 107.34025, 2),
  ('Pos 3 — Blok B Tengah & Sekretariat', 'NFC-POS-03', -6.32668, 107.34018, 3),
  ('Pos 4 — Fasum & Taman Warga', 'NFC-POS-04', -6.32642, 107.33978, 4),
  ('Pos 5 — Pagar Utara & Blok Belakang', 'NFC-POS-05', -6.32625, 107.34052, 5)
on conflict (order_index) do nothing;

-- Aktifkan Supabase Realtime Publication untuk 3 tabel live tracking
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'patrol_checkpoints'
  ) then
    alter publication supabase_realtime add table public.patrol_checkpoints;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'patrol_sessions'
  ) then
    alter publication supabase_realtime add table public.patrol_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'patrol_scans'
  ) then
    alter publication supabase_realtime add table public.patrol_scans;
  end if;
end $$;
