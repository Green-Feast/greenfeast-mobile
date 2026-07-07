import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'

type Props = {
  title: string
  body: string
}

export default function LegalDocScreen({ title, body }: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <ChevronLeft size={22} color={Colors.ink900} />
        </Pressable>
        <Text style={styles.topBarTitle}>{title}</Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.body}>{body}</Text>
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
  body: { fontFamily: Fonts.body, fontSize: 14, color: Colors.ink600, lineHeight: 22 },
})
