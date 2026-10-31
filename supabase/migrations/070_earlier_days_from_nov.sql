-- ============================================================
-- GreenFeast — Migration 070: earlier-days check starts 1 Nov 2026
-- ============================================================
-- The meals left unmarked before November are as the office wants them, so
-- the 9:30 AM "Earlier days … never marked delivered" alert (068) only looks
-- at days from 2026-11-01 on. The admin's Operations panel and customer
-- profile use the same start (EARLIER_DAYS_FROM in greenfeast-admin).

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
         WHERE o.delivery_date BETWEEN GREATEST(v_today - 30, DATE '2026-11-01') AND v_today - 1
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
