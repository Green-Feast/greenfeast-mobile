-- 108: Skip ahead (2026-11-21).
--
-- A customer can skip a lunch / dinner before its meal exists — any day the
-- plan delivers, before next week's meals are made on Sunday. The skip is
-- saved at once: the slot's default meal is made and marked skipped in one
-- locked step (skip_ahead), so Sunday's run — which never makes a slot that
-- has an order (105) — leaves it skipped, and nothing is charged. My Plan shows
-- "You skipped this lunch" with Undo skip from that moment.
--
-- Undo skip of a skipped DEFAULT meal (unskip_default_slot): the meal is made
-- fresh — today's dish and prices, not the ones from when it was skipped — or,
-- before Sunday's run has reached that day, the skip is just removed and the
-- run makes the meal. A cart the customer customized comes back as they set it
-- (manage-subscription revives those rows).
--
-- order_run_check (106) no longer counts a cart the customer saved after a
-- skip (cart_edited) as "made again after a skip".

-- ── Skip ahead ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.skip_ahead(p_sub uuid, p_date date, p_slot text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_user  uuid;
  v_addr  uuid;
  v_made  integer;
BEGIN
  IF p_slot NOT IN ('lunch', 'dinner') OR p_date < v_today OR p_date > v_today + 28 THEN RETURN 0; END IF;
  IF is_slot_locked(p_date, p_slot) THEN RETURN 0; END IF;
  -- Only a meal the plan would deliver (its day, its slot, not paused / closed).
  IF NOT slot_default_applies(p_sub, p_date, p_slot) THEN RETURN 0; END IF;

  -- Same per-slot lock as make_default_cart / save_day_cart.
  PERFORM pg_advisory_xact_lock(hashtextextended('default_cart|' || p_sub::text || '|' || p_date::text || '|' || p_slot, 0));
  IF EXISTS (SELECT 1 FROM orders WHERE subscription_id = p_sub AND delivery_date = p_date
                AND meal_slot = p_slot AND NOT walk_in) THEN
    RETURN 0;   -- the slot already has its meal: the normal skip handles it
  END IF;

  SELECT user_id INTO v_user FROM subscriptions WHERE id = p_sub;
  SELECT id INTO v_addr FROM addresses WHERE user_id = v_user AND archived_at IS NULL
   ORDER BY is_default DESC, created_at LIMIT 1;
  v_made := make_default_cart(p_sub, p_date, p_slot, v_addr);
  IF v_made > 0 THEN
    UPDATE orders SET status = 'skipped', skip_reason = 'user', updated_at = now()
     WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot
       AND NOT walk_in AND status = 'scheduled';
  END IF;
  RETURN v_made;
END; $$;
REVOKE ALL ON FUNCTION public.skip_ahead(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skip_ahead(uuid, date, text) TO service_role;

-- ── Undo skip of a skipped default meal ─────────────────────────────────────
-- Returns the meals made (0 when the day's meals come with Sunday's run).
CREATE OR REPLACE FUNCTION public.unskip_default_slot(p_sub uuid, p_date date, p_slot text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user  uuid;
  v_addr  uuid;
  v_gone  integer;
BEGIN
  IF is_slot_locked(p_date, p_slot) THEN
    RAISE EXCEPTION 'Too late — this meal has already locked for the day.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('default_cart|' || p_sub::text || '|' || p_date::text || '|' || p_slot, 0));
  IF EXISTS (SELECT 1 FROM orders WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot
                AND NOT walk_in AND status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery', 'delivered')) THEN
    RAISE EXCEPTION 'This % already has a meal — change it in Customize.', p_slot;
  END IF;

  SELECT COALESCE(a.address_id, NULL) INTO v_addr
    FROM (SELECT address_id FROM orders WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot
             AND NOT walk_in AND address_id IS NOT NULL LIMIT 1) a;
  DELETE FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in
     AND status = 'skipped' AND skip_reason = 'user' AND NOT cart_edited;
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  IF v_gone = 0 THEN RAISE EXCEPTION 'There''s no skipped meal to bring back.'; END IF;

  -- Before Sunday's run reaches the day, the run makes it (with the week's menu).
  IF p_date > menu_published_until() THEN RETURN 0; END IF;

  IF v_addr IS NULL THEN
    SELECT user_id INTO v_user FROM subscriptions WHERE id = p_sub;
    SELECT id INTO v_addr FROM addresses WHERE user_id = v_user AND archived_at IS NULL
     ORDER BY is_default DESC, created_at LIMIT 1;
  END IF;
  RETURN make_default_cart(p_sub, p_date, p_slot, v_addr);
END; $$;
REVOKE ALL ON FUNCTION public.unskip_default_slot(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unskip_default_slot(uuid, date, text) TO service_role;

-- ── order_run_check: a cart the customer saved after a skip is theirs ───────
CREATE OR REPLACE FUNCTION public.order_run_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rows  jsonb;
  v_n     integer;
  v_list  text;
BEGIN
  WITH remade AS (
    SELECT n.user_id, n.delivery_date, n.meal_slot, 'made again after a skip' AS what
      FROM orders n
     WHERE NOT n.walk_in AND n.delivery_date >= v_today AND n.item_kind = 'meal' AND NOT n.extra_dish AND NOT n.cart_edited
       AND n.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')
       AND EXISTS (SELECT 1 FROM orders s
                    WHERE s.subscription_id = n.subscription_id AND s.delivery_date = n.delivery_date
                      AND s.meal_slot = n.meal_slot AND NOT s.walk_in AND s.created_at < n.created_at
                      AND (s.status = 'skipped'
                           OR (s.status = 'cancelled' AND COALESCE(s.skip_reason, 'off_day') <> 'off_day')))
  ), doubled AS (
    SELECT o.user_id, o.delivery_date, o.meal_slot, 'two default meals' AS what
      FROM orders o
     WHERE NOT o.walk_in AND o.delivery_date >= v_today AND o.item_kind = 'meal' AND NOT o.extra_dish
       AND o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')
     GROUP BY o.user_id, o.delivery_date, o.meal_slot
    HAVING count(*) > 1
  ), found AS (
    SELECT DISTINCT * FROM (SELECT * FROM remade UNION ALL SELECT * FROM doubled) x
  )
  SELECT count(*),
         string_agg(format('%s (%s) — %s %s: %s', COALESCE(u.name, 'Customer'), COALESCE(u.customer_code, '?'),
                           to_char(f.delivery_date, 'Dy FMDD Mon'), f.meal_slot, f.what), E'\n' ORDER BY f.delivery_date, u.name),
         COALESCE(jsonb_agg(jsonb_build_object('user_id', f.user_id, 'date', f.delivery_date, 'slot', f.meal_slot, 'what', f.what)), '[]'::jsonb)
    INTO v_n, v_list, v_rows
    FROM found f LEFT JOIN users u ON u.id = f.user_id
   WHERE NOT COALESCE(u.is_test, false);

  IF v_n > 0 THEN
    PERFORM notify_admins('order_run_check',
      format('Order run check: %s meal%s to look at', v_n, CASE WHEN v_n = 1 THEN '' ELSE 's' END),
      left(v_list, 900) || E'\nOpen the customer and fix it before the 9 AM / 2 PM cutoff.',
      '/kitchen');
  END IF;
  RETURN jsonb_build_object('found', v_n, 'rows', v_rows);
END; $function$;
REVOKE ALL ON FUNCTION public.order_run_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_run_check() TO service_role;
