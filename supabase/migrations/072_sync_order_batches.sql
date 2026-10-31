-- ============================================================
-- GreenFeast — Migration 072: upcoming meals re-take their address's batch
-- ============================================================
-- A meal's batch comes from its address (052: on insert / address change, and
-- when the address moves batch). Meals can still end up out of step — Ishika,
-- 1 Nov: address on Santu Ji Batch, her 3 and 5 Nov lunches with no batch
-- since a change on 29 Oct — and then they're on no rider's route. Nightly at
-- 00:30 IST (before the 1 AM order run) every upcoming open meal is set to its
-- address's batch for that slot; also run once now.

CREATE OR REPLACE FUNCTION public.sync_order_batches()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  UPDATE orders o
     SET batch_id = CASE WHEN o.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END,
         updated_at = now()
    FROM addresses a
   WHERE a.id = o.address_id
     AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
     AND o.status IN ('scheduled', 'confirmed', 'preparing')
     AND o.batch_id IS DISTINCT FROM (CASE WHEN o.meal_slot = 'dinner' THEN a.batch_id_dinner ELSE a.batch_id_lunch END);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.sync_order_batches() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('gf-sync-order-batches') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gf-sync-order-batches');
SELECT cron.schedule('gf-sync-order-batches', '0 19 * * *', $$SELECT public.sync_order_batches()$$);

SELECT public.sync_order_batches();
