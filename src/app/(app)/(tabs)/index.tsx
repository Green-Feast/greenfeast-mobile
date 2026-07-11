import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Modal,
  ActivityIndicator,
  Linking,
} from 'react-native'
import { Image } from 'expo-image'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { setStatusBarStyle } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter, useFocusEffect } from 'expo-router'
import * as Updates from 'expo-updates'
import * as Haptics from 'expo-haptics'
import { ArrowRight, Leaf, RefreshCw, Bell, X, ChevronRight } from 'lucide-react-native'
import MacroRow from '@/components/MacroRow'
import MacroRing from '@/components/MacroRing'
import StoryCarousel from '@/components/StoryCarousel'
import { supabase } from '@/lib/supabase'
import { istToday, istHour, addDaysISO, isDeliveryLocked } from '@/lib/ist'
import { useAuthStore } from '@/store/auth'
import { useNotificationStore } from '@/store/notifications'
import { Colors, Fonts } from '@/constants/colors'
import { STORY_SLIDES, CHEF_NOTES } from '@/constants/homeContent'
import { REFERRAL_MESSAGE } from '@/constants/links'
import { CATEGORIES, CATEGORY_EMOJIS } from './menu'
import Logo from '@/components/Logo'
import Skeleton from '@/components/Skeleton'

type Order = {
  id: string
  delivery_date: string
  status: string
  meal_slot: string
  meal_templates: {
    name: string
    category: string
    kcal: number | null
    protein: number | null
    image_url: string | null
  }
}

type Subscription = {
  id: string
  status: string
  deliveries_remaining: number
  plan_name: string | null
  plans: { meals_total: number } | null
}

type Meal = {
  id: string
  name: string
  category: string
  price: number | null
  kcal: number | null
  protein: number | null
  image_url: string | null
}

type UpcomingOrder = {
  id: string
  delivery_date: string
  meal_slot: string
  extra_dish: boolean | null
  status: string
}

type AddTarget = { refOrderId: string; date: string; slot: 'lunch' | 'dinner' }

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled', confirmed: 'Confirmed', preparing: 'Being prepared',
  delivered: 'Delivered', cancelled: 'Cancelled', skipped: 'Skipped',
}

function getGreeting(name: string) {
  const h = new Date().getHours()
  const first = name.split(' ')[0]
  if (h < 12) return `Good morning, ${first}.`
  if (h < 17) return `Good afternoon, ${first}.`
  return `Good evening, ${first}.`
}

function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function fmtDayLabel(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })
}

// Deterministic "random" seed from today's date, used to rotate the daily
// picks + chef's note without any backend — same seed all day, changes at
// midnight IST.
function seedFromDate(dateStr: string): number {
  return Number(dateStr.replace(/-/g, ''))
}

// First upcoming, unlocked (not today/past, not tomorrow-after-8pm) day with
// an existing non-extra order — reused as the reference order for a
// one-tap "add this dish to my next delivery" flow, exactly like
// subscription.tsx's own addRefOrder derivation.
function findNextAddTarget(orders: UpcomingOrder[]): AddTarget | null {
  const byDate = new Map<string, UpcomingOrder[]>()
  for (const o of orders) {
    if (o.extra_dish) continue
    const arr = byDate.get(o.delivery_date) ?? []
    arr.push(o)
    byDate.set(o.delivery_date, arr)
  }
  const dates = [...byDate.keys()].sort()
  for (const d of dates) {
    if (isDeliveryLocked(d)) continue
    const base = byDate.get(d)![0]
    return { refOrderId: base.id, date: d, slot: base.meal_slot as 'lunch' | 'dinner' }
  }
  return null
}

export default function Home() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, loading: authLoading } = useAuthStore()
  const [userName, setUserName] = useState('')
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [todayOrder, setTodayOrder] = useState<Order | null>(null)
  const [meals, setMeals] = useState<Meal[]>([])
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null)
  const [confirmMeal, setConfirmMeal] = useState<Meal | null>(null)
  const [addedMealIds, setAddedMealIds] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [reloading, setReloading] = useState(false)
  const notifications = useNotificationStore((s) => s.notifications)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const unreadCount = notifications.filter((n) => !n.read).length

  // Home has a green hero band under the status bar (every other screen is
  // light-background — see _layout.tsx's global style="dark" default). Tabs
  // stay mounted after their first visit, so a plain declarative
  // <StatusBar> here would leak "light" onto other tabs once you switch
  // away; useFocusEffect's cleanup reverts it the moment Home loses focus.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light')
      return () => setStatusBarStyle('dark')
    }, [])
  )

  async function handleReloadNow() {
    if (reloading) return
    setReloading(true)
    // Logged right before the reload tears down this JS context. The
    // corresponding "after" state is logged by useOtaNotifications on the
    // next app start (see src/hooks/useOtaNotifications.ts) — diff the two
    // in logcat to see definitively whether the reload actually switched
    // updateId, or silently stayed on the same (likely embedded) one.
    console.log('[OTA] Before reloadAsync():', {
      updateId: Updates.updateId,
      channel: Updates.channel,
      runtimeVersion: Updates.runtimeVersion,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    })
    try {
      await Updates.reloadAsync()
    } catch (e) {
      console.error('[OTA] reloadAsync() failed:', e)
      // If this fails (e.g. no pending update after all), just stop the
      // spinner — nothing else to recover, the user can try again later.
      setReloading(false)
    }
  }

  async function fetchData() {
    if (!user) return
    setFetchError(false)
    const today = istToday()

    try {
      const [userRes, subRes, orderRes, upcomingRes] = await Promise.all([
        supabase.from('users').select('name').eq('id', user.id).single(),
        supabase
          .from('subscriptions')
          .select('id, status, deliveries_remaining, plan_name, plans ( meals_total )')
          .eq('user_id', user.id)
          .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('orders')
          .select('id, delivery_date, status, meal_slot, meal_template_id, meal_templates ( name, category, kcal, protein, image_url )')
          .eq('user_id', user.id)
          .eq('delivery_date', today)
          .not('status', 'in', '(cancelled,skipped)'),
        supabase
          .from('orders')
          .select('id, delivery_date, meal_slot, extra_dish, status')
          .eq('user_id', user.id)
          .gte('delivery_date', today)
          .lte('delivery_date', addDaysISO(today, 7))
          .in('status', ['scheduled', 'confirmed'])
          .order('delivery_date'),
      ])

      if (userRes.data?.name) setUserName(userRes.data.name)
      setSubscription((subRes.data as unknown as Subscription) ?? null)

      // A day can have both a lunch and a dinner order — pick whichever slot
      // is "current" right now (matches the same lunch-before-2pm-IST
      // convention subscription.tsx uses for its slot toggle), falling back
      // to whatever exists so the card never blanks out unnecessarily.
      if (orderRes.error) console.warn('[Home] today order fetch error:', orderRes.error.message)
      const rows = (orderRes.data as unknown as Order[]) ?? []
      const preferredSlot = istHour() < 14 ? 'lunch' : 'dinner'
      setTodayOrder(rows.find((r) => r.meal_slot === preferredSlot) ?? rows[0] ?? null)

      setAddTarget(findNextAddTarget((upcomingRes.data as unknown as UpcomingOrder[]) ?? []))
    } catch {
      setFetchError(true)
    }
  }

  useEffect(() => {
    if (authLoading) return
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [user, authLoading])

  // Menu catalogue — public data, fetched once regardless of auth state so
  // guests see category chips + daily picks too.
  useEffect(() => {
    supabase
      .from('meal_templates')
      .select('id, name, category, price, kcal, protein, image_url')
      .eq('is_active', true)
      .then(({ data }) => setMeals((data as Meal[]) ?? []))
  }, [])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [user])

  async function handleQuickAdd() {
    if (!confirmMeal || !addTarget) return
    setAdding(true)
    setAddError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const { data, error } = await supabase.functions.invoke('add-dish', {
        body: { order_id: addTarget.refOrderId, meal_template_id: confirmMeal.id, meal_slot: addTarget.slot },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) throw error
      if (data?.error === 'insufficient_balance') {
        setAddError('Insufficient wallet balance. Add money from My Plan first.')
        return
      }
      if (data?.error) throw new Error(data.error)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      setAddedMealIds((prev) => new Set(prev).add(confirmMeal.id))
      setConfirmMeal(null)
    } catch (e: any) {
      setAddError(e?.message ?? 'Could not add dish. Try again.')
    } finally {
      setAdding(false)
    }
  }

  const hasSubscription = !!subscription

  const todayStr = istToday()
  const seed = seedFromDate(todayStr)
  const picks: Meal[] = []
  if (meals.length > 0) {
    const i0 = seed % meals.length
    picks.push(meals[i0])
    if (meals.length > 1) picks.push(meals[(i0 + 1) % meals.length])
  }
  const chefNote = CHEF_NOTES[seed % CHEF_NOTES.length]

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
          <Logo size={40} />
          <Skeleton width={140} height={13} style={[styles.skeletonHero, { marginTop: 20, marginBottom: 4 }]} />
          <Skeleton width="70%" height={30} style={styles.skeletonHero} />
          <Skeleton width="50%" height={30} style={[styles.skeletonHero, { marginBottom: 12 }]} />
          <Skeleton width="75%" height={14} style={[styles.skeletonHero, { marginBottom: 4 }]} />
          <Skeleton width="55%" height={14} style={styles.skeletonHero} />
          <Skeleton width={160} height={46} borderRadius={999} style={[styles.skeletonHero, { marginTop: 24 }]} />
        </View>
        <View style={styles.section}>
          <Skeleton width={100} height={10} style={{ marginBottom: 16 }} />
          <Skeleton height={96} borderRadius={16} />
        </View>
      </View>
    )
  }

  if (fetchError) {
    return (
      <View style={[styles.container, styles.errorWrap]}>
        <Text style={styles.errorEmoji}>⚠️</Text>
        <Text style={styles.errorTitle}>Couldn't load your feed</Text>
        <Text style={styles.errorDesc}>Check your connection and try again.</Text>
        <TouchableOpacity
          style={styles.retryBtn}
          onPress={() => { setLoading(true); fetchData().finally(() => setLoading(false)) }}
        >
          <RefreshCw size={14} color={Colors.primary} />
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Editorial header (green hero) */}
        <Animated.View entering={FadeInDown.duration(400)} style={[styles.hero, { paddingTop: insets.top + 20 }]}>
          <View style={styles.logoRow}>
            <View style={styles.logoRowLeft}>
              <Logo size={28} />
              <Text style={styles.wordmark}>greenfeast</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.7 }]}
              onPress={() => { setShowNotifications(true); markAllRead() }}
              hitSlop={8}
            >
              <Bell size={20} color="#fff" strokeWidth={1.8} />
              {unreadCount > 0 && <View style={styles.bellBadge} />}
            </Pressable>
          </View>

          {userName ? (
            <Text style={styles.greeting}>{getGreeting(userName)}</Text>
          ) : null}

          <Text style={styles.heroTitle}>Nutrition,{'\n'}considered.</Text>
          <Text style={styles.heroSubtitle}>
            Fresh meals from our Jaipur kitchen to your door — every weekday, before 1 PM.
          </Text>

          <Pressable
            style={({ pressed }) => [styles.heroCta, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(
              !user ? '/(auth)/login' as any
                : hasSubscription ? '/(app)/(tabs)/subscription'
                : '/(onboarding)/health'
            )}
          >
            <Text style={styles.heroCtaText}>{hasSubscription ? 'My plan →' : 'Build your plan →'}</Text>
          </Pressable>
        </Animated.View>

        {/* Today's delivery (subscribers only) — tap through to My Plan */}
        {hasSubscription && (
          <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Leaf size={13} color={Colors.primary} />
              <Text style={styles.sectionLabel}>Today's delivery</Text>
            </View>
            {todayOrder ? (
              <Pressable
                style={({ pressed }) => [styles.todayCard, pressed && { opacity: 0.9 }]}
                onPress={() => router.push('/(app)/(tabs)/subscription')}
              >
                {todayOrder.meal_templates.image_url ? (
                  <Image
                    source={{ uri: todayOrder.meal_templates.image_url }}
                    style={styles.todayImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                ) : (
                  <View style={[styles.todayImage, styles.todayImageFallback]}>
                    <Text style={{ fontSize: 26 }}>{CATEGORY_EMOJIS[todayOrder.meal_templates.category] ?? '🍽️'}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.todayBadge}>
                    <Text style={styles.todayBadgeText}>{STATUS_LABELS[todayOrder.status] ?? todayOrder.status}</Text>
                  </View>
                  <Text style={styles.todayMeal} numberOfLines={1}>{todayOrder.meal_templates.name}</Text>
                  <MacroRow protein={todayOrder.meal_templates.protein} kcal={todayOrder.meal_templates.kcal} size="sm" />
                </View>
                <ChevronRight size={18} color={Colors.textMuted} />
              </Pressable>
            ) : (
              <View style={styles.noDeliveryCard}>
                <Text style={styles.noDeliveryEmoji}>🌿</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.noDeliveryTitle}>
                    {subscription?.status === 'paused' ? 'Subscription paused' : 'No delivery today'}
                  </Text>
                  <Text style={styles.noDeliveryDesc}>
                    {subscription?.status === 'paused'
                      ? 'Your plan is on pause. Resume from My Plan when ready.'
                      : 'Today isn\'t a delivery day. Check My Plan to see your upcoming schedule.'}
                  </Text>
                </View>
              </View>
            )}
          </Animated.View>
        )}

        {/* Deliveries progress ring (subscribers only) */}
        {hasSubscription && !!subscription?.plans?.meals_total && (
          <Animated.View entering={FadeInDown.delay(120).duration(400)} style={[styles.section, styles.ringCard]}>
            <MacroRing
              size={84}
              strokeWidth={9}
              centerValue={String(Math.max(0, subscription.plans.meals_total - subscription.deliveries_remaining))}
              centerLabel={`of ${subscription.plans.meals_total}`}
              segments={[
                { value: Math.max(0, subscription.plans.meals_total - subscription.deliveries_remaining), color: Colors.green700 },
                { value: subscription.deliveries_remaining, color: Colors.border },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.ringTitle}>
                {Math.max(0, subscription.plans.meals_total - subscription.deliveries_remaining)} of {subscription.plans.meals_total} meals enjoyed
              </Text>
              <Text style={styles.ringSub}>{subscription.deliveries_remaining} left on your plan</Text>
            </View>
          </Animated.View>
        )}

        {/* Category deeplinks into Menu */}
        <Animated.View entering={FadeInDown.delay(160).duration(400)} style={styles.section}>
          <View style={styles.sectionLabelRow}>
            <Leaf size={13} color={Colors.primary} />
            <Text style={styles.sectionLabel}>Browse by category</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
            {CATEGORIES.filter((c) => c !== 'All').map((cat) => {
              const catMeal = meals.find((m) => m.category === cat.toLowerCase())
              return (
                <Pressable
                  key={cat}
                  style={({ pressed }) => [styles.categoryItem, pressed && { opacity: 0.8 }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                    router.push(`/(app)/(tabs)/menu?category=${cat}` as any)
                  }}
                >
                  <View style={styles.categoryCircle}>
                    {catMeal?.image_url ? (
                      <Image source={{ uri: catMeal.image_url }} style={styles.categoryImg} contentFit="cover" cachePolicy="memory-disk" />
                    ) : (
                      <Text style={styles.categoryEmoji}>{CATEGORY_EMOJIS[cat.toLowerCase()] ?? '🍽️'}</Text>
                    )}
                  </View>
                  <Text style={styles.categoryLabel}>{cat}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </Animated.View>

        {/* Daily picks — quick-add to next unlocked delivery */}
        {picks.length > 0 && (
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Leaf size={13} color={Colors.primary} />
              <Text style={styles.sectionLabel}>Fresh from the kitchen</Text>
            </View>
            <View style={{ gap: 12 }}>
              {picks.map((meal) => {
                const added = addedMealIds.has(meal.id)
                return (
                  <View key={meal.id} style={styles.pickCard}>
                    {meal.image_url ? (
                      <Image source={{ uri: meal.image_url }} style={styles.pickImage} contentFit="cover" cachePolicy="memory-disk" />
                    ) : (
                      <View style={[styles.pickImage, styles.pickImageFallback]}>
                        <Text style={{ fontSize: 26 }}>{CATEGORY_EMOJIS[meal.category] ?? '🍽️'}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickName} numberOfLines={2}>{meal.name}</Text>
                      {meal.price != null && <Text style={styles.pickPrice}>₹{(meal.price / 100).toFixed(0)}</Text>}
                      <View style={{ marginTop: 4 }}>
                        <MacroRow protein={meal.protein} kcal={meal.kcal} size="sm" />
                      </View>
                    </View>
                    {hasSubscription ? (
                      addTarget && (
                        <Pressable
                          style={[styles.pickAddBtn, added && styles.pickAddBtnDone]}
                          disabled={added}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setConfirmMeal(meal) }}
                        >
                          <Text style={[styles.pickAddText, added && styles.pickAddTextDone]}>{added ? 'Added ✓' : 'Add'}</Text>
                        </Pressable>
                      )
                    ) : (
                      <Pressable style={styles.pickAddBtn} onPress={() => router.push('/(app)/(tabs)/menu')}>
                        <Text style={styles.pickAddText}>See menu</Text>
                      </Pressable>
                    )}
                  </View>
                )
              })}
            </View>
          </Animated.View>
        )}

        {/* Farm-to-fork story carousel — full bleed */}
        <Animated.View entering={FadeInDown.delay(240).duration(400)}>
          <View style={styles.sectionLabelRow2}>
            <Leaf size={13} color={Colors.primary} />
            <Text style={styles.sectionLabel}>The GreenFeast way</Text>
          </View>
          <StoryCarousel slides={STORY_SLIDES} />
        </Animated.View>

        {/* Chef's note */}
        <Animated.View entering={FadeInDown.delay(280).duration(400)} style={styles.section}>
          <View style={styles.chefCard}>
            <Text style={styles.chefEmoji}>🌱</Text>
            <Text style={styles.chefNote}>{chefNote}</Text>
          </View>
        </Animated.View>

        {/* Menu nudge */}
        <Animated.View entering={FadeInDown.delay(320).duration(400)} style={styles.menuNudgeWrap}>
          <Pressable
            style={({ pressed }) => [styles.menuNudge, pressed && { transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push('/(app)/(tabs)/menu')}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.menuNudgeTitle}>Explore this week's menu</Text>
              <Text style={styles.menuNudgeSub}>Power Bowls · Wraps · Salads · Smoothies</Text>
            </View>
            <ArrowRight size={18} color={Colors.accent} />
          </Pressable>
        </Animated.View>

        {/* Refer a friend */}
        <Animated.View entering={FadeInDown.delay(360).duration(400)} style={styles.section}>
          <Pressable
            style={({ pressed }) => [styles.referralCard, pressed && { opacity: 0.9 }]}
            onPress={() => Linking.openURL('https://wa.me/?text=' + encodeURIComponent(REFERRAL_MESSAGE))}
          >
            <Text style={styles.referralEmoji}>🎁</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.referralTitle}>Give a friend their first GreenFeast</Text>
              <Text style={styles.referralSub}>Share on WhatsApp →</Text>
            </View>
          </Pressable>
        </Animated.View>
      </ScrollView>

      {/* Notification history */}
      <Modal visible={showNotifications} transparent animationType="slide" onRequestClose={() => setShowNotifications(false)}>
        <Pressable style={styles.notifOverlay} onPress={() => setShowNotifications(false)}>
          <Pressable style={styles.notifSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.notifHandle} />
            <View style={styles.notifHeader}>
              <Text style={styles.notifTitle}>Notifications</Text>
              <Pressable onPress={() => setShowNotifications(false)} hitSlop={10}>
                <X size={20} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}>
              {notifications.length === 0 ? (
                <View style={styles.notifEmpty}>
                  <Bell size={28} color={Colors.textLight} strokeWidth={1.5} />
                  <Text style={styles.notifEmptyText}>No notifications yet</Text>
                </View>
              ) : (
                notifications.map((n) => {
                  const row = (
                    <View style={styles.notifRow}>
                      <View style={[styles.notifDot, n.read && { opacity: 0 }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.notifRowTitle}>{n.title}</Text>
                        <Text style={styles.notifRowBody}>{n.body}</Text>
                        <Text style={styles.notifRowTime}>{formatRelativeTime(n.createdAt)}</Text>
                      </View>
                      {n.action === 'reload' && (
                        reloading ? (
                          <ActivityIndicator size="small" color={Colors.primary} />
                        ) : (
                          <ChevronRight size={18} color={Colors.primary} />
                        )
                      )}
                    </View>
                  )
                  return n.action === 'reload' ? (
                    <Pressable
                      key={n.id}
                      onPress={handleReloadNow}
                      disabled={reloading}
                      style={({ pressed }) => pressed && { opacity: 0.7 }}
                    >
                      {row}
                    </Pressable>
                  ) : (
                    <View key={n.id}>{row}</View>
                  )
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick-add confirm sheet */}
      <Modal
        visible={!!confirmMeal}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!adding) setConfirmMeal(null) }}
      >
        <Pressable style={styles.confirmOverlay} onPress={() => !adding && setConfirmMeal(null)}>
          <Pressable style={styles.confirmCard} onPress={(e) => e.stopPropagation()}>
            {confirmMeal && addTarget && (
              <>
                <Text style={styles.confirmTitle}>Add {confirmMeal.name}?</Text>
                <Text style={styles.confirmBody}>
                  To {fmtDayLabel(addTarget.date)}'s {addTarget.slot}
                  {confirmMeal.price != null ? ` · ₹${(confirmMeal.price / 100).toFixed(0)}` : ''}
                </Text>
                <Text style={styles.confirmNote}>
                  Billed from your wallet on delivery. Removable from My Plan until 8 PM the evening before.
                </Text>
                {addError ? <Text style={styles.confirmError}>{addError}</Text> : null}
                <View style={styles.confirmBtnRow}>
                  <Pressable style={[styles.confirmBtn, styles.confirmBtnGhost]} onPress={() => setConfirmMeal(null)} disabled={adding}>
                    <Text style={styles.confirmBtnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.confirmBtn} onPress={handleQuickAdd} disabled={adding}>
                    {adding ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmBtnText}>Add dish</Text>}
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  skeletonHero: { marginBottom: 8 },

  // Error state
  errorWrap: { justifyContent: 'center', alignItems: 'center', padding: 32 },
  errorEmoji: { fontSize: 40, marginBottom: 12 },
  errorTitle: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.text, textAlign: 'center', marginBottom: 6 },
  errorDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginBottom: 20 },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  retryText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },

  // No delivery today card
  noDeliveryCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noDeliveryEmoji: { fontSize: 24, marginTop: 2 },
  noDeliveryTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 4 },
  noDeliveryDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 19 },

  hero: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    backgroundColor: Colors.green700,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  logoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  wordmark: {
    fontFamily: Fonts.headingSemi,
    fontSize: 17,
    color: '#fff',
    letterSpacing: -0.3,
  },
  bellBtn: { padding: 4 },
  bellBadge: {
    position: 'absolute', top: 2, right: 2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.danger, borderWidth: 1.5, borderColor: Colors.green700,
  },
  greeting: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.green100, marginBottom: 6 },
  heroTitle: { fontFamily: Fonts.heading, fontSize: 40, color: '#fff', lineHeight: 46, marginBottom: 12 },
  heroSubtitle: { fontFamily: Fonts.body, fontSize: 15, color: Colors.green100, lineHeight: 22, marginBottom: 24 },
  heroCta: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
  },
  heroCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.green900 },

  section: { paddingHorizontal: 16, paddingTop: 24 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  sectionLabelRow2: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingTop: 24, marginBottom: 16 },
  sectionLabel: {
    fontFamily: Fonts.bodySemi,
    fontSize: 10,
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  todayCard: {
    backgroundColor: Colors.cream100,
    borderRadius: 20,
    padding: 14,
    borderWidth: 2,
    borderColor: Colors.green700,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  todayImage: { width: 64, height: 64, borderRadius: 14, backgroundColor: Colors.cream300 },
  todayImageFallback: { alignItems: 'center', justifyContent: 'center' },
  todayBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.green50,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  todayBadgeText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.green700, textTransform: 'uppercase', letterSpacing: 0.8 },
  todayMeal: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.ink900, marginBottom: 4 },

  ringCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ringTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: Colors.ink900, lineHeight: 20, marginBottom: 4 },
  ringSub: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500 },

  categoryRow: { gap: 18, paddingRight: 16 },
  categoryItem: { alignItems: 'center', width: 72 },
  categoryCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.cream200,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  categoryImg: { width: '100%', height: '100%' },
  categoryEmoji: { fontSize: 26 },
  categoryLabel: { fontFamily: Fonts.bodyMed, fontSize: 12, color: Colors.ink600, marginTop: 6, textAlign: 'center' },

  pickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: Colors.cream300 },
  pickImageFallback: { alignItems: 'center', justifyContent: 'center' },
  pickName: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.ink900, lineHeight: 19, marginBottom: 2 },
  pickPrice: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.green700 },
  pickAddBtn: {
    backgroundColor: Colors.green700,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  pickAddBtnDone: { backgroundColor: Colors.cream300 },
  pickAddText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#fff' },
  pickAddTextDone: { color: Colors.ink500 },

  chefCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.cream200,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  chefEmoji: { fontSize: 20, marginTop: 2 },
  chefNote: { flex: 1, fontFamily: Fonts.script, fontSize: 19, color: Colors.ink600, lineHeight: 25 },

  menuNudgeWrap: { paddingHorizontal: 16, paddingTop: 16 },
  menuNudge: {
    backgroundColor: Colors.green900,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuNudgeTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: '#fff' },
  menuNudgeSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.green200, marginTop: 2 },

  referralCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.cream100,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  referralEmoji: { fontSize: 28 },
  referralTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.ink900, marginBottom: 2 },
  referralSub: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.green700 },

  // Notification history
  notifOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  notifSheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    maxHeight: '75%', paddingHorizontal: 20, paddingTop: 12, flex: 1,
  },
  notifHandle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  notifHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  notifTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text },
  notifEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 },
  notifEmptyText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textLight },
  notifRow: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  notifDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6 },
  notifRowTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  notifRowBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 2, lineHeight: 18 },
  notifRowTime: { fontFamily: Fonts.body, fontSize: 11, color: Colors.textLight, marginTop: 4 },

  // Quick-add confirm sheet
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  confirmCard: { backgroundColor: '#fff', borderRadius: 24, padding: 24, width: '100%', maxWidth: 340 },
  confirmTitle: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.ink900, marginBottom: 8 },
  confirmBody: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.ink600, marginBottom: 10 },
  confirmNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500, lineHeight: 17 },
  confirmError: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 8 },
  confirmBtnRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  confirmBtn: {
    flex: 1, backgroundColor: Colors.green700, borderRadius: 999,
    paddingVertical: 13, alignItems: 'center', justifyContent: 'center', minHeight: 46,
  },
  confirmBtnGhost: { backgroundColor: Colors.cream200 },
  confirmBtnText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },
  confirmBtnGhostText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink600 },
})
