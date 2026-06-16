-- Migration 009: track payment method so CoD subscriptions can be distinguished
-- from online (Razorpay) ones. CoD subs start 'pending' but get orders + a
-- limited app view immediately; admin flips them to 'active' once cash is
-- collected on first delivery. Online 'pending' subs (abandoned checkouts) get
-- no orders and stay hidden.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'online'
    CHECK (payment_method IN ('online', 'cod'));
