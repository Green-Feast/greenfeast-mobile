import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Check } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { LEGAL_LAST_UPDATED } from '@/constants/legal'
import Button from '@/components/Button'
import OnboardingProgress from '@/components/OnboardingProgress'
import { KeyboardAwareScreen, useAutoFocus } from '@/components/keyboard'

export default function OnboardingNameScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [agreed, setAgreed] = useState(false)
  const inputRef = useAutoFocus()

  const isValid = name.trim().length >= 2 && agreed

  // Pre-fill from OAuth profile on mount
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      const meta = user?.user_metadata
      if (meta?.full_name) setName(meta.full_name)
      else if (meta?.name) setName(meta.name)
    })
  }, [])

  async function handleContinue() {
    if (!isValid) return
    setLoading(true)
    setError('')

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      await supabase.auth.signOut()
      router.replace('/(auth)/login' as any)
      return
    }
    const { error: updateError } = await supabase
      .from('users')
      .update({
        name: name.trim(),
        terms_accepted_at: new Date().toISOString(),
        terms_version: LEGAL_LAST_UPDATED,
      })
      .eq('id', user.id)

    if (updateError) {
      setError(updateError.message)
      setLoading(false)
      return
    }
    router.push('/(onboarding)/phone')
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
        <Text style={styles.eyebrow}>YOU</Text>
        <Text style={styles.title}>What should we{'\n'}call you?</Text>
        <Text style={styles.subtitle}>So we can make this feel like yours.</Text>
      </View>

      {/* Underline input */}
      <View style={styles.field}>
        <Text style={styles.label}>YOUR NAME</Text>
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            focused && styles.inputFocused,
            !!error && styles.inputError,
          ]}
          placeholder="Enter your full name"
          value={name}
          onChangeText={(t) => {
            setName(t)
            setError('')
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor={Colors.ink300}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      {/* Terms & Privacy consent */}
      <View style={styles.consentRow}>
        <Pressable
          style={[styles.checkbox, agreed && styles.checkboxChecked]}
          onPress={() => setAgreed((v) => !v)}
          hitSlop={8}
        >
          {agreed && <Check size={14} color="#fff" strokeWidth={3} />}
        </Pressable>
        <Text style={styles.consentText} onPress={() => setAgreed((v) => !v)}>
          I agree to the{' '}
          <Text style={styles.consentLink} onPress={() => router.push('/legal/terms' as any)}>
            Terms & Conditions
          </Text>
          {' '}and{' '}
          <Text style={styles.consentLink} onPress={() => router.push('/legal/privacy' as any)}>
            Privacy Policy
          </Text>
        </Text>
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

  field: {
    paddingHorizontal: 20,
  },
  label: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  input: {
    fontFamily: Fonts.heading,
    fontSize: 24,
    color: Colors.ink900,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  inputFocused: {
    borderBottomColor: Colors.green700,
  },
  inputError: {
    borderBottomColor: Colors.danger,
  },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginTop: 8,
  },

  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 24,
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
})
