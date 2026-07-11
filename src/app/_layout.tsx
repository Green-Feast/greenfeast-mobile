import { useEffect, useRef } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Platform, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import * as Linking from 'expo-linking'
import * as SplashScreen from 'expo-splash-screen'
import {
  Fraunces_300Light,
  Fraunces_400Regular,
} from '@expo-google-fonts/fraunces'
import {
  Caveat_400Regular,
  Caveat_500Medium,
} from '@expo-google-fonts/caveat'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { useOtaNotifications } from '@/hooks/useOtaNotifications'
import { Colors } from '@/constants/colors'
import { LEGAL_LAST_UPDATED } from '@/constants/legal'

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

        // Record Terms/Privacy consent exactly once per account, the moment
        // any session is first established. Safe to run unconditionally on
        // every auth event (Google/Apple/email, native or web redirect) —
        // the login screen's checkbox gates every sign-in/sign-up action, so
        // reaching a session at all implies consent was given; the .is(...)
        // guard means a returning user's original timestamp is never
        // overwritten by a later login.
        supabase.from('users')
          .update({ terms_accepted_at: new Date().toISOString(), terms_version: LEGAL_LAST_UPDATED })
          .eq('id', session.user.id)
          .is('terms_accepted_at', null)
          .then(() => {})
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
    // Terms/Privacy must be reachable from any auth state (guest, mid-signup,
    // mid-onboarding) — exempt it from every redirect below.
    const inLegalGroup = (segments[0] as string) === '(legal)'
    if (inLegalGroup) return

    if (!session) {
      // Guests can browse /(app)/ and authenticate via /(auth)/.
      // Anything else → send to tabs.
      if (!inAppGroup && !inAuthGroup) router.replace('/(app)/(tabs)')
      return
    }

    // Signed in but phone not yet verified — start onboarding
    if (!phone) {
      if (!inOnboardingGroup) router.replace('/(onboarding)/name')
      return
    }

    // Phone verified but onboarding not complete — send to 3C (What Would You Like?)
    if (!onboarded) {
      if (!inOnboardingGroup) router.replace('/(onboarding)/gate')
      return
    }

    // Fully onboarded. The subscribe / build-plan flow reuses the onboarding
    // screens, so onboarded-but-unsubscribed users must be allowed into them.
    // Only the identity screens (name/phone) are pre-onboarding only —
    // bounce back to the app if a fully onboarded user lands on those.
    const IDENTITY_SCREENS = ['name', 'phone']
    if (inAuthGroup || (inOnboardingGroup && IDENTITY_SCREENS.includes(segments[1] ?? ''))) {
      router.replace('/(app)/(tabs)')
    }
  }, [session, phone, onboarded, loading, segments])

  // Stack instead of Slot so the whole app has one real navigation history —
  // back/swipe-back always returns to the literal previous screen, matching
  // the fix already applied to (app)/_layout.tsx for the same reason.
  return <Stack screenOptions={{ headerShown: false }} />
}

export default function RootLayout() {
  useOtaNotifications()

  // Handle OAuth redirect at root level so it survives Expo Router navigation.
  // greenfeast:///?code=... triggers Expo Router to navigate to "/" which
  // unmounts the login screen — this listener is always alive.
  const handledCode = useRef<string | null>(null)
  useEffect(() => {
    if (Platform.OS === 'web') return
    const sub = Linking.addEventListener('url', ({ url }) => {
      const { queryParams } = Linking.parse(url)
      const code = queryParams?.code as string | undefined
      if (!code || handledCode.current === code) return
      handledCode.current = code
      supabase.auth.exchangeCodeForSession(code)
    })
    return () => sub.remove()
  }, [])

  const [fontsLoaded] = useFonts({
    Fraunces_300Light,
    Fraunces_400Regular,
    Caveat_400Regular,
    Caveat_500Medium,
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        {/* Every screen in the app is light-background (cream/white), so
            dark icons is the correct global default — light was hardcoded
            here and never adapted per screen. gate.tsx and login.tsx (the
            two screens with a full-bleed hero photo under the status bar)
            override this locally with their own <StatusBar style="light">. */}
        <StatusBar style="dark" />
        <AuthGate />
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
