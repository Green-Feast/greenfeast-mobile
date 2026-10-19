import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

// Sends the admins' alerts (migration 063) as web pushes to every device an
// admin switched alerts on for (admin_push_subscriptions). notify_admins()
// wakes this up after saving an alert; each run sends whatever hasn't been
// pushed yet, so it needs no payload and calling it twice sends nothing twice
// (deployed with --no-verify-jwt — there is nothing to leak or abuse).
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…).
// The public key is also in the admin (lib/push-config.ts).

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:greenfeast.tech@gmail.com'
if (PUBLIC_KEY && PRIVATE_KEY) webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY)

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if (!PUBLIC_KEY || !PRIVATE_KEY) return json({ ok: false, error: 'VAPID keys not set' }, 500)

  try {
    // Claim what hasn't been pushed (recent only — a stale reminder isn't
    // worth a buzz hours later; it stays in the admin's Alerts list).
    const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
    const { data: alerts, error } = await supabase
      .from('admin_alerts')
      .update({ pushed_at: new Date().toISOString() })
      .is('pushed_at', null)
      .gte('created_at', since)
      .select('id, kind, title, body, url')
    if (error) throw error
    if (!alerts?.length) return json({ ok: true, alerts: 0 })

    const { data: subs } = await supabase.from('admin_push_subscriptions').select('id, endpoint, p256dh, auth')
    let sent = 0
    const gone = new Set<string>()
    const failures: string[] = []

    for (const sub of subs ?? []) {
      for (const a of alerts) {
        if (gone.has(sub.id)) break
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: a.title, body: a.body, url: a.url, tag: a.id }),
            { TTL: 3600, urgency: 'high' },
          )
          sent++
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          // The browser dropped this subscription (logged out, cleared data).
          if (status === 404 || status === 410) gone.add(sub.id)
          else failures.push(`${status ?? ''} ${(e as Error).message}`.trim())
        }
      }
      if (!gone.has(sub.id)) {
        await supabase.from('admin_push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', sub.id)
      }
    }
    if (gone.size) await supabase.from('admin_push_subscriptions').delete().in('id', [...gone])
    if (failures.length) console.error('[admin-push] failures:', failures.slice(0, 5))

    return json({ ok: true, alerts: alerts.length, devices: subs?.length ?? 0, sent, removed: gone.size, failures: failures.length })
  } catch (e) {
    console.error('[admin-push]', e)
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
