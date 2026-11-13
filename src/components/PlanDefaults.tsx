// Plan & settings → "My default meal" and "My dishes" (migrations 080, 087).
//
// The customer changes three things for every meal to come: portions for the
// lunch / dinner they chose at sign-up (at least 1 — a slot they didn't choose
// stays off), delivery days, and a dish of their own per slot — for every day
// or for a weekday — instead of the chef's weekly menu. Add-ons are shown, not
// changed (087). Saved through set_my_plan_defaults / set_my_meal_rule, which
// re-sync the plan's open meals (days changed by hand stay as they are); then
// instantiate-orders fills any new days. The wallet is the plan (079), so the
// price per meal and "about N meals left" update live as portions change.
//
// Delivery days can be none at all (089): then nothing is delivered and the
// customer walks in or adds a meal day by day. That is a flag on the plan
// (subscriptions.no_delivery_days), NOT an empty schedule — a plan with no
// schedule rows and no flag still means every day the kitchen cooks.
import { useCallback, useEffect, useState } from 'react'
import { friendlyError } from '@/lib/friendlyError'
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Minus, Plus, Check, Lock, ChevronRight, X, Sun, Moon } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { isDrinkCategory, DRINK_TAGLINE } from '@/constants/drinks'

type Slot = 'lunch' | 'dinner'
type PlanAddon = { id: string; name: string; sub_option: string | null; is_drink: boolean }
type Rule = { id: string; slot: Slot; day: number | null; meal_id: string; meal_name: string; set_by: 'admin' | 'customer'; available: boolean }
type Dish = { id: string; name: string; category: string | null }
type MenuRow = { day_of_week: number; meal_slot: Slot; meal_templates: { id: string; name: string } | null }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// Onboarding has no upper limit; the server stops at 10.
const MAX_PER_SLOT = 10

function fmt(paise: number) {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

type Defaults = { lunch: number; dinner: number; days: string[] }

export default function PlanDefaults({ subId, onChanged }: { subId: string; onChanged: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<Defaults | null>(null)
  const [draft, setDraft] = useState<Defaults | null>(null)
  const [planAddons, setPlanAddons] = useState<PlanAddon[]>([])
  const [mealCost, setMealCost] = useState(0)  // one portion: plan price + its add-ons
  const [money, setMoney] = useState(0)        // wallet + cash still owed
  const [rules, setRules] = useState<Rule[]>([])
  const [menu, setMenu] = useState<MenuRow[]>([])
  const [dishes, setDishes] = useState<Dish[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [picker, setPicker] = useState<{ slot: Slot; day: number | null } | null>(null)
  // Sunday deliveries are arranged by the office only (083): shown, not editable.
  const [sundayByOffice, setSundayByOffice] = useState(false)
  // Walk-in comes with some plans only (plans.allow_pickup, 087): the "no
  // deliveries" hint mentions it only when the plan has it.
  const [walkInAllowed, setWalkInAllowed] = useState(false)

  const load = useCallback(async () => {
    const [subRes, costRes, rulesRes, menuRes, dishRes] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('meals_lunch, meals_dinner, no_delivery_days, plans ( allow_pickup ), subscription_schedule ( day_of_week ), subscription_addons ( addon_id, sub_option, addons ( name, is_drink ) )')
        .eq('id', subId)
        .single(),
      supabase.rpc('my_meal_cost'),
      supabase.rpc('my_meal_rules'),
      supabase.from('weekly_menu').select('day_of_week, meal_slot, meal_templates ( id, name )').eq('menu_type', 'M1'),
      supabase.from('meal_templates').select('id, name, category').eq('is_active', true).eq('subscription_valid', true).order('category').order('name'),
    ])
    const sub = subRes.data as any
    if (sub) {
      const scheduled = ((sub.subscription_schedule ?? []) as { day_of_week: string }[]).map((r) => r.day_of_week)
      setSundayByOffice(scheduled.includes('Sun'))
      const planRef = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
      setWalkInAllowed(!!planRef?.allow_pickup)
      const d: Defaults = {
        lunch: sub.meals_lunch ?? 0,
        dinner: sub.meals_dinner ?? 0,
        days: scheduled.filter((x) => x !== 'Sun'),
      }
      // A plan with no schedule rows at all means every day the kitchen cooks
      // (instantiate-orders' fallback) — unless the customer chose no delivery
      // days (089), which shows as none selected. (A Sunday-only schedule has
      // rows, so it also shows none rather than a wrong "every day".)
      if (scheduled.length === 0 && !sub.no_delivery_days) d.days = [...DAYS]
      setSaved(d)
      setDraft(d)
    }
    if (sub) {
      type AddonRef = { name: string; is_drink: boolean | null }
      type Row = { addon_id: string; sub_option: string | null; addons: AddonRef | AddonRef[] | null }
      setPlanAddons(((sub.subscription_addons ?? []) as Row[]).map((a) => {
        const ad = Array.isArray(a.addons) ? a.addons[0] : a.addons
        return { id: a.addon_id, name: ad?.name ?? a.addon_id, sub_option: a.sub_option, is_drink: !!ad?.is_drink }
      }))
    }
    const cost = costRes.data as { meal_cost?: number; wallet?: number; cash_due?: number } | null
    if (cost) {
      // Add-ons don't change here (087), so the plan's meal cost is the cost
      // of every portion.
      setMealCost(cost.meal_cost ?? 0)
      setMoney((cost.wallet ?? 0) + (cost.cash_due ?? 0))
    }
    setRules(((rulesRes.data ?? []) as Rule[]))
    setMenu((menuRes.data ?? []) as unknown as MenuRow[])
    // Drinks (smoothie, coffee) are picked per day in My Plan, never as a meal.
    setDishes(((dishRes.data ?? []) as Dish[]).filter((d) => !isDrinkCategory(d.category)))
  }, [subId])

  useEffect(() => {
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  const mealsLeft = mealCost > 0 ? Math.max(Math.floor(money / mealCost), 0) : 0

  const dirty = !!draft && !!saved && (
    draft.lunch !== saved.lunch || draft.dinner !== saved.dinner ||
    [...draft.days].sort().join() !== [...saved.days].sort().join()
  )
  // Lunch / dinner as chosen at sign-up: a slot they have keeps at least 1.
  const hasLunch = (saved?.lunch ?? 0) > 0
  const hasDinner = (saved?.dinner ?? 0) > 0
  // No delivery days is a valid choice (089); only portions need a minimum.
  const valid = !!draft && (!hasLunch || draft.lunch >= 1) && (!hasDinner || draft.dinner >= 1)

  function update(patch: Partial<Defaults>) {
    if (!draft) return
    setMessage(null)
    setDraft({ ...draft, ...patch })
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
    const noDays = draft.days.length === 0
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setSaving(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('set_my_plan_defaults', {
      p_sub: subId,
      p_meals_lunch: draft.lunch,
      p_meals_dinner: draft.dinner,
      p_days: draft.days,
      p_addons: null,
    })
    if (error) {
      setSaving(false)
      setMessage({ ok: false, text: friendlyError(error, 'Could not save. Please try again.') })
      return
    }
    // Nothing new to schedule when there are no delivery days.
    if (!noDays) await fillNewDays()
    await load()
    setSaving(false)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    const r = data as { updated?: number; cancelled?: number } | null
    if (noDays) {
      const removed = r?.cancelled ? ` ${r.cancelled} upcoming meal${r.cancelled === 1 ? '' : 's'} removed.` : ''
      setMessage({ ok: true, text: `Saved — no deliveries.${removed} Days you changed by hand stay as they are.` })
    } else {
      const parts = [`${r?.updated ?? 0} upcoming meal${r?.updated === 1 ? '' : 's'} updated`]
      if (r?.cancelled) parts.push(`${r.cancelled} on days you turned off removed`)
      setMessage({ ok: true, text: `Saved — ${parts.join(', ')}. Days you changed by hand stay as they are.` })
    }
    onChanged()
  }

  async function setDish(slot: Slot, day: number | null, mealId: string | null) {
    setPicker(null)
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.rpc('set_my_meal_rule', { p_slot: slot, p_day: day, p_meal: mealId })
    if (error) {
      setSaving(false)
      setMessage({ ok: false, text: friendlyError(error, 'Could not change the dish. Please try again.') })
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
  // The drink (088) is shown apart from the add-ons.
  const hasDrink = planAddons.some((a) => a.is_drink)
  const otherAddons = planAddons.filter((a) => !a.is_drink)

  return (
    <>
      {/* ── My default meal ─────────────────────────────────────────────── */}
      <Text style={st.sectionTitle}>My default meal</Text>
      <View style={st.card}>
        <Text style={st.cardLead}>What every delivery brings unless you change that day.</Text>

        {slots.map((sl) => {
          const n = sl === 'lunch' ? draft.lunch : draft.dinner
          const Icon = sl === 'lunch' ? Sun : Moon
          const atMin = n <= 1
          return (
            <View key={sl} style={st.stepRow}>
              <Icon size={17} color={Colors.primary} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{sl === 'lunch' ? 'Lunch' : 'Dinner'}</Text>
                <Text style={st.rowSub}>{`${n} portion${n === 1 ? '' : 's'}`}</Text>
              </View>
              <Pressable
                style={[st.stepBtn, atMin && st.stepBtnOff]}
                disabled={atMin}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); update(sl === 'lunch' ? { lunch: n - 1 } : { dinner: n - 1 }) }}
                hitSlop={6}
              >
                <Minus size={16} color={atMin ? Colors.textLight : Colors.primary} />
              </Pressable>
              <Text style={st.stepVal}>{n}</Text>
              <Pressable
                style={[st.stepBtn, n >= MAX_PER_SLOT && st.stepBtnOff]}
                disabled={n >= MAX_PER_SLOT}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); update(sl === 'lunch' ? { lunch: n + 1 } : { dinner: n + 1 }) }}
                hitSlop={6}
              >
                <Plus size={16} color={n >= MAX_PER_SLOT ? Colors.textLight : Colors.primary} />
              </Pressable>
            </View>
          )
        })}

        {hasDrink && (
          <>
            <Text style={st.subhead}>Drink</Text>
            <View style={st.lockedBox}>
              <Lock size={14} color={Colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{DRINK_TAGLINE}</Text>
                <Text style={st.rowSub}>The kitchen picks a fresh one daily — swap it for any day from My Plan → Customize. To add or remove the drink, message us on WhatsApp.</Text>
              </View>
            </View>
          </>
        )}

        <Text style={st.subhead}>Add-ons with every meal</Text>
        <View style={st.lockedBox}>
          <Lock size={14} color={Colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={st.rowTitle}>
              {otherAddons.length === 0
                ? 'None'
                : otherAddons.map((a) => `${a.name}${a.sub_option ? ` (${a.sub_option})` : ''}`).join(', ')}
            </Text>
            <Text style={st.rowSub}>Add-ons stay as you chose when you joined. Message us on WhatsApp to change them.</Text>
          </View>
        </View>

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
          {sundayByOffice && (
            <View style={[st.dayChip, st.dayChipOn, st.dayChipLocked]}>
              <Text style={[st.dayChipText, st.dayChipTextOn]}>Su</Text>
            </View>
          )}
        </View>
        {draft.days.length === 0 && (
          <Text style={st.rowSub}>
            {sundayByOffice ? 'No regular deliveries' : 'No deliveries'}
            {walkInAllowed
              ? ' — you can still walk in or add a meal on any day.'
              : ' — you can still add a meal on any day from My Plan.'}
          </Text>
        )}
        <Text style={st.rowSub}>
          {sundayByOffice
            ? 'Sunday delivery is arranged by GreenFeast — message us on WhatsApp to change it.'
            : 'Sunday is our day off.'}
        </Text>

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

        {!valid && <Text style={st.error}>Keep at least one portion.</Text>}
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
  dayChipLocked: { opacity: 0.6 },
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
