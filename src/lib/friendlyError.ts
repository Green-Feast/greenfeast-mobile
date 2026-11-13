import { FunctionsHttpError } from '@supabase/supabase-js'
import { TimeoutError } from './withTimeout'

/**
 * Turn any thrown/returned error into a sentence a customer can act on.
 *
 * Errors reach the UI from four places, and only one of them is written for
 * humans:
 *   1. Our own Postgres RPCs (RAISE EXCEPTION 'You can only skip ...') and
 *      edge functions (json({ error: '...' })) — already customer-facing, keep.
 *   2. Network failures — the raw text is Java/OkHttp or iOS internals
 *      ("fetch failed: java.net.UnknownHostException: ...", "Network request
 *      failed"). Replace with a connectivity message.
 *   3. Supabase Auth — terse English ("Invalid login credentials"). Rewrite.
 *   4. Postgres/PostgREST/JS internals ("violates foreign key constraint",
 *      "JWT expired", "Cannot read property 'x' of undefined"). Never show;
 *      use the caller's fallback.
 *
 * Rule of thumb: anything that looks technical falls back to the caller's
 * context-specific sentence ("Could not save your rating. Please try again.").
 */

export const NETWORK_MESSAGE =
  "We couldn't reach GreenFeast. Please check your internet connection and try again."

const NETWORK_PATTERNS = [
  /network request failed/i,
  /fetch failed/i,
  /failed to fetch/i,
  /unknownhost/i,
  /unable to resolve host/i,
  /no address associated/i,
  /could not resolve/i,
  /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/,
  /socket ?timeout|timed out|timeout/i,
  /connection (abort|reset|refused|closed)/i,
  /internet connection appears to be offline/i,
  /network (is )?unreachable|network error/i,
  /ssl|certificate|handshake/i,
  /AuthRetryableFetchError/,
]

// Supabase Auth messages → plain English. Matched case-insensitively.
const AUTH_REWRITES: [RegExp, string][] = [
  [/invalid login credentials/i, 'Wrong email or password. Please check and try again.'],
  [/email not confirmed/i, 'Please confirm your email first — check your inbox for the link we sent.'],
  [/user already registered|already been registered/i, 'An account with this email already exists. Try signing in instead.'],
  [/password should be at least|weak.?password/i, 'Please choose a stronger password (at least 8 characters).'],
  [/new password should be different/i, 'Your new password must be different from the old one.'],
  [/rate limit|too many requests|for security purposes, you can only request/i, 'Too many attempts. Please wait a minute and try again.'],
  [/unable to validate email|invalid email|email address .* is invalid/i, 'Please enter a valid email address.'],
  [/user not found/i, 'We couldn’t find an account with that email.'],
  [/(refresh token|session).*(not found|expired|invalid)|jwt expired|invalid jwt|not authenticated|auth session missing/i,
    'Your session has expired. Please sign in again.'],
  [/token has expired or is invalid|otp.*(expired|invalid)/i, 'This code or link has expired. Please request a new one.'],
  [/signups not allowed|signup.*disabled/i, 'New sign-ups are paused right now. Please try again later.'],
]

// Anything matching these is internal plumbing — never show it to a customer.
const TECHNICAL_PATTERNS = [
  /violates|constraint|duplicate key|foreign key|not-null|null value in column/i,
  /relation .* does not exist|column .* does not exist|function .* does not exist/i,
  /permission denied|row-level security|rls/i,
  /PGRST\d+|SQLSTATE|syntax error/i,
  /edge function|non-2xx|FunctionsHttpError|FunctionsFetchError|FunctionsRelayError/i,
  /undefined|null is not an object|cannot read propert|is not a function|unexpected token|json parse/i,
  /TypeError|ReferenceError|SyntaxError/,
  /internal server error|bad gateway|service unavailable|gateway timeout|\b5\d\d\b/i,
  /^[a-z0-9_]+$/, // bare error codes like "insufficient_balance"
  /no oauth url|no auth code|redirect url/i,
  /com\.apple\.|operation couldn.t be completed|\bERR_[A-Z_]+/i,
]

function rawMessage(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  const e = error as { message?: unknown; name?: unknown; error_description?: unknown }
  const msg = typeof e.message === 'string' ? e.message : typeof e.error_description === 'string' ? e.error_description : ''
  const name = typeof e.name === 'string' ? e.name : ''
  return name && !msg.includes(name) ? `${name}: ${msg}` : msg
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true
  const m = rawMessage(error)
  return NETWORK_PATTERNS.some((p) => p.test(m))
}

/** Synchronous: map an error to a customer-safe sentence. */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isNetworkError(error)) return NETWORK_MESSAGE
  const m = rawMessage(error).replace(/^\w*Error:\s*/, '').trim()
  if (!m) return fallback
  for (const [pattern, text] of AUTH_REWRITES) if (pattern.test(m)) return text
  if (TECHNICAL_PATTERNS.some((p) => p.test(m))) return fallback
  if (m.length > 200) return fallback
  return m
}

/**
 * Async variant for supabase.functions.invoke() errors: FunctionsHttpError
 * hides our edge function's { error: '...' } body behind error.context.
 */
export async function friendlyFunctionError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json()
      if (typeof body?.error === 'string') return friendlyError(body.error, fallback)
    } catch {
      // body wasn't JSON or was already read — fall through
    }
  }
  return friendlyError(error, fallback)
}
