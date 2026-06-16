import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { Colors, Fonts } from '@/constants/colors'

interface ScreenHeaderProps {
  title?: string
  subtitle?: string
  showBack?: boolean
  onBack?: () => void
}

// Sticky top header matching the demo's Layout header (back arrow + title/subtitle).
export default function ScreenHeader({ title, subtitle, showBack, onBack }: ScreenHeaderProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  function handleBack() {
    if (onBack) onBack()
    else router.back()
  }

  return (
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
      {showBack && (
        <Pressable
          onPress={handleBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
          hitSlop={8}
        >
          <ArrowLeft size={22} color={Colors.text} />
        </Pressable>
      )}
      {title && (
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    marginLeft: -8,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnPressed: { backgroundColor: Colors.primaryLight },
  titleWrap: { flex: 1 },
  title: { fontFamily: Fonts.headingSemi, fontSize: 18, color: Colors.text },
  subtitle: { fontFamily: Fonts.body, fontSize: 12, color: Colors.textMuted, marginTop: 2 },
})
