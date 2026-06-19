import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { makeRedirectUri } from 'expo-auth-session'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { SHOW_DEV_SKIP } from '@/constants/dev'
import Logo from '@/components/Logo'

WebBrowser.maybeCompleteAuthSession()

type EmailMode = 'signin' | 'signup'

export default function LoginScreen() {
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [error, setError] = useState('')
  const handledUrl = useRef<string | null>(null)

  // Email auth state
  const [showEmail, setShowEmail] = useState(false)
  const [emailMode, setEmailMode] = useState<EmailMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)

  // Fallback: on Android the OAuth redirect often re-opens the app via deep
  // link instead of resolving openAuthSessionAsync (which returns 'dismiss').
  const incomingUrl = Linking.useURL()
  useEffect(() => {
    if (!incomingUrl || Platform.OS === 'web') return
    if (handledUrl.current === incomingUrl) return

    const { queryParams } = Linking.parse(incomingUrl)
    const code = queryParams?.code as string | undefined
    if (!code) return

    handledUrl.current = incomingUrl
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setError('Google sign-in failed. Please try again.')
    })
  }, [incomingUrl])

  async function signInWithGoogle() {
    setGoogleLoading(true)
    setError('')
    try {
      if (Platform.OS === 'web') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin },
        })
        if (error) throw error
        return
      }

      const redirectTo = makeRedirectUri({ scheme: 'greenfeast', path: '/' })
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      })
      if (error || !data?.url) throw error ?? new Error('No OAuth URL')

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
      if (result.type === 'success') {
        const { queryParams } = Linking.parse(result.url)
        const code = queryParams?.code as string | undefined
        if (!code) throw new Error('No auth code in redirect URL')
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
        if (exchangeError) throw exchangeError
      }
    } catch {
      setError('Google sign-in failed. Please try again.')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function signInWithApple() {
    setAppleLoading(true)
    setError('')
    try {
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

  async function handleEmailAuth() {
    const trimmedEmail = email.trim()
    const trimmedPassword = password.trim()
    if (!trimmedEmail || !trimmedPassword) {
      setError('Please enter your email and password.')
      return
    }
    setEmailLoading(true)
    setError('')
    try {
      if (emailMode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPassword,
        })
        if (error) throw error
      } else {
        if (trimmedPassword.length < 8) {
          throw new Error('Password must be at least 8 characters.')
        }
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: trimmedPassword,
        })
        if (error) throw error
        // If session is null, Supabase requires email confirmation
        if (!data.session) {
          setSignupSuccess(true)
          return
        }
        // Otherwise session was created immediately (email confirmation off in Supabase settings)
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setEmailLoading(false)
    }
  }

  const isLoading = googleLoading || appleLoading || emailLoading

  if (signupSuccess) {
    return (
      <View style={styles.container}>
        <View style={styles.hero}>
          <View style={styles.logoWrap}>
            <Logo size={56} />
          </View>
          <Text style={styles.title}>GreenFeast</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Check your email ✉️</Text>
          <Text style={styles.successDesc}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.successEmail}>{email}</Text>
            {'\n\n'}Open it to activate your account, then come back and sign in.
          </Text>
          <TouchableOpacity
            style={styles.emailButton}
            onPress={() => {
              setSignupSuccess(false)
              setEmailMode('signin')
            }}
          >
            <Text style={styles.emailButtonText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.hero}>
        <View style={styles.logoWrap}>
          <Logo size={56} />
        </View>
        <Text style={styles.title}>GreenFeast</Text>
        <Text style={styles.subtitle}>Healthy meals, delivered daily</Text>
      </View>

      <ScrollView
        style={styles.cardScroll}
        contentContainerStyle={styles.card}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.cardTitle}>Sign in to continue</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Google */}
        <TouchableOpacity
          style={styles.googleButton}
          onPress={signInWithGoogle}
          disabled={isLoading}
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

        {/* Apple — iOS only */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={styles.appleButton}
            onPress={signInWithApple}
            disabled={isLoading}
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

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Email expand / collapse */}
        {!showEmail ? (
          <TouchableOpacity
            style={styles.emailToggle}
            onPress={() => { setShowEmail(true); setError('') }}
            disabled={isLoading}
          >
            <Text style={styles.emailToggleText}>Continue with Email</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.emailForm}>
            {/* Mode tabs */}
            <View style={styles.modeTabs}>
              <TouchableOpacity
                style={[styles.modeTab, emailMode === 'signin' && styles.modeTabActive]}
                onPress={() => { setEmailMode('signin'); setError('') }}
              >
                <Text style={[styles.modeTabText, emailMode === 'signin' && styles.modeTabTextActive]}>Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeTab, emailMode === 'signup' && styles.modeTabActive]}
                onPress={() => { setEmailMode('signup'); setError('') }}
              >
                <Text style={[styles.modeTabText, emailMode === 'signup' && styles.modeTabTextActive]}>Create Account</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={Colors.textLight}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder={emailMode === 'signup' ? 'Password (min 8 chars)' : 'Password'}
              placeholderTextColor={Colors.textLight}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleEmailAuth}
              returnKeyType="go"
            />

            <TouchableOpacity
              style={styles.emailButton}
              onPress={handleEmailAuth}
              disabled={emailLoading}
            >
              {emailLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.emailButtonText}>
                  {emailMode === 'signin' ? 'Sign In →' : 'Create Account →'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => { setShowEmail(false); setError('') }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.terms}>
          By continuing you agree to our Terms of Service and Privacy Policy
        </Text>

        {SHOW_DEV_SKIP && (
          <TouchableOpacity
            style={styles.devBtn}
            onPress={async () => {
              await supabase.auth.signInWithPassword({ email: 'test@test.com', password: 'test1234' })
            }}
          >
            <Text style={styles.devBtnText}>Dev: Skip Login</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
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

  cardScroll: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  card: {
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

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textLight },

  emailToggle: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  emailToggleText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.text },

  emailForm: { gap: 10 },
  modeTabs: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 4,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  modeTabActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  modeTabText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textMuted },
  modeTabTextActive: { color: Colors.text },

  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: '#fff',
  },
  emailButton: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  emailButtonText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
  cancelText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', paddingVertical: 4 },

  successDesc: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted, lineHeight: 22, marginBottom: 8 },
  successEmail: { fontFamily: Fonts.bodyBold, color: Colors.text },

  terms: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 4 },
  devBtn: { marginTop: 4, alignItems: 'center', padding: 10 },
  devBtnText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textLight, textDecorationLine: 'underline' },
})
