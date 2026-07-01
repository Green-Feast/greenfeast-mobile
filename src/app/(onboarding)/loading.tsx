import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, Animated, Easing } from 'react-native'
import { useRouter } from 'expo-router'
import { Check } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'
import { useAuthStore } from '@/store/auth'

const STEPS = [
  'Calculating your protein target',
  'Matching meals to your goal',
  'Filtering allergens & restrictions',
  'Finalising your plan',
]

const STEP_MS = 1000          // time each step takes to "complete"
const TAIL_MS = 600           // small pause after the last step
const TOTAL_MS = STEPS.length * STEP_MS + TAIL_MS

export default function LoadingScreen() {
  const router = useRouter()
  const { user } = useAuthStore()
  const [done, setDone] = useState(0) // number of completed steps
  const pulse = useRef(new Animated.Value(0)).current
  const progress = useRef(new Animated.Value(0)).current

  const firstName = ((user?.user_metadata?.full_name as string) ?? (user?.user_metadata?.name as string) ?? '').split(' ')[0]

  useEffect(() => {
    // Gentle breathing pulse on the leaf badge.
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start()

    // Progress bar fills across the whole sequence.
    Animated.timing(progress, {
      toValue: 1,
      duration: STEPS.length * STEP_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start()

    // Check steps off one by one.
    const ticks = STEPS.map((_, i) =>
      setTimeout(() => setDone(i + 1), (i + 1) * STEP_MS)
    )
    const finish = setTimeout(() => router.replace('/(onboarding)/recommendation'), TOTAL_MS)

    return () => {
      ticks.forEach(clearTimeout)
      clearTimeout(finish)
    }
  }, [])

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] })
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] })
  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] })

  return (
    <View style={styles.container}>
      <View style={styles.badgeWrap}>
        <Animated.View style={[styles.glow, { opacity: glow, transform: [{ scale }] }]} />
        <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
          <Text style={styles.badgeIcon}>🌿</Text>
        </Animated.View>
      </View>

      <Text style={styles.title}>
        {firstName ? `Building your plan,\n${firstName}.` : 'Building your\npersonalised plan.'}
      </Text>

      {/* Progress bar */}
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: barWidth }]} />
      </View>

      {/* Step checklist */}
      <View style={styles.steps}>
        {STEPS.map((label, i) => {
          const isDone = i < done
          const isActive = i === done
          return (
            <StepRow key={label} label={label} isDone={isDone} isActive={isActive} />
          )
        })}
      </View>
    </View>
  )
}

function StepRow({ label, isDone, isActive }: { label: string; isDone: boolean; isActive: boolean }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.spring(anim, {
      toValue: isDone || isActive ? 1 : 0,
      useNativeDriver: true,
      friction: 6,
      tension: 80,
    }).start()
  }, [isDone, isActive])

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] })

  return (
    <View style={styles.stepRow}>
      <Animated.View
        style={[
          styles.stepDot,
          isDone && styles.stepDotDone,
          isActive && styles.stepDotActive,
          { transform: [{ scale }] },
        ]}
      >
        {isDone ? <Check size={13} color="#fff" strokeWidth={3} /> : null}
      </Animated.View>
      <Text style={[styles.stepText, (isDone || isActive) && styles.stepTextOn]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.cream50,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  badgeWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  glow: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: Colors.green50,
  },
  badge: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.green50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcon: { fontSize: 38 },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 28,
    color: Colors.ink900,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 35,
  },
  track: {
    width: '78%',
    height: 4,
    borderRadius: 999,
    backgroundColor: Colors.border,
    overflow: 'hidden',
    marginBottom: 32,
  },
  fill: { height: '100%', borderRadius: 999, backgroundColor: Colors.green700 },
  steps: { alignSelf: 'stretch', paddingHorizontal: 24, gap: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.cream50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { borderColor: Colors.green700 },
  stepDotDone: { backgroundColor: Colors.green700, borderColor: Colors.green700 },
  stepText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink400, flex: 1 },
  stepTextOn: { color: Colors.ink900, fontFamily: Fonts.bodyMed },
})
