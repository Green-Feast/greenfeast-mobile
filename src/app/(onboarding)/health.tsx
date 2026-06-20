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
  Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronDown } from 'lucide-react-native'
import { useOnboardingStore, type HealthGoal } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

const GOALS: { id: HealthGoal; label: string; icon: string }[] = [
  { id: 'build-muscle', label: 'Build Muscle', icon: '💪' },
  { id: 'lose-weight', label: 'Lose Weight', icon: '⚖️' },
  { id: 'improve-wellness', label: 'Improve Wellness', icon: '🌿' },
  { id: 'boost-energy', label: 'Boost Energy', icon: '⚡' },
]

const EXERCISE_TYPES = [
  'Gym / Weight Training',
  'Running / Cardio',
  'Yoga / Pilates',
  'Sports',
  'Walk',
  'No regular exercise',
]

// Exact strings — these drive the meal-count engine (src/lib/recommendation.ts).
const FREQUENCIES = ['Daily', '4-5 times a week', '2-3 times a week', 'Rarely']

const OCCUPATIONS = [
  'Doctor',
  'Student',
  'Working Professional',
  'Business Owner',
  'Freelancer',
  'Content Creator',
  'Other',
]

const NO_EXERCISE = 'No regular exercise'

export default function HealthScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setHealthProfile } = useOnboardingStore()
  const { user } = useAuthStore()

  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const [proteinTarget, setProteinTarget] = useState('')
  const [goal, setGoal] = useState<HealthGoal | null>(null)
  const [exerciseType, setExerciseType] = useState<string[]>([])
  const [frequency, setFrequency] = useState('')
  const [occupation, setOccupation] = useState('')
  const [occupationOpen, setOccupationOpen] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function toggleExercise(type: string) {
    if (type === NO_EXERCISE) {
      setExerciseType([NO_EXERCISE])
      return
    }
    setExerciseType((prev) => {
      const without = prev.filter((t) => t !== NO_EXERCISE)
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
      proteinTarget,
      healthGoal: goal!,
      exerciseType,
      exerciseFrequency: frequency,
      occupation,
    })
    // Incremental save — captures abandoners; payment.tsx upserts the final state
    if (user) {
      ;(async () => {
        await supabase.from('dietary_profiles').upsert({
          user_id: user.id,
          health_goal: goal,
          weight: weight || null,
          height: height || null,
          exercise_type: exerciseType,
          exercise_frequency: frequency || null,
          occupation: occupation || null,
        }, { onConflict: 'user_id' })
      })().catch(() => {})
    }
    router.push('/(onboarding)/questionnaire')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <SectionProgress current={1} />
        <View style={styles.header}>
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

        {/* Daily protein target (optional) */}
        <View style={styles.field}>
          <Text style={styles.label}>Daily protein target (g) <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 120"
            keyboardType="number-pad"
            value={proteinTarget}
            onChangeText={(t) => setProteinTarget(t.replace(/\D/g, ''))}
            placeholderTextColor={Colors.textLight}
            maxLength={3}
          />
          <Text style={styles.hint}>Helps us show how each meal contributes to your goal.</Text>
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

        {/* Occupation (optional dropdown) */}
        <Text style={styles.sectionLabel}>Occupation <Text style={styles.optional}>(optional)</Text></Text>
        <TouchableOpacity style={styles.dropdown} onPress={() => setOccupationOpen(true)}>
          <Text style={[styles.dropdownText, !occupation && styles.dropdownPlaceholder]}>
            {occupation || 'Select your occupation'}
          </Text>
          <ChevronDown size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <Button onPress={handleNext} style={{ marginTop: 16 }}>Next →</Button>
      </ScrollView>

      {/* Occupation picker */}
      <Modal
        visible={occupationOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setOccupationOpen(false)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setOccupationOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Occupation</Text>
          {OCCUPATIONS.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={styles.sheetOption}
              onPress={() => { setOccupation(opt); setOccupationOpen(false) }}
            >
              <Text style={[styles.sheetOptionText, occupation === opt && styles.textPrimary]}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 24 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20 },
  row2: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  inputGroup: { flex: 1 },
  field: { marginBottom: 20 },
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
    fontSize: 16,
    color: Colors.text,
  },
  inputError: { borderColor: Colors.danger },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 6 },
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
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  dropdownText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.text },
  dropdownPlaceholder: { color: Colors.textLight },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontFamily: Fonts.headingSemi, fontSize: 17, color: Colors.text, marginBottom: 8 },
  sheetOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  sheetOptionText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.text },
  textPrimary: { color: Colors.primary, fontFamily: Fonts.bodySemi },
})
