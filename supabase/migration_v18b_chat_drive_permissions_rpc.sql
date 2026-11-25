-- ============================================================================
-- MIGRASI v18 — BAGIAN 18B: RPC PEMBARUAN METADATA & IZIN DRIVE V2
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
-- Jalankan setelah Bagian 18A.
-- ============================================================================

create or replace function public.update_chat_message_attachment_v2(
  p_message_id uuid,
  p_attachment_type text,
  p_attachment_name text,
  p_attachment_mime text,
  p_attachment_size_bytes bigint,
  p_attachment_storage_provider text,
  p_attachment_drive_file_id text,
  p_attachment_drive_folder_path text,
  p_attachment_url text,
  p_attachment_thumbnail_url text,
  p_attachment_status text,
  p_drive_permission_scope text default null,
  p_drive_web_view_link text default null,
  p_drive_thumbnail_link text default null
)
returns public.community_chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.community_chat_messages;
  v_room_id text;
  v_effective_scope text;
begin
  if p_attachment_type = 'video' and p_attachment_storage_provider = 'supabase_transit' then
    raise exception 'Video dilarang keras transit di Supabase Storage.' using errcode = '22023';
  end if;

  select room_id into v_room_id
  from public.community_chat_messages
  where id = p_message_id;

  if not found then
    raise exception 'Pesan chat % tidak ditemukan.', p_message_id using errcode = 'P0002';
  end if;

  if v_room_id = 'grup_pengurus' or v_room_id like 'dm:%' then
    if lower(coalesce(trim(p_drive_permission_scope), '')) = 'anyone_link' then
      raise exception 'Ruang privat (Grup Pengurus / DM Personal) dilarang menggunakan izin anyone_link.'
        using errcode = '22023';
    end if;
    v_effective_scope := 'restricted_private';
  else
    v_effective_scope := coalesce(nullif(trim(p_drive_permission_scope), ''), 'anyone_link');
  end if;

  update public.community_chat_messages
  set
    attachment_type = coalesce(nullif(trim(p_attachment_type), ''), 'none'),
    attachment_name = p_attachment_name,
    attachment_mime = p_attachment_mime,
    attachment_size_bytes = p_attachment_size_bytes,
    attachment_storage_provider = p_attachment_storage_provider,
    attachment_drive_file_id = p_attachment_drive_file_id,
    attachment_drive_folder_path = p_attachment_drive_folder_path,
    attachment_url = p_attachment_url,
    attachment_thumbnail_url = p_attachment_thumbnail_url,
    attachment_status = coalesce(nullif(trim(p_attachment_status), ''), 'ready'),
    drive_permission_scope = v_effective_scope,
    drive_web_view_link = p_drive_web_view_link,
    drive_thumbnail_link = p_drive_thumbnail_link
  where id = p_message_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.update_chat_message_attachment_v2(
  uuid, text, text, text, bigint, text, text, text, text, text, text, text, text, text
) to service_role;
