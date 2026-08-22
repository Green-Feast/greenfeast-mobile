// Full-screen dish detail — extracted from menu.tsx so Home's "Today's
// Special" cards can open the exact same view instead of doing nothing.
//
// Wrapped in its own SafeAreaProvider: a full-screen <Modal> gets its own
// native window on iOS, and useSafeAreaInsets() can read stale/zero insets
// from the screen underneath rather than the modal's own safe area — this
// nested provider re-measures within the modal itself. Only verifiable on a
// real device.
import type { ReactNode } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, Modal, Linking } from 'react-native'
import { Image } from 'expo-image'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { X, MapPin } from 'lucide-react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts } from '@/constants/colors'
import { SWIGGY_URL, ZOMATO_URL, KITCHEN_MAPS_URL, isConfigured } from '@/constants/links'
import { useCategoriesStore, categoryEmoji } from '@/store/categories'
import MacroRow from '@/components/MacroRow'
import MacroRing from '@/components/MacroRing'
import SwiggyIcon from '@/components/SwiggyIcon'

export type MealDetail = {
  id: string
  name: string
  category: string
  description: string | null
  price: number | null
  kcal: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  tags: string[] | null
  image_url: string | null
  // Optional — only populated by queries written after migration 041.
  // Absent (undefined) is treated as "orderable", matching every dish's
  // actual default, so callers on an older cached response never break.
  thumb_url?: string | null
  blur_data_url?: string | null
  subscription_valid?: boolean
}

export type MealDetailPrimaryAction = {
  label: string
  onPress: () => void
  icon?: ReactNode
  loading?: boolean
  disabled?: boolean
  done?: boolean
}

type Props = {
  meal: MealDetail | null
  onClose: () => void
  unavailableReason?: string | null
  primaryAction?: MealDetailPrimaryAction
  showBrandRow?: boolean
}

function formatPrice(paise: number | null) {
  if (paise == null) return ''
  return `₹${(paise / 100).toFixed(0)}`
}

function ModalContent({ meal, onClose, unavailableReason, primaryAction, showBrandRow = true }: Props & { meal: MealDetail }) {
  const insets = useSafeAreaInsets()
  const categories = useCategoriesStore((s) => s.categories)
  // undefined (queries predating migration 041) reads as orderable — every
  // dish's actual default — never treated as takeaway-only by accident.
  const isOrderable = meal.subscription_valid !== false

  return (
    <View style={styles.detailScreen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
        {meal.image_url ? (
          <Image
            source={{ uri: meal.image_url }}
            style={styles.detailImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={meal.blur_data_url ? { uri: meal.blur_data_url } : undefined}
            transition={150}
          />
        ) : (
          <View style={styles.detailImageEmoji}>
            <Text style={styles.emojiText}>{categoryEmoji(categories, meal.category)}</Text>
          </View>
        )}
        <Pressable
          style={[styles.detailClose, { top: insets.top + 12 }]}
          onPress={onClose}
          hitSlop={8}
        >
          <X size={20} color="#fff" />
        </Pressable>

        <View style={styles.detailBody}>
          <Text style={styles.detailCategory}>{meal.category}</Text>
          <Text style={styles.detailName}>{meal.name}</Text>
          {meal.price != null && <Text style={styles.detailPrice}>{formatPrice(meal.price)}</Text>}

          {unavailableReason ? (
            <View style={styles.unavailablePill}>
              <Text style={styles.unavailablePillText}>{unavailableReason}</Text>
            </View>
          ) : null}

          {meal.description ? <Text style={styles.detailDesc}>{meal.description}</Text> : null}

          {(meal.kcal != null || meal.protein != null) && (
            <View style={styles.ringWrap}>
              <MacroRing
                size={124}
                strokeWidth={13}
                centerValue={meal.kcal != null ? String(meal.kcal) : '—'}
                centerLabel="kcal"
                segments={[
                  { value: (meal.protein ?? 0) * 4, color: Colors.macroProtein },
                  { value: (meal.carbs ?? 0) * 4, color: Colors.macroCarbs },
                  { value: (meal.fat ?? 0) * 9, color: Colors.macroFat },
                ]}
              />
              <MacroRow protein={meal.protein} carbs={meal.carbs} fat={meal.fat} kcal={meal.kcal} size="md" />
            </View>
          )}

          {meal.tags != null && meal.tags.length > 0 && (
            <View style={styles.tagsWrap}>
              {meal.tags.map((tag) => (
                <View key={tag} style={styles.tagYellow}>
                  <Text style={styles.tagYellowText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* CTA bar */}
      <View style={[styles.detailCtaBar, { paddingBottom: 12 + insets.bottom }]}>
        {!isOrderable && (
          <Text style={styles.takeawayOnlyNote}>
            Not part of the subscription — order it directly from Swiggy or Zomato instead.
          </Text>
        )}
        {primaryAction && isOrderable && (
          <Pressable
            style={[styles.addDayBtn, primaryAction.disabled && styles.addDayBtnDisabled]}
            disabled={primaryAction.disabled || primaryAction.loading}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); primaryAction.onPress() }}
          >
            {!primaryAction.loading && !primaryAction.done && primaryAction.icon}
            <Text style={styles.addDayBtnText}>
              {primaryAction.loading ? 'Adding…' : primaryAction.done ? 'Added ✓' : primaryAction.label}
            </Text>
          </Pressable>
        )}
        {showBrandRow && (
          <View style={styles.brandRow}>
            {isConfigured(SWIGGY_URL) && (
              <Pressable style={[styles.brandBtn, { backgroundColor: '#FC8019' }]} onPress={() => Linking.openURL(SWIGGY_URL)}>
                <SwiggyIcon size={18} color="#fff" />
                <Text style={styles.brandBtnText}>Swiggy</Text>
              </Pressable>
            )}
            {isConfigured(ZOMATO_URL) && (
              <Pressable style={[styles.brandBtn, { backgroundColor: '#E23744' }]} onPress={() => Linking.openURL(ZOMATO_URL)}>
                <Text style={styles.brandBtnTextBold}>Zomato</Text>
              </Pressable>
            )}
            {isConfigured(KITCHEN_MAPS_URL) && (
              <Pressable style={styles.takeawayBtn} onPress={() => Linking.openURL(KITCHEN_MAPS_URL)}>
                <MapPin size={16} color={Colors.green700} />
                <Text style={styles.takeawayBtnText}>Takeaway</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

export default function MealDetailModal(props: Props) {
  return (
    <Modal visible={!!props.meal} animationType="slide" onRequestClose={props.onClose}>
      {props.meal && (
        <SafeAreaProvider>
          <ModalContent {...props} meal={props.meal} />
        </SafeAreaProvider>
      )}
    </Modal>
  )
}

const styles = StyleSheet.create({
  detailScreen: { flex: 1, backgroundColor: Colors.cream50 },
  detailImage: { width: '100%', height: 320, backgroundColor: Colors.cream300 },
  detailImageEmoji: { width: '100%', height: 320, backgroundColor: Colors.cream300, alignItems: 'center', justifyContent: 'center' },
  emojiText: { fontSize: 40 },
  detailClose: {
    position: 'absolute', left: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center',
  },
  detailBody: { padding: 20, gap: 4 },
  detailCategory: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.green700, textTransform: 'capitalize', letterSpacing: 0.4 },
  detailName: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.ink900, marginTop: 2 },
  detailPrice: { fontFamily: Fonts.bodyBold, fontSize: 18, color: Colors.ink900, marginTop: 4 },
  detailDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500, lineHeight: 21, marginTop: 12 },

  unavailablePill: {
    alignSelf: 'flex-start', backgroundColor: Colors.badgeBg, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, marginTop: 8,
  },
  unavailablePillText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.badgeText },

  ringWrap: { alignItems: 'center', gap: 16, marginTop: 24 },

  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 16 },
  tagYellow: { backgroundColor: Colors.badgeBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  tagYellowText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.badgeText },

  detailCtaBar: {
    paddingHorizontal: 20, paddingTop: 12, gap: 10,
    backgroundColor: Colors.cream50, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  addDayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.green700, borderRadius: 999, paddingVertical: 15,
  },
  addDayBtnDisabled: { opacity: 0.5 },
  addDayBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  takeawayOnlyNote: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500, textAlign: 'center' },
  brandRow: { flexDirection: 'row', gap: 10 },
  brandBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 999,
  },
  brandBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: '#fff' },
  brandBtnTextBold: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff', fontStyle: 'italic' },
  takeawayBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 999, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: Colors.green700,
  },
  takeawayBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.green700 },
})
