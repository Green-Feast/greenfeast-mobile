import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

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
  setSession: (session: Session | null) => void
  setProfileLoaded: (phone: string | null, onboarded: boolean, hasSubscription: boolean) => void
  setPhone: (phone: string | null) => void
  setOnboarded: (onboarded: boolean) => void
  setHasSubscription: (hasSubscription: boolean) => void
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  phone: null,
  onboarded: false,
  hasSubscription: false,
  loading: true,
  profileLoading: true,
  setSession: (session) =>
    set({ session, user: session?.user ?? null, loading: false }),
  setProfileLoaded: (phone, onboarded, hasSubscription) =>
    set({ phone, onboarded, hasSubscription, profileLoading: false }),
  setPhone: (phone) => set({ phone }),
  setOnboarded: (onboarded) => set({ onboarded }),
  setHasSubscription: (hasSubscription) => set({ hasSubscription }),
  signOut: async () => {
    // Clear local state even if the network sign-out call fails, so the user
    // is always logged out from the app's perspective and AuthGate redirects.
    try {
      await supabase.auth.signOut()
    } catch {
      // ignore — we still wipe local session below
    }
    set({ session: null, user: null, phone: null, onboarded: false, hasSubscription: false, loading: false, profileLoading: false })
  },
}))
