-- ============================================================
-- GreenFeast — Migration 061: WhatsApp OTP for the customer's number
-- ============================================================
-- The onboarding "What's your WhatsApp number?" screen sends a code on
-- WhatsApp and only saves the number once the code is confirmed — the
-- phone-otp edge function does both (Meta WhatsApp Cloud API, an
-- Authentication template with a copy-code button). It stays switched off,
-- and the app keeps today's flow, until the WHATSAPP_* secrets are set.
--
-- users.phone_verified_at: when the number was confirmed. Only the edge
-- function (service role) sets it — customers can't write the column — and
-- a customer changing the number themselves (older app versions write
-- users.phone directly) clears it.
-- phone_otps: the codes, hashed; service role only.
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

CREATE OR REPLACE FUNCTION public.users_phone_unverify()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' AND NEW.phone IS DISTINCT FROM OLD.phone THEN
    NEW.phone_verified_at := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS users_phone_unverify ON public.users;
CREATE TRIGGER users_phone_unverify
  BEFORE UPDATE OF phone ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_phone_unverify();

CREATE TABLE IF NOT EXISTS public.phone_otps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone         text NOT NULL,
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0,
  wa_message_id text,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_otps_user ON public.phone_otps (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_otps_phone ON public.phone_otps (phone, created_at DESC);
ALTER TABLE public.phone_otps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phone_otps FROM anon, authenticated;
GRANT ALL ON public.phone_otps TO service_role;
