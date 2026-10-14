// Supabase edge functions go cold after a few idle minutes, and the first
// call to a cold one takes 2–7 s (measured 2026-10-14) — that, not the
// database, is what made meal edits feel slow. Screens where the customer is
// about to edit meals ping the functions they may use with a cheap OPTIONS
// request (answered before any auth or database work) so workers are already
// up when they tap. The platform can route consecutive requests to different
// workers, so each function gets two pings. Throttled per function.
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL!
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
const EVERY_MS = 3 * 60 * 1000
const lastWarm: Record<string, number> = {}

export const MEAL_EDIT_FUNCTIONS = ['update-day-cart', 'switch-meal', 'add-dish', 'remove-dish', 'manage-subscription']

function ping(name: string) {
  return fetch(`${URL}/functions/v1/${name}`, { method: 'OPTIONS', headers: { apikey: KEY } }).catch(() => {})
}

export function warmFunctions(names: string[] = MEAL_EDIT_FUNCTIONS) {
  const now = Date.now()
  for (const name of names) {
    if (now - (lastWarm[name] ?? 0) < EVERY_MS) continue
    lastWarm[name] = now
    ping(name).then(() => ping(name))
  }
}
