import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import Logo from '@/components/Logo'

WebBrowser.maybeCompleteAuthSession()

export default function LoginScreen() {
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [error, setError] = useState('')
  const handledUrl = useRef<string | null>(null)

  // Fallback: on Android the OAuth redirect often re-opens the app via deep
  // link instead of resolving openAuthSessionAsync (which returns 'dismiss').
  // Catch the incoming URL here and exchange the code ourselves.
  const incomingUrl = Linking.useURL()
  useEffect(() => {
    if (!incomingUrl || Platform.OS === 'web') return
    if (handledUrl.current === incomingUrl) return

    const { queryParams } = Linking.parse(incomingUrl)
    const code = queryParams?.code as string | undefined
    if (!code) return

    handledUrl.current = incomingUrl
    console.log('Deep link with auth code received')
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        console.log('Deep link exchange error:', error.message)
        setError('Google sign-in failed. Please try again.')
      }
    })
  }, [incomingUrl])

  async function signInWithGoogle() {
    setGoogleLoading(true)
    setError('')
    try {
      if (Platform.OS === 'web') {
        // Web: full-page redirect. supabase-js picks up the ?code= on return
        // (detectSessionInUrl is enabled for web in lib/supabase.ts).
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        })
        if (error) throw error
        return
      }

      const redirectTo = Linking.createURL('/')
      console.log('OAuth redirectTo:', redirectTo)

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      })

      if (error || !data?.url) throw error ?? new Error('No OAuth URL')

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
      console.log('OAuth result:', result.type, 'url' in result ? result.url : '')

      if (result.type === 'success') {
        const { queryParams } = Linking.parse(result.url)
        const code = queryParams?.code as string | undefined
        if (!code) throw new Error('No auth code in redirect URL')
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) throw exchangeError
      }
    } catch (err: any) {
      console.log('OAuth error:', err?.message)
      setError('Google sign-in failed. Please try again.')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function signInWithApple() {
    setAppleLoading(true)
    setError('')
    try {
      // expo-apple-authentication must be installed: npx expo install expo-apple-authentication
      const AppleAuth = await import('expo-apple-authentication')
      const credential = await AppleAuth.signInAsync({
        requestedScopes: [
          AppleAuth.AppleAuthenticationScope.FULL_NAME,
          AppleAuth.AppleAuthenticationScope.EMAIL,
        ],
      })

      if (credential.identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        })
        if (error) throw error
      }
    } catch (err: any) {
      if (err?.code !== 'ERR_REQUEST_CANCELED') {
        setError('Apple sign-in failed. Please try again.')
      }
    } finally {
      setAppleLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.logoWrap}>
          <Logo size={56} />
        </View>
        <Text style={styles.title}>GreenFeast</Text>
        <Text style={styles.subtitle}>Healthy meals, delivered daily</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sign in to continue</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={styles.googleButton}
          onPress={signInWithGoogle}
          disabled={googleLoading || appleLoading}
        >
          {googleLoading ? (
            <ActivityIndicator color={Colors.text} />
          ) : (
            <>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={styles.appleButton}
            onPress={signInWithApple}
            disabled={googleLoading || appleLoading}
          >
            {appleLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.appleIcon}></Text>
                <Text style={styles.appleButtonText}>Continue with Apple</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <Text style={styles.terms}>
          By continuing you agree to our Terms of Service and Privacy Policy
        </Text>

        {/* DEV ONLY — remove before launch */}
        <TouchableOpacity
          style={styles.devBtn}
          onPress={async () => {
            await supabase.auth.signInWithPassword({ email: 'test@test.com', password: 'test1234' })
          }}
        >
          <Text style={styles.devBtnText}>Dev: Skip Login</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary, justifyContent: 'flex-end' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontFamily: Fonts.heading, fontSize: 34, color: '#fff', marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 16, color: Colors.primaryMid },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 32,
    paddingBottom: 44,
    gap: 12,
  },
  cardTitle: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.text, marginBottom: 4 },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingVertical: 15,
    minHeight: 52,
    backgroundColor: '#fff',
  },
  googleIcon: { fontFamily: Fonts.bodyBold, fontSize: 18, color: '#4285F4' },
  googleButtonText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.text },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 999,
    paddingVertical: 15,
    minHeight: 52,
    backgroundColor: '#000',
  },
  appleIcon: { fontSize: 18, color: '#fff' },
  appleButtonText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
  terms: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 4 },
  devBtn: { marginTop: 12, alignItems: 'center', padding: 10 },
  devBtnText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textLight, textDecorationLine: 'underline' },
})
