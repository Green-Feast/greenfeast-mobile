import { useRef, useEffect, useState } from 'react'
import {
  View,
  ScrollView,
  Text,
  Pressable,
  StyleSheet,
  LayoutChangeEvent,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Colors, Fonts } from '@/constants/colors'

const TICK_SPACING = 20   // pixels per unit

interface RulerPickerProps {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  unit: string
  step?: number
}

export default function RulerPicker({
  min, max, value, onChange, unit, step = 1,
}: RulerPickerProps) {
  const scrollRef = useRef<ScrollView>(null)
  const lastHapticValue = useRef(value)
  const lastScrollValue = useRef(value)
  const [rulerWidth, setRulerWidth] = useState(0)
  const didInitialScroll = useRef(false)

  const xForValue = (v: number) => (v - min) * TICK_SPACING

  function onRulerLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width
    setRulerWidth(w)
    if (!didInitialScroll.current && w > 0) {
      didInitialScroll.current = true
      setTimeout(() => {
        scrollRef.current?.scrollTo({ x: xForValue(value), animated: false })
      }, 50)
    }
  }

  // Scroll to match when value changes via arrow buttons (not from scroll)
  useEffect(() => {
    if (!didInitialScroll.current || rulerWidth === 0) return
    if (value !== lastScrollValue.current) {
      scrollRef.current?.scrollTo({ x: xForValue(value), animated: true })
    }
  }, [value])

  function handleScroll(event: any) {
    if (rulerWidth === 0) return
    const x = event.nativeEvent.contentOffset.x
    const derived = Math.min(max, Math.max(min, min + Math.round(x / TICK_SPACING)))
    if (derived !== lastHapticValue.current) {
      lastHapticValue.current = derived
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  }

  function handleScrollEnd(event: any) {
    const x = event.nativeEvent.contentOffset.x
    const derived = Math.min(max, Math.max(min, min + Math.round(x / TICK_SPACING)))
    lastScrollValue.current = derived
    if (derived !== value) onChange(derived)
  }

  function nudge(dir: 1 | -1) {
    const next = Math.min(max, Math.max(min, value + dir * step))
    if (next === value) return
    lastScrollValue.current = next
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    onChange(next)
  }

  const ticks = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const halfPad = rulerWidth > 0 ? rulerWidth / 2 : 150

  return (
    <View style={styles.container}>
      {/* Always-visible value pill */}
      <View style={styles.pillRow}>
        <View style={styles.pill}>
          <Text style={styles.pillText}>{value} {unit}</Text>
        </View>
      </View>

      {/* Arrow + ruler row */}
      <View style={styles.rulerRow}>
        <Pressable style={styles.arrow} onPress={() => nudge(-1)} hitSlop={12}>
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>

        <View style={styles.rulerContainer} onLayout={onRulerLayout}>
          {/* Center selection indicator */}
          {rulerWidth > 0 && (
            <View
              style={[styles.centerIndicator, { left: rulerWidth / 2 - 1 }]}
              pointerEvents="none"
            />
          )}

          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToInterval={TICK_SPACING}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onMomentumScrollEnd={handleScrollEnd}
            onScrollEndDrag={handleScrollEnd}
            contentContainerStyle={{ paddingHorizontal: halfPad }}
          >
            <View style={styles.ticksRow}>
              {ticks.map((v) => {
                const offset = v - min
                const isMajor = offset % 10 === 0
                const isMid   = !isMajor && offset % 5 === 0
                return (
                  <View key={v} style={styles.tickSlot}>
                    <View style={[
                      styles.tickLine,
                      isMajor ? styles.tickMajor :
                      isMid   ? styles.tickMid   :
                                styles.tickMinor,
                    ]} />
                    {isMajor && (
                      <Text style={styles.tickLabel}>{v}</Text>
                    )}
                  </View>
                )
              })}
            </View>
          </ScrollView>
        </View>

        <Pressable style={styles.arrow} onPress={() => nudge(1)} hitSlop={12}>
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'stretch',
  },

  pillRow: {
    alignItems: 'center',
    marginBottom: 10,
  },
  pill: {
    backgroundColor: Colors.green700,
    paddingHorizontal: 20,
    paddingVertical: 7,
    borderRadius: 999,
  },
  pillText: {
    fontFamily: Fonts.bodyBold,
    fontSize: 18,
    color: Colors.cream50,
    letterSpacing: 0.5,
  },

  rulerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  arrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.green700,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: {
    fontFamily: Fonts.bodySemi,
    fontSize: 20,
    color: Colors.green700,
    lineHeight: 22,
  },

  rulerContainer: {
    flex: 1,
    height: 56,
    overflow: 'hidden',
  },

  centerIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: Colors.green700,
    opacity: 0.35,
    zIndex: 1,
  },

  ticksRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 56,
    paddingBottom: 4,
  },

  tickSlot: {
    width: TICK_SPACING,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  tickLine: {
    width: 1.5,
  },
  tickMinor: {
    height: 8,
    backgroundColor: Colors.ink100,
  },
  tickMid: {
    height: 14,
    backgroundColor: Colors.ink300,
  },
  tickMajor: {
    height: 20,
    backgroundColor: Colors.ink500,
  },
  tickLabel: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.ink400,
    marginTop: 3,
    textAlign: 'center',
  },
})
