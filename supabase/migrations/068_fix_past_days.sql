-- ============================================================
-- GreenFeast — Migration 068: fixing past days from the admin
-- ============================================================
-- Ops sometimes forget to mark meals delivered, so the customer's wallet
-- never shows the charge. The admin can now settle any earlier day
-- (Operations and the customer's day editor): mark delivered (billed by
-- advance_order_delivered as always), skip with no charge, or undo a wrong
-- "delivered" — below.
--
-- 1. undo_order_delivered(order): a meal marked delivered that wasn't →
--    "couldn't be delivered" (skipped, not_delivered), the wallet gets back
--    exactly what it was charged, the meal goes back on the plan, and the
--    customer is told (template delivery_reversed). Once per meal.
-- 2. The 9:30 AM reminder (admin_delivery_reminder 'yesterday') now lists
--    every earlier day in the last 30 with meals not marked, not only
--    yesterday.
-- ============================================================

INSERT INTO public.notification_templates
  (key, sort_order, label, description, placeholders, title, body, default_title, default_body)
VALUES
  ('delivery_reversed', 170, 'Delivery corrected — refunded',
   'Admin undoes a meal marked delivered by mistake: the charge goes back to the wallet and the meal back on the plan.',
   '{name,slot,date,amount}',
   'We''ve corrected your {slot}',
   'Your {slot} on {date} wasn''t delivered, so {amount} is back in your wallet and the meal is back on your plan.',
   'We''ve corrected your {slot}',
   'Your {slot} on {date} wasn''t delivered, so {amount} is back in your wallet and the meal is back on your plan.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.undo_order_delivered(p_order uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o        record;
  v_charge integer;
  v_meals  integer;
BEGIN
  SELECT id, user_id, subscription_id, status, quantity, meal_slot, delivery_date
    INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meal not found.';
  END IF;
  IF o.status <> 'delivered' THEN
    RAISE EXCEPTION 'This meal isn''t marked delivered.';
  END IF;

  -- Exactly what delivering it took from the wallet (reference = order id).
  SELECT COALESCE(sum(amount), 0)::integer INTO v_charge
    FROM public.wallet_transactions
   WHERE user_id = o.user_id AND type = 'debit' AND reference_id = p_order::text;
  v_meals := COALESCE(o.quantity, 1);

  UPDATE public.orders
     SET status = 'skipped', skip_reason = 'not_delivered', delivered_at = NULL, updated_at = now()
   WHERE id = p_order;

  -- Reference undo_<order>: wallet_credit ignores a second credit with it.
  PERFORM public.wallet_credit(
    o.user_id, v_charge,
    format('Refund — %s on %s wasn''t delivered', o.meal_slot, to_char(o.delivery_date, 'FMDD Mon')),
    'undo_' || p_order::text);

  -- The meal goes back on the plan (a finished/renewed plan stays closed).
  UPDATE public.subscriptions
     SET deliveries_remaining = deliveries_remaining + v_meals, updated_at = now()
   WHERE id = o.subscription_id AND status IN ('active', 'paused');

  PERFORM public.notify_event(o.user_id, 'delivery_reversed',
    jsonb_build_object('slot', o.meal_slot, 'date', to_char(o.delivery_date, 'Dy FMDD Mon'),
                       'amount', public.fmt_rupees(v_charge)),
    'order_update');

  RETURN jsonb_build_object('refunded', v_charge, 'meals_back', v_meals);
END; $$;
REVOKE ALL ON FUNCTION public.undo_order_delivered(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_order_delivered(uuid) TO service_role;

-- ── The 9:30 AM reminder covers every earlier day ───────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delivery_reminder(p_slot text, p_stage text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_total integer;
  v_list  text;
  v_first date;
  v_slot  text := CASE p_slot WHEN 'dinner' THEN 'Dinner' WHEN 'lunch' THEN 'Lunch' ELSE 'Meals' END;
BEGIN
  IF p_stage = 'yesterday' THEN
    -- Every earlier day (last 30) with meals never marked delivered, by day.
    SELECT sum(n), string_agg(label || ' ' || n, ' · ' ORDER BY d), min(d)
      INTO v_total, v_list, v_first
      FROM (
        SELECT o.delivery_date AS d, to_char(o.delivery_date, 'Dy FMDD Mon') AS label, count(*)::int AS n
          FROM public.orders o
          JOIN public.users u ON u.id = o.user_id
         WHERE o.delivery_date BETWEEN v_today - 30 AND v_today - 1
           AND (p_slot = 'all' OR o.meal_slot = p_slot)
           AND NOT u.is_test
           AND o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')
         GROUP BY 1, 2
      ) x;
    IF COALESCE(v_total, 0) = 0 THEN
      RETURN 0;
    END IF;
    PERFORM public.notify_admins('reminder_yesterday',
      format('Earlier days: %s meal%s never marked delivered', v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END),
      v_list || '. Open each day in Operations and mark them delivered, or skip the ones that didn''t go.',
      '/operations?date=' || v_first::text);
    RETURN v_total;
  END IF;

  SELECT sum(n), string_agg(batch || ' ' || n, ' · ' ORDER BY batch)
    INTO v_total, v_list
    FROM (
      SELECT COALESCE(btrim(b.name), 'Unassigned') AS batch, count(*)::int AS n
        FROM public.orders o
        JOIN public.users u ON u.id = o.user_id
        LEFT JOIN public.batches b ON b.id = o.batch_id
       WHERE o.delivery_date = v_today
         AND (p_slot = 'all' OR o.meal_slot = p_slot)
         AND NOT u.is_test
         AND CASE WHEN p_stage = 'out' THEN o.status IN ('scheduled', 'confirmed', 'preparing')
                  ELSE o.status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery') END
       GROUP BY 1
    ) x;

  IF COALESCE(v_total, 0) = 0 THEN
    RETURN 0;
  END IF;

  IF p_stage = 'out' THEN
    PERFORM public.notify_admins('reminder_out',
      format('%s: %s meal%s not out for delivery', v_slot, v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END),
      v_list || '. Mark them in Operations (or partners do it in their app).',
      '/operations');
  ELSE
    PERFORM public.notify_admins('reminder_delivered',
      format('%s: %s meal%s not marked delivered', v_slot, v_total, CASE WHEN v_total = 1 THEN '' ELSE 's' END),
      v_list || '. Customers aren''t charged until a meal is marked delivered.',
      '/operations');
  END IF;
  RETURN v_total;
END; $$;
REVOKE ALL ON FUNCTION public.admin_delivery_reminder(text, text) FROM PUBLIC, anon, authenticated;
