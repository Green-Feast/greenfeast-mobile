import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { logColdStart } from '@/lib/coldStartLog'

interface AuthState {
  session: Session | null
  user: User | null
  phone: string | null
  onboarded: boolean
  hasSubscription: boolean
  // Session-restore only. Every tab's own data fetch waits on this alone —
  // it should resolve as soon as the Supabase session is known, without
  // waiting on the profile lookup below.
  loading: boolean
  // phone/onboarded/hasSubscription lookup — only AuthGate's redirect logic
  // needs to wait on this. Splitting it from `loading` removes one full
  // serial network round-trip from every tab's cold-start render: previously
  // nothing could fetch until this profile lookup finished, even though
  // Home/My Plan/Account only ever needed `user.id`, not phone/onboarded.
  profileLoading: boolean
  // True only when the profile lookup itself failed/timed out — distinct
  // from `phone === null`, which can also mean "confirmed no phone yet".
  // AuthGate's redirect effect must never force onboarding on this: a
  // network hiccup is not evidence someone is a new user.
  profileLookupFailed: boolean
  // Which user phone/onboarded/hasSubscription actually belong to. This is
  // what makes the persisted cache below safe: AuthGate only trusts
  // phone/onboarded for routing when cachedUserId matches the *current*
  // session's user — otherwise a second account signing in on the same
  // device would briefly inherit the first account's onboarded state.
  cachedUserId: string | null
  // False until the AsyncStorage-persisted slice below has been read back
  // in. AuthGate must not treat `phone === null` as "confirmed no phone"
  // before this — that's indistinguishable from "haven't checked yet".
  hasHydrated: boolean
  setSession: (session: Session | null) => void
  // Called right before starting a profile lookup — including a retry after
  // an earlier one already flipped profileLoading false. Without this, a
  // session that arrives late (after a prior timeout) lets the redirect
  // effect act on stale phone/onboarded defaults before the fresh lookup for
  // *this* session has a chance to resolve.
  beginProfileLookup: () => void
  setProfileLoaded: (phone: string | null, onboarded: boolean, hasSubscription: boolean) => void
  setProfileLookupFailed: () => void
  setPhone: (phone: string | null) => void
  setOnboarded: (onboarded: boolean) => void
  setHasSubscription: (hasSubscription: boolean) => void
  setHasHydrated: (hydrated: boolean) => void
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      phone: null,
      onboarded: false,
      hasSubscription: false,
      loading: true,
      profileLoading: true,
      profileLookupFailed: false,
      cachedUserId: null,
      hasHydrated: false,
      setSession: (session) =>
        set({ session, user: session?.user ?? null, loading: false }),
      beginProfileLookup: () => set({ profileLoading: true, profileLookupFailed: false }),
      setProfileLoaded: (phone, onboarded, hasSubscription) =>
        set({
          phone, onboarded, hasSubscription,
          profileLoading: false, profileLookupFailed: false,
          // Marks this data as belonging to whoever's currently signed in —
          // this is what gets persisted, and what a future cold start's
          // instant-render trusts.
          cachedUserId: get().user?.id ?? null,
        }),
      setProfileLookupFailed: () => set({ profileLoading: false, profileLookupFailed: true }),
      setPhone: (phone) => set({ phone }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setHasSubscription: (hasSubscription) => set({ hasSubscription }),
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      signOut: async () => {
        // Clear local state even if the network sign-out call fails, so the user
        // is always logged out from the app's perspective and AuthGate redirects.
        try {
          await supabase.auth.signOut()
        } catch {
          // ignore — we still wipe local session below
        }
        set({
          session: null, user: null, phone: null, onboarded: false, hasSubscription: false,
          loading: false, profileLoading: false, profileLookupFailed: false, cachedUserId: null,
        })
      },
    }),
    {
      name: 'greenfeast-auth-cache',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the DERIVED profile fields, not session/user — the real
      // session token is already persisted separately (and more carefully)
      // by the Supabase client itself; duplicating it here would just be
      // another place for it to go stale or leak.
      partialize: (state) => ({
        phone: state.phone,
        onboarded: state.onboarded,
        hasSubscription: state.hasSubscription,
        cachedUserId: state.cachedUserId,
      }),
      // Fail open on a corrupt/unreadable cache — hasHydrated must still
      // flip true (with an empty cache) so AuthGate never waits forever.
      onRehydrateStorage: () => (state, error) => {
        logColdStart(`auth cache rehydrated: cachedUserId=${state?.cachedUserId ?? 'none'} error=${error ?? 'none'}`)
        if (error) useAuthStore.setState({ hasHydrated: true })
        else state?.setHasHydrated(true)
      },
    }
  )
)
