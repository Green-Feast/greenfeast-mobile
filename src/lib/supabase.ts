import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

const NETWORK_TIMEOUT_MS = 15000

// Nothing in supabase-js (session restore/refresh, REST queries, RPCs) has a
// timeout by default — on a bad or "black-holed" connection (packets silently
// dropped, no explicit rejection) a request can hang far longer than the OS's
// own TCP timeout before giving up, which is what produced a 50+ second stuck
// loading skeleton that only cleared after several app reopens. Wrapping the
// client's fetch in an AbortController timeout means every Supabase call —
// including the auth session restore that every screen's own loading state
// waits on — fails fast and lets calling code's existing error handling take
// over, instead of hanging indefinitely.
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeout))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On web the OAuth redirect reloads the page, so supabase-js must pick up
    // the ?code= from the URL itself. On native the app handles it manually.
    detectSessionInUrl: Platform.OS === 'web',
    // PKCE returns ?code= on redirect (what our native handler expects);
    // the default implicit flow returns tokens in the URL fragment instead.
    flowType: 'pkce',
  },
  global: {
    fetch: fetchWithTimeout,
  },
})
