import { View, Text, StyleSheet } from 'react-native'
import { Colors, Fonts } from '@/constants/colors'

// 4-section onboarding progress bar (sub-flow.txt §02):
//   1 Profile + Health Goals
//   2 Questionnaire + Dietary
//   3 Plan + Select Days
//   4 Address + Payment
const SECTIONS = ['Profile', 'Preferences', 'Plan', 'Payment']

export default function SectionProgress({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.bars}>
        {SECTIONS.map((_, i) => (
          <View key={i} style={[styles.bar, i < current && styles.barFilled]} />
        ))}
      </View>
      <View style={styles.labelRow}>
        <Text style={styles.current}>{SECTIONS[current - 1]}</Text>
        <Text style={styles.count}>Step {current} of 4</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: Colors.border },
  barFilled: { backgroundColor: Colors.primary },
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
