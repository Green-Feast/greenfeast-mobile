-- weekly_menu was granted only to service_role (016_weekly_menu.sql) with RLS
-- enabled and no policy — the app's own key gets "permission denied" reading
-- it. subscription.tsx's freeMealIds ends up always empty, so every meal swap
-- shows "+₹20" even when weekly_menu says it's the free counterpart-menu
-- dish, while switch-meal (which reads this table server-side) charges
-- correctly. Verified against production: anon/publishable key -> 42501;
-- secret key -> real rows.
--
-- TO authenticated, not public — only subscribers need this for swap pricing,
-- no reason to expose the full forward menu plan to anonymous scrapers.
CREATE POLICY "authenticated_read_weekly_menu"
  ON public.weekly_menu FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.weekly_menu TO authenticated;

NOTIFY pgrst, 'reload schema';
