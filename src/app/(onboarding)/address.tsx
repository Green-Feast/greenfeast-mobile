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
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'

const ADDRESS_TYPES = [
  { id: 'home', label: '🏠 Home' },
  { id: 'office', label: '🏢 Office' },
  { id: 'other', label: '📍 Other' },
] as const

export default function AddressScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setAddress } = useOnboardingStore()

  const [line1, setLine1] = useState('')
  const [pincode, setPincode] = useState('')
  const [landmark, setLandmark] = useState('')
  const [type, setType] = useState<'home' | 'office' | 'other'>('home')
  const [label, setLabel] = useState('Home')
  const [mealsLunch, setMealsLunch] = useState(1)
  const [mealsDinner, setMealsDinner] = useState(0)
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
    setAddress({
      addressLine1: line1.trim(),
      addressLandmark: landmark.trim(),
      addressPincode: pincode,
      addressLabel: label || type.charAt(0).toUpperCase() + type.slice(1),
      addressType: type,
      mealsLunch,
      mealsDinner,
    })
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
        <View style={styles.header}>
          <Text style={styles.step}>Step 6 of 6</Text>
          <Text style={styles.title}>Where and when?</Text>
        </View>

        {/* Address section */}
        <Text style={styles.sectionTitle}>Delivery address</Text>

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

        {/* Meal slots */}
        <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Meals per delivery day</Text>
        <Text style={styles.slotHint}>
          How would you like your meals split between lunch and dinner?
        </Text>

        <View style={styles.slotRow}>
          <SlotCounter
            icon="☀️"
            label="Lunch"
            value={mealsLunch}
            onDecrement={() => setMealsLunch((v) => Math.max(0, v - 1))}
            onIncrement={() => setMealsLunch((v) => v + 1)}
          />
          <SlotCounter
            icon="🌙"
            label="Dinner"
            value={mealsDinner}
            onDecrement={() => setMealsDinner((v) => Math.max(0, v - 1))}
            onIncrement={() => setMealsDinner((v) => v + 1)}
          />
        </View>

        <Button onPress={handleNext}>Review order →</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function SlotCounter({
  icon,
  label,
  value,
  onDecrement,
  onIncrement,
}: {
  icon: string
  label: string
  value: number
  onDecrement: () => void
  onIncrement: () => void
}) {
  return (
    <View style={styles.slotCard}>
      <Text style={styles.slotIcon}>{icon}</Text>
      <Text style={styles.slotLabel}>{label}</Text>
      <View style={styles.counter}>
        <TouchableOpacity style={styles.counterBtn} onPress={onDecrement}>
          <Text style={styles.counterBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.counterValue}>{value}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={onIncrement}>
          <Text style={styles.counterBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 24 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text },
  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text, marginBottom: 14 },
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
  slotHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 16, lineHeight: 18 },
  slotRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  slotCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 8,
  },
  slotIcon: { fontSize: 28 },
  slotLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  counterBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnText: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.primary },
  counterValue: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.text, minWidth: 30, textAlign: 'center' },
})
