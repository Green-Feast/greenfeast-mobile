import { createClient } from 'jsr:@supabase/supabase-js@2'

// Sunday is GreenFeast's day off: customers can't add, swap, resize or remove
// anything on a Sunday. Only the office (admin, which doesn't use this
// function) can put a meal there, for special cases.
const isSunday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay() === 0

// Remove an extra dish that was added via add-dish (extra_dish=true). Soft
// delete — sets status='cancelled' rather than a hard delete, matching how
// pause/cancel/skip all soft-delete via status elsewhere in this app.
// advance_batch_delivered excludes cancelled/skipped rows from billing and
// the deliveries-remaining count, so no wallet reversal is needed here since
// extra dishes are only ever billed on delivery, never at add time.

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
    // order_id: the extra dish's own order id (not the base order's).
    const { order_id } = await req.json()
    if (!order_id) {
      return json({ error: 'order_id is required' }, 400)
    }

    const user = await userFrom(req)
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const { data: order } = await supabase
      .from('orders')
      .select('id, user_id, extra_dish, status, delivery_date, meal_slot')
      .eq('id', order_id)
      .single()

    if (!order || order.user_id !== user.id) return json({ error: 'Order not found' }, 404)
    if (!order.extra_dish) return json({ error: 'not_extra_dish' }, 400)
    if (['delivered', 'cancelled', 'skipped'].includes(order.status)) {
      return json({ error: 'Cannot remove a delivered, cancelled, or skipped dish' }, 400)
    }

    if (isSunday(order.delivery_date)) return json({ error: 'Sunday is our day off — message us on WhatsApp if you need something special.' }, 400)
    const { data: locked } = await supabase.rpc('is_slot_locked', {
      p_date: order.delivery_date, p_slot: order.meal_slot,
    })
    if (locked) {
      return json({ error: 'Cannot remove — this slot has already locked for the day.' }, 400)
    }

    const { error: updateErr } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', order_id)

    if (updateErr) {
      console.error('remove-dish update failed:', updateErr.message)
      return json({ error: 'Could not remove dish' }, 500)
    }

    return json({ ok: true, order_id })
  } catch (err) {
    console.error('remove-dish error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
