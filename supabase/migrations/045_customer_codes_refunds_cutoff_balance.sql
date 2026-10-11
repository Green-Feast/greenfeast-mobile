-- ============================================================
-- GreenFeast — Migration 045: customer codes, refunds, cutoff balance check
-- ============================================================
-- 1. Every user gets a permanent, human-readable customer code (GF-000001…),
--    assigned in signup order and automatically for new users. Customers
--    can't change it: users INSERT is revoked (rows are created by the
--    handle_new_auth_user trigger) and UPDATE is limited to the columns the
--    app actually writes.
-- 2. refunds: ledger for admin refunds — to the wallet (store credit) or to
--    the bank through Cashfree. Service role only.
-- 3. notify_user(): in-app notification + Expo push, from inside the database.
-- 4. Balance is checked at each slot's cutoff (8 AM lunch, 1 PM dinner IST),
--    before the kitchen cooks: orders the wallet can't cover are skipped and
--    the customer is told. It used to be checked only when the order was
--    marked delivered — after it was cooked and handed over — so a ₹0 wallet
--    meant free meals. A warning goes out the evening before (8 PM IST).
--    Pending cash-on-delivery plans are exempt (delivered on credit, see 044).
-- ============================================================

-- ── 1. Customer codes ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.customer_code_seq;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS customer_code text;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE customer_code IS NULL ORDER BY created_at, id LOOP
    UPDATE public.users
       SET customer_code = 'GF-' || lpad(nextval('public.customer_code_seq')::text, 6, '0')
     WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.users
  ALTER COLUMN customer_code SET DEFAULT ('GF-' || lpad(nextval('public.customer_code_seq')::text, 6, '0')),
  ALTER COLUMN customer_code SET NOT NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_customer_code_key;
ALTER TABLE public.users ADD CONSTRAINT users_customer_code_key UNIQUE (customer_code);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.users FROM anon, authenticated;
GRANT UPDATE (name, phone, expo_push_token, onboarded, terms_accepted_at, terms_version)
  ON public.users TO authenticated;

-- ── 2. Refunds ledger ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.refunds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  payment_id    uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  kind          text NOT NULL CHECK (kind IN ('wallet', 'bank')),
  amount        integer NOT NULL CHECK (amount > 0),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  cf_refund_id  text UNIQUE,          -- our refund_id sent to Cashfree (bank refunds)
  failure_note  text,
  created_by    uuid,                 -- admin user id
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refunds_user ON public.refunds (user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_payment ON public.refunds (payment_id);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON public.refunds FROM anon, authenticated;
GRANT ALL ON public.refunds TO service_role;

DROP TRIGGER IF EXISTS refunds_updated_at ON public.refunds;
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 3. Notifications from the database ───────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;   -- functions live in schema "net"
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;   -- Supabase convention; jobs in schema "cron"

CREATE OR REPLACE FUNCTION public.notify_user(
  p_user uuid, p_title text, p_body text, p_type text DEFAULT 'custom'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
  INSERT INTO notifications (user_id, title, body, type) VALUES (p_user, p_title, p_body, p_type);
  SELECT expo_push_token INTO v_token FROM users WHERE id = p_user;
  IF v_token IS NOT NULL AND v_token <> '' THEN
    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := jsonb_build_object('to', v_token, 'title', p_title, 'body', p_body, 'sound', 'default'),
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- "₹1,234.50"-style amount for notification text.
CREATE OR REPLACE FUNCTION public.fmt_rupees(p_paise integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT '₹' || CASE WHEN p_paise % 100 = 0
                     THEN to_char(p_paise / 100, 'FM9,99,99,999')
                     ELSE to_char(p_paise / 100.0, 'FM9,99,99,990.00') END
$$;

-- ── 4. Balance check at cutoff ───────────────────────────────────────────────
-- Money already spoken for today: orders cooked / on the way but not yet
-- billed (billing happens when they're marked delivered).
CREATE OR REPLACE FUNCTION public.unbilled_today(p_user uuid, p_slot text)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(recompute_order_cart(o.id)), 0)::integer
    FROM orders o
   WHERE o.user_id = p_user
     AND o.delivery_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND o.meal_slot = p_slot
     AND o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')
$$;
REVOKE ALL ON FUNCTION public.unbilled_today(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_slot_balance(p_slot text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  u           record;
  o           record;
  v_available integer;
  v_cost      integer;
  v_hit       boolean;
  v_skipped   integer := 0;
  v_users     integer := 0;
BEGIN
  IF p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'enforce_slot_balance: invalid slot %', p_slot;
  END IF;

  FOR u IN
    SELECT DISTINCT o.user_id
      FROM orders o
      JOIN subscriptions s ON s.id = o.subscription_id
     WHERE o.delivery_date = v_today
       AND o.meal_slot = p_slot
       AND o.status IN ('scheduled', 'confirmed')
       AND NOT (s.status = 'pending' AND s.payment_method = 'cod')
  LOOP
    SELECT COALESCE(balance, 0) INTO v_available FROM wallets WHERE user_id = u.user_id FOR UPDATE;
    v_available := COALESCE(v_available, 0);
    -- At the dinner cutoff, today's lunch may not be billed yet.
    IF p_slot = 'dinner' THEN
      v_available := v_available - unbilled_today(u.user_id, 'lunch');
    END IF;

    v_hit := false;
    -- Base meal first, extras after, so a short wallet drops the extras first.
    FOR o IN
      SELECT id FROM orders
       WHERE user_id = u.user_id AND delivery_date = v_today AND meal_slot = p_slot
         AND status IN ('scheduled', 'confirmed')
       ORDER BY extra_dish, slot_seq, created_at
    LOOP
      v_cost := recompute_order_cart(o.id);
      IF v_cost <= v_available THEN
        v_available := v_available - v_cost;
      ELSE
        UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
         WHERE id = o.id;
        v_skipped := v_skipped + 1;
        v_hit := true;
      END IF;
    END LOOP;

    IF v_hit THEN
      PERFORM notify_user(
        u.user_id,
        'Today''s ' || p_slot || ' was skipped',
        'Your wallet didn''t cover today''s ' || p_slot || ', so it wasn''t prepared. '
          || 'Top up in the app to keep your next meals coming.',
        'custom');
      v_users := v_users + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('slot', p_slot, 'skipped', v_skipped, 'users', v_users);
END; $$;
REVOKE ALL ON FUNCTION public.enforce_slot_balance(text) FROM PUBLIC, anon, authenticated;

-- Evening heads-up: tomorrow's meals vs. what the wallet will have left after
-- today's unbilled orders.
CREATE OR REPLACE FUNCTION public.warn_low_balance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tomorrow date := (now() AT TIME ZONE 'Asia/Kolkata')::date + 1;
  u          record;
  v_balance  integer;
  v_left     integer;
  v_warned   integer := 0;
BEGIN
  FOR u IN
    SELECT o.user_id, SUM(recompute_order_cart(o.id))::integer AS need
      FROM orders o
      JOIN subscriptions s ON s.id = o.subscription_id
     WHERE o.delivery_date = v_tomorrow
       AND o.status IN ('scheduled', 'confirmed')
       AND NOT (s.status = 'pending' AND s.payment_method = 'cod')
     GROUP BY o.user_id
  LOOP
    SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = u.user_id;
    v_left := COALESCE(v_balance, 0)
              - unbilled_today(u.user_id, 'lunch') - unbilled_today(u.user_id, 'dinner');
    IF u.need > 0 AND v_left < u.need THEN
      PERFORM notify_user(
        u.user_id,
        'Top up for tomorrow''s meals',
        'Tomorrow''s meals need ' || fmt_rupees(u.need) || ' but your wallet will have '
          || fmt_rupees(GREATEST(v_left, 0)) || '. Top up before 8 AM so nothing gets skipped.',
        'custom');
      v_warned := v_warned + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('warned', v_warned);
END; $$;
REVOKE ALL ON FUNCTION public.warn_low_balance() FROM PUBLIC, anon, authenticated;

-- pg_cron runs in UTC: 02:30 = 8:00 AM IST, 07:30 = 1:00 PM IST, 14:30 = 8:00 PM IST.
SELECT cron.schedule('gf-cutoff-balance-lunch',  '30 2 * * *',  $$SELECT public.enforce_slot_balance('lunch')$$);
SELECT cron.schedule('gf-cutoff-balance-dinner', '30 7 * * *',  $$SELECT public.enforce_slot_balance('dinner')$$);
SELECT cron.schedule('gf-low-balance-warning',   '30 14 * * *', $$SELECT public.warn_low_balance()$$);
