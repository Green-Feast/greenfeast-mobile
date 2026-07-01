import { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useOnboardingStore, type AddOnSelection } from '@/store/onboarding'
import { MENU_LABELS, M2_INFO, CONSTRAINT_LABELS } from '@/lib/recommendation'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import OnboardingProgress from '@/components/OnboardingProgress'
import AllergenBadge from '@/components/AllergenBadge'
import MacroRow from '@/components/MacroRow'

type Plan = { id: string; name: string; meals_total: number; base_price: number }
type Addon = {
  id: string
  name: string
  description: string | null
  price_per_meal: number
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
}

const { width } = Dimensions.get('window')
const PAGE_W = width

function fmt(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

export default function RecommendationScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { recommendation, allergens, proteinTarget, dietaryFreeText, setPlan } = useOnboardingStore()

  const [plans, setPlans] = useState<Plan[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const scrollRef = useRef<ScrollView>(null)

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

  useFocusEffect(
    useCallback(() => {
      if (!recommendation) router.replace('/(onboarding)/health')
    }, [recommendation, router])
  )

  if (!recommendation) return null

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.green700} size="large" />
      </View>
    )
  }

  const { planName, tagline, menuType, derivedAddons, derivedConstraints, recommendedPlanId } = recommendation

  const plan = plans.find((p) => p.id === recommendedPlanId)
  const trialPlan = plans.find((p) => p.id === 'trial')
  const addonRows = addons.filter((a) => derivedAddons.includes(a.id))
  const addonPerMeal = addonRows.reduce((s, a) => s + a.price_per_meal, 0)

  const mealsTotal = plan?.meals_total ?? 0
  const baseMealRate = plan ? Math.round(plan.base_price / Math.max(plan.meals_total, 1)) : 0
  const perMealAllIn = baseMealRate + addonPerMeal
  const total = plan ? plan.base_price + addonPerMeal * mealsTotal : 0
  const trialTotal = trialPlan ? trialPlan.base_price + addonPerMeal * trialPlan.meals_total : 0

  const proteinNum = parseInt(proteinTarget)
  const showProtein = !isNaN(proteinNum) && proteinNum > 0
  const hasExtraProtein = derivedAddons.includes('extra-protein')
  const proteinPerMeal = hasExtraProtein ? 35 : 25

  // Approx per-meal macros = a balanced base meal + each add-on's contribution.
  // Base protein (25) + extra-protein add-on (+10) lands at the 35g headline.
  const BASE_MEAL = { kcal: 450, protein: 25, carbs: 45, fat: 15 }
  const sumMacro = (k: 'kcal' | 'protein' | 'carbs' | 'fat') =>
    addonRows.reduce((s, a) => s + (a[k] ?? 0), 0)
  const mealMacros = {
    kcal: Math.round(BASE_MEAL.kcal + sumMacro('kcal')),
    protein: Math.round(BASE_MEAL.protein + sumMacro('protein')),
    carbs: Math.round(BASE_MEAL.carbs + sumMacro('carbs')),
    fat: Math.round(BASE_MEAL.fat + sumMacro('fat')),
  }

  // Free-text dietary notes → individual pills.
  const freeTextPills = dietaryFreeText
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)

  // Pills: allergen "X Free" + free-text notes + derived constraints.
  const pills = [
    ...allergens.map((a) => `${a} Free`),
    ...freeTextPills,
    ...derivedConstraints.map((c) => CONSTRAINT_LABELS[c] ?? c),
  ]

  const menuStyle = menuType === 'M2'
    ? M2_INFO
    : {
        title: 'Global Kitchen',
        body: 'A rotating world tour of balanced, protein-forward meals — never repetitive, always satisfying. Want something different on a given day? Swap freely, anytime.',
      }

  function buildAddOns(): AddOnSelection[] {
    return addonRows.map((a) => ({ id: a.id, name: a.name, pricePerMeal: a.price_per_meal }))
  }
  function handleAccept() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setPlan(recommendedPlanId, planName, buildAddOns())
    router.push('/(onboarding)/days')
  }
  function handleTrial() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPlan('trial', planName, buildAddOns())
    router.push('/(onboarding)/days')
  }
  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / PAGE_W)
    if (next !== page) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setPage(next)
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={styles.padded}>
          <OnboardingProgress steps={4} current={3} />
        </View>

        {/* 4-card carousel */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
        >
          {/* Card 1 — Recommendation */}
          <Page>
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Built for you</Text>
              <Text style={styles.script}>made for you</Text>
              <Text style={styles.planName}>{planName}</Text>
              <Text style={styles.tagline}>{tagline}</Text>
              <View style={styles.menuBadge}>
                <Text style={styles.menuBadgeText}>{MENU_LABELS[menuType]}</Text>
              </View>

              <View style={styles.checklist}>
                {addonRows.map((a) => <ChecklistItem key={a.id} label={`${a.name} included`} />)}
                <ChecklistItem label="No repeat meals for 12+ days" />
              </View>

              {pills.length > 0 && (
                <View style={styles.pillRow}>
                  {pills.map((p) => <AllergenBadge key={p} label={p} />)}
                </View>
              )}

              {showProtein && (
                <Text style={styles.proteinLine}>
                  Each meal contributes ~{proteinPerMeal}g protein toward your {proteinNum}g daily target.
                </Text>
              )}

              <Text style={styles.social}>Members on the {planName} plan see the best results.</Text>
            </View>
          </Page>

          {/* Card 2 — Your menu style */}
          <Page>
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Your menu style</Text>
              <Text style={styles.cardTitle}>{menuStyle.title}</Text>
              <View style={styles.menuBadge}>
                <Text style={styles.menuBadgeText}>{MENU_LABELS[menuType]}</Text>
              </View>
              <Text style={styles.menuBody}>{menuStyle.body}</Text>
            </View>
          </Page>

          {/* Card 3 — Macro breakdown */}
          <Page>
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Macro breakdown</Text>
              <Text style={styles.cardTitle}>What's in each meal</Text>

              {/* Full approx macros per meal (base meal + your add-ons) */}
              <View style={styles.macroRowWrap}>
                <MacroRow
                  kcal={mealMacros.kcal}
                  protein={mealMacros.protein}
                  carbs={mealMacros.carbs}
                  fat={mealMacros.fat}
                  size="lg"
                />
              </View>

              {addonRows.length > 0 ? (
                <View style={styles.macroList}>
                  <Text style={styles.macroListHead}>Add-on contributions (per meal)</Text>
                  {addonRows.map((a) => (
                    <View key={a.id} style={styles.macroLine}>
                      <Text style={styles.macroName}>{a.name}</Text>
                      <Text style={styles.macroVals}>
                        {[
                          a.kcal != null ? `${a.kcal} kcal` : null,
                          a.protein != null ? `${a.protein}g P` : null,
                          a.carbs != null ? `${a.carbs}g C` : null,
                          a.fat != null ? `${a.fat}g F` : null,
                        ].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.menuBody}>No add-ons — clean macros straight from the kitchen.</Text>
              )}

              <Text style={styles.macroNote}>Exact macros vary by dish across the rotating menu.</Text>
            </View>
          </Page>

          {/* Card 4 — Price breakdown */}
          <Page>
            <View style={styles.card}>
              <Text style={styles.eyebrow}>Price breakdown</Text>
              <Text style={styles.cardTitle}>{mealsTotal} meals</Text>

              <View style={styles.priceList}>
                <View style={styles.priceLine}>
                  <Text style={styles.priceLabel}>Base plan</Text>
                  <Text style={styles.priceValue}>{fmt(plan?.base_price ?? 0)}</Text>
                </View>
                {addonRows.map((a) => (
                  <View key={a.id} style={styles.priceLine}>
                    <Text style={styles.priceLabel}>{a.name} × {mealsTotal}</Text>
                    <Text style={styles.priceValue}>+{fmt(a.price_per_meal * mealsTotal)}</Text>
                  </View>
                ))}
                <View style={styles.priceLine}>
                  <Text style={styles.priceLabel}>Per meal, all-in</Text>
                  <Text style={styles.priceValue}>{fmt(perMealAllIn)}</Text>
                </View>
              </View>

              {/* Total on its own line */}
              <View style={styles.totalBlock}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{fmt(total)}</Text>
              </View>
            </View>
          </Page>
        </ScrollView>

        {/* Dots */}
        <View style={styles.dots}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
          ))}
        </View>

        <View style={styles.padded}>
          <Button onPress={handleAccept} style={{ marginBottom: 12 }}>Get this plan →</Button>

          {/* 5-meal trial — styled like the CTA but not green */}
          <TouchableOpacity style={styles.trialBtn} onPress={handleTrial} activeOpacity={0.85}>
            <Text style={styles.trialBtnText}>Try 5 meals first · {fmt(trialTotal)}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.rejectLink}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
              router.push('/(onboarding)/plan')
            }}
          >
            <Text style={styles.rejectLinkText}>or choose a different plan</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return <View style={{ width: PAGE_W, paddingHorizontal: 24 }}>{children}</View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cream50 },
  container: { flex: 1, backgroundColor: Colors.cream50 },
  padded: { paddingHorizontal: 24 },

  card: {
    backgroundColor: Colors.cream50,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: Colors.green700,
    padding: 24,
    minHeight: 380,
  },
  eyebrow: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.green700, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  script: { fontFamily: Fonts.script, fontSize: 22, color: Colors.green700, marginBottom: 2 },
  planName: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.ink900, marginBottom: 6 },
  cardTitle: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.ink900, marginBottom: 12 },
  tagline: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, lineHeight: 20, marginBottom: 14 },
  menuBadge: { alignSelf: 'flex-start', backgroundColor: Colors.green700, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 18 },
  menuBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#fff' },
  menuBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, lineHeight: 22 },

  checklist: { gap: 12, marginBottom: 18 },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.green700, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { fontFamily: Fonts.bodyMed, fontSize: 15, color: Colors.ink900 },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 18 },

  proteinLine: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, lineHeight: 18, marginBottom: 14 },
  social: { fontFamily: Fonts.body, fontSize: 13, color: Colors.green700 },

  macroRowWrap: { marginBottom: 18 },
  macroList: { gap: 10 },
  macroListHead: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.ink500, textTransform: 'uppercase', letterSpacing: 1 },
  macroLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  macroName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink900 },
  macroVals: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500, textAlign: 'right', flexShrink: 1 },
  macroNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink400, marginTop: 16 },

  priceList: { gap: 12, marginBottom: 18 },
  priceLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  priceLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, flex: 1 },
  priceValue: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink900 },
  totalBlock: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 16 },
  totalLabel: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.ink500, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  totalValue: { fontFamily: Fonts.heading, fontSize: 30, color: Colors.green700 },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 16, marginBottom: 24 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.green700, width: 20 },

  trialBtn: {
    borderWidth: 1.5,
    borderColor: Colors.green700,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginBottom: 16,
    backgroundColor: Colors.cream50,
  },
  trialBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.green700 },
  rejectLink: { alignItems: 'center' },
  rejectLinkText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, textDecorationLine: 'underline' },
})
