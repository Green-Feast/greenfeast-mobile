import { createClient } from 'jsr:@supabase/supabase-js@2'

// Starts a plan renewal: creates a NEW pending subscription that continues the
// customer's current one — same settings ("repeat"), or with a different plan
// size / meals per day / add-ons ("edit"). The app then pays for it through
// cashfree-create-order like any first purchase; on payment the webhook
// activates it and retire_previous_subscriptions() closes the finished plan.
//
// Body: { from_subscription_id, plan_id?, meals_lunch?, meals_dinner?, addon_ids? }
// Returns: { subscription_id, amount } (amount in paise, server-computed).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

const MAX_MEALS_PER_SLOT = 3

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => ({}))
    const fromId: string | undefined = body.from_subscription_id
    if (!fromId) return json({ error: 'from_subscription_id is required' }, 400)

    const { data: old } = await supabase
      .from('subscriptions')
      .select('id, user_id, status, plan_id, plan_name, menu_type, delivery_mode, meals_lunch, meals_dinner, batch_id_lunch, batch_id_dinner')
      .eq('id', fromId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!old) return json({ error: 'Plan not found' }, 404)
    if (!['active', 'paused', 'expired'].includes(old.status)) {
      return json({ error: 'This plan can’t be renewed.' }, 400)
    }

    // ── Settings for the new plan: the old ones, with any edits ──────────────
    const planId: string = body.plan_id ?? old.plan_id
    const { data: plan } = await supabase
      .from('plans')
      .select('id, base_price, meals_total, is_active')
      .eq('id', planId)
      .maybeSingle()
    if (!plan || !plan.is_active) return json({ error: 'That plan isn’t available.' }, 400)

    const mealsLunch = body.meals_lunch ?? old.meals_lunch ?? 1
    const mealsDinner = body.meals_dinner ?? old.meals_dinner ?? 0
    const okCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_MEALS_PER_SLOT
    if (!okCount(mealsLunch) || !okCount(mealsDinner) || mealsLunch + mealsDinner < 1) {
      return json({ error: 'Choose between 1 and 3 meals for lunch and/or dinner.' }, 400)
    }

    let addonRows: { addon_id: string; sub_option: string | null }[]
    if (Array.isArray(body.addon_ids)) {
      const ids = [...new Set((body.addon_ids as unknown[]).filter((x): x is string => typeof x === 'string'))]
      const { data: valid } = ids.length
        ? await supabase.from('addons').select('id').in('id', ids).eq('is_active', true)
        : { data: [] as { id: string }[] }
      if ((valid ?? []).length !== ids.length) return json({ error: 'One of those add-ons isn’t available.' }, 400)
      addonRows = ids.map((id) => ({ addon_id: id, sub_option: null }))
    } else {
      const { data: current } = await supabase
        .from('subscription_addons')
        .select('addon_id, sub_option')
        .eq('subscription_id', old.id)
      addonRows = (current ?? []) as typeof addonRows
    }

    // ── Create the pending renewal ───────────────────────────────────────────
    const { data: created, error: insErr } = await supabase
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        plan_name: old.plan_name,
        menu_type: 'M1', // one menu since 052
        status: 'pending',
        payment_method: 'online',
        delivery_mode: old.delivery_mode,
        meals_per_day: mealsLunch + mealsDinner,
        meals_lunch: mealsLunch,
        meals_dinner: mealsDinner,
        deliveries_remaining: 0,
        batch_id_lunch: old.batch_id_lunch,
        batch_id_dinner: old.batch_id_dinner,
        renewed_from: old.id,
      })
      .select('id')
      .single()
    if (insErr || !created) throw insErr ?? new Error('subscription insert failed')

    if (addonRows.length > 0) {
      const { error } = await supabase.from('subscription_addons').insert(
        addonRows.map((a) => ({ subscription_id: created.id, addon_id: a.addon_id, sub_option: a.sub_option }))
      )
      if (error) throw error
    }

    // Delivery days carry over unchanged (change them later in Plan Settings).
    const { data: schedule } = await supabase
      .from('subscription_schedule')
      .select('day_of_week, meal_template_id')
      .eq('subscription_id', old.id)
    if (schedule && schedule.length > 0) {
      const { error } = await supabase.from('subscription_schedule').insert(
        schedule.map((d: any) => ({ subscription_id: created.id, day_of_week: d.day_of_week, meal_template_id: d.meal_template_id }))
      )
      if (error) throw error
    }

    // Same formula as cashfree-create-order, which charges it.
    const { data: prices } = addonRows.length
      ? await supabase.from('addons').select('price_per_meal').in('id', addonRows.map((a) => a.addon_id))
      : { data: [] as { price_per_meal: number }[] }
    const addonPerMeal = (prices ?? []).reduce((s: number, a: any) => s + (a.price_per_meal ?? 0), 0)
    const amount = plan.base_price + addonPerMeal * plan.meals_total

    return json({ subscription_id: created.id, amount })
  } catch (err) {
    console.error('renew-subscription error:', err)
    return json({ error: 'Could not start the renewal. Please try again.' }, 500)
  }
})
