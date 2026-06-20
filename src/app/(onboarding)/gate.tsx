import { useState } from 'react'
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ArrowRight } from 'lucide-react-native'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'

export default function GateScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { setOnboarded } = useAuthStore()
  const [loading, setLoading] = useState(false)

  async function handleExplore() {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('users').update({ onboarded: true }).eq('id', user!.id)
      setOnboarded(true)
      router.replace('/(app)/(tabs)')
    } catch {
      setLoading(false)
    }
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.step}>Getting started</Text>
      <Text style={styles.title}>What would you{'\n'}like to do?</Text>
      <Text style={styles.subtitle}>You can always subscribe later from the app.</Text>

      <View style={styles.cards}>
        {/* Subscribe (primary) */}
        <Pressable
          style={({ pressed }) => [styles.card, styles.cardPrimary, pressed && styles.pressed]}
          onPress={() => router.push('/(onboarding)/health')}
        >
          <Text style={styles.cardIcon}>🌿</Text>
          <Text style={[styles.cardTitle, styles.textWhite]}>Build my subscription</Text>
          <Text style={[styles.cardDesc, styles.textWhiteMuted]}>
            Answer a few questions and get a plan tailored to your goals.
          </Text>
          <View style={styles.cardCtaPrimary}>
            <Text style={styles.cardCtaPrimaryText}>Build my plan</Text>
            <ArrowRight size={15} color={Colors.text} strokeWidth={2.5} />
          </View>
        </Pressable>

        {/* Explore (secondary) */}
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          onPress={handleExplore}
          disabled={loading}
        >
          <Text style={styles.cardIcon}>🏠</Text>
          <Text style={styles.cardTitle}>Explore home</Text>
          <Text style={styles.cardDesc}>Browse the menu anytime, no commitment.</Text>
          <View style={styles.cardCtaOutline}>
            {loading ? (
              <ActivityIndicator color={Colors.primary} />
            ) : (
              <Text style={styles.cardCtaOutlineText}>Just looking around</Text>
            )}
          </View>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, paddingHorizontal: 24 },
  step: { fontFamily: Fonts.bodySemi, fontSize: 12, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 28, color: Colors.text, lineHeight: 34, marginBottom: 8 },
  subtitle: { fontFamily: Fonts.body, fontSize: 15, color: Colors.textMuted, marginBottom: 28 },
  cards: { gap: 16 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pressed: { transform: [{ scale: 0.98 }] },
  cardIcon: { fontSize: 34, marginBottom: 12 },
  cardTitle: { fontFamily: Fonts.heading, fontSize: 19, color: Colors.text, marginBottom: 6 },
  cardDesc: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, marginBottom: 18 },
  textWhite: { color: '#fff' },
  textWhiteMuted: { color: Colors.primaryMid },
  cardCtaPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.accent, borderRadius: 999, paddingVertical: 13, minHeight: 46,
  },
  cardCtaPrimaryText: { fontFamily: Fonts.bodyBold, fontSize: 14, color: Colors.text },
  cardCtaOutline: {
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 999, paddingVertical: 13, minHeight: 46,
    borderWidth: 2, borderColor: Colors.primary,
  },
  cardCtaOutlineText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: Colors.primary },
})
