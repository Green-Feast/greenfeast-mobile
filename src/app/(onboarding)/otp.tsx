import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { OTPWidget } from '@/lib/otp'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import { SHOW_DEV_SKIP } from '@/constants/dev'
import Button from '@/components/Button'

export default function OnboardingOTPScreen() {
  const { phone, reqId } = useLocalSearchParams<{ phone: string; reqId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setPhone } = useAuthStore()
  const [otp, setOtp] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleVerify() {
    if (otp.length !== 6) return
    setLoading(true)
    setError('')
    try {
      const response = await OTPWidget.verifyOTP({ reqId, otp })
      if (response?.type === 'success') {
        const { data: { user } } = await supabase.auth.getUser()
        await supabase.from('users').update({ phone }).eq('id', user!.id)
        setPhone(phone)
        router.replace('/(onboarding)/menu')
      } else {
        setError('Incorrect OTP. Please try again.')
      }
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    const msg91Phone = phone.replace('+', '')
    await OTPWidget.retryOTP({ reqId })
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.inner, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.step}>Verification</Text>
        <Text style={styles.title}>Enter OTP</Text>
        <Text style={styles.subtitle}>OTP sent to {phone}</Text>

        <TextInput
          style={[styles.otpInput, focused && styles.otpInputFocused]}
          placeholder="••••••"
          keyboardType="number-pad"
          maxLength={6}
          value={otp}
          onChangeText={(t) => {
            setOtp(t.replace(/\D/g, ''))
            setError('')
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          textAlign="center"
          placeholderTextColor={Colors.textLight}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoFocus
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.resend} onPress={handleResend} hitSlop={8}>
          <Text style={styles.resendText}>Didn't receive it? Resend OTP</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <Button onPress={handleVerify} disabled={otp.length !== 6} loading={loading}>
          Verify →
        </Button>

        {SHOW_DEV_SKIP && (
          <TouchableOpacity
            style={styles.devBtn}
            onPress={async () => {
              const { data: { user } } = await supabase.auth.getUser()
              await supabase.from('users').update({ phone }).eq('id', user!.id)
              setPhone(phone)
              router.replace('/(onboarding)/menu')
            }}
          >
            <Text style={styles.devBtnText}>Dev: Skip OTP</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, paddingHorizontal: 24, paddingBottom: 32 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginBottom: 8 },
  subtitle: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted, marginBottom: 28 },
  otpInput: {
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 16,
    paddingVertical: 18,
    fontFamily: Fonts.heading,
    fontSize: 30,
    letterSpacing: 14,
    color: Colors.text,
    backgroundColor: '#fff',
  },
  otpInputFocused: { borderColor: Colors.primary },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 12, textAlign: 'center' },
  resend: { alignItems: 'center', marginTop: 20 },
  resendText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.primary },
  devBtn: { marginTop: 16, alignItems: 'center', padding: 10 },
  devBtnText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textLight, textDecorationLine: 'underline' },
})
