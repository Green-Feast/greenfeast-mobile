// Plan & settings → "My default meal" and "My dishes" (migration 080).
//
// The customer sets, for every meal to come: portions per slot (0 = that slot
// off), default add-ons, delivery days, and a dish of their own per slot —
// for every day or for a weekday — instead of the chef's weekly menu. Saved
// through set_my_plan_defaults / set_my_meal_rule, which re-sync the plan's
// open meals (days changed by hand stay as they are); then instantiate-orders
// fills any new days. The wallet is the plan (079), so the price per meal and
// "about N meals left" update live as the default meal changes.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Minus, Plus, Check, Lock, ChevronRight, X, Sun, Moon } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'

type Slot = 'lunch' | 'dinner'
type Addon = { id: string; name: string; price_per_meal: number; description: string | null }
type Rule = { id: string; slot: Slot; day: number | null; meal_id: string; meal_name: string; set_by: 'admin' | 'customer'; available: boolean }
type Dish = { id: string; name: string; category: string | null }
type MenuRow = { day_of_week: number; meal_slot: Slot; meal_templates: { id: string; name: string } | null }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const VARIANTS: Record<string, string[]> = {
  smoothie: ['Berry Banana Protein', 'Watermelon Mint Chia', 'Creamy Avocado'],
  cheese: ['Feta', 'Parmesan', 'Cheddar'],
}
const MAX_PER_SLOT = 3

function fmt(paise: number) {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

type Defaults = { lunch: number; dinner: number; days: string[]; addons: Record<string, string | null> }

export default function PlanDefaults({ subId, onChanged }: { subId: string; onChanged: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<Defaults | null>(null)
  const [draft, setDraft] = useState<Defaults | null>(null)
  const [catalogue, setCatalogue] = useState<Addon[]>([])
  const [rate, setRate] = useState(0)          // the plan's meal price, without add-ons
  const [money, setMoney] = useState(0)        // wallet + cash still owed
  const [rules, setRules] = useState<Rule[]>([])
  const [menu, setMenu] = useState<MenuRow[]>([])
  const [dishes, setDishes] = useState<Dish[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [variantFor, setVariantFor] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ slot: Slot; day: number | null } | null>(null)

  const load = useCallback(async () => {
    const [subRes, addonRes, costRes, rulesRes, menuRes, dishRes] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('meals_lunch, meals_dinner, subscription_schedule ( day_of_week ), subscription_addons ( addon_id, sub_option )')
        .eq('id', subId)
        .single(),
      supabase.from('addons').select('id, name, price_per_meal, description').eq('is_active', true).order('price_per_meal'),
      supabase.rpc('my_meal_cost'),
      supabase.rpc('my_meal_rules'),
      supabase.from('weekly_menu').select('day_of_week, meal_slot, meal_templates ( id, name )').eq('menu_type', 'M1'),
      supabase.from('meal_templates').select('id, name, category').eq('is_active', true).eq('subscription_valid', true).order('category').order('name'),
    ])
    const sub = subRes.data as any
    if (sub) {
      const d: Defaults = {
        lunch: sub.meals_lunch ?? 0,
        dinner: sub.meals_dinner ?? 0,
        days: ((sub.subscription_schedule ?? []) as { day_of_week: string }[]).map((r) => r.day_of_week).filter((x) => x !== 'Sun'),
        addons: Object.fromEntries(((sub.subscription_addons ?? []) as { addon_id: string; sub_option: string | null }[]).map((a) => [a.addon_id, a.sub_option])),
      }
      // No days saved = every day the kitchen cooks (instantiate-orders' fallback).
      if (d.days.length === 0) d.days = [...DAYS]
      setSaved(d)
      setDraft(d)
    }
    const addons = (addonRes.data ?? []) as Addon[]
    setCatalogue(addons)
    const cost = costRes.data as { meal_cost?: number; wallet?: number; cash_due?: number } | null
    if (cost && sub) {
      // meal_cost includes the plan's current add-ons; take them out to get
      // the plan's own meal price, so the draft can add its own.
      const current = new Set(((sub.subscription_addons ?? []) as { addon_id: string }[]).map((x) => x.addon_id))
      const included = addons.filter((a) => current.has(a.id)).reduce((s, a) => s + a.price_per_meal, 0)
      setRate(Math.max((cost.meal_cost ?? 0) - included, 0))
      setMoney((cost.wallet ?? 0) + (cost.cash_due ?? 0))
    }
    setRules(((rulesRes.data ?? []) as Rule[]))
    setMenu((menuRes.data ?? []) as unknown as MenuRow[])
    setDishes((dishRes.data ?? []) as Dish[])
  }, [subId])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  const addonPerMeal = useMemo(
    () => (draft ? catalogue.filter((a) => a.id in draft.addons).reduce((s, a) => s + a.price_per_meal, 0) : 0),
    [draft, catalogue],
  )
  const mealCost = rate + addonPerMeal
  const mealsLeft = mealCost > 0 ? Math.max(Math.floor(money / mealCost), 0) : 0

  const dirty = !!draft && !!saved && (
    draft.lunch !== saved.lunch || draft.dinner !== saved.dinner ||
    [...draft.days].sort().join() !== [...saved.days].sort().join() ||
    JSON.stringify(Object.entries(draft.addons).sort()) !== JSON.stringify(Object.entries(saved.addons).sort())
  )
  const valid = !!draft && draft.lunch + draft.dinner >= 1 && draft.days.length >= 1

  function update(patch: Partial<Defaults>) {
    if (!draft) return
    setMessage(null)
    setDraft({ ...draft, ...patch })
  }

  function toggleAddon(a: Addon) {
    if (!draft) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const next = { ...draft.addons }
    if (a.id in next) {
      delete next[a.id]
    } else {
      next[a.id] = null
      if (VARIANTS[a.id]) setVariantFor(a.id)
    }
    update({ addons: next })
  }

  function toggleDay(d: string) {
    if (!draft) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    update({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] })
  }

  async function fillNewDays() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await supabase.functions.invoke('instantiate-orders', {
      body: { subscription_id: subId },
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
  }

  async function save() {
    if (!draft || !valid) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('set_my_plan_defaults', {
      p_sub: subId,
      p_meals_lunch: draft.lunch,
      p_meals_dinner: draft.dinner,
      p_days: draft.days,
      p_addons: Object.entries(draft.addons).map(([id, sub_option]) => ({ id, sub_option })),
    })
    if (error) {
      setSaving(false)
      setMessage({ ok: false, text: error.message || 'Could not save. Please try again.' })
      return
    }
    await fillNewDays()
    await load()
    setSaving(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const r = data as { updated?: number; cancelled?: number } | null
    const parts = [`${r?.updated ?? 0} upcoming meal${r?.updated === 1 ? '' : 's'} updated`]
    if (r?.cancelled) parts.push(`${r.cancelled} on days you turned off removed`)
    setMessage({ ok: true, text: `Saved — ${parts.join(', ')}. Days you changed by hand stay as they are.` })
    onChanged()
  }

  async function setDish(slot: Slot, day: number | null, mealId: string | null) {
    setPicker(null)
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.rpc('set_my_meal_rule', { p_slot: slot, p_day: day, p_meal: mealId })
    if (error) {
      setSaving(false)
      setMessage({ ok: false, text: error.message || 'Could not change the dish. Please try again.' })
      return
    }
    await load()
    setSaving(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setMessage({ ok: true, text: 'Dish saved — your upcoming meals follow it. Days you changed by hand stay as they are.' })
    onChanged()
  }

  if (loading || !draft) {
    return <View style={st.card}><ActivityIndicator color={Colors.primary} style={{ marginVertical: 24 }} /></View>
  }

  const slots: Slot[] = (['lunch', 'dinner'] as Slot[]).filter((sl) => (sl === 'lunch' ? saved?.lunch : saved?.dinner))

  return (
    <>
      {/* ── My default meal ─────────────────────────────────────────────── */}
      <Text style={st.sectionTitle}>My default meal</Text>
      <View style={st.card}>
        <Text style={st.cardLead}>What every delivery brings unless you change that day.</Text>

        {(['lunch', 'dinner'] as Slot[]).map((sl) => {
          const n = sl === 'lunch' ? draft.lunch : draft.dinner
          const Icon = sl === 'lunch' ? Sun : Moon
          return (
            <View key={sl} style={st.stepRow}>
              <Icon size={17} color={Colors.primary} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{sl === 'lunch' ? 'Lunch' : 'Dinner'}</Text>
                <Text style={st.rowSub}>{n === 0 ? 'Off' : `${n} portion${n === 1 ? '' : 's'}`}</Text>
              </View>
              <Pressable
                style={[st.stepBtn, n === 0 && st.stepBtnOff]}
                disabled={n === 0}
                onPress={() => update(sl === 'lunch' ? { lunch: n - 1 } : { dinner: n - 1 })}
                hitSlop={6}
              >
                <Minus size={16} color={n === 0 ? Colors.textLight : Colors.primary} />
              </Pressable>
              <Text style={st.stepVal}>{n}</Text>
              <Pressable
                style={[st.stepBtn, n >= MAX_PER_SLOT && st.stepBtnOff]}
                disabled={n >= MAX_PER_SLOT}
                onPress={() => update(sl === 'lunch' ? { lunch: n + 1 } : { dinner: n + 1 })}
                hitSlop={6}
              >
                <Plus size={16} color={n >= MAX_PER_SLOT ? Colors.textLight : Colors.primary} />
              </Pressable>
            </View>
          )
        })}

        <Text style={st.subhead}>Add-ons with every meal</Text>
        {catalogue.map((a) => {
          const on = a.id in draft.addons
          const variant = draft.addons[a.id]
          return (
            <Pressable key={a.id} style={[st.addonRow, on && st.addonRowOn]} onPress={() => toggleAddon(a)}>
              <View style={[st.check, on && st.checkOn]}>{on && <Check size={13} color="#fff" strokeWidth={3} />}</View>
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{a.name}{on && variant ? ` · ${variant}` : ''}</Text>
                {on && VARIANTS[a.id] ? (
                  <Pressable onPress={() => setVariantFor(a.id)} hitSlop={6}>
                    <Text style={st.link}>{variant ? 'Change flavour' : 'Pick a flavour'} ›</Text>
                  </Pressable>
                ) : a.description ? <Text style={st.rowSub}>{a.description}</Text> : null}
              </View>
              <Text style={st.price}>+₹{fmt(a.price_per_meal)}</Text>
            </Pressable>
          )
        })}

        <Text style={st.subhead}>Delivery days</Text>
        <View style={st.dayRow}>
          {DAYS.map((d) => {
            const on = draft.days.includes(d)
            return (
              <Pressable key={d} style={[st.dayChip, on && st.dayChipOn]} onPress={() => toggleDay(d)}>
                <Text style={[st.dayChipText, on && st.dayChipTextOn]}>{d.slice(0, 2)}</Text>
              </Pressable>
            )
          })}
        </View>
        <Text style={st.rowSub}>Sunday is our day off.</Text>

        <View style={st.costBox}>
          <View style={st.costRow}>
            <Text style={st.costLabel}>Each meal</Text>
            <Text style={st.costValue}>₹{fmt(mealCost)}</Text>
          </View>
          <View style={st.costRow}>
            <Text style={st.costLabel}>Your wallet pays for</Text>
            <Text style={st.costValueGreen}>about {mealsLeft} meal{mealsLeft === 1 ? '' : 's'}</Text>
          </View>
          {draft.lunch + draft.dinner > 1 && (
            <Text style={st.rowSub}>Each portion is one meal, so {draft.lunch + draft.dinner} portions a day use {draft.lunch + draft.dinner} meals.</Text>
          )}
        </View>

        {!valid && <Text style={st.error}>{draft.lunch + draft.dinner < 1 ? 'Keep at least one lunch or dinner.' : 'Pick at least one delivery day.'}</Text>}
        {message && <Text style={message.ok ? st.ok : st.error}>{message.text}</Text>}

        <Pressable
          style={({ pressed }) => [st.btn, (!dirty || !valid || saving) && st.btnOff, pressed && { opacity: 0.85 }]}
          disabled={!dirty || !valid || saving}
          onPress={save}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>Save changes</Text>}
        </Pressable>
      </View>

      {/* ── My dishes ───────────────────────────────────────────────────── */}
      {slots.length > 0 && (
        <>
          <Text style={st.sectionTitle}>My dishes</Text>
          <View style={st.card}>
            <Text style={st.cardLead}>Follow the chef's weekly menu, or pick a dish of your own — for every day or just some days.</Text>
            {slots.map((sl) => {
              const slotRules = rules.filter((r) => r.slot === sl)
              const locked = slotRules.some((r) => r.set_by === 'admin')
              const everyDay = slotRules.find((r) => r.day === null)
              return (
                <View key={sl} style={{ marginTop: 8 }}>
                  <Text style={st.subhead}>{sl === 'lunch' ? 'Lunch' : 'Dinner'}</Text>
                  {locked ? (
                    <View style={st.lockedBox}>
                      <Lock size={14} color={Colors.textMuted} />
                      <Text style={[st.rowSub, { flex: 1 }]}>
                        Set by GreenFeast: {slotRules.map((r) => `${r.meal_name}${r.day === null ? '' : ` on ${DAYS[r.day]}`}`).join(', ')}. Message us on WhatsApp to change it.
                      </Text>
                    </View>
                  ) : (
                    <>
                      <DishRow
                        label="Every day"
                        value={everyDay ? everyDay.meal_name : "Chef's weekly menu"}
                        own={!!everyDay}
                        onPress={() => setPicker({ slot: sl, day: null })}
                      />
                      {DAYS.map((d, i) => {
                        if (!saved?.days.includes(d)) return null
                        const own = slotRules.find((r) => r.day === i)
                        const menuDish = menu.find((m) => m.day_of_week === i && m.meal_slot === sl)?.meal_templates?.name
                        const value = own?.meal_name ?? everyDay?.meal_name ?? menuDish ?? '—'
                        return (
                          <DishRow
                            key={d}
                            label={DAY_NAMES[i]}
                            value={value}
                            own={!!own}
                            inherited={!own && !!everyDay}
                            onPress={() => setPicker({ slot: sl, day: i })}
                          />
                        )
                      })}
                    </>
                  )}
                </View>
              )
            })}
          </View>
        </>
      )}

      <VariantSheet
        addonId={variantFor}
        current={variantFor ? draft.addons[variantFor] ?? null : null}
        onPick={(v) => {
          if (variantFor) update({ addons: { ...draft.addons, [variantFor]: v } })
          setVariantFor(null)
        }}
        onClose={() => setVariantFor(null)}
      />
      <DishPicker
        target={picker}
        dishes={dishes}
        current={picker ? rules.find((r) => r.slot === picker.slot && r.day === picker.day)?.meal_id ?? null : null}
        menuDish={picker && picker.day !== null
          ? menu.find((m) => m.day_of_week === picker.day && m.meal_slot === picker.slot)?.meal_templates?.name ?? null
          : null}
        onPick={(mealId) => picker && setDish(picker.slot, picker.day, mealId)}
        onClose={() => setPicker(null)}
      />
    </>
  )
}

function DishRow({ label, value, own, inherited, onPress }: {
  label: string; value: string; own: boolean; inherited?: boolean; onPress: () => void
}) {
  return (
    <Pressable style={({ pressed }) => [st.dishRow, pressed && { opacity: 0.7 }]} onPress={onPress}>
      <Text style={st.dishDay}>{label}</Text>
      <Text style={[st.dishName, (own || inherited) && st.dishNameOwn]} numberOfLines={1}>
        {value}
      </Text>
      <ChevronRight size={15} color={Colors.textMuted} />
    </Pressable>
  )
}

function VariantSheet({ addonId, current, onPick, onClose }: {
  addonId: string | null; current: string | null; onPick: (v: string | null) => void; onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const options = addonId ? VARIANTS[addonId] ?? [] : []
  return (
    <Modal visible={!!addonId} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={[st.sheet, { paddingBottom: 24 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <View style={st.sheetHeader}>
            <Text style={st.sheetTitle}>Pick a flavour</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={Colors.textMuted} /></Pressable>
          </View>
          {options.map((o) => (
            <Pressable key={o} style={[st.addonRow, current === o && st.addonRowOn]} onPress={() => onPick(o)}>
              <Text style={[st.rowTitle, { flex: 1 }]}>{o}</Text>
              {current === o && <Check size={16} color={Colors.primary} />}
            </Pressable>
          ))}
          <Pressable style={st.addonRow} onPress={() => onPick(null)}>
            <Text style={[st.rowSub, { flex: 1 }]}>Chef's choice each day</Text>
            {!current && <Check size={16} color={Colors.primary} />}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

function DishPicker({ target, dishes, current, menuDish, onPick, onClose }: {
  target: { slot: Slot; day: number | null } | null
  dishes: Dish[]
  current: string | null
  menuDish: string | null
  onPick: (mealId: string | null) => void
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  if (!target) return null
  const when = target.day === null ? 'every day' : `on ${DAY_NAMES[target.day]}s`
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={[st.sheet, { maxHeight: '80%', paddingBottom: 16 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <View style={st.sheetHeader}>
            <Text style={st.sheetTitle}>{target.slot === 'lunch' ? 'Lunch' : 'Dinner'} {when}</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={Colors.textMuted} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Pressable style={[st.addonRow, !current && st.addonRowOn]} onPress={() => onPick(null)}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{target.day === null ? "Chef's weekly menu" : 'No pick for this day'}</Text>
                <Text style={st.rowSub}>
                  {target.day === null
                    ? 'A different dish each day of the week.'
                    : `Follows your every-day pick, or the weekly menu${menuDish ? ` (${menuDish})` : ''}.`}
                </Text>
              </View>
              {!current && <Check size={16} color={Colors.primary} />}
            </Pressable>
            {dishes.map((d) => (
              <Pressable key={d.id} style={[st.addonRow, current === d.id && st.addonRowOn]} onPress={() => onPick(d.id)}>
                <View style={{ flex: 1 }}>
                  <Text style={st.rowTitle}>{d.name}</Text>
                  {d.category ? <Text style={st.rowSub}>{d.category}</Text> : null}
                </View>
                {current === d.id && <Check size={16} color={Colors.primary} />}
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  sectionTitle: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.text, marginTop: 4, marginBottom: 10, marginLeft: 2 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  cardLead: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 12, lineHeight: 18 },
  subhead: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.text, marginTop: 14, marginBottom: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  stepBtn: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepBtnOff: { borderColor: Colors.border },
  stepVal: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, minWidth: 18, textAlign: 'center' },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },
  link: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, marginTop: 3 },
  price: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  addonRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: 8, backgroundColor: '#fff',
  },
  addonRowOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  check: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayRow: { flexDirection: 'row', gap: 6, marginBottom: 6 },
  dayChip: {
    flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', backgroundColor: '#fff',
  },
  dayChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayChipText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  dayChipTextOn: { color: '#fff' },
  costBox: { backgroundColor: Colors.primaryLight, borderRadius: 12, padding: 12, marginTop: 14, gap: 4 },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  costLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  costValue: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  costValueGreen: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.primary },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 10 },
  ok: { fontFamily: Fonts.body, fontSize: 13, color: Colors.primary, marginTop: 10 },
  btn: {
    backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, marginTop: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  btnOff: { opacity: 0.4 },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
  lockedBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.background, borderRadius: 10, padding: 10 },
  dishRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  dishDay: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, width: 86 },
  dishName: { flex: 1, fontFamily: Fonts.bodyMed, fontSize: 13, color: Colors.text },
  dishNameOwn: { fontFamily: Fonts.bodyBold, color: Colors.primary },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text },
})
