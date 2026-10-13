-- ============================================================
-- GreenFeast — Migration 052: one menu, cash-on-delivery upfront, batch per
-- address, fixed dishes, editable notifications
-- ============================================================
-- 1. Notification templates: every automated customer message lives in
--    notification_templates (seeded with the texts used so far) and is sent
--    through notify_event(), so the admin can edit or switch each one off.
--    kind 'saved' rows are reusable broadcast messages (promotions).
-- 2. One menu: the M2 track (wraps/toasts) is gone. Upcoming meals on it that
--    nobody customised move to the single weekly menu's dish; every plan is M1.
-- 3. Cash on delivery: no more delivering on credit by default. App signups pay
--    the first day's meals online and the rest (a round ₹100 amount) in cash:
--    the plan is active with subscriptions.cod_due_paise still to collect. Only
--    plans the admin sets up as cash-on-delivery run on credit
--    (cod_on_credit) until the cash is recorded.
-- 4. Meal-switch fee removed: the remaining ₹20 fee lines are dropped.
-- 5. Smoothie add-on ₹149 → ₹200 (no current plan has it).
-- 6. Batch per address: each address has its own lunch and dinner batch, and
--    an order's batch always follows its address (trigger). Customers can't
--    set batches. Addresses can be archived instead of deleted (orders keep
--    pointing at them), and only one default address per customer.
-- 7. Fixed dishes: customer_meal_rules ("same dish every day", set by ops),
--    used by instantiate-orders ahead of the weekly menu.
-- ============================================================

-- ── 1. Notification templates ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_templates (
  key           text PRIMARY KEY,
  kind          text NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'saved')),
  label         text NOT NULL,
  description   text,
  title         text NOT NULL,
  body          text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  placeholders  text[] NOT NULL DEFAULT '{}',
  default_title text,
  default_body  text,
  sort_order    integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_templates FROM anon, authenticated;
GRANT ALL ON public.notification_templates TO service_role;

INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body)
VALUES
  ('out_for_delivery', 10, 'Out for delivery',
   'Ops marks a batch or a single order "Out for delivery" (Operations).',
   '{name,slot}',
   'Your meal is on its way!',
   'Today''s {slot} just left the kitchen — it''ll be with you shortly.'),
  ('delivered', 20, 'Delivered',
   'Ops marks a batch or a single order "Delivered".',
   '{name,slot}',
   'Delivered!',
   'Today''s {slot} has been delivered. Enjoy!'),
  ('delivery_not_covered', 30, 'Skipped at delivery — wallet short',
   'An order is marked delivered but the wallet can''t cover it, so it''s skipped instead of billed.',
   '{name,slot,date}',
   'Delivery skipped',
   'Your wallet didn''t cover your {slot} on {date}. Top up to keep future deliveries.'),
  ('skipped_low_balance', 40, 'Skipped at cutoff — wallet short',
   '8 AM (lunch) and 1 PM (dinner) check: the wallet can''t cover today''s meal, so it isn''t prepared.',
   '{name,slot}',
   'Today''s {slot} was skipped',
   'Your wallet didn''t cover today''s {slot}, so it wasn''t prepared. Top up in the app to keep your next meals coming.'),
  ('plan_finished', 50, 'Plan finished',
   'Cutoff check: the plan has no meals left, so today''s meal isn''t prepared.',
   '{name,slot}',
   'Your plan has finished',
   'All the meals on your plan have been used, so today''s {slot} wasn''t prepared. Renew your plan in the app to keep your meals coming.'),
  ('low_balance_warning', 60, 'Low wallet — tomorrow',
   '8 PM: tomorrow''s meals cost more than the wallet will have.',
   '{name,need,balance}',
   'Top up for tomorrow''s meals',
   'Tomorrow''s meals need {need} but your wallet will have {balance}. Top up before 8 AM so nothing gets skipped.'),
  ('kitchen_closed', 70, 'Kitchen closed',
   'Ops closes the kitchen for a slot (Operations → Close kitchen). {reason} is " (the reason)" or empty.',
   '{name,slot,day,reason}',
   'No {slot} on {day}',
   'Our kitchen is closed for {slot} on {day}{reason}. You won''t be charged, and the meal stays on your plan.'),
  ('kitchen_reopened', 80, 'Kitchen reopened',
   'Ops reopens a closed slot before its cutoff.',
   '{name,slot,day}',
   'Kitchen open on {day}',
   'Good news — we''re open for {slot} on {day} after all, and your meal is back on.'),
  ('renewal_reminder', 90, 'Plan running low',
   'Every morning: plans with 2 or fewer meals left (at most once every 3 days).',
   '{name,meals_left}',
   'Your plan is running low',
   'You have only a couple of meals left on your plan — renew now to keep your deliveries going without a gap.'),
  ('cash_received', 100, 'Cash received',
   'Ops records a cash payment for a cash-on-delivery plan. {cash_due} is what''s still to collect.',
   '{name,amount,cash_due}',
   'Payment received',
   'We''ve received your cash payment of {amount} — thank you! It''s been added to your GreenFeast wallet.'),
  ('refund_wallet', 110, 'Refund to wallet',
   'Admin → Money → Refund to wallet.',
   '{name,amount,reason}',
   'Refund added to your wallet',
   '{amount} has been added to your GreenFeast wallet. Reason: {reason}'),
  ('refund_bank_started', 120, 'Bank refund started',
   'Admin → Money → Refund to bank (sent to Cashfree).',
   '{name,amount}',
   'Refund started',
   '{amount} is being refunded to your original payment method. Banks usually take 5–7 working days.'),
  ('refund_bank_done', 130, 'Bank refund completed',
   'Cashfree confirms a bank refund.',
   '{name,amount}',
   'Refund processed',
   '{amount} has been refunded to your original payment method. It can take a few working days to show in your account.'),
  ('refund_bank_failed', 140, 'Bank refund failed',
   'Cashfree rejects a bank refund; the amount goes back to the wallet.',
   '{name,amount}',
   'Refund could not be processed',
   'Your bank refund of {amount} didn''t go through, so the amount is back in your GreenFeast wallet. Contact us if you need help.'),
  ('plan_ready', 150, 'Plan set up by GreenFeast',
   'Admin creates a plan for a customer (Users → Create subscription). {wallet_note} is " and ₹X is in your wallet" or empty.',
   '{name,meals,wallet_note}',
   'Your GreenFeast plan is ready',
   '{meals} meals are set up in the app{wallet_note}. Manage meals, skips and deliveries from My Plan.')
ON CONFLICT (key) DO NOTHING;

UPDATE public.notification_templates
   SET default_title = title, default_body = body
 WHERE kind = 'event' AND default_title IS NULL;

-- {key} → value for every key in p_vars.
CREATE OR REPLACE FUNCTION public.render_template(p_text text, p_vars jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k     text;
  v     text;
  v_out text := COALESCE(p_text, '');
BEGIN
  IF p_vars IS NULL THEN RETURN v_out; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(p_vars) LOOP
    v_out := replace(v_out, '{' || k || '}', COALESCE(v, ''));
  END LOOP;
  RETURN v_out;
END; $$;

-- Sends one templated message (push + in-app, via notify_user). Does nothing
-- when the template is switched off. {name} is the customer's first name.
CREATE OR REPLACE FUNCTION public.notify_event(
  p_user uuid, p_key text, p_vars jsonb DEFAULT '{}'::jsonb, p_type text DEFAULT 'custom'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t      notification_templates%ROWTYPE;
  v_name text;
  v_vars jsonb;
BEGIN
  SELECT * INTO t FROM notification_templates WHERE key = p_key;
  IF NOT FOUND OR NOT t.enabled THEN
    RETURN false;
  END IF;
  SELECT split_part(NULLIF(trim(name), ''), ' ', 1) INTO v_name FROM users WHERE id = p_user;
  v_vars := jsonb_build_object('name', COALESCE(NULLIF(v_name, ''), 'there')) || COALESCE(p_vars, '{}'::jsonb);
  PERFORM notify_user(p_user, render_template(t.title, v_vars), render_template(t.body, v_vars), p_type);
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.notify_event(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_event(uuid, text, jsonb, text) TO service_role;

-- ── Shared helper: re-snapshot an order's ingredients from its dish ─────────
-- (switch-meal used to leave the old dish's ingredients on the kitchen sheet.)
CREATE OR REPLACE FUNCTION public.snapshot_order_ingredients(p_order uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM order_ingredients WHERE order_id = p_order;
  INSERT INTO order_ingredients (order_id, ingredient_id, ingredient_name, quantity, unit)
  SELECT o.id, i.id, i.name, ti.quantity, i.unit
    FROM orders o
    JOIN template_ingredients ti ON ti.meal_template_id = o.meal_template_id
    JOIN ingredients i ON i.id = ti.ingredient_id
   WHERE o.id = p_order;
$$;
REVOKE ALL ON FUNCTION public.snapshot_order_ingredients(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_order_ingredients(uuid) TO service_role;

-- ── 2. One menu ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT o.id, wm.meal_template_id AS new_meal
      FROM orders o
      JOIN subscriptions s ON s.id = o.subscription_id
      JOIN weekly_menu wm
        ON wm.menu_type = 'M1'
       AND wm.day_of_week = EXTRACT(ISODOW FROM o.delivery_date)::int - 1
       AND wm.meal_slot = o.meal_slot
     WHERE s.menu_type = 'M2'
       AND o.status IN ('scheduled', 'confirmed')
       AND o.is_customized = false
       AND o.extra_dish = false
       AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
       AND NOT is_slot_locked(o.delivery_date, o.meal_slot)
       AND wm.meal_template_id IS NOT NULL
       AND o.meal_template_id <> wm.meal_template_id
  LOOP
    UPDATE orders SET meal_template_id = r.new_meal, updated_at = now() WHERE id = r.id;
    PERFORM snapshot_order_ingredients(r.id);
  END LOOP;
END $$;

UPDATE public.subscriptions SET menu_type = 'M1' WHERE menu_type IS DISTINCT FROM 'M1';
ALTER TABLE public.subscriptions ALTER COLUMN menu_type SET DEFAULT 'M1';
DELETE FROM public.weekly_menu WHERE menu_type = 'M2';

-- ── 3. Cash on delivery ─────────────────────────────────────────────────────
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS cod_due_paise integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cod_on_credit boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_cod_due_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_cod_due_check CHECK (cod_due_paise >= 0);

-- Customer-created plans: always pending, no meals, one menu, nothing on credit.
CREATE OR REPLACE FUNCTION public.guard_customer_subscription_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
  END IF;
  NEW.status := 'pending';
  NEW.deliveries_remaining := 0;
  NEW.batch_id_lunch := NULL;
  NEW.batch_id_dinner := NULL;
  NEW.renewed_from := NULL;
  NEW.pause_from := NULL;
  NEW.pause_until := NULL;
  NEW.end_date := NULL;
  NEW.last_renewal_reminder_sent_at := NULL;
  NEW.menu_type := 'M1';
  NEW.cod_due_paise := 0;
  NEW.cod_on_credit := false;
  RETURN NEW;
END; $$;

-- Pending cash-on-delivery plans (delivered on credit until now) become active
-- plans on credit with whatever cash hasn't been credited yet still due.
DO $$
DECLARE
  s          record;
  v_total    integer;
  v_credited integer;
  v_used     integer;
BEGIN
  FOR s IN
    SELECT sub.id, sub.user_id, p.meals_total, p.base_price
      FROM subscriptions sub
      JOIN plans p ON p.id = sub.plan_id
     WHERE sub.status = 'pending' AND sub.payment_method = 'cod'
  LOOP
    -- One live plan per customer (049): leave it for the admin to sort out.
    IF EXISTS (SELECT 1 FROM subscriptions o
                WHERE o.user_id = s.user_id AND o.id <> s.id AND o.status IN ('active', 'paused')) THEN
      CONTINUE;
    END IF;
    SELECT s.base_price + COALESCE(SUM(a.price_per_meal), 0) * s.meals_total INTO v_total
      FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
     WHERE sa.subscription_id = s.id;
    SELECT COALESCE(SUM(amount), 0) INTO v_credited
      FROM wallet_transactions WHERE reference_id = s.id::text AND type = 'credit';
    SELECT COALESCE(SUM(COALESCE(quantity, 1)), 0) INTO v_used
      FROM orders WHERE subscription_id = s.id AND status = 'delivered';
    UPDATE subscriptions
       SET status = 'active',
           deliveries_remaining = GREATEST(s.meals_total - v_used, 0),
           cod_due_paise = GREATEST(v_total - v_credited, 0),
           cod_on_credit = (v_total - v_credited) > 0,
           updated_at = now()
     WHERE id = s.id;
  END LOOP;
END $$;

-- Billing on delivery: only plans the admin put on credit may overdraw.
CREATE OR REPLACE FUNCTION public.advance_order_delivered(p_order uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r           RECORD;
  v_total     integer;
  v_balance   integer;
  v_on_credit boolean;
BEGIN
  SELECT o.id AS order_id, o.user_id, o.subscription_id,
         o.quantity, o.cart_total, o.meal_slot, o.delivery_date
    INTO r
    FROM orders o
   WHERE o.id = p_order
     AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
     FOR UPDATE OF o;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'already_settled');
  END IF;

  -- Always recompute: cart_total is only a display snapshot and must never be
  -- the billed amount (customers could write it directly before 044).
  v_total := recompute_order_cart(r.order_id);

  -- Cash-on-delivery plans set up by the admin run on credit until the cash
  -- is recorded (052). App signups paid the first day upfront instead.
  SELECT EXISTS (SELECT 1 FROM subscriptions s
                  WHERE s.user_id = r.user_id AND s.cod_on_credit
                    AND s.status IN ('active', 'paused')) INTO v_on_credit;

  -- Row lock so two deliveries for the same customer can't both pass the
  -- balance check and overdraw the wallet.
  SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = r.user_id FOR UPDATE;
  IF v_total > 0 AND COALESCE(v_balance, 0) < v_total AND NOT v_on_credit THEN
    UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
     WHERE id = r.order_id;
    PERFORM notify_event(r.user_id, 'delivery_not_covered',
      jsonb_build_object('slot', r.meal_slot, 'date', to_char(r.delivery_date, 'Dy FMDD Mon')),
      'order_update');
    RETURN jsonb_build_object('result', 'skipped_insufficient');
  END IF;

  -- The status transition IS the guard, same as advance_batch_delivered.
  UPDATE orders SET status = 'delivered', updated_at = now()
   WHERE id = r.order_id AND status NOT IN ('delivered', 'cancelled', 'skipped');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'already_settled');
  END IF;

  UPDATE subscriptions
     SET deliveries_remaining = GREATEST(deliveries_remaining - COALESCE(r.quantity, 1), 0),
         updated_at = now()
   WHERE id = r.subscription_id;

  PERFORM wallet_debit(
    r.user_id, v_total,
    'Meal delivered ' || r.delivery_date::text || ' ' || r.meal_slot, r.order_id::text
  );

  RETURN jsonb_build_object('result', 'billed');
END; $$;
REVOKE ALL ON FUNCTION public.advance_order_delivered(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_order_delivered(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.advance_batch_delivered(
  p_batch uuid, p_date date, p_slot text DEFAULT NULL, p_is_test boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r           RECORD;
  v_total     integer;
  v_balance   integer;
  v_billed    integer := 0;
  v_short     integer := 0;
  v_raced     integer := 0;
  v_on_credit boolean;
BEGIN
  -- A typo like 'Lunch' must not silently match zero rows and report success.
  IF p_slot IS NOT NULL AND p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'advance_batch_delivered: invalid p_slot %', p_slot;
  END IF;

  FOR r IN
    SELECT o.id AS order_id, o.user_id, o.subscription_id,
           o.quantity, o.cart_total, o.meal_slot
      FROM orders o
     WHERE o.batch_id      = p_batch
       AND o.delivery_date = p_date
       AND (p_slot IS NULL OR o.meal_slot = p_slot)
       AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
       -- Admin Test/Live mode: only that side's customers (NULL = everyone).
       AND (p_is_test IS NULL OR EXISTS (
             SELECT 1 FROM users u WHERE u.id = o.user_id AND u.is_test = p_is_test))
     ORDER BY o.user_id, o.meal_slot, o.slot_seq
       FOR UPDATE OF o
  LOOP
    -- Always recompute: cart_total is only a display snapshot (see 044 header).
    v_total := recompute_order_cart(r.order_id);

    -- Admin cash-on-delivery plans run on credit until the cash is recorded.
    SELECT EXISTS (SELECT 1 FROM subscriptions s
                    WHERE s.user_id = r.user_id AND s.cod_on_credit
                      AND s.status IN ('active', 'paused')) INTO v_on_credit;

    SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = r.user_id FOR UPDATE;
    IF v_total > 0 AND COALESCE(v_balance, 0) < v_total AND NOT v_on_credit THEN
      UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
       WHERE id = r.order_id;
      PERFORM notify_event(r.user_id, 'delivery_not_covered',
        jsonb_build_object('slot', r.meal_slot, 'date', to_char(p_date, 'Dy FMDD Mon')),
        'order_update');
      v_short := v_short + 1;
      CONTINUE;
    END IF;

    -- The status transition IS the guard: only the caller that actually
    -- performs this update gets to decrement the counter and debit.
    UPDATE orders SET status = 'delivered', updated_at = now()
     WHERE id = r.order_id AND status NOT IN ('delivered', 'cancelled', 'skipped');
    IF NOT FOUND THEN
      v_raced := v_raced + 1;
      CONTINUE;
    END IF;

    UPDATE subscriptions
       SET deliveries_remaining = GREATEST(deliveries_remaining - COALESCE(r.quantity, 1), 0),
           updated_at = now()
     WHERE id = r.subscription_id;

    PERFORM wallet_debit(
      r.user_id, v_total,
      'Meal delivered ' || p_date::text || ' ' || r.meal_slot, r.order_id::text
    );

    v_billed := v_billed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'billed', v_billed,
    'skipped_insufficient', v_short,
    'already_settled', v_raced
  );
END; $$;
REVOKE ALL ON FUNCTION public.advance_batch_delivered(uuid, date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_batch_delivered(uuid, date, text, boolean) TO service_role;

-- 8 AM / 1 PM cutoff check. Plans on credit skip only the balance part; a
-- finished plan stops for everyone.
CREATE OR REPLACE FUNCTION public.enforce_slot_balance(p_slot text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today     date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  u           record;
  ord         record;
  v_available integer;
  v_cost      integer;
  v_finished  boolean;
  v_on_credit boolean;
  v_broke     boolean;
  v_done      boolean;
  v_skipped   integer := 0;
  v_users     integer := 0;
BEGIN
  IF p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'enforce_slot_balance: invalid slot %', p_slot;
  END IF;

  FOR u IN
    SELECT DISTINCT o.user_id
      FROM orders o
     WHERE o.delivery_date = v_today
       AND o.meal_slot = p_slot
       AND o.status IN ('scheduled', 'confirmed')
  LOOP
    SELECT EXISTS (SELECT 1 FROM subscriptions s
                    WHERE s.user_id = u.user_id AND s.cod_on_credit
                      AND s.status IN ('active', 'paused')) INTO v_on_credit;

    SELECT COALESCE(balance, 0) INTO v_available FROM wallets WHERE user_id = u.user_id FOR UPDATE;
    v_available := COALESCE(v_available, 0);
    -- At the dinner cutoff, today's lunch may not be billed yet.
    IF p_slot = 'dinner' THEN
      v_available := v_available - unbilled_today(u.user_id, 'lunch');
    END IF;

    v_broke := false;
    v_done  := false;
    -- Base meal first, extras after, so a short wallet drops the extras first.
    FOR ord IN
      SELECT id, subscription_id FROM orders
       WHERE user_id = u.user_id AND delivery_date = v_today AND meal_slot = p_slot
         AND status IN ('scheduled', 'confirmed')
       ORDER BY extra_dish, slot_seq, created_at
    LOOP
      SELECT (s.deliveries_remaining <= 0) INTO v_finished
        FROM subscriptions s WHERE s.id = ord.subscription_id;
      IF COALESCE(v_finished, false) THEN
        UPDATE orders SET status = 'skipped', skip_reason = 'plan_finished', updated_at = now()
         WHERE id = ord.id;
        v_skipped := v_skipped + 1;
        v_done := true;
        CONTINUE;
      END IF;

      v_cost := recompute_order_cart(ord.id);
      IF v_on_credit THEN
        CONTINUE;
      END IF;
      IF v_cost <= v_available THEN
        v_available := v_available - v_cost;
      ELSE
        UPDATE orders SET status = 'skipped', skip_reason = 'insufficient_balance', updated_at = now()
         WHERE id = ord.id;
        v_skipped := v_skipped + 1;
        v_broke := true;
      END IF;
    END LOOP;

    IF v_done THEN
      PERFORM notify_event(u.user_id, 'plan_finished', jsonb_build_object('slot', p_slot));
    ELSIF v_broke THEN
      PERFORM notify_event(u.user_id, 'skipped_low_balance', jsonb_build_object('slot', p_slot));
    END IF;
    IF v_done OR v_broke THEN
      v_users := v_users + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('slot', p_slot, 'skipped', v_skipped, 'users', v_users);
END; $$;
REVOKE ALL ON FUNCTION public.enforce_slot_balance(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_slot_balance(text) TO service_role;

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
     WHERE o.delivery_date = v_tomorrow
       AND o.status IN ('scheduled', 'confirmed')
       AND NOT EXISTS (SELECT 1 FROM subscriptions s
                        WHERE s.user_id = o.user_id AND s.cod_on_credit
                          AND s.status IN ('active', 'paused'))
     GROUP BY o.user_id
  LOOP
    SELECT COALESCE(balance, 0) INTO v_balance FROM wallets WHERE user_id = u.user_id;
    v_left := COALESCE(v_balance, 0)
              - unbilled_today(u.user_id, 'lunch') - unbilled_today(u.user_id, 'dinner');
    IF u.need > 0 AND v_left < u.need THEN
      PERFORM notify_event(u.user_id, 'low_balance_warning',
        jsonb_build_object('need', fmt_rupees(u.need), 'balance', fmt_rupees(GREATEST(v_left, 0))));
      v_warned := v_warned + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('warned', v_warned);
END; $$;
REVOKE ALL ON FUNCTION public.warn_low_balance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.warn_low_balance() TO service_role;

-- Kitchen closures send their messages through the templates too.
CREATE OR REPLACE FUNCTION public.close_kitchen(
  p_date date, p_slot text, p_reason text, p_admin uuid, p_notify boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cancelled integer := 0;
  v_users     integer := 0;
  v_day       text := trim(to_char(p_date, 'Day')) || ', ' || to_char(p_date, 'FMDD Mon');
  v_reason    text := NULLIF(trim(COALESCE(p_reason, '')), '');
  u           record;
BEGIN
  IF p_slot NOT IN ('lunch', 'dinner') THEN
    RAISE EXCEPTION 'close_kitchen: invalid slot %', p_slot;
  END IF;
  IF p_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'close_kitchen: date is in the past';
  END IF;

  INSERT INTO kitchen_closures (closed_on, meal_slot, reason, created_by)
  VALUES (p_date, p_slot, v_reason, p_admin)
  ON CONFLICT (closed_on, meal_slot) DO UPDATE SET reason = EXCLUDED.reason;

  FOR u IN
    SELECT DISTINCT user_id FROM orders
     WHERE delivery_date = p_date AND meal_slot = p_slot
       AND status IN ('scheduled', 'confirmed', 'preparing')
  LOOP
    IF p_notify THEN
      PERFORM notify_event(u.user_id, 'kitchen_closed', jsonb_build_object(
        'slot', p_slot, 'day', v_day, 'reason', COALESCE(' (' || v_reason || ')', '')));
    END IF;
    v_users := v_users + 1;
  END LOOP;

  UPDATE orders SET status = 'cancelled', skip_reason = 'kitchen_closed', updated_at = now()
   WHERE delivery_date = p_date AND meal_slot = p_slot
     AND status IN ('scheduled', 'confirmed', 'preparing');
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'customers', v_users, 'notified', p_notify);
END; $$;
REVOKE ALL ON FUNCTION public.close_kitchen(date, text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_kitchen(date, text, text, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.reopen_kitchen(p_date date, p_slot text, p_notify boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_revived integer := 0;
  v_users   integer := 0;
  v_day     text := trim(to_char(p_date, 'Day')) || ', ' || to_char(p_date, 'FMDD Mon');
  u         record;
BEGIN
  DELETE FROM kitchen_closures WHERE closed_on = p_date AND meal_slot = p_slot;

  -- Only while the slot is still open: after its cutoff the kitchen has
  -- planned without these meals.
  IF is_slot_locked(p_date, p_slot) THEN
    RETURN jsonb_build_object('revived', 0, 'customers', 0, 'note', 'slot already past cutoff');
  END IF;

  FOR u IN
    SELECT DISTINCT o.user_id FROM orders o
      JOIN subscriptions s ON s.id = o.subscription_id
     WHERE o.delivery_date = p_date AND o.meal_slot = p_slot
       AND o.status = 'cancelled' AND o.skip_reason = 'kitchen_closed'
       AND s.status IN ('active', 'pending')
  LOOP
    IF p_notify THEN
      PERFORM notify_event(u.user_id, 'kitchen_reopened', jsonb_build_object('slot', p_slot, 'day', v_day));
    END IF;
    v_users := v_users + 1;
  END LOOP;

  UPDATE orders o SET status = 'scheduled', skip_reason = NULL, updated_at = now()
    FROM subscriptions s
   WHERE s.id = o.subscription_id
     AND o.delivery_date = p_date AND o.meal_slot = p_slot
     AND o.status = 'cancelled' AND o.skip_reason = 'kitchen_closed'
     AND s.status IN ('active', 'pending');
  GET DIAGNOSTICS v_revived = ROW_COUNT;

  RETURN jsonb_build_object('revived', v_revived, 'customers', v_users);
END; $$;
REVOKE ALL ON FUNCTION public.reopen_kitchen(date, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_kitchen(date, text, boolean) TO service_role;

-- ── 4. Meal-switch fee removed ──────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT oa.order_id
      FROM order_addons oa JOIN orders o ON o.id = oa.order_id
     WHERE oa.kind = 'fee' AND o.status <> 'delivered'
  LOOP
    DELETE FROM order_addons WHERE order_id = r.order_id AND kind = 'fee';
    PERFORM recompute_order_cart(r.order_id);
  END LOOP;
END $$;

-- ── 5. Smoothie add-on ──────────────────────────────────────────────────────
UPDATE public.addons SET price_per_meal = 20000 WHERE id = 'smoothie';

-- ── 6. Batch per address ────────────────────────────────────────────────────
ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS batch_id_lunch  uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_id_dinner uuid REFERENCES public.batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at     timestamptz;

-- Customers keep managing their own addresses (same columns as before), but
-- never the batch or the archive flag. Deleting goes through archive_address().
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.addresses FROM anon, authenticated;
GRANT INSERT (id, user_id, label, type, line1, city, pincode, landmark, time_window,
              is_default, created_at, latitude, longitude, lat, lng)
  ON public.addresses TO authenticated;
GRANT UPDATE (id, user_id, label, type, line1, city, pincode, landmark, time_window,
              is_default, created_at, latitude, longitude, lat, lng)
  ON public.addresses TO authenticated;

-- Existing addresses take their customer's current plan batches.
UPDATE public.addresses a SET
  batch_id_lunch = COALESCE(a.batch_id_lunch, (
    SELECT s.batch_id_lunch FROM subscriptions s
     WHERE s.user_id = a.user_id AND s.batch_id_lunch IS NOT NULL
     ORDER BY (s.status IN ('active', 'paused')) DESC, s.created_at DESC LIMIT 1)),
  batch_id_dinner = COALESCE(a.batch_id_dinner, (
    SELECT s.batch_id_dinner FROM subscriptions s
     WHERE s.user_id = a.user_id AND s.batch_id_dinner IS NOT NULL
     ORDER BY (s.status IN ('active', 'paused')) DESC, s.created_at DESC LIMIT 1));

CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_user
  ON public.addresses (user_id) WHERE is_default AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_addresses_batch_lunch ON public.addresses (batch_id_lunch);
CREATE INDEX IF NOT EXISTS idx_addresses_batch_dinner ON public.addresses (batch_id_dinner);
CREATE INDEX IF NOT EXISTS idx_orders_address ON public.orders (address_id);

-- An order's batch is its address's batch for that slot.
CREATE OR REPLACE FUNCTION public.order_batch_from_address()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.address_id IS NOT NULL THEN
    SELECT CASE WHEN NEW.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END
      INTO NEW.batch_id
      FROM addresses a WHERE a.id = NEW.address_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_batch_from_address ON public.orders;
CREATE TRIGGER orders_batch_from_address
  BEFORE INSERT OR UPDATE OF address_id, meal_slot ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.order_batch_from_address();

-- Moving an address to another batch moves its upcoming meals with it.
CREATE OR REPLACE FUNCTION public.address_batch_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  IF NEW.batch_id_lunch IS DISTINCT FROM OLD.batch_id_lunch THEN
    UPDATE orders SET batch_id = NEW.batch_id_lunch, updated_at = now()
     WHERE address_id = NEW.id AND meal_slot = 'lunch' AND delivery_date >= v_today
       AND status IN ('scheduled', 'confirmed', 'preparing');
  END IF;
  IF NEW.batch_id_dinner IS DISTINCT FROM OLD.batch_id_dinner THEN
    UPDATE orders SET batch_id = NEW.batch_id_dinner, updated_at = now()
     WHERE address_id = NEW.id AND meal_slot = 'dinner' AND delivery_date >= v_today
       AND status IN ('scheduled', 'confirmed', 'preparing');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS addresses_batch_changed ON public.addresses;
CREATE TRIGGER addresses_batch_changed
  AFTER UPDATE OF batch_id_lunch, batch_id_dinner ON public.addresses
  FOR EACH ROW EXECUTE FUNCTION public.address_batch_changed();

-- Upcoming orders take their address's batch now.
UPDATE public.orders o
   SET batch_id = CASE WHEN o.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END,
       updated_at = now()
  FROM public.addresses a
 WHERE a.id = o.address_id
   AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
   AND o.status IN ('scheduled', 'confirmed', 'preparing')
   AND o.batch_id IS DISTINCT FROM (CASE WHEN o.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END);

-- Make an address the default, optionally sending every upcoming open meal
-- there. Customers can only touch their own addresses; service_role (admin)
-- any. Returns how many meals moved.
CREATE OR REPLACE FUNCTION public.set_default_address(p_address uuid, p_move_upcoming boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_moved integer := 0;
BEGIN
  SELECT user_id INTO v_user FROM addresses WHERE id = p_address AND archived_at IS NULL;
  IF v_user IS NULL OR (auth.uid() IS NOT NULL AND v_user <> auth.uid()) THEN
    RAISE EXCEPTION 'Address not found' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE addresses SET is_default = false WHERE user_id = v_user AND id <> p_address AND is_default;
  UPDATE addresses SET is_default = true WHERE id = p_address;

  IF p_move_upcoming THEN
    UPDATE orders SET address_id = p_address, updated_at = now()
     WHERE user_id = v_user
       AND status IN ('scheduled', 'confirmed')
       AND delivery_date >= v_today
       AND NOT is_slot_locked(delivery_date, meal_slot)
       AND address_id IS DISTINCT FROM p_address;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
  END IF;
  RETURN v_moved;
END; $$;
REVOKE ALL ON FUNCTION public.set_default_address(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_default_address(uuid, boolean) TO authenticated, service_role;

-- Remove an address. Upcoming open meals going there move to the default (or
-- newest) other address first. An address no order ever used is deleted;
-- one with order history is archived (hidden) so past orders keep it.
CREATE OR REPLACE FUNCTION public.archive_address(p_address uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user        uuid;
  v_was_default boolean;
  v_next        uuid;
  v_today       date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  SELECT user_id, COALESCE(is_default, false) INTO v_user, v_was_default
    FROM addresses WHERE id = p_address AND archived_at IS NULL;
  IF v_user IS NULL OR (auth.uid() IS NOT NULL AND v_user <> auth.uid()) THEN
    RAISE EXCEPTION 'Address not found' USING ERRCODE = 'check_violation';
  END IF;

  -- A meal already being cooked or on its way can't be redirected.
  IF EXISTS (SELECT 1 FROM orders
              WHERE address_id = p_address AND delivery_date >= v_today
                AND (status IN ('preparing', 'out_for_delivery')
                     OR (status IN ('scheduled', 'confirmed') AND is_slot_locked(delivery_date, meal_slot)))) THEN
    RAISE EXCEPTION 'Today''s meal is already on its way to this address. Try again after it''s delivered.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_next FROM addresses
   WHERE user_id = v_user AND id <> p_address AND archived_at IS NULL
   ORDER BY is_default DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF v_next IS NULL AND EXISTS (
    SELECT 1 FROM orders WHERE address_id = p_address AND delivery_date >= v_today
       AND status IN ('scheduled', 'confirmed')) THEN
    RAISE EXCEPTION 'Your upcoming meals go to this address. Add another address first.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE orders SET address_id = v_next, updated_at = now()
   WHERE address_id = p_address AND delivery_date >= v_today AND status IN ('scheduled', 'confirmed');

  IF v_was_default THEN
    UPDATE addresses SET is_default = false WHERE id = p_address;
    IF v_next IS NOT NULL THEN
      UPDATE addresses SET is_default = true WHERE id = v_next;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM orders WHERE address_id = p_address) THEN
    UPDATE addresses SET archived_at = now(), is_default = false WHERE id = p_address;
    RETURN 'archived';
  END IF;
  DELETE FROM addresses WHERE id = p_address;
  RETURN 'deleted';
END; $$;
REVOKE ALL ON FUNCTION public.archive_address(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_address(uuid) TO authenticated, service_role;

-- ── 7. Fixed dishes ("same dish every day") ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_meal_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  meal_slot        text NOT NULL CHECK (meal_slot IN ('lunch', 'dinner')),
  day_of_week      smallint CHECK (day_of_week BETWEEN 0 AND 6),  -- Mon=0; NULL = every day
  meal_template_id text NOT NULL REFERENCES public.meal_templates(id) ON DELETE CASCADE,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_meal_rules_one
  ON public.customer_meal_rules (user_id, meal_slot, COALESCE(day_of_week, -1));
ALTER TABLE public.customer_meal_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_meal_rules FROM anon, authenticated;
GRANT ALL ON public.customer_meal_rules TO service_role;
