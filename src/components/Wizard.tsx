import { useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { ArrowLeft } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'
import { KeyboardStickyFooter } from '@/components/keyboard'

export type WizardStep = {
  key: string
  title: string
  subtitle?: string
  eyebrow?: string
  emoji?: string   // legacy — ignored in new design, kept for backward compat
  canNext: boolean
  // Set false for steps that manage their own scroll/gestures (e.g. drag-to-rank)
  scroll?: boolean
  render: () => ReactNode
}

type Props = {
  steps: WizardStep[]
  nextLabel?: string
  onComplete: () => void
  onExitFirst?: () => void
  // Which of the 4 named onboarding sections this wizard belongs to, and
  // (for sections spanning multiple screens) this screen's offset/total
  // within that section — see SectionProgress.
  section: 1 | 2 | 3 | 4
  sectionStepOffset?: number
  sectionTotalOverride?: number
}

export default function Wizard({
  steps, nextLabel = 'Finish →', onComplete, onExitFirst,
  section, sectionStepOffset = 0, sectionTotalOverride,
}: Props) {
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const [footerHeight, setFooterHeight] = useState(0)
  const fade = useRef(new Animated.Value(1)).current
  const slide = useRef(new Animated.Value(0)).current

  const step = steps[index]
  const isLast = index === steps.length - 1
  const sectionStep = sectionStepOffset + index + 1
  const sectionTotalSteps = sectionTotalOverride ?? steps.length

  function animateTo(nextIndex: number, dir: 1 | -1) {
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slide, { toValue: -dir * 28, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      setIndex(nextIndex)
      slide.setValue(dir * 28)
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 7, tension: 60 }),
      ]).start()
    })
  }

  function next() {
    if (!step.canNext) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    if (isLast) { onComplete(); return }
    animateTo(index + 1, 1)
  }
  function back() {
    Haptics.selectionAsync().catch(() => {})
    if (index === 0) { onExitFirst?.(); return }
    animateTo(index - 1, -1)
  }

  return (
    <View style={styles.container}>
      {/* Progress header */}
      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={back} hitSlop={12} style={styles.backBtn}>
          <ArrowLeft size={20} color={Colors.ink900} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <SectionProgress current={section} sectionStep={sectionStep} sectionTotalSteps={sectionTotalSteps} />
        </View>
      </View>

      <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateX: slide }] }]}>
        {step.scroll === false ? (
          <View style={[styles.scroll, { flex: 1 }]}>
            <QuestionCard step={step} />
            <View style={styles.content}>{step.render()}</View>
          </View>
        ) : (
          <KeyboardAwareScrollView
            style={styles.fillView}
            contentContainerStyle={styles.scroll}
            bottomOffset={24 + footerHeight}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <QuestionCard step={step} />
            <View style={styles.content}>{step.render()}</View>
          </KeyboardAwareScrollView>
        )}
      </Animated.View>

      <KeyboardStickyFooter style={styles.footer} basePadding={16} onMeasure={setFooterHeight}>
        <Button onPress={next} disabled={!step.canNext}>{isLast ? nextLabel : 'Continue →'}</Button>
      </KeyboardStickyFooter>
    </View>
  )
}

function QuestionCard({ step }: { step: WizardStep }) {
  return (
    <View style={styles.qCard}>
      {step.eyebrow ? (
        <Text style={styles.eyebrow}>{step.eyebrow}</Text>
      ) : null}
      <Text style={styles.title}>{step.title}</Text>
      {step.subtitle ? <Text style={styles.subtitle}>{step.subtitle}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },

  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  body: { flex: 1 },
  fillView: { flex: 1 },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    flexGrow: 1,
  },

  qCard: {
    paddingTop: 8,
    paddingBottom: 28,
  },
  eyebrow: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 32,
    color: Colors.ink900,
    lineHeight: 38,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink500,
    lineHeight: 22,
  },

  content: { alignSelf: 'stretch' },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.cream50,
  },
})
