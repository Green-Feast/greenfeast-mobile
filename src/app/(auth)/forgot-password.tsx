import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, TextInput } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { makeRedirectUri } from 'expo-auth-session'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function handleSend() {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Please enter your email.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const redirectTo = makeRedirectUri({ scheme: 'greenfeast', path: '/reset-password' })
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo })
      if (error) throw error
      setSent(true)
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
        <View style={styles.successCard}>
          <Text style={styles.headline}>Check your email</Text>
          <Text style={styles.successDesc}>
            We sent a password reset link to{'\n'}
            <Text style={styles.successEmail}>{email.trim()}</Text>
            {'\n\n'}Open it on this device to set a new password.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back to Sign In</Text>
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
      <View style={[styles.content, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <ChevronLeft size={22} color={Colors.ink900} />
        </TouchableOpacity>

        <View style={styles.headlineGroup}>
          <Text style={styles.headline}>Reset your password</Text>
          <Text style={styles.subheadline}>
            Enter the email on your account and we'll send you a reset link.
          </Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

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
            onSubmitEditing={handleSend}
            returnKeyType="go"
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleSend} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Send Reset Link</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  content: { flex: 1, paddingHorizontal: 20, gap: 24 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8 },

  headlineGroup: { gap: 4 },
  headline: { fontFamily: Fonts.heading, fontSize: 32, color: Colors.ink900 },
  subheadline: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink500 },

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

  successCard: { paddingHorizontal: 20, paddingTop: 24, gap: 16 },
  successDesc: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink500, lineHeight: 22 },
  successEmail: { fontFamily: Fonts.bodyBold, color: Colors.ink900 },
})
