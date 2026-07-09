import { useState } from 'react'
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/auth'
import { Colors, Fonts } from '@/constants/colors'
import Button from '@/components/Button'
import Logo from '@/components/Logo'

const FOOD_PHOTO = require('@/assets/food/avo-protein.jpg')

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
    <View style={styles.container}>
      {/* Food photo — top half */}
      <View style={styles.photoWrap}>
        <Image
          source={FOOD_PHOTO}
          style={styles.photo}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
        <LinearGradient
          colors={['transparent', Colors.cream50]}
          style={styles.photoFade}
          pointerEvents="none"
        />
      </View>

      {/* Bottom content */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 32 }]}>
        {/* Wordmark */}
        <View style={styles.wordmark}>
          <Logo size={28} />
          <Text style={styles.wordmarkText}>greenfeast</Text>
        </View>

        {/* Headline */}
        <Text style={styles.headline}>
          Salads that actually{'\n'}fill you up.
        </Text>

        <Text style={styles.subtitle}>
          Farm-fresh bowls built around your goals,{'\n'}delivered to you daily.
        </Text>

        {/* CTAs */}
        <Button onPress={() => router.push('/(onboarding)/health')} style={styles.primaryBtn}>
          Get started
        </Button>

        <Button
          variant="ghost"
          onPress={handleExplore}
          disabled={loading}
          style={styles.ghostBtn}
        >
          {loading ? (
            <ActivityIndicator color={Colors.ink500} />
          ) : (
            'Just browse the menu'
          )}
        </Button>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.cream50,
  },

  photoWrap: {
    width: '100%',
    height: '45%',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '35%',
  },

  bottom: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 0,
  },

  wordmark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  wordmarkText: {
    fontFamily: Fonts.headingSemi,
    fontSize: 17,
    color: Colors.green700,
    letterSpacing: -0.3,
  },

  headline: {
    fontFamily: Fonts.heading,
    fontSize: 38,
    color: Colors.ink900,
    lineHeight: 44,
    marginBottom: 12,
  },

  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink500,
    lineHeight: 22,
    marginBottom: 28,
  },

  primaryBtn: {
    marginBottom: 10,
  },
  ghostBtn: {},
})
