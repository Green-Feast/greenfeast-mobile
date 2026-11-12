-- GreenFeast — Migration 086: cash on delivery on the 60-meal plan too
-- (067 made it online-only). The app reads plans.allow_cod; cashfree-create-order checks it.
UPDATE public.plans SET allow_cod = true WHERE id = 'plan60';
