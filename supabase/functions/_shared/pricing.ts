// The price of one meal on a subscription (paise). A plan bought with a
// coupon keeps its coupon price (subscriptions.meal_price_paise, migration
// 066); otherwise it's the plan's regular price, round(plan price ÷ meals) —
// the formula the app has always billed. Mirrors subscription_meal_rate() in
// SQL and lib/pricing.ts in the admin.
export function mealRate(
  sub: { meal_price_paise?: number | null } | null | undefined,
  plan: { base_price: number; meals_total: number } | null | undefined,
): number | null {
  if (sub?.meal_price_paise) return sub.meal_price_paise
  if (!plan) return null
  return Math.round(plan.base_price / Math.max(plan.meals_total, 1))
}
