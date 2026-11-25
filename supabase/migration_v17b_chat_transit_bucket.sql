-- ============================================================================
-- MIGRASI v17 — BAGIAN 17B: BUCKET TRANSIT NON-VIDEO `chat-transit`
-- Perumahan Saung Kebun — Idempotent (aman dijalankan ulang di Supabase SQL Editor)
--
-- ATURAN KETAT:
--   - Bucket `chat-transit` BERSIFAT PRIVAT (public = false) dan HANYA untuk
--     transit sementara Foto, Kamera, & Dokumen non-video (maks 20 MB).
--   - SEMUA VIDEO (video/*) DILARANG KERAS masuk ke bucket ini dan otomatis
--     ditolak di level Storage bucket maupun backend.
-- ============================================================================

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'chat-transit',
  'chat-transit',
  false,
  20971520, -- 20 MB untuk foto/dokumen sementara sebelum dipindah ke Google Drive
  array[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
