import { useState, useCallback } from 'react'
import { friendlyError } from '@/lib/friendlyError'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import { ChevronLeft, Plus, Trash2, Edit3, Check } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import { ADDRESS_SELECT, addressText, type AddressRecord } from '@/lib/address'

type Address = AddressRecord

// Plan settings → Delivery addresses. Adding / editing is its own screen
// (address-edit), shared form in components/AddressForm.
export default function AddressesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuthStore()

  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchAddresses = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('addresses')
      .select(ADDRESS_SELECT)
      .eq('user_id', user.id)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('created_at')
    setAddresses((data as Address[]) ?? [])
  }, [user])

  // Refreshes when coming back from the add / edit screen.
  useFocusEffect(useCallback(() => {
    fetchAddresses().finally(() => setLoading(false))
  }, [fetchAddresses]))

  const openAdd = () => router.push('/(app)/address-edit')
  const openEdit = (addr: Address) => router.push({ pathname: '/(app)/address-edit', params: { id: addr.id } })

  // Makes it the default; with moveMeals, every upcoming meal that can still
  // be changed goes there too (its delivery route follows the address).
  async function moveUpcoming(id: string, moveMeals: boolean) {
    const { data, error: err } = await supabase.rpc('set_default_address', { p_address: id, p_move_upcoming: moveMeals })
    if (err) {
      Alert.alert('Could not change the address', friendlyError(err, 'Please try again.'))
      return
    }
    await fetchAddresses()
    if (moveMeals && (data ?? 0) > 0) {
      Alert.alert('Done', `${data} upcoming meal${data === 1 ? '' : 's'} will now be delivered here.`)
    }
  }

  function askToUse(id: string, name: string) {
    Alert.alert(
      `Deliver to ${name}?`,
      'Should your upcoming meals go to this address? You can still change single days from My Plan.',
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'New meals only', onPress: () => moveUpcoming(id, false) },
        { text: 'All upcoming meals', onPress: () => moveUpcoming(id, true) },
      ]
    )
  }

  async function handleDelete(id: string) {
    Alert.alert('Remove this address?', 'Any upcoming meals going here move to your other address.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(id)
          try {
            // Archived rather than deleted once orders have used it, so past
            // orders keep their address.
            const { error: err } = await supabase.rpc('archive_address', { p_address: id })
            if (err) Alert.alert('Could not remove it', friendlyError(err, 'Please try again.'))
            await fetchAddresses()
          } finally { setDeletingId(null) }
        },
      },
    ])
  }

  function handleSetDefault(id: string) {
    const addr = addresses.find(a => a.id === id)
    askToUse(id, addr?.label ?? 'this address')
  }

  return (
    <View style={s.container}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 8, paddingBottom: 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={s.backBtn}>
            <ChevronLeft size={22} color={Colors.text} />
          </Pressable>
          <Text style={s.topBarTitle}>Delivery addresses</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 48 }} />
        ) : addresses.length === 0 ? (
          <View style={s.emptyWrap}>
            <Text style={s.emptyText}>No addresses saved yet.</Text>
            <Text style={s.emptySubText}>Add one below — your meals are delivered there.</Text>
          </View>
        ) : (
          <View style={s.listWrap}>
            {addresses.map((addr) => (
              <View key={addr.id} style={[s.addrCard, addr.is_default && s.addrCardDefault]}>
                <View style={s.addrCardTop}>
                  <View style={s.addrMeta}>
                    <Text style={s.addrLabel}>{addr.label}</Text>
                    {addr.is_default && (
                      <View style={s.defaultBadge}>
                        <Check size={10} color={Colors.primary} />
                        <Text style={s.defaultBadgeText}>Default</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.addrActions}>
                    <Pressable onPress={() => openEdit(addr)} hitSlop={8} style={s.iconBtn}>
                      <Edit3 size={16} color={Colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(addr.id)}
                      hitSlop={8}
                      style={s.iconBtn}
                      disabled={deletingId === addr.id}
                    >
                      {deletingId === addr.id
                        ? <ActivityIndicator size="small" color={Colors.danger} />
                        : <Trash2 size={16} color={Colors.danger} />}
                    </Pressable>
                  </View>
                </View>
                <Text style={s.addrLine1}>{addressText(addr)}</Text>
                {addr.landmark ? <Text style={s.addrLandmark}>{addr.landmark}</Text> : null}
                <Text style={s.addrPincode}>{addr.city || 'Jaipur'} {addr.pincode}</Text>
                {addr.lat == null ? <Text style={s.addrNoPin}>No map pin yet — tap edit to add one for the rider</Text> : null}
                {!addr.is_default && (
                  <Pressable style={s.setDefaultBtn} onPress={() => handleSetDefault(addr.id)}>
                    <Text style={s.setDefaultText}>Deliver here</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add button (fixed at bottom) */}
      <View style={[s.addBtnWrap, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable style={s.addBtn} onPress={openAdd}>
          <Plus size={18} color="#fff" />
          <Text style={s.addBtnText}>Add new address</Text>
        </Pressable>
      </View>

    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { paddingHorizontal: 16 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 2 },
  topBarTitle: { fontFamily: Fonts.heading, fontSize: 20, color: Colors.text },
  emptyWrap: { alignItems: 'center', marginTop: 64, paddingHorizontal: 32 },
  emptyText: { fontFamily: Fonts.bodyBold, fontSize: 16, color: Colors.text, marginBottom: 6 },
  emptySubText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  listWrap: { gap: 12 },
  addrCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: Colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  addrCardDefault: { borderColor: Colors.primary },
  addrCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  addrMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addrLabel: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  defaultBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primaryLight, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  defaultBadgeText: { fontFamily: Fonts.bodySemi, fontSize: 11, color: Colors.primary },
  addrActions: { flexDirection: 'row', gap: 12 },
  iconBtn: { padding: 4 },
  addrLine1: { fontFamily: Fonts.body, fontSize: 14, color: Colors.text, marginBottom: 2 },
  addrLandmark: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginBottom: 2 },
  addrPincode: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted },
  addrNoPin: { fontFamily: Fonts.body, fontSize: 12, color: Colors.accentText, marginTop: 4 },
  setDefaultBtn: { marginTop: 12, alignSelf: 'flex-start' },
  setDefaultText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  addBtnWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.background, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.borderFaint,
  },
  addBtn: {
    backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
