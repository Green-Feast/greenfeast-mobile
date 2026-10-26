import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 'sandbox' until CASHFREE_ENV=production is set once live keys replace the
// test ones — flip this one env var (plus the keys) to go live, nothing else.
const CASHFREE_ENV = Deno.env.get('CASHFREE_ENV') === 'production' ? 'production' : 'sandbox'
const CASHFREE_BASE = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg'

// Cashfree customer_id only allows alphanumeric/underscore/hyphen — Supabase
// UUIDs already fit, but strip defensively rather than trust it blindly.
function sanitizeCustomerId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

// Accepts "+91XXXXXXXXXX" or "XXXXXXXXXX" — Cashfree wants a bare 10-digit number.
function sanitizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-10)
}

// Cash on delivery: the first day's meals are paid online now, the rest in
// cash on the first delivery — rounded down to a round ₹100, the odd amount
// going online. Same formula as the app's payment screen (codSplit).
function codSplit(totalPaise: number, perMealPaise: number, mealsPerDay: number) {
  const firstDay = Math.min(perMealPaise * Math.max(mealsPerDay, 1), totalPaise)
  const cash = Math.max(Math.floor((totalPaise - firstDay) / 10000) * 10000, 0)
  return { upfront: totalPaise - cash, cash }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // amount_paise from the app is ignored — the price is computed below. It
    // used to be charged as sent, so a modified client could pay Rs 1 for a plan.
    // cod: true → charge only the cash-on-delivery upfront (first day's meals).
    // coupon_code (optional, migration 066): lowers the plan's meal price —
    // checked and priced by coupon_quote(), never by the app.
    const { subscription_id, amount_paise: clientAmount, cod, coupon_code } = await req.json()

    if (!subscription_id) {
      return new Response(
        JSON.stringify({ error: 'subscription_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') ?? ''
    )
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the subscription belongs to this user
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('id, status, meals_lunch, meals_dinner, plan_id, plans ( name, base_price, meals_total, allow_cod )')
      .eq('id', subscription_id)
      .eq('user_id', user.id)
      .single()
    const plan = (sub as any)?.plans as { name: string; base_price: number; meals_total: number; allow_cod: boolean } | null
    if (subErr || !sub || !plan) {
      return new Response(
        JSON.stringify({ error: 'Subscription not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Server-side price, same formula the app displays (payment.tsx grandTotal):
    // plan base price + sum(add-on price per meal) x meals in the plan.
    const { data: subAddons } = await supabase
      .from('subscription_addons')
      .select('addons ( price_per_meal )')
      .eq('subscription_id', subscription_id)
    const addonPerMeal = (subAddons ?? []).reduce(
      (sum: number, row: any) => sum + (row.addons?.price_per_meal ?? 0), 0
    )
    let planTotal = plan.base_price + addonPerMeal * plan.meals_total
    let mealPrice = Math.round(plan.base_price / Math.max(plan.meals_total, 1))

    // A coupon: only when buying a plan (pending) — never a top-up, never a
    // plan that's already running. The meal price it sets is what this
    // payment buys; the webhook copies it onto the plan (apply_payment_coupon).
    let coupon: { id: string; code: string; meal_price_paise: number; discount_paise: number } | null = null
    const code = typeof coupon_code === 'string' ? coupon_code.trim() : ''
    if (code) {
      if ((sub as any).status !== 'pending') {
        return new Response(
          JSON.stringify({ error: 'Codes can only be used when buying a plan.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const { data: quote, error: quoteErr } = await supabase.rpc('coupon_quote', {
        p_user: user.id,
        p_code: code,
        p_plan: (sub as any).plan_id,
        p_addon_per_meal: addonPerMeal,
        p_kind: null,
        p_exclude_sub: subscription_id,
      })
      if (quoteErr) {
        console.error('cashfree-create-order: coupon_quote failed:', quoteErr.message)
        return new Response(
          JSON.stringify({ error: 'Could not check that code. Please try again.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      if (!quote?.ok) {
        return new Response(
          JSON.stringify({ error: quote?.error ?? "That code isn't valid." }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      coupon = { id: quote.coupon_id, code: quote.code, meal_price_paise: quote.meal_price_paise, discount_paise: quote.discount_paise }
      planTotal = quote.total_paise
      mealPrice = quote.meal_price_paise
    }

    let amount_paise = planTotal
    let cash_paise = 0
    if (cod) {
      if ((sub as any).status !== 'pending') {
        return new Response(
          JSON.stringify({ error: 'Cash on delivery is only for a new plan.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      // Some plans are online-only in the app (plans.allow_cod, migration 067).
      if (plan.allow_cod === false) {
        return new Response(
          JSON.stringify({ error: `The ${plan.name} can only be paid online.` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      const perMeal = mealPrice + addonPerMeal
      const split = codSplit(planTotal, perMeal, ((sub as any).meals_lunch ?? 0) + ((sub as any).meals_dinner ?? 0))
      amount_paise = split.upfront
      cash_paise = split.cash
    }
    if (clientAmount != null && clientAmount !== amount_paise) {
      console.warn('cashfree-create-order: app showed', clientAmount, 'but this charge is', amount_paise, subscription_id)
      // Never charge more than the app showed: an old app version that doesn't
      // know a plan's price (e.g. the 60-meal plan, 067) shows a wrong amount.
      if (typeof clientAmount === 'number' && clientAmount < amount_paise) {
        return new Response(
          JSON.stringify({ error: 'The price in your app is out of date — please update GreenFeast and try again.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }
    // The cash part is collected on delivery and recorded by the admin; the
    // plan activates (cashfree-webhook) once this payment lands either way.
    const { error: codErr } = await supabase
      .from('subscriptions')
      .update({ payment_method: cod ? 'cod' : 'online', cod_due_paise: cash_paise, cod_on_credit: false })
      .eq('id', subscription_id)
      .eq('status', 'pending')
    if (codErr) {
      console.error('cashfree-create-order: could not save the payment split:', codErr.message)
      return new Response(
        JSON.stringify({ error: 'Could not start the payment. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('name, phone')
      .eq('id', user.id)
      .single()

    const APP_ID = Deno.env.get('CASHFREE_APP_ID')!
    const SECRET_KEY = Deno.env.get('CASHFREE_SECRET_KEY')!

    // Our own order_id (not Cashfree's internal cf_order_id) — this is what
    // the webhook echoes back, and what we store in payments.cf_order_id to
    // match against.
    const orderId = `sub_${subscription_id.slice(0, 20)}_${Date.now()}`

    const cfRes = await fetch(`${CASHFREE_BASE}/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': APP_ID,
        'x-client-secret': SECRET_KEY,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount_paise / 100, // Cashfree wants rupees, not paise
        order_currency: 'INR',
        customer_details: {
          customer_id: sanitizeCustomerId(user.id),
          customer_phone: sanitizePhone(userRow?.phone ?? ''),
          customer_name: userRow?.name || undefined,
        },
      }),
    })

    if (!cfRes.ok) {
      const body = await cfRes.text()
      console.error('Cashfree order creation failed:', body)
      throw new Error('Cashfree order creation failed')
    }

    const cfOrder = await cfRes.json()

    // Insert pending payment row. Checked, not fire-and-forget: the webhook
    // matches on cf_order_id to activate the subscription, so a failed insert
    // means a paid customer whose plan never activates.
    const { error: payErr } = await supabase.from('payments').insert({
      user_id: user.id,
      subscription_id,
      amount: amount_paise,
      status: 'created',
      cf_order_id: orderId,
      coupon_id: coupon?.id ?? null,
      meal_price_paise: coupon?.meal_price_paise ?? null,
      discount_paise: coupon?.discount_paise ?? null,
    })
    if (payErr) {
      console.error('cashfree-create-order: payments insert failed:', payErr.message)
      return new Response(
        JSON.stringify({ error: 'Could not start the payment. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        order_id: orderId,
        payment_session_id: cfOrder.payment_session_id,
        environment: CASHFREE_ENV,
        amount_paise,
        cash_paise,
        coupon_code: coupon?.code ?? null,
        discount_paise: coupon?.discount_paise ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('cashfree-create-order error:', err)
    return new Response(
      JSON.stringify({ error: 'Could not create payment order. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
