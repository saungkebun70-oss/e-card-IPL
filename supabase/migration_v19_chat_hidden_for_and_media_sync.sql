-- ============================================================================
-- MIGRASI v19: PENGHAPUSAN PER PENGGUNA (hidden_for ALA WHATSAPP GROUP)
--              & SINKRONISASI REALTIME LAMPIRAN CHAT CEPAT SAUNG KEBUN
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
--
-- Mencakup:
--   1. Memastikan seluruh kolom metadata lampiran Google Drive tersedia pada
--      public.community_chat_messages (kompatibel penuh dengan v17 & v18).
--   2. Menambahkan kolom `hidden_for jsonb NOT NULL DEFAULT '[]'::jsonb` + indeks GIN
--      untuk isolasi penghapusan pesan/gambar per pengguna ("Hapus untuk Saya").
--   3. Mengaktifkan `REPLICA IDENTITY FULL` dan memastikan tabel terdaftar di publikasi
--      `supabase_realtime` agar event INSERT/UPDATE/DELETE selalu mengirim kolom lengkap
--      (termasuk `attachment_drive_file_id`, `attachment_url`, `attachment_name`,
--      `attachment_mime`, `attachment_size_bytes`, dan `hidden_for`).
--   4. RPC aman `public.hide_chat_message_for_me(p_message_id uuid)` (SECURITY DEFINER):
--      - Memverifikasi identitas peminta & hak akses ruang chat dari header sesi.
--      - HANYA menambahkan ID kanonik peminta ke array JSONB `hidden_for`.
--      - TIDAK PERNAH menghapus baris pesan maupun berkas asli di Google Drive.
--   5. RPC aman `public.delete_chat_message_for_everyone(p_message_id uuid)`:
--      - Khusus pengirim asli pesan atau Pengurus aktif untuk opsi "Hapus untuk Semua".
-- ============================================================================

-- 1. Pastikan seluruh kolom lampiran & hidden_for tersedia pada public.community_chat_messages
alter table if exists public.community_chat_messages
  add column if not exists attachment_type text not null default 'none',
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size_bytes bigint,
  add column if not exists attachment_storage_provider text,
  add column if not exists attachment_drive_file_id text,
  add column if not exists attachment_drive_folder_path text,
  add column if not exists attachment_url text,
  add column if not exists attachment_thumbnail_url text,
  add column if not exists attachment_status text,
  add column if not exists drive_permission_scope text,
  add column if not exists drive_web_view_link text,
  add column if not exists drive_thumbnail_link text,
  add column if not exists hidden_for jsonb not null default '[]'::jsonb;

-- Backfill nilai NULL (jika kolom sudah pernah dibuat tanpa default)
update public.community_chat_messages
set hidden_for = '[]'::jsonb
where hidden_for is null or jsonb_typeof(hidden_for) <> 'array';

alter table if exists public.community_chat_messages
  alter column hidden_for set default '[]'::jsonb;

alter table if exists public.community_chat_messages
  drop constraint if exists community_chat_messages_hidden_for_array_check;

alter table if exists public.community_chat_messages
  add constraint community_chat_messages_hidden_for_array_check
  check (jsonb_typeof(hidden_for) = 'array');

create index if not exists idx_community_chat_hidden_for_gin
  on public.community_chat_messages
  using gin (hidden_for);

-- 2. Pastikan Supabase Realtime mengirimkan seluruh kolom pada INSERT/UPDATE/DELETE
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

-- 3. Helper cek hak akses ruang chat untuk peminta aktif berdasarkan request headers
create or replace function public.chat_caller_can_access_room(p_room_id text)
returns boolean
language sql
stable
as $$
  select
    case
      when p_room_id = 'forum_umum' then
        lower(trim(public.req_header('x-user-role'))) in ('admin', 'pengurus', 'bendahara', 'ketua', 'warga', 'petugas', 'keamanan')
      when p_room_id = 'pengurus_warga' then
        lower(trim(public.req_header('x-user-role'))) in ('admin', 'pengurus', 'bendahara', 'ketua', 'warga')
      when p_room_id = 'warga_keamanan' then
        lower(trim(public.req_header('x-user-role'))) in ('warga', 'petugas', 'keamanan')
      when p_room_id = 'pengurus_keamanan' then
        lower(trim(public.req_header('x-user-role'))) in ('admin', 'pengurus', 'bendahara', 'ketua', 'petugas', 'keamanan')
      when p_room_id = 'grup_pengurus' then
        lower(trim(public.req_header('x-user-role'))) in ('admin', 'pengurus', 'bendahara', 'ketua')
      when p_room_id like 'dm:%' then
        public.chat_is_dm_participant(p_room_id)
      else false
    end;
$$;

grant execute on function public.chat_caller_can_access_room(text) to anon, authenticated;

-- 4. RPC "Hapus untuk Saya" (WhatsApp Group-style):
--    Hanya menambahkan ID kanonik peminta ke array `hidden_for`.
--    TIDAK menghapus baris pesan di DB dan TIDAK menghapus berkas asli di Google Drive.
create or replace function public.hide_chat_message_for_me(
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text;
  v_row public.community_chat_messages;
  v_next_hidden jsonb;
begin
  if p_message_id is null then
    raise exception 'ID pesan tidak valid.';
  end if;

  v_caller := public.chat_caller_participant_id();
  if v_caller is null or v_caller = '' then
    raise exception 'Sesi pengguna aktif diperlukan untuk menyembunyikan pesan.';
  end if;

  select *
  into v_row
  from public.community_chat_messages
  where id = p_message_id;

  if not found then
    raise exception 'Pesan chat tidak ditemukan.';
  end if;

  if not public.chat_caller_can_access_room(v_row.room_id) then
    raise exception 'Anda tidak memiliki akses ke ruang percakapan ini.';
  end if;

  v_next_hidden := coalesce(v_row.hidden_for, '[]'::jsonb);
  if jsonb_typeof(v_next_hidden) <> 'array' then
    v_next_hidden := '[]'::jsonb;
  end if;

  if not (v_next_hidden ? v_caller) then
    v_next_hidden := v_next_hidden || to_jsonb(v_caller);
    update public.community_chat_messages
    set hidden_for = v_next_hidden
    where id = p_message_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'room_id', v_row.room_id,
    'caller_id', v_caller,
    'hidden_for', v_next_hidden
  );
end;
$$;

grant execute on function public.hide_chat_message_for_me(uuid) to anon, authenticated;

-- 5. RPC "Hapus untuk Semua":
--    Hanya boleh dijalankan oleh pengirim asli pesan atau Pengurus/Admin aktif pada ruang yang dapat diakses.
create or replace function public.delete_chat_message_for_everyone(
  p_message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_raw_blok text := lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'));
  v_raw_pet text := lower(regexp_replace(trim(coalesce(nullif(public.req_header('x-petugas-id'), ''), public.req_header('x-blok-rumah'))), '\s+', '', 'g'));
  v_caller text := public.chat_caller_participant_id();
  v_row public.community_chat_messages;
  v_sender_norm text;
  v_is_sender boolean := false;
begin
  if p_message_id is null then
    raise exception 'ID pesan tidak valid.';
  end if;

  if v_caller is null or v_caller = '' then
    raise exception 'Sesi pengguna aktif diperlukan untuk menghapus pesan.';
  end if;

  select *
  into v_row
  from public.community_chat_messages
  where id = p_message_id;

  if not found then
    return jsonb_build_object('ok', true, 'id', p_message_id, 'already_deleted', true);
  end if;

  if not public.chat_caller_can_access_room(v_row.room_id) then
    raise exception 'Anda tidak memiliki akses ke ruang percakapan ini.';
  end if;

  v_sender_norm := lower(trim(coalesce(v_row.sender_id, '')));
  if v_sender_norm = v_caller then
    v_is_sender := true;
  elsif v_role in ('admin', 'pengurus', 'bendahara', 'ketua') then
    if v_raw_blok in ('admin', 'andriansyah') and v_sender_norm in ('admin:admin', 'admin:andriansyah', 'pengurus:andriansyah') then
      v_is_sender := true;
    elsif v_raw_blok in ('paiwan', 'bpiwan') and v_sender_norm in ('admin:paiwan', 'admin:bpiwan', 'pengurus:bpiwan') then
      v_is_sender := true;
    elsif v_sender_norm = ('pengurus:' || v_raw_blok) then
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

  if not (v_is_sender or v_role in ('admin', 'pengurus', 'bendahara', 'ketua')) then
    raise exception 'Hanya pengirim pesan atau Pengurus yang dapat menghapus pesan untuk semua peserta.';
  end if;

  delete from public.community_chat_messages where id = p_message_id;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'room_id', v_row.room_id,
    'deleted_for_everyone', true
  );
end;
$$;

grant execute on function public.delete_chat_message_for_everyone(uuid) to anon, authenticated;
