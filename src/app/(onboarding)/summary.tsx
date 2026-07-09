import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useOnboardingStore } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'
import AllergenBadge from '@/components/AllergenBadge'

type Plan = { id: string; name: string; meals_total: number; base_price: number }

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(0)}`
}

const DAY_LETTER: Record<string, string> = {
  Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'T', Fri: 'F', Sat: 'S', Sun: 'S',
}

export default function SummaryScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useOnboardingStore()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!store.planId) return
    supabase
      .from('plans')
      .select('*')
      .eq('id', store.planId)
      .single()
      .then(({ data }) => {
        setPlan(data)
        setLoading(false)
      })
  }, [store.planId])

  const totalAddons = store.addOns.reduce((sum, a) => sum + a.pricePerMeal, 0)
  const mealsTotal = plan?.meals_total ?? 0
  const basePrice = plan?.base_price ?? 0
  const addonTotal = totalAddons * mealsTotal
  const grandTotal = basePrice + addonTotal

  const daysShort = store.selectedDays.map((d) => DAY_LETTER[d] ?? d[0]).join('  ')
  const freeTextConstraints = (store.dietaryFreeText ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.green700} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <SectionProgress current={4} sectionStep={2} sectionTotalSteps={3} />
        <View style={styles.header}>
          <Text style={styles.title}>Your subscription</Text>
        </View>

        {/* Plan details */}
        <Section title="Plan Details">
          <Row label="Plan" value={store.planName || plan?.name || '—'} />
          <Row label="Meals" value={`${mealsTotal} meals`} />
          <Row label="Delivery days" value={daysShort || '—'} />
          <Row label="Delivery mode" value={store.deliveryMode === 'opt-out' ? 'All days (skip as you go)' : 'Only selected days'} />
          <Row label="Lunch per day" value={String(store.mealsLunch)} />
          <Row label="Dinner per day" value={String(store.mealsDinner)} />
        </Section>

        {/* Add-ons */}
        {store.addOns.length > 0 && (
          <Section title="Add-Ons">
            {store.addOns.map((a) => (
              <Row
                key={a.id}
                label={a.name + (a.subOption ? ` (${a.subOption})` : '')}
                value={fmt(a.pricePerMeal) + '/meal'}
              />
            ))}
          </Section>
        )}

        {/* Dietary — every tag rendered as an allergen badge */}
        <Section title="Dietary Profile">
          <View style={styles.badgeRow}>
            {store.dietaryPreference !== 'none' && (
              <AllergenBadge label={store.dietaryPreference.charAt(0).toUpperCase() + store.dietaryPreference.slice(1)} />
            )}
            {store.allergens.map((a) => (
              <AllergenBadge key={a} label={`${a} Free`} />
            ))}
            {freeTextConstraints.map((c, i) => (
              <AllergenBadge key={`c-${i}`} label={c} />
            ))}
            {store.dietaryPreference === 'none' &&
              store.allergens.length === 0 &&
              freeTextConstraints.length === 0 && (
                <Text style={styles.noteText}>No restrictions</Text>
              )}
          </View>
        </Section>

        {/* Address */}
        <Section title="Delivery Address">
          <Row label="Type" value={store.addressLabel} />
          <Row label="Address" value={`${store.addressLine1}, Jaipur ${store.addressPincode}`} />
          {store.addressLandmark ? <Row label="Landmark" value={store.addressLandmark} /> : null}
        </Section>

        {/* Pricing */}
        <Section title="Pricing">
          <Row label={`Base plan (${mealsTotal} meals)`} value={fmt(basePrice)} />
          {store.addOns.map((a) => (
            <Row
              key={a.id}
              label={`${a.name} × ${mealsTotal}`}
              value={`+${fmt(a.pricePerMeal * mealsTotal)}`}
            />
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{fmt(grandTotal)}</Text>
          </View>
        </Section>

        <View style={styles.spacer} />
      </ScrollView>

      {/* Sticky CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}>
        <Button onPress={() => router.push('/(onboarding)/payment')}>Proceed to Payment →</Button>
      </View>
    </View>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cream50 },
  container: { flex: 1, backgroundColor: Colors.cream50 },
  scroll: { padding: 24, paddingBottom: 20 },
  header: { marginTop: 24, marginBottom: 24 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.ink900 },
  section: { marginBottom: 20 },
  sectionTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.ink500, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  sectionCard: {
    backgroundColor: Colors.cream100,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 12,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  rowLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, flex: 1 },
  rowValue: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink900, flex: 1, textAlign: 'right' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  noteText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, lineHeight: 18 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  totalLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink900 },
  totalValue: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.green700 },
  spacer: { height: 120 },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.cream50,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
})
