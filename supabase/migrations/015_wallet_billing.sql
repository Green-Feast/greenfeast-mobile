-- ============================================================
-- GreenFeast — Migration 015: Wallet billing engine
-- Run in the Supabase SQL Editor.
--
-- The wallet becomes the billing ledger:
--   * The subscribe-flow payment CREDITS the wallet (opening balance).
--   * Each delivered meal DEBITS (meal cost + add-ons) from the balance.
--   * History = wallet_transactions rows.
--   * When the balance / deliveries run out, the app prompts a renewal top-up.
--
-- All money mutations go through these SECURITY DEFINER RPCs so they are atomic
-- (no read-modify-write races on balance) and idempotent on reference_id
-- (so a webhook + client both firing, or a re-run, never double-counts).
-- EXECUTE is granted to service_role only — credits/debits are issued server
-- side (edge functions / admin actions), never trusted from the client.
-- ============================================================

-- ── Credit: add money + ledger row. Idempotent on (wallet, 'credit', reference_id).
CREATE OR REPLACE FUNCTION public.wallet_credit(
  p_user uuid, p_amount integer, p_reason text, p_reference_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  INSERT INTO wallets (user_id, balance) VALUES (p_user, 0)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet FROM wallets WHERE user_id = p_user;

  IF p_reference_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE wallet_id = v_wallet AND type = 'credit' AND reference_id = p_reference_id
  ) THEN RETURN; END IF;

  UPDATE wallets SET balance = balance + p_amount, updated_at = now() WHERE id = v_wallet;
  INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, reason, reference_id)
    VALUES (v_wallet, p_user, 'credit', p_amount, p_reason, p_reference_id);
END; $$;

-- ── Debit: subtract money + ledger row. Idempotent on (wallet, 'debit', reference_id).
CREATE OR REPLACE FUNCTION public.wallet_debit(
  p_user uuid, p_amount integer, p_reason text, p_reference_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  INSERT INTO wallets (user_id, balance) VALUES (p_user, 0)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet FROM wallets WHERE user_id = p_user;

  IF p_reference_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE wallet_id = v_wallet AND type = 'debit' AND reference_id = p_reference_id
  ) THEN RETURN; END IF;

  UPDATE wallets SET balance = balance - p_amount, updated_at = now() WHERE id = v_wallet;
  INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, reason, reference_id)
    VALUES (v_wallet, p_user, 'debit', p_amount, p_reason, p_reference_id);
END; $$;

-- ── Mark a whole batch delivered for a date: per order -> set delivered,
--    decrement deliveries_remaining (floor 0), debit wallet (meal + add-ons).
--    Idempotent: delivered orders are excluded; wallet_debit dedupes on order id.
CREATE OR REPLACE FUNCTION public.advance_batch_delivered(p_batch uuid, p_date date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_addon integer;
  v_per_meal integer;
  v_count integer := 0;
BEGIN
  FOR r IN
    SELECT o.id AS order_id, o.user_id, o.subscription_id,
           p.base_price, p.meals_total
    FROM orders o
    JOIN subscriptions s ON s.id = o.subscription_id
    JOIN plans p         ON p.id = s.plan_id
    WHERE o.batch_id = p_batch
      AND o.delivery_date = p_date
      AND o.status NOT IN ('delivered', 'cancelled', 'skipped')
  LOOP
    SELECT COALESCE(SUM(a.price_per_meal), 0) INTO v_addon
    FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
    WHERE sa.subscription_id = r.subscription_id;

    v_per_meal := ROUND(r.base_price::numeric / NULLIF(r.meals_total, 0)) + COALESCE(v_addon, 0);

    UPDATE orders SET status = 'delivered', updated_at = now() WHERE id = r.order_id;

    UPDATE subscriptions
      SET deliveries_remaining = GREATEST(deliveries_remaining - 1, 0), updated_at = now()
      WHERE id = r.subscription_id;

    PERFORM wallet_debit(r.user_id, v_per_meal, 'Meal delivered ' || p_date::text, r.order_id::text);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END; $$;

-- Server-side callers only.
REVOKE ALL ON FUNCTION public.wallet_credit(uuid, integer, text, text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_debit(uuid, integer, text, text)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advance_batch_delivered(uuid, date)                 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_credit(uuid, integer, text, text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_debit(uuid, integer, text, text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_batch_delivered(uuid, date)              TO service_role;
