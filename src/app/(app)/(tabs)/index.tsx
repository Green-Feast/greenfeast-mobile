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
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ArrowRight, Leaf, RefreshCw, Bell, X } from 'lucide-react-native'
import MacroRow from '@/components/MacroRow'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { useNotificationStore } from '@/store/notifications'
import { Colors, Fonts } from '@/constants/colors'
import Logo from '@/components/Logo'
import Skeleton from '@/components/Skeleton'

type Order = {
  id: string
  delivery_date: string
  status: string
  meal_slot: string
  meal_templates: { name: string; category: string; kcal: number | null; protein: number | null }
}

type Subscription = {
  id: string
  status: string
  deliveries_remaining: number
  plan_name: string | null
}

const STORY_CARDS = [
  {
    emoji: '🌿',
    headline: 'Made this morning.',
    body: "Every meal is prepared fresh in our Jaipur kitchen — no cold storage, no shortcuts. By the time it reaches you, it's been in the world for less than 4 hours.",
  },
  {
    emoji: '⚖️',
    headline: 'Nutrition, considered.',
    body: "We obsess over macro balance so you don't have to. Each bowl is crafted to fuel your goals — whether that's more energy, a leaner build, or simply eating cleaner.",
  },
  {
    emoji: '📅',
    headline: 'Consistency is the meal.',
    body: 'One great day of eating is luck. 20 days in a row is a habit. A GreenFeast subscription makes the healthy choice the effortless one — day after day.',
  },
  {
    emoji: '🫙',
    headline: 'Nothing hidden inside.',
    body: 'No preservatives. No artificial colour. No mystery ingredients. Real vegetables, real grains, real protein — tasted and tracked by people who care.',
  },
]

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

export default function Home() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, loading: authLoading } = useAuthStore()
  const [userName, setUserName] = useState('')
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [todayOrder, setTodayOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const notifications = useNotificationStore((s) => s.notifications)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const unreadCount = notifications.filter((n) => !n.read).length

  async function fetchData() {
    if (!user) return
    setFetchError(false)
    const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0]

    try {
      const [userRes, subRes, orderRes] = await Promise.all([
        supabase.from('users').select('name').eq('id', user.id).single(),
        supabase
          .from('subscriptions')
          .select('id, status, deliveries_remaining, plan_name')
          .eq('user_id', user.id)
          .or('status.eq.active,status.eq.paused,and(status.eq.pending,payment_method.eq.cod)')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('orders')
          .select('id, delivery_date, status, meal_slot, meal_template_id, meal_templates ( name, category, kcal, protein )')
          .eq('user_id', user.id)
          .eq('delivery_date', today)
          .not('status', 'in', '(cancelled,skipped)')
          .maybeSingle(),
      ])

      if (userRes.data?.name) setUserName(userRes.data.name)
      setSubscription((subRes.data as Subscription) ?? null)
      setTodayOrder((orderRes.data as unknown as Order) ?? null)
    } catch {
      setFetchError(true)
    }
  }

  useEffect(() => {
    if (authLoading) return
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [user, authLoading])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchData()
    setRefreshing(false)
  }, [user])

  const hasSubscription = !!subscription

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
        {/* Editorial header (cream canvas) */}
        <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
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
              <Bell size={20} color={Colors.text} strokeWidth={1.8} />
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
        </View>

        {/* Today's delivery (subscribers only) */}
        {hasSubscription && (
          <View style={styles.section}>
            <View style={styles.sectionLabelRow}>
              <Leaf size={13} color={Colors.primary} />
              <Text style={styles.sectionLabel}>Today's delivery</Text>
            </View>
            {todayOrder ? (
              <View style={styles.todayCard}>
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText}>{STATUS_LABELS[todayOrder.status] ?? todayOrder.status}</Text>
                </View>
                <Text style={styles.todayMeal}>{todayOrder.meal_templates.name}</Text>
                <MacroRow
                  protein={todayOrder.meal_templates.protein}
                  kcal={todayOrder.meal_templates.kcal}
                  size="sm"
                /></View>
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
          </View>
        )}

        {/* Story strip */}
        <View style={styles.section}>
          <View style={styles.sectionLabelRow}>
            <Leaf size={13} color={Colors.primary} />
            <Text style={styles.sectionLabel}>The GreenFeast way</Text>
          </View>

          <View style={{ gap: 12 }}>
            {STORY_CARDS.map((card, i) => (
              <View key={i} style={styles.storyCard}>
                <Text style={styles.storyEmoji}>{card.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.storyHeadline}>{card.headline}</Text>
                  <Text style={styles.storyBody}>{card.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Menu nudge */}
        <View style={styles.menuNudgeWrap}>
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
        </View>
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
                notifications.map((n) => (
                  <View key={n.id} style={styles.notifRow}>
                    <View style={[styles.notifDot, n.read && { opacity: 0 }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.notifRowTitle}>{n.title}</Text>
                      <Text style={styles.notifRowBody}>{n.body}</Text>
                      <Text style={styles.notifRowTime}>{formatRelativeTime(n.createdAt)}</Text>
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
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
    color: Colors.green700,
    letterSpacing: -0.3,
  },
  bellBtn: { padding: 4 },
  bellBadge: {
    position: 'absolute', top: 2, right: 2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.danger, borderWidth: 1.5, borderColor: Colors.background,
  },
  greeting: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.ink400, marginBottom: 6 },
  heroTitle: { fontFamily: Fonts.heading, fontSize: 40, color: Colors.ink900, lineHeight: 46, marginBottom: 12 },
  heroSubtitle: { fontFamily: Fonts.body, fontSize: 15, color: Colors.ink500, lineHeight: 22, marginBottom: 24 },
  heroCta: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.green900,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
  },
  heroCtaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },

  section: { paddingHorizontal: 16, paddingTop: 24 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
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
    padding: 18,
    borderWidth: 2,
    borderColor: Colors.green700,
    gap: 8,
  },
  todayBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.green50,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  todayBadgeText: { fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.green700, textTransform: 'uppercase', letterSpacing: 0.8 },
  todayMeal: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.ink900 },

  storyCard: {
    backgroundColor: Colors.cream200,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
  },
  storyEmoji: { fontSize: 22, marginTop: 2 },
  storyHeadline: { fontFamily: Fonts.heading, fontSize: 16, color: Colors.ink900, marginBottom: 6 },
  storyBody: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, lineHeight: 19 },

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
})
