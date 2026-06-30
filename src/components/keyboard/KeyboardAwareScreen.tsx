import { useState, type ReactNode } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import KeyboardStickyFooter from './KeyboardStickyFooter'

type Props = {
  /** Scrollable body content. */
  children: ReactNode

  /**
   * Optional primary CTA pinned above the keyboard. The footer rides the
   * keyboard with the OS animation curve and never gets covered. Pass the
   * button (and any helper text) here; style its container with `footerStyle`.
   * Omit it for screens whose CTA lives inline at the end of the scroll.
   */
  footer?: ReactNode
  /**
   * Visual style for the sticky footer container (background, top border,
   * horizontal/top padding). Do NOT set `paddingBottom` here — the safe-area
   * bottom inset is owned by the footer so it can collapse with the keyboard.
   * Use `footerBasePadding` for the constant bottom gap.
   */
  footerStyle?: StyleProp<ViewStyle>
  /** Constant bottom padding kept in both keyboard states. Default 16. */
  footerBasePadding?: number

  /** Outer container style — typically just a background color. */
  style?: StyleProp<ViewStyle>
  /** Scroll content container style (paddings, flexGrow, etc.). */
  contentContainerStyle?: StyleProp<ViewStyle>

  /**
   * Gap kept between a focused input's caret and whatever sits below it
   * (keyboard, or the sticky footer when present). The footer's measured height
   * is added automatically. Default 24.
   */
  bottomOffset?: number

  keyboardShouldPersistTaps?: 'always' | 'never' | 'handled'
  showsVerticalScrollIndicator?: boolean
}

/**
 * One keyboard-aware screen container for the whole auth + onboarding flow.
 *
 * - Body uses `KeyboardAwareScrollView` so the focused input is always scrolled
 *   above the keyboard, and the extra space is removed cleanly on dismiss (no
 *   leftover blank area — the grey-rectangle bug).
 * - `footer` is wrapped in `KeyboardStickyFooter` so the CTA tracks the keyboard
 *   with the native animation and is never covered.
 *
 * Replaces React Native's `KeyboardAvoidingView`, which is unreliable here:
 * Expo SDK 56 / RN 0.85 runs edge-to-edge, under which Android `adjustResize`
 * behaves like `adjustNothing`, so `KeyboardAvoidingView`'s height/padding math
 * is computed against a window that never resizes.
 */
export default function KeyboardAwareScreen({
  children,
  footer,
  footerStyle,
  footerBasePadding = 16,
  style,
  contentContainerStyle,
  bottomOffset = 24,
  keyboardShouldPersistTaps = 'handled',
  showsVerticalScrollIndicator = false,
}: Props) {
  const [footerHeight, setFooterHeight] = useState(0)

  return (
    <View style={[styles.fill, style]}>
      <KeyboardAwareScrollView
        style={styles.fill}
        contentContainerStyle={contentContainerStyle}
        bottomOffset={bottomOffset + footerHeight}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      >
        {children}
      </KeyboardAwareScrollView>

      {footer != null && (
        <KeyboardStickyFooter
          style={footerStyle}
          basePadding={footerBasePadding}
          onMeasure={setFooterHeight}
        >
          {footer}
        </KeyboardStickyFooter>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
