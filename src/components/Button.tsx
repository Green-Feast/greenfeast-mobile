import { ReactNode } from 'react'
import {
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  StyleProp,
} from 'react-native'
import { Colors, Fonts } from '@/constants/colors'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface ButtonProps {
  children: ReactNode
  onPress?: () => void
  variant?: Variant
  disabled?: boolean
  loading?: boolean
  fullWidth?: boolean
  style?: StyleProp<ViewStyle>
}

// Pill-shaped button matching the demo's Button component (rounded-full, 44px min).
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

  return (
    <Pressable
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
        <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : Colors.primary} />
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
  },
  fullWidth: { width: '100%' },
  disabled: { opacity: 0.4 },
  label: { fontFamily: Fonts.bodySemi, fontSize: 16 },
})

const variantStyles: Record<Variant, { container: ViewStyle; pressed: ViewStyle; label: any }> = {
  primary: {
    container: { backgroundColor: Colors.primary },
    pressed: { backgroundColor: Colors.primaryDark },
    label: { color: '#fff' },
  },
  secondary: {
    container: { backgroundColor: 'transparent', borderWidth: 2, borderColor: Colors.primary },
    pressed: { backgroundColor: Colors.primaryLight },
    label: { color: Colors.primary },
  },
  danger: {
    container: { backgroundColor: 'transparent', borderWidth: 2, borderColor: Colors.danger },
    pressed: { backgroundColor: Colors.dangerLight },
    label: { color: Colors.danger },
  },
  ghost: {
    container: { backgroundColor: Colors.primaryLight },
    pressed: { backgroundColor: '#d0ebd0' },
    label: { color: Colors.primary },
  },
}
