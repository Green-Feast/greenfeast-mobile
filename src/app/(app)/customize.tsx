// Customize — the full-screen cart editor for one lunch / dinner (migration 097).
//
// A cart is items: meals (dish × qty, each with its own add-ons) and drinks
// (smoothie / coffee × qty, no add-ons). On a slot the plan delivers it must
// keep the plan's default — M meals, D drinks, and the plan's add-ons on M
// meals — so less than that is a skip. Swaps are free (−1 burrito, +1 panini
// is still 2 meals); a premium dish costs its premium. Everything is saved at
// once with save_day_cart, which checks the same rules on the server.
//
// Params: date (YYYY-MM-DD), slot ('lunch' | 'dinner').
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { ChevronLeft, Minus, Plus, ChevronDown, ChevronUp, Lock, CupSoda } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { isDrinkCategory } from '@/constants/drinks'
import { useCategoriesStore } from '@/store/categories'
import { useAvailabilityStore, isMealAvailable } from '@/store/availability'
import { extractFunctionErrorMessage } from '@/lib/supabaseFunctionError'

type Slot = 'lunch' | 'dinner'
type Dish = {
  id: string
  name: string
  category: string
  kcal: number | null
  short_description: string | null
  image_url: string | null
  thumb_url: string | null
  premium_paise: number | null
}
type Addon = { id: string; name: string; price_per_meal: number }
type CartState = {
  applies: boolean
  need_meals: number
  need_drinks: number
  meal_price: number
  drink_price: number
  plan_addon_ids: string[]
  locked: boolean
  subscription_id: string
}
// One meal item: a dish × qty with add-on counts. Drinks have no add-ons.
type Item = { key: string; kind: 'meal' | 'drink'; dish: string; qty: number; addons: Record<string, number> }

let keySeq = 0
const newKey = () => `i${++keySeq}`
const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const DRINK_SECTIONS: { id: string; name: string }[] = [
  { id: 'smoothie', name: 'Smoothies' },
  { id: 'coffee', name: 'Coffee' },
]

function fmtDay(date: string) {
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export default function CustomizeScreen() {
  const { date, slot } = useLocalSearchParams<{ date: string; slot: Slot }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const categories = useCategoriesStore((s) => s.categories)
  const loadCategories = useCategoriesStore((s) => s.load)
  const unavailableMeals = useAvailabilityStore((s) => s.unavailableMeals)

  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<CartState | null>(null)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [addons, setAddons] = useState<Addon[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState<string | null>(null) // meal item whose add-ons are showing
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [skipHint, setSkipHint] = useState(false)
  const lastSkipTap = useRef(0)

  const load = useCallback(async () => {
    loadCategories()
    const [stRes, dishRes, addonRes] = await Promise.all([
      supabase.rpc('my_slot_cart', { p_date: date, p_slot: slot }),
      supabase
        .from('meal_templates')
        .select('id, name, category, kcal, short_description, image_url, thumb_url, premium_paise')
        .eq('is_active', true)
        .eq('subscription_valid', true)
        .order('name'),
      supabase.from('addons').select('id, name, price_per_meal').eq('is_active', true).eq('is_drink', false).order('name'),
    ])
    const st = stRes.data as CartState | null
    setState(st)
    setDishes((dishRes.data as Dish[]) ?? [])
    setAddons((addonRes.data as Addon[]) ?? [])
    if (st?.subscription_id) {
      const { data: rows } = await supabase
        .from('orders')
        .select('id, item_kind, quantity, meal_template_id, order_addons ( addon_id, quantity, kind )')
        .eq('subscription_id', st.subscription_id)
        .eq('delivery_date', date)
        .eq('meal_slot', slot)
        .eq('walk_in', false)
        .in('status', ['scheduled', 'confirmed'])
        .order('slot_seq')
      setItems(((rows ?? []) as any[]).map((r) => ({
        key: newKey(),
        kind: r.item_kind === 'drink' ? 'drink' : 'meal',
        dish: r.meal_template_id,
        qty: r.quantity ?? 1,
        addons: Object.fromEntries(
          ((r.order_addons ?? []) as { addon_id: string | null; quantity: number | null; kind: string }[])
            .filter((l) => l.kind === 'addon' && l.addon_id)
            .map((l) => [l.addon_id as string, l.quantity ?? 1]),
        ),
      })))
    }
  }, [date, slot, loadCategories])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  const dishById = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes])
  const addonById = useMemo(() => new Map(addons.map((a) => [a.id, a])), [addons])
  const planAddons = state?.plan_addon_ids ?? []

  const meals = items.filter((i) => i.kind === 'meal').reduce((n, i) => n + i.qty, 0)
  const drinks = items.filter((i) => i.kind === 'drink').reduce((n, i) => n + i.qty, 0)
  const needMeals = state?.applies ? state.need_meals : 0
  const needDrinks = state?.applies ? state.need_drinks : 0
  const priceOf = (d: Dish | undefined) =>
    !d || !state ? 0 : isDrinkCategory(d.category) ? state.drink_price : state.meal_price + (d.premium_paise ?? 0)
  const total = items.reduce((sum, i) => {
    const d = dishById.get(i.dish)
    const addonSum = Object.entries(i.addons).reduce((s, [id, n]) => s + (addonById.get(id)?.price_per_meal ?? 0) * n, 0)
    return sum + priceOf(d) * i.qty + addonSum
  }, 0)
  const planAddonCount = (id: string) => items.filter((i) => i.kind === 'meal').reduce((n, i) => n + (i.addons[id] ?? 0), 0)

  const shortBy = Math.max(needMeals - meals, 0)
  const shortDrinks = Math.max(needDrinks - drinks, 0)
  const empty = items.length === 0
  const canSave = !!state && !state.locked && !empty && shortBy === 0 && shortDrinks === 0

  // ── Changing the cart ────────────────────────────────────────────────────
  function qtyOfDish(id: string) {
    return items.filter((i) => i.dish === id).reduce((n, i) => n + i.qty, 0)
  }

  function addDish(d: Dish) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setError('')
    const kind: Item['kind'] = isDrinkCategory(d.category) ? 'drink' : 'meal'
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, addons: { ...i.addons } }))
      // The plan's add-ons follow the meals: a meal added while they're short gets them.
      const planShort = kind === 'meal'
        ? planAddons.filter((id) => next.filter((i) => i.kind === 'meal').reduce((n, i) => n + (i.addons[id] ?? 0), 0) < needMeals)
        : []
      const same = next.find((i) => i.dish === d.id && (kind === 'drink' || planShort.every((id) => (i.addons[id] ?? 0) === i.qty)))
      if (same && same.qty < 10) {
        same.qty += 1
        for (const id of planShort) same.addons[id] = (same.addons[id] ?? 0) + 1
        return next
      }
      next.push({ key: newKey(), kind, dish: d.id, qty: 1, addons: Object.fromEntries(planShort.map((id) => [id, 1])) })
      return next
    })
  }

  function removeDish(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setError('')
    setItems((prev) => {
      const next = prev.map((i) => ({ ...i, addons: { ...i.addons } }))
      // Take from the last item of that dish.
      const idx = [...next].reverse().findIndex((i) => i.dish === id)
      if (idx < 0) return prev
      const it = next[next.length - 1 - idx]
      it.qty -= 1
      // An add-on can't outnumber its meal's portions.
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
      // The plan's add-ons stay on the plan's meals.
      if (delta < 0 && planAddons.includes(addonId) && planAddonCount(addonId) - 1 < needMeals) {
        setError(`${addonById.get(addonId)?.name ?? 'That add-on'} comes with your plan's meals.`)
        return i
      }
      const addonsNext = { ...i.addons, [addonId]: want }
      if (want === 0) delete addonsNext[addonId]
      return { ...i, addons: addonsNext }
    }))
  }

  // ── Save / skip ──────────────────────────────────────────────────────────
  async function save() {
    if (!state || !canSave) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)
    setError('')
    const payload = items.map((i) => ({
      kind: i.kind,
      dish: i.dish,
      qty: i.qty,
      ...(i.kind === 'meal'
        ? { addons: Object.entries(i.addons).filter(([, n]) => n > 0).map(([id, n]) => ({ id, qty: n })) }
        : {}),
    }))
    const { error: err } = await supabase.rpc('save_day_cart', {
      p_sub: state.subscription_id, p_date: date, p_slot: slot, p_items: payload,
    })
    setSaving(false)
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(err.message || 'Could not save. Please try again.')
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    router.back()
  }

  // Skip needs a double tap so nobody skips a meal by accident.
  async function onSkipPress() {
    const now = Date.now()
    if (now - lastSkipTap.current > 450) {
      lastSkipTap.current = now
      setSkipHint(true)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      return
    }
    lastSkipTap.current = 0
    setSkipHint(false)
    if (!state) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)
    const { data: { session } } = await supabase.auth.getSession()
    const { error: err } = await supabase.functions.invoke('manage-subscription', {
      body: { action: 'skip', subscription_id: state.subscription_id, delivery_date: date, meal_slot: slot },
      headers: { Authorization: `Bearer ${session?.access_token}` },
    })
    setSaving(false)
    if (err) {
      setError(await extractFunctionErrorMessage(err, 'Could not skip it. Please try again.'))
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    Alert.alert('Meal skipped', `Your ${slot} on ${fmtDay(date)} is skipped — nothing is charged. You can bring it back in My Plan before the cutoff.`)
    router.back()
  }

  // ── Menu sections ────────────────────────────────────────────────────────
  const sections = useMemo(() => {
    const avail = (d: Dish) => isMealAvailable({ unavailableMeals }, date, d.id)
    const mealCats = categories.filter((c) => !isDrinkCategory(c.id))
    const out: { id: string; name: string; dishes: Dish[] }[] = []
    for (const c of mealCats) {
      const list = dishes.filter((d) => d.category === c.id && avail(d))
      if (list.length) out.push({ id: c.id, name: c.name, dishes: list })
    }
    const known = new Set(mealCats.map((c) => c.id))
    const other = dishes.filter((d) => !known.has(d.category) && !isDrinkCategory(d.category) && avail(d))
    if (other.length) out.push({ id: 'other', name: 'More', dishes: other })
    for (const s of DRINK_SECTIONS) {
      const list = dishes.filter((d) => d.category === s.id && avail(d))
      if (list.length) out.push({ id: s.id, name: s.name, dishes: list })
    }
    return out
  }, [categories, dishes, unavailableMeals, date])

  if (loading) {
    return <View style={[st.center, { paddingTop: insets.top }]}><ActivityIndicator color={Colors.primary} /></View>
  }
  if (!state) {
    return (
      <View style={[st.center, { paddingTop: insets.top }]}>
        <Text style={st.muted}>You need a live plan to customise meals.</Text>
      </View>
    )
  }

  const slotLabel = slot === 'lunch' ? 'Lunch' : 'Dinner'

  return (
    <View style={st.container}>
      <View style={[st.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={st.backBtn}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title}>Customize {slotLabel.toLowerCase()}</Text>
          <Text style={st.subtitle}>{fmtDay(date)}</Text>
        </View>
      </View>

      {state.locked ? (
        <View style={st.lockBox}>
          <Lock size={16} color={Colors.textMuted} />
          <Text style={st.muted}>This {slotLabel.toLowerCase()} is already being prepared — changes close at {slot === 'lunch' ? '9 AM' : '2 PM'}.</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={{ paddingBottom: 180 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {/* ── Your cart ── */}
        <Text style={st.section}>Your cart</Text>
        {state.applies ? (
          <Text style={st.hint}>
            Your plan: {needMeals} meal{needMeals === 1 ? '' : 's'}{needDrinks > 0 ? ` + ${needDrinks} drink${needDrinks === 1 ? '' : 's'}` : ''}.
            Swap anything you like — to have less, skip this {slotLabel.toLowerCase()}.
          </Text>
        ) : (
          <Text style={st.hint}>No meal from your plan this {slotLabel.toLowerCase()} — add anything you'd like.</Text>
        )}
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
                <Stepper qty={i.qty} disabled={state.locked} onMinus={() => removeDish(i.dish)} onPlus={() => d && addDish(d)} />
              </View>
              {i.kind === 'meal' && addons.length > 0 && !state.locked && (
                <Pressable style={st.addonToggle} onPress={() => setOpen(isOpen ? null : i.key)} hitSlop={6}>
                  <Text style={st.link}>Add-ons</Text>
                  {isOpen ? <ChevronUp size={14} color={Colors.primary} /> : <ChevronDown size={14} color={Colors.primary} />}
                </Pressable>
              )}
              {isOpen && (
                <View style={st.addonList}>
                  {addons.map((a) => {
                    const n = i.addons[a.id] ?? 0
                    const plan = planAddons.includes(a.id)
                    return (
                      <View key={a.id} style={st.addonRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={st.addonName}>{a.name}{plan ? ' · with your plan' : ''}</Text>
                          <Text style={st.cartSub}>+{rupees(a.price_per_meal)} each</Text>
                        </View>
                        <Stepper qty={n} onMinus={() => setAddon(i.key, a.id, -1)} onPlus={() => setAddon(i.key, a.id, +1)} />
                      </View>
                    )
                  })}
                </View>
              )}
            </View>
          )
        })}

        {/* ── Menu ── */}
        {!state.locked && sections.map((sec) => (
          <View key={sec.id}>
            <Text style={st.section}>{sec.name}</Text>
            {sec.dishes.map((d) => {
              const n = qtyOfDish(d.id)
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
                      {rupees(priceOf(d))}{(d.premium_paise ?? 0) > 0 ? `  ·  premium +${rupees(d.premium_paise!)}` : ''}
                    </Text>
                  </View>
                  {n === 0 ? (
                    <Pressable style={st.addBtn} onPress={() => addDish(d)}>
                      <Text style={st.addBtnText}>ADD</Text>
                    </Pressable>
                  ) : (
                    <Stepper qty={n} onMinus={() => removeDish(d.id)} onPlus={() => addDish(d)} />
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
          <Text style={[st.barCount, shortBy > 0 && st.barShort]}>
            {state.applies ? `${meals}/${needMeals} meal${needMeals === 1 ? '' : 's'}` : `${meals} meal${meals === 1 ? '' : 's'}`}
          </Text>
          {(needDrinks > 0 || drinks > 0) && (
            <Text style={[st.barCount, shortDrinks > 0 && st.barShort]}>
              {' · '}{state.applies && needDrinks > 0 ? `${drinks}/${needDrinks}` : drinks} drink{(needDrinks || drinks) === 1 ? '' : 's'}
            </Text>
          )}
          <Text style={st.barTotal}>{rupees(total)}</Text>
        </View>
        {error ? <Text style={st.error}>{error}</Text> : (
          shortBy > 0 || shortDrinks > 0 ? (
            <Text style={st.barHint}>
              Add {shortBy > 0 ? `${shortBy} more meal${shortBy === 1 ? '' : 's'}` : ''}{shortBy > 0 && shortDrinks > 0 ? ' and ' : ''}{shortDrinks > 0 ? `${shortDrinks} more drink${shortDrinks === 1 ? '' : 's'}` : ''} — or skip this {slotLabel.toLowerCase()}.
            </Text>
          ) : skipHint ? <Text style={st.barHint}>Double-tap Skip to skip this {slotLabel.toLowerCase()}.</Text> : null
        )}
        <View style={st.barBtns}>
          {state.applies && !state.locked && (
            <Pressable style={st.skipBtn} onPress={onSkipPress} disabled={saving}>
              <Text style={st.skipText}>Skip</Text>
            </Pressable>
          )}
          <Pressable style={[st.saveBtn, (!canSave || saving) && st.saveOff]} onPress={save} disabled={!canSave || saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.saveText}>Save cart</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  )
}

function Stepper({ qty, onMinus, onPlus, disabled }: { qty: number; onMinus: () => void; onPlus: () => void; disabled?: boolean }) {
  return (
    <View style={[st.stepper, disabled && { opacity: 0.4 }]}>
      <Pressable onPress={onMinus} disabled={disabled || qty <= 0} hitSlop={8} style={st.stepBtn}>
        <Minus size={14} color={Colors.primary} strokeWidth={2.5} />
      </Pressable>
      <Text style={st.stepQty}>{qty}</Text>
      <Pressable onPress={onPlus} disabled={disabled || qty >= 10} hitSlop={8} style={st.stepBtn}>
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
  lockBox: { flexDirection: 'row', gap: 8, alignItems: 'center', marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: Colors.surface },
  section: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.text, marginTop: 18, marginBottom: 8, marginHorizontal: 16 },
  hint: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginHorizontal: 16, marginBottom: 10, lineHeight: 17 },
  muted: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, flexShrink: 1 },
  cartRow: { backgroundColor: '#fff', borderRadius: 14, marginHorizontal: 16, marginBottom: 8, padding: 12, borderWidth: 1, borderColor: Colors.borderFaint },
  cartTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cartName: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  cartSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  addonToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, alignSelf: 'flex-start' },
  link: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },
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
  barBtns: { flexDirection: 'row', gap: 10, marginTop: 10 },
  skipBtn: { paddingHorizontal: 20, borderRadius: 999, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  skipText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textMuted },
  saveBtn: { flex: 1, backgroundColor: Colors.primary, borderRadius: 999, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  saveOff: { opacity: 0.4 },
  saveText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
