import { useRef, useState, type ReactNode } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Sparkles } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'

export type WizardStep = {
  key: string
  title: string
  subtitle?: string
  emoji?: string            // shown in the question-card badge; defaults to a sparkle
  canNext: boolean
  // Set false for steps whose content manages its own scroll/gestures (e.g. a
  // drag-to-rank list), so the wizard doesn't wrap them in a ScrollView.
  scroll?: boolean
  render: () => ReactNode
}

type Props = {
  steps: WizardStep[]
  nextLabel?: string         // label shown on the final step's button
  onComplete: () => void
  onExitFirst?: () => void   // back-press on the first step
}

// A single-purpose-per-page wizard. Each step shows its question inside a
// prominent card (with an icon badge), the answer UI below it in a scroll
// area, and a sticky footer button that stays above the keyboard.
export default function Wizard({ steps, nextLabel = 'Finish →', onComplete, onExitFirst }: Props) {
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(0)
  const fade = useRef(new Animated.Value(1)).current
  const slide = useRef(new Animated.Value(0)).current

  const step = steps[index]
  const isLast = index === steps.length - 1
  const pct = ((index + 1) / steps.length) * 100

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
    Haptics.selectionAsync().catch(() => {})
    if (isLast) { onComplete(); return }
    animateTo(index + 1, 1)
  }
  function back() {
    Haptics.selectionAsync().catch(() => {})
    if (index === 0) { onExitFirst?.(); return }
    animateTo(index - 1, -1)
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Progress header */}
      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={back} hitSlop={10} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <Text style={styles.count}>{index + 1}/{steps.length}</Text>
      </View>

      <Animated.View style={[styles.body, { opacity: fade, transform: [{ translateX: slide }] }]}>
        {step.scroll === false ? (
          <View style={[styles.scroll, { flex: 1 }]}>
            <QuestionCard step={step} />
            <View style={styles.content}>{step.render()}</View>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <QuestionCard step={step} />
            <View style={styles.content}>{step.render()}</View>
          </ScrollView>
        )}
      </Animated.View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button onPress={next} disabled={!step.canNext}>{isLast ? nextLabel : 'Continue →'}</Button>
      </View>
    </KeyboardAvoidingView>
  )
}

function QuestionCard({ step }: { step: WizardStep }) {
  return (
    <View style={styles.qCard}>
      <View style={styles.badge}>
        {step.emoji
          ? <Text style={styles.badgeEmoji}>{step.emoji}</Text>
          : <Sparkles size={20} color={Colors.primary} />}
      </View>
      <Text style={styles.title}>{step.title}</Text>
      {step.subtitle ? <Text style={styles.subtitle}>{step.subtitle}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingBottom: 8 },
  backBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  track: { flex: 1, height: 6, borderRadius: 999, backgroundColor: Colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999, backgroundColor: Colors.primary },
  count: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted, minWidth: 32, textAlign: 'right' },

  body: { flex: 1 },
  scroll: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, flexGrow: 1 },

  // The question presented as a card with an icon badge — gives each step
  // visual weight instead of a bare centered heading.
  qCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 22,
    alignItems: 'center',
    marginBottom: 24,
  },
  badge: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    shadowColor: Colors.primary, shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  badgeEmoji: { fontSize: 24 },
  title: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.text, textAlign: 'center', lineHeight: 30 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20, marginTop: 8 },

  content: { alignSelf: 'stretch' },

  footer: { paddingHorizontal: 24, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
})
