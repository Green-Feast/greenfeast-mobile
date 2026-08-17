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
import { withTimeout } from '@/lib/withTimeout'
import { useAuthStore } from '@/store/auth'
import { useOtaNotifications } from '@/hooks/useOtaNotifications'
import { Colors } from '@/constants/colors'
import { LEGAL_LAST_UPDATED } from '@/constants/legal'

SplashScreen.preventAutoHideAsync()

// Ceilings for the two network waits that gate the whole app's first render.
// Generous enough not to trip a genuinely slow-but-working connection, short
// enough that a stalled one never looks like a permanent freeze.
const SESSION_RESTORE_TIMEOUT_MS = 10000
const PROFILE_LOOKUP_TIMEOUT_MS = 10000

function AuthGate() {
  const router = useRouter()
  const segments = useSegments()
  const { session, phone, onboarded, loading, profileLoading, setSession, setProfileLoaded } = useAuthStore()

  useEffect(() => {
    // Cold-start safety net. supabase-js emits INITIAL_SESSION (the only thing
    // that flips `loading` to false) only after it has restored the session —
    // and when the stored access token has expired, that restore refreshes it
    // over the network first, with no timeout of its own. On the first launch
    // after the app has sat idle for hours, a cold radio can leave that call
    // pending indefinitely, so `loading` never flips and every tab sits on its
    // skeleton forever. Killing the app and reopening "fixes" it only because
    // the token is fresh by then and the restore needs no network at all.
    //
    // A null session here is safe: the redirect effect below leaves anyone
    // already inside /(app)/ exactly where they are and just renders the guest
    // state, and the listener above still applies the real session whenever it
    // does land.
    const restoreTimer = setTimeout(() => {
      if (!useAuthStore.getState().loading) return
      console.warn(
        `[AuthGate] session restore did not settle in ${SESSION_RESTORE_TIMEOUT_MS}ms — ` +
          'rendering signed-out; the auth listener will apply the session if it arrives'
      )
      setSession(null)
      setProfileLoaded(null, false, false)
    }, SESSION_RESTORE_TIMEOUT_MS)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      clearTimeout(restoreTimer)
      // Unblock every tab's own data fetch (Home, My Plan, Account) the
      // moment the session itself is known — they only ever needed
      // `user.id`, not phone/onboarded, so there's no reason to make them
      // wait on the profile lookup below too.
      setSession(session)

      if (session) {
        // This lookup must never leave profileLoading stuck true — that would
        // hang the redirect effect below indefinitely. Neither a rejection nor
        // an indefinitely-pending request can do so: the timeout bounds the
        // wait and the catch falls back to "unknown" values so the redirect
        // logic can proceed. A genuinely returning user just retries once the
        // network recovers.
        try {
          const [{ data }, { count }] = await withTimeout(
            Promise.all([
              supabase.from('users').select('phone, onboarded').eq('id', session.user.id).single(),
              supabase
                .from('subscriptions')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', session.user.id)
                .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)'),
            ]),
            PROFILE_LOOKUP_TIMEOUT_MS,
            'profile lookup'
          )
          setProfileLoaded(data?.phone ?? null, data?.onboarded ?? false, (count ?? 0) > 0)
        } catch (err) {
          console.warn('[AuthGate] profile lookup failed:', err)
          setProfileLoaded(null, false, false)
        }

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
        setProfileLoaded(null, false, false)
      }
    })

    return () => {
      clearTimeout(restoreTimer)
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    // Redirect decisions need phone/onboarded, not just the session, so this
    // effect (unlike each tab's own fetch) waits on both.
    if (loading || profileLoading) return

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
  }, [session, phone, onboarded, loading, profileLoading, segments])

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
