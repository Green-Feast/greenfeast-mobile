import { createClient } from 'jsr:@supabase/supabase-js@2'
import { mealRate } from '../_shared/pricing.ts'

// Sunday is GreenFeast's day off: customers can't add, swap, resize or remove
// anything on a Sunday. Only the office (admin, which doesn't use this
// function) can put a meal there, for special cases.
const isSunday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay() === 0

// Edit a single day's cart on an EXISTING base order:
//
//   op = 'add_addon'      { addon_id }  — attach an add-on to the day, at quantity 1.
//   op = 'remove_addon'   { addon_id }  — detach a non-default add-on entirely.
//   op = 'inc_qty'                      — +1 base portion (never re-bills here).
//   op = 'dec_qty'                      — -1 base portion, down to 1. Below that is a
//                                         skip (the app asks first): 'use_skip'.
//   op = 'inc_addon_qty'  { addon_id }  — attach at qty 1 if absent, else +1 (cap 10).
//   op = 'dec_addon_qty'  { addon_id }  — -1; a non-default add-on at qty 1 is removed
//                                         entirely rather than left at 0. A default
//                                         add-on floors at 1 (same protection as
//                                         remove_addon) instead of being removable here.
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
    const { order_id, op, addon_id } = await req.json() as {
      order_id?: string
      op?: 'add_addon' | 'remove_addon' | 'inc_qty' | 'dec_qty' | 'inc_addon_qty' | 'dec_addon_qty'
      addon_id?: string
    }
    if (!order_id || !op) return json({ error: 'order_id and op are required' }, 400)

    const user = await userFrom(req)
    if (!user) return json({ error: 'Unauthorized' }, 401)

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
    if (isSunday(order.delivery_date)) return json({ error: 'Sunday is our day off — message us on WhatsApp if you need something special.' }, 400)
    const [{ data: locked }, { data: sub }] = await Promise.all([
      supabase.rpc('is_slot_locked', { p_date: order.delivery_date, p_slot: order.meal_slot }),
      supabase
        .from('subscriptions')
        .select('meals_lunch, meals_dinner, plan_id, meal_price_paise, plans ( base_price, meals_total )')
        .eq('id', order.subscription_id)
        .single(),
    ])
    if (locked) {
      return json({ error: 'Cannot edit — this slot has already locked for the day.' }, 400)
    }

    // Backfill the base-meal rate snapshot on older orders so cart_total is right.
    const plan = (sub as any)?.plans as { base_price: number; meals_total: number } | null
    if (order.unit_price == null && plan) {
      const rate = mealRate(sub as any, plan) as number
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

    // ── inc_addon_qty (ensure present at >=1, then +1; capped at 10) ──────
    if (op === 'inc_addon_qty') {
      if (!addon_id) return json({ error: 'addon_id required' }, 400)
      const { data: addon } = await supabase
        .from('addons').select('id, price_per_meal').eq('id', addon_id).maybeSingle()
      if (!addon) return json({ error: 'Add-on not found' }, 404)

      const { data: existing } = await supabase
        .from('order_addons')
        .select('id, quantity').eq('order_id', order.id).eq('addon_id', addon_id).eq('kind', 'addon').maybeSingle()
      if (!existing) {
        await supabase.from('order_addons').insert({
          order_id: order.id, addon_id, kind: 'addon', quantity: 1, unit_price: addon.price_per_meal,
        })
      } else {
        const nextQty = (existing.quantity ?? 1) + 1
        if (nextQty > 10) return json({ error: 'addon_quantity_cap' }, 400)
        await supabase.from('order_addons').update({ quantity: nextQty }).eq('id', existing.id)
      }
    }

    // ── dec_addon_qty (default add-on floors at 1; a non-default one at
    //    quantity 1 is removed entirely rather than left at a stray 0) ─────
    if (op === 'dec_addon_qty') {
      if (!addon_id) return json({ error: 'addon_id required' }, 400)
      const { data: existing } = await supabase
        .from('order_addons')
        .select('id, quantity').eq('order_id', order.id).eq('addon_id', addon_id).eq('kind', 'addon').maybeSingle()
      if (!existing) return json({ error: 'Add-on not on this order' }, 400)

      const qty = existing.quantity ?? 1
      if (qty <= 1) {
        const { data: isDefault } = await supabase
          .from('subscription_addons').select('id')
          .eq('subscription_id', order.subscription_id).eq('addon_id', addon_id).maybeSingle()
        if (isDefault) return json({ error: 'cannot_remove_default_addon' }, 400)
        await supabase.from('order_addons').delete().eq('id', existing.id)
      } else {
        await supabase.from('order_addons').update({ quantity: qty - 1 }).eq('id', existing.id)
      }
    }

    // ── inc_qty / dec_qty (billed on delivery, not here) ──────────────────
    if (op === 'inc_qty') {
      await supabase.from('orders')
        .update({ quantity: (order.quantity ?? 1) + 1, updated_at: new Date().toISOString() })
        .eq('id', order.id)
    }
    if (op === 'dec_qty') {
      // Fewer portions than the plan's default is fine for a day (a roommate
      // away): the meal counter and wallet are charged per delivered portion.
      // The last portion goes through skip instead, which the app confirms.
      if ((order.quantity ?? 1) <= 1) return json({ error: 'use_skip' }, 400)
      await supabase.from('orders')
        .update({ quantity: (order.quantity ?? 1) - 1, updated_at: new Date().toISOString() })
        .eq('id', order.id)
    }

    // Re-snapshot the cart total and report the wallet balance for warnings.
    const [{ data: cartTotal }, { data: wallet }] = await Promise.all([
      supabase.rpc('recompute_order_cart', { p_order: order.id }),
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
    ])
    return json({ ok: true, order_id: order.id, cart_total: cartTotal ?? null, wallet_balance: wallet?.balance ?? 0 })
  } catch (err) {
    console.error('update-day-cart error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
