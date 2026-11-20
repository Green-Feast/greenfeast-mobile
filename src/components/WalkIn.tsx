// My Plan → Walk-in (migrations 087, 102).
//
// Since 102 a walk-in is a cart, ordered on the walk-in cart screen
// (app/(app)/walk-in-cart.tsx): any dishes the café serves, drinks and
// add-ons within the plan's limits, one code for the lot. This tab picks the
// place and shows today's code. (The text below describes the 087 rules.)
//
// A 30- or 60-meal subscriber walks into one of our places (during that
// place's hours, any day) and eats their default meal there or takes it away.
// The structure is the plan's — the same add-ons, 1–2 portions (their default,
// or one more) — but the dish, the drink (088: any active smoothie or coffee,
// always a named one) and any flavour are theirs to pick; dishes that are delivery
// only (not on the café menu) can't be a walk-in. One a day, separate from
// deliveries. start_walk_in returns a 6-digit code; the Counter hands the meal
// over and only then is it paid from the wallet. An unused code lapses at
// closing time, uncharged.
import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { Store, Check, ChevronRight } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'

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
  // 103: the code works for an hour (or until closing, if sooner)
  valid_until?: string
  addons: { name: string; sub_option: string | null }[]
  // 102: the whole cart (absent on a walk-in from before it)
  items?: { kind: 'meal' | 'drink'; name: string | null; qty: number; addons: { name: string; qty: number }[] }[]
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
  const router = useRouter()
  const [state, setState] = useState<{ eligible: boolean; error?: string; today: Today | null } | null>(null)

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
        <Text style={st.small}>Walk in any day during café hours and have your meal at our café, or take it away — paid from your wallet. Pick a 30- or 60-meal plan when you renew to get it.</Text>
      </View>
    )
  }

  if (state.today) return <TodayCard today={state.today} />

  return (
    <>
      <View style={st.intro}>
        <Text style={st.introTitle}>Eat at our café</Text>
        <Text style={st.lead}>
          Walk in any day, no booking. Pick your meals and drinks, get a code, and pay from your wallet when it&apos;s handed over. One walk-in a day.
        </Text>
      </View>

      <Text style={st.sectionTitle}>Choose a place</Text>
      {places.length === 0 ? (
        <Text style={st.small}>No places are taking walk-ins right now.</Text>
      ) : places.map((p) => (
        <Pressable key={p.id} style={({ pressed }) => [st.placeCard, pressed && { opacity: 0.85 }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/(app)/walk-in-cart', params: { location: p.id } } as any) }}>
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
        {today.items && today.items.length > 0 ? today.items.map((it, n) => (
          <View key={n} style={{ marginBottom: 4 }}>
            <Text style={st.rowTitle}>{it.kind === 'drink' ? 'Drink · ' : ''}{it.name ?? 'Item'}{it.qty > 1 ? ` ×${it.qty}` : ''}</Text>
            {it.addons.length > 0 && (
              <Text style={st.rowSub}>{it.addons.map((a) => `${a.name}${a.qty > 1 ? ` ×${a.qty}` : ''}`).join(' · ')}</Text>
            )}
          </View>
        )) : (
          <>
            <Text style={st.rowTitle}>{what}</Text>
            {!!extras && <Text style={st.rowSub}>{extras}</Text>}
          </>
        )}
        {today.cost != null && <Text style={st.rowSub}>₹{fmt(today.cost)} from your wallet{done ? '' : ' when it’s handed over'}</Text>}
      </View>
      {!done && (
        <Text style={st.small}>Valid until {today.valid_until ?? today.closes} today. If you don&apos;t come, it isn&apos;t charged.</Text>
      )}
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
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingHorizontal: 20, maxHeight: '92%' },
  // Shrinks to the sheet's max height so the content scrolls inside it
  // instead of running off the bottom (React Native's flexShrink defaults to 0).
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetContent: { paddingBottom: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12 },
  sheetTitle: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.text, flex: 1 },
  placeLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  warnBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.dangerLight, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginTop: 12 },
  // The warning above the dish row sits on it, with the same gap as the rows.
  warnBoxTight: { marginTop: 0, marginBottom: 8 },
  warnIcon: { marginTop: 1.5 },
  // flexShrink, not flex: 1 - flex: 1 on wrapped Text leaves blank lines under it on Android.
  warnText: { flexShrink: 1, fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.danger, lineHeight: 18 },
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
