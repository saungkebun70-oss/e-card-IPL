-- ============================================================================
-- MIGRASI V16 - BAGIAN 16D: PENGAKTIFAN RLS, GRANT & KEBIJAKAN RLS LENGKAP
-- (AMAN DENGAN PENGECEKAN to_regclass AGAR TIDAK ERROR 42P01 JIKA TABEL BELUM ADA)
-- Prasyarat: Bagian 16A, 16B & 16C sudah dijalankan
-- Idempotent & aman dijalankan ulang di Supabase SQL Editor
-- ============================================================================

-- 1. pengurus_settings_permissions (dibuat di Bagian 16B)
alter table public.pengurus_settings_permissions enable row level security;
grant select, insert, update, delete on public.pengurus_settings_permissions to anon, authenticated;

drop policy if exists "psp_select_verified_pengurus" on public.pengurus_settings_permissions;
create policy "psp_select_verified_pengurus" on public.pengurus_settings_permissions
  for select using (
    public.is_verified_bendahara_caller()
    or (
      public.is_verified_active_pengurus_caller()
      and pengurus_username = public.normalize_pengurus_username(public.req_header('x-blok-rumah'))
    )
  );

drop policy if exists "psp_insert_bendahara_only" on public.pengurus_settings_permissions;
create policy "psp_insert_bendahara_only" on public.pengurus_settings_permissions
  for insert with check (public.is_verified_bendahara_caller());

drop policy if exists "psp_update_bendahara_only" on public.pengurus_settings_permissions;
create policy "psp_update_bendahara_only" on public.pengurus_settings_permissions
  for update
  using (public.is_verified_bendahara_caller())
  with check (public.is_verified_bendahara_caller());

drop policy if exists "psp_delete_bendahara_only" on public.pengurus_settings_permissions;
create policy "psp_delete_bendahara_only" on public.pengurus_settings_permissions
  for delete using (public.is_verified_bendahara_caller());

-- 2. users_warga (diperbarui di Bagian 16A)
alter table public.users_warga enable row level security;

drop policy if exists "warga_hanya_lihat_rumah_sendiri" on public.users_warga;
create policy "warga_hanya_lihat_rumah_sendiri" on public.users_warga
  for select using (
    public.is_verified_active_pengurus_caller()
    or public.is_verified_warga_self_caller(blok_rumah)
  );

drop policy if exists "admin_tambah_warga" on public.users_warga;
create policy "admin_tambah_warga" on public.users_warga
  for insert with check (
    public.can_access_central_setting_db('settings.residents_blocks')
  );

drop policy if exists "bendahara_edit_warga" on public.users_warga;
create policy "bendahara_edit_warga" on public.users_warga
  for update
  using (
    public.can_access_central_setting_db('settings.residents_blocks')
    or (
      public.is_verified_active_pengurus_caller()
      and public.normalize_pengurus_username(blok_rumah) = public.normalize_pengurus_username(public.req_header('x-blok-rumah'))
    )
    or public.is_verified_warga_self_caller(blok_rumah)
  )
  with check (
    public.can_access_central_setting_db('settings.residents_blocks')
    or (
      public.is_verified_active_pengurus_caller()
      and public.normalize_pengurus_username(blok_rumah) = public.normalize_pengurus_username(public.req_header('x-blok-rumah'))
    )
    or public.is_verified_warga_self_caller(blok_rumah)
  );

drop policy if exists "bendahara_hapus_warga" on public.users_warga;
create policy "bendahara_hapus_warga" on public.users_warga
  for delete using (
    public.is_verified_bendahara_caller()
    or public.can_access_central_setting_db('settings.residents_blocks')
  );

-- 3. Tabel inti & opsional lain (dicek dengan to_regclass agar bebas error 42P01)
do $$
begin
  -- payment_config
  if to_regclass('public.payment_config') is not null then
    execute 'alter table public.payment_config enable row level security';
    execute 'drop policy if exists "bendahara_payment_config_write" on public.payment_config';
    execute $sql$
      create policy "bendahara_payment_config_write" on public.payment_config
        for all
        using (public.can_access_central_setting_db('settings.ipl_billing'))
        with check (public.can_access_central_setting_db('settings.ipl_billing'))
    $sql$;
  end if;

  -- app_settings
  if to_regclass('public.app_settings') is not null then
    execute 'alter table public.app_settings enable row level security';
    execute 'drop policy if exists "bendahara_app_settings_write" on public.app_settings';
    execute $sql$
      create policy "bendahara_app_settings_write" on public.app_settings
        for all
        using (
          public.is_verified_bendahara_caller()
          or public.can_access_central_setting_db('settings.system_integrations')
        )
        with check (
          public.is_verified_bendahara_caller()
          or public.can_access_central_setting_db('settings.system_integrations')
        )
    $sql$;

    execute 'drop policy if exists "app_settings_patrol_update_policy" on public.app_settings';
    execute $sql$
      create policy "app_settings_patrol_update_policy" on public.app_settings
        for update
        using (
          public.can_access_central_setting_db('settings.security_patrol')
          or (
            lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
            and nullif(trim(public.req_header('x-petugas-id')), '') is not null
          )
        )
        with check (
          public.can_access_central_setting_db('settings.security_patrol')
          or (
            lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
            and nullif(trim(public.req_header('x-petugas-id')), '') is not null
          )
        )
    $sql$;
  end if;

  -- bot_wa_config
  if to_regclass('public.bot_wa_config') is not null then
    execute 'alter table public.bot_wa_config enable row level security';
    execute 'drop policy if exists "admin_bot_config_select" on public.bot_wa_config';
    execute $sql$
      create policy "admin_bot_config_select" on public.bot_wa_config
        for select using (public.is_verified_active_pengurus_caller())
    $sql$;

    execute 'drop policy if exists "bendahara_bot_config_write" on public.bot_wa_config';
    execute $sql$
      create policy "bendahara_bot_config_write" on public.bot_wa_config
        for all
        using (public.can_access_central_setting_db('settings.system_integrations'))
        with check (public.can_access_central_setting_db('settings.system_integrations'))
    $sql$;
  end if;

  -- system_notifications (opsional jika belum dibuat dari schema.sql)
  if to_regclass('public.system_notifications') is not null then
    execute 'alter table public.system_notifications enable row level security';
    execute 'drop policy if exists "admin_kirim_notifikasi" on public.system_notifications';
    execute $sql$
      create policy "admin_kirim_notifikasi" on public.system_notifications
        for insert with check (public.is_verified_active_pengurus_caller())
    $sql$;

    execute 'drop policy if exists "bendahara_hapus_notifikasi" on public.system_notifications';
    execute $sql$
      create policy "bendahara_hapus_notifikasi" on public.system_notifications
        for delete using (
          public.is_verified_bendahara_caller()
          or public.can_access_central_setting_db('settings.system_integrations')
        )
    $sql$;
  end if;

  -- audit_logs
  if to_regclass('public.audit_logs') is not null then
    execute 'alter table public.audit_logs enable row level security';
    execute 'drop policy if exists "audit_select_admin" on public.audit_logs';
    execute $sql$
      create policy "audit_select_admin" on public.audit_logs
        for select using (public.is_verified_active_pengurus_caller())
    $sql$;

    execute 'drop policy if exists "audit_delete_admin" on public.audit_logs';
    execute $sql$
      create policy "audit_delete_admin" on public.audit_logs
        for delete using (
          public.is_verified_bendahara_caller()
          or public.can_access_central_setting_db('settings.reports_audit')
        )
    $sql$;
  end if;

  -- transaksi_ipl
  if to_regclass('public.transaksi_ipl') is not null then
    execute 'alter table public.transaksi_ipl enable row level security';
    execute 'drop policy if exists "admin_verifikasi_transaksi" on public.transaksi_ipl';
    execute 'drop policy if exists "transaksi_ipl_update_policy" on public.transaksi_ipl';
    execute $sql$
      create policy "transaksi_ipl_update_policy" on public.transaksi_ipl
        for update
        using (
          public.is_verified_bendahara_caller()
          or public.is_verified_ketua_caller()
          or public.can_access_central_setting_db('settings.reports_audit')
          or public.can_access_central_setting_db('settings.ipl_billing')
        )
        with check (
          public.is_verified_bendahara_caller()
          or public.is_verified_ketua_caller()
          or public.can_access_central_setting_db('settings.reports_audit')
          or public.can_access_central_setting_db('settings.ipl_billing')
        )
    $sql$;

    execute 'drop policy if exists "transaksi_ipl_delete_policy" on public.transaksi_ipl';
    execute $sql$
      create policy "transaksi_ipl_delete_policy" on public.transaksi_ipl
        for delete using (
          public.is_verified_bendahara_caller()
          or public.is_verified_ketua_caller()
          or public.can_access_central_setting_db('settings.reports_audit')
        )
    $sql$;
  end if;

  -- transaksi_kas
  if to_regclass('public.transaksi_kas') is not null then
    execute 'alter table public.transaksi_kas enable row level security';
    execute 'drop policy if exists "transaksi_kas_insert_policy" on public.transaksi_kas';
    execute $sql$
      create policy "transaksi_kas_insert_policy" on public.transaksi_kas
        for insert with check (public.is_verified_active_pengurus_caller())
    $sql$;

    execute 'drop policy if exists "transaksi_kas_update_policy" on public.transaksi_kas';
    execute $sql$
      create policy "transaksi_kas_update_policy" on public.transaksi_kas
        for update
        using (
          public.is_verified_bendahara_caller()
          or public.is_verified_ketua_caller()
          or public.can_access_central_setting_db('settings.reports_audit')
        )
        with check (
          public.is_verified_bendahara_caller()
          or public.is_verified_ketua_caller()
          or public.can_access_central_setting_db('settings.reports_audit')
        )
    $sql$;

    execute 'drop policy if exists "transaksi_kas_delete_policy" on public.transaksi_kas';
    execute $sql$
      create policy "transaksi_kas_delete_policy" on public.transaksi_kas
        for delete using (
          public.is_verified_bendahara_caller()
          or public.is_verified_ketua_caller()
          or public.can_access_central_setting_db('settings.reports_audit')
        )
    $sql$;
  end if;

  -- petugas_keamanan
  if to_regclass('public.petugas_keamanan') is not null then
    execute 'alter table public.petugas_keamanan enable row level security';
    execute 'drop policy if exists petugas_keamanan_insert_policy on public.petugas_keamanan';
    execute 'drop policy if exists petugas_keamanan_update_policy on public.petugas_keamanan';
    execute 'drop policy if exists petugas_keamanan_delete_policy on public.petugas_keamanan';
    execute 'create policy petugas_keamanan_insert_policy on public.petugas_keamanan for insert with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy petugas_keamanan_update_policy on public.petugas_keamanan for update using (public.can_access_central_setting_db(''settings.security_patrol'')) with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy petugas_keamanan_delete_policy on public.petugas_keamanan for delete using (public.can_access_central_setting_db(''settings.security_patrol''))';
  end if;

  -- titik_patroli
  if to_regclass('public.titik_patroli') is not null then
    execute 'alter table public.titik_patroli enable row level security';
    execute 'drop policy if exists titik_patroli_insert_policy on public.titik_patroli';
    execute 'drop policy if exists titik_patroli_update_policy on public.titik_patroli';
    execute 'drop policy if exists titik_patroli_delete_policy on public.titik_patroli';
    execute 'create policy titik_patroli_insert_policy on public.titik_patroli for insert with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy titik_patroli_update_policy on public.titik_patroli for update using (public.can_access_central_setting_db(''settings.security_patrol'')) with check (public.can_access_central_setting_db(''settings.security_patrol''))';
    execute 'create policy titik_patroli_delete_policy on public.titik_patroli for delete using (public.can_access_central_setting_db(''settings.security_patrol''))';
  end if;

  -- log_patroli
  if to_regclass('public.log_patroli') is not null then
    execute 'alter table public.log_patroli enable row level security';
    execute 'drop policy if exists log_patroli_delete_policy on public.log_patroli';
    execute 'drop policy if exists "log_patroli_delete_admin" on public.log_patroli';
    execute 'create policy "log_patroli_delete_admin" on public.log_patroli for delete using (public.can_access_central_setting_db(''settings.security_patrol'') or public.can_access_central_setting_db(''settings.reports_audit''))';
  end if;

  -- community_chat_messages
  if to_regclass('public.community_chat_messages') is not null then
    execute 'alter table public.community_chat_messages enable row level security';
    execute 'drop policy if exists "community_chat_delete_portal" on public.community_chat_messages';
    execute $chatpol$
      create policy "community_chat_delete_portal" on public.community_chat_messages
        for delete using (
          public.is_verified_bendahara_caller()
          or public.can_access_central_setting_db('settings.chat_moderation')
          or (
            lower(trim(public.req_header('x-user-role'))) = 'warga'
            and public.is_verified_warga_self_caller(public.req_header('x-blok-rumah'))
            and (
              lower(trim(sender_id)) = 'warga:' || lower(regexp_replace(trim(public.req_header('x-blok-rumah')), '\s+', '', 'g'))
              or lower(trim(sender_id)) = 'warga:' || lower(public.normalize_blok_canonical(public.req_header('x-blok-rumah')))
            )
          )
          or (
            lower(trim(public.req_header('x-user-role'))) in ('petugas', 'keamanan')
            and lower(trim(sender_id)) in (
              'petugas:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g')),
              'keamanan:' || lower(regexp_replace(trim(public.req_header('x-petugas-id')), '\s+', '', 'g'))
            )
          )
        )
    $chatpol$;
  end if;
end $$;
