import { useEffect, useRef } from 'react'
import { Animated, DimensionValue, StyleProp, ViewStyle } from 'react-native'

type Props = {
  width?: DimensionValue
  height?: number
  borderRadius?: number
  style?: StyleProp<ViewStyle>
}

export default function Skeleton({ width = '100%', height = 16, borderRadius = 8, style }: Props) {
  const opacity = useRef(new Animated.Value(0.35)).current

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: '#D8DDD4', opacity }, style]}
    />
  )
}
