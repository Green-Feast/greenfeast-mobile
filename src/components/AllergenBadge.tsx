import { View, Text, StyleSheet } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Colors, Fonts } from '@/constants/colors'

interface AllergenBadgeProps {
  label: string
}

function LeafIcon() {
  return (
    <Svg width={11} height={13} viewBox="0 0 12 14" fill="none">
      <Path
        d="M6 13C6 13 1 9.5 1 5.5C1 3 3.5 1 6 1C8.5 1 11 3 11 5.5C11 9.5 6 13 6 13Z"
        stroke={Colors.badgeText}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Path
        d="M6 13V5"
        stroke={Colors.badgeText}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  )
}

export default function AllergenBadge({ label }: AllergenBadgeProps) {
  return (
    <View style={styles.badge}>
      <LeafIcon />
      <Text style={styles.text}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.badgeBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  text: {
    fontFamily: Fonts.bodyMed,
    fontSize: 11,
    color: Colors.badgeText,
  },
})
