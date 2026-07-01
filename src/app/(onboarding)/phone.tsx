import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import OnboardingProgress from '@/components/OnboardingProgress'
import { KeyboardAwareScreen, useAutoFocus } from '@/components/keyboard'

export default function OnboardingPhoneScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setPhone } = useAuthStore()
  const [phone, setPhoneInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useAutoFocus()

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
      router.replace('/(onboarding)/gate')
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAwareScreen
      style={styles.container}
      contentContainerStyle={[styles.inner, { paddingTop: insets.top + 16 }]}
      footerStyle={styles.footer}
      footer={
        <Button onPress={handleContinue} disabled={!isValid} loading={loading}>
          Continue →
        </Button>
      }
    >
      {/* Progress bar */}
      <OnboardingProgress steps={4} current={0} />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YOUR NUMBER</Text>
        <Text style={styles.title}>What's your{'\n'}WhatsApp number?</Text>
        <Text style={styles.subtitle}>We'll send your order updates here.</Text>
      </View>

      {/* Underline phone input */}
      <View style={styles.field}>
        <Text style={styles.label}>MOBILE NUMBER</Text>
        <View style={[styles.inputRow, focused && styles.inputRowFocused]}>
          <Text style={styles.prefix}>+91</Text>
          <View style={styles.prefixSeparator} />
          <TextInput
            ref={inputRef}
            style={styles.input}
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
            placeholderTextColor={Colors.ink300}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAwareScreen>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  inner: { flexGrow: 1, gap: 0 },
  footer: { paddingHorizontal: 20 },

  header: { paddingHorizontal: 20, marginTop: 32, marginBottom: 40 },
  eyebrow: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 36,
    color: Colors.ink900,
    lineHeight: 42,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink500,
    lineHeight: 22,
  },

  field: { paddingHorizontal: 20 },
  label: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
    gap: 12,
  },
  inputRowFocused: {
    borderBottomColor: Colors.green700,
  },
  prefix: {
    fontFamily: Fonts.bodyMed,
    fontSize: 22,
    color: Colors.ink500,
  },
  prefixSeparator: {
    width: 1,
    height: 22,
    backgroundColor: Colors.border,
  },
  input: {
    flex: 1,
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: Colors.ink900,
    letterSpacing: 2,
    padding: 0,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginTop: 8,
  },
})
