import { type ReactNode } from 'react'
import { type StyleProp, type ViewStyle, type LayoutChangeEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'

type Props = {
  children: ReactNode
  /**
   * Footer container style (background, top border, horizontal/top padding).
   * Do NOT set `paddingBottom` — this component owns the bottom inset so it can
   * collapse with the keyboard.
   */
  style?: StyleProp<ViewStyle>
  /** Constant bottom padding kept in both keyboard states. Default 16. */
  basePadding?: number
  /** Reports the footer's laid-out height (used to offset scroll content). */
  onMeasure?: (height: number) => void
}

/**
 * A primary CTA pinned above the keyboard. `KeyboardStickyView` lifts it with
 * the native keyboard animation so it is never covered, and the safe-area
 * bottom inset is animated to collapse as the keyboard opens (snug above it)
 * and restore when it closes (no leftover space). Shared by KeyboardAwareScreen
 * and Wizard so every onboarding CTA behaves identically.
 */
export default function KeyboardStickyFooter({
  children,
  style,
  basePadding = 16,
  onMeasure,
}: Props) {
  const insets = useSafeAreaInsets()
  const { progress } = useReanimatedKeyboardAnimation()

  const padStyle = useAnimatedStyle(() => ({
    paddingBottom: basePadding + insets.bottom * (1 - progress.value),
  }))

  function handleLayout(e: LayoutChangeEvent) {
    onMeasure?.(e.nativeEvent.layout.height)
  }

  return (
    <KeyboardStickyView>
      <Animated.View style={[style, padStyle]} onLayout={onMeasure ? handleLayout : undefined}>
        {children}
      </Animated.View>
    </KeyboardStickyView>
  )
}
