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
  Pause, Play, SkipForward, ArrowUpDown, X, ArrowRight, UtensilsCrossed, MapPin,
} from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import SubscribeGate from '@/components/SubscribeGate'

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
}

type FirstMeal = { delivery_date: string; meal_templates: { name: string } | null }

type Plan = { id: string; name: string; meals_total: number; days_per_week: number; base_price: number }
type UpcomingOrder = { id: string; delivery_date: string; meal_templates: { name: string } | null }

// ── Helpers ────────────────────────────────────────────────────────────────

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
const ADDR_TYPES = [
  { id: 'home' as const, label: '🏠 Home' },
  { id: 'office' as const, label: '🏢 Office' },
  { id: 'other' as const, label: '📍 Other' },
]

// ── Main screen ────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, hasSubscription } = useAuthStore()
  const [sub, setSub] = useState<SubData | null>(null)
  const [firstMeal, setFirstMeal] = useState<FirstMeal | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [pauseOpen, setPauseOpen] = useState(false)
  const [skipOpen, setSkipOpen] = useState(false)
  const [changePlanOpen, setChangePlanOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [dietaryOpen, setDietaryOpen] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)

  const fetchSub = useCallback(async () => {
    if (!user) return
    // Include CoD subs still 'pending' (limited view). Online 'pending' subs
    // (abandoned checkouts) are excluded.
    const { data } = await supabase
      .from('subscriptions')
      .select('id, status, payment_method, plan_name, deliveries_remaining, end_date, pause_from, pause_until, plans ( name, meals_total, days_per_week, base_price )')
      .eq('user_id', user.id)
      .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const s = (data as unknown as SubData) ?? null
    setSub(s)

    // For the CoD limited view, load the earliest upcoming meal
    if (s && s.status === 'pending' && s.payment_method === 'cod') {
      const today = new Date().toISOString().split('T')[0]
      const { data: order } = await supabase
        .from('orders')
        .select('delivery_date, meal_templates ( name )')
        .eq('subscription_id', s.id)
        .gte('delivery_date', today)
        .in('status', ['scheduled', 'confirmed'])
        .order('delivery_date')
        .limit(1)
        .maybeSingle()
      setFirstMeal((order as unknown as FirstMeal) ?? null)
    } else {
      setFirstMeal(null)
    }
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

  if (!hasSubscription || !sub) {
    return (
      <View style={s.container}>
        <View style={[s.header, { paddingTop: insets.top + 16 }]}>
          <Text style={s.title}>My Plan</Text>
        </View>
        <SubscribeGate
          onSubscribe={() => router.push('/(onboarding)/health')}
          onExplore={() => router.push('/(app)/(tabs)/menu')}
        />
      </View>
    )
  }

  const planName = sub.plan_name || sub.plans?.name || 'Your Plan'
  const mealsTotal = sub.plans?.meals_total ?? 0
  const remaining = sub.deliveries_remaining
  const progress = mealsTotal > 0 ? Math.min(100, (remaining / mealsTotal) * 100) : 0
  const isCodPending = sub.status === 'pending' && sub.payment_method === 'cod'
  const payAmount = sub.plans?.base_price ?? 0

  // ── Limited CoD view: first meal + pay banner, no management until paid ──
  if (isCodPending) {
    return (
      <View style={s.container}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <Text style={s.title}>My Plan</Text>

          {/* Confirmed plan banner */}
          <View style={s.codHeroCard}>
            <Text style={s.codHeroEmoji}>🎉</Text>
            <Text style={s.codHeroTitle}>{planName} is confirmed</Text>
            <Text style={s.codHeroSub}>
              Your first meal is on the way. Pay in cash on delivery to unlock your full plan.
            </Text>
          </View>

          {/* First meal card */}
          <Text style={s.codSectionLabel}>Your first meal</Text>
          <View style={s.codMealCard}>
            {firstMeal ? (
              <>
                <Text style={s.codMealName}>{firstMeal.meal_templates?.name ?? 'Your meal'}</Text>
                <Text style={s.codMealDate}>Arriving {fmtDate(firstMeal.delivery_date)}</Text>
              </>
            ) : (
              <Text style={s.codMealDate}>We're scheduling your first delivery…</Text>
            )}
          </View>

          {/* Pay banner */}
          <View style={s.codPayCard}>
            <Text style={s.codPayEmoji}>💵</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.codPayTitle}>Pay ₹{payAmount.toLocaleString('en-IN')} on delivery</Text>
              <Text style={s.codPayDesc}>
                Hand the cash to your delivery partner when your first meal arrives. Once we confirm
                payment, your full plan — pause, skip, meal changes and history — unlocks here.
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    )
  }

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
    { label: 'Edit delivery address', Icon: MapPin,          onPress: () => setAddressOpen(true) },
  ]

  const actions = sub.status === 'paused'
    ? [{ label: 'Resume subscription', Icon: Play, onPress: handleResume }, ...sharedActions]
    : [{ label: 'Pause subscription',  Icon: Pause, onPress: () => setPauseOpen(true) }, ...sharedActions]

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <Text style={s.title}>My Plan</Text>

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
                {sub.plans.meals_total} meals · {sub.plans.days_per_week} days/week · ₹{sub.plans.base_price.toLocaleString('en-IN')}
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
              style={({ pressed }) => [s.actionRow, i < actions.length && s.actionRowBorder, pressed && s.rowPressed]}
              onPress={onPress}
            >
              <Icon size={18} color={Colors.text} />
              <Text style={[s.actionLabel, { flex: 1 }]}>{label}</Text>
              <ArrowRight size={15} color={Colors.textLight} />
            </Pressable>
          ))}
          <Pressable style={({ pressed }) => [s.actionRow, pressed && s.rowPressedDanger]} onPress={() => setCancelOpen(true)}>
            <X size={18} color={Colors.danger} />
            <Text style={[s.actionLabel, { color: Colors.danger }]}>Cancel subscription</Text>
          </Pressable>
        </View>
      </ScrollView>

      <PauseModal    visible={pauseOpen}      subId={sub.id} onClose={() => setPauseOpen(false)}      onDone={() => { setPauseOpen(false);      fetchSub() }} />
      <SkipModal     visible={skipOpen}       subId={sub.id} userId={user!.id} onClose={() => setSkipOpen(false)}       onDone={() => { setSkipOpen(false);       fetchSub() }} />
      <ChangePlanModal visible={changePlanOpen} subId={sub.id} currentPlanName={planName} onClose={() => setChangePlanOpen(false)} onDone={() => { setChangePlanOpen(false); fetchSub() }} />
      <CancelModal   visible={cancelOpen}     subId={sub.id} onClose={() => setCancelOpen(false)}     onDone={() => { setCancelOpen(false);     fetchSub() }} />
      <DietaryModal  visible={dietaryOpen}    userId={user!.id} onClose={() => setDietaryOpen(false)} onDone={() => setDietaryOpen(false)} />
      <AddressModal  visible={addressOpen}    userId={user!.id} onClose={() => setAddressOpen(false)} onDone={() => setAddressOpen(false)} />
    </View>
  )
}

// ── PauseModal ─────────────────────────────────────────────────────────────

function PauseModal({ visible, subId, onClose, onDone }: {
  visible: boolean; subId: string; onClose: () => void; onDone: () => void
}) {
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
        <View style={m.sheet}>
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
        <View style={m.sheet}>
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
  const [plans, setPlans] = useState<Plan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!visible) return
    setLoadingPlans(true)
    supabase.from('plans').select('id, name, meals_total, days_per_week, base_price')
      .eq('is_active', true).order('base_price')
      .then(({ data }) => { setPlans((data as Plan[]) ?? []); setLoadingPlans(false) })
  }, [visible])

  async function handleChange() {
    if (!selectedId) return
    const plan = plans.find((p) => p.id === selectedId)
    if (!plan) return
    setSaving(true); setError('')
    try {
      const { error: err } = await supabase.from('subscriptions')
        .update({ plan_id: selectedId, plan_name: plan.name, deliveries_remaining: plan.meals_total })
        .eq('id', subId)
      if (err) throw err
      onDone()
    } catch { setError('Something went wrong. Please try again.') }
    finally { setSaving(false) }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={m.overlay}>
        <View style={m.sheet}>
          <View style={m.handle} />
          <SheetHeader title="Change plan" onClose={onClose} />
          <Text style={m.stepLabel}>Currently on: {currentPlanName}</Text>
          {loadingPlans ? (
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
          ) : (
            <View style={{ gap: 10, marginBottom: 20 }}>
              {plans.map((plan) => {
                const active = plan.id === selectedId
                const isCurrent = plan.name === currentPlanName
                return (
                  <Pressable
                    key={plan.id}
                    style={[m.selectRow, active && m.selectRowActive, isCurrent && m.selectRowCurrent]}
                    onPress={() => !isCurrent && setSelectedId(plan.id)}
                    disabled={isCurrent}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[m.selectRowTitle, active && { color: Colors.primary }]}>{plan.name}</Text>
                      <Text style={m.selectRowSub}>{plan.meals_total} meals · {plan.days_per_week} days/week</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={[m.planPrice, active && { color: Colors.primary }]}>₹{plan.base_price.toLocaleString('en-IN')}</Text>
                      {isCurrent && <Text style={m.currentBadge}>Current</Text>}
                    </View>
                  </Pressable>
                )
              })}
            </View>
          )}
          {error ? <Text style={m.errorText}>{error}</Text> : null}
          <Pressable style={[m.btn, (!selectedId || saving) && m.btnDisabled]} disabled={!selectedId || saving} onPress={handleChange}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnText}>Confirm change</Text>}
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={[m.sheet, { maxHeight: '90%' }]}>
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

// ── AddressModal ───────────────────────────────────────────────────────────

function AddressModal({ visible, userId, onClose, onDone }: {
  visible: boolean; userId: string; onClose: () => void; onDone: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [addressId, setAddressId] = useState<string | null>(null)
  const [line1, setLine1] = useState('')
  const [landmark, setLandmark] = useState('')
  const [pincode, setPincode] = useState('')
  const [label, setLabel] = useState('Home')
  const [type, setType] = useState<'home' | 'office' | 'other'>('home')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!visible) return
    setLoading(true)
    supabase.from('addresses').select('id, line1, landmark, pincode, label, type')
      .eq('user_id', userId).order('created_at').limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setAddressId(data.id); setLine1(data.line1 ?? ''); setLandmark(data.landmark ?? '')
          setPincode(data.pincode ?? ''); setLabel(data.label ?? 'Home'); setType((data.type as any) ?? 'home')
        }
        setLoading(false)
      })
  }, [visible, userId])

  function validate() {
    const e: Record<string, string> = {}
    if (!line1.trim() || line1.trim().length < 5) e.line1 = 'Enter a valid street address'
    if (!/^\d{6}$/.test(pincode)) e.pincode = 'Pincode must be 6 digits'
    return e
  }

  async function handleSave() {
    const fe = validate()
    if (Object.keys(fe).length > 0) { setFieldErrors(fe); return }
    setSaving(true); setError('')
    try {
      if (addressId) {
        const { error: err } = await supabase.from('addresses')
          .update({ line1: line1.trim(), landmark: landmark.trim(), pincode, label, type }).eq('id', addressId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('addresses')
          .insert({ user_id: userId, line1: line1.trim(), landmark: landmark.trim(), pincode, label, type })
        if (err) throw err
      }
      onDone()
    } catch { setError('Could not save address. Please try again.') }
    finally { setSaving(false) }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={m.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={[m.sheet, { maxHeight: '85%' }]}>
            <View style={m.handle} />
            <SheetHeader title="Delivery address" onClose={onClose} />
            {loading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
                <AddrField label="Street address" error={fieldErrors.line1}>
                  <TextInput
                    style={[m.input, fieldErrors.line1 && m.inputError]}
                    placeholder="House/flat no., street name"
                    value={line1}
                    onChangeText={(t) => { setLine1(t); setFieldErrors((e) => ({ ...e, line1: '' })) }}
                    placeholderTextColor={Colors.textLight}
                  />
                </AddrField>
                <AddrField label="Landmark (optional)">
                  <TextInput
                    style={m.input}
                    placeholder="e.g. Near the blue gate"
                    value={landmark}
                    onChangeText={setLandmark}
                    placeholderTextColor={Colors.textLight}
                  />
                </AddrField>
                <AddrField label="Pincode" error={fieldErrors.pincode}>
                  <TextInput
                    style={[m.input, fieldErrors.pincode && m.inputError]}
                    placeholder="6-digit pincode"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={pincode}
                    onChangeText={(t) => { setPincode(t.replace(/\D/g, '')); setFieldErrors((e) => ({ ...e, pincode: '' })) }}
                    placeholderTextColor={Colors.textLight}
                  />
                </AddrField>
                <AddrField label="Address type">
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {ADDR_TYPES.map((t) => (
                      <Pressable
                        key={t.id}
                        style={[m.typeBtn, type === t.id && m.typeBtnActive]}
                        onPress={() => { setType(t.id); setLabel(t.id.charAt(0).toUpperCase() + t.id.slice(1)) }}
                      >
                        <Text style={[m.typeBtnText, type === t.id && m.typeBtnTextActive]}>{t.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </AddrField>
                <AddrField label="Label (optional)">
                  <TextInput
                    style={m.input}
                    placeholder="e.g. Home, Mom's Place"
                    value={label}
                    onChangeText={setLabel}
                    maxLength={40}
                    placeholderTextColor={Colors.textLight}
                  />
                </AddrField>
                {error ? <Text style={m.errorText}>{error}</Text> : null}
              </ScrollView>
            )}
            <Pressable style={[m.btn, m.btnSaveRow, (saving || loading) && m.btnDisabled]} disabled={saving || loading} onPress={handleSave}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={m.btnText}>Save address</Text>}
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

function AddrField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, marginBottom: 8 }}>{label}</Text>
      {children}
      {error ? <Text style={m.errorText}>{error}</Text> : null}
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  scroll: { paddingHorizontal: 16, paddingBottom: 32 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 16 },

  // CoD limited view
  codHeroCard: {
    backgroundColor: Colors.primaryLight, borderRadius: 16, padding: 20, marginBottom: 24,
    alignItems: 'center', borderWidth: 2, borderColor: Colors.primary,
  },
  codHeroEmoji: { fontSize: 40, marginBottom: 8 },
  codHeroTitle: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.text, textAlign: 'center', marginBottom: 6 },
  codHeroSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
  codSectionLabel: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
  },
  codMealCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 24, borderWidth: 1, borderColor: Colors.border },
  codMealName: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.text, marginBottom: 4 },
  codMealDate: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted },
  codPayCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 18, flexDirection: 'row', gap: 14,
    borderLeftWidth: 3, borderLeftColor: Colors.accent, borderWidth: 1, borderColor: Colors.border,
  },
  codPayEmoji: { fontSize: 26 },
  codPayTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text, marginBottom: 4 },
  codPayDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 19 },

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
  // Backdrop & sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 32 },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 999, alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text },
  // Text
  stepLabel: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.text, marginBottom: 12 },
  stepSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 12 },
  emptyText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginVertical: 24 },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginBottom: 12 },
  // Date chips
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
  // Buttons
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
  // Selectable rows
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
  // Radio
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  radioLabel: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },
  // Centre modal (cancel)
  centreOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  centreCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 320 },
  centreTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text, marginBottom: 8 },
  centreBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, marginBottom: 20, lineHeight: 20 },
  // Dietary pills
  pill: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  pillTextActive: { color: '#fff' },
  // Textarea
  textarea: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    padding: 14, fontFamily: Fonts.body, fontSize: 14, color: Colors.text, minHeight: 80,
  },
  // Address form
  input: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, fontFamily: Fonts.body, fontSize: 15, color: Colors.text,
  },
  inputError: { borderColor: Colors.danger },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 4 },
  typeBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 999, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: '#fff', alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  typeBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  typeBtnTextActive: { color: Colors.primary },
})
