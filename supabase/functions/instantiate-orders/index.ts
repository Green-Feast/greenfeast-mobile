import { createClient } from 'jsr:@supabase/supabase-js@2'

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toISO(date: Date): string {
  return date.toISOString().split('T')[0]
}

function next14Days(): Date[] {
  const dates: Date[] = []
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  for (let i = 0; i < 14; i++) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() + i)
    dates.push(d)
  }
  return dates
}

async function processSubscription(supabase: any, subId: string): Promise<number> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, user_id, batch_id, status, payment_method, pause_from, pause_until, meals_lunch, meals_dinner, menu_type')
    .eq('id', subId)
    .single()

  // Active subs always get orders. CoD subs get orders while still 'pending'
  // (deliveries start before cash is collected). Online 'pending' subs do not.
  const eligible = sub && (sub.status === 'active' || (sub.status === 'pending' && sub.payment_method === 'cod'))
  if (!eligible) return 0

  const [{ data: schedule }, { data: addr }, { data: subAddons }, { data: weeklyMenus }] = await Promise.all([
    supabase
      .from('subscription_schedule')
      .select('day_of_week, meal_template_id')
      .eq('subscription_id', subId),
    supabase
      .from('addresses')
      .select('id')
      .eq('user_id', sub.user_id)
      .eq('is_default', true)
      .maybeSingle(),
    supabase
      .from('subscription_addons')
      .select('addon_id, sub_option')
      .eq('subscription_id', subId),
    supabase
      .from('weekly_menu')
      .select('day_of_week, meal_slot, meal_template_id')
      .eq('menu_type', sub.menu_type ?? 'M1'),
  ])

  if (!schedule || schedule.length === 0) return 0

  // day_of_week → meal_template_id lookup from subscription_schedule (fallback)
  const scheduleMap: Record<string, string> = {}
  for (const row of schedule) scheduleMap[row.day_of_week] = row.meal_template_id

  // (day_of_week, meal_slot) → meal_template_id lookup from weekly_menu
  const weeklyMenuMap: Record<string, Record<string, string>> = {}
  for (const row of (weeklyMenus ?? [])) {
    if (!weeklyMenuMap[row.day_of_week]) weeklyMenuMap[row.day_of_week] = {}
    weeklyMenuMap[row.day_of_week][row.meal_slot] = row.meal_template_id
  }

  // ingredient snapshot cache — avoids re-querying the same meal template
  const ingredientCache: Record<string, any[]> = {}
  async function getIngredients(templateId: string) {
    if (ingredientCache[templateId]) return ingredientCache[templateId]
    const { data } = await supabase
      .from('template_ingredients')
      .select('quantity, ingredients ( id, name, unit )')
      .eq('meal_template_id', templateId)
    ingredientCache[templateId] = data ?? []
    return ingredientCache[templateId]
  }

  let created = 0

  for (const date of next14Days()) {
    const dow = DOW_NAMES[date.getUTCDay()]
    // weekly_menu uses Mon=0..Sun=6 to match the Kitchen admin UI convention
    const dowNum = (date.getUTCDay() + 6) % 7
    const dateStr = toISO(date)

    // Skip pause range
    if (sub.pause_from && sub.pause_until && dateStr >= sub.pause_from && dateStr <= sub.pause_until) continue

    const slots: Array<'lunch' | 'dinner'> = []
    if ((sub.meals_lunch ?? 1) > 0) slots.push('lunch')
    if ((sub.meals_dinner ?? 0) > 0) slots.push('dinner')

    for (const slot of slots) {
      // Try weekly_menu first (by menu_type + day_of_week + meal_slot),
      // fall back to subscription_schedule (by day_of_week)
      let mealTemplateId = weeklyMenuMap[dowNum]?.[slot]
      if (!mealTemplateId) mealTemplateId = scheduleMap[dow]
      if (!mealTemplateId) continue

      const { data: order, error: insertErr } = await supabase
        .from('orders')
        .insert({
          user_id: sub.user_id,
          subscription_id: subId,
          meal_template_id: mealTemplateId,
          batch_id: sub.batch_id ?? null,
          address_id: addr?.id ?? null,
          delivery_date: dateStr,
          meal_slot: slot,
          status: 'scheduled',
          is_customized: false,
        })
        .select('id')
        .single()

      if (insertErr) {
        // 23505 = unique violation → order already exists; skip ingredients
        if (insertErr.code === '23505') continue
        console.error(`Order insert failed (${dateStr} ${slot}):`, insertErr.message)
        continue
      }

      // Snapshot ingredients from template
      const ingredients = await getIngredients(mealTemplateId)
      if (ingredients.length > 0) {
        await supabase.from('order_ingredients').insert(
          ingredients.map((ti: any) => ({
            order_id: order.id,
            ingredient_id: ti.ingredients.id,
            ingredient_name: ti.ingredients.name,
            quantity: ti.quantity,
            unit: ti.ingredients.unit,
          }))
        )
      }

      // Copy subscription addons to this order
      if (subAddons && subAddons.length > 0) {
        await supabase.from('order_addons').insert(
          subAddons.map((a: any) => ({
            order_id: order.id,
            addon_id: a.addon_id,
            sub_option: a.sub_option ?? null,
          }))
        )
      }

      created++
    }
  }

  return created
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const isServiceRole = token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    let body: any = {}
    try { body = await req.json() } catch { /* no body in cron invocations */ }

    // Non-service-role callers (the app, after a CoD signup) may only
    // instantiate their OWN subscription, identified by a valid user JWT.
    if (!isServiceRole) {
      const { data: { user }, error } = await supabase.auth.getUser(token)
      if (error || !user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      }
      if (!body.subscription_id) {
        return new Response(JSON.stringify({ error: 'subscription_id required' }), { status: 400 })
      }
      const { data: ownSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('id', body.subscription_id)
        .eq('user_id', user.id)
        .single()
      if (!ownSub) {
        return new Response(JSON.stringify({ error: 'Subscription not found' }), { status: 403 })
      }
      const created = await processSubscription(supabase, body.subscription_id)
      return new Response(
        JSON.stringify({ ok: true, orders_created: created }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    let totalCreated = 0

    if (body.subscription_id) {
      // Single subscription mode — called after payment or on resume
      totalCreated = await processSubscription(supabase, body.subscription_id)
    } else {
      // Nightly cron mode — process every active subscription
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('status', 'active')

      for (const sub of (subs ?? [])) {
        try {
          const n = await processSubscription(supabase, sub.id)
          totalCreated += n
        } catch (err) {
          console.error(`processSubscription failed for ${sub.id}:`, err)
        }
      }
    }

    return new Response(
      JSON.stringify({ ok: true, orders_created: totalCreated }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('instantiate-orders error:', err)
    return new Response(
      JSON.stringify({ error: 'Failed to instantiate orders' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
