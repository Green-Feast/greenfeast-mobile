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
// Some Indian mobile networks block *.supabase.co at the DNS level, so the
// app can be pointed at our own domain instead (EXPO_PUBLIC_SUPABASE_URL =
// e.g. https://api.<our-domain>, a Supabase custom domain or proxy). The
// database still stores absolute links on the original host (meal photos:
// https://<ref>.supabase.co/storage/v1/...), which would stay blocked, so
// when a different host is configured every response body has that origin
// rewritten to ours. Off entirely while the URL is still *.supabase.co.
// No AbortController / signal handling here (see the note above).
const ORIGINAL_SUPABASE_ORIGIN = 'https://amwwjcwoumhbdxaxvexj.supabase.co'
const configuredOrigin = supabaseUrl?.replace(/\/+$/, '')
const rewriteOrigin = !!configuredOrigin && configuredOrigin !== ORIGINAL_SUPABASE_ORIGIN

export function rewriteSupabaseUrl<T extends string | null | undefined>(url: T): T {
  if (!rewriteOrigin || !url) return url
  return url.split(ORIGINAL_SUPABASE_ORIGIN).join(configuredOrigin) as T
}

const proxyAwareFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init)
  if (!rewriteOrigin) return res
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) return res
  const text = await res.text()
  return new Response(rewriteSupabaseUrl(text), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

// supabase-js reads the saved session from storage before every request, one
// request at a time (behind its auth lock), so a screen firing a dozen
// queries queued a dozen AsyncStorage reads. Only this client writes these
// keys, so a copy in memory is always current: the first read comes from
// AsyncStorage, the rest from memory, and every write still goes to disk.
const memory = new Map<string, string | null>()
const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (memory.has(key)) return memory.get(key) ?? null
    const value = await AsyncStorage.getItem(key)
    memory.set(key, value)
    return value
  },
  async setItem(key: string, value: string): Promise<void> {
    memory.set(key, value)
    await AsyncStorage.setItem(key, value)
  },
  async removeItem(key: string): Promise<void> {
    memory.set(key, null)
    await AsyncStorage.removeItem(key)
  },
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: proxyAwareFetch },
  auth: {
    storage: sessionStorage,
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
