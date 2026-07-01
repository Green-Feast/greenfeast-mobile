import { View, Text, StyleSheet } from 'react-native'
import { Colors, Fonts } from '@/constants/colors'

type Size = 'sm' | 'md' | 'lg'

interface MacroRowProps {
  protein?: number | null
  carbs?: number | null
  fat?: number | null
  fibre?: number | null
  kcal?: number | null
  size?: Size
}

const MACROS = [
  { key: 'protein' as const, color: Colors.macroProtein, label: 'PROTEIN' },
  { key: 'carbs'   as const, color: Colors.macroCarbs,   label: 'CARBS'   },
  { key: 'fat'     as const, color: Colors.macroFat,     label: 'FAT'     },
  { key: 'fibre'   as const, color: Colors.macroFibre,   label: 'FIBRE'   },
]

const TICK_SIZES: Record<Size, { width: number; height: number; labelSize: number; valueSize: number }> = {
  sm: { width: 2, height: 10, labelSize: 9,  valueSize: 11 },
  md: { width: 3, height: 13, labelSize: 10, valueSize: 13 },
  lg: { width: 3, height: 15, labelSize: 11, valueSize: 14 },
}

export default function MacroRow({ protein, carbs, fat, fibre, kcal, size = 'md' }: MacroRowProps) {
  const tick = TICK_SIZES[size]

  const items = MACROS.filter(({ key }) => {
    const val = { protein, carbs, fat, fibre }[key]
    return val != null && !isNaN(val as number)
  })

  if (items.length === 0) return null

  return (
    <View style={styles.row}>
      {items.map(({ key, color, label }) => {
        const val = { protein, carbs, fat, fibre }[key] as number
        return (
          <View key={key} style={styles.item}>
            <View style={[styles.tick, { width: tick.width, height: tick.height, backgroundColor: color }]} />
            <Text style={[styles.label, { fontSize: tick.labelSize }]}>{label}</Text>
            <Text style={[styles.value, { fontSize: tick.valueSize }]}>{Math.round(val)}g</Text>
          </View>
        )
      })}
      {kcal != null && !isNaN(kcal) && (
        <View style={styles.kcalItem}>
          <Text style={[styles.label, { fontSize: tick.labelSize }]}>KCAL</Text>
          <Text style={[styles.value, { fontSize: tick.valueSize }]}>{Math.round(kcal)}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  tick: {
    borderRadius: 2,
  },
  label: {
    fontFamily: Fonts.bodyMed,
    color: Colors.ink500,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  value: {
    fontFamily: Fonts.bodySemi,
    color: Colors.ink900,
  },
  kcalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
})
