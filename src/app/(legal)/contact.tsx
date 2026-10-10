import { View, Text, ScrollView, Pressable, StyleSheet, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Phone, Mail, MapPin, MessageCircle } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'
import {
  BUSINESS_NAME,
  BUSINESS_OPERATOR,
  BUSINESS_ADDRESS,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_WHATSAPP_NUMBER,
  SUPPORT_EMAIL,
  OPS_EMAIL,
  supportWhatsAppUrl,
} from '@/constants/links'

function Row({
  icon, label, value, onPress,
}: { icon: React.ReactNode; label: string; value: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.rowPressed : null]}
    >
      <View style={styles.iconWrap}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </Pressable>
  )
}

export default function ContactScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ChevronLeft size={22} color={Colors.ink900} />
        </Pressable>
        <Text style={styles.topBarTitle}>Contact Us</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.biz}>{BUSINESS_NAME}</Text>
        <Text style={styles.bizSub}>Fresh, macro-balanced meal subscriptions, delivered in Jaipur.</Text>
        <Text style={styles.operator}>Operated by {BUSINESS_OPERATOR}</Text>

        <View style={styles.card}>
          <Row
            icon={<MessageCircle size={18} color={Colors.whatsapp} />}
            label="WhatsApp (fastest)"
            value={SUPPORT_PHONE_DISPLAY}
            onPress={() => Linking.openURL(supportWhatsAppUrl('Contact Us page')).catch(() => {})}
          />
          <View style={styles.divider} />
          <Row
            icon={<Phone size={18} color={Colors.green700} />}
            label="Phone"
            value={SUPPORT_PHONE_DISPLAY}
            onPress={() => Linking.openURL(`tel:+${SUPPORT_WHATSAPP_NUMBER}`).catch(() => {})}
          />
          <View style={styles.divider} />
          <Row
            icon={<Mail size={18} color={Colors.green700} />}
            label="Email: support and billing"
            value={SUPPORT_EMAIL}
            onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {})}
          />
          <View style={styles.divider} />
          <Row
            icon={<Mail size={18} color={Colors.green700} />}
            label="Email: orders and deliveries"
            value={OPS_EMAIL}
            onPress={() => Linking.openURL(`mailto:${OPS_EMAIL}`).catch(() => {})}
          />
          <View style={styles.divider} />
          <Row
            icon={<MapPin size={18} color={Colors.green700} />}
            label="Kitchen and registered address"
            value={BUSINESS_ADDRESS}
          />
        </View>

        <Text style={styles.note}>
          We reply to every message within 1 business day. For a delivery or food issue, include your registered phone
          number and a photo. See Refunds & Cancellations for what we can refund.
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.cream50 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  topBarTitle: { fontFamily: Fonts.headingSemi, fontSize: 17, color: Colors.ink900 },
  scroll: { padding: 20 },
  biz: { fontFamily: Fonts.headingSemi, fontSize: 24, color: Colors.ink900 },
  bizSub: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink600, marginTop: 4, lineHeight: 20 },
  operator: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500, marginTop: 6, marginBottom: 20 },
  card: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  rowPressed: { backgroundColor: Colors.cream100 },
  iconWrap: { width: 24, alignItems: 'center' },
  rowLabel: { fontFamily: Fonts.body, fontSize: 12, color: Colors.ink500 },
  rowValue: { fontFamily: Fonts.bodySemi, fontSize: 15, color: Colors.ink900, marginTop: 2, lineHeight: 21 },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 54 },
  note: { fontFamily: Fonts.body, fontSize: 13, color: Colors.ink500, lineHeight: 20, marginTop: 18 },
})
