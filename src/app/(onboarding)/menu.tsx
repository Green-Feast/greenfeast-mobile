import { useState, useEffect } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { Colors } from '@/constants/colors'

const { width } = Dimensions.get('window')
const CARD_WIDTH = (width - 48) / 2

type Meal = {
  id: string
  name: string
  category: string
  description: string
  price: number
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  tags: string[]
  image_url?: string | null
}

const CATEGORIES = [
  { label: 'All', value: 'all' },
  { label: 'Bowls', value: 'bowl' },
  { label: 'Wraps', value: 'wrap' },
  { label: 'Salads', value: 'salad' },
  { label: 'Toasts', value: 'toast' },
  { label: 'Smoothies', value: 'smoothie' },
]

const CATEGORY_EMOJIS: Record<string, string> = {
  bowl: '🥗',
  wrap: '🌯',
  salad: '🥙',
  toast: '🍞',
  smoothie: '🥤',
}

function formatPrice(paise: number) {
  return `₹${(paise / 100).toFixed(0)}`
}

export default function MenuScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('all')
  const [selected, setSelected] = useState<Meal | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const { data } = await supabase
          .from('meal_templates')
          .select('*')
          .eq('is_active', true)
        setMeals(data ?? [])
      } catch {
        // transient/network — stop the spinner regardless
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filtered = activeCategory === 'all'
    ? meals
    : meals.filter((m) => m.category === activeCategory)

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Explore our menu</Text>
        <Text style={styles.subtitle}>Fresh, nutritious meals made daily</Text>
      </View>

      {/* Category tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat.value}
            style={[styles.tab, activeCategory === cat.value && styles.tabActive]}
            onPress={() => setActiveCategory(cat.value)}
          >
            <Text style={[styles.tabText, activeCategory === cat.value && styles.tabTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Meal grid */}
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={Colors.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => setSelected(item)}>
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
              <Text style={styles.cardPrice}>{formatPrice(item.price)}</Text>
              {item.tags.length > 0 && (
                <View style={styles.tagRow}>
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>{item.tags[0]}</Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          )}
        />
      )}

      {/* Meal detail bottom sheet */}
      <Modal
        visible={!!selected}
        animationType="slide"
        transparent
        onRequestClose={() => setSelected(null)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setSelected(null)} />
        {selected && (
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              {selected.image_url ? (
                <Image
                  source={{ uri: selected.image_url }}
                  style={styles.sheetImage}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={styles.sheetEmoji}>
                  <Text style={styles.sheetEmojiText}>{CATEGORY_EMOJIS[selected.category] ?? '🍽️'}</Text>
                </View>
              )}
              <View style={styles.sheetBody}>
                <Text style={styles.sheetName}>{selected.name}</Text>
                <Text style={styles.sheetPrice}>{formatPrice(selected.price)}</Text>
                <Text style={styles.sheetDesc}>{selected.description}</Text>

                {selected.kcal && (
                  <View style={styles.macros}>
                    <MacroBox label="Kcal" value={String(selected.kcal)} />
                    <MacroBox label="Protein" value={`${selected.protein}g`} />
                    <MacroBox label="Carbs" value={`${selected.carbs}g`} />
                    <MacroBox label="Fat" value={`${selected.fat}g`} />
                  </View>
                )}

                {selected.tags.length > 0 && (
                  <View style={styles.tagsWrap}>
                    {selected.tags.map((t) => (
                      <View key={t} style={styles.tag}>
                        <Text style={styles.tagText}>{t}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setSelected(null)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>

      {/* CTA */}
      <View style={styles.cta}>
        <TouchableOpacity style={styles.ctaBtn} onPress={() => router.push('/(onboarding)/gate')}>
          <Text style={styles.ctaBtnText}>Next →</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function MacroBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.macroBox}>
      <Text style={styles.macroValue}>{value}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 14, color: Colors.textMuted, marginTop: 4 },
  tabs: { maxHeight: 56, flexGrow: 0 },
  tabsContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center', paddingVertical: 4 },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textMuted },
  tabTextActive: { color: '#fff' },
  grid: { padding: 16, paddingBottom: 100 },
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
  cardImage: { width: '100%', height: 100, borderRadius: 10, marginBottom: 8 },
  cardEmoji: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emojiText: { fontSize: 28 },
  cardName: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 4, lineHeight: 18 },
  cardPrice: { fontSize: 13, color: Colors.primary, fontWeight: '600', marginBottom: 6 },
  tagRow: { flexDirection: 'row' },
  tag: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  tagText: { fontSize: 10, color: Colors.primary, fontWeight: '600' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '75%',
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  sheetImage: { width: '100%', height: 200, borderRadius: 16, marginBottom: 16 },
  sheetEmoji: {
    height: 120,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetEmojiText: { fontSize: 60 },
  sheetBody: { padding: 20 },
  sheetName: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  sheetPrice: { fontSize: 16, color: Colors.primary, fontWeight: '700', marginBottom: 12 },
  sheetDesc: { fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 16 },
  macros: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  macroBox: {
    flex: 1,
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  macroValue: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  macroLabel: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  closeBtn: {
    marginHorizontal: 20,
    marginTop: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeBtnText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
