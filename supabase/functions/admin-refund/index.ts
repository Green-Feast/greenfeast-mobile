import { createClient } from 'jsr:@supabase/supabase-js@2'

// Refunds a Cashfree payment back to the customer's bank / UPI / card.
// Called only by the admin app (Money → Refund), authenticated with
// INTERNAL_FN_SECRET — the Cashfree keys live here, not on Vercel.
//
// The same amount is deducted from the customer's wallet first, so money
// can't be both refunded and spent on meals; if Cashfree rejects the refund,
// it goes straight back into the wallet. Cashfree then reports the final
// outcome through REFUND_STATUS_WEBHOOK (cashfree-webhook), which completes
// the refund or, if it failed, returns the money to the wallet.
//
// Deploy with --no-verify-jwt (INTERNAL_FN_SECRET is not a JWT).

const CASHFREE_ENV = Deno.env.get('CASHFREE_ENV') === 'production' ? 'production' : 'sandbox'
const CASHFREE_BASE = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg'

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

Deno.serve(async (req) => {
  const secret = Deno.env.get('INTERNAL_FN_SECRET')
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  if (!secret || token !== secret) return json({ error: 'Unauthorized' }, 401)

  try {
    const { payment_id, amount_paise, reason, admin_user_id } = await req.json()
    const amount = Number(amount_paise)
    if (!payment_id || !Number.isInteger(amount) || amount <= 0) {
      return json({ error: 'payment_id and a positive amount are required' }, 400)
    }
    if (!reason || !String(reason).trim()) return json({ error: 'A reason is required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: payment } = await supabase
      .from('payments')
      .select('id, user_id, amount, status, cf_order_id, cf_payment_id')
      .eq('id', payment_id)
      .maybeSingle()
    if (!payment || payment.status !== 'paid' || !payment.cf_order_id || !payment.cf_payment_id) {
      return json({ error: 'Only a paid Cashfree payment can be refunded to the bank.' }, 400)
    }

    const { data: earlier } = await supabase
      .from('refunds')
      .select('amount')
      .eq('payment_id', payment.id)
      .eq('kind', 'bank')
      .in('status', ['pending', 'completed'])
    const alreadyRefunded = (earlier ?? []).reduce((s: number, r: any) => s + r.amount, 0)
    const refundable = payment.amount - alreadyRefunded
    if (amount > refundable) {
      return json({ error: `At most ${rupees(refundable)} can still be refunded on this payment.` }, 400)
    }

    const { data: wallet } = await supabase
      .from('wallets').select('balance').eq('user_id', payment.user_id).maybeSingle()
    const balance = wallet?.balance ?? 0
    if (balance < amount) {
      return json({
        error: `The wallet only has ${rupees(Math.max(balance, 0))} left — the rest has already been spent on meals. Refund at most that.`,
      }, 400)
    }

    const { data: refund, error: insErr } = await supabase
      .from('refunds')
      .insert({
        user_id: payment.user_id,
        payment_id: payment.id,
        kind: 'bank',
        amount,
        reason: String(reason).trim(),
        status: 'pending',
        created_by: admin_user_id ?? null,
      })
      .select('id')
      .single()
    if (insErr || !refund) throw insErr ?? new Error('refund insert failed')

    // Cashfree refund_id: 3-40 chars, alphanumeric/underscore/hyphen.
    const cfRefundId = `gf_${refund.id.replace(/-/g, '').slice(0, 24)}`
    await supabase.from('refunds').update({ cf_refund_id: cfRefundId }).eq('id', refund.id)

    const { error: debitErr } = await supabase.rpc('wallet_debit', {
      p_user: payment.user_id,
      p_amount: amount,
      p_reason: `Refund to bank — ${String(reason).trim()}`,
      p_reference_id: `refund_${refund.id}`,
    })
    if (debitErr) {
      await supabase.from('refunds')
        .update({ status: 'failed', failure_note: `wallet debit failed: ${debitErr.message}` })
        .eq('id', refund.id)
      throw debitErr
    }

    const cfRes = await fetch(`${CASHFREE_BASE}/orders/${encodeURIComponent(payment.cf_order_id)}/refunds`, {
      method: 'POST',
      headers: {
        'x-client-id': Deno.env.get('CASHFREE_APP_ID')!,
        'x-client-secret': Deno.env.get('CASHFREE_SECRET_KEY')!,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        refund_amount: amount / 100, // Cashfree wants rupees
        refund_id: cfRefundId,
        refund_note: String(reason).trim().slice(0, 100),
      }),
    })
    const cfBody = await cfRes.json().catch(() => ({}))

    if (!cfRes.ok) {
      // Rejected outright: put the money back in the wallet.
      await supabase.rpc('wallet_credit', {
        p_user: payment.user_id,
        p_amount: amount,
        p_reason: 'Refund to bank failed — amount returned to wallet',
        p_reference_id: `refund_fail_${refund.id}`,
      })
      const note = (cfBody as any)?.message ?? `Cashfree error ${cfRes.status}`
      await supabase.from('refunds').update({ status: 'failed', failure_note: note }).eq('id', refund.id)
      console.error('admin-refund: Cashfree rejected refund', cfRefundId, cfRes.status, JSON.stringify(cfBody))
      return json({ error: `Cashfree rejected the refund: ${note}. The amount is back in the wallet.` }, 502)
    }

    const cfStatus = String((cfBody as any)?.refund_status ?? 'PENDING').toUpperCase()
    if (cfStatus === 'SUCCESS') {
      await supabase.from('refunds').update({ status: 'completed' }).eq('id', refund.id)
    }

    return json({
      ok: true,
      refund_id: refund.id,
      user_id: payment.user_id,
      status: cfStatus === 'SUCCESS' ? 'completed' : 'pending',
    })
  } catch (err) {
    console.error('admin-refund error:', err)
    return json({ error: 'Refund failed — check the Refunds tab before trying again.' }, 500)
  }
})
