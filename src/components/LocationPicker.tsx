import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Linking, Alert } from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps'
import * as Location from 'expo-location'
import { LocateFixed } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'
import { JAIPUR_CENTER, reverseGeocode, type ParsedAddress } from '@/lib/address'
import { withTimeout } from '@/lib/withTimeout'

export type LatLng = { lat: number; lng: number }

const JAIPUR: Region = { latitude: JAIPUR_CENTER.lat, longitude: JAIPUR_CENTER.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }
const CLOSE = { latitudeDelta: 0.004, longitudeDelta: 0.004 }

type Props = {
  value: LatLng | null
  // A pin set on the map ('map') or from the phone's location ('gps').
  onChange: (c: LatLng, source: 'map' | 'gps') => void
  // The address Google has for that pin (null when it has none). The form
  // fills only what the customer hasn't typed, and everything stays editable.
  onResolveAddress?: (a: ParsedAddress | null, source: 'map' | 'gps') => void
  height?: number
}

const near = (a: LatLng, b: LatLng) => Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6

export default function LocationPicker({ value, onChange, onResolveAddress, height = 200 }: Props) {
  const mapRef = useRef<MapView>(null)
  const [locating, setLocating] = useState(false)
  const [resolving, setResolving] = useState(false)
  // Latest pin wins: a slow lookup of an earlier pin must not fill the form.
  const seq = useRef(0)
  // The pin this map set itself, so a pin set from outside (a Places pick)
  // is recognised and the map moves to it.
  const ownPin = useRef<LatLng | null>(value)

  useEffect(() => {
    if (!value) return
    if (ownPin.current && near(ownPin.current, value)) return
    ownPin.current = value
    mapRef.current?.animateToRegion({ latitude: value.lat, longitude: value.lng, ...CLOSE }, 500)
  }, [value])

  const marker = value
    ? { latitude: value.lat, longitude: value.lng }
    : { latitude: JAIPUR.latitude, longitude: JAIPUR.longitude }

  async function set(latitude: number, longitude: number, source: 'map' | 'gps') {
    const c = { lat: latitude, lng: longitude }
    ownPin.current = c
    onChange(c, source)
    if (!onResolveAddress) return
    const mine = ++seq.current
    setResolving(true)
    try {
      // Google's geocoder (REST, needs no location permission — the phone's
      // own geocoder on Android does, and failed silently on a map tap).
      const parsed = await reverseGeocode(latitude, longitude)
      if (mine === seq.current) onResolveAddress(parsed, source)
    } finally {
      if (mine === seq.current) setResolving(false)
    }
  }

  async function useMyLocation() {
    if (locating) return
    setLocating(true)
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (perm.status !== 'granted') {
        Alert.alert(
          'Location is off for GreenFeast',
          'Allow location to use where you are now, or tap the map to place the pin yourself.',
          perm.canAskAgain
            ? [{ text: 'OK' }]
            : [{ text: 'Not now', style: 'cancel' }, { text: 'Open settings', onPress: () => Linking.openSettings() }],
        )
        return
      }
      // A fresh fix can take long indoors; fall back to the last known one.
      let pos: Location.LocationObject | null = null
      try {
        pos = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 12000, 'Location')
      } catch {
        pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000, requiredAccuracy: 200 })
      }
      if (!pos) {
        Alert.alert("Couldn't find you", 'Please tap the map to place the pin on your building.')
        return
      }
      const { latitude, longitude } = pos.coords
      mapRef.current?.animateToRegion({ latitude, longitude, ...CLOSE }, 600)
      await set(latitude, longitude, 'gps')
    } catch {
      Alert.alert("Couldn't find you", 'Please tap the map to place the pin on your building.')
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
        initialRegion={value ? { ...marker, ...CLOSE } : JAIPUR}
        onPress={(e) => set(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude, 'map')}
        toolbarEnabled={false}
      >
        <Marker
          coordinate={marker}
          draggable
          onDragEnd={(e) => set(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude, 'map')}
        />
      </MapView>

      <Pressable style={styles.locBtn} onPress={useMyLocation} hitSlop={6}>
        {locating ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <>
            <LocateFixed size={14} color={Colors.primary} />
            <Text style={styles.locBtnText}>Use my current location</Text>
          </>
        )}
      </Pressable>

      {resolving && (
        <View style={styles.resolving} pointerEvents="none">
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.hintText}>Finding the address…</Text>
        </View>
      )}
      {!value && !resolving && (
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>Tap the map or drag the pin onto your building</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.primaryLight },
  locBtn: {
    position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, minHeight: 34,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  locBtnText: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary },
  hint: { position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 8 },
  resolving: {
    position: 'absolute', bottom: 10, left: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 8,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  hintText: { fontFamily: Fonts.body, fontSize: 11, color: '#fff', textAlign: 'center' },
})
