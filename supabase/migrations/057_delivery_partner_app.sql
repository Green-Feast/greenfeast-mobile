-- ============================================================
-- GreenFeast — Migration 057: delivery partner app
-- ============================================================
-- Delivery partners get their own login (greenfeast-admin /partner) showing
-- their batches, stops and a map, and mark meals on the way / delivered
-- themselves instead of the admin doing it by hand in Operations.
--
-- 1. delivery_partners: login (auth user), test partner flag, last seen.
-- 2. Partner logins are staff accounts — the sign-up trigger doesn't make
--    them customers (no public.users row).
-- 3. orders: who's carrying it, when it went out / was delivered, a failed
--    drop's reason, the optional handover photo. Times are stamped by a
--    trigger so every path (admin, partner, batch RPC) records them.
-- 4. skip_reason 'not_delivered' — the admin skipped a failed drop (not
--    charged; the meal stays on the plan, like 'admin').
-- 5. cash_reports: cash a partner says they collected. The admin records it
--    (payment + wallet credit) — nothing changes for the customer until then.
-- 6. route_stops: the partner's saved stop order per batch.
-- 7. my_riders(): the customer app shows "On the way with <name> · Call".
-- 8. Private storage bucket for handover photos.
-- ============================================================

-- ── 1. Partner logins ──────────────────────────────────────────────────────
ALTER TABLE public.delivery_partners
  ADD COLUMN IF NOT EXISTS user_id      uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_test      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- The login ID is the partner's 10-digit phone, so it must be unique among
-- partners who have a login.
CREATE UNIQUE INDEX IF NOT EXISTS delivery_partners_login_phone
  ON public.delivery_partners (right(regexp_replace(phone, '\D', '', 'g'), 10))
  WHERE user_id IS NOT NULL;

-- Leftover default privileges: customers never need these on staff tables.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.delivery_partners FROM anon, authenticated;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.batches FROM anon, authenticated;

-- ── 2. Partner logins aren't customers ─────────────────────────────────────
-- Runs as part of Supabase Auth's user insert (role supabase_auth_admin,
-- search_path auth) — keep everything schema-qualified (see 056).
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delivery partner logins are created by the admin with app_metadata
  -- role 'partner' — staff, not customers.
  IF COALESCE(NEW.raw_app_meta_data ->> 'role', '') = 'partner' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.users (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

-- ── 3. Delivery tracking on orders ─────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_partner_id uuid REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS out_for_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at        timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_issue      text,
  ADD COLUMN IF NOT EXISTS delivery_issue_at   timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_photo_path text;

-- Customers can read these (table-level SELECT, own rows by RLS) but only
-- ever update address_id (column grant) — nothing to grant here.

CREATE OR REPLACE FUNCTION public.orders_stamp_delivery()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'out_for_delivery' THEN
      NEW.out_for_delivery_at := now();
    ELSIF NEW.status = 'delivered' THEN
      NEW.delivered_at := now();
      -- A reported problem is resolved once the meal is handed over.
      NEW.delivery_issue := NULL;
      NEW.delivery_issue_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS orders_stamp_delivery ON public.orders;
CREATE TRIGGER orders_stamp_delivery
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_stamp_delivery();

-- Meals delivered before this migration: their last update is the best
-- record of when.
UPDATE public.orders SET delivered_at = updated_at
 WHERE status = 'delivered' AND delivered_at IS NULL;

-- ── 4. Skip reason for failed drops ────────────────────────────────────────
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_skip_reason_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_skip_reason_check CHECK (
  skip_reason = ANY (ARRAY['user', 'insufficient_balance', 'pause', 'admin', 'plan_finished', 'kitchen_closed', 'not_delivered'])
);

-- ── 5. Cash reported by partners ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  partner_id      uuid REFERENCES public.delivery_partners(id) ON DELETE SET NULL,
  order_id        uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  amount_paise    integer NOT NULL CHECK (amount_paise > 0),
  note            text,
  reported_at     timestamptz NOT NULL DEFAULT now(),
  recorded_at     timestamptz,
  recorded_by     uuid,
  payment_id      uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  dismissed_at    timestamptz,
  dismissed_by    uuid
);
CREATE INDEX IF NOT EXISTS cash_reports_open
  ON public.cash_reports (reported_at)
  WHERE recorded_at IS NULL AND dismissed_at IS NULL;
CREATE INDEX IF NOT EXISTS cash_reports_subscription ON public.cash_reports (subscription_id);
ALTER TABLE public.cash_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_reports FROM anon, authenticated;
GRANT ALL ON public.cash_reports TO service_role;

-- ── 6. Saved stop order ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_stops (
  batch_id   uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  address_id uuid NOT NULL REFERENCES public.addresses(id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, address_id)
);
ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.route_stops FROM anon, authenticated;
GRANT ALL ON public.route_stops TO service_role;

-- ── 7. Rider shown to the customer ─────────────────────────────────────────
-- Customers can't read delivery_partners; this returns just the first name
-- and phone of whoever is carrying (or delivered) the caller's own meals on
-- that date.
CREATE OR REPLACE FUNCTION public.my_riders(p_date date)
RETURNS TABLE (order_id uuid, rider_name text, rider_phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id,
         split_part(btrim(p.name), ' ', 1),
         '+91' || right(regexp_replace(p.phone, '\D', '', 'g'), 10)
    FROM public.orders o
    JOIN public.delivery_partners p ON p.id = o.delivery_partner_id
   WHERE o.user_id = auth.uid()
     AND o.delivery_date = p_date
     AND o.status IN ('out_for_delivery', 'delivered');
$$;
REVOKE ALL ON FUNCTION public.my_riders(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_riders(date) TO authenticated, service_role;

-- ── 8. Handover photos ─────────────────────────────────────────────────────
-- Private: uploaded through signed upload URLs made by the partner app's
-- server, viewed by the admin through short-lived signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('delivery-photos', 'delivery-photos', false, 3145728, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
