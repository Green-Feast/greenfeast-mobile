// My Plan → Walk-in (migration 087).
//
// A 30- or 60-meal subscriber walks into one of our places (11 AM–11 PM, any
// day) and eats their default meal there or takes it away. The structure is
// the plan's — the same add-ons, 1–2 portions (their default, or one more) —
// but the dish and any flavour are theirs to pick; dishes that are delivery
// only (not on the café menu) can't be a walk-in. One a day, separate from
// deliveries. start_walk_in returns a 6-digit code; the Counter hands the meal
// over and only then is it paid from the wallet. An unused code lapses at
// closing time, uncharged.
import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, ActivityIndicator, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Store, MapPin, Check, ChevronRight, X, UtensilsCrossed, ShoppingBag, Lock, AlertTriangle } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { ADDON_VARIANTS } from '@/constants/addonVariants'

type Place = {
  id: string
  name: string
  address: string
  maps_url: string | null
  offers_pickup: boolean
  offers_dine_in: boolean
  opens_at: string
  closes_at: string
}
type Mode = 'dine_in' | 'pickup'
type Dish = { id: string; name: string; category: string | null; kcal: number | null; protein: number | null }
type QuoteAddon = { id: string; name: string; sub_option: string | null }
type Today = {
  order_id: string
  code: string | null
  place: string
  mode: Mode
  status: string
  meal_name: string | null
  portions: number
  cost: number | null
  closes: string
  addons: { name: string; sub_option: string | null }[]
}
type Quote = {
  ok: boolean
  eligible?: boolean
  error?: string | null
  open_now?: boolean
  place?: string
  opens?: string
  closes?: string
  offers_pickup?: boolean
  offers_dine_in?: boolean
  default_meal_id?: string | null
  default_meal_name?: string | null
  default_meal_ok?: boolean
  dishes?: Dish[]
  addons?: QuoteAddon[]
  portions?: number[]
  portion_cost?: number
  spendable?: number
  today?: Today | null
}

const fmt = (paise: number) => (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })

// "11 AM", "4:30 PM"
function clock(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`
}

function usePlaces() {
  const [places, setPlaces] = useState<Place[] | null>(null)
  useEffect(() => {
    supabase
      .from('pickup_locations')
      .select('id, name, address, maps_url, offers_pickup, offers_dine_in, opens_at, closes_at')
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => setPlaces((data ?? []) as Place[]))
  }, [])
  return places
}

export default function WalkIn({ refreshKey }: { refreshKey: number }) {
  const places = usePlaces()
  const [state, setState] = useState<{ eligible: boolean; error?: string; today: Today | null } | null>(null)
  const [place, setPlace] = useState<Place | null>(null)

  const loadToday = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_walk_in_today')
    if (error) return setState({ eligible: false, error: 'Could not load Walk-in. Pull down to try again.', today: null })
    const d = data as { eligible: boolean; error?: string; today: Today | null }
    setState({ eligible: d.eligible, error: d.error, today: d.today ?? null })
  }, [])

  useEffect(() => { loadToday() }, [loadToday, refreshKey])

  if (!state || !places) return <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />

  if (!state.eligible) {
    return (
      <View style={st.card}>
        <View style={st.iconCircle}><Store size={20} color={Colors.primary} /></View>
        <Text style={st.cardTitle}>Eat at our café</Text>
        <Text style={st.lead}>{state.error || 'Walk-in comes with the 30- and 60-meal plans.'}</Text>
        <Text style={st.small}>Walk in any day from 11 AM to 11 PM and have your meal at our café, or take it away — paid from your wallet. Pick a 30- or 60-meal plan when you renew to get it.</Text>
      </View>
    )
  }

  if (state.today) return <TodayCard today={state.today} />

  return (
    <>
      <View style={st.intro}>
        <Text style={st.introTitle}>Eat at our café</Text>
        <Text style={st.lead}>
          Walk in any day, no booking. Your default meal, made fresh, paid from your wallet when it&apos;s handed over. One walk-in a day.
        </Text>
      </View>

      <Text style={st.sectionTitle}>Choose a place</Text>
      {places.length === 0 ? (
        <Text style={st.small}>No places are taking walk-ins right now.</Text>
      ) : places.map((p) => (
        <Pressable key={p.id} style={({ pressed }) => [st.placeCard, pressed && { opacity: 0.85 }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPlace(p) }}>
          <View style={st.iconCircle}><Store size={20} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.rowTitle}>{p.name}</Text>
            <Text style={st.rowSub}>{p.address}</Text>
            <Text style={st.rowSub}>
              {clock(p.opens_at)}–{clock(p.closes_at)} · {p.offers_dine_in && p.offers_pickup ? 'Eat here or takeaway' : p.offers_dine_in ? 'Eat here' : 'Takeaway'}
            </Text>
          </View>
          <ChevronRight size={18} color={Colors.textMuted} />
        </Pressable>
      ))}

      <OrderSheet
        place={place}
        onClose={() => setPlace(null)}
        onOrdered={(t) => { setPlace(null); setState({ eligible: true, today: t }) }}
      />
    </>
  )
}

function TodayCard({ today }: { today: Today }) {
  const done = today.status === 'delivered'
  const what = `${today.meal_name ?? 'Your meal'}${today.portions > 1 ? ` ×${today.portions}` : ''}`
  const extras = today.addons.map((a) => `${a.name}${a.sub_option ? ` (${a.sub_option})` : ''}`).join(', ')
  return (
    <View style={st.card}>
      <Text style={st.eyebrow}>Today&apos;s walk-in · {today.mode === 'dine_in' ? 'Eat here' : 'Takeaway'}</Text>
      <Text style={st.cardTitle}>{today.place}</Text>
      {done ? (
        <>
          <View style={[st.iconCircle, { marginTop: 12 }]}><Check size={20} color={Colors.primary} /></View>
          <Text style={st.lead}>Handed over — enjoy your meal! Your next walk-in can be tomorrow.</Text>
        </>
      ) : (
        <View style={{ alignItems: 'center', paddingVertical: 8 }}>
          <Text style={st.lead}>Show this code at the counter</Text>
          <Text style={st.code}>{today.code ? `${today.code.slice(0, 3)} ${today.code.slice(3)}` : '—'}</Text>
        </View>
      )}
      <View style={st.summaryBox}>
        <Text style={st.rowTitle}>{what}</Text>
        {!!extras && <Text style={st.rowSub}>{extras}</Text>}
        {today.cost != null && <Text style={st.rowSub}>₹{fmt(today.cost)} from your wallet{done ? '' : ' when it’s handed over'}</Text>}
      </View>
      {!done && (
        <Text style={st.small}>Valid until {today.closes} today. If you don&apos;t come, it isn&apos;t charged.</Text>
      )}
    </View>
  )
}

function OrderSheet({ place, onClose, onOrdered }: { place: Place | null; onClose: () => void; onOrdered: (t: Today) => void }) {
  const insets = useSafeAreaInsets()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [dishId, setDishId] = useState<string | null>(null)
  const [portions, setPortions] = useState(1)
  const [flavours, setFlavours] = useState<Record<string, string | null>>({})
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!place) return
    setQuote(null); setError(''); setPicking(false)
    supabase.rpc('walk_in_quote', { p_location: place.id }).then(({ data, error: err }) => {
      if (err) return setError(err.message || 'Could not load. Please try again.')
      const q = data as Quote
      setQuote(q)
      setMode(q.offers_dine_in ? 'dine_in' : q.offers_pickup ? 'pickup' : null)
      setDishId(q.default_meal_ok ? q.default_meal_id ?? null : null)
      setPortions(q.portions?.[0] ?? 1)
      setFlavours(Object.fromEntries((q.addons ?? []).map((a) => [a.id, a.sub_option])))
      if (q.today) onOrdered(q.today)
    })
  }, [place])

  const dishes = quote?.dishes ?? []
  const dish = dishes.find((d) => d.id === dishId) ?? null
  const cost = (quote?.portion_cost ?? 0) * portions
  const cantAfford = !!quote && (quote.spendable ?? 0) < cost
  const blocked = !quote?.ok || !quote.open_now || !mode || !dish || cantAfford
  const defaultIsDeliveryOnly = !!quote?.default_meal_id && !quote.default_meal_ok

  async function order() {
    if (!place || !quote || blocked || !mode || !dish) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setBusy(true); setError('')
    const { data, error: err } = await supabase.rpc('start_walk_in', {
      p_location: place.id,
      p_mode: mode,
      p_meal: dish.id,
      p_portions: portions,
      p_options: flavours,
    })
    setBusy(false)
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return setError(err.message || 'Could not place it. Please try again.')
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onOrdered(data as Today)
  }

  return (
    <Modal visible={!!place} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={[st.sheet, { paddingBottom: 16 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <View style={st.sheetHeader}>
            <Text style={st.sheetTitle} numberOfLines={1}>{place?.name}</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={Colors.textMuted} /></Pressable>
          </View>

          {!quote && !error ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: 32 }} />
          ) : quote && !quote.ok ? (
            <Text style={st.error}>{quote.error}</Text>
          ) : quote ? (
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
              {place && (
                <Pressable
                  style={st.placeLine}
                  disabled={!place.maps_url}
                  onPress={() => place.maps_url && Linking.openURL(place.maps_url)}
                >
                  <MapPin size={14} color={Colors.textMuted} />
                  <Text style={[st.rowSub, { flex: 1, marginTop: 0 }]}>
                    {place.address} · {quote.opens}–{quote.closes}{place.maps_url ? ' · Directions' : ''}
                  </Text>
                </Pressable>
              )}

              {!quote.open_now && (
                <View style={st.warnBox}>
                  <Text style={st.warnText}>Closed right now — walk-ins from {quote.opens} to {quote.closes}.</Text>
                </View>
              )}

              {/* Eat here / takeaway */}
              <Text style={st.subhead}>How</Text>
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

              {/* Dish */}
              <Text style={st.subhead}>Your meal</Text>
              {defaultIsDeliveryOnly && !dish && (
                <View style={st.warnBox}>
                  <AlertTriangle size={15} color={Colors.danger} />
                  <Text style={[st.warnText, { flex: 1 }]}>
                    {quote.default_meal_name} is for delivery only — it isn&apos;t served at our café. Pick another dish for your walk-in.
                  </Text>
                </View>
              )}
              <Pressable style={({ pressed }) => [st.pickRow, pressed && { opacity: 0.8 }]} onPress={() => setPicking(true)}>
                <View style={{ flex: 1 }}>
                  <Text style={st.rowTitle}>{dish ? dish.name : 'Pick a dish'}</Text>
                  <Text style={st.rowSub}>
                    {dish
                      ? dish.id === quote.default_meal_id ? "Today's default meal" : [dish.kcal ? `${dish.kcal} kcal` : null, dish.protein ? `${dish.protein}g protein` : null].filter(Boolean).join(' · ') || 'Your pick'
                      : 'Any dish on our café menu'}
                  </Text>
                </View>
                <Text style={st.link}>Change</Text>
              </Pressable>

              {/* Portions */}
              <Text style={st.subhead}>Portions</Text>
              <View style={st.segment}>
                {(quote.portions ?? [1]).map((n) => (
                  <Pressable key={n} style={[st.segBtn, portions === n && st.segBtnOn]} onPress={() => setPortions(n)}>
                    <Text style={[st.segText, portions === n && st.segTextOn]}>{n} portion{n === 1 ? '' : 's'}</Text>
                  </Pressable>
                ))}
              </View>
              {(quote.portions ?? []).length === 1 && <Text style={st.small}>A walk-in is up to 2 portions.</Text>}

              {/* Add-ons: fixed, flavours free */}
              {(quote.addons ?? []).length > 0 && (
                <>
                  <Text style={st.subhead}>With your meal</Text>
                  {(quote.addons ?? []).map((a) => {
                    const variants = ADDON_VARIANTS[a.id]
                    return (
                      <View key={a.id} style={st.addonRow}>
                        <View style={st.addonHead}>
                          <Lock size={13} color={Colors.textMuted} />
                          <Text style={[st.rowTitle, { flex: 1 }]}>{a.name}{portions > 1 ? ` ×${portions}` : ''}</Text>
                        </View>
                        {variants && (
                          <View style={st.chipRow}>
                            {variants.map((v) => {
                              const on = flavours[a.id] === v
                              return (
                                <Pressable key={v} style={[st.chip, on && st.chipOn]} onPress={() => setFlavours({ ...flavours, [a.id]: v })}>
                                  <Text style={[st.chipText, on && st.chipTextOn]}>{v}</Text>
                                </Pressable>
                              )
                            })}
                            <Pressable style={[st.chip, !flavours[a.id] && st.chipOn]} onPress={() => setFlavours({ ...flavours, [a.id]: null })}>
                              <Text style={[st.chipText, !flavours[a.id] && st.chipTextOn]}>Chef&apos;s choice</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    )
                  })}
                  <Text style={st.small}>Your plan&apos;s add-ons come with every walk-in.</Text>
                </>
              )}

              <View style={st.costBox}>
                <Text style={st.costLabel}>From your wallet</Text>
                <Text style={st.costValue}>₹{fmt(cost)}</Text>
              </View>
              {cantAfford && <Text style={st.error}>Your wallet doesn&apos;t have room for this walk-in — renew your plan to add meals.</Text>}
              {!!error && <Text style={st.error}>{error}</Text>}

              <Pressable
                style={({ pressed }) => [st.btn, (blocked || busy) && st.btnOff, pressed && { opacity: 0.85 }]}
                disabled={blocked || busy}
                onPress={order}
              >
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>Order walk-in</Text>}
              </Pressable>
              <Text style={st.small}>You get a code to show at the counter. It&apos;s paid when it&apos;s handed over, and isn&apos;t charged if you don&apos;t come.</Text>
            </ScrollView>
          ) : null}
          {!quote && !!error && <Text style={st.error}>{error}</Text>}
        </Pressable>
      </Pressable>

      {picking && quote && (
        <DishPicker
          dishes={dishes}
          current={dishId}
          defaultId={quote.default_meal_ok ? quote.default_meal_id ?? null : null}
          onPick={(id) => { setDishId(id); setPicking(false) }}
          onClose={() => setPicking(false)}
        />
      )}
    </Modal>
  )
}

function DishPicker({ dishes, current, defaultId, onPick, onClose }: {
  dishes: Dish[]; current: string | null; defaultId: string | null; onPick: (id: string) => void; onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const ordered = defaultId ? [...dishes].sort((a, b) => (a.id === defaultId ? -1 : b.id === defaultId ? 1 : 0)) : dishes
  return (
    <View style={[StyleSheet.absoluteFill, st.overlay]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={[st.sheet, { maxHeight: '80%', paddingBottom: 16 + insets.bottom }]}>
        <View style={st.sheetHeader}>
          <Text style={st.sheetTitle}>Pick a dish</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={20} color={Colors.textMuted} /></Pressable>
        </View>
        <Text style={[st.small, { textAlign: 'left', marginTop: 0, marginBottom: 10 }]}>Dishes on our café menu. Delivery-only dishes aren&apos;t served here.</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {ordered.map((d) => (
            <Pressable key={d.id} style={[st.pickRow, current === d.id && st.pickRowOn]} onPress={() => onPick(d.id)}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowTitle}>{d.name}</Text>
                <Text style={st.rowSub}>{d.id === defaultId ? "Today's default meal" : d.category ?? ''}</Text>
              </View>
              {current === d.id && <Check size={16} color={Colors.primary} />}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  intro: { marginBottom: 16 },
  introTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.text, marginBottom: 6 },
  sectionTitle: { fontFamily: Fonts.heading, fontSize: 17, color: Colors.text, marginBottom: 10, marginLeft: 2 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 18, marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  placeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  iconCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  cardTitle: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text, marginTop: 4 },
  lead: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginTop: 6 },
  small: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 10, lineHeight: 17, textAlign: 'center' },
  code: { fontFamily: Fonts.heading, fontSize: 44, letterSpacing: 6, color: Colors.primary, marginVertical: 10 },
  summaryBox: { backgroundColor: Colors.primaryLight, borderRadius: 12, padding: 12, marginTop: 12, gap: 2 },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },
  link: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  subhead: { fontFamily: Fonts.bodyBold, fontSize: 13, color: Colors.text, marginTop: 16, marginBottom: 8 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '92%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12 },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.text, flex: 1 },
  placeLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warnBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.dangerLight, borderRadius: 10, padding: 10, marginTop: 12 },
  warnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.danger, lineHeight: 18 },
  segment: { flexDirection: 'row', gap: 8 },
  segBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12,
    borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff',
  },
  segBtnOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text },
  segTextOn: { color: '#fff' },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12,
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: 8, backgroundColor: '#fff',
  },
  pickRowOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  addonRow: { padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.borderFaint, marginBottom: 8 },
  addonHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff' },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.textMuted },
  chipTextOn: { color: '#fff' },
  costBox: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.primaryLight, borderRadius: 12, padding: 12, marginTop: 16 },
  costLabel: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  costValue: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 10 },
  btn: {
    backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14, marginTop: 16,
    alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  btnOff: { opacity: 0.4 },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
