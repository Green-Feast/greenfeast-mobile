import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) throw new Error('Unauthorized')

    const userId = user.id
    let deleteAuthUser = false
    try {
      const body = await req.json()
      deleteAuthUser = body?.deleteAuthUser === true
    } catch {
      // no body / not JSON — treat as the existing dev-reset call (data only)
    }

    if (deleteAuthUser) {
      // Real account deletion. public.users.id IS auth.users.id (PK+FK+CASCADE),
      // so deleting the auth user below cascades away the live profile,
      // subscriptions, orders, addresses, wallet, and payments — that's the
      // whole point: it's what forces Supabase to mint a fresh identity if the
      // same Google/Apple account signs in again. Snapshot everything into
      // deleted_accounts FIRST so the admin app can still show it.
      const [profileRes, dietaryRes, addressesRes, subsRes, ordersRes, walletRes, txRes, paymentsRes] = await Promise.all([
        supabase.from('users').select('*').eq('id', userId).maybeSingle(),
        supabase.from('dietary_profiles').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('addresses').select('*').eq('user_id', userId),
        supabase.from('subscriptions').select('*, plans ( name )').eq('user_id', userId),
        supabase.from('orders').select('id, delivery_date, meal_slot, status, quantity, unit_price, extra_dish, meal_templates ( name )').eq('user_id', userId).order('delivery_date', { ascending: false }),
        supabase.from('wallets').select('balance').eq('user_id', userId).maybeSingle(),
        supabase.from('wallet_transactions').select('type, amount, reason, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('payments').select('amount, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
      ])

      const snapshot = {
        profile: profileRes.data,
        dietary_profile: dietaryRes.data,
        addresses: addressesRes.data ?? [],
        subscriptions: subsRes.data ?? [],
        orders: ordersRes.data ?? [],
        wallet_balance: walletRes.data?.balance ?? 0,
        wallet_transactions: txRes.data ?? [],
        payments: paymentsRes.data ?? [],
      }

      const { error: archiveErr } = await supabase.from('deleted_accounts').insert({
        original_user_id: userId,
        name: profileRes.data?.name ?? null,
        phone: profileRes.data?.phone ?? null,
        email: user.email ?? null,
        snapshot,
      })
      if (archiveErr) throw archiveErr

      const { error: authDeleteErr } = await supabase.auth.admin.deleteUser(userId)
      if (authDeleteErr) throw authDeleteErr

      return new Response(
        JSON.stringify({ success: true, message: 'Account and all data deleted' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Dev-reset path, unchanged: wipe app data but keep the auth account so
    // the same login can be reused for repeated testing.
    await Promise.all([
      supabase.from('subscriptions').delete().eq('user_id', userId),
      supabase.from('addresses').delete().eq('user_id', userId),
      supabase.from('dietary_profiles').delete().eq('user_id', userId),
      supabase.from('questionnaire_responses').delete().eq('user_id', userId),
      supabase.from('wallets').delete().eq('user_id', userId),
    ])
    await supabase.from('users').update({
      name: null,
      phone: null,
      onboarded: false,
    }).eq('id', userId)

    return new Response(
      JSON.stringify({ success: true, message: 'All user data reset' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (err: any) {
    console.error(err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
