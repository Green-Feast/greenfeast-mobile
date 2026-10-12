-- ============================================================
-- GreenFeast — Migration 049: one live plan per customer
-- ============================================================
-- A customer could end up with two active plans at once (Green Feast Test
-- did, 12 Sep: onboarding run twice, each subscription activated from the
-- phone) and then got every meal twice. At most one active/paused plan per
-- customer from now on. Renewals still work: the webhook and "Mark cash
-- received" retire the finished plan before activating the new one.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_live_plan_per_user
  ON public.subscriptions (user_id)
  WHERE status IN ('active', 'paused');
