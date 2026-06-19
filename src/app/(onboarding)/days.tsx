import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useOnboardingStore, type DeliveryMode } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function DaysScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setDays } = useOnboardingStore()

  const [mode, setMode] = useState<DeliveryMode>('opt-out')
  const [selected, setSelected] = useState<string[]>([...DAYS])
  const [mealsLunch, setMealsLunch] = useState(1)
  const [mealsDinner, setMealsDinner] = useState(0)

  const totalSlots = mealsLunch + mealsDinner

  function switchMode(newMode: DeliveryMode) {
    setMode(newMode)
    setSelected(newMode === 'opt-out' ? [...DAYS] : [])
  }

  function toggleDay(day: string) {
    setSelected((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  function handleNext() {
    if (selected.length === 0 || totalSlots === 0) return
    setDays(selected, mode, mealsLunch, mealsDinner)
    router.push('/(onboarding)/address')
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
      <SectionProgress current={3} />
      <View style={styles.header}>
        <Text style={styles.title}>When do you want your meals?</Text>
        <Text style={styles.subtitle}>Choose how you'd like to manage deliveries</Text>
      </View>

      {/* Mode cards */}
      <View style={styles.modeCards}>
        <TouchableOpacity
          style={[styles.modeCard, mode === 'opt-out' && styles.modeCardActive]}
          onPress={() => switchMode('opt-out')}
        >
          <View style={[styles.radio, mode === 'opt-out' && styles.radioActive]}>
            {mode === 'opt-out' && <View style={styles.radioDot} />}
          </View>
          <View style={styles.modeText}>
            <Text style={[styles.modeTitle, mode === 'opt-out' && styles.textPrimary]}>
              All days, skip as you go
            </Text>
            <Text style={styles.modeDesc}>
              All days are active by default. Uncheck the days you want to skip.
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.modeCard, mode === 'opt-in' && styles.modeCardActive]}
          onPress={() => switchMode('opt-in')}
        >
          <View style={[styles.radio, mode === 'opt-in' && styles.radioActive]}>
            {mode === 'opt-in' && <View style={styles.radioDot} />}
          </View>
          <View style={styles.modeText}>
            <Text style={[styles.modeTitle, mode === 'opt-in' && styles.textPrimary]}>
              Only days I choose
            </Text>
            <Text style={styles.modeDesc}>
              No days active by default. Check only the days you want.
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Day grid */}
      <View style={styles.dayGrid}>
        {DAYS.map((day) => {
          const isOn = selected.includes(day)
          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayCell, isOn && styles.dayCellActive]}
              onPress={() => toggleDay(day)}
            >
              <Text style={[styles.dayLabel, isOn && styles.dayLabelActive]}>{day}</Text>
              <View style={[styles.dayCheck, isOn && styles.dayCheckActive]}>
                {isOn && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>
          )
        })}
      </View>

      {selected.length === 0 && (
        <Text style={styles.warn}>Select at least one day to continue</Text>
      )}

      <Text style={styles.selectedCount}>
        {selected.length} day{selected.length !== 1 ? 's' : ''} selected
      </Text>

      {/* Meal timing */}
      <Text style={styles.sectionTitle}>Meal timing</Text>
      <Text style={styles.slotHint}>How would you like your meals split between lunch and dinner?</Text>

      <View style={styles.slotRow}>
        <SlotCounter
          icon="☀️"
          label="Lunch"
          value={mealsLunch}
          onDecrement={() => setMealsLunch((v) => Math.max(0, v - 1))}
          onIncrement={() => setMealsLunch((v) => v + 1)}
        />
        <SlotCounter
          icon="🌙"
          label="Dinner"
          value={mealsDinner}
          onDecrement={() => setMealsDinner((v) => Math.max(0, v - 1))}
          onIncrement={() => setMealsDinner((v) => v + 1)}
        />
      </View>

      <Text style={styles.timingLine}>
        Lunch 12–2 · Dinner 5–7. Need a specific time? WhatsApp us after checkout.
      </Text>

      {totalSlots === 0 && <Text style={styles.warn}>Add at least one meal per day</Text>}

      <Button onPress={handleNext} disabled={selected.length === 0 || totalSlots === 0}>Next →</Button>
    </ScrollView>
  )
}

function SlotCounter({
  icon,
  label,
  value,
  onDecrement,
  onIncrement,
}: {
  icon: string
  label: string
  value: number
  onDecrement: () => void
  onIncrement: () => void
}) {
  return (
    <View style={styles.slotCard}>
      <Text style={styles.slotIcon}>{icon}</Text>
      <Text style={styles.slotLabel}>{label}</Text>
      <View style={styles.counter}>
        <TouchableOpacity style={styles.counterBtn} onPress={onDecrement}>
          <Text style={styles.counterBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.counterValue}>{value}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={onIncrement}>
          <Text style={styles.counterBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 28 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  modeCards: { gap: 12, marginBottom: 28 },
  modeCard: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'flex-start',
  },
  modeCardActive: { borderColor: Colors.primary },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  modeText: { flex: 1 },
  modeTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text, marginBottom: 4 },
  modeDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  textPrimary: { color: Colors.primary },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  dayCell: {
    width: '30%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 8,
  },
  dayCellActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  dayLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.textMuted },
  dayLabelActive: { color: Colors.primary },
  dayCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCheckActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkmark: { fontFamily: Fonts.bodyBold, color: '#fff', fontSize: 12 },
  warn: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, textAlign: 'center', marginBottom: 8 },
  selectedCount: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginBottom: 24 },
  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text, marginBottom: 6 },
  slotHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 16, lineHeight: 18 },
  slotRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  slotCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 8,
  },
  slotIcon: { fontSize: 28 },
  slotLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  counterBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnText: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.primary },
  counterValue: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.text, minWidth: 30, textAlign: 'center' },
  timingLine: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 18, marginBottom: 24 },
})
