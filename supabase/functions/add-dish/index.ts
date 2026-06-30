import { createClient } from 'jsr:@supabase/supabase-js@2'

// Add an extra dish to an existing delivery slot (e.g. a 2nd lunch with a
// different meal). The dish is PREPAID at add time: the base per-meal rate is
// debited from the wallet and the subscription's remaining-meals counter is
// decremented by one. The new order row is flagged extra_dish=true so delivery
// settlement never bills it again.

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
    // order_id: any existing order in the target (date, slot) — used to derive
    // subscription / date / slot / batch / address. meal_template_id: dish to add.
    const { order_id, meal_template_id } = await req.json()
    if (!order_id || !meal_template_id) {
      return json({ error: 'order_id and meal_template_id are required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // Reference order — verify ownership and that the slot is still open.
    const { data: ref } = await supabase
      .from('orders')
      .select('id, user_id, subscription_id, delivery_date, meal_slot, batch_id, address_id, status')
      .eq('id', order_id)
      .single()

    if (!ref || ref.user_id !== user.id) return json({ error: 'Order not found' }, 404)
    if (['delivered', 'cancelled', 'skipped'].includes(ref.status)) {
      return json({ error: 'Cannot add to a delivered, cancelled, or skipped slot' }, 400)
    }
    if (ref.delivery_date < new Date().toISOString().split('T')[0]) {
      return json({ error: 'Cannot add to a past order' }, 400)
    }

    // Base per-meal rate (paise) from the plan — add-ons are not included.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('deliveries_remaining, plan_id')
      .eq('id', ref.subscription_id)
      .single()
    const { data: plan } = await supabase
      .from('plans')
      .select('base_price, meals_total')
      .eq('id', sub?.plan_id)
      .maybeSingle()

    if (!plan) return json({ error: 'Plan not found' }, 404)
    const rate = Math.round(plan.base_price / Math.max(plan.meals_total, 1))

    // Funds check before creating anything.
    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', user.id)
      .maybeSingle()
    if ((wallet?.balance ?? 0) < rate) {
      return json({ error: 'insufficient_balance', required: rate }, 402)
    }

    // Next slot_seq for this (subscription, date, slot).
    const { data: existing } = await supabase
      .from('orders')
      .select('slot_seq')
      .eq('subscription_id', ref.subscription_id)
      .eq('delivery_date', ref.delivery_date)
      .eq('meal_slot', ref.meal_slot)
      .order('slot_seq', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextSeq = (existing?.slot_seq ?? 0) + 1

    // Create the extra dish order.
    const { data: created, error: insertErr } = await supabase
      .from('orders')
      .insert({
        user_id: user.id,
        subscription_id: ref.subscription_id,
        meal_template_id,
        batch_id: ref.batch_id ?? null,
        address_id: ref.address_id ?? null,
        delivery_date: ref.delivery_date,
        meal_slot: ref.meal_slot,
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

    // Prepay: debit wallet (idempotent on the new order id) and burn one meal.
    await supabase.rpc('wallet_debit', {
      p_user: user.id,
      p_amount: rate,
      p_reason: 'Extra dish added',
      p_reference_id: `adddish-${created.id}`,
    })
    await supabase
      .from('subscriptions')
      .update({
        deliveries_remaining: Math.max((sub?.deliveries_remaining ?? 0) - 1, 0),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ref.subscription_id)

    return json({ ok: true, order_id: created.id, charged: rate })
  } catch (err) {
    console.error('add-dish error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
