import { createClient } from 'jsr:@supabase/supabase-js@2'

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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: order } = await supabase
      .from('orders')
      .select('id, user_id, extra_dish, status, delivery_date')
      .eq('id', order_id)
      .single()

    if (!order || order.user_id !== user.id) return json({ error: 'Order not found' }, 404)
    if (!order.extra_dish) return json({ error: 'not_extra_dish' }, 400)
    if (['delivered', 'cancelled', 'skipped'].includes(order.status)) {
      return json({ error: 'Cannot remove a delivered, cancelled, or skipped dish' }, 400)
    }
    if (order.delivery_date < new Date().toISOString().split('T')[0]) {
      return json({ error: 'Cannot remove a past order' }, 400)
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
