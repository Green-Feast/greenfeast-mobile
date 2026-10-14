import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, ArrowRight } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import { istToday, addDaysISO, dowMon0 } from '@/lib/ist'
import MealDetailModal, { type MealDetail } from '@/components/MealDetailModal'

// This week's subscriber menu — the weekly_menu rotation every plan follows
// (one menu since migration 052), one card per day like the menu card the
// team shares on WhatsApp. Opens from Home ("Explore this week's menu") and
// the calendar icon on My Plan. Works signed out too (weekly_menu is public).

type Dish = MealDetail & { short_description: string | null }
type Row = { day_of_week: number; meal_slot: 'lunch' | 'dinner'; meal_templates: Dish | null }
type Day = { dow: number; date: string; lunch: Dish | null; dinner: Dish | null }

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function shortDate(iso: string) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function macros(d: Dish) {
  return [
    d.kcal ? `${d.kcal} kcal` : null,
    d.protein ? `${Math.round(Number(d.protein))}g protein` : null,
    d.fibre ? `${Math.round(Number(d.fibre))}g fibre` : null,
  ].filter(Boolean).join('  •  ')
}

export default function WeeklyMenuScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, hasSubscription } = useAuthStore()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [detail, setDetail] = useState<MealDetail | null>(null)

  const today = istToday()
  const monday = addDaysISO(today, -dowMon0(today))

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('weekly_menu')
      .select('day_of_week, meal_slot, meal_templates ( id, name, category, description, short_description, price, kcal, protein, carbs, fat, fibre, tags, image_url, thumb_url, blur_data_url )')
      .eq('menu_type', 'M1')
      .order('day_of_week')
    if (data) setRows(data as unknown as Row[])
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const days: Day[] = useMemo(() => {
    const out: Day[] = []
    for (let dow = 0; dow < 7; dow++) {
      const lunch = rows.find((r) => r.day_of_week === dow && r.meal_slot === 'lunch')?.meal_templates ?? null
      const dinner = rows.find((r) => r.day_of_week === dow && r.meal_slot === 'dinner')?.meal_templates ?? null
      if (lunch || dinner) out.push({ dow, date: addDaysISO(monday, dow), lunch, dinner })
    }
    return out
  }, [rows, monday])

  const first = days[0]
  const last = days[days.length - 1]

  return (
    <View style={st.container}>
      <View style={[st.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={st.backBtn}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text style={st.topBarTitle}>This week's menu</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {first && last && (
          <Text style={st.subtitle}>
            {shortDate(first.date)} – {shortDate(last.date)} · the subscribers' menu, lunch and dinner
          </Text>
        )}

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 48 }} />
        ) : days.length === 0 ? (
          <Text style={st.empty}>This week's menu is on its way — check back soon.</Text>
        ) : (
          days.map((d) => {
            const isToday = d.date === today
            const past = d.date < today
            const same = !d.lunch || !d.dinner || d.lunch.id === d.dinner.id
            const dishes: { label: string | null; dish: Dish }[] = same
              ? [{ label: null, dish: (d.lunch ?? d.dinner)! }]
              : [{ label: 'Lunch', dish: d.lunch! }, { label: 'Dinner', dish: d.dinner! }]
            return (
              <View key={d.dow} style={[st.card, isToday && st.cardToday, past && { opacity: 0.6 }]}>
                <View style={st.cardHead}>
                  <Text style={st.dayLabel}>{DAY[d.dow]} · {shortDate(d.date)}</Text>
                  {isToday && <View style={st.todayPill}><Text style={st.todayText}>Today</Text></View>}
                </View>
                {dishes.map(({ label, dish }) => (
                  <Pressable
                    key={(label ?? '') + dish.id}
                    onPress={() => setDetail(dish)}
                    style={({ pressed }) => [st.dishRow, pressed && { opacity: 0.75 }]}
                  >
                    <View style={{ flex: 1 }}>
                      {label && <Text style={st.slotLabel}>{label}</Text>}
                      <Text style={st.dishName}>{dish.name}</Text>
                      {(dish.short_description || dish.description) ? (
                        <Text style={st.dishDesc}>{dish.description || dish.short_description}</Text>
                      ) : null}
                      {macros(dish) ? <Text style={st.macros}>{macros(dish)}</Text> : null}
                    </View>
                    {(dish.thumb_url || dish.image_url) ? (
                      <Image
                        source={{ uri: (dish.thumb_url || dish.image_url)! }}
                        placeholder={dish.blur_data_url ? { uri: dish.blur_data_url } : undefined}
                        style={st.thumb}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    ) : null}
                  </Pressable>
                ))}
              </View>
            )
          })
        )}

        {!loading && days.length > 0 && (
          <Pressable
            style={({ pressed }) => [st.cta, pressed && { opacity: 0.85 }]}
            onPress={() => router.push(
              hasSubscription ? '/(app)/(tabs)/subscription' : user ? '/(onboarding)/health' : '/(auth)/login' as any
            )}
          >
            <Text style={st.ctaText}>
              {hasSubscription ? 'Want something else on a day? Swap it in My Plan' : 'Get these delivered — start a plan'}
            </Text>
            <ArrowRight size={16} color="#fff" />
          </Pressable>
        )}
      </ScrollView>

      <MealDetailModal meal={detail} onClose={() => setDetail(null)} />
    </View>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  backBtn: { padding: 4 },
  topBarTitle: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.text },
  subtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 14, marginLeft: 2 },
  empty: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 48 },

  card: {
    backgroundColor: Colors.primaryLight, borderRadius: 18, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  cardToday: { borderColor: Colors.primary, borderWidth: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  dayLabel: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  todayPill: { backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  todayText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: '#fff' },
  dishRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 6 },
  slotLabel: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase', marginBottom: 2 },
  dishName: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.text },
  dishDesc: { fontFamily: Fonts.body, fontSize: 13, color: Colors.text, marginTop: 4, lineHeight: 19 },
  macros: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, marginTop: 8 },
  thumb: { width: 72, height: 72, borderRadius: 14 },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, marginTop: 8,
  },
  ctaText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },
})
