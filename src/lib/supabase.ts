import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

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
