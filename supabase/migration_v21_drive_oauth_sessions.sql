-- ============================================================================
-- MIGRATION V21: SESI SEMENTARA OAUTH GOOGLE DRIVE LINTAS APK & iOS
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- ============================================================================

create table if not exists public.drive_oauth_sessions (
  state text primary key,
  status text not null default 'pending' check (status in ('pending', 'completed', 'error')),
  access_token text,
  expires_in integer,
  email text,
  display_name text,
  photo_link text,
  error_message text,
  created_by_role text,
  created_by_blok text,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_drive_oauth_sessions_expires_at
  on public.drive_oauth_sessions (expires_at);

alter table public.drive_oauth_sessions enable row level security;

-- Hanya backend service_role yang boleh membaca/menulis tabel sesi OAuth sementara.
revoke all on table public.drive_oauth_sessions from anon, authenticated;
grant all on table public.drive_oauth_sessions to service_role;
