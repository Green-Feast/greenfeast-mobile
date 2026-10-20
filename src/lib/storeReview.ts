import AsyncStorage from '@react-native-async-storage/async-storage'
import * as StoreReview from 'expo-store-review'
import { supabase } from '@/lib/supabase'
import { useRatingStore } from '@/store/rating'

// The store's own "rate this app" pop-up (Apple: at most 3 a year, shown or
// not at the system's discretion; Google: in-app review quota). We only ask
// it to appear when the customer is clearly happy — store_review_check()
// (migration 065) — and at most once every 120 days. No reward, and never a
// "do you like us?" question first.
const KEY = 'store_review_last_asked_v1'
const GAP_DAYS = 120

export async function maybeAskStoreReview(userId: string | undefined, opts: { afterRenewal?: boolean } = {}) {
  try {
    if (!userId) return
    // Never in the same visit as a meal-rating sheet.
    if (useRatingStore.getState().sheet) return
    const last = Number(await AsyncStorage.getItem(`${KEY}:${userId}`)) || 0
    if (Date.now() - last < GAP_DAYS * 86400_000) return
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return
    const { data, error } = await supabase.rpc('store_review_check', { p_after_renewal: !!opts.afterRenewal })
    if (error || data !== true) return
    // Counted as asked even if the system decides not to show it — asking
    // again tomorrow wouldn't change its answer.
    await AsyncStorage.setItem(`${KEY}:${userId}`, String(Date.now()))
    await StoreReview.requestReview()
  } catch {
    // best-effort — a rating prompt must never break the app
  }
}
