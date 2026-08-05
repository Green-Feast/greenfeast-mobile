import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

// A previous attempt wrapped every call in a custom AbortController-based
// fetch timeout to fix a rare stuck-loading bug. That broke EVERY Supabase
// call app-wide (login, Menu, everything) — AbortController/signal support
// in this native build's fetch implementation wasn't verified before
// shipping, and it very likely doesn't behave the way a plain browser/Node
// fetch does here. Reverted. If the stuck-loading issue needs revisiting,
// use a Promise.race + setTimeout approach instead (doesn't touch fetch's
// signal at all, so it can't have this failure mode), and verify on-device
// before shipping again.
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
})
