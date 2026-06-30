import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ArrowRight, Leaf, RefreshCw } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
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

export default function Home() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuthStore()
  const [userName, setUserName] = useState('')
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [todayOrder, setTodayOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)

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
    setLoading(true)
    fetchData().finally(() => setLoading(false))
  }, [user])

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
        {/* Hero */}
        <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
          {/* subtle yellow glow accents */}
          <View style={[styles.glow, { top: 30, left: -40 }]} />
          <View style={[styles.glow, { top: -20, right: -30, width: 140, height: 140 }]} />

          <Logo size={40} />

          {userName ? <Text style={styles.greeting}>{getGreeting(userName)}</Text> : null}

          <Text style={styles.heroTitle}>Nutrition,{'\n'}considered.</Text>
          <Text style={styles.heroSubtitle}>
            Fresh meals from our Jaipur kitchen to your door — every weekday, before 1 PM.
          </Text>

          <Pressable
            style={({ pressed }) => [styles.heroCta, pressed && { transform: [{ scale: 0.97 }] }]}
            onPress={() => router.push(hasSubscription ? '/(app)/(tabs)/subscription' : '/(onboarding)/health')}
          >
            <Text style={styles.heroCtaText}>{hasSubscription ? 'My plan' : 'Build your plan'}</Text>
            <ArrowRight size={15} color={Colors.text} strokeWidth={2.5} />
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
                <View style={styles.todayCardLeft}>
                  <Text style={styles.todayMeal}>{todayOrder.meal_templates.name}</Text>
                  <Text style={styles.todayMeta}>
                    {todayOrder.meal_templates.kcal ? `${todayOrder.meal_templates.kcal} kcal` : ''}
                    {todayOrder.meal_templates.protein ? ` · ${todayOrder.meal_templates.protein}g protein` : ''}
                  </Text>
                  <View style={styles.todayBadge}>
                    <Text style={styles.todayBadgeText}>{STATUS_LABELS[todayOrder.status] ?? todayOrder.status}</Text>
                  </View>
                </View>
              </View>
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
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Skeleton in hero needs a semi-transparent white tint
  skeletonHero: { backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 8 },

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
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingBottom: 40,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    opacity: 0.06,
  },
  greeting: { fontFamily: Fonts.bodyMed, fontSize: 14, color: Colors.primaryMid, marginTop: 20, marginBottom: 4 },
  heroTitle: { fontFamily: Fonts.heading, fontSize: 32, color: '#fff', lineHeight: 38, marginBottom: 12 },
  heroSubtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.primaryMid, lineHeight: 21, maxWidth: 280 },
  heroCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: Colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: 999,
    marginTop: 24,
  },
  heroCtaText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },

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
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  todayCardLeft: { gap: 6 },
  todayMeal: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.text },
  todayMeta: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  todayBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 4,
  },
  todayBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },

  storyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    flexDirection: 'row',
    gap: 16,
  },
  storyEmoji: { fontSize: 24, marginTop: 2 },
  storyHeadline: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 4 },
  storyBody: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, lineHeight: 18 },

  menuNudgeWrap: { paddingHorizontal: 16, paddingTop: 16 },
  menuNudge: {
    backgroundColor: Colors.forest,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuNudgeTitle: { fontFamily: Fonts.bodyBold, fontSize: 14, color: '#fff' },
  menuNudgeSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.primaryMid, marginTop: 2 },
})
