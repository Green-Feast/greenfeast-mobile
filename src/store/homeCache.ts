// Stale-while-revalidate cache for Home's user-scoped payload.
//
// Home's fetch can stall ~10s on a cold start (see coldStartProbe.ts for the
// live diagnosis). Rather than wait on it, Home paints last-known state from
// AsyncStorage immediately and lets the real fetch overwrite it whenever it
// lands — the same pattern that took AuthGate's routing from a 10s wait to
// ~150ms.
//
// Correctness rule that makes this safe: todayOrder is date-specific, so it
// is stored with the IST date it was fetched for and is only replayed when
// that date is still today. Showing yesterday's meal as "today's delivery"
// would be worse than showing a spinner. subscription/userName aren't
// date-sensitive, so they always replay.
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { istToday } from '@/lib/ist'

export type CachedOrder = {
  id: string
  delivery_date: string
  status: string
  meal_slot: string
  meal_templates: {
    name: string
    category: string
    kcal: number | null
    protein: number | null
    image_url: string | null
  }
}

export type CachedSubscription = {
  id: string
  status: string
  deliveries_remaining: number
  plan_name: string | null
  carried_meals?: number
  plans: { meals_total: number } | null
}

type HomeCacheState = {
  // Which user this payload belongs to — a different account signing in on
  // the same device must never inherit the previous one's Home screen.
  cachedUserId: string | null
  // IST date todayOrder was fetched for; anything else means it's stale.
  cachedDate: string | null
  userName: string
  subscription: CachedSubscription | null
  todayOrder: CachedOrder | null
  hasHydrated: boolean
  save: (payload: {
    userId: string
    userName: string
    subscription: CachedSubscription | null
    todayOrder: CachedOrder | null
  }) => void
  clear: () => void
  setHasHydrated: (v: boolean) => void
}

export const useHomeCacheStore = create<HomeCacheState>()(
  persist(
    (set) => ({
      cachedUserId: null,
      cachedDate: null,
      userName: '',
      subscription: null,
      todayOrder: null,
      hasHydrated: false,
      save: ({ userId, userName, subscription, todayOrder }) =>
        set({ cachedUserId: userId, cachedDate: istToday(), userName, subscription, todayOrder }),
      clear: () =>
        set({ cachedUserId: null, cachedDate: null, userName: '', subscription: null, todayOrder: null }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: 'greenfeast-home-cache',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        cachedUserId: s.cachedUserId,
        cachedDate: s.cachedDate,
        userName: s.userName,
        subscription: s.subscription,
        todayOrder: s.todayOrder,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) useHomeCacheStore.setState({ hasHydrated: true })
        else state?.setHasHydrated(true)
      },
    }
  )
)

// Only replay the cache for the user it actually belongs to. todayOrder is
// additionally gated on the cache being from today — see the header note.
export function readHomeCache(userId: string | null | undefined) {
  const s = useHomeCacheStore.getState()
  if (!userId || s.cachedUserId !== userId) return null
  return {
    userName: s.userName,
    subscription: s.subscription,
    todayOrder: s.cachedDate === istToday() ? s.todayOrder : null,
    todayOrderIsFresh: s.cachedDate === istToday(),
  }
}
