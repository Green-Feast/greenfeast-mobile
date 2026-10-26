// "Have a coupon code?" — on the onboarding payment screen and the Renew sheet
// (never for wallet top-ups). Offers made for this customer show as tap-to-
// apply chips. The applied coupon is re-checked whenever the plan or add-ons
// change, and the server checks it again when the payment starts.
import { useEffect, useRef, useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Tag, X, CheckCircle2 } from 'lucide-react-native'
import { previewCoupon, fetchCouponOffers, couponRupees, type CouponOffer, type CouponQuote } from '@/lib/coupons'
import { Colors, Fonts } from '@/constants/colors'

export default function CouponField({
  planId,
  addonIds,
  applied,
  onChange,
  disabled,
}: {
  planId: string
  addonIds: string[]
  applied: CouponQuote | null
  onChange: (quote: CouponQuote | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [offers, setOffers] = useState<CouponOffer[]>([])

  useEffect(() => {
    fetchCouponOffers().then(setOffers).catch(() => {})
  }, [])

  // The plan or add-ons changed: re-price the applied code (or drop it).
  const addonKey = addonIds.slice().sort().join(',')
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    if (!applied) return
    let cancelled = false
    previewCoupon(applied.code, planId, addonIds).then((res) => {
      if (cancelled) return
      if (res.ok) onChange(res.quote)
      else {
        onChange(null)
        setError(res.error)
        setOpen(true)
      }
    })
    return () => { cancelled = true }
  }, [planId, addonKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function apply(raw: string) {
    const c = raw.trim()
    if (!c) return setError('Enter a code.')
    setChecking(true)
    setError('')
    const res = await previewCoupon(c, planId, addonIds)
    setChecking(false)
    if (!res.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {})
      return setError(res.error)
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    onChange(res.quote)
    setCode('')
    setOpen(false)
  }

  const planOffers = offers.filter((o) => o.plans[planId] && o.code !== applied?.code)

  if (applied) {
    return (
      <View style={st.applied}>
        <CheckCircle2 size={18} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={st.appliedTitle}>{applied.code} applied</Text>
          <Text style={st.appliedSub}>
            {couponRupees(applied.mealPrice)} per meal instead of {couponRupees(applied.regularMealPrice)} · You save {couponRupees(applied.discount)}
          </Text>
        </View>
        {!disabled && (
          <Pressable onPress={() => { onChange(null); setError('') }} hitSlop={10} accessibilityLabel="Remove coupon">
            <X size={18} color={Colors.textMuted} />
          </Pressable>
        )}
      </View>
    )
  }

  return (
    <View style={st.wrap}>
      {planOffers.length > 0 && (
        <View style={st.offers}>
          <Text style={st.offersLabel}>An offer for you</Text>
          {planOffers.map((o) => (
            <Pressable
              key={o.code}
              disabled={disabled || checking}
              onPress={() => apply(o.code)}
              style={({ pressed }) => [st.offer, pressed && { opacity: 0.8 }]}
            >
              <Tag size={14} color={Colors.primary} />
              <Text style={st.offerText}>
                {o.code} · {couponRupees(o.plans[planId])} per meal
              </Text>
              <Text style={st.offerApply}>Apply</Text>
            </Pressable>
          ))}
        </View>
      )}

      {open ? (
        <View style={st.inputRow}>
          <TextInput
            value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); setError('') }}
            placeholder="Coupon code"
            placeholderTextColor={Colors.textLight}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            editable={!disabled && !checking}
            onSubmitEditing={() => apply(code)}
            returnKeyType="done"
            style={st.input}
          />
          <Pressable
            onPress={() => apply(code)}
            disabled={disabled || checking}
            style={({ pressed }) => [st.applyBtn, (pressed || checking) && { opacity: 0.8 }]}
          >
            {checking ? <ActivityIndicator size="small" color="#fff" /> : <Text style={st.applyText}>Apply</Text>}
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setOpen(true)} disabled={disabled} hitSlop={6} style={st.toggle}>
          <Tag size={15} color={Colors.primary} />
          <Text style={st.toggleText}>Have a coupon code?</Text>
        </Pressable>
      )}
      {!!error && <Text style={st.error}>{error}</Text>}
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 8 },
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
  offers: { marginBottom: 8, gap: 6 },
  offersLabel: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1.5 },
  offer: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.primary, backgroundColor: Colors.green50,
  },
  offerText: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text },
  offerApply: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.primary },
  applied: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginTop: 4, marginBottom: 8,
    borderRadius: 14, backgroundColor: Colors.green50, borderWidth: 1, borderColor: Colors.green200,
  },
  appliedTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.primary },
  appliedSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink600, marginTop: 2, lineHeight: 17 },
})
