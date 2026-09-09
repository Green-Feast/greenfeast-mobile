import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, TextInput } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'

// Reached only through the deep link in the password-reset email
// (greenfeast:///reset-password?code=...).
//
// This screen deliberately does NOT call exchangeCodeForSession itself. The
// root layout already runs an always-mounted Linking listener that exchanges
// any incoming ?code=, and a PKCE code is single-use — doing it here too
// means whichever call loses the race fails with an "already used" error.
// So we just wait for the session that exchange produces and then let the
// subscriber set a new password.
//
// The root layout's redirect effect also exempts this route explicitly:
// without that, the session arriving here would immediately bounce an
// onboarded user to the tabs before they could type anything.
const SESSION_WAIT_MS = 10000

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const session = useAuthStore((s) => s.session)

  const [status, setStatus] = useState<'waiting' | 'ready' | 'expired'>('waiting')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // The recovery session can arrive a moment after this screen mounts (the
  // exchange is a network round-trip), or be there already if the link was
  // opened while signed in.
  useEffect(() => {
    if (session) setStatus('ready')
  }, [session])

  // No session within the window means the link was already used, expired,
  // or opened on a different device from the one that requested it (PKCE
  // keeps the verifier on the requesting device).
  useEffect(() => {
    if (status !== 'waiting') return
    const timer = setTimeout(() => {
      setStatus((current) => (current === 'waiting' ? 'expired' : current))
    }, SESSION_WAIT_MS)
    return () => clearTimeout(timer)
  }, [status])

  async function handleSetPassword() {
    const trimmed = password.trim()
    if (trimmed.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: trimmed })
      if (updateError) throw updateError
      setDone(true)
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'waiting') {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color={Colors.green900} size="large" />
      </View>
    )
  }

  if (status === 'expired') {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <View style={styles.card}>
          <Text style={styles.headline}>Link expired</Text>
          <Text style={styles.desc}>
            This reset link is no longer valid. Links can only be used once, and must be opened on
            the same device you requested them from.
          </Text>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.replace('/(auth)/forgot-password' as any)}
          >
            <Text style={styles.primaryBtnText}>Request a new link</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (done) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <View style={styles.card}>
          <Text style={styles.headline}>Password updated</Text>
          <Text style={styles.desc}>You're signed in and ready to go.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(app)/(tabs)')}>
            <Text style={styles.primaryBtnText}>Continue</Text>
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
      <View style={[styles.content, { paddingTop: insets.top + 24 }]}>
        <View style={styles.headlineGroup}>
          <Text style={styles.headline}>Set a new password</Text>
          <Text style={styles.subheadline}>Choose a password with at least 8 characters.</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>NEW PASSWORD</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="Min 8 characters"
            placeholderTextColor={Colors.ink300}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            value={password}
            onChangeText={(t) => { setPassword(t); setError('') }}
            onSubmitEditing={handleSetPassword}
            returnKeyType="go"
            autoFocus
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSetPassword} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Update Password</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: 20, gap: 24 },
  card: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },

  headlineGroup: { gap: 4 },
  headline: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.ink900 },
  subheadline: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink500 },
  desc: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink500, lineHeight: 22 },

  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger },

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

  primaryBtn: {
    backgroundColor: Colors.green900,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  primaryBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
