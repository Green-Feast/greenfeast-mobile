import { createClient } from 'jsr:@supabase/supabase-js@2'

// Creates a Razorpay order for an arbitrary wallet top-up amount.
// The razorpay-webhook handles the authoritative credit on payment.captured.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MIN_TOPUP_PAISE = 10000  // ₹100 minimum

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

    const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')!
    const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!
    const credentials = btoa(`${KEY_ID}:${KEY_SECRET}`)

    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount_paise,
        currency: 'INR',
        receipt: `topup_${user.id.slice(0, 20)}_${Date.now()}`,
        notes: { purpose: 'topup', user_id: user.id, amount_paise },
      }),
    })

    if (!rzpRes.ok) throw new Error('Razorpay order creation failed')
    const rzpOrder = await rzpRes.json()

    // Insert a payment row (subscription_id is NULL for top-ups)
    await supabase.from('payments').insert({
      user_id: user.id,
      subscription_id: null,
      amount: amount_paise,
      status: 'created',
      razorpay_order_id: rzpOrder.id,
    })

    return json({ order_id: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, key_id: KEY_ID })
  } catch (err) {
    console.error('wallet-topup error:', err)
    return json({ error: 'Could not create top-up order. Please try again.' }, 500)
  }
})
