-- ============================================================================
-- MIGRATION V15: MONITOR PENYIMPANAN BACKEND & MODE HYBRID GOOGLE DRIVE
-- Perumahan Saung Kebun — Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- Target Drive Pusat: saungkebun70@gmail.com
-- ============================================================================

-- 1. Pastikan helper pembaca header tersedia
create or replace function public.req_header(header_name text) returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.headers', true), '')::json->>lower(header_name),
    ''
  );
$$;

-- 2. Pastikan kolom konfigurasi hybrid drive tersedia di app_settings
alter table if exists public.app_settings
  add column if not exists hybrid_drive_config jsonb not null default '{}'::jsonb;

-- 3. Pastikan Admin dapat menghapus salinan media lama di Supabase Storage
--    setelah media berhasil diarsipkan ke Google Drive saungkebun70@gmail.com
drop policy if exists "hybrid_storage_admin_delete" on storage.objects;
create policy "hybrid_storage_admin_delete" on storage.objects
  for delete using (
    bucket_id in ('bukti-ipl', 'bug-reports', 'avatars')
    and lower(trim(public.req_header('x-user-role'))) = 'admin'
  );

-- 4. Fungsi RPC Pemantau Status Penyimpanan Supabase (Storage Objects + Database Size)
--    Dipanggil oleh backend server/API untuk mendeteksi kapan media baru
--    perlu diarahkan otomatis ke Google Drive OAuth2.
create or replace function public.get_supabase_storage_status()
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_role text := lower(trim(public.req_header('x-user-role')));
  v_has_headers text := nullif(current_setting('request.headers', true), '');
  v_total_objects bigint := 0;
  v_storage_bytes bigint := 0;
  v_db_bytes bigint := 0;
  v_buckets jsonb := '[]'::jsonb;
begin
  -- Batasi akses hanya untuk pengguna portal terautentikasi atau service_role server
  if v_has_headers is not null and v_role not in ('admin', 'warga', 'petugas', 'keamanan') then
    if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
      raise exception 'Akses status penyimpanan hanya untuk pengguna portal atau layanan backend.'
        using errcode = '42501';
    end if;
  end if;

  select
    count(*)::bigint,
    coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint
  into v_total_objects, v_storage_bytes
  from storage.objects o;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bucket', sub.bucket_id,
        'fileCount', sub.file_count,
        'usedBytes', sub.used_bytes
      )
      order by sub.used_bytes desc, sub.bucket_id asc
    ),
    '[]'::jsonb
  )
  into v_buckets
  from (
    select
      o.bucket_id,
      count(*)::bigint as file_count,
      coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint as used_bytes
    from storage.objects o
    group by o.bucket_id
  ) sub;

  select pg_database_size(current_database())::bigint into v_db_bytes;

  return jsonb_build_object(
    'total_objects', v_total_objects,
    'storage_used_bytes', v_storage_bytes,
    'db_used_bytes', v_db_bytes,
    'buckets', v_buckets,
    'measured_at', now()
  );
end;
$$;

grant execute on function public.get_supabase_storage_status() to anon, authenticated, service_role;
