-- ============================================================
-- GreenFeast — Migration 079: the wallet is the plan
-- ============================================================
-- A plan is now money worth 5 / 15 / 30 / 60 default meals, and nothing else.
-- Add-ons, extra portions and extra dishes come out of the same wallet, so they
-- simply leave fewer meals. There is no separate meal counter any more:
--
--   one meal's worth   default_meal_cost(sub) = the plan's meal price (its
--                      coupon price if bought with one, 066) + the plan's
--                      default add-ons, per portion — what a default order costs
--   meals left         floor((wallet + cash still owed on the plan) / that)
--
-- subscriptions.deliveries_remaining keeps its name and stays the column every
-- reader uses (app, admin, crons, renewal_credit), but on a live plan (active /
-- paused) it is now always that estimate: a BEFORE trigger sets it on every
-- write to the plan, and the wallet / default add-ons refresh it when they
-- change. Writes to it on a live plan are therefore ignored — the old
-- decrements in billing (052), the +1 in undo_order_delivered (068), the
-- activation values in cashfree-webhook / the admin — so those keep working
-- unchanged. carried_meals (069) is no longer used: the money carries over by
-- itself.
--
-- The plan is finished when the wallet can't pay for one default meal.
-- Customers can't top up any more (wallet-topup refuses); they renew.
--
-- Also here:
--  * retire_previous_subscriptions: when a plan starts, every other live plan
--    of the customer closes and hands over its meals still to come. It used to
--    close only plans with 0 meals left — but crediting the new plan's money
--    now makes the old plan's estimate > 0 too, and two live plans can't exist
--    (049), so the new one would never start.
--  * schedulable_paise(user): the money instantiate-orders may still schedule
--    meals against (it schedules by money now, not by meal count).
--  * enforce_slot_balance: a base meal the wallet can't cover, when the wallet
--    is below one default meal, is "plan finished" (renew), not "low balance".
--  * Messages that said "top up" now say "renew".
--  * Plans already finished but holding a meal's worth or more close instead of
--    restarting on that money (it comes off their next plan).
--  * Switch-over: every live plan's meals left is recalculated from its wallet.

-- ── One meal's worth ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.addons_per_meal(p_sub uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(a.price_per_meal), 0)::integer
    FROM public.subscription_addons sa
    JOIN public.addons a ON a.id = sa.addon_id
   WHERE sa.subscription_id = p_sub
$$;

CREATE OR REPLACE FUNCTION public.default_meal_cost(p_sub uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.subscription_meal_rate(p_sub) + public.addons_per_meal(p_sub)
$$;

-- Meals that much money pays for. Cash still owed on the plan counts: the
-- customer has bought those meals (app cash-on-delivery signups, admin plans).
CREATE OR REPLACE FUNCTION public.meals_left_for(p_user uuid, p_cost integer, p_cod_due integer)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN COALESCE(p_cost, 0) <= 0 THEN 0
    ELSE GREATEST(floor(
           (COALESCE((SELECT w.balance FROM public.wallets w WHERE w.user_id = p_user), 0)
            + COALESCE(p_cod_due, 0))::numeric / p_cost), 0)::integer
  END
$$;

CREATE OR REPLACE FUNCTION public.meals_left_estimate(p_sub uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.meals_left_for(s.user_id, public.default_meal_cost(s.id), s.cod_due_paise)
    FROM public.subscriptions s WHERE s.id = p_sub
$$;

REVOKE ALL ON FUNCTION public.addons_per_meal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.default_meal_cost(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meals_left_for(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meals_left_estimate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.addons_per_meal(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.default_meal_cost(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.meals_left_for(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.meals_left_estimate(uuid) TO service_role;

-- For the app: the signed-in customer's live plan — one meal's worth and the
-- wallet it's measured against. Nothing for anyone else.
CREATE OR REPLACE FUNCTION public.my_meal_cost()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'subscription_id', s.id,
           'meal_cost', public.default_meal_cost(s.id),
           'meals_left', s.deliveries_remaining,
           'wallet', COALESCE((SELECT w.balance FROM public.wallets w WHERE w.user_id = s.user_id), 0),
           'cash_due', COALESCE(s.cod_due_paise, 0))
    FROM public.subscriptions s
   WHERE s.user_id = auth.uid() AND s.status IN ('active', 'paused')
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.my_meal_cost() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_meal_cost() TO authenticated;

-- ── deliveries_remaining follows the wallet ─────────────────────────────────
-- Uses NEW's own price fields: in a BEFORE trigger the row isn't written yet.
CREATE OR REPLACE FUNCTION public.subscriptions_meals_left()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('active', 'paused') THEN
    NEW.deliveries_remaining := public.meals_left_for(
      NEW.user_id,
      COALESCE(NEW.meal_price_paise, public.plan_meal_rate(NEW.plan_id)) + public.addons_per_meal(NEW.id),
      NEW.cod_due_paise);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.subscriptions_meals_left() FROM PUBLIC, anon, authenticated;

-- Fires after subscriptions_guard_customer_insert (alphabetical), so a
-- customer's own insert is already forced to 'pending' and left alone.
DROP TRIGGER IF EXISTS subscriptions_meals_left ON public.subscriptions;
CREATE TRIGGER subscriptions_meals_left
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.subscriptions_meals_left();

-- Touch the customer's live plan so the trigger above recalculates it; only
-- when the number actually changes.
CREATE OR REPLACE FUNCTION public.refresh_meals_left(p_user uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.subscriptions s
     SET deliveries_remaining = public.meals_left_estimate(s.id)
   WHERE s.user_id = p_user
     AND s.status IN ('active', 'paused')
     AND s.deliveries_remaining IS DISTINCT FROM public.meals_left_estimate(s.id)
$$;
REVOKE ALL ON FUNCTION public.refresh_meals_left(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_meals_left(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.wallets_refresh_meals_left()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.refresh_meals_left(NEW.user_id);
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.wallets_refresh_meals_left() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS wallets_refresh_meals_left ON public.wallets;
CREATE TRIGGER wallets_refresh_meals_left
  AFTER INSERT OR UPDATE OF balance ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.wallets_refresh_meals_left();

CREATE OR REPLACE FUNCTION public.subscription_addons_refresh_meals_left()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.subscriptions
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.subscription_id ELSE NEW.subscription_id END;
  IF v_user IS NOT NULL THEN
    PERFORM public.refresh_meals_left(v_user);
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.subscription_addons_refresh_meals_left() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS subscription_addons_refresh_meals_left ON public.subscription_addons;
CREATE TRIGGER subscription_addons_refresh_meals_left
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_addons
  FOR EACH ROW EXECUTE FUNCTION public.subscription_addons_refresh_meals_left();

-- ── Money still free to schedule meals against ──────────────────────────────
-- Wallet + cash owed on the live plan − every meal already made and not yet
-- billed (extras included). Days before 1 Nov are left unmarked on purpose (070).
CREATE OR REPLACE FUNCTION public.schedulable_paise(p_user uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet integer;
  v_due    integer;
  v_open   integer;
BEGIN
  SELECT COALESCE(balance, 0) INTO v_wallet FROM wallets WHERE user_id = p_user;
  SELECT COALESCE(SUM(COALESCE(cod_due_paise, 0)), 0)::integer INTO v_due
    FROM subscriptions WHERE user_id = p_user AND status IN ('active', 'paused');
  SELECT COALESCE(SUM(recompute_order_cart(o.id)), 0)::integer INTO v_open
    FROM orders o
   WHERE o.user_id = p_user
     AND o.delivery_date >= DATE '2026-11-01'
     AND o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery');
  RETURN COALESCE(v_wallet, 0) + COALESCE(v_due, 0) - COALESCE(v_open, 0);
END; $$;
REVOKE ALL ON FUNCTION public.schedulable_paise(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedulable_paise(uuid) TO service_role;

-- ── A new plan closes every other live plan ─────────────────────────────────
-- Same hand-over as 069's early renewal, now for any live plan with no cash
-- owed: its meals still to come move to the new plan at the price they were
-- made at (the wallet holds that money). A plan with cash still owed closes as
-- before — its future meals are cancelled and the cash stays recorded on it.
CREATE OR REPLACE FUNCTION public.retire_previous_subscriptions(p_new_sub uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  old     record;
  n       integer := 0;
BEGIN
  SELECT user_id INTO v_user FROM subscriptions WHERE id = p_new_sub;
  IF v_user IS NULL THEN RETURN 0; END IF;

  FOR old IN
    SELECT id, batch_id_lunch, batch_id_dinner, cod_due_paise
      FROM subscriptions
     WHERE user_id = v_user
       AND id <> p_new_sub
       AND status IN ('active', 'paused')
     ORDER BY created_at DESC
     FOR UPDATE
  LOOP
    UPDATE subscriptions SET status = 'expired', deliveries_remaining = 0, updated_at = now()
     WHERE id = old.id;

    IF COALESCE(old.cod_due_paise, 0) = 0 THEN
      -- What's still to come moves over. A slot the new plan already has
      -- can't take a second order: that one is dropped instead.
      UPDATE orders o
         SET subscription_id = p_new_sub, updated_at = now()
       WHERE o.subscription_id = old.id
         AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
         AND NOT EXISTS (SELECT 1 FROM orders x
                          WHERE x.subscription_id = p_new_sub
                            AND x.delivery_date = o.delivery_date
                            AND x.meal_slot = o.meal_slot
                            AND x.slot_seq = o.slot_seq);
      UPDATE orders SET status = 'cancelled', updated_at = now()
       WHERE subscription_id = old.id
         AND status IN ('scheduled', 'confirmed');
    ELSE
      UPDATE orders SET status = 'cancelled', updated_at = now()
       WHERE subscription_id = old.id
         AND status IN ('scheduled', 'confirmed')
         AND (delivery_date > v_today
              OR (delivery_date = v_today AND NOT is_slot_locked(delivery_date, meal_slot)));
    END IF;

    UPDATE subscriptions
       SET batch_id_lunch  = COALESCE(batch_id_lunch, old.batch_id_lunch),
           batch_id_dinner = COALESCE(batch_id_dinner, old.batch_id_dinner)
     WHERE id = p_new_sub;

    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.retire_previous_subscriptions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retire_previous_subscriptions(uuid) TO service_role;

-- ── Cutoff check: an empty wallet means the plan is finished ────────────────
-- As in 052, plus: a base meal the wallet can't cover when what's left is less
-- than one default meal is "plan finished" (renew), not "low balance".
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
      SELECT id, subscription_id, extra_dish FROM orders
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
      ELSIF NOT COALESCE(ord.extra_dish, false)
            AND v_available < public.default_meal_cost(ord.subscription_id) THEN
        UPDATE orders SET status = 'skipped', skip_reason = 'plan_finished', updated_at = now()
         WHERE id = ord.id;
        v_skipped := v_skipped + 1;
        v_done := true;
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

-- ── Messages: renew, not top up ─────────────────────────────────────────────
-- Only where ops haven't already reworded them.
UPDATE public.notification_templates
   SET body = 'Your wallet didn''t cover your {slot} on {date}. Renew your plan in the app to keep your meals coming.'
 WHERE key = 'delivery_not_covered'
   AND body = 'Your wallet didn''t cover your {slot} on {date}. Top up to keep future deliveries.';
UPDATE public.notification_templates
   SET body = 'Your wallet didn''t have enough for today''s {slot}, so it wasn''t prepared. Renew your plan in the app to keep your meals coming.'
 WHERE key = 'skipped_low_balance'
   AND body = 'Your wallet didn''t cover today''s {slot}, so it wasn''t prepared. Top up in the app to keep your next meals coming.';
UPDATE public.notification_templates
   SET body = 'Your wallet has run out, so today''s {slot} wasn''t prepared. Renew your plan in the app to keep your meals coming.'
 WHERE key = 'plan_finished'
   AND body = 'All the meals on your plan have been used, so today''s {slot} wasn''t prepared. Renew your plan in the app to keep your meals coming.';
UPDATE public.notification_templates
   SET title = 'Your wallet is running low',
       body = 'Tomorrow''s meals need {need} but your wallet will have {balance}. Renew your plan before 9 AM so nothing gets skipped.'
 WHERE key = 'low_balance_warning'
   AND body = 'Tomorrow''s meals need {need} but your wallet will have {balance}. Top up before 9 AM so nothing gets skipped.';

-- ── One-off: finished plans stay finished (decided 2026-11-10) ──────────────
-- Plans that had used up their meals (0 left) but still hold a meal's worth or
-- more in the wallet would otherwise restart on that money at the next order
-- run. They close instead; the money stays in the wallet and comes off their
-- next plan (078 — an expired plan isn't counted against it).
UPDATE public.subscriptions s
   SET status = 'expired', updated_at = now()
 WHERE s.status IN ('active', 'paused')
   AND s.deliveries_remaining <= 0
   AND public.meals_left_estimate(s.id) > 0;

-- ── Switch-over: every live plan's meals left now comes from its wallet ─────
UPDATE public.subscriptions s
   SET deliveries_remaining = public.meals_left_estimate(s.id)
 WHERE s.status IN ('active', 'paused')
   AND s.deliveries_remaining IS DISTINCT FROM public.meals_left_estimate(s.id);

NOTIFY pgrst, 'reload schema';
