import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import {
  ChevronLeft,
  Pause, Play, SkipForward, ArrowUpDown, X, ArrowRight, UtensilsCrossed, MapPin,
} from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import RazorpayWebView from '@/components/RazorpayWebView'

// ── Types ──────────────────────────────────────────────────────────────────

type SubData = {
  id: string
  status: string
  payment_method: string
  plan_name: string | null
  deliveries_remaining: number
  end_date: string | null
  pause_from: string | null
  pause_until: string | null
  plans: { name: string; meals_total: number; days_per_week: number; base_price: number } | null
  subscription_addons: { addons: { price_per_meal: number } | null }[]
}

type Plan = { id: string; name: string; meals_total: number; days_per_week: number; base_price: number }
type UpcomingOrder = { id: string; delivery_date: string; meal_templates: { name: string } | null }

// ── Constants ──────────────────────────────────────────────────────────────

const ALLERGENS = ['Peanuts', 'Shellfish', 'Dairy', 'Sesame', 'Soy', 'Nuts', 'Gluten', 'Egg']
const DIETARY_PREFS = ['none', 'vegetarian', 'vegan'] as const
const PROTEINS = ['Paneer', 'Tofu']
const BASES = ['Quinoa', 'Couscous', 'Rice', 'Pasta', 'Soba noodles']
const VEGGIES = ['Bell pepper', 'Mushroom', 'Broccoli', 'Onion']
const SPICES = ['Mild', 'Medium', 'Spicy'] as const
const DRESSINGS = [
  { label: 'Mixed in', value: 'mixed-in' },
  { label: 'On the side', value: 'on-the-side' },
] as const
// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(paise: number) { return (paise / 100).toLocaleString('en-IN') }
function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtShort(d: Date) { return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }
function fmtDow(d: Date) { return d.toLocaleDateString('en-IN', { weekday: 'short' }) }
function toISO(d: Date) { return d.toISOString().split('T')[0] }
function generateDates(count: number, offsetDays = 1): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + offsetDays + i); return d
  })
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function PlanSettingsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuthStore()
  const [sub, setSub] = useState<SubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [pauseOpen, setPauseOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [changePlanOpen, setChangePlanOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [dietaryOpen, setDietaryOpen] = useState(false)

  const fetchSub = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('subscriptions')
      .select('id, status, payment_method, plan_name, deliveries_remaining, end_date, pause_from, pause_until, plans ( name, meals_total, days_per_week, base_price ), subscription_addons ( addons ( price_per_meal ) )')
      .eq('user_id', user.id)
      .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setSub((data as unknown as SubData) ?? null)
  }, [user])

  useEffect(() => {
    setLoading(true)
    fetchSub().finally(() => setLoading(false))
  }, [fetchSub])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchSub()
    setRefreshing(false)
  }, [fetchSub])

  if (loading) {
    return <View style={s.loadingWrap}><ActivityIndicator size="large" color={Colors.primary} /></View>
  }

  if (!sub) {
    return (
      <View style={s.container}>
        <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
            <ChevronLeft size={22} color={Colors.text} />
          </Pressable>
          <Text style={s.topBarTitle}>Plan & settings</Text>
        </View>
        <View style={s.emptyWrap}>
          <Text style={s.emptyText}>No active subscription found.</Text>
        </View>
      </View>
    )
  }

  const planName = sub.plan_name || sub.plans?.name || 'Your Plan'
  const mealsTotal = sub.plans?.meals_total ?? 0
  const remaining = sub.deliveries_remaining
  const progress = mealsTotal > 0 ? Math.min(100, (remaining / mealsTotal) * 100) : 0
  const addonPerMeal = (sub.subscription_addons ?? []).reduce((s, a) => s + (a.addons?.price_per_meal ?? 0), 0)
  const totalAmount = (sub.plans?.base_price ?? 0) + addonPerMeal * mealsTotal

  async function handleResume() {
    if (!sub) return
    try {
      await supabase.functions.invoke('manage-subscription', {
        body: { action: 'resume', subscription_id: sub.id },
      })
      await fetchSub()
    } catch { /* silent — pull-to-refresh recovers */ }
  }

  const sharedActions = [
    { label: 'Skip a specific day',   Icon: SkipForward,     onPress: () => setSkipOpen(true) },
    { label: 'Change plan',           Icon: ArrowUpDown,     onPress: () => setChangePlanOpen(true) },
    { label: 'Edit dietary profile',  Icon: UtensilsCrossed, onPress: () => setDietaryOpen(true) },
    { label: 'Edit delivery address', Icon: MapPin,          onPress: () => router.push('/(app)/addresses') },
  ]

  const actions = sub.status === 'paused'
    ? [{ label: 'Resume subscription', Icon: Play, onPress: handleResume }, ...sharedActions]
    : [{ label: 'Pause subscription',  Icon: Pause, onPress: () => setPauseOpen(true) }, ...sharedActions]

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: 40 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Header */}
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
            <ChevronLeft size={22} color={Colors.text} />
          </Pressable>
          <Text style={s.topBarTitle}>Plan & settings</Text>
        </View>

        {/* Plan card */}
        <View style={s.planCard}>
          <View style={s.planCardHeader}>
            <View style={s.planCardTop}>
              <Text style={s.planCardNameLight}>{planName}</Text>
              <View style={s.activeBadge}>
                <Text style={s.activeBadgeText}>{sub.status === 'paused' ? 'Paused' : 'Active'}</Text>
              </View>
            </View>
            {sub.plans && (
              <Text style={s.planCardMetaLight}>
                {sub.plans.meals_total} meals · {sub.plans.days_per_week} days/week · ₹{fmt(totalAmount)}
              </Text>
            )}
          </View>
          <View style={s.planCardBody}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Next renewal</Text>
              <Text style={s.metaValue}>{fmtDate(sub.end_date)}</Text>
            </View>
            {sub.status === 'paused' && sub.pause_until && (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Paused until</Text>
                <Text style={s.metaValue}>{fmtDate(sub.pause_until)}</Text>
              </View>
            )}
            <View>
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Deliveries remaining</Text>
                <Text style={s.metaValueGreen}>{remaining}/{mealsTotal}</Text>
              </View>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${progress}%` }]} />
              </View>
            </View>
          </View>
        </View>

        {/* Actions */}
        <View style={s.actionCard}>
          {actions.map(({ label, Icon, onPress }, i) => (
            <Pressable
              key={label}
              style={({ pressed }) => [s.actionRow, i < actions.length - 1 && s.actionRowBorder, pressed && s.rowPressed]}
              onPress={onPress}
            >
              <Icon size={18} color={Colors.text} />
              <Text style={[s.actionLabel, { flex: 1 }]}>{label}</Text>
              <ArrowRight size={15} color={Colors.textLight} />
            </Pressable>
          ))}
          <Pressable
            style={({ pressed }) => [s.actionRow, pressed && s.rowPressedDanger]}
            onPress={() => setCancelOpen(true)}
          >
            <X size={18} color={Colors.danger} />
            <Text style={[s.actionLabel, { color: Colors.danger }]}>Cancel subscription</Text>
          </Pressable>
        </View>
      </ScrollView>

      <PauseModal      visible={pauseOpen}       subId={sub.id} onClose={() => setPauseOpen(false)}       onDone={() => { setPauseOpen(false);      fetchSub() }} />
      <SkipModal       visible={skipOpen}        subId={sub.id} userId={user!.id} onClose={() => setSkipOpen(false)}        onDone={() => { setSkipOpen(false);       fetchSub() }} />
      <ChangePlanModal visible={changePlanOpen}  subId={sub.id} currentPlanName={planName} onClose={() => setChangePlanOpen(false)} onDone={() => { setChangePlanOpen(false); fetchSub() }} />
      <CancelModal     visible={cancelOpen}      subId={sub.id} onClose={() => setCancelOpen(false)}      onDone={() => { setCancelOpen(false);     fetchSub() }} />
      <DietaryModal    visible={dietaryOpen}     userId={user!.id} onClose={() => setDietaryOpen(false)}  onDone={() => setDietaryOpen(false)} />
    </View>
  )
}

// ── PauseModal ─────────────────────────────────────────────────────────────

function PauseModal({ visible, subId, onClose, onDone }: {
  visible: boolean; subId: string; onClose: () => void; onDone: () => void
}) {
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState<'from' | 'until'>('from')
  const [fromDate, setFromDate] = useState<string | null>(null)
  const [untilDate, setUntilDate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fromDates = generateDates(30, 1)
  const untilDates = fromDate
    ? generateDates(14, Math.ceil((new Date(fromDate + 'T00:00:00').getTime() - Date.now()) / 86400000) + 1)
    : []

  async function handlePause() {
    if (!fromDate || !untilDate) return
    setSaving(true); setError('')
    try {
      const { error } = await supabase.functions.invoke('manage-subscription', {
        body: { action: 'pause', subscription_id: subId, pause_from: fromDate, pause_until: untilDate },
      })
      if (error) throw error
      onDone()
    } catch { setError('Something went wrong. Please try again.') }
    finally { setSaving(false) }
  }

  function reset() { setStep('from'); setFromDate(null); setUntilDate(null); setError(''); onClose() }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <View style={m.overlay}>
        <View style={[m.sheet, { paddingBottom: 32 + insets.bottom }]}>
          <View style={m.handle} />
          <SheetHeader title="Pause subscription" onClose={reset} />

          {step === 'from' ? (
            <>
              <Text style={m.stepLabel}>Select pause start date</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.dateRow}>
                {fromDates.map((d) => {
                  const iso = toISO(d); const active = iso === fromDate
                  return (
                    <Pressable key={iso} style={[m.dateChip, active && m.dateChipActive]} onPress={() => setFromDate(iso)}>
                      <Text style={[m.dateDow, active && m.dateDowActive]}>{fmtDow(d)}</Text>
                      <Text style={[m.dateNum, active && m.dateNumActive]}>{fmtShort(d)}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
              <Pressable style={[m.btn, !fromDate && m.btnDisabled]} disabled={!fromDate} onPress={() => setStep('until')}>
                <Text style={m.btnText}>Next: pick end date</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={m.stepLabel}>Select pause end date</Text>
              <Text style={m.stepSub}>From {fmtDate(fromDate)}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.dateRow}>
                {untilDates.map((d) => {
                  const iso = toISO(d)
                  if (fromDate && iso <= fromDate) return null
                  const active = iso === untilDate
                  return (
                    <Pressable key={iso} style={[m.dateChip, active && m.dateChipActive]} onPress={() => setUntilDate(iso)}>
                      <Text style={[m.dateDow, active && m.dateDowActive]}>{fmtDow(d)}</Text>
                      <Text style={[m.dateNum, active && m.dateNumActive]}>{fmtShort(d)}</Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
              {error ? <Text style={m.errorText}>{error}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable style={[m.btn, m.btnGhost, { flex: 1 }]} onPress={() => setStep('from')}>
                  <Text style={m.btnGhostText}>Back</Text>
                </Pressable>
                <Pressable style={[m.btn, (!untilDate || saving) && m.btnDisabled, { flex: 1 }]} disabled={!untilDate || saving} onPress={handlePause}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnText}>Confirm pause</Text>}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}

// ── SkipModal ──────────────────────────────────────────────────────────────

function SkipModal({ visible, subId, userId, onClose, onDone }: {
  visible: boolean; subId: string; userId: string; onClose: () => void; onDone: () => void
}) {
  const insets = useSafeAreaInsets()
  const [orders, setOrders] = useState<UpcomingOrder[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    setLoadingOrders(true)
    const todayStr = new Date().toISOString().split('T')[0]
    const future = new Date(); future.setDate(future.getDate() + 14)
    supabase.from('orders')
      .select('id, delivery_date, meal_templates ( name )')
      .eq('subscription_id', subId)
      .gte('delivery_date', todayStr).lte('delivery_date', future.toISOString().split('T')[0])
      .in('status', ['scheduled', 'confirmed'])
      .order('delivery_date')
      .then(({ data }) => { setOrders((data as unknown as UpcomingOrder[]) ?? []); setLoadingOrders(false) })
  }, [visible, subId])

  async function handleSkip() {
    if (!selectedDate) return
    setSaving(true); setError('')
    try {
      const { error } = await supabase.functions.invoke('manage-subscription', {
        body: { action: 'skip', subscription_id: subId, delivery_date: selectedDate },
      })
      if (error) throw error
      onDone()
    } catch { setError('Something went wrong. Please try again.') }
    finally { setSaving(false) }
  }

  function reset() { setSelectedDate(null); setError(''); onClose() }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={reset}>
      <View style={m.overlay}>
        <View style={[m.sheet, { paddingBottom: 32 + insets.bottom }]}>
          <View style={m.handle} />
          <SheetHeader title="Skip a delivery" onClose={reset} />
          <Text style={m.stepLabel}>Select a day to skip</Text>
          {loadingOrders ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
          ) : orders.length === 0 ? (
            <Text style={m.emptyText}>No upcoming deliveries in the next 14 days.</Text>
          ) : (
            <View style={{ gap: 10, marginBottom: 20 }}>
              {[...new Map(orders.map(o => [o.delivery_date, o])).values()].map((o) => {
                const active = o.delivery_date === selectedDate
                return (
                  <Pressable key={o.delivery_date} style={[m.selectRow, active && m.selectRowActive]} onPress={() => setSelectedDate(o.delivery_date)}>
                    <View style={{ flex: 1 }}>
                      <Text style={[m.selectRowTitle, active && { color: Colors.primary }]}>{fmtDate(o.delivery_date)}</Text>
                      <Text style={m.selectRowSub}>{o.meal_templates?.name ?? '—'}</Text>
                    </View>
                    <View style={[m.radio, active && m.radioActive]}>{active && <View style={m.radioDot} />}</View>
                  </Pressable>
                )
              })}
            </View>
          )}
          {error ? <Text style={m.errorText}>{error}</Text> : null}
          <Pressable style={[m.btn, (!selectedDate || saving) && m.btnDisabled]} disabled={!selectedDate || saving} onPress={handleSkip}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnText}>Skip this delivery</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

// ── ChangePlanModal ────────────────────────────────────────────────────────

function ChangePlanModal({ visible, subId, currentPlanName, onClose, onDone }: {
  visible: boolean; subId: string; currentPlanName: string; onClose: () => void; onDone: () => void
}) {
  const insets = useSafeAreaInsets()
  const { user } = useAuthStore()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [timing, setTiming] = useState<'now' | 'queue' | null>(null)
  const [walletBalance, setWalletBalance] = useState(0)
  const [addonPerMeal, setAddonPerMeal] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [razorpayOrderId, setRazorpayOrderId] = useState<string | null>(null)
  const [razorpayAmountPaise, setRazorpayAmountPaise] = useState(0)

  useEffect(() => {
    if (!visible || !user) return
    setSelectedId(null); setTiming(null); setError('')
    setLoadingPlans(true)
    Promise.all([
      supabase.from('plans').select('id, name, meals_total, days_per_week, base_price')
        .eq('is_active', true).order('base_price'),
      supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      supabase.from('subscription_addons').select('addons(price_per_meal)').eq('subscription_id', subId),
    ]).then(([{ data: plansData }, { data: walletData }, { data: addonsData }]) => {
      setPlans((plansData as Plan[]) ?? [])
      setWalletBalance(walletData?.balance ?? 0)
      const perMeal = ((addonsData ?? []) as any[]).reduce(
        (sum: number, row: any) => sum + (row.addons?.price_per_meal ?? 0), 0
      )
      setAddonPerMeal(perMeal)
      setLoadingPlans(false)
    })
  }, [visible, user, subId])

  const selectedPlan = plans.find((p) => p.id === selectedId) ?? null

  function newPlanTotal(plan: Plan) {
    return plan.base_price + addonPerMeal * plan.meals_total
  }

  function chargeNow(plan: Plan) {
    return Math.max(0, newPlanTotal(plan) - walletBalance)
  }

  async function applyNow(plan: Plan, charge: number) {
    // Optimistic: update subscription immediately. Wallet credit happens via webhook.
    const { error: err } = await supabase.from('subscriptions')
      .update({ plan_id: plan.id, plan_name: plan.name, deliveries_remaining: plan.meals_total })
      .eq('id', subId)
    if (err) throw err

    // Cancel future un-customized orders so they get re-instantiated with new plan
    const today = new Date().toISOString().split('T')[0]
    await supabase.from('orders').delete()
      .eq('subscription_id', subId)
      .gte('delivery_date', today)
      .eq('is_customized', false)
      .in('status', ['scheduled', 'confirmed'])

    // Kick off order creation
    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      supabase.functions.invoke('instantiate-orders', {
        body: { subscription_id: subId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => {})
    }
  }

  async function applyQueue(plan: Plan) {
    // Create a new pending subscription; it activates when the current one ends.
    const { data: currentSub } = await supabase.from('subscriptions')
      .select('end_date, menu_type, meals_lunch, meals_dinner')
      .eq('id', subId).single()

    const { error: err } = await supabase.from('subscriptions').insert({
      user_id: user!.id,
      plan_id: plan.id,
      plan_name: plan.name,
      status: 'pending',
      payment_method: 'online',
      deliveries_remaining: plan.meals_total,
      menu_type: currentSub?.menu_type ?? 'M1',
      meals_lunch: currentSub?.meals_lunch ?? 1,
      meals_dinner: currentSub?.meals_dinner ?? 0,
      start_date: currentSub?.end_date ?? null,
    })
    if (err) throw err
  }

  async function handleConfirm() {
    if (!selectedPlan || !timing) return
    setSaving(true); setError('')
    try {
      if (timing === 'now') {
        const charge = chargeNow(selectedPlan)
        if (charge > 0) {
          // Create a wallet top-up Razorpay order for the charge amount
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) throw new Error('Not authenticated')
          const { data, error: fnErr } = await supabase.functions.invoke('wallet-topup', {
            body: { amount_paise: charge },
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          if (fnErr || data?.error) throw new Error(data?.error ?? 'Payment order failed')
          setRazorpayOrderId(data.order_id)
          setRazorpayAmountPaise(charge)
          setSaving(false)
          return // Razorpay will call onPaymentSuccess
        }
        await applyNow(selectedPlan, 0)
      } else {
        const total = newPlanTotal(selectedPlan)
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Not authenticated')
        const { data, error: fnErr } = await supabase.functions.invoke('wallet-topup', {
          body: { amount_paise: total },
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (fnErr || data?.error) throw new Error(data?.error ?? 'Payment order failed')
        setRazorpayOrderId(data.order_id)
        setRazorpayAmountPaise(total)
        setSaving(false)
        return // Razorpay will call onPaymentSuccess
      }
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function onPaymentSuccess(_paymentId: string) {
    if (!selectedPlan || !timing) return
    setSaving(true); setError('')
    try {
      if (timing === 'now') {
        await applyNow(selectedPlan, razorpayAmountPaise)
      } else {
        await applyQueue(selectedPlan)
      }
      setRazorpayOrderId(null)
      onDone()
    } catch (e: any) {
      setRazorpayOrderId(null)
      setError(e?.message ?? 'Payment succeeded but plan update failed. Contact support.')
    } finally {
      setSaving(false)
    }
  }

  if (razorpayOrderId) {
    return (
      <RazorpayWebView
        orderId={razorpayOrderId}
        amount={razorpayAmountPaise}
        keyId={process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? ''}
        userName={user?.user_metadata?.name ?? user?.email ?? 'User'}
        userPhone={user?.phone ?? ''}
        onSuccess={onPaymentSuccess}
        onFailure={() => { setRazorpayOrderId(null); setError('Payment failed. Please try again.') }}
        onDismiss={() => setRazorpayOrderId(null)}
      />
    )
  }

  const showTiming = !!selectedId && !loadingPlans
  const charge = selectedPlan && timing === 'now' ? chargeNow(selectedPlan) : null
  const queueTotal = selectedPlan && timing === 'queue' ? newPlanTotal(selectedPlan) : null

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={m.overlay}>
        <View style={[m.sheet, { flex: 1, maxHeight: '92%', paddingBottom: 32 + insets.bottom }]}>
          <View style={m.handle} />
          <SheetHeader title="Change plan" onClose={onClose} />
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            <Text style={m.stepLabel}>Currently on: {currentPlanName}</Text>
            {loadingPlans ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
            ) : (
              <View style={{ gap: 10, marginBottom: 16 }}>
                {plans.map((plan) => {
                  const active = plan.id === selectedId
                  const isCurrent = plan.name === currentPlanName
                  return (
                    <Pressable
                      key={plan.id}
                      style={[m.selectRow, active && m.selectRowActive, isCurrent && m.selectRowCurrent]}
                      onPress={() => { if (!isCurrent) { setSelectedId(plan.id); setTiming(null) } }}
                      disabled={isCurrent}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[m.selectRowTitle, active && { color: Colors.primary }]}>{plan.name}</Text>
                        <Text style={m.selectRowSub}>{plan.meals_total} meals · {plan.days_per_week} days/week</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 4 }}>
                        <Text style={[m.planPrice, active && { color: Colors.primary }]}>₹{fmt(plan.base_price)}</Text>
                        {isCurrent && <Text style={m.currentBadge}>Current</Text>}
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            )}

            {showTiming && (
              <>
                <Text style={[m.stepLabel, { marginTop: 8 }]}>When should this take effect?</Text>
                <View style={{ gap: 10, marginBottom: 16 }}>
                  <Pressable
                    style={[m.selectRow, timing === 'now' && m.selectRowActive]}
                    onPress={() => setTiming('now')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[m.selectRowTitle, timing === 'now' && { color: Colors.primary }]}>Switch now</Text>
                      <Text style={m.selectRowSub}>Start immediately, reset deliveries</Text>
                    </View>
                    <View style={[m.radio, timing === 'now' && m.radioActive]}>
                      {timing === 'now' && <View style={m.radioDot} />}
                    </View>
                  </Pressable>
                  <Pressable
                    style={[m.selectRow, timing === 'queue' && m.selectRowActive]}
                    onPress={() => setTiming('queue')}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[m.selectRowTitle, timing === 'queue' && { color: Colors.primary }]}>Start after current ends</Text>
                      <Text style={m.selectRowSub}>Continues when current plan's deliveries run out</Text>
                    </View>
                    <View style={[m.radio, timing === 'queue' && m.radioActive]}>
                      {timing === 'queue' && <View style={m.radioDot} />}
                    </View>
                  </Pressable>
                </View>
              </>
            )}

            {timing === 'now' && selectedPlan && (
              <View style={m.chargeBreakdown}>
                <Text style={m.chargeLabel}>Payment breakdown</Text>
                <View style={m.chargeRow}>
                  <Text style={m.chargeItem}>New plan total</Text>
                  <Text style={m.chargeValue}>₹{fmt(newPlanTotal(selectedPlan))}</Text>
                </View>
                <View style={m.chargeRow}>
                  <Text style={m.chargeItem}>Wallet balance</Text>
                  <Text style={m.chargeValue}>−₹{fmt(walletBalance)}</Text>
                </View>
                <View style={[m.chargeRow, m.chargeTotalRow]}>
                  <Text style={m.chargeTotalLabel}>You pay now</Text>
                  <Text style={m.chargeTotalValue}>₹{fmt(charge ?? 0)}</Text>
                </View>
              </View>
            )}

            {timing === 'queue' && selectedPlan && (
              <View style={m.chargeBreakdown}>
                <Text style={m.chargeLabel}>Payment</Text>
                <View style={[m.chargeRow, m.chargeTotalRow]}>
                  <Text style={m.chargeTotalLabel}>Full plan amount</Text>
                  <Text style={m.chargeTotalValue}>₹{fmt(queueTotal ?? 0)}</Text>
                </View>
                <Text style={m.chargeNote}>Activates automatically when your current plan ends</Text>
              </View>
            )}

            {error ? <Text style={m.errorText}>{error}</Text> : null}
            <View style={{ height: 16 }} />
          </ScrollView>

          <Pressable
            style={[m.btn, m.btnSaveRow, (!selectedId || !timing || saving) && m.btnDisabled]}
            disabled={!selectedId || !timing || saving}
            onPress={handleConfirm}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={m.btnText}>
                {timing === 'now' && charge === 0 ? 'Switch now (no charge)' : 'Pay & confirm'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

// ── CancelModal ────────────────────────────────────────────────────────────

function CancelModal({ visible, subId, onClose, onDone }: {
  visible: boolean; subId: string; onClose: () => void; onDone: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function handleCancel() {
    setSaving(true)
    try {
      await supabase.functions.invoke('manage-subscription', {
        body: { action: 'cancel', subscription_id: subId },
      })
      onDone()
    } finally { setSaving(false) }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={m.centreOverlay}>
        <View style={m.centreCard}>
          <Text style={m.centreTitle}>Cancel subscription?</Text>
          <Text style={m.centreBody}>
            All upcoming deliveries will be cancelled. Contact support to reinstate.
          </Text>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
            <Pressable style={[m.btn, m.btnGhost, { flex: 1 }]} onPress={onClose}>
              <Text style={m.btnGhostText}>Keep it</Text>
            </Pressable>
            <Pressable style={[m.btn, m.btnDanger, { flex: 1 }]} onPress={handleCancel} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnText}>Cancel plan</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── DietaryModal ───────────────────────────────────────────────────────────

function DietaryModal({ visible, userId, onClose, onDone }: {
  visible: boolean; userId: string; onClose: () => void; onDone: () => void
}) {
  const insets = useSafeAreaInsets()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [allergens, setAllergens] = useState<string[]>([])
  const [dietaryPref, setDietaryPref] = useState('none')
  const [proteinPref, setProteinPref] = useState<string[]>([])
  const [baseAvoidance, setBaseAvoidance] = useState<string[]>([])
  const [veggieAvoidance, setVeggieAvoidance] = useState<string[]>([])
  const [spice, setSpice] = useState('')
  const [dressing, setDressing] = useState('')
  const [freeText, setFreeText] = useState('')

  useEffect(() => {
    if (!visible) return
    setLoading(true)
    supabase.from('dietary_profiles').select('*').eq('user_id', userId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAllergens(data.allergens ?? [])
          setDietaryPref(data.dietary_preference ?? 'none')
          setProteinPref(data.protein_preference ?? [])
          setBaseAvoidance(data.base_avoidance ?? [])
          setVeggieAvoidance(data.veggie_avoidance ?? [])
          setSpice(data.spice_preference ?? '')
          setDressing(data.dressing_preference ?? '')
          setFreeText(data.free_text ?? '')
        }
        setLoading(false)
      })
  }, [visible, userId])

  function toggle(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
  }

  async function handleSave() {
    setSaving(true); setError('')
    try {
      const { error: err } = await supabase.from('dietary_profiles').upsert({
        user_id: userId, allergens, dietary_preference: dietaryPref,
        protein_preference: proteinPref, base_avoidance: baseAvoidance,
        veggie_avoidance: veggieAvoidance, spice_preference: spice,
        dressing_preference: dressing, free_text: freeText,
      }, { onConflict: 'user_id' })
      if (err) throw err
      onDone()
    } catch { setError('Could not save. Please try again.') }
    finally { setSaving(false) }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={m.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={[m.sheet, { maxHeight: '90%', flex: 1, paddingBottom: 32 + insets.bottom }]}>
            <View style={m.handle} />
            <SheetHeader title="Dietary preferences" onClose={onClose} />
            {loading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
                <DietSection title="Allergies">
                  <PillRow options={ALLERGENS} selected={allergens} onToggle={(v) => toggle(allergens, v, setAllergens)} />
                </DietSection>
                <DietSection title="Dietary preference">
                  {DIETARY_PREFS.map((opt) => (
                    <Pressable key={opt} style={m.radioRow} onPress={() => setDietaryPref(opt)}>
                      <View style={[m.radio, dietaryPref === opt && m.radioActive]}>
                        {dietaryPref === opt && <View style={m.radioDot} />}
                      </View>
                      <Text style={m.radioLabel}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
                    </Pressable>
                  ))}
                </DietSection>
                <DietSection title="Protein preference">
                  <PillRow options={PROTEINS} selected={proteinPref} onToggle={(v) => toggle(proteinPref, v, setProteinPref)} />
                </DietSection>
                <DietSection title="Bases to avoid">
                  <PillRow options={BASES} selected={baseAvoidance} onToggle={(v) => toggle(baseAvoidance, v, setBaseAvoidance)} />
                </DietSection>
                <DietSection title="Vegetables to skip">
                  <PillRow options={VEGGIES} selected={veggieAvoidance} onToggle={(v) => toggle(veggieAvoidance, v, setVeggieAvoidance)} />
                </DietSection>
                <DietSection title="Spice level">
                  {SPICES.map((opt) => (
                    <Pressable key={opt} style={m.radioRow} onPress={() => setSpice(opt.toLowerCase())}>
                      <View style={[m.radio, spice === opt.toLowerCase() && m.radioActive]}>
                        {spice === opt.toLowerCase() && <View style={m.radioDot} />}
                      </View>
                      <Text style={m.radioLabel}>{opt}</Text>
                    </Pressable>
                  ))}
                </DietSection>
                <DietSection title="Dressing">
                  {DRESSINGS.map(({ label, value }) => (
                    <Pressable key={value} style={m.radioRow} onPress={() => setDressing(value)}>
                      <View style={[m.radio, dressing === value && m.radioActive]}>
                        {dressing === value && <View style={m.radioDot} />}
                      </View>
                      <Text style={m.radioLabel}>{label}</Text>
                    </Pressable>
                  ))}
                </DietSection>
                <DietSection title="Anything else?">
                  <TextInput
                    style={m.textarea}
                    placeholder="Any other preferences or notes"
                    value={freeText}
                    onChangeText={setFreeText}
                    multiline
                    maxLength={250}
                    placeholderTextColor={Colors.textLight}
                    textAlignVertical="top"
                  />
                </DietSection>
                {error ? <Text style={[m.errorText, { marginHorizontal: 16, marginBottom: 8 }]}>{error}</Text> : null}
              </ScrollView>
            )}
            <Pressable style={[m.btn, m.btnSaveRow, (saving || loading) && m.btnDisabled]} disabled={saving || loading} onPress={handleSave}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnText}>Save preferences</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

// ── Shared sub-components ──────────────────────────────────────────────────

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={m.sheetHeader}>
      <Text style={m.sheetTitle}>{title}</Text>
      <Pressable onPress={onClose} hitSlop={12}><X size={20} color={Colors.textMuted} /></Pressable>
    </View>
  )
}

function DietSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20, paddingHorizontal: 16 }}>
      <Text style={{ fontFamily: Fonts.headingSemi, fontSize: 14, color: Colors.text, marginBottom: 10 }}>{title}</Text>
      {children}
    </View>
  )
}

function PillRow({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const active = selected.includes(opt)
        return (
          <Pressable key={opt} style={[m.pill, active && m.pillActive]} onPress={() => onToggle(opt)}>
            <Text style={[m.pillText, active && m.pillTextActive]}>{opt}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 2 },
  topBarTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.text },

  emptyWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },

  planCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  planCardHeader: { backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 16 },
  planCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planCardNameLight: { fontFamily: Fonts.heading, fontSize: 18, color: '#fff' },
  planCardMetaLight: { fontFamily: Fonts.body, fontSize: 13, color: Colors.primaryMid, marginTop: 4 },
  activeBadge: { backgroundColor: Colors.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  activeBadgeText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.text },
  planCardBody: { paddingHorizontal: 16, paddingVertical: 16, gap: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  metaLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  metaValue: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.text },
  metaValueGreen: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.primary },
  progressTrack: { height: 10, backgroundColor: Colors.border, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 999 },

  actionCard: {
    backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, minHeight: 56 },
  actionRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  actionLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },
  rowPressed: { backgroundColor: Colors.hover },
  rowPressedDanger: { backgroundColor: Colors.dangerLight },
})

const m = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 32 },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 999, alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text },
  stepLabel: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.text, marginBottom: 12 },
  stepSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 12 },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginVertical: 24 },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginBottom: 12 },
  dateRow: { paddingBottom: 16, gap: 8 },
  dateChip: {
    alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff', minWidth: 64,
  },
  dateChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dateDow: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  dateDowActive: { color: Colors.primaryMid },
  dateNum: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginTop: 2 },
  dateNumActive: { color: '#fff' },
  btn: {
    backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', minHeight: 52,
  },
  btnDisabled: { opacity: 0.4 },
  btnGhost: { backgroundColor: Colors.primaryLight },
  btnDanger: { backgroundColor: Colors.danger },
  btnSaveRow: { marginHorizontal: 16, marginTop: 8 },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
  btnGhostText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.primary },
  selectRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff',
  },
  selectRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  selectRowCurrent: { opacity: 0.5 },
  selectRowTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  selectRowSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  planPrice: { fontFamily: Fonts.heading, fontSize: 16, color: Colors.text },
  currentBadge: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.primary },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  radioLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },
  centreOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  centreCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 320 },
  centreTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text, marginBottom: 8 },
  centreBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, marginBottom: 20, lineHeight: 20 },
  pill: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  pillTextActive: { color: '#fff' },
  textarea: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    padding: 14, fontFamily: Fonts.body, fontSize: 14, color: Colors.text, minHeight: 80,
  },
  // Change plan charge breakdown
  chargeBreakdown: {
    backgroundColor: Colors.primaryLight, borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.primary + '40',
  },
  chargeLabel: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  chargeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chargeItem: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  chargeValue: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.text },
  chargeTotalRow: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 6, paddingTop: 10 },
  chargeTotalLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  chargeTotalValue: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.primary },
  chargeNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 8 },
})
