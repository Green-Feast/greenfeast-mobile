import { useEffect, useState, useCallback } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useOnboardingStore, type AddOnSelection } from '@/store/onboarding'
import { MENU_LABELS, M2_INFO } from '@/lib/recommendation'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

type Plan = { id: string; name: string; meals_total: number; base_price: number }
type Addon = { id: string; name: string; description: string | null; price_per_meal: number }

// Representative protein per meal — makes the "toward your target" line concrete
// without committing to a specific dish (real value varies 18–28g across the menu).
const AVG_PROTEIN_PER_MEAL = 25

function fmt(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

export default function RecommendationScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { recommendation, allergens, proteinTarget, setPlan } = useOnboardingStore()

  const [plans, setPlans] = useState<Plan[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('plans').select('*').eq('is_active', true),
      supabase.from('addons').select('*').eq('is_active', true),
    ]).then(([{ data: p }, { data: a }]) => {
      setPlans((p ?? []) as Plan[])
      setAddons((a ?? []) as Addon[])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  // Guard: only redirect when this screen is actually focused (not during background re-renders)
  useFocusEffect(
    useCallback(() => {
      if (!recommendation) router.replace('/(onboarding)/health')
    }, [recommendation, router])
  )

  if (!recommendation) return null

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    )
  }

  const { planName, tagline, menuType, derivedAddons, recommendedMealCount, recommendedPlanId } = recommendation

  const plan = plans.find((p) => p.id === recommendedPlanId)
  const trialPlan = plans.find((p) => p.id === 'trial')
  const addonRows = addons.filter((a) => derivedAddons.includes(a.id))
  const addonPerMeal = addonRows.reduce((s, a) => s + a.price_per_meal, 0)

  const perMealAllIn = plan ? Math.round(plan.base_price / plan.meals_total) + addonPerMeal : 0
  const total = plan ? plan.base_price + addonPerMeal * plan.meals_total : 0
  const trialTotal = trialPlan ? trialPlan.base_price + addonPerMeal * trialPlan.meals_total : 0

  const proteinNum = parseInt(proteinTarget)
  const showProtein = !isNaN(proteinNum) && proteinNum > 0

  function buildAddOns(): AddOnSelection[] {
    return addonRows.map((a) => ({ id: a.id, name: a.name, pricePerMeal: a.price_per_meal }))
  }

  function handleAccept() {
    setPlan(recommendedPlanId, planName, buildAddOns())
    router.push('/(onboarding)/days')
  }

  function handleTrial() {
    setPlan('trial', planName, buildAddOns())
    router.push('/(onboarding)/days')
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
      <SectionProgress current={3} />

      {/* Main plan card */}
      <View style={styles.planCard}>
        <View style={styles.planCardTop}>
          <Text style={styles.eyebrow}>Built for you</Text>
          <Text style={styles.planName}>{planName}</Text>
          <Text style={styles.tagline}>{tagline}</Text>
          <View style={styles.menuBadge}>
            <Text style={styles.menuBadgeText}>{MENU_LABELS[menuType]}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.planCardBottom}>
          {/* Checklist */}
          <View style={styles.checklist}>
            {addonRows.map((a) => (
              <ChecklistItem key={a.id} label={`${a.name} included`} />
            ))}
            <ChecklistItem label={`${recommendedMealCount} meals a month`} />
            <ChecklistItem label="No repeat meals for 12+ days" />
          </View>

          {/* Allergen trust badges */}
          {allergens.length > 0 && (
            <View style={styles.badgeRow}>
              {allergens.map((a) => (
                <View key={a} style={styles.badge}>
                  <Text style={styles.badgeText}>{a} Free</Text>
                </View>
              ))}
            </View>
          )}

          {showProtein && (
            <Text style={styles.proteinLine}>
              Each meal contributes ~{AVG_PROTEIN_PER_MEAL}g protein toward your {proteinNum}g daily target.
            </Text>
          )}

          {/* Price */}
          <View style={styles.priceRow}>
            <Text style={styles.perMeal}>{fmt(perMealAllIn)}<Text style={styles.perMealUnit}>/meal</Text></Text>
            <Text style={styles.total}>{fmt(total)} total</Text>
          </View>

          <Text style={styles.social}>People on the {planName} plan stick with it longer.</Text>
        </View>
      </View>

      {/* M2 informational moment — describes the menu flavour, not the plan name */}
      {menuType === 'M2' && (
        <View style={styles.infoCard}>
          <Text style={styles.infoMenuLabel}>YOUR MENU STYLE</Text>
          <Text style={styles.infoTitle}>{M2_INFO.title}</Text>
          <Text style={styles.infoBody}>{M2_INFO.body}</Text>
        </View>
      )}

      <Button onPress={handleAccept} style={{ marginBottom: 16 }}>Get this plan →</Button>

      {/* Trial sub-card */}
      <Text style={styles.trialPrompt}>Not ready for full commitment?</Text>
      <TouchableOpacity style={styles.trialCard} onPress={handleTrial}>
        <View>
          <Text style={styles.trialTitle}>Try 5 meals first</Text>
          <Text style={styles.trialSub}>Same plan, same add-ons · {fmt(trialTotal)}</Text>
        </View>
        <Text style={styles.trialArrow}>→</Text>
      </TouchableOpacity>
      <Text style={styles.trialFootnote}>Small commitments lead to great results.</Text>

      <TouchableOpacity style={styles.rejectLink} onPress={() => router.push('/(onboarding)/plan')}>
        <Text style={styles.rejectLinkText}>or choose a different plan</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

function ChecklistItem({ label }: { label: string }) {
  return (
    <View style={styles.checkItem}>
      <View style={styles.checkIcon}>
        <Check size={13} color="#fff" strokeWidth={3} />
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 48 },
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
  eyebrow: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  planName: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, marginBottom: 6 },
  tagline: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 14 },
  menuBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  menuBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#fff' },
  divider: { height: 1, backgroundColor: Colors.border },
  planCardBottom: { padding: 24 },
  checklist: { gap: 12, marginBottom: 18 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkIcon: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  checkLabel: { fontFamily: Fonts.bodyMed, fontSize: 15, color: Colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 },
  badge: { backgroundColor: Colors.background, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted },
  proteinLine: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 18, marginBottom: 18 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 8 },
  perMeal: { fontFamily: Fonts.heading, fontSize: 34, color: Colors.text },
  perMealUnit: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.textMuted },
  total: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  social: { fontFamily: Fonts.body, fontSize: 13, color: Colors.primary },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  infoMenuLabel: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 },
  infoTitle: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.text, marginBottom: 6 },
  infoBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 19 },
  trialPrompt: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text, marginBottom: 10 },
  trialCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trialTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text, marginBottom: 4 },
  trialSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  trialArrow: { fontFamily: Fonts.bodyBold, fontSize: 20, color: Colors.primary },
  trialFootnote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginBottom: 24 },
  rejectLink: { alignItems: 'center' },
  rejectLinkText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textDecorationLine: 'underline' },
})
