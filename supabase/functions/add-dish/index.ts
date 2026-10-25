import { createClient } from 'jsr:@supabase/supabase-js@2'

// Sunday is GreenFeast's day off: customers can't add, swap, resize or remove
// anything on a Sunday. Only the office (admin, which doesn't use this
// function) can put a meal there, for special cases.
const isSunday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay() === 0

// Add an extra dish to a delivery slot. The dish is NOT charged here — it's
// billed ON DELIVERY like every other meal: advance_batch_delivered debits
// its cart_total and burns one delivery from the counter. The row is flagged
// extra_dish=true only so the UI can group it under the slot; it is billed
// the same as a base meal.
//
// Two ways to call this, exactly one required:
//
//   { order_id, meal_template_id, meal_slot? }
//     Existing behaviour — order_id is any existing order for the same day
//     (any slot), used to derive subscription/date/batch/address. meal_slot
//     is optional, defaulting to the reference order's own slot; pass it
//     explicitly to add into a slot that has no order yet on that date (e.g.
//     a dinner dish on a lunch-only plan), using the lunch order as reference.
//
//   { subscription_id, delivery_date, meal_slot, meal_template_id }
//     Off-day path — for a date with ZERO existing orders in any slot (e.g. a
//     weekday the subscriber turned off in their default plan). No reference
//     order exists to derive anything from, so subscription ownership, date
//     bounds and address all have to be established directly instead.
//
// Either way, address_id (one of the customer's own addresses) sends this
// dish somewhere else — e.g. one portion home, one to the office. Its batch
// follows that address (orders_batch_from_address, migration 052).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// The session JWT is verified locally against the project's signing keys
// (getClaims, keys cached by this warm worker) instead of a round trip to the
// Auth server on every tap; the client lives at module scope so the cache and
// connections survive between requests.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

async function userFrom(req: Request): Promise<{ id: string } | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  if (!token) return null
  const { data, error } = await supabase.auth.getClaims(token)
  const sub = data?.claims?.sub
  if (error || !sub || data?.claims?.role !== 'authenticated') return null
  return { id: sub as string }
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { order_id, subscription_id, delivery_date, meal_template_id, meal_slot, address_id, quantity } = await req.json()
    // Portions of this dish (one call instead of an inc_qty call per portion).
    const qty = Math.min(Math.max(Number.isInteger(quantity) ? quantity : 1, 1), 10)
    if (!meal_template_id) return json({ error: 'meal_template_id is required' }, 400)
    if (!order_id && !subscription_id) {
      return json({ error: 'Either order_id or subscription_id is required' }, 400)
    }
    if (order_id && subscription_id) {
      return json({ error: 'Pass order_id or subscription_id, not both' }, 400)
    }
    if (meal_slot && !['lunch', 'dinner'].includes(meal_slot)) {
      return json({ error: 'meal_slot must be lunch or dinner' }, 400)
    }

    const user = await userFrom(req)
    if (!user) return json({ error: 'Unauthorized' }, 401)

    // ── Derive a common context — { subscriptionId, effectiveDate,
    //    effectiveSlot, addressId } — from whichever path was used. ────────
    let subscriptionId: string
    let effectiveDate: string
    let effectiveSlot: 'lunch' | 'dinner'
    let addressId: string | null

    if (order_id) {
      const { data: ref } = await supabase
        .from('orders')
        .select('id, user_id, subscription_id, delivery_date, meal_slot, address_id, status')
        .eq('id', order_id)
        .single()

      if (!ref || ref.user_id !== user.id) return json({ error: 'Order not found' }, 404)
      if (['delivered', 'cancelled', 'skipped'].includes(ref.status)) {
        return json({ error: 'Cannot add to a delivered, cancelled, or skipped slot' }, 400)
      }

      subscriptionId = ref.subscription_id
      effectiveDate = ref.delivery_date
      effectiveSlot = (meal_slot ?? ref.meal_slot) as 'lunch' | 'dinner'
      addressId = ref.address_id ?? null
    } else {
      if (!delivery_date || !meal_slot) {
        return json({ error: 'delivery_date and meal_slot are required with subscription_id' }, 400)
      }

      // Ownership — mirrors the app's own subscription queries (e.g.
      // AddToDaySheet): active or paused plans.
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('id, user_id, status, end_date')
        .eq('id', subscription_id)
        .single()
      if (!sub || sub.user_id !== user.id) return json({ error: 'Subscription not found' }, 404)
      if (sub.status !== 'active' && sub.status !== 'paused') return json({ error: 'Subscription is not active' }, 400)
      if (sub.end_date && delivery_date > sub.end_date) {
        return json({ error: 'That date is after your subscription ends' }, 400)
      }

      subscriptionId = subscription_id
      effectiveDate = delivery_date
      effectiveSlot = meal_slot

      // Address — the customer's default (the app can pass address_id to
      // pick another), else none (the order_id path tolerates null too).
      const { data: addr } = await supabase
        .from('addresses')
        .select('id, is_default')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('is_default', { ascending: false })
        .limit(1)
        .maybeSingle()
      addressId = addr?.id ?? null
    }

    if (address_id) {
      const { data: own } = await supabase
        .from('addresses')
        .select('id')
        .eq('id', address_id)
        .eq('user_id', user.id)
        .is('archived_at', null)
        .maybeSingle()
      if (!own) return json({ error: 'Address not found' }, 404)
      addressId = own.id
    }

    // Everything that has to be true before adding, checked together: slot
    // still open, kitchen open, dish available that day (the app greys these
    // out, but a client check is UX only) and allowed on plans, meals left.
    // Also the subscription's slot batches (orders without an address ride
    // them) and the next slot_seq for this (subscription, date, slot).
    if (isSunday(effectiveDate)) return json({ error: 'Sunday is our day off — message us on WhatsApp if you need something special.' }, 400)

    const [
      { data: locked }, { data: closed }, { data: unavailable }, { data: dish }, { data: sub }, { data: existing },
    ] = await Promise.all([
      supabase.rpc('is_slot_locked', { p_date: effectiveDate, p_slot: effectiveSlot }),
      supabase
        .from('kitchen_closures')
        .select('reason')
        .eq('closed_on', effectiveDate)
        .eq('meal_slot', effectiveSlot)
        .maybeSingle(),
      supabase
        .from('meal_availability')
        .select('is_available')
        .eq('for_date', effectiveDate)
        .eq('meal_template_id', meal_template_id)
        .eq('is_available', false)
        .maybeSingle(),
      supabase
        .from('meal_templates')
        .select('is_active, subscription_valid')
        .eq('id', meal_template_id)
        .maybeSingle(),
      supabase
        .from('subscriptions')
        .select('plan_id, batch_id_lunch, batch_id_dinner, deliveries_remaining, plans ( base_price, meals_total )')
        .eq('id', subscriptionId)
        .single(),
      supabase
        .from('orders')
        .select('slot_seq')
        .eq('subscription_id', subscriptionId)
        .eq('delivery_date', effectiveDate)
        .eq('meal_slot', effectiveSlot)
        .order('slot_seq', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    if (locked) {
      return json({ error: 'Cannot add — this slot has already locked for the day.' }, 400)
    }
    if (closed) {
      return json({ error: `The kitchen is closed for ${effectiveSlot} that day${closed.reason ? ` (${closed.reason})` : ''}.` }, 400)
    }
    if (unavailable) {
      return json({ error: 'This dish is not available on that date.' }, 400)
    }
    if (!dish || !dish.is_active || !dish.subscription_valid) {
      return json({ error: 'This dish is not available for subscription orders.' }, 400)
    }
    if (!sub) return json({ error: 'Subscription not found' }, 404)
    if ((sub.deliveries_remaining ?? 0) <= 0) {
      return json({ error: 'No deliveries remaining on this plan' }, 400)
    }
    // Base per-meal rate (paise) from the plan — add-ons are not included.
    const plan = (Array.isArray((sub as any).plans) ? (sub as any).plans[0] : (sub as any).plans) as
      { base_price: number; meals_total: number } | null
    if (!plan) return json({ error: 'Plan not found' }, 404)
    const rate = Math.round(plan.base_price / Math.max(plan.meals_total, 1))

    // Zero existing rows (the off-day case) resolves to slot_seq 1, leaving 0
    // unused for that (date, slot) — harmless, advance_batch_delivered just
    // sorts by it.
    const nextSeq = (existing?.slot_seq ?? 0) + 1

    // Create the extra dish order.
    const { data: created, error: insertErr } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        subscription_id: subscriptionId,
        meal_template_id,
        batch_id: (effectiveSlot === 'lunch' ? sub.batch_id_lunch : sub.batch_id_dinner) ?? null,
        address_id: addressId,
        delivery_date: effectiveDate,
        meal_slot: effectiveSlot,
        status: 'scheduled',
        is_customized: true,
        extra_dish: true,
        quantity: qty,
        unit_price: rate,
        slot_seq: nextSeq,
      })
      .select('id')
      .single()

    if (insertErr || !created) {
      console.error('add-dish insert failed:', insertErr?.message)
      return json({ error: 'Could not add dish' }, 500)
    }

    // Snapshot ingredients for the kitchen and the cart total (so the dish
    // shows its price right away). The wallet is debited and the counter
    // burned ON DELIVERY (not here).
    await Promise.all([
      supabase.rpc('snapshot_order_ingredients', { p_order: created.id }),
      supabase.rpc('recompute_order_cart', { p_order: created.id }),
    ])

    return json({ ok: true, order_id: created.id, billed: 'on_delivery', amount: rate * qty })
  } catch (err) {
    console.error('add-dish error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
