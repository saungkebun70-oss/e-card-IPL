-- ============================================================================
-- MIGRASI V16 [MODUL 1/5]: EKSKLUSIVITAS AKUN PENGURUS VS WARGA, PEMULIHAN
-- OTOMATIS WARGA, & DELEGASI PENGATURAN TERPUSAT KHUSUS BENDAHARA
-- Aplikasi: e-Card IPL Saung Kebun (e-card-ipl.vercel.app)
-- Perumahan Saung Kebun, Desa Bengle, Kec. Majalaya, Kab. Karawang
-- Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. HELPER NORMALISASI & PEMBACA HEADER
-- ----------------------------------------------------------------------------

create or replace function public.req_header(header_name text)
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> lower(header_name),
    ''
  );
$$;

create or replace function public.normalize_blok_canonical(raw_blok text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      upper(
        regexp_replace(
          replace(coalesce(trim(raw_blok), ''), '-', '/'),
          '\s+',
          '',
          'g'
        )
      ),
      '^([A-Z]+)0+(\d+)',
      '\1\2'
    ),
    '/0+(\d+)',
    '/\1'
  );
$$;

create or replace function public.normalize_pengurus_username(raw_input text)
returns text
language sql
immutable
as $$
  select case lower(regexp_replace(coalesce(trim(raw_input), ''), '[\s.]+', '', 'g'))
    when 'admin' then 'andriansyah'
    when 'paiwan' then 'bpiwan'
    else lower(regexp_replace(coalesce(trim(raw_input), ''), '[\s.]+', '', 'g'))
  end;
$$;

-- ----------------------------------------------------------------------------
-- 2. PERLUASAN SKEMA public.users_warga (EKSKLUSIVITAS PENGURUS VS WARGA)
-- ----------------------------------------------------------------------------

alter table public.users_warga
  add column if not exists is_active_pengurus boolean not null default false,
  add column if not exists is_active_warga boolean not null default true,
  add column if not exists warga_account_status text not null default 'active',
  add column if not exists linked_warga_blok text,
  add column if not exists linked_pengurus_username text,
  add column if not exists pengurus_status_updated_at timestamptz,
  add column if not exists pengurus_status_updated_by text;

alter table public.users_warga
  drop constraint if exists users_warga_warga_account_status_check;

alter table public.users_warga
  add constraint users_warga_warga_account_status_check
  check (warga_account_status in ('active', 'suspended_pengurus', 'inactive'));

create index if not exists idx_users_warga_active_pengurus
  on public.users_warga (is_active_pengurus, role)
  where is_active_pengurus = true;

create index if not exists idx_users_warga_warga_status
  on public.users_warga (warga_account_status, is_active_warga);

create index if not exists idx_users_warga_linked_warga_blok
  on public.users_warga (linked_warga_blok)
  where linked_warga_blok is not null;

create index if not exists idx_users_warga_linked_pengurus_username
  on public.users_warga (linked_pengurus_username)
  where linked_pengurus_username is not null;

-- Backfill pemetaan resmi Pengurus <-> Blok Rumah Warga Saung Kebun
update public.users_warga u
set linked_warga_blok = case public.normalize_pengurus_username(u.blok_rumah)
    when 'andriansyah' then 'B7/16'
    when 'bpiwan' then 'B8/5'
    when 'erlangga' then 'B3/7'
    when 'doni' then 'B5/21'
    when 'wahyu' then 'B5/24'
    when 'deny' then 'B8/6'
    else u.linked_warga_blok
  end
where u.role in ('admin', 'bendahara')
  or lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) in (
    'andriansyah', 'admin', 'bpiwan', 'paiwan', 'erlangga', 'doni', 'wahyu', 'deny'
  );

update public.users_warga w
set linked_pengurus_username = case public.normalize_blok_canonical(w.blok_rumah)
    when 'B7/16' then 'andriansyah'
    when 'B8/5' then 'bpiwan'
    when 'B3/7' then 'erlangga'
    when 'B5/21' then 'doni'
    when 'B5/24' then 'wahyu'
    when 'B8/6' then 'deny'
    else w.linked_pengurus_username
  end
where coalesce(w.role, 'warga') = 'warga'
  and public.normalize_blok_canonical(w.blok_rumah) in (
    'B7/16', 'B8/5', 'B3/7', 'B5/21', 'B5/24', 'B8/6'
  );

-- Sinkronkan status awal akun Pengurus aktif (Bendahara = full, lainnya = add_only)
update public.users_warga u
set
  is_active_pengurus = (u.aktif = true and u.role in ('admin', 'bendahara')),
  is_active_warga = case
    when u.aktif = true and u.role in ('admin', 'bendahara') then false
    when u.aktif = false then false
    else true
  end,
  warga_account_status = case
    when u.aktif = true and u.role in ('admin', 'bendahara') then 'suspended_pengurus'
    when u.aktif = false then 'inactive'
    else 'active'
  end,
  admin_permission = case
    when u.aktif = true and u.role in ('admin', 'bendahara') then
      case
        when u.jabatan = 'Bendahara'
          or u.role = 'bendahara'
          or public.normalize_pengurus_username(u.blok_rumah) = 'andriansyah'
        then 'full'
        else 'add_only'
      end
    else null
  end,
  bot_role = case
    when u.aktif = true and (
      u.jabatan = 'Bendahara'
      or u.role = 'bendahara'
      or public.normalize_pengurus_username(u.blok_rumah) = 'andriansyah'
    ) then 'bendahara'
    when u.aktif = true and u.role = 'admin' then 'admin'
    else 'warga'
  end
where u.role in ('admin', 'bendahara');

-- Nonaktifkan sementara akun Warga/Blok milik Pengurus yang sedang aktif
update public.users_warga w
set
  is_active_pengurus = false,
  is_active_warga = not exists (
    select 1
    from public.users_warga p
    where p.is_active_pengurus = true
      and p.aktif = true
      and p.role in ('admin', 'bendahara')
      and (
        public.normalize_blok_canonical(p.linked_warga_blok) = public.normalize_blok_canonical(w.blok_rumah)
        or (
          w.linked_pengurus_username is not null
          and public.normalize_pengurus_username(p.blok_rumah) = public.normalize_pengurus_username(w.linked_pengurus_username)
        )
      )
  ) and w.aktif,
  warga_account_status = case
    when exists (
      select 1
      from public.users_warga p
      where p.is_active_pengurus = true
        and p.aktif = true
        and p.role in ('admin', 'bendahara')
        and (
          public.normalize_blok_canonical(p.linked_warga_blok) = public.normalize_blok_canonical(w.blok_rumah)
          or (
            w.linked_pengurus_username is not null
            and public.normalize_pengurus_username(p.blok_rumah) = public.normalize_pengurus_username(w.linked_pengurus_username)
          )
        )
    ) then 'suspended_pengurus'
    when w.aktif = false then 'inactive'
    else 'active'
  end
where coalesce(w.role, 'warga') = 'warga';

-- ----------------------------------------------------------------------------
-- 3. TABEL MATRIKS IZIN PENGATURAN TERPUSAT (pengurus_settings_permissions)
-- ----------------------------------------------------------------------------

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

-- Seed matriks default ('revoked') untuk seluruh Pengurus aktif selain Bendahara
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

-- ----------------------------------------------------------------------------
-- 4. FUNGSI VERIFIKASI SERVER/DATABASE (ANTI BYPASS HEADER FRONTEND)
-- ----------------------------------------------------------------------------

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

  -- Bendahara aktif selalu memiliki akses penuh ke seluruh modul pengaturan terpusat
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

  -- Hanya boleh dicek oleh Bendahara, layanan backend, atau pengurus itu sendiri
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

-- ----------------------------------------------------------------------------
-- 5. TRIGGER AUDIT LOG & PENJAGA INTEGRITAS STATUS PENGURUS <-> WARGA
-- ----------------------------------------------------------------------------

create or replace function public.trg_fn_guard_pengurus_permissions_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_row public.users_warga%rowtype;
  v_actor text := 'system';
  v_bypass text := coalesce(current_setting('app.bypass_permission_guard', true), '0');
begin
  if v_bypass <> '1' and not public.is_verified_bendahara_caller() then
    raise exception 'Hanya Bendahara (Andriansyah) yang berwenang mengatur delegasi izin pengaturan sistem terpusat.'
      using errcode = '42501';
  end if;

  v_caller_row := public.resolve_caller_pengurus_row();
  if v_caller_row.id is not null then
    v_actor := public.normalize_pengurus_username(v_caller_row.blok_rumah);
  elsif nullif(trim(public.req_header('x-blok-rumah')), '') is not null then
    v_actor := public.normalize_pengurus_username(public.req_header('x-blok-rumah'));
  end if;

  if tg_op = 'DELETE' then
    if public.normalize_pengurus_username(old.pengurus_username) = 'andriansyah' then
      raise exception 'Hak pengaturan terpusat Bendahara tidak dapat dihapus.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  new.pengurus_username := public.normalize_pengurus_username(new.pengurus_username);

  if new.pengurus_username = 'andriansyah' and new.status = 'revoked' then
    raise exception 'Hak pengaturan sistem terpusat milik Bendahara tidak dapat dicabut.'
      using errcode = '42501';
  end if;

  if new.pengurus_user_id is null then
    select u.id
    into new.pengurus_user_id
    from public.users_warga u
    where public.normalize_pengurus_username(u.blok_rumah) = new.pengurus_username
      and u.role in ('admin', 'bendahara')
    order by case when u.is_active_pengurus then 0 else 1 end
    limit 1;
  end if;

  new.updated_at := now();

  if new.status = 'granted' then
    new.granted_by := coalesce(nullif(trim(new.granted_by), ''), v_actor);
    new.granted_at := coalesce(new.granted_at, now());
    if tg_op = 'UPDATE' and old.status is distinct from 'granted' then
      new.granted_by := v_actor;
      new.granted_at := now();
    end if;
  else
    new.revoked_by := coalesce(nullif(trim(new.revoked_by), ''), v_actor);
    new.revoked_at := coalesce(new.revoked_at, now());
    if tg_op = 'UPDATE' and old.status is distinct from 'revoked' then
      new.revoked_by := v_actor;
      new.revoked_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_pengurus_permissions_write on public.pengurus_settings_permissions;
create trigger trg_guard_pengurus_permissions_write
  before insert or update or delete on public.pengurus_settings_permissions
  for each row
  execute function public.trg_fn_guard_pengurus_permissions_write();

create or replace function public.trg_fn_audit_pengurus_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller public.users_warga%rowtype;
  v_actor_id text := 'system';
  v_actor_name text := 'Sistem / Bendahara';
  v_action text;
  v_target_user text;
  v_key text;
  v_summary text;
begin
  v_caller := public.resolve_caller_pengurus_row();
  if v_caller.id is not null then
    v_actor_id := v_caller.blok_rumah;
    v_actor_name := v_caller.nama_warga;
  elsif nullif(trim(public.req_header('x-blok-rumah')), '') is not null then
    v_actor_id := trim(public.req_header('x-blok-rumah'));
  end if;

  if tg_op = 'DELETE' then
    v_action := 'DELETE_PENGURUS_SETTING_PERMISSION';
    v_target_user := old.pengurus_username;
    v_key := old.setting_key;
    v_summary := format('Bendahara menghapus aturan modul %s untuk pengurus %s.', v_key, v_target_user);
  else
    v_target_user := new.pengurus_username;
    v_key := new.setting_key;
    v_action := case
      when new.status = 'granted' then 'GRANT_PENGURUS_SETTING_PERMISSION'
      else 'REVOKE_PENGURUS_SETTING_PERMISSION'
    end;
    v_summary := format(
      'Bendahara mengubah akses %s untuk pengurus %s menjadi %s.',
      v_key,
      v_target_user,
      upper(new.status)
    );
  end if;

  insert into public.audit_logs (
    actor_role,
    actor_id,
    actor_name,
    action,
    entity,
    entity_id,
    summary,
    metadata
  )
  values (
    case when v_caller.id is not null then 'admin' else 'system' end,
    v_actor_id,
    v_actor_name,
    v_action,
    'pengurus_settings_permissions',
    v_target_user || ':' || v_key,
    v_summary,
    jsonb_build_object(
      'pengurus_username', v_target_user,
      'setting_key', v_key,
      'before_status', case when tg_op in ('UPDATE', 'DELETE') then old.status else null end,
      'after_status', case when tg_op in ('INSERT', 'UPDATE') then new.status else null end,
      'notes', case when tg_op in ('INSERT', 'UPDATE') then new.notes else null end
    )
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_pengurus_permissions on public.pengurus_settings_permissions;
create trigger trg_audit_pengurus_permissions
  after insert or update or delete on public.pengurus_settings_permissions
  for each row
  execute function public.trg_fn_audit_pengurus_permissions();

-- Trigger sinkronisasi otomatis & proteksi kolom hak istimewa pada public.users_warga
create or replace function public.trg_fn_sync_users_warga_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bypass text := coalesce(current_setting('app.bypass_privilege_guard', true), '0');
  v_caller public.users_warga%rowtype;
  v_actor text := 'system';
  v_priv_changed boolean := false;
begin
  v_caller := public.resolve_caller_pengurus_row();
  if v_caller.id is not null then
    v_actor := public.normalize_pengurus_username(v_caller.blok_rumah);
  end if;

  if tg_op = 'INSERT' then
    v_priv_changed := (
      coalesce(new.is_active_pengurus, false) = true
      or coalesce(new.role, 'warga') in ('admin', 'bendahara')
      or new.admin_permission is not null
    );
  else
    v_priv_changed := (
      new.role is distinct from old.role
      or new.jabatan is distinct from old.jabatan
      or new.admin_permission is distinct from old.admin_permission
      or new.is_active_pengurus is distinct from old.is_active_pengurus
      or new.is_active_warga is distinct from old.is_active_warga
      or new.warga_account_status is distinct from old.warga_account_status
      or new.linked_warga_blok is distinct from old.linked_warga_blok
      or new.linked_pengurus_username is distinct from old.linked_pengurus_username
    );
  end if;

  -- Proteksi anti eskalasi dari frontend: hanya Bendahara / RPC terverifikasi yang boleh mengubah hak Pengurus
  if v_priv_changed and v_bypass <> '1' and not public.is_verified_bendahara_caller() then
    raise exception 'Perubahan status Pengurus, peran, atau pemulihan akun Warga hanya dapat dilakukan oleh Bendahara aktif melalui prosedur resmi.'
      using errcode = '42501';
  end if;

  -- Normalisasi eksklusivitas Pengurus vs Warga
  if coalesce(new.is_active_pengurus, false) = true then
    if coalesce(new.role, 'warga') = 'warga' then
      new.role := 'admin';
    end if;
    new.is_active_warga := false;
    new.warga_account_status := 'suspended_pengurus';
    new.aktif := true;
    new.admin_permission := case
      when new.jabatan = 'Bendahara'
        or new.role = 'bendahara'
        or public.normalize_pengurus_username(new.blok_rumah) = 'andriansyah'
      then 'full'
      else coalesce(nullif(new.admin_permission, ''), 'add_only')
    end;
    new.bot_role := case
      when new.admin_permission = 'full' or new.jabatan = 'Bendahara' then 'bendahara'
      else 'admin'
    end;
    new.pengurus_status_updated_at := now();
    new.pengurus_status_updated_by := coalesce(new.pengurus_status_updated_by, v_actor);
  elsif tg_op = 'UPDATE' and old.is_active_pengurus = true and new.is_active_pengurus = false then
    -- Pemulihan otomatis saat status Pengurus dicabut/dinonaktifkan
    new.admin_permission := null;
    new.bot_role := 'warga';
    new.is_active_warga := true;
    new.warga_account_status := 'active';
    new.pengurus_status_updated_at := now();
    new.pengurus_status_updated_by := coalesce(new.pengurus_status_updated_by, v_actor);
    if new.linked_warga_blok is null
       or public.normalize_blok_canonical(new.blok_rumah) = public.normalize_blok_canonical(new.linked_warga_blok) then
      new.role := 'warga';
      new.jabatan := null;
      new.aktif := true;
    end if;
  elsif coalesce(new.role, 'warga') = 'warga' then
    if coalesce(new.warga_account_status, 'active') = 'suspended_pengurus' then
      new.is_active_warga := false;
    elsif coalesce(new.aktif, true) = false then
      new.is_active_warga := false;
      new.warga_account_status := 'inactive';
    elsif new.is_active_warga = true then
      new.warga_account_status := 'active';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_users_warga_privileges on public.users_warga;
create trigger trg_sync_users_warga_privileges
  before insert or update on public.users_warga
  for each row
  execute function public.trg_fn_sync_users_warga_privileges();

-- Trigger AFTER UPDATE: sinkronkan baris Warga/Blok terhubung & cabut pengurus_settings_permissions
create or replace function public.trg_fn_propagate_pengurus_warga_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm_username text := public.normalize_pengurus_username(new.blok_rumah);
  v_linked_blok text := public.normalize_blok_canonical(new.linked_warga_blok);
  v_actor text := coalesce(nullif(new.pengurus_status_updated_by, ''), 'system');
  v_bypass text := coalesce(current_setting('app.bypass_sync_propagation', true), '0');
begin
  if v_bypass = '1' then
    return new;
  end if;

  if old.is_active_pengurus is distinct from new.is_active_pengurus then
    perform set_config('app.bypass_privilege_guard', '1', true);
    perform set_config('app.bypass_permission_guard', '1', true);
    perform set_config('app.bypass_sync_propagation', '1', true);

    if new.is_active_pengurus = false then
      -- 1. Cabut seluruh hak akses pengaturan terpusat pengurus tersebut
      update public.pengurus_settings_permissions
      set
        status = 'revoked',
        revoked_by = v_actor,
        revoked_at = now(),
        notes = coalesce(notes, 'Dicabut otomatis karena status Pengurus dinonaktifkan.'),
        updated_at = now()
      where pengurus_username = v_norm_username
        and status = 'granted';

      -- 2. Aktifkan kembali akun Warga/Blok miliknya secara otomatis
      update public.users_warga w
      set
        is_active_pengurus = false,
        is_active_warga = true,
        warga_account_status = 'active',
        aktif = true,
        role = 'warga',
        admin_permission = null,
        pengurus_status_updated_at = now(),
        pengurus_status_updated_by = v_actor
      where w.id <> new.id
        and coalesce(w.role, 'warga') = 'warga'
        and (
          (v_linked_blok <> '' and public.normalize_blok_canonical(w.blok_rumah) = v_linked_blok)
          or public.normalize_pengurus_username(w.linked_pengurus_username) = v_norm_username
        );

      insert into public.audit_logs (
        actor_role, actor_id, actor_name, action, entity, entity_id, summary, metadata
      )
      values (
        'admin',
        v_actor,
        v_actor,
        'SYNC_PENGURUS_TO_WARGA',
        'users_warga',
        new.blok_rumah,
        format(
          'Status Pengurus %s (%s) dinonaktifkan; akun Warga/Blok (%s) otomatis diaktifkan kembali & seluruh hak Pengurus dicabut.',
          new.nama_warga,
          new.blok_rumah,
          coalesce(nullif(v_linked_blok, ''), new.blok_rumah)
        ),
        jsonb_build_object(
          'pengurus_username', v_norm_username,
          'linked_warga_blok', v_linked_blok,
          'is_active_pengurus', false,
          'is_active_warga', true,
          'warga_account_status', 'active'
        )
      );
    else
      -- Pengurus diaktifkan -> tangguhkan jalur login Warga/Blok miliknya
      update public.users_warga w
      set
        is_active_warga = false,
        warga_account_status = 'suspended_pengurus',
        pengurus_status_updated_at = now(),
        pengurus_status_updated_by = v_actor
      where w.id <> new.id
        and coalesce(w.role, 'warga') = 'warga'
        and (
          (v_linked_blok <> '' and public.normalize_blok_canonical(w.blok_rumah) = v_linked_blok)
          or public.normalize_pengurus_username(w.linked_pengurus_username) = v_norm_username
        );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_propagate_pengurus_warga_sync on public.users_warga;
create trigger trg_propagate_pengurus_warga_sync
  after update on public.users_warga
  for each row
  execute function public.trg_fn_propagate_pengurus_warga_sync();

-- ----------------------------------------------------------------------------
-- 6. RPC VALIDASI LOGIN & GUARD EKSKLUSIVITAS PENGURUS VS WARGA
-- ----------------------------------------------------------------------------

create or replace function public.validate_login_account_status(
  p_identifier text,
  p_login_mode text default 'warga'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(trim(coalesce(p_login_mode, 'warga')));
  v_raw text := trim(coalesce(p_identifier, ''));
  v_canon_blok text := public.normalize_blok_canonical(v_raw);
  v_norm_user text := public.normalize_pengurus_username(v_raw);
  v_unit public.users_warga%rowtype;
  v_active_pengurus public.users_warga%rowtype;
  v_revoked_pengurus public.users_warga%rowtype;
begin
  if v_mode not in ('warga', 'admin') then
    return jsonb_build_object(
      'allowed', false,
      'code', 'INVALID_LOGIN_MODE',
      'message', 'Jalur login tidak dikenali. Gunakan jalur Warga atau jalur Pengurus.'
    );
  end if;

  if v_raw = '' then
    return jsonb_build_object(
      'allowed', false,
      'code', 'EMPTY_IDENTIFIER',
      'message', 'Mohon isi Blok/No. Rumah atau Username Pengurus terlebih dahulu.'
    );
  end if;

  -- Cek apakah identifier merujuk ke Pengurus aktif (langsung atau lewat blok rumahnya)
  select p.*
  into v_active_pengurus
  from public.users_warga p
  where p.is_active_pengurus = true
    and p.aktif = true
    and p.role in ('admin', 'bendahara')
    and (
      public.normalize_pengurus_username(p.blok_rumah) = v_norm_user
      or (v_canon_blok <> '' and public.normalize_blok_canonical(p.linked_warga_blok) = v_canon_blok)
      or (v_canon_blok <> '' and public.normalize_blok_canonical(p.blok_rumah) = v_canon_blok)
    )
  order by case when public.normalize_pengurus_username(p.blok_rumah) = v_norm_user then 0 else 1 end
  limit 1;

  -- Cari baris akun unit/warga jika ada
  select u.*
  into v_unit
  from public.users_warga u
  where (v_canon_blok <> '' and public.normalize_blok_canonical(u.blok_rumah) = v_canon_blok)
     or public.normalize_pengurus_username(u.blok_rumah) = v_norm_user
  order by case when coalesce(u.role, 'warga') = 'warga' then 0 else 1 end
  limit 1;

  -- JALUR LOGIN WARGA / BLOK
  if v_mode = 'warga' then
    if v_active_pengurus.id is not null
       or (v_unit.id is not null and (v_unit.is_active_pengurus = true or v_unit.warga_account_status = 'suspended_pengurus')) then
      return jsonb_build_object(
        'allowed', false,
        'code', 'PENGURUS_MUST_USE_ADMIN_PORTAL',
        'message', format(
          'Akun ini terdaftar sebagai Pengurus aktif (%s — %s) dan tidak dapat masuk lewat jalur Warga atau Blok. Silakan masuk melalui jalur Pengurus.',
          coalesce(v_active_pengurus.nama_warga, v_unit.nama_warga, 'Pengurus'),
          coalesce(v_active_pengurus.jabatan, v_unit.jabatan, 'Pengurus')
        ),
        'blok_rumah', coalesce(v_unit.blok_rumah, v_active_pengurus.linked_warga_blok, v_raw),
        'pengurus_username', coalesce(v_active_pengurus.blok_rumah, v_unit.linked_pengurus_username),
        'is_active_pengurus', true,
        'is_active_warga', false,
        'warga_account_status', 'suspended_pengurus'
      );
    end if;

    if v_unit.id is not null and (
      v_unit.aktif = false
      or v_unit.is_active_warga = false
      or v_unit.warga_account_status <> 'active'
    ) then
      return jsonb_build_object(
        'allowed', false,
        'code', 'WARGA_ACCOUNT_INACTIVE',
        'message', 'Akun Warga/Blok ini sedang tidak aktif. Silakan hubungi Bendahara atau Pengurus lingkungan.',
        'blok_rumah', v_unit.blok_rumah,
        'is_active_pengurus', v_unit.is_active_pengurus,
        'is_active_warga', v_unit.is_active_warga,
        'warga_account_status', v_unit.warga_account_status
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'code', 'OK',
      'message', 'Akun Warga valid untuk masuk melalui jalur Warga.',
      'blok_rumah', coalesce(v_unit.blok_rumah, v_canon_blok),
      'is_active_pengurus', false,
      'is_active_warga', coalesce(v_unit.is_active_warga, true),
      'warga_account_status', coalesce(v_unit.warga_account_status, 'active')
    );
  end if;

  -- JALUR LOGIN PENGURUS / ADMIN
  if v_active_pengurus.id is not null then
    return jsonb_build_object(
      'allowed', true,
      'code', 'OK',
      'message', 'Akun Pengurus aktif valid untuk masuk melalui jalur Pengurus.',
      'blok_rumah', v_active_pengurus.blok_rumah,
      'pengurus_username', public.normalize_pengurus_username(v_active_pengurus.blok_rumah),
      'jabatan', v_active_pengurus.jabatan,
      'admin_permission', v_active_pengurus.admin_permission,
      'is_active_pengurus', true,
      'is_active_warga', false,
      'warga_account_status', 'suspended_pengurus'
    );
  end if;

  select p.*
  into v_revoked_pengurus
  from public.users_warga p
  where (
      public.normalize_pengurus_username(p.blok_rumah) = v_norm_user
      or (v_canon_blok <> '' and public.normalize_blok_canonical(p.linked_warga_blok) = v_canon_blok)
    )
    and p.is_active_pengurus = false
    and (p.role in ('admin', 'bendahara') or p.linked_pengurus_username is not null or p.linked_warga_blok is not null)
  limit 1;

  if v_revoked_pengurus.id is not null then
    return jsonb_build_object(
      'allowed', false,
      'code', 'PENGURUS_REVOKED_USE_WARGA',
      'message', 'Status Pengurus akun ini telah dinonaktifkan. Hak akses Pengurus telah dicabut dan akun Warga/Blok Anda telah aktif kembali — silakan masuk melalui jalur Warga.',
      'blok_rumah', coalesce(v_revoked_pengurus.linked_warga_blok, v_revoked_pengurus.blok_rumah),
      'is_active_pengurus', false,
      'is_active_warga', true,
      'warga_account_status', 'active'
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'code', 'NOT_ACTIVE_PENGURUS',
    'message', 'Akun ini tidak terdaftar sebagai Pengurus aktif. Gunakan jalur Warga apabila Anda masuk sebagai warga unit.'
  );
end;
$$;

grant execute on function public.validate_login_account_status(text, text) to anon, authenticated;

-- Perbarui login_ecard agar mengembalikan metadata eksklusivitas (tetap kompatibel dengan seluruh caller eksisting)
drop function if exists public.login_ecard(text, text);

create or replace function public.login_ecard(p_blok text, p_pin text)
returns table (
  blok_rumah text,
  nama_warga text,
  no_wa text,
  status_hunian text,
  nominal_iuran integer,
  role text,
  jabatan text,
  admin_permission text,
  is_active_pengurus boolean,
  is_active_warga boolean,
  warga_account_status text,
  linked_warga_blok text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := lower(regexp_replace(trim(coalesce(p_blok, '')), '\s+', '', 'g'));
  v_canon_blok text := public.normalize_blok_canonical(p_blok);
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
    where (
      lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = v_key
      or (v_canon_blok <> '' and public.normalize_blok_canonical(u.blok_rumah) = v_canon_blok)
    )
      and u.pin_akses = trim(coalesce(p_pin, ''))
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
    u.admin_permission,
    u.is_active_pengurus,
    u.is_active_warga,
    u.warga_account_status,
    u.linked_warga_blok
  from public.users_warga u
  where (
    lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = v_key
    or (v_canon_blok <> '' and public.normalize_blok_canonical(u.blok_rumah) = v_canon_blok)
  )
    and u.pin_akses = trim(coalesce(p_pin, ''))
    and u.aktif = true
  order by case when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = v_key then 0 else 1 end
  limit 1;
end;
$$;

grant execute on function public.login_ecard(text, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. RPC SINKRONISASI PENGURUS <-> WARGA & DELEGASI IZIN BENDAHARA
-- ----------------------------------------------------------------------------

create or replace function public.sync_pengurus_to_warga_status(
  p_target_identifier text,
  p_is_active_pengurus boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw text := trim(coalesce(p_target_identifier, ''));
  v_norm_user text := public.normalize_pengurus_username(v_raw);
  v_canon_blok text := public.normalize_blok_canonical(v_raw);
  v_caller public.users_warga%rowtype;
  v_actor text := 'system';
  v_target public.users_warga%rowtype;
  v_linked_blok text;
  v_active_bendahara_count integer := 0;
  v_revoked_perm_count integer := 0;
  v_restored_warga_count integer := 0;
  v_action text;
begin
  if not public.is_verified_bendahara_caller()
     and not public.can_access_central_setting_db('settings.residents_blocks') then
    raise exception 'Akses ditolak: hanya Bendahara atau Pengurus berizin settings.residents_blocks yang dapat mengubah status Pengurus.'
      using errcode = '42501';
  end if;

  if v_raw = '' then
    raise exception 'Target akun Pengurus atau Blok Rumah wajib diisi.'
      using errcode = '22023';
  end if;

  v_caller := public.resolve_caller_pengurus_row();
  if v_caller.id is not null then
    v_actor := public.normalize_pengurus_username(v_caller.blok_rumah);
  end if;

  select u.*
  into v_target
  from public.users_warga u
  where public.normalize_pengurus_username(u.blok_rumah) = v_norm_user
     or (v_canon_blok <> '' and public.normalize_blok_canonical(u.blok_rumah) = v_canon_blok)
     or (v_canon_blok <> '' and public.normalize_blok_canonical(u.linked_warga_blok) = v_canon_blok)
  order by
    case when u.role in ('admin', 'bendahara') then 0 else 1 end,
    case when u.is_active_pengurus then 0 else 1 end
  limit 1;

  if v_target.id is null then
    raise exception 'Akun target (%) tidak ditemukan pada data warga/pengurus.', v_raw
      using errcode = 'P0002';
  end if;

  -- Proteksi: pencabutan / pengangkatan Bendahara hanya oleh Bendahara aktif, dan dilarang menonaktifkan Bendahara terakhir
  if (v_target.jabatan = 'Bendahara' or v_target.role = 'bendahara' or public.normalize_pengurus_username(v_target.blok_rumah) = 'andriansyah') then
    if not public.is_verified_bendahara_caller() then
      raise exception 'Hanya Bendahara yang berwenang mengubah status akun Bendahara.'
        using errcode = '42501';
    end if;

    if p_is_active_pengurus = false then
      select count(*)::integer
      into v_active_bendahara_count
      from public.users_warga b
      where b.id <> v_target.id
        and b.is_active_pengurus = true
        and b.aktif = true
        and (b.jabatan = 'Bendahara' or b.role = 'bendahara');

      if v_active_bendahara_count = 0 then
        raise exception 'Tidak dapat menonaktifkan satu-satunya Bendahara aktif. Sistem membutuhkan minimal 1 Bendahara aktif.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  v_norm_user := public.normalize_pengurus_username(
    coalesce(nullif(v_target.linked_pengurus_username, ''), v_target.blok_rumah)
  );
  v_linked_blok := public.normalize_blok_canonical(
    coalesce(nullif(v_target.linked_warga_blok, ''), case when v_target.role = 'warga' then v_target.blok_rumah else '' end)
  );

  perform set_config('app.bypass_privilege_guard', '1', true);
  perform set_config('app.bypass_permission_guard', '1', true);
  perform set_config('app.bypass_sync_propagation', '1', true);

  if p_is_active_pengurus = false then
    -- 1. Cabut status Pengurus & hak akses khususnya
    update public.users_warga u
    set
      is_active_pengurus = false,
      admin_permission = null,
      bot_role = 'warga',
      is_active_warga = true,
      warga_account_status = 'active',
      aktif = true,
      role = case
        when u.linked_warga_blok is null or public.normalize_blok_canonical(u.blok_rumah) = v_linked_blok
        then 'warga'
        else u.role
      end,
      jabatan = case
        when u.linked_warga_blok is null or public.normalize_blok_canonical(u.blok_rumah) = v_linked_blok
        then null
        else u.jabatan
      end,
      pengurus_status_updated_at = now(),
      pengurus_status_updated_by = v_actor
    where u.id = v_target.id
       or public.normalize_pengurus_username(u.blok_rumah) = v_norm_user;

    -- 2. Aktifkan kembali akun Warga/Blok miliknya secara otomatis
    update public.users_warga w
    set
      is_active_pengurus = false,
      is_active_warga = true,
      warga_account_status = 'active',
      aktif = true,
      role = 'warga',
      admin_permission = null,
      pengurus_status_updated_at = now(),
      pengurus_status_updated_by = v_actor
    where coalesce(w.role, 'warga') = 'warga'
      and (
        (v_linked_blok <> '' and public.normalize_blok_canonical(w.blok_rumah) = v_linked_blok)
        or public.normalize_pengurus_username(w.linked_pengurus_username) = v_norm_user
      );
    get diagnostics v_restored_warga_count = row_count;

    -- 3. Cabut seluruh delegasi pengaturan terpusat
    update public.pengurus_settings_permissions
    set
      status = 'revoked',
      revoked_by = v_actor,
      revoked_at = now(),
      notes = coalesce(nullif(trim(p_reason), ''), 'Dicabut otomatis saat status Pengurus dinonaktifkan.'),
      updated_at = now()
    where pengurus_username = v_norm_user
      and status = 'granted';
    get diagnostics v_revoked_perm_count = row_count;

    v_action := 'SYNC_PENGURUS_TO_WARGA';
  else
    -- Aktifkan Pengurus eksklusif & tangguhkan jalur login Warga/Blok miliknya
    update public.users_warga u
    set
      is_active_pengurus = true,
      is_active_warga = false,
      warga_account_status = 'suspended_pengurus',
      aktif = true,
      role = case when coalesce(u.role, 'warga') = 'warga' then 'admin' else u.role end,
      admin_permission = case
        when u.jabatan = 'Bendahara' or u.role = 'bendahara' or v_norm_user = 'andriansyah'
        then 'full'
        else 'add_only'
      end,
      bot_role = case
        when u.jabatan = 'Bendahara' or u.role = 'bendahara' or v_norm_user = 'andriansyah'
        then 'bendahara'
        else 'admin'
      end,
      pengurus_status_updated_at = now(),
      pengurus_status_updated_by = v_actor
    where u.id = v_target.id
       or public.normalize_pengurus_username(u.blok_rumah) = v_norm_user;

    update public.users_warga w
    set
      is_active_warga = false,
      warga_account_status = 'suspended_pengurus',
      pengurus_status_updated_at = now(),
      pengurus_status_updated_by = v_actor
    where w.id <> v_target.id
      and coalesce(w.role, 'warga') = 'warga'
      and (
        (v_linked_blok <> '' and public.normalize_blok_canonical(w.blok_rumah) = v_linked_blok)
        or public.normalize_pengurus_username(w.linked_pengurus_username) = v_norm_user
      );

    -- Pastikan baris matriks izin default tersedia ('revoked') untuk pengurus non-Bendahara
    if coalesce(v_target.jabatan, '') <> 'Bendahara' and v_norm_user <> 'andriansyah' then
      insert into public.pengurus_settings_permissions (
        pengurus_username, pengurus_user_id, setting_key, status, revoked_by, revoked_at, notes
      )
      select
        v_norm_user,
        v_target.id,
        k.setting_key,
        'revoked',
        v_actor,
        now(),
        'Default saat akun Pengurus diaktifkan.'
      from (
        values
          ('settings.ipl_billing'),
          ('settings.security_patrol'),
          ('settings.residents_blocks'),
          ('settings.chat_moderation'),
          ('settings.reports_audit'),
          ('settings.system_integrations')
      ) as k(setting_key)
      on conflict (pengurus_username, setting_key) do nothing;
    end if;

    v_action := 'ACTIVATE_PENGURUS_EXCLUSIVE';
  end if;

  insert into public.audit_logs (
    actor_role, actor_id, actor_name, action, entity, entity_id, summary, metadata
  )
  values (
    case when v_caller.id is not null then 'admin' else 'system' end,
    coalesce(v_caller.blok_rumah, v_actor),
    coalesce(v_caller.nama_warga, v_actor),
    v_action,
    'users_warga',
    v_target.blok_rumah,
    case
      when p_is_active_pengurus = false then format(
        'Status Pengurus %s dicabut; akun Warga/Blok (%s) otomatis diaktifkan kembali & %s izin terpusat dicabut.',
        v_target.nama_warga,
        coalesce(nullif(v_linked_blok, ''), v_target.blok_rumah),
        v_revoked_perm_count
      )
      else format(
        'Akun Pengurus %s diaktifkan secara eksklusif; jalur Warga/Blok (%s) ditangguhkan sementara.',
        v_target.nama_warga,
        coalesce(nullif(v_linked_blok, ''), v_target.blok_rumah)
      )
    end,
    jsonb_build_object(
      'target_identifier', v_raw,
      'pengurus_username', v_norm_user,
      'linked_warga_blok', v_linked_blok,
      'is_active_pengurus', p_is_active_pengurus,
      'is_active_warga', not p_is_active_pengurus,
      'warga_account_status', case when p_is_active_pengurus then 'suspended_pengurus' else 'active' end,
      'revoked_permissions_count', v_revoked_perm_count,
      'restored_warga_count', v_restored_warga_count,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'action', v_action,
    'target_blok_rumah', v_target.blok_rumah,
    'pengurus_username', v_norm_user,
    'linked_warga_blok', nullif(v_linked_blok, ''),
    'is_active_pengurus', p_is_active_pengurus,
    'is_active_warga', not p_is_active_pengurus,
    'warga_account_status', case when p_is_active_pengurus then 'suspended_pengurus' else 'active' end,
    'revoked_permissions_count', v_revoked_perm_count,
    'restored_warga_count', v_restored_warga_count
  );
end;
$$;

grant execute on function public.sync_pengurus_to_warga_status(text, boolean, text) to anon, authenticated;

create or replace function public.set_pengurus_setting_permission(
  p_pengurus_username text,
  p_setting_key text,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text := public.normalize_pengurus_username(p_pengurus_username);
  v_key text := trim(coalesce(p_setting_key, ''));
  v_status text := lower(trim(coalesce(p_status, '')));
  v_caller public.users_warga%rowtype;
  v_actor text := 'andriansyah';
  v_target public.users_warga%rowtype;
  v_saved public.pengurus_settings_permissions%rowtype;
begin
  if not public.is_verified_bendahara_caller() then
    raise exception 'Hanya Bendahara (Andriansyah) yang dapat membuka atau menutup izin pengaturan sistem terpusat.'
      using errcode = '42501';
  end if;

  if v_key not in (
    'settings.ipl_billing',
    'settings.security_patrol',
    'settings.residents_blocks',
    'settings.chat_moderation',
    'settings.reports_audit',
    'settings.system_integrations'
  ) then
    raise exception 'Kunci modul pengaturan tidak valid: %', v_key
      using errcode = '22023';
  end if;

  if v_status not in ('granted', 'revoked') then
    raise exception 'Status izin harus bernilai granted atau revoked.'
      using errcode = '22023';
  end if;

  if v_username = '' or v_username = 'andriansyah' then
    raise exception 'Hak pengaturan terpusat Bendahara selalu penuh secara default dan tidak diubah melalui matriks delegasi.'
      using errcode = '42501';
  end if;

  select u.*
  into v_target
  from public.users_warga u
  where public.normalize_pengurus_username(u.blok_rumah) = v_username
    and u.role in ('admin', 'bendahara')
  order by case when u.is_active_pengurus then 0 else 1 end
  limit 1;

  if v_target.id is null then
    raise exception 'Akun Pengurus "%" tidak ditemukan.', v_username
      using errcode = 'P0002';
  end if;

  if v_status = 'granted' and (v_target.is_active_pengurus = false or v_target.aktif = false) then
    raise exception 'Tidak dapat memberi izin ke Pengurus "%" karena status Pengurus sedang nonaktif.', v_username
      using errcode = '42501';
  end if;

  v_caller := public.resolve_caller_pengurus_row();
  if v_caller.id is not null then
    v_actor := public.normalize_pengurus_username(v_caller.blok_rumah);
  end if;

  perform set_config('app.bypass_permission_guard', '1', true);

  insert into public.pengurus_settings_permissions (
    pengurus_username,
    pengurus_user_id,
    setting_key,
    status,
    granted_by,
    granted_at,
    revoked_by,
    revoked_at,
    notes,
    updated_at
  )
  values (
    v_username,
    v_target.id,
    v_key,
    v_status,
    case when v_status = 'granted' then v_actor else null end,
    case when v_status = 'granted' then now() else null end,
    case when v_status = 'revoked' then v_actor else null end,
    case when v_status = 'revoked' then now() else null end,
    nullif(trim(coalesce(p_notes, '')), ''),
    now()
  )
  on conflict (pengurus_username, setting_key) do update set
    pengurus_user_id = excluded.pengurus_user_id,
    status = excluded.status,
    granted_by = case when excluded.status = 'granted' then v_actor else public.pengurus_settings_permissions.granted_by end,
    granted_at = case when excluded.status = 'granted' then now() else public.pengurus_settings_permissions.granted_at end,
    revoked_by = case when excluded.status = 'revoked' then v_actor else public.pengurus_settings_permissions.revoked_by end,
    revoked_at = case when excluded.status = 'revoked' then now() else public.pengurus_settings_permissions.revoked_at end,
    notes = coalesce(excluded.notes, public.pengurus_settings_permissions.notes),
    updated_at = now()
  returning * into v_saved;

  return jsonb_build_object(
    'ok', true,
    'id', v_saved.id,
    'pengurus_username', v_saved.pengurus_username,
    'setting_key', v_saved.setting_key,
    'status', v_saved.status,
    'granted_by', v_saved.granted_by,
    'granted_at', v_saved.granted_at,
    'revoked_by', v_saved.revoked_by,
    'revoked_at', v_saved.revoked_at,
    'updated_at', v_saved.updated_at
  );
end;
$$;

grant execute on function public.set_pengurus_setting_permission(text, text, text, text) to anon, authenticated;

create or replace function public.get_pengurus_central_permissions(p_pengurus_username text default null)
returns setof public.pengurus_settings_permissions
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller public.users_warga%rowtype;
  v_filter text := nullif(public.normalize_pengurus_username(coalesce(p_pengurus_username, '')), '');
begin
  if public.is_trusted_db_admin() or public.is_verified_bendahara_caller() then
    return query
    select psp.*
    from public.pengurus_settings_permissions psp
    where v_filter is null or psp.pengurus_username = v_filter
    order by psp.pengurus_username asc, psp.setting_key asc;
    return;
  end if;

  v_caller := public.resolve_caller_pengurus_row();
  if v_caller.id is null then
    raise exception 'Akses ditolak: hanya Pengurus aktif yang dapat membaca matriks izin pengaturan terpusat.'
      using errcode = '42501';
  end if;

  return query
  select psp.*
  from public.pengurus_settings_permissions psp
  where psp.pengurus_username = public.normalize_pengurus_username(v_caller.blok_rumah)
    and (v_filter is null or psp.pengurus_username = v_filter)
  order by psp.setting_key asc;
end;
$$;

grant execute on function public.get_pengurus_central_permissions(text) to anon, authenticated;
grant execute on function public.can_access_central_setting_db(text) to anon, authenticated;
grant execute on function public.can_access_central_setting(text, text) to anon, authenticated;
grant execute on function public.is_verified_bendahara_caller() to anon, authenticated;
grant execute on function public.is_verified_active_pengurus_caller() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 8. KEBIJAKAN ROW LEVEL SECURITY (RLS) TERVERIFIKASI DB (ANTI BYPASS CLIENT)
-- ----------------------------------------------------------------------------

-- 8A. pengurus_settings_permissions (Baca oleh Bendahara / pemilik akun; Tulis HANYA Bendahara)
alter table public.pengurus_settings_permissions enable row level security;
grant select, insert, update, delete on public.pengurus_settings_permissions to anon, authenticated;

drop policy if exists "psp_select_verified_pengurus" on public.pengurus_settings_permissions;
create policy "psp_select_verified_pengurus" on public.pengurus_settings_permissions
  for select using (
    public.is_verified_bendahara_caller()
    or (
      public.is_verified_active_pengurus_caller()
      and pengurus_username = public.normalize_pengurus_username(public.req_header('x-blok-rumah'))
    )
  );

drop policy if exists "psp_insert_bendahara_only" on public.pengurus_settings_permissions;
create policy "psp_insert_bendahara_only" on public.pengurus_settings_permissions
  for insert with check (public.is_verified_bendahara_caller());

drop policy if exists "psp_update_bendahara_only" on public.pengurus_settings_permissions;
create policy "psp_update_bendahara_only" on public.pengurus_settings_permissions
  for update
  using (public.is_verified_bendahara_caller())
  with check (public.is_verified_bendahara_caller());

drop policy if exists "psp_delete_bendahara_only" on public.pengurus_settings_permissions;
create policy "psp_delete_bendahara_only" on public.pengurus_settings_permissions
  for delete using (public.is_verified_bendahara_caller());

-- 8B. users_warga (Warga aktif non-pengurus hanya lihat rumah sendiri; kelola blok sesuai settings.residents_blocks)
alter table public.users_warga enable row level security;

drop policy if exists "warga_hanya_lihat_rumah_sendiri" on public.users_warga;
create policy "warga_hanya_lihat_rumah_sendiri" on public.users_warga
  for select using (
    public.is_verified_active_pengurus_caller()
    or public.is_verified_warga_self_caller(blok_rumah)
  );

drop policy if exists "admin_tambah_warga" on public.users_warga;
create policy "admin_tambah_warga" on public.users_warga
  for insert with check (
    public.can_access_central_setting_db('settings.residents_blocks')
  );

drop policy if exists "bendahara_edit_warga" on public.users_warga;
create policy "bendahara_edit_warga" on public.users_warga
  for update
  using (
    public.can_access_central_setting_db('settings.residents_blocks')
    or (
      public.is_verified_active_pengurus_caller()
      and public.normalize_pengurus_username(blok_rumah) = public.normalize_pengurus_username(public.req_header('x-blok-rumah'))
    )
    or public.is_verified_warga_self_caller(blok_rumah)
  )
  with check (
    public.can_access_central_setting_db('settings.residents_blocks')
    or (
      public.is_verified_active_pengurus_caller()
      and public.normalize_pengurus_username(blok_rumah) = public.normalize_pengurus_username(public.req_header('x-blok-rumah'))
    )
    or public.is_verified_warga_self_caller(blok_rumah)
  );

drop policy if exists "bendahara_hapus_warga" on public.users_warga;
create policy "bendahara_hapus_warga" on public.users_warga
  for delete using (
    public.is_verified_bendahara_caller()
    or public.can_access_central_setting_db('settings.residents_blocks')
  );

-- 8C. payment_config (settings.ipl_billing)
alter table public.payment_config enable row level security;

drop policy if exists "bendahara_payment_config_write" on public.payment_config;
create policy "bendahara_payment_config_write" on public.payment_config
  for all
  using (public.can_access_central_setting_db('settings.ipl_billing'))
  with check (public.can_access_central_setting_db('settings.ipl_billing'));

-- 8D. app_settings (settings.system_integrations / settings.security_patrol)
alter table public.app_settings enable row level security;

drop policy if exists "bendahara_app_settings_write" on public.app_settings;
create policy "bendahara_app_settings_write" on public.app_settings
  for all
  using (
    public.is_verified_bendahara_caller()
    or public.can_access_central_setting_db('settings.system_integrations')
  )
  with check (
    public.is_verified_bendahara_caller()
    or public.can_access_central_setting_db('settings.system_integrations')
  );

drop policy if exists "app_settings_patrol_update_policy" on public.app_settings;
create policy "app_settings_patrol_update_policy" on public.app_settings
  for update
  using (
    public.can_access_central_setting_db('settings.security_patrol')
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and nullif(trim(public.req_header('x-petugas-id')), '') is not null
    )
  )
  with check (
    public.can_access_central_setting_db('settings.security_patrol')
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and nullif(trim(public.req_header('x-petugas-id')), '') is not null
    )
  );

-- 8E. bot_wa_config (settings.system_integrations)
alter table public.bot_wa_config enable row level security;

drop policy if exists "admin_bot_config_select" on public.bot_wa_config;
create policy "admin_bot_config_select" on public.bot_wa_config
  for select using (public.is_verified_active_pengurus_caller());

drop policy if exists "bendahara_bot_config_write" on public.bot_wa_config;
create policy "bendahara_bot_config_write" on public.bot_wa_config
  for all
  using (public.can_access_central_setting_db('settings.system_integrations'))
  with check (public.can_access_central_setting_db('settings.system_integrations'));

-- 8F. system_notifications (settings.system_integrations untuk hapus/kelola)
alter table public.system_notifications enable row level security;

drop policy if exists "admin_kirim_notifikasi" on public.system_notifications;
create policy "admin_kirim_notifikasi" on public.system_notifications
  for insert with check (public.is_verified_active_pengurus_caller());

drop policy if exists "bendahara_hapus_notifikasi" on public.system_notifications;
create policy "bendahara_hapus_notifikasi" on public.system_notifications
  for delete using (
    public.is_verified_bendahara_caller()
    or public.can_access_central_setting_db('settings.system_integrations')
  );

-- 8G. audit_logs (settings.reports_audit untuk hapus; hanya Pengurus aktif untuk baca)
alter table public.audit_logs enable row level security;

drop policy if exists "audit_select_admin" on public.audit_logs;
create policy "audit_select_admin" on public.audit_logs
  for select using (public.is_verified_active_pengurus_caller());

drop policy if exists "audit_delete_admin" on public.audit_logs;
create policy "audit_delete_admin" on public.audit_logs
  for delete using (
    public.is_verified_bendahara_caller()
    or public.can_access_central_setting_db('settings.reports_audit')
  );

-- 8H. transaksi_ipl & transaksi_kas (Verifikasi/Edit/Hapus tervalidasi DB + settings.reports_audit / Ketua)
drop policy if exists "admin_verifikasi_transaksi" on public.transaksi_ipl;
drop policy if exists "transaksi_ipl_update_policy" on public.transaksi_ipl;
create policy "transaksi_ipl_update_policy" on public.transaksi_ipl
  for update
  using (
    public.is_verified_bendahara_caller()
    or public.is_verified_ketua_caller()
    or public.can_access_central_setting_db('settings.reports_audit')
    or public.can_access_central_setting_db('settings.ipl_billing')
  )
  with check (
    public.is_verified_bendahara_caller()
    or public.is_verified_ketua_caller()
    or public.can_access_central_setting_db('settings.reports_audit')
    or public.can_access_central_setting_db('settings.ipl_billing')
  );

drop policy if exists "transaksi_ipl_delete_policy" on public.transaksi_ipl;
create policy "transaksi_ipl_delete_policy" on public.transaksi_ipl
  for delete using (
    public.is_verified_bendahara_caller()
    or public.is_verified_ketua_caller()
    or public.can_access_central_setting_db('settings.reports_audit')
  );

drop policy if exists "transaksi_kas_insert_policy" on public.transaksi_kas;
create policy "transaksi_kas_insert_policy" on public.transaksi_kas
  for insert with check (public.is_verified_active_pengurus_caller());

drop policy if exists "transaksi_kas_update_policy" on public.transaksi_kas;
create policy "transaksi_kas_update_policy" on public.transaksi_kas
  for update
  using (
    public.is_verified_bendahara_caller()
    or public.is_verified_ketua_caller()
    or public.can_access_central_setting_db('settings.reports_audit')
  )
  with check (
    public.is_verified_bendahara_caller()
    or public.is_verified_ketua_caller()
    or public.can_access_central_setting_db('settings.reports_audit')
  );

drop policy if exists "transaksi_kas_delete_policy" on public.transaksi_kas;
create policy "transaksi_kas_delete_policy" on public.transaksi_kas
  for delete using (
    public.is_verified_bendahara_caller()
    or public.is_verified_ketua_caller()
    or public.can_access_central_setting_db('settings.reports_audit')
  );

-- 8I. Modul keamanan/patroli & moderasi chat (hanya jika tabelnya sudah ada)
do $$
begin
  if to_regclass('public.petugas_keamanan') is not null then
    execute 'drop policy if exists petugas_keamanan_insert_policy on public.petugas_keamanan';
    execute 'drop policy if exists petugas_keamanan_update_policy on public.petugas_keamanan';
    execute 'drop policy if exists petugas_keamanan_delete_policy on public.petugas_keamanan';
    execute 'create policy petugas_keamanan_insert_policy on public.petugas_keamanan for insert with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy petugas_keamanan_update_policy on public.petugas_keamanan for update using (public.can_access_central_setting_db(''settings.security_patrol'')) with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy petugas_keamanan_delete_policy on public.petugas_keamanan for delete using (public.can_access_central_setting_db(''settings.security_patrol''))';
  end if;

  if to_regclass('public.titik_patroli') is not null then
    execute 'drop policy if exists titik_patroli_insert_policy on public.titik_patroli';
    execute 'drop policy if exists titik_patroli_update_policy on public.titik_patroli';
    execute 'drop policy if exists titik_patroli_delete_policy on public.titik_patroli';
    execute 'create policy titik_patroli_insert_policy on public.titik_patroli for insert with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy titik_patroli_update_policy on public.titik_patroli for update using (public.can_access_central_setting_db(''settings.security_patrol'')) with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy titik_patroli_delete_policy on public.titik_patroli for delete using (public.can_access_central_setting_db(''settings.security_patrol''))';
  end if;

  if to_regclass('public.log_patroli') is not null then
    execute 'drop policy if exists log_patroli_delete_policy on public.log_patroli';
    execute 'drop policy if exists "log_patroli_delete_admin" on public.log_patroli';
    execute 'create policy "log_patroli_delete_admin" on public.log_patroli for delete using (public.can_access_central_setting_db(''settings.security_patrol'') or public.can_access_central_setting_db(''settings.reports_audit''))';
  end if;

  if to_regclass('public.community_chat_messages') is not null then
    execute 'drop policy if exists "community_chat_delete_portal" on public.community_chat_messages';
    execute $chatpol$
      create policy "community_chat_delete_portal" on public.community_chat_messages
        for delete using (
          public.is_verified_bendahara_caller()
          or public.can_access_central_setting_db('settings.chat_moderation')
          or (
            lower(trim(public.req_header('x-user-role'))) = 'warga'
            and public.is_verified_warga_self_caller(public.req_header('x-blok-rumah'))
            and (
              lower(trim(sender_id)) = 'warga:' || lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
              or lower(trim(sender_id)) = 'warga:' || lower(public.normalize_blok_canonical(public.req_header('x-blok-rumah')))
            )
          )
          or (
            lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
            and lower(trim(sender_id)) in (
              'petugas:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g')),
              'keamanan:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g'))
            )
          )
        )
    $chatpol$;
  end if;
end $$;
