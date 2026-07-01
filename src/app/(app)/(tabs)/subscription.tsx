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
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Pause, Play, SkipForward, ArrowRight, Wallet, MapPin, X, Check, AlertCircle, Plus, TrendingDown, TrendingUp, SlidersHorizontal, Utensils, Moon, Settings2, CheckCircle2, ChevronRight } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import SubscribeGate from '@/components/SubscribeGate'
import RazorpayWebView from '@/components/RazorpayWebView'
import MacroRow from '@/components/MacroRow'

// ── Types ──────────────────────────────────────────────────────────────────

type SubData = {
  id: string
  status: string
  payment_method: string
  plan_name: string | null
  deliveries_remaining: number
  start_date: string | null
  end_date: string | null
  pause_from: string | null
  pause_until: string | null
  menu_type: string | null
  plans: { name: string; meals_total: number; days_per_week: number; base_price: number } | null
}

type SubAddon = { addon_id: string; addons: { name: string; price_per_meal: number } | null }

type FirstMeal = { delivery_date: string; meal_templates: { name: string } | null }

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
  address_id: string | null
  quantity: number | null
  unit_price: number | null
  switch_fee_paise: number | null
  extra_dish: boolean | null
  slot_seq: number | null
  meal_templates: { id: string; name: string; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; image_url: string | null } | null
  order_addons: CartLine[]
}

type AddonCatalog = { id: string; name: string; price_per_meal: number }

type WalletTransaction = {
  id: string
  type: 'credit' | 'debit'
  amount: number
  reason: string
  created_at: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(paise: number) { return (paise / 100).toLocaleString('en-IN') }
function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateLong(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}
function toISO(d: Date) { return d.toISOString().split('T')[0] }

// All calendar math is done in IST (UTC+5:30) so the week strip and the day a
// tap opens never disagree around midnight, regardless of the device timezone.
const IST_MS = 5.5 * 60 * 60 * 1000
function istToday(): string { return new Date(Date.now() + IST_MS).toISOString().split('T')[0] }
function istHour(): number { return new Date(Date.now() + IST_MS).getUTCHours() }
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().split('T')[0]
}
// Mon=0 … Sun=6
function dowMon0(iso: string): number { return (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7 }
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

// A delivery is locked if it's today/past, or tomorrow after 8 PM IST.
function isLocked(dateStr: string): boolean {
  const today = istToday()
  if (dateStr <= today) return true
  return dateStr === addDaysISO(today, 1) && istHour() >= 20
}

// ── Main screen ────────────────────────────────────────────────────────────

export default function SubscriptionScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, hasSubscription } = useAuthStore()
  const [sub, setSub] = useState<SubData | null>(null)
  const [firstMeal, setFirstMeal] = useState<FirstMeal | null>(null)
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
  const [skipConfirm, setSkipConfirm] = useState<string | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [selectedDay, setSelectedDay] = useState<string>(istToday())
  const [selectedSlot, setSelectedSlot] = useState<'lunch' | 'dinner'>(istHour() < 14 ? 'lunch' : 'dinner')
  const [showDayModal, setShowDayModal] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState('')
  const [transactions, setTransactions] = useState<WalletTransaction[]>([])
  const [showTransactions, setShowTransactions] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [showRazorpay, setShowRazorpay] = useState(false)
  const [funding, setFunding] = useState(false)
  const [freeMealIds, setFreeMealIds] = useState<Set<string>>(new Set())
  const [topupAmountPaise, setTopupAmountPaise] = useState(50000) // ₹500 default
  const [topupCustom, setTopupCustom] = useState('')
  const [razorpayOrderId, setRazorpayOrderId] = useState<string | null>(null)
  const [razorpayAmountPaise, setRazorpayAmountPaise] = useState(0)
  const [creatingTopup, setCreatingTopup] = useState(false)
  const didAutoSync = useRef(false)
  const stripRef = useRef<ScrollView | null>(null)

  const fetchAll = useCallback(async () => {
    if (!user) return
    const today = istToday()

    const { data: subData } = await supabase
      .from('subscriptions')
      .select('id, status, payment_method, plan_name, deliveries_remaining, start_date, end_date, pause_from, pause_until, menu_type, plans ( name, meals_total, days_per_week, base_price )')
      .eq('user_id', user.id)
      .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const s = (subData as unknown as SubData) ?? null
    setSub(s)

    if (!s) return

    // CoD limited view: only the first upcoming meal
    if (s.status === 'pending' && s.payment_method === 'cod') {
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
      return
    }

    // Active / paused: fetch upcoming orders through the end of the current week.
    const endOffset = ((5 - dowMon0(today)) + 7) % 7 // days until Saturday (Mon=0..Sat=5)
    const endStr = addDaysISO(today, endOffset)

    const [ordersRes, walletRes, addrRes, addonRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, delivery_date, meal_slot, status, address_id, quantity, unit_price, switch_fee_paise, extra_dish, slot_seq, meal_templates ( id, name, kcal, protein, carbs, fat, image_url ), order_addons ( id, addon_id, kind, label, quantity, unit_price )')
        .eq('subscription_id', s.id)
        .gte('delivery_date', today)
        .lte('delivery_date', endStr)
        .in('status', ['scheduled', 'confirmed', 'preparing'])
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
        .order('is_default', { ascending: false })
        .order('created_at'),
      supabase
        .from('subscription_addons')
        .select('addon_id, addons ( name, price_per_meal )')
        .eq('subscription_id', s.id),
    ])

    setWeekOrders((ordersRes.data as unknown as OrderItem[]) ?? [])
    setWalletBalance(walletRes.data?.balance ?? null)
    setAddresses((addrRes.data as AddressData[]) ?? [])
    setSubAddons((addonRes.data as unknown as SubAddon[]) ?? [])
  }, [user])

  // Fetch meal + add-on catalogues once on mount for the cart editor.
  useEffect(() => {
    supabase
      .from('meal_templates')
      .select('id, name, category, kcal, protein, image_url')
      .eq('is_active', true)
      .order('category')
      .then(({ data }) => setAllMeals((data as MealTemplate[]) ?? []))
    supabase
      .from('addons')
      .select('id, name, price_per_meal')
      .eq('is_active', true)
      .then(({ data }) => setAllAddons((data as AddonCatalog[]) ?? []))
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchAll().finally(() => setLoading(false))
  }, [fetchAll])

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
  useEffect(() => { setPickingAddressForOrder(null); setAddMode(false); setSwapError('') }, [selectedDay, showDayModal])

  // When selected day/slot changes, look up the free dishes (own + counterpart menu)
  // so the swap list shows "Free" vs "+₹20" correctly.
  useEffect(() => {
    if (!sub) { setFreeMealIds(new Set()); return }
    const slotOrder = weekOrders.find(o => o.delivery_date === selectedDay && !o.extra_dish && o.meal_slot === selectedSlot)
    if (!slotOrder) { setFreeMealIds(new Set()); return }
    const myMenuType = sub.menu_type ?? 'M1'
    const counterpart = myMenuType === 'M1' ? 'M2' : 'M1'
    const dowNum = dowMon0(selectedDay)
    ;(async () => {
      const { data } = await supabase
        .from('weekly_menu')
        .select('meal_template_id')
        .in('menu_type', [myMenuType, counterpart])
        .eq('day_of_week', dowNum)
        .eq('meal_slot', selectedSlot)
      setFreeMealIds(new Set((data ?? []).map((m: any) => m.meal_template_id).filter(Boolean)))
    })()
  }, [selectedDay, selectedSlot, sub, weekOrders])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchAll()
    setRefreshing(false)
  }, [fetchAll])

  async function handleSkipConfirm() {
    if (!skipConfirm || !sub) return
    setSkipping(true)
    try {
      await supabase.functions.invoke('manage-subscription', {
        body: { action: 'skip', subscription_id: sub.id, delivery_date: skipConfirm },
      })
      setSkipConfirm(null)
      await fetchAll()
    } catch { /* silent */ }
    finally { setSkipping(false) }
  }

  async function handleSwapMeal(orderId: string, newMealId: string) {
    setSwapping(true)
    setSwapError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('switch-meal', {
        body: { order_id: orderId, meal_template_id: newMealId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw error
      if (data?.error === 'insufficient_balance') {
        setSwapError('Insufficient wallet balance (₹20 required). Add money first.')
        return
      }
      if (data?.error) throw new Error(data.error)
      setShowDayModal(false)
      await fetchAll()
    } catch (e: any) {
      setSwapError(e?.message ?? 'Could not swap meal. Try again.')
    } finally {
      setSwapping(false)
    }
  }

  async function handleAddDish(refOrderId: string, newMealId: string) {
    setSwapping(true)
    setSwapError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('add-dish', {
        body: { order_id: refOrderId, meal_template_id: newMealId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw error
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

  // Add-on add/remove + base meal quantity, charged to the wallet immediately.
  async function handleCartOp(orderId: string, op: 'add_addon' | 'remove_addon' | 'inc_qty' | 'dec_qty', addonId?: string) {
    if (cartBusy) return
    setCartBusy(true)
    setSwapError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('update-day-cart', {
        body: { order_id: orderId, op, addon_id: addonId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw error
      if (data?.error === 'insufficient_balance') {
        setSwapError('Insufficient wallet balance. Add money first.')
        return
      }
      if (data?.error === 'cannot_remove_default_addon') {
        setSwapError("This add-on is part of your plan and can't be removed here.")
        return
      }
      if (data?.error === 'below_minimum') {
        setSwapError('You already have the minimum number of meals for this slot.')
        return
      }
      if (data?.error) throw new Error(data.error)
      await fetchAll()
    } catch (e: any) {
      setSwapError(e?.message ?? 'Could not update the cart. Try again.')
    } finally {
      setCartBusy(false)
    }
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
      setRazorpayOrderId(data.order_id)
      setRazorpayAmountPaise(amount)
      setShowAddMoney(false)
      setShowRazorpay(true)
    } catch (e: any) {
      console.error('createTopupOrder:', e)
    } finally {
      setCreatingTopup(false)
    }
  }

  async function handleAddMoneyDev() {
    if (!user) return
    const amount = topupCustom ? Math.round(parseFloat(topupCustom) * 100) : topupAmountPaise
    if (!amount || amount < 10000) return
    setFunding(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      await supabase.rpc('wallet_credit', {
        p_user: user.id,
        p_amount: amount,
        p_reason: 'Wallet top-up',
        p_reference_id: `dev-topup-${Date.now()}`,
      })
      setShowAddMoney(false)
      await fetchAll()
    } catch {
      /* silent */
    } finally {
      setFunding(false)
    }
  }

  if (loading) {
    return <View style={s.loadingWrap}><ActivityIndicator size="large" color={Colors.primary} /></View>
  }

  if (!hasSubscription || !sub) {
    return (
      <View style={s.container}>
        <View style={[s.titleWrap, { paddingTop: insets.top + 16 }]}>
          <Text style={s.title}>My Plan</Text>
        </View>
        <SubscribeGate
          onSubscribe={() => router.push('/(onboarding)/health')}
          onExplore={() => router.push('/(app)/(tabs)/menu')}
        />
      </View>
    )
  }

  const mealsTotal = sub.plans?.meals_total ?? 0
  const remaining = sub.deliveries_remaining
  const progress = mealsTotal > 0 ? Math.min(100, (remaining / mealsTotal) * 100) : 0
  const isCodPending = sub.status === 'pending' && sub.payment_method === 'cod'
  const payAmount = sub.plans?.base_price ?? 0

  // ── CoD limited view ──────────────────────────────────────────────────────

  if (isCodPending) {
    const planName = sub.plan_name || sub.plans?.name || 'Your Plan'
    return (
      <View style={s.container}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <Text style={s.title}>My Plan</Text>

          <View style={s.codHeroCard}>
            <Text style={s.codHeroEmoji}>🎉</Text>
            <Text style={s.codHeroTitle}>{planName} is confirmed</Text>
            <Text style={s.codHeroSub}>
              Your first meal is on the way. Pay in cash on delivery to unlock your full plan.
            </Text>
          </View>

          <Text style={s.sectionLabel}>Your first meal</Text>
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

          <View style={s.codPayCard}>
            <Text style={s.codPayEmoji}>💵</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.codPayTitle}>Pay ₹{fmt(payAmount)} on delivery</Text>
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

  // ── Active / paused home view ─────────────────────────────────────────────

  const todayStr = istToday()
  const orderMap = new Map<string, OrderItem[]>()
  for (const o of weekOrders) {
    const arr = orderMap.get(o.delivery_date) ?? []
    arr.push(o)
    orderMap.set(o.delivery_date, arr)
  }
  const nextOrder = weekOrders.find(o => o.delivery_date >= todayStr) ?? null

  // Week-strip timeline: from subscription start through end of this week.
  const startStr = sub.start_date && sub.start_date < todayStr ? sub.start_date : todayStr
  const endOffset = ((5 - dowMon0(todayStr)) + 7) % 7
  const endStr = addDaysISO(todayStr, endOffset)
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
  const heroLocked = isLocked(selectedDay)
  const heroIsToday = selectedDay === todayStr

  // Day modal data (same slot).
  const daySlotOrders = (orderMap.get(selectedDay) ?? []).filter(o => o.meal_slot === selectedSlot)
  const dayOrder = daySlotOrders.find(o => !o.extra_dish) ?? null
  const dayExtras = daySlotOrders.filter(o => o.extra_dish)
  const dayLocked = heroLocked

  const baseRate = sub.plans ? Math.round(sub.plans.base_price / Math.max(sub.plans.meals_total, 1)) : 0
  const dayAllOrders = daySlotOrders
  const orderBase = (o: OrderItem) => (o.unit_price ?? baseRate) * (o.quantity ?? 1)
  const addonLinesCost = (o: OrderItem) =>
    (o.order_addons ?? []).filter(l => l.kind === 'addon').reduce((sum, l) => sum + (l.unit_price ?? 0) * (l.quantity ?? 1), 0)
  const feeCost = (o: OrderItem) =>
    (o.switch_fee_paise ?? 0) + (o.order_addons ?? []).filter(l => l.kind === 'fee').reduce((sum, l) => sum + (l.unit_price ?? 0) * (l.quantity ?? 1), 0)
  const dayMealsAddons = dayAllOrders.reduce((sum, o) => sum + orderBase(o) + addonLinesCost(o), 0)
  const daySwapFees = dayAllOrders.reduce((sum, o) => sum + feeCost(o), 0)
  const dayTotal = dayMealsAddons + daySwapFees
  const lowBalance = walletBalance !== null && dayTotal > walletBalance
  const dayOrderAddonIds = new Set((dayOrder?.order_addons ?? []).filter(l => l.kind === 'addon' && l.addon_id).map(l => l.addon_id))
  const defaultAddonIds = new Set(subAddons.map(a => a.addon_id))

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
        <Text style={s.title}>My Plan</Text>

        {/* WEEK HEADER */}
        <Text style={s.weekLabel}>{heroIsToday ? 'Today' : 'This week'}</Text>

        {/* DATE STRIP */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.weekStripContent}
          style={s.weekStrip}
          ref={(r) => { stripRef.current = r }}
          onContentSizeChange={() => stripRef.current?.scrollToEnd({ animated: false })}
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
          <View style={s.heroCard}>
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
            </View>

            {/* Action buttons */}
            <View style={s.heroCardBtns}>
              {!heroLocked && (
                <Pressable
                  style={({ pressed }) => [s.heroSkipBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSkipConfirm(selectedDay) }}
                >
                  <SkipForward size={15} color={Colors.text} strokeWidth={2} />
                  <Text style={s.heroSkipText}>Skip</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [s.heroCustomizeBtn, !heroLocked && { flex: 1.4 }, pressed && { opacity: 0.85 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setAddMode(false); setShowDayModal(true) }}
              >
                <SlidersHorizontal size={15} color="#fff" strokeWidth={2} />
                <Text style={s.heroCustomizeText}>{heroLocked ? 'View details →' : 'Customize →'}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={s.heroEmpty}>
            <Text style={s.heroEmptyText}>No {selectedSlot} on {dowShort(selectedDay)} {dayNum(selectedDay)}</Text>
            {!heroLocked && (
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

        {/* PAUSE / RESUME ACTION */}
        <View style={s.quickActions}>
          <Pressable
            style={({ pressed }) => [s.actionBox, pressed && { opacity: 0.75 }]}
            onPress={() => { if (nextOrder) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setSkipConfirm(nextOrder.delivery_date) } }}
          >
            <SkipForward size={22} color={nextOrder ? Colors.primary : Colors.textLight} />
            <Text style={[s.actionBoxLabel, !nextOrder && { color: Colors.textLight }]}>Skip next</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.actionBox, pressed && { opacity: 0.75 }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/(app)/plan-settings') }}
          >
            {sub.status === 'paused'
              ? <Play size={22} color={Colors.primary} />
              : <Pause size={22} color={Colors.primary} />}
            <Text style={s.actionBoxLabel}>{sub.status === 'paused' ? 'Resume' : 'Pause'}</Text>
          </Pressable>
        </View>

        {/* ADD-ONS */}
        {subAddons.length > 0 && (
          <View style={s.addonsCard}>
            <Text style={s.addonsTitle}>Your add-ons</Text>
            {subAddons.map((a) => (
              <View key={a.addon_id} style={s.addonsRow}>
                <Text style={s.addonsName}>{a.addons?.name ?? a.addon_id}</Text>
                <Text style={s.addonsPrice}>₹{fmt(a.addons?.price_per_meal ?? 0)}/meal</Text>
              </View>
            ))}
          </View>
        )}

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

        {/* RENEWAL ALERT */}
        {remaining === 0 && (
          <View style={s.renewalAlert}>
            <View style={s.renewalAlertContent}>
              <AlertCircle size={20} color={Colors.accent} style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.renewalAlertTitle}>Plan expired</Text>
                <Text style={s.renewalAlertText}>Renew to keep receiving meals</Text>
              </View>
            </View>
            <View style={s.renewalAlertBtns}>
              <Pressable
                style={({ pressed }) => [s.renewalAlertBtn, s.renewalAlertBtnPrimary, pressed && { opacity: 0.85 }]}
                onPress={() => setShowAddMoney(true)}
              >
                <Text style={s.renewalAlertBtnText}>Renew plan</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [s.renewalAlertBtn, s.renewalAlertBtnGhost, pressed && { opacity: 0.7 }]}
                onPress={() => router.push('/(app)/plan-settings')}
              >
                <Text style={s.renewalAlertBtnGhostText}>Change plan</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* WALLET */}
        {walletBalance !== null && (
          <View style={s.walletCard}>
            <View style={s.walletRow}>
              <Wallet size={16} color={Colors.accent} />
              <Text style={s.walletTitle}>Wallet</Text>
            </View>
            <View style={s.walletBody}>
              <View>
                <Text style={s.walletBalance}>₹{(walletBalance / 100).toLocaleString('en-IN')}</Text>
                <Text style={s.walletSub}>Available balance</Text>
              </View>
              <Pressable
                style={({ pressed }) => [s.walletBtn, pressed && { opacity: 0.85 }]}
                onPress={() => setShowAddMoney(true)}
              >
                <Text style={s.walletBtnText}>Add money</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => { fetchTransactions(); setShowTransactions(true) }}>
              <Text style={s.walletLink}>View transactions</Text>
            </Pressable>
          </View>
        )}

        {/* DELIVERY ADDRESS */}
        {addresses.length > 0 && (() => {
          const defaultAddr = addresses.find(a => a.is_default) ?? addresses[0]
          return (
            <View style={s.addressCard}>
              <View style={s.addressHeader}>
                <MapPin size={14} color={Colors.primary} />
                <Text style={s.addressLabel}>{defaultAddr.label || 'Delivery address'}</Text>
                {addresses.length > 1 && (
                  <Text style={s.addressCountBadge}>{addresses.length} addresses</Text>
                )}
              </View>
              <Text style={s.addressLine} numberOfLines={2}>{defaultAddr.line1}</Text>
              <Pressable onPress={() => router.push('/(app)/addresses')}>
                <Text style={s.addressEdit}>Manage addresses →</Text>
              </Pressable>
            </View>
          )
        })()}

        {/* VIEW PLAN & SETTINGS */}
        <Pressable
          style={({ pressed }) => [s.settingsRow, pressed && { opacity: 0.8 }]}
          onPress={() => router.push('/(app)/plan-settings')}
        >
          <Text style={s.settingsRowText}>View plan & settings</Text>
          <ArrowRight size={16} color={Colors.primary} />
        </Pressable>
      </ScrollView>

      {/* Skip confirm dialog */}
      <Modal
        visible={!!skipConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setSkipConfirm(null)}
      >
        <View style={s.confirmOverlay}>
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>Skip this delivery?</Text>
            <Text style={s.confirmBody}>
              Delivery on {fmtDate(skipConfirm)}.{'\n'}This meal will be removed from your week.
            </Text>
            <View style={s.confirmBtns}>
              <Pressable
                style={[s.confirmBtn, s.confirmBtnGhost]}
                onPress={() => setSkipConfirm(null)}
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
              contentContainerStyle={{ paddingBottom: 24 }}
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
                      {feeCost(dayOrder) > 0 && (
                        <Text style={s.swapFeeTag}>+₹{fmt(feeCost(dayOrder))} swap fee</Text>
                      )}
                    </View>
                  </View>

                  {/* Portions stepper for the base meal */}
                  {!dayLocked && (
                    <View style={s.qtyRow}>
                      <View>
                        <Text style={s.qtyLabel}>Portions</Text>
                        <Text style={s.qtySub}>Billed from your wallet on delivery</Text>
                      </View>
                      <View style={s.qtyStepper}>
                        <Pressable
                          style={[s.qtyBtn, (cartBusy || (dayOrder.quantity ?? 1) <= 1) && { opacity: 0.4 }]}
                          onPress={() => handleCartOp(dayOrder.id, 'dec_qty')}
                          disabled={cartBusy || (dayOrder.quantity ?? 1) <= 1}
                        >
                          <Text style={s.qtyBtnText}>−</Text>
                        </Pressable>
                        <Text style={s.qtyValue}>{dayOrder.quantity ?? 1}</Text>
                        <Pressable
                          style={[s.qtyBtn, cartBusy && { opacity: 0.4 }]}
                          onPress={() => handleCartOp(dayOrder.id, 'inc_qty')}
                          disabled={cartBusy}
                        >
                          <Text style={s.qtyBtnText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* Extra dishes added to this slot */}
                  {dayExtras.map((ex) => (
                    <View key={ex.id} style={s.extraRow}>
                      <Plus size={14} color={Colors.primary} />
                      <Text style={s.extraName}>{ex.meal_templates?.name ?? 'Extra dish'}</Text>
                      <Text style={s.extraTag}>+₹{fmt(orderBase(ex))}</Text>
                    </View>
                  ))}

                  {/* Add-ons for this day */}
                  {!dayLocked && allAddons.length > 0 && (
                    <View style={s.addonEditWrap}>
                      <Text style={s.addonEditHead}>Add-ons for this day</Text>
                      {allAddons.map((a) => {
                        const on = dayOrderAddonIds.has(a.id)
                        const isDefault = defaultAddonIds.has(a.id)
                        return (
                          <View key={a.id} style={s.addonEditRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={s.addonEditName}>{a.name}</Text>
                              <Text style={s.addonEditPrice}>
                                ₹{fmt(a.price_per_meal)}{isDefault ? ' · in your plan' : ''}
                              </Text>
                            </View>
                            {on ? (
                              isDefault ? (
                                <View style={s.addonIncluded}><Text style={s.addonIncludedText}>Included</Text></View>
                              ) : (
                                <Pressable
                                  style={[s.addonRemoveBtn, cartBusy && { opacity: 0.4 }]}
                                  onPress={() => handleCartOp(dayOrder.id, 'remove_addon', a.id)}
                                  disabled={cartBusy}
                                >
                                  <Text style={s.addonRemoveText}>Remove</Text>
                                </Pressable>
                              )
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
                    {daySwapFees > 0 && (
                      <View style={s.cartSummaryRow}>
                        <Text style={s.cartSummaryLabel}>Swap fees</Text>
                        <Text style={s.cartSummaryVal}>₹{fmt(daySwapFees)}</Text>
                      </View>
                    )}
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
                <View style={s.dayModalNoOrder}>
                  <Text style={s.dayModalNoOrderText}>No delivery scheduled for this day</Text>
                </View>
              )}

              {/* Swap / Add section */}
              {dayOrder && (
                <View style={s.dayModalSwapSection}>
                  {dayLocked ? (
                    <View style={s.dayModalLockBanner}>
                      <Text style={s.dayModalLockText}>
                        🔒 Changes for this day are locked
                      </Text>
                      <Text style={s.dayModalLockSub}>
                        Swaps close at 8 PM the night before delivery
                      </Text>
                    </View>
                  ) : (
                    <>
                      {/* Swap / Add toggle */}
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
                      <Text style={s.dayModalSectionLabel}>
                        {addMode ? 'Add another dish to this slot' : 'Swap for something else'}
                      </Text>
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
                        const isCurrent = !addMode && meal.id === dayOrder.meal_templates?.id
                        const isFree = !addMode && !isCurrent && freeMealIds.has(meal.id)
                        return (
                          <Pressable
                            key={meal.id}
                            style={({ pressed }) => [
                              s.mealRow,
                              isCurrent && s.mealRowCurrent,
                              pressed && !isCurrent && { opacity: 0.7 },
                            ]}
                            onPress={() => {
                              if (swapping || isCurrent) return
                              if (addMode) handleAddDish(dayOrder.id, meal.id)
                              else handleSwapMeal(dayOrder.id, meal.id)
                            }}
                            disabled={swapping || isCurrent}
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
                                {meal.kcal ? `${meal.kcal} kcal` : meal.category}
                                {meal.protein ? ` · ${meal.protein}g protein` : ''}
                              </Text>
                            </View>
                            {isCurrent && (
                              <View style={s.mealRowCurrentBadge}>
                                <Check size={14} color={Colors.primary} strokeWidth={2.5} />
                              </View>
                            )}
                            {!isCurrent && !swapping && (
                              <View style={[s.switchBadge, (isFree || addMode) && s.switchBadgeFree]}>
                                <Text style={[s.switchBadgeText, (isFree || addMode) && s.switchBadgeTextFree]}>
                                  {addMode ? 'Add' : isFree ? 'Free' : '+₹20'}
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

              {/* Per-order address section */}
              {dayOrder && !dayLocked && addresses.length > 0 && (
                <View style={s.addrPickSection}>
                  <Text style={s.dayModalSectionLabel}>Deliver to</Text>
                  {pickingAddressForOrder === dayOrder.id ? (
                    <View style={{ gap: 8, marginBottom: 8 }}>
                      {addresses.map((addr) => {
                        const isSelected = (dayOrder.address_id ?? addresses.find(a => a.is_default)?.id) === addr.id
                        return (
                          <Pressable
                            key={addr.id}
                            style={[s.addrPickRow, isSelected && s.addrPickRowActive]}
                            onPress={async () => {
                              await supabase.from('orders').update({ address_id: addr.id }).eq('id', dayOrder.id)
                              setWeekOrders(prev => prev.map(o => o.id === dayOrder.id ? { ...o, address_id: addr.id } : o))
                              setPickingAddressForOrder(null)
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={[s.addrPickLabel, isSelected && { color: Colors.primary }]}>{addr.label}</Text>
                              <Text style={s.addrPickLine1} numberOfLines={1}>{addr.line1}</Text>
                            </View>
                            {isSelected && <Check size={16} color={Colors.primary} strokeWidth={2.5} />}
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : (
                    <Pressable style={s.addrPickCurrent} onPress={() => setPickingAddressForOrder(dayOrder.id)}>
                      {(() => {
                        const sel = addresses.find(a => a.id === dayOrder.address_id) ?? addresses.find(a => a.is_default) ?? addresses[0]
                        return (
                          <>
                            <View style={{ flex: 1 }}>
                              <Text style={s.addrPickLabel}>{sel.label}</Text>
                              <Text style={s.addrPickLine1} numberOfLines={1}>{sel.line1}</Text>
                            </View>
                            <Text style={s.addrPickChange}>Change</Text>
                          </>
                        )
                      })()}
                    </Pressable>
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
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
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
                      <Text style={s.transactionDate}>{fmtDate(t.created_at)}</Text>
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
            <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
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
                  : <Text style={s.addMoneyBtnText}>Pay with Razorpay</Text>}
              </Pressable>

              {__DEV__ && (
                <Pressable
                  style={({ pressed }) => [s.addMoneyBtn, s.addMoneyBtnDev, pressed && { opacity: 0.8 }]}
                  onPress={handleAddMoneyDev}
                  disabled={funding}
                >
                  {funding ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <Text style={s.addMoneyBtnDevText}>Dev: Fake credit</Text>
                  )}
                </Pressable>
              )}

              <View style={{ height: 20 }} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Razorpay payment — for wallet top-ups */}
      {showRazorpay && razorpayOrderId && (
        <RazorpayWebView
          orderId={razorpayOrderId}
          amount={razorpayAmountPaise}
          keyId={process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? ''}
          userName={user?.user_metadata?.name ?? user?.email ?? 'User'}
          userPhone={user?.phone ?? ''}
          onSuccess={async (_paymentId) => {
            setShowRazorpay(false)
            setRazorpayOrderId(null)
            await fetchAll()
            fetchTransactions()
            setShowTransactions(true)
          }}
          onFailure={() => { setShowRazorpay(false); setRazorpayOrderId(null) }}
          onDismiss={() => { setShowRazorpay(false); setRazorpayOrderId(null) }}
        />
      )}
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

  sectionLabel: {
    fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8,
  },

  // CoD limited view
  codHeroCard: {
    backgroundColor: Colors.primaryLight, borderRadius: 16, padding: 20, marginBottom: 24,
    alignItems: 'center', borderWidth: 2, borderColor: Colors.primary,
  },
  codHeroEmoji: { fontSize: 40, marginBottom: 8 },
  codHeroTitle: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.text, textAlign: 'center', marginBottom: 6 },
  codHeroSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
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

  // Timeline strip — day + date
  weekStrip: { marginBottom: 0 },
  weekStripContent: { gap: 8, paddingBottom: 4, paddingTop: 2 },
  dayCell: {
    alignItems: 'center',
    width: 56,
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

  // Quick actions
  quickActions: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  actionBox: {
    flex: 1, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 22, alignItems: 'center',
    gap: 8, borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  actionBoxLabel: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text, textAlign: 'center' },

  // Add-ons card
  addonsCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  addonsTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  addonsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  addonsName: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.text },
  addonsPrice: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },

  // Day modal extras
  swapFeeTag: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.accentText, marginLeft: 10 },
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
  addonIncluded: { backgroundColor: Colors.primaryLight, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  addonIncludedText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },

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

  // Wallet
  walletCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  walletTitle: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  walletBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  walletBalance: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text },
  walletSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  walletBtn: { backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  walletBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#fff' },
  walletLink: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.primary },

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
  addMoneyBtnDev: { backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.primary },
  addMoneyBtnDevText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.primary },
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

  // Delivery address
  addressCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  addressHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  addressLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  addressCountBadge: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textLight, marginLeft: 4 },
  addressLine: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.text, marginBottom: 10 },
  addressEdit: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },

  // Per-order address picker in day modal
  addrPickSection: { paddingHorizontal: 20, paddingBottom: 16 },
  addrPickCurrent: {
    flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
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
    borderWidth: 2, borderColor: Colors.primary,
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

  // Hero action buttons
  heroCardBtns: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingBottom: 18 },
  heroSkipBtn: {
    flex: 1, height: 48, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: 'transparent',
    borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  heroSkipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  heroCustomizeBtn: {
    height: 48, backgroundColor: Colors.primary, borderRadius: 999,
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

  // Settings link
  settingsRow: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  settingsRowText: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.primary },

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
