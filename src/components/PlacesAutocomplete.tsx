import { useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Colors, Fonts } from '@/constants/colors'

// Shared Google Places autocomplete for the two address forms (onboarding
// SF11 and the Address book screen). Plain REST calls — no places SDK
// dependency; the key comes from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY, which for
// OTA bundles is sourced from the EAS environment (see AGENTS.md gotchas).
//
// Biased to Jaipur (the delivery city), matching LocationPicker's default
// map region.

export type Prediction = { place_id: string; description: string }
export type PlaceSelection = {
  description: string
  lat: number | null
  lng: number | null
  pincode: string | null
}

const KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY

export function usePlacesAutocomplete(onSelect: (sel: PlaceSelection) => void) {
  const [predictions, setPredictions] = useState<Prediction[]>([])
  const [visible, setVisible] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchPredictions(text: string) {
    if (text.trim().length < 3) { setPredictions([]); return }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(text)}&key=${KEY}&components=country:in&location=26.9124,75.7873&radius=50000`
      const res = await fetch(url)
      const data = await res.json()
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        // Most common cause: key missing "Places API" or app-restricted.
        console.error('Places Autocomplete error:', data.status, data.error_message)
        setPredictions([])
        return
      }
      setPredictions((data.predictions ?? []).map((p: any) => ({ place_id: p.place_id, description: p.description })))
    } catch (e) {
      console.error('Places Autocomplete request failed:', e)
      setPredictions([])
    }
  }

  // Call from the street-address input's onChangeText (after updating state).
  function onChangeText(text: string) {
    setVisible(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchPredictions(text), 300)
  }

  function onFocus() { setVisible(true) }
  // Delay lets a prediction row's onPress land before the list unmounts.
  function onBlur() { setTimeout(() => setVisible(false), 150) }

  async function selectPrediction(p: Prediction) {
    setVisible(false)
    setPredictions([])
    const sel: PlaceSelection = { description: p.description, lat: null, lng: null, pincode: null }
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${p.place_id}&fields=formatted_address,geometry,address_component&key=${KEY}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.status !== 'OK') {
        console.error('Places Details error:', data.status, data.error_message)
      } else {
        const result = data.result
        if (result?.geometry?.location) {
          sel.lat = result.geometry.location.lat
          sel.lng = result.geometry.location.lng
        }
        const postal = result?.address_components?.find((c: any) => c.types.includes('postal_code'))
        if (postal) sel.pincode = postal.long_name
      }
    } catch (e) {
      console.error('Places Details request failed:', e)
    }
    // Even if details failed, still hand back the description text.
    onSelect(sel)
  }

  return { predictions, visible, onChangeText, onFocus, onBlur, selectPrediction }
}

// Rendered in normal flow (not position:absolute) directly under the street
// input — an absolutely-positioned dropdown inside a ScrollView is unreliable
// on Android; in-flow just pushes the fields below down while showing.
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
          <Text style={styles.text} numberOfLines={2}>{p.description}</Text>
        </Pressable>
      ))}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  row: { paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderFaint },
  text: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text },
})
