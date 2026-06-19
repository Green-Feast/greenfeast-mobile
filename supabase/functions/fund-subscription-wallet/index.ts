import { createClient } from 'jsr:@supabase/supabase-js@2'

// Credits a subscription's wallet with the plan's grand total (base + add-ons),
// computed SERVER-SIDE from the catalogue so the amount can never be inflated by
// the client. Idempotent via wallet_credit(reference_id = subscription_id), so the
// app's optimistic call and the Razorpay webhook can both fire safely.

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
      .select('id, user_id, plan_name, plans ( base_price, meals_total )')
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

    const plan = (sub as any).plans as { base_price: number; meals_total: number } | null
    if (!plan) {
      return new Response(JSON.stringify({ error: 'Plan not found' }), { status: 404, headers: corsHeaders })
    }

    // Add-on total = Σ(price_per_meal) × meals_total
    const { data: subAddons } = await supabase
      .from('subscription_addons')
      .select('addons ( price_per_meal )')
      .eq('subscription_id', subscriptionId)

    const addonPerMeal = (subAddons ?? []).reduce(
      (s: number, row: any) => s + (row.addons?.price_per_meal ?? 0), 0
    )
    const amount = plan.base_price + addonPerMeal * plan.meals_total

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
