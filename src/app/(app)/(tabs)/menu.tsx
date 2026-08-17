// Full menu browse — 2-column image-card grid matching the onboarding
// "Explore our menu" aesthetic. Category pills live in a fixed header so they
// never get clipped, and images are cached via expo-image.
import { useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { ExternalLink, MapPin, CalendarPlus } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { istToday } from '@/lib/ist'
import { useAuthStore } from '@/store/auth'
import { useAvailabilityStore, isMealAvailable } from '@/store/availability'
import { Colors, Fonts } from '@/constants/colors'
import { SWIGGY_URL, ZOMATO_URL, KITCHEN_MAPS_URL, isConfigured } from '@/constants/links'
import { CATEGORIES, CATEGORY_EMOJIS } from '@/constants/categories'
import Skeleton from '@/components/Skeleton'
import AddToDaySheet from '@/components/AddToDaySheet'
import MealDetailModal, { type MealDetail } from '@/components/MealDetailModal'
import * as Haptics from 'expo-haptics'

export { CATEGORIES, CATEGORY_EMOJIS }

// short_description is card-only — the detail modal keeps showing the full
// description, where the longer ingredient lists are genuinely useful.
type Meal = MealDetail & { short_description: string | null }

function formatPrice(paise: number | null) {
  if (paise == null) return ''
  return `₹${(paise / 100).toFixed(0)}`
}

export default function MenuScreen() {
  const insets = useSafeAreaInsets()
  const authLoading = useAuthStore((s) => s.loading)
  const params = useLocalSearchParams<{ category?: string }>()
  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('All')
  const [selected, setSelected] = useState<Meal | null>(null)
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const today = istToday()
  const unavailableMeals = useAvailabilityStore((s) => s.unavailableMeals)
  const ensureFreshAvailability = useAvailabilityStore((s) => s.ensureFresh)

  // Category deeplink from Home (e.g. /(app)/(tabs)/menu?category=Bowl).
  useEffect(() => {
    if (!params.category) return
    const match = CATEGORIES.find((c) => c.toLowerCase() === params.category!.toLowerCase())
    if (match) setActiveCategory(match)
  }, [params.category])

  useEffect(() => {
    ensureFreshAvailability()
  }, [ensureFreshAvailability])

  useEffect(() => {
    if (authLoading) return
    ;(async () => {
      try {
        const { data } = await supabase
          .from('meal_templates')
          .select('id, name, category, description, short_description, price, kcal, protein, carbs, fat, tags, image_url')
          .eq('is_active', true)
          .order('category')
        const list = (data ?? []) as Meal[]
        setMeals(list)
        // Warm the image cache so cards render instantly on re-entry.
        Image.prefetch(list.map((m) => m.image_url).filter(Boolean) as string[])
      } catch {
        // transient/network — leave the list empty rather than spinning forever
      } finally {
        setLoading(false)
      }
    })()
  }, [authLoading])

  const filtered =
    activeCategory === 'All' ? meals : meals.filter((m) => m.category === activeCategory.toLowerCase())

  return (
    <View style={styles.container}>
      {/* Fixed header + category pills */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Our Menu</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {CATEGORIES.map((cat) => {
            const active = activeCategory === cat
            return (
              <Pressable
                key={cat}
                style={[styles.tab, active && styles.tabActive]}
                onPress={() => setActiveCategory(cat)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{cat}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.grid}>
          <View style={styles.row}>
            {[0, 1].map((i) => <Skeleton key={i} width="48%" height={170} borderRadius={16} />)}
          </View>
          <View style={[styles.row, { marginTop: 12 }]}>
            {[0, 1].map((i) => <Skeleton key={i} width="48%" height={170} borderRadius={16} />)}
          </View>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            // Greyed but still tappable — the detail view still opens, only
            // the "Add to day" CTA gets disabled there. A card that vanishes
            // or stops responding entirely reads as a broken app, not an
            // unavailable dish.
            const available = isMealAvailable({ unavailableMeals }, today, item.id)
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed, !available && styles.cardUnavailable]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                  setSelected(item)
                }}
              >
                {item.image_url ? (
                  <Image
                    source={{ uri: item.image_url }}
                    style={styles.cardImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={150}
                  />
                ) : (
                  <View style={styles.cardEmoji}>
                    <Text style={styles.emojiText}>{CATEGORY_EMOJIS[item.category] ?? '🍽️'}</Text>
                  </View>
                )}
                {!available && (
                  <View style={styles.cardUnavailablePill}>
                    <Text style={styles.cardUnavailablePillText}>Not available today</Text>
                  </View>
                )}
                <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
                {item.price != null && <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>}
                <Text style={styles.cardDesc} numberOfLines={2}>
                  {item.short_description ?? item.description ?? ''}
                </Text>
              </Pressable>
            )
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No meals in this category yet.</Text>
            </View>
          }
          ListFooterComponent={
            (isConfigured(SWIGGY_URL) || isConfigured(ZOMATO_URL) || isConfigured(KITCHEN_MAPS_URL)) ? (
              <View style={styles.craveWrap}>
                <Text style={styles.craveTitle}>Craving it right now?</Text>
                <View style={styles.craveRow}>
                  {isConfigured(SWIGGY_URL) && (
                    <Pressable style={[styles.craveBtn, { backgroundColor: '#FC8019' }]} onPress={() => Linking.openURL(SWIGGY_URL)}>
                      <ExternalLink size={14} color="#fff" />
                      <Text style={styles.craveBtnText}>Swiggy</Text>
                    </Pressable>
                  )}
                  {isConfigured(ZOMATO_URL) && (
                    <Pressable style={[styles.craveBtn, { backgroundColor: '#E23744' }]} onPress={() => Linking.openURL(ZOMATO_URL)}>
                      <ExternalLink size={14} color="#fff" />
                      <Text style={styles.craveBtnText}>Zomato</Text>
                    </Pressable>
                  )}
                  {isConfigured(KITCHEN_MAPS_URL) && (
                    <Pressable style={[styles.craveBtn, styles.craveBtnGhost]} onPress={() => Linking.openURL(KITCHEN_MAPS_URL)}>
                      <MapPin size={14} color={Colors.green700} />
                      <Text style={[styles.craveBtnText, styles.craveBtnGhostText]}>Takeaway</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ) : null
          }
        />
      )}

      <MealDetailModal
        meal={selected}
        onClose={() => setSelected(null)}
        unavailableReason={
          selected && !isMealAvailable({ unavailableMeals }, today, selected.id) ? 'Not available today' : null
        }
        primaryAction={{
          label: 'Add to day',
          icon: <CalendarPlus size={17} color="#fff" />,
          onPress: () => setAddSheetOpen(true),
          disabled: selected ? !isMealAvailable({ unavailableMeals }, today, selected.id) : false,
        }}
      />

      {selected && (
        <AddToDaySheet
          visible={addSheetOpen}
          onClose={() => setAddSheetOpen(false)}
          meal={{ id: selected.id, name: selected.name }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.ink900, marginBottom: 12 },

  tabs: { gap: 8, paddingRight: 16, paddingVertical: 2 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.cream50,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.green700, borderColor: Colors.green700 },
  tabText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.ink500 },
  tabTextActive: { color: '#fff' },

  grid: { padding: 16, paddingBottom: 32 },
  row: { gap: 12, marginBottom: 12 },
  card: {
    flex: 1,
    // Caps a lone odd-count last-row card at half width instead of
    // stretching to fill the row — pure flex/CSS, no Dimensions/
    // useWindowDimensions subscription needed, so it's correct on rotation
    // and foldables for free (module-scope Dimensions.get('window') was the
    // old bug here: captured once at import, never updated).
    maxWidth: '48%',
    backgroundColor: Colors.cream200,
    borderRadius: 20,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  cardPressed: { transform: [{ scale: 0.97 }] },
  cardUnavailable: { opacity: 0.55 },
  cardImage: { width: '100%', height: 110, borderRadius: 12, backgroundColor: Colors.cream300 },
  cardUnavailablePill: {
    position: 'absolute', top: 20, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, alignItems: 'center',
  },
  cardUnavailablePillText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: '#fff' },
  cardEmoji: {
    width: '100%',
    height: 110,
    borderRadius: 12,
    backgroundColor: Colors.cream300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiText: { fontSize: 40 },
  cardName: { fontFamily: Fonts.heading, fontSize: 15, color: Colors.ink900, lineHeight: 19 },
  cardPrice: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.green700 },
  // minHeight reserves 2 lines always — cardName is already numberOfLines={2}
  // (so its own height already varies by up to 1 line), and a variable-height
  // description on top of that would leave ragged FlatList rows.
  cardDesc: { fontFamily: Fonts.body, fontSize: 12, lineHeight: 16, color: Colors.ink500, minHeight: 32 },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.body, color: Colors.ink500, fontSize: 14 },

  craveWrap: { marginTop: 8, marginBottom: 16, alignItems: 'center' },
  craveTitle: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.ink500, marginBottom: 12 },
  craveRow: { flexDirection: 'row', gap: 10 },
  craveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999,
  },
  craveBtnGhost: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.green700 },
  craveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#fff' },
  craveBtnGhostText: { color: Colors.green700 },
})
