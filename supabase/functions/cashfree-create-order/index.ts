import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 'sandbox' until CASHFREE_ENV=production is set once live keys replace the
// test ones — flip this one env var (plus the keys) to go live, nothing else.
const CASHFREE_ENV = Deno.env.get('CASHFREE_ENV') === 'production' ? 'production' : 'sandbox'
const CASHFREE_BASE = CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg'

// Cashfree customer_id only allows alphanumeric/underscore/hyphen — Supabase
// UUIDs already fit, but strip defensively rather than trust it blindly.
function sanitizeCustomerId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '')
}

// Accepts "+91XXXXXXXXXX" or "XXXXXXXXXX" — Cashfree wants a bare 10-digit number.
function sanitizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { subscription_id, amount_paise } = await req.json()

    if (!subscription_id || !amount_paise) {
      return new Response(
        JSON.stringify({ error: 'subscription_id and amount_paise are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify caller is authenticated
    const authHeader = req.headers.get('Authorization')
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader?.replace('Bearer ', '') ?? ''
    )
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the subscription belongs to this user
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('id, plan_id')
      .eq('id', subscription_id)
      .eq('user_id', user.id)
      .single()
    if (subErr || !sub) {
      return new Response(
        JSON.stringify({ error: 'Subscription not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('name, phone')
      .eq('id', user.id)
      .single()

    const APP_ID = Deno.env.get('CASHFREE_APP_ID')!
    const SECRET_KEY = Deno.env.get('CASHFREE_SECRET_KEY')!

    // Our own order_id (not Cashfree's internal cf_order_id) — this is what
    // the webhook echoes back, and what we store in payments.cf_order_id to
    // match against.
    const orderId = `sub_${subscription_id.slice(0, 20)}_${Date.now()}`

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

    // Insert pending payment row. Checked, not fire-and-forget: the webhook
    // matches on cf_order_id to activate the subscription, so a failed insert
    // means a paid customer whose plan never activates.
    const { error: payErr } = await supabase.from('payments').insert({
      user_id: user.id,
      subscription_id,
      amount: amount_paise,
      status: 'created',
      cf_order_id: orderId,
    })
    if (payErr) {
      console.error('cashfree-create-order: payments insert failed:', payErr.message)
      return new Response(
        JSON.stringify({ error: 'Could not start the payment. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        order_id: orderId,
        payment_session_id: cfOrder.payment_session_id,
        environment: CASHFREE_ENV,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('cashfree-create-order error:', err)
    return new Response(
      JSON.stringify({ error: 'Could not create payment order. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
