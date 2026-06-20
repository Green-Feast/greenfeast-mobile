import { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { supabase } from '@/lib/supabase'
import { useOnboardingStore } from '@/store/onboarding'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'

// Customisation options (sub-flow.txt S7). Collected AFTER payment so the
// pre-purchase flow stays short. NOTE: protein_preference stores the proteins
// the customer wants AVOIDED (column name is legacy).
const PROTEINS = ['Paneer', 'Tofu']
const BASES = ['Quinoa', 'Couscous', 'Rice', 'Pasta', 'Soba noodles']
const VEGGIES = ['Mushroom', 'Bell pepper', 'Broccoli', 'Onion']

const FORMATS = [
  { label: 'Bowls', value: 'bowls' as const },
  { label: 'Wraps', value: 'wraps' as const },
  { label: 'Both', value: 'both' as const },
]
const SPICES = [
  { label: 'Mild', value: 'mild' as const },
  { label: 'Medium', value: 'medium' as const },
  { label: 'Spicy', value: 'spicy' as const },
]
const DRESSINGS = [
  { label: 'Mixed in', value: 'mixed-in' as const },
  { label: 'On the side', value: 'on-the-side' as const },
]

export default function CustomiseScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { dietaryFreeText, setCustomisations, reset } = useOnboardingStore()

  const [proteinAvoid, setProteinAvoid] = useState<string[]>([])
  const [baseAvoid, setBaseAvoid] = useState<string[]>([])
  const [veggieAvoid, setVeggieAvoid] = useState<string[]>([])
  const [format, setFormat] = useState<'bowls' | 'wraps' | 'both' | ''>('')
  const [spice, setSpice] = useState<'mild' | 'medium' | 'spicy' | ''>('')
  const [dressing, setDressing] = useState<'mixed-in' | 'on-the-side' | ''>('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  function toggle(arr: string[], val: string, setter: (v: string[]) => void) {
    setter(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val])
  }

  function goHome() {
    reset()
    router.replace('/(app)/(tabs)')
  }

  async function handleSave() {
    setSaving(true)
    try {
      setCustomisations({
        proteinPreference: proteinAvoid,
        baseAvoidance: baseAvoid,
        veggieAvoidance: veggieAvoid,
        formatPreference: format,
        spicePreference: spice,
        dressingPreference: dressing,
        customisationNote: note,
      })

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        // Preserve the allergy note captured pre-payment alongside any new note.
        const combinedNote = [dietaryFreeText, note].filter(Boolean).join(' • ') || null
        await supabase
          .from('dietary_profiles')
          .update({
            protein_preference: proteinAvoid,
            base_avoidance: baseAvoid,
            veggie_avoidance: veggieAvoid,
            format_preference: format || null,
            spice_preference: spice || null,
            dressing_preference: dressing || null,
            free_text: combinedNote,
          })
          .eq('user_id', user.id)
      }
    } catch {
      // Non-blocking — customisations are optional; never trap the user here.
    } finally {
      goHome()
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>Last step</Text>
        <Text style={styles.title}>How do you like your meals?</Text>
        <Text style={styles.subtitle}>
          Our bowls use different proteins, bases, and veggies — tell us if anything doesn't suit you and we'll swap it out.
        </Text>

        <Section title="Proteins to avoid">
          <Pills options={PROTEINS} selected={proteinAvoid} onToggle={(v) => toggle(proteinAvoid, v, setProteinAvoid)} />
        </Section>

        <Section title="Bases to avoid">
          <Pills options={BASES} selected={baseAvoid} onToggle={(v) => toggle(baseAvoid, v, setBaseAvoid)} />
        </Section>

        <Section title="Vegetables to skip">
          <Pills options={VEGGIES} selected={veggieAvoid} onToggle={(v) => toggle(veggieAvoid, v, setVeggieAvoid)} />
        </Section>

        <Section title="Format preference">
          <Choice options={FORMATS} value={format} onSelect={setFormat} />
        </Section>

        <Section title="Spice level">
          <Choice options={SPICES} value={spice} onSelect={setSpice} />
        </Section>

        <Section title="Dressing">
          <Choice options={DRESSINGS} value={dressing} onSelect={setDressing} />
        </Section>

        <Section title="Anything else?">
          <TextInput
            style={styles.textarea}
            placeholder="e.g. extra spicy, no raw onion, less oil"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={250}
            placeholderTextColor={Colors.textLight}
            textAlignVertical="top"
          />
        </Section>

        <Button onPress={handleSave} disabled={saving} style={{ marginTop: 8 }}>
          {saving ? <ActivityIndicator color="#fff" /> : 'Save & finish →'}
        </Button>
        <TouchableOpacity style={styles.skip} onPress={goHome} disabled={saving}>
          <Text style={styles.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Pills({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <View style={styles.pillRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt}
          style={[styles.pill, selected.includes(opt) && styles.pillActive]}
          onPress={() => onToggle(opt)}
        >
          <Text style={[styles.pillText, selected.includes(opt) && styles.pillTextActive]}>{opt}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

function Choice<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { label: string; value: T }[]
  value: T | ''
  onSelect: (v: T) => void
}) {
  return (
    <View style={styles.pillRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.pill, value === opt.value && styles.pillActive]}
          onPress={() => onSelect(opt.value)}
        >
          <Text style={[styles.pillText, value === opt.value && styles.pillTextActive]}>{opt.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 24, paddingBottom: 40 },
  eyebrow: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 26, color: Colors.text, marginBottom: 6 },
  subtitle: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 24 },
  section: { marginBottom: 22 },
  sectionTitle: { fontFamily: Fonts.headingSemi, fontSize: 15, color: Colors.text, marginBottom: 12 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 13, color: Colors.textMuted },
  pillTextActive: { color: '#fff' },
  textarea: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: 14,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.text,
    minHeight: 80,
  },
  skip: { alignItems: 'center', marginTop: 14 },
  skipText: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, textDecorationLine: 'underline' },
})
