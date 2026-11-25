-- ============================================================================
-- MIGRASI v17 — BAGIAN 17C: KEBIJAKAN RLS BUCKET `chat-transit`
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
-- Jalankan setelah Bagian 17B.
-- ============================================================================

create or replace function public.req_header(header_name text) returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json->>lower(header_name),
    ''
  );
$$;

-- Izinkan upload sementara ke `chat-transit` hanya untuk pengguna portal tervalidasi
-- dengan prefiks path sesuai peran/identitas dan melarang ekstensi video.
drop policy if exists "chat_transit_insert_portal" on storage.objects;
create policy "chat_transit_insert_portal" on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'chat-transit'
    and lower(trim(public.req_header('x-user-role'))) in ('admin', 'warga', 'petugas', 'keamanan')
    and lower(name) !~ '\.(mp4|mov|mkv|avi|webm|3gp|m4v)$'
    and (
      (
        lower(trim(public.req_header('x-user-role'))) = 'admin'
        and name like 'admin/%'
      )
      or (
        lower(trim(public.req_header('x-user-role'))) = 'warga'
        and name like 'warga/%'
      )
      or (
        lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
        and name like 'petugas/%'
      )
    )
  );

-- Pengunggah hanya dapat membaca objek transit miliknya (service_role tetap punya akses penuh untuk transfer & hapus).
drop policy if exists "chat_transit_select_portal" on storage.objects;
create policy "chat_transit_select_portal" on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'chat-transit'
    and (
      lower(trim(public.req_header('x-user-role'))) = 'admin'
      or (
        lower(trim(public.req_header('x-user-role'))) = 'warga'
        and name like 'warga/%'
      )
      or (
        lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
        and name like 'petugas/%'
      )
    )
  );

-- Hapus objek transit: diizinkan untuk admin/service_role atau pengirim pada prefiks perannya.
drop policy if exists "chat_transit_delete_portal" on storage.objects;
create policy "chat_transit_delete_portal" on storage.objects
  for delete
  to anon, authenticated
  using (
    bucket_id = 'chat-transit'
    and (
      lower(trim(public.req_header('x-user-role'))) = 'admin'
      or (
        lower(trim(public.req_header('x-user-role'))) = 'warga'
        and name like 'warga/%'
      )
      or (
        lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
        and name like 'petugas/%'
      )
    )
  );
