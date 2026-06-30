import { createClient } from 'jsr:@supabase/supabase-js@2'

const SWITCH_FEE_PAISE = 2000 // ₹20

// Swap a day's meal. Switching to your own menu's dish or the counterpart menu's
// dish for that day/slot is FREE; anything else adds a ₹20 "Meal switch" fee.
//
// No money moves here — the fee is recorded as a cart line (order_addons,
// kind='fee') so it lands in orders.cart_total and is billed ON DELIVERY along
// with the meal. Reverting to a free dish removes the fee line.

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
    const { order_id, meal_template_id } = await req.json()
    if (!order_id || !meal_template_id) {
      return json({ error: 'order_id and meal_template_id are required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Authenticate caller
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // Load the order and verify ownership
    const { data: order } = await supabase
      .from('orders')
      .select('id, user_id, subscription_id, delivery_date, meal_slot, meal_template_id, status')
      .eq('id', order_id)
      .single()

    if (!order || order.user_id !== user.id) return json({ error: 'Order not found' }, 404)
    if (['delivered', 'cancelled', 'skipped'].includes(order.status)) {
      return json({ error: 'Cannot switch a delivered, cancelled, or skipped order' }, 400)
    }
    if (order.delivery_date < new Date().toISOString().split('T')[0]) {
      return json({ error: 'Cannot switch a past order' }, 400)
    }
    if (order.meal_template_id === meal_template_id) {
      return json({ ok: true, charged: false }) // nothing to do
    }

    // Load subscription to find its menu_type
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('menu_type')
      .eq('id', order.subscription_id)
      .single()

    const myMenuType = sub?.menu_type ?? 'M1'
    const counterpart = myMenuType === 'M1' ? 'M2' : 'M1'

    // Derive day_of_week (Mon=0) for the delivery date
    const deliveryDate = new Date(order.delivery_date + 'T00:00:00Z')
    const dowNum = (deliveryDate.getUTCDay() + 6) % 7

    // Both the user's own menu dish and the counterpart's dish are free swaps.
    const { data: menuRows } = await supabase
      .from('weekly_menu')
      .select('meal_template_id')
      .in('menu_type', [myMenuType, counterpart])
      .eq('day_of_week', dowNum)
      .eq('meal_slot', order.meal_slot)
    const freeSet = new Set((menuRows ?? []).map((m: any) => m.meal_template_id).filter(Boolean))
    const isFreeSwitch = freeSet.has(meal_template_id)

    // Apply the swap.
    await supabase
      .from('orders')
      .update({
        meal_template_id,
        is_customized: true,
        switch_fee_paise: 0, // fee now lives on a cart line, not this column
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id)

    // Reconcile the "Meal switch" fee line: remove any existing one, then add a
    // single line back only if the new dish is off-menu.
    await supabase.from('order_addons')
      .delete().eq('order_id', order_id).eq('kind', 'fee').eq('label', 'Meal switch')
    if (!isFreeSwitch) {
      await supabase.from('order_addons').insert({
        order_id, addon_id: null, kind: 'fee', label: 'Meal switch',
        quantity: 1, unit_price: SWITCH_FEE_PAISE,
      })
    }

    // Re-snapshot the cart total so the fee shows up immediately in the app.
    await supabase.rpc('recompute_order_cart', { p_order: order_id })

    return json({ ok: true, charged: false, fee_paise: isFreeSwitch ? 0 : SWITCH_FEE_PAISE, billed: 'on_delivery' })
  } catch (err) {
    console.error('switch-meal error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
