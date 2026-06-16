import { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { useOnboardingStore } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import RazorpayWebView from '@/components/RazorpayWebView'

type Method = 'razorpay' | 'cod'
type Phase = 'summary' | 'creating' | 'checkout' | 'success'

const PLAN_AMOUNTS: Record<string, number> = {
  trial: 149900,
  plan15: 405000,
  plan30: 749900,
}

const PLAN_DELIVERIES: Record<string, number> = {
  trial: 5,
  plan15: 15,
  plan30: 30,
}

const DAY_MAP: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

function nextOccurrence(weekday: number): string {
  const today = new Date()
  const current = today.getDay() === 0 ? 7 : today.getDay()
  let daysAhead = weekday - current
  if (daysAhead <= 0) daysAhead += 7
  const target = new Date(today)
  target.setDate(today.getDate() + daysAhead)
  return target.toISOString().split('T')[0]
}

function fmtRupees(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`
}

export default function PaymentScreen() {
  const insets = useSafeAreaInsets()
  const { setOnboarded, setHasSubscription, phone } = useAuthStore()
  const store = useOnboardingStore()

  const [method, setMethod] = useState<Method>('razorpay')
  const [phase, setPhase] = useState<Phase>('summary')
  const [error, setError] = useState('')
  const [userName, setUserName] = useState('')

  // Set after DB records created
  const [subscriptionId, setSubscriptionId] = useState('')
  const [firstDelivery, setFirstDelivery] = useState('')

  // Set after Razorpay order created
  const [rzpOrder, setRzpOrder] = useState<{
    orderId: string; amount: number; keyId: string
  } | null>(null)

  const planAmount = PLAN_AMOUNTS[store.planId ?? ''] ?? 149900
  const addonTotal = store.addOns.reduce((s, a) => s + a.pricePerMeal, 0) * (PLAN_DELIVERIES[store.planId ?? ''] ?? 5)
  const grandTotal = planAmount + addonTotal

  async function createRecords(): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Display name for Razorpay checkout prefill (cosmetic)
    const { data: profile } = await supabase.from('users').select('name').eq('id', user.id).single()
    setUserName(profile?.name ?? (user.user_metadata?.full_name as string) ?? '')

    // 1. Create address
    const { data: addr, error: addrErr } = await supabase
      .from('addresses')
      .insert({
        user_id: user.id,
        label: store.addressLabel,
        type: store.addressType,
        line1: store.addressLine1,
        city: 'Jaipur',
        pincode: store.addressPincode,
        landmark: store.addressLandmark || null,
        is_default: true,
      })
      .select('id')
      .single()
    if (addrErr) throw addrErr

    // 2. Upsert dietary profile
    const { error: dietErr } = await supabase
      .from('dietary_profiles')
      .upsert({
        user_id: user.id,
        allergens: store.allergens,
        dietary_preference: store.dietaryPreference,
        protein_preference: store.proteinPreference,
        base_avoidance: store.baseAvoidance,
        veggie_avoidance: store.veggieAvoidance,
        spice_preference: store.spicePreference || null,
        dressing_preference: store.dressingPreference || null,
        free_text: store.dietaryFreeText || null,
        health_goal: store.healthGoal,
        weight: store.weight || null,
        height: store.height || null,
        exercise_type: store.exerciseType,
        exercise_frequency: store.exerciseFrequency || null,
        occupation: store.occupation || null,
      }, { onConflict: 'user_id' })
    if (dietErr) throw dietErr

    // 3. Upsert questionnaire response
    if (store.q1Answer) {
      await supabase
        .from('questionnaire_responses')
        .upsert({
          user_id: user.id,
          health_goal: store.healthGoal,
          q1_answer: store.q1Answer,
          q2_answer: store.q2Answer || null,
          derived_menu: store.derivedMenu,
          derived_addons: store.derivedAddons,
        }, { onConflict: 'user_id' })
    }

    // 4. Calculate start date
    const minDay = Math.min(...store.selectedDays.map((d) => DAY_MAP[d]))
    const startDate = nextOccurrence(minDay)
    setFirstDelivery(startDate)

    // 5. Create subscription — status 'pending' until payment confirmed
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .insert({
        user_id: user.id,
        plan_id: store.planId,
        plan_name: store.planName || null,
        menu_type: store.derivedMenu || null,
        status: 'pending',
        payment_method: method === 'cod' ? 'cod' : 'online',
        delivery_mode: store.deliveryMode,
        meals_per_day: store.mealsLunch + store.mealsDinner,
        meals_lunch: store.mealsLunch,
        meals_dinner: store.mealsDinner,
        deliveries_remaining: 0,
      })
      .select('id')
      .single()
    if (subErr) throw subErr

    // 6. Create subscription_addons
    if (store.addOns.length > 0) {
      const { error: addErr } = await supabase
        .from('subscription_addons')
        .insert(
          store.addOns.map((a) => ({
            subscription_id: sub.id,
            addon_id: a.id,
            sub_option: a.subOption ?? null,
          }))
        )
      if (addErr) throw addErr
    }

    // 7. Create subscription_schedule (assign a starter meal to each day)
    const { data: starterMeal } = await supabase
      .from('meal_templates')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .single()

    if (starterMeal) {
      await supabase
        .from('subscription_schedule')
        .insert(
          store.selectedDays.map((day) => ({
            subscription_id: sub.id,
            day_of_week: day,
            meal_template_id: starterMeal.id,
          }))
        )
    }

    // 8. Create wallet (idempotent)
    await supabase.from('wallets').upsert({ user_id: user.id, balance: 0 }, { onConflict: 'user_id' })

    return sub.id
  }

  async function activateSubscription(subId: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('subscriptions')
      .update({
        status: 'active',
        deliveries_remaining: PLAN_DELIVERIES[store.planId ?? ''] ?? 0,
      })
      .eq('id', subId)
    await supabase.from('users').update({ onboarded: true }).eq('id', user.id)
    setOnboarded(true)
    setHasSubscription(true) // sub is now active — unlock My Plan tab without app reload
  }

  async function handleProceed() {
    setError('')
    setPhase('creating')
    try {
      const subId = await createRecords()
      setSubscriptionId(subId)

      if (method === 'cod') {
        // CoD: instantiate orders now so the delivery partner has a sheet and
        // the subscriber sees their first meal. Cash is collected on first
        // delivery; admin then flips the sub to 'active' to unlock the full plan.
        const { data: { session } } = await supabase.auth.getSession()
        await supabase.functions.invoke('instantiate-orders', {
          body: { subscription_id: subId },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        })
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('users').update({ onboarded: true }).eq('id', user.id)
          setOnboarded(true)
        }
        setHasSubscription(true) // limited CoD plan — first meal + pay banner
        setPhase('success')
        return
      }

      // Razorpay: create order via Edge Function
      const { data: { session } } = await supabase.auth.getSession()
      const res = await supabase.functions.invoke('razorpay-create-order', {
        body: { subscription_id: subId, amount_paise: grandTotal },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })

      if (res.error) throw new Error(res.error.message)

      setRzpOrder({
        orderId: res.data.order_id,
        amount: res.data.amount,
        keyId: res.data.key_id,
      })
      setPhase('checkout')
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.')
      setPhase('summary')
    }
  }

  async function handlePaymentSuccess(paymentId: string) {
    // Optimistically activate — webhook will also fire and do the same (idempotent)
    await activateSubscription(subscriptionId)
    setPhase('success')
  }

  function handlePaymentFailure(errMsg: string) {
    setRzpOrder(null)
    setPhase('summary')
    setError(`Payment failed: ${errMsg}`)
  }

  function handleCheckoutDismissed() {
    setRzpOrder(null)
    setPhase('summary')
    // No error — user just cancelled
  }

  // ── Razorpay WebView fullscreen ──────────────────────────────────────────
  if (phase === 'checkout' && rzpOrder) {
    return (
      <Modal visible animationType="slide" presentationStyle="fullScreen">
        <RazorpayWebView
          orderId={rzpOrder.orderId}
          amount={rzpOrder.amount}
          keyId={rzpOrder.keyId}
          userName={userName}
          userPhone={phone ?? ''}
          onSuccess={handlePaymentSuccess}
          onFailure={handlePaymentFailure}
          onDismiss={handleCheckoutDismissed}
        />
      </Modal>
    )
  }

  // ── Main summary screen ──────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: 120 }]}
      >
        <Text style={styles.title}>Complete your order</Text>

        {/* Order recap */}
        <View style={styles.recapCard}>
          <Text style={styles.recapPlan}>{store.planName || store.planId}</Text>
          <Text style={styles.recapAmount}>{fmtRupees(grandTotal)}</Text>
          <View style={styles.recapRow}>
            <Text style={styles.recapDetail}>{store.selectedDays.length} days/week</Text>
            <Text style={styles.recapDot}>·</Text>
            <Text style={styles.recapDetail}>
              {store.deliveryMode === 'opt-out' ? 'Skip anytime' : 'Opt-in schedule'}
            </Text>
          </View>
          {addonTotal > 0 && (
            <View style={styles.addonRow}>
              <Text style={styles.recapDetail}>Plan: {fmtRupees(planAmount)}</Text>
              <Text style={styles.recapDot}>+</Text>
              <Text style={styles.recapDetail}>Add-ons: {fmtRupees(addonTotal)}</Text>
            </View>
          )}
        </View>

        {/* Payment method */}
        <Text style={styles.sectionTitle}>Payment method</Text>

        <TouchableOpacity
          style={[styles.methodCard, method === 'razorpay' && styles.methodCardActive]}
          onPress={() => setMethod('razorpay')}
        >
          <View style={[styles.radio, method === 'razorpay' && styles.radioActive]}>
            {method === 'razorpay' && <View style={styles.radioDot} />}
          </View>
          <View style={styles.methodText}>
            <Text style={styles.methodTitle}>Pay Online</Text>
            <Text style={styles.methodDesc}>UPI · Cards · Net Banking · Wallets</Text>
          </View>
          <Text style={styles.methodIcon}>💳</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, method === 'cod' && styles.methodCardActive]}
          onPress={() => setMethod('cod')}
        >
          <View style={[styles.radio, method === 'cod' && styles.radioActive]}>
            {method === 'cod' && <View style={styles.radioDot} />}
          </View>
          <View style={styles.methodText}>
            <Text style={styles.methodTitle}>Cash on Delivery</Text>
            <Text style={styles.methodDesc}>Pay when your food arrives</Text>
          </View>
          <Text style={styles.methodIcon}>💵</Text>
        </TouchableOpacity>

        {method === 'razorpay' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              You'll be redirected to a secure Razorpay checkout. Supports Google Pay, PhonePe, BHIM,
              HDFC, ICICI, and all major UPI apps.
            </Text>
          </View>
        )}

        {method === 'cod' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Your subscription will start once our team confirms receipt of payment. We'll call you to
              collect on your first delivery day.
            </Text>
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      {/* CTA */}
      <View style={[styles.cta, { paddingBottom: insets.bottom + 16 }]}>
        <Button onPress={handleProceed} disabled={phase === 'creating'}>
          {phase === 'creating' ? (
            <ActivityIndicator color="#fff" />
          ) : method === 'razorpay' ? (
            `Pay ${fmtRupees(grandTotal)} →`
          ) : (
            'Confirm order →'
          )}
        </Button>
      </View>

      {/* Success modal */}
      <Modal visible={phase === 'success'} animationType="fade" transparent>
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>🎉</Text>
            <Text style={styles.successTitle}>Welcome to GreenFeast!</Text>
            <Text style={styles.successDesc}>
              {method === 'cod'
                ? `Your first meal is scheduled!\nPay ${fmtRupees(grandTotal)} in cash to your delivery partner on your first delivery.\nFirst delivery: ${firstDelivery}`
                : `Payment confirmed.\nYour subscription is active!\nFirst delivery: ${firstDelivery}`}
            </Text>
            <Button
              onPress={() => { store.reset() }}
              style={{ marginTop: 8 }}
            >
              Go to home →
            </Button>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 20 },

  recapCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 16,
    padding: 20,
    marginBottom: 28,
    borderWidth: 2,
    borderColor: Colors.primary,
    gap: 4,
  },
  recapPlan: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.primary },
  recapAmount: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  addonRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recapDetail: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  recapDot: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textLight },

  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text, marginBottom: 12 },

  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  methodCardActive: { borderColor: Colors.primary },
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
  methodText: { flex: 1 },
  methodTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  methodDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  methodIcon: { fontSize: 24 },

  infoBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
  },
  infoText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 20 },

  error: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.danger,
    textAlign: 'center',
    marginTop: 8,
  },

  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },

  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  successCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  successEmoji: { fontSize: 56 },
  successTitle: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.text, textAlign: 'center' },
  successDesc: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
})
