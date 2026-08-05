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
        await supabase.rpc('wallet_credit', {
          p_user: paymentRow.user_id,
          p_amount: capturedPaise,
          p_reason: 'Wallet top-up',
          p_reference_id: String(payment.cf_payment_id),
        })
      }

      if (paymentRow.subscription_id) {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('plan_id')
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

        // Fund the wallet (authoritative server-side credit; idempotent on
        // subscription_id, so the app's optimistic call won't double-count).
        await fetch(`${SUPABASE_URL}/functions/v1/fund-subscription-wallet`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ subscription_id: paymentRow.subscription_id }),
        }).catch(err => console.error('Failed to trigger fund-subscription-wallet:', err))
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
