-- orders.batch_id is a snapshot taken at instantiate-orders time and kept in
-- sync only when a subscription is reassigned through the admin's batch
-- actions (moveSubscriberToBatch / changeBatch), which call
-- syncFutureOrdersBatch. Batch reassignments that happened before that sync
-- helper existed (or through any other path) left a backlog of not-yet-
-- settled orders whose batch_id no longer matches their subscription's
-- current per-slot batch — e.g. a subscriber correctly shows as assigned on
-- the Batches page, but their already-created order for today still carries
-- the old (or null) batch_id, so it shows under "Unassigned" in Operations.
-- One-time repair: bring every current, not-yet-settled order in line with
-- its subscription's batch for that slot.
UPDATE public.orders o
SET batch_id = CASE WHEN o.meal_slot = 'lunch' THEN s.batch_id_lunch ELSE s.batch_id_dinner END
FROM public.subscriptions s
WHERE s.id = o.subscription_id
  AND o.delivery_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date
  AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
  AND o.batch_id IS DISTINCT FROM (CASE WHEN o.meal_slot = 'lunch' THEN s.batch_id_lunch ELSE s.batch_id_dinner END);
