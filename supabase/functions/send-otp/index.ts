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
    const { phone } = await req.json()

    if (!phone || !/^\+91[6-9]\d{9}$/.test(phone)) {
      return new Response(
        JSON.stringify({ error: 'Invalid phone number. Use format +91XXXXXXXXXX' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Delete old unverified OTPs for this phone before creating a new one
    await supabase
      .from('otp_attempts')
      .delete()
      .eq('phone', phone)
      .eq('verified', false)

    const { error: insertError } = await supabase.from('otp_attempts').insert({
      phone,
      otp,
      expires_at: expiresAt,
    })

    if (insertError) throw insertError

    // Send OTP via MSG91 SMS
    const msg91Response = await fetch('https://control.msg91.com/api/v5/otp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: Deno.env.get('MSG91_API_KEY')!,
      },
      body: JSON.stringify({
        template_id: Deno.env.get('MSG91_OTP_TEMPLATE_ID')!,
        mobile: phone.replace('+', ''),
        otp,
      }),
    })

    const msg91Data = await msg91Response.json()

    if (!msg91Response.ok || msg91Data.type === 'error') {
      throw new Error(`MSG91 error: ${JSON.stringify(msg91Data)}`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('send-otp error:', err)
    return new Response(
      JSON.stringify({ error: 'Failed to send OTP. Please try again.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
