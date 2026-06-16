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
import { useOnboardingStore, type HealthGoal } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'

const GOALS: { id: HealthGoal; label: string; icon: string }[] = [
  { id: 'build-muscle', label: 'Build Muscle', icon: '💪' },
  { id: 'lose-weight', label: 'Lose Weight', icon: '⚖️' },
  { id: 'improve-wellness', label: 'Improve Wellness', icon: '🌿' },
  { id: 'boost-energy', label: 'Boost Energy', icon: '⚡' },
]

const EXERCISE_TYPES = ['Gym', 'Running', 'Yoga', 'Other', 'None']

const FREQUENCIES = [
  'Daily',
  '3–4x per week',
  '1–2x per week',
  'Rarely or never',
]

export default function HealthScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setHealthProfile } = useOnboardingStore()

  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [goal, setGoal] = useState<HealthGoal | null>(null)
  const [exerciseType, setExerciseType] = useState<string[]>([])
  const [frequency, setFrequency] = useState('')
  const [occupation, setOccupation] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function toggleExercise(type: string) {
    if (type === 'None') {
      setExerciseType(['None'])
      return
    }
    setExerciseType((prev) => {
      const without = prev.filter((t) => t !== 'None')
      return without.includes(type)
        ? without.filter((t) => t !== type)
        : [...without, type]
    })
  }

  function validate() {
    const e: Record<string, string> = {}
    const h = parseInt(height)
    const w = parseInt(weight)
    if (!height || isNaN(h) || h < 120 || h > 250) e.height = 'Enter a valid height (120–250 cm)'
    if (!weight || isNaN(w) || w < 30 || w > 200) e.weight = 'Enter a valid weight (30–200 kg)'
    if (!goal) e.goal = 'Select a goal'
    if (exerciseType.length === 0) e.exercise = 'Select at least one option'
    if (!frequency) e.frequency = 'Select your exercise frequency'
    return e
  }

  function handleNext() {
    const e = validate()
    if (Object.keys(e).length > 0) {
      setErrors(e)
      return
    }
    setHealthProfile({
      height,
      weight,
      healthGoal: goal!,
      exerciseType,
      exerciseFrequency: frequency,
      occupation,
    })
    router.push('/(onboarding)/questionnaire')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.step}>Step 1 of 6</Text>
          <Text style={styles.title}>Tell us about yourself</Text>
          <Text style={styles.subtitle}>We'll use this to build your personalised plan.</Text>
        </View>

        {/* Height & Weight */}
        <View style={styles.row2}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Height (cm)</Text>
            <TextInput
              style={[styles.input, errors.height && styles.inputError]}
              placeholder="175"
              keyboardType="number-pad"
              value={height}
              onChangeText={(t) => { setHeight(t.replace(/\D/g, '')); setErrors((e) => ({ ...e, height: '' })) }}
              placeholderTextColor={Colors.textLight}
              maxLength={3}
            />
            {errors.height ? <Text style={styles.error}>{errors.height}</Text> : null}
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Weight (kg)</Text>
            <TextInput
              style={[styles.input, errors.weight && styles.inputError]}
              placeholder="70"
              keyboardType="number-pad"
              value={weight}
              onChangeText={(t) => { setWeight(t.replace(/\D/g, '')); setErrors((e) => ({ ...e, weight: '' })) }}
              placeholderTextColor={Colors.textLight}
              maxLength={3}
            />
            {errors.weight ? <Text style={styles.error}>{errors.weight}</Text> : null}
          </View>
        </View>

        {/* Primary Goal */}
        <Text style={styles.sectionLabel}>Primary Goal</Text>
        {errors.goal ? <Text style={styles.error}>{errors.goal}</Text> : null}
        <View style={styles.goalGrid}>
          {GOALS.map((g) => (
            <TouchableOpacity
              key={g.id}
              style={[styles.goalCard, goal === g.id && styles.goalCardActive]}
              onPress={() => { setGoal(g.id); setErrors((e) => ({ ...e, goal: '' })) }}
            >
              <Text style={styles.goalIcon}>{g.icon}</Text>
              <Text style={[styles.goalLabel, goal === g.id && styles.goalLabelActive]}>
                {g.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Exercise Type */}
        <Text style={styles.sectionLabel}>Exercise Type</Text>
        {errors.exercise ? <Text style={styles.error}>{errors.exercise}</Text> : null}
        <View style={styles.pillRow}>
          {EXERCISE_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.pill, exerciseType.includes(t) && styles.pillActive]}
              onPress={() => { toggleExercise(t); setErrors((e) => ({ ...e, exercise: '' })) }}
            >
              <Text style={[styles.pillText, exerciseType.includes(t) && styles.pillTextActive]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Exercise Frequency */}
        <Text style={styles.sectionLabel}>Exercise Frequency</Text>
        {errors.frequency ? <Text style={styles.error}>{errors.frequency}</Text> : null}
        <View style={styles.radioGroup}>
          {FREQUENCIES.map((f) => (
            <TouchableOpacity
              key={f}
              style={styles.radioRow}
              onPress={() => { setFrequency(f); setErrors((e) => ({ ...e, frequency: '' })) }}
            >
              <View style={[styles.radio, frequency === f && styles.radioActive]}>
                {frequency === f && <View style={styles.radioDot} />}
              </View>
              <Text style={styles.radioLabel}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Occupation (optional) */}
        <Text style={styles.sectionLabel}>Occupation <Text style={styles.optional}>(optional)</Text></Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Software Engineer"
          value={occupation}
          onChangeText={setOccupation}
          placeholderTextColor={Colors.textLight}
          maxLength={100}
        />

        <Button onPress={handleNext} style={{ marginTop: 8 }}>Next →</Button>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 28 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20 },
  row2: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  inputGroup: { flex: 1 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, marginBottom: 8 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: Fonts.body,
    fontSize: 16,
    color: Colors.text,
  },
  inputError: { borderColor: Colors.danger },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 4, marginBottom: 4 },
  sectionLabel: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text, marginBottom: 12, marginTop: 8 },
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  goalCard: {
    width: '47%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  goalCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  goalIcon: { fontSize: 28, marginBottom: 8 },
  goalLabel: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
  goalLabelActive: { color: Colors.primary },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  pillTextActive: { color: '#fff' },
  radioGroup: { gap: 12, marginBottom: 24 },
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
  optional: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
})
