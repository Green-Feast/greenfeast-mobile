import { useState, useEffect } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Info } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useOnboardingStore, type PlanId, type AddOnSelection } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

type Plan = {
  id: PlanId
  name: string
  meals_total: number
  base_price: number
}

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

const SMOOTHIE_OPTIONS = ['Berry Banana Protein', 'Watermelon Mint Chia', 'Creamy Avocado']
const CHEESE_OPTIONS = ['Feta', 'Parmesan', 'Cheddar']

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(0)}`
}

export default function PlanScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { recommendation, upsellShown, setPlan } = useOnboardingStore()
  const [plans, setPlans] = useState<Plan[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [loading, setLoading] = useState(true)

  // Pre-select the recommended plan + add-ons (sub-flow.txt S10).
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(recommendation?.recommendedPlanId ?? null)
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    recommendation?.derivedAddons.forEach((id) => { init[id] = true })
    return init
  })
  const [subOptions, setSubOptions] = useState<Record<string, string>>({})
  const [subOptionModal, setSubOptionModal] = useState<string | null>(null)
  const [macroModal, setMacroModal] = useState<Addon | null>(null)

  useEffect(() => {
    Promise.all([
      supabase.from('plans').select('*').eq('is_active', true).order('meals_total'),
      supabase.from('addons').select('*').eq('is_active', true),
    ]).then(([{ data: p }, { data: a }]) => {
      setPlans((p ?? []) as Plan[])
      setAddons(a ?? [])
      setLoading(false)
    })
  }, [])

  const plan = plans.find((p) => p.id === selectedPlan)

  const totalAddons = addons
    .filter((a) => selectedAddons[a.id])
    .reduce((sum, a) => sum + a.price_per_meal, 0)

  const totalPaise = (plan?.base_price ?? 0) + totalAddons * (plan?.meals_total ?? 0)

  function toggleAddon(id: string) {
    setSelectedAddons((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      if (next[id] && (id === 'smoothie' || id === 'cheese')) {
        setSubOptionModal(id)
      }
      return next
    })
  }

  function handleNext() {
    if (!selectedPlan || !plan) return

    const addOnSelections: AddOnSelection[] = addons
      .filter((a) => selectedAddons[a.id])
      .map((a) => ({
        id: a.id,
        name: a.name,
        pricePerMeal: a.price_per_meal,
        subOption: subOptions[a.id],
      }))

    const planName = recommendation?.planName ?? 'Custom Plan'
    setPlan(selectedPlan, planName, addOnSelections)

    // S11 — if the user stripped a recommended add-on, show the upsell once
    const recommended = recommendation?.derivedAddons ?? []
    const removed = recommended.filter((id) => !selectedAddons[id])
    if (removed.length > 0 && !upsellShown) {
      router.push({ pathname: '/(onboarding)/addon-upsell', params: { removed: removed.join(',') } })
    } else {
      router.push('/(onboarding)/days')
    }
  }

  const subOpts = subOptionModal === 'smoothie' ? SMOOTHIE_OPTIONS : CHEESE_OPTIONS

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
      <SectionProgress current={3} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={20} color={Colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Choose your plan</Text>
        <Text style={styles.subtitle}>Customise your subscription</Text>
      </View>

      {/* Plan cards */}
      <Text style={styles.sectionLabel}>How many meals?</Text>
      <View style={styles.planCards}>
        {plans.map((p) => {
          const perMeal = Math.round(p.base_price / p.meals_total)
          const isSelected = selectedPlan === p.id
          return (
            <TouchableOpacity
              key={p.id}
              style={[styles.planCard, isSelected && styles.planCardActive]}
              onPress={() => setSelectedPlan(p.id as PlanId)}
            >
              <View style={styles.planCardLeft}>
                <Text style={[styles.planMeals, isSelected && styles.textPrimary]}>
                  {p.meals_total}
                </Text>
                <Text style={[styles.planMealsLabel, isSelected && styles.textPrimary]}>meals</Text>
              </View>
              <View style={styles.planCardRight}>
                <Text style={[styles.planName, isSelected && styles.textPrimary]}>{p.name}</Text>
                <Text style={styles.planPerMeal}>{fmt(perMeal)}/meal</Text>
                <Text style={[styles.planTotal, isSelected && styles.textPrimary]}>{fmt(p.base_price)} total</Text>
              </View>
              <View style={[styles.radio, isSelected && styles.radioActive]}>
                {isSelected && <View style={styles.radioDot} />}
              </View>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Add-ons */}
      <Text style={styles.sectionLabel}>Enhance your plan</Text>
      <View style={styles.addonList}>
        {addons.map((a) => {
          const isOn = !!selectedAddons[a.id]
          const subOpt = subOptions[a.id]
          return (
            <TouchableOpacity
              key={a.id}
              style={[styles.addonRow, isOn && styles.addonRowActive]}
              onPress={() => toggleAddon(a.id)}
            >
              <View style={[styles.checkbox, isOn && styles.checkboxActive]}>
                {isOn && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <View style={styles.addonInfo}>
                <Text style={styles.addonName}>
                  {a.name}
                  {subOpt ? ` (${subOpt})` : ''}
                </Text>
                {a.description && <Text style={styles.addonDesc}>{a.description}</Text>}
                {isOn && (a.id === 'smoothie' || a.id === 'cheese') && (
                  <TouchableOpacity onPress={() => setSubOptionModal(a.id)}>
                    <Text style={styles.changeVariant}>
                      {subOpt ? 'Change variant ›' : 'Pick variant ›'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.addonRight}>
                <TouchableOpacity
                  style={styles.infoBtn}
                  onPress={() => setMacroModal(a)}
                  hitSlop={8}
                >
                  <Info size={16} color={Colors.textMuted} />
                </TouchableOpacity>
                <Text style={styles.addonPrice}>{fmt(a.price_per_meal)}/meal</Text>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* Price summary */}
      {selectedPlan && (
        <View style={styles.priceSummary}>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Base plan</Text>
            <Text style={styles.priceValue}>{fmt(plan?.base_price ?? 0)}</Text>
          </View>
          {addons.filter((a) => selectedAddons[a.id]).map((a) => (
            <View key={a.id} style={styles.priceRow}>
              <Text style={styles.priceLabel}>{a.name}</Text>
              <Text style={styles.priceValue}>
                +{fmt(a.price_per_meal * (plan?.meals_total ?? 0))}
              </Text>
            </View>
          ))}
          <View style={[styles.priceRow, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{fmt(totalPaise)}</Text>
          </View>
        </View>
      )}

      <Button onPress={handleNext} disabled={!selectedPlan}>Next →</Button>

      {/* Sub-option picker modal */}
      <Modal
        visible={!!subOptionModal}
        transparent
        animationType="slide"
        onRequestClose={() => setSubOptionModal(null)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setSubOptionModal(null)}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            Pick {subOptionModal === 'smoothie' ? 'flavour' : 'cheese type'}
          </Text>
          {subOpts.map((opt) => (
            <TouchableOpacity
              key={opt}
              style={styles.sheetOption}
              onPress={() => {
                setSubOptions((prev) => ({ ...prev, [subOptionModal!]: opt }))
                setSubOptionModal(null)
              }}
            >
              <Text style={styles.sheetOptionText}>{opt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Add-on macro popover */}
      <Modal
        visible={!!macroModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMacroModal(null)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMacroModal(null)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          {macroModal && (
            <>
              <Text style={styles.sheetTitle}>{macroModal.name} · per meal</Text>
              {macroModal.description && <Text style={styles.macroDesc}>{macroModal.description}</Text>}
              <View style={styles.macroGrid}>
                <MacroBox label="Kcal" value={macroModal.kcal != null ? `${macroModal.kcal}` : '—'} />
                <MacroBox label="Protein" value={macroModal.protein != null ? `${macroModal.protein}g` : '—'} />
                <MacroBox label="Carbs" value={macroModal.carbs != null ? `${macroModal.carbs}g` : '—'} />
                <MacroBox label="Fat" value={macroModal.fat != null ? `${macroModal.fat}g` : '—'} />
              </View>
            </>
          )}
        </View>
      </Modal>
    </ScrollView>
  )
}

function MacroBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macroBox}>
      <Text style={styles.macroVal}>{value}</Text>
      <Text style={styles.macroLbl}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 28 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.primary },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  sectionLabel: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text, marginBottom: 12 },
  planCards: { gap: 10, marginBottom: 28 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  planCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  planCardLeft: { alignItems: 'center', minWidth: 48 },
  planMeals: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  planMealsLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted },
  planCardRight: { flex: 1 },
  planName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 2 },
  planPerMeal: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 2 },
  planTotal: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  textPrimary: { color: Colors.primary },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  addonList: { gap: 10, marginBottom: 24 },
  addonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  addonRowActive: { borderColor: Colors.primary },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkmark: { fontFamily: Fonts.bodyBold, color: '#fff', fontSize: 13 },
  addonInfo: { flex: 1 },
  addonName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  addonDesc: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  changeVariant: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, marginTop: 4 },
  addonRight: { alignItems: 'flex-end', gap: 8 },
  infoBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  addonPrice: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  priceSummary: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginBottom: 20,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between' },
  priceLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  priceValue: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10 },
  totalLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  totalValue: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.primary },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: { fontFamily: Fonts.headingSemi, fontSize: 17, color: Colors.text, marginBottom: 16 },
  sheetOption: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetOptionText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.text },
  macroDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 19, marginBottom: 16 },
  macroGrid: { flexDirection: 'row', gap: 10 },
  macroBox: { flex: 1, backgroundColor: Colors.primaryLight, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  macroVal: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.primary },
  macroLbl: { fontFamily: Fonts.body, fontSize: 11, color: Colors.primary, marginTop: 2 },
})
