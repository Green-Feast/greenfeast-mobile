import { useEffect, useRef } from 'react'
import { View, Text, Animated, StyleSheet } from 'react-native'
import { Colors, Fonts } from '@/constants/colors'

// "Train track" onboarding progress bar (sub-flow.txt §02):
//   1 Profile + Health Goals
//   2 Questionnaire + Dietary
//   3 Plan + Select Days
//   4 Address + Payment
//
// Each of the 4 bars is a named section. The bar for the section currently in
// progress expands (like a station platform stretching out) and shows a fill
// proportional to fine-grained progress within that section; completed
// sections stay compact and fully solid, future sections stay compact and
// empty. Crossing into the next section shrinks the old bar back down and
// expands the new one.
const SECTIONS = ['Profile', 'Preferences', 'Plan', 'Payment']
const COMPACT_FLEX = 1
const EXPANDED_FLEX = 2.5

type Props = {
  current: 1 | 2 | 3 | 4
  sectionStep: number
  sectionTotalSteps: number
}

export default function SectionProgress({ current, sectionStep, sectionTotalSteps }: Props) {
  const flexAnims = useRef(SECTIONS.map((_, i) => new Animated.Value(i === current - 1 ? EXPANDED_FLEX : COMPACT_FLEX))).current
  const fillAnim = useRef(new Animated.Value(sectionTotalSteps > 0 ? sectionStep / sectionTotalSteps : 0)).current

  useEffect(() => {
    Animated.parallel(
      flexAnims.map((anim, i) =>
        Animated.timing(anim, {
          toValue: i === current - 1 ? EXPANDED_FLEX : COMPACT_FLEX,
          duration: 280,
          useNativeDriver: false,
        })
      )
    ).start()
  }, [current])

  useEffect(() => {
    const fraction = sectionTotalSteps > 0 ? Math.min(1, Math.max(0, sectionStep / sectionTotalSteps)) : 0
    Animated.timing(fillAnim, { toValue: fraction, duration: 220, useNativeDriver: false }).start()
  }, [sectionStep, sectionTotalSteps])

  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {SECTIONS.map((_, i) => {
          const isCurrent = i === current - 1
          const isDone = i < current - 1
          return (
            <Animated.View key={i} style={[styles.bar, { flex: flexAnims[i] }]}>
              {isCurrent ? (
                <Animated.View
                  style={[
                    styles.fill,
                    {
                      width: fillAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                    },
                  ]}
                />
              ) : isDone ? (
                <View style={[styles.fill, { width: '100%' }]} />
              ) : null}
            </Animated.View>
          )
        })}
      </View>
      <View style={styles.labelRow}>
        <Text style={styles.current}>{SECTIONS[current - 1]}</Text>
        <Text style={styles.count}>Step {sectionStep} of {sectionTotalSteps}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { height: 5, borderRadius: 3, backgroundColor: Colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: Colors.primary },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  current: {
    fontFamily: Fonts.bodySemi,
    fontSize: 12,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  count: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
})
