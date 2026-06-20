import { createClient } from 'jsr:@supabase/supabase-js@2'

const SWITCH_FEE_PAISE = 2000 // ₹20

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { order_id, meal_template_id } = await req.json()
    if (!order_id || !meal_template_id) {
      return json({ error: 'order_id and meal_template_id are required' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Authenticate caller
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // Load the order and verify ownership
    const { data: order } = await supabase
      .from('orders')
      .select('id, user_id, subscription_id, delivery_date, meal_slot, meal_template_id, status')
      .eq('id', order_id)
      .single()

    if (!order || order.user_id !== user.id) return json({ error: 'Order not found' }, 404)
    if (['delivered', 'cancelled', 'skipped'].includes(order.status)) {
      return json({ error: 'Cannot switch a delivered, cancelled, or skipped order' }, 400)
    }
    if (order.delivery_date < new Date().toISOString().split('T')[0]) {
      return json({ error: 'Cannot switch a past order' }, 400)
    }
    if (order.meal_template_id === meal_template_id) {
      return json({ ok: true, charged: false }) // nothing to do
    }

    // Load subscription to find its menu_type
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('menu_type')
      .eq('id', order.subscription_id)
      .single()

    const myMenuType = sub?.menu_type ?? 'M1'
    const counterpart = myMenuType === 'M1' ? 'M2' : 'M1'

    // Derive day_of_week (Mon=0) for the delivery date
    const deliveryDate = new Date(order.delivery_date + 'T00:00:00Z')
    const dowNum = (deliveryDate.getUTCDay() + 6) % 7

    // Look up the counterpart menu's meal for this (day, slot)
    const { data: counterpartRow } = await supabase
      .from('weekly_menu')
      .select('meal_template_id')
      .eq('menu_type', counterpart)
      .eq('day_of_week', dowNum)
      .eq('meal_slot', order.meal_slot)
      .maybeSingle()

    const isFreeSwitch = counterpartRow?.meal_template_id === meal_template_id

    if (!isFreeSwitch) {
      // Check wallet balance before debiting
      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle()

      if ((wallet?.balance ?? 0) < SWITCH_FEE_PAISE) {
        return json({ error: 'insufficient_balance', required: SWITCH_FEE_PAISE }, 402)
      }

      // Debit ₹20
      await supabase.rpc('wallet_debit', {
        p_user: user.id,
        p_amount: SWITCH_FEE_PAISE,
        p_reason: 'Meal switch',
        p_reference_id: `switch-${order_id}`,
      })
    }

    // Update the order
    await supabase
      .from('orders')
      .update({ meal_template_id, is_customized: true, updated_at: new Date().toISOString() })
      .eq('id', order_id)

    return json({ ok: true, charged: !isFreeSwitch, fee_paise: isFreeSwitch ? 0 : SWITCH_FEE_PAISE })
  } catch (err) {
    console.error('switch-meal error:', err)
    return json({ error: 'Internal server error' }, 500)
  }
})
