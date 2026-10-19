// Home's "How was your lunch?" card — shown once a meal is delivered (the
// server decides which meal, and how often to ask: admin → Feedback). A star
// opens the rating sheet with that many stars picked; ✕ is "not now".
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Image } from 'expo-image'
import * as Haptics from 'expo-haptics'
import { X, Star } from 'lucide-react-native'
import { mealQuestion, STAR_WORDS, type RatingPrompt } from '@/lib/ratings'
import { Colors, Fonts } from '@/constants/colors'

export default function RateMealCard({
  prompt,
  onRate,
  onDismiss,
}: {
  prompt: RatingPrompt
  onRate: (stars: number) => void
  onDismiss: () => void
}) {
  return (
    <View style={st.card}>
      <View style={st.top}>
        {prompt.image ? (
          <Image source={{ uri: prompt.image }} style={st.thumb} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        ) : (
          <View style={[st.thumb, st.thumbEmpty]}><Text style={{ fontSize: 22 }}>🍽️</Text></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={st.eyebrow}>Rate your meal</Text>
          <Text style={st.title}>{mealQuestion(prompt.date, prompt.slot)}</Text>
          <Text style={st.dish} numberOfLines={1}>{prompt.dishNames}</Text>
        </View>
        <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Not now" style={st.close}>
          <X size={18} color={Colors.textMuted} />
        </Pressable>
      </View>
      <View style={st.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
              onRate(n)
            }}
            style={({ pressed }) => [st.starBtn, pressed && { transform: [{ scale: 0.9 }] }]}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'} — ${STAR_WORDS[n]}`}
          >
            <Star size={32} color={Colors.ink300} strokeWidth={1.5} />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: Colors.cream300 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: Fonts.bodySemi, fontSize: 10, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1.5 },
  title: { fontFamily: Fonts.heading, fontSize: 18, color: Colors.ink900, marginTop: 2 },
  dish: { fontFamily: Fonts.body, fontSize: 13, color: Colors.textMuted, marginTop: 1 },
  close: { alignSelf: 'flex-start', padding: 2 },
  stars: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14, paddingHorizontal: 8 },
  starBtn: { padding: 6 },
})
