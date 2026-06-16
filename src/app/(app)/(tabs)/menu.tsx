// Full menu browse — restyled to match the demo's MenuExplore aesthetic.
import { useEffect, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'

type Meal = {
  id: string
  name: string
  category: string
  description: string | null
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  tags: string[]
}

const CATEGORIES = ['All', 'Bowl', 'Wrap', 'Salad', 'Toast', 'Smoothie']

export default function MenuScreen() {
  const insets = useSafeAreaInsets()
  const [meals, setMeals] = useState<Meal[]>([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('All')
  const [selected, setSelected] = useState<Meal | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('meal_templates')
          .select('id, name, category, description, kcal, protein, carbs, fat, tags')
          .eq('is_active', true)
          .order('category')
        if (error) console.log('menu fetch error:', error.message)
        if (active && data) setMeals(data as Meal[])
      } catch (e: any) {
        console.log('menu fetch threw:', e?.message)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const filtered =
    activeCategory === 'All' ? meals : meals.filter((m) => m.category === activeCategory.toLowerCase())

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.title}>Our Menu</Text>
        <Text style={styles.subtitle}>{meals.length} meals · rotates weekly</Text>
      </View>

      <View>
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

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.mealCard, pressed && styles.mealCardPressed]}
            onPress={() => setSelected(item)}
          >
            <View style={styles.mealCardLeft}>
              <Text style={styles.mealName}>{item.name}</Text>
              <Text style={styles.mealMeta}>
                {item.kcal ? `${item.kcal} kcal` : ''}
                {item.protein ? ` · ${item.protein}g protein` : ''}
              </Text>
              {item.tags.length > 0 && (
                <View style={styles.tagRow}>
                  {item.tags.slice(0, 3).map((tag) => (
                    <View key={tag} style={styles.tag}>
                      <Text style={styles.tagText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            <View style={styles.categoryChip}>
              <Text style={styles.categoryChipText}>{item.category}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No meals in this category yet.</Text>
          </View>
        }
      />

      {/* Detail modal */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSelected(null)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Pressable style={styles.modalClose} onPress={() => setSelected(null)} hitSlop={8}>
              <X size={20} color={Colors.textMuted} />
            </Pressable>

            {selected && (
              <>
                <Text style={styles.modalName}>{selected.name}</Text>
                <Text style={styles.modalCategory}>{selected.category}</Text>

                {selected.description ? <Text style={styles.modalDesc}>{selected.description}</Text> : null}

                <View style={styles.macrosRow}>
                  {selected.kcal != null && <Macro value={`${selected.kcal}`} label="kcal" />}
                  {selected.protein != null && <Macro value={`${selected.protein}g`} label="protein" />}
                  {selected.carbs != null && <Macro value={`${selected.carbs}g`} label="carbs" />}
                  {selected.fat != null && <Macro value={`${selected.fat}g`} label="fat" />}
                </View>

                {selected.tags.length > 0 && (
                  <View style={styles.tagRow}>
                    {selected.tags.map((tag) => (
                      <View key={tag} style={styles.tagYellow}>
                        <Text style={styles.tagYellowText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
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
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text },
  subtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 2 },

  tabs: { paddingHorizontal: 16, gap: 8, paddingVertical: 12 },
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

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  mealCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  mealCardPressed: { transform: [{ scale: 0.97 }] },
  mealCardLeft: { flex: 1, gap: 4 },
  mealName: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text },
  mealMeta: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted },
  categoryChip: {
    backgroundColor: Colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  categoryChipText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.primary, textTransform: 'capitalize' },

  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { backgroundColor: Colors.primaryLight, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.primary },
  tagYellow: { backgroundColor: Colors.accent, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagYellowText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.text },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: Fonts.body, color: Colors.textMuted, fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 48,
    gap: 10,
  },
  modalClose: { alignSelf: 'flex-end', padding: 4 },
  modalName: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.text },
  modalCategory: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, textTransform: 'capitalize', marginTop: -4 },
  modalDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20 },
  macrosRow: { flexDirection: 'row', gap: 10, marginVertical: 4 },
  macroBox: { flex: 1, backgroundColor: Colors.primaryLight, borderRadius: 12, paddingVertical: 10, alignItems: 'center' },
  macroVal: { fontFamily: Fonts.headingSemi, fontSize: 16, color: Colors.primary },
  macroLbl: { fontFamily: Fonts.body, fontSize: 11, color: Colors.primary },
})
