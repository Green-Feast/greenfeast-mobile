import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
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

type Plan = { id: string; name: string; meals_total: number; base_price: number }

function fmt(paise: number) {
  return `₹${(paise / 100).toFixed(0)}`
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.step}>Step 7 of 7</Text>
          <Text style={styles.title}>Your subscription</Text>
        </View>

        {/* Plan details */}
        <Section title="Plan Details">
          <Row label="Plan" value={store.planName || plan?.name || '—'} />
          <Row label="Meals" value={`${mealsTotal} meals`} />
          <Row label="Delivery days" value={store.selectedDays.join(', ') || '—'} />
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

        {/* Dietary */}
        <Section title="Dietary Profile">
          {store.allergens.length > 0 && (
            <View style={styles.badgeRow}>
              {store.allergens.map((a) => (
                <View key={a} style={styles.badge}>
                  <Text style={styles.badgeText}>{a} Free</Text>
                </View>
              ))}
            </View>
          )}
          {store.dietaryPreference !== 'none' && (
            <Row label="Preference" value={store.dietaryPreference.charAt(0).toUpperCase() + store.dietaryPreference.slice(1)} />
          )}
          {store.spicePreference ? <Row label="Spice" value={store.spicePreference} /> : null}
          {store.dressingPreference ? <Row label="Dressing" value={store.dressingPreference === 'mixed-in' ? 'Mixed in' : 'On the side'} /> : null}
          {store.dietaryFreeText ? (
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>{store.dietaryFreeText}</Text>
            </View>
          ) : null}
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
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.editLink}>Edit subscription</Text>
        </TouchableOpacity>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 20 },
  header: { marginBottom: 24 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text },
  section: { marginBottom: 20 },
  sectionTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  rowLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, flex: 1 },
  rowValue: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text, flex: 1, textAlign: 'right' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { backgroundColor: Colors.primaryLight, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },
  noteBox: { backgroundColor: Colors.background, borderRadius: 8, padding: 10 },
  noteText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 12,
  },
  totalLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  totalValue: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.primary },
  spacer: { height: 120 },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 10,
  },
  editLink: { fontFamily: Fonts.body, textAlign: 'center', fontSize: 14, color: Colors.textMuted, textDecorationLine: 'underline' },
})
