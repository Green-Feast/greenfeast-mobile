import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useOnboardingStore } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'
import LocationPicker, { type LatLng } from '@/components/LocationPicker'
import { usePlacesAutocomplete, PredictionsDropdown } from '@/components/PlacesAutocomplete'
import { KeyboardAwareScreen, useAutoFocus } from '@/components/keyboard'

const ADDRESS_TYPES = [
  { id: 'home', label: '🏠 Home' },
  { id: 'office', label: '🏢 Office' },
  { id: 'other', label: '📍 Other' },
] as const

export default function AddressScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setAddress } = useOnboardingStore()
  const { user } = useAuthStore()

  const [line1, setLine1] = useState('')
  const [pincode, setPincode] = useState('')
  const [landmark, setLandmark] = useState('')
  const [type, setType] = useState<'home' | 'office' | 'other'>('home')
  const [label, setLabel] = useState('Home')
  const [pin, setPin] = useState<LatLng | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [focused, setFocused] = useState<string | null>(null)
  const line1Ref = useAutoFocus()

  const autocomplete = usePlacesAutocomplete((sel) => {
    setLine1(sel.description)
    setErrors((e) => ({ ...e, line1: '' }))
    if (sel.pincode && /^\d{6}$/.test(sel.pincode)) {
      setPincode(sel.pincode)
      setErrors((e) => ({ ...e, pincode: '' }))
    }
    if (sel.lat != null && sel.lng != null) setPin({ lat: sel.lat, lng: sel.lng })
  })

  function validate() {
    const e: Record<string, string> = {}
    if (!line1.trim() || line1.trim().length < 5) e.line1 = 'Enter a valid street address'
    if (!/^\d{6}$/.test(pincode)) e.pincode = 'Pincode must be exactly 6 digits'
    return e
  }

  function handleNext() {
    const e = validate()
    if (Object.keys(e).length > 0) {
      setErrors(e)
      return
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const resolvedLabel = label || type.charAt(0).toUpperCase() + type.slice(1)
    setAddress({
      addressLine1: line1.trim(),
      addressLandmark: landmark.trim(),
      addressPincode: pincode,
      addressLabel: resolvedLabel,
      addressType: type,
      addressLat: pin?.lat ?? null,
      addressLng: pin?.lng ?? null,
    })
    // Incremental save: update existing default address if one exists, otherwise insert.
    // payment.tsx will do the same check so no duplicate is created.
    if (user) {
      const fields = {
        user_id: user.id,
        label: resolvedLabel,
        type,
        line1: line1.trim(),
        city: 'Jaipur',
        pincode,
        landmark: landmark.trim() || null,
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        is_default: true,
      }
      ;(async () => {
        const { data: existing } = await supabase
          .from('addresses').select('id').eq('user_id', user.id).eq('is_default', true).maybeSingle()
        if (existing) {
          await supabase.from('addresses').update(fields).eq('id', existing.id)
        } else {
          await supabase.from('addresses').insert(fields)
        }
      })().catch(() => {})
    }
    router.push('/(onboarding)/summary')
  }

  function changeType(t: typeof type) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setType(t)
    setLabel(t.charAt(0).toUpperCase() + t.slice(1))
  }

  return (
    <View style={styles.container}>
      {/* Fixed header — progress bar must not scroll with the page */}
      <View style={{ paddingHorizontal: 24, paddingTop: insets.top + 24 }}>
        <SectionProgress current={4} sectionStep={1} sectionTotalSteps={3} />
      </View>
      <KeyboardAwareScreen
        contentContainerStyle={[styles.scroll, { paddingTop: 0, paddingBottom: 40 + insets.bottom }]}
      >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>DELIVERY</Text>
        <Text style={styles.title}>Where do we deliver?</Text>
        <Text style={styles.subtitle}>We currently deliver across Jaipur.</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>STREET ADDRESS</Text>
        <TextInput
          ref={line1Ref}
          style={[
            styles.input,
            focused === 'line1' && styles.inputFocused,
            !!errors.line1 && styles.inputError,
          ]}
          placeholder="Enter your street address"
          value={line1}
          onChangeText={(t) => {
            setLine1(t)
            setErrors((e) => ({ ...e, line1: '' }))
            autocomplete.onChangeText(t)
          }}
          onFocus={() => { setFocused('line1'); autocomplete.onFocus() }}
          onBlur={() => { setFocused(null); autocomplete.onBlur() }}
          placeholderTextColor={Colors.ink300}
        />
        <PredictionsDropdown
          predictions={autocomplete.predictions}
          visible={autocomplete.visible}
          onPick={autocomplete.selectPrediction}
        />
        {errors.line1 ? <Text style={styles.error}>{errors.line1}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>PINCODE</Text>
        <TextInput
          style={[
            styles.input,
            focused === 'pincode' && styles.inputFocused,
            !!errors.pincode && styles.inputError,
          ]}
          placeholder="6-digit pincode"
          keyboardType="number-pad"
          maxLength={6}
          value={pincode}
          onChangeText={(t) => { setPincode(t.replace(/\D/g, '')); setErrors((e) => ({ ...e, pincode: '' })) }}
          onFocus={() => setFocused('pincode')}
          onBlur={() => setFocused(null)}
          placeholderTextColor={Colors.ink300}
        />
        {errors.pincode ? <Text style={styles.error}>{errors.pincode}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>PIN YOUR LOCATION <Text style={styles.optional}>(optional)</Text></Text>
        <LocationPicker
          value={pin}
          onChange={setPin}
          onResolveAddress={({ line1: l1, pincode: pc }) => {
            if (l1) { setLine1(l1); setErrors((e) => ({ ...e, line1: '' })) }
            if (pc && /^\d{6}$/.test(pc)) { setPincode(pc); setErrors((e) => ({ ...e, pincode: '' })) }
          }}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>LANDMARK <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={[styles.input, focused === 'landmark' && styles.inputFocused]}
          placeholder="e.g. Near the blue gate"
          value={landmark}
          onChangeText={setLandmark}
          onFocus={() => setFocused('landmark')}
          onBlur={() => setFocused(null)}
          placeholderTextColor={Colors.ink300}
          maxLength={100}
        />
      </View>

      {/* Address type */}
      <View style={styles.field}>
        <Text style={styles.label}>ADDRESS TYPE</Text>
        <View style={styles.typeRow}>
          {ADDRESS_TYPES.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.typeBtn, type === t.id && styles.typeBtnActive]}
              onPress={() => changeType(t.id)}
            >
              <Text style={[styles.typeBtnText, type === t.id && styles.typeBtnTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>LABEL <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={[styles.input, focused === 'label' && styles.inputFocused]}
          placeholder="e.g. Home, Mom's Place"
          value={label}
          onChangeText={setLabel}
          onFocus={() => setFocused('label')}
          onBlur={() => setFocused(null)}
          placeholderTextColor={Colors.ink300}
          maxLength={40}
        />
      </View>

      <Button onPress={handleNext} style={{ marginTop: 8 }}>Review order →</Button>
      </KeyboardAwareScreen>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 28 },
  eyebrow: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
  },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.ink900, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500 },
  field: { marginBottom: 20 },
  label: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  optional: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink400, textTransform: 'none', letterSpacing: 0 },
  input: {
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.ink900,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 0,
  },
  inputFocused: { borderBottomColor: Colors.green700 },
  inputError: { borderBottomColor: Colors.danger },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 6 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cream50,
    alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: Colors.green50, borderColor: Colors.green700 },
  typeBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.ink500 },
  typeBtnTextActive: { color: Colors.green700 },
})
