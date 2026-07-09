import { useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useOnboardingStore } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function DaysScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setDays } = useOnboardingStore()

  const [mealsLunch, setMealsLunch] = useState(1)
  const [mealsDinner, setMealsDinner] = useState(0)
  // All six days on by default, but editable — tapping toggles a day off/on.
  const [days, setSelectedDays] = useState<string[]>([...DAYS])

  const totalSlots = mealsLunch + mealsDinner

  function toggleDay(day: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  function handleNext() {
    if (totalSlots === 0 || days.length === 0) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    // Days can be skipped or added later from the subscriber tab, so we start in
    // opt-out mode with the chosen days active (in canonical Mon–Sat order).
    const ordered = DAYS.filter((d) => days.includes(d))
    setDays(ordered, 'opt-out', mealsLunch, mealsDinner)
    router.push('/(onboarding)/address')
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: 40 + insets.bottom }]}>
      <SectionProgress current={3} sectionStep={5} sectionTotalSteps={5} />
      <View style={styles.header}>
        <Text style={styles.title}>When do you want your meals?</Text>
        <Text style={styles.subtitle}>We deliver Monday to Saturday</Text>
      </View>

      {/* Day circles — all on by default, but tap any day to toggle it off/on */}
      <View style={styles.dayGrid}>
        {DAYS.map((day) => {
          const on = days.includes(day)
          return (
            <TouchableOpacity
              key={day}
              style={styles.dayCol}
              onPress={() => toggleDay(day)}
              activeOpacity={0.8}
            >
              <View style={[styles.dayCircle, on && styles.dayCircleActive]}>
                <Text style={[styles.dayLabel, on && styles.dayLabelActive]}>{day}</Text>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>

      <Text style={styles.selectedCount}>
        {days.length === 0
          ? 'Tap at least one day to continue.'
          : 'Tap a day to skip it. You can change this anytime from your subscriber tab.'}
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

      <Button onPress={handleNext} disabled={totalSlots === 0 || days.length === 0}>Next →</Button>
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
  function dec() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onDecrement()
  }
  function inc() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    onIncrement()
  }
  return (
    <View style={styles.slotCard}>
      <Text style={styles.slotIcon}>{icon}</Text>
      <Text style={styles.slotLabel}>{label}</Text>
      <View style={styles.counter}>
        <TouchableOpacity style={styles.counterBtn} onPress={dec}>
          <Text style={styles.counterBtnText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.counterValue}>{value}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={inc}>
          <Text style={styles.counterBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginTop: 24, marginBottom: 28 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.ink900, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500 },
  dayGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  dayCol: { alignItems: 'center' },
  dayCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.cream50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleActive: { backgroundColor: Colors.green700, borderColor: Colors.green700 },
  dayLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.ink500 },
  dayLabelActive: { color: '#fff' },
  warn: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, textAlign: 'center', marginBottom: 8 },
  selectedCount: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, textAlign: 'center', marginBottom: 24 },
  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.ink900, marginBottom: 6 },
  slotHint: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, marginBottom: 16, lineHeight: 18 },
  slotRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  slotCard: {
    flex: 1,
    backgroundColor: Colors.cream50,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 8,
  },
  slotIcon: { fontSize: 28 },
  slotLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink900 },
  counter: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  counterBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: Colors.green700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterBtnText: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.green700 },
  counterValue: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.ink900, minWidth: 30, textAlign: 'center' },
  timingLine: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500, lineHeight: 18, marginBottom: 24 },
})
