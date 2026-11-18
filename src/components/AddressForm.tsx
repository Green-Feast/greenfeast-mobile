import { useRef, useState, type Ref } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Lock, Info } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'
import LocationPicker from '@/components/LocationPicker'
import { usePlacesAutocomplete, PredictionsDropdown, type PlaceSelection } from '@/components/PlacesAutocomplete'
import {
  SERVICE_CITY, hasHouseNumber, nearJaipur, pincodeError,
  type AddressDraft, type AddressType, type ParsedAddress,
} from '@/lib/address'

// The one address form (onboarding's address step and Plan settings → address
// book; the day cart sends customers to the address book). Every field stays
// editable after Google fills it: Places picks, map pins and the current
// location often come without the house number, and a rider can't find a door
// without it.

type FillField = 'line1' | 'line2' | 'pincode'

const TYPES: { id: AddressType; label: string }[] = [
  { id: 'home', label: '🏠 Home' },
  { id: 'office', label: '🏢 Office' },
  { id: 'other', label: '📍 Other' },
]

type Props = {
  value: AddressDraft
  onChange: (next: AddressDraft) => void
  errors: Record<string, string>
  onClearError: (field: string) => void
  servedPincodes: Map<string, string> | null
  variant?: 'underline' | 'boxed'
  line1Ref?: Ref<TextInput>
  mapHeight?: number
}

export default function AddressForm({
  value, onChange, errors, onClearError, servedPincodes, variant = 'boxed', line1Ref, mapHeight = 190,
}: Props) {
  const [focused, setFocused] = useState<string | null>(null)
  // What Google filled in last, per field. A field whose text differs from it
  // is the customer's own and a map pin never overwrites it.
  const machine = useRef<Partial<Record<FillField, string>>>({})
  // A map / location address we didn't apply because the customer had typed.
  const [suggestion, setSuggestion] = useState<ParsedAddress | null>(null)
  const [houseHint, setHouseHint] = useState(false)

  // Async callbacks (Places, geocoding) must build on the latest value.
  const latest = useRef(value)
  latest.current = value
  function patch(p: Partial<AddressDraft>) {
    const next = { ...latest.current, ...p }
    latest.current = next
    onChange(next)
  }

  const isCustomers = (f: FillField) => {
    const v = latest.current[f].trim()
    return v !== '' && v !== (machine.current[f] ?? '').trim()
  }

  const autocomplete = usePlacesAutocomplete((sel: PlaceSelection) => {
    // An explicit pick replaces the address; the customer can edit any of it.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const p: Partial<AddressDraft> = { line1: sel.line1, line2: sel.line2, placeId: sel.placeId }
    if (sel.pincode) p.pincode = sel.pincode
    if (sel.lat != null && sel.lng != null) { p.lat = sel.lat; p.lng = sel.lng; p.source = 'places' }
    machine.current = { line1: sel.line1, line2: sel.line2, ...(sel.pincode ? { pincode: sel.pincode } : {}) }
    patch(p)
    setSuggestion(null)
    setHouseHint(!sel.houseNumber && !hasHouseNumber(sel.line1))
    onClearError('line1'); onClearError('pincode'); onClearError('pin')
  })

  function applyParsed(a: ParsedAddress, force: boolean) {
    const p: Partial<AddressDraft> = {}
    let skipped = false
    const fill = (f: FillField, v: string | null) => {
      if (!v) return
      if (!force && isCustomers(f)) { if (latest.current[f].trim() !== v) skipped = true; return }
      p[f] = v
      machine.current[f] = v
    }
    fill('line1', a.line1)
    fill('line2', a.line2)
    fill('pincode', a.pincode)
    patch(p)
    if (p.line1 || p.pincode) { onClearError('line1'); onClearError('pincode') }
    setSuggestion(skipped ? a : null)
    const line1 = p.line1 ?? latest.current.line1
    setHouseHint(!hasHouseNumber(line1))
  }

  function onPin(c: { lat: number; lng: number }, source: 'map' | 'gps') {
    // A moved pin is no longer the picked place.
    patch({ lat: c.lat, lng: c.lng, source, placeId: null })
    onClearError('pin')
  }

  function onResolved(a: ParsedAddress | null) {
    if (a) applyParsed(a, false)
  }

  const pinOutside = value.lat != null && value.lng != null && !nearJaipur(value.lat, value.lng)
  const pc = value.pincode
  const pcLive = pc.length === 6 ? pincodeError(pc, servedPincodes) : null
  const pcArea = pc.length === 6 && !pcLive ? servedPincodes?.get(pc) : undefined
  const ul = variant === 'underline'
  const inputStyle = (f: string, extra?: object) => [
    ul ? st.inputUl : st.inputBox,
    focused === f && (ul ? st.inputUlFocused : st.inputBoxFocused),
    !!errors[f] && (ul ? st.inputUlError : st.inputBoxError),
    extra,
  ]
  const Label = ({ children, optional }: { children: string; optional?: boolean }) => (
    <Text style={ul ? st.labelUl : st.labelBox}>
      {children}{optional ? <Text style={st.optional}>  (optional)</Text> : null}
    </Text>
  )

  return (
    <View>
      <View style={st.field}>
        <Label>{ul ? 'ADDRESS LINE 1' : 'Address line 1'}</Label>
        <TextInput
          ref={line1Ref}
          style={inputStyle('line1', st.multiline)}
          placeholder="House / flat no., building, street — or search"
          value={value.line1}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          submitBehavior="blurAndSubmit"
          returnKeyType="next"
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={250}
          onChangeText={(t) => {
            const v = t.replace(/\s*\n+\s*/g, ', ')
            patch({ line1: v })
            onClearError('line1')
            if (hasHouseNumber(v)) setHouseHint(false)
            autocomplete.onChangeText(v)
          }}
          onFocus={() => { setFocused('line1'); autocomplete.onFocus() }}
          onBlur={() => { setFocused(null); autocomplete.onBlur() }}
          placeholderTextColor={Colors.textLight}
        />
        <PredictionsDropdown
          predictions={autocomplete.predictions}
          visible={autocomplete.visible}
          onPick={autocomplete.selectPrediction}
        />
        {errors.line1 ? <Text style={st.error}>{errors.line1}</Text> : null}
        {!errors.line1 && houseHint ? (
          <View style={st.note}>
            <Info size={14} color={Colors.accentText} />
            <Text style={st.noteText}>Add your house / flat number to line 1 so the rider finds your door.</Text>
          </View>
        ) : null}
      </View>

      <View style={st.field}>
        <Label optional>{ul ? 'ADDRESS LINE 2' : 'Address line 2'}</Label>
        <TextInput
          style={inputStyle('line2')}
          placeholder="Area, colony, sector"
          value={value.line2}
          onChangeText={(t) => patch({ line2: t })}
          onFocus={() => setFocused('line2')}
          onBlur={() => setFocused(null)}
          autoCapitalize="words"
          maxLength={150}
          placeholderTextColor={Colors.textLight}
        />
      </View>

      <View style={st.field}>
        <Label optional>{ul ? 'LANDMARK' : 'Landmark'}</Label>
        <TextInput
          style={inputStyle('landmark')}
          placeholder="e.g. Opposite the park, near the blue gate"
          value={value.landmark}
          onChangeText={(t) => patch({ landmark: t })}
          onFocus={() => setFocused('landmark')}
          onBlur={() => setFocused(null)}
          maxLength={100}
          placeholderTextColor={Colors.textLight}
        />
      </View>

      <View style={[st.field, st.row]}>
        <View style={{ flex: 1 }}>
          <Label>{ul ? 'PINCODE' : 'Pincode'}</Label>
          <TextInput
            style={inputStyle("pincode", pcLive ? st.warnBorder : undefined)}
            placeholder="302…"
            keyboardType="number-pad"
            maxLength={6}
            value={value.pincode}
            onChangeText={(t) => { patch({ pincode: t.replace(/\D/g, '') }); onClearError('pincode') }}
            onFocus={() => setFocused('pincode')}
            onBlur={() => setFocused(null)}
            placeholderTextColor={Colors.textLight}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Label>{ul ? 'CITY' : 'City'}</Label>
          <View style={[ul ? st.inputUl : st.inputBox, st.locked]}>
            <Text style={st.lockedText}>{SERVICE_CITY}</Text>
            <Lock size={13} color={Colors.textLight} />
          </View>
        </View>
      </View>
      {errors.pincode || pcLive ? (
        <Text style={[st.error, st.afterRow]}>{errors.pincode || pcLive}</Text>
      ) : pcArea ? (
        <Text style={[st.ok, st.afterRow]}>✓ {pcArea}</Text>
      ) : null}

      <View style={st.field}>
        <Label>{ul ? 'PIN YOUR BUILDING' : 'Pin your building on the map'}</Label>
        <Text style={st.help}>Recommended — the rider navigates to this pin with Google Maps.</Text>
        <LocationPicker
          value={value.lat != null && value.lng != null ? { lat: value.lat, lng: value.lng } : null}
          onChange={onPin}
          onResolveAddress={onResolved}
          height={mapHeight}
        />
        {errors.pin ? <Text style={st.error}>{errors.pin}</Text> : null}
        {pinOutside ? (
          <Text style={st.error}>This pin is outside Jaipur. Please move it onto the delivery address.</Text>
        ) : null}
        {suggestion ? (
          <Pressable
            style={st.suggest}
            onPress={() => { applyParsed(suggestion, true); setSuggestion(null) }}
          >
            <Text style={st.suggestText} numberOfLines={3}>
              Google has this pin at <Text style={{ fontFamily: Fonts.bodySemi }}>
                {[suggestion.line1, suggestion.line2, suggestion.pincode].filter(Boolean).join(', ')}
              </Text>
            </Text>
            <Text style={st.suggestBtn}>Use it</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={st.field}>
        <Label>{ul ? 'ADDRESS TYPE' : 'Address type'}</Label>
        <View style={st.typeRow}>
          {TYPES.map((t) => (
            <Pressable
              key={t.id}
              style={[st.typeBtn, value.type === t.id && st.typeBtnActive]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
                const auto = TYPES.some((x) => x.id.charAt(0).toUpperCase() + x.id.slice(1) === value.label) || !value.label.trim()
                patch({ type: t.id, ...(auto ? { label: t.id.charAt(0).toUpperCase() + t.id.slice(1) } : {}) })
              }}
            >
              <Text style={[st.typeBtnText, value.type === t.id && st.typeBtnTextActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={st.field}>
        <Label optional>{ul ? 'LABEL' : 'Label'}</Label>
        <TextInput
          style={inputStyle('label')}
          placeholder="e.g. Home, Mom's place"
          value={value.label}
          onChangeText={(t) => patch({ label: t })}
          onFocus={() => setFocused('label')}
          onBlur={() => setFocused(null)}
          maxLength={40}
          placeholderTextColor={Colors.textLight}
        />
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  field: { marginBottom: 18 },
  row: { flexDirection: 'row', gap: 14, marginBottom: 0 },
  afterRow: { marginTop: 6 },
  labelUl: {
    fontFamily: Fonts.bodyMed, fontSize: 11, color: Colors.ink400,
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8,
  },
  labelBox: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.text, marginBottom: 8 },
  optional: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink400, textTransform: 'none', letterSpacing: 0 },
  inputUl: {
    fontFamily: Fonts.body, fontSize: 16, color: Colors.ink900,
    borderBottomWidth: 1.5, borderBottomColor: Colors.border, paddingVertical: 10, paddingHorizontal: 0,
  },
  inputUlFocused: { borderBottomColor: Colors.green700 },
  inputUlError: { borderBottomColor: Colors.danger },
  inputBox: {
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.body, fontSize: 15, color: Colors.text,
  },
  inputBoxFocused: { borderColor: Colors.primary },
  inputBoxError: { borderColor: Colors.danger },
  warnBorder: { borderColor: Colors.danger, borderBottomColor: Colors.danger },
  multiline: { minHeight: 48, lineHeight: 21 },
  locked: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.cream100, opacity: 0.85 },
  lockedText: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted },
  error: { fontFamily: Fonts.body, fontSize: 12, color: Colors.danger, marginTop: 6 },
  ok: { fontFamily: Fonts.body, fontSize: 12, color: Colors.primary, marginTop: 6 },
  help: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: -4, marginBottom: 8 },
  note: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 8,
    backgroundColor: Colors.accentLight, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
  },
  noteText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.accentText, lineHeight: 17 },
  suggest: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8,
    backgroundColor: Colors.primaryLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
  },
  suggestText: { flex: 1, fontFamily: Fonts.body, fontSize: 12, color: Colors.text, lineHeight: 17 },
  suggestBtn: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.primary },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 999, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: '#fff', alignItems: 'center',
  },
  typeBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  typeBtnText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  typeBtnTextActive: { color: Colors.primary },
})
