import { useEffect, useState, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, Plus, Trash2, Edit3, Check } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import LocationPicker, { type LatLng } from '@/components/LocationPicker'

type Address = {
  id: string
  line1: string
  landmark: string | null
  pincode: string
  label: string
  type: 'home' | 'office' | 'other'
  is_default: boolean
  lat: number | null
  lng: number | null
}

const ADDR_TYPES = [
  { id: 'home' as const, label: '🏠 Home' },
  { id: 'office' as const, label: '🏢 Office' },
  { id: 'other' as const, label: '📍 Other' },
]

function validate(line1: string, pincode: string) {
  const e: Record<string, string> = {}
  if (!line1.trim() || line1.trim().length < 5) e.line1 = 'Enter a valid street address'
  if (!/^\d{6}$/.test(pincode)) e.pincode = 'Pincode must be 6 digits'
  return e
}

export default function AddressesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuthStore()

  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Form state
  const [line1, setLine1] = useState('')
  const [landmark, setLandmark] = useState('')
  const [pincode, setPincode] = useState('')
  const [label, setLabel] = useState('Home')
  const [addrType, setAddrType] = useState<'home' | 'office' | 'other'>('home')
  const [pin, setPin] = useState<LatLng | null>(null)

  const fetchAddresses = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('addresses')
      .select('id, line1, landmark, pincode, label, type, is_default, lat, lng')
      .eq('user_id', user.id)
      .order('is_default', { ascending: false })
      .order('created_at')
    setAddresses((data as Address[]) ?? [])
  }, [user])

  useEffect(() => {
    setLoading(true)
    fetchAddresses().finally(() => setLoading(false))
  }, [fetchAddresses])

  function openAdd() {
    setEditingId(null)
    setLine1(''); setLandmark(''); setPincode(''); setLabel('Home'); setAddrType('home'); setPin(null)
    setError(''); setFieldErrors({})
    setFormOpen(true)
  }

  function openEdit(addr: Address) {
    setEditingId(addr.id)
    setLine1(addr.line1); setLandmark(addr.landmark ?? ''); setPincode(addr.pincode)
    setLabel(addr.label); setAddrType(addr.type)
    setPin(addr.lat != null && addr.lng != null ? { lat: addr.lat, lng: addr.lng } : null)
    setError(''); setFieldErrors({})
    setFormOpen(true)
  }

  async function handleSave() {
    const fe = validate(line1, pincode)
    if (Object.keys(fe).length > 0) { setFieldErrors(fe); return }
    setSaving(true); setError('')
    try {
      if (editingId) {
        const { error: err } = await supabase.from('addresses')
          .update({ line1: line1.trim(), landmark: landmark.trim() || null, pincode, label, type: addrType, lat: pin?.lat ?? null, lng: pin?.lng ?? null })
          .eq('id', editingId)
        if (err) throw err
      } else {
        const isFirst = addresses.length === 0
        const { error: err } = await supabase.from('addresses').insert({
          user_id: user!.id,
          line1: line1.trim(),
          landmark: landmark.trim() || null,
          pincode,
          label,
          type: addrType,
          lat: pin?.lat ?? null,
          lng: pin?.lng ?? null,
          is_default: isFirst,
        })
        if (err) throw err
      }
      setFormOpen(false)
      await fetchAddresses()
    } catch { setError('Could not save address. Please try again.') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await supabase.from('addresses').delete().eq('id', id)
      const updated = addresses.filter(a => a.id !== id)
      // If deleted was default and there are remaining addresses, promote the first
      if (addresses.find(a => a.id === id)?.is_default && updated.length > 0) {
        await supabase.from('addresses').update({ is_default: true }).eq('id', updated[0].id)
      }
      await fetchAddresses()
    } finally { setDeletingId(null) }
  }

  async function handleSetDefault(id: string) {
    if (!user) return
    await supabase.from('addresses').update({ is_default: false }).eq('user_id', user.id)
    await supabase.from('addresses').update({ is_default: true }).eq('id', id)
    await fetchAddresses()
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
            <Text style={s.emptySubText}>Add one below to speed up checkout.</Text>
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
                <Text style={s.addrLine1}>{addr.line1}</Text>
                {addr.landmark ? <Text style={s.addrLandmark}>{addr.landmark}</Text> : null}
                <Text style={s.addrPincode}>Pincode: {addr.pincode}</Text>
                {!addr.is_default && (
                  <Pressable style={s.setDefaultBtn} onPress={() => handleSetDefault(addr.id)}>
                    <Text style={s.setDefaultText}>Set as default</Text>
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

      {/* Add / Edit sheet */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <View style={f.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setFormOpen(false)} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={f.sheet}>
              <View style={f.handle} />
              <View style={f.header}>
                <Text style={f.title}>{editingId ? 'Edit address' : 'Add address'}</Text>
                <Pressable onPress={() => setFormOpen(false)} hitSlop={12}>
                  <Text style={f.closeText}>Cancel</Text>
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                style={f.formScroll}
                contentContainerStyle={{ padding: 16 }}
                keyboardShouldPersistTaps="handled"
              >
                <FormField label="Street address" error={fieldErrors.line1}>
                  <TextInput
                    style={[f.input, fieldErrors.line1 && f.inputError]}
                    placeholder="House/flat no., street name"
                    value={line1}
                    onChangeText={(t) => { setLine1(t); setFieldErrors(e => ({ ...e, line1: '' })) }}
                    placeholderTextColor={Colors.textLight}
                  />
                </FormField>

                <FormField label="Landmark (optional)">
                  <TextInput
                    style={f.input}
                    placeholder="e.g. Near the blue gate"
                    value={landmark}
                    onChangeText={setLandmark}
                    placeholderTextColor={Colors.textLight}
                  />
                </FormField>

                <FormField label="Pincode" error={fieldErrors.pincode}>
                  <TextInput
                    style={[f.input, fieldErrors.pincode && f.inputError]}
                    placeholder="6-digit pincode"
                    keyboardType="number-pad"
                    maxLength={6}
                    value={pincode}
                    onChangeText={(t) => { setPincode(t.replace(/\D/g, '')); setFieldErrors(e => ({ ...e, pincode: '' })) }}
                    placeholderTextColor={Colors.textLight}
                  />
                </FormField>

                <FormField label="Pin your location (optional)">
                  <LocationPicker
                    value={pin}
                    onChange={setPin}
                    height={180}
                    onResolveAddress={({ line1: l1, pincode: pc }) => {
                      if (l1) { setLine1(l1); setFieldErrors(e => ({ ...e, line1: '' })) }
                      if (pc && /^\d{6}$/.test(pc)) { setPincode(pc); setFieldErrors(e => ({ ...e, pincode: '' })) }
                    }}
                  />
                </FormField>

                <FormField label="Address type">
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {ADDR_TYPES.map((t) => (
                      <Pressable
                        key={t.id}
                        style={[f.typeBtn, addrType === t.id && f.typeBtnActive]}
                        onPress={() => { setAddrType(t.id); setLabel(t.id.charAt(0).toUpperCase() + t.id.slice(1)) }}
                      >
                        <Text style={[f.typeBtnText, addrType === t.id && f.typeBtnTextActive]}>{t.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </FormField>

                <FormField label="Label (optional)">
                  <TextInput
                    style={f.input}
                    placeholder="e.g. Home, Mom's place"
                    value={label}
                    onChangeText={setLabel}
                    maxLength={40}
                    placeholderTextColor={Colors.textLight}
                  />
                </FormField>

                {error ? <Text style={f.errorText}>{error}</Text> : null}
                <View style={{ height: 16 }} />
              </ScrollView>

              <Pressable
                style={[f.saveBtn, saving && f.saveBtnDisabled]}
                disabled={saving}
                onPress={handleSave}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={f.saveBtnText}>{editingId ? 'Save changes' : 'Add address'}</Text>}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  )
}

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, marginBottom: 8 }}>{label}</Text>
      {children}
      {error ? <Text style={f.fieldError}>{error}</Text> : null}
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

const f = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 24, maxHeight: '90%' },
  formScroll: { flexShrink: 1 },
  handle: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 999, alignSelf: 'center', marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 16 },
  title: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.text },
  closeText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.textMuted },
  input: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, fontFamily: Fonts.body, fontSize: 15, color: Colors.text,
  },
  inputError: { borderColor: Colors.danger },
  fieldError: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 4 },
  typeBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 999, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: '#fff', alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  typeBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  typeBtnTextActive: { color: Colors.primary },
  errorText: { fontFamily: Fonts.body, fontSize: 13, color: Colors.danger, marginBottom: 8 },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center', marginHorizontal: 16, marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
