-- 105: The order run can never make a meal twice (2026-11-21).
--
-- 19–21 Nov: the nightly order run re-made the default meal for lunches and
-- dinners customers had skipped (its "slot taken" check counted only live
-- meals). 26 meals were re-made; 9 were delivered and charged. The run's own
-- check is fixed (instantiate-orders), and now make_default_cart — the only
-- thing that creates a default meal — refuses on its own as well, under a
-- per-slot lock, so no caller and no overlap of runs can bring a skip back.

CREATE OR REPLACE FUNCTION public.make_default_cart(p_sub uuid, p_date date, p_slot text, p_address uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s       record;
  v_m     integer := plan_slot_meals(p_sub, p_slot);
  v_d     integer := plan_slot_drinks(p_sub, p_slot);
  v_dish  text;
  v_drink text;
  v_seq   integer;
  v_id    uuid;
  n       integer := 0;
BEGIN
  SELECT id, user_id INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND OR v_m <= 0 THEN RETURN 0; END IF;

  -- Never make a slot twice (105). One run at a time per slot (two order runs
  -- for the same customer can overlap: the 1 AM check, a payment, a gift…),
  -- then: a slot that has any meal, delivered or not, or was skipped, or was
  -- cancelled for a reason (pause, kitchen closed, wallet…) is left alone.
  -- Only removed extras (cancelled, no reason) and days the plan doesn't
  -- deliver ('off_day') don't count — resync_plan_orders clears a slot's
  -- open meals before it remakes them, so that path still works.
  PERFORM pg_advisory_xact_lock(hashtextextended('default_cart|' || p_sub::text || '|' || p_date::text || '|' || p_slot, 0));
  IF EXISTS (SELECT 1 FROM orders
              WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in
                AND (status <> 'cancelled' OR COALESCE(skip_reason, 'off_day') <> 'off_day')) THEN
    RETURN 0;
  END IF;
  -- The customer's / office's fixed dish, then the weekly menu, then the
  -- plan's own dish for that weekday (subscription_schedule) when the menu has none.
  v_dish := COALESCE(plan_default_dish(s.user_id, p_date, p_slot),
                     (SELECT meal_template_id FROM subscription_schedule
                       WHERE subscription_id = p_sub AND day_of_week = trim(to_char(p_date, 'Dy'))));
  IF v_dish IS NULL THEN RETURN 0; END IF;

  SELECT COALESCE(max(slot_seq) + 1, 0) INTO v_seq FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in;

  INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                      quantity, unit_price, item_kind, extra_dish, slot_seq, is_customized, address_id)
  VALUES (s.user_id, p_sub, v_dish, p_date, p_slot, 'scheduled',
          v_m, item_unit_price(p_sub, v_dish), 'meal', false, v_seq,
          plan_rule_dish(s.user_id, p_date, p_slot) IS NOT NULL, p_address)
  RETURNING id INTO v_id;
  PERFORM snapshot_order_ingredients(v_id);
  INSERT INTO order_addons (order_id, addon_id, sub_option, quantity, unit_price, is_plan)
  SELECT v_id, sa.addon_id, sa.sub_option, v_m, a.price_per_meal, true
    FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
   WHERE sa.subscription_id = p_sub AND NOT a.is_drink;
  PERFORM recompute_order_cart(v_id);
  n := 1;

  IF v_d > 0 THEN
    v_drink := slot_default_drink(p_date, p_slot);
    IF v_drink IS NOT NULL THEN
      INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                          quantity, unit_price, item_kind, extra_dish, slot_seq, address_id)
      VALUES (s.user_id, p_sub, v_drink, p_date, p_slot, 'scheduled',
              v_d, drink_price(), 'drink', true, v_seq + 1, p_address)
      RETURNING id INTO v_id;
      PERFORM snapshot_order_ingredients(v_id);
      PERFORM recompute_order_cart(v_id);
      n := n + 1;
    END IF;
  END IF;
  RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.make_default_cart(uuid, date, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.make_default_cart(uuid, date, text, uuid) TO service_role;
