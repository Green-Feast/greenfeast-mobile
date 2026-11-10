// Pickup & dine-in (082): the places, and a sheet to choose how a meal (or a
// slot, by default) is collected — delivery, takeaway at a place, or dine-in.
// Used by My Plan's day sheet (set_order_fulfilment) and Plan & settings'
// Collection section (set_my_collection). The parent does the saving.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Modal, ActivityIndicator, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { X, Check, Truck, ShoppingBag, UtensilsCrossed, MapPin } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'

export type Fulfilment = 'delivery' | 'pickup' | 'dine_in'
export type Place = {
  id: string
  name: string
  address: string
  maps_url: string | null
  offers_pickup: boolean
  offers_dine_in: boolean
  opens_at: string
  lunch_until: string
  closes_at: string
}

let cache: Place[] | null = null
export async function loadPlaces(): Promise<Place[]> {
  if (cache) return cache
  const { data } = await supabase
    .from('pickup_locations')
    .select('id, name, address, maps_url, offers_pickup, offers_dine_in, opens_at, lunch_until, closes_at')
    .eq('is_active', true)
    .order('sort_order')
  cache = (data ?? []) as Place[]
  return cache
}

export function usePlaces() {
  const [places, setPlaces] = useState<Place[]>(cache ?? [])
  useEffect(() => { loadPlaces().then(setPlaces).catch(() => {}) }, [])
  return places
}

// "11 AM", "4:30 PM"
export function clock(t: string) {
  const [h, m] = t.split(':').map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`
}

// When a slot can be collected at a place: lunch until lunch_until, dinner after.
export function slotHours(p: Place, slot: 'lunch' | 'dinner') {
  return slot === 'lunch' ? `${clock(p.opens_at)}–${clock(p.lunch_until)}` : `${clock(p.lunch_until)}–${clock(p.closes_at)}`
}

export function collectionLabel(mode: Fulfilment | null | undefined, placeId: string | null | undefined, places: Place[]) {
  if (!mode || mode === 'delivery') return 'Delivery'
  const p = places.find((x) => x.id === placeId)
  return `${mode === 'dine_in' ? 'Dine-in' : 'Takeaway'} at ${p?.name ?? 'our café'}`
}

export default function PickupSheet({
  visible, title, note, slot, current, onPick, onClose,
}: {
  visible: boolean
  title: string
  note?: string
  slot: 'lunch' | 'dinner'
  current: { mode: Fulfilment; place: string | null }
  onPick: (mode: Fulfilment, place: string | null) => Promise<string | null> // error text, or null when saved
  onClose: () => void
}) {
  const insets = useSafeAreaInsets()
  const places = usePlaces()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { if (visible) setError('') }, [visible])

  async function pick(mode: Fulfilment, place: string | null) {
    const key = `${mode}|${place ?? ''}`
    if (mode === current.mode && place === current.place) return onClose()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    setBusy(key)
    setError('')
    const err = await onPick(mode, place)
    setBusy(null)
    if (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      setError(err)
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    onClose()
  }

  const options: { key: string; mode: Fulfilment; place: Place | null; title: string; sub: string; Icon: typeof Truck }[] = [
    { key: 'delivery|', mode: 'delivery', place: null, title: 'Delivery', sub: 'To your address, as usual', Icon: Truck },
  ]
  for (const p of places) {
    if (p.offers_dine_in) {
      options.push({ key: `dine_in|${p.id}`, mode: 'dine_in', place: p, title: `Dine-in at ${p.name}`, sub: `${p.address} · ${slotHours(p, slot)}`, Icon: UtensilsCrossed })
    }
    if (p.offers_pickup) {
      options.push({ key: `pickup|${p.id}`, mode: 'pickup', place: p, title: `Takeaway from ${p.name}`, sub: `${p.address} · ${slotHours(p, slot)}`, Icon: ShoppingBag })
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={[st.sheet, { paddingBottom: 24 + insets.bottom }]} onPress={(e) => e.stopPropagation()}>
          <View style={st.header}>
            <Text style={st.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={20} color={Colors.textMuted} /></Pressable>
          </View>
          {note ? <Text style={st.note}>{note}</Text> : null}
          {places.length === 0 && <ActivityIndicator color={Colors.primary} style={{ marginVertical: 16 }} />}
          {options.map((o) => {
            const on = o.mode === current.mode && (o.place?.id ?? null) === current.place
            return (
              <Pressable key={o.key} style={[st.row, on && st.rowOn]} onPress={() => pick(o.mode, o.place?.id ?? null)} disabled={!!busy}>
                <o.Icon size={18} color={Colors.primary} strokeWidth={1.75} />
                <View style={{ flex: 1 }}>
                  <Text style={st.rowTitle}>{o.title}</Text>
                  <Text style={st.rowSub}>{o.sub}</Text>
                  {o.place?.maps_url ? (
                    <Pressable onPress={() => Linking.openURL(o.place!.maps_url!)} hitSlop={6} style={st.mapLink}>
                      <MapPin size={12} color={Colors.primary} />
                      <Text style={st.mapText}>Directions</Text>
                    </Pressable>
                  ) : null}
                </View>
                {busy === o.key ? <ActivityIndicator size="small" color={Colors.primary} /> : on ? <Check size={18} color={Colors.primary} /> : null}
              </Pressable>
            )
          })}
          {!!error && <Text style={st.error}>{error}</Text>}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text },
  note: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, lineHeight: 18, marginBottom: 12 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: Colors.border, marginBottom: 8, backgroundColor: '#fff',
  },
  rowOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  rowTitle: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  rowSub: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, alignSelf: 'flex-start' },
  mapText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginTop: 6 },
})
