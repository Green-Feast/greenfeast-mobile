import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { ChevronLeft } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import AddressForm from '@/components/AddressForm'
import { KeyboardAwareScreen } from '@/components/keyboard'
import { friendlyError } from '@/lib/friendlyError'
import {
  ADDRESS_SELECT, EMPTY_ADDRESS, addressRow, draftFromRecord, useServicePincodes, validateAddress,
  type AddressDraft, type AddressRecord,
} from '@/lib/address'

// Add or edit one delivery address (Plan settings → Delivery addresses, and the
// day cart's "Add or change addresses"). A full screen rather than a sheet so
// the keyboard-aware scroll and the sticky Save button work on Android
// (edge-to-edge: KeyboardAvoidingView in a Modal left Save under the keyboard).
export default function AddressEditScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const { user } = useAuthStore()
  const served = useServicePincodes()

  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS)
  const [loading, setLoading] = useState(!!id)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!id || !user) return
    let live = true
    supabase.from('addresses').select(ADDRESS_SELECT).eq('id', id).eq('user_id', user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!live) return
        if (error || !data) {
          Alert.alert('Address not found', 'It may have been removed.', [{ text: 'OK', onPress: () => router.back() }])
          return
        }
        setDraft(draftFromRecord(data as AddressRecord))
        setLoading(false)
      })
    return () => { live = false }
  }, [id, user, router])

  async function moveUpcoming(addressId: string, moveMeals: boolean) {
    const { data, error } = await supabase.rpc('set_default_address', { p_address: addressId, p_move_upcoming: moveMeals })
    if (error) {
      Alert.alert('Could not change the address', friendlyError(error, 'Please try again.'))
      return
    }
    if (moveMeals && (data ?? 0) > 0) {
      Alert.alert('Done', `${data} upcoming meal${data === 1 ? '' : 's'} will now be delivered here.`)
    }
  }

  async function handleSave() {
    if (saving || !user) return
    const e = validateAddress(draft, served)
    if (Object.keys(e).length > 0) {
      setErrors(e)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      return
    }
    setSaving(true); setSaveError('')
    try {
      const row = addressRow(draft)
      if (id) {
        const { error } = await supabase.from('addresses').update(row).eq('id', id)
        if (error) throw error
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        router.back()
        return
      }
      // The server makes a customer's first address the default (093).
      const { data: created, error } = await supabase.from('addresses')
        .insert({ ...row, user_id: user.id, is_default: false })
        .select('id, is_default').single()
      if (error) throw error
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      if (created.is_default) {
        // Their only address: every upcoming meal goes here.
        await moveUpcoming(created.id, true)
        router.back()
        return
      }
      // A new place to eat: offer to send the upcoming meals there.
      Alert.alert(
        `Deliver to ${row.label}?`,
        'Should your upcoming meals go to this address? You can still change single days from My Plan.',
        [
          { text: 'Not now', style: 'cancel', onPress: () => router.back() },
          { text: 'New meals only', onPress: async () => { await moveUpcoming(created.id, false); router.back() } },
          { text: 'All upcoming meals', onPress: async () => { await moveUpcoming(created.id, true); router.back() } },
        ],
        { cancelable: false },
      )
    } catch (err) {
      console.warn('[address-edit] save failed', err)
      setSaveError(friendlyError(err, 'Could not save the address. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text style={s.topBarTitle}>{id ? 'Edit address' : 'Add address'}</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 48 }} />
      ) : (
        <KeyboardAwareScreen
          style={{ backgroundColor: Colors.background }}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          footerStyle={s.footer}
          footer={
            <View>
              {saveError ? <Text style={s.saveError}>{saveError}</Text> : null}
              <Pressable style={[s.saveBtn, saving && s.saveBtnDisabled]} disabled={saving} onPress={handleSave}>
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={s.saveBtnText}>{id ? 'Save changes' : 'Save address'}</Text>}
              </Pressable>
            </View>
          }
        >
          <AddressForm
            value={draft}
            onChange={setDraft}
            errors={errors}
            onClearError={(f) => setErrors((e) => (e[f] ? { ...e, [f]: '' } : e))}
            servedPincodes={served}
            variant="boxed"
          />
        </KeyboardAwareScreen>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 2 },
  topBarTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.text },
  footer: {
    backgroundColor: Colors.background, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.borderFaint,
  },
  saveError: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginBottom: 8, textAlign: 'center' },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
