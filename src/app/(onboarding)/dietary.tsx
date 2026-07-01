import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useOnboardingStore } from '@/store/onboarding'
import { useAuthStore } from '@/store/auth'
import { supabase } from '@/lib/supabase'
import { Colors, Fonts } from '@/constants/colors'
import Wizard, { type WizardStep } from '@/components/Wizard'

const ALLERGENS = ['Peanuts', 'Dairy', 'Quinoa', 'Soy', 'Nuts', 'Gluten', 'Lactose']

export default function DietaryScreen() {
  const router = useRouter()
  const { setDietaryBasics } = useOnboardingStore()
  const { user } = useAuthStore()

  const [allergens, setAllergens] = useState<string[]>([])
  const [freeText, setFreeText] = useState('')

  function toggleAllergen(val: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    setAllergens((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]))
  }

  function handleComplete() {
    // Dietary preference (veg/vegan) screen removed — default to 'none'.
    setDietaryBasics({ allergens, dietaryPreference: 'none', dietaryFreeText: freeText })
    if (user) {
      ;(async () => {
        await supabase.from('dietary_profiles').upsert({
          user_id: user.id,
          allergens,
          dietary_preference: 'none',
          free_text: freeText || null,
        }, { onConflict: 'user_id' })
      })().catch(() => {})
    }
    router.push('/(onboarding)/loading')
  }

  const steps: WizardStep[] = [
    {
      key: 'allergens',
      eyebrow: 'YOUR FOOD',
      title: 'Any allergies or things to avoid?',
      subtitle: "We'll keep these out of every meal.",
      emoji: '🚫',
      canNext: true,
      render: () => (
        <View>
          <View style={styles.pillWrap}>
            {ALLERGENS.map((opt) => {
              const on = allergens.includes(opt)
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.pill, on && styles.pillActive]}
                  onPress={() => toggleAllergen(opt)}
                >
                  <Text style={[styles.pillText, on && styles.pillTextActive]}>{opt}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Text style={styles.fieldLabel}>Anything else?</Text>
          <TextInput
            style={styles.textarea}
            placeholder="e.g. Sesame, shellfish, specific intolerances"
            value={freeText}
            onChangeText={setFreeText}
            multiline
            maxLength={250}
            placeholderTextColor={Colors.textLight}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{freeText.length}/250</Text>
        </View>
      ),
    },
  ]

  return (
    <Wizard
      steps={steps}
      nextLabel="Build my plan →"
      onComplete={handleComplete}
      onExitFirst={() => router.back()}
    />
  )
}

const styles = StyleSheet.create({
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pill: {
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: 999,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.cream50,
  },
  pillActive: { backgroundColor: Colors.green700, borderColor: Colors.green700 },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.ink500 },
  pillTextActive: { color: '#fff' },
  fieldLabel: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.ink400,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 28,
    marginBottom: 8,
  },
  textarea: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink900,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
    paddingVertical: 10,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink300, textAlign: 'right', marginTop: 6 },
})
