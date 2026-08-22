import { createClient } from 'jsr:@supabase/supabase-js@2'

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const { order_id, subscription_id, delivery_date, meal_template_id, meal_slot } = await req.json()
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

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
      // AddToDaySheet): active/paused, or pending-but-already-paying-COD.
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('id, user_id, status, payment_method, end_date')
        .eq('id', subscription_id)
        .single()
      if (!sub || sub.user_id !== user.id) return json({ error: 'Subscription not found' }, 404)
      const validStatus =
        sub.status === 'active' || sub.status === 'paused' || (sub.status === 'pending' && sub.payment_method === 'cod')
      if (!validStatus) return json({ error: 'Subscription is not active' }, 400)
      if (sub.end_date && delivery_date > sub.end_date) {
        return json({ error: 'That date is after your subscription ends' }, 400)
      }

      subscriptionId = subscription_id
      effectiveDate = delivery_date
      effectiveSlot = meal_slot

      // Address — most recent order's address for this subscription (where
      // they've actually been receiving deliveries), else their default
      // address, else any, else null (the existing order_id path already
      // tolerates a null address the same way).
      const { data: recentOrder } = await supabase
        .from('orders')
        .select('address_id')
        .eq('subscription_id', subscriptionId)
        .not('address_id', 'is', null)
        .order('delivery_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (recentOrder?.address_id) {
        addressId = recentOrder.address_id
      } else {
        const { data: addr } = await supabase
          .from('addresses')
          .select('id, is_default')
          .eq('user_id', user.id)
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle()
        addressId = addr?.id ?? null
      }
    }

    const { data: locked } = await supabase.rpc('is_slot_locked', {
      p_date: effectiveDate, p_slot: effectiveSlot,
    })
    if (locked) {
      return json({ error: 'Cannot add — this slot has already locked for the day.' }, 400)
    }

    // Server-side availability enforcement — the app greys these out, but a
    // client check is UX only, not a guarantee.
    const { data: unavailable } = await supabase
      .from('meal_availability')
      .select('is_available')
      .eq('for_date', effectiveDate)
      .eq('meal_template_id', meal_template_id)
      .eq('is_available', false)
      .maybeSingle()
    if (unavailable) {
      return json({ error: 'This dish is not available on that date.' }, 400)
    }

    // subscription_valid gates a dish out of subscription flows entirely
    // (menu_tab-visible-but-takeaway-only dishes) — same "client check is UX
    // only" reasoning as above.
    const { data: dish } = await supabase
      .from('meal_templates')
      .select('is_active, subscription_valid')
      .eq('id', meal_template_id)
      .maybeSingle()
    if (!dish || !dish.is_active || !dish.subscription_valid) {
      return json({ error: 'This dish is not available for subscription orders.' }, 400)
    }

    // Base per-meal rate (paise) from the plan — add-ons are not included.
    // Also fetch both slot batches: a dinner dish added off a lunch reference
    // order (or vice versa) must ride the subscription's batch for the slot
    // it's actually being added to, not the reference order's own batch.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan_id, batch_id_lunch, batch_id_dinner, deliveries_remaining')
      .eq('id', subscriptionId)
      .single()
    if (!sub) return json({ error: 'Subscription not found' }, 404)
    if ((sub.deliveries_remaining ?? 0) <= 0) {
      return json({ error: 'No deliveries remaining on this plan' }, 400)
    }
    const { data: plan } = await supabase
      .from('plans')
      .select('base_price, meals_total')
      .eq('id', sub.plan_id)
      .maybeSingle()

    if (!plan) return json({ error: 'Plan not found' }, 404)
    const rate = Math.round(plan.base_price / Math.max(plan.meals_total, 1))

    // Next slot_seq for this (subscription, date, slot). Zero existing rows
    // (the off-day case) resolves to slot_seq 1, leaving 0 unused for that
    // (date, slot) — harmless, advance_batch_delivered just sorts by it.
    const { data: existing } = await supabase
      .from('orders')
      .select('slot_seq')
      .eq('subscription_id', subscriptionId)
      .eq('delivery_date', effectiveDate)
      .eq('meal_slot', effectiveSlot)
      .order('slot_seq', { ascending: false })
      .limit(1)
      .maybeSingle()
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
        quantity: 1,
        unit_price: rate,
        slot_seq: nextSeq,
      })
      .select('id')
      .single()

    if (insertErr || !created) {
      console.error('add-dish insert failed:', insertErr?.message)
      return json({ error: 'Could not add dish' }, 500)
    }

    // Snapshot ingredients for the kitchen.
    const { data: ings } = await supabase
      .from('template_ingredients')
      .select('quantity, ingredients ( id, name, unit )')
      .eq('meal_template_id', meal_template_id)
    if (ings && ings.length > 0) {
      await supabase.from('order_ingredients').insert(
        ings.map((ti: any) => ({
          order_id: created.id,
          ingredient_id: ti.ingredients.id,
          ingredient_name: ti.ingredients.name,
          quantity: ti.quantity,
          unit: ti.ingredients.unit,
        }))
      )
    }

    // Snapshot the cart total so the extra dish shows its price right away.
    // The wallet is debited and the counter burned ON DELIVERY (not here).
    await supabase.rpc('recompute_order_cart', { p_order: created.id })

    return json({ ok: true, order_id: created.id, billed: 'on_delivery', amount: rate })
  } catch (err) {
    console.error('add-dish error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
