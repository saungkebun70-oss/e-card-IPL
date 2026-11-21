-- ============================================================================
-- MIGRATION V4: LIVE TRACKING PATROLI REAL-TIME DI ATAS PETA 3D
-- Perumahan Saung Kebun — Kalibrasi GPS ke Koordinat Persen (X%, Y%) Peta 3D
-- + Sesi Patroli Live Real-Time (patrol_gps_calibration & patrol_live_sessions)
-- Idempotent & aman dijalankan ulang di Supabase SQL Editor.
-- ============================================================================

-- 1. Tabel Kalibrasi GPS Asli per Pos (Pos 1 s/d Pos 5)
create table if not exists public.patrol_gps_calibration (
  pos_id text primary key,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- 2. Tabel Sesi Live Tracking Patroli Real-Time
create table if not exists public.patrol_live_sessions (
  id uuid primary key default gen_random_uuid(),
  officer_id text not null,
  officer_name text not null,
  status text not null default 'active' check (status in ('active', 'completed')),
  current_x double precision not null default 12.5,
  current_y double precision not null default 76.0,
  current_lat double precision,
  current_lng double precision,
  accuracy double precision,
  trail_points jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_ping_at timestamptz not null default now()
);

create index if not exists idx_patrol_live_sessions_status_started
  on public.patrol_live_sessions (status, started_at desc);

create index if not exists idx_patrol_live_sessions_last_ping
  on public.patrol_live_sessions (last_ping_at desc);

-- 3. Row Level Security (RLS) — Aman untuk pola autentikasi PIN aplikasi (anon & authenticated)
alter table public.patrol_gps_calibration enable row level security;
alter table public.patrol_live_sessions enable row level security;

drop policy if exists "patrol_gps_calibration_all_policy" on public.patrol_gps_calibration;
create policy "patrol_gps_calibration_all_policy"
  on public.patrol_gps_calibration
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "patrol_live_sessions_all_policy" on public.patrol_live_sessions;
create policy "patrol_live_sessions_all_policy"
  on public.patrol_live_sessions
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- 4. Aktifkan Supabase Realtime untuk Live Tracking Patroli & Kalibrasi GPS
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'patrol_live_sessions'
  ) then
    alter publication supabase_realtime add table public.patrol_live_sessions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'patrol_gps_calibration'
  ) then
    alter publication supabase_realtime add table public.patrol_gps_calibration;
  end if;
end
$$;
