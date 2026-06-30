import { createClient } from 'jsr:@supabase/supabase-js@2'

// Edit a single day's cart on an EXISTING base order:
//
//   op = 'add_addon'    { addon_id }  — attach an add-on to the day.
//   op = 'remove_addon' { addon_id }  — detach a non-default add-on.
//   op = 'inc_qty'                    — +1 base portion (never re-bills here).
//   op = 'dec_qty'                    — -1 base portion (never below the slot floor).
//
// IMPORTANT: no money moves here. The wallet is the billing ledger and is
// debited ON DELIVERY by advance_batch_delivered, which bills orders.cart_total
// (base × quantity + add-on lines). Charging here as well would double-bill at
// delivery. We only mutate the cart and re-snapshot cart_total, returning it
// plus the wallet balance so the client can warn before the day locks.
//
// Default add-ons (from the subscription) can't be removed here.

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
    const { order_id, op, addon_id } = await req.json() as {
      order_id?: string
      op?: 'add_addon' | 'remove_addon' | 'inc_qty' | 'dec_qty'
      addon_id?: string
    }
    if (!order_id || !op) return json({ error: 'order_id and op are required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // ── Load + guard the base order ───────────────────────────────────────
    const { data: order } = await supabase
      .from('orders')
      .select('id, user_id, subscription_id, delivery_date, meal_slot, status, quantity, unit_price')
      .eq('id', order_id)
      .single()
    if (!order || order.user_id !== user.id) return json({ error: 'Order not found' }, 404)
    if (['delivered', 'cancelled', 'skipped'].includes(order.status)) {
      return json({ error: 'This delivery can no longer be changed' }, 400)
    }
    if (order.delivery_date < new Date().toISOString().split('T')[0]) {
      return json({ error: 'Cannot edit a past order' }, 400)
    }

    // Backfill the base-meal rate snapshot on older orders so cart_total is right.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('meals_lunch, meals_dinner, plan_id, plans ( base_price, meals_total )')
      .eq('id', order.subscription_id)
      .single()
    const plan = (sub as any)?.plans as { base_price: number; meals_total: number } | null
    if (order.unit_price == null && plan) {
      const rate = Math.round(plan.base_price / Math.max(plan.meals_total, 1))
      await supabase.from('orders').update({ unit_price: rate }).eq('id', order.id)
      order.unit_price = rate
    }

    // ── add_addon (idempotent) ────────────────────────────────────────────
    if (op === 'add_addon') {
      if (!addon_id) return json({ error: 'addon_id required' }, 400)
      const { data: addon } = await supabase
        .from('addons').select('id, price_per_meal').eq('id', addon_id).maybeSingle()
      if (!addon) return json({ error: 'Add-on not found' }, 404)

      const { data: existing } = await supabase
        .from('order_addons')
        .select('id').eq('order_id', order.id).eq('addon_id', addon_id).eq('kind', 'addon').maybeSingle()
      if (!existing) {
        await supabase.from('order_addons').insert({
          order_id: order.id, addon_id, kind: 'addon', quantity: 1, unit_price: addon.price_per_meal,
        })
      }
    }

    // ── remove_addon (defaults are protected) ─────────────────────────────
    if (op === 'remove_addon') {
      if (!addon_id) return json({ error: 'addon_id required' }, 400)
      const { data: isDefault } = await supabase
        .from('subscription_addons').select('id')
        .eq('subscription_id', order.subscription_id).eq('addon_id', addon_id).maybeSingle()
      if (isDefault) return json({ error: 'cannot_remove_default_addon' }, 400)
      await supabase.from('order_addons')
        .delete().eq('order_id', order.id).eq('addon_id', addon_id).eq('kind', 'addon')
    }

    // ── inc_qty / dec_qty (billed on delivery, not here) ──────────────────
    if (op === 'inc_qty') {
      await supabase.from('orders')
        .update({ quantity: (order.quantity ?? 1) + 1, updated_at: new Date().toISOString() })
        .eq('id', order.id)
    }
    if (op === 'dec_qty') {
      const floor = Math.max(order.meal_slot === 'dinner' ? (sub?.meals_dinner ?? 0) : (sub?.meals_lunch ?? 1), 1)
      if ((order.quantity ?? 1) <= floor) return json({ error: 'below_minimum', floor }, 400)
      await supabase.from('orders')
        .update({ quantity: (order.quantity ?? 1) - 1, updated_at: new Date().toISOString() })
        .eq('id', order.id)
    }

    // Re-snapshot the cart total and report the wallet balance for warnings.
    const { data: cartTotal } = await supabase.rpc('recompute_order_cart', { p_order: order.id })
    const { data: wallet } = await supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle()
    return json({ ok: true, order_id: order.id, cart_total: cartTotal ?? null, wallet_balance: wallet?.balance ?? 0 })
  } catch (err) {
    console.error('update-day-cart error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
