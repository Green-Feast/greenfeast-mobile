import { createClient } from 'jsr:@supabase/supabase-js@2'

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
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

    // Refund outcomes for bank refunds started from the admin (admin-refund).
    // Our refund ids start with gf_; anything else is the restaurant's.
    if (event.type === 'REFUND_STATUS_WEBHOOK') {
      const refund = event?.data?.refund ?? {}
      const refundId: string = refund.refund_id ?? ''
      if (!refundId.startsWith('gf_')) {
        return new Response(JSON.stringify({ ok: true, ignored: true }), { status: 200 })
      }
      const { data: row } = await supabase
        .from('refunds')
        .select('id, user_id, amount, status')
        .eq('cf_refund_id', refundId)
        .maybeSingle()
      if (!row) {
        console.error('cashfree-webhook: no refunds row for', refundId)
        return new Response(JSON.stringify({ error: 'refund row not found' }), { status: 500 })
      }
      const cfStatus = String(refund.refund_status ?? '').toUpperCase()
      const amountText = rupees(row.amount)

      if (cfStatus === 'SUCCESS' && row.status !== 'completed') {
        await supabase.from('refunds').update({ status: 'completed' }).eq('id', row.id)
        // Text: admin → Notifications → Automated messages.
        await supabase.rpc('notify_event', {
          p_user: row.user_id,
          p_key: 'refund_bank_done',
          p_vars: { amount: amountText },
        })
      } else if ((cfStatus === 'FAILED' || cfStatus === 'CANCELLED') && row.status === 'pending') {
        // The wallet was debited when the refund started — give it back.
        const { error: creditErr } = await supabase.rpc('wallet_credit', {
          p_user: row.user_id,
          p_amount: row.amount,
          p_reason: 'Refund to bank failed — amount returned to wallet',
          p_reference_id: `refund_fail_${row.id}`,
        })
        if (creditErr) {
          console.error('cashfree-webhook: refund reversal failed:', creditErr.message)
          return new Response(JSON.stringify({ error: 'reversal failed' }), { status: 500 })
        }
        await supabase.from('refunds')
          .update({ status: 'failed', failure_note: refund.status_description ?? cfStatus })
          .eq('id', row.id)
        await supabase.rpc('notify_event', {
          p_user: row.user_id,
          p_key: 'refund_bank_failed',
          p_vars: { amount: amountText },
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

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
        .select('id, subscription_id, user_id, amount')
        .eq('cf_order_id', order.order_id)
        .maybeSingle()

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

      // A plan payment must cover the price set when the order was created
      // (payments.amount, computed server-side by cashfree-create-order). Should
      // never happen now; if it does, activate and credit nothing and leave it
      // for a human. Marked 'failed' (payment id kept) so the app's
      // fund-subscription-wallet call, which needs a 'paid' row, can't credit
      // it either.
      if (paymentRow.subscription_id && capturedPaise < paymentRow.amount) {
        console.error(
          'cashfree-webhook: UNDERPAID plan payment', order.order_id,
          'captured', capturedPaise, 'expected', paymentRow.amount
        )
        await supabase
          .from('payments')
          .update({ status: 'failed', cf_payment_id: String(payment.cf_payment_id) })
          .eq('id', paymentRow.id)
        return new Response(JSON.stringify({ ok: true, held: 'underpaid' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const { error: markErr } = await supabase
        .from('payments')
        .update({ status: 'paid', cf_payment_id: String(payment.cf_payment_id) })
        .eq('id', paymentRow.id)
      if (markErr) {
        console.error('cashfree-webhook: could not mark payment paid:', markErr.message)
        return new Response(JSON.stringify({ error: 'mark paid failed' }), { status: 500 })
      }

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
          .select('plan_id, plan_name, payment_method, cod_due_paise, plans ( meals_total )')
          .eq('id', paymentRow.subscription_id)
          .single()

        const planRow = Array.isArray((sub as any)?.plans) ? (sub as any).plans[0] : (sub as any)?.plans
        const deliveries = planRow?.meals_total ?? 0

        // A renewal (or a new plan after the old one ran out) first closes the
        // customer's finished plan — only one live plan per customer is
        // allowed (migration 049) — and inherits its delivery batch, before
        // instantiate-orders below so the new orders get that batch.
        const { error: retireErr } = await supabase.rpc('retire_previous_subscriptions', {
          p_new_sub: paymentRow.subscription_id,
        })
        if (retireErr) console.error('cashfree-webhook: retire_previous_subscriptions failed:', retireErr.message)

        // A coupon this payment was priced with sets the plan's meal price —
        // before activation, so every order is made at that price (066).
        const { error: couponErr } = await supabase.rpc('apply_payment_coupon', { p_payment: paymentRow.id })
        if (couponErr) {
          console.error('cashfree-webhook: apply_payment_coupon failed:', couponErr.message)
          return new Response(JSON.stringify({ error: 'coupon failed' }), { status: 500 })
        }

        const { error: activateErr } = await supabase
          .from('subscriptions')
          .update({ status: 'active', deliveries_remaining: deliveries })
          .eq('id', paymentRow.subscription_id)
          .eq('status', 'pending') // idempotent guard — don't overwrite if already active
        if (activateErr) {
          // e.g. the customer still has another live plan with meals left.
          console.error('cashfree-webhook: could not activate', paymentRow.subscription_id, activateErr.message)
        }


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
        // key, not a JWT, so that call was always rejected. Credits the amount
        // this order was created for (= what was just captured, checked above)
        // with the same reference (subscription_id) as fund-subscription-wallet,
        // so whichever of the two lands second is a no-op.
        // Cash on delivery: this was the first day's meals; the rest is
        // collected in cash (cod_due_paise) and credited when it's recorded.
        const planName = (sub as any)?.plan_name ?? 'Subscription'
        const codDue = (sub as any)?.payment_method === 'cod' ? ((sub as any)?.cod_due_paise ?? 0) : 0
        const { error: fundErr } = await supabase.rpc('wallet_credit', {
          p_user: paymentRow.user_id,
          p_amount: paymentRow.amount,
          p_reason: codDue > 0
            ? `First day paid online — ${planName} (${rupees(codDue)} cash on delivery)`
            : `Plan payment — ${planName}`,
          p_reference_id: paymentRow.subscription_id,
        })
        if (fundErr) {
          console.error('cashfree-webhook: plan wallet credit failed:', fundErr.message)
          return new Response(JSON.stringify({ error: 'credit failed' }), { status: 500 })
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
        // An order can have several attempts, and webhooks can arrive out of
        // order: a failed attempt's event must not overwrite a later success.
        .eq('status', 'created')
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
