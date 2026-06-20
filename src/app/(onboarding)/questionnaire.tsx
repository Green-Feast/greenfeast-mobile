import { useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import { useOnboardingStore } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import { computeRecommendation } from '@/lib/recommendation'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

// ── Questions by goal ─────────────────────────────────────────────────────────

type Option = { id: string; label: string; desc?: string }

type QuestionSet = {
  q1: { question: string; options: Option[] }
  q2?: { question: string; options: Option[] } // only for lose-weight
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

export default function QuestionnaireScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
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
  const canProceed = q1Answer !== '' && (!needsQ2 || q2Answer !== '')

  function handleNext() {
    if (!canProceed) return
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
      <SectionProgress current={2} />
      <View style={styles.header}>
        <Text style={styles.title}>A few quick questions</Text>
        <Text style={styles.subtitle}>Help us get your plan right.</Text>
      </View>

      {/* Q1 */}
      <View style={styles.questionBlock}>
        <Text style={styles.question}>{qs.q1.question}</Text>
        <View style={styles.options}>
          {qs.q1.options.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.option, q1Answer === opt.id && styles.optionActive]}
              onPress={() => setQ1Answer(opt.id)}
            >
              <View style={[styles.radio, q1Answer === opt.id && styles.radioActive]}>
                {q1Answer === opt.id && <View style={styles.radioDot} />}
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, q1Answer === opt.id && styles.optionLabelActive]}>
                  {opt.label}
                </Text>
                {opt.desc && <Text style={styles.optionDesc}>{opt.desc}</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Q2 (only for lose-weight) */}
      {needsQ2 && qs.q2 && (
        <View style={styles.questionBlock}>
          <Text style={styles.question}>{qs.q2.question}</Text>
          <View style={styles.options}>
            {qs.q2.options.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={[styles.option, q2Answer === opt.id && styles.optionActive]}
                onPress={() => setQ2Answer(opt.id)}
              >
                <View style={[styles.radio, q2Answer === opt.id && styles.radioActive]}>
                  {q2Answer === opt.id && <View style={styles.radioDot} />}
                </View>
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, q2Answer === opt.id && styles.optionLabelActive]}>
                    {opt.label}
                  </Text>
                  {opt.desc && <Text style={styles.optionDesc}>{opt.desc}</Text>}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <Button onPress={handleNext} disabled={!canProceed}>Next →</Button>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 32 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  questionBlock: { marginBottom: 32 },
  question: { fontFamily: Fonts.headingSemi, fontSize: 17, color: Colors.text, marginBottom: 16, lineHeight: 24 },
  options: { gap: 10 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  optionActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  optionText: { flex: 1 },
  optionLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  optionLabelActive: { color: Colors.primary },
  optionDesc: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
})
