import { useState, useRef } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors } from '@/constants/colors'

export default function OTPScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>()
  const router = useRouter()
  const { setSession } = useAuthStore()
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleVerify() {
    if (otp.length !== 6) return
    setLoading(true)
    setError('')

    const { data, error } = await supabase.functions.invoke('verify-otp', {
      body: { phone, otp },
    })

    if (error || !data?.session) {
      setError('Incorrect OTP. Please try again.')
      setLoading(false)
      return
    }

    await supabase.auth.setSession(data.session)
    setSession(data.session)
    setLoading(false)
    // Root layout's auth gate will redirect to (app) automatically
  }

  async function handleResend() {
    await supabase.functions.invoke('send-otp', { body: { phone } })
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>Enter OTP</Text>
          <Text style={styles.subtitle}>
            Sent to {phone}
          </Text>
        </View>

        <TextInput
          style={styles.otpInput}
          placeholder="• • • • • •"
          keyboardType="number-pad"
          maxLength={6}
          value={otp}
          onChangeText={(t) => {
            setOtp(t.replace(/\D/g, ''))
            setError('')
          }}
          textAlign="center"
          placeholderTextColor={Colors.textLight}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, (otp.length !== 6 || loading) && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={otp.length !== 6 || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Verify OTP →</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.resend} onPress={handleResend}>
          <Text style={styles.resendText}>Didn't receive it? Resend OTP</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, padding: 24, paddingTop: 60 },
  back: { marginBottom: 32 },
  backText: { fontSize: 16, color: Colors.primary, fontWeight: '600' },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textMuted },
  otpInput: {
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 20,
    fontSize: 32,
    letterSpacing: 12,
    color: Colors.text,
    marginBottom: 8,
  },
  error: { fontSize: 13, color: Colors.danger, marginBottom: 16, textAlign: 'center' },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resend: { alignItems: 'center' },
  resendText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
})
