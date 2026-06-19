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
  Image,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Pause, Play, SkipForward, ArrowUpDown, ArrowRight, Wallet, MapPin, X, Check } from 'lucide-react-native'
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

type OrderItem = {
  id: string
  delivery_date: string
  status: string
  meal_templates: { name: string; kcal: number | null; protein: number | null; image_url: string | null } | null
}

type MealTemplate = {
  id: string
  name: string
  category: string
  kcal: number | null
  protein: number | null
  image_url: string | null
}

type AddressData = { line1: string; landmark: string | null; label: string }

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(paise: number) { return (paise / 100).toLocaleString('en-IN') }
function fmtDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateLong(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })
}
function fmtDow(d: Date) { return d.toLocaleDateString('en-IN', { weekday: 'short' }) }
function toISO(d: Date) { return d.toISOString().split('T')[0] }

function statusLabel(status: string) {
  if (status === 'preparing') return 'In our kitchen'
  if (status === 'out_for_delivery') return 'Out for delivery'
  if (status === 'delivered') return 'Delivered'
  return 'Scheduled'
}

// A delivery is locked if it's today or if it's tomorrow and past 8 PM
function isLocked(dateStr: string): boolean {
  const now = new Date()
  const todayStr = toISO(now)
  if (dateStr <= todayStr) return true
  const tmr = new Date(now)
  tmr.setDate(tmr.getDate() + 1)
  return dateStr === toISO(tmr) && now.getHours() >= 20
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
  const [address, setAddress] = useState<AddressData | null>(null)
  const [allMeals, setAllMeals] = useState<MealTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [skipConfirm, setSkipConfirm] = useState<string | null>(null)
  const [skipping, setSkipping] = useState(false)
  const [selectedDay, setSelectedDay] = useState<{ dateStr: string; date: Date } | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState('')
  const didAutoSync = useRef(false)

  const fetchAll = useCallback(async () => {
    if (!user) return
    const today = new Date().toISOString().split('T')[0]

    const { data: subData } = await supabase
      .from('subscriptions')
      .select('id, status, payment_method, plan_name, deliveries_remaining, end_date, pause_from, pause_until, plans ( name, meals_total, days_per_week, base_price )')
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

    // Active / paused: parallel fetch
    const in7 = new Date()
    in7.setDate(in7.getDate() + 6)
    const in7Str = in7.toISOString().split('T')[0]

    const [ordersRes, walletRes, addrRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, delivery_date, status, meal_templates ( name, kcal, protein, image_url )')
        .eq('subscription_id', s.id)
        .gte('delivery_date', today)
        .lte('delivery_date', in7Str)
        .in('status', ['scheduled', 'confirmed', 'preparing'])
        .order('delivery_date'),
      supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('addresses')
        .select('line1, landmark, label')
        .eq('user_id', user.id)
        .order('created_at')
        .limit(1)
        .maybeSingle(),
    ])

    setWeekOrders((ordersRes.data as unknown as OrderItem[]) ?? [])
    setWalletBalance(walletRes.data?.balance ?? null)
    setAddress((addrRes.data as AddressData) ?? null)
  }, [user])

  // Fetch meal templates once on mount for the swap panel
  useEffect(() => {
    supabase
      .from('meal_templates')
      .select('id, name, category, kcal, protein, image_url')
      .eq('is_active', true)
      .order('category')
      .then(({ data }) => setAllMeals((data as MealTemplate[]) ?? []))
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
      const { error } = await supabase
        .from('orders')
        .update({ meal_template_id: newMealId })
        .eq('id', orderId)
      if (error) throw error
      setSelectedDay(null)
      await fetchAll()
    } catch (e: any) {
      setSwapError(e?.message ?? 'Could not swap meal. Try again.')
    } finally {
      setSwapping(false)
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

  const todayStr = new Date().toISOString().split('T')[0]
  const orderMap = new Map(weekOrders.map(o => [o.delivery_date, o]))
  const todayOrder = orderMap.get(todayStr) ?? null
  const nextOrder = weekOrders.find(o => o.delivery_date >= todayStr) ?? null

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i); return d
  })

  // Day detail panel data
  const dayOrder = selectedDay ? (orderMap.get(selectedDay.dateStr) ?? null) : null
  const dayLocked = selectedDay ? isLocked(selectedDay.dateStr) : false

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <Text style={s.title}>My Plan</Text>

        {/* TODAY'S DELIVERY */}
        <Text style={s.sectionLabel}>Today's delivery</Text>
        {todayOrder ? (
          <View style={s.todayCard}>
            <View style={s.todayCardRow}>
              <View style={{ flex: 1 }}>
                <View style={s.statusBadge}>
                  <Text style={s.statusBadgeText}>{statusLabel(todayOrder.status)}</Text>
                </View>
                <Text style={s.todayMealName}>{todayOrder.meal_templates?.name ?? 'Your meal'}</Text>
                {(todayOrder.meal_templates?.kcal || todayOrder.meal_templates?.protein) && (
                  <Text style={s.todayMeta}>
                    {todayOrder.meal_templates.kcal ? `${todayOrder.meal_templates.kcal} kcal` : ''}
                    {todayOrder.meal_templates.kcal && todayOrder.meal_templates.protein ? ' · ' : ''}
                    {todayOrder.meal_templates.protein ? `${todayOrder.meal_templates.protein}g protein` : ''}
                  </Text>
                )}
              </View>
              {todayOrder.meal_templates?.image_url && (
                <Image source={{ uri: todayOrder.meal_templates.image_url }} style={s.todayThumb} />
              )}
            </View>
          </View>
        ) : (
          <View style={s.noDeliveryCard}>
            <Text style={s.noDeliveryText}>No delivery today</Text>
            {nextOrder && (
              <Text style={s.noDeliveryMeta}>Next meal on {fmtDate(nextOrder.delivery_date)}</Text>
            )}
          </View>
        )}

        {/* THIS WEEK STRIP — tappable, shows meal thumbnail when available */}
        <Text style={s.sectionLabel}>This week</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.weekStripContent}
          style={s.weekStrip}
        >
          {weekDates.map((date, i) => {
            const dateStr = toISO(date)
            const order = orderMap.get(dateStr)
            const isToday = i === 0
            const hasImage = !!order?.meal_templates?.image_url
            const mealWord = order?.meal_templates?.name?.split(' ')[0] ?? '—'
            return (
              <Pressable
                key={dateStr}
                style={({ pressed }) => [s.dayCell, isToday && s.dayCellToday, pressed && { opacity: 0.7 }]}
                onPress={() => setSelectedDay({ dateStr, date })}
              >
                <Text style={[s.dayDow, isToday && s.dayDowToday]}>{fmtDow(date)}</Text>
                {hasImage ? (
                  <Image
                    source={{ uri: order!.meal_templates!.image_url! }}
                    style={s.dayThumb}
                  />
                ) : (
                  <Text style={[s.dayMeal, isToday && s.dayMealToday]} numberOfLines={1}>
                    {mealWord}
                  </Text>
                )}
              </Pressable>
            )
          })}
        </ScrollView>
        <Text style={s.lockNote}>Tap a day to see or swap your meal · Changes lock at 8 PM the night before</Text>

        {/* QUICK ACTIONS */}
        <View style={s.quickActions}>
          <Pressable
            style={({ pressed }) => [s.actionBox, pressed && { opacity: 0.75 }]}
            onPress={() => nextOrder ? setSkipConfirm(nextOrder.delivery_date) : null}
          >
            <SkipForward size={20} color={nextOrder ? Colors.primary : Colors.textLight} />
            <Text style={[s.actionBoxLabel, !nextOrder && { color: Colors.textLight }]}>Skip next</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.actionBox, pressed && { opacity: 0.75 }]}
            onPress={() => router.push('/(app)/plan-settings')}
          >
            {sub.status === 'paused'
              ? <Play size={20} color={Colors.primary} />
              : <Pause size={20} color={Colors.primary} />}
            <Text style={s.actionBoxLabel}>{sub.status === 'paused' ? 'Resume' : 'Pause'}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.actionBox, pressed && { opacity: 0.75 }]}
            onPress={() => router.push('/(app)/plan-settings')}
          >
            <ArrowUpDown size={20} color={Colors.primary} />
            <Text style={s.actionBoxLabel}>Change plan</Text>
          </Pressable>
        </View>

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
              <View style={s.walletBtn}>
                <Text style={s.walletBtnText}>Add money</Text>
              </View>
            </View>
            <Text style={s.walletLink}>View transactions</Text>
          </View>
        )}

        {/* DELIVERY ADDRESS */}
        {address && (
          <View style={s.addressCard}>
            <View style={s.addressHeader}>
              <MapPin size={14} color={Colors.primary} />
              <Text style={s.addressLabel}>{address.label || 'Delivery address'}</Text>
            </View>
            <Text style={s.addressLine} numberOfLines={2}>{address.line1}</Text>
            <Pressable onPress={() => router.push('/(app)/plan-settings')}>
              <Text style={s.addressEdit}>Edit →</Text>
            </Pressable>
          </View>
        )}

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

      {/* Day detail / meal swap panel */}
      <Modal
        visible={!!selectedDay}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDay(null)}
      >
        <Pressable style={s.dayModalOverlay} onPress={() => setSelectedDay(null)}>
          <Pressable style={s.dayModalSheet} onPress={(e) => e.stopPropagation()}>
            {/* Handle */}
            <View style={s.dayModalHandle} />

            {/* Header */}
            <View style={s.dayModalHeader}>
              <Text style={s.dayModalDate}>
                {selectedDay ? fmtDateLong(selectedDay.dateStr) : ''}
              </Text>
              <Pressable onPress={() => setSelectedDay(null)} hitSlop={10}>
                <X size={20} color={Colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {/* Current meal */}
              {dayOrder ? (
                <View style={s.dayModalCurrentSection}>
                  <Text style={s.dayModalSectionLabel}>Your meal</Text>
                  <View style={s.dayModalCurrentCard}>
                    {dayOrder.meal_templates?.image_url && (
                      <Image
                        source={{ uri: dayOrder.meal_templates.image_url }}
                        style={s.dayModalCurrentImg}
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
                </View>
              ) : (
                <View style={s.dayModalNoOrder}>
                  <Text style={s.dayModalNoOrderText}>No delivery scheduled for this day</Text>
                </View>
              )}

              {/* Swap section */}
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
                      <Text style={s.dayModalSectionLabel}>Swap for something else</Text>
                      {swapError ? (
                        <Text style={s.dayModalSwapError}>{swapError}</Text>
                      ) : null}
                      {allMeals.map((meal) => {
                        const isCurrent = meal.id === (dayOrder.meal_templates as any)?.id
                        return (
                          <Pressable
                            key={meal.id}
                            style={({ pressed }) => [
                              s.mealRow,
                              isCurrent && s.mealRowCurrent,
                              pressed && !isCurrent && { opacity: 0.7 },
                            ]}
                            onPress={() => {
                              if (!isCurrent && !swapping) handleSwapMeal(dayOrder.id, meal.id)
                            }}
                            disabled={swapping || isCurrent}
                          >
                            {meal.image_url ? (
                              <Image source={{ uri: meal.image_url }} style={s.mealRowThumb} />
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

  // Today's delivery card
  todayCard: {
    backgroundColor: Colors.primary, borderRadius: 16, padding: 20, marginBottom: 16,
  },
  todayCardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  todayThumb: { width: 72, height: 72, borderRadius: 12 },
  statusBadge: {
    backgroundColor: Colors.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: 'flex-start', marginBottom: 12,
  },
  statusBadgeText: { fontFamily: Fonts.bodyBold, fontSize: 11, color: Colors.text },
  todayMealName: { fontFamily: Fonts.heading, fontSize: 20, color: '#fff', marginBottom: 6 },
  todayMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.primaryMid },
  noDeliveryCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16,
    alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
  },
  noDeliveryText: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.text, marginBottom: 4 },
  noDeliveryMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },

  // Week strip
  weekStrip: { marginBottom: 0 },
  weekStripContent: { gap: 8, paddingBottom: 4, paddingTop: 2 },
  dayCell: {
    alignItems: 'center',
    width: 60,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  dayCellToday: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayDow: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  dayDowToday: { color: Colors.primaryMid },
  dayThumb: { width: 40, height: 40, borderRadius: 8 },
  dayMeal: { fontFamily: Fonts.bodyBold, fontSize: 10, color: Colors.text, maxWidth: 52, textAlign: 'center' },
  dayMealToday: { color: '#fff' },
  lockNote: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textLight, marginTop: 8, marginBottom: 16 },

  // Quick actions
  quickActions: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  actionBox: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    gap: 6, borderWidth: 1, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1,
  },
  actionBoxLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.text, textAlign: 'center' },

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

  // Delivery address
  addressCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  addressHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  addressLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  addressLine: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.text, marginBottom: 10 },
  addressEdit: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },

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
  dayModalStatusRow: { flexDirection: 'row' },
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
