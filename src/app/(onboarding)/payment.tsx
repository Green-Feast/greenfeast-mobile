import { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { CFPaymentGatewayService, CFErrorResponse, type CFCallback } from 'react-native-cashfree-pg-sdk'
import { CFSession, CFEnvironment } from 'cashfree-pg-api-contract'
import { supabase } from '@/lib/supabase'
import { setActiveCashfreeCallback } from '@/lib/cashfreeCallback'
import { extractFunctionErrorMessage } from '@/lib/supabaseFunctionError'
import { useAuthStore } from '@/store/auth'
import { useOnboardingStore } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import { APP_VERSION_STRING } from '@/constants/version'
import { SUPPORT_WHATSAPP_NUMBER } from '@/constants/links'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'

type Method = 'cashfree' | 'cod'
type Phase = 'summary' | 'creating' | 'success'

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

// Cash on delivery: the first day's meals are paid online now and the rest in
// cash on the first delivery — rounded down to a round ₹100, the odd amount
// going online. Same formula as cashfree-create-order (codSplit), which is
// what's actually charged.
function codSplit(totalPaise: number, perMealPaise: number, mealsPerDay: number) {
  const firstDay = Math.min(perMealPaise * Math.max(mealsPerDay, 1), totalPaise)
  const cash = Math.max(Math.floor((totalPaise - firstDay) / 10000) * 10000, 0)
  return { upfront: totalPaise - cash, cash }
}

export default function PaymentScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { setOnboarded, setHasSubscription } = useAuthStore()
  const store = useOnboardingStore()

  const [method, setMethod] = useState<Method>('cashfree')
  const [phase, setPhase] = useState<Phase>('summary')
  const [error, setError] = useState('')
  const [userName, setUserName] = useState('')

  // Set after DB records created
  const [subscriptionId, setSubscriptionId] = useState('')
  const [firstDelivery, setFirstDelivery] = useState('')

  const planAmount = PLAN_AMOUNTS[store.planId ?? ''] ?? 149900
  const planMeals = PLAN_DELIVERIES[store.planId ?? ''] ?? 5
  const addonPerMeal = store.addOns.reduce((s, a) => s + a.pricePerMeal, 0)
  const addonTotal = addonPerMeal * planMeals
  const grandTotal = planAmount + addonTotal
  const cod = codSplit(grandTotal, Math.round(planAmount / planMeals) + addonPerMeal, store.mealsLunch + store.mealsDinner)
  // What the server actually charged / left for cash (set when the order is made).
  const [charged, setCharged] = useState<{ upfront: number; cash: number } | null>(null)
  const firstName = userName.split(' ')[0]

  useEffect(() => {
    if (phase === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    }
  }, [phase])

  async function createRecords(): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Not authenticated')

    // Display name for the success screen's "Welcome aboard" greeting (cosmetic)
    const { data: profile } = await supabase.from('users').select('name').eq('id', user.id).single()
    setUserName(profile?.name ?? (user.user_metadata?.full_name as string) ?? '')

    // 1. Upsert address — address.tsx may have already written this incrementally;
    //    if a default address exists for the user, update it in-place instead of
    //    creating a duplicate.
    const addressFields = {
      user_id: user.id,
      label: store.addressLabel,
      type: store.addressType,
      line1: store.addressLine1,
      city: 'Jaipur',
      pincode: store.addressPincode,
      landmark: store.addressLandmark || null,
      lat: store.addressLat,
      lng: store.addressLng,
      is_default: true,
    }
    const { data: existingAddr } = await supabase
      .from('addresses')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .maybeSingle()

    let addrId: string
    if (existingAddr) {
      const { error: addrErr } = await supabase.from('addresses').update(addressFields).eq('id', existingAddr.id)
      if (addrErr) throw addrErr
      addrId = existingAddr.id
    } else {
      const { data: addr, error: addrErr } = await supabase.from('addresses').insert(addressFields).select('id').single()
      if (addrErr) throw addrErr
      addrId = addr.id
    }
    void addrId // used by instantiate-orders via user's default address lookup

    // 2. Upsert dietary profile — only the basics collected pre-payment.
    //    Detailed customisations are written by the post-payment customise screen,
    //    so we must NOT overwrite those columns with empty values here.
    const { error: dietErr } = await supabase
      .from('dietary_profiles')
      .upsert({
        user_id: user.id,
        allergens: store.allergens,
        dietary_preference: store.dietaryPreference,
        free_text: store.dietaryFreeText || null,
        health_goal: store.healthGoal,
        weight: store.weight || null,
        height: store.height || null,
        exercise_type: store.exerciseType,
        exercise_frequency: store.exerciseFrequency || null,
        occupation: store.occupation || null,
        protein_target: store.proteinTarget ? parseInt(store.proteinTarget) : null,
        fibre_target: store.fibreTarget ? parseInt(store.fibreTarget) : null,
      }, { onConflict: 'user_id' })
    if (dietErr) throw dietErr

    // 3. Upsert questionnaire response (incl. derived constraints)
    if (store.q1Answer && store.recommendation) {
      await supabase
        .from('questionnaire_responses')
        .upsert({
          user_id: user.id,
          health_goal: store.healthGoal,
          q1_answer: store.q1Answer,
          q2_answer: store.q2Answer || null,
          derived_menu: store.recommendation.menuType,
          derived_addons: store.recommendation.derivedAddons,
          derived_constraints: store.recommendation.derivedConstraints,
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
        menu_type: store.recommendation?.menuType || null,
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
      .eq('subscription_valid', true)
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
    await supabase.from('wallets').upsert({ user_id: user.id, balance: 0 }, { onConflict: 'user_id', ignoreDuplicates: true })

    return sub.id
  }

  async function activateSubscription(subId: string) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    // The plan is activated by the server once Cashfree confirms the payment
    // (cashfree-webhook) — the app can't write plan status (migration 050).
    // Wait for it, so My Plan opens on the active plan rather than the
    // "Subscribe" screen. Usually a few seconds.
    for (let i = 0; i < 15; i++) {
      const { data } = await supabase.from('subscriptions').select('status').eq('id', subId).maybeSingle()
      if (data?.status === 'active') break
      await new Promise((r) => setTimeout(r, 2000))
    }
    await supabase.from('users').update({ onboarded: true }).eq('id', user.id)
    setOnboarded(true)
    setHasSubscription(true) // sub is now active — unlock My Plan tab without app reload
  }

  // Credit the wallet with what was paid (computed server-side). The wallet is
  // the billing ledger — meals debit from this balance. Idempotent
  // (reference_id = subscription_id), so the webhook doing it too is safe.
  async function fundWallet(subId: string) {
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.functions.invoke('fund-subscription-wallet', {
      body: { subscription_id: subId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
  }

  async function handleProceed() {
    setError('')
    setPhase('creating')
    try {
      const subId = await createRecords()
      setSubscriptionId(subId)

      // Both methods go through Cashfree now: online pays the whole plan,
      // cash on delivery pays the first day's meals (the rest is cash at the
      // first delivery — no more delivering on credit). The server prices it.
      const { data: { session } } = await supabase.auth.getSession()
      const res = await supabase.functions.invoke('cashfree-create-order', {
        body: {
          subscription_id: subId,
          amount_paise: method === 'cod' ? cod.upfront : grandTotal,
          cod: method === 'cod',
        },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })

      if (res.error) {
        // res.error.message alone is always the generic "Edge Function
        // returned a non-2xx status code" — every distinct failure this
        // function can return (missing subscription, payments insert
        // failed, Cashfree itself rejected the order, ...) collapsed into
        // that one meaningless line. The real body only lives in
        // error.context.json().
        throw new Error(await extractFunctionErrorMessage(res.error, 'Could not start payment. Please try again.'))
      }
      setCharged({ upfront: res.data.amount_paise ?? grandTotal, cash: res.data.cash_paise ?? 0 })

      const cfSession = new CFSession(
        res.data.payment_session_id,
        res.data.order_id,
        res.data.environment === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX
      )
      CFPaymentGatewayService.doWebPayment(cfSession)
      // Stay in 'creating' — the native checkout UI covers this screen until
      // the callback below fires.
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.')
      setPhase('summary')
    }
  }

  async function handlePaymentSuccess() {
    // Optimistically activate — webhook will also fire and do the same (idempotent)
    await activateSubscription(subscriptionId)
    // Instantiate orders now too. The webhook also does this, but it depends on
    // a publicly reachable function URL; doing it here guarantees the user's
    // first deliveries exist the moment they land on My Plan. The unique
    // (subscription_id, delivery_date) constraint makes the webhook's repeat safe.
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.functions.invoke('instantiate-orders', {
      body: { subscription_id: subscriptionId },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    await fundWallet(subscriptionId)
    setPhase('success')
  }

  function handlePaymentFailure(errMsg: string) {
    setPhase('summary')
    setError(`Payment failed: ${errMsg}`)
  }

  // The native SDK's callback is registered once per mount and can't take
  // fresh props/state each render — a ref keeps it reading the latest
  // subscriptionId/handlers instead of a stale closure from mount time.
  const latest = useRef({ handlePaymentSuccess, handlePaymentFailure })
  latest.current = { handlePaymentSuccess, handlePaymentFailure }

  useEffect(() => {
    const callback: CFCallback = {
      onVerify: () => { latest.current.handlePaymentSuccess() },
      onError: (error: CFErrorResponse) => {
        latest.current.handlePaymentFailure(error.getMessage() || 'Please try again.')
      },
    }
    // Not CFPaymentGatewayService.setCallback/removeCallback directly — see
    // cashfreeCallback.ts. My Plan's own wallet-topup screen uses the same
    // shared singleton and stays mounted underneath this one (expo-router
    // keeps a pushed-from screen alive), so an out-of-order cleanup between
    // the two could otherwise silently unhook whichever callback is actually
    // live — this is what let a completed payment leave onboarding stuck
    // spinning forever with no error and no success.
    return setActiveCashfreeCallback(callback)
  }, [])

  // ── Main summary screen ──────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Fixed header — progress bar must not scroll with the page */}
      <View style={{ paddingHorizontal: 24, paddingTop: insets.top + 24 }}>
        <SectionProgress current={4} sectionStep={3} sectionTotalSteps={3} />
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 }]}
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
          style={[styles.methodCard, method === 'cashfree' && styles.methodCardActive]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMethod('cashfree') }}
        >
          <View style={[styles.radio, method === 'cashfree' && styles.radioActive]}>
            {method === 'cashfree' && <View style={styles.radioDot} />}
          </View>
          <View style={styles.methodText}>
            <Text style={styles.methodTitle}>Pay Online</Text>
            <Text style={styles.methodDesc}>UPI · Cards · Net Banking · Wallets</Text>
          </View>
          <Text style={styles.methodIcon}>💳</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.methodCard, method === 'cod' && styles.methodCardActive]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMethod('cod') }}
        >
          <View style={[styles.radio, method === 'cod' && styles.radioActive]}>
            {method === 'cod' && <View style={styles.radioDot} />}
          </View>
          <View style={styles.methodText}>
            <Text style={styles.methodTitle}>Cash on Delivery</Text>
            <Text style={styles.methodDesc}>
              {fmtRupees(cod.upfront)} now · {fmtRupees(cod.cash)} cash on your first delivery
            </Text>
          </View>
          <Text style={styles.methodIcon}>💵</Text>
        </TouchableOpacity>

        {method === 'cashfree' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              You'll be redirected to a secure Cashfree checkout. Supports Google Pay, PhonePe, BHIM,
              HDFC, ICICI, and all major UPI apps.
            </Text>
          </View>
        )}

        {method === 'cod' && (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              Pay your first day's meals ({fmtRupees(cod.upfront)}) online now to confirm your plan. Hand the
              remaining {fmtRupees(cod.cash)} in cash to your delivery partner on your first delivery — we'll add it
              to your GreenFeast wallet, which pays for your meals as they're delivered.
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
          ) : method === 'cashfree' ? (
            `Pay ${fmtRupees(grandTotal)} →`
          ) : (
            `Pay ${fmtRupees(cod.upfront)} now →`
          )}
        </Button>
      </View>

      {/* Success modal */}
      <Modal visible={phase === 'success'} animationType="fade" transparent>
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <Text style={styles.successEmoji}>🎉</Text>
            {firstName ? <Text style={styles.successScript}>Welcome aboard, {firstName}.</Text> : null}
            <Text style={styles.successTitle}>Welcome to GreenFeast!</Text>
            <Text style={styles.successDesc}>
              {method === 'cod'
                ? `${fmtRupees(charged?.upfront ?? cod.upfront)} paid — your plan is active!\nPlease keep ${fmtRupees(charged?.cash ?? cod.cash)} in cash ready for your delivery partner on your first delivery.\nFirst delivery: ${firstDelivery}`
                : `Payment confirmed.\nYour subscription is active!\nFirst delivery: ${firstDelivery}`}
            </Text>
            <Button
              onPress={() => {
                store.reset()
                router.replace('/(app)/(tabs)')
              }}
              style={{ marginTop: 8 }}
            >
              Get started →
            </Button>
            {method === 'cod' && (
              <TouchableOpacity
                onPress={() => {
                  const msg = encodeURIComponent(
                    `Hi GreenFeast! I'm messaging from the GreenFeast app (v${APP_VERSION_STRING}).\n` +
                    `Topic: Cash on Delivery\n\n` +
                    `I just set up my ${store.planName || ''} plan with cash on delivery.`
                  )
                  Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${msg}`).catch(() => {})
                }}
                hitSlop={8}
              >
                <Text style={styles.waLink}>Questions? Message us on WhatsApp</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  scroll: { padding: 24 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.ink900, marginTop: 24, marginBottom: 20 },

  recapCard: {
    backgroundColor: Colors.green50,
    borderRadius: 16,
    padding: 20,
    marginBottom: 28,
    borderWidth: 2,
    borderColor: Colors.green700,
    gap: 4,
  },
  recapPlan: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.green700 },
  recapAmount: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.ink900 },
  recapRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  addonRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recapDetail: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500 },
  recapDot: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink400 },

  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.ink900, marginBottom: 12 },

  methodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.cream50,
    borderRadius: 14,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    marginBottom: 10,
  },
  methodCardActive: { borderColor: Colors.green700 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.green700 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.green700 },
  methodText: { flex: 1 },
  methodTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink900 },
  methodDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, marginTop: 2 },
  methodIcon: { fontSize: 24 },

  infoBox: {
    backgroundColor: Colors.cream100,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: Colors.green700,
  },
  infoText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, lineHeight: 20 },

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
    backgroundColor: Colors.cream50,
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
    backgroundColor: Colors.cream50,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    gap: 12,
  },
  successEmoji: { fontSize: 56 },
  successScript: { fontFamily: Fonts.script, fontSize: 24, color: Colors.green700 },
  successTitle: { fontFamily: Fonts.heading, fontSize: 24, color: Colors.ink900, textAlign: 'center' },
  successDesc: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink500,
    textAlign: 'center',
    lineHeight: 22,
  },
  waLink: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.green700, marginTop: 4 },
})
