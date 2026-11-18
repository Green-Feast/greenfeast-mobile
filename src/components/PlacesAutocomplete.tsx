import { useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { MapPin } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'
import { JAIPUR_CENTER, parseComponents, type AddressComponent } from '@/lib/address'

// Google Places autocomplete for the shared address form (components/AddressForm).
// Plain REST calls to the Places API (legacy endpoints, the ones enabled on
// our key) — no Places SDK dependency. The key is EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
// which OTA bundles take from the EAS environment (see AGENTS.md gotchas).
//
// One session token covers the keystrokes and the Details call that ends them,
// so Google bills a pick as one session. Results are limited to India and
// biased to Jaipur.

export type Prediction = { place_id: string; main: string; secondary: string; description: string }
export type PlaceSelection = {
  placeId: string
  description: string
  lat: number | null
  lng: number | null
  line1: string
  line2: string
  pincode: string | null
  // Google had a house / flat / street number for this place.
  houseNumber: boolean
}

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY

function newSessionToken() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function usePlacesAutocomplete(onSelect: (sel: PlaceSelection) => void) {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [visible, setVisible] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionRef = useRef<string | null>(null)
  const seqRef = useRef(0)

  async function fetchPredictions(text: string) {
    const seq = ++seqRef.current
    if (!KEY || text.trim().length < 3) { setPredictions([]); return }
    sessionRef.current ??= newSessionToken()
    try {
      const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json'
        + `?input=${encodeURIComponent(text)}&key=${KEY}&components=country:in&language=en`
        + `&location=${JAIPUR_CENTER.lat},${JAIPUR_CENTER.lng}&radius=30000`
        + `&sessiontoken=${sessionRef.current}`
      const data = await fetch(url).then((r) => r.json())
      if (seq !== seqRef.current) return // a newer keystroke's request owns the list
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.warn('Places Autocomplete error:', data.status, data.error_message)
        setPredictions([])
        return
      }
      setPredictions((data.predictions ?? []).slice(0, 5).map((p: any) => ({
        place_id: p.place_id,
        description: p.description,
        main: p.structured_formatting?.main_text ?? p.description,
        secondary: p.structured_formatting?.secondary_text ?? '',
      })))
    } catch (e) {
      console.warn('Places Autocomplete request failed:', e)
      if (seq === seqRef.current) setPredictions([])
    }
  }

  // Call from line 1's onChangeText (after updating state).
  function onChangeText(text: string) {
    setVisible(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchPredictions(text), 300)
  }

  function onFocus() { setVisible(true) }
  // Delay lets a prediction row's onPress land before the list unmounts.
  function onBlur() { setTimeout(() => setVisible(false), 200) }
  function dismiss() { setVisible(false); setPredictions([]) }

  async function selectPrediction(p: Prediction) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    seqRef.current++
    setVisible(false)
    setPredictions([])
    const token = sessionRef.current
    sessionRef.current = null // the Details call ends this session
    // Without details: the place name as line 1, the rest of its description as line 2.
    const sel: PlaceSelection = {
      placeId: p.place_id, description: p.description, lat: null, lng: null,
      line1: p.main, line2: '', pincode: null, houseNumber: /\d/.test(p.main),
    }
    try {
      const url = 'https://maps.googleapis.com/maps/api/place/details/json'
        + `?place_id=${p.place_id}&fields=address_component,geometry,name,types&language=en&key=${KEY}`
        + (token ? `&sessiontoken=${token}` : '')
      const data = await fetch(url).then((r) => r.json())
      if (data.status !== 'OK') {
        console.warn('Places Details error:', data.status, data.error_message)
      } else {
        const result = data.result
        if (result?.geometry?.location) {
          sel.lat = result.geometry.location.lat
          sel.lng = result.geometry.location.lng
        }
        const parsed = parseComponents(result?.address_components as AddressComponent[], result?.name ?? p.main)
        sel.line1 = parsed.line1 || p.main
        sel.line2 = parsed.line2
        sel.pincode = parsed.pincode
        sel.houseNumber = parsed.houseNumber
      }
    } catch (e) {
      console.warn('Places Details request failed:', e)
    }
    onSelect(sel)
  }

  return { predictions, visible, onChangeText, onFocus, onBlur, dismiss, selectPrediction }
}

// Rendered in normal flow (not position:absolute) directly under line 1 — an
// absolutely-positioned dropdown inside a ScrollView is unreliable on Android;
// in-flow just pushes the fields below down while showing.
export function PredictionsDropdown({
  predictions, visible, onPick,
}: {
  predictions: Prediction[]
  visible: boolean
  onPick: (p: Prediction) => void
}) {
  if (!visible || predictions.length === 0) return null
  return (
    <View style={styles.dropdown}>
      {predictions.map((p) => (
        <Pressable key={p.place_id} style={styles.row} onPress={() => onPick(p)}>
          <MapPin size={15} color={Colors.textMuted} style={{ marginTop: 2 }} />
          <View style={{ flex: 1 }}>
            <Text style={styles.main} numberOfLines={1}>{p.main}</Text>
            {p.secondary ? <Text style={styles.secondary} numberOfLines={1}>{p.secondary}</Text> : null}
          </View>
        </Pressable>
      ))}
      <Text style={styles.powered}>Suggestions by Google</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  dropdown: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.borderFaint,
  },
  main: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.text },
  secondary: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  powered: { fontFamily: Fonts.body, fontSize: 10, color: Colors.textLight, textAlign: 'right', paddingHorizontal: 12, paddingVertical: 6 },
})
