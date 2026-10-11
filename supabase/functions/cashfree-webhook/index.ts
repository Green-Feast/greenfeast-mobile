import { createClient } from 'jsr:@supabase/supabase-js@2'

const DELIVERIES_BY_PLAN: Record<string, number> = {
  trial: 5,
  plan15: 15,
  plan30: 30,
}

// Cashfree signs webhooks as base64(HMAC-SHA256(secret, timestamp + rawBody))
// using the same client secret used to authenticate API calls — no separate
// webhook secret to configure.
async function verifyCashfreeSignature(
  rawBody: string, timestamp: string, signature: string, secret: string
): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(timestamp + rawBody))
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
  return expected === signature
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-webhook-signature') ?? ''
    const timestamp = req.headers.get('x-webhook-timestamp') ?? ''
    const secret = Deno.env.get('CASHFREE_SECRET_KEY')!

    const valid = await verifyCashfreeSignature(rawBody, timestamp, signature, secret)
    if (!valid) {
      console.error('Cashfree webhook: invalid signature')
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 })
    }

    const event = JSON.parse(rawBody)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // The Cashfree account is shared with the restaurant's Petpooja POS. If an
    // account-wide endpoint ever points here, its payments would arrive too —
    // acknowledge and ignore anything that isn't one of our own order ids
    // (sub_… from cashfree-create-order, topup_… from wallet-topup) instead of
    // 500-ing and making Cashfree retry it forever.
    const orderId: string = event?.data?.order?.order_id ?? ''
    if (!orderId.startsWith('sub_') && !orderId.startsWith('topup_')) {
      return new Response(JSON.stringify({ ok: true, ignored: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (event.type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const order = event.data.order
      const payment = event.data.payment

      const { data: paymentRow, error: payErr } = await supabase
        .from('payments')
        .update({
          status: 'paid',
          cf_payment_id: String(payment.cf_payment_id),
        })
        .eq('cf_order_id', order.order_id)
        .select('subscription_id, user_id, amount')
        .single()

      // If this lookup fails we credit nobody and activate nothing — the
      // customer has paid and gets silence. Log loudly and 500 so Cashfree
      // retries the webhook instead of treating it as delivered.
      if (payErr || !paymentRow) {
        console.error(
          'cashfree-webhook: no payments row for order', order.order_id,
          payErr?.message ?? '(no matching row)'
        )
        return new Response(
          JSON.stringify({ error: 'payment row not found' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // Cashfree reports amounts in rupees, not paise — the DB stores paise
      // everywhere else, so convert on the way in.
      const capturedPaise = Math.round((payment.payment_amount ?? 0) * 100)

      // Wallet top-up: no subscription, credit the captured amount directly.
      if (!paymentRow.subscription_id) {
        const { error: creditErr } = await supabase.rpc('wallet_credit', {
          p_user: paymentRow.user_id,
          p_amount: capturedPaise,
          p_reason: 'Wallet top-up',
          p_reference_id: String(payment.cf_payment_id),
        })
        // 500 → Cashfree retries; the credit is idempotent on cf_payment_id.
        if (creditErr) {
          console.error('cashfree-webhook: top-up credit failed:', creditErr.message)
          return new Response(JSON.stringify({ error: 'credit failed' }), { status: 500 })
        }
      }

      if (paymentRow.subscription_id) {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('plan_id, plan_name, plans ( base_price, meals_total )')
          .eq('id', paymentRow.subscription_id)
          .single()

        const deliveries = DELIVERIES_BY_PLAN[sub?.plan_id ?? ''] ?? 0

        await supabase
          .from('subscriptions')
          .update({ status: 'active', deliveries_remaining: deliveries })
          .eq('id', paymentRow.subscription_id)
          .eq('status', 'pending') // idempotent guard — don't overwrite if already active

        // Instantiate orders for next 14 days now that subscription is active
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
        const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        await fetch(`${SUPABASE_URL}/functions/v1/instantiate-orders`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ subscription_id: paymentRow.subscription_id }),
        }).catch(err => console.error('Failed to trigger instantiate-orders:', err))

        // Fund the wallet here directly rather than over HTTP via
        // fund-subscription-wallet: that function sits behind the gateway's JWT
        // check, and this runtime's SUPABASE_SERVICE_ROLE_KEY is an sb_secret_…
        // key, not a JWT, so that call was always rejected and onboarding
        // wallets only got funded by the app's own call. Same server-side
        // amount (plan base + add-ons × meals) and the same reference
        // (subscription_id) as fund-subscription-wallet, so whichever of the two
        // lands second is a no-op.
        const plan = (sub as any)?.plans as { base_price: number; meals_total: number } | null
        if (plan) {
          const { data: subAddons } = await supabase
            .from('subscription_addons')
            .select('addons ( price_per_meal )')
            .eq('subscription_id', paymentRow.subscription_id)
          const addonPerMeal = (subAddons ?? []).reduce(
            (sum: number, row: any) => sum + (row.addons?.price_per_meal ?? 0), 0
          )
          const { error: fundErr } = await supabase.rpc('wallet_credit', {
            p_user: paymentRow.user_id,
            p_amount: plan.base_price + addonPerMeal * plan.meals_total,
            p_reason: `Plan payment — ${(sub as any)?.plan_name ?? 'Subscription'}`,
            p_reference_id: paymentRow.subscription_id,
          })
          if (fundErr) {
            console.error('cashfree-webhook: plan wallet credit failed:', fundErr.message)
            return new Response(JSON.stringify({ error: 'credit failed' }), { status: 500 })
          }
        } else {
          console.error('cashfree-webhook: no plan for subscription', paymentRow.subscription_id)
        }
      }
    }

    if (event.type === 'PAYMENT_FAILED_WEBHOOK' || event.type === 'PAYMENT_USER_DROPPED_WEBHOOK') {
      const order = event.data.order
      const payment = event.data.payment
      const { error: failErr } = await supabase
        .from('payments')
        .update({
          status: 'failed',
          cf_payment_id: payment?.cf_payment_id ? String(payment.cf_payment_id) : null,
        })
        .eq('cf_order_id', order.order_id)
      if (failErr) {
        console.error('cashfree-webhook: could not mark payment failed:', failErr.message)
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('cashfree-webhook error:', err)
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), { status: 500 })
  }
})
