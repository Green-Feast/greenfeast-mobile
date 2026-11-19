-- 099: Office adjustments — Add paid meals, Record a delivery (2026-11-19).
--
-- While customers are still being onboarded, some things happen outside the
-- app. Two office tools for that on the customer's full profile, both behind
-- the action password and the admin log:
--
--   Add paid meals     admin_add_paid_meals(sub, meals, …): always meals × the
--                      plan's meal price (default_meal_cost — the unit "meals
--                      left" counts in), never a typed amount. Either money
--                      received (a payment with proof, source
--                      'admin_paid_meals', into the wallet) or cash still to
--                      collect (added to cash due; the meals run on credit
--                      until it's recorded). Free meals stay Gift meals (081).
--
--   Record a delivery  admin_record_delivery(sub, date, slot, items, …): a meal
--                      that went out but isn't in the app (skipped, no batch,
--                      off day, the customer called). Today or an earlier day.
--                      Writes delivered items and charges the wallet as a
--                      delivery would ('Meal delivered …', meal_charge), so it
--                      shows in Order history, the totals and the books. A
--                      skipped / cancelled row in that slot is replaced, not
--                      doubled. Refused when the wallet doesn't cover it, and
--                      when the slot still has a meal in the app (Mark
--                      delivered is for that).
--
-- Items: [{"kind":"meal","dish":"<id>","qty":1,"addons":[{"id":"<addon>","qty":1}]},
--         {"kind":"drink","dish":"<id>","qty":1}]

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_source_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_source_check CHECK (source IS NULL OR source IN (
  'app_plan', 'app_topup', 'admin_onboarding', 'admin_activation', 'cod_collection', 'partner_cod',
  'admin_paid_meals'));

-- Why the office wrote this order (Record a delivery).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS office_note text;

-- admin_record_payment (092) accepts the new source.
CREATE OR REPLACE FUNCTION public.admin_record_payment(
  p_user uuid, p_sub uuid, p_amount integer, p_method text, p_cash integer, p_upi integer,
  p_reference text, p_paid_on date, p_source text, p_note text, p_reason text,
  p_admin uuid, p_action uuid, p_idem text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id   uuid;
  v_cash integer := COALESCE(p_cash, 0);
  v_upi  integer := COALESCE(p_upi, 0);
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF p_idem IS NOT NULL THEN
    SELECT id INTO v_id FROM payments WHERE idempotency_key = p_idem;
    IF FOUND THEN RETURN jsonb_build_object('payment_id', v_id, 'duplicate', true); END IF;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 20000000 THEN
    RAISE EXCEPTION 'Enter an amount between ₹1 and ₹2,00,000.';
  END IF;
  IF p_method NOT IN ('cash', 'upi', 'cash_upi', 'bank_transfer', 'previous_records') THEN
    RAISE EXCEPTION 'Pick how it was paid.';
  END IF;
  IF p_source NOT IN ('admin_onboarding', 'admin_activation', 'cod_collection', 'partner_cod', 'admin_paid_meals') THEN
    RAISE EXCEPTION 'Unknown payment source %.', p_source;
  END IF;
  IF p_method = 'cash_upi' AND v_cash + v_upi <> p_amount THEN
    RAISE EXCEPTION 'Cash % + UPI % must add up to %.', fmt_rupees(v_cash), fmt_rupees(v_upi), fmt_rupees(p_amount);
  END IF;
  IF p_sub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE id = p_sub AND user_id = p_user) THEN
    RAISE EXCEPTION 'That plan isn''t this customer''s.';
  END IF;

  INSERT INTO payments (user_id, subscription_id, amount, status, method, source, cash_paise, upi_paise,
                        proof_reference, paid_on, recorded_by, admin_action_id, note, idempotency_key)
  VALUES (p_user, p_sub, p_amount, 'paid', p_method, p_source,
          CASE WHEN p_method = 'cash_upi' THEN v_cash END, CASE WHEN p_method = 'cash_upi' THEN v_upi END,
          NULLIF(trim(COALESCE(p_reference, '')), ''), p_paid_on, p_admin, p_action,
          NULLIF(trim(COALESCE(p_note, '')), ''), p_idem)
  RETURNING id INTO v_id;

  PERFORM wallet_credit(p_user, p_amount, p_reason, 'pay_' || v_id::text);
  IF p_sub IS NOT NULL THEN
    PERFORM book_rounding_income(p_sub);
  END IF;
  RETURN jsonb_build_object('payment_id', v_id, 'duplicate', false);
END; $$;

-- ── Add paid meals ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_add_paid_meals(
  p_sub uuid, p_meals integer, p_collect boolean,
  p_method text, p_cash integer, p_upi integer, p_reference text, p_paid_on date, p_note text,
  p_admin uuid, p_action uuid, p_idem text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        record;
  v_unit   integer;
  v_amount integer;
  v_res    jsonb := '{}'::jsonb;
  v_left   integer;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF p_meals IS NULL OR p_meals < 1 OR p_meals > 90 THEN
    RAISE EXCEPTION 'Add between 1 and 90 meals.';
  END IF;
  SELECT id, user_id, status, plan_name INTO s FROM subscriptions WHERE id = p_sub FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'Paid meals go on a live plan — this one is %.', s.status;
  END IF;

  -- Always meals × the plan's meal price (the unit "meals left" counts in).
  v_unit := default_meal_cost(p_sub);
  IF COALESCE(v_unit, 0) <= 0 THEN RAISE EXCEPTION 'This plan has no meal price.'; END IF;
  v_amount := v_unit * p_meals;

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
      'admin_paid_meals', p_note,
      format('Paid meals — %s × %s', p_meals, fmt_rupees(v_unit)),
      p_admin, p_action, p_idem);
  END IF;

  SELECT deliveries_remaining INTO v_left FROM subscriptions WHERE id = p_sub;
  RETURN v_res || jsonb_build_object('amount', v_amount, 'unit', v_unit, 'meals', p_meals,
                                     'collect', p_collect, 'meals_left', v_left, 'user_id', s.user_id);
END; $$;
REVOKE ALL ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_paid_meals(uuid, integer, boolean, text, integer, integer, text, date, text, uuid, uuid, text) TO service_role;

-- ── Record a delivery ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_record_delivery(
  p_sub uuid, p_date date, p_slot text, p_items jsonb,
  p_mode text, p_address uuid, p_location text, p_reason text,
  p_admin uuid, p_action uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END; $$;
REVOKE ALL ON FUNCTION public.admin_record_delivery(uuid, date, text, jsonb, text, uuid, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_delivery(uuid, date, text, jsonb, text, uuid, text, text, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
