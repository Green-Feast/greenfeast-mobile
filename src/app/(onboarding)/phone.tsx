import { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import { KeyboardAwareScreen, useAutoFocus } from '@/components/keyboard'
import { warmFunctions } from '@/lib/warmFunctions'

const IN_USE = 'This number is already in use. Use another number, or sign in with the account it belongs to.'

type OtpReply = { ok: boolean; enabled?: boolean; error?: string; message?: string; resend_in?: number }

// WhatsApp OTP (phone-otp edge function, migration 061). Until WhatsApp is
// set up on the server it answers enabled: false and this screen saves the
// number straight away, as before.
async function otp(body: Record<string, unknown>): Promise<OtpReply> {
  const { data, error } = await supabase.functions.invoke('phone-otp', { body })
  if (error) {
    // A non-2xx still carries our { message } body.
    try {
      const parsed = await (error as { context?: Response }).context?.json()
      if (parsed?.message) return parsed as OtpReply
    } catch {}
    return { ok: false, error: 'network', message: 'No connection — check your internet and try again.' }
  }
  return data as OtpReply
}

export default function OnboardingPhoneScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setPhone } = useAuthStore()
  const [phone, setPhoneInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [inUse, setInUse] = useState(false)
  const inputRef = useAutoFocus()

  // WhatsApp code step
  const [otpEnabled, setOtpEnabled] = useState(false)
  const [step, setStep] = useState<'number' | 'code'>('number')
  const [code, setCode] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const codeRef = useRef<TextInput>(null)

  const isValid = phone.replace(/\D/g, '').length === 10

  useEffect(() => {
    warmFunctions(['phone-otp'])
    otp({ action: 'status' }).then((r) => setOtpEnabled(!!r.ok && !!r.enabled))
  }, [])

  // A number already on another account can't be used again — say so as
  // soon as all 10 digits are typed.
  useEffect(() => {
    setInUse(false)
    if (phone.length !== 10) return
    let cancelled = false
    supabase.rpc('phone_in_use', { p_phone: '+91' + phone }).then(({ data }) => {
      if (cancelled || !data) return
      setInUse(true)
      setError(IN_USE)
    })
    return () => { cancelled = true }
  }, [phone])

  // Resend countdown
  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  function finish(cleanPhone: string) {
    setPhone(cleanPhone)
    router.replace('/(onboarding)/gate')
  }

  async function saveWithoutCode() {
    const cleanPhone = '+91' + phone.replace(/\D/g, '')
    const { data: { user } } = await supabase.auth.getUser()
    const { error: saveErr } = await supabase.from('users').update({ phone: cleanPhone }).eq('id', user!.id)
    // The save used to be fire-and-forget: when it failed (most often the
    // number already belongs to another account — phone is unique), the app
    // carried on as if it had saved, and asked again on every launch.
    if (saveErr) {
      if (saveErr.code === '23505') setInUse(true)
      setError(saveErr.code === '23505' ? IN_USE : 'Could not save your number. Please try again.')
      return
    }
    finish(cleanPhone)
  }

  async function sendCode() {
    const r = await otp({ action: 'send', phone })
    if (!r.ok) {
      if (r.error === 'not_configured') {
        // Switched off on the server since this screen opened.
        setOtpEnabled(false)
        return saveWithoutCode()
      }
      if (r.error === 'in_use') setInUse(true)
      if (r.error === 'too_soon' && step === 'code') setResendIn(r.resend_in ?? 30)
      setError(r.message ?? 'Could not send the code. Please try again.')
      return
    }
    setStep('code')
    setCode('')
    setResendIn(r.resend_in ?? 30)
    setTimeout(() => codeRef.current?.focus(), 300)
  }

  async function verify(value = code) {
    if (value.length !== 6) return
    setLoading(true)
    setError('')
    try {
      const r = await otp({ action: 'verify', phone, code: value })
      if (!r.ok) {
        setError(r.message ?? 'That code isn’t right.')
        if (r.error === 'in_use') setInUse(true)
        return
      }
      finish('+91' + phone)
    } finally {
      setLoading(false)
    }
  }

  async function handleContinue() {
    if (step === 'code') return verify()
    if (!isValid) return
    setLoading(true)
    setError('')
    try {
      if (otpEnabled) await sendCode()
      else await saveWithoutCode()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function resend() {
    if (resendIn > 0 || loading) return
    setLoading(true)
    setError('')
    try {
      await sendCode()
    } finally {
      setLoading(false)
    }
  }

  const footerLabel = step === 'code' ? 'Verify →' : otpEnabled ? 'Send code on WhatsApp →' : 'Continue →'
  const footerDisabled = step === 'code' ? code.length !== 6 : !isValid || inUse

  return (
    <KeyboardAwareScreen
      style={styles.container}
      contentContainerStyle={[styles.inner, { paddingTop: insets.top + 16 }]}
      footerStyle={styles.footer}
      footer={
        <Button onPress={handleContinue} disabled={footerDisabled} loading={loading}>
          {footerLabel}
        </Button>
      }
    >
      {step === 'number' ? (
        <>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>YOUR NUMBER</Text>
            <Text style={styles.title}>What's your{'\n'}WhatsApp number?</Text>
            <Text style={styles.subtitle}>
              {otpEnabled
                ? "We'll send a code on WhatsApp to confirm it, then your order updates here."
                : "We'll send your order updates here."}
            </Text>
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
        </>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.eyebrow}>CONFIRM YOUR NUMBER</Text>
            <Text style={styles.title}>Enter the code{'\n'}from WhatsApp</Text>
            <Text style={styles.subtitle}>We sent a 6-digit code to +91 {phone.slice(0, 5)} {phone.slice(5)} on WhatsApp.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>CODE</Text>
            <View style={[styles.inputRow, styles.inputRowFocused]}>
              <TextInput
                ref={codeRef}
                style={[styles.input, styles.codeInput]}
                placeholder="••••••"
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChangeText={(t) => {
                  const v = t.replace(/\D/g, '').slice(0, 6)
                  setCode(v)
                  setError('')
                  if (v.length === 6) verify(v)
                }}
                placeholderTextColor={Colors.ink300}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.links}>
              <Pressable onPress={resend} disabled={resendIn > 0 || loading} hitSlop={8}>
                <Text style={[styles.link, (resendIn > 0 || loading) && styles.linkOff]}>
                  {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setStep('number'); setCode(''); setError('') }}
                hitSlop={8}
              >
                <Text style={styles.link}>Change number</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
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
  codeInput: { letterSpacing: 10, fontSize: 28 },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.danger,
    marginTop: 8,
  },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 20 },
  link: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.green700 },
  linkOff: { color: Colors.ink400 },
})
