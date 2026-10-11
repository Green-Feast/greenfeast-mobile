import { createClient } from 'jsr:@supabase/supabase-js@2'

// Credits a subscription's wallet with the money actually received for it
// through Cashfree — the amount of its paid payments row, never a catalogue
// price. It used to credit the plan's price for ANY subscription the caller
// owned, paid or not, and customers can create subscriptions themselves: free
// wallet money on demand (2026-10-11 audit). Cash-on-delivery plans are credited
// by the admin's "Mark cash received" instead. The webhook credits the same
// payment itself (same reference), so this is only the app's optimistic call;
// idempotent via wallet_credit(reference_id = subscription_id).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const isServiceRole = token === SERVICE_KEY

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)

    let body: any = {}
    try { body = await req.json() } catch { /* noop */ }
    const subscriptionId: string | undefined = body.subscription_id
    if (!subscriptionId) {
      return new Response(JSON.stringify({ error: 'subscription_id required' }), { status: 400, headers: corsHeaders })
    }

    // Resolve the subscription + plan. Non-service callers may only fund their own.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, user_id, plan_name')
      .eq('id', subscriptionId)
      .single()

    if (!sub) {
      return new Response(JSON.stringify({ error: 'Subscription not found' }), { status: 404, headers: corsHeaders })
    }

    if (!isServiceRole) {
      const { data: { user }, error } = await supabase.auth.getUser(token)
      if (error || !user || user.id !== sub.user_id) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
      }
    }

    // Only a Cashfree payment the webhook has confirmed counts (cash payments
    // have no cf_order_id and are credited by the admin action).
    const { data: paid } = await supabase
      .from('payments')
      .select('amount')
      .eq('subscription_id', subscriptionId)
      .eq('status', 'paid')
      .not('cf_order_id', 'is', null)
      .order('created_at')
      .limit(1)
      .maybeSingle()

    if (!paid || !(paid.amount > 0)) {
      return new Response(
        JSON.stringify({ error: 'No confirmed payment for this subscription yet' }),
        { status: 409, headers: corsHeaders }
      )
    }
    const amount = paid.amount

    const { error: rpcErr } = await supabase.rpc('wallet_credit', {
      p_user: sub.user_id,
      p_amount: amount,
      p_reason: `Plan payment — ${(sub as any).plan_name ?? 'Subscription'}`,
      p_reference_id: subscriptionId,
    })
    if (rpcErr) throw rpcErr

    return new Response(JSON.stringify({ ok: true, amount }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('fund-subscription-wallet error:', err)
    return new Response(JSON.stringify({ error: 'Failed to fund wallet' }), { status: 500, headers: corsHeaders })
  }
})
