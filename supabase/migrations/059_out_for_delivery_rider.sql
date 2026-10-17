-- ============================================================
-- GreenFeast — Migration 059: "on its way" names the rider
-- ============================================================
-- The admin (lib/delivery.ts) now fills {rider} in the out_for_delivery
-- message: the delivery partner's first name when they start delivery from
-- the partner app, "our delivery partner" when the office marks it. Only
-- changed if nobody has edited the text yet (Notifications → Automated
-- messages); either way {rider} becomes an available placeholder.
-- Apply only after the admin that fills {rider} is live.
-- ============================================================

UPDATE public.notification_templates
   SET body         = 'Today''s {slot} is on its way with {rider} — it''ll be with you shortly.',
       default_body = 'Today''s {slot} is on its way with {rider} — it''ll be with you shortly.',
       updated_at   = now()
 WHERE key = 'out_for_delivery'
   AND body = default_body;

UPDATE public.notification_templates
   SET placeholders = array_append(placeholders, 'rider')
 WHERE key = 'out_for_delivery'
   AND NOT ('rider' = ANY (placeholders));
