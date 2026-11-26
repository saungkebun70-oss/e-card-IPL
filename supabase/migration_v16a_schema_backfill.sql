-- ============================================================================
-- MIGRASI V16 - BAGIAN 16A: EKSTENSI, HELPER NORMALISASI, KOLOM users_warga,
-- INDEX & BACKFILL AWAL EKSKLUSIVITAS PENGURUS VS WARGA
-- Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Helper pembaca header & normalisasi
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

-- 2. Penambahan kolom eksklusivitas Pengurus vs Warga pada public.users_warga
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

-- 3. Index pendukung pencarian eksklusivitas
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

-- 4. Backfill & sinkronisasi awal data (aman dijalankan ulang walau trigger 16C sudah aktif)
do $$
begin
  perform set_config('app.bypass_privilege_guard', '1', true);
  perform set_config('app.bypass_sync_propagation', '1', true);

  -- Pemetaan resmi Pengurus -> Blok Rumah Warga Saung Kebun
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

  -- Pemetaan balik Blok Rumah Warga -> Username Pengurus
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

  -- Sinkronkan status awal akun Pengurus (Bendahara = full, lainnya = add_only)
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

  -- Tangguhkan sementara akun Warga/Blok milik Pengurus yang sedang aktif
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
end $$;
