import { createClient } from 'jsr:@supabase/supabase-js@2'

const DELIVERIES_BY_PLAN: Record<string, number> = {
  trial: 5,
  plan15: 15,
  plan30: 30,
}

async function verifyRazorpaySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(body))
  const expected = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return expected === signature
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-razorpay-signature') ?? ''
    const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')!

    const valid = await verifyRazorpaySignature(rawBody, signature, secret)
    if (!valid) {
      console.error('Razorpay webhook: invalid signature')
      return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 400 })
    }

    const event = JSON.parse(rawBody)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity

      const { data: paymentRow } = await supabase
        .from('payments')
        .update({
          status: 'paid',
          razorpay_payment_id: payment.id,
        })
        .eq('razorpay_order_id', payment.order_id)
        .select('subscription_id, user_id, amount')
        .single()

      // Wallet top-up: no subscription, credit the captured amount directly.
      if (paymentRow && !paymentRow.subscription_id) {
        const capturedPaise = payment.amount // Razorpay sends amount in paise
        await supabase.rpc('wallet_credit', {
          p_user: paymentRow.user_id,
          p_amount: capturedPaise,
          p_reason: 'Wallet top-up',
          p_reference_id: payment.id,
        })
      }

      if (paymentRow?.subscription_id) {
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

    if (event.event === 'payment.failed') {
      const payment = event.payload.payment.entity
      await supabase
        .from('payments')
        .update({
          status: 'failed',
          razorpay_payment_id: payment.id,
        })
        .eq('razorpay_order_id', payment.order_id)
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('razorpay-webhook error:', err)
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), { status: 500 })
  }
})
