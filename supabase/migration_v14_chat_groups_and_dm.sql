-- ============================================================================
-- MIGRASI v14: GRUP PENGURUS, GRUP KOORDINASI & CHAT PERSONAL / INDIVIDU (DM)
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
--
-- Mencakup:
--   1. Perluasan ruang chat pada public.community_chat_messages:
--      - `grup_pengurus`     : Grup Internal Khusus Pengurus / Admin
--      - `pengurus_keamanan` : Grup Pengurus & Keamanan
--      - `pengurus_warga`    : Grup Pengurus & Warga
--      - `warga_keamanan`    : Grup Warga & Keamanan
--      - `forum_umum`        : Forum Lingkungan (Pengurus, Warga & Keamanan)
--      - `dm:<id1>__<id2>`   : Chat Personal / Individu (Direct Message 1-on-1)
--   2. Kolom opsional recipient_id, recipient_name, recipient_role untuk DM.
--   3. Helper SQL kanonik + RLS ketat sehingga pesan DM hanya dapat dibaca
--      dan dikirim oleh kedua peserta percakapan terkait, dan `grup_pengurus`
--      hanya dapat diakses oleh Pengurus (role = 'admin').
--   4. RPC aman `public.get_chat_directory()` untuk daftar kontak chat
--      (tanpa mengekspos PIN ataupun nomor WA sensitif).
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Helper normalisasi kode blok kanonik agar B03/07 & B3/7 identik
create or replace function public.chat_canonical_blok(raw_blok text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      lower(regexp_replace(coalesce(trim(raw_blok), ''), '\s+', '', 'g')),
      '^([a-z]+)0+(\d+)',
      '\1\2'
    ),
    '/0+(\d+)',
    '/\1'
  );
$$;

grant execute on function public.chat_canonical_blok(text) to anon, authenticated;

-- 2. Helper ID kanonik peserta chat berdasarkan request headers
create or replace function public.chat_caller_participant_id()
returns text
language sql
stable
as $$
  select case
    when lower(trim(public.req_header('x-user-role'))) = 'admin' then
      case
        when lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g')) in ('admin', 'andriansyah')
          then 'admin:andriansyah'
        when lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g')) in ('paiwan', 'bpiwan')
          then 'admin:bpiwan'
        else 'admin:' || lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
      end
    when lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan') then
      'petugas:' || lower(regexp_replace(trim(coalesce(nullif(public.req_header('x-petugas-id'), ''), public.req_header('x-blok-rumah'))), '\s+', '', 'g'))
    when lower(trim(public.req_header('x-user-role'))) = 'warga' then
      'warga:' || public.chat_canonical_blok(public.req_header('x-blok-rumah'))
    else ''
  end;
$$;

grant execute on function public.chat_caller_participant_id() to anon, authenticated;

-- 3. Helper cek apakah caller merupakan salah satu dari 2 peserta DM `dm:<id1>__<id2>`
create or replace function public.chat_is_dm_participant(p_room_id text)
returns boolean
language plpgsql
stable
as $$
declare
  v_caller text := public.chat_caller_participant_id();
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_raw_blok text := lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'));
  v_body text;
  v_part1 text;
  v_part2 text;
begin
  if v_caller = '' or p_room_id is null or p_room_id not like 'dm:%' then
    return false;
  end if;

  v_body := substr(p_room_id, 4);
  if position('__' in v_body) = 0 then
    return false;
  end if;

  v_part1 := split_part(v_body, '__', 1);
  v_part2 := split_part(v_body, '__', 2);

  if v_part1 = v_caller or v_part2 = v_caller then
    return true;
  end if;

  -- Kompatibilitas alias admin:admin <-> admin:andriansyah serta admin:paiwan <-> admin:bpiwan
  if v_role = 'admin' and v_raw_blok in ('admin', 'andriansyah') then
    if v_part1 in ('admin:admin', 'admin:andriansyah') or v_part2 in ('admin:admin', 'admin:andriansyah') then
      return true;
    end if;
  end if;

  if v_role = 'admin' and v_raw_blok in ('paiwan', 'bpiwan') then
    if v_part1 in ('admin:paiwan', 'admin:bpiwan') or v_part2 in ('admin:paiwan', 'admin:bpiwan') then
      return true;
    end if;
  end if;

  if v_role = 'warga' and v_raw_blok <> '' then
    if v_part1 = ('warga:' || v_raw_blok) or v_part2 = ('warga:' || v_raw_blok) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

grant execute on function public.chat_is_dm_participant(text) to anon, authenticated;

-- 4. Perbarui struktur & constraint tabel public.community_chat_messages
alter table public.community_chat_messages
  add column if not exists recipient_id text,
  add column if not exists recipient_name text,
  add column if not exists recipient_role text;

alter table public.community_chat_messages
  drop constraint if exists community_chat_messages_room_id_check;

alter table public.community_chat_messages
  add constraint community_chat_messages_room_id_check check (
    room_id in (
      'forum_umum',
      'grup_pengurus',
      'pengurus_warga',
      'pengurus_keamanan',
      'warga_keamanan'
    )
    or (room_id like 'dm:%' and position('__' in substr(room_id, 4)) > 1)
  );

create index if not exists idx_community_chat_recipient
  on public.community_chat_messages (recipient_id)
  where recipient_id is not null;

-- 5. Kebijakan RLS terbaru (Keanggotaan Grup Ketat Sesuai Peran, DM eksklusif 2 peserta)
drop policy if exists "community_chat_select_portal" on public.community_chat_messages;
create policy "community_chat_select_portal" on public.community_chat_messages
  for select using (
    (
      room_id = 'forum_umum'
      and lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
    )
    or (
      room_id = 'pengurus_warga'
      and lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga')
    )
    or (
      room_id = 'warga_keamanan'
      and lower(trim(public.req_header('x-user-role'))) in ('warga', 'petugas', 'keamanan')
    )
    or (
      room_id = 'pengurus_keamanan'
      and lower(trim(public.req_header('x-user-role'))) in ('admin', 'petugas', 'keamanan')
    )
    or (
      room_id = 'grup_pengurus'
      and lower(trim(public.req_header('x-user-role'))) = 'admin'
    )
    or (
      room_id like 'dm:%'
      and public.chat_is_dm_participant(room_id)
    )
  );

drop policy if exists "community_chat_insert_portal" on public.community_chat_messages;
create policy "community_chat_insert_portal" on public.community_chat_messages
  for insert with check (
    (
      lower(trim(public.req_header('x-user-role'))) = 'admin'
      and sender_role = 'admin'
      and (
        room_id in ('forum_umum', 'grup_pengurus', 'pengurus_warga', 'pengurus_keamanan')
        or (room_id like 'dm:%' and public.chat_is_dm_participant(room_id))
      )
    )
    or (
      lower(trim(public.req_header('x-user-role'))) = 'warga'
      and sender_role = 'warga'
      and (
        room_id in ('forum_umum', 'pengurus_warga', 'warga_keamanan')
        or (room_id like 'dm:%' and public.chat_is_dm_participant(room_id))
      )
    )
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and sender_role in ('petugas', 'keamanan')
      and (
        room_id in ('forum_umum', 'pengurus_keamanan', 'warga_keamanan')
        or (room_id like 'dm:%' and public.chat_is_dm_participant(room_id))
      )
    )
  );

drop policy if exists "community_chat_delete_portal" on public.community_chat_messages;
create policy "community_chat_delete_portal" on public.community_chat_messages
  for delete using (
    lower(trim(public.req_header('x-user-role'))) = 'admin'
    or (
      lower(trim(public.req_header('x-user-role'))) = 'warga'
      and (
        lower(trim(sender_id)) = 'warga:' || lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
        or lower(trim(sender_id)) = 'warga:' || public.chat_canonical_blok(public.req_header('x-blok-rumah'))
      )
    )
    or (
      lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
      and lower(trim(sender_id)) in (
        'petugas:' || lower(regexp_replace(trim(coalesce(nullif(public.req_header('x-petugas-id'), ''), public.req_header('x-blok-rumah'))), '\s+', '', 'g')),
        'keamanan:' || lower(regexp_replace(trim(coalesce(nullif(public.req_header('x-petugas-id'), ''), public.req_header('x-blok-rumah'))), '\s+', '', 'g'))
      )
    )
  );

-- 6. RPC aman direktori kontak chat (hanya nama, peran & blok/jabatan — TANPA PIN / WA, bebas duplikat)
create or replace function public.get_chat_directory()
returns table (
  participant_id text,
  role text,
  display_name text,
  subtitle text,
  blok_or_code text
)
language sql
security definer
set search_path = public
as $$
  with admin_dedup as (
    -- Akun Pengurus / Admin aktif (dideduplikasi & dipetakan ke Blok Rumah masing-masing)
    select distinct on (pid)
      pid as participant_id,
      'admin'::text as role,
      display_name,
      subtitle,
      blok_or_code
    from (
      select
        case
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) in ('admin', 'andriansyah') then 'admin:andriansyah'
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) in ('paiwan', 'bpiwan') then 'admin:bpiwan'
          else 'admin:' || lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g'))
        end as pid,
        case
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = 'admin' then 'Andriansyah'
          else u.nama_warga
        end as display_name,
        coalesce(nullif(trim(u.jabatan), ''), 'Pengurus') as subtitle,
        case
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) in ('admin', 'andriansyah') then 'B7/16'
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) in ('paiwan', 'bpiwan') then 'B8/5'
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = 'erlangga' then 'B3/7'
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = 'doni' then 'B5/21'
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = 'wahyu' then 'B5/24'
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) = 'deny' then 'B8/6'
          else u.blok_rumah
        end as blok_or_code,
        case
          when lower(regexp_replace(trim(u.blok_rumah), '\s+', '', 'g')) in ('andriansyah', 'bpiwan') then 0
          else 1
        end as pref_rank
      from public.users_warga u
      where u.aktif = true
        and u.role in ('admin', 'bendahara')
    ) admin_rows
    order by pid, pref_rank asc
  ),
  petugas_dedup as (
    -- Akun Petugas Keamanan aktif (dideduplikasi berdasarkan nama)
    select distinct on (lower(trim(p.nama)))
      'petugas:' || lower(regexp_replace(trim(p.id::text), '\s+', '', 'g')) as participant_id,
      'petugas'::text as role,
      p.nama as display_name,
      coalesce(nullif(trim(p.shift), ''), 'Petugas Keamanan') as subtitle,
      coalesce(nullif(trim(p.username), ''), 'Keamanan') as blok_or_code
    from public.petugas_keamanan p
    where p.aktif = true
    order by lower(trim(p.nama)), p.created_at asc
  ),
  warga_dedup as (
    -- Akun Warga aktif (dihuni, dideduplikasi berdasarkan blok kanonik)
    select distinct on (public.chat_canonical_blok(w.blok_rumah))
      'warga:' || public.chat_canonical_blok(w.blok_rumah) as participant_id,
      'warga'::text as role,
      w.nama_warga as display_name,
      'Warga · Blok ' || upper(public.chat_canonical_blok(w.blok_rumah)) as subtitle,
      upper(public.chat_canonical_blok(w.blok_rumah)) as blok_or_code
    from public.users_warga w
    where w.aktif = true
      and coalesce(w.role, 'warga') = 'warga'
      and lower(coalesce(w.status_hunian, 'Tetap')) <> 'kosong'
    order by public.chat_canonical_blok(w.blok_rumah), w.created_at desc
  )
  select participant_id, role, display_name, subtitle, blok_or_code from admin_dedup
  union all
  select participant_id, role, display_name, subtitle, blok_or_code from petugas_dedup
  union all
  select participant_id, role, display_name, subtitle, blok_or_code from warga_dedup;
$$;

grant execute on function public.get_chat_directory() to anon, authenticated;
