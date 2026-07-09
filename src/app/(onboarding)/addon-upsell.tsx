import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useOnboardingStore } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

type Addon = { id: string; name: string; description: string | null; price_per_meal: number }

const GOAL_TEXT: Record<string, string> = {
  'build-muscle': 'build muscle',
  'lose-weight': 'lose weight',
  'improve-wellness': 'improve wellness',
  'boost-energy': 'boost energy',
}

function fmt(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

// S11 — loss-aversion re-add prompt, shown once when a recommended add-on is
// stripped in the Plan Builder. Only the removed add-ons are surfaced here.
export default function AddonUpsellScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { removed } = useLocalSearchParams<{ removed: string }>()
  const { healthGoal, planId, planName, addOns, setPlan, setUpsellShown } = useOnboardingStore()

  const removedIds = (removed ?? '').split(',').filter(Boolean)
  const [addons, setAddons] = useState<Addon[]>([])
  const [loading, setLoading] = useState(true)
  const [addedBack, setAddedBack] = useState<string[]>([])

  useEffect(() => {
    supabase
      .from('addons')
      .select('*')
      .in('id', removedIds.length ? removedIds : ['__none__'])
      .then(({ data }) => {
        setAddons((data ?? []) as Addon[])
        setLoading(false)
      })
  }, [])

  function addBack(a: Addon) {
    if (addOns.some((x) => x.id === a.id)) return
    setPlan(planId!, planName, [...addOns, { id: a.id, name: a.name, pricePerMeal: a.price_per_meal }])
    setAddedBack((prev) => [...prev, a.id])
  }

  function handleContinue() {
    setUpsellShown()
    router.replace('/(onboarding)/days')
  }

  const goalText = GOAL_TEXT[healthGoal ?? ''] ?? 'reach your goal'

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: 40 + insets.bottom }]}>
      <SectionProgress current={3} sectionStep={4} sectionTotalSteps={5} />
      <Text style={styles.title}>Before you continue</Text>
      <Text style={styles.subtitle}>These add-ons were picked for your goal.</Text>

      {addons.map((a) => {
        const isAdded = addedBack.includes(a.id) || addOns.some((x) => x.id === a.id)
        return (
          <View key={a.id} style={styles.card}>
            <Text style={styles.cardBody}>
              Your goal is to <Text style={styles.bold}>{goalText}</Text>. You removed{' '}
              <Text style={styles.bold}>{a.name}</Text> from your plan.
            </Text>
            {a.description ? <Text style={styles.cardDesc}>{a.description}</Text> : null}
            {isAdded ? (
              <View style={styles.addedRow}>
                <Check size={16} color={Colors.primary} strokeWidth={3} />
                <Text style={styles.addedText}>Added back · {fmt(a.price_per_meal)}/meal</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.addBtn} onPress={() => addBack(a)}>
                <Text style={styles.addBtnText}>Add back to my plan · {fmt(a.price_per_meal)}/meal</Text>
              </TouchableOpacity>
            )}
          </View>
        )
      })}

      <Button onPress={handleContinue} style={{ marginTop: 8 }}>Continue →</Button>
      <TouchableOpacity style={styles.skip} onPress={handleContinue}>
        <Text style={styles.skipText}>skip and continue →</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, marginBottom: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  cardBody: { fontFamily: Fonts.body, fontSize: 15, color: Colors.text, lineHeight: 22 },
  bold: { fontFamily: Fonts.bodyBold, color: Colors.text },
  cardDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 6 },
  addBtn: {
    marginTop: 16,
    backgroundColor: Colors.primaryLight,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
  },
  addBtnText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.primary },
  addedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  addedText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },
  skip: { alignItems: 'center', marginTop: 14 },
  skipText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textDecorationLine: 'underline' },
})
