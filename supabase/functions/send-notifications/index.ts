import { createClient } from 'jsr:@supabase/supabase-js@2'

// To trigger a push notification call this function with the service role key:
//
//   await supabase.functions.invoke('send-notifications', {
//     body: {
//       user_id: 'uuid',        // OR
//       subscription_id: 'uuid', // resolved to user_id automatically
//       title: 'Your meal is on its way!',
//       body:  'Estimated arrival: 12:30 PM',
//       type:  'order_update',  // stored in notifications table
//     }
//   })
//
// For "order status update → notification", call this from the admin server
// action (subscribers/[id]/actions.ts) when updating order status, or wire
// a pg_net trigger once volume justifies it.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  // Service-role callers only
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  if (token !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  try {
    const { user_id, subscription_id, title, body, type = 'general', data = {} } = await req.json()

    if (!title || !body) return json({ error: 'title and body are required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Resolve user_id
    let targetUserId: string | undefined = user_id
    if (!targetUserId && subscription_id) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('user_id')
        .eq('id', subscription_id)
        .single()
      targetUserId = sub?.user_id
    }

    if (!targetUserId) return json({ error: 'user_id or subscription_id required' }, 400)

    // Fetch push token
    const { data: user } = await supabase
      .from('users')
      .select('expo_push_token')
      .eq('id', targetUserId)
      .single()

    // Always log to notifications table (in-app notification centre)
    await supabase.from('notifications').insert({
      user_id: targetUserId,
      title,
      body,
      type,
    }).catch(err => console.error('notifications insert failed:', err))

    if (!user?.expo_push_token) {
      return json({ ok: true, sent: false, reason: 'no_push_token' })
    }

    // Send via Expo Push API
    const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify({
        to: user.expo_push_token,
        title,
        body,
        data: { ...data, type },
        sound: 'default',
        priority: 'high',
      }),
    })

    const result = await pushRes.json()
    const ticket = result?.data

    if (ticket?.status === 'error') {
      console.error('Expo push error:', ticket)
      return json({ ok: false, sent: false, ticket })
    }

    return json({ ok: true, sent: true, ticket })
  } catch (err) {
    console.error('send-notifications error:', err)
    return json({ error: 'Notification send failed' }, 500)
  }
})
