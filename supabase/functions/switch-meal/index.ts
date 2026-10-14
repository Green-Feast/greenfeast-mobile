import { createClient } from 'jsr:@supabase/supabase-js@2'

// Swap a day's meal for any subscription dish. Swaps are free (052 removed the
// ₹20 "Meal switch" fee); the meal is billed on delivery like any other, at
// the order's own rate. The kitchen's ingredient snapshot follows the new dish.

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
    const { order_id, meal_template_id } = await req.json()
    if (!order_id || !meal_template_id) {
      return json({ error: 'order_id and meal_template_id are required' }, 400)
    }

    // Authenticate caller
    const user = await userFrom(req)
    if (!user) return json({ error: 'Unauthorized' }, 401)

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
    if (order.meal_template_id === meal_template_id) {
      return json({ ok: true, charged: false, fee_paise: 0 }) // nothing to do
    }

    // Lock, availability (the app greys these out, but a client check is UX
    // only) and subscription_valid (menu-visible-but-takeaway-only dishes),
    // checked together.
    const [{ data: locked }, { data: unavailable }, { data: dish }] = await Promise.all([
      supabase.rpc('is_slot_locked', { p_date: order.delivery_date, p_slot: order.meal_slot }),
      supabase
        .from('meal_availability')
        .select('is_available')
        .eq('for_date', order.delivery_date)
        .eq('meal_template_id', meal_template_id)
        .eq('is_available', false)
        .maybeSingle(),
      supabase
        .from('meal_templates')
        .select('is_active, subscription_valid')
        .eq('id', meal_template_id)
        .maybeSingle(),
    ])
    if (locked) {
      return json({ error: 'Cannot switch — this slot has already locked for the day.' }, 400)
    }
    if (unavailable) {
      return json({ error: 'This dish is not available on that date.' }, 400)
    }
    if (!dish || !dish.is_active || !dish.subscription_valid) {
      return json({ error: 'This dish is not available for subscription orders.' }, 400)
    }

    // Apply the swap (and drop any "Meal switch" fee line left from before
    // swaps were free), then re-snapshot the ingredients and cart total.
    await Promise.all([
      supabase
        .from('orders')
        .update({
          meal_template_id,
          is_customized: true,
          switch_fee_paise: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order_id),
      supabase.from('order_addons')
        .delete().eq('order_id', order_id).eq('kind', 'fee').eq('label', 'Meal switch'),
    ])
    await Promise.all([
      supabase.rpc('snapshot_order_ingredients', { p_order: order_id }),
      supabase.rpc('recompute_order_cart', { p_order: order_id }),
    ])

    return json({ ok: true, charged: false, fee_paise: 0, billed: 'on_delivery' })
  } catch (err) {
    console.error('switch-meal error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
