// TEMPORARY cold-start diagnostic (1.9.0) — remove once the ~10s stall is
// root-caused.
//
// Fires a raw fetch() at module-eval time, deliberately bypassing supabase-js
// entirely: no auth client, no token, no session restore, no AsyncStorage.
// It hits a public table (categories, RLS `USING (true)`) with only the anon
// key, so the ONLY thing it measures is DNS + TCP + TLS + server time.
//
// Run against the instrumented supabase queries in the same launch, this
// splits the two candidate causes apart decisively:
//
//   RAW fast (~400ms) + supabase slow (~10s)
//     → the stall is inside the auth client (queries queueing behind token
//       refresh / session restore). Fixable in app code.
//
//   RAW also slow (~10s)
//     → the stall is connection establishment, most likely the IPv6
//       Happy-Eyeballs fallback (carrier blackholes the v6 SYN, OS waits out
//       its ~10s TCP connect timeout, then retries on v4 — and the route
//       stays warm afterwards, which is exactly why a relaunch 20s later is
//       instant). Not fixable in JS; only maskable with cache-first render.
import { logColdStart } from './coldStartLog'

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

export function runColdStartProbe() {
  if (!SUPABASE_URL || !ANON_KEY) return
  const t0 = Date.now()
  logColdStart('RAW probe fired (no supabase-js, no auth)')
  fetch(`${SUPABASE_URL}/rest/v1/categories?select=id&limit=1`, {
    headers: { apikey: ANON_KEY },
  })
    .then((r) => logColdStart(`RAW probe resolved status=${r.status} after ${Date.now() - t0}ms`))
    .catch((e) => logColdStart(`RAW probe FAILED after ${Date.now() - t0}ms: ${e}`))
}
