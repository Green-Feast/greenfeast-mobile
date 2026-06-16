import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID')!
    const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET')!

    // Create Razorpay order
    const credentials = btoa(`${KEY_ID}:${KEY_SECRET}`)
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amount_paise,
        currency: 'INR',
        receipt: `sub_${subscription_id.slice(0, 20)}`,
        notes: { subscription_id, user_id: user.id },
      }),
    })

    if (!rzpRes.ok) {
      const body = await rzpRes.text()
      console.error('Razorpay order creation failed:', body)
      throw new Error('Razorpay order creation failed')
    }

    const rzpOrder = await rzpRes.json()

    // Insert pending payment row
    await supabase.from('payments').insert({
      user_id: user.id,
      subscription_id,
      amount: amount_paise,
      status: 'created',
      razorpay_order_id: rzpOrder.id,
    })

    return new Response(
      JSON.stringify({
        order_id: rzpOrder.id,
        amount: rzpOrder.amount,
        currency: rzpOrder.currency,
        key_id: KEY_ID,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('razorpay-create-order error:', err)
    return new Response(
      JSON.stringify({ error: 'Could not create payment order. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
