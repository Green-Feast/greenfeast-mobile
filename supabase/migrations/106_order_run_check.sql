-- 106: A check after the night order run (2026-11-21).
--
-- 1:15 AM IST, right after the 1 AM run: any lunch / dinner from today on that
-- has (a) a default meal made after the customer skipped or cancelled it, or
-- (b) two default meals, is reported to the admins (Alerts, kind
-- 'order_run_check') with who, when and which meal — so a mistake like
-- 19–21 Nov is caught the same night, not from customers after delivery.
-- order_run_check() can also be run by hand any time; it changes nothing.

CREATE OR REPLACE FUNCTION public.order_run_check()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_rows  jsonb;
  v_n     integer;
  v_list  text;
BEGIN
  WITH remade AS (
    SELECT n.user_id, n.delivery_date, n.meal_slot, 'made again after a skip' AS what
      FROM orders n
     WHERE NOT n.walk_in AND n.delivery_date >= v_today AND n.item_kind = 'meal' AND NOT n.extra_dish
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
END; $$;
REVOKE ALL ON FUNCTION public.order_run_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_run_check() TO service_role;

DO $cron$
BEGIN
  PERFORM cron.unschedule('gf-order-run-check');
EXCEPTION WHEN OTHERS THEN NULL;
END $cron$;
-- 19:45 UTC = 1:15 AM IST, after the 1 AM order run.
SELECT cron.schedule('gf-order-run-check', '45 19 * * *', 'SELECT public.order_run_check()');
