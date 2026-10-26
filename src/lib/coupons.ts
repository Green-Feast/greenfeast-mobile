import { supabase } from '@/lib/supabase'

// Coupons (migration 066). A coupon lowers the price of one meal on the 15-
// and 30-meal plans, so the plan costs that × meals (add-ons are full price).
// The app only previews; cashfree-create-order re-checks the code and charges
// the server's price (coupon_code), and the plan keeps that meal price.

export type CouponQuote = {
  code: string
  meals: number
  mealPrice: number        // paise, the coupon's price for one meal
  regularMealPrice: number // paise
  addonPerMeal: number     // paise
  total: number            // paise, what the plan costs with the coupon
  regularTotal: number     // paise
  discount: number         // paise saved
}

export type CouponOffer = { code: string; endsOn: string; plans: Record<string, number> }

// Coupons never apply to the trial (the database refuses it too).
export function couponsAllowed(planId: string | null | undefined): boolean {
  return !!planId && planId !== 'trial'
}

export async function previewCoupon(
  code: string,
  planId: string,
  addonIds: string[],
): Promise<{ ok: true; quote: CouponQuote } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('preview_coupon', { p_code: code.trim(), p_plan_id: planId, p_addon_ids: addonIds })
  if (error) return { ok: false, error: 'Could not check that code. Please try again.' }
  if (!data?.ok) return { ok: false, error: data?.error ?? "That code isn't valid." }
  return {
    ok: true,
    quote: {
      code: data.code,
      meals: data.meals,
      mealPrice: data.meal_price_paise,
      regularMealPrice: data.regular_meal_price_paise,
      addonPerMeal: data.addon_per_meal_paise,
      total: data.total_paise,
      regularTotal: data.regular_total_paise,
      discount: data.discount_paise,
    },
  }
}

// Coupons the office made for this customer (shown as tap-to-apply offers).
export async function fetchCouponOffers(): Promise<CouponOffer[]> {
  const { data, error } = await supabase.rpc('my_coupon_offers')
  if (error || !Array.isArray(data)) return []
  return (data as { code: string; ends_on: string; plans: Record<string, number> | null }[]).map((o) => ({
    code: o.code,
    endsOn: o.ends_on,
    plans: o.plans ?? {},
  }))
}

// "₹229" or "₹249.97".
export function couponRupees(paise: number): string {
  const r = paise / 100
  return `₹${r.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`
}
