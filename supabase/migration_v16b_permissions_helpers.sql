-- ============================================================================
-- MIGRASI V16 - BAGIAN 16B: TABEL MATRIKS IZIN PENGATURAN TERPUSAT,
-- SEED DEFAULT 'revoked', & FUNGSI VERIFIKASI SERVER/DATABASE
-- Prasyarat: Bagian 16A sudah dijalankan
-- Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- ============================================================================

-- 1. Tabel matriks izin pengaturan terpusat khusus delegasi Bendahara
create table if not exists public.pengurus_settings_permissions (
  id uuid primary key default gen_random_uuid(),
  pengurus_username text not null,
  pengurus_user_id uuid references public.users_warga(id) on delete cascade,
  setting_key text not null check (
    setting_key in (
      'settings.ipl_billing',
      'settings.security_patrol',
      'settings.residents_blocks',
      'settings.chat_moderation',
      'settings.reports_audit',
      'settings.system_integrations'
    )
  ),
  status text not null default 'revoked' check (status in ('granted', 'revoked')),
  granted_by text,
  granted_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pengurus_username, setting_key)
);

create index if not exists idx_pengurus_settings_perm_lookup
  on public.pengurus_settings_permissions (pengurus_username, setting_key, status);

-- 2. Seed default ('revoked') untuk pengurus aktif selain Bendahara
do $$
begin
  perform set_config('app.bypass_permission_guard', '1', true);

  insert into public.pengurus_settings_permissions (
    pengurus_username,
    pengurus_user_id,
    setting_key,
    status,
    revoked_by,
    revoked_at,
    notes
  )
  select
    public.normalize_pengurus_username(p.blok_rumah) as pengurus_username,
    p.id as pengurus_user_id,
    k.setting_key,
    'revoked' as status,
    'system_default' as revoked_by,
    now() as revoked_at,
    'Default: pengaturan terpusat terkunci, hanya Bendahara (Andriansyah) yang dapat membuka delegasi.' as notes
  from public.users_warga p
  cross join (
    values
      ('settings.ipl_billing'),
      ('settings.security_patrol'),
      ('settings.residents_blocks'),
      ('settings.chat_moderation'),
      ('settings.reports_audit'),
      ('settings.system_integrations')
  ) as k(setting_key)
  where p.is_active_pengurus = true
    and p.aktif = true
    and coalesce(p.jabatan, '') <> 'Bendahara'
    and public.normalize_pengurus_username(p.blok_rumah) <> 'andriansyah'
  on conflict (pengurus_username, setting_key) do nothing;
end $$;

-- 3. Fungsi verifikasi caller di sisi database (anti-bypass header frontend)
create or replace function public.is_trusted_db_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(nullif(current_setting('request.headers', true), ''), '') = ''
    or coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

create or replace function public.resolve_caller_pengurus_row()
returns public.users_warga
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_raw_id text := trim(public.req_header('x-blok-rumah'));
  v_norm_user text := public.normalize_pengurus_username(v_raw_id);
  v_row public.users_warga%rowtype;
begin
  if v_role not in ('admin', 'bendahara') or v_norm_user = '' then
    return null;
  end if;

  select u.*
  into v_row
  from public.users_warga u
  where u.aktif = true
    and u.is_active_pengurus = true
    and u.role in ('admin', 'bendahara')
    and (
      lower(regexp_replace(trim(u.blok_rumah), '[\s.]+', '', 'g')) = lower(regexp_replace(v_raw_id, '[\s.]+', '', 'g'))
      or public.normalize_pengurus_username(u.blok_rumah) = v_norm_user
    )
  order by
    case when lower(trim(u.blok_rumah)) = lower(v_raw_id) then 0 else 1 end,
    case when u.jabatan = 'Bendahara' or u.admin_permission = 'full' then 0 else 1 end
  limit 1;

  if not found then
    return null;
  end if;

  return v_row;
end;
$$;

create or replace function public.is_verified_active_pengurus_caller()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.users_warga%rowtype;
begin
  if public.is_trusted_db_admin() then
    return true;
  end if;

  v_row := public.resolve_caller_pengurus_row();
  return v_row.id is not null and v_row.is_active_pengurus = true and v_row.aktif = true;
end;
$$;

create or replace function public.is_verified_bendahara_caller()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.users_warga%rowtype;
begin
  if public.is_trusted_db_admin() then
    return true;
  end if;

  v_row := public.resolve_caller_pengurus_row();
  if v_row.id is null then
    return false;
  end if;

  return (
    v_row.is_active_pengurus = true
    and v_row.aktif = true
    and (
      v_row.jabatan = 'Bendahara'
      or v_row.role = 'bendahara'
      or public.normalize_pengurus_username(v_row.blok_rumah) = 'andriansyah'
    )
    and coalesce(v_row.admin_permission, '') = 'full'
  );
end;
$$;

create or replace function public.is_verified_ketua_caller()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.users_warga%rowtype;
begin
  if public.is_trusted_db_admin() then
    return true;
  end if;

  v_row := public.resolve_caller_pengurus_row();
  if v_row.id is null then
    return false;
  end if;

  return (
    v_row.is_active_pengurus = true
    and v_row.aktif = true
    and v_row.jabatan = 'Ketua'
  );
end;
$$;

create or replace function public.is_verified_warga_self_caller(p_blok text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_blok text := public.normalize_blok_canonical(public.req_header('x-blok-rumah'));
  v_target text := public.normalize_blok_canonical(p_blok);
  v_ok boolean := false;
begin
  if v_role <> 'warga' or v_blok = '' or v_target = '' or v_blok <> v_target then
    return false;
  end if;

  select exists(
    select 1
    from public.users_warga w
    where public.normalize_blok_canonical(w.blok_rumah) = v_blok
      and w.aktif = true
      and w.role = 'warga'
      and w.is_active_pengurus = false
      and w.is_active_warga = true
      and w.warga_account_status = 'active'
      and not exists (
        select 1
        from public.users_warga p
        where p.is_active_pengurus = true
          and p.aktif = true
          and p.role in ('admin', 'bendahara')
          and (
            public.normalize_blok_canonical(p.linked_warga_blok) = v_blok
            or (
              w.linked_pengurus_username is not null
              and public.normalize_pengurus_username(p.blok_rumah) = public.normalize_pengurus_username(w.linked_pengurus_username)
            )
          )
      )
  ) into v_ok;

  return v_ok;
end;
$$;

create or replace function public.can_access_central_setting_db(p_setting_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := trim(coalesce(p_setting_key, ''));
  v_row public.users_warga%rowtype;
  v_username text;
  v_granted boolean := false;
begin
  if v_key not in (
    'settings.ipl_billing',
    'settings.security_patrol',
    'settings.residents_blocks',
    'settings.chat_moderation',
    'settings.reports_audit',
    'settings.system_integrations'
  ) then
    return false;
  end if;

  if public.is_verified_bendahara_caller() then
    return true;
  end if;

  v_row := public.resolve_caller_pengurus_row();
  if v_row.id is null or v_row.is_active_pengurus = false or v_row.aktif = false then
    return false;
  end if;

  v_username := public.normalize_pengurus_username(v_row.blok_rumah);

  select exists(
    select 1
    from public.pengurus_settings_permissions psp
    where psp.pengurus_username = v_username
      and psp.setting_key = v_key
      and psp.status = 'granted'
  ) into v_granted;

  return coalesce(v_granted, false);
end;
$$;

create or replace function public.can_access_central_setting(
  p_pengurus_username text,
  p_setting_key text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key text := trim(coalesce(p_setting_key, ''));
  v_norm_target text := public.normalize_pengurus_username(p_pengurus_username);
  v_caller public.users_warga%rowtype;
  v_target public.users_warga%rowtype;
  v_granted boolean := false;
begin
  if v_key not in (
    'settings.ipl_billing',
    'settings.security_patrol',
    'settings.residents_blocks',
    'settings.chat_moderation',
    'settings.reports_audit',
    'settings.system_integrations'
  ) or v_norm_target = '' then
    return false;
  end if;

  if not public.is_trusted_db_admin() and not public.is_verified_bendahara_caller() then
    v_caller := public.resolve_caller_pengurus_row();
    if v_caller.id is null or public.normalize_pengurus_username(v_caller.blok_rumah) <> v_norm_target then
      return false;
    end if;
  end if;

  select u.*
  into v_target
  from public.users_warga u
  where u.aktif = true
    and u.is_active_pengurus = true
    and u.role in ('admin', 'bendahara')
    and public.normalize_pengurus_username(u.blok_rumah) = v_norm_target
  order by case when u.jabatan = 'Bendahara' or u.admin_permission = 'full' then 0 else 1 end
  limit 1;

  if v_target.id is null then
    return false;
  end if;

  if v_target.jabatan = 'Bendahara'
     or v_target.role = 'bendahara'
     or public.normalize_pengurus_username(v_target.blok_rumah) = 'andriansyah' then
    return coalesce(v_target.admin_permission, '') = 'full';
  end if;

  select exists(
    select 1
    from public.pengurus_settings_permissions psp
    where psp.pengurus_username = v_norm_target
      and psp.setting_key = v_key
      and psp.status = 'granted'
  ) into v_granted;

  return coalesce(v_granted, false);
end;
$$;
