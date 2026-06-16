import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useOnboardingStore } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'

const ADDON_LABELS: Record<string, string> = {
  'smoothie': 'Smoothie',
  'exotic-fruits': 'Exotic Cut Fruits',
  'cheese': 'Extra Cheese',
}

const MENU_LABELS: Record<string, string> = {
  M1: 'Global Menu',
  M2: 'Gut Health Menu',
}

const GOAL_LABELS: Record<string, string> = {
  'build-muscle': 'building muscle',
  'lose-weight': 'losing weight',
  'improve-wellness': 'improving wellness',
  'boost-energy': 'boosting energy',
}

function derivePlanName(goal: string, q1: string): string {
  if (goal === 'build-muscle') return q1 === 'cut' ? 'Lean & Strong' : 'Fuel & Grow'
  if (goal === 'lose-weight') {
    if (q1 === 'bloating') return 'Gut Reset'
    if (q1 === 'lean-out') return 'Lean & Clean'
    return 'Balance & Heal'
  }
  if (goal === 'improve-wellness') return q1 === 'clean' ? 'Everyday Green' : 'Gut Health Pro'
  return q1 === 'crash' ? 'Energy Reset' : 'Power Up'
}

export default function RecommendationScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { healthGoal, derivedMenu, derivedAddons, q1Answer, setPlan } = useOnboardingStore()

  const planName = derivePlanName(healthGoal ?? '', q1Answer)

  function buildAddOnSelections() {
    return derivedAddons.map((id) => ({
      id,
      name: ADDON_LABELS[id] ?? id,
      pricePerMeal: id === 'smoothie' ? 6000 : id === 'exotic-fruits' ? 5000 : 3000,
    }))
  }

  function handleAccept() {
    setPlan('plan30', planName, buildAddOnSelections())
    router.push('/(onboarding)/days')
  }

  function handleTrial() {
    setPlan('trial', planName, buildAddOnSelections())
    router.push('/(onboarding)/days')
  }

  function handleChooseDifferent() {
    router.push('/(onboarding)/plan')
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
      <View style={styles.header}>
        <Text style={styles.step}>Step 4 of 6</Text>
        <Text style={styles.title}>Your personalised plan</Text>
        <Text style={styles.subtitle}>
          Based on your goal of {GOAL_LABELS[healthGoal ?? ''] ?? 'wellness'}
        </Text>
      </View>

      {/* Main plan card */}
      <View style={styles.planCard}>
        <View style={styles.planCardTop}>
          <Text style={styles.planName}>{planName}</Text>

          {derivedMenu && (
            <View style={styles.menuBadge}>
              <Text style={styles.menuBadgeText}>{MENU_LABELS[derivedMenu]}</Text>
            </View>
          )}

          {derivedMenu === 'M2' && (
            <Text style={styles.menuDesc}>
              Built around anti-inflammatory ingredients and gut-friendly portions.
            </Text>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.planCardBottom}>
          <View style={styles.mealsRow}>
            <Text style={styles.mealCount}>30</Text>
            <Text style={styles.mealCountLabel}>meals</Text>
            <Text style={styles.mealCountSub}>· Monthly plan · ₹7,499</Text>
          </View>

          {derivedAddons.length > 0 && (
            <View style={styles.addonsRow}>
              <Text style={styles.addonsLabel}>Recommended add-ons:</Text>
              <View style={styles.addonPills}>
                {derivedAddons.map((id) => (
                  <View key={id} style={styles.addonPill}>
                    <Text style={styles.addonPillText}>{ADDON_LABELS[id] ?? id}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Trial sub-card */}
      <TouchableOpacity style={styles.trialCard} onPress={handleTrial}>
        <View>
          <Text style={styles.trialTitle}>Try this as a 5-meal plan first</Text>
          <Text style={styles.trialSub}>Small commitment · ₹1,499</Text>
        </View>
        <Text style={styles.trialArrow}>→</Text>
      </TouchableOpacity>

      <Button onPress={handleAccept} style={{ marginBottom: 14 }}>Yes, I'll try this →</Button>

      <TouchableOpacity style={styles.rejectLink} onPress={handleChooseDifferent}>
        <Text style={styles.rejectLinkText}>Choose a different plan</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 48 },
  header: { marginBottom: 24 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  planCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.primary,
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  planCardTop: { padding: 24, backgroundColor: Colors.primaryLight },
  planName: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.primary, marginBottom: 10 },
  menuBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: 8,
  },
  menuBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#fff' },
  menuDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  divider: { height: 1, backgroundColor: Colors.border },
  planCardBottom: { padding: 24 },
  mealsRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginBottom: 16 },
  mealCount: { fontFamily: Fonts.heading, fontSize: 36, color: Colors.text },
  mealCountLabel: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.text },
  mealCountSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  addonsRow: { gap: 8 },
  addonsLabel: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  addonPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  addonPill: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  addonPillText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },
  trialCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trialTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text, marginBottom: 4 },
  trialSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  trialArrow: { fontFamily: Fonts.bodyBold, fontSize: 20, color: Colors.primary },
  rejectLink: { alignItems: 'center' },
  rejectLinkText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textDecorationLine: 'underline' },
})
