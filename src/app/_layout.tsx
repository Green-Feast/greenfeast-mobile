import { useEffect } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import {
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors } from '@/constants/colors'

SplashScreen.preventAutoHideAsync()

function AuthGate() {
  const router = useRouter()
  const segments = useSegments()
  const { session, phone, onboarded, loading, setSession, setPhone, setOnboarded, setHasSubscription } = useAuthStore()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        // Fetch phone + onboarded + subscription status before marking loading
        // done so both the gate and the tab bar have complete info.
        const [{ data }, { count }] = await Promise.all([
          supabase.from('users').select('phone, onboarded').eq('id', session.user.id).single(),
          supabase
            .from('subscriptions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', session.user.id)
            .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)'),
        ])
        setPhone(data?.phone ?? null)
        setOnboarded(data?.onboarded ?? false)
        setHasSubscription((count ?? 0) > 0)
      } else {
        setPhone(null)
        setOnboarded(false)
        setHasSubscription(false)
      }
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (loading) return

    const inAuthGroup = segments[0] === '(auth)'
    const inOnboardingGroup = segments[0] === '(onboarding)'
    const inAppGroup = segments[0] === '(app)'

    if (!session) {
      if (!inAuthGroup) router.replace('/(auth)/phone')
      return
    }

    // Signed in but phone not yet verified — start onboarding
    if (!phone) {
      if (!inOnboardingGroup) router.replace('/(onboarding)/name')
      return
    }

    // Phone verified but onboarding not complete — stay in onboarding
    if (!onboarded) {
      if (!inOnboardingGroup) router.replace('/(onboarding)/menu')
      return
    }

    // Fully onboarded — move to app
    if (inAuthGroup || inOnboardingGroup) {
      router.replace('/(app)/(tabs)')
    }
  }, [session, phone, onboarded, loading, segments])

  return <Slot />
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: Colors.background }} />
  }

  return (
    <>
      <StatusBar style="light" />
      <AuthGate />
    </>
  )
}
