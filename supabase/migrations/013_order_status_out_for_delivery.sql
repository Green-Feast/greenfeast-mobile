-- ============================================================
-- GreenFeast — Migration 013: Add 'out_for_delivery' order status
-- Run in the Supabase SQL Editor.
--
-- WHY: The mobile app's statusLabel() already renders an 'out_for_delivery'
-- state, and the admin Operations page needs to advance a whole batch through
-- Scheduled -> Preparing (In kitchen) -> Out for delivery -> Delivered. The
-- orders.status CHECK constraint currently allows only:
--   scheduled, confirmed, preparing, delivered, cancelled, skipped
-- This widens it to include 'out_for_delivery'.
-- ============================================================

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'scheduled',
    'confirmed',
    'preparing',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'skipped'
  ));
