import { useRef, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps'
import * as Location from 'expo-location'
import { LocateFixed } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'

export type LatLng = { lat: number; lng: number }

// Jaipur — the delivery city — is the default map center.
const JAIPUR: Region = { latitude: 26.9124, longitude: 75.7873, latitudeDelta: 0.06, longitudeDelta: 0.06 }

export type ResolvedAddress = { line1?: string; pincode?: string }

type Props = {
  value: LatLng | null
  onChange: (c: LatLng) => void
  // Called after the pin moves with the reverse-geocoded street + pincode, so
  // the caller can auto-fill the address fields.
  onResolveAddress?: (a: ResolvedAddress) => void
  height?: number
}

export default function LocationPicker({ value, onChange, onResolveAddress, height = 200 }: Props) {
  const mapRef = useRef<MapView>(null)
  const [locating, setLocating] = useState(false)

  const marker = value
    ? { latitude: value.lat, longitude: value.lng }
    : { latitude: JAIPUR.latitude, longitude: JAIPUR.longitude }

  async function set(latitude: number, longitude: number) {
    onChange({ lat: latitude, lng: longitude })
    if (!onResolveAddress) return
    try {
      const res = await Location.reverseGeocodeAsync({ latitude, longitude })
      const r = res?.[0]
      if (!r) return
      const parts = [r.name, r.street, r.district].filter(Boolean) as string[]
      const line1 = Array.from(new Set(parts)).join(', ')
      onResolveAddress({ line1: line1 || undefined, pincode: r.postalCode || undefined })
    } catch {
      // reverse geocoding failed — keep the coordinates, user can type manually
    }
  }

  async function useMyLocation() {
    setLocating(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const { latitude, longitude } = pos.coords
      set(latitude, longitude)
      mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 600)
    } catch {
      // ignore — user can still drop the pin manually
    } finally {
      setLocating(false)
    }
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={value ? { ...marker, latitudeDelta: 0.01, longitudeDelta: 0.01 } : JAIPUR}
        onPress={(e) => set(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
      >
        <Marker
          coordinate={marker}
          draggable
          onDragEnd={(e) => set(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
        />
      </MapView>

      <Pressable style={styles.locBtn} onPress={useMyLocation}>
        {locating ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <>
            <LocateFixed size={14} color={Colors.primary} />
            <Text style={styles.locBtnText}>Use my location</Text>
          </>
        )}
      </Pressable>

      {!value && (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Tap the map or drag the pin to set your exact location</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.primaryLight },
  locBtn: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  locBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },
  hint: { position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 8 },
  hintText: { fontFamily: Fonts.body, fontSize: 11, color: '#fff', textAlign: 'center' },
})
