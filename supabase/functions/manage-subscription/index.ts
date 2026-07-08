import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { action, subscription_id, pause_from, pause_until, delivery_date, meal_slot } = await req.json()

    if (!action || !subscription_id) {
      return json({ error: 'action and subscription_id are required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller owns this subscription
    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') ?? ''
    )
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, status, user_id')
      .eq('id', subscription_id)
      .eq('user_id', user.id)
      .single()

    if (!sub) return json({ error: 'Subscription not found' }, 404)

    // ── pause ────────────────────────────────────────────────────────────────

    if (action === 'pause') {
      if (sub.status === 'cancelled') return json({ error: 'Subscription is cancelled' }, 400)
      if (!pause_from || !pause_until) return json({ error: 'pause_from and pause_until required' }, 400)
      if (pause_from < today()) return json({ error: 'Pause cannot start in the past' }, 400)

      await supabase
        .from('subscriptions')
        .update({ status: 'paused', pause_from, pause_until })
        .eq('id', subscription_id)

      await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('subscription_id', subscription_id)
        .gte('delivery_date', pause_from)
        .lte('delivery_date', pause_until)
        .in('status', ['scheduled', 'confirmed'])

      return json({ ok: true, action: 'paused', pause_from, pause_until })
    }

    // ── resume ───────────────────────────────────────────────────────────────

    if (action === 'resume') {
      if (sub.status !== 'paused') return json({ error: 'Subscription is not paused' }, 400)

      await supabase
        .from('subscriptions')
        .update({ status: 'active', pause_from: null, pause_until: null })
        .eq('id', subscription_id)

      // Revive future orders that the pause had cancelled. In an active
      // subscription, orders only reach 'cancelled' via pause (skips use
      // 'skipped'), so this safely restores the schedule. Without this, the
      // re-instantiate below hits the unique constraint and leaves them cancelled.
      await supabase
        .from('orders')
        .update({ status: 'scheduled' })
        .eq('subscription_id', subscription_id)
        .gte('delivery_date', today())
        .eq('status', 'cancelled')

      // Re-instantiate the next 14 days now that the pause is cleared
      const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
      const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      await fetch(`${SUPABASE_URL}/functions/v1/instantiate-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ subscription_id }),
      }).catch(err => console.error('instantiate-orders call failed:', err))

      return json({ ok: true, action: 'resumed' })
    }

    // ── skip ─────────────────────────────────────────────────────────────────

    if (action === 'skip') {
      if (!delivery_date) return json({ error: 'delivery_date required for skip' }, 400)
      if (delivery_date < today()) return json({ error: 'Cannot skip a past delivery' }, 400)
      if (sub.status === 'cancelled') return json({ error: 'Subscription is cancelled' }, 400)

      // meal_slot is optional: omitted = whole-day skip (Plan Settings' "Skip a
      // specific day" flow), present = skip just that slot (My Plan hero card).
      let skipQuery = supabase
        .from('orders')
        .update({ status: 'skipped' })
        .eq('subscription_id', subscription_id)
        .eq('delivery_date', delivery_date)
        .in('status', ['scheduled', 'confirmed'])
      if (meal_slot) skipQuery = skipQuery.eq('meal_slot', meal_slot)
      const { error: skipErr } = await skipQuery

      if (skipErr) throw skipErr

      return json({ ok: true, action: 'skipped', delivery_date, meal_slot: meal_slot ?? null })
    }

    // ── cancel ───────────────────────────────────────────────────────────────

    if (action === 'cancel') {
      if (sub.status === 'cancelled') return json({ error: 'Already cancelled' }, 400)

      await supabase
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', subscription_id)

      await supabase
        .from('orders')
        .update({ status: 'cancelled' })
        .eq('subscription_id', subscription_id)
        .gte('delivery_date', today())
        .in('status', ['scheduled', 'confirmed'])

      return json({ ok: true, action: 'cancelled' })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    console.error('manage-subscription error:', err)
    return json({ error: 'Action failed. Please try again.' }, 500)
  }
})
