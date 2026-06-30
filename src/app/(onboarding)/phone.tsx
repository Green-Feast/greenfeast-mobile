import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'

export default function OnboardingPhoneScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setPhone } = useAuthStore()
  const [phone, setPhoneInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isValid = phone.replace(/\D/g, '').length === 10

  async function handleContinue() {
    if (!isValid) return
    setLoading(true)
    setError('')
    const cleanPhone = '+91' + phone.replace(/\D/g, '')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('users').update({ phone: cleanPhone }).eq('id', user!.id)
      setPhone(cleanPhone)
      router.replace('/(onboarding)/menu')
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.inner, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.step}>Setup</Text>
        <Text style={styles.title}>Your WhatsApp number</Text>
        <Text style={styles.subtitle}>We'll send your order updates here on WhatsApp.</Text>

        <View style={styles.form}>
          <Text style={styles.label}>WhatsApp number</Text>
          <View style={styles.inputRow}>
            <View style={styles.countryCode}>
              <Text style={styles.countryCodeText}>+91</Text>
            </View>
            <TextInput
              style={[styles.input, focused && styles.inputFocused]}
              placeholder="98765 43210"
              keyboardType="phone-pad"
              maxLength={10}
              value={phone}
              onChangeText={(t) => {
                setPhoneInput(t.replace(/\D/g, ''))
                setError('')
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholderTextColor={Colors.textLight}
              autoFocus
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <View style={{ flex: 1 }} />

        <Button onPress={handleContinue} disabled={!isValid} loading={loading}>
          Continue →
        </Button>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  inner: { flex: 1, paddingHorizontal: 24, paddingBottom: 32 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginBottom: 8 },
  subtitle: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted, lineHeight: 22, marginBottom: 28 },
  form: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  label: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text, marginBottom: 10 },
  inputRow: { flexDirection: 'row', gap: 8 },
  countryCode: {
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    justifyContent: 'center',
  },
  countryCodeText: { fontFamily: Fonts.bodySemi, fontSize: 16, color: Colors.text },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: Fonts.body,
    fontSize: 17,
    letterSpacing: 2,
    color: Colors.text,
  },
  inputFocused: { borderColor: Colors.primary },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 10 },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 8 },
})
