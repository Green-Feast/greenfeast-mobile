// Rate a delivered meal: stars, chips ("What went wrong?" / "What did you
// like?") and an optional comment. One sheet for the whole app —
// RatingSheetHost sits in the (app) layout and opens whenever the rating store
// asks (Home's card, Order history, or a "How was your lunch?" push).
import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { X, Star, CheckCircle2, Heart } from 'lucide-react-native'
import { useAuthStore } from '@/store/auth'
import { useRatingStore, type RatingSheetRequest } from '@/store/rating'
import {
  rateMeal,
  fetchMealForRating,
  canStillRate,
  mealQuestion,
  tagsFor,
  STAR_WORDS,
  STAR_COLOR,
  type MealRating,
  type RatingPrompt,
} from '@/lib/ratings'
import { Colors, Fonts } from '@/constants/colors'

export function RatingSheetHost() {
  const sheet = useRatingStore((s) => s.sheet)
  const userId = useAuthStore((s) => s.user?.id)
  const [ready, setReady] = useState<{ req: RatingSheetRequest; meal: RatingPrompt; existing: MealRating | null } | null>(null)

  useEffect(() => {
    if (!sheet) {
      setReady(null)
      return
    }
    // Past the rating window (an old push): nothing to do.
    if (!canStillRate(sheet.date)) {
      useRatingStore.getState().close()
      return
    }
    if (sheet.meal) {
      setReady({ req: sheet, meal: sheet.meal, existing: sheet.existing ?? null })
      return
    }
    if (!userId) return // signed-in state still loading — runs again when it lands
    let cancelled = false
    fetchMealForRating(userId, sheet.date, sheet.slot)
      .then(({ meal, existing }) => {
        if (cancelled) return
        if (!meal) return useRatingStore.getState().close() // nothing delivered to rate
        setReady({ req: sheet, meal, existing })
      })
      .catch(() => {
        if (!cancelled) useRatingStore.getState().close()
      })
    return () => {
      cancelled = true
    }
  }, [sheet, userId])

  if (!ready) return null
  return <RateMealSheet key={`${ready.req.date}|${ready.req.slot}`} request={ready.req} meal={ready.meal} existing={ready.existing} />
}

function RateMealSheet({ request, meal, existing }: { request: RatingSheetRequest; meal: RatingPrompt; existing: MealRating | null }) {
  const insets = useSafeAreaInsets()
  const close = useRatingStore((s) => s.close)
  const saved = useRatingStore((s) => s.saved)
  const [stars, setStars] = useState(request.initialStars ?? existing?.stars ?? 0)
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [comment, setComment] = useState(existing?.comment ?? '')
  // A star tapped on Home's card / Order history already counts as a choice.
  const [dirty, setDirty] = useState(!!request.initialStars && request.initialStars !== existing?.stars)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Thank-you shows briefly, then the sheet closes itself.
  useEffect(() => {
    if (!done) return
    const t = setTimeout(close, 2600)
    return () => clearTimeout(t)
  }, [done, close])

  function pickStars(n: number) {
    Haptics.selectionAsync().catch(() => {})
    setStars(n)
    setDirty(true)
    setError('')
    // Chips are different for 1–3★ and 4–5★ — drop the ones that no longer apply.
    const allowed = new Set(tagsFor(n).map((t) => t.key))
    setTags((prev) => prev.filter((t) => allowed.has(t)))
  }

  function toggleTag(key: string) {
    Haptics.selectionAsync().catch(() => {})
    setDirty(true)
    setTags((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]))
  }

  async function submit() {
    if (!stars) return setError('Tap a star first.')
    setSaving(true)
    setError('')
    try {
      await rateMeal({ date: request.date, slot: request.slot, stars, tags, comment, source: request.source })
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
      setDone(true)
      saved()
    } catch (e: any) {
      setError(e?.message ?? 'Could not save your rating. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Closing without Submit still keeps the stars (and anything else picked).
  function dismiss() {
    if (!done && dirty && stars > 0 && !saving) {
      rateMeal({ date: request.date, slot: request.slot, stars, tags, comment, source: request.source })
        .then(saved)
        .catch(() => {})
    }
    close()
  }

  const chipHeading = stars >= 4 ? 'What did you like?' : stars === 3 ? 'What could be better?' : 'What went wrong?'

  return (
    <Modal visible transparent animationType="slide" onRequestClose={dismiss}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={st.overlay} onPress={dismiss}>
          <Pressable style={[st.sheet, { paddingBottom: 20 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
            <View style={st.handle} />
            {done ? (
              <View style={st.doneWrap}>
                {stars >= 4 ? <Heart size={40} color={Colors.primary} fill={Colors.primary} /> : <CheckCircle2 size={40} color={Colors.primary} />}
                <Text style={st.doneTitle}>{stars >= 4 ? 'Thank you!' : stars === 3 ? 'Thanks for the feedback' : 'Sorry about that'}</Text>
                <Text style={st.doneText}>
                  {stars >= 4
                    ? 'Glad you enjoyed it — the kitchen will love hearing this.'
                    : stars === 3
                      ? "We'll use it to make your meals better."
                      : 'Thanks for telling us. Our team has been told and will look into it.'}
                </Text>
                <Pressable style={[st.primaryBtn, { alignSelf: 'stretch' }]} onPress={close}>
                  <Text style={st.primaryBtnText}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} bounces={false}>
                <View style={st.header}>
                  {meal.image ? (
                    <Image source={{ uri: meal.image }} style={st.thumb} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <View style={[st.thumb, st.thumbEmpty]}><Text style={{ fontSize: 20 }}>🍽️</Text></View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={st.title}>{mealQuestion(request.date, request.slot)}</Text>
                    <Text style={st.dish} numberOfLines={2}>{meal.dishNames}</Text>
                  </View>
                  <Pressable onPress={dismiss} hitSlop={10} accessibilityLabel="Close">
                    <X size={20} color={Colors.textMuted} />
                  </Pressable>
                </View>

                <View style={st.starsRow}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => pickStars(n)}
                      hitSlop={4}
                      style={st.starBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`${n} star${n === 1 ? '' : 's'} — ${STAR_WORDS[n]}`}
                    >
                      <Star size={40} color={n <= stars ? STAR_COLOR : Colors.ink300} fill={n <= stars ? STAR_COLOR : 'transparent'} strokeWidth={1.5} />
                    </Pressable>
                  ))}
                </View>
                <Text style={st.starWord}>{stars ? STAR_WORDS[stars] : 'Tap to rate'}</Text>

                {stars > 0 && (
                  <>
                    <Text style={st.sectionLabel}>{chipHeading}</Text>
                    <View style={st.chips}>
                      {tagsFor(stars).map((t) => {
                        const on = tags.includes(t.key)
                        return (
                          <Pressable key={t.key} onPress={() => toggleTag(t.key)} style={[st.chip, on && st.chipOn]} accessibilityState={{ selected: on }}>
                            <Text style={[st.chipText, on && st.chipTextOn]}>{t.label}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                    <TextInput
                      style={st.input}
                      value={comment}
                      onChangeText={(t) => { setComment(t); setDirty(true) }}
                      placeholder={stars <= 2 ? 'What happened? (optional)' : 'Anything else? (optional)'}
                      placeholderTextColor={Colors.textLight}
                      multiline
                      maxLength={1000}
                      textAlignVertical="top"
                    />
                  </>
                )}

                {!!error && <Text style={st.error}>{error}</Text>}
                <Pressable
                  style={[st.primaryBtn, (!stars || saving) && { opacity: 0.5 }]}
                  disabled={!stars || saving}
                  onPress={submit}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.primaryBtnText}>{existing ? 'Update rating' : 'Submit'}</Text>}
                </Pressable>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 12, maxHeight: '88%' },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  thumb: { width: 52, height: 52, borderRadius: 14, backgroundColor: Colors.cream300 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.headingSemi, fontSize: 20, color: Colors.text },
  dish: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  starBtn: { padding: 4 },
  starWord: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink600, textAlign: 'center', marginTop: 6, marginBottom: 6 },
  sectionLabel: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, marginTop: 14, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: '#fff' },
  chipOn: { backgroundColor: Colors.green50, borderColor: Colors.primary },
  chipText: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.text },
  chipTextOn: { color: Colors.primary },
  input: {
    fontFamily: Fonts.body, fontSize: 15, color: Colors.text, minHeight: 84,
    borderWidth: 1, borderColor: Colors.borderFaint, borderRadius: 12, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, marginTop: 16,
  },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 10 },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  primaryBtnText: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  doneWrap: { alignItems: 'center', gap: 8, paddingVertical: 18, paddingHorizontal: 8 },
  doneTitle: { fontFamily: Fonts.headingSemi, fontSize: 20, color: Colors.text, marginTop: 4 },
  doneText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
})
