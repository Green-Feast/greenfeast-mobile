import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useOnboardingStore } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

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
  const [errors, setErrors] = useState<Record<string, string>>({})

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
    const resolvedLabel = label || type.charAt(0).toUpperCase() + type.slice(1)
    setAddress({
      addressLine1: line1.trim(),
      addressLandmark: landmark.trim(),
      addressPincode: pincode,
      addressLabel: resolvedLabel,
      addressType: type,
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
    setType(t)
    setLabel(t.charAt(0).toUpperCase() + t.slice(1))
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <SectionProgress current={4} />
        <View style={styles.header}>
          <Text style={styles.title}>Where do we deliver?</Text>
          <Text style={styles.subtitle}>We currently deliver across Jaipur.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Street address</Text>
          <TextInput
            style={[styles.input, errors.line1 && styles.inputError]}
            placeholder="Enter your street address"
            value={line1}
            onChangeText={(t) => { setLine1(t); setErrors((e) => ({ ...e, line1: '' })) }}
            placeholderTextColor={Colors.textLight}
          />
          {errors.line1 ? <Text style={styles.error}>{errors.line1}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Pincode</Text>
          <TextInput
            style={[styles.input, errors.pincode && styles.inputError]}
            placeholder="6-digit pincode"
            keyboardType="number-pad"
            maxLength={6}
            value={pincode}
            onChangeText={(t) => { setPincode(t.replace(/\D/g, '')); setErrors((e) => ({ ...e, pincode: '' })) }}
            placeholderTextColor={Colors.textLight}
          />
          {errors.pincode ? <Text style={styles.error}>{errors.pincode}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Landmark <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Near the blue gate"
            value={landmark}
            onChangeText={setLandmark}
            placeholderTextColor={Colors.textLight}
            maxLength={100}
          />
        </View>

        {/* Address type */}
        <View style={styles.field}>
          <Text style={styles.label}>Address type</Text>
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
          <Text style={styles.label}>Label <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Home, Mom's Place"
            value={label}
            onChangeText={setLabel}
            placeholderTextColor={Colors.textLight}
            maxLength={40}
          />
        </View>

        <Button onPress={handleNext} style={{ marginTop: 8 }}>Review order →</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 24 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  field: { marginBottom: 16 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, marginBottom: 8 },
  optional: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.text,
  },
  inputError: { borderColor: Colors.danger },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 4 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  typeBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  typeBtnTextActive: { color: Colors.primary },
})
