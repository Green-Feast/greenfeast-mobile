import { View, Text, StyleSheet } from 'react-native'
import Svg, { Circle } from 'react-native-svg'
import { Colors, Fonts } from '@/constants/colors'

// Apple-Health-style ring: one or more colored segments drawn around a
// shared track, using the same same-radius-circles-with-dasharray trick as
// the design system's CalorieRing reference (see
// greenfeast-design-system/project/components/nutrition/CalorieRing.jsx) —
// each segment is its own <Circle> stroke, offset so segments sit end to end
// starting from the top (12 o'clock) with a small gap between them.

type Segment = { value: number; color: string }

type Props = {
  segments: Segment[]
  size?: number
  strokeWidth?: number
  centerValue?: string
  centerLabel?: string
}

export default function MacroRing({ segments, size = 96, strokeWidth = 11, centerValue, centerLabel }: Props) {
  const r = (size - strokeWidth * 2) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1
  const nonZero = segments.filter((s) => s.value > 0)
  const GAP = nonZero.length > 1 ? circ * 0.018 : 0

  let startFraction = 0
  const arcs = nonZero.map((seg) => {
    const fraction = seg.value / total
    const segLen = Math.max(0, fraction * circ - GAP)
    const dashoffset = -(startFraction * circ - circ * 0.25)
    startFraction += fraction
    return { color: seg.color, dasharray: `${segLen} ${circ - segLen}`, dashoffset }
  })

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={Colors.border} strokeWidth={Math.max(2, strokeWidth - 2)} />
        {arcs.map((a, i) => (
          <Circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={a.color}
            strokeWidth={strokeWidth}
            strokeDasharray={a.dasharray}
            strokeDashoffset={a.dashoffset}
            strokeLinecap="round"
          />
        ))}
      </Svg>
      {(centerValue || centerLabel) && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.center}>
            {centerValue ? <Text style={styles.value}>{centerValue}</Text> : null}
            {centerLabel ? <Text style={styles.label}>{centerLabel}</Text> : null}
          </View>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  value: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.ink900, lineHeight: 20 },
  label: {
    fontFamily: Fonts.bodyMed,
    fontSize: 10,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 1,
  },
})
