import { useEffect, useState, useCallback, useRef } from 'react'
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
  Alert,
  Linking,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { SkipForward, Wallet, X, Check, AlertCircle, Plus, TrendingDown, TrendingUp, SlidersHorizontal, Utensils, Moon, Settings2, CheckCircle2, ChevronRight, History, MapPin, RotateCcw, Banknote, CalendarDays, Phone, Bike } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { CFPaymentGatewayService, CFErrorResponse, type CFCallback } from 'react-native-cashfree-pg-sdk'
import { CFSession, CFEnvironment } from 'cashfree-pg-api-contract'
import { supabase } from '@/lib/supabase'
import { setActiveCashfreeCallback } from '@/lib/cashfreeCallback'
import { useAuthStore } from '@/store/auth'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import { useAvailabilityStore, isMealAvailable, isAddonAvailable } from '@/store/availability'
import { Colors, Fonts } from '@/constants/colors'
import { istToday, istHour, addDaysISO, dowMon0, endOfMonthISO, isSlotLocked, SLOT_CUTOFF_HOUR } from '@/lib/ist'
import SubscribeGate from '@/components/SubscribeGate'
import { maybeAskStoreReview } from '@/lib/storeReview'
import RenewPlanSheet, { type RenewConfig, type RenewPaymentState, type RenewPlanOption } from '@/components/RenewPlanSheet'
import { useOnboardingStore } from '@/store/onboarding'
import { extractFunctionErrorMessage } from '@/lib/supabaseFunctionError'
import MacroRow from '@/components/MacroRow'
import { warmFunctions } from '@/lib/warmFunctions'

// ── Types ──────────────────────────────────────────────────────────────────

type SubData = {
  id: string
  status: string
  payment_method: string
  plan_id: string | null
  meals_lunch: number | null
  meals_dinner: number | null
  plan_name: string | null
  deliveries_remaining: number
  start_date: string | null
  end_date: string | null
  pause_from: string | null
  pause_until: string | null
  cod_due_paise: number | null
  plans: { name: string; meals_total: number; days_per_week: number; base_price: number } | null
}

type SubAddon = { addon_id: string; addons: { name: string; price_per_meal: number } | null }

type MealTemplate = {
  id: string
  name: string
  category: string
  kcal: number | null
  protein: number | null
  image_url: string | null
}

type AddressData = { id: string; line1: string; landmark: string | null; label: string; is_default: boolean }

type CartLine = {
  id: string
  addon_id: string | null
  kind: 'addon' | 'fee'
  label: string | null
  quantity: number
  unit_price: number | null
}

type OrderItem = {
  id: string
  delivery_date: string
  meal_slot: string
  status: string
  skip_reason: string | null
  address_id: string | null
  quantity: number | null
  unit_price: number | null
  switch_fee_paise: number | null
  extra_dish: boolean | null
  slot_seq: number | null
  delivered_at: string | null
  meal_templates: { id: string; name: string; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; image_url: string | null } | null
  order_addons: CartLine[]
}

// Who's bringing today's meal (delivery partner app) — my_riders() gives the
// partner's first name and phone for the customer's own orders.
type Rider = { name: string; phone: string }

function clockIST(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

type AddonCatalog = { id: string; name: string; price_per_meal: number }

type CartOp = 'add_addon' | 'remove_addon' | 'inc_qty' | 'dec_qty' | 'inc_addon_qty' | 'dec_addon_qty'

type WalletTransaction = {
  id: string
  type: 'credit' | 'debit'
  amount: number
  reason: string
  created_at: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Single source of truth for the date-strip cell sizing, referenced by both
// the styles below and the scroll-to-today offset math.
const DAY_CELL_WIDTH = 56
const DAY_CELL_GAP = 8
const DAY_CELL_PITCH = DAY_CELL_WIDTH + DAY_CELL_GAP

function fmt(paise: number) { return (paise / 100).toLocaleString('en-IN') }
function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
// For full timestamps (wallet_transactions.created_at), not YYYY-MM-DD dates —
// fmtDate's 'T00:00:00' suffix turns a timestamp into "Invalid Date". Postgres
// returns microseconds (…:47.962139+00:00); trimmed to milliseconds so every
// JS engine parses it.
function fmtTimestamp(ts: string | null) {
  if (!ts) return '—'
  const d = new Date(
    ts.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00')
  )
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}
function fmtDateLong(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}
function toISO(d: Date) { return d.toISOString().split('T')[0] }

function dowShort(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' })
}
function dayNum(iso: string): string { return String(new Date(iso + 'T00:00:00Z').getUTCDate()) }

function statusLabel(status: string) {
  if (status === 'preparing') return 'In our kitchen'
  if (status === 'out_for_delivery') return 'Out for delivery'
  if (status === 'delivered') return 'Delivered'
  return 'Scheduled'
}

// Calendar strip covers today through the end of this month, extending into
// next month when fewer than 14 days of the current month remain (so the
// visible range always covers at least the order-instantiation horizon).
function stripEndISO(todayIso: string): string {
  const endOfThisMonth = endOfMonthISO(todayIso)
  if (endOfThisMonth >= addDaysISO(todayIso, 14)) return endOfThisMonth
  return endOfMonthISO(addDaysISO(endOfThisMonth, 1))
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, hasSubscription, loading: authLoading } = useAuthStore()
  const [sub, setSub] = useState<SubData | null>(null)
  const [weekOrders, setWeekOrders] = useState<OrderItem[]>([])
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [addresses, setAddresses] = useState<AddressData[]>([])
  const [pickingAddressForOrder, setPickingAddressForOrder] = useState<string | null>(null)
  const [allMeals, setAllMeals] = useState<MealTemplate[]>([])
  const [allAddons, setAllAddons] = useState<AddonCatalog[]>([])
  const [subAddons, setSubAddons] = useState<SubAddon[]>([])
  const [addMode, setAddMode] = useState(false)
  const [cartBusy, setCartBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [skipConfirm, setSkipConfirm] = useState<{ date: string; slot: 'lunch' | 'dinner' } | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string>(istToday())
  const [selectedSlot, setSelectedSlot] = useState<'lunch' | 'dinner'>(istHour() < SLOT_CUTOFF_HOUR.dinner ? 'lunch' : 'dinner')
  const [showDayModal, setShowDayModal] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState('')
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [showTransactions, setShowTransactions] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  // Kitchen closures (admin → Operations) in the strip's range: "date|slot" → reason.
  const [closures, setClosures] = useState<Map<string, string | null>>(new Map())
  const [riders, setRiders] = useState<Map<string, Rider>>(new Map())
  // Renewal (plan's meals used up): sheet + payment progress. The Cashfree
  // callback below is shared with wallet top-ups; paymentPurpose says which
  // one a returning payment belongs to.
  const [showRenew, setShowRenew] = useState(false)
  const [renewState, setRenewState] = useState<RenewPaymentState>('idle')
  const [renewMessage, setRenewMessage] = useState('')
  const [plansCatalog, setPlansCatalog] = useState<RenewPlanOption[]>([])
  const paymentPurpose = useRef<'topup' | 'renewal'>('topup')
  const renewFromSubId = useRef<string | null>(null)
  // Where an added dish goes (one portion home, one to the office…).
  const [addAddressId, setAddAddressId] = useState<string | null>(null)
  const [skipError, setSkipError] = useState('')
  const [topupAmountPaise, setTopupAmountPaise] = useState(50000) // ₹500 default
  const [topupCustom, setTopupCustom] = useState('')
  const [creatingTopup, setCreatingTopup] = useState(false)
  const didAutoSync = useRef(false)
  const stripRef = useRef<ScrollView | null>(null)
  const unavailableMeals = useAvailabilityStore((st) => st.unavailableMeals)
  const unavailableAddons = useAvailabilityStore((st) => st.unavailableAddons)
  const ensureFreshAvailability = useAvailabilityStore((st) => st.ensureFresh)

  // The plan's id, once known: the plan and everything under it then load in
  // one round trip instead of two (plan first, then its orders).
  const subIdRef = useRef<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!user) return
    // Customer is on My Plan, likely about to edit meals: wake the functions.
    warmFunctions()
    const today = istToday()
    const endStr = stripEndISO(today)

    const planQuery = () => supabase
      .from('subscriptions')
      .select('id, status, payment_method, plan_id, meals_lunch, meals_dinner, plan_name, deliveries_remaining, start_date, end_date, pause_from, pause_until, cod_due_paise, plans ( name, meals_total, days_per_week, base_price )')
      .eq('user_id', user.id)
      .in('status', ['active', 'paused'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const detailQueries = (subId: string) => Promise.all([
      supabase
        .from('orders')
        .select('id, delivery_date, meal_slot, status, skip_reason, address_id, quantity, unit_price, switch_fee_paise, extra_dish, slot_seq, delivered_at, meal_templates ( id, name, kcal, protein, carbs, fat, image_url ), order_addons ( id, addon_id, kind, label, quantity, unit_price )')
        .eq('subscription_id', subId)
        .gte('delivery_date', today)
        .lte('delivery_date', endStr)
        // Delivered / out-for-delivery stay in so today's finished slot still
        // shows what was delivered instead of "No lunch"; skipped ones so a
        // skip can be undone.
        .in('status', ['scheduled', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'skipped'])
        .order('delivery_date'),
      supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('addresses')
        .select('id, line1, landmark, label, is_default')
        .eq('user_id', user.id)
        .is('archived_at', null)
        .order('is_default', { ascending: false })
        .order('created_at'),
      supabase
        .from('subscription_addons')
        .select('addon_id, addons ( name, price_per_meal )')
        .eq('subscription_id', subId),
      supabase
        .from('kitchen_closures')
        .select('closed_on, meal_slot, reason')
        .gte('closed_on', today)
        .lte('closed_on', endStr),
      supabase.rpc('my_riders', { p_date: today }),
    ])

    const knownId = subIdRef.current
    const [planRes, guessed] = await Promise.all([planQuery(), knownId ? detailQueries(knownId) : Promise.resolve(null)])

    // Network failure (e.g. a background auto-refresh on a flaky connection):
    // keep what's on screen rather than blanking the plan.
    if (planRes.error) return

    const s = (planRes.data as unknown as SubData) ?? null
    setSub(s)
    subIdRef.current = s?.id ?? null
    if (!s) return

    // First load, or the plan changed (e.g. a renewal): load its details now.
    const [ordersRes, walletRes, addrRes, addonRes, closuresRes, ridersRes] =
      guessed && knownId === s.id ? guessed : await detailQueries(s.id)

    if (ordersRes.error || walletRes.error) return
    setWeekOrders((ordersRes.data as unknown as OrderItem[]) ?? [])
    setWalletBalance(walletRes.data?.balance ?? null)
    setAddresses((addrRes.data as AddressData[]) ?? [])
    setSubAddons((addonRes.data as unknown as SubAddon[]) ?? [])
    setClosures(new Map(((closuresRes.data ?? []) as { closed_on: string; meal_slot: string; reason: string | null }[])
      .map((c) => [`${c.closed_on}|${c.meal_slot}`, c.reason])))
    setRiders(new Map(((ridersRes.data ?? []) as { order_id: string; rider_name: string; rider_phone: string }[])
      .map((r) => [r.order_id, { name: r.rider_name, phone: r.rider_phone }])))
  }, [user])

  // Fetch meal + add-on catalogues once on mount for the cart editor.
  useEffect(() => {
    supabase
      .from('meal_templates')
      .select('id, name, category, kcal, protein, image_url')
      .eq('is_active', true)
      .eq('subscription_valid', true)
      .order('category')
      .then(({ data }) => setAllMeals((data as MealTemplate[]) ?? []))
    supabase
      .from('addons')
      .select('id, name, price_per_meal')
      .eq('is_active', true)
      .then(({ data }) => setAllAddons((data as AddonCatalog[]) ?? []))
    supabase
      .from('plans')
      .select('id, name, base_price, meals_total')
      .eq('is_active', true)
      .order('base_price')
      .then(({ data }) => setPlansCatalog((data as RenewPlanOption[]) ?? []))
  }, [])

  useEffect(() => {
    if (authLoading) return
    setLoading(true)
    fetchAll().finally(() => setLoading(false))
  }, [fetchAll, authLoading])

  useEffect(() => {
    ensureFreshAvailability()
  }, [ensureFreshAvailability])

  // Auto-sync: if the sub is active but no orders exist (e.g. instantiate-orders
  // failed silently during payment), retry it once so the week strip isn't empty.
  useEffect(() => {
    if (loading || !sub || sub.status !== 'active' || weekOrders.length > 0) return
    if (didAutoSync.current) return
    didAutoSync.current = true
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      await supabase.functions.invoke('instantiate-orders', {
        body: { subscription_id: sub.id },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      fetchAll()
    })()
  }, [loading, sub, weekOrders.length, fetchAll])

  // Reset address picker + add-mode when modal closes or day changes
  useEffect(() => { setPickingAddressForOrder(null); setAddMode(false); setSwapError(''); setAddAddressId(null) }, [selectedDay, showDayModal])
  useEffect(() => { if (showDayModal) warmFunctions() }, [showDayModal])

  // Silent background refresh: tab focus, app foreground, every 5 min.
  const refreshAvailability = useAvailabilityStore((st) => st.refresh)
  useAutoRefresh(() => Promise.all([fetchAll(), refreshAvailability()]), { enabled: !authLoading && !!user })

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchAll()
    setRefreshing(false)
  }, [fetchAll])

  // Skips and un-skips show straight away and save in the background; if the
  // server refuses, the customer is told and the plan reloads to the truth.
  async function handleSkipConfirm() {
    if (!skipConfirm || !sub) return
    const { date, slot } = skipConfirm
    setSkipError('')
    setSkipConfirm(null)
    setShowDayModal(false)
    setWeekOrders(prev => prev.map(o =>
      o.delivery_date === date && o.meal_slot === slot && (o.status === 'scheduled' || o.status === 'confirmed')
        ? { ...o, status: 'skipped', skip_reason: 'user' } : o))
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    try {
      const { error } = await supabase.functions.invoke('manage-subscription', {
        body: { action: 'skip', subscription_id: sub.id, delivery_date: date, meal_slot: slot },
      })
      if (error) Alert.alert('Could not skip this meal', await extractFunctionErrorMessage(error, 'Please try again.'))
    } catch {
      Alert.alert('Could not skip this meal', 'Please check your connection and try again.')
    }
    fetchAll()
  }

  // Changed their mind: bring back a meal they skipped, until the cutoff.
  async function handleUnskip(date: string, slot: 'lunch' | 'dinner') {
    if (!sub) return
    setWeekOrders(prev => prev.map(o =>
      o.delivery_date === date && o.meal_slot === slot && o.status === 'skipped' && o.skip_reason === 'user'
        ? { ...o, status: 'scheduled', skip_reason: null } : o))
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    try {
      const { error } = await supabase.functions.invoke('manage-subscription', {
        body: { action: 'unskip', subscription_id: sub.id, delivery_date: date, meal_slot: slot },
      })
      if (error) Alert.alert('Could not bring it back', await extractFunctionErrorMessage(error, 'Please try again.'))
    } catch {
      Alert.alert('Could not bring it back', 'Please check your connection and try again.')
    }
    fetchAll()
  }

  // One meal's delivery address. Its delivery route follows the address.
  async function changeOrderAddress(orderId: string, addressId: string) {
    setSwapError('')
    const { error } = await supabase.from('orders').update({ address_id: addressId }).eq('id', orderId)
    if (error) {
      setSwapError(error.message || 'Could not change the address. Please try again.')
      return
    }
    setWeekOrders(prev => prev.map(o => o.id === orderId ? { ...o, address_id: addressId } : o))
    setPickingAddressForOrder(null)
  }

  // The new dish shows straight away; the swap saves in the background.
  async function handleSwapMeal(orderId: string, newMealId: string) {
    setSwapError('')
    const meal = allMeals.find(m => m.id === newMealId)
    if (meal) {
      setWeekOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, meal_templates: { id: meal.id, name: meal.name, kcal: meal.kcal, protein: meal.protein, carbs: null, fat: null, image_url: meal.image_url } }
        : o))
    }
    setShowDayModal(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const { data, error } = await supabase.functions.invoke('switch-meal', {
        body: { order_id: orderId, meal_template_id: newMealId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Could not swap meal. Try again.'))
      if (data?.error) throw new Error(data.error)
    } catch (e: any) {
      Alert.alert('Could not swap the meal', e?.message ?? 'Please try again.')
    }
    fetchAll()
  }

  async function handleAddDish(refOrderId: string, newMealId: string, slot: 'lunch' | 'dinner') {
    setSwapping(true)
    setSwapError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('add-dish', {
        body: { order_id: refOrderId, meal_template_id: newMealId, meal_slot: slot, address_id: addAddressId ?? undefined },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Could not add dish. Try again.'))
      if (data?.error === 'insufficient_balance') {
        setSwapError('Insufficient wallet balance for an extra dish. Add money first.')
        return
      }
      if (data?.error) throw new Error(data.error)
      setShowDayModal(false)
      setAddMode(false)
      await fetchAll()
    } catch (e: any) {
      setSwapError(e?.message ?? 'Could not add dish. Try again.')
    } finally {
      setSwapping(false)
    }
  }

  // Off-day path — a date with zero orders in any slot (e.g. a weekday
  // turned off in the default plan) has no reference order for add-dish's
  // usual { order_id } payload to derive subscription/date/address from, so
  // this passes them directly instead.
  async function handleAddDishOffDay(subId: string, date: string, slot: 'lunch' | 'dinner', newMealId: string) {
    setSwapping(true)
    setSwapError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('add-dish', {
        body: { subscription_id: subId, delivery_date: date, meal_slot: slot, meal_template_id: newMealId, address_id: addAddressId ?? undefined },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Could not add dish. Try again.'))
      if (data?.error === 'insufficient_balance') {
        setSwapError('Insufficient wallet balance for an extra dish. Add money first.')
        return
      }
      if (data?.error) throw new Error(data.error)
      setShowDayModal(false)
      setAddMode(false)
      await fetchAll()
    } catch (e: any) {
      setSwapError(e?.message ?? 'Could not add dish. Try again.')
    } finally {
      setSwapping(false)
    }
  }

  async function handleRemoveDish(orderId: string) {
    if (cartBusy) return
    setCartBusy(true)
    setSwapError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('remove-dish', {
        body: { order_id: orderId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Could not remove this dish. Try again.'))
      if (data?.error) throw new Error(data.error)
      await fetchAll()
    } catch (e: any) {
      setSwapError(e?.message ?? 'Could not remove this dish. Try again.')
    } finally {
      setCartBusy(false)
    }
  }

  // Add-on add/remove/quantity + base meal quantity. Nothing here is charged
  // immediately — everything is billed from the wallet on delivery.
  // Each tap shows at once and is saved in the background, in tap order (the
  // server reads then writes the count, so two at once could lose one); the
  // plan reloads when the last one is done, which also undoes anything the
  // server refused.
  const cartQueue = useRef<Promise<void>>(Promise.resolve())
  const cartPending = useRef(0)

  function applyCartOpLocally(orderId: string, op: CartOp, addonId?: string) {
    setWeekOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o
      if (op === 'inc_qty') return { ...o, quantity: (o.quantity ?? 1) + 1 }
      if (op === 'dec_qty') return { ...o, quantity: Math.max((o.quantity ?? 1) - 1, 1) }
      if (!addonId) return o
      const lines = o.order_addons ?? []
      const line = lines.find(l => l.kind === 'addon' && l.addon_id === addonId)
      if (op === 'add_addon' || op === 'inc_addon_qty') {
        if (line) {
          if (op === 'add_addon') return o
          return { ...o, order_addons: lines.map(l => l === line ? { ...l, quantity: Math.min((l.quantity ?? 1) + 1, 10) } : l) }
        }
        const price = allAddons.find(a => a.id === addonId)?.price_per_meal ?? null
        return { ...o, order_addons: [...lines, { id: `pending-${addonId}`, addon_id: addonId, kind: 'addon', label: null, quantity: 1, unit_price: price }] }
      }
      if (!line) return o
      if (op === 'remove_addon' || (line.quantity ?? 1) <= 1) return { ...o, order_addons: lines.filter(l => l !== line) }
      return { ...o, order_addons: lines.map(l => l === line ? { ...l, quantity: (l.quantity ?? 1) - 1 } : l) }
    }))
  }

  function handleCartOp(orderId: string, op: CartOp, addonId?: string) {
    setSwapError('')
    applyCartOpLocally(orderId, op, addonId)
    cartPending.current += 1
    cartQueue.current = cartQueue.current.then(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error('Please sign in again.')
        const { data, error } = await supabase.functions.invoke('update-day-cart', {
          body: { order_id: orderId, op, addon_id: addonId },
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        // Named errors arrive as a non-2xx body (see supabaseFunctionError.ts).
        const code = error ? await extractFunctionErrorMessage(error, 'Could not update the cart. Try again.') : data?.error
        if (code === 'use_skip') setSkipConfirm({ date: selectedDay, slot: selectedSlot })
        else if (code === 'cannot_remove_default_addon') setSwapError("This add-on is part of your plan and can't be removed here.")
        else if (code === 'addon_quantity_cap') setSwapError('Maximum 10 of this add-on per meal.')
        else if (code) setSwapError(code)
      } catch (e: any) {
        setSwapError(e?.message ?? 'Could not update the cart. Try again.')
      } finally {
        cartPending.current -= 1
        if (cartPending.current === 0) await fetchAll()
      }
    })
  }

  async function fetchTransactions() {
    if (!user) return
    const { data } = await supabase
      .from('wallet_transactions')
      .select('id, type, amount, reason, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    setTransactions((data as WalletTransaction[]) ?? [])
  }

  // The native SDK's callback is registered once per mount and can't take
  // fresh props/state each render — a ref keeps it reading the latest
  // fetch functions instead of a stale closure from mount time.
  // After a renewal payment: the webhook activates the new plan within a few
  // seconds. Poll until it shows up (renewed_from = the finished plan).
  async function confirmRenewal() {
    setRenewState('confirming')
    setRenewMessage('')
    const fromId = renewFromSubId.current
    for (let i = 0; i < 15; i++) {
      const { data } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('renewed_from', fromId ?? '')
        .eq('status', 'active')
        .maybeSingle()
      if (data) {
        await fetchAll()
        setRenewState('done')
        setRenewMessage('Your new plan is active and your meals are being scheduled.')
        // A renewed plan is a happy moment — let the store ask for a rating.
        setTimeout(() => maybeAskStoreReview(user?.id, { afterRenewal: true }), 3000)
        return
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    await fetchAll()
    setRenewState('done')
    setRenewMessage('Payment received — your new plan will show up here in a minute.')
  }

  const latestTopupHandlers = useRef({ fetchAll, fetchTransactions, confirmRenewal })
  latestTopupHandlers.current = { fetchAll, fetchTransactions, confirmRenewal }

  useEffect(() => {
    const callback: CFCallback = {
      onVerify: () => {
        if (paymentPurpose.current === 'renewal') {
          paymentPurpose.current = 'topup'
          latestTopupHandlers.current.confirmRenewal()
          return
        }
        // Optimistic refresh — the webhook is the authoritative credit,
        // this just reflects it in the UI as soon as possible.
        latestTopupHandlers.current.fetchAll()
        latestTopupHandlers.current.fetchTransactions()
        setShowTransactions(true)
      },
      onError: (error: CFErrorResponse) => {
        if (paymentPurpose.current === 'renewal') {
          paymentPurpose.current = 'topup'
          setRenewState('failed')
          setRenewMessage(error.getMessage() || 'The payment was not completed. Nothing was charged.')
          return
        }
        console.warn('Wallet top-up failed:', error.getMessage())
      },
    }
    // Not CFPaymentGatewayService.setCallback/removeCallback directly — see
    // cashfreeCallback.ts. This effect runs unconditionally on every mount of
    // this screen, including the SubscribeGate branch for a brand-new user —
    // so it's already live and registered by the time onboarding's payment
    // screen mounts on top of it (expo-router keeps this screen mounted
    // underneath whatever gets pushed). Both screens share the same
    // process-wide singleton; an out-of-order cleanup here could otherwise
    // silently unhook onboarding's live listener instead of this one.
    return setActiveCashfreeCallback(callback)
  }, [])

  async function startRenewal(cfg: RenewConfig) {
    if (!sub) return
    setRenewState('starting')
    setRenewMessage('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again.')
      const headers = { Authorization: `Bearer ${session.access_token}` }

      const renewal = await supabase.functions.invoke('renew-subscription', {
        body: { from_subscription_id: sub.id, ...cfg },
        headers,
      })
      if (renewal.error) throw new Error(await extractFunctionErrorMessage(renewal.error, 'Could not start the renewal.'))

      const order = await supabase.functions.invoke('cashfree-create-order', {
        body: { subscription_id: renewal.data.subscription_id },
        headers,
      })
      if (order.error) throw new Error(await extractFunctionErrorMessage(order.error, 'Could not start the payment.'))

      paymentPurpose.current = 'renewal'
      renewFromSubId.current = sub.id
      setRenewState('paying')
      CFPaymentGatewayService.doWebPayment(new CFSession(
        order.data.payment_session_id,
        order.data.order_id,
        order.data.environment === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX
      ))
    } catch (e: any) {
      paymentPurpose.current = 'topup'
      setRenewState('failed')
      setRenewMessage(e?.message ?? 'Something went wrong. Please try again.')
    }
  }

  async function cancelFinishedPlan() {
    if (!sub) return
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.functions.invoke('manage-subscription', {
      body: { action: 'cancel', subscription_id: sub.id },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    if (error) {
      setRenewState('failed')
      setRenewMessage(await extractFunctionErrorMessage(error, 'Could not cancel the plan. Please try again.'))
      return
    }
    setShowRenew(false)
    await fetchAll()
  }

  function redoOnboarding() {
    setShowRenew(false)
    useOnboardingStore.getState().reset()
    router.push('/(onboarding)/health' as any)
  }

  async function createTopupOrder() {
    if (!user) return
    const amount = topupCustom ? Math.round(parseFloat(topupCustom) * 100) : topupAmountPaise
    if (!amount || amount < 10000) return // min ₹100
    setCreatingTopup(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('wallet-topup', {
        body: { amount_paise: amount },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error || data?.error) throw new Error(data?.error ?? 'Failed to create order')
      setShowAddMoney(false)
      const cfSession = new CFSession(
        data.payment_session_id,
        data.order_id,
        data.environment === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX
      )
      CFPaymentGatewayService.doWebPayment(cfSession)
      // Native checkout UI takes over the screen until onVerify/onError fires
      // (registered once on mount below).
    } catch (e: any) {
      console.error('createTopupOrder:', e)
    } finally {
      setCreatingTopup(false)
    }
  }

  if (loading) {
    return <View style={s.loadingWrap}><ActivityIndicator size="large" color={Colors.primary} /></View>
  }

  if (!hasSubscription || !sub) {
    return (
      <View style={s.container}>
        <View style={[s.titleWrap, { paddingTop: insets.top + 16 }]}>
          <Text style={s.title}>{hasSubscription ? 'My Plan' : 'Subscribe'}</Text>
        </View>
        <SubscribeGate
          onSubscribe={() => router.push(user ? '/(onboarding)/health' : '/(auth)/login' as any)}
          onExplore={() => router.push('/(app)/(tabs)/menu')}
        />
      </View>
    )
  }

  const mealsTotal = sub.plans?.meals_total ?? 0
  const remaining = sub.deliveries_remaining
  const progress = mealsTotal > 0 ? Math.min(100, (remaining / mealsTotal) * 100) : 0
  // Cash on delivery: the first day was paid online at signup; the rest is
  // cash for the delivery partner, credited to the wallet when it's recorded.
  const codDue = sub.payment_method === 'cod' ? (sub.cod_due_paise ?? 0) : 0

  // ── Active / paused home view ─────────────────────────────────────────────

  const todayStr = istToday()
  const liveOrders = weekOrders.filter(o => o.status !== 'skipped')
  const orderMap = new Map<string, OrderItem[]>()
  for (const o of liveOrders) {
    const arr = orderMap.get(o.delivery_date) ?? []
    arr.push(o)
    orderMap.set(o.delivery_date, arr)
  }

  // Calendar strip: from subscription start through the end of this month
  // (or next month, near month-end — see stripEndISO).
  const startStr = sub.start_date && sub.start_date < todayStr ? sub.start_date : todayStr
  const endStr = stripEndISO(todayStr)
  const stripDates: string[] = []
  for (let d = startStr; d <= endStr; d = addDaysISO(d, 1)) stripDates.push(d)

  // Hero card: all orders for the selected day + slot.
  const heroOrders = (orderMap.get(selectedDay) ?? []).filter(o => o.meal_slot === selectedSlot)
  const heroBase = heroOrders.find(o => !o.extra_dish) ?? null
  const heroTotalQty = heroOrders.reduce((sum, o) => sum + (o.quantity ?? 1), 0)
  const heroKcal = heroOrders.reduce((sum, o) => sum + ((o.meal_templates?.kcal ?? 0) * (o.quantity ?? 1)), 0)
  const heroProtein = heroOrders.reduce((sum, o) => sum + ((o.meal_templates?.protein ?? 0) * (o.quantity ?? 1)), 0)
  const heroCarbs = heroOrders.reduce((sum, o) => sum + ((o.meal_templates?.carbs ?? 0) * (o.quantity ?? 1)), 0)
  const heroFat = heroOrders.reduce((sum, o) => sum + ((o.meal_templates?.fat ?? 0) * (o.quantity ?? 1)), 0)
  // Locked once the slot's cutoff passes (8 AM lunch / 1 PM dinner, same day),
  // or once the kitchen has already started on it — unlocking "today" under
  // the new same-day cutoff would otherwise expose Skip/Swap/Remove on a meal
  // that's already `preparing`.
  const heroDone = heroOrders.length > 0 && heroOrders.every(o => o.status === 'delivered')
  const heroRider = heroOrders.map(o => riders.get(o.id)).find(Boolean) ?? null
  const heroDeliveredAt = heroDone
    ? heroOrders.map(o => o.delivered_at).filter((t): t is string => !!t).sort().pop() ?? null
    : null
  const heroLocked =
    isSlotLocked(selectedDay, selectedSlot) ||
    heroOrders.some(o => o.status === 'preparing' || o.status === 'out_for_delivery' || o.status === 'delivered')
  const heroIsToday = selectedDay === todayStr
  // Meals the customer skipped in this slot — can be brought back until cutoff.
  const slotSkipped = weekOrders.filter(o =>
    o.status === 'skipped' && o.delivery_date === selectedDay && o.meal_slot === selectedSlot)
  const canUnskip = slotSkipped.some(o => o.skip_reason === 'user') && !isSlotLocked(selectedDay, selectedSlot)

  // Day modal data (same slot).
  const daySlotOrders = (orderMap.get(selectedDay) ?? []).filter(o => o.meal_slot === selectedSlot)
  const dayOrder = daySlotOrders.find(o => !o.extra_dish) ?? null
  const dayExtras = daySlotOrders.filter(o => o.extra_dish)
  const dayLocked = heroLocked

  // Any non-extra order on this day, in ANY slot — used (a) to decide whether
  // the "Add {slot}" button should appear at all (the day is within the
  // active/instantiated window) and (b) as the reference order for add-dish
  // when the selected slot itself has no base order yet.
  const dayAnyBase = (orderMap.get(selectedDay) ?? []).find(o => !o.extra_dish) ?? null
  const dayHasNothing = !dayOrder && dayExtras.length === 0 && !dayAnyBase
  const addRefOrder = dayOrder ?? dayExtras[0] ?? dayAnyBase ?? null
  // When there's no base order for this slot, adding is the only possible
  // action — force it rather than trusting addMode (which resets on open).
  const effectiveAddMode = !dayOrder || addMode

  const baseRate = sub.plans ? Math.round(sub.plans.base_price / Math.max(sub.plans.meals_total, 1)) : 0
  const dayAllOrders = daySlotOrders
  const orderBase = (o: OrderItem) => (o.unit_price ?? baseRate) * (o.quantity ?? 1)
  const addonLinesCost = (o: OrderItem) =>
    (o.order_addons ?? []).filter(l => l.kind === 'addon').reduce((sum, l) => sum + (l.unit_price ?? 0) * (l.quantity ?? 1), 0)
  // Cost of the next slot that's still open (not past cutoff) — for the
  // low-wallet banner.
  const nextOpen = liveOrders
    .filter((o) => (o.status === 'scheduled' || o.status === 'confirmed') && !isSlotLocked(o.delivery_date, o.meal_slot as 'lunch' | 'dinner'))
    .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date) || (a.meal_slot === 'lunch' ? 0 : 1) - (b.meal_slot === 'lunch' ? 0 : 1))[0]
  const nextMealCost = nextOpen
    ? liveOrders
        .filter((o) => o.delivery_date === nextOpen.delivery_date && o.meal_slot === nextOpen.meal_slot
          && (o.status === 'scheduled' || o.status === 'confirmed'))
        .reduce((sum, o) => sum + orderBase(o) + addonLinesCost(o), 0)
    : 0

  const dayMealsAddons = dayAllOrders.reduce((sum, o) => sum + orderBase(o) + addonLinesCost(o), 0)
  const dayTotal = dayMealsAddons
  // Delivered meals are already paid for, so they can't make the balance "low".
  const lowBalance = walletBalance !== null && !heroDone && dayTotal > walletBalance
  const dayOrderAddonIds = new Set((dayOrder?.order_addons ?? []).filter(l => l.kind === 'addon' && l.addon_id).map(l => l.addon_id))
  const dayOrderAddonQty = new Map(
    (dayOrder?.order_addons ?? []).filter(l => l.kind === 'addon' && l.addon_id).map(l => [l.addon_id as string, l.quantity ?? 1])
  )
  const defaultAddonIds = new Set(subAddons.map(a => a.addon_id))
  const defaultAddress = addresses.find(a => a.is_default) ?? addresses[0] ?? null
  // Where a newly added dish goes: chosen, else this slot's meal's address.
  const addTarget = addAddressId ?? dayOrder?.address_id ?? defaultAddress?.id ?? null

  // "Deliver to" for one meal: where it's going, with a picker to change it.
  const renderAddressPicker = (order: OrderItem) => {
    if (dayLocked || addresses.length === 0) return null
    const sel = addresses.find(a => a.id === order.address_id) ?? defaultAddress
    if (pickingAddressForOrder === order.id) {
      return (
        <View style={{ gap: 8, marginTop: 10 }}>
          {addresses.map((addr) => {
            const isSelected = sel?.id === addr.id
            return (
              <Pressable
                key={addr.id}
                style={[s.addrPickRow, isSelected && s.addrPickRowActive]}
                onPress={() => changeOrderAddress(order.id, addr.id)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.addrPickLabel, isSelected && { color: Colors.primary }]}>{addr.label}</Text>
                  <Text style={s.addrPickLine1} numberOfLines={1}>{addr.line1}</Text>
                </View>
                {isSelected && <Check size={16} color={Colors.primary} strokeWidth={2.5} />}
              </Pressable>
            )
          })}
          <Pressable onPress={() => { setShowDayModal(false); router.push('/(app)/addresses') }} hitSlop={6}>
            <Text style={s.addrPickChange}>Add or change addresses →</Text>
          </Pressable>
        </View>
      )
    }
    return (
      <Pressable style={[s.addrPickCurrent, { marginTop: 10 }]} onPress={() => setPickingAddressForOrder(order.id)}>
        <MapPin size={15} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={s.addrPickLabel}>Deliver to {sel?.label ?? 'your address'}</Text>
          {sel && <Text style={s.addrPickLine1} numberOfLines={1}>{sel.line1}</Text>}
        </View>
        <Text style={s.addrPickChange}>Change</Text>
      </Pressable>
    )
  }

  // Day label for hero card eyebrow: "TODAY'S LUNCH" / "FRI 3'S DINNER"
  const heroEyebrow = heroIsToday
    ? `Today's ${selectedSlot}`
    : `${dowShort(selectedDay)} ${dayNum(selectedDay)}'s ${selectedSlot}`

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <View style={s.titleRow}>
          <Text style={[s.title, { marginBottom: 0 }]}>My Plan</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => router.push('/(app)/weekly-menu' as any)}
              hitSlop={10}
              style={({ pressed }) => [s.historyBtn, pressed && { opacity: 0.7 }]}
              accessibilityLabel="This week's menu"
            >
              <CalendarDays size={20} color={Colors.text} strokeWidth={1.75} />
            </Pressable>
            <Pressable
              onPress={() => router.push('/(app)/order-history' as any)}
              hitSlop={10}
              style={({ pressed }) => [s.historyBtn, pressed && { opacity: 0.7 }]}
              accessibilityLabel="Order history"
            >
              <History size={20} color={Colors.text} strokeWidth={1.75} />
            </Pressable>
          </View>
        </View>

        {codDue > 0 && (
          <View style={s.codPayCard}>
            <Banknote size={22} color={Colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={s.codPayTitle}>₹{fmt(codDue)} cash to pay</Text>
              <Text style={s.codPayDesc}>
                Hand it to your delivery partner at your next delivery — it goes into your wallet and pays for your meals.
              </Text>
            </View>
          </View>
        )}

        {/* WEEK HEADER */}
        <Text style={s.weekLabel}>{heroIsToday ? 'Today' : 'This week'}</Text>

        {/* DATE STRIP */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.weekStripContent}
          style={s.weekStrip}
          ref={(r) => { stripRef.current = r }}
          onContentSizeChange={() => {
            const idx = stripDates.indexOf(todayStr)
            if (idx >= 0) stripRef.current?.scrollTo({ x: idx * DAY_CELL_PITCH, animated: false })
          }}
        >
          {stripDates.map((d) => {
            const isToday = d === todayStr
            const isSelected = d === selectedDay
            const isPast = d < todayStr
            const cell = (
              <View style={[
                s.dayCell,
                isSelected && s.dayCellSelected,
                isToday && !isSelected && s.dayCellTodayUnselected,
                isPast && s.dayCellPast,
              ]}>
                <Text style={[s.dayDate, isSelected && s.dayDateSelected]}>{dayNum(d)}</Text>
                <Text style={[s.dayDow, isSelected && s.dayDowSelected]}>{dowShort(d)}</Text>
              </View>
            )
            if (isPast) return <View key={d}>{cell}</View>
            return (
              <Pressable
                key={d}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedDay(d) }}
                style={({ pressed }) => pressed && { opacity: 0.7 }}
              >
                {cell}
              </Pressable>
            )
          })}
        </ScrollView>

        {/* HERO DAY CARD */}
        {heroBase ? (
          <View key="hero-card" style={s.heroCard}>
            <View style={s.heroHeader}>
              <View style={s.heroTopRow}>
                <View>
                  <Text style={s.heroEyebrow}>{heroEyebrow}</Text>
                  <Text style={s.heroTitle}>{selectedSlot === 'lunch' ? 'Lunch' : 'Dinner'}</Text>
                  <Text style={s.heroSubtitle}>
                    {heroTotalQty} {heroTotalQty === 1 ? 'item' : 'items'}
                    {heroKcal > 0 ? ` · ${heroKcal.toLocaleString('en-IN')} kcal total` : ''}
                  </Text>
                </View>
                <View style={[s.heroStatusBadge, heroBase.status === 'preparing' && s.heroStatusPrep]}>
                  <CheckCircle2 size={13} color={Colors.primary} strokeWidth={2.5} />
                  <Text style={[s.heroStatusText, heroBase.status === 'preparing' && s.heroStatusPrepText]}>
                    {statusLabel(heroBase.status)}
                  </Text>
                </View>
              </View>

              {/* Who's bringing it (delivery partner app) */}
              {heroBase.status === 'out_for_delivery' && heroRider && (
                <View style={s.riderRow}>
                  <Bike size={16} color={Colors.primary} />
                  <Text style={s.riderText} numberOfLines={1}>On the way with {heroRider.name}</Text>
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${heroRider.phone}`).catch(() => {})}
                    style={({ pressed }) => [s.riderCall, pressed && { opacity: 0.7 }]}
                    accessibilityLabel={`Call ${heroRider.name}`}
                  >
                    <Phone size={13} color="#fff" />
                    <Text style={s.riderCallText}>Call</Text>
                  </Pressable>
                </View>
              )}
              {heroDeliveredAt && (
                <Text style={s.riderDone}>
                  Delivered at {clockIST(heroDeliveredAt)}{heroRider ? ` by ${heroRider.name}` : ''}
                </Text>
              )}

              {/* Meal list */}
              <View style={s.heroCartList}>
                {heroOrders.map(o => (
                  <View key={o.id} style={s.heroCartRow}>
                    {o.meal_templates?.image_url ? (
                      <Image source={{ uri: o.meal_templates.image_url }} style={s.heroFoodThumb} contentFit="cover" cachePolicy="memory-disk" />
                    ) : (
                      <View style={[s.heroFoodThumb, { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ fontSize: 18 }}>🍽️</Text>
                      </View>
                    )}
                    <View style={s.heroCartRowInfo}>
                      <Text style={s.heroCartName} numberOfLines={1}>{o.meal_templates?.name ?? 'Your meal'}</Text>
                      {(o.meal_templates?.kcal ?? 0) > 0 && (
                        <Text style={s.heroCartKcal}>
                          {o.meal_templates!.kcal} kcal{(o.quantity ?? 1) > 1 ? ' each' : ''}
                        </Text>
                      )}
                    </View>
                    <View style={s.heroQtyPill}>
                      <Text style={s.heroQtyPillText}>{o.quantity ?? 1}×</Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* Macro chips */}
              {(heroProtein > 0 || heroCarbs > 0 || heroFat > 0) && (
                <View style={s.heroMacroStrip}>
                  <MacroRow protein={heroProtein} carbs={heroCarbs} fat={heroFat} size="md" />
                </View>
              )}

              {/* Add-ons — subscription-level, applies to every meal */}
              {subAddons.length > 0 && (
                <View style={s.heroAddonsRow}>
                  <Text style={s.heroAddonsText}>
                    + {subAddons.map((a) => a.addons?.name ?? a.addon_id).join(', ')}
                  </Text>
                </View>
              )}
            </View>

            {/* Action buttons */}
            <View style={s.heroCardBtns}>
              {!heroLocked && (
                <Pressable
                  style={({ pressed }) => [s.heroSkipBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSkipConfirm({ date: selectedDay, slot: selectedSlot }) }}
                >
                  <SkipForward size={15} color={Colors.text} strokeWidth={2} />
                  <Text style={s.heroSkipText}>Skip</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [s.heroCustomizeBtn, { flex: heroLocked ? 1 : 1.4 }, pressed && { opacity: 0.85 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setAddMode(false); setShowDayModal(true) }}
              >
                <SlidersHorizontal size={15} color="#fff" strokeWidth={2} />
                <Text style={s.heroCustomizeText}>{heroLocked ? 'View details →' : 'Customize →'}</Text>
              </Pressable>
            </View>
          </View>
        ) : heroOrders.length > 0 ? (
          // Extras-only slot: dishes were added here but there's no base
          // order (e.g. a dinner dish added on a lunch-only plan).
          <View key="hero-extras" style={s.heroCard}>
            <View style={s.heroHeader}>
              <View style={s.heroTopRow}>
                <View>
                  <Text style={s.heroEyebrow}>{heroEyebrow}</Text>
                  <Text style={s.heroTitle}>{selectedSlot === 'lunch' ? 'Lunch' : 'Dinner'}</Text>
                  <Text style={s.heroSubtitle}>
                    {heroTotalQty} extra {heroTotalQty === 1 ? 'item' : 'items'}
                  </Text>
                </View>
              </View>
              <View style={s.heroCartList}>
                {heroOrders.map(o => (
                  <View key={o.id} style={s.heroCartRow}>
                    {o.meal_templates?.image_url ? (
                      <Image source={{ uri: o.meal_templates.image_url }} style={s.heroFoodThumb} contentFit="cover" cachePolicy="memory-disk" />
                    ) : (
                      <View style={[s.heroFoodThumb, { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' }]}>
                        <Text style={{ fontSize: 18 }}>🍽️</Text>
                      </View>
                    )}
                    <View style={s.heroCartRowInfo}>
                      <Text style={s.heroCartName} numberOfLines={1}>{o.meal_templates?.name ?? 'Your meal'}</Text>
                      {(o.meal_templates?.kcal ?? 0) > 0 && (
                        <Text style={s.heroCartKcal}>
                          {o.meal_templates!.kcal} kcal{(o.quantity ?? 1) > 1 ? ' each' : ''}
                        </Text>
                      )}
                    </View>
                    <View style={s.heroQtyPill}>
                      <Text style={s.heroQtyPillText}>{o.quantity ?? 1}×</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
            <View style={s.heroCardBtns}>
              <Pressable
                style={({ pressed }) => [s.heroCustomizeBtn, { flex: 1 }, pressed && { opacity: 0.85 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setAddMode(false); setShowDayModal(true) }}
              >
                <SlidersHorizontal size={15} color="#fff" strokeWidth={2} />
                <Text style={s.heroCustomizeText}>{heroLocked ? 'View details →' : 'Customize →'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View key="hero-empty" style={s.heroEmpty}>
            {slotSkipped.length > 0 && !closures.has(`${selectedDay}|${selectedSlot}`) ? (
              <>
                <Text style={s.heroEmptyText}>
                  {slotSkipped[0].skip_reason === 'user'
                    ? `You skipped this ${selectedSlot} — nothing is charged.`
                    : slotSkipped[0].skip_reason === 'plan_finished'
                      ? `This ${selectedSlot} was skipped — your plan's meals were used up.`
                      : slotSkipped[0].skip_reason === 'insufficient_balance'
                        ? `This ${selectedSlot} was skipped — your wallet didn't cover it.`
                        : `This ${selectedSlot} was skipped.`}
                </Text>
                {canUnskip && (
                  <Pressable
                    style={({ pressed }) => [s.heroAddBtn, pressed && { opacity: 0.7 }, skipping && { opacity: 0.5 }]}
                    onPress={() => handleUnskip(selectedDay, selectedSlot)}
                    disabled={skipping}
                  >
                    {skipping ? <ActivityIndicator size="small" color={Colors.primary} /> : <RotateCcw size={14} color={Colors.primary} />}
                    <Text style={s.heroAddBtnText}>Undo skip</Text>
                  </Pressable>
                )}
              </>
            ) : null}
            {slotSkipped.length === 0 || closures.has(`${selectedDay}|${selectedSlot}`) ? (
            <Text style={s.heroEmptyText}>
              {closures.has(`${selectedDay}|${selectedSlot}`)
                ? `Kitchen closed for ${selectedSlot} on ${dowShort(selectedDay)} ${dayNum(selectedDay)}${closures.get(`${selectedDay}|${selectedSlot}`) ? ` — ${closures.get(`${selectedDay}|${selectedSlot}`)}` : ''}. The meal stays on your plan.`
                : `No ${selectedSlot} on ${dowShort(selectedDay)} ${dayNum(selectedDay)}`}
            </Text>
            ) : null}
            {/* dayAnyBase used to gate this — meant a day with zero orders in
                any slot (e.g. a weekday turned off in the default plan) had
                no way to open the day modal at all. Off-day adds create an
                extra_dish row with no base order, so dayAnyBase would stay
                null even after adding one — this can't require it. */}
            {!heroLocked && slotSkipped.length === 0 && (
              <Pressable
                style={({ pressed }) => [s.heroAddBtn, pressed && { opacity: 0.7 }]}
                onPress={() => { setAddMode(true); setShowDayModal(true) }}
              >
                <Plus size={14} color={Colors.primary} />
                <Text style={s.heroAddBtnText}>Add {selectedSlot}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* SLOT TOGGLE */}
        <View style={s.slotToggleWrap}>
          <View style={s.slotToggle}>
            <Pressable
              style={[s.slotBtn, selectedSlot === 'lunch' && s.slotBtnActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedSlot('lunch') }}
            >
              <Utensils size={15} color={selectedSlot === 'lunch' ? '#fff' : Colors.textMuted} strokeWidth={2} />
              <Text style={[s.slotBtnText, selectedSlot === 'lunch' && s.slotBtnTextActive]}>Lunch</Text>
            </Pressable>
            <Pressable
              style={[s.slotBtn, selectedSlot === 'dinner' && s.slotBtnActive]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedSlot('dinner') }}
            >
              <Moon size={15} color={selectedSlot === 'dinner' ? '#fff' : Colors.textMuted} strokeWidth={2} />
              <Text style={[s.slotBtnText, selectedSlot === 'dinner' && s.slotBtnTextActive]}>Dinner</Text>
            </Pressable>
          </View>
        </View>

        {/* INFO TILES — Balance + Plan Settings */}
        <View style={s.infoTilesRow}>
          <Pressable
            style={({ pressed }) => [s.infoTile, pressed && { opacity: 0.75 }]}
            onPress={() => setShowAddMoney(true)}
          >
            <View style={s.infoTileIcon}><Wallet size={19} color={Colors.primary} strokeWidth={1.75} /></View>
            <View>
              <Text style={s.infoTileCaption}>Balance</Text>
              <Text style={s.infoTileValue}>
                {walletBalance !== null ? `₹${(walletBalance / 100).toLocaleString('en-IN')}` : '—'}
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.infoTile, pressed && { opacity: 0.75 }]}
            onPress={() => router.push('/(app)/plan-settings')}
          >
            <View style={s.infoTileIcon}><Settings2 size={19} color={Colors.primary} strokeWidth={1.75} /></View>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={s.infoTileLabel}>Plan Settings</Text>
              <ChevronRight size={15} color={Colors.textMuted} strokeWidth={2} />
            </View>
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [s.addrLinkRow, pressed && { opacity: 0.75 }]}
          onPress={() => router.push('/(app)/addresses')}
        >
          <MapPin size={17} color={Colors.primary} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <Text style={s.infoTileLabel}>Delivery addresses</Text>
            <Text style={s.addrLinkSub} numberOfLines={1}>
              {defaultAddress ? `${defaultAddress.label} · ${defaultAddress.line1}` : 'Add where your meals should go'}
            </Text>
          </View>
          <ChevronRight size={15} color={Colors.textMuted} strokeWidth={2} />
        </Pressable>

        {/* DELIVERIES REMAINING */}
        <View style={s.progressCard}>
          <View style={s.progressRow}>
            <Text style={s.progressLabel}>Deliveries remaining</Text>
            <Text style={s.progressCount}>{remaining}/{mealsTotal}</Text>
          </View>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${progress}%` }]} />
          </View>
          {sub.end_date && (
            <Text style={s.renewNote}>Renews {fmtDate(sub.end_date)}</Text>
          )}
        </View>

        {/* LOW WALLET — meals left on the plan, but not the money for the next one */}
        {remaining > 0 && nextMealCost > 0 && walletBalance !== null && walletBalance < nextMealCost && (
          <View style={s.renewalAlert}>
            <View style={s.renewalAlertContent}>
              <Wallet size={20} color={Colors.accent} style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.renewalAlertTitle}>Your wallet is running low</Text>
                <Text style={s.renewalAlertText}>
                  Your next meal costs ₹{fmt(nextMealCost)} and your wallet has ₹{fmt(Math.max(walletBalance, 0))}.
                  Top up before the cutoff so it isn't skipped.
                </Text>
              </View>
            </View>
            <View style={s.renewalAlertBtns}>
              <Pressable
                style={({ pressed }) => [s.renewalAlertBtn, s.renewalAlertBtnPrimary, pressed && { opacity: 0.85 }]}
                onPress={() => setShowAddMoney(true)}
              >
                <Text style={s.renewalAlertBtnText}>Add money</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* PLAN FINISHED — renew (repeat / edit / new plan) or cancel */}
        {remaining === 0 && (
          <View style={s.renewalAlert}>
            <View style={s.renewalAlertContent}>
              <AlertCircle size={20} color={Colors.accent} style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.renewalAlertTitle}>Your plan's meals are used up</Text>
                <Text style={s.renewalAlertText}>Renew to keep your meals coming.</Text>
              </View>
            </View>
            <View style={s.renewalAlertBtns}>
              <Pressable
                style={({ pressed }) => [s.renewalAlertBtn, s.renewalAlertBtnPrimary, pressed && { opacity: 0.85 }]}
                onPress={() => { setRenewState('idle'); setRenewMessage(''); setShowRenew(true) }}
              >
                <Text style={s.renewalAlertBtnText}>Renew plan</Text>
              </Pressable>
            </View>
          </View>
        )}

      </ScrollView>

      <RenewPlanSheet
        visible={showRenew}
        onClose={() => { if (renewState === 'done') setRenewState('idle'); setShowRenew(false) }}
        planName={sub.plan_name}
        current={{
          plan_id: sub.plan_id ?? 'plan15',
          meals_lunch: sub.meals_lunch ?? 1,
          meals_dinner: sub.meals_dinner ?? 0,
          addon_ids: subAddons.map((a) => a.addon_id),
        }}
        plans={plansCatalog}
        addons={allAddons}
        walletBalance={walletBalance}
        paymentState={renewState}
        paymentMessage={renewMessage}
        onRenew={startRenewal}
        onRedoOnboarding={redoOnboarding}
        onCancelPlan={cancelFinishedPlan}
      />

      {/* Skip confirm dialog */}
      <Modal
        visible={!!skipConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setSkipConfirm(null)}
      >
        <View style={s.confirmOverlay}>
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>Skip {skipConfirm?.slot ?? 'this'}?</Text>
            <Text style={s.confirmBody}>
              {skipConfirm?.slot === 'lunch' ? 'Lunch' : 'Dinner'} on {fmtDate(skipConfirm?.date ?? null)}.{'\n'}Nothing is charged and the meal stays on your plan. You can undo this until the cutoff.
            </Text>
            {skipError ? <Text style={s.dayModalSwapError}>{skipError}</Text> : null}
            <View style={s.confirmBtns}>
              <Pressable
                style={[s.confirmBtn, s.confirmBtnGhost]}
                onPress={() => { setSkipConfirm(null); setSkipError('') }}
              >
                <Text style={s.confirmBtnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.confirmBtn, s.confirmBtnPrimary, skipping && { opacity: 0.5 }]}
                onPress={handleSkipConfirm}
                disabled={skipping}
              >
                {skipping
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.confirmBtnText}>Skip it</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Day detail / customize modal */}
      <Modal
        visible={showDayModal}
        transparent
        animationType="slide"
        onRequestClose={() => { setShowDayModal(false); setPickingAddressForOrder(null) }}
      >
        <View style={s.dayModalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => { setShowDayModal(false); setPickingAddressForOrder(null) }} />
          <View style={s.dayModalSheet}>
            {/* Handle */}
            <View style={s.dayModalHandle} />

            {/* Header */}
            <View style={s.dayModalHeader}>
              <Text style={s.dayModalDate}>{fmtDateLong(selectedDay)}</Text>
              <Pressable onPress={() => setShowDayModal(false)} hitSlop={10}>
                <X size={20} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
              alwaysBounceVertical
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              {/* Current meal */}
              {dayOrder ? (
                <View style={s.dayModalCurrentSection}>
                  <Text style={s.dayModalSectionLabel}>Your meal</Text>
                  <View style={s.dayModalCurrentCard}>
                    {dayOrder.meal_templates?.image_url && (
                      <Image
                        source={{ uri: dayOrder.meal_templates.image_url }}
                        style={s.dayModalCurrentImg}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        transition={200}
                      />
                    )}
                    <Text style={s.dayModalCurrentName}>
                      {dayOrder.meal_templates?.name ?? 'Your meal'}
                    </Text>
                    {(dayOrder.meal_templates?.kcal || dayOrder.meal_templates?.protein) && (
                      <Text style={s.dayModalCurrentMeta}>
                        {dayOrder.meal_templates.kcal ? `${dayOrder.meal_templates.kcal} kcal` : ''}
                        {dayOrder.meal_templates.kcal && dayOrder.meal_templates.protein ? ' · ' : ''}
                        {dayOrder.meal_templates.protein ? `${dayOrder.meal_templates.protein}g protein` : ''}
                      </Text>
                    )}
                    <View style={s.dayModalStatusRow}>
                      <Text style={s.dayModalStatus}>{statusLabel(dayOrder.status)}</Text>
                    </View>
                  </View>

                  {renderAddressPicker(dayOrder)}

                  {/* Portions stepper for the base meal */}
                  {!dayLocked && (
                    <View style={s.qtyRow}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={s.qtyLabel}>Portions</Text>
                        <Text style={s.qtySub}>
                          {(dayOrder.quantity ?? 1) <= 1
                            ? 'Billed on delivery · − skips this meal'
                            : 'Fewer portions = fewer meals and less from your wallet'}
                        </Text>
                      </View>
                      <View style={s.qtyStepper}>
                        <Pressable
                          style={[s.qtyBtn, cartBusy && { opacity: 0.4 }]}
                          onPress={() => {
                            // The last portion: that's a skip (asks first).
                            if ((dayOrder.quantity ?? 1) <= 1) setSkipConfirm({ date: selectedDay, slot: selectedSlot })
                            else handleCartOp(dayOrder.id, 'dec_qty')
                          }}
                          disabled={cartBusy}
                          hitSlop={8}
                        >
                          <Text style={s.qtyBtnText}>−</Text>
                        </Pressable>
                        <Text style={s.qtyValue} maxFontSizeMultiplier={1.3}>{dayOrder.quantity ?? 1}</Text>
                        <Pressable
                          style={[s.qtyBtn, cartBusy && { opacity: 0.4 }]}
                          onPress={() => handleCartOp(dayOrder.id, 'inc_qty')}
                          disabled={cartBusy}
                          hitSlop={8}
                        >
                          <Text style={s.qtyBtnText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* Extra dishes added to this slot — each can go to its own address */}
                  {dayExtras.map((ex) => (
                    <View key={ex.id}>
                      <View style={s.extraRow}>
                        <Plus size={14} color={Colors.primary} />
                        <Text style={s.extraName}>{ex.meal_templates?.name ?? 'Extra dish'}</Text>
                        <Text style={s.extraTag}>+₹{fmt(orderBase(ex))}</Text>
                        {!dayLocked && (
                          <Pressable
                            style={[s.addonRemoveBtn, cartBusy && { opacity: 0.4 }]}
                            onPress={() => handleRemoveDish(ex.id)}
                            disabled={cartBusy}
                          >
                            <Text style={s.addonRemoveText}>Remove</Text>
                          </Pressable>
                        )}
                      </View>
                      {addresses.length > 1 && renderAddressPicker(ex)}
                    </View>
                  ))}

                  {/* Add-ons for this day — a stepper once one's on the order
                      (quantity > 1 is billed as unit_price × quantity by
                      recompute_order_cart already), a plain Add button
                      before that. A default add-on's stepper floors at 1
                      rather than letting it reach 0 — mirrors the server's
                      cannot_remove_default_addon guard on remove_addon. */}
                  {!dayLocked && allAddons.length > 0 && (
                    <View style={s.addonEditWrap}>
                      <Text style={s.addonEditHead}>Add-ons for this day</Text>
                      {allAddons.map((a) => {
                        const on = dayOrderAddonIds.has(a.id)
                        const isDefault = defaultAddonIds.has(a.id)
                        const qty = dayOrderAddonQty.get(a.id) ?? 1
                        const available = isAddonAvailable({ unavailableAddons }, selectedDay, a.id)
                        return (
                          <View key={a.id} style={[s.addonEditRow, !available && { opacity: 0.5 }]}>
                            <View style={{ flex: 1 }}>
                              <Text style={s.addonEditName}>{a.name}</Text>
                              <Text style={s.addonEditPrice}>
                                ₹{fmt(a.price_per_meal * (on ? qty : 1))}
                                {isDefault ? ' · in your plan' : ''}
                                {!available ? ' · not available today' : ''}
                              </Text>
                            </View>
                            {!available ? null : on ? (
                              <View style={s.qtyStepper}>
                                <Pressable
                                  style={[s.qtyBtn, (cartBusy || (isDefault && qty <= 1)) && { opacity: 0.4 }]}
                                  onPress={() => handleCartOp(dayOrder.id, 'dec_addon_qty', a.id)}
                                  disabled={cartBusy || (isDefault && qty <= 1)}
                                  hitSlop={8}
                                >
                                  <Text style={s.qtyBtnText}>−</Text>
                                </Pressable>
                                <Text style={s.qtyValue} maxFontSizeMultiplier={1.3}>{qty}</Text>
                                <Pressable
                                  style={[s.qtyBtn, cartBusy && { opacity: 0.4 }]}
                                  onPress={() => handleCartOp(dayOrder.id, 'inc_addon_qty', a.id)}
                                  disabled={cartBusy}
                                  hitSlop={8}
                                >
                                  <Text style={s.qtyBtnText}>+</Text>
                                </Pressable>
                              </View>
                            ) : (
                              <Pressable
                                style={[s.addonAddBtn, cartBusy && { opacity: 0.4 }]}
                                onPress={() => handleCartOp(dayOrder.id, 'add_addon', a.id)}
                                disabled={cartBusy}
                              >
                                <Plus size={13} color={Colors.primary} />
                                <Text style={s.addonAddText}>Add</Text>
                              </Pressable>
                            )}
                          </View>
                        )
                      })}
                    </View>
                  )}

                  {/* Cart total for the day — everything is billed on delivery */}
                  <View style={s.cartSummary}>
                    <View style={s.cartSummaryRow}>
                      <Text style={s.cartSummaryLabel}>Meals & add-ons</Text>
                      <Text style={s.cartSummaryVal}>₹{fmt(dayMealsAddons)}</Text>
                    </View>
                    <View style={s.cartSummaryTotalRow}>
                      <Text style={s.cartSummaryTotalLabel}>Day total</Text>
                      <Text style={s.cartSummaryTotalVal}>₹{fmt(dayTotal)}</Text>
                    </View>
                    <Text style={s.cartBilledNote}>Billed from your wallet on delivery</Text>
                    {lowBalance && (
                      <Pressable
                        style={s.lowBalRow}
                        onPress={() => { setShowDayModal(false); setShowAddMoney(true) }}
                      >
                        <AlertCircle size={14} color={Colors.accentText} />
                        <Text style={s.lowBalText}>Low wallet balance for delivery — top up →</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ) : (
                <View style={s.dayModalCurrentSection}>
                  <View style={s.dayModalNoOrder}>
                    <Text style={s.dayModalNoOrderText}>
                      {dayHasNothing ? 'Nothing scheduled — pick a dish below to add one' : `No ${selectedSlot} scheduled — add a dish below`}
                    </Text>
                  </View>

                  {/* Extra dishes already added to this slot (extras-only — no base order) */}
                  {dayExtras.map((ex) => (
                    <View key={ex.id}>
                      <View style={s.extraRow}>
                        <Plus size={14} color={Colors.primary} />
                        <Text style={s.extraName}>{ex.meal_templates?.name ?? 'Extra dish'}</Text>
                        <Text style={s.extraTag}>+₹{fmt(orderBase(ex))}</Text>
                        {!dayLocked && (
                          <Pressable
                            style={[s.addonRemoveBtn, cartBusy && { opacity: 0.4 }]}
                            onPress={() => handleRemoveDish(ex.id)}
                            disabled={cartBusy}
                          >
                            <Text style={s.addonRemoveText}>Remove</Text>
                          </Pressable>
                        )}
                      </View>
                      {renderAddressPicker(ex)}
                    </View>
                  ))}
                </View>
              )}

              {/* Swap / Add section — effectiveAddMode alone (not just dayOrder
                  or addRefOrder) covers the fully-off-day case: zero orders in
                  any slot on this date, so there's no reference order to swap
                  or add against yet. effectiveAddMode is already true there
                  (it's !dayOrder || addMode, and dayOrder is null), which is
                  exactly what routes the tap handler below to the off-day
                  add-dish path instead of the normal reference-order one. */}
              {(dayOrder || addRefOrder || effectiveAddMode) && (
                <View style={s.dayModalSwapSection}>
                  {dayLocked ? (
                    <View style={s.dayModalLockBanner}>
                      <Text style={s.dayModalLockText}>
                        🔒 Changes for this day are locked
                      </Text>
                      <Text style={s.dayModalLockSub}>
                        {selectedSlot === 'lunch' ? 'Lunch closes at 8 AM' : 'Dinner closes at 1 PM'} on delivery day
                      </Text>
                    </View>
                  ) : (
                    <>
                      {/* Swap / Add toggle — only meaningful when there's a base meal to swap */}
                      {dayOrder && (
                        <View style={s.modeToggle}>
                          <Pressable
                            style={[s.modeBtn, !addMode && s.modeBtnActive]}
                            onPress={() => { setAddMode(false); setSwapError('') }}
                          >
                            <Text style={[s.modeBtnText, !addMode && s.modeBtnTextActive]}>Swap meal</Text>
                          </Pressable>
                          <Pressable
                            style={[s.modeBtn, addMode && s.modeBtnActive]}
                            onPress={() => { setAddMode(true); setSwapError('') }}
                          >
                            <Text style={[s.modeBtnText, addMode && s.modeBtnTextActive]}>Add a dish</Text>
                          </Pressable>
                        </View>
                      )}
                      <Text style={s.dayModalSectionLabel}>
                        {effectiveAddMode ? (dayOrder ? 'Add another dish to this slot' : `Add a ${selectedSlot} dish`) : 'Swap for something else'}
                      </Text>
                      {effectiveAddMode && addresses.length > 1 && (
                        <View style={s.addToRow}>
                          <Text style={s.addToLabel}>Deliver it to</Text>
                          {addresses.map((a) => (
                            <Pressable
                              key={a.id}
                              onPress={() => setAddAddressId(a.id)}
                              style={[s.addToChip, addTarget === a.id && s.addToChipActive]}
                            >
                              <Text style={[s.addToChipText, addTarget === a.id && s.addToChipTextActive]}>{a.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                      {swapError ? (
                        <View style={s.swapErrorRow}>
                          <Text style={s.dayModalSwapError}>{swapError}</Text>
                          {swapError.includes('balance') && (
                            <Pressable onPress={() => { setShowDayModal(false); setSwapError(''); setShowAddMoney(true) }}>
                              <Text style={s.swapErrorLink}>Add money →</Text>
                            </Pressable>
                          )}
                        </View>
                      ) : null}
                      {allMeals.map((meal) => {
                        const isCurrent = !effectiveAddMode && !!dayOrder && meal.id === dayOrder.meal_templates?.id
                        const available = isMealAvailable({ unavailableMeals }, selectedDay, meal.id)
                        return (
                          <Pressable
                            key={meal.id}
                            style={({ pressed }) => [
                              s.mealRow,
                              isCurrent && s.mealRowCurrent,
                              !available && { opacity: 0.5 },
                              pressed && !isCurrent && available && { opacity: 0.7 },
                            ]}
                            onPress={() => {
                              if (swapping || isCurrent || !available) return
                              if (effectiveAddMode) {
                                // addRefOrder is null on a fully-off day (zero
                                // orders in any slot) — add-dish then has no
                                // reference order to derive subscription/date/
                                // address from, so pass them directly instead.
                                if (addRefOrder) handleAddDish(addRefOrder.id, meal.id, selectedSlot)
                                else handleAddDishOffDay(sub.id, selectedDay, selectedSlot, meal.id)
                              } else if (dayOrder) {
                                handleSwapMeal(dayOrder.id, meal.id)
                              }
                            }}
                            disabled={swapping || isCurrent || !available}
                          >
                            {meal.image_url ? (
                              <Image source={{ uri: meal.image_url }} style={s.mealRowThumb} contentFit="cover" cachePolicy="memory-disk" />
                            ) : (
                              <View style={s.mealRowPlaceholder}>
                                <Text style={s.mealRowCategory}>{meal.category[0].toUpperCase()}</Text>
                              </View>
                            )}
                            <View style={s.mealRowInfo}>
                              <Text style={s.mealRowName} numberOfLines={2}>{meal.name}</Text>
                              <Text style={s.mealRowMeta}>
                                {!available
                                  ? 'Not available on this day'
                                  : meal.kcal ? `${meal.kcal} kcal` : meal.category}
                                {available && meal.protein ? ` · ${meal.protein}g protein` : ''}
                              </Text>
                            </View>
                            {isCurrent && (
                              <View style={s.mealRowCurrentBadge}>
                                <Check size={14} color={Colors.primary} strokeWidth={2.5} />
                              </View>
                            )}
                            {!isCurrent && !swapping && available && (
                              <View style={[s.switchBadge, s.switchBadgeFree]}>
                                <Text style={[s.switchBadgeText, s.switchBadgeTextFree]} maxFontSizeMultiplier={1.3}>
                                  {effectiveAddMode ? 'Add' : 'Swap'}
                                </Text>
                              </View>
                            )}
                            {swapping && !isCurrent && (
                              <ActivityIndicator size="small" color={Colors.textLight} />
                            )}
                          </Pressable>
                        )
                      })}
                      <View style={{ height: 32 }} />
                    </>
                  )}
                </View>
              )}

            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Transactions modal */}
      <Modal
        visible={showTransactions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTransactions(false)}
      >
        <Pressable style={s.dayModalOverlay} onPress={() => setShowTransactions(false)}>
          <Pressable style={s.dayModalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.dayModalHandle} />
            <View style={s.dayModalHeader}>
              <Text style={s.dayModalDate}>Wallet transactions</Text>
              <Pressable onPress={() => setShowTransactions(false)} hitSlop={10}>
                <X size={20} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom }}>
              {transactions.length === 0 ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Text style={s.dayModalNoOrderText}>No transactions yet</Text>
                </View>
              ) : (
                transactions.map((t) => (
                  <View key={t.id} style={s.transactionRow}>
                    <View style={s.transactionIcon}>
                      {t.type === 'credit' ? (
                        <TrendingUp size={16} color={Colors.primary} />
                      ) : (
                        <TrendingDown size={16} color={Colors.danger} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.transactionReason}>{t.reason}</Text>
                      <Text style={s.transactionDate}>{fmtTimestamp(t.created_at)}</Text>
                    </View>
                    <Text style={[s.transactionAmount, t.type === 'credit' ? s.transactionCredit : s.transactionDebit]}>
                      {t.type === 'credit' ? '+' : '−'}₹{fmt(t.amount)}
                    </Text>
                  </View>
                ))
              )}
              <View style={{ height: 20 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add money modal */}
      <Modal
        visible={showAddMoney}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddMoney(false)}
      >
        <Pressable style={s.dayModalOverlay} onPress={() => setShowAddMoney(false)}>
          <Pressable style={s.dayModalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.dayModalHandle} />
            <View style={s.dayModalHeader}>
              <Text style={s.dayModalDate}>Add money to wallet</Text>
              <Pressable onPress={() => setShowAddMoney(false)} hitSlop={10}>
                <X size={20} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} showsVerticalScrollIndicator={false}>
              <Text style={s.amountDisplayLabel}>Select amount</Text>

              {/* Quick chips */}
              <View style={s.topupChips}>
                {[50000, 100000, 200000].map((amt) => (
                  <Pressable
                    key={amt}
                    style={[s.topupChip, topupAmountPaise === amt && !topupCustom && s.topupChipActive]}
                    onPress={() => { setTopupAmountPaise(amt); setTopupCustom('') }}
                  >
                    <Text style={[s.topupChipText, topupAmountPaise === amt && !topupCustom && s.topupChipTextActive]}>
                      ₹{amt / 100}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={[s.amountDisplayLabel, { marginTop: 16 }]}>Or enter a custom amount</Text>
              <TextInput
                style={s.topupInput}
                keyboardType="number-pad"
                placeholder="₹ Amount (min ₹100)"
                placeholderTextColor={Colors.textLight}
                value={topupCustom}
                onChangeText={setTopupCustom}
              />

              <Text style={s.amountDisplay}>
                ₹{topupCustom
                  ? (parseFloat(topupCustom) || 0).toLocaleString('en-IN')
                  : fmt(topupAmountPaise)}
              </Text>

              <Pressable
                style={({ pressed }) => [s.addMoneyBtn, pressed && { opacity: 0.8 }, creatingTopup && { opacity: 0.6 }]}
                onPress={createTopupOrder}
                disabled={creatingTopup}
              >
                {creatingTopup
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.addMoneyBtnText}>Add money</Text>}
              </Pressable>

              <Pressable
                style={({ pressed }) => [s.viewTransactionsBtn, pressed && { opacity: 0.75 }]}
                onPress={() => { setShowAddMoney(false); fetchTransactions(); setShowTransactions(true) }}
              >
                <Text style={s.viewTransactionsBtnText}>View transactions</Text>
              </Pressable>

              <View style={{ height: 20 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  titleWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  historyBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff', borderWidth: 1, borderColor: Colors.border,
  },
  addrLinkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12,
  },
  addrLinkSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addToRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 },
  addToLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted },
  addToChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#fff' },
  addToChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  addToChipText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.text },
  addToChipTextActive: { color: Colors.primary },

  sectionLabel: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8,
  },

  // CoD limited view
  codPayCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, flexDirection: 'row', gap: 12, marginBottom: 16,
    borderLeftWidth: 3, borderLeftColor: Colors.accent, borderWidth: 1, borderColor: Colors.border,
  },
  codPayTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text, marginBottom: 4 },
  codPayDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 19 },

  // Timeline strip — day + date
  weekStrip: { marginBottom: 16 },
  weekStripContent: { gap: DAY_CELL_GAP, paddingBottom: 4, paddingTop: 2 },
  dayCell: {
    alignItems: 'center',
    width: DAY_CELL_WIDTH,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  dayCellPast: { backgroundColor: Colors.borderFaint, borderColor: Colors.borderFaint, opacity: 0.55 },
  dayDow: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  dayDate: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text },

  // Day modal extras
  extraRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    backgroundColor: Colors.primaryLight, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  extraName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text, flex: 1 },
  extraTag: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.primary },
  // Portions stepper
  qtyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 14, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
  },
  qtyLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  qtySub: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  qtyBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyBtnText: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.primary },
  qtyValue: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text, minWidth: 22, textAlign: 'center' },

  // Add-on editor
  addonEditWrap: { marginTop: 18 },
  addonEditHead: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 10,
  },
  addonEditRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  addonEditName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  addonEditPrice: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addonAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryLight, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
  },
  addonAddText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  addonRemoveBtn: {
    backgroundColor: Colors.background, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border,
  },
  addonRemoveText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },

  // Cart summary
  cartSummary: {
    marginTop: 18, padding: 16, borderRadius: 14,
    backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.primary,
  },
  cartSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  cartSummaryLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  cartSummaryVal: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text },
  cartSummaryTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: Colors.primary, paddingTop: 10, marginTop: 2,
  },
  cartSummaryTotalLabel: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text },
  cartSummaryTotalVal: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.primary },
  cartBilledNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 8 },
  lowBalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  lowBalText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accentText },

  modeToggle: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: 12, padding: 4, marginBottom: 14 },
  modeBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  modeBtnActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  modeBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  modeBtnTextActive: { color: Colors.text },

  // Deliveries remaining
  progressCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  progressLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  progressCount: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.primary },
  progressTrack: { height: 8, backgroundColor: Colors.border, borderRadius: 999, overflow: 'hidden', marginBottom: 8 },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 999 },
  renewNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textLight },

  // Renewal alert
  renewalAlert: {
    backgroundColor: Colors.accentLight, borderRadius: 16, padding: 16, marginBottom: 12,
    borderLeftWidth: 3, borderLeftColor: Colors.accent,
  },
  renewalAlertContent: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  renewalAlertTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.text, marginBottom: 2 },
  renewalAlertText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  renewalAlertBtns: { gap: 8 },
  renewalAlertBtn: { borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
  renewalAlertBtnPrimary: { backgroundColor: Colors.accent },
  renewalAlertBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#fff' },
  renewalAlertBtnGhost: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.accent },
  renewalAlertBtnGhostText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accent },

  // Transactions
  transactionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  transactionIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  transactionReason: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 2 },
  transactionDate: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  transactionAmount: { fontFamily: Fonts.bodyBold, fontSize: 14, minWidth: 60, textAlign: 'right' },
  transactionCredit: { color: Colors.primary },
  transactionDebit: { color: Colors.danger },

  // Add money
  amountDisplayLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 8 },
  amountDisplay: { fontFamily: Fonts.heading, fontSize: 36, color: Colors.text, marginBottom: 20, marginTop: 8 },
  addMoneyBtn: {
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
    alignItems: 'center', marginBottom: 10,
  },
  addMoneyBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  viewTransactionsBtn: {
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 4,
    borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: 'transparent',
  },
  viewTransactionsBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.primary },
  topupChips: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  topupChip: {
    flex: 1, borderRadius: 12, paddingVertical: 12, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: '#fff', alignItems: 'center',
  },
  topupChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  topupChipText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.textMuted },
  topupChipTextActive: { color: Colors.primary },
  topupInput: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    fontFamily: Fonts.body, fontSize: 16, color: Colors.text, marginBottom: 4,
  },

  // Swap error with link
  swapErrorRow: { marginBottom: 10 },
  swapErrorLink: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary, marginTop: 4 },

  // Meal switch price badge
  switchBadge: {
    backgroundColor: Colors.background, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  switchBadgeFree: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  switchBadgeText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.textMuted },
  switchBadgeTextFree: { color: Colors.primary },

  // Per-order address picker in day modal
  addrPickSection: { paddingHorizontal: 20, paddingBottom: 16 },
  addrPickCurrent: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.primaryLight,
  },
  addrPickRow: {
    flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff',
  },
  addrPickRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  addrPickLabel: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.text },
  addrPickLine1: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addrPickChange: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },

  // Week header label
  weekLabel: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, marginBottom: 12 },

  // Date strip — new 3-state tiles (selected=fill, today-unselected=border, rest=grey border)
  // dayCellSelected replaces dayCellToday for the active day
  dayCellSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayCellTodayUnselected: { borderColor: Colors.primary, borderWidth: 2, backgroundColor: '#fff' },
  dayDateSelected: { color: '#fff' },
  dayDowSelected: { color: Colors.primaryMid },

  // Hero card
  heroCard: {
    marginHorizontal: 0, marginBottom: 16,
    backgroundColor: '#fff', borderRadius: 20,
    borderWidth: 2, borderColor: Colors.primary, borderStyle: 'solid',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 16, elevation: 4,
    overflow: 'hidden',
  },
  heroHeader: { padding: 18, paddingBottom: 14 },
  heroTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  heroEyebrow: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.primary,
    textTransform: 'capitalize', letterSpacing: 0.8, marginBottom: 5,
  },
  heroTitle: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 3, lineHeight: 30 },
  heroSubtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  heroStatusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primaryLight, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, marginTop: 2,
  },
  heroStatusPrep: { backgroundColor: '#FFF9C4' },
  riderRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: Colors.primaryLight,
  },
  riderText: { flex: 1, fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  riderCall: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: Colors.primary,
  },
  riderCallText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: '#fff' },
  riderDone: { marginTop: 10, fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  heroStatusText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.primary },
  heroStatusPrepText: { color: '#795700' },

  // Meal rows inside hero card
  heroCartList: { backgroundColor: '#FAFAFA', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 2, marginBottom: 12 },
  heroCartRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  heroFoodThumb: { width: 46, height: 46, borderRadius: 12, flexShrink: 0 },
  heroCartRowInfo: { flex: 1 },
  heroCartName: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, lineHeight: 17 },
  heroCartKcal: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  heroQtyPill: {
    minWidth: 26, height: 26, backgroundColor: Colors.primaryLight, borderRadius: 7,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, paddingHorizontal: 5,
  },
  heroQtyPillText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.primary },

  // Macro strip
  heroMacroStrip: { paddingTop: 2 },
  heroAddonsRow: { marginTop: 10 },
  heroAddonsText: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },

  // Hero action buttons
  heroCardBtns: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingBottom: 18 },
  heroSkipBtn: {
    flex: 1, height: 48, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: 'transparent',
    borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  heroSkipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  heroCustomizeBtn: {
    height: 48, backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 20,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  heroCustomizeText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },

  // Hero empty state
  heroEmpty: {
    marginBottom: 16, backgroundColor: '#fff', borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
    padding: 28, alignItems: 'center', gap: 12,
  },
  heroEmptyText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.textMuted },
  heroAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primaryLight, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9,
  },
  heroAddBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },

  // Slot toggle (Lunch / Dinner pill)
  slotToggleWrap: { marginBottom: 16 },
  slotToggle: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 999,
    padding: 4, borderWidth: 1, borderColor: Colors.border, gap: 4,
  },
  slotBtn: {
    flex: 1, height: 44, borderRadius: 999, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  slotBtnActive: { backgroundColor: Colors.primary },
  slotBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textMuted },
  slotBtnTextActive: { color: '#fff' },

  // Info tiles (Balance + Plan Settings)
  infoTilesRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  infoTile: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  infoTileIcon: {
    width: 42, height: 42, backgroundColor: Colors.primaryLight, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  infoTileCaption: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  infoTileValue: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.text },
  infoTileLabel: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, lineHeight: 17 },

  // Skip confirm dialog
  confirmOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  confirmCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 320 },
  confirmTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text, marginBottom: 8 },
  confirmBody: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, marginBottom: 20, lineHeight: 20 },
  confirmBtns: { flexDirection: 'row', gap: 12 },
  confirmBtn: { flex: 1, borderRadius: 999, paddingVertical: 13, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  confirmBtnGhost: { backgroundColor: Colors.primaryLight },
  confirmBtnGhostText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },
  confirmBtnPrimary: { backgroundColor: Colors.primary },
  confirmBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },

  // Day detail / meal swap modal
  dayModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  dayModalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    paddingBottom: 0,
    flex: 1,
  },
  dayModalHandle: {
    width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2,
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  dayModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  dayModalDate: { fontFamily: Fonts.headingSemi, fontSize: 17, color: Colors.text },

  dayModalCurrentSection: { padding: 20 },
  dayModalSectionLabel: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12,
  },
  dayModalCurrentCard: {
    backgroundColor: Colors.primaryLight, borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  dayModalCurrentImg: { width: '100%', height: 160, borderRadius: 12, marginBottom: 12 },
  dayModalCurrentName: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text, marginBottom: 4 },
  dayModalCurrentMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 8 },
  dayModalStatusRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  dayModalStatus: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },

  dayModalNoOrder: { padding: 24, alignItems: 'center' },
  dayModalNoOrderText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted },

  dayModalSwapSection: { paddingHorizontal: 20, paddingTop: 4 },
  dayModalSwapError: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginBottom: 12 },
  dayModalLockBanner: {
    backgroundColor: Colors.background, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  dayModalLockText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 4 },
  dayModalLockSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },

  // Meal rows in swap list
  mealRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  mealRowCurrent: { opacity: 0.7 },
  mealRowThumb: { width: 52, height: 52, borderRadius: 10, flexShrink: 0 },
  mealRowPlaceholder: {
    width: 52, height: 52, borderRadius: 10, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  mealRowCategory: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.primary },
  mealRowInfo: { flex: 1 },
  mealRowName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 3 },
  mealRowMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, textTransform: 'capitalize' },
  mealRowCurrentBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
})
