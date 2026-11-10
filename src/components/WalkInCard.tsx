// Home → "Eat at our café" (082): while a place is open, a 30- or 60-meal
// subscriber can walk in for their default meal. walk_in_quote shows what it
// is and what it costs (an extra meal when a delivery is already coming for
// that slot); start_walk_in makes it and returns the code shown at the counter.
import { useCallback, useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { Store, X, UtensilsCrossed, ShoppingBag, ChevronRight } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import { usePlaces, clock, type Place } from '@/components/PickupSheet'

type Quote = {
  ok: boolean
  error?: string | null
  slot?: 'lunch' | 'dinner'
  place?: string
  offers_pickup?: boolean
  offers_dine_in?: boolean
  closes?: string
  meal_name?: string | null
  portions?: number
  cost?: number
  extra?: boolean
  already_booked_here?: boolean
  can_afford?: boolean
  open_walk_in?: { order_id: string; code: string; location: string } | null
}

function nowIst() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(11, 16)
}
const isOpen = (p: Place, t = nowIst()) => t >= p.opens_at.slice(0, 5) && t < p.closes_at.slice(0, 5)
const fmt = (paise: number) => (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export default function WalkInCard({ userId }: { userId: string }) {
  const places = usePlaces()
  const [allowed, setAllowed] = useState(false)
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState<Place | null>(null)

  useEffect(() => {
    supabase
      .from('subscriptions')
      .select('plans ( allow_pickup )')
      .eq('user_id', userId)
      .in('status', ['active', 'paused'])
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const p = (data as any)?.plans
        setAllowed(!!(Array.isArray(p) ? p[0] : p)?.allow_pickup)
      })
  }, [userId])

  // Re-check opening hours every minute while Home is up.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60000)
    return () => clearInterval(id)
  }, [])

  const openNow = places.filter((p) => isOpen(p))
  if (!allowed || openNow.length === 0) return null
  void tick

  return (
    <>
      {openNow.map((p) => (
        <Pressable key={p.id} style={({ pressed }) => [st.card, pressed && { opacity: 0.9 }]} onPress={() => setOpen(p)}>
          <View style={st.iconWrap}><Store size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={st.cardTitle}>Eat at {p.name}</Text>
            <Text style={st.cardSub}>
              Open till {clock(p.closes_at)} · {p.offers_dine_in && p.offers_pickup ? 'dine-in or takeaway' : p.offers_dine_in ? 'dine-in' : 'takeaway'} · your default meal
            </Text>
          </View>
          <ChevronRight size={18} color="#fff" />
        </Pressable>
      ))}
      <WalkInSheet place={open} onClose={() => setOpen(null)} />
    </>
  )
}

function WalkInSheet({ place, onClose }: { place: Place | null; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!place) return
    setQuote(null); setCode(null); setError('')
    const { data, error: err } = await supabase.rpc('walk_in_quote', { p_location: place.id })
    if (err) return setError(err.message || 'Could not check. Please try again.')
    const q = data as Quote
    setQuote(q)
    if (q.open_walk_in && q.open_walk_in.location === place.id) setCode(q.open_walk_in.code)
  }, [place])

  useEffect(() => { load() }, [load])

  async function start(mode: 'pickup' | 'dine_in') {
    if (!place) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    setBusy(true); setError('')
    const { data, error: err } = await supabase.rpc('start_walk_in', { p_location: place.id, p_mode: mode })
    setBusy(false)
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      return setError(err.message || 'Could not start. Please try again.')
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    setCode((data as { code: string }).code)
  }

  return (
    <Modal visible={!!place} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={[st.sheet, { paddingBottom: 24 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <View style={st.header}>
            <Text style={st.title}>{place?.name}</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={Colors.textMuted} /></Pressable>
          </View>

          {code ? (
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={st.lead}>Show this code at the counter</Text>
              <Text style={st.code}>{code.slice(0, 3)} {code.slice(3)}</Text>
              <Text style={st.small}>
                {quote?.meal_name ? `${quote.meal_name}${(quote.portions ?? 1) > 1 ? ` ×${quote.portions}` : ''} · ` : ''}
                paid from your wallet when it&apos;s handed over. Valid until {quote?.closes ?? 'closing'} today.
              </Text>
            </View>
          ) : !quote && !error ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: 24 }} />
          ) : quote && !quote.ok ? (
            <Text style={st.error}>{quote.error}</Text>
          ) : quote ? (
            <>
              <Text style={st.lead}>
                Your {quote.slot}: <Text style={{ fontFamily: Fonts.bodyBold }}>{quote.meal_name}</Text>
                {(quote.portions ?? 1) > 1 ? ` ×${quote.portions}` : ''} — ₹{fmt(quote.cost ?? 0)} from your wallet.
              </Text>
              {quote.extra && (
                <Text style={st.warn}>
                  {quote.already_booked_here
                    ? `You already have a ${quote.slot} booked for collection today — this would be an extra meal.`
                    : `Your ${quote.slot} delivery is still coming today — this is an extra meal.`}
                </Text>
              )}
              {!quote.can_afford ? (
                <Text style={st.error}>Your wallet doesn&apos;t have room for an extra meal — renew your plan to add one.</Text>
              ) : (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {quote.offers_dine_in && (
                    <Pressable style={st.btn} disabled={busy} onPress={() => start('dine_in')}>
                      {busy ? <ActivityIndicator color="#fff" /> : <><UtensilsCrossed size={16} color="#fff" /><Text style={st.btnText}>Eat here</Text></>}
                    </Pressable>
                  )}
                  {quote.offers_pickup && (
                    <Pressable style={[st.btn, quote.offers_dine_in && st.btnGhost]} disabled={busy} onPress={() => start('pickup')}>
                      <ShoppingBag size={16} color={quote.offers_dine_in ? Colors.primary : '#fff'} />
                      <Text style={[st.btnText, quote.offers_dine_in && { color: Colors.primary }]}>Takeaway</Text>
                    </Pressable>
                  )}
                </View>
              )}
              <Text style={st.small}>Always your default meal — set it in Plan &amp; settings. Valid until {quote.closes} today; not charged if you don&apos;t collect it.</Text>
            </>
          ) : null}
          {!!error && <Text style={st.error}>{error}</Text>}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.primary,
    borderRadius: 16, padding: 16, marginHorizontal: 16, marginTop: 24,
  },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: Fonts.bodyBold, fontSize: 15, color: '#fff' },
  cardSub: { fontFamily: Fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.text },
  lead: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text, lineHeight: 20, marginBottom: 8 },
  warn: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.accentText, backgroundColor: Colors.primaryLight, borderRadius: 10, padding: 10, marginBottom: 8, lineHeight: 18 },
  code: { fontFamily: Fonts.heading, fontSize: 44, letterSpacing: 6, color: Colors.primary, marginVertical: 12 },
  small: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 12, lineHeight: 17, textAlign: 'center' },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 8 },
  btn: {
    flexDirection: 'row', gap: 8, backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  btnGhost: { backgroundColor: Colors.primaryLight },
  btnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
