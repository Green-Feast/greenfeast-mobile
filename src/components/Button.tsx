import { ReactNode } from 'react'
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts } from '@/constants/colors'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'destructive'

interface ButtonProps {
  children: ReactNode
  onPress?: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
  style?: StyleProp<ViewStyle>
}

export default function Button({
  children,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = true,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading

  function handlePressIn() {
    if (isDisabled) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
  }

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        variantStyles[variant].container,
        pressed && variantStyles[variant].pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'danger' || variant === 'destructive' ? '#fff' : Colors.primary}
        />
      ) : typeof children === 'string' ? (
        <Text style={[styles.label, variantStyles[variant].label]}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 999,
    minHeight: 52,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.45 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 16 },
})

const variantStyles: Record<Variant, { container: ViewStyle; pressed: ViewStyle; label: any }> = {
  primary: {
    container: { backgroundColor: Colors.green900 },
    pressed: { backgroundColor: Colors.green800 },
    label: { color: '#fff' },
  },
  secondary: {
    container: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.green700 },
    pressed: { backgroundColor: Colors.green50 },
    label: { color: Colors.green700 },
  },
  ghost: {
    container: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.border },
    pressed: { backgroundColor: Colors.cream200 },
    label: { color: Colors.ink900 },
  },
  danger: {
    container: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.danger },
    pressed: { backgroundColor: Colors.dangerLight },
    label: { color: Colors.danger },
  },
  destructive: {
    container: { backgroundColor: Colors.danger },
    pressed: { backgroundColor: '#A03826' },
    label: { color: '#fff' },
  },
}
