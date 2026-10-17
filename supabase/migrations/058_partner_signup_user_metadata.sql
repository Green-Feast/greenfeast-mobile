-- ============================================================
-- GreenFeast — Migration 058: partner logins skip the customer row (fix 057)
-- ============================================================
-- 057 made handle_new_auth_user skip accounts with app_metadata.role =
-- 'partner', but Supabase Auth's admin createUser inserts the auth.users row
-- first and sets app_metadata in a second statement — so the insert trigger
-- never saw it and partners still got a public.users row (and used up a
-- GF-… customer code). user_metadata IS part of the insert, so the admin's
-- "Create login" sets user_metadata.gf_account = 'partner' and that's what
-- the trigger checks now.
--
-- Setting that flag on a public sign-up only means the account gets no
-- customer row — it grants nothing: partner access requires the admin to
-- link the account to a delivery_partners row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delivery partner logins are staff accounts, not customers.
  IF COALESCE(NEW.raw_user_meta_data ->> 'gf_account', '') = 'partner'
     OR COALESCE(NEW.raw_app_meta_data ->> 'role', '') = 'partner' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
