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
import SectionProgress from '@/components/SectionProgress'

// Allergens are safety-critical and shown as trust badges on the recommendation
// screen (stack-logic.txt §03). Detailed customisations are collected later, on
// the post-payment customise screen.
const ALLERGENS = ['Peanuts', 'Dairy', 'Quinoa', 'Soy', 'Nuts', 'Gluten', 'Lactose']
const DIETARY_PREFS = [
  { id: 'none', label: 'No restriction' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
] as const

export default function DietaryScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setDietaryBasics } = useOnboardingStore()

  const [allergens, setAllergens] = useState<string[]>([])
  const [dietaryPref, setDietaryPref] = useState<'none' | 'vegetarian' | 'vegan'>('none')
  const [freeText, setFreeText] = useState('')

  function toggleAllergen(val: string) {
    setAllergens((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]))
  }

  function handleNext() {
    setDietaryBasics({ allergens, dietaryPreference: dietaryPref, dietaryFreeText: freeText })
    router.push('/(onboarding)/loading')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <SectionProgress current={2} />
        <View style={styles.header}>
          <Text style={styles.title}>Allergies & diet</Text>
          <Text style={styles.subtitle}>We'll never put these in your meals.</Text>
        </View>

        {/* Allergens */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Allergies</Text>
          <Text style={styles.sectionSubtitle}>Select all that apply</Text>
          <View style={styles.pillRow}>
            {ALLERGENS.map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.pill, allergens.includes(opt) && styles.pillActive]}
                onPress={() => toggleAllergen(opt)}
              >
                <Text style={[styles.pillText, allergens.includes(opt) && styles.pillTextActive]}>
                  {opt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Dietary preference */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dietary preference</Text>
          <View style={styles.radioGroup}>
            {DIETARY_PREFS.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={styles.radioRow}
                onPress={() => setDietaryPref(opt.id)}
              >
                <View style={[styles.radio, dietaryPref === opt.id && styles.radioActive]}>
                  {dietaryPref === opt.id && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.radioLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Free text */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Any other allergies?</Text>
          <Text style={styles.sectionSubtitle}>Optional</Text>
          <TextInput
            style={styles.textarea}
            placeholder="e.g. Sesame, shellfish, specific intolerances"
            value={freeText}
            onChangeText={setFreeText}
            multiline
            numberOfLines={3}
            maxLength={250}
            placeholderTextColor={Colors.textLight}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{freeText.length}/250</Text>
        </View>

        <Button onPress={handleNext} style={{ marginTop: 8 }}>Next →</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 28 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  section: { marginBottom: 24 },
  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text, marginBottom: 4 },
  sectionSubtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 10 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  pillTextActive: { color: '#fff' },
  radioGroup: { gap: 10 },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  radioLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },
  textarea: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.text,
    minHeight: 80,
  },
  charCount: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textLight, textAlign: 'right', marginTop: 4 },
})
