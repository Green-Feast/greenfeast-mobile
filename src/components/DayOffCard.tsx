// My Plan on a Sunday: our day off for subscriptions. Points to Swiggy/Zomato
// for a meal anyway, and to WhatsApp for anything specific (only the office
// can put a meal on a Sunday).
import { View, Text, Pressable, StyleSheet, Linking } from 'react-native'
import * as Haptics from 'expo-haptics'
import { MessageCircle, ExternalLink } from 'lucide-react-native'
import { supportWhatsAppUrl, SWIGGY_URL, ZOMATO_URL, isConfigured } from '@/constants/links'
import { Colors, Fonts } from '@/constants/colors'

function open(url: string) {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
  Linking.openURL(url).catch(() => {})
}

export default function DayOffCard() {
  return (
    <View style={st.card}>
      <Text style={st.title}>Sunday&apos;s our day off for subscriptions</Text>
      <Text style={st.body}>
        You can order via Zomato or Swiggy. For any specific requirement, just ask.
      </Text>
      <View style={st.row}>
        {isConfigured(SWIGGY_URL) && (
          <Pressable
            style={({ pressed }) => [st.pill, { backgroundColor: '#FC8019' }, pressed && st.pressed]}
            onPress={() => open(SWIGGY_URL)}
            accessibilityRole="link"
          >
            <ExternalLink size={15} color="#fff" />
            <Text style={st.pillText}>Swiggy</Text>
          </Pressable>
        )}
        {isConfigured(ZOMATO_URL) && (
          <Pressable
            style={({ pressed }) => [st.pill, { backgroundColor: '#E23744' }, pressed && st.pressed]}
            onPress={() => open(ZOMATO_URL)}
            accessibilityRole="link"
          >
            <ExternalLink size={15} color="#fff" />
            <Text style={st.pillText}>Zomato</Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [st.pill, { backgroundColor: Colors.green700 }, pressed && st.pressed]}
          onPress={() => open(supportWhatsAppUrl('My Plan > Sunday'))}
          accessibilityRole="button"
        >
          <MessageCircle size={15} color="#fff" />
          <Text style={st.pillText}>Contact us</Text>
        </Pressable>
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  card: {
    marginBottom: 16, backgroundColor: Colors.cream100, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, paddingVertical: 28, paddingHorizontal: 24,
    alignItems: 'center',
  },
  title: { fontFamily: Fonts.heading, fontSize: 22, color: Colors.ink900, textAlign: 'center' },
  body: { fontFamily: Fonts.body, fontSize: 14, color: Colors.textMuted, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 20 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  pillText: { fontFamily: Fonts.bodySemi, fontSize: 14, color: '#fff' },
})
