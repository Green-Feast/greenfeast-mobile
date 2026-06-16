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

const ALLERGENS = ['Peanuts', 'Shellfish', 'Dairy', 'Sesame', 'Soy', 'Nuts', 'Gluten', 'Egg']
const DIETARY_PREFS = [
  { id: 'none', label: 'No restriction' },
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
] as const

const PROTEINS = ['Paneer', 'Tofu']
const BASES = ['Quinoa', 'Couscous', 'Rice', 'Pasta', 'Soba noodles']
const VEGGIES = ['Bell pepper', 'Mushroom', 'Broccoli', 'Onion']
const SPICES = ['Mild', 'Medium', 'Spicy'] as const
const DRESSINGS = ['Mixed in', 'On the side'] as const

function MultiPill({
  options,
  selected,
  onToggle,
}: {
  options: string[]
  selected: string[]
  onToggle: (val: string) => void
}) {
  return (
    <View style={styles.pillRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          style={[styles.pill, selected.includes(opt) && styles.pillActive]}
          onPress={() => onToggle(opt)}
        >
          <Text style={[styles.pillText, selected.includes(opt) && styles.pillTextActive]}>
            {opt}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

function RadioRow({
  options,
  selected,
  onSelect,
}: {
  options: readonly string[]
  selected: string
  onSelect: (val: string) => void
}) {
  return (
    <View style={styles.radioGroup}>
      {options.map((opt) => (
        <TouchableOpacity key={opt} style={styles.radioRow} onPress={() => onSelect(opt)}>
          <View style={[styles.radio, selected === opt && styles.radioActive]}>
            {selected === opt && <View style={styles.radioDot} />}
          </View>
          <Text style={styles.radioLabel}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export default function DietaryScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setDietary } = useOnboardingStore()

  const [allergens, setAllergens] = useState<string[]>([])
  const [dietaryPref, setDietaryPref] = useState<'none' | 'vegetarian' | 'vegan'>('none')
  const [proteinPref, setProteinPref] = useState<string[]>([])
  const [baseAvoidance, setBaseAvoidance] = useState<string[]>([])
  const [veggieAvoidance, setVeggieAvoidance] = useState<string[]>([])
  const [spice, setSpice] = useState<'Mild' | 'Medium' | 'Spicy' | ''>('')
  const [dressing, setDressing] = useState<'Mixed in' | 'On the side' | ''>('')
  const [freeText, setFreeText] = useState('')

  function toggle(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
  }

  function handleNext() {
    setDietary({
      allergens,
      dietaryPreference: dietaryPref,
      proteinPreference: proteinPref,
      baseAvoidance,
      veggieAvoidance,
      spicePreference: spice.toLowerCase() as any,
      dressingPreference: dressing === 'Mixed in' ? 'mixed-in' : dressing === 'On the side' ? 'on-the-side' : '',
      dietaryFreeText: freeText,
    })
    router.push('/(onboarding)/loading')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.step}>Step 3 of 6</Text>
          <Text style={styles.title}>Dietary preferences</Text>
          <Text style={styles.subtitle}>We'll customise your meals around these.</Text>
        </View>

        {/* Allergens */}
        <Section title="Allergies" subtitle="Select all that apply">
          <MultiPill
            options={ALLERGENS}
            selected={allergens}
            onToggle={(v) => toggle(allergens, v, setAllergens)}
          />
        </Section>

        {/* Dietary preference */}
        <Section title="Dietary preference">
          <View style={styles.radioGroup}>
            {DIETARY_PREFS.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={styles.radioRow}
                onPress={() => setDietaryPref(opt.id as any)}
              >
                <View style={[styles.radio, dietaryPref === opt.id && styles.radioActive]}>
                  {dietaryPref === opt.id && <View style={styles.radioDot} />}
                </View>
                <Text style={styles.radioLabel}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Section>

        {/* Protein preference */}
        <Section title="Protein preference" subtitle="What proteins do you prefer?">
          <MultiPill
            options={PROTEINS}
            selected={proteinPref}
            onToggle={(v) => toggle(proteinPref, v, setProteinPref)}
          />
        </Section>

        {/* Base avoidance */}
        <Section title="Bases to avoid" subtitle="We'll leave these out of your bowls">
          <MultiPill
            options={BASES}
            selected={baseAvoidance}
            onToggle={(v) => toggle(baseAvoidance, v, setBaseAvoidance)}
          />
        </Section>

        {/* Veggie avoidance */}
        <Section title="Vegetables to skip">
          <MultiPill
            options={VEGGIES}
            selected={veggieAvoidance}
            onToggle={(v) => toggle(veggieAvoidance, v, setVeggieAvoidance)}
          />
        </Section>

        {/* Spice */}
        <Section title="Spice level">
          <RadioRow options={SPICES} selected={spice} onSelect={(v) => setSpice(v as any)} />
        </Section>

        {/* Dressing */}
        <Section title="Dressing">
          <RadioRow options={DRESSINGS} selected={dressing} onSelect={(v) => setDressing(v as any)} />
        </Section>

        {/* Free text */}
        <Section title="Anything else?" subtitle="Optional">
          <TextInput
            style={styles.textarea}
            placeholder="e.g. I'm gluten intolerant, love spicy food, avoid raw onion"
            value={freeText}
            onChangeText={setFreeText}
            multiline
            numberOfLines={3}
            maxLength={250}
            placeholderTextColor={Colors.textLight}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{freeText.length}/250</Text>
        </Section>

        <Button onPress={handleNext} style={{ marginTop: 8 }}>Next →</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 28 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
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
