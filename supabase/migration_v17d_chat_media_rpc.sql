-- ============================================================================
-- MIGRASI v17 — BAGIAN 17D: GUARDRAIL VIDEO & RPC PEMBARUAN METADATA LAMPIRAN
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
-- Jalankan setelah Bagian 17A–17C.
-- ============================================================================

-- 1. Pastikan video tidak pernah boleh tercatat menggunakan provider `supabase_transit`
alter table if exists public.community_chat_messages
  drop constraint if exists community_chat_messages_no_video_transit_check;

alter table if exists public.community_chat_messages
  add constraint community_chat_messages_no_video_transit_check
  check (
    not (
      attachment_type = 'video'
      and attachment_storage_provider = 'supabase_transit'
    )
  );

-- 2. RPC aman untuk memperbarui metadata lampiran pesan chat (dipanggil backend / Edge Function service_role)
create or replace function public.update_chat_message_attachment(
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
  p_attachment_status text
)
returns public.community_chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.community_chat_messages;
begin
  if p_attachment_type = 'video' and p_attachment_storage_provider = 'supabase_transit' then
    raise exception 'Video dilarang keras transit di Supabase Storage.' using errcode = '22023';
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
    attachment_status = coalesce(nullif(trim(p_attachment_status), ''), 'ready')
  where id = p_message_id
  returning * into v_row;

  if not found then
    raise exception 'Pesan chat % tidak ditemukan.', p_message_id using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

grant execute on function public.update_chat_message_attachment(
  uuid, text, text, text, bigint, text, text, text, text, text, text
) to service_role;
