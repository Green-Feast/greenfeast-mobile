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
import { StatusBar } from 'expo-status-bar'
import { ChevronLeft } from 'lucide-react-native'
import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { makeRedirectUri } from 'expo-auth-session'
// Static import (not the lazy `await import()` the auth call below still
// uses) so AppleAuthenticationButton is a real component reference. Expo
// modules ship a real, importable JS API on every platform with a no-op
// native binding where unsupported, so this is safe to evaluate on Android
// too — only device verification can fully confirm it, per this project's
// own habit of not trusting an untested native-adjacent assumption blindly.
import * as AppleAuthentication from 'expo-apple-authentication'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { SHOW_DEV_LOGIN, DEV_LOGIN_EMAIL, DEV_LOGIN_PASSWORD } from '@/constants/dev'
import Logo from '@/components/Logo'
import GoogleIcon from '@/components/GoogleIcon'

const HERO_PHOTO = require('@/assets/food/burrito-bowl.webp')

WebBrowser.maybeCompleteAuthSession()

// 'choice' shows the sign-in options; the email views progressively reveal
// the form only once the subscriber has actually chosen email — this is what
// actually removes the dead space below the old always-visible form, since
// there's simply less on screen at once, not a layout trick on top of it.
type AuthView = 'choice' | 'email-signin' | 'email-signup'

export default function LoginScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [error, setError] = useState('')
  const handledUrl = useRef<string | null>(null)

  // False on iOS < 13 and on simulators with no Apple ID signed in — the
  // button must not render at all in either case, not just fail on tap.
  useEffect(() => {
    if (Platform.OS !== 'ios') return
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable)
  }, [])

  const [view, setView] = useState<AuthView>('choice')
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

  function goToChoice() {
    setView('choice')
    setError('')
  }

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
    // AppleAuthenticationButton has no disabled prop, so this guard is the
    // only thing standing between a fast double-tap and two concurrent
    // sign-in attempts.
    if (appleLoading) return
    setAppleLoading(true)
    setError('')
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      if (credential.identityToken) {
        const { data, error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        })
        if (error) throw error
        // fullName is only ever returned on the FIRST authorization for this
        // Apple ID — every later sign-in gets null. Persist it now or the
        // account has no name forever (Home's greeting silently renders
        // blank), since nothing else captures it later.
        const givenName = credential.fullName?.givenName
        if (givenName && data.user) {
          await supabase.from('users').update({ name: givenName }).eq('id', data.user.id).is('name', null)
        }
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
      if (view === 'email-signin') {
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

  const consentNotice = (
    <Text style={styles.consentNotice}>
      By continuing you agree to our{' '}
      <Text style={styles.consentLink} onPress={() => router.push('/(legal)/terms' as any)}>
        Terms & Conditions
      </Text>
      {' '}and{' '}
      <Text style={styles.consentLink} onPress={() => router.push('/(legal)/privacy' as any)}>
        Privacy Policy
      </Text>.
    </Text>
  )

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
            onPress={() => { setSignupSuccess(false); setView('email-signin') }}
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
      {/* The hero photo sits full-bleed under the status bar — override the
          global dark-icon default while this screen is focused. */}
      <StatusBar style="light" />

      {/* Hero photo — screen-proportional (not a fixed 200pt banner) with a
          top-anchored crop, matching (onboarding)/gate.tsx's treatment. A
          fixed height forced a ~49% crop on this square photo; height:'42%'
          keeps the container close to square, so cover crops only the empty
          plate/table below instead of the bowl itself. */}
      <View style={styles.heroWrap}>
        <Image source={HERO_PHOTO} style={styles.heroPhoto} contentFit="cover" contentPosition="top" cachePolicy="memory-disk" />
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
        contentContainerStyle={[styles.scroll, { paddingBottom: 32 + insets.bottom }]}
      >
        {view !== 'choice' && (
          <Pressable onPress={goToChoice} hitSlop={10} style={styles.backBtn}>
            <ChevronLeft size={22} color={Colors.ink900} />
          </Pressable>
        )}

        {/* Headline */}
        <View style={styles.headlineGroup}>
          <Text style={styles.headline}>
            {view === 'choice' ? 'Sign in to continue' : view === 'email-signin' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={styles.subheadline}>
            {view === 'choice' ? 'Good food, goals met.' : view === 'email-signin' ? 'Sign in with your email' : 'Takes less than a minute'}
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {view === 'choice' ? (
          <View style={styles.buttonStack}>
            <TouchableOpacity style={styles.oauthBtn} onPress={signInWithGoogle} disabled={isLoading}>
              {googleLoading ? (
                <ActivityIndicator color={Colors.ink900} />
              ) : (
                <>
                  <GoogleIcon size={18} />
                  <Text style={styles.oauthBtnText}>Continue with Google</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Apple's own button, not a hand-rolled one — required by their
                HIG (approved title, logo, colors, proportions) and a
                documented App Store review flag otherwise. It renders null
                on its own when unavailable, but only after logging a dev
                warning — the appleAvailable check above avoids that. It has
                no children/loading-spinner slot and no disabled prop, so
                double-tap protection lives inside signInWithApple itself. */}
            {Platform.OS === 'ios' && appleAvailable && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={26}
                style={styles.appleBtnNative}
                onPress={signInWithApple}
              />
            )}

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.emailOutlineBtn}
              onPress={() => { setView('email-signin'); setError('') }}
            >
              <Text style={styles.emailOutlineBtnText}>Sign in with email</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.createAccountBtn}
              onPress={() => { setView('email-signup'); setError('') }}
            >
              <Text style={styles.createAccountText}>
                Don't have an account? <Text style={styles.createAccountTextBold}>Create one</Text>
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.buttonStack}>
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>EMAIL</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="you@example.com"
                placeholderTextColor={Colors.ink300}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                autoComplete="email"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder={view === 'email-signup' ? 'Min 8 characters' : '••••••••'}
                placeholderTextColor={Colors.ink300}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType={view === 'email-signup' ? 'newPassword' : 'password'}
                autoComplete={view === 'email-signup' ? 'new-password' : 'current-password'}
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={handleEmailAuth}
                returnKeyType="go"
              />
            </View>

            <TouchableOpacity style={styles.emailBtn} onPress={handleEmailAuth} disabled={emailLoading}>
              {emailLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.emailBtnText}>
                  {view === 'email-signin' ? 'Sign In →' : 'Create Account →'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.createAccountBtn}
              onPress={() => { setView(view === 'email-signin' ? 'email-signup' : 'email-signin'); setError('') }}
            >
              <Text style={styles.createAccountText}>
                {view === 'email-signin' ? (
                  <>Don't have an account? <Text style={styles.createAccountTextBold}>Create one</Text></>
                ) : (
                  <>Already have an account? <Text style={styles.createAccountTextBold}>Sign in</Text></>
                )}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.consentWrap}>{consentNotice}</View>

        {SHOW_DEV_LOGIN && DEV_LOGIN_EMAIL && (
          <TouchableOpacity
            style={styles.devBtn}
            onPress={async () => {
              await supabase.auth.signInWithPassword({ email: DEV_LOGIN_EMAIL, password: DEV_LOGIN_PASSWORD })
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
    height: '42%',
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
    height: '35%',
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

  // gap alone owns vertical rhythm from here down — two rhythms: 24 between
  // sections (headline / buttons / consent), 12 within the button stack.
  scroll: {
    paddingHorizontal: 20,
    gap: 24,
  },

  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },

  headlineGroup: { gap: 4 },
  headline: {
    fontFamily: Fonts.heading,
    fontSize: 32,
    color: Colors.ink900,
  },
  subheadline: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink500,
  },

  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
  },

  buttonStack: { gap: 12 },

  // OAuth buttons
  oauthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#747775',
    borderRadius: 999,
    paddingVertical: 15,
    minHeight: 52,
    backgroundColor: '#FFFFFF',
  },
  oauthBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#1F1F1F' },

  // AppleAuthenticationButton must not get backgroundColor/borderRadius via
  // style (Apple's own docs: silently ignored and against guidelines) — use
  // buttonStyle/cornerRadius on the component instead. It also has no
  // intrinsic size, so an explicit height is required or it won't appear.
  appleBtnNative: { width: '100%', height: 52 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.ink100 },
  dividerText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink300 },

  emailOutlineBtn: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingVertical: 15,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emailOutlineBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.ink900 },

  createAccountBtn: { alignItems: 'center', paddingVertical: 4 },
  createAccountText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500 },
  createAccountTextBold: { fontFamily: Fonts.bodySemi, color: Colors.green700 },

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
  },
  emailBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },

  successCard: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  successDesc: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink500, lineHeight: 22 },
  successEmail: { fontFamily: Fonts.bodyBold, color: Colors.ink900 },

  consentWrap: { paddingTop: 4 },
  consentNotice: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.ink400,
    lineHeight: 18,
    textAlign: 'center',
  },
  consentLink: {
    fontFamily: Fonts.bodyMed,
    color: Colors.green700,
    textDecorationLine: 'underline',
  },
  devBtn: { alignItems: 'center', padding: 10 },
  devBtnText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink300, textDecorationLine: 'underline' },
})
