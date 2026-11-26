-- ============================================================================
-- MIGRASI v20: FITUR EDIT PESAN CHAT & TRANSPARANSI RIWAYAT PERUBAHAN
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
--
-- Mencakup:
--   1. Menambahkan kolom `is_edited` (boolean NOT NULL DEFAULT false),
--      `original_content` (text), dan `edited_at` (timestamptz) pada tabel
--      `public.community_chat_messages`.
--   2. Memastikan `REPLICA IDENTITY FULL` & publikasi `supabase_realtime` aktif
--      agar pembaruan pesan langsung tersinkron ke seluruh anggota grup & DM.
--   3. RPC aman `public.edit_chat_message(p_message_id uuid, p_new_message text)`:
--      - Hanya mengizinkan pengirim asli pesan untuk mengedit pesannya sendiri.
--      - Menyimpan isi pesan asli pertama kali ke `original_content` dan tidak
--        menimpanya saat pengeditan ulang demi transparansi penuh di dalam grup.
-- ============================================================================

-- 1. Tambahkan kolom riwayat edit pada public.community_chat_messages
alter table if exists public.community_chat_messages
  add column if not exists is_edited boolean not null default false,
  add column if not exists original_content text,
  add column if not exists edited_at timestamptz;

update public.community_chat_messages
set is_edited = false
where is_edited is null;

alter table if exists public.community_chat_messages
  alter column is_edited set default false;

create index if not exists idx_community_chat_is_edited
  on public.community_chat_messages (room_id, is_edited)
  where is_edited = true;

-- 2. Pastikan Supabase Realtime mengirimkan payload lengkap saat UPDATE
alter table if exists public.community_chat_messages replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'community_chat_messages'
    ) then
      alter publication supabase_realtime add table public.community_chat_messages;
    end if;
  end if;
end $$;

-- 3. RPC aman untuk mengedit pesan milik sendiri & menjaga `original_content`
create or replace function public.edit_chat_message(
  p_message_id uuid,
  p_new_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text := trim(coalesce(p_new_message, ''));
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_raw_blok text := lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'));
  v_raw_pet text := lower(regexp_replace(trim(coalesce(nullif(public.req_header('x-petugas-id'), ''), public.req_header('x-blok-rumah'))), '\s+', '', 'g'));
  v_caller text := public.chat_caller_participant_id();
  v_row public.community_chat_messages;
  v_updated public.community_chat_messages;
  v_sender_norm text;
  v_is_sender boolean := false;
  v_original text;
begin
  if p_message_id is null then
    raise exception 'ID pesan tidak valid.' using errcode = '22023';
  end if;

  if char_length(v_clean) < 1 or char_length(v_clean) > 1000 then
    raise exception 'Isi pesan edit harus antara 1 hingga 1000 karakter.' using errcode = '22023';
  end if;

  if v_caller is null or v_caller = '' then
    raise exception 'Sesi pengguna aktif diperlukan untuk mengedit pesan.' using errcode = '42501';
  end if;

  select *
  into v_row
  from public.community_chat_messages
  where id = p_message_id;

  if not found then
    raise exception 'Pesan chat tidak ditemukan.' using errcode = 'P0002';
  end if;

  if not public.chat_caller_can_access_room(v_row.room_id) then
    raise exception 'Anda tidak memiliki akses ke ruang percakapan ini.' using errcode = '42501';
  end if;

  v_sender_norm := lower(trim(coalesce(v_row.sender_id, '')));
  if v_sender_norm = v_caller then
    v_is_sender := true;
  elsif v_role in ('admin', 'pengurus', 'bendahara', 'ketua') then
    if v_raw_blok in ('admin', 'andriansyah') and v_sender_norm in ('admin:admin', 'admin:andriansyah', 'pengurus:andriansyah') then
      v_is_sender := true;
    elsif v_raw_blok in ('paiwan', 'bpiwan') and v_sender_norm in ('admin:paiwan', 'admin:bpiwan', 'pengurus:bpiwan') then
      v_is_sender := true;
    elsif v_sender_norm in ('admin:' || v_raw_blok, 'pengurus:' || v_raw_blok) then
      v_is_sender := true;
    end if;
  elsif v_role = 'warga' then
    if v_sender_norm in ('warga:' || v_raw_blok, 'warga:' || public.chat_canonical_blok(v_raw_blok)) then
      v_is_sender := true;
    end if;
  elsif v_role in ('petugas', 'keamanan') then
    if v_sender_norm in ('petugas:' || v_raw_pet, 'keamanan:' || v_raw_pet) then
      v_is_sender := true;
    end if;
  end if;

  if not v_is_sender then
    raise exception 'Hanya pengirim asli yang dapat mengedit pesan ini.' using errcode = '42501';
  end if;

  if v_clean = v_row.message then
    return jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'id', v_row.id,
      'room_id', v_row.room_id,
      'message', v_row.message,
      'is_edited', coalesce(v_row.is_edited, false),
      'original_content', v_row.original_content,
      'edited_at', v_row.edited_at
    );
  end if;

  -- Pertahankan isi pesan asli pertama kali sebelum diedit demi transparansi grup
  v_original := case
    when coalesce(v_row.is_edited, false) = true
      and v_row.original_content is not null
      and length(v_row.original_content) > 0
    then v_row.original_content
    else v_row.message
  end;

  update public.community_chat_messages
  set
    message = v_clean,
    is_edited = true,
    original_content = v_original,
    edited_at = now()
  where id = p_message_id
  returning * into v_updated;

  return jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'id', v_updated.id,
    'room_id', v_updated.room_id,
    'message', v_updated.message,
    'is_edited', v_updated.is_edited,
    'original_content', v_updated.original_content,
    'edited_at', v_updated.edited_at
  );
end;
$$;

grant execute on function public.edit_chat_message(uuid, text) to anon, authenticated;
