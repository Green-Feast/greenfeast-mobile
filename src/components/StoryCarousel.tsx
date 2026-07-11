import { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Colors, Fonts } from '@/constants/colors'
import type { StorySlide } from '@/constants/homeContent'

const { width } = Dimensions.get('window')
const CARD_H = 400
const AUTO_ADVANCE_MS = 5000

type Props = { slides: StorySlide[] }

// Full-bleed image carousel — the farm → kitchen → door → you narrative.
// Same pagingEnabled-ScrollView pattern as the onboarding recommendation
// carousel, auto-advancing on a timer that resets on manual swipe.
export default function StoryCarousel({ slides }: Props) {
  const scrollRef = useRef<ScrollView>(null)
  const [page, setPage] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function startTimer() {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setPage((prev) => {
        const next = (prev + 1) % slides.length
        scrollRef.current?.scrollTo({ x: next * width, animated: true })
        return next
      })
    }, AUTO_ADVANCE_MS)
  }

  useEffect(() => {
    startTimer()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [slides.length])

  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width)
    setPage(next)
    startTimer()
  }

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
      >
        {slides.map((slide, i) => (
          <View key={i} style={{ width, height: CARD_H }}>
            <Image source={slide.image} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.75)']}
              style={styles.fade}
              pointerEvents="none"
            />
            <View style={styles.textWrap}>
              <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
              <Text style={styles.title}>{slide.title}</Text>
              <Text style={styles.body}>{slide.body}</Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {slides.map((_, i) => (
          <View key={i} style={[styles.dot, page === i && styles.dotActive]} />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
  },
  textWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 24,
  },
  eyebrow: {
    fontFamily: Fonts.bodySemi,
    fontSize: 11,
    color: Colors.accent,
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 26,
    color: '#fff',
    lineHeight: 31,
    marginBottom: 8,
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: 'rgba(255,255,255,0.88)',
    lineHeight: 19,
  },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 14 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.green700, width: 20 },
})
