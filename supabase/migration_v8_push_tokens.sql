-- ============================================================================
-- Migration v8: Tabel `user_push_tokens` untuk Penyimpanan Token FCM Android/iOS
-- e-Card IPL Perumahan Saung Kebun
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'warga',
  blok_rumah TEXT,
  token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_push_tokens_user_token_unique UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id
  ON public.user_push_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_user_push_tokens_token
  ON public.user_push_tokens (token);

ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_push_tokens_select_all" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_select_all"
  ON public.user_push_tokens
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "user_push_tokens_insert_all" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_insert_all"
  ON public.user_push_tokens
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "user_push_tokens_update_all" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_update_all"
  ON public.user_push_tokens
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "user_push_tokens_delete_all" ON public.user_push_tokens;
CREATE POLICY "user_push_tokens_delete_all"
  ON public.user_push_tokens
  FOR DELETE
  USING (true);
