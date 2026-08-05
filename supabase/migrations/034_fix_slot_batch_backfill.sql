-- 033's backfill copied the old single batch_id into BOTH batch_id_lunch and
-- batch_id_dinner unconditionally. That's wrong whenever the batch it copied
-- is only a lunch batch (as both existing batches are) — subscribers ended up
-- with a "dinner batch" that actually points at a lunch-slot batch, so they
-- never showed up as unassigned in the Dinner tab even though no real dinner
-- batch was ever set.
UPDATE public.subscriptions s
SET batch_id_lunch = NULL
FROM public.batches b
WHERE s.batch_id_lunch = b.id AND b.meal_slot <> 'lunch';

UPDATE public.subscriptions s
SET batch_id_dinner = NULL
FROM public.batches b
WHERE s.batch_id_dinner = b.id AND b.meal_slot <> 'dinner';
