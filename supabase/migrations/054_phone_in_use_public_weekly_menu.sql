-- ============================================================
-- GreenFeast — Migration 054: one account per mobile number, public menu
-- ============================================================
-- 1. Until OTP verification exists, a number can't be checked as belonging to
--    the person typing it — so at least never let it go on a second account.
--    Numbers are stored one way (+91XXXXXXXXXX) whoever enters them (app,
--    admin, spreadsheet import), so "9876543210" and "+91 98765 43210" are
--    the same number to users_phone_key; phone_in_use() lets the app say
--    "already in use" before saving.
-- 2. The weekly menu is public (the app's "This week's menu" page works
--    before signing in), like meal_templates already is.
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_phone IS NULL OR btrim(p_phone) = '' THEN NULL
    WHEN length(d) = 10 THEN '+91' || d
    WHEN length(d) = 12 AND left(d, 2) = '91' THEN '+' || d
    WHEN length(d) = 11 AND left(d, 1) = '0' THEN '+91' || right(d, 10)
    ELSE btrim(p_phone)
  END
  FROM (SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS d) x
$$;

CREATE OR REPLACE FUNCTION public.users_normalize_phone()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.phone := normalize_phone(NEW.phone);
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS users_normalize_phone ON public.users;
CREATE TRIGGER users_normalize_phone
  BEFORE INSERT OR UPDATE OF phone ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_normalize_phone();

UPDATE public.users SET phone = normalize_phone(phone)
 WHERE phone IS DISTINCT FROM normalize_phone(phone);

-- Is this number on someone else's account? (Signed-in customers only.)
CREATE OR REPLACE FUNCTION public.phone_in_use(p_phone text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
     WHERE phone = normalize_phone(p_phone)
       AND id IS DISTINCT FROM auth.uid()
  )
$$;
REVOKE ALL ON FUNCTION public.phone_in_use(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.phone_in_use(text) TO authenticated, service_role;

-- ── Public weekly menu ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS public_read_weekly_menu ON public.weekly_menu;
CREATE POLICY public_read_weekly_menu ON public.weekly_menu FOR SELECT TO anon USING (true);
GRANT SELECT ON public.weekly_menu TO anon;
