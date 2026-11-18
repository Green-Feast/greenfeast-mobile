import { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { useOnboardingStore } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import SectionProgress from '@/components/SectionProgress'
import AddressForm from '@/components/AddressForm'
import { KeyboardAwareScreen, useAutoFocus } from '@/components/keyboard'
import { friendlyError } from '@/lib/friendlyError'
import {
  SERVICE_CITY, addressRow, saveDefaultAddress, useServicePincodes, validateAddress, type AddressDraft,
} from '@/lib/address'

export default function AddressScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useOnboardingStore()
  const { user } = useAuthStore()
  const served = useServicePincodes()
  const line1Ref = useAutoFocus()

  // Coming back to this step shows what was entered before.
  const [draft, setDraft] = useState<AddressDraft>({
    line1: store.addressLine1,
    line2: store.addressLine2,
    landmark: store.addressLandmark,
    pincode: store.addressPincode,
    lat: store.addressLat,
    lng: store.addressLng,
    placeId: store.addressPlaceId,
    source: store.addressSource,
    type: store.addressType,
    label: store.addressLabel || 'Home',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleNext() {
    if (saving) return
    const e = validateAddress(draft, served)
    if (Object.keys(e).length > 0) {
      setErrors(e)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      return
    }
    setSaveError('')
    const row = addressRow(draft)
    store.setAddress({
      addressLine1: row.line1,
      addressLine2: row.line2 ?? '',
      addressLandmark: row.landmark ?? '',
      addressCity: SERVICE_CITY,
      addressPincode: row.pincode,
      addressLabel: row.label,
      addressType: row.type,
      addressLat: row.lat,
      addressLng: row.lng,
      addressPlaceId: row.place_id,
      addressSource: draft.source,
    })
    // Saved now (so the office sees it even if payment waits), and again at
    // payment. The server checks the pincode; show its answer here.
    if (user) {
      setSaving(true)
      try {
        await saveDefaultAddress(user.id, draft)
      } catch (err) {
        console.warn('[onboarding address] save failed', err)
        setSaveError(friendlyError(err, 'Could not save your address. Please try again.'))
        setSaving(false)
        return
      }
      setSaving(false)
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    router.push('/(onboarding)/summary')
  }

  return (
    <View style={styles.container}>
      {/* Fixed header — progress bar must not scroll with the page */}
      <View style={{ paddingHorizontal: 24, paddingTop: insets.top + 24 }}>
        <SectionProgress current={4} sectionStep={1} sectionTotalSteps={3} />
      </View>
      <KeyboardAwareScreen
        contentContainerStyle={[styles.scroll, { paddingTop: 0, paddingBottom: 40 + insets.bottom }]}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow}>DELIVERY</Text>
          <Text style={styles.title}>Where do we deliver?</Text>
          <Text style={styles.subtitle}>We currently deliver across Jaipur.</Text>
        </View>

        <AddressForm
          value={draft}
          onChange={setDraft}
          errors={errors}
          onClearError={(f) => setErrors((e) => (e[f] ? { ...e, [f]: '' } : e))}
          servedPincodes={served}
          variant="underline"
          line1Ref={line1Ref}
        />

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
        <Button onPress={handleNext} loading={saving} style={{ marginTop: 8 }}>Review order →</Button>
      </KeyboardAwareScreen>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  scroll: { padding: 24, paddingBottom: 40 },
  header: { marginBottom: 28 },
  eyebrow: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 10,
  },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.ink900, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink500 },
  error: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginBottom: 8 },
})
