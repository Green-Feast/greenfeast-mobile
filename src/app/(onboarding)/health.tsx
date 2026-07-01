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
import { GripVertical } from 'lucide-react-native'
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
import RulerPicker from '@/components/RulerPicker'

type GoalItem = { id: HealthGoal; label: string }

const RANK_GOALS: GoalItem[] = [
  { id: 'lose-weight',      label: 'Weight loss'     },
  { id: 'boost-energy',     label: 'More energy'     },
  { id: 'build-muscle',     label: 'Muscle building' },
  { id: 'improve-wellness', label: 'Eat cleaner'     },
]

const EXERCISE_TYPES = [
  'Gym / Weight Training',
  'Running / Cardio',
  'Yoga / Pilates',
  'Sports',
  'Walking',
  'No regular exercise',
]
const FREQUENCIES = ['Daily', '4–5 times a week', '2–3 times a week', 'Rarely']
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

  // RulerPicker uses numbers; default to sensible midpoints
  const [heightCm, setHeightCm] = useState(170)
  const [weightKg, setWeightKg] = useState(70)

  const [proteinTarget, setProteinTarget] = useState('')
  const [ranked, setRanked] = useState<GoalItem[]>(RANK_GOALS)
  const [exerciseType, setExerciseType] = useState<string[]>([])
  const [frequency, setFrequency] = useState('')
  const [occupation, setOccupation] = useState('')

  function toggleExercise(type: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    if (type === NO_EXERCISE) { setExerciseType([NO_EXERCISE]); return }
    setExerciseType((prev) => {
      const without = prev.filter((t) => t !== NO_EXERCISE)
      return without.includes(type) ? without.filter((t) => t !== type) : [...without, type]
    })
  }

  function toggleOccupation(opt: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    setOccupation((prev) => (prev === opt ? '' : opt))
  }

  function toggleFrequency(f: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    setFrequency((prev) => (prev === f ? '' : f))
  }

  function handleComplete() {
    const order = ranked.map((g) => g.id)
    const goal = order[0]
    setHealthProfile({
      height: String(heightCm),
      weight: String(weightKg),
      proteinTarget,
      healthGoal: goal,
      goalRanking: order,
      exerciseType,
      exerciseFrequency: frequency,
      occupation,
    })
    if (user) {
      ;(async () => {
        await supabase.from('dietary_profiles').upsert({
          user_id: user.id,
          health_goal: goal,
          weight: weightKg,
          height: heightCm,
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
          onLongPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
            drag()
          }}
          delayLongPress={120}
          style={[styles.rankRow, isActive && styles.rankRowActive]}
        >
          <GripVertical size={18} color={Colors.ink300} />
          <View style={styles.rankNum}>
            <Text style={styles.rankNumText}>{rank}</Text>
          </View>
          <Text style={styles.rankLabel}>{item.label}</Text>
        </TouchableOpacity>
      </ScaleDecorator>
    )
  }

  const steps: WizardStep[] = [
    // SF1 — Height & Weight
    {
      key: 'body',
      eyebrow: 'YOUR BODY',
      title: 'Height & weight',
      subtitle: 'Used to calibrate your meal portions and macros.',
      canNext: true,
      render: () => (
        <View style={styles.rulersWrap}>
          <View style={styles.rulerGroup}>
            <Text style={styles.rulerLabel}>HEIGHT</Text>
            <RulerPicker min={120} max={250} value={heightCm} onChange={setHeightCm} unit="cm" />
          </View>
          <View style={styles.rulerGroup}>
            <Text style={styles.rulerLabel}>WEIGHT</Text>
            <RulerPicker min={30} max={200} value={weightKg} onChange={setWeightKg} unit="kg" />
          </View>
        </View>
      ),
    },

    // SF2 — Rank Goals
    {
      key: 'goals',
      eyebrow: 'YOUR GOAL',
      title: 'Rank your goals',
      subtitle: 'Drag to order by priority — your top goal shapes your plan.',
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

    // SF3 — Exercise Type
    {
      key: 'exercise',
      eyebrow: 'YOUR LIFESTYLE',
      title: 'How do you stay active?',
      subtitle: 'Pick all that apply.',
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

    // SF4 — Frequency
    {
      key: 'frequency',
      eyebrow: 'YOUR LIFESTYLE',
      title: 'How often do you train?',
      canNext: !!frequency,
      render: () => (
        <View style={styles.pillWrap}>
          {FREQUENCIES.map((f) => {
            const on = frequency === f
            return (
              <TouchableOpacity
                key={f}
                style={[styles.pill, styles.pillWide, on && styles.pillActive]}
                onPress={() => toggleFrequency(f)}
              >
                <Text style={[styles.pillText, on && styles.pillTextActive]}>{f}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ),
    },

    // SF5 — Protein Target
    {
      key: 'protein',
      eyebrow: 'YOUR GOALS',
      title: 'Daily protein target',
      subtitle: 'Optional — leave blank and we\'ll calculate it for you.',
      canNext: true,
      render: () => (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>DAILY PROTEIN TARGET (G)</Text>
          <TextInput
            style={styles.fieldInput}
            placeholder="e.g. 120"
            keyboardType="number-pad"
            value={proteinTarget}
            onChangeText={(t) => setProteinTarget(t.replace(/\D/g, ''))}
            placeholderTextColor={Colors.ink300}
            maxLength={3}
          />
        </View>
      ),
    },

    // SF6 — Occupation
    {
      key: 'occupation',
      eyebrow: 'YOUR LIFESTYLE',
      title: 'What do you do?',
      subtitle: 'Helps us understand your daily energy needs.',
      canNext: true,
      render: () => (
        <View style={styles.pillWrap}>
          {OCCUPATIONS.map((opt) => {
            const on = occupation === opt
            return (
              <TouchableOpacity
                key={opt}
                style={[styles.pill, on && styles.pillActive]}
                onPress={() => toggleOccupation(opt)}
              >
                <Text style={[styles.pillText, on && styles.pillTextActive]}>{opt}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ),
    },
  ]

  return (
    <Wizard
      steps={steps}
      nextLabel="Next →"
      onComplete={handleComplete}
      onExitFirst={() => router.back()}
    />
  )
}

const styles = StyleSheet.create({
  // Height / weight ruler layout
  rulersWrap: { gap: 32 },
  rulerGroup: { gap: 10 },
  rulerLabel: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    textAlign: 'center',
  },

  // Goal rank rows
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.cream200,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  rankRowActive: {
    borderColor: Colors.green700,
    shadowColor: Colors.green700,
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4,
  },
  rankNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.green50,
    alignItems: 'center', justifyContent: 'center',
  },
  rankNumText: {
    fontFamily: Fonts.headingSemi,
    fontSize: 13,
    color: Colors.green700,
  },
  rankLabel: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.ink900, flex: 1 },

  // Pill chips (multi-select + single-select)
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.cream50,
  },
  pillWide: { flex: 1, minWidth: 140, alignItems: 'center' },
  pillActive: { backgroundColor: Colors.green700, borderColor: Colors.green700 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink500 },
  pillTextActive: { color: '#fff' },

  // Underline text inputs
  field: { gap: 8 },
  fieldLabel: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  fieldInput: {
    fontFamily: Fonts.heading,
    fontSize: 28,
    color: Colors.ink900,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 0,
    textAlign: 'center',
  },
})
