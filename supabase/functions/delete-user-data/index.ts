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

    // Delete in reverse dependency order. FK cascades handle orders automatically.
    // subscription_addons is also handled by subscription cascade
    await Promise.all([
      supabase.from('subscriptions').delete().eq('user_id', userId),
      supabase.from('addresses').delete().eq('user_id', userId),
      supabase.from('dietary_profiles').delete().eq('user_id', userId),
      supabase.from('questionnaire_responses').delete().eq('user_id', userId),
      supabase.from('wallets').delete().eq('user_id', userId),
    ])

    // Reset user profile (keep auth account)
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
