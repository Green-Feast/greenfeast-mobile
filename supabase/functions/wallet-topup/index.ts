import { createClient } from 'jsr:@supabase/supabase-js@2'

// Creates a Cashfree order for an arbitrary wallet top-up amount.
// cashfree-webhook handles the authoritative credit on PAYMENT_SUCCESS_WEBHOOK.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MIN_TOPUP_PAISE = 10000  // ₹100 minimum

const CASHFREE_ENV = Deno.env.get('CASHFREE_ENV') === 'production' ? 'production' : 'sandbox'
const CASHFREE_BASE = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg'

function sanitizeCustomerId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

function sanitizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Authenticate caller
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { amount_paise } = await req.json()
    if (!amount_paise || typeof amount_paise !== 'number' || amount_paise < MIN_TOPUP_PAISE) {
      return json({ error: `Minimum top-up is ₹${MIN_TOPUP_PAISE / 100}` }, 400)
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('name, phone')
      .eq('id', user.id)
      .single()

    const APP_ID = Deno.env.get('CASHFREE_APP_ID')!
    const SECRET_KEY = Deno.env.get('CASHFREE_SECRET_KEY')!
    const orderId = `topup_${user.id.slice(0, 20)}_${Date.now()}`

    const cfRes = await fetch(`${CASHFREE_BASE}/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': APP_ID,
        'x-client-secret': SECRET_KEY,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        order_id: orderId,
        order_amount: amount_paise / 100, // Cashfree wants rupees, not paise
        order_currency: 'INR',
        customer_details: {
          customer_id: sanitizeCustomerId(user.id),
          customer_phone: sanitizePhone(userRow?.phone ?? ''),
          customer_name: userRow?.name || undefined,
        },
      }),
    })

    if (!cfRes.ok) {
      const body = await cfRes.text()
      console.error('Cashfree order creation failed:', body)
      throw new Error('Cashfree order creation failed')
    }
    const cfOrder = await cfRes.json()

    // Insert a payment row (subscription_id is NULL for top-ups).
    // MUST NOT be fire-and-forget: the webhook finds this row by cf_order_id to
    // credit the wallet, so if the insert fails the customer pays and is never
    // credited. Fail the request instead of handing back a payable order id.
    const { error: payErr } = await supabase.from('payments').insert({
      user_id: user.id,
      subscription_id: null,
      amount: amount_paise,
      status: 'created',
      cf_order_id: orderId,
    })
    if (payErr) {
      console.error('wallet-topup: payments insert failed:', payErr.message)
      return json({ error: 'Could not start the top-up. Please try again.' }, 500)
    }

    return json({ order_id: orderId, payment_session_id: cfOrder.payment_session_id, environment: CASHFREE_ENV })
  } catch (err) {
    console.error('wallet-topup error:', err)
    return json({ error: 'Could not create top-up order. Please try again.' }, 500)
  }
})
