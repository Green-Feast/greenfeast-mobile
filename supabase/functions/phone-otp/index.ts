import { createClient } from 'jsr:@supabase/supabase-js@2'

// WhatsApp OTP for the customer's number (onboarding "What's your WhatsApp
// number?"). Migration 061.
//
//   { action: 'status' }                → { ok, enabled }   — is WhatsApp set up?
//   { action: 'send',   phone }         → { ok, resend_in } — code sent on WhatsApp
//   { action: 'verify', phone, code }   → { ok }            — number saved as verified
//
// Failures come back as 200 { ok: false, error: <code>, message } so the app
// can show the message as is. Error codes: not_configured, invalid_phone,
// in_use, too_soon, too_many, send_failed, no_code, expired, wrong_code,
// locked, unauthorized.
//
// Sending uses the Meta WhatsApp Cloud API with an Authentication template
// (copy-code button). Secrets:
//   WHATSAPP_TOKEN            permanent system-user token
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's Phone number ID
//   WHATSAPP_OTP_TEMPLATE     template name (default greenfeast_otp)
//   WHATSAPP_OTP_LANG         template language (default en)
//   WHATSAPP_API_VERSION      Graph API version (default v23.0)
//   OTP_REVIEW_PHONES         optional: comma-separated 10-digit numbers for
//   OTP_REVIEW_CODE           App Store / Play reviewers — no message is sent,
//                             this fixed code works instead.
// Codes are 6 digits, valid 10 minutes, 5 tries; one send per 30 s, at most
// 6 a day per number and 10 a day per account (so nobody runs up the bill).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? ''
const PHONE_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? ''
const TEMPLATE = Deno.env.get('WHATSAPP_OTP_TEMPLATE') ?? 'greenfeast_otp'
const LANG = Deno.env.get('WHATSAPP_OTP_LANG') ?? 'en'
const API_VERSION = Deno.env.get('WHATSAPP_API_VERSION') ?? 'v23.0'
const PEPPER = Deno.env.get('INTERNAL_FN_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const REVIEW_PHONES = (Deno.env.get('OTP_REVIEW_PHONES') ?? '').split(',').map((p) => p.replace(/\D/g, '').slice(-10)).filter((p) => p.length === 10)
const REVIEW_CODE = (Deno.env.get('OTP_REVIEW_CODE') ?? '').replace(/\D/g, '')

const ENABLED = !!TOKEN && !!PHONE_ID
const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_AFTER_S = 30
const MAX_TRIES = 5

async function userFrom(req: Request): Promise<{ id: string } | null> {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  if (!token) return null
  const { data, error } = await supabase.auth.getClaims(token)
  const sub = data?.claims?.sub
  if (error || !sub || data?.claims?.role !== 'authenticated') return null
  return { id: sub as string }
}

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function fail(error: string, message: string, extra: object = {}) {
  return json({ ok: false, error, message, ...extra })
}

async function hash(userId: string, phone: string, code: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}:${phone}:${code}`))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sameHash(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function sixDigits() {
  const n = new Uint32Array(1)
  crypto.getRandomValues(n)
  return String(n[0] % 1_000_000).padStart(6, '0')
}

// The Authentication template: the code fills the body and the copy-code button.
async function sendWhatsApp(digits: string, code: string): Promise<{ id?: string; error?: string }> {
  const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: `91${digits}`,
      type: 'template',
      template: {
        name: TEMPLATE,
        language: { code: LANG },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      },
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { error: body?.error?.message ?? `WhatsApp returned ${res.status}` }
  return { id: body?.messages?.[0]?.id }
}

async function inUseByOther(userId: string, phone: string) {
  const { data } = await supabase.from('users').select('id').eq('phone', phone).neq('id', userId).limit(1)
  return (data ?? []).length > 0
}

const IN_USE = 'This number is already on another GreenFeast account. Sign in with that account, or message us on WhatsApp and we’ll sort it out.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const user = await userFrom(req)
    if (!user) return fail('unauthorized', 'Please sign in again.')

    const body = (await req.json().catch(() => ({}))) as { action?: string; phone?: string; code?: string }
    if (body.action === 'status') return json({ ok: true, enabled: ENABLED })
    if (!ENABLED) return fail('not_configured', 'WhatsApp codes aren’t set up yet.')

    const digits = String(body.phone ?? '').replace(/\D/g, '').slice(-10)
    if (!/^[6-9]\d{9}$/.test(digits)) return fail('invalid_phone', 'Enter a valid 10-digit mobile number.')
    const phone = '+91' + digits
    const review = REVIEW_PHONES.includes(digits) && REVIEW_CODE.length === 6

    if (body.action === 'send') {
      if (await inUseByOther(user.id, phone)) return fail('in_use', IN_USE)

      const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
      const { data: recent } = await supabase
        .from('phone_otps')
        .select('created_at, user_id, phone')
        .or(`user_id.eq.${user.id},phone.eq.${phone}`)
        .gte('created_at', dayAgo)
        .order('created_at', { ascending: false })
      const rows = (recent ?? []) as { created_at: string; user_id: string; phone: string }[]
      const last = rows.find((r) => r.user_id === user.id)
      if (last) {
        const wait = RESEND_AFTER_S - Math.floor((Date.now() - new Date(last.created_at).getTime()) / 1000)
        if (wait > 0) return fail('too_soon', `Wait ${wait} seconds before asking for another code.`, { resend_in: wait })
      }
      if (!review && (rows.filter((r) => r.phone === phone).length >= 6 || rows.filter((r) => r.user_id === user.id).length >= 10)) {
        return fail('too_many', 'Too many codes today. Try again tomorrow, or message us on WhatsApp.')
      }

      const code = review ? REVIEW_CODE : sixDigits()
      let messageId: string | null = null
      if (!review) {
        const sent = await sendWhatsApp(digits, code)
        if (sent.error) {
          console.error('[phone-otp] WhatsApp send failed:', sent.error)
          return fail('send_failed', 'Couldn’t send the code on WhatsApp. Check the number is on WhatsApp and try again.')
        }
        messageId = sent.id ?? null
      }
      const { error } = await supabase.from('phone_otps').insert({
        user_id: user.id,
        phone,
        code_hash: await hash(user.id, phone, code),
        expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        wa_message_id: messageId,
      })
      if (error) throw error
      return json({ ok: true, resend_in: RESEND_AFTER_S })
    }

    if (body.action === 'verify') {
      const code = String(body.code ?? '').replace(/\D/g, '')
      if (code.length !== 6) return fail('wrong_code', 'Enter the 6-digit code.')

      const { data: otp } = await supabase
        .from('phone_otps')
        .select('id, code_hash, expires_at, attempts')
        .eq('user_id', user.id)
        .eq('phone', phone)
        .is('verified_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!otp) return fail('no_code', 'Ask for a code first.')
      if (new Date(otp.expires_at).getTime() < Date.now()) return fail('expired', 'That code has expired — ask for a new one.')
      if (otp.attempts >= MAX_TRIES) return fail('locked', 'Too many wrong tries — ask for a new code.')

      if (!sameHash(otp.code_hash, await hash(user.id, phone, code))) {
        await supabase.from('phone_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id)
        const left = MAX_TRIES - otp.attempts - 1
        return fail(left > 0 ? 'wrong_code' : 'locked', left > 0 ? `That code isn't right — ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries — ask for a new code.')
      }

      if (await inUseByOther(user.id, phone)) return fail('in_use', IN_USE)
      await supabase.from('phone_otps').update({ verified_at: new Date().toISOString() }).eq('id', otp.id)
      const { error } = await supabase.from('users').update({ phone, phone_verified_at: new Date().toISOString() }).eq('id', user.id)
      if (error) {
        if ((error as { code?: string }).code === '23505') return fail('in_use', IN_USE)
        throw error
      }
      return json({ ok: true })
    }

    return fail('bad_request', 'Unknown action.')
  } catch (e) {
    console.error('[phone-otp]', e)
    return json({ ok: false, error: 'server', message: 'Something went wrong. Please try again.' }, 500)
  }
})
