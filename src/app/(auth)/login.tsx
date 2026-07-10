import { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Platform,
  TextInput,
  ScrollView,
} from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Check } from 'lucide-react-native'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { makeRedirectUri } from 'expo-auth-session'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { SHOW_DEV_SKIP } from '@/constants/dev'
import Logo from '@/components/Logo'

const HERO_PHOTO = require('@/assets/food/burrito-bowl.jpg')

WebBrowser.maybeCompleteAuthSession()

type EmailMode = 'signin' | 'signup'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const handledUrl = useRef<string | null>(null)

  const [emailMode, setEmailMode] = useState<EmailMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [signupSuccess, setSignupSuccess] = useState(false)

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

  const CONSENT_MSG = 'Please tick the box below to agree to the Terms & Conditions and Privacy Policy first.'

  function toggleAgreed() {
    const next = !agreed
    setAgreed(next)
    if (next && error === CONSENT_MSG) setError('')
  }

  async function signInWithGoogle() {
    if (!agreed) { setError(CONSENT_MSG); return }
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
    if (!agreed) { setError(CONSENT_MSG); return }
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
    if (!agreed) { setError(CONSENT_MSG); return }
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
        if (trimmedPassword.length < 8) throw new Error('Password must be at least 8 characters.')
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: trimmedPassword,
        })
        if (error) throw error
        if (!data.session) {
          setSignupSuccess(true)
          return
        }
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setEmailLoading(false)
    }
  }

  const isLoading = googleLoading || appleLoading || emailLoading

  // ── Email-confirmed success state ────────────────────────────────

  if (signupSuccess) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <View style={styles.wordmarkRow}>
          <Logo size={24} />
          <Text style={styles.wordmarkText}>greenfeast</Text>
        </View>
        <View style={styles.successCard}>
          <Text style={styles.headline}>Check your email</Text>
          <Text style={styles.successDesc}>
            We sent a confirmation link to{'\n'}
            <Text style={styles.successEmail}>{email}</Text>
            {'\n\n'}Open it to activate your account, then come back and sign in.
          </Text>
          <TouchableOpacity
            style={styles.emailBtn}
            onPress={() => { setSignupSuccess(false); setEmailMode('signin') }}
          >
            <Text style={styles.emailBtnText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  // ── Main login screen ─────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Hero photo */}
      <View style={styles.heroWrap}>
        <Image source={HERO_PHOTO} style={styles.heroPhoto} contentFit="cover" cachePolicy="memory-disk" />
        <LinearGradient colors={['transparent', Colors.cream50]} style={styles.heroFade} pointerEvents="none" />
      </View>

      {/* Wordmark */}
      <View style={styles.wordmarkRow}>
        <Logo size={24} />
        <Text style={styles.wordmarkText}>greenfeast</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingBottom: 48 + insets.bottom }]}
      >
        {/* Headline */}
        <Text style={styles.headline}>Sign in to continue</Text>
        <Text style={styles.subheadline}>Good food, goals met.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Google */}
        <TouchableOpacity
          style={styles.oauthBtn}
          onPress={signInWithGoogle}
          disabled={isLoading}
        >
          {googleLoading ? (
            <ActivityIndicator color={Colors.ink900} />
          ) : (
            <>
              <Text style={styles.googleG}>G</Text>
              <Text style={styles.oauthBtnText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Apple — iOS only */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={styles.appleBtn}
            onPress={signInWithApple}
            disabled={isLoading}
          >
            {appleLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.appleIcon}></Text>
                <Text style={styles.appleBtnText}>Continue with Apple</Text>
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

        {/* Email auth */}
        <View style={styles.emailSection}>
          {/* Mode toggles */}
          <View style={styles.modeTabs}>
            <TouchableOpacity
              onPress={() => { setEmailMode('signin'); setError('') }}
              style={styles.modeTabBtn}
            >
              <Text style={[styles.modeTabText, emailMode === 'signin' && styles.modeTabActive]}>
                Sign In
              </Text>
              {emailMode === 'signin' && <View style={styles.modeTabUnderline} />}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setEmailMode('signup'); setError('') }}
              style={styles.modeTabBtn}
            >
              <Text style={[styles.modeTabText, emailMode === 'signup' && styles.modeTabActive]}>
                Create Account
              </Text>
              {emailMode === 'signup' && <View style={styles.modeTabUnderline} />}
            </TouchableOpacity>
          </View>

          {/* Email field */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>EMAIL</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="you@example.com"
              placeholderTextColor={Colors.ink300}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={setEmail}
            />
          </View>

          {/* Password field */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>PASSWORD</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder={emailMode === 'signup' ? 'Min 8 characters' : '••••••••'}
              placeholderTextColor={Colors.ink300}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={handleEmailAuth}
              returnKeyType="go"
            />
          </View>

          <TouchableOpacity
            style={styles.emailBtn}
            onPress={handleEmailAuth}
            disabled={emailLoading}
          >
            {emailLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.emailBtnText}>
                {emailMode === 'signin' ? 'Sign In →' : 'Create Account →'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Terms & Privacy consent */}
        <View style={styles.consentRow}>
          <Pressable
            style={[styles.checkbox, agreed && styles.checkboxChecked]}
            onPress={toggleAgreed}
            hitSlop={8}
          >
            {agreed && <Check size={14} color="#fff" strokeWidth={3} />}
          </Pressable>
          <Text style={styles.consentText} onPress={toggleAgreed}>
            I agree to the{' '}
            <Text style={styles.consentLink} onPress={() => router.push('/(legal)/terms' as any)}>
              Terms & Conditions
            </Text>
            {' '}and{' '}
            <Text style={styles.consentLink} onPress={() => router.push('/(legal)/privacy' as any)}>
              Privacy Policy
            </Text>
          </Text>
        </View>

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
  container: {
    flex: 1,
    backgroundColor: Colors.cream50,
  },

  heroWrap: {
    width: '100%',
    height: 200,
  },
  heroPhoto: {
    width: '100%',
    height: '100%',
  },
  heroFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },

  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 8,
  },
  wordmarkText: {
    fontFamily: Fonts.headingSemi,
    fontSize: 17,
    color: Colors.green700,
    letterSpacing: -0.3,
  },

  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    gap: 16,
  },

  headline: {
    fontFamily: Fonts.heading,
    fontSize: 32,
    color: Colors.ink900,
    marginTop: 8,
    marginBottom: 4,
  },
  subheadline: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink500,
    marginBottom: 8,
  },

  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
  },

  // OAuth buttons
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingVertical: 15,
    minHeight: 52,
    backgroundColor: Colors.cream50,
  },
  googleG: { fontFamily: Fonts.bodyBold, fontSize: 17, color: '#4285F4' },
  oauthBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.ink900 },

  appleBtn: {
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
  appleBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.ink100 },
  dividerText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink300 },

  // Email section
  emailSection: { gap: 16 },
  modeTabs: { flexDirection: 'row', gap: 20 },
  modeTabBtn: { alignItems: 'center', paddingBottom: 4 },
  modeTabText: {
    fontFamily: Fonts.bodyMed,
    fontSize: 15,
    color: Colors.ink400,
  },
  modeTabActive: { color: Colors.green700 },
  modeTabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: Colors.green700,
    borderRadius: 1,
  },

  fieldGroup: { gap: 6 },
  fieldLabel: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  fieldInput: {
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink900,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 0,
  },

  emailBtn: {
    backgroundColor: Colors.green900,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    marginTop: 4,
  },
  emailBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },

  successCard: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  successDesc: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink500, lineHeight: 22 },
  successEmail: { fontFamily: Fonts.bodyBold, color: Colors.ink900 },

  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: {
    backgroundColor: Colors.green700,
    borderColor: Colors.green700,
  },
  consentText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink500,
    lineHeight: 19,
  },
  consentLink: {
    fontFamily: Fonts.bodyMed,
    color: Colors.green700,
    textDecorationLine: 'underline',
  },
  devBtn: { alignItems: 'center', padding: 10 },
  devBtnText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink300, textDecorationLine: 'underline' },
})
