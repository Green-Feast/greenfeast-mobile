import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useOnboardingStore } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import { computeRecommendation } from '@/lib/recommendation'
import { Colors, Fonts } from '@/constants/colors'
import Wizard, { type WizardStep } from '@/components/Wizard'

type Option = { id: string; label: string; desc?: string }
type QuestionSet = {
  q1: { question: string; options: Option[] }
  q2?: { question: string; options: Option[] }
}

const QUESTIONS: Record<string, QuestionSet> = {
  'build-muscle': {
    q1: {
      question: 'What phase are you currently in?',
      options: [
        { id: 'cut', label: 'Cut phase', desc: 'Reduce fat, preserve muscle' },
        { id: 'bulk', label: 'Bulk phase', desc: 'Build mass' },
      ],
    },
  },
  'lose-weight': {
    q1: {
      question: 'What issue are you currently facing?',
      options: [
        { id: 'bloating', label: 'Bloating', desc: 'Digestive discomfort' },
        { id: 'lean-out', label: 'Lean out', desc: 'Want to slim down, feel heavy' },
        { id: 'condition', label: 'Health condition', desc: 'PCOS, diabetes, thyroid, etc.' },
      ],
    },
    q2: {
      question: "What's your current approach?",
      options: [
        { id: 'exercise', label: 'Regular exercise', desc: 'Gym, running, yoga' },
        { id: 'diet', label: 'Dietary modification only', desc: 'No exercise' },
      ],
    },
  },
  'improve-wellness': {
    q1: {
      question: 'What does improving your wellness look like for you?',
      options: [
        { id: 'clean', label: 'Eat clean, feel better', desc: 'Global variety' },
        { id: 'gut', label: 'Anti-inflammatory / gut health', desc: 'Focus on digestion' },
      ],
    },
  },
  'boost-energy': {
    q1: {
      question: 'What does low energy look like for you?',
      options: [
        { id: 'crash', label: 'Post-meal crash', desc: 'Brain fog, afternoon slump' },
        { id: 'stamina', label: 'Physical fatigue', desc: 'Low stamina, gym performance' },
      ],
    },
  },
}

// Shared with dietary.tsx so both screens agree on Section 2's total step
// count for the SectionProgress "train track" bar (1 or 2 dynamic questions
// here, plus dietary.tsx's own single step).
export function getQuestionCount(goal: string): number {
  return QUESTIONS[goal]?.q2 ? 2 : 1
}

export default function QuestionnaireScreen() {
  const router = useRouter()
  const { healthGoal, exerciseFrequency, setQuestionnaire } = useOnboardingStore()
  const { user } = useAuthStore()
  const [q1Answer, setQ1Answer] = useState('')
  const [q2Answer, setQ2Answer] = useState('')

  useFocusEffect(
    useCallback(() => {
      if (!healthGoal) router.replace('/(onboarding)/health')
    }, [healthGoal, router])
  )

  if (!healthGoal) return null

  const qs = QUESTIONS[healthGoal]
  const needsQ2 = !!qs.q2
  const questionCount = getQuestionCount(healthGoal)

  function handleComplete() {
    const recommendation = computeRecommendation({
      goal: healthGoal!,
      q1: q1Answer,
      q2: q2Answer,
      exerciseFrequency,
    })
    setQuestionnaire({ q1Answer, q2Answer, recommendation })
    if (user) {
      ;(async () => {
        await supabase.from('questionnaire_responses').upsert({
          user_id: user.id,
          health_goal: healthGoal,
          q1_answer: q1Answer,
          q2_answer: q2Answer || null,
          derived_menu: recommendation.menuType,
          derived_addons: recommendation.derivedAddons,
          derived_constraints: recommendation.derivedConstraints,
        }, { onConflict: 'user_id' })
      })().catch(() => {})
    }
    router.push('/(onboarding)/dietary')
  }

  const renderOptions = (options: Option[], value: string, onChange: (v: string) => void) => (
    <View style={styles.options}>
      {options.map((opt) => {
        const on = value === opt.id
        return (
          <TouchableOpacity
            key={opt.id}
            style={[styles.option, on && styles.optionActive]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); onChange(opt.id) }}
          >
            <View style={[styles.radio, on && styles.radioActive]}>
              {on && <View style={styles.radioDot} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.optionLabel, on && styles.optionLabelActive]}>{opt.label}</Text>
              {opt.desc && <Text style={styles.optionDesc}>{opt.desc}</Text>}
            </View>
          </TouchableOpacity>
        )
      })}
    </View>
  )

  const steps: WizardStep[] = [
    {
      key: 'q1',
      eyebrow: 'YOUR GOAL',
      title: qs.q1.question,
      emoji: '🤔',
      canNext: q1Answer !== '',
      render: () => renderOptions(qs.q1.options, q1Answer, setQ1Answer),
    },
  ]
  if (needsQ2 && qs.q2) {
    steps.push({
      key: 'q2',
      title: qs.q2.question,
      emoji: '🍽️',
      canNext: q2Answer !== '',
      render: () => renderOptions(qs.q2!.options, q2Answer, setQ2Answer),
    })
  }

  return (
    <Wizard
      steps={steps}
      nextLabel="See my plan →"
      onComplete={handleComplete}
      onExitFirst={() => router.back()}
      section={2}
      sectionTotalOverride={questionCount + 1}
    />
  )
}

const styles = StyleSheet.create({
  options: { gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.cream200,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  optionActive: { borderColor: Colors.green700, backgroundColor: Colors.green50 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.green700 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.green700 },
  optionLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink900 },
  optionLabelActive: { color: Colors.green700 },
  optionDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, marginTop: 2 },
})
