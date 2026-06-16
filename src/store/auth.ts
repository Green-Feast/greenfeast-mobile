import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthState {
  session: Session | null
  user: User | null
  phone: string | null
  onboarded: boolean
  hasSubscription: boolean
  loading: boolean
  setSession: (session: Session | null) => void
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
  setSession: (session) =>
    set({ session, user: session?.user ?? null, loading: false }),
  setPhone: (phone) => set({ phone }),
  setOnboarded: (onboarded) => set({ onboarded }),
  setHasSubscription: (hasSubscription) => set({ hasSubscription }),
  signOut: async () => {
    await supabase.auth.signOut()
    set({ session: null, user: null, phone: null, onboarded: false, hasSubscription: false })
  },
}))
