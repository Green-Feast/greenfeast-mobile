-- ============================================================
-- GreenFeast — Migration 092: an auditable money system
-- ============================================================
-- Every rupee that moves is now explainable from the database alone:
--
--  1. The wallet ledger is categorised. wallet_transactions.category says what
--     each row is (a Cashfree payment, cash / UPI the office received, an
--     opening balance moved from earlier records, a gift, a referral reward, a
--     refund, a meal charge …), set by a trigger from the row's reference —
--     a reference the trigger can't place is refused, so no new kind of money
--     can appear unnoticed. Rows written inside an admin action carry the
--     admin and the action (admin_audit_log) they belong to.
--  2. Payments carry their proof. Real money the office takes outside
--     Cashfree (cash, UPI on our QR, bank transfer, earlier records) must say
--     how it was paid (method, cash / UPI split), where it came from (source:
--     onboarding, plan activation, cash-on-delivery collection, a partner's
--     report), a proof reference (UPI UTR, receipt no.), the day it was paid
--     and who recorded it — the database refuses it otherwise. Payments made
--     before this migration without proof are marked method 'unrecorded'; the
--     admin can attach proof to them once, later.
--  3. Money records are permanent. payments, wallet_transactions, refunds,
--     meal_gifts, referrals, coupon_redemptions, cash_reports,
--     balance_decisions, admin_audit_log and the archive tables can't be
--     deleted or have their amounts edited — not even with the service key.
--     A wallet's balance moves only through wallet_credit / wallet_debit.
--  4. Deleting a customer archives their money. Their rows move to
--     money_archives / deleted_money_records (a balance left in the wallet is
--     first recorded as forfeited), then the account can go, so the same
--     phone / email can sign up again and the history stays with us.
--  5. Admin money actions are database functions (admin_*), each one
--     transaction: COD collection (cash + UPI must equal what's due), plan
--     activation and onboarding payments (proof required), refunds to the
--     wallet or outside Cashfree, a cancelled customer's balance (keep /
--     refund / forfeit), gifts, undoing a delivery, attaching proof later.
--     The admin app asks for the admin's action password (hashed here,
--     admin_action_passwords) before calling them and logs every action.
--  6. Rounding: a meal is the plan price ÷ meals, rounded DOWN to the whole
--     rupee (₹7,499 / 30 → ₹249). The rest (₹29) is GreenFeast's — recorded
--     as 'rounding_income' once the plan is fully paid. Replaces 077's
--     few-paise credit.
--  7. Reports: money_ledger_rows(), money_month_summary() and money_checks()
--     (reconciliation) for the Money tab and the month-end export.
-- ============================================================

-- ── 0. Context an admin action passes down to the ledger ───────────────────
-- set_config(…, true) is transaction-local, and these keys can only be set
-- from inside SQL functions (PostgREST doesn't expose set_config).
CREATE OR REPLACE FUNCTION public.money_ctx(p_key text)
RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('gf.' || p_key, true), '')
$$;

CREATE OR REPLACE FUNCTION public.money_set_admin(p_admin uuid, p_action uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_admin IS NULL THEN
    RAISE EXCEPTION 'This action needs the admin who did it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = p_admin) THEN
    RAISE EXCEPTION 'Not an admin.';
  END IF;
  PERFORM set_config('gf.admin', p_admin::text, true);
  PERFORM set_config('gf.action', COALESCE(p_action::text, ''), true);
END; $$;
REVOKE ALL ON FUNCTION public.money_set_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ist_today()
RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

-- ── 1. New columns and tables ───────────────────────────────────────────────
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS category        text,
  ADD COLUMN IF NOT EXISTS admin_id        uuid,
  ADD COLUMN IF NOT EXISTS admin_action_id uuid;
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created  ON public.wallet_transactions (created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_category ON public.wallet_transactions (category);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON public.wallet_transactions (reference_id);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS method          text,
  ADD COLUMN IF NOT EXISTS source          text,
  ADD COLUMN IF NOT EXISTS cash_paise      integer CHECK (cash_paise IS NULL OR cash_paise >= 0),
  ADD COLUMN IF NOT EXISTS upi_paise       integer CHECK (upi_paise IS NULL OR upi_paise >= 0),
  ADD COLUMN IF NOT EXISTS proof_reference text,
  ADD COLUMN IF NOT EXISTS paid_on         date,
  ADD COLUMN IF NOT EXISTS recorded_by     uuid,
  ADD COLUMN IF NOT EXISTS admin_action_id uuid,
  ADD COLUMN IF NOT EXISTS note            text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS wallet_tx_id    uuid,
  ADD COLUMN IF NOT EXISTS proof_added_at  timestamptz,
  ADD COLUMN IF NOT EXISTS proof_added_by  uuid;
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_wallet_tx ON public.payments (wallet_tx_id) WHERE wallet_tx_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_created ON public.payments (created_at);

ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_kind_check;
ALTER TABLE public.refunds ADD CONSTRAINT refunds_kind_check CHECK (kind IN ('wallet', 'bank', 'offline'));
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS method          text,
  ADD COLUMN IF NOT EXISTS proof_reference text,
  ADD COLUMN IF NOT EXISTS admin_action_id uuid;

-- Every admin action (money or not). Append-only; no foreign keys, so rows
-- outlive the customers and admins they mention.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  admin_id            uuid,
  admin_email         text,
  action              text NOT NULL,
  sensitive           boolean NOT NULL DEFAULT false,
  password_checked    boolean NOT NULL DEFAULT false,
  outcome             text NOT NULL CHECK (outcome IN ('ok', 'error', 'denied')),
  error               text,
  target_user         uuid,
  target_subscription uuid,
  target_ref          text,
  amount_paise        integer,
  details             jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user ON public.admin_audit_log (target_user);
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;
GRANT SELECT, INSERT ON public.admin_audit_log TO service_role;

-- The second password admins type before a sensitive action.
CREATE TABLE IF NOT EXISTS public.admin_action_passwords (
  admin_id        uuid PRIMARY KEY,
  password_hash   text NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until    timestamptz
);
ALTER TABLE public.admin_action_passwords ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_action_passwords FROM anon, authenticated, service_role;

-- What was decided about a customer's wallet when their plan was cancelled.
CREATE TABLE IF NOT EXISTS public.balance_decisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id),
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  decision        text NOT NULL CHECK (decision IN ('keep', 'forfeit', 'refund_bank', 'refund_offline')),
  amount_paise    integer NOT NULL CHECK (amount_paise >= 0),
  balance_before  integer NOT NULL,
  reason          text NOT NULL,
  refund_id       uuid REFERENCES public.refunds(id) ON DELETE SET NULL,
  admin_id        uuid NOT NULL,
  admin_action_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_balance_decisions_user ON public.balance_decisions (user_id);
ALTER TABLE public.balance_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.balance_decisions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.balance_decisions TO service_role;

-- A deleted / reset customer's money history.
CREATE TABLE IF NOT EXISTS public.money_archives (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,          -- the account as it was (no FK: it's gone)
  customer_code    text,
  name             text,
  phone            text,
  email            text,
  is_test          boolean NOT NULL DEFAULT false,
  reason           text NOT NULL CHECK (reason IN ('account_deleted', 'admin_deleted', 'admin_reset')),
  admin_id         uuid,
  admin_action_id  uuid,
  balance_at_close integer NOT NULL DEFAULT 0,
  forfeited_paise  integer NOT NULL DEFAULT 0,
  rows_archived    integer NOT NULL DEFAULT 0,
  archived_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_money_archives_user ON public.money_archives (user_id);
ALTER TABLE public.money_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.money_archives FROM anon, authenticated;
GRANT SELECT ON public.money_archives TO service_role;

CREATE TABLE IF NOT EXISTS public.deleted_money_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id   uuid NOT NULL REFERENCES public.money_archives(id),
  source_table text NOT NULL,
  source_id    uuid NOT NULL,
  occurred_at  timestamptz,
  row          jsonb NOT NULL,
  UNIQUE (source_table, source_id)
);
CREATE INDEX IF NOT EXISTS idx_deleted_money_records_table ON public.deleted_money_records (source_table, occurred_at);
ALTER TABLE public.deleted_money_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deleted_money_records FROM anon, authenticated;
GRANT SELECT ON public.deleted_money_records TO service_role;

-- ── 2. Rounding: whole-rupee meals, the rest is GreenFeast's ────────────────
CREATE OR REPLACE FUNCTION public.plan_meal_rate(p_plan text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (floor(base_price::numeric / GREATEST(meals_total, 1) / 100) * 100)::integer
    FROM public.plans WHERE id = p_plan
$$;

-- What a plan's rounding leaves GreenFeast (₹7,499 − 30 × ₹249 = ₹29).
CREATE OR REPLACE FUNCTION public.plan_rounding_gap(p_plan text)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(base_price - public.plan_meal_rate(id) * meals_total, 0)
    FROM public.plans WHERE id = p_plan
$$;
REVOKE ALL ON FUNCTION public.plan_rounding_gap(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_rounding_gap(text) TO service_role;

-- Booked once per plan (reference rounding_income_<sub>), only on a regular
-- price plan whose full price has been paid: payments on it + the wallet
-- money a renewal took off (078) reach the plan price, nothing still owed.
CREATE OR REPLACE FUNCTION public.book_rounding_income(p_sub uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s      record;
  v_gap  integer;
  v_paid integer;
  v_rate integer;
BEGIN
  SELECT sub.id, sub.user_id, sub.plan_id, sub.status, sub.meal_price_paise, COALESCE(sub.cod_due_paise, 0) AS due,
         p.base_price, p.meals_total
    INTO s
    FROM subscriptions sub JOIN plans p ON p.id = sub.plan_id
   WHERE sub.id = p_sub;
  IF NOT FOUND OR s.meal_price_paise IS NOT NULL OR s.due > 0 OR s.status NOT IN ('active', 'paused') THEN
    RETURN 0;
  END IF;
  v_gap := plan_rounding_gap(s.plan_id);
  IF COALESCE(v_gap, 0) <= 0 THEN RETURN 0; END IF;

  SELECT COALESCE(SUM(amount), 0) + COALESCE(MAX(COALESCE(wallet_credit_paise, 0)), 0)
    INTO v_paid
    FROM payments WHERE subscription_id = p_sub AND status IN ('paid', 'refunded');
  IF v_paid < s.base_price THEN RETURN 0; END IF;

  IF EXISTS (SELECT 1 FROM wallet_transactions
              WHERE user_id = s.user_id AND reference_id = 'rounding_income_' || p_sub::text) THEN
    RETURN 0;
  END IF;

  v_rate := plan_meal_rate(s.plan_id);
  PERFORM wallet_debit(s.user_id, v_gap,
    format('Plan rounding — %s meals × %s; the %s left over is kept by GreenFeast',
           s.meals_total, fmt_rupees(v_rate), fmt_rupees(v_gap)),
    'rounding_income_' || p_sub::text);
  RETURN v_gap;
END; $$;
REVOKE ALL ON FUNCTION public.book_rounding_income(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_rounding_income(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.subscriptions_rounding_income()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM book_rounding_income(NEW.id);
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.subscriptions_rounding_income() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS subscriptions_rounding_credit ON public.subscriptions;
DROP TRIGGER IF EXISTS subscriptions_rounding_income ON public.subscriptions;
CREATE TRIGGER subscriptions_rounding_income
  AFTER UPDATE OF status ON public.subscriptions
  FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status = 'active')
  EXECUTE FUNCTION public.subscriptions_rounding_income();

-- ── 3. What a ledger row is ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_tx_category(p_type text, p_ref text, p_user uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind   text;
  v_method text;
BEGIN
  IF p_ref IS NULL THEN
    RAISE EXCEPTION 'A wallet change needs a reference.';
  END IF;

  -- Rows from before this migration, re-labelled once.
  IF money_ctx('backfill') = 'on' AND p_ref ~ '^(addmeals_|adj_|adjust_|correction_|e2e_)' THEN
    RETURN 'legacy_adjustment';
  END IF;

  IF p_type = 'credit' THEN
    IF p_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      -- A plan's money: Cashfree (webhook / fund-subscription-wallet) when the
      -- plan has a paid Cashfree payment, else an admin opening balance (the
      -- pre-092 onboarding used the bare plan id too).
      IF EXISTS (SELECT 1 FROM payments
                  WHERE subscription_id = p_ref::uuid AND cf_order_id IS NOT NULL
                    AND status IN ('paid', 'refunded')) THEN
        RETURN 'payment_cashfree';
      END IF;
      RETURN 'opening_balance';
    ELSIF p_ref ~ '^[0-9]+$' THEN
      RETURN 'payment_cashfree';            -- wallet top-up, reference = cf_payment_id
    ELSIF p_ref LIKE 'pay\_%' THEN
      SELECT method INTO v_method FROM payments WHERE id::text = substr(p_ref, 5);
      IF v_method IS NULL THEN RAISE EXCEPTION 'No payment % for this wallet credit.', p_ref; END IF;
      RETURN CASE WHEN v_method = 'previous_records' THEN 'opening_balance' ELSE 'payment_offline' END;
    ELSIF p_ref LIKE 'cash\_%' THEN
      RETURN 'payment_offline';             -- pre-092 cash recording / activation
    ELSIF p_ref LIKE 'refund\_fail\_%' THEN
      RETURN 'bank_refund_reversed';
    ELSIF p_ref LIKE 'refund\_%' THEN
      RETURN 'refund_to_wallet';
    ELSIF p_ref LIKE 'undo\_%' THEN
      RETURN 'delivery_reversal';
    ELSIF p_ref LIKE 'gift\_%' THEN
      RETURN 'gift';
    ELSIF p_ref LIKE 'referral\_%' THEN
      RETURN 'referral_reward';
    ELSIF p_ref LIKE 'rounding\_%' AND p_ref NOT LIKE 'rounding\_income\_%' THEN
      RETURN 'rounding_credit';             -- 077's few paise, history only
    END IF;
  ELSIF p_type = 'debit' THEN
    IF p_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN 'meal_charge';                 -- reference = order id
    ELSIF p_ref LIKE 'refund\_%' THEN
      SELECT kind INTO v_kind FROM refunds WHERE id::text = substr(p_ref, 8);
      RETURN CASE v_kind WHEN 'offline' THEN 'refund_offline' ELSE 'bank_refund' END;
    ELSIF p_ref LIKE 'forfeit\_%' THEN
      RETURN 'forfeit';
    ELSIF p_ref LIKE 'closed\_%' THEN
      RETURN 'account_closed';
    ELSIF p_ref LIKE 'rounding\_income\_%' THEN
      RETURN 'rounding_income';
    END IF;
  END IF;

  RAISE EXCEPTION 'Unknown kind of wallet % (reference %). Wallet money only moves through payments, gifts, referrals, refunds and meal charges.', p_type, p_ref;
END; $$;
REVOKE ALL ON FUNCTION public.wallet_tx_category(text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. wallet_credit / wallet_debit: the only way a balance moves ───────────
CREATE OR REPLACE FUNCTION public.wallet_credit(
  p_user uuid, p_amount integer, p_reason text, p_reference_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_wallet uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  INSERT INTO wallets (user_id, balance) VALUES (p_user, 0)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_wallet FROM wallets WHERE user_id = p_user FOR UPDATE;

  IF p_reference_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE wallet_id = v_wallet AND type = 'credit' AND reference_id = p_reference_id
  ) THEN RETURN; END IF;

  -- The ledger row first: its trigger refuses a reference it can't place.
  INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, reason, reference_id)
    VALUES (v_wallet, p_user, 'credit', p_amount, p_reason, p_reference_id);
  PERFORM set_config('gf.ledger', 'on', true);
  UPDATE wallets SET balance = balance + p_amount, updated_at = now() WHERE id = v_wallet;
  PERFORM set_config('gf.ledger', '', true);
END; $$;

CREATE OR REPLACE FUNCTION public.wallet_debit(
  p_user uuid, p_amount integer, p_reason text, p_reference_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_wallet  uuid;
  v_balance integer;
  v_cat     text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  INSERT INTO wallets (user_id, balance) VALUES (p_user, 0)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT id, balance INTO v_wallet, v_balance FROM wallets WHERE user_id = p_user FOR UPDATE;

  IF p_reference_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM wallet_transactions
    WHERE wallet_id = v_wallet AND type = 'debit' AND reference_id = p_reference_id
  ) THEN RETURN; END IF;

  -- Only a meal can take a wallet below zero (cash-on-delivery plans the
  -- admin runs on credit; the Money checks flag any other). Refunds,
  -- forfeits and rounding never do.
  v_cat := wallet_tx_category('debit', p_reference_id, p_user);
  IF v_cat <> 'meal_charge' AND v_balance - p_amount < 0 THEN
    RAISE EXCEPTION 'The wallet has only %, so % can''t be taken from it.', fmt_rupees(v_balance), fmt_rupees(p_amount);
  END IF;

  INSERT INTO wallet_transactions (wallet_id, user_id, type, amount, reason, reference_id)
    VALUES (v_wallet, p_user, 'debit', p_amount, p_reason, p_reference_id);
  PERFORM set_config('gf.ledger', 'on', true);
  UPDATE wallets SET balance = balance - p_amount, updated_at = now() WHERE id = v_wallet;
  PERFORM set_config('gf.ledger', '', true);
END; $$;

REVOKE ALL ON FUNCTION public.wallet_credit(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_debit(uuid, integer, text, text)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_credit(uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_debit(uuid, integer, text, text)  TO service_role;

-- ── 5. Backfill: label what's already there ─────────────────────────────────
SELECT set_config('gf.backfill', 'on', true);

UPDATE public.wallet_transactions
   SET category = public.wallet_tx_category(type, reference_id, user_id)
 WHERE category IS NULL;

-- Payments: Cashfree ones are what they are; everything the admin entered
-- before today has no proof ('unrecorded') and its source comes from the
-- wallet credit it made.
UPDATE public.payments
   SET method = 'cashfree',
       source = CASE WHEN subscription_id IS NULL THEN 'app_topup' ELSE 'app_plan' END,
       paid_on = (created_at AT TIME ZONE 'Asia/Kolkata')::date
 WHERE cf_order_id IS NOT NULL AND method IS NULL;

UPDATE public.payments p
   SET method = 'unrecorded',
       paid_on = (p.created_at AT TIME ZONE 'Asia/Kolkata')::date,
       source = COALESCE((
         SELECT CASE WHEN t.reason LIKE 'Cash received%' THEN 'cod_collection'
                     WHEN t.reason LIKE 'Payment received%' THEN 'admin_activation' END
           FROM public.wallet_transactions t
          WHERE t.user_id = p.user_id AND t.type = 'credit' AND t.reference_id = 'cash_' || p.id::text
          LIMIT 1), 'admin_onboarding')
 WHERE p.cf_order_id IS NULL AND p.method IS NULL;

-- Link each payment to the wallet credit it made.
UPDATE public.payments p SET wallet_tx_id = t.id
  FROM public.wallet_transactions t
 WHERE p.wallet_tx_id IS NULL AND t.type = 'credit' AND t.user_id = p.user_id
   AND t.reference_id = 'cash_' || p.id::text;
UPDATE public.payments p SET wallet_tx_id = t.id
  FROM public.wallet_transactions t
 WHERE p.wallet_tx_id IS NULL AND p.cf_payment_id IS NOT NULL AND p.subscription_id IS NULL
   AND t.type = 'credit' AND t.user_id = p.user_id AND t.reference_id = p.cf_payment_id;
-- Plan credits use the plan id: one per plan, matched to that plan's payment
-- of the same amount (Cashfree first, else the admin's opening balance).
UPDATE public.payments p SET wallet_tx_id = t.id
  FROM public.wallet_transactions t
 WHERE p.wallet_tx_id IS NULL AND p.subscription_id IS NOT NULL
   AND p.status IN ('paid', 'refunded')
   AND t.type = 'credit' AND t.user_id = p.user_id
   AND t.reference_id = p.subscription_id::text AND t.amount = p.amount
   AND NOT EXISTS (SELECT 1 FROM public.payments x WHERE x.wallet_tx_id = t.id)
   AND p.id = (SELECT p2.id FROM public.payments p2
                WHERE p2.subscription_id = p.subscription_id AND p2.amount = t.amount
                  AND p2.status IN ('paid', 'refunded') AND p2.wallet_tx_id IS NULL
                ORDER BY (p2.cf_order_id IS NULL), p2.created_at LIMIT 1);

UPDATE public.refunds SET method = 'cashfree' WHERE kind = 'bank' AND method IS NULL;

SELECT set_config('gf.backfill', '', true);

ALTER TABLE public.wallet_transactions ALTER COLUMN category SET NOT NULL;
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_category_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_category_check CHECK (category IN (
  'payment_cashfree', 'payment_offline', 'opening_balance',
  'gift', 'referral_reward', 'refund_to_wallet', 'delivery_reversal', 'bank_refund_reversed', 'rounding_credit',
  'meal_charge', 'bank_refund', 'refund_offline', 'forfeit', 'account_closed', 'rounding_income',
  'legacy_adjustment'));

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check CHECK (method IS NULL OR method IN (
  'cashfree', 'cash', 'upi', 'cash_upi', 'bank_transfer', 'previous_records', 'unrecorded'));
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_source_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_source_check CHECK (source IS NULL OR source IN (
  'app_plan', 'app_topup', 'admin_onboarding', 'admin_activation', 'cod_collection', 'partner_cod'));

-- ── 6. Ledger trigger: category, admin, payment link ────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_transactions_label()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.category := wallet_tx_category(NEW.type, NEW.reference_id, NEW.user_id);
  NEW.admin_id := COALESCE(NEW.admin_id, money_ctx('admin')::uuid);
  NEW.admin_action_id := COALESCE(NEW.admin_action_id, money_ctx('action')::uuid);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.wallet_transactions_label() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wallet_transactions_label ON public.wallet_transactions;
CREATE TRIGGER wallet_transactions_label
  BEFORE INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.wallet_transactions_label();

CREATE OR REPLACE FUNCTION public.wallet_transactions_link_payment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pay uuid;
BEGIN
  IF NEW.category NOT IN ('payment_cashfree', 'payment_offline', 'opening_balance') THEN
    RETURN NULL;
  END IF;
  IF NEW.reference_id LIKE 'pay\_%' OR NEW.reference_id LIKE 'cash\_%' THEN
    SELECT id INTO v_pay FROM payments
     WHERE id::text = substr(NEW.reference_id, CASE WHEN NEW.reference_id LIKE 'pay\_%' THEN 5 ELSE 6 END)
       AND wallet_tx_id IS NULL;
  ELSIF NEW.reference_id ~ '^[0-9]+$' THEN
    SELECT id INTO v_pay FROM payments
     WHERE cf_payment_id = NEW.reference_id AND user_id = NEW.user_id AND wallet_tx_id IS NULL;
  ELSE
    SELECT id INTO v_pay FROM payments
     WHERE subscription_id::text = NEW.reference_id AND user_id = NEW.user_id
       AND amount = NEW.amount AND status IN ('paid', 'refunded') AND wallet_tx_id IS NULL
     ORDER BY (cf_order_id IS NULL), created_at LIMIT 1;
  END IF;
  IF v_pay IS NOT NULL THEN
    UPDATE payments SET wallet_tx_id = NEW.id WHERE id = v_pay;
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.wallet_transactions_link_payment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wallet_transactions_link_payment ON public.wallet_transactions;
CREATE TRIGGER wallet_transactions_link_payment
  AFTER INSERT ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION public.wallet_transactions_link_payment();

-- ── 7. Permanent records ────────────────────────────────────────────────────
-- Deletes are allowed only while a customer's money is being archived
-- (archive_customer_money sets gf.archiving inside its own transaction).
CREATE OR REPLACE FUNCTION public.money_rows_permanent()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND money_ctx('archiving') = 'on'
     AND TG_TABLE_NAME NOT IN ('admin_audit_log', 'money_archives', 'deleted_money_records') THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '% is a permanent money record and can''t be emptied.', TG_TABLE_NAME;
  END IF;
  RAISE EXCEPTION '% rows are permanent money records and can''t be %d.', TG_TABLE_NAME, lower(TG_OP);
END; $$;
REVOKE ALL ON FUNCTION public.money_rows_permanent() FROM PUBLIC, anon, authenticated;

-- Tables that never change after insert (UPDATEs that only clear a foreign
-- key — ON DELETE SET NULL — are let through for the ones that have them).
CREATE OR REPLACE FUNCTION public.money_rows_frozen()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  k     text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v_old) LOOP
    IF v_old->k IS DISTINCT FROM v_new->k
       AND NOT (jsonb_typeof(v_new->k) = 'null'
                AND k IN ('payment_id', 'subscription_id', 'refund_id', 'partner_id', 'order_id', 'coupon_id')) THEN
      RAISE EXCEPTION '% rows are permanent money records: % can''t be changed.', TG_TABLE_NAME, k;
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.money_rows_frozen() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wallet_transactions', 'payments', 'refunds', 'meal_gifts', 'referrals',
                           'coupon_redemptions', 'cash_reports', 'balance_decisions',
                           'admin_audit_log', 'money_archives', 'deleted_money_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_permanent', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.money_rows_permanent()', t || '_permanent', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.money_rows_permanent()', t || '_no_truncate', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['wallet_transactions', 'meal_gifts', 'referrals', 'coupon_redemptions',
                           'balance_decisions', 'admin_audit_log', 'money_archives', 'deleted_money_records'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_frozen', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.money_rows_frozen()', t || '_frozen', t);
  END LOOP;
END $$;

-- Payments: free while being made (created → paid / failed by the webhook);
-- once paid, the money fields are fixed. Allowed after that: paid → refunded,
-- linking the wallet credit once, and attaching proof once to a payment
-- recorded without it (admin_add_payment_proof).
CREATE OR REPLACE FUNCTION public.payments_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := ist_today();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cf_order_id IS NOT NULL THEN
      NEW.method := 'cashfree';
      NEW.source := CASE WHEN NEW.subscription_id IS NULL THEN 'app_topup' ELSE 'app_plan' END;
      NEW.paid_on := COALESCE(NEW.paid_on, v_today);
      RETURN NEW;
    END IF;
    -- Money the office took itself: it must say how, where from, with proof.
    IF NEW.status IN ('paid', 'refunded') THEN
      IF NEW.method IS NULL OR NEW.method IN ('cashfree', 'unrecorded') THEN
        RAISE EXCEPTION 'Say how this payment was made (cash, UPI, bank transfer or earlier records).';
      END IF;
      IF NEW.source IS NULL OR NEW.source IN ('app_plan', 'app_topup') THEN
        RAISE EXCEPTION 'Say where this payment comes from.';
      END IF;
      IF NEW.recorded_by IS NULL THEN
        RAISE EXCEPTION 'A payment needs the admin who recorded it.';
      END IF;
      IF NEW.paid_on IS NULL OR NEW.paid_on > v_today OR NEW.paid_on < DATE '2025-01-01' THEN
        RAISE EXCEPTION 'Give the day it was paid (not in the future).';
      END IF;
      IF NEW.method <> 'cash' AND length(trim(COALESCE(NEW.proof_reference, ''))) < 3 THEN
        RAISE EXCEPTION 'Add a proof reference (UPI UTR, transfer or receipt no.).';
      END IF;
      NEW.cash_paise := CASE NEW.method WHEN 'cash' THEN NEW.amount WHEN 'cash_upi' THEN NEW.cash_paise ELSE 0 END;
      NEW.upi_paise  := CASE NEW.method WHEN 'upi' THEN NEW.amount WHEN 'cash_upi' THEN NEW.upi_paise ELSE 0 END;
      IF NEW.method = 'cash_upi' AND (COALESCE(NEW.cash_paise, 0) <= 0 OR COALESCE(NEW.upi_paise, 0) <= 0
                                      OR NEW.cash_paise + NEW.upi_paise <> NEW.amount) THEN
        RAISE EXCEPTION 'Cash + UPI must add up to the payment.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.status NOT IN ('paid', 'refunded') THEN
    IF OLD.method IS DISTINCT FROM NEW.method AND OLD.cf_order_id IS NOT NULL THEN
      NEW.method := OLD.method;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'paid' AND NEW.status = 'refunded') THEN
    RAISE EXCEPTION 'A paid payment can only become refunded.';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.amount IS DISTINCT FROM OLD.amount OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.cash_paise IS DISTINCT FROM OLD.cash_paise OR NEW.upi_paise IS DISTINCT FROM OLD.upi_paise
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by OR NEW.admin_action_id IS DISTINCT FROM OLD.admin_action_id
     OR NEW.cf_order_id IS DISTINCT FROM OLD.cf_order_id OR NEW.cf_payment_id IS DISTINCT FROM OLD.cf_payment_id
     OR NEW.coupon_id IS DISTINCT FROM OLD.coupon_id OR NEW.meal_price_paise IS DISTINCT FROM OLD.meal_price_paise
     OR NEW.discount_paise IS DISTINCT FROM OLD.discount_paise OR NEW.wallet_credit_paise IS DISTINCT FROM OLD.wallet_credit_paise
     OR NEW.referral_code IS DISTINCT FROM OLD.referral_code OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'A paid payment is a permanent money record and can''t be changed.';
  END IF;
  IF NEW.wallet_tx_id IS DISTINCT FROM OLD.wallet_tx_id AND OLD.wallet_tx_id IS NOT NULL THEN
    RAISE EXCEPTION 'This payment is already linked to its wallet credit.';
  END IF;
  -- Proof can be attached once, only to a payment recorded without it.
  IF NEW.method IS DISTINCT FROM OLD.method OR NEW.proof_reference IS DISTINCT FROM OLD.proof_reference
     OR NEW.paid_on IS DISTINCT FROM OLD.paid_on THEN
    IF OLD.method <> 'unrecorded' OR NEW.proof_added_by IS NULL
       OR NEW.method IN ('cashfree', 'unrecorded') OR length(trim(COALESCE(NEW.proof_reference, ''))) < 3
       OR NEW.paid_on IS NULL OR NEW.paid_on > v_today THEN
      RAISE EXCEPTION 'Proof can only be added once, to a payment recorded without it.';
    END IF;
  ELSIF NEW.proof_added_at IS DISTINCT FROM OLD.proof_added_at OR NEW.proof_added_by IS DISTINCT FROM OLD.proof_added_by THEN
    RAISE EXCEPTION 'A paid payment is a permanent money record and can''t be changed.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.payments_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS payments_guard ON public.payments;
CREATE TRIGGER payments_guard
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_guard();

-- Refunds: amount, who, what for are fixed; status moves forward once.
CREATE OR REPLACE FUNCTION public.refunds_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.proof_reference IS DISTINCT FROM OLD.proof_reference
     OR NEW.admin_action_id IS DISTINCT FROM OLD.admin_action_id
     OR (NEW.user_id IS DISTINCT FROM OLD.user_id AND NEW.user_id IS NOT NULL)
     OR (NEW.payment_id IS DISTINCT FROM OLD.payment_id AND NEW.payment_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A refund is a permanent money record: only its status can move on.';
  END IF;
  IF NEW.cf_refund_id IS DISTINCT FROM OLD.cf_refund_id AND OLD.cf_refund_id IS NOT NULL THEN
    RAISE EXCEPTION 'This refund already has its Cashfree id.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'A % refund can''t change any more.', OLD.status;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.refunds_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS refunds_guard ON public.refunds;
CREATE TRIGGER refunds_guard
  BEFORE UPDATE ON public.refunds
  FOR EACH ROW EXECUTE FUNCTION public.refunds_guard();

-- Cash reports: what the partner said they collected is fixed.
CREATE OR REPLACE FUNCTION public.cash_reports_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- An open report is the partner's to revise (partner_report_cash); once the
  -- office has recorded or dismissed it, it's fixed.
  IF (OLD.recorded_at IS NOT NULL OR OLD.dismissed_at IS NOT NULL)
     AND (NEW.amount_paise IS DISTINCT FROM OLD.amount_paise OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id OR NEW.reported_at IS DISTINCT FROM OLD.reported_at
          OR NEW.note IS DISTINCT FROM OLD.note) THEN
    RAISE EXCEPTION 'A recorded or dismissed cash report can''t be changed.';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
    RAISE EXCEPTION 'A cash report can''t move to another customer.';
  END IF;
  IF OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id AND NEW.payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'This cash report is already recorded.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.cash_reports_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cash_reports_guard ON public.cash_reports;
CREATE TRIGGER cash_reports_guard
  BEFORE UPDATE ON public.cash_reports
  FOR EACH ROW EXECUTE FUNCTION public.cash_reports_guard();

-- Wallets: the balance moves only through wallet_credit / wallet_debit, and
-- a wallet starts at zero.
CREATE OR REPLACE FUNCTION public.wallets_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.balance <> 0 THEN
      RAISE EXCEPTION 'A wallet starts at ₹0; money goes in through a payment, gift, referral or refund.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.balance IS DISTINCT FROM OLD.balance AND COALESCE(money_ctx('ledger'), '') <> 'on' THEN
    RAISE EXCEPTION 'A wallet balance only changes with a ledger entry (wallet_credit / wallet_debit).';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'A wallet can''t move to another customer.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.wallets_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wallets_guard ON public.wallets;
CREATE TRIGGER wallets_guard
  BEFORE INSERT OR UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.wallets_guard();
DROP TRIGGER IF EXISTS wallets_no_truncate ON public.wallets;
CREATE TRIGGER wallets_no_truncate BEFORE TRUNCATE ON public.wallets
  FOR EACH STATEMENT EXECUTE FUNCTION public.money_rows_permanent();

-- ── 8. Action password ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_action_password_status(p_admin uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'set', EXISTS (SELECT 1 FROM admin_action_passwords WHERE admin_id = p_admin),
    'set_at', (SELECT set_at FROM admin_action_passwords WHERE admin_id = p_admin),
    'locked_until', (SELECT locked_until FROM admin_action_passwords
                      WHERE admin_id = p_admin AND locked_until > now()))
$$;

-- The admin app checks the login password (and the old action password, if
-- there is one) before calling this.
CREATE OR REPLACE FUNCTION public.admin_set_action_password(p_admin uuid, p_new text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = p_admin) THEN
    RAISE EXCEPTION 'Not an admin.';
  END IF;
  IF p_new IS NULL OR length(p_new) < 8 THEN
    RAISE EXCEPTION 'The action password needs at least 8 characters.';
  END IF;
  INSERT INTO admin_action_passwords (admin_id, password_hash, set_at, failed_attempts, locked_until)
  VALUES (p_admin, crypt(p_new, gen_salt('bf', 10)), now(), 0, NULL)
  ON CONFLICT (admin_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, set_at = now(), failed_attempts = 0, locked_until = NULL;
END; $$;

-- 5 wrong tries lock it for 15 minutes.
CREATE OR REPLACE FUNCTION public.admin_check_action_password(p_admin uuid, p_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM admin_action_passwords WHERE admin_id = p_admin FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Set your action password first (Security page).', 'code', 'not_set');
  END IF;
  IF r.locked_until IS NOT NULL AND r.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'locked',
      'error', format('Too many wrong tries — locked until %s.', to_char(r.locked_until AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')));
  END IF;
  IF p_password IS NOT NULL AND crypt(p_password, r.password_hash) = r.password_hash THEN
    UPDATE admin_action_passwords SET failed_attempts = 0, locked_until = NULL WHERE admin_id = p_admin;
    RETURN jsonb_build_object('ok', true);
  END IF;
  IF r.failed_attempts + 1 >= 5 THEN
    UPDATE admin_action_passwords SET failed_attempts = 0, locked_until = now() + interval '15 minutes' WHERE admin_id = p_admin;
    RETURN jsonb_build_object('ok', false, 'code', 'locked', 'error', 'Wrong action password — locked for 15 minutes.');
  END IF;
  UPDATE admin_action_passwords SET failed_attempts = r.failed_attempts + 1 WHERE admin_id = p_admin;
  RETURN jsonb_build_object('ok', false, 'code', 'wrong',
    'error', format('Wrong action password (%s tries left).', 5 - (r.failed_attempts + 1)));
END; $$;

REVOKE ALL ON FUNCTION public.admin_action_password_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_set_action_password(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_check_action_password(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_action_password_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_action_password(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_check_action_password(uuid, text) TO service_role;

-- ── 9. Admin money actions ──────────────────────────────────────────────────
-- Money the office received, with its proof, into the customer's wallet.
-- p_idem (generated when the form opens) makes a double click a no-op.
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
  IF p_source NOT IN ('admin_onboarding', 'admin_activation', 'cod_collection', 'partner_cod') THEN
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

-- Cash-on-delivery money: cash + UPI must be exactly what's due.
CREATE OR REPLACE FUNCTION public.admin_record_cod(
  p_sub uuid, p_cash integer, p_upi integer, p_upi_reference text, p_paid_on date,
  p_note text, p_cash_report uuid, p_admin uuid, p_action uuid, p_idem text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s        record;
  v_cash   integer := COALESCE(p_cash, 0);
  v_upi    integer := COALESCE(p_upi, 0);
  v_method text;
  v_res    jsonb;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF p_idem IS NOT NULL AND EXISTS (SELECT 1 FROM payments WHERE idempotency_key = p_idem) THEN
    RETURN jsonb_build_object('payment_id', (SELECT id FROM payments WHERE idempotency_key = p_idem), 'duplicate', true);
  END IF;
  SELECT id, user_id, status, plan_name, COALESCE(cod_due_paise, 0) AS due
    INTO s FROM subscriptions WHERE id = p_sub FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found.'; END IF;
  IF s.status NOT IN ('active', 'paused') THEN RAISE EXCEPTION 'Activate the plan first (it isn''t live yet).'; END IF;
  IF s.due <= 0 THEN RAISE EXCEPTION 'Nothing is due on this plan.'; END IF;
  IF v_cash < 0 OR v_upi < 0 THEN RAISE EXCEPTION 'Amounts can''t be negative.'; END IF;
  IF v_cash + v_upi <> s.due THEN
    RAISE EXCEPTION 'Cash % + UPI % = %, but % is due. They must match.',
      fmt_rupees(v_cash), fmt_rupees(v_upi), fmt_rupees(v_cash + v_upi), fmt_rupees(s.due);
  END IF;
  IF v_upi > 0 AND length(trim(COALESCE(p_upi_reference, ''))) < 3 THEN
    RAISE EXCEPTION 'Add the UPI reference (UTR) for the UPI part.';
  END IF;
  v_method := CASE WHEN v_cash > 0 AND v_upi > 0 THEN 'cash_upi' WHEN v_upi > 0 THEN 'upi' ELSE 'cash' END;

  IF p_cash_report IS NOT NULL THEN
    UPDATE cash_reports SET recorded_at = now(), recorded_by = p_admin
     WHERE id = p_cash_report AND subscription_id = p_sub AND recorded_at IS NULL AND dismissed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'That cash report is already recorded or dismissed.'; END IF;
  END IF;

  v_res := admin_record_payment(s.user_id, p_sub, s.due, v_method, v_cash, v_upi,
    CASE WHEN v_upi > 0 THEN p_upi_reference ELSE COALESCE(NULLIF(trim(COALESCE(p_upi_reference, '')), ''), 'Cash collected') END,
    p_paid_on, CASE WHEN p_cash_report IS NULL THEN 'cod_collection' ELSE 'partner_cod' END,
    p_note, format('Cash on delivery received — %s', COALESCE(s.plan_name, 'plan')),
    p_admin, p_action, p_idem);

  IF p_cash_report IS NOT NULL THEN
    UPDATE cash_reports SET payment_id = (v_res->>'payment_id')::uuid WHERE id = p_cash_report;
  END IF;
  UPDATE subscriptions SET cod_due_paise = 0, cod_on_credit = false, updated_at = now() WHERE id = p_sub;
  PERFORM book_rounding_income(p_sub);
  RETURN v_res || jsonb_build_object('user_id', s.user_id, 'amount', s.due);
END; $$;

-- Store credit for a problem (undelivered meal, quality, missing item).
CREATE OR REPLACE FUNCTION public.admin_refund_to_wallet(
  p_user uuid, p_amount integer, p_reason text, p_admin uuid, p_action uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 THEN
    RAISE EXCEPTION 'Enter an amount between ₹1 and ₹1,00,000.';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'Add a reason — the customer sees it.'; END IF;
  INSERT INTO refunds (user_id, kind, amount, reason, status, created_by, admin_action_id)
  VALUES (p_user, 'wallet', p_amount, trim(p_reason), 'completed', p_admin, p_action)
  RETURNING id INTO v_id;
  PERFORM wallet_credit(p_user, p_amount, 'Refund — ' || trim(p_reason), 'refund_' || v_id::text);
  RETURN v_id;
END; $$;

-- Money handed back outside Cashfree (cash, UPI, bank transfer), with proof.
CREATE OR REPLACE FUNCTION public.admin_refund_offline(
  p_user uuid, p_amount integer, p_method text, p_reference text, p_reason text, p_admin uuid, p_action uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
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
END; $$;

-- A cancelled customer's balance: keep (owed to them), forfeit (GreenFeast's,
-- with a reason), or a refund (bank refunds go through admin-refund; this
-- records the decision with its refund).
CREATE OR REPLACE FUNCTION public.admin_settle_balance(
  p_user uuid, p_sub uuid, p_decision text, p_amount integer, p_reason text,
  p_refund uuid, p_admin uuid, p_action uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id      uuid := gen_random_uuid();
  v_balance integer;
  v_amount  integer;
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
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
END; $$;

CREATE OR REPLACE FUNCTION public.admin_gift_meals(
  p_user uuid, p_meals integer, p_reason text, p_admin uuid, p_admin_email text, p_action uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  RETURN gift_meals(p_user, p_meals, p_reason, COALESCE(p_admin_email, p_admin::text));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_undo_delivered(p_order uuid, p_admin uuid, p_action uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  RETURN undo_order_delivered(p_order);
END; $$;

-- Proof for a payment recorded before 092 without it — once.
CREATE OR REPLACE FUNCTION public.admin_add_payment_proof(
  p_payment uuid, p_method text, p_reference text, p_paid_on date, p_admin uuid, p_action uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM money_set_admin(p_admin, p_action);
  IF p_method NOT IN ('cash', 'upi', 'cash_upi', 'bank_transfer', 'previous_records') THEN
    RAISE EXCEPTION 'Pick how it was paid.';
  END IF;
  UPDATE payments
     SET method = p_method, proof_reference = trim(COALESCE(p_reference, '')), paid_on = p_paid_on,
         proof_added_at = now(), proof_added_by = p_admin
   WHERE id = p_payment AND method = 'unrecorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'This payment already has its proof.'; END IF;
END; $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'admin_record_payment(uuid, uuid, integer, text, integer, integer, text, date, text, text, text, uuid, uuid, text)',
    'admin_record_cod(uuid, integer, integer, text, date, text, uuid, uuid, uuid, text)',
    'admin_refund_to_wallet(uuid, integer, text, uuid, uuid)',
    'admin_refund_offline(uuid, integer, text, text, text, uuid, uuid)',
    'admin_settle_balance(uuid, uuid, text, integer, text, uuid, uuid, uuid)',
    'admin_gift_meals(uuid, integer, text, uuid, text, uuid)',
    'admin_undo_delivered(uuid, uuid, uuid)',
    'admin_add_payment_proof(uuid, text, text, date, uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ── 10. Archiving a customer's money ────────────────────────────────────────
-- Called by the admin before reset / delete (with the admin), and by the
-- users BEFORE DELETE trigger for any other deletion (the app's own account
-- deletion). A positive balance is first recorded as forfeited
-- ('account_closed'); a negative one (cash still owed) is kept on the archive.
CREATE OR REPLACE FUNCTION public.archive_customer_money(p_user uuid, p_reason text, p_admin uuid, p_action uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  u         record;
  v_archive uuid := gen_random_uuid();
  v_balance integer;
  v_forfeit integer := 0;
  v_rows    integer := 0;
BEGIN
  IF p_reason NOT IN ('account_deleted', 'admin_deleted', 'admin_reset') THEN
    RAISE EXCEPTION 'Unknown archive reason %.', p_reason;
  END IF;
  IF p_admin IS NOT NULL THEN
    PERFORM money_set_admin(p_admin, p_action);
  END IF;
  SELECT x.id, x.customer_code, x.name, x.phone, COALESCE(x.is_test, false) AS is_test,
         (SELECT a.email FROM auth.users a WHERE a.id = x.id) AS email
    INTO u FROM users x WHERE x.id = p_user;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = p_user)
     AND NOT EXISTS (SELECT 1 FROM payments WHERE user_id = p_user)
     AND NOT EXISTS (SELECT 1 FROM refunds WHERE user_id = p_user)
     AND NOT EXISTS (SELECT 1 FROM referrals WHERE referrer_id = p_user OR referee_id = p_user)
     AND NOT EXISTS (SELECT 1 FROM cash_reports WHERE user_id = p_user) THEN
    RETURN NULL;
  END IF;

  SELECT balance INTO v_balance FROM wallets WHERE user_id = p_user;
  v_balance := COALESCE(v_balance, 0);
  IF v_balance > 0 THEN
    PERFORM wallet_debit(p_user, v_balance,
      CASE p_reason WHEN 'admin_reset' THEN 'Account reset — wallet balance closed'
                    ELSE 'Account deleted — wallet balance closed' END,
      'closed_' || v_archive::text);
    v_forfeit := v_balance;
  END IF;

  -- Archive rows are frozen once written, so the count goes in up front.
  SELECT (SELECT count(*) FROM wallet_transactions WHERE user_id = p_user)
       + (SELECT count(*) FROM payments WHERE user_id = p_user)
       + (SELECT count(*) FROM refunds WHERE user_id = p_user)
       + (SELECT count(*) FROM meal_gifts WHERE user_id = p_user)
       + (SELECT count(*) FROM referrals WHERE referrer_id = p_user OR referee_id = p_user)
       + (SELECT count(*) FROM coupon_redemptions WHERE user_id = p_user)
       + (SELECT count(*) FROM cash_reports WHERE user_id = p_user)
       + (SELECT count(*) FROM balance_decisions WHERE user_id = p_user)
       + (SELECT count(*) FROM wallets WHERE user_id = p_user)
    INTO v_rows;

  INSERT INTO money_archives (id, user_id, customer_code, name, phone, email, is_test, reason,
                              admin_id, admin_action_id, balance_at_close, forfeited_paise, rows_archived)
  VALUES (v_archive, p_user, u.customer_code, u.name, u.phone, u.email, u.is_test, p_reason,
          p_admin, p_action, v_balance, v_forfeit, v_rows);

  INSERT INTO deleted_money_records (archive_id, source_table, source_id, occurred_at, row)
    SELECT v_archive, 'wallet_transactions', t.id, t.created_at, to_jsonb(t) FROM wallet_transactions t WHERE t.user_id = p_user
    UNION ALL
    SELECT v_archive, 'payments', p.id, p.created_at, to_jsonb(p) FROM payments p WHERE p.user_id = p_user
    UNION ALL
    SELECT v_archive, 'refunds', r.id, r.created_at, to_jsonb(r) FROM refunds r WHERE r.user_id = p_user
    UNION ALL
    SELECT v_archive, 'meal_gifts', g.id, g.created_at, to_jsonb(g) FROM meal_gifts g WHERE g.user_id = p_user
    UNION ALL
    SELECT v_archive, 'referrals', r.id, r.created_at, to_jsonb(r) FROM referrals r
     WHERE r.referrer_id = p_user OR r.referee_id = p_user
    UNION ALL
    SELECT v_archive, 'coupon_redemptions', c.id, c.created_at, to_jsonb(c) FROM coupon_redemptions c WHERE c.user_id = p_user
    UNION ALL
    SELECT v_archive, 'cash_reports', c.id, c.reported_at, to_jsonb(c) FROM cash_reports c WHERE c.user_id = p_user
    UNION ALL
    SELECT v_archive, 'balance_decisions', b.id, b.created_at, to_jsonb(b) FROM balance_decisions b WHERE b.user_id = p_user
    UNION ALL
    SELECT v_archive, 'wallets', w.id, w.updated_at, to_jsonb(w) FROM wallets w WHERE w.user_id = p_user;

  PERFORM set_config('gf.archiving', 'on', true);
  DELETE FROM balance_decisions WHERE user_id = p_user;
  DELETE FROM refunds WHERE user_id = p_user;
  DELETE FROM coupon_redemptions WHERE user_id = p_user;
  DELETE FROM referrals WHERE referrer_id = p_user OR referee_id = p_user;
  DELETE FROM meal_gifts WHERE user_id = p_user;
  DELETE FROM cash_reports WHERE user_id = p_user;
  DELETE FROM wallet_transactions WHERE user_id = p_user;
  DELETE FROM payments WHERE user_id = p_user;
  DELETE FROM wallets WHERE user_id = p_user;
  PERFORM set_config('gf.archiving', '', true);
  RETURN v_archive;
END; $$;
REVOKE ALL ON FUNCTION public.archive_customer_money(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_customer_money(uuid, text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.users_archive_money()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM archive_customer_money(OLD.id, 'account_deleted', NULL, NULL);
  RETURN OLD;
END; $$;
REVOKE ALL ON FUNCTION public.users_archive_money() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS users_archive_money ON public.users;
CREATE TRIGGER users_archive_money
  BEFORE DELETE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.users_archive_money();

-- ── 11. Reports ─────────────────────────────────────────────────────────────
-- Every ledger row in a period, live and archived, with who it belongs to.
CREATE OR REPLACE FUNCTION public.money_ledger_rows(p_from timestamptz, p_to timestamptz, p_test boolean)
RETURNS TABLE (
  id uuid, created_at timestamptz, user_id uuid, customer_code text, customer_name text,
  type text, category text, amount integer, reason text, reference_id text,
  admin_id uuid, admin_email text, admin_action_id uuid, archived boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.created_at, t.user_id, u.customer_code, u.name, t.type, t.category, t.amount, t.reason,
         t.reference_id, t.admin_id, a.email, t.admin_action_id, false
    FROM wallet_transactions t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN admin_users a ON a.user_id = t.admin_id
   WHERE t.created_at >= p_from AND t.created_at < p_to AND COALESCE(u.is_test, false) = p_test
  UNION ALL
  SELECT d.source_id, d.occurred_at, m.user_id, m.customer_code, m.name, d.row->>'type', d.row->>'category',
         (d.row->>'amount')::integer, d.row->>'reason', d.row->>'reference_id',
         NULLIF(d.row->>'admin_id', '')::uuid, a.email, NULLIF(d.row->>'admin_action_id', '')::uuid, true
    FROM deleted_money_records d
    JOIN money_archives m ON m.id = d.archive_id
    LEFT JOIN admin_users a ON a.user_id = NULLIF(d.row->>'admin_id', '')::uuid
   WHERE d.source_table = 'wallet_transactions' AND d.occurred_at >= p_from AND d.occurred_at < p_to
     AND m.is_test = p_test
$$;

-- Everything the month-end report needs, for [p_from, p_to) IST days.
CREATE OR REPLACE FUNCTION public.money_month_summary(p_from date, p_to date, p_test boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from timestamptz := (p_from::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_to   timestamptz := (p_to::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_open integer;
  v_cats jsonb;
  v_in   integer;
  v_out  integer;
  v_pay  jsonb;
  v_ref  jsonb;
  v_live integer;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0)
    INTO v_open FROM money_ledger_rows('-infinity', v_from, p_test);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', type, 'category', category, 'count', n, 'amount', total)
                            ORDER BY type, category), '[]'::jsonb),
         COALESCE(SUM(total) FILTER (WHERE type = 'credit'), 0),
         COALESCE(SUM(total) FILTER (WHERE type = 'debit'), 0)
    INTO v_cats, v_in, v_out
    FROM (SELECT type, category, count(*) AS n, SUM(amount) AS total
            FROM money_ledger_rows(v_from, v_to, p_test) GROUP BY type, category) c;

  -- Real money received in the period (by the day it was paid).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('method', method, 'source', source, 'count', n,
                                               'amount', total, 'cash', cash, 'upi', upi)
                            ORDER BY method, source), '[]'::jsonb)
    INTO v_pay
    FROM (SELECT p.method, p.source, count(*) AS n, SUM(p.amount) AS total,
                 SUM(COALESCE(p.cash_paise, 0)) AS cash, SUM(COALESCE(p.upi_paise, 0)) AS upi
            FROM payments p JOIN users u ON u.id = p.user_id
           WHERE p.status IN ('paid', 'refunded') AND COALESCE(u.is_test, false) = p_test
             AND p.paid_on >= p_from AND p.paid_on < p_to
           GROUP BY p.method, p.source) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'count', n, 'amount', total)), '[]'::jsonb)
    INTO v_ref
    FROM (SELECT r.kind, r.status, count(*) AS n, SUM(r.amount) AS total
            FROM refunds r JOIN users u ON u.id = r.user_id
           WHERE COALESCE(u.is_test, false) = p_test AND r.created_at >= v_from AND r.created_at < v_to
           GROUP BY r.kind, r.status) x;

  SELECT COALESCE(SUM(w.balance), 0) INTO v_live
    FROM wallets w JOIN users u ON u.id = w.user_id WHERE COALESCE(u.is_test, false) = p_test;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to,
    'opening_balance', v_open,
    'credits', v_in, 'debits', v_out,
    'closing_balance', v_open + v_in - v_out,
    'wallets_now', v_live,
    'by_category', v_cats,
    'payments', v_pay,
    'refunds', v_ref,
    'coupons', (SELECT jsonb_build_object('count', count(*), 'discount', COALESCE(SUM(c.discount_paise), 0))
                  FROM coupon_redemptions c JOIN users u ON u.id = c.user_id
                 WHERE COALESCE(u.is_test, false) = p_test AND c.created_at >= v_from AND c.created_at < v_to),
    'cod_outstanding', (SELECT jsonb_build_object('count', count(*), 'amount', COALESCE(SUM(s.cod_due_paise), 0))
                          FROM subscriptions s JOIN users u ON u.id = s.user_id
                         WHERE COALESCE(u.is_test, false) = p_test AND s.status IN ('active', 'paused')
                           AND COALESCE(s.cod_due_paise, 0) > 0),
    'archived_accounts', (SELECT count(*) FROM money_archives
                           WHERE is_test = p_test AND archived_at >= v_from AND archived_at < v_to));
END; $$;

-- Reconciliation. Each check: ok, how many rows break it, and up to 50 of them.
CREATE OR REPLACE FUNCTION public.money_checks(p_test boolean)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_all jsonb := '[]'::jsonb;
  r   jsonb;
BEGIN
  -- 1. Each wallet = its own ledger.
  SELECT jsonb_build_object('key', 'wallet_vs_ledger', 'label', 'Every wallet balance equals its ledger',
           'count', count(*), 'amount', COALESCE(SUM(abs(diff)), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('customer', code, 'name', name, 'balance', balance, 'ledger', ledger)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT u.customer_code AS code, u.name, w.balance, l.ledger, w.balance - l.ledger AS diff,
                 row_number() OVER () AS rn
            FROM wallets w JOIN users u ON u.id = w.user_id
            CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0)::integer AS ledger
                                  FROM wallet_transactions t WHERE t.wallet_id = w.id) l
           WHERE COALESCE(u.is_test, false) = p_test AND w.balance <> l.ledger) x;
  v_all := v_all || r;

  -- 2. Every paid payment made its wallet credit.
  SELECT jsonb_build_object('key', 'payment_without_credit', 'label', 'Every payment reached the wallet',
           'count', count(*), 'amount', COALESCE(SUM(amount), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('customer', code, 'name', name, 'amount', amount, 'method', method, 'date', paid_on)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT u.customer_code AS code, u.name, p.amount, p.method, p.paid_on, row_number() OVER () AS rn
            FROM payments p JOIN users u ON u.id = p.user_id
           WHERE p.status IN ('paid', 'refunded') AND p.wallet_tx_id IS NULL
             AND COALESCE(u.is_test, false) = p_test) x;
  v_all := v_all || r;

  -- 3. Every wallet payment credit has its payment.
  SELECT jsonb_build_object('key', 'credit_without_payment', 'label', 'Every payment credit has a payment record',
           'count', count(*), 'amount', COALESCE(SUM(amount), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('customer', code, 'name', name, 'amount', amount, 'reason', reason, 'date', created_at)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT u.customer_code AS code, u.name, t.amount, t.reason, t.created_at, row_number() OVER () AS rn
            FROM wallet_transactions t JOIN users u ON u.id = t.user_id
           WHERE t.category IN ('payment_cashfree', 'payment_offline', 'opening_balance')
             AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.wallet_tx_id = t.id)
             AND COALESCE(u.is_test, false) = p_test) x;
  v_all := v_all || r;

  -- 4. Offline payments with no proof.
  SELECT jsonb_build_object('key', 'missing_proof', 'label', 'Every offline payment has proof',
           'count', count(*), 'amount', COALESCE(SUM(amount), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('payment_id', id, 'customer', code, 'name', name, 'amount', amount, 'source', source, 'date', paid_on)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT p.id, u.customer_code AS code, u.name, p.amount, p.source, p.paid_on, row_number() OVER (ORDER BY p.paid_on) AS rn
            FROM payments p JOIN users u ON u.id = p.user_id
           WHERE p.status IN ('paid', 'refunded') AND p.method = 'unrecorded'
             AND COALESCE(u.is_test, false) = p_test) x;
  v_all := v_all || r;

  -- 5. Bank refunds: every started one took its money from the wallet, every
  --    failed one gave it back.
  SELECT jsonb_build_object('key', 'bank_refunds', 'label', 'Bank refunds match the ledger',
           'count', count(*), 'amount', COALESCE(SUM(amount), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('customer', code, 'amount', amount, 'status', status, 'problem', problem)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT u.customer_code AS code, f.amount, f.status,
                 CASE WHEN d.id IS NULL THEN 'no wallet debit' ELSE 'failed but not returned' END AS problem,
                 row_number() OVER () AS rn
            FROM refunds f JOIN users u ON u.id = f.user_id
            LEFT JOIN wallet_transactions d ON d.user_id = f.user_id AND d.type = 'debit' AND d.reference_id = 'refund_' || f.id::text
            LEFT JOIN wallet_transactions c ON c.user_id = f.user_id AND c.type = 'credit' AND c.reference_id = 'refund_fail_' || f.id::text
           WHERE f.kind = 'bank' AND COALESCE(u.is_test, false) = p_test
             AND (d.id IS NULL OR (f.status = 'failed' AND c.id IS NULL))) x;
  v_all := v_all || r;

  -- 6. Wallets below zero outside a plan the admin runs on credit.
  SELECT jsonb_build_object('key', 'negative_wallets', 'label', 'No wallet below zero (except plans on credit)',
           'count', count(*), 'amount', COALESCE(SUM(-balance), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('customer', code, 'name', name, 'balance', balance)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT u.customer_code AS code, u.name, w.balance, row_number() OVER () AS rn
            FROM wallets w JOIN users u ON u.id = w.user_id
           WHERE w.balance < 0 AND COALESCE(u.is_test, false) = p_test
             AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = w.user_id
                              AND s.status IN ('active', 'paused') AND s.cod_on_credit)) x;
  v_all := v_all || r;

  -- 7. Money held for customers with no plan and no decision since their
  --    last plan ended.
  SELECT jsonb_build_object('key', 'balances_to_settle', 'label', 'Balances of customers without a plan are decided',
           'count', count(*), 'amount', COALESCE(SUM(balance), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'customer', code, 'name', name, 'balance', balance, 'since', since)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT w.user_id, u.customer_code AS code, u.name, w.balance, last.ended AS since, row_number() OVER (ORDER BY w.balance DESC) AS rn
            FROM wallets w JOIN users u ON u.id = w.user_id
            CROSS JOIN LATERAL (SELECT max(s.updated_at) AS ended FROM subscriptions s WHERE s.user_id = w.user_id) last
           WHERE w.balance > 0 AND COALESCE(u.is_test, false) = p_test
             AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = w.user_id AND s.status IN ('cancelled', 'expired'))
             AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = w.user_id AND s.status IN ('active', 'paused', 'pending'))
             AND NOT EXISTS (SELECT 1 FROM balance_decisions b WHERE b.user_id = w.user_id AND b.decision = 'keep'
                              AND b.created_at >= COALESCE(last.ended, '-infinity'::timestamptz) - interval '1 minute')) x;
  v_all := v_all || r;

  -- 8. Partner cash not yet recorded after 2 days.
  SELECT jsonb_build_object('key', 'cash_reports_open', 'label', 'Partner cash recorded within 2 days',
           'count', count(*), 'amount', COALESCE(SUM(amount_paise), 0),
           'rows', COALESCE(jsonb_agg(jsonb_build_object('customer', code, 'amount', amount_paise, 'reported', reported_at)) FILTER (WHERE rn <= 50), '[]'::jsonb))
    INTO r
    FROM (SELECT u.customer_code AS code, c.amount_paise, c.reported_at, row_number() OVER () AS rn
            FROM cash_reports c JOIN users u ON u.id = c.user_id
           WHERE c.recorded_at IS NULL AND c.dismissed_at IS NULL AND c.reported_at < now() - interval '2 days'
             AND COALESCE(u.is_test, false) = p_test) x;
  v_all := v_all || r;

  RETURN (SELECT jsonb_agg(c || jsonb_build_object('ok', (c->>'count')::integer = 0)) FROM jsonb_array_elements(v_all) c);
END; $$;

REVOKE ALL ON FUNCTION public.money_ledger_rows(timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_month_summary(date, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.money_checks(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.money_ledger_rows(timestamptz, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_month_summary(date, date, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.money_checks(boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
