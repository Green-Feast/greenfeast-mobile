// Walk-in cart (migration 102) — the walk-in version of Customize.
//
// A walk-in is a cart: meals (any dish the café serves today × qty, each with
// its own add-ons) and drinks (smoothie / coffee × qty). Priced like the
// delivery cart and paid from the wallet when the counter hands it over. The
// limits come from the plan's default for this meal (M meals, D drinks):
// meals 1 … M + 1, drinks (1 if the plan has a drink) … D + 1, and the plan's
// add-ons on as many meals as they take, up to M. start_walk_in_cart checks
// the same rules and returns the 6-digit code for the whole cart.
//
// Params: location (pickup_locations id).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { ChevronLeft, Minus, Plus, ChevronDown, ChevronUp, CupSoda, MapPin, AlertTriangle, UtensilsCrossed, ShoppingBag } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendlyError'
import { Colors, Fonts } from '@/constants/colors'
import { isDrinkCategory } from '@/constants/drinks'
import { useCategoriesStore } from '@/store/categories'

type Mode = 'dine_in' | 'pickup'
type Dish = {
  id: string
  name: string
  category: string
  kcal: number | null
  short_description: string | null
  image_url: string | null
  thumb_url: string | null
  premium_paise: number
}
type Addon = { id: string; name: string; price_per_meal: number }
type Limits = {
  slot: 'lunch' | 'dinner'
  default_meals: number
  default_drinks: number
  meal_min: number
  meal_max: number
  drink_min: number
  drink_max: number
  plan_addon_ids: string[]
}
type Quote = {
  ok: boolean
  eligible?: boolean
  error?: string
  open_now?: boolean
  place?: string
  address?: string
  maps_url?: string | null
  opens?: string
  closes?: string
  offers_pickup?: boolean
  offers_dine_in?: boolean
  limits?: Limits
  meal_price?: number
  drink_price?: number
  default_meal_id?: string | null
  default_drink_id?: string | null
  dishes?: Dish[]
  addons?: Addon[]
  spendable?: number
  today?: unknown
}
type Item = { key: string; kind: 'meal' | 'drink'; dish: string; qty: number; addons: Record<string, number> }

let keySeq = 0
const newKey = () => `w${++keySeq}`
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const DRINK_SECTIONS = [
  { id: 'smoothie', name: 'Smoothies' },
  { id: 'coffee', name: 'Coffee' },
]

export default function WalkInCartScreen() {
  const { location } = useLocalSearchParams<{ location: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const categories = useCategoriesStore((s) => s.categories)
  const loadCategories = useCategoriesStore((s) => s.load)

  const [loading, setLoading] = useState(true)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    loadCategories()
    const { data, error: err } = await supabase.rpc('walk_in_cart_quote', { p_location: location })
    if (err) { setError(friendlyError(err, 'Could not load the menu. Please try again.')); return }
    const q = data as Quote
    setQuote(q)
    if (!q.ok || !q.limits) return
    setMode(q.offers_dine_in ? 'dine_in' : q.offers_pickup ? 'pickup' : null)
    // Start from the plan's default: M × the day's dish with the plan's
    // add-ons, D × the day's drink.
    const lim = q.limits
    const start: Item[] = []
    if (q.default_meal_id) {
      start.push({
        key: newKey(), kind: 'meal', dish: q.default_meal_id, qty: lim.default_meals,
        addons: Object.fromEntries(lim.plan_addon_ids.map((id) => [id, lim.default_meals])),
      })
    }
    if (q.default_drink_id && lim.default_drinks > 0) {
      start.push({ key: newKey(), kind: 'drink', dish: q.default_drink_id, qty: Math.min(lim.default_drinks, lim.drink_max), addons: {} })
    }
    setItems(start)
  }, [location, loadCategories])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  const dishes = quote?.dishes ?? []
  const addons = quote?.addons ?? []
  const lim = quote?.limits
  const dishById = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes])
  const addonById = useMemo(() => new Map(addons.map((a) => [a.id, a])), [addons])
  const planAddons = lim?.plan_addon_ids ?? []

  const meals = items.filter((i) => i.kind === 'meal').reduce((n, i) => n + i.qty, 0)
  const drinks = items.filter((i) => i.kind === 'drink').reduce((n, i) => n + i.qty, 0)
  const needAddon = Math.min(meals, lim?.default_meals ?? 0)
  const planAddonCount = (id: string, list = items) => list.filter((i) => i.kind === 'meal').reduce((n, i) => n + (i.addons[id] ?? 0), 0)
  const priceOf = (d: Dish | undefined) =>
    !d || !quote ? 0 : isDrinkCategory(d.category) ? (quote.drink_price ?? 0) : (quote.meal_price ?? 0) + (d.premium_paise ?? 0)
  const total = items.reduce((sum, i) => {
    const addonSum = Object.entries(i.addons).reduce((s, [id, n]) => s + (addonById.get(id)?.price_per_meal ?? 0) * n, 0)
    return sum + priceOf(dishById.get(i.dish)) * i.qty + addonSum
  }, 0)

  const problem = !lim ? '' :
    meals < lim.meal_min ? 'Add a meal to your walk-in.' :
    drinks < lim.drink_min ? 'Your plan comes with a drink — add one.' :
    planAddons.some((id) => planAddonCount(id) < needAddon)
      ? `${addonById.get(planAddons.find((id) => planAddonCount(id) < needAddon)!)?.name ?? 'Your plan add-on'} comes with your plan — keep it on ${needAddon} meal${needAddon === 1 ? '' : 's'}.`
      : (quote?.spendable ?? 0) < total ? "Your wallet doesn't cover this — take less, or renew your plan." : ''
  const canSave = !!quote?.ok && !!quote.open_now && !!mode && !problem && items.length > 0

  // ── Changing the cart ────────────────────────────────────────────────────
  const qtyOfDish = (id: string) => items.filter((i) => i.dish === id).reduce((n, i) => n + i.qty, 0)
  const atMax = (kind: Item['kind']) => !!lim && (kind === 'meal' ? meals >= lim.meal_max : drinks >= lim.drink_max)

  function addDish(d: Dish) {
    const kind: Item['kind'] = isDrinkCategory(d.category) ? 'drink' : 'meal'
    if (atMax(kind)) {
      setError(kind === 'meal' ? `Up to ${lim!.meal_max} meals at a walk-in.` : `Up to ${lim!.drink_max} drink${lim!.drink_max === 1 ? '' : 's'} at a walk-in.`)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      return
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setError('')
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, addons: { ...i.addons } }))
      // A meal added while the plan's add-ons are short gets them.
      const mealsAfter = meals + (kind === 'meal' ? 1 : 0)
      const short = kind === 'meal'
        ? planAddons.filter((id) => planAddonCount(id, next) < Math.min(mealsAfter, lim?.default_meals ?? 0))
        : []
      const same = next.find((i) => i.dish === d.id && (kind === 'drink' || short.every((id) => (i.addons[id] ?? 0) === i.qty)))
      if (same && same.qty < 10) {
        same.qty += 1
        for (const id of short) same.addons[id] = (same.addons[id] ?? 0) + 1
        return next
      }
      next.push({ key: newKey(), kind, dish: d.id, qty: 1, addons: Object.fromEntries(short.map((id) => [id, 1])) })
      return next
    })
  }

  function removeDish(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setError('')
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, addons: { ...i.addons } }))
      const idx = [...next].reverse().findIndex((i) => i.dish === id)
      if (idx < 0) return prev
      const it = next[next.length - 1 - idx]
      it.qty -= 1
      for (const [a, n] of Object.entries(it.addons)) if (n > it.qty) it.addons[a] = it.qty
      return next.filter((i) => i.qty > 0)
    })
  }

  function setAddon(itemKey: string, addonId: string, delta: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setError('')
    setItems((prev) => prev.map((i) => {
      if (i.key !== itemKey) return i
      const now = i.addons[addonId] ?? 0
      const want = Math.max(0, Math.min(now + delta, 10))
      if (delta < 0 && planAddons.includes(addonId) && planAddonCount(addonId) - 1 < needAddon) {
        setError(`${addonById.get(addonId)?.name ?? 'That add-on'} comes with your plan's meals.`)
        return i
      }
      const nextAddons = { ...i.addons, [addonId]: want }
      if (want === 0) delete nextAddons[addonId]
      return { ...i, addons: nextAddons }
    }))
  }

  async function getCode() {
    if (!canSave || !mode) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)
    setError('')
    const payload = items.map((i) => ({
      kind: i.kind, dish: i.dish, qty: i.qty,
      ...(i.kind === 'meal' ? { addons: Object.entries(i.addons).filter(([, n]) => n > 0).map(([id, n]) => ({ id, qty: n })) } : {}),
    }))
    const { error: err } = await supabase.rpc('start_walk_in_cart', { p_location: location, p_mode: mode, p_items: payload })
    setSaving(false)
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(friendlyError(err, 'Could not place it. Please try again.'))
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.back()
  }

  // ── Menu sections ────────────────────────────────────────────────────────
  const sections = useMemo(() => {
    const mealCats = categories.filter((c) => !isDrinkCategory(c.id))
    const out: { id: string; name: string; dishes: Dish[] }[] = []
    for (const c of mealCats) {
      const list = dishes.filter((d) => d.category === c.id)
      if (list.length) out.push({ id: c.id, name: c.name, dishes: list })
    }
    const known = new Set(mealCats.map((c) => c.id))
    const other = dishes.filter((d) => !known.has(d.category) && !isDrinkCategory(d.category))
    if (other.length) out.push({ id: 'other', name: 'More', dishes: other })
    for (const s of DRINK_SECTIONS) {
      const list = dishes.filter((d) => d.category === s.id)
      if (list.length) out.push({ id: s.id, name: s.name, dishes: list })
    }
    return out
  }, [categories, dishes])

  if (loading) {
    return <View style={[st.center, { paddingTop: insets.top }]}><ActivityIndicator color={Colors.primary} /></View>
  }
  if (!quote || !quote.ok || !lim) {
    return (
      <View style={[st.center, { paddingTop: insets.top }]}>
        <Text style={st.muted}>{quote?.error || error || 'Walk-in isn’t available right now.'}</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={st.link}>Go back</Text></Pressable>
      </View>
    )
  }
  if (quote.today) {
    return (
      <View style={[st.center, { paddingTop: insets.top }]}>
        <Text style={st.muted}>You already have today&apos;s walk-in — one a day. Your code is on the Walk-in tab.</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}><Text style={st.link}>Go back</Text></Pressable>
      </View>
    )
  }

  const slotLabel = lim.slot === 'lunch' ? 'lunch' : 'dinner'

  return (
    <View style={st.container}>
      <View style={[st.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={st.backBtn}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>{quote.place}</Text>
          <Text style={st.subtitle}>Walk-in · {quote.opens}–{quote.closes}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 190 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {!!quote.address && (
          <Pressable style={st.placeLine} disabled={!quote.maps_url} onPress={() => quote.maps_url && Linking.openURL(quote.maps_url)}>
            <MapPin size={14} color={Colors.textMuted} />
            <Text style={[st.muted, { flex: 1 }]}>{quote.address}{quote.maps_url ? ' · Directions' : ''}</Text>
          </Pressable>
        )}
        {!quote.open_now && (
          <View style={st.warnBox}>
            <AlertTriangle size={15} color={Colors.danger} />
            <Text style={st.warnText}>Closed right now — walk-ins from {quote.opens} to {quote.closes}.</Text>
          </View>
        )}

        {/* Eat here / takeaway */}
        <View style={st.segment}>
          {quote.offers_dine_in && (
            <Pressable style={[st.segBtn, mode === 'dine_in' && st.segBtnOn]} onPress={() => setMode('dine_in')}>
              <UtensilsCrossed size={15} color={mode === 'dine_in' ? '#fff' : Colors.text} />
              <Text style={[st.segText, mode === 'dine_in' && st.segTextOn]}>Eat here</Text>
            </Pressable>
          )}
          {quote.offers_pickup && (
            <Pressable style={[st.segBtn, mode === 'pickup' && st.segBtnOn]} onPress={() => setMode('pickup')}>
              <ShoppingBag size={15} color={mode === 'pickup' ? '#fff' : Colors.text} />
              <Text style={[st.segText, mode === 'pickup' && st.segTextOn]}>Takeaway</Text>
            </Pressable>
          )}
        </View>

        {/* ── Your cart ── */}
        <Text style={st.section}>Your {slotLabel}</Text>
        <Text style={st.hint}>
          Up to {lim.meal_max} meal{lim.meal_max === 1 ? '' : 's'}
          {lim.drink_max > 0 ? ` and ${lim.drink_max} drink${lim.drink_max === 1 ? '' : 's'}` : ''}
          {lim.drink_min > 0 ? ' — your plan comes with a drink' : ''}. Pick anything from the menu below.
        </Text>
        {items.length === 0 ? (
          <Text style={[st.muted, { marginHorizontal: 16, marginBottom: 8 }]}>Nothing yet — add from the menu below.</Text>
        ) : items.map((i) => {
          const d = dishById.get(i.dish)
          const isOpen = open === i.key
          const itemAddons = Object.entries(i.addons).filter(([, n]) => n > 0)
          return (
            <View key={i.key} style={st.cartRow}>
              <View style={st.cartTop}>
                {i.kind === 'drink' ? <CupSoda size={16} color={Colors.primary} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={st.cartName}>{d?.name ?? 'Dish'}</Text>
                  {itemAddons.length > 0 && (
                    <Text style={st.cartSub}>
                      {itemAddons.map(([id, n]) => `${addonById.get(id)?.name ?? id}${n > 1 ? ` ×${n}` : ''}`).join(' · ')}
                    </Text>
                  )}
                </View>
                <Stepper qty={i.qty} onMinus={() => removeDish(i.dish)} onPlus={() => d && addDish(d)} plusOff={atMax(i.kind)} />
              </View>
              {i.kind === 'meal' && addons.length > 0 && (
                <Pressable style={st.addonToggle} onPress={() => setOpen(isOpen ? null : i.key)} hitSlop={6}>
                  <Text style={st.link}>Add-ons</Text>
                  {isOpen ? <ChevronUp size={14} color={Colors.primary} /> : <ChevronDown size={14} color={Colors.primary} />}
                </Pressable>
              )}
              {isOpen && (
                <View style={st.addonList}>
                  {addons.map((a) => (
                    <View key={a.id} style={st.addonRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.addonName}>{a.name}{planAddons.includes(a.id) ? ' · with your plan' : ''}</Text>
                        <Text style={st.cartSub}>+{rupees(a.price_per_meal)} each</Text>
                      </View>
                      <Stepper qty={i.addons[a.id] ?? 0} onMinus={() => setAddon(i.key, a.id, -1)} onPlus={() => setAddon(i.key, a.id, +1)} />
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        })}

        {/* ── Menu ── */}
        {sections.map((sec) => (
          <View key={sec.id}>
            <Text style={st.section}>{sec.name}</Text>
            {sec.dishes.map((d) => {
              const n = qtyOfDish(d.id)
              const kind = isDrinkCategory(d.category) ? 'drink' : 'meal'
              return (
                <View key={d.id} style={st.menuRow}>
                  {(d.thumb_url || d.image_url)
                    ? <Image source={{ uri: d.thumb_url ?? d.image_url! }} style={st.thumb} contentFit="cover" cachePolicy="memory-disk" />
                    : <View style={[st.thumb, st.thumbEmpty]} />}
                  <View style={{ flex: 1 }}>
                    <Text style={st.menuName}>{d.name}</Text>
                    <Text style={st.cartSub} numberOfLines={1}>
                      {[d.kcal ? `${d.kcal} kcal` : null, d.short_description].filter(Boolean).join(' · ')}
                    </Text>
                    <Text style={st.price}>
                      {rupees(priceOf(d))}{d.premium_paise > 0 ? `  ·  premium +${rupees(d.premium_paise)}` : ''}
                    </Text>
                  </View>
                  {n === 0 ? (
                    <Pressable style={[st.addBtn, atMax(kind) && { opacity: 0.4 }]} onPress={() => addDish(d)}>
                      <Text style={st.addBtnText}>ADD</Text>
                    </Pressable>
                  ) : (
                    <Stepper qty={n} onMinus={() => removeDish(d.id)} onPlus={() => addDish(d)} plusOff={atMax(kind)} />
                  )}
                </View>
              )
            })}
          </View>
        ))}
      </ScrollView>

      {/* ── Bottom bar ── */}
      <View style={[st.bar, { paddingBottom: 12 + insets.bottom }]}>
        <View style={st.barTop}>
          <Text style={[st.barCount, meals < lim.meal_min && st.barShort]}>
            {meals}/{lim.meal_max} meal{lim.meal_max === 1 ? '' : 's'}
          </Text>
          {lim.drink_max > 0 && (
            <Text style={[st.barCount, drinks < lim.drink_min && st.barShort]}>
              {' · '}{drinks}/{lim.drink_max} drink{lim.drink_max === 1 ? '' : 's'}
            </Text>
          )}
          <Text style={st.barTotal}>{rupees(total)}</Text>
        </View>
        {error ? <Text style={st.error}>{error}</Text> : problem ? <Text style={st.barHint}>{problem}</Text> : (
          <Text style={st.barHint}>Your code works for an hour. Paid from your wallet when the counter hands it over.</Text>
        )}
        <Pressable style={[st.saveBtn, (!canSave || saving) && st.saveOff]} onPress={getCode} disabled={!canSave || saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.saveText}>Get my code</Text>}
        </Pressable>
      </View>
    </View>
  )
}

function Stepper({ qty, onMinus, onPlus, plusOff }: { qty: number; onMinus: () => void; onPlus: () => void; plusOff?: boolean }) {
  return (
    <View style={st.stepper}>
      <Pressable onPress={onMinus} disabled={qty <= 0} hitSlop={8} style={st.stepBtn}>
        <Minus size={14} color={Colors.primary} strokeWidth={2.5} />
      </Pressable>
      <Text style={st.stepQty}>{qty}</Text>
      <Pressable onPress={onPlus} hitSlop={8} style={[st.stepBtn, plusOff && { opacity: 0.35 }]}>
        <Plus size={14} color={Colors.primary} strokeWidth={2.5} />
      </Pressable>
    </View>
  )
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, padding: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { padding: 2 },
  title: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.text },
  subtitle: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 1 },
  placeLine: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginHorizontal: 16, marginBottom: 10 },
  warnBox: { flexDirection: 'row', gap: 8, alignItems: 'center', marginHorizontal: 16, marginBottom: 10, padding: 12, borderRadius: 12, backgroundColor: Colors.dangerLight },
  warnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.danger, flex: 1 },
  segment: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 4 },
  segBtn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff' },
  segBtnOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  segTextOn: { color: '#fff' },
  section: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.text, marginTop: 18, marginBottom: 8, marginHorizontal: 16 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginHorizontal: 16, marginBottom: 10, lineHeight: 17 },
  muted: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, flexShrink: 1, textAlign: 'left' },
  cartRow: { backgroundColor: '#fff', borderRadius: 14, marginHorizontal: 16, marginBottom: 8, padding: 12, borderWidth: 1, borderColor: Colors.borderFaint },
  cartTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cartName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  cartSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addonToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  link: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  addonList: { marginTop: 8, borderTopWidth: 1, borderTopColor: Colors.borderFaint, paddingTop: 6 },
  addonRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  addonName: { fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.text },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  thumb: { width: 56, height: 56, borderRadius: 12 },
  thumbEmpty: { backgroundColor: Colors.surface },
  menuName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  price: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.text, marginTop: 3 },
  addBtn: { borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#fff' },
  addBtnText: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.primary },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 10, backgroundColor: Colors.primaryLight },
  stepBtn: { paddingHorizontal: 10, paddingVertical: 7 },
  stepQty: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.primary, minWidth: 16, textAlign: 'center' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: 16, paddingTop: 12 },
  barTop: { flexDirection: 'row', alignItems: 'center' },
  barCount: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },
  barShort: { color: Colors.danger },
  barTotal: { marginLeft: 'auto', fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  barHint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 4 },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 999, alignItems: 'center', justifyContent: 'center', minHeight: 50, marginTop: 10 },
  saveOff: { opacity: 0.4 },
  saveText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
