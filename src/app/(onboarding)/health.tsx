import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronDown, GripVertical } from 'lucide-react-native'
import DraggableFlatList, {
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist'
import * as Haptics from 'expo-haptics'
import { useOnboardingStore, type HealthGoal } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import Wizard, { type WizardStep } from '@/components/Wizard'

type GoalItem = { id: HealthGoal; label: string; icon: string }

// Drag-to-rank goals (mockup: "Rank your goals"). Labels map to the existing
// goal IDs so the questionnaire + recommendation engine are unchanged.
const RANK_GOALS: GoalItem[] = [
  { id: 'lose-weight', label: 'Weight loss', icon: '⚖️' },
  { id: 'boost-energy', label: 'More energy', icon: '⚡' },
  { id: 'build-muscle', label: 'Muscle building', icon: '💪' },
  { id: 'improve-wellness', label: 'Eat cleaner', icon: '🌿' },
]

const EXERCISE_TYPES = [
  'Gym / Weight Training',
  'Running / Cardio',
  'Yoga / Pilates',
  'Sports',
  'Walk',
  'No regular exercise',
]
const FREQUENCIES = ['Daily', '4-5 times a week', '2-3 times a week', 'Rarely']
const OCCUPATIONS = [
  'Doctor', 'Student', 'Working Professional', 'Business Owner',
  'Freelancer', 'Content Creator', 'Other',
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
  const [ranked, setRanked] = useState<GoalItem[]>(RANK_GOALS)
  const [exerciseType, setExerciseType] = useState<string[]>([])
  const [frequency, setFrequency] = useState('')
  const [occupation, setOccupation] = useState('')
  const [occupationOpen, setOccupationOpen] = useState(false)

  const h = parseInt(height)
  const w = parseInt(weight)
  const heightValid = !isNaN(h) && h >= 120 && h <= 250
  const weightValid = !isNaN(w) && w >= 30 && w <= 200

  function toggleExercise(type: string) {
    Haptics.selectionAsync().catch(() => {})
    if (type === NO_EXERCISE) { setExerciseType([NO_EXERCISE]); return }
    setExerciseType((prev) => {
      const without = prev.filter((t) => t !== NO_EXERCISE)
      return without.includes(type) ? without.filter((t) => t !== type) : [...without, type]
    })
  }

  function handleComplete() {
    const order = ranked.map((g) => g.id)
    const goal = order[0]
    setHealthProfile({
      height, weight, proteinTarget,
      healthGoal: goal, goalRanking: order,
      exerciseType, exerciseFrequency: frequency, occupation,
    })
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

  const renderGoal = ({ item, drag, isActive, getIndex }: RenderItemParams<GoalItem>) => {
    const rank = (getIndex() ?? 0) + 1
    return (
      <ScaleDecorator>
        <TouchableOpacity
          activeOpacity={1}
          onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); drag() }}
          delayLongPress={120}
          style={[styles.rankRow, isActive && styles.rankRowActive]}
        >
          <GripVertical size={18} color={Colors.textLight} />
          <View style={styles.rankNum}><Text style={styles.rankNumText}>{rank}</Text></View>
          <Text style={styles.rankIcon}>{item.icon}</Text>
          <Text style={styles.rankLabel}>{item.label}</Text>
        </TouchableOpacity>
      </ScaleDecorator>
    )
  }

  const steps: WizardStep[] = [
    {
      key: 'body',
      title: 'Your height & weight',
      subtitle: "We use this to size your plan's macros.",
      emoji: '📏',
      canNext: heightValid && weightValid,
      render: () => (
        <View style={styles.bodyRow}>
          <View style={styles.bodyField}>
            <Text style={styles.label}>Height (cm)</Text>
            <TextInput
              style={styles.bigInput}
              placeholder="175"
              keyboardType="number-pad"
              value={height}
              onChangeText={(t) => setHeight(t.replace(/\D/g, ''))}
              placeholderTextColor={Colors.textLight}
              maxLength={3}
              textAlign="center"
            />
          </View>
          <View style={styles.bodyField}>
            <Text style={styles.label}>Weight (kg)</Text>
            <TextInput
              style={styles.bigInput}
              placeholder="70"
              keyboardType="number-pad"
              value={weight}
              onChangeText={(t) => setWeight(t.replace(/\D/g, ''))}
              placeholderTextColor={Colors.textLight}
              maxLength={3}
              textAlign="center"
            />
          </View>
        </View>
      ),
    },
    {
      key: 'goals',
      title: 'Rank your goals',
      subtitle: 'Drag to order them by priority — your top goal shapes your plan.',
      emoji: '🎯',
      canNext: true,
      scroll: false,
      render: () => (
        <DraggableFlatList
          data={ranked}
          keyExtractor={(item) => item.id}
          renderItem={renderGoal}
          onDragEnd={({ data }) => setRanked(data)}
          scrollEnabled={false}
          activationDistance={12}
          containerStyle={{ flexGrow: 0 }}
        />
      ),
    },
    {
      key: 'exercise',
      title: 'How do you stay active?',
      subtitle: 'Pick all that apply.',
      emoji: '🏃',
      canNext: exerciseType.length > 0,
      render: () => (
        <View style={styles.pillWrap}>
          {EXERCISE_TYPES.map((t) => {
            const on = exerciseType.includes(t)
            return (
              <TouchableOpacity
                key={t}
                style={[styles.pill, on && styles.pillActive]}
                onPress={() => toggleExercise(t)}
              >
                <Text style={[styles.pillText, on && styles.pillTextActive]}>{t}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ),
    },
    {
      key: 'frequency',
      title: 'How often do you train?',
      emoji: '📅',
      canNext: !!frequency,
      render: () => (
        <View style={styles.radioGroup}>
          {FREQUENCIES.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.radioRow, frequency === f && styles.radioRowActive]}
              onPress={() => { Haptics.selectionAsync().catch(() => {}); setFrequency(f) }}
            >
              <View style={[styles.radio, frequency === f && styles.radioActive]}>
                {frequency === f && <View style={styles.radioDot} />}
              </View>
              <Text style={[styles.radioLabel, frequency === f && styles.radioLabelActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    },
    {
      key: 'details',
      title: 'A few optional details',
      subtitle: 'Helps us fine-tune — skip if you like.',
      emoji: '✨',
      canNext: true,
      render: () => (
        <View style={{ gap: 24 }}>
          <View>
            <Text style={styles.label}>Daily protein target (g)</Text>
            <TextInput
              style={styles.bigInput}
              placeholder="e.g. 120"
              keyboardType="number-pad"
              value={proteinTarget}
              onChangeText={(t) => setProteinTarget(t.replace(/\D/g, ''))}
              placeholderTextColor={Colors.textLight}
              maxLength={3}
              textAlign="center"
            />
          </View>
          <View>
            <Text style={styles.label}>Occupation</Text>
            <TouchableOpacity style={styles.dropdown} onPress={() => setOccupationOpen(true)}>
              <Text style={[styles.dropdownText, !occupation && styles.dropdownPlaceholder]}>
                {occupation || 'Select your occupation'}
              </Text>
              <ChevronDown size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      ),
    },
  ]

  return (
    <>
      <Wizard
        steps={steps}
        nextLabel="Next →"
        onComplete={handleComplete}
        onExitFirst={() => router.back()}
      />

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
    </>
  )
}

const styles = StyleSheet.create({
  label: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text, marginBottom: 10, textAlign: 'center' },

  bodyRow: { flexDirection: 'row', gap: 14, justifyContent: 'center' },
  bodyField: { flex: 1, maxWidth: 160 },
  bigInput: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 16,
    paddingVertical: 20,
    fontFamily: Fonts.heading,
    fontSize: 28,
    color: Colors.text,
  },

  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  rankRowActive: { borderColor: Colors.primary, shadowColor: Colors.primary, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4 },
  rankNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  rankNumText: { fontFamily: Fonts.headingSemi, fontSize: 13, color: Colors.primary },
  rankIcon: { fontSize: 20 },
  rankLabel: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, flex: 1 },

  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  pill: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textMuted },
  pillTextActive: { color: '#fff' },

  radioGroup: { gap: 12 },
  radioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#fff', borderRadius: 16, padding: 18,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  radioRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  radio: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: Colors.primary },
  radioLabel: { fontFamily: Fonts.bodyMed, fontSize: 16, color: Colors.text },
  radioLabelActive: { color: Colors.primary, fontFamily: Fonts.bodyBold },

  dropdown: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 16,
  },
  dropdownText: { fontFamily: Fonts.body, fontSize: 16, color: Colors.text },
  dropdownPlaceholder: { color: Colors.textLight },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  sheetHandle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontFamily: Fonts.headingSemi, fontSize: 17, color: Colors.text, marginBottom: 8 },
  sheetOption: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  sheetOptionText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.text },
  textPrimary: { color: Colors.primary, fontFamily: Fonts.bodySemi },
})
