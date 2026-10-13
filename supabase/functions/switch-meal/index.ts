import { createClient } from 'jsr:@supabase/supabase-js@2'

// Swap a day's meal for any subscription dish. Swaps are free (052 removed the
// ₹20 "Meal switch" fee); the meal is billed on delivery like any other, at
// the order's own rate. The kitchen's ingredient snapshot follows the new dish.

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
    const { data: locked } = await supabase.rpc('is_slot_locked', {
      p_date: order.delivery_date, p_slot: order.meal_slot,
    })
    if (locked) {
      return json({ error: 'Cannot switch — this slot has already locked for the day.' }, 400)
    }
    if (order.meal_template_id === meal_template_id) {
      return json({ ok: true, charged: false, fee_paise: 0 }) // nothing to do
    }

    // Server-side availability enforcement — the app greys these out, but a
    // client check is UX only, not a guarantee.
    const { data: unavailable } = await supabase
      .from('meal_availability')
      .select('is_available')
      .eq('for_date', order.delivery_date)
      .eq('meal_template_id', meal_template_id)
      .eq('is_available', false)
      .maybeSingle()
    if (unavailable) {
      return json({ error: 'This dish is not available on that date.' }, 400)
    }

    // subscription_valid gates a dish out of subscription flows entirely
    // (menu-visible-but-takeaway-only dishes) — same "client check is UX
    // only" reasoning as above.
    const { data: dish } = await supabase
      .from('meal_templates')
      .select('is_active, subscription_valid')
      .eq('id', meal_template_id)
      .maybeSingle()
    if (!dish || !dish.is_active || !dish.subscription_valid) {
      return json({ error: 'This dish is not available for subscription orders.' }, 400)
    }

    // Apply the swap.
    await supabase
      .from('orders')
      .update({
        meal_template_id,
        is_customized: true,
        switch_fee_paise: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order_id)

    // Any "Meal switch" fee line left from before swaps were free goes too.
    await supabase.from('order_addons')
      .delete().eq('order_id', order_id).eq('kind', 'fee').eq('label', 'Meal switch')
    await supabase.rpc('snapshot_order_ingredients', { p_order: order_id })

    // Re-snapshot the cart total.
    await supabase.rpc('recompute_order_cart', { p_order: order_id })

    return json({ ok: true, charged: false, fee_paise: 0, billed: 'on_delivery' })
  } catch (err) {
    console.error('switch-meal error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
