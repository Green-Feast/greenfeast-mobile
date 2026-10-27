-- ============================================================
-- GreenFeast — Migration 069: renewing before the meals run out
-- ============================================================
-- The app offers Renew from 2 meals left — the point the renewal reminder goes
-- out. A renewal paid while the old plan still had meals used to get stuck:
-- the old plan wasn't finished, so retire_previous_subscriptions() left it
-- live, the one-live-plan index (049) kept the new plan from activating, and
-- the payment sat in the wallet with the new plan pending for good.
--
-- A renewal now continues the plan it renews (subscriptions.renewed_from): on
-- payment that plan closes and everything still to come moves across — its
-- undelivered orders, at the price they were bought at (the wallet already
-- holds that money), and its meal count, kept in carried_meals and added to
-- the new plan's meals on activation (cashfree-webhook, admin activatePendingPlan).
-- Only from a running plan with no cash due; renew-subscription refuses the
-- rest before any payment. Other finished plans retire as before.
--
-- Also: the customer insert guard (050/052) predates coupons (066). A customer
-- could create their own pending plan with any meal_price_paise / coupon_id,
-- and every meal would then be billed at that price after a full-price payment.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS carried_meals integer NOT NULL DEFAULT 0 CHECK (carried_meals >= 0);

CREATE OR REPLACE FUNCTION public.retire_previous_subscriptions(p_new_sub uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid;
  v_from  uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  old     record;
  n       integer := 0;
BEGIN
  SELECT user_id, renewed_from INTO v_user, v_from FROM subscriptions WHERE id = p_new_sub;
  IF v_user IS NULL THEN RETURN 0; END IF;

  FOR old IN
    SELECT id, batch_id_lunch, batch_id_dinner, deliveries_remaining
      FROM subscriptions
     WHERE user_id = v_user
       AND id <> p_new_sub
       AND status IN ('active', 'paused')
       AND (deliveries_remaining <= 0
            -- The plan this one renews, renewed early: running, nothing owed.
            OR (id = v_from AND status = 'active' AND COALESCE(cod_due_paise, 0) = 0))
     ORDER BY created_at DESC
     FOR UPDATE
  LOOP
    IF old.id = v_from THEN
      UPDATE subscriptions SET status = 'expired', deliveries_remaining = 0, updated_at = now()
       WHERE id = old.id;

      -- What's still to come moves over, with its meals. A slot the new plan
      -- already has can't take a second order: that one is dropped instead.
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

      UPDATE subscriptions
         SET carried_meals = carried_meals + GREATEST(old.deliveries_remaining, 0)
       WHERE id = p_new_sub;
    ELSE
      UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE id = old.id;

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
  NEW.carried_meals := 0;
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
  -- Set only from a paid, server-priced coupon (apply_payment_coupon, 066).
  NEW.meal_price_paise := NULL;
  NEW.coupon_id := NULL;
  RETURN NEW;
END; $$;

NOTIFY pgrst, 'reload schema';
