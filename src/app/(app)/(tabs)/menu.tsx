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
  Modal,
  ScrollView,
  Dimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import Skeleton from '@/components/Skeleton'

const { width } = Dimensions.get('window')
const CARD_WIDTH = (width - 48) / 2

type Meal = {
  id: string
  name: string
  category: string
  description: string | null
  price: number | null
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  tags: string[]
  image_url: string | null
}

const CATEGORIES = ['All', 'Bowl', 'Wrap', 'Salad', 'Toast', 'Smoothie']
const CATEGORY_EMOJIS: Record<string, string> = {
  bowl: '🥗', wrap: '🌯', salad: '🥙', toast: '🍞', smoothie: '🥤',
}

function formatPrice(paise: number | null) {
  if (paise == null) return ''
  return `₹${(paise / 100).toFixed(0)}`
}

export default function MenuScreen() {
  const insets = useSafeAreaInsets()
  const authLoading = useAuthStore((s) => s.loading)
  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('All')
  const [selected, setSelected] = useState<Meal | null>(null)

  useEffect(() => {
    if (authLoading) return
    ;(async () => {
      try {
        const { data } = await supabase
          .from('meal_templates')
          .select('id, name, category, description, price, kcal, protein, carbs, fat, tags, image_url')
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
            {[0, 1].map((i) => <Skeleton key={i} width={CARD_WIDTH} height={170} borderRadius={16} />)}
          </View>
          <View style={[styles.row, { marginTop: 12 }]}>
            {[0, 1].map((i) => <Skeleton key={i} width={CARD_WIDTH} height={170} borderRadius={16} />)}
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
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => setSelected(item)}
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
              <Text style={styles.cardName} numberOfLines={2}>{item.name}</Text>
              {item.price != null && <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>}
              {item.tags?.length > 0 && (
                <View style={styles.tagRow}>
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>{item.tags[0]}</Text>
                  </View>
                </View>
              )}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No meals in this category yet.</Text>
            </View>
          }
        />
      )}

      {/* Detail modal */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.modalClose} onPress={() => setSelected(null)} hitSlop={8}>
              <X size={20} color={Colors.textMuted} />
            </Pressable>

            {selected && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {selected.image_url && (
                  <Image
                    source={{ uri: selected.image_url }}
                    style={styles.modalImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                )}
                <Text style={styles.modalName}>{selected.name}</Text>
                <Text style={styles.modalCategory}>{selected.category}</Text>

                {selected.description ? <Text style={styles.modalDesc}>{selected.description}</Text> : null}

                <View style={styles.macrosRow}>
                  {selected.kcal != null && <Macro value={`${selected.kcal}`} label="kcal" />}
                  {selected.protein != null && <Macro value={`${selected.protein}g`} label="protein" />}
                  {selected.carbs != null && <Macro value={`${selected.carbs}g`} label="carbs" />}
                  {selected.fat != null && <Macro value={`${selected.fat}g`} label="fat" />}
                </View>

                {selected.tags?.length > 0 && (
                  <View style={styles.tagsWrap}>
                    {selected.tags.map((tag) => (
                      <View key={tag} style={styles.tagYellow}>
                        <Text style={styles.tagYellowText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function Macro({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.macroBox}>
      <Text style={styles.macroVal}>{value}</Text>
      <Text style={styles.macroLbl}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 12 },

  tabs: { gap: 8, paddingRight: 16, paddingVertical: 2 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  tabTextActive: { color: '#fff' },

  grid: { padding: 16, paddingBottom: 32 },
  row: { gap: 12, marginBottom: 12 },
  card: {
    width: CARD_WIDTH,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardPressed: { transform: [{ scale: 0.97 }] },
  cardImage: { width: '100%', height: 110, borderRadius: 10, marginBottom: 8, backgroundColor: Colors.primaryLight },
  cardEmoji: {
    width: '100%',
    height: 110,
    borderRadius: 10,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emojiText: { fontSize: 40 },
  cardName: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text, marginBottom: 4, lineHeight: 18 },
  cardPrice: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary, marginBottom: 6 },
  tagRow: { flexDirection: 'row' },
  tag: { backgroundColor: Colors.primaryLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.primary },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.body, color: Colors.textMuted, fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 48,
    maxHeight: '85%',
    gap: 10,
  },
  modalClose: { alignSelf: 'flex-end', padding: 4 },
  modalImage: { width: '100%', height: 200, borderRadius: 16, marginBottom: 8, backgroundColor: Colors.primaryLight },
  modalName: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.text },
  modalCategory: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textTransform: 'capitalize', marginTop: -4 },
  modalDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginTop: 6 },
  macrosRow: { flexDirection: 'row', gap: 10, marginVertical: 8 },
  macroBox: { flex: 1, backgroundColor: Colors.primaryLight, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  macroVal: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.primary },
  macroLbl: { fontFamily: Fonts.body, fontSize: 11, color: Colors.primary },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tagYellow: { backgroundColor: Colors.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagYellowText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.text },
})
