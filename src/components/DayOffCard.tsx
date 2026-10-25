// My Plan on a Sunday: our day off, said nicely, with a way to reach us for
// anything special (only the office can put a meal on a Sunday).
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native'
import * as Haptics from 'expo-haptics'
import { MessageCircle } from 'lucide-react-native'
import { supportWhatsAppUrl } from '@/constants/links'
import { Colors, Fonts } from '@/constants/colors'

export default function DayOffCard() {
  return (
    <View style={st.card}>
      <Text style={st.emoji}>🌿☕</Text>
      <Text style={st.title}>Sunday is our day off</Text>
      <Text style={st.script}>The kitchen is resting up for Monday.</Text>
      <Text style={st.body}>
        No meals go out on Sundays, so there's nothing to add or change today. Need something special? Just ask.
      </Text>
      <Pressable
        style={({ pressed }) => [st.pill, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
          Linking.openURL(supportWhatsAppUrl('My Plan > Sunday')).catch(() => {})
        }}
        accessibilityRole="button"
      >
        <MessageCircle size={16} color="#fff" />
        <Text style={st.pillText}>Contact us</Text>
      </Pressable>
    </View>
  )
}

const st = StyleSheet.create({
  card: {
    marginBottom: 16, backgroundColor: Colors.cream100, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, paddingVertical: 28, paddingHorizontal: 24,
    alignItems: 'center',
  },
  emoji: { fontSize: 34, marginBottom: 8 },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.ink900, textAlign: 'center' },
  script: { fontFamily: Fonts.script, fontSize: 20, color: Colors.green700, marginTop: 2, textAlign: 'center' },
  body: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18,
    backgroundColor: Colors.green700, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12,
  },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 15, color: '#fff' },
})
