import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native'
import { Pressable } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import * as Haptics from 'expo-haptics'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

// Mirrors expo-router's internal BottomTabBarButtonProps (not part of its public
// type exports, so we don't reach into build/ internals for it). The index
// signature lets through the accessibility props (aria-*, role, etc.) the tab
// bar passes that we don't need to touch — we only intercept the few that
// control the ripple/press feel.
type TabBarButtonProps = {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  href?: string
  android_ripple?: unknown
  pressOpacity?: number
  hoverEffect?: unknown
  onPressIn?: ((e: GestureResponderEvent) => void) | null
  onPressOut?: ((e: GestureResponderEvent) => void) | null
  [key: string]: any
}

/**
 * Custom bottom-tab press treatment: kills the default Android ripple in
 * favor of a scale + opacity animation (Reanimated) with a light haptic tick.
 * Passed as `screenOptions.tabBarButton` so every tab gets it uniformly.
 */
export default function TabBarButton({
  children,
  style,
  href,
  android_ripple,
  pressOpacity,
  hoverEffect,
  onPressIn,
  onPressOut,
  ...rest
}: TabBarButtonProps) {
  const scale = useSharedValue(1)
  const opacity = useSharedValue(1)

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }))

  function handlePressIn(e: GestureResponderEvent) {
    scale.value = withTiming(0.96, { duration: 80 })
    opacity.value = withTiming(0.8, { duration: 80 })
    Haptics.selectionAsync().catch(() => {})
    onPressIn?.(e)
  }

  function handlePressOut(e: GestureResponderEvent) {
    scale.value = withSpring(1, { damping: 20, stiffness: 120, mass: 0.5 })
    opacity.value = withTiming(1, { duration: 120 })
    onPressOut?.(e)
  }

  return (
    <AnimatedPressable
      {...rest}
      android_ripple={null}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, animatedStyle]}
    >
      {children}
    </AnimatedPressable>
  )
}
