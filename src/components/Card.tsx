import { ReactNode } from 'react'
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native'
import { Colors } from '@/constants/colors'

interface CardProps {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  bordered?: boolean
}

// White rounded-2xl card with subtle shadow — the demo's standard surface.
export default function Card({ children, style, bordered = true }: CardProps) {
  return <View style={[styles.card, bordered && styles.bordered, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  bordered: { borderWidth: 1, borderColor: Colors.border },
})
