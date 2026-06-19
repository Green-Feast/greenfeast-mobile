import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, Animated, Easing } from 'react-native'
import { useRouter } from 'expo-router'
import { Colors, Fonts } from '@/constants/colors'

const STEPS = [
  'Calculating your daily protein requirement...',
  'Matching meals to your goal and dietary needs...',
  'Filtering out allergens and restrictions...',
  'Building your personalised plan...',
]

export default function LoadingScreen() {
  const router = useRouter()
  const [stepIndex, setStepIndex] = useState(0)
  const rotation = useRef(new Animated.Value(0)).current
  const fadeAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    // Spin animation (continuous)
    Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start()

    // Cycle through steps every 700ms
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start()
      setStepIndex((i) => (i + 1) % STEPS.length)
    }, 700)

    // Auto-advance after 2.8s
    const timeout = setTimeout(() => {
      clearInterval(interval)
      router.replace('/(onboarding)/recommendation')
    }, 2800)

    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [])

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  })

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]}>
        <Text style={styles.spinnerIcon}>🌿</Text>
      </Animated.View>

      <Text style={styles.title}>Building your personalised plan...</Text>

      <Animated.Text style={[styles.step, { opacity: fadeAnim }]}>
        {STEPS[stepIndex]}
      </Animated.Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  spinner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  spinnerIcon: { fontSize: 36 },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 22,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 30,
  },
  step: {
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
  },
})
