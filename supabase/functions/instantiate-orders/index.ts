import { createClient } from 'jsr:@supabase/supabase-js@2'
import { mealRate } from '../_shared/pricing.ts'

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toISO(date: Date): string {
  return date.toISOString().split('T')[0]
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
// Same cutoffs as is_slot_locked (migrations 031, 075): 9 AM lunch, 2 PM dinner, IST.
const SLOT_CUTOFF_HOUR: Record<'lunch' | 'dinner', number> = { lunch: 9, dinner: 14 }

// A weekly-menu drink that can go on a delivery (is_deliverable_drink, migration
// 088: active + valid for plans), with its name; null means "chef's choice".
// Cached for one request so the nightly run asks once per drink, not per plan.
type DrinkInfo = { name: string } | null
type DrinkCache = Map<string, DrinkInfo>

async function deliverableDrink(supabase: any, id: string, cache: DrinkCache): Promise<DrinkInfo> {
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  const { data: ok, error } = await supabase.rpc('is_deliverable_drink', { p_drink: id })
  if (error) throw error // fail closed: better no order tonight than one with the wrong drink
  let info: DrinkInfo = null
  if (ok === true) {
    const { data: t, error: nameErr } = await supabase.from('meal_templates').select('name').eq('id', id).maybeSingle()
    if (nameErr) throw nameErr
    if (t?.name) info = { name: t.name }
  }
  cache.set(id, info)
  return info
}

// The 14-day window starts from today's IST date. It used the UTC date, which
// at the nightly 1 AM IST run is still yesterday — so the window started a day
// in the past.
function next14Days(): Date[] {
  const dates: Date[] = []
  const today = new Date(Date.now() + IST_OFFSET_MS)
  today.setUTCHours(0, 0, 0, 0)
  for (let i = 0; i < 14; i++) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() + i)
    dates.push(d)
  }
  return dates
}

async function processSubscription(supabase: any, subId: string, drinkCache: DrinkCache): Promise<number> {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, user_id, batch_id_lunch, batch_id_dinner, status, payment_method, pause_from, pause_until, meals_lunch, meals_dinner, menu_type, plan_id, deliveries_remaining, start_date, meal_price_paise, no_delivery_days')
    .eq('id', subId)
    .single()

  // Only active plans get orders. Cash-on-delivery plans are active too
  // (first day paid online at signup, or set up by the admin) — 052.
  if (!sub || sub.status !== 'active') return 0

  const [{ data: schedule }, { data: addr }, { data: subAddons, error: addonsErr }, { data: weeklyMenus, error: menuErr }, { data: plan }, { data: rules }] = await Promise.all([
    supabase
      .from('subscription_schedule')
      .select('day_of_week, meal_template_id')
      .eq('subscription_id', subId),
    // Default address (one per customer since 052); archived ones never.
    supabase
      .from('addresses')
      .select('id')
      .eq('user_id', sub.user_id)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('created_at')
      .limit(1)
      .maybeSingle(),
    supabase
      .from('subscription_addons')
      .select('addon_id, sub_option, addons(price_per_meal, is_drink)')
      .eq('subscription_id', subId),
    // One weekly menu for everyone (052 removed the M2 track).
    supabase
      .from('weekly_menu')
      .select('day_of_week, meal_slot, meal_template_id, drink_template_id')
      .eq('menu_type', 'M1'),
    supabase
      .from('plans')
      .select('base_price, meals_total')
      .eq('id', sub.plan_id)
      .maybeSingle(),
    // "Same dish every day" rules set by ops (Kitchen / subscriber profile).
    supabase
      .from('customer_meal_rules')
      .select('meal_slot, day_of_week, meal_template_id, meal_templates ( is_active, subscription_valid )')
      .eq('user_id', sub.user_id),
  ])

  // Without the add-on lines (or the menu) an order would be made at the wrong
  // price or with the wrong dish, so a failed load makes nothing; the next run retries.
  if (addonsErr || menuErr) {
    console.error(`add-on / weekly menu load failed for ${subId}:`, (addonsErr ?? menuErr).message)
    return 0
  }

  // "slot|dow" (a weekday) or "slot|*" (every day) → fixed dish. A dish that
  // has since been switched off falls back to the weekly menu.
  const fixedMap: Record<string, string> = {}
  for (const r of (rules ?? []) as any[]) {
    const t = Array.isArray(r.meal_templates) ? r.meal_templates[0] : r.meal_templates
    if (!t?.is_active || !t?.subscription_valid) continue
    fixedMap[`${r.meal_slot}|${r.day_of_week ?? '*'}`] = r.meal_template_id
  }

  // day_of_week → meal_template_id lookup from subscription_schedule (fallback)
  const scheduleMap: Record<string, string> = {}
  for (const row of (schedule ?? [])) {
    if (row.meal_template_id) scheduleMap[row.day_of_week] = row.meal_template_id
  }

  // (day_of_week integer, meal_slot) → meal_template_id lookup from weekly_menu
  const weeklyMenuMap: Record<number, Record<string, string>> = {}
  for (const row of (weeklyMenus ?? [])) {
    if (!weeklyMenuMap[row.day_of_week]) weeklyMenuMap[row.day_of_week] = {}
    if (row.meal_template_id) weeklyMenuMap[row.day_of_week][row.meal_slot] = row.meal_template_id
  }

  // (day_of_week integer, meal_slot) → drink (meal_templates id) from weekly_menu (088)
  const weeklyDrinkMap: Record<number, Record<string, string>> = {}
  for (const row of (weeklyMenus ?? [])) {
    if (!row.drink_template_id) continue
    if (!weeklyDrinkMap[row.day_of_week]) weeklyDrinkMap[row.day_of_week] = {}
    weeklyDrinkMap[row.day_of_week][row.meal_slot] = row.drink_template_id
  }
  // The plan has a drink when one of its add-ons is the drink add-on (addons.is_drink).
  // Its price is already in addonTotal below; the drink only decides sub_option.
  const hasDrink = (subAddons ?? []).some((a: any) => a.addons?.is_drink)

  // No delivery days (089): the customer chose none, so an empty schedule does NOT
  // mean every day. Only the schedule's own rows count (an office-set Sunday); with
  // none there is nothing to deliver. Plans without the flag keep the old rule:
  // no schedule rows = every day the kitchen cooks.
  const noDeliveryDays = sub.no_delivery_days === true
  if (noDeliveryDays && Object.keys(scheduleMap).length === 0) return 0

  // Bail only if no source has any meals to offer
  const hasScheduleDays = noDeliveryDays || Object.keys(scheduleMap).length > 0
  if (!hasScheduleDays && Object.keys(weeklyMenuMap).length === 0 && Object.keys(fixedMap).length === 0) return 0

  // Compute per-meal unit_price (paise) to snapshot on each order: the plan's
  // meal price (its coupon price if it was bought with one) + add-ons.
  const addonTotal = (subAddons ?? []).reduce((sum: number, a: any) => sum + (a.addons?.price_per_meal ?? 0), 0)
  const rate = mealRate(sub, plan)
  const unitPrice: number | null = rate == null ? null : rate + addonTotal

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

  // The wallet is the plan (079): never schedule more than the money left
  // after every meal already made (extras included) — wallet plus any cash
  // still owed on the plan. Once it can't pay for a default meal the plan is
  // finished until it's renewed.
  const { data: freePaise, error: freeErr } = await supabase.rpc('schedulable_paise', { p_user: sub.user_id })
  if (freeErr) {
    console.error(`schedulable_paise failed for ${subId}:`, freeErr.message)
    return 0
  }
  let capacity: number = freePaise ?? 0

  // Kitchen closed (holiday etc., admin → Operations): no orders for those
  // slots. The meals stay on the plan and get scheduled on later days.
  const { data: closures } = await supabase
    .from('kitchen_closures')
    .select('closed_on, meal_slot')
    .gte('closed_on', toISO(new Date(Date.now() + IST_OFFSET_MS)))
  const closed = new Set((closures ?? []).map((c: any) => `${c.closed_on}|${c.meal_slot}`))

  let created = 0
  const istNow = new Date(Date.now() + IST_OFFSET_MS)
  const todayIST = toISO(istNow)
  const istHour = istNow.getUTCHours()

  for (const date of next14Days()) {
    const dow = DOW_NAMES[date.getUTCDay()]
    // weekly_menu uses Mon=0..Sun=6 to match the Kitchen admin UI convention
    const dowNum = (date.getUTCDay() + 6) % 7
    const dateStr = toISO(date)

    // Nothing before the plan's first delivery date (set when an existing
    // customer is moved over, so the app takes over from a chosen day).
    if (sub.start_date && dateStr < sub.start_date) continue

    // Skip pause range
    if (sub.pause_from && sub.pause_until && dateStr >= sub.pause_from && dateStr <= sub.pause_until) continue

    // If the subscription has explicit delivery days, honour them — don't deliver on off days
    if (hasScheduleDays && !Object.prototype.hasOwnProperty.call(scheduleMap, dow)) continue

    const slots: Array<'lunch' | 'dinner'> = []
    if ((sub.meals_lunch ?? 1) > 0) slots.push('lunch')
    if ((sub.meals_dinner ?? 0) > 0) slots.push('dinner')

    for (const slot of slots) {
      // A slot already past today's cutoff is locked for the kitchen: creating
      // it now (e.g. a 3 PM signup getting today's lunch) is a meal nobody cooks.
      if (dateStr === todayIST && istHour >= SLOT_CUTOFF_HOUR[slot]) continue
      if (closed.has(`${dateStr}|${slot}`)) continue

      // A fixed dish for this weekday, then one for every day, then the
      // weekly menu, then the subscription_schedule fallback (by day name).
      const fixed = fixedMap[`${slot}|${dowNum}`] ?? fixedMap[`${slot}|*`]
      let mealTemplateId = fixed ?? weeklyMenuMap[dowNum]?.[slot]
      if (!mealTemplateId) mealTemplateId = scheduleMap[dow]
      if (!mealTemplateId) continue

      const slotQty = slot === 'lunch' ? (sub.meals_lunch ?? 1) : (sub.meals_dinner ?? 1)
      // No price (plan row missing) → nothing can be billed, so nothing is made.
      if (unitPrice == null) continue
      const orderCost = unitPrice * slotQty
      if (orderCost > capacity) continue

      // The day's drink: the kitchen's pick for this day and slot, if it can be
      // delivered (is_deliverable_drink); otherwise null = chef's choice and the
      // drink line keeps the subscription's own sub_option (the legacy flavour).
      let drinkId: string | null = null
      let drinkName: string | null = null
      if (hasDrink) {
        const wanted = weeklyDrinkMap[dowNum]?.[slot]
        if (wanted) {
          const drink = await deliverableDrink(supabase, wanted, drinkCache)
          if (drink) { drinkId = wanted; drinkName = drink.name }
        }
      }

      const { data: order, error: insertErr } = await supabase
        .from('orders')
        .insert({
          user_id: sub.user_id,
          subscription_id: subId,
          meal_template_id: mealTemplateId,
          batch_id: (slot === 'lunch' ? sub.batch_id_lunch : sub.batch_id_dinner) ?? null,
          address_id: addr?.id ?? null,
          delivery_date: dateStr,
          meal_slot: slot,
          status: 'scheduled',
          // A fixed dish must survive weekly-menu edits (propagateMenuChanges
          // only touches non-customised orders).
          is_customized: !!fixed,
          quantity: slotQty,
          unit_price: unitPrice,
          // Only sent when set, so nothing changes for a plan without a drink.
          ...(drinkId ? { drink_template_id: drinkId } : {}),
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
            // The drink line carries the day's drink name (088); the rest keep their flavour.
            sub_option: (a.addons?.is_drink && drinkName) ? drinkName : (a.sub_option ?? null),
          }))
        )
      }

      created++
      capacity -= orderCost
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
  // Two things satisfy "service role" here: the platform-reserved
  // SUPABASE_SERVICE_ROLE_KEY (what other edge functions — manage-subscription,
  // cashfree-webhook — read on their own side when calling this one, so those
  // calls have always matched each other correctly), and INTERNAL_FN_SECRET
  // (for callers outside Supabase's edge runtime, e.g. the admin app's Vercel
  // Cron routes — those hold the long-form legacy service_role key from
  // Supabase's dashboard, which is NOT the same string as what
  // Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') resolves to inside a function
  // on this project, so that comparison silently always failed for any
  // caller outside Supabase itself).
  const isServiceRole =
    token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    (!!Deno.env.get('INTERNAL_FN_SECRET') && token === Deno.env.get('INTERNAL_FN_SECRET'))

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Drinks looked up this run (see deliverableDrink).
    const drinkCache: DrinkCache = new Map()

    let body: any = {}
    try { body = await req.json() } catch { /* no body in cron invocations */ }

    // Non-service-role callers (the app, after checkout) may only
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
      const created = await processSubscription(supabase, body.subscription_id, drinkCache)
      return new Response(
        JSON.stringify({ ok: true, orders_created: created }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    let totalCreated = 0

    if (body.subscription_id) {
      // Single subscription mode — called after payment or on resume
      totalCreated = await processSubscription(supabase, body.subscription_id, drinkCache)
    } else {
      // Nightly cron mode — process every active subscription
      const { data: subs } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('status', 'active')

      for (const sub of (subs ?? [])) {
        try {
          const n = await processSubscription(supabase, sub.id, drinkCache)
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
