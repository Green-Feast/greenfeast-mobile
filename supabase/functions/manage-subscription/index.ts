import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// IST calendar date. A UTC date is still "yesterday" between midnight and
// 5:30 AM IST, which let a pause/cancel reach back into the previous day.
function today(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]
}

type OrderRef = { id: string; delivery_date: string; meal_slot: string }

// Today's slots that are past their cutoff are already on the kitchen sheet:
// pause / resume / cancel must leave those orders alone. Cancelling one meant a
// cooked meal that was never billed; reviving one meant a meal the kitchen
// never planned for.
async function withoutLockedToday(supabase: any, rows: OrderRef[]): Promise<string[]> {
  const t = today()
  const locked = new Set<string>()
  for (const slot of ['lunch', 'dinner']) {
    const { data } = await supabase.rpc('is_slot_locked', { p_date: t, p_slot: slot })
    if (data) locked.add(slot)
  }
  return rows
    .filter((o) => !(o.delivery_date === t && locked.has(o.meal_slot)))
    .map((o) => o.id)
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

      const { data: inRange } = await supabase
        .from('orders')
        .select('id, delivery_date, meal_slot')
        .eq('subscription_id', subscription_id)
        .gte('delivery_date', pause_from)
        .lte('delivery_date', pause_until)
        .in('status', ['scheduled', 'confirmed'])
      const toCancel = await withoutLockedToday(supabase, (inRange ?? []) as OrderRef[])
      if (toCancel.length > 0) {
        // skip_reason 'pause' marks these as the pause's own cancellations, so
        // resume revives exactly these (and not, say, a dish the user removed).
        await supabase
          .from('orders')
          .update({ status: 'cancelled', skip_reason: 'pause' })
          .in('id', toCancel)
      }

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
      // Only the pause's own cancellations: skip_reason 'pause', or — for
      // pauses made before that marker existed — base meals with no reason.
      // Extra dishes the user removed are 'cancelled' too and must stay gone
      // (reviving them billed the user for dishes they had removed).
      const { data: paused } = await supabase
        .from('orders')
        .select('id, delivery_date, meal_slot')
        .eq('subscription_id', subscription_id)
        .gte('delivery_date', today())
        .eq('status', 'cancelled')
        .or('skip_reason.eq.pause,and(skip_reason.is.null,extra_dish.eq.false)')
      const toRevive = await withoutLockedToday(supabase, (paused ?? []) as OrderRef[])
      if (toRevive.length > 0) {
        await supabase
          .from('orders')
          .update({ status: 'scheduled', skip_reason: null })
          .in('id', toRevive)
      }

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
      if (sub.status === 'cancelled') return json({ error: 'Subscription is cancelled' }, 400)

      // meal_slot is optional: omitted = whole-day skip (Plan Settings' "Skip a
      // specific day" flow), present = skip just that slot (My Plan hero card).
      // Each requested slot is checked independently against its own cutoff —
      // a whole-day skip after lunch has locked should still skip dinner.
      const candidateSlots = meal_slot ? [meal_slot] : ['lunch', 'dinner']
      const openSlots: string[] = []
      for (const s of candidateSlots) {
        const { data: locked } = await supabase.rpc('is_slot_locked', { p_date: delivery_date, p_slot: s })
        if (!locked) openSlots.push(s)
      }
      if (openSlots.length === 0) {
        return json({
          error: meal_slot
            ? 'Cannot skip — this slot has already locked for the day.'
            : 'Cannot skip — both slots have already locked for the day.',
        }, 400)
      }

      // skip_reason='user' matters: an auto-pause-after-repeated-skips feature
      // reads this to count only wallet-driven skips — a user choosing to skip
      // a day must never count toward that.
      const { error: skipErr } = await supabase
        .from('orders')
        .update({ status: 'skipped', skip_reason: 'user' })
        .eq('subscription_id', subscription_id)
        .eq('delivery_date', delivery_date)
        .in('status', ['scheduled', 'confirmed'])
        .in('meal_slot', openSlots)

      if (skipErr) throw skipErr

      return json({ ok: true, action: 'skipped', delivery_date, meal_slot: meal_slot ?? null, slots_skipped: openSlots })
    }

    // ── cancel ───────────────────────────────────────────────────────────────

    if (action === 'cancel') {
      if (sub.status === 'cancelled') return json({ error: 'Already cancelled' }, 400)

      await supabase
        .from('subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', subscription_id)

      const { data: upcoming } = await supabase
        .from('orders')
        .select('id, delivery_date, meal_slot')
        .eq('subscription_id', subscription_id)
        .gte('delivery_date', today())
        .in('status', ['scheduled', 'confirmed'])
      const toCancel = await withoutLockedToday(supabase, (upcoming ?? []) as OrderRef[])
      if (toCancel.length > 0) {
        await supabase.from('orders').update({ status: 'cancelled' }).in('id', toCancel)
      }

      return json({ ok: true, action: 'cancelled' })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    console.error('manage-subscription error:', err)
    return json({ error: 'Action failed. Please try again.' }, 500)
  }
})
