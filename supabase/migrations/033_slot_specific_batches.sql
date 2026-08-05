-- Batches become meal-slot-specific: a batch is either a lunch route or a
-- dinner route, never both. This lets the same subscriber ride a different
-- batch (partner/route) for lunch than for dinner.
ALTER TABLE public.batches ADD COLUMN meal_slot TEXT CHECK (meal_slot IN ('lunch', 'dinner'));

-- Backfill existing batches from their time_window: "evening" batches were
-- already the de-facto dinner run (see BATCH_COLORS' "Evening" entry in the
-- admin app), everything else (morning/noon) was lunch.
UPDATE public.batches SET meal_slot = CASE WHEN time_window = 'evening' THEN 'dinner' ELSE 'lunch' END;
ALTER TABLE public.batches ALTER COLUMN meal_slot SET NOT NULL;

-- A subscription can now be assigned a batch per slot independently — needed
-- because a subscriber can add a dinner (or lunch) meal on top of a plan that
-- doesn't include it by default, and that meal still needs a route to ride.
ALTER TABLE public.subscriptions ADD COLUMN batch_id_lunch UUID REFERENCES public.batches(id) ON DELETE SET NULL;
ALTER TABLE public.subscriptions ADD COLUMN batch_id_dinner UUID REFERENCES public.batches(id) ON DELETE SET NULL;

-- Backfill: whatever single batch a subscriber was in becomes their starting
-- batch for both slots; admin can split them apart afterwards.
UPDATE public.subscriptions SET batch_id_lunch = batch_id, batch_id_dinner = batch_id WHERE batch_id IS NOT NULL;

-- The single-batch column is now replaced by the two slot-specific ones.
-- orders.batch_id (a separate column, snapshotted per order) is untouched.
ALTER TABLE public.subscriptions DROP COLUMN batch_id;
