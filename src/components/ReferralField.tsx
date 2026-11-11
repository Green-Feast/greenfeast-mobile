// "Joining through a friend?" — onboarding's payment screen (081). The friend's
// referral code is their customer code (GF-000123). It doesn't change the
// price: once this first plan (15 meals or more) starts, both get a free meal
// in their wallet. Checked here with preview_referral, again by
// cashfree-create-order, and once more when the plan starts.
import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Users, X, CheckCircle2 } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'

export type ReferralApplied = { code: string; referrerName: string }

export default function ReferralField({
  planId,
  applied,
  onChange,
  disabled,
}: {
  planId: string
  applied: ReferralApplied | null
  onChange: (r: ReferralApplied | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  async function check(raw: string): Promise<ReferralApplied | string> {
    const { data, error: rpcErr } = await supabase.rpc('preview_referral', { p_code: raw, p_plan: planId })
    if (rpcErr) return 'Could not check that code. Please try again.'
    const r = data as { ok: boolean; code?: string; referrer_name?: string; error?: string } | null
    if (!r?.ok) return r?.error ?? "That code isn't valid."
    return { code: r.code!, referrerName: r.referrer_name ?? 'your friend' }
  }

  // A different plan size may not qualify (the 5-meal trial doesn't).
  useEffect(() => {
    if (!applied) return
    let cancelled = false
    check(applied.code).then((res) => {
      if (cancelled || typeof res !== 'string') return
      onChange(null)
      setError(res)
      setOpen(true)
    })
    return () => { cancelled = true }
  }, [planId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function apply() {
    const c = code.trim()
    if (!c) return setError('Enter your friend\'s code.')
    setChecking(true)
    setError('')
    const res = await check(c)
    setChecking(false)
    if (typeof res === 'string') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      return setError(res)
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    onChange(res)
    setCode('')
    setOpen(false)
  }

  if (applied) {
    return (
      <View style={st.applied}>
        <CheckCircle2 size={18} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={st.appliedTitle}>{`Joining with ${applied.referrerName}'s code`}</Text>
          <Text style={st.appliedSub}>{applied.referrerName} earns free meals for referring you once your plan starts.</Text>
        </View>
        {!disabled && (
          <Pressable onPress={() => { onChange(null); setError('') }} hitSlop={10} accessibilityLabel="Remove referral code">
            <X size={18} color={Colors.textMuted} />
          </Pressable>
        )}
      </View>
    )
  }

  return (
    <View style={st.wrap}>
      {open ? (
        <View style={st.inputRow}>
          <TextInput
            value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); setError('') }}
            placeholder="Friend's code, e.g. GF-000123"
            placeholderTextColor={Colors.textLight}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            editable={!disabled && !checking}
            onSubmitEditing={apply}
            returnKeyType="done"
            style={st.input}
          />
          <Pressable
            onPress={apply}
            disabled={disabled || checking}
            style={({ pressed }) => [st.applyBtn, (pressed || checking) && { opacity: 0.8 }]}
          >
            {checking ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.applyText}>Apply</Text>}
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} disabled={disabled} hitSlop={6} style={st.toggle}>
          <Users size={15} color={Colors.primary} />
          <Text style={st.toggleText}>Joining through a friend?</Text>
        </Pressable>
      )}
      {!!error && <Text style={st.error}>{error}</Text>}
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { marginTop: 0, marginBottom: 8 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  toggleText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  input: {
    flex: 1, fontFamily: Fonts.bodySemi, fontSize: 15, letterSpacing: 1, color: Colors.text,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: '#fff',
  },
  applyBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', minWidth: 84 },
  applyText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: '#fff' },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 6 },
  applied: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginTop: 4, marginBottom: 8,
    borderRadius: 14, backgroundColor: Colors.green50, borderWidth: 1, borderColor: Colors.green200,
  },
  appliedTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.primary },
  appliedSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink600, marginTop: 2, lineHeight: 17 },
})
