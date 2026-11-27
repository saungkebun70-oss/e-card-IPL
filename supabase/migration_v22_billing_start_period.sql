-- ============================================================================
-- Migration v22: Pengaturan Bulan & Tahun Mulai Penagihan Aktif (Pra-Rilis)
-- ============================================================================
-- Menambahkan kolom `billing_start_month` dan `billing_start_year` pada tabel
-- `public.app_settings` agar bulan sebelum mulai aplikasi rilis otomatis
-- diperlakukan sebagai periode Pra-Rilis (Belum Berlaku) dan tidak dihitung
-- sebagai tunggakan pada dasbor, matriks 12 bulan, LPJ, maupun Bot WhatsApp.
-- ============================================================================

alter table public.app_settings
  add column if not exists billing_start_month integer not null default 11;

alter table public.app_settings
  add column if not exists billing_start_year integer not null default 2026;

alter table public.app_settings
  drop constraint if exists app_settings_billing_start_month_check;

alter table public.app_settings
  add constraint app_settings_billing_start_month_check
  check (billing_start_month between 1 and 12);

alter table public.app_settings
  drop constraint if exists app_settings_billing_start_year_check;

alter table public.app_settings
  add constraint app_settings_billing_start_year_check
  check (billing_start_year between 2024 and 2100);

update public.app_settings
set
  billing_start_month = coalesce(billing_start_month, 11),
  billing_start_year = coalesce(billing_start_year, 2026)
where id = 'default-app-brand';
