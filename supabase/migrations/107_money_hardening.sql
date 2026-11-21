-- 107: Money hardening after the 21 Nov audit.
--
-- After the order-run bug (19–21 Nov) every path that moves money or makes
-- orders was reviewed and attacked as a customer would. What this changes:
--
--  1. The ledger can't hold two entries with the same reference (unique index
--     — wallet_credit / wallet_debit already checked, now Postgres enforces it).
--  2. A Cashfree plan payment is credited exactly once, by its own payment:
--     credit_plan_payment(). Before, every credit for a plan used the plan's id
--     as its reference, so a second payment for the same plan (two checkouts
--     both paid) was captured but silently never credited.
--  3. One-time keys (claim_once) on the admin's money actions — record a
--     delivery, gifts, refunds, balance decisions, add paid meals — so a
--     repeated submit changes nothing.
--  4. save_day_cart takes the per-slot lock make_default_cart uses (105): a
--     double-tapped Save can't leave two carts.
--  5. sync_pauses revives only the pause's own cancellations (skip_reason
--     'pause'); the pre-marker branch (any cancelled base meal) is gone — no
--     live data needed it, and it could bring back meals cancelled for other
--     reasons.
--  6. One pending bank refund per payment at a time.
--  7. Tighter grants: internal pricing helpers no longer callable from the app
--     (they took any plan id), no customer UPDATE on wallets, no customer
--     writes to order_ingredients, and Sunday delivery days stay office-only
--     even through direct writes.

-- ── 1. Ledger: one entry per reference ──────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_one_per_reference
  ON public.wallet_transactions (wallet_id, type, reference_id) WHERE reference_id IS NOT NULL;

-- ── 6. One pending bank refund per payment ──────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS refunds_one_pending_bank
  ON public.refunds (payment_id) WHERE kind = 'bank' AND status = 'pending';

-- ── 3. One-time keys ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_once (
  key        text PRIMARY KEY,
  action     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_once ENABLE ROW LEVEL SECURITY;   -- no policies: service role only
REVOKE ALL ON public.admin_once FROM anon, authenticated;
GRANT ALL ON public.admin_once TO service_role;

-- Claims a one-time key for an admin action, inside the action's own
-- transaction (so a failed action frees it again). No key (older callers):
-- nothing to claim.
CREATE OR REPLACE FUNCTION public.claim_once(p_key text, p_action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_key IS NULL OR length(p_key) < 8 THEN RETURN; END IF;
  INSERT INTO admin_once (key, action) VALUES (p_key, p_action) ON CONFLICT (key) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Already done — this was sent twice, so nothing more was changed.' USING ERRCODE = 'P0001';
  END IF;
END; $$;
REVOKE ALL ON FUNCTION public.claim_once(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_once(text, text) TO service_role;

-- ── 2. A Cashfree plan payment, credited exactly once ───────────────────────
-- The plan's first payment keeps the plan id as its reference (what the
-- webhook and fund-subscription-wallet always used, so replays stay no-ops).
-- Another paid payment for the same plan is credited under its own Cashfree
-- payment id and the admins are told (refund one?). A plan credit already in
-- the ledger but not linked to any payment (before 092) counts as this one's.
CREATE OR REPLACE FUNCTION public.credit_plan_payment(p_payment uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p        record;
  s        record;
  v_wallet uuid;
  v_tx     uuid;
  v_ref    text;
  v_double boolean := false;
  v_reason text;
BEGIN
  SELECT * INTO p FROM payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF p.status <> 'paid' OR p.cf_order_id IS NULL OR p.subscription_id IS NULL OR COALESCE(p.amount, 0) <= 0 THEN
    RETURN jsonb_build_object('credited', false, 'why', 'not a paid plan payment');
  END IF;
  IF p.wallet_tx_id IS NOT NULL THEN
    RETURN jsonb_build_object('credited', false, 'why', 'already credited');
  END IF;

  INSERT INTO wallets (user_id, balance) VALUES (p.user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet FROM wallets WHERE user_id = p.user_id FOR UPDATE;

  SELECT t.id INTO v_tx FROM wallet_transactions t
   WHERE t.wallet_id = v_wallet AND t.type = 'credit' AND t.reference_id = p.subscription_id::text;
  IF v_tx IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM payments x WHERE x.wallet_tx_id = v_tx AND x.id <> p.id) THEN
      -- The plan's credit belongs to another payment: this is a second payment.
      IF p.cf_payment_id IS NULL OR p.cf_payment_id !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'A second payment for this plan has no Cashfree payment id — credit it by hand.';
      END IF;
      v_ref := p.cf_payment_id;
      v_double := true;
    ELSE
      -- An older credit for this same payment, never linked: link it, credit nothing.
      UPDATE payments SET wallet_tx_id = v_tx WHERE id = p.id;
      RETURN jsonb_build_object('credited', false, 'why', 'already credited (linked)');
    END IF;
  ELSE
    v_ref := p.subscription_id::text;
  END IF;

  SELECT plan_name, payment_method, COALESCE(cod_due_paise, 0) AS due INTO s FROM subscriptions WHERE id = p.subscription_id;
  v_reason := CASE
    WHEN v_double THEN format('Second payment for the same plan — %s', COALESCE(s.plan_name, 'plan'))
    WHEN s.payment_method = 'cod' AND s.due > 0 THEN format('First day paid online — %s (%s cash on delivery)', COALESCE(s.plan_name, 'plan'), fmt_rupees(s.due))
    ELSE format('Plan payment — %s', COALESCE(s.plan_name, 'Subscription')) END;
  PERFORM wallet_credit(p.user_id, p.amount, v_reason, v_ref);

  IF v_double THEN
    PERFORM notify_admins('double_payment',
      'Paid twice for one plan',
      format('%s paid %s a second time for the same plan (Cashfree order %s). It''s in their wallet — refund it from Money if it was a mistake.',
             COALESCE((SELECT name FROM users WHERE id = p.user_id), 'A customer'), fmt_rupees(p.amount), p.cf_order_id),
      '/money');
  END IF;
  RETURN jsonb_build_object('credited', true, 'second_payment', v_double, 'reference', v_ref, 'amount', p.amount);
END; $$;
REVOKE ALL ON FUNCTION public.credit_plan_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_plan_payment(uuid) TO service_role;

-- ── 7. Grants ───────────────────────────────────────────────────────────────
-- Internal pricing helpers took any plan id from anyone with the app's key.
-- Every caller is a definer function or the server (service role).
REVOKE EXECUTE ON FUNCTION public.default_slot_cost(uuid, date, text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.item_unit_price(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.meal_cost_for(uuid, integer)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_has_drink(uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_meal_addons_price(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_slot_drinks(uuid, text)             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_slot_meals(uuid, text)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.slot_cart_problem(uuid, date, text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.slot_cart_state(uuid, date, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.slot_default_applies(uuid, date, text)   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.default_slot_cost(uuid, date, text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.item_unit_price(uuid, text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.meal_cost_for(uuid, integer)             TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_has_drink(uuid)                     TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_meal_addons_price(uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_slot_drinks(uuid, text)             TO service_role;
GRANT EXECUTE ON FUNCTION public.plan_slot_meals(uuid, text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.slot_cart_problem(uuid, date, text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.slot_cart_state(uuid, date, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.slot_default_applies(uuid, date, text)   TO service_role;

-- Customers never update a wallet (RLS already had no policy for it) or write
-- ingredient snapshots (no policy either) — remove the grants as well.
REVOKE UPDATE ON public.wallets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_ingredients FROM authenticated;

-- Sunday deliveries are set by the office only (083) — also for direct writes
-- from the app's own login (the app's plan settings already refuse it).
CREATE OR REPLACE FUNCTION public.guard_customer_schedule()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user = 'authenticated' AND NEW.day_of_week = 'Sun' THEN
    RAISE EXCEPTION 'Sunday is our day off — message us on WhatsApp if you need something special.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS subscription_schedule_guard_customer ON public.subscription_schedule;
CREATE TRIGGER subscription_schedule_guard_customer
  BEFORE INSERT OR UPDATE ON public.subscription_schedule
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_schedule();

-- ── 3 / 4 / 5. The functions (patched from their live definitions) ─────────
DROP FUNCTION IF EXISTS public.admin_record_delivery(p_sub uuid, p_date date, p_slot text, p_items jsonb, p_mode text, p_address uuid, p_location text, p_reason text, p_admin uuid, p_action uuid);
CREATE OR REPLACE FUNCTION public.admin_record_delivery(p_sub uuid, p_date date, p_slot text, p_items jsonb, p_mode text, p_address uuid, p_location text, p_reason text, p_admin uuid, p_action uuid, p_idem text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  s         record;
  it        jsonb;
  x         jsonb;
  v_kind    text;
  v_dish    text;
  v_qty     integer;
  v_aqty    integer;
  v_seq     integer;
  v_id      uuid;
  v_ids     uuid[] := '{}';
  v_total   integer := 0;
  v_balance integer;
  v_walk    boolean := p_mode IN ('dine_in', 'pickup');
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  -- One-time key (107): a repeated submit changes nothing.
  PERFORM claim_once(p_idem, 'admin_record_delivery');

  IF p_slot IS NULL OR p_slot NOT IN ('lunch', 'dinner') THEN RAISE EXCEPTION 'Pick lunch or dinner.'; END IF;
  IF p_date IS NULL OR p_date > v_today THEN
    RAISE EXCEPTION 'Only today or an earlier day — this records a meal that already went out.';
  END IF;
  IF p_date < v_today - 60 THEN RAISE EXCEPTION 'That''s more than 60 days ago.'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Say why this delivery wasn''t in the app.'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('delivery', 'dine_in', 'pickup') THEN
    RAISE EXCEPTION 'Pick delivered, or collected at a counter.';
  END IF;

  SELECT id, user_id, status INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'Deliveries are recorded on a live plan — this one is %.', s.status;
  END IF;

  IF v_walk THEN
    IF p_location IS NULL OR NOT EXISTS (SELECT 1 FROM pickup_locations WHERE id = p_location) THEN
      RAISE EXCEPTION 'Pick the counter it was collected at.';
    END IF;
  ELSIF p_address IS NULL OR NOT EXISTS (
    SELECT 1 FROM addresses WHERE id = p_address AND user_id = s.user_id
  ) THEN
    RAISE EXCEPTION 'Pick one of the customer''s addresses.';
  END IF;

  -- A meal still in the app for this slot is delivered with Mark delivered.
  IF EXISTS (SELECT 1 FROM orders
              WHERE user_id = s.user_id AND delivery_date = p_date AND meal_slot = p_slot
                AND walk_in = v_walk
                AND status IN ('scheduled', 'confirmed', 'preparing', 'out_for_delivery')) THEN
    RAISE EXCEPTION 'This % is still in the app — open it in the day editor and use Mark delivered.', p_slot;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add what was delivered.';
  END IF;

  -- The skipped / cancelled meal of that slot is replaced, not shown twice.
  -- (Never charged, so nothing in the ledger points at it.)
  DELETE FROM orders o
   WHERE o.user_id = s.user_id AND o.delivery_date = p_date AND o.meal_slot = p_slot
     AND o.walk_in = v_walk AND o.status IN ('skipped', 'cancelled')
     AND NOT EXISTS (SELECT 1 FROM wallet_transactions t WHERE t.reference_id = o.id::text);

  SELECT COALESCE(MAX(slot_seq), 0) INTO v_seq FROM orders
   WHERE user_id = s.user_id AND delivery_date = p_date AND meal_slot = p_slot;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_kind := COALESCE(it->>'kind', 'meal');
    v_dish := it->>'dish';
    v_qty  := COALESCE((it->>'qty')::int, 1);
    IF v_kind NOT IN ('meal', 'drink') THEN RAISE EXCEPTION 'Unknown item %.', v_kind; END IF;
    IF v_qty < 1 OR v_qty > 10 THEN RAISE EXCEPTION 'Between 1 and 10 of each item.'; END IF;
    IF v_dish IS NULL OR NOT EXISTS (SELECT 1 FROM meal_templates WHERE id = v_dish) THEN
      RAISE EXCEPTION 'Unknown dish %.', COALESCE(v_dish, '(none)');
    END IF;
    IF (v_kind = 'drink') <> is_drink_dish(v_dish) THEN
      RAISE EXCEPTION '% is a %, not a %.', (SELECT name FROM meal_templates WHERE id = v_dish),
        CASE WHEN is_drink_dish(v_dish) THEN 'drink' ELSE 'meal' END, v_kind;
    END IF;

    v_seq := v_seq + 1;
    INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                        quantity, unit_price, item_kind, extra_dish, slot_seq, is_customized, cart_edited,
                        address_id, fulfilment, pickup_location_id, walk_in, delivered_at, office_note)
    VALUES (s.user_id, p_sub, v_dish, p_date, p_slot, 'delivered',
            v_qty, item_unit_price(p_sub, v_dish), v_kind, v_kind = 'drink', v_seq, true, true,
            CASE WHEN v_walk THEN NULL ELSE p_address END, p_mode,
            CASE WHEN v_walk THEN p_location END, v_walk,
            CASE WHEN p_date = v_today THEN now() END,
            'Recorded by the office: ' || trim(p_reason))
    RETURNING id INTO v_id;
    PERFORM snapshot_order_ingredients(v_id);

    IF v_kind = 'meal' THEN
      FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(it->'addons', '[]'::jsonb)) LOOP
        v_aqty := COALESCE((x->>'qty')::int, 1);
        IF NOT EXISTS (SELECT 1 FROM addons WHERE id = x->>'id' AND NOT COALESCE(is_drink, false)) THEN
          RAISE EXCEPTION 'Unknown add-on % (a drink is its own item).', x->>'id';
        END IF;
        IF v_aqty < 1 OR v_aqty > 20 THEN RAISE EXCEPTION 'Between 1 and 20 of each add-on.'; END IF;
        INSERT INTO order_addons (order_id, addon_id, sub_option, quantity, unit_price, is_plan)
        SELECT v_id, a.id, NULLIF(x->>'option', ''), v_aqty, a.price_per_meal,
               EXISTS (SELECT 1 FROM subscription_addons sa WHERE sa.subscription_id = p_sub AND sa.addon_id = a.id)
          FROM addons a WHERE a.id = x->>'id';
      END LOOP;
    END IF;

    v_total := v_total + recompute_order_cart(v_id);
    v_ids := v_ids || v_id;
  END LOOP;

  -- The wallet must cover it — no credit for a recorded delivery.
  INSERT INTO wallets (user_id, balance) VALUES (s.user_id, 0) ON CONFLICT (user_id) DO NOTHING;
  SELECT balance INTO v_balance FROM wallets WHERE user_id = s.user_id FOR UPDATE;
  IF COALESCE(v_balance, 0) < v_total THEN
    RAISE EXCEPTION 'The wallet has %, and this delivery costs %. Add paid meals first.',
      fmt_rupees(COALESCE(v_balance, 0)), fmt_rupees(v_total);
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM wallet_debit(s.user_id, (SELECT cart_total FROM orders WHERE id = v_id),
                         'Meal delivered ' || p_date::text || ' ' || p_slot, v_id::text);
  END LOOP;

  RETURN jsonb_build_object('orders', to_jsonb(v_ids), 'total', v_total, 'user_id', s.user_id);
END; $function$;
REVOKE ALL ON FUNCTION public.admin_record_delivery(uuid, date, text, jsonb, text, uuid, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_delivery(uuid, date, text, jsonb, text, uuid, text, text, uuid, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.admin_gift_meals(p_user uuid, p_meals integer, p_reason text, p_admin uuid, p_admin_email text, p_action uuid);
CREATE OR REPLACE FUNCTION public.admin_gift_meals(p_user uuid, p_meals integer, p_reason text, p_admin uuid, p_admin_email text, p_action uuid, p_idem text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  -- One-time key (107): a repeated submit changes nothing.
  PERFORM claim_once(p_idem, 'admin_gift_meals');
  RETURN gift_meals(p_user, p_meals, p_reason, COALESCE(p_admin_email, p_admin::text));
END; $function$;
REVOKE ALL ON FUNCTION public.admin_gift_meals(uuid, integer, text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gift_meals(uuid, integer, text, uuid, text, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.admin_gift_money(p_user uuid, p_amount integer, p_reason text, p_admin uuid, p_admin_email text, p_action uuid);
CREATE OR REPLACE FUNCTION public.admin_gift_money(p_user uuid, p_amount integer, p_reason text, p_admin uuid, p_admin_email text, p_action uuid, p_idem text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  -- One-time key (107): a repeated submit changes nothing.
  PERFORM claim_once(p_idem, 'admin_gift_money');
  RETURN gift_money(p_user, p_amount, p_reason, COALESCE(p_admin_email, p_admin::text));
END; $function$;
REVOKE ALL ON FUNCTION public.admin_gift_money(uuid, integer, text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_gift_money(uuid, integer, text, uuid, text, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.admin_refund_to_wallet(p_user uuid, p_amount integer, p_reason text, p_admin uuid, p_action uuid);
CREATE OR REPLACE FUNCTION public.admin_refund_to_wallet(p_user uuid, p_amount integer, p_reason text, p_admin uuid, p_action uuid, p_idem text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  -- One-time key (107): a repeated submit changes nothing.
  PERFORM claim_once(p_idem, 'admin_refund_to_wallet');
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 THEN
    RAISE EXCEPTION 'Enter an amount between ₹1 and ₹1,00,000.';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Add a reason — the customer sees it.'; END IF;
  INSERT INTO refunds (user_id, kind, amount, reason, status, created_by, admin_action_id)
  VALUES (p_user, 'wallet', p_amount, trim(p_reason), 'completed', p_admin, p_action)
  RETURNING id INTO v_id;
  PERFORM wallet_credit(p_user, p_amount, 'Refund — ' || trim(p_reason), 'refund_' || v_id::text);
  RETURN v_id;
END; $function$;
REVOKE ALL ON FUNCTION public.admin_refund_to_wallet(uuid, integer, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_to_wallet(uuid, integer, text, uuid, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.admin_refund_offline(p_user uuid, p_amount integer, p_method text, p_reference text, p_reason text, p_admin uuid, p_action uuid);
CREATE OR REPLACE FUNCTION public.admin_refund_offline(p_user uuid, p_amount integer, p_method text, p_reference text, p_reason text, p_admin uuid, p_action uuid, p_idem text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  -- One-time key (107): a repeated submit changes nothing.
  PERFORM claim_once(p_idem, 'admin_refund_offline');
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Enter the amount refunded.'; END IF;
  IF p_method NOT IN ('cash', 'upi', 'bank_transfer') THEN RAISE EXCEPTION 'Pick how it was refunded.'; END IF;
  IF p_method <> 'cash' AND length(trim(COALESCE(p_reference, ''))) < 3 THEN
    RAISE EXCEPTION 'Add the UPI / transfer reference.';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Add a reason.'; END IF;
  INSERT INTO refunds (user_id, kind, amount, reason, status, created_by, method, proof_reference, admin_action_id)
  VALUES (p_user, 'offline', p_amount, trim(p_reason), 'completed', p_admin, p_method,
          NULLIF(trim(COALESCE(p_reference, '')), ''), p_action)
  RETURNING id INTO v_id;
  PERFORM wallet_debit(p_user, p_amount, 'Refunded — ' || trim(p_reason), 'refund_' || v_id::text);
  RETURN v_id;
END; $function$;
REVOKE ALL ON FUNCTION public.admin_refund_offline(uuid, integer, text, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_refund_offline(uuid, integer, text, text, text, uuid, uuid, text) TO service_role;

DROP FUNCTION IF EXISTS public.admin_settle_balance(p_user uuid, p_sub uuid, p_decision text, p_amount integer, p_reason text, p_refund uuid, p_admin uuid, p_action uuid);
CREATE OR REPLACE FUNCTION public.admin_settle_balance(p_user uuid, p_sub uuid, p_decision text, p_amount integer, p_reason text, p_refund uuid, p_admin uuid, p_action uuid, p_idem text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id      uuid := gen_random_uuid();
  v_balance integer;
  v_amount  integer;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  -- One-time key (107): a repeated submit changes nothing.
  PERFORM claim_once(p_idem, 'admin_settle_balance');
  IF p_decision NOT IN ('keep', 'forfeit', 'refund_bank', 'refund_offline') THEN
    RAISE EXCEPTION 'Pick keep, refund or forfeit.';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Add a reason.'; END IF;
  SELECT balance INTO v_balance FROM wallets WHERE user_id = p_user FOR UPDATE;
  v_balance := COALESCE(v_balance, 0);
  v_amount := CASE WHEN p_decision = 'keep' THEN GREATEST(v_balance, 0) ELSE COALESCE(p_amount, 0) END;
  IF p_decision = 'forfeit' THEN
    IF v_amount <= 0 OR v_amount > v_balance THEN
      RAISE EXCEPTION 'Forfeit between ₹1 and the wallet''s %.', fmt_rupees(v_balance);
    END IF;
    PERFORM wallet_debit(p_user, v_amount,
      'Balance forfeited — ' || trim(p_reason), 'forfeit_' || v_id::text);
  ELSIF p_decision IN ('refund_bank', 'refund_offline') AND p_refund IS NULL THEN
    RAISE EXCEPTION 'A refund decision needs its refund.';
  END IF;
  INSERT INTO balance_decisions (id, user_id, subscription_id, decision, amount_paise, balance_before,
                                 reason, refund_id, admin_id, admin_action_id)
  VALUES (v_id, p_user, p_sub, p_decision, v_amount, v_balance, trim(p_reason), p_refund, p_admin, p_action);
  RETURN v_id;
END; $function$;
REVOKE ALL ON FUNCTION public.admin_settle_balance(uuid, uuid, text, integer, text, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_settle_balance(uuid, uuid, text, integer, text, uuid, uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_add_paid_meals(p_sub uuid, p_meals integer, p_collect boolean, p_method text, p_cash integer, p_upi integer, p_reference text, p_paid_on date, p_note text, p_reason text, p_admin uuid, p_action uuid, p_idem text, p_amount integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        record;
  v_unit   integer;
  v_amount integer;
  v_what   text;
  v_res    jsonb := '{}'::jsonb;
  v_left   integer;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  -- One-time key (107): a repeated submit changes nothing.
  PERFORM claim_once(p_idem, 'admin_add_paid_meals');
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Say why this is being added.';
  END IF;
  SELECT id, user_id, status, plan_name INTO s FROM subscriptions WHERE id = p_sub FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'Paid meals go on a live plan — this one is %.', s.status;
  END IF;

  v_unit := default_meal_cost(p_sub);
  IF COALESCE(v_unit, 0) <= 0 THEN RAISE EXCEPTION 'This plan has no meal price.'; END IF;

  IF p_amount IS NOT NULL THEN
    -- An amount: the meal counter follows from the wallet.
    IF p_amount < 100 OR p_amount > 20000000 THEN RAISE EXCEPTION 'Enter ₹1 – ₹2,00,000.'; END IF;
    v_amount := p_amount;
    v_what := format('Paid money — %s', fmt_rupees(v_amount));
  ELSE
    -- Meals: always meals × the plan's meal price.
    IF p_meals IS NULL OR p_meals < 1 OR p_meals > 90 THEN
      RAISE EXCEPTION 'Add between 1 and 90 meals.';
    END IF;
    v_amount := v_unit * p_meals;
    v_what := format('Paid meals — %s × %s', p_meals, fmt_rupees(v_unit));
  END IF;

  IF p_collect THEN
    UPDATE subscriptions
       SET cod_due_paise = COALESCE(cod_due_paise, 0) + v_amount,
           cod_on_credit = true,
           payment_method = 'cod',
           updated_at = now()
     WHERE id = p_sub;
  ELSE
    v_res := admin_record_payment(
      s.user_id, p_sub, v_amount, p_method, p_cash, p_upi, p_reference, p_paid_on,
      'admin_paid_meals', COALESCE(NULLIF(trim(COALESCE(p_note, '')), ''), trim(p_reason)),
      v_what || ' — ' || trim(p_reason),
      p_admin, p_action, p_idem);
  END IF;

  SELECT deliveries_remaining INTO v_left FROM subscriptions WHERE id = p_sub;
  RETURN v_res || jsonb_build_object('amount', v_amount, 'unit', v_unit, 'meals', p_meals,
                                     'collect', p_collect, 'meals_left', v_left, 'user_id', s.user_id);
END; $function$;
REVOKE ALL ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, text, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, text, uuid, uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.save_day_cart(p_sub uuid, p_date date, p_slot text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s          record;
  it         jsonb;
  ad         jsonb;
  v_applies  boolean;
  v_need_m   integer := plan_slot_meals(p_sub, p_slot);
  v_need_d   integer := plan_slot_drinks(p_sub, p_slot);
  v_meals    integer := 0;
  v_drinks   integer := 0;
  v_new      integer := 0;
  v_old      integer;
  v_addr     uuid;
  v_seq      integer;
  v_id       uuid;
  v_first    boolean := true;
  v_kind     text;
  v_dish     text;
  v_qty      integer;
  v_aqty     integer;
  pa         record;
  v_have     integer;
BEGIN
  SELECT * INTO s FROM subscriptions WHERE id = p_sub;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF COALESCE(auth.role(), '') = 'authenticated' AND s.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Plan not found.';
  END IF;
  IF s.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Your plan isn''t running.'; END IF;
  -- One change at a time per lunch / dinner (107): a double-tapped Save, or a save
  -- racing the order run, can't leave two carts. Same lock as make_default_cart.
  PERFORM pg_advisory_xact_lock(hashtextextended('default_cart|' || p_sub::text || '|' || p_date::text || '|' || p_slot, 0));
  IF p_slot NOT IN ('lunch', 'dinner') THEN RAISE EXCEPTION 'Pick lunch or dinner.'; END IF;
  IF is_slot_locked(p_date, p_slot) THEN
    RAISE EXCEPTION 'This meal is already being prepared — changes close at 9 AM for lunch and 2 PM for dinner.';
  END IF;
  IF EXISTS (SELECT 1 FROM kitchen_closures WHERE closed_on = p_date AND meal_slot = p_slot) THEN
    RAISE EXCEPTION 'The kitchen is closed for this meal.';
  END IF;
  IF s.pause_from IS NOT NULL AND s.pause_until IS NOT NULL AND p_date BETWEEN s.pause_from AND s.pause_until THEN
    RAISE EXCEPTION 'Your plan is paused that day.';
  END IF;
  v_applies := slot_default_applies(p_sub, p_date, p_slot);
  IF extract(isodow FROM p_date) = 7 AND NOT v_applies THEN
    RAISE EXCEPTION 'Sunday is our day off — message us on WhatsApp if you need something special.';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your cart is empty — to have no meal, skip it instead.';
  END IF;

  -- Validate and price.
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_kind := it->>'kind';
    v_dish := it->>'dish';
    v_qty  := COALESCE((it->>'qty')::int, 0);
    IF v_qty < 1 OR v_qty > 10 THEN RAISE EXCEPTION 'Pick 1 to 10 of each item.'; END IF;
    IF v_kind = 'drink' THEN
      IF NOT is_deliverable_drink(v_dish) THEN RAISE EXCEPTION 'That drink isn''t available.'; END IF;
      IF it ? 'addons' AND jsonb_array_length(COALESCE(it->'addons', '[]')) > 0 THEN
        RAISE EXCEPTION 'Drinks don''t take add-ons.';
      END IF;
      v_drinks := v_drinks + v_qty;
      v_new := v_new + drink_price() * v_qty;
    ELSIF v_kind = 'meal' THEN
      IF NOT EXISTS (SELECT 1 FROM meal_templates WHERE id = v_dish AND is_active AND subscription_valid
                                                    AND category NOT IN ('smoothie', 'coffee')) THEN
        RAISE EXCEPTION 'One of those dishes isn''t available for plans.';
      END IF;
      IF EXISTS (SELECT 1 FROM meal_availability WHERE for_date = p_date AND meal_template_id = v_dish AND NOT is_available) THEN
        RAISE EXCEPTION '% isn''t available that day.', (SELECT name FROM meal_templates WHERE id = v_dish);
      END IF;
      v_meals := v_meals + v_qty;
      v_new := v_new + item_unit_price(p_sub, v_dish) * v_qty;
      FOR ad IN SELECT * FROM jsonb_array_elements(COALESCE(it->'addons', '[]')) LOOP
        v_aqty := COALESCE((ad->>'qty')::int, 0);
        IF v_aqty < 1 OR v_aqty > 10 THEN RAISE EXCEPTION 'Pick 1 to 10 of each add-on.'; END IF;
        IF NOT EXISTS (SELECT 1 FROM addons WHERE id = ad->>'id' AND is_active AND NOT is_drink) THEN
          RAISE EXCEPTION 'One of those add-ons isn''t available.';
        END IF;
        v_new := v_new + (SELECT price_per_meal FROM addons WHERE id = ad->>'id') * v_aqty;
      END LOOP;
    ELSE
      RAISE EXCEPTION 'Unknown item.';
    END IF;
  END LOOP;

  -- The minimum.
  IF v_applies THEN
    IF v_meals < v_need_m THEN
      RAISE EXCEPTION 'Your plan has % meal% here — add % more, or skip this meal.',
        v_need_m, CASE WHEN v_need_m = 1 THEN '' ELSE 's' END, v_need_m - v_meals;
    END IF;
    IF v_drinks < v_need_d THEN
      RAISE EXCEPTION 'Your plan has % drink% here — add % more, or skip this meal.',
        v_need_d, CASE WHEN v_need_d = 1 THEN '' ELSE 's' END, v_need_d - v_drinks;
    END IF;
    FOR pa IN SELECT sa.addon_id, a.name FROM subscription_addons sa JOIN addons a ON a.id = sa.addon_id
               WHERE sa.subscription_id = p_sub AND NOT a.is_drink LOOP
      SELECT COALESCE(SUM((x->>'qty')::int), 0) INTO v_have
        FROM jsonb_array_elements(p_items) i, jsonb_array_elements(COALESCE(i->'addons', '[]')) x
       WHERE i->>'kind' = 'meal' AND x->>'id' = pa.addon_id;
      IF v_have < v_need_m THEN
        RAISE EXCEPTION '% comes with your plan''s meals — keep it on % meal%.',
          pa.name, v_need_m, CASE WHEN v_need_m = 1 THEN '' ELSE 's' END;
      END IF;
    END LOOP;
  END IF;

  -- Wallet: what this adds over the cart it replaces.
  SELECT COALESCE(SUM(recompute_order_cart(o.id)), 0)::integer INTO v_old FROM orders o
   WHERE o.subscription_id = p_sub AND o.delivery_date = p_date AND o.meal_slot = p_slot
     AND NOT o.walk_in AND o.status IN ('scheduled', 'confirmed');
  IF v_new > v_old AND NOT COALESCE(s.cod_on_credit, false) AND v_new - v_old > schedulable_paise(s.user_id) THEN
    RAISE EXCEPTION 'Your wallet doesn''t cover these extras — remove something, or renew your plan.';
  END IF;

  -- Replace the slot's open items.
  SELECT address_id INTO v_addr FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in
     AND address_id IS NOT NULL
   ORDER BY (status IN ('scheduled', 'confirmed')) DESC, extra_dish, slot_seq LIMIT 1;
  IF v_addr IS NULL THEN
    SELECT id INTO v_addr FROM addresses WHERE user_id = s.user_id AND archived_at IS NULL
     ORDER BY is_default DESC, created_at LIMIT 1;
  END IF;
  DELETE FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot
     AND NOT walk_in AND status IN ('scheduled', 'confirmed');
  SELECT COALESCE(max(slot_seq) + 1, 0) INTO v_seq FROM orders
   WHERE subscription_id = p_sub AND delivery_date = p_date AND meal_slot = p_slot AND NOT walk_in;

  -- Meals first (the first one is the slot's "base" for older readers), then drinks.
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) ORDER BY (value->>'kind') DESC LOOP
    v_kind := it->>'kind';
    v_dish := it->>'dish';
    v_qty  := (it->>'qty')::int;
    INSERT INTO orders (user_id, subscription_id, meal_template_id, delivery_date, meal_slot, status,
                        quantity, unit_price, item_kind, extra_dish, slot_seq, is_customized, cart_edited, address_id)
    VALUES (s.user_id, p_sub, v_dish, p_date, p_slot, 'scheduled',
            v_qty, item_unit_price(p_sub, v_dish), v_kind, NOT (v_first AND v_kind = 'meal'), v_seq,
            true, true, v_addr)
    RETURNING id INTO v_id;
    v_first := false;
    v_seq := v_seq + 1;
    PERFORM snapshot_order_ingredients(v_id);
    IF v_kind = 'meal' THEN
      INSERT INTO order_addons (order_id, addon_id, sub_option, quantity, unit_price, is_plan)
      SELECT v_id, x->>'id', NULLIF(x->>'option', ''), (x->>'qty')::int, a.price_per_meal,
             EXISTS (SELECT 1 FROM subscription_addons sa WHERE sa.subscription_id = p_sub AND sa.addon_id = a.id)
        FROM jsonb_array_elements(COALESCE(it->'addons', '[]')) x JOIN addons a ON a.id = x->>'id';
    END IF;
    PERFORM recompute_order_cart(v_id);
  END LOOP;

  RETURN slot_cart_state(p_sub, p_date, p_slot) || jsonb_build_object('total', v_new);
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_pauses()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_ended   uuid[];
  v_started integer;
  v_later   integer;
BEGIN
  WITH ended AS (
    UPDATE subscriptions
       SET status = 'active', pause_from = NULL, pause_until = NULL, updated_at = now()
     WHERE status IN ('active', 'paused') AND pause_until < v_today
     RETURNING id
  )
  SELECT array_agg(id) INTO v_ended FROM ended;

  -- The pause's own cancellations come back, as on Resume.
  UPDATE orders o
     SET status = 'scheduled', skip_reason = NULL, updated_at = now()
   WHERE o.subscription_id = ANY (COALESCE(v_ended, '{}'))
     AND o.delivery_date >= v_today
     AND o.status = 'cancelled'
     AND o.skip_reason = 'pause'
     AND NOT o.walk_in
     AND NOT is_slot_locked(o.delivery_date, o.meal_slot);

  -- A pause set for later that has come round. Anything added to its days since
  -- it was set goes with it.
  UPDATE orders o
     SET status = 'cancelled', skip_reason = 'pause', updated_at = now()
    FROM subscriptions s
   WHERE s.id = o.subscription_id
     AND s.status = 'active' AND s.pause_from <= v_today AND s.pause_until >= v_today
     AND o.delivery_date BETWEEN s.pause_from AND s.pause_until
     AND o.status IN ('scheduled', 'confirmed')
     AND NOT o.walk_in
     AND NOT is_slot_locked(o.delivery_date, o.meal_slot);

  UPDATE subscriptions
     SET status = 'paused', updated_at = now()
   WHERE status = 'active' AND pause_from <= v_today AND pause_until >= v_today;
  GET DIAGNOSTICS v_started = ROW_COUNT;

  -- Older ones were marked Paused from the day they were asked for.
  UPDATE subscriptions
     SET status = 'active', updated_at = now()
   WHERE status = 'paused' AND pause_from > v_today;
  GET DIAGNOSTICS v_later = ROW_COUNT;

  RETURN jsonb_build_object('ended', COALESCE(array_length(v_ended, 1), 0), 'started', v_started, 'set_for_later', v_later);
END; $function$;

NOTIFY pgrst, 'reload schema';
